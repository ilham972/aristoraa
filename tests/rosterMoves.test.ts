import { describe, it, expect } from 'vitest';
import {
  netCountDelta,
  validateCaps,
  realOps,
  effectiveCap,
  buildGradeBoard,
  acceptedGradesOf,
  DEFAULT_MAX_SIZE,
  type RosterOp,
  type BoardGroup,
  type BoardMemberRow,
  type BoardStudent,
} from '../convex/lib/rosterMoves';

const op = (studentId: string, from: string | null, to: string | null): RosterOp => ({
  studentId,
  fromGroupId: from,
  toGroupId: to,
});

describe('effectiveCap', () => {
  it('uses maxSize when set', () => {
    expect(effectiveCap(6)).toBe(6);
  });
  it('falls back to the 10 hard-cap when unset', () => {
    expect(effectiveCap(undefined)).toBe(DEFAULT_MAX_SIZE);
    expect(effectiveCap(null)).toBe(10);
  });
});

describe('realOps', () => {
  it('drops no-op moves (target === source)', () => {
    const ops = [op('s1', 'A', 'A'), op('s2', 'A', 'B'), op('s3', null, null)];
    expect(realOps(ops).map((o) => o.studentId)).toEqual(['s2']);
  });
});

describe('netCountDelta', () => {
  it('moves a student from A to B: A−1, B+1', () => {
    const d = netCountDelta([op('s1', 'A', 'B')]);
    expect(d.get('A')).toBe(-1);
    expect(d.get('B')).toBe(1);
  });

  it('add from Unassigned only grows the target', () => {
    const d = netCountDelta([op('s1', null, 'B')]);
    expect(d.has('A')).toBe(false);
    expect(d.get('B')).toBe(1);
  });

  it('remove to Unassigned only shrinks the source', () => {
    const d = netCountDelta([op('s1', 'A', null)]);
    expect(d.get('A')).toBe(-1);
    expect(d.has('B' as string)).toBe(false);
  });

  it('a swap (A→B and B→A) nets to zero on both', () => {
    const d = netCountDelta([op('s1', 'A', 'B'), op('s2', 'B', 'A')]);
    expect(d.get('A')).toBe(0);
    expect(d.get('B')).toBe(0);
  });
});

describe('validateCaps', () => {
  const caps = new Map([
    ['A', 10],
    ['B', 10],
    ['small', 4],
  ]);

  it('passes when no group exceeds its cap', () => {
    const current = new Map([['A', 8], ['B', 5]]);
    const res = validateCaps([op('s1', 'A', 'B')], current, caps);
    expect(res.ok).toBe(true);
    expect(res.violations).toEqual([]);
  });

  it('blocks a move that would push a group to 11', () => {
    const current = new Map([['A', 5], ['B', 10]]);
    const res = validateCaps([op('s1', 'A', 'B')], current, caps);
    expect(res.ok).toBe(false);
    expect(res.violations[0]).toEqual({ groupId: 'B', count: 11, cap: 10 });
  });

  it('respects a custom maxSize cap', () => {
    const current = new Map([['small', 4], ['A', 2]]);
    const res = validateCaps([op('s1', 'A', 'small')], current, caps);
    expect(res.ok).toBe(false);
    expect(res.violations[0]).toEqual({ groupId: 'small', count: 5, cap: 4 });
  });

  it('a swap that keeps a full group at its cap is allowed', () => {
    const current = new Map([['A', 10], ['B', 10]]);
    const res = validateCaps([op('s1', 'A', 'B'), op('s2', 'B', 'A')], current, caps);
    expect(res.ok).toBe(true);
  });

  it('moving OUT of a full group never violates', () => {
    const current = new Map([['A', 10], ['B', 3]]);
    const res = validateCaps([op('s1', 'A', 'B')], current, caps);
    expect(res.ok).toBe(true);
  });

  it('uses the default cap for groups missing from the caps map', () => {
    const current = new Map([['X', 10]]);
    const res = validateCaps([op('s1', null, 'X')], current, new Map());
    expect(res.ok).toBe(false);
    expect(res.violations[0]).toEqual({ groupId: 'X', count: 11, cap: 10 });
  });
});

