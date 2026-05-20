// Phase F: the weekly time grid.
//
// dayOfWeek encoding matches the existing scheduleSlots convention used by
// the old Schedule tab: 1=Mon … 6=Sat. We extend it with 7=Sun so the
// weekend morning block has somewhere to live. (The old tab only rendered
// 1..6; Sunday slots simply never appeared. /groups renders all 7.)
//
// Hour bands the user specified:
//   weekdays (Mon–Fri):           3PM → 10PM
//   weekends (Sat & Sun):  8AM → 12PM  and  3PM → 10PM
//
// Each cell is a 1-hour atom. A session may span multiple atoms (e.g. a
// 3–5PM class occupies the 3-4 and 4-5 rows); the grid stores each atom as
// its own scheduleSlots row keyed by startTime/endTime, matching how the
// legacy tab modelled multi-hour slots as discrete entries.

export type DayNum = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export const DAYS: { num: DayNum; short: string; full: string; weekend: boolean }[] = [
  { num: 1, short: "Mon", full: "Monday", weekend: false },
  { num: 2, short: "Tue", full: "Tuesday", weekend: false },
  { num: 3, short: "Wed", full: "Wednesday", weekend: false },
  { num: 4, short: "Thu", full: "Thursday", weekend: false },
  { num: 5, short: "Fri", full: "Friday", weekend: false },
  { num: 6, short: "Sat", full: "Saturday", weekend: true },
  { num: 7, short: "Sun", full: "Sunday", weekend: true },
];

/** One-hour band: { start: "15:00", end: "16:00", label: "3-4P" }. */
export type HourBand = { start: string; end: string; label: string };

function hh(h: number): string {
  return `${String(h).padStart(2, "0")}:00`;
}

function bandLabel(h: number): string {
  const startAmpm = h >= 12 ? "P" : "A";
  const endH = h + 1;
  const endAmpm = endH >= 12 && endH < 24 ? "P" : "A";
  const s12 = h % 12 === 0 ? 12 : h % 12;
  const e12 = endH % 12 === 0 ? 12 : endH % 12;
  // Compact: drop the meridiem on the start when both share it.
  return startAmpm === endAmpm ? `${s12}-${e12}${endAmpm}` : `${s12}${startAmpm}-${e12}${endAmpm}`;
}

function bandsForRange(startHour: number, endHour: number): HourBand[] {
  const out: HourBand[] = [];
  for (let h = startHour; h < endHour; h++) {
    out.push({ start: hh(h), end: hh(h + 1), label: bandLabel(h) });
  }
  return out;
}

// Weekday band: 15:00 → 22:00 (7 atoms).
export const WEEKDAY_BANDS: HourBand[] = bandsForRange(15, 22);

// Weekend band: 08:00 → 12:00 (4) + 15:00 → 22:00 (7) = 11 atoms.
export const WEEKEND_BANDS: HourBand[] = [
  ...bandsForRange(8, 12),
  ...bandsForRange(15, 22),
];

export function bandsForDay(day: DayNum): HourBand[] {
  const meta = DAYS.find((d) => d.num === day);
  return meta?.weekend ? WEEKEND_BANDS : WEEKDAY_BANDS;
}

/** Map a JS Date.getDay() (0=Sun..6=Sat) to our DayNum (1=Mon..7=Sun). */
export function jsDowToDayNum(jsDow: number): DayNum {
  return (jsDow === 0 ? 7 : jsDow) as DayNum;
}

/** Today's DayNum. */
export function todayDayNum(): DayNum {
  return jsDowToDayNum(new Date().getDay());
}

export function fmtTime12(time24: string): string {
  const [h, m] = time24.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
}

/** Format LKR with thousands separators: 12500 → "Rs 12,500". */
export function fmtLKR(amount: number): string {
  return `Rs ${Math.round(amount).toLocaleString("en-US")}`;
}
