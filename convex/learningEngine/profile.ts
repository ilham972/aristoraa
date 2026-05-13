// Phase C.1 — Student profile aggregator.
//
// Derived view (no schema) that joins three layers in a single read:
//   Layer 2 mastery   (per-student memoryState → R, accFactor, mastery)
//   Layer 3 importance (conceptImportance per (grade, term))
//   Layer 4 profile   (this file — per-concept profile rows + predicted exam %
//                      per (grade, term) bucket)
//
// Cumulative term semantics: a concept's prediction contribution under exam
// bucket (G, T_exam) is mastery × importance[(G, T_exam, c.id)] — NOT the
// concept's "own" (c.grade, c.term) importance. A Term-1 concept tested by a
// Term-2 paper will have an importance row under (G, T=2) created by B.2's
// recompute, and that row is what the (G, T=2) prediction reads. Missing rows
// = 0 contribution. This is the cumulative-aware reading of the algorithm
// plan's `predictedExamPctPerTerm` (the spec's `p.term == t` filter would lose
// cumulative semantics and is intentionally not used here).
//
// Downgraded students: per the user's decision, predictions are reported per
// (grade, term) the student STUDIES — not just their schoolGrade. A G10
// student downgraded to G9 on M1 gets both G9 and G10 buckets in the result,
// even though only the G10 exam is the one they will sit. The Lead reads both
// to track "is the G9 remediation working?" separately from "ready for G10?".
//
// Scope-filter (per user decision): a downgraded student's G9 prediction
// counts ONLY concepts whose module is in their G9 scope. A G10 student doing
// G9 work only on M1 gets a G9 prediction summed over M1 concepts, with
// importance renormalized so Σ = 1.0 over the studied subset. Without
// renormalization the G9 prediction would be capped at the importance share
// of M1 (~10-20%), making "remediation working" indistinguishable from
// "barely studying." The renormalized number answers: "how is the student
// doing on the G9 work they actually study?"
//
// Prereq gap is per-concept: a concept has prereqGap=true if ANY transitive
// prereq (depth ≤ PREREQ_BFS_DEPTH) has mastery < MASTERY_THRESHOLD. Cycles
// are broken by a visited-set; the depth cap is the cycle-safety belt.
//
// C.1 surfaces:
//   - profile rows (per concept)
//   - predictedExamPctPerGradeTerm   (Record<"G{g}T{t}", number in 0..1>)
//   - isAtRisk flag per concept (importance >= AT_RISK_IMPORTANCE_THRESHOLD
//     AND R < AT_RISK_R_THRESHOLD)
//
// C.2 extends this with:
//   - atRiskConcepts (sorted derived list — importance desc)
//   - retentionDebtByGradeTerm  (per (G, T_exam): {totalMarks, marksAtRisk,
//     atRiskImportanceSum, source, nextExamDate, daysToExam})
//   - nextExam summary across the student's grade scope
//
// Retention-debt math (Phase C.2):
//   atRiskImportance(G, T) = Σ_c importance[(G, T, c)] for c where mastery(c) < 0.5
//                                                       AND importance[(G,T,c)] exists
//   marksAtRisk(G, T)      = atRiskImportance(G, T) × totalMarks(G, T)
// totalMarks resolution order:
//   1. examCalendar.totalMarks for the next upcoming exam at (G, T)
//   2. Most-recent pastPapers.totalMarks for (G, T)
//   3. 100 (final fallback)
// When no exam is scheduled at all for (G, T), retentionDebt is omitted from
// that bucket — the consumer renders "no upcoming exam" instead of guessing.

import { query } from "../_generated/server";
import { v } from "convex/values";
import type { GenericQueryCtx } from "convex/server";
import type { DataModel, Doc, Id } from "../_generated/dataModel";
import { masteryFromState } from "./mastery";
import { MASTERY_THRESHOLD } from "./config";

type QueryCtx = GenericQueryCtx<DataModel>;

// Shared input shape for the profile builder. The unitIds + gradeByModule are
// resolved client-side from src/lib/curriculum-data (backend cannot import
// from src/lib). Phase D's planner reuses this exact shape so the caller
// passes the same args to either layer.
export type StudentProfileArgs = {
  studentId: Id<"students">;
  unitIds: string[];
  gradeByModule: Record<string, number[]>;
  asOf?: number;
};

