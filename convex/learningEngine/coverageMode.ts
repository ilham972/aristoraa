// Coverage mode — pure within-concept fit overrides (2026-07-14).
//
// Founder decision (see decisions.md "coverage-first mode"): with a short
// runway to the exam, every regular student should work through the WHOLE
// book, easy→hard, without repeating a question — because pulling a fresh
// question on a due concept IS the repetition, and each book question is a
// distinct exam pattern worth seeing once. The memory model still decides
// WHEN a concept appears (spaced repetition untouched); this module only
// changes WHICH question represents the concept:
//
//   • The next UNSEEN question in the teacher's easy→hard ladder
//     (difficulty, then pickerOrder — the Lesson Builder drag order) gets
//     fit 1.0; each further unseen rung decays by COVERAGE_LADDER_DECAY.
//   • An unseen question more than COVERAGE_MAX_STEP_UP above the student's
//     current skill is not ready — no override (its Gaussian fit is already
//     tiny), so weak students defer the hardest tail automatically.
//   • Seen questions keep their Gaussian fit × COVERAGE_SEEN_FIT_DAMP, so
//     repeats only win once every ready rung is exhausted — the engine then
//     degrades gracefully to the normal behaviour.
//
// Pure and synchronous so it unit-tests without a database.

import {
  COVERAGE_LADDER_DECAY,
  COVERAGE_LADDER_FLOOR,
  COVERAGE_MAX_STEP_UP,
  COVERAGE_SEEN_FIT_DAMP,
  DEFAULT_QUESTION_DIFFICULTY,
  FIT_SIGMA,
} from "./config";

export type CoverageQuestion = {
  id: string;
  difficulty: number | null;
  pickerOrder: number | null;
  seen: boolean;
};

export type CoverageFitOverride = {
  fit: number;
  reason: string;
};

function gaussianFit(qDifficulty: number, skill: number): number {
  const delta = qDifficulty - skill;
  const g = Math.exp(-(delta * delta) / (2 * FIT_SIGMA * FIT_SIGMA));
  return Math.min(1, Math.max(0, g));
}

// Fit overrides for ONE concept's candidate questions. `studentSkill` is the
// planner's mastery→skill mapping (1 + 4 * mastery, range 1..5). Returns a
// map keyed by question id; questions absent from the map keep their normal
// Gaussian fit (currently: unseen questions that are too hard for now).
export function coverageLadderFits(args: {
  questions: CoverageQuestion[];
  studentSkill: number;
}): Map<string, CoverageFitOverride> {
  const out = new Map<string, CoverageFitOverride>();

  // The teacher's ladder: difficulty, then drag order, then id (stable).
  const ladder = [...args.questions].sort((a, b) => {
    const d =
      (a.difficulty ?? DEFAULT_QUESTION_DIFFICULTY) -
      (b.difficulty ?? DEFAULT_QUESTION_DIFFICULTY);
    if (d !== 0) return d;
    const p =
      (a.pickerOrder ?? Number.MAX_SAFE_INTEGER) -
      (b.pickerOrder ?? Number.MAX_SAFE_INTEGER);
    if (p !== 0) return p;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  let rung = 0;
  for (const q of ladder) {
    const qDifficulty = q.difficulty ?? DEFAULT_QUESTION_DIFFICULTY;
    if (q.seen) {
      out.set(q.id, {
        fit: gaussianFit(qDifficulty, args.studentSkill) * COVERAGE_SEEN_FIT_DAMP,
        reason: "coverage: already seen — damped",
      });
      continue;
    }
    if (qDifficulty - args.studentSkill > COVERAGE_MAX_STEP_UP) {
      // Not ready yet — leave the Gaussian fit alone (it is already low);
      // the rung stays reserved for when mastery grows.
      continue;
    }
    out.set(q.id, {
      fit: Math.max(
        COVERAGE_LADDER_FLOOR,
        Math.pow(COVERAGE_LADDER_DECAY, rung),
      ),
      reason: `coverage: rung ${rung + 1} of the unseen ladder`,
    });
    rung += 1;
  }
  return out;
}
