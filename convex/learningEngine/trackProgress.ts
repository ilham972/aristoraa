// Track Progress view — the read-time query behind /students/[id]/progress
// and the session Sheets-tab strip.
// Spec: docs/superpowers/specs/2026-07-10-track-progress-view-design.md
//
// Founder decision (2026-07-10): COMPUTE FRESH ON OPEN. No saved progress
// table — this query derives everything live from the same rows the planner
// reads (track order, exercises, memoryState), so the view can never drift
// from what sheets actually do, and Convex reactivity updates it in real
// time while the teacher scores. All derivation rules live in
// convex/lib/trackProgressCore.ts (pure, unit-tested); this file only loads
// data and assembles the response.

import { query } from "../_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { masteryFromState } from "./mastery";
import { resolveTrackForStudent } from "./tracks";
import { resolveUnitPacing } from "./path";
import { questionsTaggedToConcept } from "./derivedConcepts";
import {
  MASTERY_THRESHOLD,
  MINUTES_PER_NEW_CONCEPT,
  MAIN_NEW_CONCEPTS_MIN,
  MAIN_NEW_CONCEPTS_MAX,
  SESSION_MIN_DEFAULT,
} from "./config";
import {
  minutesBetweenClock,
  deriveUnitStatuses,
  taughtMeanMastery,
  conceptsPerSession,
  sessionsLeftForUnit,
  projectFinishYmd,
  ymdFromMs,
  type CoreUnit,
  type UnitStatus,
} from "../lib/trackProgressCore";

// Curriculum unit ids follow "M{1-6}-G{6-11}-T{1-3}-{idx}". Fallback when the
// client-supplied metadata doesn't know a track unit (curriculum edited).
function parseGradeTerm(
  unitId: string,
): { grade: number; term: number } | null {
  const m = /^M[1-6]-G(\d+)-T(\d+)-\d+$/.exec(unitId);
  return m ? { grade: Number(m[1]), term: Number(m[2]) } : null;
}

type ProgressConcept = {
  conceptId: Id<"exercises">;
  name: string;
  taught: boolean;
  mastery: number | null;
  isNext: boolean;
  noQuestions: boolean;
};

type ProgressUnit = {
  unitId: string;
  unitName: string;
  grade: number | null;
  term: number | null;
  status: UnitStatus;
  outOfScope: boolean;
  noSyllabus: boolean;
  conceptsTotal: number;
  conceptsTaught: number;
  meanMastery: number | null;
  sessionsLeft: number | null;
  concepts: ProgressConcept[];
};

