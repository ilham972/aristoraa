import { describe, it, expect } from 'vitest';
import {
  netCountDelta,
  validateCaps,
  realOps,
  effectiveCap,
  DEFAULT_MAX_SIZE,
  type RosterOp,
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
