import { describe, it, expect } from 'vitest';
import {
  coverageLadderFits,
  type CoverageQuestion,
} from '../convex/learningEngine/coverageMode';
import {
  COVERAGE_LADDER_DECAY,
  COVERAGE_SEEN_FIT_DAMP,
} from '../convex/learningEngine/config';

const q = (
  id: string,
  difficulty: number | null,
  opts?: { pickerOrder?: number | null; seen?: boolean },
): CoverageQuestion => ({
  id,
  difficulty,
  pickerOrder: opts?.pickerOrder ?? null,
  seen: opts?.seen ?? false,
});

describe('coverageLadderFits', () => {
  it('gives the easiest unseen question fit 1.0 and decays down the ladder', () => {
    const fits = coverageLadderFits({
      questions: [q('c', 3), q('a', 1), q('b', 2)],
      studentSkill: 1,
    });
    expect(fits.get('a')!.fit).toBe(1);
    expect(fits.get('b')!.fit).toBeCloseTo(COVERAGE_LADDER_DECAY);
    expect(fits.get('c')!.fit).toBeCloseTo(COVERAGE_LADDER_DECAY ** 2);
  });

  it('tie-breaks equal difficulty by pickerOrder (the drag order)', () => {
    const fits = coverageLadderFits({
      questions: [
        q('later', 2, { pickerOrder: 5 }),
        q('first', 2, { pickerOrder: 1 }),
      ],
      studentSkill: 2,
    });
    expect(fits.get('first')!.fit).toBe(1);
    expect(fits.get('later')!.fit).toBeCloseTo(COVERAGE_LADDER_DECAY);
  });

  it('skips seen questions: the next UNSEEN rung gets 1.0', () => {
    const fits = coverageLadderFits({
      questions: [q('done', 1, { seen: true }), q('next', 2)],
      studentSkill: 1,
    });
    expect(fits.get('next')!.fit).toBe(1);
    expect(fits.get('next')!.reason).toContain('rung 1');
  });

  it('damps seen questions so they only win when nothing unseen remains', () => {
    const fits = coverageLadderFits({
      questions: [q('done', 2, { seen: true }), q('next', 2)],
      studentSkill: 2,
    });
    // Seen question at perfect difficulty match: Gaussian 1.0 × damp.
    expect(fits.get('done')!.fit).toBeCloseTo(COVERAGE_SEEN_FIT_DAMP);
    expect(fits.get('done')!.fit).toBeLessThan(fits.get('next')!.fit);
  });

  it('leaves far-too-hard unseen questions alone (not ready = no override)', () => {
    // Weak student (skill 1): a d5 question is beyond the max step-up —
    // the hard tail is deferred automatically, not served.
    const fits = coverageLadderFits({
      questions: [q('easy', 1), q('tail', 5)],
      studentSkill: 1,
    });
    expect(fits.get('easy')!.fit).toBe(1);
    expect(fits.has('tail')).toBe(false);
  });

  it('unlocks the hard tail once mastery grows', () => {
    const fits = coverageLadderFits({
      questions: [q('tail', 5)],
      studentSkill: 3.2,
    });
    expect(fits.get('tail')!.fit).toBe(1);
  });

  it('all-seen concept degrades to damped Gaussian everywhere (repeat mode)', () => {
    const fits = coverageLadderFits({
      questions: [q('x', 2, { seen: true }), q('y', 4, { seen: true })],
      studentSkill: 2,
    });
    // Both damped; the better difficulty match still ranks first, i.e. the
    // old behaviour survives inside the damp.
    expect(fits.get('x')!.fit).toBeGreaterThan(fits.get('y')!.fit);
    expect(fits.get('x')!.reason).toContain('seen');
  });

  it('null difficulty falls back to the d3 midpoint for ladder placement', () => {
    const fits = coverageLadderFits({
      questions: [q('untagged', null), q('easy', 1)],
      studentSkill: 1,
    });
    expect(fits.get('easy')!.fit).toBe(1);
    expect(fits.get('untagged')!.fit).toBeCloseTo(COVERAGE_LADDER_DECAY);
  });
});
