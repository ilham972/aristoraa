// Phase D.1 — Candidate question pool.
// Phase D.2 — Per-question scoring (additive, 5 factors).
//
// D.1 (`candidatePool`) takes (studentId, dateStr) + the curriculum-derived
// scope (unitIds + gradeByModule, same shape as studentProfile) and returns
// the list of questions eligible to appear on today's sheet. Eligibility =
//
//   1. Concept the question is tagged to is in the student's studied scope.
//      (Handled by `computeStudentProfile` — concepts outside scope never
//      appear in the profile.)
//   2. Concept does NOT have an unmet prerequisite (prereqGap === false).
//      Mastered concepts STAY in the pool because D.3's exam-prep slot
//      targets near-mastered concepts via past-paper questions.
//   3. Question was NOT used on any sheet for this student in the last
//      NOVELTY_COOLDOWN_DAYS calendar days.
//
// D.2 (`scoredCandidatePool`) layers a per-question score on top of the D.1
// pool. Five factors, each in [0, 1], combined as a weighted sum (weights
// sum to 1, see config.ts):
//
//   importance — concept.importance (already 0..1 from Phase B)
//   urgency    — (1 - R) with +URGENCY_OVERDUE_BOOST if past natural review
//   fit        — Gaussian peak where q.difficulty meets student skill on
//                this concept (skill = 1 + 4 * mastery, mapped to the same
//                1..5 scale q.difficulty uses)
//   novelty    — D.1 already filters recently-used questions, so this is
//                hardcoded 1.0 inside the scorer; the term is kept so
//                Phase G can experiment with soft-novelty later
//   proximity  — 1 - daysToExam/HORIZON, clamped, zero past the horizon
//                Uses examCalendar at (student.schoolGrade, concept.term).
//                A concept whose term has no upcoming exam contributes 0
//                proximity (the urgency + importance factors carry it).
//
// D.3 (slot allocator) consumes the scored, sorted pool; D.6 stores the
// scoringSnapshot for audit. The score formula is intentionally transparent
// — every factor is exposed in the return value so the Lead-dashboard "why
// this question?" tooltip and Phase F calibration can both read the same
// numbers without re-deriving them.
//
// Module-of-day affinity is NOT a scoring factor. It's a *slot* concern
// handled in D.3: warm-up slot deliberately picks OFF-module candidates,
// main block picks ON-module candidates, exam-prep is module-agnostic. So
// the scorer is module-blind by design.
//
// Phase 0.6's coverage dashboard is the deployment-time gate that ensures
// every studied concept has ≥ MIN_QUESTIONS_PER_CONCEPT tagged questions.
// At runtime, if a non-gapped concept yields zero candidates (no tags OR
// every tag in cooldown), we surface it via `plannerGaps` so the Lead
// dashboard can react — but we DO NOT block the rest of the pool.

import { mutation, query } from "../_generated/server";
import { ConvexError, v } from "convex/values";
import type { GenericMutationCtx, GenericQueryCtx } from "convex/server";
import type { DataModel, Doc, Id } from "../_generated/dataModel";
import { computeStudentProfile } from "./profile";
import { masteryFromState } from "./mastery";
import {
  resolveTeachingPath,
  resolveUnitPacing,
  resolveUnitMainQuestions,
} from "./path";
import { resolveTrackForStudent } from "./tracks";
import { baseStudentIdsForSlot } from "../lib/roster";
import {
  conceptsForQuestion,
  questionsTaggedToConcept,
} from "./derivedConcepts";
import {
  coverageLadderFits,
  type CoverageFitOverride,
  type CoverageQuestion,
} from "./coverageMode";
import {
  NOVELTY_COOLDOWN_DAYS,
  W_IMPORTANCE,
  W_URGENCY,
  W_FIT,
  W_NOVELTY,
  W_PROXIMITY,
  FIT_SIGMA,
  URGENCY_OVERDUE_BOOST,
  PROXIMITY_HORIZON_DAYS,
  DEFAULT_QUESTION_DIFFICULTY,
  DEFAULT_OFF_DAYS,
  SHEET_LEN_WEAK,
  SHEET_LEN_DEFAULT,
  SHEET_LEN_STRONG,
  SESSION_MIN_WEAK,
  SESSION_MIN_DEFAULT,
  SESSION_MIN_STRONG,
  DEFAULT_QUESTION_TIME_MIN,
  COMPLETION_HISTORY_WINDOW_DAYS,
  COMPLETION_RATE_GROW,
  COMPLETION_RATE_SHRINK,
  MIN_COMPLETION_SAMPLE,
  SESSION_MIN_FLOOR,
  SESSION_MIN_CEILING,
  SHEET_LEN_FLOOR,
  SHEET_LEN_CEILING,
  LATE_TERM_DAYS,
  PHASE_RATIOS,
  DEFAULT_RATIOS,
  EXAM_WEEK_RATIOS,
  EXAM_PREP_MASTERY_FLOOR,
  MINUTES_PER_NEW_CONCEPT,
  MAIN_NEW_CONCEPTS_MIN,
  MAIN_NEW_CONCEPTS_MAX,
  BUDGET_GROW_FACTOR,
  BUDGET_SHRINK_FACTOR,
  REVISION_DUE_R,
  UNDERFILL_REASONS,
  EXAM_BACKSTOP_DAYS,
  NATURAL_INTERVAL_FLOOR_DAYS,
  MASTERY_THRESHOLD,
} from "./config";

type QueryCtx = GenericQueryCtx<DataModel>;
type MutationCtx = GenericMutationCtx<DataModel>;
// All read-only helpers in this file accept either context. Convex's mutation
// ctx exposes the same `db.query` / `db.get` surface as the query ctx, so the
// union is structurally callable. Mutations use this so they can plan + write
// in a single transaction without `runQuery`'s separate-transaction overhead.
type ReadCtx = QueryCtx | MutationCtx;

const MS_PER_DAY = 86_400_000;

// Weekday → module mapping. Mon = M1 ... Sat = M6, Sun = no module. The
// candidate pool itself does NOT filter by module (D.3 does), but the
// computed module-of-day is returned in metadata so callers can route
// candidates into the right slot without re-deriving the mapping.
//
// JavaScript Date.getUTCDay(): 0 = Sun, 1 = Mon, ..., 6 = Sat.
const MODULE_BY_UTC_WEEKDAY: Record<number, string | null> = {
  0: null, // Sunday — off
  1: "M1",
  2: "M2",
  3: "M3",
  4: "M4",
  5: "M5",
  6: "M6",
};

function moduleForDateStr(dateStr: string): string | null {
  const ms = Date.parse(`${dateStr}T00:00:00.000Z`);
  if (Number.isNaN(ms)) return null;
  return MODULE_BY_UTC_WEEKDAY[new Date(ms).getUTCDay()] ?? null;
}

