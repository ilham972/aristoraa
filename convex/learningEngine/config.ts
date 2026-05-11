// Learning-engine tunable constants. Phase G will migrate these to a
// `learningConfig` table; for now they live in code as the single source of truth.

// Minimum number of questions a concept must have before the sheet generator
// is allowed to draw from it. Below this, the coverage dashboard renders the
// concept as gated and Phase D will refuse to generate sheets touching it.
export const MIN_QUESTIONS_PER_CONCEPT = 5;
