// Single source of truth for per-student off-days.
//
// The centre operates every day of the week — there are NO default off-days.
// A student is "off" on a date only when that date's weekday is explicitly
// listed in their `students.offDays` field. Previously this defaulted to
// ["sunday"], which wrongly flagged EVERY student (none have offDays set) as
// off on Sundays — hiding the Generate-sheet button on the Sheets tab and
// excluding them from tomorrow's WhatsApp reminders.
//
// Values in `offDays` are lowercase weekday names ("sunday", "monday", ...);
// matching is case-insensitive and whitespace-trimmed.
export const DEFAULT_OFF_DAYS: readonly string[] = [];

const WEEKDAY_NAMES = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

// Weekday name for a YYYY-MM-DD date string, evaluated in UTC. Returns null
// for an unparseable string.
export function weekdayNameFromDateStr(dateStr: string): string | null {
  const ms = Date.parse(`${dateStr}T00:00:00.000Z`);
  if (Number.isNaN(ms)) return null;
  return WEEKDAY_NAMES[new Date(ms).getUTCDay()];
}

// True when `dateStr`'s weekday falls on one of the student's off-days.
// `offDays` undefined → DEFAULT_OFF_DAYS (empty → never off).
export function isOffDayForDate(
  offDays: string[] | undefined,
  dateStr: string,
): boolean {
  const day = weekdayNameFromDateStr(dateStr);
  if (!day) return false;
  const set = new Set(
    (offDays ?? DEFAULT_OFF_DAYS).map((d) => String(d).toLowerCase().trim()),
  );
  return set.has(day);
}
