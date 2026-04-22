import { query } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";

// Aggregate queries for timeline views.
// Works over `entries` + `currentAssignments` (for concept-watch completions).

export const byStudent = query({
  args: {
    studentId: v.id("students"),
    startDate: v.string(), // inclusive, YYYY-MM-DD
    endDate: v.string(),   // inclusive
    moduleId: v.optional(v.string()), // filter to one module
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return { entries: [], assignments: [] };

    const entries = await ctx.db
      .query("entries")
      .withIndex("by_student", (q) => q.eq("studentId", args.studentId))
      .collect();

    const inRange = entries.filter(
      (e) =>
        e.date >= args.startDate &&
        e.date <= args.endDate &&
        (!args.moduleId || e.moduleId === args.moduleId)
    );

    // Concept completions: any currentAssignments row with type === "concept"
    // and completedAt set, in date range.
    const assignmentRows = await ctx.db
      .query("currentAssignments")
      .withIndex("by_student_date", (q) => q.eq("studentId", args.studentId))
      .collect();
    const assignments = assignmentRows.filter(
      (a) => a.date >= args.startDate && a.date <= args.endDate
    );

    return { entries: inRange, assignments };
  },
});

// Cross-student comparison: a grade + module for a date range.
// Returns rows { student, countsByDate: { date: { correct, wrong, exerciseCount } } }.
export const compare = query({
  args: {
    grade: v.number(),
    moduleId: v.string(),
    startDate: v.string(),
    endDate: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return { rows: [] };

    const students = await ctx.db.query("students").collect();
    const inGrade = students.filter((s) => s.schoolGrade === args.grade);

    const rows: Array<{
      student: Doc<"students">;
      countsByDate: Record<string, { correct: number; wrong: number; exerciseCount: number }>;
      totalCorrect: number;
      totalExercises: number;
    }> = [];

    for (const s of inGrade) {
      const entries = await ctx.db
        .query("entries")
        .withIndex("by_student", (q) => q.eq("studentId", s._id))
        .collect();
      const filtered = entries.filter(
        (e) =>
          e.moduleId === args.moduleId &&
          e.date >= args.startDate &&
          e.date <= args.endDate
      );
      const countsByDate: Record<string, { correct: number; wrong: number; exerciseCount: number }> = {};
      let totalCorrect = 0;
      const exerciseIds = new Set<Id<"exercises">>();
      for (const e of filtered) {
        const day = countsByDate[e.date] ?? { correct: 0, wrong: 0, exerciseCount: 0 };
        day.correct += e.correctCount;
        day.wrong += Math.max(0, e.totalAttempted - e.correctCount);
        day.exerciseCount += 1;
        countsByDate[e.date] = day;
        totalCorrect += e.correctCount;
        exerciseIds.add(e.exerciseId);
      }
      rows.push({
        student: s,
        countsByDate,
        totalCorrect,
        totalExercises: exerciseIds.size,
      });
    }

    rows.sort((a, b) => b.totalCorrect - a.totalCorrect);
    return { rows };
  },
});
