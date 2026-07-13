// Coverage forecast advisor (2026-07-14) — the runway view for coverage
// mode. Per track unit: book-question pool size, how many this student has
// SEEN (any prior sheet), and whether the rest fits before the exam at the
// student's observed sheet pace. Pure math in lib/coverageForecastCore.ts;
// this file only gathers inputs:
//   pool  — questionsTaggedToConcept per concept (leaf questions only, the
//           exact same helper the planner's candidate pool uses).
//   seen  — union of question ids across ALL the student's generatedSheets.
//   pace  — sheets + questions in the last PACE_WINDOW_DAYS.
//   exams — examCalendar at the track's target grade, next date per term.

import { query } from "../_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { resolveTrackForStudent } from "./tracks";
import { questionsTaggedToConcept } from "./derivedConcepts";
import {
  forecastCoverage,
  type ForecastUnitInput,
} from "../lib/coverageForecastCore";

const MS_PER_DAY = 86_400_000;
// Pace observation window. Two weeks smooths over off-days and absences
// without reaching so far back that an old schedule pollutes the rate.
const PACE_WINDOW_DAYS = 14;

function ymdFromMs(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function sheetQuestionIds(s: Doc<"generatedSheets">): Id<"questionBank">[] {
  return [
    ...s.warmupQuestionIds,
    ...s.mainQuestionIds,
    ...(s.revisionQuestionIds ?? []),
    ...s.examPrepQuestionIds,
  ];
}

export const coverageForecastForStudent = query({
  args: {
    studentId: v.id("students"),
    // Client-supplied curriculum metadata (backend can't read
    // src/lib/curriculum-data.ts — same pattern as trackProgressForStudent).
    units: v.array(
      v.object({
        unitId: v.string(),
        unitName: v.string(),
        grade: v.number(),
        term: v.number(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const student = await ctx.db.get(args.studentId);
    if (!student) return null;

    const track = await resolveTrackForStudent(ctx, student);
    if (!track) return { status: "no-track" as const };

    const nowMs = Date.now();
    const todayYmd = ymdFromMs(nowMs);
    const metaByUnit = new Map(args.units.map((u) => [u.unitId, u]));

    // ── Seen set (all time) + pace (recent window), one indexed read ─────
    const sheets = await ctx.db
      .query("generatedSheets")
      .withIndex("by_student_date", (q) => q.eq("studentId", args.studentId))
      .collect();
    const seen = new Set<string>();
    const paceStartYmd = ymdFromMs(nowMs - PACE_WINDOW_DAYS * MS_PER_DAY);
    let recentSheetCount = 0;
    let recentQuestionCount = 0;
    for (const s of sheets) {
      const qids = sheetQuestionIds(s);
      for (const qid of qids) seen.add(qid as unknown as string);
      if (s.date >= paceStartYmd && s.date <= todayYmd) {
        recentSheetCount += 1;
        recentQuestionCount += qids.length;
      }
    }

    // ── Per-unit pools along the track ───────────────────────────────────
    const unitInputs: ForecastUnitInput[] = [];
    const unitNames = new Map<string, string>();
    for (const unitId of track.orderedUnitIds) {
      const meta = metaByUnit.get(unitId) ?? null;
      const parsedTerm = /^M\d+-G\d+-T(\d+)-\d+$/.exec(unitId);
      const term = meta?.term ?? (parsedTerm ? Number(parsedTerm[1]) : null);
      unitNames.set(unitId, meta?.unitName ?? unitId);

      const exRows = await ctx.db
        .query("exercises")
        .withIndex("by_unit", (q) => q.eq("unitId", unitId))
        .collect();
      const pool = new Set<string>();
      for (const row of exRows) {
        if (row.type !== "concept") continue;
        const qids = await questionsTaggedToConcept(ctx, row._id);
        for (const qid of qids) pool.add(qid as unknown as string);
      }
      let seenCount = 0;
      pool.forEach((qid) => {
        if (seen.has(qid)) seenCount += 1;
      });
      unitInputs.push({
        unitId,
        term,
        totalQuestions: pool.size,
        seenQuestions: seenCount,
      });
    }

    // ── Next exam per term at the track's target grade ───────────────────
    const examRows = await ctx.db
      .query("examCalendar")
      .withIndex("by_grade", (q) => q.eq("grade", track.targetGrade))
      .collect();
    const daysToExamByTerm: Record<string, number | null> = {};
    for (const row of examRows) {
      if (row.examDate < todayYmd) continue;
      const key = String(row.term);
      const days = Math.round(
        (Date.parse(`${row.examDate}T00:00:00.000Z`) - nowMs) / MS_PER_DAY,
      );
      const cur = daysToExamByTerm[key];
      if (cur === undefined || cur === null || days < cur) {
        daysToExamByTerm[key] = days;
      }
    }

    const result = forecastCoverage({
      units: unitInputs,
      pace: {
        windowDays: PACE_WINDOW_DAYS,
        recentSheetCount,
        recentQuestionCount,
      },
      daysToExamByTerm,
    });

    return {
      status: "ok" as const,
      trackName: track.name,
      units: result.units.map((u) => ({
        ...u,
        unitName: unitNames.get(u.unitId) ?? u.unitId,
      })),
      summary: result.summary,
      paceWindowDays: PACE_WINDOW_DAYS,
    };
  },
});