// At-risk thresholds. Lifted from algorithm_plan.md Phase C.2:
//   atRisk = importance >= 0.02 AND R < 0.5
const AT_RISK_IMPORTANCE_THRESHOLD = 0.02;
const AT_RISK_R_THRESHOLD = 0.5;
// Retention-debt threshold: concepts with mastery below this contribute their
// (G, T_exam) importance share to "marks at risk". Aligns with Phase C.2 spec.
const RETENTION_DEBT_MASTERY_THRESHOLD = 0.5;
// Final fallback when neither examCalendar nor any pastPaper has totalMarks.
const FALLBACK_TOTAL_MARKS = 100;
const MS_PER_DAY = 86_400_000;

// Cycle-safety cap on the prereq-gap BFS. Real concept DAGs should be a few
// hops deep at most; this is a defensive limit.
const PREREQ_BFS_DEPTH = 10;

// Curriculum unit IDs follow "M{1-6}-G{6-11}-T{1-3}-{idx}". Backend can't
// import src/lib/curriculum-data, so we parse module / grade / term from the
// unitId string at query time. Any concept whose unitId does not parse is
// silently dropped from the profile (it shouldn't exist in well-formed data).
function parseUnitId(
  unitId: string,
): { moduleId: string; grade: number; term: number } | null {
  const m = /^(M[1-6])-G(\d+)-T(\d+)-\d+$/.exec(unitId);
  if (!m) return null;
  return { moduleId: m[1], grade: Number(m[2]), term: Number(m[3]) };
}

