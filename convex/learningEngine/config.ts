// Learning-engine tunable constants. Phase G will migrate these to a
// `learningConfig` table; for now they live in code as the single source of truth.

// Minimum number of questions a concept must have before the sheet generator
// is allowed to draw from it. Below this, the coverage dashboard renders the
// concept as gated and Phase D will refuse to generate sheets touching it.
export const MIN_QUESTIONS_PER_CONCEPT = 5;

// ─── Phase A: FSRS-lite memory model ──────────────────────────────────────
// R(t) = (1 + t / (FACTOR * S)) ^ -1   power-law forgetting curve.
// t = days since lastReviewAt; S = stability in days at R = 0.9.
export const FACTOR = 9;

// Initial values for a (student, concept) pair on first attempt.
export const DEFAULT_INIT_STABILITY = 1.0;   // days
export const DEFAULT_INIT_DIFFICULTY = 5.0;  // on 1..10

// Mastery threshold used by sheet planner + parent reports (Phase A.3 onward).
export const MASTERY_THRESHOLD = 0.75;

// Accuracy-factor sigmoid sharpness:
// acc_factor = sigmoid(ACC_ALPHA * (correct_w - wrong_w))
export const ACC_ALPHA = 1.2;

// Stability multipliers on review (FSRS-lite, success/failure only — graded
// "hard" response is deferred to Phase G when there's tuning data).
export const STAB_GROWTH_GOOD = 1.5;
export const STAB_GROWTH_HARD = 1.1;
export const STAB_DECAY_AGAIN = 0.4;

// Difficulty deltas on review. Concept gets easier with each success, harder
// after a wrong answer.
export const DIFF_DELTA_GOOD = -0.15;
export const DIFF_DELTA_AGAIN = 0.30;

// Clamp ranges for FSRS-lite state.
export const DIFFICULTY_MIN = 1.0;
export const DIFFICULTY_MAX = 10.0;
export const STABILITY_MIN = 0.1;
export const STABILITY_MAX = 365.0;

// ─── Phase B: concept importance (exam blueprint) ─────────────────────────
// Every concept in a (grade, term) scope gets at least this much importance
// after normalization so genuinely-absent concepts still get a sliver of
// weight when the planner ranks candidates. Re-normalization after the floor
// is applied keeps Σ importance = 1.0 within (grade, term).
export const MIN_IMPORTANCE_FLOOR = 0.005;

// ─── Phase D: sheet planner ────────────────────────────────────────────────
// Novelty cooldown: a question used on any sheet in the last
// NOVELTY_COOLDOWN_DAYS calendar days is filtered out of today's candidate
// pool (D.1). Keeps repeats from feeling stale; the same fresh-instance Q
// becomes eligible again once the window passes. Tuned in Phase G.
export const NOVELTY_COOLDOWN_DAYS = 7;

// D.2 — per-question scoring weights. Sum is intentionally 1.0 so baseScore
// lands in [0, 1] and Phase G can compare runs across days without
// renormalizing. Each factor below is also clamped to [0, 1] before the
// weighted sum, so no single factor can dominate via overflow.
//   importance — concept's exam-blueprint weight (Phase B)
//   urgency    — 1 - R, with a flat overdue boost
//   fit        — difficulty / mastery match (Gaussian peak)
//   novelty    — recently-used questions are filtered out in D.1, so this is
//                1.0 inside the scorer; the term is kept in the formula so
//                Phase G can experiment with soft-novelty (e.g. "small
//                penalty for q used 30+ days ago").
//   proximity  — how close is the next exam at (student.schoolGrade,
//                concept.term); zero past the horizon
export const W_IMPORTANCE = 0.3;
export const W_URGENCY = 0.25;
export const W_FIT = 0.2;
export const W_NOVELTY = 0.15;
export const W_PROXIMITY = 0.1;

// Gaussian width for the difficulty-fit term. Student skill on a concept is
// mapped from mastery 0..1 → 1..5 (the question difficulty scale). With
// sigma = 1.5 the fit curve is gentle enough that a difficulty-3 question
// still scores ~0.72 against a skill-5 student, so D.3 won't over-pack a
// strong student with only the hardest questions.
export const FIT_SIGMA = 1.5;

// Flat additive urgency boost when a concept is past its natural review
// interval. Lifted from algorithm_plan.md Phase D.2.
export const URGENCY_OVERDUE_BOOST = 0.2;

// Proximity falls linearly from 1.0 at exam-day to 0.0 at the horizon.
// Past the horizon, proximity is forced to 0 so the term contributes nothing
// for exams that are months away.
export const PROXIMITY_HORIZON_DAYS = 90;

// Default question difficulty when a row's `difficulty` field is null. The
// midpoint of the 1..5 scale; matches the algorithm_plan.md fallback.
export const DEFAULT_QUESTION_DIFFICULTY = 3;

