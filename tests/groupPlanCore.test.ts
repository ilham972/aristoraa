import { describe, it, expect } from 'vitest';
import { buildGroupSkeleton } from '../convex/lib/groupPlanCore';

const dates = (n: number, startDay = 1): string[] =>
  Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(2026, 7, startDay + i * 2)); // every 2 days
    return d.toISOString().slice(0, 10);
  });

describe('buildGroupSkeleton', () => {
  it('lays units across sessions in order and projects finish dates', () => {
    const r = buildGroupSkeleton({
      sessionDates: dates(4),
      units: [
        { unitId: 'U1', term: 3, unseenCount: 10, totalCount: 10 },
        { unitId: 'U2', term: 3, unseenCount: 6, totalCount: 6 },
      ],
      mainQuestionsPerSession: 8,
      spiralShare: 0.25,
      examDateByTerm: { 3: '2026-09-01' },
      anyPastUnitStarted: false,
    });
    // Session 1: no past unit yet → all 8 new from U1 (2 left in U1).
    expect(r.sessions[0].spiralCount).toBe(0);
    expect(r.sessions[0].parts).toEqual([{ unitId: 'U1', newCount: 8 }]);
    // Session 2: U1 finishes (2) then U2 starts; U1 done → spiral turns on
    // AFTER the boundary session (still 0 here since spiral computed first).
    expect(r.sessions[1].parts[0]).toEqual({ unitId: 'U1', newCount: 2 });
    expect(r.sessions[1].parts[1].unitId).toBe('U2');
    const u1 = r.units.find((u) => u.unitId === 'U1')!;
    expect(u1.projectedFinishDate).toBe(r.sessions[1].date);
    expect(u1.verdict).toBe('on-track');
  });

  it('marks units that miss their exam date', () => {
    const r = buildGroupSkeleton({
      sessionDates: dates(3), // capacity 18 < 30 needed
      units: [{ unitId: 'U1', term: 3, unseenCount: 30, totalCount: 30 }],
      mainQuestionsPerSession: 6,
      spiralShare: 0,
      examDateByTerm: { 3: '2026-08-02' },
      anyPastUnitStarted: false,
    });
    const u1 = r.units[0];
    expect(u1.projectedFinishDate).toBeNull();
    expect(u1.verdict).toBe('after-horizon');
  });

  it('wont-finish when projected finish lands after the exam', () => {
    const r = buildGroupSkeleton({
      sessionDates: dates(5), // finishes on 3rd session
      units: [{ unitId: 'U1', term: 3, unseenCount: 18, totalCount: 18 }],
      mainQuestionsPerSession: 6,
      spiralShare: 0,
      examDateByTerm: { 3: '2026-08-02' }, // before 3rd session (Aug 5)
      anyPastUnitStarted: false,
    });
    expect(r.units[0].verdict).toBe('wont-finish');
  });

  it('reserves spiral slots once a past unit exists', () => {
    const r = buildGroupSkeleton({
      sessionDates: dates(2),
      units: [{ unitId: 'U2', term: 3, unseenCount: 20, totalCount: 20 }],
      mainQuestionsPerSession: 8,
      spiralShare: 0.25,
      examDateByTerm: {},
      anyPastUnitStarted: true, // U1 finished before today
    });
    expect(r.sessions[0].spiralCount).toBe(2);
    expect(r.sessions[0].parts[0].newCount).toBe(6);
    expect(r.units[0].verdict).toBe('no-exam');
  });

  it('already-finished units report done', () => {
    const r = buildGroupSkeleton({
      sessionDates: dates(2),
      units: [
        { unitId: 'U1', term: 3, unseenCount: 0, totalCount: 12 },
        { unitId: 'U2', term: 3, unseenCount: 4, totalCount: 12 },
      ],
      mainQuestionsPerSession: 8,
      spiralShare: 0.25,
      examDateByTerm: { 3: '2026-12-01' },
      anyPastUnitStarted: true,
    });
    expect(r.units[0].verdict).toBe('done');
    expect(r.sessions[0].parts[0].unitId).toBe('U2');
  });

  it('units with no questions in the bank report no-questions, never done', () => {
    const r = buildGroupSkeleton({
      sessionDates: dates(3),
      units: [
        { unitId: 'U1', term: 3, unseenCount: 4, totalCount: 4 },
        { unitId: 'U2', term: 3, unseenCount: 0, totalCount: 0 }, // book not entered
        { unitId: 'U3', term: 3, unseenCount: 6, totalCount: 6 },
      ],
      mainQuestionsPerSession: 8,
      spiralShare: 0,
      examDateByTerm: { 3: '2026-12-01' },
      anyPastUnitStarted: false,
    });
    // The walk skips the empty unit and continues into U3…
    expect(r.sessions[0].parts.map((p) => p.unitId)).toEqual(['U1', 'U3']);
    // …but the projection says the truth: no questions, not done.
    expect(r.units[1].verdict).toBe('no-questions');
    expect(r.units[0].verdict).toBe('on-track');
  });
});
