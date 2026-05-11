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
