import { mutation } from "../_generated/server";
import { v } from "convex/values";
import { Doc, Id } from "../_generated/dataModel";
import {
  DEFAULT_INIT_DIFFICULTY,
  DEFAULT_INIT_STABILITY,
  DIFF_DELTA_AGAIN,
  DIFF_DELTA_GOOD,
  DIFFICULTY_MAX,
  DIFFICULTY_MIN,
  STAB_DECAY_AGAIN,
  STAB_GROWTH_GOOD,
  STABILITY_MAX,
  STABILITY_MIN,
} from "./config";

const MS_PER_DAY = 86_400_000;

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

// weight(q) = 0.6 + 0.2 * difficulty   →   d=1: 0.8 … d=5: 1.6.
// Unknown difficulty defaults to 3 (matches A.2's "legacy / unrated" case).
function weightFor(difficulty: number): number {
  return 0.6 + 0.2 * difficulty;
}

// Phase A.2 — record one student attempt.
//
// Caller passes either:
//   - `questionId`: the canonical questionBank-linked path. Concepts come
//     from `questionConcepts`; difficulty from `questionBank.difficulty`.
//   - `exerciseId` (optionally with `questionKey`): the legacy fallback. We
//     have no per-question tagging, so the attempt is credited to *every*
//     concept-type exercise in the same unit at difficulty 3. The attemptLog
//     row is tagged with source = "legacy-unit-fallback" for later audit,
//     overriding whatever the caller passed.
//
// `response`:
//   - "good"    → success: stability grows, difficulty drops slightly.
//   - "again"   → failure: stability decays sharply, difficulty rises.
//   - "skipped" → no-op (returns early, no memory write, no log row).
//
// Multi-concept question rule: every tagged concept receives a full-weight
// update + its own attemptLog row. Optional per-tag weight (Phase G) is
// reserved on `questionConcepts.weight` and not yet consulted here.
export const recordAttempt = mutation({
  args: {
    studentId: v.id("students"),
    questionId: v.optional(v.id("questionBank")),
    exerciseId: v.optional(v.id("exercises")),
    questionKey: v.optional(v.string()),
    response: v.string(), // "good" | "again" | "skipped"
    occurredAt: v.number(),
    source: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (args.response === "skipped") {
      // Per A.2 algorithm: no memory update and no log row for skips.
      return { updatedConcepts: 0, loggedAttempts: 0 };
    }
    if (args.response !== "good" && args.response !== "again") {
      throw new Error(
        `recordAttempt: response must be 'good' | 'again' | 'skipped' (got '${args.response}')`,
      );
    }
    if (!args.questionId && !args.exerciseId) {
      throw new Error(
        "recordAttempt: provide either questionId or exerciseId",
      );
    }

    // Resolve target concepts + per-attempt difficulty.
    let conceptIds: Array<Id<"exercises">> = [];
    let difficulty = 3;
    let usedLegacyFallback = false;
    let resolvedExerciseId: Id<"exercises"> | undefined = args.exerciseId;
    let resolvedQuestionKey: string | undefined = args.questionKey;

    if (args.questionId) {
      const question = await ctx.db.get(args.questionId);
      if (!question) {
        throw new Error(`recordAttempt: questionBank row ${args.questionId} not found`);
      }
      const tags = await ctx.db
        .query("questionConcepts")
        .withIndex("by_question", (q) => q.eq("questionId", args.questionId!))
        .collect();
      conceptIds = tags.map((t) => t.conceptExerciseId);
      difficulty = question.difficulty ?? 3;
      // Prefer the question's own back-link to the legacy exercise identity.
      // Only fall back to the caller-supplied exerciseId if the question is
      // unlinked (early-stage textbook crops sometimes are).
      resolvedExerciseId = question.linkedExerciseId ?? args.exerciseId;
      resolvedQuestionKey = question.linkedQuestionKey ?? args.questionKey;
    } else {
      const exercise = await ctx.db.get(args.exerciseId!);
      if (!exercise) {
        throw new Error(`recordAttempt: exercises row ${args.exerciseId} not found`);
      }
      const siblings = await ctx.db
        .query("exercises")
        .withIndex("by_unit", (q) => q.eq("unitId", exercise.unitId))
        .collect();
      conceptIds = siblings
        .filter((e) => e.type === "concept")
        .map((e) => e._id);
      difficulty = 3;
      usedLegacyFallback = true;
    }

    if (conceptIds.length === 0) {
      // No concept tagging exists yet. Nothing to update / log; surface to
      // caller so they can decide whether to warn.
      return { updatedConcepts: 0, loggedAttempts: 0 };
    }

    const weight = weightFor(difficulty);
    const source = usedLegacyFallback
      ? "legacy-unit-fallback"
      : args.source ?? "session";

    let updatedConcepts = 0;
    let loggedAttempts = 0;

    for (const conceptId of conceptIds) {
      const existing: Doc<"memoryState"> | null = await ctx.db
        .query("memoryState")
        .withIndex("by_student_concept", (q) =>
          q.eq("studentId", args.studentId).eq("conceptExerciseId", conceptId),
        )
        .unique();

      // Lazy-init on first attempt for this (student, concept) pair.
      const state: {
        difficulty: number;
        stability: number;
        attemptCount: number;
        correctWeighted: number;
        wrongWeighted: number;
        lastReviewAt: number;
      } = existing
        ? {
            difficulty: existing.difficulty,
            stability: existing.stability,
            attemptCount: existing.attemptCount,
            correctWeighted: existing.correctWeighted,
            wrongWeighted: existing.wrongWeighted,
            lastReviewAt: existing.lastReviewAt,
          }
        : {
            difficulty: DEFAULT_INIT_DIFFICULTY,
            stability: DEFAULT_INIT_STABILITY,
            attemptCount: 0,
            correctWeighted: 0,
            wrongWeighted: 0,
            lastReviewAt: args.occurredAt,
          };

      const daysSince =
        state.attemptCount > 0
          ? (args.occurredAt - state.lastReviewAt) / MS_PER_DAY
          : 0;

      if (args.response === "good") {
        // Stability grows; small extra boost for reviews that survived a
        // long gap (lag bonus scaled by daysSince / max(S, 0.5)).
        const lagBonus = 1 + 0.1 * (daysSince / Math.max(state.stability, 0.5));
        state.stability = state.stability * STAB_GROWTH_GOOD * lagBonus;
        state.difficulty = state.difficulty + DIFF_DELTA_GOOD;
        state.correctWeighted = state.correctWeighted + weight;
      } else {
        // "again" — wrong answer. Stability decays sharply, difficulty rises.
        state.stability = state.stability * STAB_DECAY_AGAIN;
        state.difficulty = state.difficulty + DIFF_DELTA_AGAIN;
        state.wrongWeighted = state.wrongWeighted + weight;
      }

      state.difficulty = clamp(state.difficulty, DIFFICULTY_MIN, DIFFICULTY_MAX);
      state.stability = clamp(state.stability, STABILITY_MIN, STABILITY_MAX);
      state.lastReviewAt = args.occurredAt;
      state.attemptCount = state.attemptCount + 1;

      if (existing) {
        await ctx.db.patch(existing._id, {
          difficulty: state.difficulty,
          stability: state.stability,
          lastReviewAt: state.lastReviewAt,
          lastResponse: args.response,
          attemptCount: state.attemptCount,
          correctWeighted: state.correctWeighted,
          wrongWeighted: state.wrongWeighted,
        });
      } else {
        await ctx.db.insert("memoryState", {
          studentId: args.studentId,
          conceptExerciseId: conceptId,
          difficulty: state.difficulty,
          stability: state.stability,
          lastReviewAt: state.lastReviewAt,
          lastResponse: args.response,
          attemptCount: state.attemptCount,
          correctWeighted: state.correctWeighted,
          wrongWeighted: state.wrongWeighted,
          initializedAt: args.occurredAt,
        });
      }
      updatedConcepts += 1;

      await ctx.db.insert("attemptLog", {
        studentId: args.studentId,
        conceptExerciseId: conceptId,
        questionId: args.questionId,
        exerciseId: resolvedExerciseId,
        questionKey: resolvedQuestionKey,
        response: args.response,
        difficulty,
        weight,
        occurredAt: args.occurredAt,
        source,
      });
      loggedAttempts += 1;
    }

    return { updatedConcepts, loggedAttempts };
  },
});
