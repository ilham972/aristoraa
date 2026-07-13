import { describe, it, expect } from 'vitest';
import {
  DEFAULT_OFF_DAYS,
  isOffDayForDate,
  weekdayNameFromDateStr,
} from '../convex/lib/offDays';

// 2026-07-12 is a Sunday; 2026-07-13 is a Monday.
const SUNDAY = '2026-07-12';
const MONDAY = '2026-07-13';

describe('weekdayNameFromDateStr', () => {
  it('names weekdays correctly', () => {
    expect(weekdayNameFromDateStr(SUNDAY)).toBe('sunday');
    expect(weekdayNameFromDateStr(MONDAY)).toBe('monday');
  });
  it('returns null for garbage', () => {
    expect(weekdayNameFromDateStr('not-a-date')).toBe(null);
  });
});

describe('isOffDayForDate — no default off-days', () => {
  it('the centre has no default off-days', () => {
    expect(DEFAULT_OFF_DAYS).toEqual([]);
  });

  // The reported bug: selecting a student on a Sunday showed
  // "<name> is off today" instead of the Generate-sheet button, because the
  // off-day default was ["sunday"]. With no default, nobody is off on Sunday.
  it('a student with no offDays is NOT off on Sunday', () => {
    expect(isOffDayForDate(undefined, SUNDAY)).toBe(false);
  });

  it('a student with no offDays is NOT off on a weekday', () => {
    expect(isOffDayForDate(undefined, MONDAY)).toBe(false);
  });

  it('respects an explicitly-configured off-day (case-insensitive)', () => {
    expect(isOffDayForDate(['Sunday'], SUNDAY)).toBe(true);
    expect(isOffDayForDate(['sunday'], MONDAY)).toBe(false);
  });
});