describe('buildGradeBoard', () => {
  // Mirrors the prod data that exposed the two bugs.
  const students: BoardStudent[] = [
    { _id: 'risla', name: 'Risla', schoolGrade: 10 },
    { _id: 'reeha', name: 'Reeha', schoolGrade: 11 }, // other-grade member
    { _id: 'asma', name: 'Asma', schoolGrade: 10 }, // in two groups
    { _id: 'kavi', name: 'Kavi', schoolGrade: 10 }, // only in an untyped group
    { _id: 'sara', name: 'Sara', schoolGrade: 10 }, // no group → unassigned
    { _id: 'janusan', name: 'Janusan', schoolGrade: 11 }, // gr11 in untyped group
  ];
  const groups: BoardGroup[] = [
    { _id: 'rra', name: 'risla_reeha_asma', grade: 10, additionalGrades: [11] },
    { _id: 'asma2', name: 'asma_other', grade: 10 },
    { _id: 'ibanjalin', name: 'ibanjalin' }, // NO grade declared, mixed members
    // empty but SCHEDULED grade-10 group → a real drop target
    { _id: 'empty10', name: 'new_group', grade: 10, firstSession: { dayOfWeek: 1, startTime: '16:00' } },
    // phantom: grade declared but NO members and NO session → abandoned, must hide
    { _id: 'phantom10', name: 'new_group', grade: 10 },
    { _id: 'g11', name: 'reeha_solo', grade: 11 }, // not a grade-10 column
  ];
  const members: BoardMemberRow[] = [
    { groupId: 'rra', studentId: 'risla' },
    { groupId: 'rra', studentId: 'reeha' },
    { groupId: 'rra', studentId: 'asma' },
    { groupId: 'asma2', studentId: 'asma' }, // asma's 2nd group
    { groupId: 'ibanjalin', studentId: 'kavi' },
    { groupId: 'ibanjalin', studentId: 'janusan' },
    { groupId: 'g11', studentId: 'reeha' },
  ];

  const board = buildGradeBoard(10, groups, members, students);
  const col = (id: string) => board.columns.find((c) => c.groupId === id);

  it('Bug 1: shows EVERY member of a group as a chip (no "locked")', () => {
    const rra = col('rra');
    expect(rra).toBeDefined();
    expect(rra!.members.map((m) => m.name).sort()).toEqual(['Asma', 'Reeha', 'Risla']);
    expect(rra!.count).toBe(3);
  });

  it('Bug 1: an off-grade member carries their real grade (for the badge)', () => {
    const reeha = col('rra')!.members.find((m) => m.studentId === 'reeha');
    expect(reeha!.grade).toBe(11);
  });

  it('Bug 1: a multi-group student appears in EACH of their groups', () => {
    expect(col('rra')!.members.some((m) => m.studentId === 'asma')).toBe(true);
    expect(col('asma2')!.members.some((m) => m.studentId === 'asma')).toBe(true);
  });

  it('Bug 2: an untyped group with a grade-10 member becomes a column', () => {
    const ib = col('ibanjalin');
    expect(ib).toBeDefined();
    expect(ib!.acceptedGrades).toEqual([]); // accepts any grade
    expect(ib!.members.map((m) => m.studentId).sort()).toEqual(['janusan', 'kavi']);
  });

  it('includes empty groups that declare the grade AND are scheduled (drop targets)', () => {
    expect(col('empty10')).toBeDefined();
    expect(col('empty10')!.members).toEqual([]);
  });

  it('hides phantom groups with no members and no scheduled session', () => {
    // The Week-view "tap empty cell" flow mints a `new_group` row before the
    // user commits; backing out leaves an abandoned, session-less, memberless
    // row. It must NOT clutter the board even though it declares grade 10.
    expect(col('phantom10')).toBeUndefined();
  });

  it('excludes groups that neither declare grade 10 nor hold a grade-10 member', () => {
    expect(col('g11')).toBeUndefined();
  });

  it('unassigned lists only grade-10 students in no group', () => {
    expect(board.unassigned.map((s) => s.name)).toEqual(['Sara']);
  });

  it('exposes acceptedGrades for the move guard', () => {
    expect(acceptedGradesOf(groups[0])).toEqual([10, 11]);
    expect(acceptedGradesOf(groups[2])).toEqual([]);
  });
});
