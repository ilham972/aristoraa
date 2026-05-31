// Within-day time math for the Session-tab launcher + pill strip.
//
// The app-wide day-of-week convention (1=Mon..7=Sun) lives in time-grid.ts.
// This module only deals with a single date string ("YYYY-MM-DD") paired
// with "HH:MM" 24h times, which is what the pill strip needs to decide a
// session's live / past / upcoming state and which time band it sits in.

export type TimeBand = 'morning' | 'afternoon' | 'evening';

/** Morning < 12:00, Afternoon 12:00–17:59, Evening ≥ 18:00. Tiles all 24h. */
export function timeBand(startTime: string): TimeBand {
  const h = parseInt(startTime.split(':')[0], 10);
  if (h < 12) return 'morning';
  if (h < 18) return 'afternoon';
  return 'evening';
}

/** 12-hour clock hour, no am/pm, no minutes: "16:30" → "4", "08:00" → "8". */
export function hourLabel(startTime: string): string {
  const h = parseInt(startTime.split(':')[0], 10);
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return String(h12);
}

function at(date: string, time: string): Date {
  const d = new Date(date + 'T00:00:00');
  const [h, m] = time.split(':').map(Number);
  d.setHours(h, m, 0, 0);
  return d;
}

/** now within [start, end) on the given date — i.e. the class is happening. */
export function isLive(date: string, start: string, end: string, now: Date): boolean {
  return now >= at(date, start) && now < at(date, end);
}

/** Has the session's start time already passed for that date? */
export function isPast(date: string, start: string, now: Date): boolean {
  return now > at(date, start);
}
