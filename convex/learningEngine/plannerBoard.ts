// Global Planner backend (departments redesign follow-up, 2026-07-14).
//
// The /planner nav page is the one place the founder pre-plans every grade's
// term: exam countdown, each group's lesson-plan state, and a grade-wide
// coverage forecast. Two queries:
//   plannerGroups      — light listing of every real group (grade, roster,
//                        track, next session, crystallized-ahead counts) so
//                        the Term board knows what exists without running the
//                        heavy plan walk for all 20+ groups at once. The
//                        per-group heavy walk (groupLessonPlan) is subscribed
//                        per CARD, only for the selected grade.
//   gradeForecastRollup — the global version of the per-student coverage
//                        forecast: ONE pool walk per distinct track, then a
//                        cheap per-student seen/pace pass. Same pure math
//                        (lib/coverageForecastCore.ts) as the student page.

import { query } from "../_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { groupMemberStudents, resolveTrackForGroup } from "./groupPlan";
import { resolveTrackForStudent } from "./tracks";
import { questionsTaggedToConcept } from "./derivedConcepts";
import {
  forecastCoverage,
  type ForecastUnitInput,
} from "../lib/coverageForecastCore";

const MS_PER_DAY = 86_400_000;

function ymdFromMs(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

// Day-of-week for a YYYY-MM-DD, app convention 1=Mon..7=Sun.
function dowFromYmd(ymd: string): number {
  const d = new Date(`${ymd}T00:00:00.000Z`).getUTCDay();
  return d === 0 ? 7 : d;
}

// ── Term board: light per-group listing ───────────────────────────────────

export const plannerGroups = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const now = Date.now();
    const todayYmd = ymdFromMs(now);

    const groups = await ctx.db.query("groups").collect();

    const out = await Promise.all(
      groups.map(async (g) => {
        const [students, slots, futureSheets] = await Promise.all([
          groupMemberStudents(ctx, g._id),
          ctx.db
            .query("scheduleSlots")
            .withIndex("by_group", (q) => q.eq("groupId", g._id))
            .collect(),
          ctx.db
            .query("groupSheets")
            .withIndex("by_group_date", (q) =>
              q.eq("groupId", g._id).gte("date", todayYmd),
            )
            .collect(),
        ]);

        // Phantom rows (abandoned Week-view creations) stay hidden, same
        // rule as the organize board: no members AND no sessions.
        if (students.length === 0 && slots.length === 0) return null;

        // Grade: the group's declared grade, else majority member grade.
        let grade = g.grade ?? null;
        if (grade === null && students.length > 0) {
          const counts = new Map<number, number>();
          for (const s of students) {
            counts.set(s.schoolGrade, (counts.get(s.schoolGrade) ?? 0) + 1);
          }
          let best: { g: number; n: number } | null = null;
          counts.forEach((n, gr) => {
            if (!best || n > best.n) best = { g: gr, n };
          });
          grade = best ? (best as { g: number; n: number }).g : null;
        }

        const track = await resolveTrackForGroup(ctx, students);

        // Next MAIN session date within 14 days (planning is about Main).
        const mainDows = new Set(
          slots
            .filter((s) => (s.sessionType ?? "main") === "main")
            .map((s) => s.dayOfWeek),
        );
        let nextSessionDate: string | null = null;
        for (let i = 0; i < 14 && nextSessionDate === null; i++) {
          const ymd = ymdFromMs(now + i * MS_PER_DAY);
          if (mainDows.has(dowFromYmd(ymd))) nextSessionDate = ymd;
        }

        const active = futureSheets.filter((r) => r.status !== "delegated");
        const plannedThrough =
          active.length > 0
            ? active.map((r) => r.date).sort()[active.length - 1]
            : null;

        return {
          groupId: g._id,
          name: g.name,
          grade,
          memberCount: students.length,
          studentsWithTrack: students.filter((s) => s.trackId).length,
          trackId: track?._id ?? null,
          trackName: track?.name ?? null,
          mainSlotCount: mainDows.size,
          revisionSlotCount: slots.filter(
            (s) => (s.sessionType ?? "main") === "revision",
          ).length,
          nextSessionDate,
          crystallizedAhead: active.length,
          plannedThrough,
        };
      }),
    );

    return out.filter((g): g is NonNullable<typeof g> => g !== null);
  },
});

// ── Grade forecast rollup: the global coverage forecast ───────────────────

// Pace observation window — MUST match coverageForecast.ts so the student
// page and the grade rollup never disagree.
const PACE_WINDOW_DAYS = 14;

function sheetQuestionIds(s: Doc<"generatedSheets">): Id<"questionBank">[] {
  return [
    ...s.warmupQuestionIds,
    ...s.mainQuestionIds,
    ...(s.revisionQuestionIds ?? []),
    ...s.examPrepQuestionIds,
  ];
}

