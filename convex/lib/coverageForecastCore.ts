// Coverage forecast — pure math (2026-07-14).
//
// Answers the founder's runway question per track unit: "will this student
// finish the unit's book questions before the exam, at the current pace?"
//
// Model (deliberately simple + honest):
//   • pace        = sheets/day × questions/sheet, measured from the
//                   student's recent sheets (a real, observed number — not
//                   a hope).
//   • capacity(U) = pace × days until U's term exam — questions the student
//                   can still do before that exam.
//   • demand      = unseen questions remaining, summed over every unit
//                   competing for the same window (exam on or before U's).
//   • share(U)    = capacity × remaining(U) / demand — the engine spreads
//                   revision by due-ness, so proportional allocation is the
//                   honest approximation.
//   • projected%  = (seen + min(remaining, share)) / total.
//
// Verdicts: done / on-track (≥95% projected) / at-risk (≥75%) /
// wont-finish / no-exam / no-questions.
//
// Pure and synchronous: unit-tested without a database.

export type ForecastUnitInput = {
  unitId: string;
  term: number | null;
  totalQuestions: number;
  seenQuestions: number;
};

export type ForecastPaceInput = {
  windowDays: number; // observation window length
  recentSheetCount: number; // sheets generated inside the window
  recentQuestionCount: number; // questions across those sheets
};

export type UnitVerdict =
  | "done"
  | "on-track"
  | "at-risk"
  | "wont-finish"
  | "no-exam"
  | "no-questions";

export type ForecastUnit = {
  unitId: string;
  term: number | null;
  totalQuestions: number;
  seenQuestions: number;
  remaining: number;
  coveredPct: number; // 0..1 of the pool already seen
  projectedPct: number | null; // 0..1 at exam day; null when no exam/pace
  daysToExam: number | null;
  verdict: UnitVerdict;
};

export type ForecastSummary = {
  sheetsPerWeek: number | null;
  questionsPerSheet: number | null;
  questionsPerDay: number | null;
  totalRemaining: number;
  // At the current pace, days to finish EVERYTHING remaining (all units).
  daysToFinishAll: number | null;
  hasPace: boolean;
};

export const ON_TRACK_PCT = 0.95;
export const AT_RISK_PCT = 0.75;

export function forecastCoverage(args: {
  units: ForecastUnitInput[];
  pace: ForecastPaceInput;
  daysToExamByTerm: Record<string, number | null>;
}): { units: ForecastUnit[]; summary: ForecastSummary } {
  const { pace } = args;
  const hasPace = pace.recentSheetCount > 0 && pace.windowDays > 0;
  const sheetsPerDay = hasPace ? pace.recentSheetCount / pace.windowDays : 0;
  const questionsPerSheet = hasPace
    ? pace.recentQuestionCount / pace.recentSheetCount
    : 0;
  const questionsPerDay = sheetsPerDay * questionsPerSheet;

  const withDays = args.units.map((u) => {
    const daysToExam =
      u.term !== null ? args.daysToExamByTerm[String(u.term)] ?? null : null;
    return { ...u, remaining: Math.max(0, u.totalQuestions - u.seenQuestions), daysToExam };
  });

  const totalRemaining = withDays.reduce((s, u) => s + u.remaining, 0);

  const units: ForecastUnit[] = withDays.map((u) => {
    const coveredPct =
      u.totalQuestions > 0 ? u.seenQuestions / u.totalQuestions : 0;

    let verdict: UnitVerdict;
    let projectedPct: number | null = null;

    if (u.totalQuestions === 0) {
      verdict = "no-questions";
    } else if (u.remaining === 0) {
      verdict = "done";
      projectedPct = 1;
    } else if (u.daysToExam === null) {
      verdict = "no-exam";
    } else if (!hasPace) {
      verdict = "wont-finish"; // zero observed pace can finish nothing
      projectedPct = coveredPct;
    } else {
      // Units competing for the capacity before THIS unit's exam: everything
      // unfinished whose exam is on or before it (or has no exam — it still
      // eats revision slots, so count it; conservative on purpose).
      const demand = withDays.reduce(
        (s, o) =>
          s +
          (o.remaining > 0 &&
          (o.daysToExam === null || o.daysToExam <= u.daysToExam!)
            ? o.remaining
            : 0),
        0,
      );
      const capacity = questionsPerDay * Math.max(0, u.daysToExam);
      const share = demand > 0 ? capacity * (u.remaining / demand) : 0;
      const projectedSeen = u.seenQuestions + Math.min(u.remaining, share);
      projectedPct = Math.min(1, projectedSeen / u.totalQuestions);
      verdict =
        projectedPct >= ON_TRACK_PCT
          ? "on-track"
          : projectedPct >= AT_RISK_PCT
            ? "at-risk"
            : "wont-finish";
    }

    return {
      unitId: u.unitId,
      term: u.term,
      totalQuestions: u.totalQuestions,
      seenQuestions: u.seenQuestions,
      remaining: u.remaining,
      coveredPct,
      projectedPct,
      daysToExam: u.daysToExam,
      verdict,
    };
  });

  return {
    units,
    summary: {
      sheetsPerWeek: hasPace ? sheetsPerDay * 7 : null,
      questionsPerSheet: hasPace ? questionsPerSheet : null,
      questionsPerDay: hasPace ? questionsPerDay : null,
      totalRemaining,
      daysToFinishAll:
        hasPace && questionsPerDay > 0
          ? Math.ceil(totalRemaining / questionsPerDay)
          : null,
      hasPace,
    },
  };
}