// ─── Phase D.3: slot allocator / sheet sizing / phase-of-term reweighting ──

// Default off-day if a student has no `offDays` field set. Sri Lankan tuition
// week is M1 Mon … M6 Sat, Sun off — but the user has confirmed off-days
// vary per student (homeschool / weekend-batch / different centres), so this
// is only the fallback. Lowercase weekday name to match the schema field.
export const DEFAULT_OFF_DAYS = ["sunday"] as const;

// Daily sheet target sizes, in QUESTIONS. Used as caps when packing by time
// budget — weak student's sheet won't exceed SHEET_LEN_WEAK questions even
// if the time budget would allow more. Manual `sheetLengthOverride` on the
// student row wins over these.
export const SHEET_LEN_WEAK = 5;
export const SHEET_LEN_DEFAULT = 8;
export const SHEET_LEN_STRONG = 12;

// Daily sheet target TIME budget, in minutes. The slot allocator picks
// questions until cumulative `expectedTimeMin` hits the budget; this is the
// primary sizing axis because a single hard 10-min question crowds out two
// 3-min ones at the same question count. Manual `sessionMinutesOverride`
// wins; otherwise the auto-tuner walks the budget up or down based on the
// student's recent completion history.
export const SESSION_MIN_WEAK = 25;
export const SESSION_MIN_DEFAULT = 45;
export const SESSION_MIN_STRONG = 70;

// Fallback expected time per question when `questionBank.expectedTimeMin`
// is null. Tuned to the midpoint of a typical math-practice question:
// quick algebra ≈ 2 min, word problem ≈ 6 min, mid-range ≈ 4 min.
export const DEFAULT_QUESTION_TIME_MIN = 4;

// Auto-tuning window for the budget. We look at sheets generated in the last
// COMPLETION_HISTORY_WINDOW_DAYS days, measure their completion rate, and
// adjust the next sheet's budget up or down accordingly. Two weeks gives 6
// classes per typical 3-modules-per-week student — enough signal to react
// without over-fitting to one bad day.
export const COMPLETION_HISTORY_WINDOW_DAYS = 14;

// "Student finishing comfortably" — if average completion across recent
// sheets is ≥ this AND total attempted on every recent sheet ≥ MIN_SAMPLE,
// nudge budget up next time.
export const COMPLETION_RATE_GROW = 0.95;
// "Student struggling" — if avg completion ≤ this, shrink budget next time.
export const COMPLETION_RATE_SHRINK = 0.6;
// Minimum number of completed-or-partially-completed sheets within the
// window before the auto-tuner is allowed to override the defaults. Below
// this, default to SESSION_MIN_DEFAULT / SHEET_LEN_DEFAULT — premature
// tuning on a single sheet would be too jumpy.
export const MIN_COMPLETION_SAMPLE = 3;

// Multiplicative budget adjustments. Applied per cycle (each planSheet call
// at most adjusts once, not compounding within one call).
export const BUDGET_GROW_FACTOR = 1.1;
export const BUDGET_SHRINK_FACTOR = 0.8;

// Hard floor/ceiling clamps on the auto-tuned budget so the loop can't run
// away to absurd values.
export const SESSION_MIN_FLOOR = 15;
export const SESSION_MIN_CEILING = 120;
export const SHEET_LEN_FLOOR = 3;
export const SHEET_LEN_CEILING = 20;

// ── Phase-of-term reweighting (Section 5 of learning_engine_plan.md) ──
// Days-to-exam thresholds that select which row of the phase table applies.
//   daysToExam ≤ EXAM_WEEK_DAYS  → exam-week override (fully mixed, see
//                                   planSheet algorithm)
//   daysToExam ≤ LATE_TERM_DAYS  → "late" half of that term
//   else                          → "early" half
// When no exam is scheduled at all, the planner uses DEFAULT_RATIOS.
export const EXAM_WEEK_DAYS = 14;
export const LATE_TERM_DAYS = 35;

// Phase ratios: { warmup, main, revision, examPrep }. Σ = 1.0 per row.
// Sheet-redesign 4-section model (founder, 2026-06-04):
//   warmup   → recent MISTAKES (small, easy-first opener)
//   main     → new acquisition (next concept(s) on the teaching path)
//   revision → spaced-repetition body (due / forgetting concepts) — grows
//              through the year as there's more to retain
//   examPrep → past-paper mixed
// (Phase 6 makes the time budget session-length-aware; these proportions are
// the per-phase split and are tunable.)
export const PHASE_RATIOS = {
  earlyT1: { warmup: 0.1, main: 0.7, revision: 0.1, examPrep: 0.1 },
  lateT1: { warmup: 0.15, main: 0.45, revision: 0.25, examPrep: 0.15 },
  earlyT2: { warmup: 0.15, main: 0.45, revision: 0.3, examPrep: 0.1 },
  lateT2: { warmup: 0.15, main: 0.35, revision: 0.3, examPrep: 0.2 },
  earlyT3: { warmup: 0.1, main: 0.4, revision: 0.4, examPrep: 0.1 },
  lateT3: { warmup: 0.1, main: 0.2, revision: 0.45, examPrep: 0.25 },
} as const;

