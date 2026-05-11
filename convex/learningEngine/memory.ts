import { MutationCtx, mutation } from "../_generated/server";
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

// weight(q) = 0.6 + 0.2 * difficulty   ->   d=1 yields 0.8, d=5 yields 1.6.
// Unknown difficulty defaults to 3 (legacy / unrated path).
function weightFor(difficulty: number): number {
  return 0.6 + 0.2 * difficulty;
}

export interface ApplyAttemptArgs {
  studentId: Id<"students">;
  questionId?: Id<"questionBank">;
  exerciseId?: Id<"exercises">;
  questionKey?: string;
  response: string; // "good" | "again" | "skipped"
  occurredAt: number;
  source?: string;
}

// Phase A.2 core. Shared between the public `recordAttempt` mutation and the
// A.4 backfill mutation so the latter can process many attempts inside a
// single transaction without going through one mutation call per row.
//
// Behaviour matches the algorithm_plan.md A.2 block:
//   - questionId path: concepts via questionConcepts; difficulty from
//     questionBank.difficulty (default 3 when unrated).
//   - legacy fallback (exerciseId only): credits every concept-type
//     exercise in the unit at difficulty 3; attemptLog source override
//     to "legacy-unit-fallback".
//   - response "good": S *= STAB_GROWTH_GOOD * lag-bonus, D += DIFF_DELTA_GOOD,
//     correctWeighted += weight.
//   - response "again": S *= STAB_DECAY_AGAIN, D += DIFF_DELTA_AGAIN,
//     wrongWeighted += weight.
//   - response "skipped": no-op, no log row.
//   - Multi-concept question: every tagged concept gets full-weight update
//     plus its own attemptLog row.
export async function applyAttempt(
  ctx: MutationCtx,
  args: ApplyAttemptArgs,
): Promise<{ updatedConcepts: number; loggedAttempts: number }> {
  if (args.response === "skipped") {
    return { updatedConcepts: 0, loggedAttempts: 0 };
  }
  if (args.response !== "good" && args.response !== "again") {
    throw new Error(
      `recordAttempt: response must be 'good' | 'again' | 'skipped' (got '${args.response}')`,
    );
  }
  if (!args.questionId && !args.exerciseId) {
    throw new Error("recordAttempt: provide either questionId or exerciseId");
  }

  let conceptIds: Array<Id<"exercises">> = [];
  let difficulty = 3;
  let usedLegacyFallback = false;
  let resolvedExerciseId: Id<"exercises"> | undefined = args.exerciseId;
  let resolvedQuestionKey: string | undefined = args.questionKey;

  if (args.questionId) {
    const question = await ctx.db.get(args.questionId);
    if (!question) {
      throw new Error(
        `recordAttempt: questionBank row ${args.questionId} not found`,
      );
    }
    const qId = args.questionId;
    const tags = await ctx.db
      .query("questionConcepts")
      .withIndex("by_question", (q) => q.eq("questionId", qId))
      .collect();
    conceptIds = tags.map((t) => t.conceptExerciseId);
    difficulty = question.difficulty ?? 3;
    resolvedExerciseId = question.linkedExerciseId ?? args.exerciseId;
    resolvedQuestionKey = question.linkedQuestionKey ?? args.questionKey;
  } else {
    const exercise = await ctx.db.get(args.exerciseId!);
    if (!exercise) {
      throw new Error(
        `recordAttempt: exercises row ${args.exerciseId} not found`,
      );
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
    return { updatedConcepts: 0, loggedAttempts: 0 };
  }

  const weight = weightFor(difficulty);
  // Caller-supplied source always wins (e.g. backfill needs to tag its rows
  // unambiguously for idempotency checks). When the caller omits it we
  // default to "legacy-unit-fallback" for the legacy path and "session"
  // for the canonical questionId path.
  const source =
    args.source ?? (usedLegacyFallback ? "legacy-unit-fallback" : "session");

  let updatedConcepts = 0;
  let loggedAttempts = 0;

  for (const conceptId of conceptIds) {
    const existing: Doc<"memoryState"> | null = await ctx.db
      .query("memoryState")
      .withIndex("by_student_concept", (q) =>
        q.eq("studentId", args.studentId).eq("conceptExerciseId", conceptId),
      )
      .unique();

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
      const lagBonus = 1 + 0.1 * (daysSince / Math.max(state.stability, 0.5));
      state.stability = state.stability * STAB_GROWTH_GOOD * lagBonus;
      state.difficulty = state.difficulty + DIFF_DELTA_GOOD;
      state.correctWeighted = state.correctWeighted + weight;
    } else {
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
}

export const recordAttempt = mutation({
  args: {
    studentId: v.id("students"),
    questionId: v.optional(v.id("questionBank")),
    exerciseId: v.optional(v.id("exercises")),
    questionKey: v.optional(v.string()),
    response: v.string(),
    occurredAt: v.number(),
    source: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await applyAttempt(ctx, args);
  },
});
