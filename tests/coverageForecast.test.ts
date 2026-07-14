import { describe, it, expect } from 'vitest';
import {
  forecastCoverage,
  type ForecastUnitInput,
} from '../convex/lib/coverageForecastCore';

const unit = (
  unitId: string,
  term: number | null,
  total: number,
  seen: number,
): ForecastUnitInput => ({
  unitId,
  term,
  totalQuestions: total,
  seenQuestions: seen,
});

// 14 sheets in 14 days, 10 questions each → 10 q/day.
const STEADY_PACE = {
  windowDays: 14,
  recentSheetCount: 14,
  recentQuestionCount: 140,
};

describe('forecastCoverage', () => {
  it('finished unit → done, projected 100%', () => {
    const r = forecastCoverage({
      units: [unit('u1', 1, 20, 20)],
      pace: STEADY_PACE,
      daysToExamByTerm: { '1': 30 },
    });
    expect(r.units[0].verdict).toBe('done');
    expect(r.units[0].projectedPct).toBe(1);
  });

  it('plenty of runway → on-track', () => {
    // 40 remaining, 10 q/day, 30 days → capacity 300 ≫ demand.
    const r = forecastCoverage({
      units: [unit('u1', 1, 50, 10)],
      pace: STEADY_PACE,
      daysToExamByTerm: { '1': 30 },
    });
    expect(r.units[0].verdict).toBe('on-track');
    expect(r.units[0].projectedPct).toBe(1);
  });

  it('short runway → wont-finish with an honest projection', () => {
    // 90 remaining, 10 q/day, 3 days → only ~30 more → 40/100 projected.
    const r = forecastCoverage({
      units: [unit('u1', 1, 100, 10)],
      pace: STEADY_PACE,
      daysToExamByTerm: { '1': 3 },
    });
    expect(r.units[0].verdict).toBe('wont-finish');
    expect(r.units[0].projectedPct).toBeCloseTo(0.4);
  });

  it('units share the capacity window proportionally to remaining', () => {
    // Two term-1 units, 10 days × 10 q/day = 100 capacity, 200 remaining →
    // each projects half of its remaining done.
    const r = forecastCoverage({
      units: [unit('a', 1, 100, 0), unit('b', 1, 100, 0)],
      pace: STEADY_PACE,
      daysToExamByTerm: { '1': 10 },
    });
    expect(r.units[0].projectedPct).toBeCloseTo(0.5);
    expect(r.units[1].projectedPct).toBeCloseTo(0.5);
  });

  it('a later exam gets more capacity than an earlier one', () => {
    const r = forecastCoverage({
      units: [unit('early', 1, 100, 0), unit('late', 2, 100, 0)],
      pace: STEADY_PACE,
      daysToExamByTerm: { '1': 5, '2': 60 },
    });
    expect(r.units[1].projectedPct!).toBeGreaterThan(r.units[0].projectedPct!);
    expect(r.units[1].verdict).toBe('on-track');
  });

  it('no exam date → no-exam; empty pool → no-questions', () => {
    const r = forecastCoverage({
      units: [unit('u1', 3, 10, 2), unit('u2', 1, 0, 0)],
      pace: STEADY_PACE,
      daysToExamByTerm: { '1': 30 },
    });
    expect(r.units[0].verdict).toBe('no-exam');
    expect(r.units[1].verdict).toBe('no-questions');
  });

  it('no recent sheets → no pace, wont-finish, null summary rates', () => {
    const r = forecastCoverage({
      units: [unit('u1', 1, 10, 2)],
      pace: { windowDays: 14, recentSheetCount: 0, recentQuestionCount: 0 },
      daysToExamByTerm: { '1': 30 },
    });
    expect(r.units[0].verdict).toBe('wont-finish');
    expect(r.summary.hasPace).toBe(false);
    expect(r.summary.sheetsPerWeek).toBeNull();
    expect(r.summary.daysToFinishAll).toBeNull();
  });

  it('summary: total remaining + days to finish everything at pace', () => {
    const r = forecastCoverage({
      units: [unit('a', 1, 50, 10), unit('b', 1, 30, 0)],
      pace: STEADY_PACE, // 10 q/day
      daysToExamByTerm: { '1': 30 },
    });
    expect(r.summary.totalRemaining).toBe(70);
    expect(r.summary.daysToFinishAll).toBe(7);
    expect(r.summary.sheetsPerWeek).toBeCloseTo(7);
    expect(r.summary.questionsPerSheet).toBeCloseTo(10);
  });

  it('past-term backlog does NOT steal capacity from the upcoming exam', () => {
    // Term-3 exam in 10 days (capacity 100), 50 remaining in term 3. A huge
    // 1000-question backlog from terms 1+2 (exams already gone → no
    // daysToExam) must not drown the term-3 verdict.
    const r = forecastCoverage({
      units: [
        unit('t1-backlog', 1, 1000, 0),
        unit('t2-backlog', 2, 200, 0),
        unit('t3-current', 3, 50, 0),
      ],
      pace: STEADY_PACE, // 10 q/day
      daysToExamByTerm: { '3': 10 }, // terms 1+2 have no upcoming exam
    });
    const t3 = r.units.find((u) => u.unitId === 't3-current')!;
    expect(t3.verdict).toBe('on-track');
    expect(t3.projectedPct).toBe(1);
    expect(r.units[0].verdict).toBe('no-exam');
    expect(r.units[1].verdict).toBe('no-exam');
    // Summary separates "everything ever" from "due before an actual exam".
    expect(r.summary.totalRemaining).toBe(1250);
    expect(r.summary.datedRemaining).toBe(50);
    expect(r.summary.daysToFinishDated).toBe(5);
  });
});