function ymdFromMs(ms: number): string {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function clamp01(x: number): number {
  if (Number.isNaN(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

function parseYmdToMs(ymd: string): number {
  return Date.parse(`${ymd}T00:00:00.000Z`);
}

// Phase 6: minutes between two "HH:MM" clock strings (scheduleSlots.startTime /
// endTime). Returns null on malformed input or non-positive duration so the
// caller falls back to overrides/defaults. Handles a slot that wraps past
// midnight defensively (treated as same-day; negative → null).
function minutesBetweenClock(start: string, end: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/;
  const s = m.exec(start);
  const e = m.exec(end);
  if (!s || !e) return null;
  const startMin = Number(s[1]) * 60 + Number(s[2]);
  const endMin = Number(e[1]) * 60 + Number(e[2]);
  const diff = endMin - startMin;
  return diff > 0 ? diff : null;
}

// ──────────────────────────────────────────────────────────────────────────
// D.1 candidate types
// ──────────────────────────────────────────────────────────────────────────

type CandidateQuestion = {
  _id: Id<"questionBank">;
  source: string;
  difficulty: number | null;
  // Lesson Builder drag order — the coverage-mode ladder tie-break.
  pickerOrder: number | null;
  linkedExerciseId: Id<"exercises"> | null;
  linkedQuestionKey: string | null;
  pastPaperId: Id<"pastPapers"> | null;
  marksAvailable: number | null;
  textbookPageId: Id<"textbookPages"> | null;
  questionNumberInPaper: string | null;
};

// The profile row produced by computeStudentProfile. We use a structural
// type so callers don't need to import profile.ts's internals.
type ProfileRow = NonNullable<
  Awaited<ReturnType<typeof computeStudentProfile>>
>["profile"][number];

type RawCandidate = {
  question: CandidateQuestion;
  concept: ProfileRow;
};

type PlannerGap = {
  conceptId: Id<"exercises">;
  conceptName: string;
  reason: "no-tags" | "all-in-cooldown";
};

type PoolMeta = {
  todayModule: string | null;
  cooldownStartYmd: string;
  cooldownDays: number;
  recentSheetCount: number;
  recentlyUsedQuestionCount: number;
  uniqueQuestionsConsidered: number;
  candidateCount: number;
  consideredConcepts: number;
  prereqGappedSkipped: number;
};

type RawPool = {
  candidates: RawCandidate[];
  plannerGaps: PlannerGap[];
  meta: PoolMeta;
  generatedAt: number;
  asOfMs: number;
  studentSchoolGrade: number;
};

// ──────────────────────────────────────────────────────────────────────────
// D.1 internal builder. Shared by `candidatePool` (D.1) and
// `scoredCandidatePool` (D.2); the latter just adds scoring on top.
// ──────────────────────────────────────────────────────────────────────────

async function buildCandidatePool(
  ctx: ReadCtx,
  args: {
    studentId: Id<"students">;
    dateStr: string;
    unitIds: string[];
    gradeByModule: Record<string, number[]>;
    // Lesson Builder (2026-07-11): question ids the teacher explicitly
    // ticked for the Main block. These bypass the novelty cooldown (an
    // explicit choice beats the 7-day rest rule) and keep a prereq-gapped
    // concept's ticked questions servable (D.4 alerts still surface the gap).
    forceIncludeQuestionIds?: Set<string>;
  },
): Promise<RawPool | null> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(args.dateStr)) {
    throw new Error(`candidatePool: invalid dateStr "${args.dateStr}"`);
  }
  const asOfMs = parseYmdToMs(args.dateStr);
  if (Number.isNaN(asOfMs)) {
    throw new Error(`candidatePool: invalid dateStr "${args.dateStr}"`);
  }

  const profile = await computeStudentProfile(ctx, {
    studentId: args.studentId,
    unitIds: args.unitIds,
    gradeByModule: args.gradeByModule,
    asOf: asOfMs,
  });
  if (!profile) return null;

  const todayModule = moduleForDateStr(args.dateStr);

  // Novelty-cooldown set. Anchor on dateStr so re-runs for past dates are stable.
  const cooldownStartMs = asOfMs - NOVELTY_COOLDOWN_DAYS * MS_PER_DAY;
  const cooldownStartYmd = ymdFromMs(cooldownStartMs);
  const recentSheets = await ctx.db
    .query("generatedSheets")
    .withIndex("by_student_date", (q) =>
      q
        .eq("studentId", args.studentId)
        .gte("date", cooldownStartYmd)
        .lt("date", args.dateStr),
    )
    .collect();
  // Count-based novelty window: how many times each question was used across
  // recent sheets. Original behaviour was a binary "used → excluded"; we now
  // exclude a question only once usage reaches its repeatCount (default 1, so
  // unflagged questions behave exactly as before). repeatCount is a
  // temporary-remedy scheduling lever — see questionBank schema note. It does
  // NOT touch the memory/mastery model.
  const usageCountByQuestion = new Map<string, number>();
  const bumpUsage = (qId: unknown) => {
    const k = qId as string;
    usageCountByQuestion.set(k, (usageCountByQuestion.get(k) ?? 0) + 1);
  };
  for (const s of recentSheets) {
    for (const qId of s.warmupQuestionIds) bumpUsage(qId);
    for (const qId of s.mainQuestionIds) bumpUsage(qId);
    for (const qId of s.revisionQuestionIds ?? []) bumpUsage(qId);
    for (const qId of s.examPrepQuestionIds) bumpUsage(qId);
  }

  const conceptByQuestion = new Map<string, ProfileRow[]>();
  const uniqueQuestionIds = new Set<string>();
  const plannerGaps: PlannerGap[] = [];
  // Concepts with ≥1 tagged question. "all-in-cooldown" is detected AFTER the
  // count-based filter below, because repeat-flagged questions may survive.
  const taggedConcepts: ProfileRow[] = [];

  let consideredConcepts = 0;
  let prereqGappedSkipped = 0;

  for (const concept of profile.profile) {
    if (concept.prereqGap && !args.forceIncludeQuestionIds) {
      prereqGappedSkipped += 1;
      continue;
    }

    // Read both tag paths via the unified helper so textbook crops (which
    // carry the concept link via linkedExerciseId + unit ordering rather
    // than a direct questionConcepts row) are visible to the planner.
    // Coverage uses the same helper — keeps "what counts as tagged" in
    // one place across the engine.
    const taggedQuestionIds = await questionsTaggedToConcept(
      ctx,
      concept.conceptId,
    );

    // Prereq-gapped concept + teacher override: keep ONLY the explicitly
    // ticked questions (teacher wins; the gap surfaces via D.4 alerts).
    if (concept.prereqGap) {
      const forced = taggedQuestionIds.filter((id) =>
        args.forceIncludeQuestionIds!.has(id as unknown as string),
      );
      if (forced.length === 0) {
        prereqGappedSkipped += 1;
        continue;
      }
      consideredConcepts += 1;
      taggedConcepts.push(concept);
      for (const qId of forced) {
        const qKey = qId as unknown as string;
        uniqueQuestionIds.add(qKey);
        const list = conceptByQuestion.get(qKey);
        if (list) list.push(concept);
        else conceptByQuestion.set(qKey, [concept]);
      }
      continue;
    }
    consideredConcepts += 1;

    if (taggedQuestionIds.length === 0) {
      plannerGaps.push({
        conceptId: concept.conceptId,
        conceptName: concept.name,
        reason: "no-tags",
      });
      continue;
    }
    taggedConcepts.push(concept);

    for (const qId of taggedQuestionIds) {
      const qKey = qId as unknown as string;
      uniqueQuestionIds.add(qKey);
      const list = conceptByQuestion.get(qKey);
      if (list) {
        list.push(concept);
      } else {
        conceptByQuestion.set(qKey, [concept]);
      }
    }
  }

  const questionDocs = await Promise.all(
    Array.from(uniqueQuestionIds).map((qId) =>
      ctx.db.get(qId as unknown as Id<"questionBank">),
    ),
  );

  const candidates: RawCandidate[] = [];
  const conceptsWithCandidate = new Set<string>();
  for (const q of questionDocs) {
    if (!q) continue;
    const qKey = q._id as unknown as string;
    const concepts = conceptByQuestion.get(qKey);
    if (!concepts || concepts.length === 0) continue;
    // Count-based cooldown: a question rests once used repeatCount times in
    // the window. repeatCount === 1 (default) == the original binary rule.
    // Teacher-ticked questions (Lesson Builder) bypass the rest entirely.
    const used = usageCountByQuestion.get(qKey) ?? 0;
    const cap = Math.max(1, q.repeatCount ?? 1);
    if (used >= cap && !args.forceIncludeQuestionIds?.has(qKey)) continue;
    const candidateQ: CandidateQuestion = {
      _id: q._id,
      source: q.source,
      difficulty: q.difficulty ?? null,
      pickerOrder: q.pickerOrder ?? null,
      linkedExerciseId: q.linkedExerciseId ?? null,
      linkedQuestionKey: q.linkedQuestionKey ?? null,
      pastPaperId: q.pastPaperId ?? null,
      marksAvailable: q.marksAvailable ?? null,
      textbookPageId: q.textbookPageId ?? null,
      questionNumberInPaper: q.questionNumberInPaper ?? null,
    };
    // A question tagged to multiple concepts appears once per concept here.
    // D.2's scorer evaluates each (q, concept) pair independently; D.3's
    // slot allocator then dedupes physical questions via a seen-set so a
    // single q can't appear twice on one sheet even when scored highly
    // under two different concepts.
    for (const concept of concepts) {
      candidates.push({ question: candidateQ, concept });
      conceptsWithCandidate.add(concept.conceptId as unknown as string);
    }
  }

  // all-in-cooldown: concept had tags but every question rested this window.
  for (const concept of taggedConcepts) {
    if (!conceptsWithCandidate.has(concept.conceptId as unknown as string)) {
      plannerGaps.push({
        conceptId: concept.conceptId,
        conceptName: concept.name,
        reason: "all-in-cooldown",
      });
    }
  }

  return {
    candidates,
    plannerGaps,
    meta: {
      todayModule,
      cooldownStartYmd,
      cooldownDays: NOVELTY_COOLDOWN_DAYS,
      recentSheetCount: recentSheets.length,
      recentlyUsedQuestionCount: usageCountByQuestion.size,
      uniqueQuestionsConsidered: uniqueQuestionIds.size,
      candidateCount: candidates.length,
      consideredConcepts,
      prereqGappedSkipped,
    },
    generatedAt: asOfMs,
    asOfMs,
    studentSchoolGrade: profile.student.schoolGrade,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// D.1 query — unscored candidate pool. Kept for inspection / debugging and
// for any future caller that wants the raw pool without scoring overhead.
// ──────────────────────────────────────────────────────────────────────────

export const candidatePool = query({
  args: {
    studentId: v.id("students"),
    // YYYY-MM-DD. Used for the module-of-day metadata + the novelty-cooldown
    // window anchor (window = [dateStr - NOVELTY_COOLDOWN_DAYS, dateStr)).
    dateStr: v.string(),
    // Same curriculum scope inputs as studentProfile — caller resolves them
    // client-side from src/lib/curriculum-data.ts.
    unitIds: v.array(v.string()),
    gradeByModule: v.record(v.string(), v.array(v.number())),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const pool = await buildCandidatePool(ctx, args);
    if (!pool) return null;
    return {
      candidates: pool.candidates,
      plannerGaps: pool.plannerGaps,
      meta: pool.meta,
      generatedAt: pool.generatedAt,
    };
  },
});

// ──────────────────────────────────────────────────────────────────────────
// D.2 — Per-question scoring.
// ──────────────────────────────────────────────────────────────────────────

// Days the concept is past its natural review interval. Stability (in days)
// is the FSRS interval at R = 0.9 — the canonical "naturalIntervalFromStability"
// is the stability itself. Positive return = overdue.
//
// Cold concepts (no memory state yet — lastReviewAt === null) are NOT
// reported as overdue: their R is already 0 from masteryFromState defaults,
// so urgency = 1 - 0 = 1 without needing the boost. Stacking the boost on
// top would push urgency above 1, which we clamp anyway, but skipping it
// keeps the per-factor numbers honest in the scoringSnapshot.
function overdueDays(
  stability: number | null,
  lastReviewAt: number | null,
  asOfMs: number,
): number {
  if (stability === null || lastReviewAt === null) return 0;
  const daysSinceLastReview = (asOfMs - lastReviewAt) / MS_PER_DAY;
  return daysSinceLastReview - stability;
}

// D.5 — exam-date backstop. Returns { fired, reason } telling the scorer
// whether to force urgency to 1.0 because the concept's natural review
// would slip past the exam-prep deadline.
//
// Algorithm (algorithm_plan.md D.5):
//   daysUntilNaturalReview = daysSinceLastReview + naturalIntervalFromStability(stability)
//   if daysUntilNaturalReview > daysToExam − EXAM_BACKSTOP_DAYS:
//     force urgency = 1.0
//
// Cold concepts (no memory state) and concepts with no upcoming exam at the
// concept's term are never backstopped — those are handled by the cold-
// concept urgency baseline (1 − R = 1.0) and proximity-zero respectively.
function examBackstopUrgency(args: {
  stability: number | null;
  lastReviewAt: number | null;
  daysToExam: number | null;
  asOfMs: number;
}): { fired: boolean; reason: string | null } {
  if (
    args.stability === null ||
    args.lastReviewAt === null ||
    args.daysToExam === null
  ) {
    return { fired: false, reason: null };
  }
  const daysSinceLastReview = (args.asOfMs - args.lastReviewAt) / MS_PER_DAY;
  const naturalInterval = Math.max(
    NATURAL_INTERVAL_FLOOR_DAYS,
    args.stability,
  );
  const daysUntilNaturalReview = daysSinceLastReview + naturalInterval;
  const cutoff = args.daysToExam - EXAM_BACKSTOP_DAYS;
  if (daysUntilNaturalReview > cutoff) {
    return {
      fired: true,
      reason: `natural-review at +${Math.round(
        daysUntilNaturalReview,
      )}d would slip past exam-${EXAM_BACKSTOP_DAYS}d cutoff (+${cutoff}d)`,
    };
  }
  return { fired: false, reason: null };
}

export type ScoreFactors = {
  importance: number;
  urgency: number;
  fit: number;
  novelty: number;
  proximity: number;
};

export type ScoreBreakdown = ScoreFactors & {
  baseScore: number;
  overdueDays: number;
  daysToExam: number | null;
  studentSkillOnConcept: number;
  qDifficulty: number;
  // D.5: when the exam-date backstop fires for this concept, urgency is
  // forced to this value (typically 1.0) and `urgencyOverrideReason`
  // explains why. The standard `1 - R + overdueBoost` formula is bypassed
  // entirely so the factor breakdown UI can label the row honestly.
  urgencyOverride: number | null;
  urgencyOverrideReason: string | null;
  // Coverage mode (2026-07-14): when active, the Gaussian difficulty-fit is
  // replaced by the coverage-ladder value (see coverageMode.ts) and the
  // reason names the rung — same honesty contract as the urgency override.
  fitOverride: number | null;
  fitOverrideReason: string | null;
};

// Pure scoring function. Inputs are already-resolved memory state + exam
// proximity, so this is trivially unit-testable and reusable from F.3
// (calibration replay) and G (tuning lab).
export function scoreCandidate(args: {
  importance: number;          // concept.importance, 0..1
  R: number;                   // concept.R, 0..1
  mastery: number;             // concept.mastery, 0..1
  stability: number | null;    // null when cold
  lastReviewAt: number | null; // null when cold
  qDifficulty: number | null;  // null → DEFAULT_QUESTION_DIFFICULTY
  daysToExam: number | null;   // null → proximity 0
  asOfMs: number;
  // D.5: when set, urgency is forced to this value (clamped to [0,1]) and
  // the standard `1 - R + overdueBoost` formula is bypassed. Reason string
  // surfaces in the ScoreBreakdown for the audit trail / UI labelling.
  urgencyOverride?: number | null;
  urgencyOverrideReason?: string | null;
  // Coverage mode: when set, replaces the Gaussian difficulty-fit entirely
  // (clamped to [0,1]). Reason surfaces in the ScoreBreakdown.
  fitOverride?: number | null;
  fitOverrideReason?: string | null;
}): ScoreBreakdown {
  const importance = clamp01(args.importance);

  // Urgency: stale memory + overdue boost — UNLESS the caller supplies a
  // hard override (D.5 exam-date backstop). Override replaces, not stacks,
  // so the factor breakdown stays honest.
  const overdue = overdueDays(args.stability, args.lastReviewAt, args.asOfMs);
  const hasOverride =
    args.urgencyOverride !== undefined && args.urgencyOverride !== null;
  const urgency = hasOverride
    ? clamp01(args.urgencyOverride as number)
    : clamp01(
        1 - clamp01(args.R) +
          (overdue > 0 ? URGENCY_OVERDUE_BOOST : 0),
      );

  // Difficulty fit (Gaussian peak) — unless coverage mode supplies a
  // ladder override (replaces, not stacks, same honesty rule as urgency).
  const studentSkillOnConcept = 1 + 4 * clamp01(args.mastery); // 1..5
  const qDifficulty = args.qDifficulty ?? DEFAULT_QUESTION_DIFFICULTY;
  const delta = qDifficulty - studentSkillOnConcept;
  const hasFitOverride =
    args.fitOverride !== undefined && args.fitOverride !== null;
  const fit = hasFitOverride
    ? clamp01(args.fitOverride as number)
    : clamp01(Math.exp(-(delta * delta) / (2 * FIT_SIGMA * FIT_SIGMA)));

  // Novelty: 1.0 here because D.1 already filtered the cooldown window.
  const novelty = 1;

  // Exam proximity.
  let proximity = 0;
  if (args.daysToExam !== null && args.daysToExam <= PROXIMITY_HORIZON_DAYS) {
    proximity = clamp01(
      1 - Math.max(0, args.daysToExam) / PROXIMITY_HORIZON_DAYS,
    );
  }

  const baseScore =
    W_IMPORTANCE * importance +
    W_URGENCY * urgency +
    W_FIT * fit +
    W_NOVELTY * novelty +
    W_PROXIMITY * proximity;

  return {
    importance,
    urgency,
    fit,
    novelty,
    proximity,
    baseScore: clamp01(baseScore),
    overdueDays: overdue,
    daysToExam: args.daysToExam,
    studentSkillOnConcept,
    qDifficulty,
    urgencyOverride: hasOverride ? clamp01(args.urgencyOverride as number) : null,
    urgencyOverrideReason: hasOverride
      ? args.urgencyOverrideReason ?? null
      : null,
    fitOverride: hasFitOverride ? clamp01(args.fitOverride as number) : null,
    fitOverrideReason: hasFitOverride
      ? args.fitOverrideReason ?? null
      : null,
  };
}

// ── Coverage ladder — per-(concept, question) fit overrides ──────────────
// THE default since the departments redesign (2026-07-14): every student in
// "normal" learning mode gets ladder overrides for the whole candidate pool
// in one pass. Seen = the question appeared on ANY of the student's sheets
// strictly BEFORE dateStr (today's own draft never damps a same-day
// regenerate). Returns null ONLY for students flagged into "consolidation"
// mode (students.learningMode) — their picks fall back to the Gaussian
// difficulty-fit with repeats, the weak-student consolidation behaviour.
async function buildCoverageOverrides(
  ctx: ReadCtx,
  args: {
    studentId: Id<"students">;
    dateStr: string;
    candidates: RawCandidate[];
  },
): Promise<Map<string, CoverageFitOverride> | null> {
  const student = await ctx.db.get(args.studentId);
  if ((student?.learningMode ?? "normal") === "consolidation") return null;

  const priorSheets = await ctx.db
    .query("generatedSheets")
    .withIndex("by_student_date", (q) =>
      q.eq("studentId", args.studentId).lt("date", args.dateStr),
    )
    .collect();
  const seenEver = new Set<string>();
  for (const s of priorSheets) {
    for (const qId of s.warmupQuestionIds) seenEver.add(qId as unknown as string);
    for (const qId of s.mainQuestionIds) seenEver.add(qId as unknown as string);
    for (const qId of s.revisionQuestionIds ?? [])
      seenEver.add(qId as unknown as string);
    for (const qId of s.examPrepQuestionIds)
      seenEver.add(qId as unknown as string);
  }

  // Group the pool per concept, then let the pure ladder helper decide.
  const byConcept = new Map<
    string,
    { skill: number; questions: CoverageQuestion[] }
  >();
  for (const c of args.candidates) {
    const cid = c.concept.conceptId as unknown as string;
    let g = byConcept.get(cid);
    if (!g) {
      g = { skill: 1 + 4 * Math.min(1, Math.max(0, c.concept.mastery)), questions: [] };
      byConcept.set(cid, g);
    }
    g.questions.push({
      id: c.question._id as unknown as string,
      difficulty: c.question.difficulty,
      pickerOrder: c.question.pickerOrder,
      seen: seenEver.has(c.question._id as unknown as string),
    });
  }

  const out = new Map<string, CoverageFitOverride>();
  byConcept.forEach((g, cid) => {
    const fits = coverageLadderFits({
      questions: g.questions,
      studentSkill: g.skill,
    });
    fits.forEach((v, qid) => out.set(`${cid}|${qid}`, v));
  });
  return out;
}

// ──────────────────────────────────────────────────────────────────────────
// D.2 query — scored, ranked candidate pool.
// ──────────────────────────────────────────────────────────────────────────

export const scoredCandidatePool = query({
  args: {
    studentId: v.id("students"),
    dateStr: v.string(),
    unitIds: v.array(v.string()),
    gradeByModule: v.record(v.string(), v.array(v.number())),
    // Cap on returned candidates (sorted by score desc). Defaults to all.
    // Useful for the verification UI: "show me the top 50".
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;

    const pool = await buildCandidatePool(ctx, {
      studentId: args.studentId,
      dateStr: args.dateStr,
      unitIds: args.unitIds,
      gradeByModule: args.gradeByModule,
    });
    if (!pool) return null;

    // Pull exam calendar for the student's schoolGrade once, bucket by term.
    // The proximity factor reads `next upcoming exam at (schoolGrade, c.term)`.
    // Downgraded students still SIT their schoolGrade exam — so a G9-on-M1
    // concept's proximity is computed against the G10 exam date for that
    // concept's term, not the G9 calendar. This matches the spec.
    const examRows = await ctx.db
      .query("examCalendar")
      .withIndex("by_grade", (q) =>
        q.eq("grade", pool.studentSchoolGrade),
      )
      .collect();
    const asOfMs = pool.asOfMs;
    const asOfYmd = ymdFromMs(asOfMs);
    const nextExamYmdByTerm = new Map<number, string>();
    for (const row of examRows) {
      if (row.examDate < asOfYmd) continue;
      const cur = nextExamYmdByTerm.get(row.term);
      if (cur === undefined || row.examDate < cur) {
        nextExamYmdByTerm.set(row.term, row.examDate);
      }
    }

    function daysToExamForTerm(term: number): number | null {
      const ymd = nextExamYmdByTerm.get(term);
      if (!ymd) return null;
      const ms = parseYmdToMs(ymd);
      if (Number.isNaN(ms)) return null;
      return Math.round((ms - asOfMs) / MS_PER_DAY);
    }

    type ScoredCandidate = {
      question: CandidateQuestion;
      concept: ProfileRow;
      score: number;
      factors: ScoreBreakdown;
    };

    // Coverage ladder (default engine): same overrides the real planner
    // applies, so this inspection view matches what generation will do.
    // Null only for consolidation-mode students.
    const coverage = await buildCoverageOverrides(ctx, {
      studentId: args.studentId,
      dateStr: args.dateStr,
      candidates: pool.candidates,
    });

    const scored: ScoredCandidate[] = pool.candidates.map((c) => {
      const daysToExam = daysToExamForTerm(c.concept.term);
      const backstop = examBackstopUrgency({
        stability: c.concept.stability,
        lastReviewAt: c.concept.lastReviewAt,
        daysToExam,
        asOfMs: pool.asOfMs,
      });
      const cov = coverage?.get(
        `${c.concept.conceptId as unknown as string}|${c.question._id as unknown as string}`,
      );
      const factors = scoreCandidate({
        importance: c.concept.importance,
        R: c.concept.R,
        mastery: c.concept.mastery,
        stability: c.concept.stability,
        lastReviewAt: c.concept.lastReviewAt,
        qDifficulty: c.question.difficulty,
        daysToExam,
        asOfMs: pool.asOfMs,
        urgencyOverride: backstop.fired ? 1.0 : null,
        urgencyOverrideReason: backstop.reason,
        fitOverride: cov ? cov.fit : null,
        fitOverrideReason: cov ? cov.reason : null,
      });
      return {
        question: c.question,
        concept: c.concept,
        score: factors.baseScore,
        factors,
      };
    });

    scored.sort((a, b) => b.score - a.score);

    const limit =
      args.limit !== undefined && args.limit > 0 ? args.limit : scored.length;
    const trimmed = scored.slice(0, limit);

    // Per-term exam summary, returned in meta for the verification UI.
    const examSummary: Array<{
      term: number;
      examDate: string;
      daysToExam: number;
    }> = [];
    nextExamYmdByTerm.forEach((ymd, term) => {
      const days = daysToExamForTerm(term);
      if (days === null) return;
      examSummary.push({ term, examDate: ymd, daysToExam: days });
    });
    examSummary.sort((a, b) => a.term - b.term);

    return {
      candidates: trimmed,
      plannerGaps: pool.plannerGaps,
      meta: {
        ...pool.meta,
        scoredCount: scored.length,
        returnedCount: trimmed.length,
        weights: {
          importance: W_IMPORTANCE,
          urgency: W_URGENCY,
          fit: W_FIT,
          novelty: W_NOVELTY,
          proximity: W_PROXIMITY,
        },
        examSummary,
      },
      generatedAt: pool.generatedAt,
    };
  },
});

// ──────────────────────────────────────────────────────────────────────────
// Internal helper exports (re-used by D.3 slot allocator).
// ──────────────────────────────────────────────────────────────────────────

export type { CandidateQuestion, ProfileRow, RawCandidate, RawPool };
export { buildCandidatePool };

// ══════════════════════════════════════════════════════════════════════════
// PHASE D.3 — Slot allocator (planSheet)
//
// Architecture overview:
//
//   planSheet(studentId, dateStr, unitIds, gradeByModule)
//     ├── 1. Resolve student + off-day check
//     │       → if today is the student's off-day, return early
//     │         with status="off-day". No DB writes.
//     ├── 2. Build the scored candidate pool (reuses D.1 + D.2 helpers)
//     ├── 3. Determine phase-of-term using the next upcoming exam at
//     │       student.schoolGrade (any term). Maps to one of:
//     │         earlyT1 / lateT1 / earlyT2 / lateT2 / earlyT3 / lateT3
//     │         examWeek-T{n}  (≤ EXAM_WEEK_DAYS to exam)
//     │         default        (no upcoming exam)
//     │       Each phase yields a ratio triple (warmup, main, examPrep).
//     ├── 4. Compute today's time + question budget:
//     │         a) sessionMinutesOverride / sheetLengthOverride (manual)
//     │         b) auto-tune from past COMPLETION_HISTORY_WINDOW_DAYS sheets
//     │            classify into weak / default / strong tier
//     │         c) clamp to [SESSION_MIN_FLOOR, SESSION_MIN_CEILING]
//     ├── 5. Allocate slots:
//     │       Each slot has its own primary filter on the scored pool:
//     │         exam-prep: source=="past-paper" AND mastery >= 0.5
//     │         main:      concept.moduleId === todayModule
//     │         warmup:    concept.moduleId !== todayModule
//     │       Exam-week override collapses module-of-day boundaries: all
//     │       three slots draw from any-module, prioritising past-paper
//     │       sources and the upcoming exam's term.
//     │       Within each slot, pickInterleaved walks concepts in score
//     │       order and round-robins so a single dominant concept doesn't
//     │       monopolise the slot. Cross-slot dedupe (seenQuestionIds)
//     │       guarantees no physical question repeats on the sheet.
//     ├── 6. Fallbacks when a slot can't fill from its primary filter:
//     │       warmup    → same-module review concepts (mastery ≥ 0.5)
//     │       main      → past-paper source from today's module
//     │       exam-prep → harder textbook questions on mastered concepts
//     │       Reasons recorded in underFillReasons.
//     └── 7. Return { status, warmup, main, examPrep, phaseOfTerm,
//                     ratios, budget, examWeekMode, underFillReasons,
//                     plannerGaps, meta, generatedAt }
//
// What this query does NOT do (deferred to other phases):
//   - Persistence to generatedSheets — D.6 wraps planSheet as a mutation
//   - PDF rendering — Phase E
//   - Prereq-unmet alerts — D.4 (this query already filters prereq-gapped
//     concepts via D.1, so the sheet itself is prereq-clean; D.4 will add
//     soft alerts when a prereq gap is the *reason* a sheet under-fills).
//   - Lead override / swap — D.6 + E.4
// ══════════════════════════════════════════════════════════════════════════

const WEEKDAY_NAMES = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

type StudentDoc = Doc<"students">;

// ── Off-day check ─────────────────────────────────────────────────────────

// Per-student off-day. Reads `student.offDays`, lowercased. Falls back to
// DEFAULT_OFF_DAYS (["sunday"]) when unset. Lowercase normalisation makes
// the schema field forgiving — "Sunday", "SUNDAY", "sun" (no) all resolve
// against the canonical name set.
function offDaysFor(student: StudentDoc): Set<string> {
  const raw = student.offDays ?? DEFAULT_OFF_DAYS;
  const out = new Set<string>();
  for (const d of raw) out.add(String(d).toLowerCase().trim());
  return out;
}

function weekdayNameFromDateStr(dateStr: string): string | null {
  const ms = Date.parse(`${dateStr}T00:00:00.000Z`);
  if (Number.isNaN(ms)) return null;
  return WEEKDAY_NAMES[new Date(ms).getUTCDay()];
}

function isOffDay(student: StudentDoc, dateStr: string): boolean {
  const dayName = weekdayNameFromDateStr(dateStr);
  if (!dayName) return false;
  return offDaysFor(student).has(dayName);
}

// ── Budget computation ────────────────────────────────────────────────────

type Tier = "weak" | "default" | "strong";

type Budget = {
  timeMin: number;        // target session time in minutes
  questionCap: number;    // hard cap on questions even if time budget allows more
  tier: Tier;
  source:
    | "slot-length"
    | "manual-override"
    | "auto-tuned"
    | "default-no-history"
    | "default-fallback";
  recentCompletionRate: number | null;
  recentSheetsConsidered: number;
  // Phase 6: resolved session length in minutes BEFORE the tier multiplier
  // (i.e. the raw class/override/default minutes). Drives MAIN_NEW_CONCEPTS.
  sessionMinutes: number;
};

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

function tierToTime(tier: Tier): number {
  if (tier === "weak") return SESSION_MIN_WEAK;
  if (tier === "strong") return SESSION_MIN_STRONG;
  return SESSION_MIN_DEFAULT;
}
function tierToCount(tier: Tier): number {
  if (tier === "weak") return SHEET_LEN_WEAK;
  if (tier === "strong") return SHEET_LEN_STRONG;
  return SHEET_LEN_DEFAULT;
}

// Look at sheets generated in the last COMPLETION_HISTORY_WINDOW_DAYS for
// this student. For each sheet, compute completion rate from attemptLog:
// a sheet's question was "attempted" if any attemptLog row exists with
// questionId in the sheet AND occurredAt within the same calendar day.
// Returns the average completion rate + number of sheets sampled.
async function recentCompletionStats(
  ctx: ReadCtx,
  studentId: Id<"students">,
  dateStr: string,
): Promise<{ avgCompletion: number | null; sampleCount: number }> {
  const asOfMs = parseYmdToMs(dateStr);
  if (Number.isNaN(asOfMs)) {
    return { avgCompletion: null, sampleCount: 0 };
  }
  const windowStartMs =
    asOfMs - COMPLETION_HISTORY_WINDOW_DAYS * MS_PER_DAY;
  const windowStartYmd = ymdFromMs(windowStartMs);

  const recentSheets = await ctx.db
    .query("generatedSheets")
    .withIndex("by_student_date", (q) =>
      q
        .eq("studentId", studentId)
        .gte("date", windowStartYmd)
        .lt("date", dateStr),
    )
    .collect();
  if (recentSheets.length === 0) {
    return { avgCompletion: null, sampleCount: 0 };
  }

  // Safety fix (2026-07-10 audit): credit attempts within 48h of the sheet
  // date, not just the same calendar day. Real life scores sheets the next
  // morning; the old same-day rule counted those sheets as 0% complete and
  // misclassified the student as "weak" (shrinking their sheets). The scan
  // end extends past asOfMs so a yesterday-sheet scored today still counts.
  const ATTEMPT_CREDIT_WINDOW_MS = 48 * 3_600_000;
  const attempts = await ctx.db
    .query("attemptLog")
    .withIndex("by_student_time", (q) =>
      q
        .eq("studentId", studentId)
        .gte("occurredAt", windowStartMs)
        .lt("occurredAt", asOfMs + ATTEMPT_CREDIT_WINDOW_MS),
    )
    .collect();

  // Attempt times per physical question (one row per concept × question;
  // dedupe happens naturally via the per-question time list).
  const attemptTimesByQuestion = new Map<string, number[]>();
  for (const a of attempts) {
    if (!a.questionId) continue;
    const k = a.questionId as unknown as string;
    const list = attemptTimesByQuestion.get(k);
    if (list) list.push(a.occurredAt);
    else attemptTimesByQuestion.set(k, [a.occurredAt]);
  }

  let totalRate = 0;
  let denom = 0;
  for (const sheet of recentSheets) {
    const sheetQs = [
      ...sheet.warmupQuestionIds,
      ...sheet.mainQuestionIds,
      ...(sheet.revisionQuestionIds ?? []),
      ...sheet.examPrepQuestionIds,
    ];
    if (sheetQs.length === 0) continue;
    const sheetStartMs = parseYmdToMs(sheet.date);
    const sheetEndMs = sheetStartMs + ATTEMPT_CREDIT_WINDOW_MS;
    let hits = 0;
    for (const qId of sheetQs) {
      const times = attemptTimesByQuestion.get(qId as unknown as string);
      if (times && times.some((t) => t >= sheetStartMs && t < sheetEndMs)) {
        hits += 1;
      }
    }
    totalRate += hits / sheetQs.length;
    denom += 1;
  }
  if (denom === 0) return { avgCompletion: null, sampleCount: 0 };
  return { avgCompletion: totalRate / denom, sampleCount: denom };
}

// Phase 6 — session-length-aware budget.
//
// TIME budget precedence (founder decision: "use the class times"):
//   1. the scheduled session's actual length (slot start→end)
//   2. student.sessionMinutesOverride (manual per-student)
//   3. tier default from completion history (or SESSION_MIN_DEFAULT)
//
// The class length is fixed, so the completion-history tier is NOT applied to
// time — it's applied as a DENSITY multiplier on the QUESTION cap (a strong
// student fits more questions in the same hour; a weak student fewer). The
// question cap otherwise derives from the time budget so longer sessions yield
// longer sheets. Manual sheetLengthOverride still wins the cap outright.
async function computeBudget(
  ctx: ReadCtx,
  student: StudentDoc,
  dateStr: string,
  slotId?: Id<"scheduleSlots">,
): Promise<Budget> {
  // Completion-history tier (always computed; used as the density multiplier).
  const { avgCompletion, sampleCount } = await recentCompletionStats(
    ctx,
    student._id,
    dateStr,
  );
  let tier: Tier = "default";
  const haveHistory =
    avgCompletion !== null && sampleCount >= MIN_COMPLETION_SAMPLE;
  if (haveHistory) {
    if (avgCompletion! >= COMPLETION_RATE_GROW) tier = "strong";
    else if (avgCompletion! <= COMPLETION_RATE_SHRINK) tier = "weak";
  }
  const densityMultiplier =
    tier === "strong"
      ? BUDGET_GROW_FACTOR
      : tier === "weak"
        ? BUDGET_SHRINK_FACTOR
        : 1.0;

  // Resolve session minutes by precedence.
  let sessionMinutes: number;
  let source: Budget["source"];
  let slotMinutes: number | null = null;
  if (slotId) {
    const slot = await ctx.db.get(slotId);
    if (slot) slotMinutes = minutesBetweenClock(slot.startTime, slot.endTime);
  }
  if (slotMinutes !== null) {
    sessionMinutes = slotMinutes;
    source = "slot-length";
  } else if (
    student.sessionMinutesOverride !== undefined &&
    student.sessionMinutesOverride !== null
  ) {
    sessionMinutes = student.sessionMinutesOverride;
    source = "manual-override";
  } else {
    sessionMinutes = tierToTime(tier);
    source = haveHistory ? "auto-tuned" : "default-no-history";
  }

  const timeMin = clamp(
    sessionMinutes,
    SESSION_MIN_FLOOR,
    SESSION_MIN_CEILING,
  );

  // Question cap: explicit per-student override wins; otherwise derive from the
  // time budget (so it scales with session length) and apply the tier density.
  const hasCountOverride =
    student.sheetLengthOverride !== undefined &&
    student.sheetLengthOverride !== null;
  const questionCap = hasCountOverride
    ? clamp(student.sheetLengthOverride!, SHEET_LEN_FLOOR, SHEET_LEN_CEILING)
    : clamp(
        Math.round((timeMin / DEFAULT_QUESTION_TIME_MIN) * densityMultiplier),
        SHEET_LEN_FLOOR,
        SHEET_LEN_CEILING,
      );

  return {
    timeMin,
    questionCap,
    tier,
    source,
    recentCompletionRate: avgCompletion,
    recentSheetsConsidered: sampleCount,
    sessionMinutes,
  };
}

// ── Phase-of-term determination ───────────────────────────────────────────

type PhaseKey =
  | "earlyT1"
  | "lateT1"
  | "earlyT2"
  | "lateT2"
  | "earlyT3"
  | "lateT3"
  | "examWeek-T1"
  | "examWeek-T2"
  | "examWeek-T3"
  | "default";

type Ratios = {
  warmup: number;
  main: number;
  revision: number;
  examPrep: number;
};

type PhaseInfo = {
  phase: PhaseKey;
  ratios: Ratios;
  examWeekMode: boolean;
  daysToExam: number | null;
  examTerm: number | null;
  examDate: string | null;
};

// Resolve the upcoming exam at student.schoolGrade (any term — pick the
// earliest exam date on or after dateStr). examWeekMode if ≤ EXAM_WEEK_DAYS,
// else late if ≤ LATE_TERM_DAYS, else early. No upcoming exam → "default".
//
// We pick the schoolGrade exam, not assignedGrade — a G10 student downgraded
// on M1 still SITS the G10 paper, so phase reweighting tracks the G10
// calendar. (Same reasoning as proximity scoring in D.2.)
async function determinePhase(
  ctx: ReadCtx,
  studentSchoolGrade: number,
  dateStr: string,
): Promise<PhaseInfo> {
  const examRows = await ctx.db
    .query("examCalendar")
    .withIndex("by_grade", (q) => q.eq("grade", studentSchoolGrade))
    .collect();

  let next: { examDate: string; term: number; examModeActive: boolean } | null =
    null;
  for (const r of examRows) {
    if (r.examDate < dateStr) continue;
    if (!next || r.examDate < next.examDate) {
      next = {
        examDate: r.examDate,
        term: r.term,
        examModeActive: r.examModeActive === true,
      };
    }
  }
  if (!next) {
    return {
      phase: "default",
      ratios: { ...DEFAULT_RATIOS },
      examWeekMode: false,
      daysToExam: null,
      examTerm: null,
      examDate: null,
    };
  }

  const examMs = parseYmdToMs(next.examDate);
  const asOfMs = parseYmdToMs(dateStr);
  const daysToExam = Math.round((examMs - asOfMs) / MS_PER_DAY);

  // Exam-week mode is now MANUAL (Founder, 2026-06-11): it fires only when the
  // teacher flips the exam's "Exam mode" switch on the Exam Calendar — never
  // automatically from proximity. The early/late ratio buckets below still key
  // off daysToExam; only this disruptive term-lock branch is gated. The 14-day
  // window now only drives the "exam approaching" reminder (convex/examAlerts).
  if (next.examModeActive) {
    return {
      phase: `examWeek-T${next.term}` as PhaseKey,
      ratios: { ...EXAM_WEEK_RATIOS },
      examWeekMode: true,
      daysToExam,
      examTerm: next.term,
      examDate: next.examDate,
    };
  }
  const half: "early" | "late" =
    daysToExam <= LATE_TERM_DAYS ? "late" : "early";
  const key = `${half}T${next.term}` as keyof typeof PHASE_RATIOS;
  const ratios = PHASE_RATIOS[key];
  return {
    phase: key as PhaseKey,
    ratios: { ...ratios },
    examWeekMode: false,
    daysToExam,
    examTerm: next.term,
    examDate: next.examDate,
  };
}

// ── Slot picker (round-robin interleaved by concept) ──────────────────────

type ScoredCandidate = {
  question: CandidateQuestion;
  concept: ProfileRow;
  score: number;
  factors: ScoreBreakdown;
};

// Greedy round-robin pick: walks unique concepts in score order, takes one
// question per concept per pass, wraps around until either the time budget
// or the question cap is hit (whichever first), with cross-slot dedupe via
// seenQuestionIds. Diversifies the sheet so a single high-importance concept
// can't monopolise the slot — the user's interleaving requirement.
//
// Note: operates on EnrichedCandidate so `question.expectedTimeMin` is
// directly readable. enrichWithTime is the single batched read that adds
// the field.
function pickInterleaved(
  candidates: EnrichedCandidate[],
  timeBudgetMin: number,
  questionCap: number,
  seenQuestionIds: Set<string>,
): { picked: EnrichedCandidate[]; usedTimeMin: number } {
  if (questionCap <= 0 || timeBudgetMin <= 0) {
    return { picked: [], usedTimeMin: 0 };
  }
  // Group by concept; preserves the score-desc order within each group
  // because we iterate `candidates` (already sorted) in one pass.
  const conceptOrder: string[] = [];
  const byConcept = new Map<string, EnrichedCandidate[]>();
  for (const c of candidates) {
    const key = c.concept.conceptId as unknown as string;
    if (!byConcept.has(key)) {
      conceptOrder.push(key);
      byConcept.set(key, []);
    }
    byConcept.get(key)!.push(c);
  }
  const picked: EnrichedCandidate[] = [];
  let usedTimeMin = 0;
  // Round-robin: each pass picks at most one question per concept. Bound
  // total passes to questionCap × 2 so a degenerate input can't loop.
  for (let pass = 0; pass < questionCap * 2 + 1; pass++) {
    let progressedThisPass = false;
    for (const k of conceptOrder) {
      if (picked.length >= questionCap) break;
      const list = byConcept.get(k)!;
      let chosen: EnrichedCandidate | null = null;
      while (list.length > 0) {
        const cand = list.shift()!;
        if (seenQuestionIds.has(cand.question._id as unknown as string)) {
          continue;
        }
        chosen = cand;
        break;
      }
      if (!chosen) continue;
      const t =
        chosen.question.expectedTimeMin ?? DEFAULT_QUESTION_TIME_MIN;
      // Soft time-budget enforcement: allow first pick always, then allow
      // overshoot up to 20% so a near-full sheet isn't truncated by a single
      // slightly-long question.
      if (
        picked.length > 0 &&
        usedTimeMin + t > timeBudgetMin * 1.2
      ) {
        // Return this candidate to the head of its concept group so a
        // later, smaller-budget slot doesn't lose it from consideration
        // entirely. Cross-slot dedupe still respects the slot ordering.
        list.unshift(chosen);
        continue;
      }
      picked.push(chosen);
      seenQuestionIds.add(chosen.question._id as unknown as string);
      usedTimeMin += t;
      progressedThisPass = true;
      if (
        picked.length >= questionCap ||
        usedTimeMin >= timeBudgetMin
      ) {
        return { picked, usedTimeMin };
      }
    }
    if (!progressedThisPass) break; // pool exhausted
  }
  return { picked, usedTimeMin };
}

// Pull `expectedTimeMin` for a list of questionBank IDs in one batch.
// Used to enrich CandidateQuestion when D.1's RawPool didn't capture the
// field. Avoids modifying the existing CandidateQuestion shape.
type EnrichedQuestion = CandidateQuestion & {
  expectedTimeMin: number | null;
};
type EnrichedCandidate = Omit<ScoredCandidate, "question"> & {
  question: EnrichedQuestion;
};

async function enrichWithTime(
  ctx: ReadCtx,
  scored: ScoredCandidate[],
): Promise<EnrichedCandidate[]> {
  const ids = new Set<string>();
  for (const s of scored) ids.add(s.question._id as unknown as string);
  const docs = await Promise.all(
    Array.from(ids).map((id) =>
      ctx.db.get(id as unknown as Id<"questionBank">),
    ),
  );
  const timeById = new Map<string, number | null>();
  for (const d of docs) {
    if (!d) continue;
    timeById.set(
      d._id as unknown as string,
      d.expectedTimeMin ?? null,
    );
  }
  return scored.map((s) => ({
    ...s,
    question: {
      ...s.question,
      expectedTimeMin:
        timeById.get(s.question._id as unknown as string) ?? null,
    },
  }));
}

// ── D.4 — Prereq DAG preflight alerts ────────────────────────────────────
// Soft alerts surfaced on a sheet whenever a chosen question touches a
// concept whose prerequisite has mastery < MASTERY_THRESHOLD. Does NOT
// block the sheet — D.1 already filtered out concepts with prereqGap ===
// true, so primary-concept gaps shouldn't fire. But a question is often
// tagged to MULTIPLE concepts (questionConcepts join). If concept A puts
// the Q into the pool and concept B (also tagged to the same Q) has a
// prereq gap, "loud mode" surfaces the gap so the Lead sees the full
// picture before printing.
//
// Loud-mode contract (per user decision 2026-05-14):
//   • Look at EVERY concept tag of the picked Q, not just the in-pool one.
//   • Walk the prereq DAG to depth PREREQ_BFS_DEPTH, surfacing every
//     unmastered prereq along the way (not just the first blocker —
//     profile.ts's `hasUnmasteredPrereq` short-circuits at first; this
//     helper walks the full frontier).
//   • Dedup by (questionId, conceptId, prereqId).

type PrereqAlert = {
  type: "prereqUnmet";
  questionId: Id<"questionBank">;
  conceptId: Id<"exercises">;
  conceptName: string;
  prereqId: Id<"exercises">;
  prereqName: string;
  prereqMastery: number;
};

const PREREQ_ALERT_BFS_DEPTH = 10;

async function computePrereqAlerts(
  ctx: ReadCtx,
  args: {
    studentId: Id<"students">;
    pickedQuestionIds: Id<"questionBank">[];
    asOfMs: number;
  },
): Promise<PrereqAlert[]> {
  if (args.pickedQuestionIds.length === 0) return [];

  // 1. Mastery lookup: load all memoryState rows for this student once.
  const states = await ctx.db
    .query("memoryState")
    .withIndex("by_student", (q) => q.eq("studentId", args.studentId))
    .collect();
  const masteryByConcept = new Map<string, number>();
  for (const s of states) {
    masteryByConcept.set(
      s.conceptExerciseId as unknown as string,
      masteryFromState(s, args.asOfMs).mastery,
    );
  }
  const getMastery = (id: Id<"exercises">): number =>
    masteryByConcept.get(id as unknown as string) ?? 0;

  // 2. Exercise doc cache (need name + prerequisiteExerciseIds).
  const exerciseCache = new Map<string, Doc<"exercises"> | null>();
  async function getExercise(
    id: Id<"exercises">,
  ): Promise<Doc<"exercises"> | null> {
    const key = id as unknown as string;
    const cached = exerciseCache.get(key);
    if (cached !== undefined) return cached;
    const doc = await ctx.db.get(id);
    exerciseCache.set(key, doc);
    return doc;
  }

  const alerts: PrereqAlert[] = [];
  const seenTriple = new Set<string>();

  for (const qId of args.pickedQuestionIds) {
    // All concepts this question is tagged to (loud mode — not just the
    // in-pool concept that put it on the sheet). Uses the unified helper
    // so textbook crops surface their inherited concepts alongside any
    // direct questionConcepts join rows.
    const conceptIds = await conceptsForQuestion(ctx, qId);

    for (const conceptId of conceptIds) {
      const conceptDoc = await getExercise(conceptId);
      if (!conceptDoc || conceptDoc.type !== "concept") continue;
      const conceptName = conceptDoc.name;

      // BFS the prereq DAG. Visited scoped per-concept-walk so distinct
      // tags from the same Q each get a fair walk.
      const visited = new Set<string>([conceptId as unknown as string]);
      let frontier: Id<"exercises">[] =
        conceptDoc.prerequisiteExerciseIds ?? [];
      for (
        let depth = 0;
        depth < PREREQ_ALERT_BFS_DEPTH && frontier.length > 0;
        depth++
      ) {
        const next: Id<"exercises">[] = [];
        for (const p of frontier) {
          const k = p as unknown as string;
          if (visited.has(k)) continue;
          visited.add(k);
          const pMastery = getMastery(p);
          const pDoc = await getExercise(p);
          // Push alert if unmastered. Continue walking transitively so a
          // chain A→B→C surfaces both A and B if both are weak.
          if (pMastery < MASTERY_THRESHOLD) {
            const tripleKey = `${qId}|${conceptId}|${k}`;
            if (!seenTriple.has(tripleKey)) {
              seenTriple.add(tripleKey);
              alerts.push({
                type: "prereqUnmet",
                questionId: qId,
                conceptId,
                conceptName,
                prereqId: p,
                prereqName: pDoc?.name ?? "(unknown concept)",
                prereqMastery: pMastery,
              });
            }
          }
          if (pDoc && pDoc.type === "concept") {
            for (const pp of pDoc.prerequisiteExerciseIds ?? []) {
              if (!visited.has(pp as unknown as string)) next.push(pp);
            }
          }
        }
        frontier = next;
      }
    }
  }

  return alerts;
}

// ── planSheet query + shared planSheetCore ──────────────────────────────
// planSheetCore is the read-only planning brain. The query exposes it for
// the verification UI; D.6 mutations call it directly inside their
// transaction (so the same row read by buildCandidatePool's novelty
// cooldown is the row that gets written, with no inter-transaction race).

type PlanSheetArgs = {
  studentId: Id<"students">;
  dateStr: string;
  unitIds: string[];
  gradeByModule: Record<string, number[]>;
  // Phase 6: the scheduled session whose start→end length drives the time
  // budget. Optional — planner still works (default budget) without it.
  slotId?: Id<"scheduleSlots">;
  debugSessionMinutes?: number;
  debugSheetLength?: number;
  // Generate-time control panel: explicit per-section question targets for
  // THIS sheet. Any provided section overrides its ratio-derived size; unset
  // sections stay auto. `main` also lifts the new-concept cap.
  sectionTargets?: {
    warmup?: number;
    main?: number;
    revision?: number;
    examPrep?: number;
  };
  // Lesson Builder (2026-07-11): the teacher's exact tick-set for the Main
  // block, in print order. When present, Main = exactly these questions
  // (cooldown bypassed; the auto path/pacing machinery is skipped) and the
  // other sections plan around them. Unservable ids (untagged / off-scope)
  // are dropped with an underfill reason.
  mainQuestionIdsOverride?: Id<"questionBank">[];
};

export async function planSheetCore(ctx: ReadCtx, args: PlanSheetArgs) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(args.dateStr)) {
    throw new Error(`planSheet: invalid dateStr "${args.dateStr}"`);
  }

  // ── 1. Resolve student ──────────────────────────────────────────────
  const student = await ctx.db.get(args.studentId);
  if (!student) return null;

    const todayModule = moduleForDateStr(args.dateStr);
    const offDay = isOffDay(student, args.dateStr);

    // ── 2. Off-day fast return ──────────────────────────────────────────
    // No DB writes here — D.6 inspects this status before persisting.
    if (offDay) {
      return {
        status: "off-day" as const,
        offDayReason: `Student '${student.name}' rests on ${weekdayNameFromDateStr(
          args.dateStr,
        )}.`,
        date: args.dateStr,
        todayModule,
        warmup: [] as EnrichedCandidate[],
        main: [] as EnrichedCandidate[],
        revision: [] as EnrichedCandidate[],
        examPrep: [] as EnrichedCandidate[],
        phase: null,
        ratios: null,
        budget: null,
        examWeek: null,
        underFillReasons: [] as string[],
        alerts: [] as PrereqAlert[],
        plannerGaps: [] as PlannerGap[],
        meta: null,
        generatedAt: parseYmdToMs(args.dateStr),
      };
    }

    // ── 3. Track resolution (Phase 1 — track model) ─────────────────────
    // Resolved BEFORE the candidate pool (safety fix 2026-07-10, see below).
    // When the student rides a track, the Main block walks the track's
    // orderedUnitIds and the budget grade/term come from the track's target
    // exam. trackUnitSet restricts NEW-concept Main candidates; trackRank
    // gives the global ordering. When null, behaviour is unchanged (legacy
    // schoolGrade + per-(grade,term) teachingPath path).
    const track = await resolveTrackForStudent(ctx, student);

    // Safety fix (2026-07-10 audit): a cross-grade track (e.g. remedial G8
    // units for a G10-scoped student) may contain units OUTSIDE the client-
    // resolved grade scope. Those units never entered the candidate pool, so
    // the Main block silently skipped them — a hole in the curriculum with
    // no warning. Widen BOTH scope inputs with the track's units: unitIds
    // gains the ids, and gradeByModule gains each track unit's module→grade
    // pair so computeStudentProfile's isStudied check passes.
    let poolUnitIds = args.unitIds;
    let poolGradeByModule = args.gradeByModule;
    if (track) {
      const unitSet = new Set(args.unitIds);
      const gbm: Record<string, number[]> = Object.fromEntries(
        Object.entries(args.gradeByModule).map(([m, gs]) => [m, [...gs]]),
      );
      for (const unitId of track.orderedUnitIds) {
        unitSet.add(unitId);
        const m = /^(M[1-6])-G(\d+)-T\d+-\d+$/.exec(unitId);
        if (!m) continue;
        const moduleId = m[1];
        const grade = Number(m[2]);
        if (!gbm[moduleId]) gbm[moduleId] = [];
        if (!gbm[moduleId].includes(grade)) gbm[moduleId].push(grade);
      }
      poolUnitIds = Array.from(unitSet);
      poolGradeByModule = gbm;
    }

    // ── 3b. Candidate pool ──────────────────────────────────────────────
    const forceInclude =
      args.mainQuestionIdsOverride && args.mainQuestionIdsOverride.length > 0
        ? new Set(
            args.mainQuestionIdsOverride.map((id) => id as unknown as string),
          )
        : undefined;
    const pool = await buildCandidatePool(ctx, {
      studentId: args.studentId,
      dateStr: args.dateStr,
      unitIds: poolUnitIds,
      gradeByModule: poolGradeByModule,
      ...(forceInclude ? { forceIncludeQuestionIds: forceInclude } : {}),
    });
    if (!pool) return null;

    const trackUnitSet = track ? new Set(track.orderedUnitIds) : null;
    const trackRank = track
      ? new Map(track.orderedUnitIds.map((id, i) => [id, i] as const))
      : null;
    const budgetGrade = track ? track.targetGrade : pool.studentSchoolGrade;

    // ── 4. Exam calendar lookups (for both phase + scoring proximity) ───
    const poolAsOfMs = pool.asOfMs;
    const examRows = await ctx.db
      .query("examCalendar")
      .withIndex("by_grade", (q) =>
        q.eq("grade", budgetGrade),
      )
      .collect();
    const asOfYmd = ymdFromMs(poolAsOfMs);
    const nextExamYmdByTerm = new Map<number, string>();
    for (const row of examRows) {
      if (row.examDate < asOfYmd) continue;
      const cur = nextExamYmdByTerm.get(row.term);
      if (cur === undefined || row.examDate < cur) {
        nextExamYmdByTerm.set(row.term, row.examDate);
      }
    }
    const daysToExamForTerm = (term: number): number | null => {
      const ymd = nextExamYmdByTerm.get(term);
      if (!ymd) return null;
      const ms = parseYmdToMs(ymd);
      if (Number.isNaN(ms)) return null;
      return Math.round((ms - poolAsOfMs) / MS_PER_DAY);
    };

    // ── 5. Score every candidate (reuses D.2's pure helper) ─────────────
    // D.5 — exam-date backstop: per-concept check that forces urgency to
    // 1.0 when the natural review interval would slip past the exam-prep
    // deadline. Replaces (does not stack on top of) the standard urgency
    // formula so the factor breakdown remains honest.
    // Coverage ladder (default engine): within a concept the next UNSEEN
    // ladder question outranks its siblings via a fit override — spaced
    // repetition still owns WHEN, this owns WHICH. Null only when this
    // student is in consolidation mode (per-student weak fallback).
    const coverage = await buildCoverageOverrides(ctx, {
      studentId: args.studentId,
      dateStr: args.dateStr,
      candidates: pool.candidates,
    });
    const scored: ScoredCandidate[] = pool.candidates.map((c) => {
      const daysToExam = daysToExamForTerm(c.concept.term);
      const backstop = examBackstopUrgency({
        stability: c.concept.stability,
        lastReviewAt: c.concept.lastReviewAt,
        daysToExam,
        asOfMs: pool.asOfMs,
      });
      const cov = coverage?.get(
        `${c.concept.conceptId as unknown as string}|${c.question._id as unknown as string}`,
      );
      const factors = scoreCandidate({
        importance: c.concept.importance,
        R: c.concept.R,
        mastery: c.concept.mastery,
        stability: c.concept.stability,
        lastReviewAt: c.concept.lastReviewAt,
        qDifficulty: c.question.difficulty,
        daysToExam,
        asOfMs: pool.asOfMs,
        urgencyOverride: backstop.fired ? 1.0 : null,
        urgencyOverrideReason: backstop.reason,
        fitOverride: cov ? cov.fit : null,
        fitOverrideReason: cov ? cov.reason : null,
      });
      return {
        question: c.question,
        concept: c.concept,
        score: factors.baseScore,
        factors,
      };
    });
    scored.sort((a, b) => b.score - a.score);

    // ── 6. Enrich candidates with expectedTimeMin (single batch read) ───
    const enriched = await enrichWithTime(ctx, scored);

    // ── 7. Phase-of-term + ratios ───────────────────────────────────────
    const phaseInfo = await determinePhase(
      ctx,
      budgetGrade,
      args.dateStr,
    );

    // ── 8. Budget ───────────────────────────────────────────────────────
    let budget: Budget;
    if (
      args.debugSessionMinutes !== undefined ||
      args.debugSheetLength !== undefined
    ) {
      const dbgMinutes = args.debugSessionMinutes ?? SESSION_MIN_DEFAULT;
      budget = {
        timeMin: clamp(dbgMinutes, SESSION_MIN_FLOOR, SESSION_MIN_CEILING),
        questionCap: clamp(
          args.debugSheetLength ?? SHEET_LEN_CEILING,
          SHEET_LEN_FLOOR,
          SHEET_LEN_CEILING,
        ),
        tier: "default",
        source: "manual-override",
        recentCompletionRate: null,
        recentSheetsConsidered: 0,
        sessionMinutes: dbgMinutes,
      };
    } else {
      budget = await computeBudget(ctx, student, args.dateStr, args.slotId);
    }

    // ── 9. Slot allocation ──────────────────────────────────────────────
    // Order matters: exam-prep first (most-restricted candidate set),
    // main next (module-of-day filtered), warmup last (most permissive).
    // Cross-slot dedupe is a single shared Set populated as we go.
    const seen = new Set<string>();
    const underFillReasons: string[] = [];

    // Slot budgets — distribute time & question-count by phase ratios.
    // Round up so each non-zero ratio gets at least one slot's worth.
    function slotBudget(ratio: number): {
      timeMin: number;
      qCap: number;
    } {
      const timeMin = budget.timeMin * ratio;
      const qCap = Math.max(
        ratio > 0 ? 1 : 0,
        Math.round(budget.questionCap * ratio),
      );
      return { timeMin, qCap };
    }

    // Generate-time control panel (Founder, 2026-06-12): when a section's
    // explicit target is supplied, it overrides the ratio-derived size for
    // THIS sheet. Unset sections stay auto (ratio × length). The Main target is
    // resolved further below (it also drives how many new concepts to teach).
    const targets = args.sectionTargets;
    const overrideBudget = (n: number): { timeMin: number; qCap: number } => ({
      // Generous time so a soft time budget never truncates the chosen count.
      timeMin: Math.max(budget.timeMin, (Math.round(n) + 1) * DEFAULT_QUESTION_TIME_MIN),
      qCap: Math.max(0, Math.round(n)),
    });
    const sectionBudget = (
      slot: "warmup" | "main" | "revision" | "examPrep",
      ratio: number,
    ): { timeMin: number; qCap: number } => {
      const t = targets?.[slot];
      return t !== undefined ? overrideBudget(t) : slotBudget(ratio);
    };

    const examPrepBudget = sectionBudget("examPrep", phaseInfo.ratios.examPrep);
    const warmupBudget = sectionBudget("warmup", phaseInfo.ratios.warmup);
    const revisionBudget = sectionBudget("revision", phaseInfo.ratios.revision);

    // ── Sheet redesign (Phase 4): teaching-path order over in-scope concepts.
    // The weekday→module rule is GONE. The Main block walks the teacher-curated
    // teaching path to each student's next NOT-yet-introduced concept. Order
    // key: (grade asc, term asc, teaching-path unit rank, natural unit, concept
    // order). Teaching path is per (grade, term); units absent from a saved
    // path — or when none is saved — fall back to natural curriculum order
    // parsed from the unit id. Only candidate concepts are considered: a
    // concept with no tagged questions can't be put on a sheet, and
    // prereq-gapped concepts were already excluded by buildCandidatePool.
    const unitNaturalKey = (unitId: string): number => {
      const m = /^M(\d+)-G\d+-T\d+-(\d+)$/.exec(unitId);
      if (!m) return 1_000_000;
      return Number(m[1]) * 1000 + Number(m[2]);
    };
    const gradeTermKeys = new Set<string>();
    for (const c of enriched) {
      gradeTermKeys.add(`${c.concept.grade}-${c.concept.term}`);
    }
    const pathByGradeTerm = new Map<string, string[] | null>();
    for (const key of Array.from(gradeTermKeys)) {
      const [g, t] = key.split("-").map(Number);
      pathByGradeTerm.set(key, await resolveTeachingPath(ctx, g, t));
    }
    const unitRank = (concept: ProfileRow): number => {
      const path = pathByGradeTerm.get(`${concept.grade}-${concept.term}`);
      if (path) {
        const idx = path.indexOf(concept.unitId);
        if (idx >= 0) return idx;
        return 100_000 + unitNaturalKey(concept.unitId);
      }
      return unitNaturalKey(concept.unitId);
    };
    // Distinct in-scope concepts (dedupe the per-question candidate rows),
    // ordered along the teaching path.
    const conceptById = new Map<string, ProfileRow>();
    for (const c of enriched) {
      const id = c.concept.conceptId as unknown as string;
      if (!conceptById.has(id)) conceptById.set(id, c.concept);
    }
    const orderedConcepts = Array.from(conceptById.values()).sort((a, b) => {
      // Track ordering (Phase 1): when the student rides a track, a single
      // global rank from the track's orderedUnitIds replaces the
      // per-(grade,term) teaching-path key. Units off the track sort last.
      if (trackRank) {
        const ta = trackRank.get(a.unitId) ?? Number.POSITIVE_INFINITY;
        const tb = trackRank.get(b.unitId) ?? Number.POSITIVE_INFINITY;
        if (ta !== tb) return ta - tb;
        return a.order - b.order;
      }
      if (a.grade !== b.grade) return a.grade - b.grade;
      if (a.term !== b.term) return a.term - b.term;
      const ra = unitRank(a);
      const rb = unitRank(b);
      if (ra !== rb) return ra - rb;
      return a.order - b.order;
    });
    // "New" = never attempted (prereq-gapped concepts are already absent).
    // Track restriction (Phase 1): new-concept Main candidates must lie on the
    // track. No-op when the student has no track. Revision/warm-up/exam-prep
    // pools draw from `enriched` directly and are deliberately NOT restricted.
    const orderedNew = orderedConcepts.filter(
      (c) =>
        c.attemptCount === 0 &&
        (trackUnitSet === null || trackUnitSet.has(c.unitId)),
    );
    // How many new concepts to introduce:
    //   Phase 7: if the unit of the next new concept has a teacher-set pace,
    //            use round(conceptsPerHour * sessionHours).
    //   Phase 6: else scale by session length (round(min / 50)).
    // TODO(maturity): adjust the per-unit conceptsPerHour from observed session
    // completion over time — not built yet (Phase 7 is teacher-set only).
    const firstNew = orderedNew[0];
    const pacing = firstNew
      ? await resolveUnitPacing(ctx, firstNew.grade, firstNew.term, firstNew.unitId)
      : null;
    // Main-block size precedence (Founder, 2026-06-12):
    //   1. one-off sectionTargets.main from the generate-time control panel
    //   2. saved per-unit mainQuestions for the next new concept's unit
    //   3. auto: pacing-based (Phase 7) or session-length-based (Phase 6)
    // The explicit target also lifts the MAIN_NEW_CONCEPTS_MAX cap so a bigger
    // Main block can actually introduce more new concepts (bounded by how many
    // new concepts are available on the track/path).
    const savedMain = firstNew
      ? await resolveUnitMainQuestions(
          ctx,
          firstNew.grade,
          firstNew.term,
          firstNew.unitId,
        )
      : null;
    const explicitMain =
      targets?.main !== undefined ? targets.main : savedMain;
    const autoMainConcepts =
      pacing !== null
        ? clamp(
            Math.round((pacing * budget.sessionMinutes) / 60),
            MAIN_NEW_CONCEPTS_MIN,
            MAIN_NEW_CONCEPTS_MAX,
          )
        : clamp(
            Math.round(budget.sessionMinutes / MINUTES_PER_NEW_CONCEPT),
            MAIN_NEW_CONCEPTS_MIN,
            MAIN_NEW_CONCEPTS_MAX,
          );
    const mainNewConcepts =
      explicitMain !== null && explicitMain !== undefined
        ? Math.max(
            0,
            Math.min(Math.round(explicitMain), Math.max(0, orderedNew.length)),
          )
        : autoMainConcepts;
    const mainBudget =
      explicitMain !== null && explicitMain !== undefined
        ? overrideBudget(explicitMain)
        : slotBudget(phaseInfo.ratios.main);
    const newConceptIds = new Set<string>(
      orderedNew
        .slice(0, mainNewConcepts)
        .map((c) => c.conceptId as unknown as string),
    );

    // ── 9a0. Main override (Lesson Builder, 2026-07-11) ─────────────────
    // The teacher's exact ticks claim their questions FIRST so no other
    // section can steal them via the shared seen-set. Order preserved (it
    // becomes the print order). Ids with no servable candidate pairing
    // (untagged / outside the widened scope) are dropped + flagged.
    let mainPicked: EnrichedCandidate[] = [];
    const mainOverridden =
      args.mainQuestionIdsOverride !== undefined &&
      args.mainQuestionIdsOverride.length > 0;
    if (mainOverridden) {
      const byId = new Map<string, EnrichedCandidate>();
      for (const c of enriched) {
        const k = c.question._id as unknown as string;
        if (!byId.has(k)) byId.set(k, c); // highest-scored concept pairing
      }
      let dropped = 0;
      for (const qid of args.mainQuestionIdsOverride!) {
        const k = qid as unknown as string;
        if (seen.has(k)) continue;
        const cand = byId.get(k);
        if (!cand) {
          dropped += 1;
          continue;
        }
        seen.add(k);
        mainPicked.push(cand);
      }
      if (dropped > 0) {
        underFillReasons.push("main-override-question-unservable");
      }
    }

    // ── 9a. Exam-prep slot ──────────────────────────────────────────────
    // Primary: past-paper + mastery ≥ floor. In exam-week mode, ignore
    // module-of-day; out of exam week, also ignore module (past-paper
    // candidates are exam-coverage, not module-specific drills).
    let examPrepPicked: EnrichedCandidate[] = [];
    if (examPrepBudget.qCap > 0) {
      const primary = enriched.filter(
        (c) =>
          c.question.source === "past-paper" &&
          c.concept.mastery >= EXAM_PREP_MASTERY_FLOOR,
      );
      const r = pickInterleaved(
        primary,
        examPrepBudget.timeMin,
        examPrepBudget.qCap,
        seen,
      );
      examPrepPicked = r.picked;
      // Fallback: harder textbook Qs on mastered concepts.
      if (examPrepPicked.length < examPrepBudget.qCap) {
        const fallback = enriched.filter(
          (c) =>
            c.question.source !== "past-paper" &&
            c.concept.mastery >= EXAM_PREP_MASTERY_FLOOR &&
            (c.question.difficulty ?? DEFAULT_QUESTION_DIFFICULTY) >= 4,
        );
        const r2 = pickInterleaved(
          fallback,
          examPrepBudget.timeMin - r.usedTimeMin,
          examPrepBudget.qCap - examPrepPicked.length,
          seen,
        );
        if (r2.picked.length > 0) {
          examPrepPicked.push(...(r2.picked));
          underFillReasons.push(
            UNDERFILL_REASONS.EXAM_PREP_FALLBACK_HARDER,
          );
        }
      }
    }

    // ── 9b. Main slot — next NEW concept(s) on the teaching path ─────────
    // Non-exam-week: the next not-yet-introduced concept(s) on the path. The
    // difficulty-fit factor already favours easy questions for brand-new
    // concepts (mastery ≈ 0 → skill ≈ 1). Exam-week keeps the existing
    // exam-term focus (module boundaries already collapsed).
    // Skipped entirely when the Lesson Builder override filled Main (9a0).
    if (mainOverridden) {
      // Main already holds the teacher's exact ticks.
    } else if (mainBudget.qCap > 0 && !phaseInfo.examWeekMode) {
      const primary = enriched.filter((c) =>
        newConceptIds.has(c.concept.conceptId as unknown as string),
      );
      const r = pickInterleaved(
        primary,
        mainBudget.timeMin,
        mainBudget.qCap,
        seen,
      );
      mainPicked = r.picked;
      // Deepen fallback: the student has been introduced to everything on the
      // path in scope → drill the least-mastered introduced concepts instead.
      if (mainPicked.length < mainBudget.qCap) {
        const deepen = enriched
          .filter((c) => c.concept.attemptCount > 0)
          .slice()
          .sort((a, b) => a.concept.mastery - b.concept.mastery);
        const r2 = pickInterleaved(
          deepen,
          mainBudget.timeMin - r.usedTimeMin,
          mainBudget.qCap - mainPicked.length,
          seen,
        );
        if (r2.picked.length > 0) {
          mainPicked.push(...r2.picked);
          underFillReasons.push(UNDERFILL_REASONS.MAIN_FALLBACK_DEEPEN);
        }
      }
    } else if (mainBudget.qCap > 0 && phaseInfo.examWeekMode) {
      // Exam-week main: any concept in the upcoming exam's term, ranked
      // by score (past-paper preferred via importance + proximity).
      const examTerm = phaseInfo.examTerm;
      const primary = enriched.filter(
        (c) => examTerm === null || c.concept.term === examTerm,
      );
      const r = pickInterleaved(
        primary,
        mainBudget.timeMin,
        mainBudget.qCap,
        seen,
      );
      mainPicked = r.picked;
    }

    // ── 9c. Warm-up slot = recent MISTAKES (easy-first) ─────────────────
    // Founder decision (2026-06-04): the confidence Warm-up is replaced by
    // error recovery. Lead with the student's recently-wrong concepts
    // (lastResponse === "again"), easiest question first — a re-test of a
    // corrected mistake is both a confidence win and the highest-value
    // retrieval. Fallback: the most-urgent introduced concepts (lowest R) so
    // the opener is never empty for an active student. (Full spaced-repetition
    // Revision is a separate section, filled in Phase 5.)
    let warmupPicked: EnrichedCandidate[] = [];
    if (warmupBudget.qCap > 0) {
      const mistakes = enriched
        .filter((c) => c.concept.lastResponse === "again")
        .slice()
        .sort(
          (a, b) =>
            (a.question.difficulty ?? DEFAULT_QUESTION_DIFFICULTY) -
            (b.question.difficulty ?? DEFAULT_QUESTION_DIFFICULTY),
        );
      const r = pickInterleaved(
        mistakes,
        warmupBudget.timeMin,
        warmupBudget.qCap,
        seen,
      );
      warmupPicked = r.picked;
      if (warmupPicked.length < warmupBudget.qCap) {
        const fallback = enriched
          .filter(
            (c) =>
              c.concept.attemptCount > 0 &&
              c.concept.lastResponse !== "again",
          )
          .slice()
          .sort((a, b) => a.concept.R - b.concept.R);
        const r2 = pickInterleaved(
          fallback,
          warmupBudget.timeMin - r.usedTimeMin,
          warmupBudget.qCap - warmupPicked.length,
          seen,
        );
        if (r2.picked.length > 0) {
          warmupPicked.push(...r2.picked);
          underFillReasons.push(UNDERFILL_REASONS.WARMUP_FALLBACK_REVISION);
        }
      }
    }

    // ── 9e. Revision slot — spaced repetition on DUE concepts ───────────
    // Introduced concepts that have decayed (R < REVISION_DUE_R) or are past
    // their natural review interval, EXCLUDING current mistakes (those are the
    // Warm-up's job). Ranked by the existing baseScore (urgency × importance
    // already inside it), interleaved across units. Fallback: lowest-R
    // introduced concepts even if not strictly due, so an active student's
    // Revision section is rarely empty.
    let revisionPicked: EnrichedCandidate[] = [];
    if (revisionBudget.qCap > 0) {
      const isDue = (c: EnrichedCandidate): boolean => {
        if (c.concept.attemptCount <= 0) return false; // not introduced
        if (c.concept.lastResponse === "again") return false; // mistake → warmup
        if (c.concept.R < REVISION_DUE_R) return true;
        return (
          overdueDays(
            c.concept.stability,
            c.concept.lastReviewAt,
            pool.asOfMs,
          ) > 0
        );
      };
      const primary = enriched.filter(isDue); // already score-sorted
      const r = pickInterleaved(
        primary,
        revisionBudget.timeMin,
        revisionBudget.qCap,
        seen,
      );
      revisionPicked = r.picked;
      if (revisionPicked.length < revisionBudget.qCap) {
        const fallback = enriched
          .filter(
            (c) =>
              c.concept.attemptCount > 0 &&
              c.concept.lastResponse !== "again",
          )
          .slice()
          .sort((a, b) => a.concept.R - b.concept.R);
        const r2 = pickInterleaved(
          fallback,
          revisionBudget.timeMin - r.usedTimeMin,
          revisionBudget.qCap - revisionPicked.length,
          seen,
        );
        revisionPicked.push(...r2.picked);
      }
    }

    // ── 9f. Leftover reallocation (Phase 6) ─────────────────────────────
    // If a section's pool was thin (e.g. no mistakes → empty Warm-up), its
    // share of the budget went unused. Rather than ship a short sheet, top up
    // with the most-urgent remaining introduced concepts (spaced-repetition
    // flavoured) and append them to the Revision section — the natural home for
    // extra retrieval practice. Respects `seen` (no repeats) and the overall
    // time + question budget, so this never overshoots the sheet length.
    //
    // Skipped when the generate-time control panel supplied explicit section
    // targets — the teacher is driving the section sizes by hand, so silently
    // padding Revision would override their choice.
    if (!targets) {
      const usedTime = [
        ...warmupPicked,
        ...mainPicked,
        ...examPrepPicked,
        ...revisionPicked,
      ].reduce(
        (s, c) => s + (c.question.expectedTimeMin ?? DEFAULT_QUESTION_TIME_MIN),
        0,
      );
      const pickedSoFar =
        warmupPicked.length +
        mainPicked.length +
        examPrepPicked.length +
        revisionPicked.length;
      const leftoverQ = budget.questionCap - pickedSoFar;
      const leftoverTime = budget.timeMin - usedTime;
      if (leftoverQ > 0 && leftoverTime > 0) {
        const topup = enriched
          .filter(
            (c) =>
              c.concept.attemptCount > 0 &&
              c.concept.lastResponse !== "again",
          )
          .slice()
          .sort((a, b) => a.concept.R - b.concept.R);
        const r = pickInterleaved(topup, leftoverTime, leftoverQ, seen);
        if (r.picked.length > 0) revisionPicked.push(...r.picked);
      }
    }

    // ── 10. Pool-exhaustion underfill flag ──────────────────────────────
    const totalPicked =
      warmupPicked.length +
      mainPicked.length +
      revisionPicked.length +
      examPrepPicked.length;
    if (totalPicked < budget.questionCap * 0.6) {
      underFillReasons.push(UNDERFILL_REASONS.POOL_EXHAUSTED);
    }

    // ── 10.5 D.4 prereq alerts (loud mode) ──────────────────────────────
    const allPickedQIds = [
      ...warmupPicked.map((c) => c.question._id),
      ...mainPicked.map((c) => c.question._id),
      ...revisionPicked.map((c) => c.question._id),
      ...examPrepPicked.map((c) => c.question._id),
    ];
    const alerts = await computePrereqAlerts(ctx, {
      studentId: args.studentId,
      pickedQuestionIds: allPickedQIds,
      asOfMs: pool.asOfMs,
    });

    // ── 11. Final return ────────────────────────────────────────────────
    return {
      status: "ok" as const,
      offDayReason: null,
      date: args.dateStr,
      todayModule,
      warmup: warmupPicked,
      main: mainPicked,
      revision: revisionPicked,
      examPrep: examPrepPicked,
      phase: {
        key: phaseInfo.phase,
        ratios: phaseInfo.ratios,
        examWeekMode: phaseInfo.examWeekMode,
        daysToExam: phaseInfo.daysToExam,
        examTerm: phaseInfo.examTerm,
        examDate: phaseInfo.examDate,
      },
      ratios: phaseInfo.ratios,
      budget,
      examWeek: phaseInfo.examWeekMode
        ? {
            daysToExam: phaseInfo.daysToExam,
            examTerm: phaseInfo.examTerm,
            examDate: phaseInfo.examDate,
          }
        : null,
      underFillReasons,
      alerts,
      plannerGaps: pool.plannerGaps,
      meta: {
        ...pool.meta,
        scoredCount: scored.length,
        pickedCount: totalPicked,
        // Per-student mode (departments redesign): ladder = "normal",
        // Gaussian-with-repeats fallback = "consolidation".
        learningMode: coverage !== null ? "normal" : "consolidation",
        weights: {
          importance: W_IMPORTANCE,
          urgency: W_URGENCY,
          fit: W_FIT,
          novelty: W_NOVELTY,
          proximity: W_PROXIMITY,
        },
        examSummary: Array.from(nextExamYmdByTerm.entries())
          .map(([term, ymd]) => ({
            term,
            examDate: ymd,
            daysToExam: daysToExamForTerm(term)!,
          }))
          .sort((a, b) => a.term - b.term),
      },
      generatedAt: pool.generatedAt,
    };
}

// ── planSheet: thin query wrapper around planSheetCore ───────────────────
export const planSheet = query({
  args: {
    studentId: v.id("students"),
    dateStr: v.string(),                                   // YYYY-MM-DD
    unitIds: v.array(v.string()),
    gradeByModule: v.record(v.string(), v.array(v.number())),
    slotId: v.optional(v.id("scheduleSlots")),
    debugSessionMinutes: v.optional(v.number()),
    debugSheetLength: v.optional(v.number()),
    sectionTargets: v.optional(
      v.object({
        warmup: v.optional(v.number()),
        main: v.optional(v.number()),
        revision: v.optional(v.number()),
        examPrep: v.optional(v.number()),
      }),
    ),
    mainQuestionIdsOverride: v.optional(v.array(v.id("questionBank"))),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    return planSheetCore(ctx, args);
  },
});

// ══════════════════════════════════════════════════════════════════════════
// PHASE D.6 — Sheet persistence + override journal
//
// saveSheetForStudent  — plans + writes one generatedSheets row (status="draft")
//                        Replaces an existing draft for the same (student, date);
//                        throws if a non-draft row already exists (printed/
//                        completed sheets are frozen — Lead must explicitly
//                        delete to regenerate).
//                        Off-day result returns { status: "off-day", written:
//                        false } and writes nothing.
// overrideSheet        — Lead manual swap/remove/add. Logs sheetOverrides row
//                        + mutates the generatedSheets row in the same txn.
// markPrinted          — status: "draft" → "printed", sets printedAt
// markCompleted        — status: "printed" → "completed", sets completedAt
//
// Bulk slot generation is handled CLIENT-side (see sheet-planner-tab) by
// looping students and calling saveSheetForStudent per row — keeps unitIds /
// gradeByModule resolution in src/lib/curriculum-data.ts where it lives.
// ══════════════════════════════════════════════════════════════════════════

// Resolve the calling teacher's id from auth. Returns null if no teacher row
// exists for the clerkUserId yet (legacy users — sheet still writes, audit
// field stays undefined).
//
// Defensive: use collect() not unique(). Historical bootstrap allowed the
// same clerkUserId to land twice in `teachers` (the `add` mutation didn't
// guard duplicates until the same patch that introduced this helper).
// `.unique()` throws on >1 hit, which crashed every saveSheetForStudent
// call for affected users. We pick the oldest row deterministically so
// audit-field FKs stay stable across calls — and `teachers.dedupeByClerkUser`
// is available for the Lead to clean the data.
async function resolveTeacherId(
  ctx: MutationCtx,
): Promise<Id<"teachers"> | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  const rows = await ctx.db
    .query("teachers")
    .withIndex("by_clerk_user", (q) =>
      q.eq("clerkUserId", identity.subject),
    )
    .collect();
  if (rows.length === 0) return null;
  // Pick the oldest by _creationTime so the chosen teacherId is stable
  // across calls even before dedupe runs.
  const oldest = rows.reduce((a, b) =>
    a._creationTime <= b._creationTime ? a : b,
  );
  return oldest._id;
}

// Build the per-question scoring snapshot for the audit row. Only picked
// Qs (8–12 rows), not the full scored pool (could be hundreds).
type ScoringSnapshotEntry = {
  questionId: Id<"questionBank">;
  conceptId: Id<"exercises">;
  slot: "warmup" | "main" | "revision" | "examPrep";
  baseScore: number;
  factors: {
    importance: number;
    urgency: number;
    fit: number;
    novelty: number;
    proximity: number;
    urgencyOverride: number | null;
    urgencyOverrideReason: string | null;
  };
};

function buildScoringSnapshot(
  warmup: EnrichedCandidate[],
  main: EnrichedCandidate[],
  revision: EnrichedCandidate[],
  examPrep: EnrichedCandidate[],
): ScoringSnapshotEntry[] {
  const out: ScoringSnapshotEntry[] = [];
  const push = (
    list: EnrichedCandidate[],
    slot: "warmup" | "main" | "revision" | "examPrep",
  ) => {
    for (const c of list) {
      out.push({
        questionId: c.question._id,
        conceptId: c.concept.conceptId,
        slot,
        baseScore: c.factors.baseScore,
        factors: {
          importance: c.factors.importance,
          urgency: c.factors.urgency,
          fit: c.factors.fit,
          novelty: c.factors.novelty,
          proximity: c.factors.proximity,
          urgencyOverride: c.factors.urgencyOverride,
          urgencyOverrideReason: c.factors.urgencyOverrideReason,
        },
      });
    }
  };
  push(warmup, "warmup");
  push(main, "main");
  push(revision, "revision");
  push(examPrep, "examPrep");
  return out;
}

export const saveSheetForStudent = mutation({
  args: {
    studentId: v.id("students"),
    dateStr: v.string(),
    unitIds: v.array(v.string()),
    gradeByModule: v.record(v.string(), v.array(v.number())),
    slotId: v.optional(v.id("scheduleSlots")),
    debugSessionMinutes: v.optional(v.number()),
    debugSheetLength: v.optional(v.number()),
    sectionTargets: v.optional(
      v.object({
        warmup: v.optional(v.number()),
        main: v.optional(v.number()),
        revision: v.optional(v.number()),
        examPrep: v.optional(v.number()),
      }),
    ),
    mainQuestionIdsOverride: v.optional(v.array(v.id("questionBank"))),
  },
  handler: async (ctx, args) => {
    try {
      return await saveSheetForStudentImpl(ctx, args);
    } catch (e) {
      // Surface the real error to the client. Plain `throw new Error()` is
      // hidden as "Server Error" by Convex; ConvexError makes the message
      // reachable via err.data on the client.
      const msg =
        e instanceof Error
          ? `${e.message}${e.stack ? "\n" + e.stack.split("\n").slice(0, 4).join("\n") : ""}`
          : String(e);
      throw new ConvexError(`saveSheetForStudent failed: ${msg}`);
    }
  },
});

async function saveSheetForStudentImpl(
  ctx: MutationCtx,
  args: {
    studentId: Id<"students">;
    dateStr: string;
    unitIds: string[];
    gradeByModule: Record<string, number[]>;
    slotId?: Id<"scheduleSlots">;
    debugSessionMinutes?: number;
    debugSheetLength?: number;
    sectionTargets?: {
      warmup?: number;
      main?: number;
      revision?: number;
      examPrep?: number;
    };
    mainQuestionIdsOverride?: Id<"questionBank">[];
  },
) {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Unauthenticated");

    const teacherId = await resolveTeacherId(ctx);

    // Plan the sheet inside the same transaction so the cooldown read sees
    // any row we're about to write/replace consistently.
    const result = await planSheetCore(ctx, {
      studentId: args.studentId,
      dateStr: args.dateStr,
      unitIds: args.unitIds,
      gradeByModule: args.gradeByModule,
      slotId: args.slotId,
      debugSessionMinutes: args.debugSessionMinutes,
      debugSheetLength: args.debugSheetLength,
      sectionTargets: args.sectionTargets,
      mainQuestionIdsOverride: args.mainQuestionIdsOverride,
    });
    if (!result) {
      return { status: "no-student", written: false } as const;
    }

    // Defensive: use collect() not unique(). If a prior D.1 backfill or
    // failed-retry attempt left two rows for the same (student, date),
    // `.unique()` would throw before we ever get to the regen guard. With
    // collect() we pick the most-recently-generated row as the "existing"
    // and let the patch path overwrite it.
    const existingRows = await ctx.db
      .query("generatedSheets")
      .withIndex("by_student_date", (q) =>
        q.eq("studentId", args.studentId).eq("date", args.dateStr),
      )
      .collect();
    const existing =
      existingRows.length === 0
        ? null
        : existingRows.reduce((a, b) =>
            a.generatedAt >= b.generatedAt ? a : b,
          );

    if (result.status === "off-day") {
      // If a stale draft exists from before off-days were configured for
      // this weekday, mark it skipped so the audit trail keeps the row but
      // the UI / planner stop treating it as live. Printed / completed
      // sheets are left untouched (the student already has the paper in
      // hand — flipping the status would mislead).
      let skippedExistingId: Id<"generatedSheets"> | null = null;
      if (
        existing &&
        existing.status !== "printed" &&
        existing.status !== "completed"
      ) {
        await ctx.db.patch(existing._id, { status: "skipped" });
        skippedExistingId = existing._id;
      }
      return {
        status: "off-day",
        written: false,
        offDayReason: result.offDayReason,
        skippedExistingId,
      } as const;
    }

    // Regen guard: replace if existing status is "draft" or undefined
    // (legacy D.1 row). Block on "printed"/"completed".

    const status = existing?.status;
    if (status === "printed" || status === "completed") {
      throw new ConvexError(
        `Sheet for ${args.dateStr} is ${status} — delete it explicitly before regenerating.`,
      );
    }

    const warmupQuestionIds = result.warmup.map((c) => c.question._id);
    const mainQuestionIds = result.main.map((c) => c.question._id);
    const revisionQuestionIds = result.revision.map((c) => c.question._id);
    const examPrepQuestionIds = result.examPrep.map((c) => c.question._id);
    const scoringSnapshot = buildScoringSnapshot(
      result.warmup,
      result.main,
      result.revision,
      result.examPrep,
    );

    // Build row WITHOUT explicit undefined values — Convex's db.insert
    // rejects optional Id fields set to undefined. Only spread the optional
    // fields when we actually have a value for them.
    const row: Record<string, unknown> = {
      studentId: args.studentId,
      date: args.dateStr,
      generatedAt: Date.now(),
      warmupQuestionIds,
      mainQuestionIds,
      revisionQuestionIds,
      examPrepQuestionIds,
      status: "draft",
      alerts: result.alerts,
      scoringSnapshot,
    };
    if (args.slotId) row.slotId = args.slotId;
    if (teacherId) row.generatedByTeacherId = teacherId;

    let sheetId: Id<"generatedSheets">;
    if (existing) {
      await ctx.db.patch(
        existing._id,
        row as Partial<Doc<"generatedSheets">>,
      );
      sheetId = existing._id;
    } else {
      sheetId = await ctx.db.insert(
        "generatedSheets",
        row as Omit<Doc<"generatedSheets">, "_id" | "_creationTime">,
      );
    }

    return {
      status: "ok",
      written: true,
      sheetId,
      replaced: existing !== null,
      questionCount:
        warmupQuestionIds.length +
        mainQuestionIds.length +
        revisionQuestionIds.length +
        examPrepQuestionIds.length,
      alertCount: result.alerts.length,
      underFillReasons: result.underFillReasons,
    } as const;
}

// ── overrideSheet — Lead manual swap / remove / add ─────────────────────
// Writes a sheetOverrides audit row + mutates the matching question id
// array on the sheet in the same transaction.
//   action="swap":   replace questionIdBefore → questionIdAfter in `slotName`
//   action="remove": drop questionIdBefore from `slotName`
//   action="add":    append questionIdAfter to `slotName`
// Slot name is the field stem ("warmup" → warmupQuestionIds, etc).
export const overrideSheet = mutation({
  args: {
    sheetId: v.id("generatedSheets"),
    action: v.string(), // "swap" | "remove" | "add"
    slotName: v.string(), // "warmup" | "main" | "examPrep"
    questionIdBefore: v.optional(v.id("questionBank")),
    questionIdAfter: v.optional(v.id("questionBank")),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");

    const teacherId = await resolveTeacherId(ctx);
    if (!teacherId) {
      throw new Error("Override requires a registered teacher row");
    }

    const sheet = await ctx.db.get(args.sheetId);
    if (!sheet) throw new Error("Sheet not found");
    if (sheet.status === "completed") {
      throw new Error("Cannot override a completed sheet");
    }

    if (
      args.slotName !== "warmup" &&
      args.slotName !== "main" &&
      args.slotName !== "revision" &&
      args.slotName !== "examPrep"
    ) {
      throw new Error(`Invalid slotName "${args.slotName}"`);
    }
    const fieldName =
      args.slotName === "warmup"
        ? "warmupQuestionIds"
        : args.slotName === "main"
          ? "mainQuestionIds"
          : args.slotName === "revision"
            ? "revisionQuestionIds"
            : "examPrepQuestionIds";

    // revisionQuestionIds is optional — old rows have no array. Guard the read.
    const list = [
      ...((sheet[fieldName] as Id<"questionBank">[] | undefined) ?? []),
    ];

    if (args.action === "swap") {
      if (!args.questionIdBefore || !args.questionIdAfter) {
        throw new Error("swap requires questionIdBefore + questionIdAfter");
      }
      const idx = list.findIndex((x) => x === args.questionIdBefore);
      if (idx < 0) {
        throw new Error("questionIdBefore not in slot");
      }
      list[idx] = args.questionIdAfter;
    } else if (args.action === "remove") {
      if (!args.questionIdBefore) {
        throw new Error("remove requires questionIdBefore");
      }
      const idx = list.findIndex((x) => x === args.questionIdBefore);
      if (idx < 0) {
        throw new Error("questionIdBefore not in slot");
      }
      list.splice(idx, 1);
    } else if (args.action === "add") {
      if (!args.questionIdAfter) {
        throw new Error("add requires questionIdAfter");
      }
      // Prevent cross-slot duplicates: check the OTHER three arrays too.
      const otherFields: Array<typeof fieldName> = (
        [
          "warmupQuestionIds",
          "mainQuestionIds",
          "revisionQuestionIds",
          "examPrepQuestionIds",
        ] as const
      ).filter((f) => f !== fieldName) as Array<typeof fieldName>;
      for (const f of otherFields) {
        const otherList = (sheet[f] as Id<"questionBank">[] | undefined) ?? [];
        if (otherList.includes(args.questionIdAfter)) {
          throw new Error(
            `Question already on this sheet in ${f.replace("QuestionIds", "")}`,
          );
        }
      }
      if (list.includes(args.questionIdAfter)) {
        throw new Error("Question already in this slot");
      }
      list.push(args.questionIdAfter);
    } else {
      throw new Error(`Invalid action "${args.action}"`);
    }

    await ctx.db.patch(args.sheetId, {
      [fieldName]: list,
      // Touch generatedAt so downstream cache-busts invalidate. Not
      // strictly necessary but cheap and avoids stale renders.
      generatedAt: Date.now(),
    } as Partial<Doc<"generatedSheets">>);

    const overrideId = await ctx.db.insert("sheetOverrides", {
      sheetId: args.sheetId,
      action: args.action,
      slotName: args.slotName,
      questionIdBefore: args.questionIdBefore,
      questionIdAfter: args.questionIdAfter,
      byTeacherId: teacherId,
      reason: args.reason,
      at: Date.now(),
    });

    return { overrideId, sheetId: args.sheetId };
  },
});

export const markPrinted = mutation({
  args: { sheetId: v.id("generatedSheets") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    const sheet = await ctx.db.get(args.sheetId);
    if (!sheet) throw new Error("Sheet not found");
    if (sheet.status === "completed") {
      throw new Error("Cannot re-print a completed sheet");
    }
    await ctx.db.patch(args.sheetId, {
      status: "printed",
      printedAt: Date.now(),
    });
    return { sheetId: args.sheetId };
  },
});

export const markCompleted = mutation({
  args: { sheetId: v.id("generatedSheets") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    const sheet = await ctx.db.get(args.sheetId);
    if (!sheet) throw new Error("Sheet not found");
    await ctx.db.patch(args.sheetId, {
      status: "completed",
      completedAt: Date.now(),
    });
    return { sheetId: args.sheetId };
  },
});

// ── Read helpers for the verification UI ─────────────────────────────────
// Surfaces the saved sheet (if any) alongside the live planner preview, so
// the Lead can compare draft vs preview before re-saving.
export const getSavedSheet = query({
  args: {
    studentId: v.id("students"),
    dateStr: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    // Defensive: collect() not unique() — historical backfills/failed retries
    // can leave two rows for the same (student, date). unique() would THROW
    // and take the whole read path down; pick the latest instead, matching
    // the defense saveSheetForStudentImpl already has (safety fix 2026-07-10).
    const rows = await ctx.db
      .query("generatedSheets")
      .withIndex("by_student_date", (q) =>
        q.eq("studentId", args.studentId).eq("date", args.dateStr),
      )
      .collect();
    if (rows.length === 0) return null;
    return rows.reduce((a, b) => (a.generatedAt >= b.generatedAt ? a : b));
  },
});

// List students enrolled in a slot — used by the bulk "Generate for whole
// class" action in the verification UI. Returns enriched rows so the UI can
// show name + scope-derivation knobs without a follow-up batch read.
export const listSlotStudents = query({
  args: { slotId: v.id("scheduleSlots") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const slot = await ctx.db.get(args.slotId);
    if (!slot) return null;
    const ids = await baseStudentIdsForSlot(ctx, slot);
    const students = await Promise.all(ids.map((id) => ctx.db.get(id)));
    return students.filter((s): s is Doc<"students"> => s !== null);
  },
});

export type { Budget, PhaseInfo, ScoredCandidate, EnrichedCandidate };
