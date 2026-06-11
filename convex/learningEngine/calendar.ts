// Phase C.3 — Exam calendar backend.
//
// Term-exam date directory. Stores one row per (grade, term, year). Drives:
//   - Phase D.5 SR exam-date backstop (clip review intervals so concepts get a
//     fresh cycle ≥ EXAM_BACKSTOP_DAYS before their relevant paper)
//   - Phase C.2 retention-debt "marks at risk in upcoming exam"
//   - Phase G.1 exam-score predictor (projects mastery forward to examDate)
//
// examDate is a YYYY-MM-DD string (not a number) for cheap lexicographic
// comparison in the by_examDate index and to avoid timezone ambiguity at the
// day level. Callers pass `asOfDate` in the same format.

import { mutation, query } from "../_generated/server";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";

const MS_PER_DAY = 86_400_000;

// Days between two YYYY-MM-DD strings, treating them as UTC midnight. Negative
// when `to` is before `from`. The exact-day interpretation matches the way
// schedules/exam dates are managed in the rest of the app.
function daysBetweenYmd(from: string, to: string): number {
  const fromMs = Date.parse(`${from}T00:00:00.000Z`);
  const toMs = Date.parse(`${to}T00:00:00.000Z`);
  if (Number.isNaN(fromMs) || Number.isNaN(toMs)) return 0;
  return Math.round((toMs - fromMs) / MS_PER_DAY);
}

// ─── queries ──────────────────────────────────────────────────────────────

// Every exam row, ordered earliest first. Used by the C.3 management page.
export const list = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const rows = await ctx.db.query("examCalendar").collect();
    return rows.sort((a, b) => {
      if (a.examDate !== b.examDate) return a.examDate.localeCompare(b.examDate);
      if (a.grade !== b.grade) return a.grade - b.grade;
      return a.term - b.term;
    });
  },
});

export const listByGrade = query({
  args: { grade: v.number() },
  handler: async (ctx, { grade }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const rows = await ctx.db
      .query("examCalendar")
      .withIndex("by_grade", (q) => q.eq("grade", grade))
      .collect();
    return rows.sort((a, b) => a.examDate.localeCompare(b.examDate));
  },
});

// Earliest exam at examDate >= asOfDate across the given grades. Returns null
// when none scheduled. Takes a grade *list* so downgraded students
// (assignedGradesByModule) can ask for "the next exam I care about" in one
// call.
export const nextExamFor = query({
  args: {
    grades: v.array(v.number()),
    asOfDate: v.string(), // YYYY-MM-DD
  },
  handler: async (ctx, { grades, asOfDate }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    if (grades.length === 0) return null;

    const all = await ctx.db
      .query("examCalendar")
      .withIndex("by_examDate")
      .collect();
    const gradeSet = new Set(grades);

    const upcoming = all
      .filter((r) => gradeSet.has(r.grade) && r.examDate >= asOfDate)
      .sort((a, b) => a.examDate.localeCompare(b.examDate));

    return upcoming[0] ?? null;
  },
});

// Integer days from asOfDate to the next scheduled exam across `grades`.
// null when no exam is scheduled. 0 = the exam is today.
export const daysToNextExam = query({
  args: {
    grades: v.array(v.number()),
    asOfDate: v.string(),
  },
  handler: async (ctx, { grades, asOfDate }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    if (grades.length === 0) return null;

    const all = await ctx.db.query("examCalendar").collect();
    const gradeSet = new Set(grades);

    let earliest: string | null = null;
    for (const r of all) {
      if (!gradeSet.has(r.grade)) continue;
      if (r.examDate < asOfDate) continue;
      if (earliest === null || r.examDate < earliest) earliest = r.examDate;
    }
    if (earliest === null) return null;
    return daysBetweenYmd(asOfDate, earliest);
  },
});

// ─── mutations ────────────────────────────────────────────────────────────

