import { describe, it, expect } from 'vitest';
import {
  minutesBetweenClock,
  unitTier,
  taughtMeanMastery,
  deriveUnitStatuses,
  conceptsPerSession,
  sessionsLeftForUnit,
  projectFinishYmd,
  ymdFromMs,
  MS_PER_DAY,
  type CoreUnit,
} from '../convex/lib/trackProgressCore';

const c = (taught: boolean, mastery: number | null = null) => ({ taught, mastery });
const u = (unitId: string, inScope: boolean, concepts: CoreUnit['concepts']): CoreUnit => ({
  unitId,
  inScope,
  concepts,
});

describe('minutesBetweenClock', () => {
  it('computes a normal duration', () => {
    expect(minutesBetweenClock('15:00', '17:30')).toBe(150);
  });
  it('rejects malformed and non-positive input', () => {
    expect(minutesBetweenClock('abc', '17:00')).toBeNull();
    expect(minutesBetweenClock('17:00', '17:00')).toBeNull();
    expect(minutesBetweenClock('18:00', '17:00')).toBeNull();
  });
});

describe('unitTier (two-tier done rule)', () => {
  it('pending while any concept is untaught', () => {
    expect(unitTier([c(true, 0.9), c(false)], 0.75)).toBe('pending');
  });
  it('taught when all attempted but mean mastery below threshold', () => {
    expect(unitTier([c(true, 0.6), c(true, 0.7)], 0.75)).toBe('taught');
  });
  it('mastered when all attempted and mean mastery ≥ threshold', () => {
    expect(unitTier([c(true, 0.8), c(true, 0.9)], 0.75)).toBe('mastered');
  });
  it('zero-concept unit is pending (caller flags noSyllabus)', () => {
    expect(unitTier([], 0.75)).toBe('pending');
  });
});

describe('taughtMeanMastery', () => {
  it('averages only taught concepts', () => {
    expect(taughtMeanMastery([c(true, 0.5), c(true, 0.7), c(false)])).toBeCloseTo(0.6);
  });
  it('null when nothing taught', () => {
    expect(taughtMeanMastery([c(false), c(false)])).toBeNull();
  });
});

describe('deriveUnitStatuses (frontier walk)', () => {
  it('marks the first servable pending unit as current', () => {
    const units = [
      u('u1', true, [c(true, 0.9)]),                 // mastered
      u('u2', true, [c(true, 0.5), c(true, 0.6)]),   // taught
      u('u3', true, [c(true, 0.9), c(false)]),       // ← current
      u('u4', true, [c(false)]),                     // upcoming
    ];
    expect(deriveUnitStatuses(units, 0.75)).toEqual([
      'mastered',
      'taught',
      'current',
      'upcoming',
    ]);
  });

  it('skips out-of-scope and empty units when picking the frontier (the silent-skip bug made visible)', () => {
    const units = [
      u('offscope', false, [c(false)]), // planner would skip → upcoming, never current
      u('empty', true, []),             // no syllabus data → never current
      u('real', true, [c(false)]),      // ← current
    ];
    expect(deriveUnitStatuses(units, 0.75)).toEqual(['upcoming', 'upcoming', 'current']);
  });

  it('no frontier when everything is taught', () => {
    const units = [u('u1', true, [c(true, 0.9)]), u('u2', true, [c(true, 0.4)])];
    expect(deriveUnitStatuses(units, 0.75)).toEqual(['mastered', 'taught']);
  });
});

describe('conceptsPerSession (must mirror planner autoMainConcepts)', () => {
  const base = { minutesPerNewConcept: 50, minConcepts: 1, maxConcepts: 3 };
  it('default rule: sessionMinutes / MINUTES_PER_NEW_CONCEPT, clamped', () => {
    expect(conceptsPerSession({ ...base, pacingPerHour: null, sessionMinutes: 60 })).toBe(1);
    expect(conceptsPerSession({ ...base, pacingPerHour: null, sessionMinutes: 120 })).toBe(2);
    expect(conceptsPerSession({ ...base, pacingPerHour: null, sessionMinutes: 480 })).toBe(3); // max clamp
    expect(conceptsPerSession({ ...base, pacingPerHour: null, sessionMinutes: 15 })).toBe(1);  // min clamp
  });
  it('teacher pacing wins when set', () => {
    expect(conceptsPerSession({ ...base, pacingPerHour: 2, sessionMinutes: 60 })).toBe(2);
    expect(conceptsPerSession({ ...base, pacingPerHour: 1, sessionMinutes: 120 })).toBe(2);
  });
});

describe('sessionsLeftForUnit', () => {
  it('ceils partial sessions', () => {
    expect(sessionsLeftForUnit(3, 2)).toBe(2);
    expect(sessionsLeftForUnit(4, 2)).toBe(2);
    expect(sessionsLeftForUnit(0, 2)).toBe(0);
  });
});

describe('projectFinishYmd', () => {
  const today = Date.parse('2026-07-10T00:00:00.000Z');
  it('walks forward whole weeks', () => {
    // 5 sessions at 2/week → 3 weeks → +21 days
    expect(projectFinishYmd({ sessionsLeftTotal: 5, sessionsPerWeek: 2, todayMs: today })).toBe(
      ymdFromMs(today + 21 * MS_PER_DAY),
    );
  });
  it('null without a weekly schedule', () => {
    expect(projectFinishYmd({ sessionsLeftTotal: 5, sessionsPerWeek: 0, todayMs: today })).toBeNull();
  });
  it('today when nothing is left', () => {
    expect(projectFinishYmd({ sessionsLeftTotal: 0, sessionsPerWeek: 2, todayMs: today })).toBe('2026-07-10');
  });
});
