// Pure logic for the paper-class ("Library") feature. No Convex / DB access
// here so it can be unit-tested in isolation (see tests/paperClasses.test.ts).
//
// Two jobs:
//   1. Availability — decide whether a student is free for a paper block,
//      given their outside busy windows, their personal-class slots, and any
//      other paper blocks they already sit in (all on the same weekday/time).
//   2. Billing — flat 100 LKR per student per DAY, no matter how many blocks
//      they attended that day.

/** Flat paper-class fee: 100 LKR per student per day attended. */
export const PAPER_RATE_LKR = 100;

/** Half-open overlap on "HH:MM" strings: [aStart,aEnd) ∩ [bStart,bEnd). */
export function rangesOverlap(
  aStart: string,
  aEnd: string,
  bStart: string,
  bEnd: string,
): boolean {
  return aStart < bEnd && aEnd > bStart;
}

/** A weekly time window the student is occupied (night class, personal class…). */
export type BusyWindow = {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  // Why they're busy, surfaced in the UI when a candidate is greyed out.
  reason: string;
};

export type BlockSlot = {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
};

/**
 * Returns the conflict that makes a student unavailable for `block`, or null
 * if they're free. The first overlapping window (in the order given) wins, so
 * callers should pass the most meaningful reason first if they care.
 */
export function busyConflict(
  block: BlockSlot,
  windows: BusyWindow[],
): BusyWindow | null {
  for (const w of windows) {
    if (w.dayOfWeek !== block.dayOfWeek) continue;
    if (rangesOverlap(block.startTime, block.endTime, w.startTime, w.endTime)) {
      return w;
    }
  }
  return null;
}

/** Convenience boolean wrapper around {@link busyConflict}. */
export function isStudentFree(block: BlockSlot, windows: BusyWindow[]): boolean {
  return busyConflict(block, windows) === null;
}

/**
 * Flat per-day paper revenue from attendance rows. Charges 100 LKR for each
 * distinct (student, date) pair marked "present" — so two blocks in one day
 * still bills once. Absent / unmarked rows contribute nothing.
 */
export function paperRevenue(
  rows: Array<{ studentId: string; date: string; status: string }>,
  rate: number = PAPER_RATE_LKR,
): number {
  const billed = new Set<string>();
  for (const r of rows) {
    if (r.status === "present") billed.add(`${r.studentId}|${r.date}`);
  }
  return billed.size * rate;
}
