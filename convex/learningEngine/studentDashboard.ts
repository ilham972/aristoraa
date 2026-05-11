import { query } from "../_generated/server";
import { v } from "convex/values";
import { Doc, Id } from "../_generated/dataModel";
import { masteryFromState } from "./mastery";

// Phase A.5 — read-only "give me everything the dashboard needs in one query."
// Returns concept-type exercises joined with the student's memoryState (or
// cold defaults) and per-concept attempt totals. Frontend resolves module +
// grade + term via curriculum-data (backend can't import from src/lib).
export const studentMastery = query({
  args: { studentId: v.id("students") },
  handler: async (ctx, { studentId }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;

    const student = await ctx.db.get(studentId);
    if (!student) return null;

    const concepts = (await ctx.db.query("exercises").collect()).filter(
      (e) => e.type === "concept",
    );

    const states = await ctx.db
      .query("memoryState")
      .withIndex("by_student", (q) => q.eq("studentId", studentId))
      .collect();
    const stateByConcept = new Map<string, Doc<"memoryState">>();
    for (const s of states) {
      stateByConcept.set(s.conceptExerciseId as unknown as string, s);
    }

    const now = Date.now();
    const rows = concepts.map((c) => {
      const state = stateByConcept.get(c._id as unknown as string);
      const m = state
        ? masteryFromState(state, now)
        : { R: 0, accFactor: 0.5, mastery: 0 };
      return {
        conceptId: c._id as Id<"exercises">,
        unitId: c.unitId,
        name: c.name,
        order: c.order,
        mastery: m.mastery,
        R: m.R,
        accFactor: m.accFactor,
        attemptCount: state?.attemptCount ?? 0,
        correctWeighted: state?.correctWeighted ?? 0,
        wrongWeighted: state?.wrongWeighted ?? 0,
        lastReviewAt: state?.lastReviewAt ?? null,
        stability: state?.stability ?? null,
        difficulty: state?.difficulty ?? null,
        lastResponse: state?.lastResponse ?? null,
        hasState: state !== undefined,
      };
    });

    return {
      student: {
        id: student._id,
        name: student.name,
        schoolGrade: student.schoolGrade,
        assignedGrades: student.assignedGrades ?? [student.schoolGrade],
      },
      rows,
      generatedAt: now,
    };
  },
});
