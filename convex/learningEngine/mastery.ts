import { query } from "../_generated/server";
import { v } from "convex/values";
import { Doc, Id } from "../_generated/dataModel";
import { ACC_ALPHA, FACTOR } from "./config";

const MS_PER_DAY = 86_400_000;

// Defaults for a (student, concept) pair that has no memoryState row yet —
// i.e. the student has never attempted this concept. Treat as fully forgotten
// with neutral accuracy: R = 0, accFactor = 0.5, mastery = 0. The sheet
// planner reads `mastery = 0` as "needs first exposure."
const COLD_R = 0;
const COLD_ACC_FACTOR = 0.5;
const COLD_MASTERY = 0;

function clamp01(x: number): number {
  if (Number.isNaN(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

// Derive R, accFactor, mastery for a single memoryState row at a given time.
// Exported as a pure function (no ctx access) so other layers can reuse it
// from inside replays / calibration snapshots (Phase F.3).
export function masteryFromState(
  state: Pick<
    Doc<"memoryState">,
    "stability" | "lastReviewAt" | "correctWeighted" | "wrongWeighted"
  >,
  atTimeMs: number,
): { R: number; accFactor: number; mastery: number } {
  // Clamp t to 0 for atTime < lastReviewAt (Phase F.3 replay edge case).
  const tDays = Math.max(0, (atTimeMs - state.lastReviewAt) / MS_PER_DAY);
  const R = Math.pow(1 + tDays / (FACTOR * state.stability), -1);
  const accFactor = sigmoid(
    ACC_ALPHA * (state.correctWeighted - state.wrongWeighted),
  );
  const mastery = R * accFactor;
  return {
    R: clamp01(R),
    accFactor: clamp01(accFactor),
    mastery: clamp01(mastery),
  };
}

// Phase A.3 — read-only mastery query for a single (student, concept).
export const masteryFor = query({
  args: {
    studentId: v.id("students"),
    conceptExerciseId: v.id("exercises"),
    atTime: v.optional(v.number()), // ms epoch; defaults to now
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return { R: COLD_R, accFactor: COLD_ACC_FACTOR, mastery: COLD_MASTERY };
    }
    const state = await ctx.db
      .query("memoryState")
      .withIndex("by_student_concept", (q) =>
        q
          .eq("studentId", args.studentId)
          .eq("conceptExerciseId", args.conceptExerciseId),
      )
      .unique();
    if (!state) {
      return { R: COLD_R, accFactor: COLD_ACC_FACTOR, mastery: COLD_MASTERY };
    }
    return masteryFromState(state, args.atTime ?? Date.now());
  },
});

// Phase A.3 — bulk query for every concept the student has any memoryState on.
// One student-indexed lookup; mastery for cold (no-row) concepts is the
// caller's job (the dashboard knows the concept list from curriculum data).
export const masteryAll = query({
  args: {
    studentId: v.id("students"),
    atTime: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [] as Array<{
      conceptExerciseId: Id<"exercises">;
      R: number;
      accFactor: number;
      mastery: number;
      lastReviewAt: number;
      stability: number;
      difficulty: number;
      attemptCount: number;
      correctWeighted: number;
      wrongWeighted: number;
      lastResponse: string;
    }>;

    const states = await ctx.db
      .query("memoryState")
      .withIndex("by_student", (q) => q.eq("studentId", args.studentId))
      .collect();

    const at = args.atTime ?? Date.now();
    return states.map((state) => {
      const m = masteryFromState(state, at);
      return {
        conceptExerciseId: state.conceptExerciseId,
        R: m.R,
        accFactor: m.accFactor,
        mastery: m.mastery,
        lastReviewAt: state.lastReviewAt,
        stability: state.stability,
        difficulty: state.difficulty,
        attemptCount: state.attemptCount,
        correctWeighted: state.correctWeighted,
        wrongWeighted: state.wrongWeighted,
        lastResponse: state.lastResponse,
      };
    });
  },
});