export const gradeForecastRollup = query({
  args: {
    grade: v.number(),
    // Client-supplied curriculum metadata (backend can't read
    // src/lib/curriculum-data.ts — same pattern as coverageForecastForStudent).
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
    const nowMs = Date.now();
    const todayYmd = ymdFromMs(nowMs);
    const metaByUnit = new Map(args.units.map((u) => [u.unitId, u]));

    const allStudents = await ctx.db.query("students").collect();
    const students = allStudents.filter((s) => s.schoolGrade === args.grade);
    if (students.length === 0) {
      return { status: "no-students" as const, students: [] };
    }

    // Resolve each student's track; pool-walk each DISTINCT track once.
    const tracks = await Promise.all(
      students.map((s) => resolveTrackForStudent(ctx, s)),
    );
    const distinctTracks = new Map<string, Doc<"tracks">>();
    for (const t of tracks) {
      if (t) distinctTracks.set(t._id as unknown as string, t);
    }

    // trackId → per-unit pool (Set of question ids), in track order.
    const poolByTrack = new Map<
      string,
      Array<{ unitId: string; term: number | null; pool: Set<string> }>
    >();
    for (const [tid, track] of Array.from(distinctTracks.entries())) {
      const unitPools = await Promise.all(
        track.orderedUnitIds.map(async (unitId: string) => {
          const exRows = await ctx.db
            .query("exercises")
            .withIndex("by_unit", (q) => q.eq("unitId", unitId))
            .collect();
          const conceptRows = exRows.filter((r) => r.type === "concept");
          const tagged = await Promise.all(
            conceptRows.map((r) => questionsTaggedToConcept(ctx, r._id)),
          );
          const pool = new Set<string>();
          for (const list of tagged) {
            for (const qid of list) pool.add(qid as unknown as string);
          }
          const meta = metaByUnit.get(unitId);
          const parsedTerm = /^M\d+-G\d+-T(\d+)-\d+$/.exec(unitId);
          const term =
            meta?.term ?? (parsedTerm ? Number(parsedTerm[1]) : null);
          return { unitId, term, pool };
        }),
      );
      poolByTrack.set(tid, unitPools);
    }

    // Exam days per (targetGrade, term) — one calendar read per grade seen.
    const targetGrades = new Set(
      Array.from(distinctTracks.values()).map((t) => t.targetGrade),
    );
    const daysToExamByGradeTerm = new Map<
      number,
      Record<string, number | null>
    >();
    for (const g of Array.from(targetGrades)) {
      const rows = await ctx.db
        .query("examCalendar")
        .withIndex("by_grade", (q) => q.eq("grade", g))
        .collect();
      const byTerm: Record<string, number | null> = {};
      for (const row of rows) {
        if (row.examDate < todayYmd) continue;
        const days = Math.round(
          (Date.parse(`${row.examDate}T00:00:00.000Z`) - nowMs) / MS_PER_DAY,
        );
        const key = String(row.term);
        const cur = byTerm[key];
        if (cur === undefined || cur === null || days < cur) byTerm[key] = days;
      }
      daysToExamByGradeTerm.set(g, byTerm);
    }

    // Per-student: seen + pace from their own sheets, then the pure forecast.
    const paceStartYmd = ymdFromMs(nowMs - PACE_WINDOW_DAYS * MS_PER_DAY);
    const perStudent = await Promise.all(
      students.map(async (s, i) => {
        const track = tracks[i];
        if (!track) {
          return {
            studentId: s._id,
            name: s.name,
            trackName: null,
            status: "no-track" as const,
            units: [],
            summary: null,
          };
        }
        const sheets = await ctx.db
          .query("generatedSheets")
          .withIndex("by_student_date", (q) => q.eq("studentId", s._id))
          .collect();
        const seen = new Set<string>();
        let recentSheetCount = 0;
        let recentQuestionCount = 0;
        for (const sh of sheets) {
          const qids = sheetQuestionIds(sh);
          for (const qid of qids) seen.add(qid as unknown as string);
          if (sh.date >= paceStartYmd && sh.date <= todayYmd) {
            recentSheetCount += 1;
            recentQuestionCount += qids.length;
          }
        }

        const unitPools =
          poolByTrack.get(track._id as unknown as string) ?? [];
        const unitInputs: ForecastUnitInput[] = unitPools.map((u) => {
          let seenCount = 0;
          u.pool.forEach((qid) => {
            if (seen.has(qid)) seenCount += 1;
          });
          return {
            unitId: u.unitId,
            term: u.term,
            totalQuestions: u.pool.size,
            seenQuestions: seenCount,
          };
        });

        const result = forecastCoverage({
          units: unitInputs,
          pace: {
            windowDays: PACE_WINDOW_DAYS,
            recentSheetCount,
            recentQuestionCount,
          },
          daysToExamByTerm:
            daysToExamByGradeTerm.get(track.targetGrade) ?? {},
        });

        return {
          studentId: s._id,
          name: s.name,
          trackName: track.name,
          status: "ok" as const,
          units: result.units.map((u) => ({
            ...u,
            unitName: metaByUnit.get(u.unitId)?.unitName ?? u.unitId,
          })),
          summary: result.summary,
        };
      }),
    );

    return {
      status: "ok" as const,
      paceWindowDays: PACE_WINDOW_DAYS,
      students: perStudent,
    };
  },
});