function ymdFromMs(ms: number): string {
  const d = new Date(ms);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function daysBetweenYmd(from: string, to: string): number {
  const fromMs = Date.parse(`${from}T00:00:00.000Z`);
  const toMs = Date.parse(`${to}T00:00:00.000Z`);
  if (Number.isNaN(fromMs) || Number.isNaN(toMs)) return 0;
  return Math.round((toMs - fromMs) / MS_PER_DAY);
}

// Phase C.1 + D.1 — pure helper that does the heavy lifting (memory lookups,
// importance joins, prereq BFS, exam-calendar resolution). Exported so the
// Phase D planner (`convex/learningEngine/planner.ts`) can reuse the exact
// same profile rows the dashboards consume — single source of truth for
// "is concept c masterable / gapped / studied?" lives here.
export async function computeStudentProfile(
  ctx: QueryCtx,
  args: StudentProfileArgs,
) {
  const student = await ctx.db.get(args.studentId);
  if (!student) return null;

  const atTime = args.asOf ?? Date.now();

    // ── 1. Concept-type exercises in scope. ─────────────────────────────
    // Build a (grade → Set<moduleId>) view for fast scope checks. A concept c
    // is "studied" if c.moduleId is in studiedModulesByGrade.get(c.grade).
    const studiedModulesByGrade = new Map<number, Set<string>>();
    for (const [moduleId, grades] of Object.entries(args.gradeByModule)) {
      for (const g of grades) {
        if (!studiedModulesByGrade.has(g)) {
          studiedModulesByGrade.set(g, new Set());
        }
        studiedModulesByGrade.get(g)!.add(moduleId);
      }
    }
    const isStudied = (grade: number, moduleId: string): boolean =>
      studiedModulesByGrade.get(grade)?.has(moduleId) ?? false;

    type ConceptMeta = {
      _id: Id<"exercises">;
      name: string;
      unitId: string;
      moduleId: string;
      grade: number;
      term: number;
      prerequisiteExerciseIds: Id<"exercises">[];
      order: number;
    };
    const conceptRows: ConceptMeta[] = [];
    const seenConceptIds = new Set<string>();
    for (const uId of args.unitIds) {
      const rows = await ctx.db
        .query("exercises")
        .withIndex("by_unit", (q) => q.eq("unitId", uId))
        .collect();
      for (const r of rows) {
        if (r.type !== "concept") continue;
        const key = r._id as unknown as string;
        if (seenConceptIds.has(key)) continue;
        const parsed = parseUnitId(r.unitId);
        if (!parsed) continue;
        // Scope filter: only include concepts the student actually studies.
        if (!isStudied(parsed.grade, parsed.moduleId)) continue;
        seenConceptIds.add(key);
        conceptRows.push({
          _id: r._id,
          name: r.name,
          unitId: r.unitId,
          moduleId: parsed.moduleId,
          grade: parsed.grade,
          term: parsed.term,
          prerequisiteExerciseIds: r.prerequisiteExerciseIds ?? [],
          order: r.order,
        });
      }
    }
    const studiedConceptIds = new Set<string>(
      conceptRows.map((c) => c._id as unknown as string),
    );

    // ── 2. Memory states for this student in one indexed read. ──────────
    const states = await ctx.db
      .query("memoryState")
      .withIndex("by_student", (q) => q.eq("studentId", args.studentId))
      .collect();
    const stateByConcept = new Map<string, Doc<"memoryState">>();
    for (const s of states) {
      stateByConcept.set(s.conceptExerciseId as unknown as string, s);
    }

    // Mastery cache memoizes per-concept evaluation including for prereqs that
    // fall outside the student's scope (BFS may reach across grade boundaries).
    const masteryCache = new Map<
      string,
      { R: number; accFactor: number; mastery: number }
    >();
    function getMastery(
      conceptId: Id<"exercises">,
    ): { R: number; accFactor: number; mastery: number } {
      const key = conceptId as unknown as string;
      const cached = masteryCache.get(key);
      if (cached) return cached;
      const s = stateByConcept.get(key);
      const m = s
        ? masteryFromState(s, atTime)
        : { R: 0, accFactor: 0.5, mastery: 0 };
      masteryCache.set(key, m);
      return m;
    }

    // ── 3. Resolve student grade scope. ─────────────────────────────────
    // Union of schoolGrade + assignedGrades + every grade across
    // assignedGradesByModule. The same grade may appear in multiple modules
    // — Set dedupes naturally.
    const gradeSet = new Set<number>();
    gradeSet.add(student.schoolGrade);
    for (const g of student.assignedGrades ?? []) gradeSet.add(g);
    const byMod = student.assignedGradesByModule as
      | Record<string, number[]>
      | undefined;
    if (byMod && typeof byMod === "object") {
      for (const list of Object.values(byMod)) {
        if (Array.isArray(list)) for (const g of list) gradeSet.add(g);
      }
    }
    const studentGrades = Array.from(gradeSet).sort((a, b) => a - b);

    // ── 4. Importance maps per (grade, T_exam) bucket. ──────────────────
    // bucketKey "G{g}T{t}" → Map<conceptId, importance>.
    // We pull for every (g ∈ studentGrades, t ∈ {1, 2, 3}) — these are the
    // possible exam buckets this student could care about across the year.
    const importanceByGT = new Map<string, Map<string, number>>();
    for (const g of studentGrades) {
      for (const t of [1, 2, 3] as const) {
        const rows = await ctx.db
          .query("conceptImportance")
          .withIndex("by_grade_term", (q) => q.eq("grade", g).eq("term", t))
          .collect();
        if (rows.length === 0) continue;
        const m = new Map<string, number>();
        for (const r of rows) {
          m.set(r.conceptExerciseId as unknown as string, r.importance);
        }
        importanceByGT.set(`G${g}T${t}`, m);
      }
    }

    // ── 5. Prereq DAG cache + BFS. ──────────────────────────────────────
    // In-scope concepts already have their prereq id list in conceptRows.
    // Out-of-scope prereqs are loaded on demand (BFS may cross grade
    // boundaries when a G10 concept depends on a G8 foundation, etc.).
    const prereqCache = new Map<string, Id<"exercises">[]>();
    for (const c of conceptRows) {
      prereqCache.set(
        c._id as unknown as string,
        c.prerequisiteExerciseIds,
      );
    }
    async function loadPrereqs(
      id: Id<"exercises">,
    ): Promise<Id<"exercises">[]> {
      const key = id as unknown as string;
      const cached = prereqCache.get(key);
      if (cached) return cached;
      const doc = await ctx.db.get(id);
      const prereqs =
        doc && doc.type === "concept"
          ? doc.prerequisiteExerciseIds ?? []
          : [];
      prereqCache.set(key, prereqs);
      return prereqs;
    }

    async function hasUnmasteredPrereq(
      start: Id<"exercises">,
    ): Promise<{ gap: boolean; firstBlockerId: Id<"exercises"> | null }> {
      const visited = new Set<string>([start as unknown as string]);
      let frontier = (await loadPrereqs(start)).filter(
        (id) => !visited.has(id as unknown as string),
      );
      for (
        let depth = 0;
        depth < PREREQ_BFS_DEPTH && frontier.length > 0;
        depth++
      ) {
        const next: Id<"exercises">[] = [];
        for (const p of frontier) {
          const k = p as unknown as string;
          if (visited.has(k)) continue;
          visited.add(k);
          const m = getMastery(p);
          if (m.mastery < MASTERY_THRESHOLD) {
            return { gap: true, firstBlockerId: p };
          }
          const more = await loadPrereqs(p);
          for (const pp of more) {
            if (!visited.has(pp as unknown as string)) next.push(pp);
          }
        }
        frontier = next;
      }
      return { gap: false, firstBlockerId: null };
    }

    // ── 6. Per-concept profile rows. ────────────────────────────────────
    type ProfileRow = {
      conceptId: Id<"exercises">;
      name: string;
      unitId: string;
      moduleId: string;
      grade: number;
      term: number;
      order: number;
      mastery: number;
      R: number;
      accFactor: number;
      hasState: boolean;
      // Importance under the concept's own (grade, term). For cumulative
      // prediction the consumer also looks at importanceByGT for higher-term
      // buckets (Term 1 concepts contribute to Term 2 and Term 3 predictions
      // via separate rows recomputed by B.2).
      importance: number;
      expectedExamContribution: number; // mastery × ownImportance
      isMastered: boolean;
      isAtRisk: boolean;
      prereqGap: boolean;
      firstBlockerId: Id<"exercises"> | null;
      // Memory-state fields the Phase D scorer (D.2 onward) reads to compute
      // urgency / overdue-by-N-days without re-querying memoryState. null
      // when no attempt has happened yet (hasState === false).
      stability: number | null;
      lastReviewAt: number | null;
      attemptCount: number;
    };

    const profile: ProfileRow[] = [];
    for (const c of conceptRows) {
      const m = getMastery(c._id);
      const ownBucketKey = `G${c.grade}T${c.term}`;
      const ownImpMap = importanceByGT.get(ownBucketKey);
      const ownImportance =
        ownImpMap?.get(c._id as unknown as string) ?? 0;
      const isMastered = m.mastery >= MASTERY_THRESHOLD;
      const isAtRisk =
        ownImportance >= AT_RISK_IMPORTANCE_THRESHOLD &&
        m.R < AT_RISK_R_THRESHOLD;
      const { gap, firstBlockerId } = await hasUnmasteredPrereq(c._id);
      const stateRow = stateByConcept.get(c._id as unknown as string);
      profile.push({
        conceptId: c._id,
        name: c.name,
        unitId: c.unitId,
        moduleId: c.moduleId,
        grade: c.grade,
        term: c.term,
        order: c.order,
        mastery: m.mastery,
        R: m.R,
        accFactor: m.accFactor,
        hasState: stateRow !== undefined,
        importance: ownImportance,
        expectedExamContribution: m.mastery * ownImportance,
        isMastered,
        isAtRisk,
        prereqGap: gap,
        firstBlockerId,
        stability: stateRow?.stability ?? null,
        lastReviewAt: stateRow?.lastReviewAt ?? null,
        attemptCount: stateRow?.attemptCount ?? 0,
      });
    }

    // ── 7. predictedExamPctPerGradeTerm. ────────────────────────────────
    // For every (G, T_exam) bucket: sum mastery × importance ONLY over
    // concepts the student studies, with importance renormalized over the
    // studied subset so Σ = 1.0 within the studied scope. Without
    // renormalization, a downgraded student studying ~1/6 of G9 would have
    // their G9 prediction capped at ~17% regardless of mastery — meaningless
    // for the Lead's "is remediation working?" question.
    //
    // studiedImportanceShare carries the *unrenormalized* total — useful for
    // the UI to convey "you study X% of what this exam covers."
    const predictedExamPctPerGradeTerm: Record<string, number> = {};
    const studiedImportanceShareByGradeTerm: Record<string, number> = {};
    importanceByGT.forEach((impMap, bucketKey) => {
      let studiedImpSum = 0;
      const studiedPairs: Array<{ conceptId: string; imp: number }> = [];
      impMap.forEach((imp, conceptId) => {
        if (!studiedConceptIds.has(conceptId)) return;
        studiedImpSum += imp;
        studiedPairs.push({ conceptId, imp });
      });
      studiedImportanceShareByGradeTerm[bucketKey] = studiedImpSum;
      if (studiedImpSum === 0) {
        predictedExamPctPerGradeTerm[bucketKey] = 0;
        return;
      }
      let total = 0;
      for (const pair of studiedPairs) {
        const mState = getMastery(pair.conceptId as unknown as Id<"exercises">);
        total += mState.mastery * (pair.imp / studiedImpSum);
      }
      predictedExamPctPerGradeTerm[bucketKey] = Math.max(0, Math.min(1, total));
    });

    // ── 8. (C.2) at-risk concepts — sorted derived view. ────────────────
    // Importance descending so the "biggest exam-impact concept that is
    // forgetting fastest" bubbles to the top.
    const atRiskConcepts = profile
      .filter((p) => p.isAtRisk)
      .slice()
      .sort((a, b) => b.importance - a.importance);

    // ── 9. (C.2) examCalendar + pastPaper totalMarks index. ─────────────
    // Pull every examCalendar row across the student's grade scope so we can
    // pick the next upcoming exam per (G, T_exam). Same idea for pastPapers
    // as the totalMarks fallback.
    const calendarByGT = new Map<
      string,
      Array<{ examDate: string; totalMarks?: number; year: number }>
    >();
    for (const g of studentGrades) {
      const rows = await ctx.db
        .query("examCalendar")
        .withIndex("by_grade", (q) => q.eq("grade", g))
        .collect();
      for (const r of rows) {
        const key = `G${r.grade}T${r.term}`;
        if (!calendarByGT.has(key)) calendarByGT.set(key, []);
        calendarByGT.get(key)!.push({
          examDate: r.examDate,
          totalMarks: r.totalMarks,
          year: r.year,
        });
      }
    }
    // Pre-sort each bucket by examDate ascending so the first row >= asOfDate
    // is the next upcoming exam.
    calendarByGT.forEach((list) =>
      list.sort((a, b) => a.examDate.localeCompare(b.examDate)),
    );

    const paperTotalsByGT = new Map<string, number>();
    for (const g of studentGrades) {
      const rows = await ctx.db
        .query("pastPapers")
        .withIndex("by_grade", (q) => q.eq("grade", g))
        .collect();
      // Use the most recently uploaded paper's totalMarks per (G, T) as the
      // fallback. Holdout / non-training irrelevant here — we want any signal
      // about the paper's mark budget.
      const byKey = new Map<
        string,
        { uploadedAt: number; totalMarks: number }
      >();
      for (const r of rows) {
        if (r.totalMarks == null) continue;
        const key = `G${r.grade}T${r.term}`;
        const existing = byKey.get(key);
        if (!existing || r.uploadedAt > existing.uploadedAt) {
          byKey.set(key, {
            uploadedAt: r.uploadedAt,
            totalMarks: r.totalMarks,
          });
        }
      }
      byKey.forEach((v, k) => paperTotalsByGT.set(k, v.totalMarks));
    }

    const asOfYmd = ymdFromMs(atTime);

    // ── 10. (C.2) retention debt per (G, T_exam) bucket. ────────────────
    type RetentionDebtRow = {
      grade: number;
      term: number;
      // Sum of (G, T_exam) importances for concepts below mastery threshold.
      atRiskImportanceSum: number;
      totalMarks: number;
      marksAtRisk: number;
      totalMarksSource: "calendar" | "paper" | "fallback";
      nextExamDate: string | null;
      daysToExam: number | null;
    };
    const retentionDebtByGradeTerm: Record<string, RetentionDebtRow> = {};

    importanceByGT.forEach((impMap, bucketKey) => {
      // Decode bucketKey "G{g}T{t}". We rebuilt it ourselves, so the regex
      // match is total — but guard anyway for safety.
      const m = /^G(\d+)T(\d+)$/.exec(bucketKey);
      if (!m) return;
      const g = Number(m[1]);
      const t = Number(m[2]);

      // Skip buckets with no scheduled exam — the consumer cannot meaningfully
      // act on retention debt for an exam that does not exist on the calendar.
      const cal = calendarByGT.get(bucketKey) ?? [];
      const upcoming = cal.find((r) => r.examDate >= asOfYmd) ?? null;
      if (!upcoming) return;

      // Same scope-filter + renormalization as predictions: only studied
      // concepts contribute, with importance renormalized over the studied
      // subset. "Marks at risk" then reads as "of the marks on the parts you
      // study, this many are at risk."
      let studiedImpSum = 0;
      let atRiskImpRaw = 0;
      impMap.forEach((imp, conceptId) => {
        if (!studiedConceptIds.has(conceptId)) return;
        studiedImpSum += imp;
        const mState = getMastery(conceptId as unknown as Id<"exercises">);
        if (mState.mastery < RETENTION_DEBT_MASTERY_THRESHOLD) {
          atRiskImpRaw += imp;
        }
      });
      const atRiskImportanceSum =
        studiedImpSum > 0 ? atRiskImpRaw / studiedImpSum : 0;

      let totalMarks: number;
      let source: RetentionDebtRow["totalMarksSource"];
      if (upcoming.totalMarks != null) {
        totalMarks = upcoming.totalMarks;
        source = "calendar";
      } else if (paperTotalsByGT.has(bucketKey)) {
        totalMarks = paperTotalsByGT.get(bucketKey)!;
        source = "paper";
      } else {
        totalMarks = FALLBACK_TOTAL_MARKS;
        source = "fallback";
      }

      retentionDebtByGradeTerm[bucketKey] = {
        grade: g,
        term: t,
        atRiskImportanceSum,
        totalMarks,
        marksAtRisk: atRiskImportanceSum * totalMarks,
        totalMarksSource: source,
        nextExamDate: upcoming.examDate,
        daysToExam: daysBetweenYmd(asOfYmd, upcoming.examDate),
      };
    });

    // ── 11. (C.2) "single next exam" summary across all of student's grades.
    // Useful for orienting the UI: "Your next exam is G10 Term 1 in 42 days".
    type NextExam = {
      grade: number;
      term: number;
      examDate: string;
      daysToExam: number;
      totalMarks: number | null;
    };
    const upcomingCandidates: NextExam[] = [];
    calendarByGT.forEach((list, bucketKey) => {
      const m = /^G(\d+)T(\d+)$/.exec(bucketKey);
      if (!m) return;
      const g = Number(m[1]);
      const t = Number(m[2]);
      const upcoming = list.find((r) => r.examDate >= asOfYmd);
      if (!upcoming) return;
      upcomingCandidates.push({
        grade: g,
        term: t,
        examDate: upcoming.examDate,
        daysToExam: daysBetweenYmd(asOfYmd, upcoming.examDate),
        totalMarks: upcoming.totalMarks ?? null,
      });
    });
    upcomingCandidates.sort((a, b) => a.examDate.localeCompare(b.examDate));
    const nextExam: NextExam | null = upcomingCandidates[0] ?? null;

    return {
      student: {
        id: student._id,
        name: student.name,
        schoolGrade: student.schoolGrade,
        assignedGrades: studentGrades,
        assignedGradesByModule:
          (student.assignedGradesByModule as
            | Record<string, number[]>
            | undefined) ?? null,
      },
      profile,
      predictedExamPctPerGradeTerm,
      studiedImportanceShareByGradeTerm,
      atRiskConcepts,
      retentionDebtByGradeTerm,
      nextExam,
      generatedAt: atTime,
    };
}

// Phase C.1 query — thin auth wrapper around the helper above. Returns null
// for unauthenticated callers (same legacy contract used by the dashboards).
export const studentProfile = query({
  args: {
    studentId: v.id("students"),
    // Cumulative unit list across all the student's grades × all 3 terms,
    // resolved client-side from src/lib/curriculum-data.ts (backend cannot
    // import from src/lib). For a downgraded student studying G10 + G9, pass
    // every unit ID across both grades, all terms.
    unitIds: v.array(v.string()),
    // Per-module grade scope (resolved client-side from student.assignedGrades
    // + assignedGradesByModule + schoolGrade fallback). Keys are "M1".."M6";
    // values are the grades the student studies on that module. Used to
    // filter concepts so a downgraded G9-on-M1-only student doesn't get
    // dragged down by unstudied G9 concepts on M2-M6.
    gradeByModule: v.record(v.string(), v.array(v.number())),
    asOf: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    return await computeStudentProfile(ctx, args);
  },
});
