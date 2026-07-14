import { describe, it, expect } from 'vitest';
import {
  assessConsolidation,
  type ConsolidationAttempt,
} from '../convex/lib/consolidationCore';
import {
  CONSOLIDATION_ENTER_FAIL_RATE,
  CONSOLIDATION_EXIT_FAIL_RATE,
  CONSOLIDATION_MIN_ATTEMPTS,
} from '../convex/learningEngine/config';

const W = 1.2; // weight of a difficulty-3 question (0.6 + 0.2*3)

const attempts = (good: number, again: number, skipped = 0): ConsolidationAttempt[] => [
  ...Array.from({ length: good }, () => ({ response: 'good', weight: W })),
  ...Array.from({ length: again }, () => ({ response: 'again', weight: W })),
  ...Array.from({ length: skipped }, () => ({ response: 'skipped', weight: W })),
];

const assess = (
  a: ConsolidationAttempt[],
  mode: 'normal' | 'consolidation' = 'normal',
) =>
  assessConsolidation({
    attempts: a,
    currentMode: mode,
    enterFailRate: CONSOLIDATION_ENTER_FAIL_RATE,
    exitFailRate: CONSOLIDATION_EXIT_FAIL_RATE,
    minAttempts: CONSOLIDATION_MIN_ATTEMPTS,
  });

describe('assessConsolidation', () => {
  it('stays silent below the attempt floor', () => {
    const r = assess(attempts(2, 9)); // 11 attempts, 82% failure — but thin
    expect(r.verdict).toBe('ok');
    expect(r.failRate).toBeNull();
    expect(r.attemptCount).toBe(11);
  });

  it('skipped attempts carry no signal (excluded from count and rate)', () => {
    // 11 real attempts + 5 skips: still below the floor of 12.
    const r = assess(attempts(2, 9, 5));
    expect(r.verdict).toBe('ok');
    expect(r.attemptCount).toBe(11);
  });

  it('suggests consolidation for a failing normal student', () => {
    const r = assess(attempts(6, 6)); // 50% ≥ enter threshold (40%)
    expect(r.verdict).toBe('suggest-consolidation');
    expect(r.failRate).toBeCloseTo(0.5);
  });

  it('does not flag a healthy normal student', () => {
    const r = assess(attempts(10, 2)); // ~17% < 40%
    expect(r.verdict).toBe('ok');
  });

  it('hysteresis: a middling rate keeps the current mode either way', () => {
    // 30% sits between exit (20%) and enter (40%): no suggestion in either mode.
    const mid = attempts(14, 6);
    expect(assess(mid, 'normal').verdict).toBe('ok');
    expect(assess(mid, 'consolidation').verdict).toBe('ok');
  });

  it('suggests normal once a consolidation student recovers', () => {
    const r = assess(attempts(18, 2), 'consolidation'); // 10% ≤ exit (20%)
    expect(r.verdict).toBe('suggest-normal');
  });

  it('difficulty weighting: failing only hard questions flags later than easy ones', () => {
    const hardW = 0.6 + 0.2 * 5; // 1.6
    const easyW = 0.6 + 0.2 * 1; // 0.8
    // 8 easy rights + 4 hard wrongs → wrong share 6.4/12.8 = 50% ⇒ flagged.
    const failsHard = [
      ...Array.from({ length: 8 }, () => ({ response: 'good', weight: easyW })),
      ...Array.from({ length: 4 }, () => ({ response: 'again', weight: hardW })),
    ];
    // 8 hard rights + 4 easy wrongs → wrong share 3.2/16 = 20% ⇒ not flagged.
    const failsEasy = [
      ...Array.from({ length: 8 }, () => ({ response: 'good', weight: hardW })),
      ...Array.from({ length: 4 }, () => ({ response: 'again', weight: easyW })),
    ];
    expect(assess(failsHard).verdict).toBe('suggest-consolidation');
    expect(assess(failsEasy).verdict).toBe('ok');
  });
});
