import { describe, it, expect } from 'vitest';
import {
  rangesOverlap,
  busyConflict,
  isStudentFree,
  paperRevenue,
  PAPER_RATE_LKR,
  type BusyWindow,
} from '../convex/lib/paperClasses';

describe('rangesOverlap', () => {
  it('overlaps when ranges intersect', () => {
    expect(rangesOverlap('15:00', '17:00', '16:00', '18:00')).toBe(true);
  });
  it('does not overlap when touching at the edge (half-open)', () => {
    expect(rangesOverlap('15:00', '16:00', '16:00', '17:00')).toBe(false);
  });
  it('does not overlap when disjoint', () => {
    expect(rangesOverlap('15:00', '16:00', '18:00', '19:00')).toBe(false);
  });
});

describe('busyConflict / isStudentFree', () => {
  const block = { dayOfWeek: 3, startTime: '16:00', endTime: '18:00' };

  it('is free when no windows match the day', () => {
    const windows: BusyWindow[] = [
      { dayOfWeek: 2, startTime: '16:00', endTime: '18:00', reason: 'Night class' },
    ];
    expect(busyConflict(block, windows)).toBeNull();
    expect(isStudentFree(block, windows)).toBe(true);
  });

  it('is busy when an outside window overlaps on the same day', () => {
    const windows: BusyWindow[] = [
      { dayOfWeek: 3, startTime: '17:00', endTime: '19:00', reason: 'Physics tuition' },
    ];
    expect(busyConflict(block, windows)?.reason).toBe('Physics tuition');
    expect(isStudentFree(block, windows)).toBe(false);
  });

  it('is free when a same-day window does not overlap the time', () => {
    const windows: BusyWindow[] = [
      { dayOfWeek: 3, startTime: '18:00', endTime: '20:00', reason: 'Night class' },
    ];
    expect(isStudentFree(block, windows)).toBe(true);
  });

  it('returns the first overlapping window as the reason', () => {
    const windows: BusyWindow[] = [
      { dayOfWeek: 3, startTime: '17:00', endTime: '18:00', reason: 'Personal class: G9 Algebra' },
      { dayOfWeek: 3, startTime: '16:30', endTime: '17:30', reason: 'Night class' },
    ];
    expect(busyConflict(block, windows)?.reason).toBe('Personal class: G9 Algebra');
  });
});

describe('paperRevenue — flat 100/day', () => {
  it('charges 100 for one present student on one day', () => {
    expect(
      paperRevenue([{ studentId: 's1', date: '2026-06-17', status: 'present' }]),
    ).toBe(PAPER_RATE_LKR);
  });

  it('charges once when a student attends two blocks the same day', () => {
    expect(
      paperRevenue([
        { studentId: 's1', date: '2026-06-17', status: 'present' },
        { studentId: 's1', date: '2026-06-17', status: 'present' },
      ]),
    ).toBe(100);
  });

  it('charges per day across different days', () => {
    expect(
      paperRevenue([
        { studentId: 's1', date: '2026-06-17', status: 'present' },
        { studentId: 's1', date: '2026-06-18', status: 'present' },
      ]),
    ).toBe(200);
  });

  it('ignores absent and unmarked rows', () => {
    expect(
      paperRevenue([
        { studentId: 's1', date: '2026-06-17', status: 'absent' },
        { studentId: 's2', date: '2026-06-17', status: 'present' },
        { studentId: 's3', date: '2026-06-17', status: 'unknown' },
      ]),
    ).toBe(100);
  });

  it('respects a custom rate', () => {
    expect(
      paperRevenue([{ studentId: 's1', date: '2026-06-17', status: 'present' }], 150),
    ).toBe(150);
  });
});