// Fallback ratios when no upcoming exam is scheduled (or the student has no
// term context).
export const DEFAULT_RATIOS = {
  warmup: 0.15,
  main: 0.4,
  revision: 0.3,
  examPrep: 0.15,
} as const;

// In exam week (≤ EXAM_WEEK_DAYS to upcoming exam) the slot allocator
// abandons module-of-day boundaries: everything pulled is exam-relevant,
// past-paper-source preferred, ranked by score. The "main" slot becomes
// "rest of the exam-relevant pool", warm-up shrinks, exam-prep grows.
export const EXAM_WEEK_RATIOS = {
  warmup: 0.1,
  main: 0.15,
  revision: 0.4,
  examPrep: 0.35,
} as const;

// Mastery threshold for inclusion in the exam-prep slot. Concept must be at
// least somewhat learned before we throw a past-paper question at the
// student — past-paper questions are typically harder than textbook ones.
export const EXAM_PREP_MASTERY_FLOOR = 0.5;

// ─── Sheet redesign (Phase 4): path-driven Main block ──────────────────────
// How many NOT-yet-introduced concepts the Main block teaches per sheet. The
// planner walks the teacher-curated teaching path and picks the next N concepts
// the student hasn't started (prereqs met). Phase 6 makes this session-length-
// aware (longer class → more new concepts); for now it's a flat default.
export const MAIN_NEW_CONCEPTS = 2;

// ─── Sheet redesign (Phase 5): Revision section ────────────────────────────
// A concept is "due" for revision when its retention R has decayed below this
// threshold (or it is past its natural review interval). 0.7 ≈ re-surface
// before the student drops below 70% recall — early enough to relearn cheaply,
// late enough not to waste a slot on something still fresh.
export const REVISION_DUE_R = 0.7;

// ─── Phase D.5: exam-date backstop ────────────────────────────────────────
// "Force-review window" before an upcoming exam. A concept whose natural
// FSRS-lite review interval (lastReviewAt + naturalInterval) would land
// AFTER (examDate − EXAM_BACKSTOP_DAYS) is considered "would slip past the
// exam" and gets its urgency factor forced to 1.0 in the scorer (replaces
// the standard `1 - R + overdueBoost` urgency rather than stacking on top
// — see `scoreCandidate.urgencyOverride`).
//
// Tuning rationale: 21 days = three weeks. Long enough that the planner can
// schedule each at-risk concept ≥ once before the deadline (typical 3-class-
// per-week student gets ~9 sessions in three weeks). Shorter (14d) collides
// with the exam-week override; longer (28d+) starts disrupting normal
// module-of-day learning too early.
export const EXAM_BACKSTOP_DAYS = 21;

// Natural-review interval as a function of FSRS-lite stability. R = 0.9 at
// t = stability days (by FACTOR=9 calibration); we approximate "would the
// student fall below mastery threshold before then?" by using stability
// directly as the natural-interval estimate. Phase G can replace with an
// actual R(t) inversion once tuning data lands.
//   naturalIntervalDays(stability) = max(NATURAL_INTERVAL_FLOOR, stability)
// Floor exists so a brand-new (stability ≈ 1d) concept doesn't trigger the
// backstop on day-zero just because 1 day < 21.
export const NATURAL_INTERVAL_FLOOR_DAYS = 3;

// Underfill: when a slot can't be filled from its primary candidate set, the
// allocator falls back through these stages. Reasons surface in planSheet's
// `underFillReasons` for the Lead-dashboard "why this sheet is short" tip.
export const UNDERFILL_REASONS = {
  WARMUP_FALLBACK_SAME_MODULE: "warmup-fallback-same-module-review",
  MAIN_FALLBACK_PAST_PAPER: "main-fallback-past-paper",
  EXAM_PREP_FALLBACK_HARDER: "exam-prep-fallback-harder-textbook",
  POOL_EXHAUSTED: "pool-exhausted",
  // ─── Sheet redesign (Phase 4 / 5) ───────────────────────────────────────
  // Main block had no not-yet-introduced concepts left on the path, so it
  // deepened on the least-mastered introduced concepts instead.
  MAIN_FALLBACK_DEEPEN: "main-fallback-deepen",
  // Warm-up (mistakes) found no recently-wrong concepts, so it borrowed the
  // most-urgent introduced (lowest-R) concepts as a gentle opener.
  WARMUP_FALLBACK_REVISION: "warmup-fallback-urgent-revision",
} as const;
