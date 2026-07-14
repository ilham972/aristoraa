// Consolidation assessment — pure math (2026-07-14, departments redesign).
//
// Decides what the daily engine-alert scan should SUGGEST for one student's
// learning mode. The system never flips the switch itself — it posts an
// in-app notification and a human decides (same pattern as exam mode).
//
//   verdict "suggest-consolidation" — normal student failing too much: their
//     individual sections should fall back to difficulty-matched repeats.
//   verdict "suggest-normal"        — consolidation student has recovered:
//     back to the coverage ladder (no repeats).
//   verdict "ok"                    — nothing to say (healthy, or too few
//     attempts in the window to judge).
//
// Failure rate is DIFFICULTY-WEIGHTED (same weights the memory model uses):
// a student who only fails the hardest questions is stretched, not weak; a
// student failing easy questions is drowning. "skipped" attempts carry no
// signal either way and are excluded.
//
// Pure and synchronous: unit-tested without a database.

export type ConsolidationAttempt = {
  response: string; // "good" | "again" | "skipped"
  weight: number; // attemptLog.weight = 0.6 + 0.2 * difficulty
};

export type ConsolidationVerdict =
  | "suggest-consolidation"
  | "suggest-normal"
  | "ok";

export type ConsolidationAssessment = {
  verdict: ConsolidationVerdict;
  failRate: number | null; // null when below the attempt floor
  attemptCount: number; // non-skipped attempts considered
};

export function assessConsolidation(args: {
  attempts: ConsolidationAttempt[];
  currentMode: "normal" | "consolidation";
  enterFailRate: number;
  exitFailRate: number;
  minAttempts: number;
}): ConsolidationAssessment {
  let rightW = 0;
  let wrongW = 0;
  let count = 0;
  for (const a of args.attempts) {
    if (a.response === "again") {
      wrongW += a.weight;
      count += 1;
    } else if (a.response === "good") {
      rightW += a.weight;
      count += 1;
    }
    // "skipped" (and anything unknown) carries no signal.
  }

  if (count < args.minAttempts) {
    return { verdict: "ok", failRate: null, attemptCount: count };
  }

  const total = rightW + wrongW;
  const failRate = total > 0 ? wrongW / total : 0;

  if (args.currentMode === "normal" && failRate >= args.enterFailRate) {
    return { verdict: "suggest-consolidation", failRate, attemptCount: count };
  }
  if (args.currentMode === "consolidation" && failRate <= args.exitFailRate) {
    return { verdict: "suggest-normal", failRate, attemptCount: count };
  }
  return { verdict: "ok", failRate, attemptCount: count };
}