export const trackProgressForStudent = query({
  args: {
    studentId: v.id("students"),
    // Client-supplied curriculum metadata (backend can't read
    // src/lib/curriculum-data.ts — same pattern as listCandidateUnitsForTrack).
    units: v.array(
      v.object({
        unitId: v.string(),
        unitName: v.string(),
        grade: v.number(),
        term: v.number(),
      }),
    ),
    // Client-computed unitIdsForScope(resolveGradeByModule(student)) — used
    // to badge track units the planner's candidate pool can't see.
    scopeUnitIds: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const student = await ctx.db.get(args.studentId);
    if (!student) return null;

    const track = await resolveTrackForStudent(ctx, student);
    if (!track) return { status: "no-track" as const };

    const now = Date.now();
    const scope = new Set(args.scopeUnitIds);
    const metaByUnit = new Map(args.units.map((u) => [u.unitId, u]));

    // ── Memory states: one indexed read, mapped by concept ──────────────
    const states = await ctx.db
      .query("memoryState")
      .withIndex("by_student", (q) => q.eq("studentId", args.studentId))
      .collect();
    const stateByConcept = new Map<string, Doc<"memoryState">>();
    for (const s of states) {
      stateByConcept.set(s.conceptExerciseId as unknown as string, s);
    }

    // ── Per-unit concept rows in track order ─────────────────────────────
    type RawUnit = {
      unitId: string;
      unitName: string;
      grade: number | null;
      term: number | null;
      inScope: boolean;
      concepts: Array<{
        conceptId: Id<"exercises">;
        name: string;
        taught: boolean;
        mastery: number | null;
      }>;
    };
    const rawUnits: RawUnit[] = [];
    for (const unitId of track.orderedUnitIds) {
      const meta = metaByUnit.get(unitId) ?? null;
      const parsed = parseGradeTerm(unitId);
      const exRows = await ctx.db
        .query("exercises")
        .withIndex("by_unit", (q) => q.eq("unitId", unitId))
        .collect();
      const concepts = exRows
        .filter((r) => r.type === "concept")
        .sort((a, b) => a.order - b.order)
        .map((r) => {
          const st = stateByConcept.get(r._id as unknown as string);
          const taught = st !== undefined && st.attemptCount > 0;
          return {
            conceptId: r._id,
            name: r.name,
            taught,
            mastery: st ? masteryFromState(st, now).mastery : null,
          };
        });
      rawUnits.push({
        unitId,
        unitName: meta?.unitName ?? unitId,
        grade: meta?.grade ?? parsed?.grade ?? null,
        term: meta?.term ?? parsed?.term ?? null,
        inScope: scope.has(unitId),
        concepts,
      });
    }

    // ── Statuses via the pure core (frontier walk) ───────────────────────
    const coreUnits: CoreUnit[] = rawUnits.map((u) => ({
      unitId: u.unitId,
      inScope: u.inScope,
      concepts: u.concepts.map((c) => ({ taught: c.taught, mastery: c.mastery })),
    }));
    const statuses = deriveUnitStatuses(coreUnits, MASTERY_THRESHOLD);

    // ── Weekly schedule: group slots ∪ legacy slot roster, deduped ───────
    const memberships = await ctx.db
      .query("groupMembers")
      .withIndex("by_student", (q) => q.eq("studentId", args.studentId))
      .collect();
    const slotSeen = new Set<string>();
    const slots: Doc<"scheduleSlots">[] = [];
    for (const m of memberships) {
      const groupSlots = await ctx.db
        .query("scheduleSlots")
        .withIndex("by_group", (q) => q.eq("groupId", m.groupId))
        .collect();
      for (const s of groupSlots) {
        const k = s._id as unknown as string;
        if (!slotSeen.has(k)) {
          slotSeen.add(k);
          slots.push(s);
        }
      }
    }
    const legacyRows = await ctx.db
      .query("slotStudents")
      .withIndex("by_student", (q) => q.eq("studentId", args.studentId))
      .collect();
    for (const r of legacyRows) {
      const k = r.slotId as unknown as string;
      if (slotSeen.has(k)) continue;
      const s = await ctx.db.get(r.slotId);
      if (s) {
        slotSeen.add(k);
        slots.push(s);
      }
    }
    const durations = slots
      .map((s) => minutesBetweenClock(s.startTime, s.endTime))
      .filter((n): n is number => n !== null);
    const sessionsPerWeek = durations.length;
    const avgSessionMinutes =
      durations.length > 0
        ? durations.reduce((a, b) => a + b, 0) / durations.length
        : null;
    // Estimation minutes: real schedule → student override → planner default.
    const estimateMinutes =
      avgSessionMinutes ??
      student.sessionMinutesOverride ??
      SESSION_MIN_DEFAULT;

    // ── Per-unit estimates + assembly ────────────────────────────────────
    const units: ProgressUnit[] = [];
    let sessionsLeftTotal = 0;
    for (let i = 0; i < rawUnits.length; i++) {
      const u = rawUnits[i];
      const status = statuses[i];
      const conceptsTaught = u.concepts.filter((c) => c.taught).length;
      const untaught = u.concepts.length - conceptsTaught;
      let sessionsLeft: number | null = null;
      if (
        (status === "current" || status === "upcoming") &&
        u.inScope &&
        u.concepts.length > 0
      ) {
        const pacing =
          u.grade !== null && u.term !== null
            ? await resolveUnitPacing(ctx, u.grade, u.term, u.unitId)
            : null;
        const cps = conceptsPerSession({
          pacingPerHour: pacing,
          sessionMinutes: estimateMinutes,
          minutesPerNewConcept: MINUTES_PER_NEW_CONCEPT,
          minConcepts: MAIN_NEW_CONCEPTS_MIN,
          maxConcepts: MAIN_NEW_CONCEPTS_MAX,
        });
        sessionsLeft = sessionsLeftForUnit(untaught, cps);
        sessionsLeftTotal += sessionsLeft;
      }
      units.push({
        unitId: u.unitId,
        unitName: u.unitName,
        grade: u.grade,
        term: u.term,
        status,
        outOfScope: !u.inScope,
        noSyllabus: u.concepts.length === 0,
        conceptsTotal: u.concepts.length,
        conceptsTaught,
        meanMastery: taughtMeanMastery(
          u.concepts.map((c) => ({ taught: c.taught, mastery: c.mastery })),
        ),
        sessionsLeft,
        concepts: u.concepts.map((c) => ({
          ...c,
          isNext: false,
          noQuestions: false,
        })),
      });
    }

    // isNext: the first untaught concept of the current unit — literally what
    // the next sheet's Main block will teach.
    const currentIdx = units.findIndex((u) => u.status === "current");
    if (currentIdx >= 0) {
      const next = units[currentIdx].concepts.find((c) => !c.taught);
      if (next) next.isNext = true;
    }

    // noQuestions: frontier warning only (current + first in-scope upcoming
    // unit) — bounded cost, and that's where the warning is actionable.
    const warnIdxs: number[] = [];
    if (currentIdx >= 0) warnIdxs.push(currentIdx);
    const nextUpcoming = units.findIndex(
      (u, i) =>
        i > currentIdx && u.status === "upcoming" && !u.outOfScope && !u.noSyllabus,
    );
    if (nextUpcoming >= 0) warnIdxs.push(nextUpcoming);
    for (const idx of warnIdxs) {
      for (const concept of units[idx].concepts) {
        if (concept.taught) continue;
        const tagged = await questionsTaggedToConcept(ctx, concept.conceptId);
        if (tagged.length === 0) concept.noQuestions = true;
      }
    }

    // ── Exam target + projection ─────────────────────────────────────────
    const todayYmd = ymdFromMs(now);
    const examRows = await ctx.db
      .query("examCalendar")
      .withIndex("by_grade", (q) => q.eq("grade", track.targetGrade))
      .collect();
    const upcoming = examRows
      .filter((r) => r.examDate >= todayYmd)
      .sort((a, b) => a.examDate.localeCompare(b.examDate));
    // Prefer the track's target-term exam; else the LAST upcoming exam at the
    // target grade (the year's final target); else null.
    const targetExam =
      upcoming.find((r) => r.term === track.targetTerm) ??
      (upcoming.length > 0 ? upcoming[upcoming.length - 1] : null);

    const projectedFinishYmd = projectFinishYmd({
      sessionsLeftTotal,
      sessionsPerWeek,
      todayMs: now,
    });
    const onTrack =
      projectedFinishYmd !== null && targetExam !== null
        ? projectedFinishYmd <= targetExam.examDate
        : null;

    // ── Summary (zero-concept units excluded from counts) ────────────────
    const counted = units.filter((u) => !u.noSyllabus);
    return {
      status: "ok" as const,
      track: {
        name: track.name,
        level: track.level,
        targetGrade: track.targetGrade,
        targetTerm: track.targetTerm,
      },
      summary: {
        unitsTotal: counted.length,
        unitsTaught: counted.filter(
          (u) => u.status === "taught" || u.status === "mastered",
        ).length,
        unitsMastered: counted.filter((u) => u.status === "mastered").length,
        conceptsTotal: counted.reduce((s, u) => s + u.conceptsTotal, 0),
        conceptsTaught: counted.reduce((s, u) => s + u.conceptsTaught, 0),
      },
      prediction: {
        sessionsLeftTotal,
        sessionsPerWeek,
        avgSessionMinutes,
        projectedFinishYmd,
        examYmd: targetExam?.examDate ?? null,
        examTerm: targetExam?.term ?? null,
        onTrack,
      },
      units,
      generatedAt: now,
    };
  },
});