// Upsert by (grade, term, year). Patches an existing row when found; inserts
// otherwise. The composite key is enforced here in code — Convex has no native
// unique constraint, so any direct insert outside this mutation could violate
// it. All writers in the app go through here.
export const upsert = mutation({
  args: {
    grade: v.number(),
    term: v.number(),
    year: v.number(),
    examDate: v.string(),
    totalMarks: v.optional(v.number()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");

    if (!/^\d{4}-\d{2}-\d{2}$/.test(args.examDate)) {
      throw new Error("examDate must be YYYY-MM-DD");
    }
    if (![1, 2, 3].includes(args.term)) {
      throw new Error("term must be 1, 2, or 3");
    }
    if (args.grade < 6 || args.grade > 11) {
      throw new Error("grade must be 6..11");
    }

    const existing = await ctx.db
      .query("examCalendar")
      .withIndex("by_grade_term_year", (q) =>
        q.eq("grade", args.grade).eq("term", args.term).eq("year", args.year),
      )
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        examDate: args.examDate,
        totalMarks: args.totalMarks,
        notes: args.notes,
      });
      return existing._id;
    }

    const id = await ctx.db.insert("examCalendar", {
      grade: args.grade,
      term: args.term,
      year: args.year,
      examDate: args.examDate,
      totalMarks: args.totalMarks,
      notes: args.notes,
    });
    return id;
  },
});

// Edit an existing row by id. Unlike upsert (which keys on grade/term/year),
// this lets the user change the composite key too — guarding against
// conflicts at the new key before patching. The form pre-fills with the row
// being edited and posts back here; on a key change with a conflict, the user
// gets a clear error and decides whether to delete the conflicting row first.
export const updateById = mutation({
  args: {
    id: v.id("examCalendar"),
    grade: v.number(),
    term: v.number(),
    year: v.number(),
    examDate: v.string(),
    totalMarks: v.optional(v.number()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");

    if (!/^\d{4}-\d{2}-\d{2}$/.test(args.examDate)) {
      throw new Error("examDate must be YYYY-MM-DD");
    }
    if (![1, 2, 3].includes(args.term)) {
      throw new Error("term must be 1, 2, or 3");
    }
    if (args.grade < 6 || args.grade > 11) {
      throw new Error("grade must be 6..11");
    }

    const current = await ctx.db.get(args.id);
    if (!current) throw new Error("Exam row not found");

    const keyChanged =
      current.grade !== args.grade ||
      current.term !== args.term ||
      current.year !== args.year;

    if (keyChanged) {
      const conflict = await ctx.db
        .query("examCalendar")
        .withIndex("by_grade_term_year", (q) =>
          q.eq("grade", args.grade).eq("term", args.term).eq("year", args.year),
        )
        .unique();
      if (conflict && conflict._id !== args.id) {
        throw new Error(
          `Another exam already exists for G${args.grade} Term ${args.term} ${args.year}. Delete it first or pick a different key.`,
        );
      }
    }

    await ctx.db.patch(args.id, {
      grade: args.grade,
      term: args.term,
      year: args.year,
      examDate: args.examDate,
      totalMarks: args.totalMarks,
      notes: args.notes,
    });
    return args.id;
  },
});

export const remove = mutation({
  args: { id: v.id("examCalendar") },
  handler: async (ctx, { id }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    await ctx.db.delete(id);
    return null;
  },
});

// Manual exam-mode toggle (Founder, 2026-06-11). Flipping this on puts the
// sheet planner into exam-week mode for this exam's term (Main block locks to
// the exam term). Off = normal teaching order. Replaces the old automatic
// 14-day proximity trigger in determinePhase.
export const setExamMode = mutation({
  args: { id: v.id("examCalendar"), active: v.boolean() },
  handler: async (ctx, { id, active }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    const row = await ctx.db.get(id);
    if (!row) throw new Error("Exam row not found");
    await ctx.db.patch(id, { examModeActive: active });
    return id;
  },
});

// Re-export the date helper so profile.ts can compute "days to exam" without
// going through a Convex query.
export { daysBetweenYmd };

export type ExamCalendarRow = {
  _id: Id<"examCalendar">;
  grade: number;
  term: number;
  year: number;
  examDate: string;
  totalMarks?: number;
  notes?: string;
  examModeActive?: boolean;
};
