// Pure helpers for the Track Progress view.
// Spec: docs/superpowers/specs/2026-07-10-track-progress-view-design.md
//
// No Convex imports — unit-tested in tests/trackProgress.test.ts (same
// pattern as rosterMoves.ts / paperClasses.ts). The Convex query
// (convex/learningEngine/trackProgress.ts) is a thin data-loader over these
// functions; ALL derivation rules live here so the view's predictions can be
// tested against the planner's constants without a database.
//
// CONTRACT: the sessions-left math MUST mirror planner.ts's autoMainConcepts
// (Phase 6/7) exactly — the caller passes the planner's own config constants
// so the view can never promise a pace the sheet generator won't deliver.

export const MS_PER_DAY = 86_400_000;

export type CoreConcept = { taught: boolean; mastery: number | null };
export type CoreUnit = {
  unitId: string;
  inScope: boolean;
  concepts: CoreConcept[];
};
export type UnitTier = "mastered" | "taught" | "pending";
export type UnitStatus = "mastered" | "taught" | "current" | "upcoming";

// Minutes between two "HH:MM" clock strings. Null on malformed input or
// non-positive duration (mirrors the planner's local helper).
export function minutesBetweenClock(start: string, end: string): number | null {
  const re = /^(\d{1,2}):(\d{2})$/;
  const s = re.exec(start);
  const e = re.exec(end);
  if (!s || !e) return null;
  const diff =
    Number(e[1]) * 60 + Number(e[2]) - (Number(s[1]) * 60 + Number(s[2]));
  return diff > 0 ? diff : null;
}

// Two-tier done rule (founder decision 2026-07-10):
//   TAUGHT   = every concept attempted at least once.
//   MASTERED = taught AND mean mastery ≥ masteryThreshold.
// Zero-concept units are "pending" — the caller flags them noSyllabus and
// they are excluded from the frontier and from counts.
export function unitTier(
  concepts: CoreConcept[],
  masteryThreshold: number,
): UnitTier {
  if (concepts.length === 0) return "pending";
  if (concepts.some((c) => !c.taught)) return "pending";
  const mean =
    concepts.reduce((s, c) => s + (c.mastery ?? 0), 0) / concepts.length;
  return mean >= masteryThreshold ? "mastered" : "taught";
}

// Mean mastery over the concepts that HAVE been taught (partial units show
// "how is what we've covered holding?"). Null when nothing is taught yet.
export function taughtMeanMastery(concepts: CoreConcept[]): number | null {
  const taught = concepts.filter((c) => c.taught && c.mastery !== null);
  if (taught.length === 0) return null;
  return (
    taught.reduce((s, c) => s + (c.mastery as number), 0) / taught.length
  );
}

// Statuses along the track. The frontier ("current") is the first pending
// unit the planner can actually serve — in scope and with ≥1 concept —
// mirroring the Main block's orderedNew walk. Every other pending unit is
// "upcoming" (including out-of-scope ones; the caller badges those).
export function deriveUnitStatuses(
  units: CoreUnit[],
  masteryThreshold: number,
): UnitStatus[] {
  const tiers = units.map((u) => unitTier(u.concepts, masteryThreshold));
  let frontier = -1;
  for (let i = 0; i < units.length; i++) {
    if (tiers[i] !== "pending") continue;
    if (!units[i].inScope) continue;
    if (units[i].concepts.length === 0) continue;
    if (units[i].concepts.every((c) => c.taught)) continue; // defensive
    frontier = i;
    break;
  }
  return tiers.map((t, i) =>
    t !== "pending" ? t : i === frontier ? "current" : "upcoming",
  );
}

// Mirrors planner.ts autoMainConcepts EXACTLY:
//   pacing set  → clamp(round(conceptsPerHour × sessionMinutes / 60), min, max)
//   pacing null → clamp(round(sessionMinutes / minutesPerNewConcept), min, max)
export function conceptsPerSession(args: {
  pacingPerHour: number | null;
  sessionMinutes: number;
  minutesPerNewConcept: number;
  minConcepts: number;
  maxConcepts: number;
}): number {
  const raw =
    args.pacingPerHour !== null
      ? (args.pacingPerHour * args.sessionMinutes) / 60
      : args.sessionMinutes / args.minutesPerNewConcept;
  return Math.max(
    args.minConcepts,
    Math.min(args.maxConcepts, Math.round(raw)),
  );
}

export function sessionsLeftForUnit(
  untaughtCount: number,
  cps: number,
): number {
  if (untaughtCount <= 0) return 0;
  return Math.ceil(untaughtCount / Math.max(1, cps));
}

export function ymdFromMs(ms: number): string {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

// Projected calendar finish: remaining sessions spread over sessions/week.
// Null when the student has no weekly schedule (caller shows sessions-only).
export function projectFinishYmd(args: {
  sessionsLeftTotal: number;
  sessionsPerWeek: number;
  todayMs: number;
}): string | null {
  if (args.sessionsPerWeek <= 0) return null;
  if (args.sessionsLeftTotal <= 0) return ymdFromMs(args.todayMs);
  const weeks = Math.ceil(args.sessionsLeftTotal / args.sessionsPerWeek);
  return ymdFromMs(args.todayMs + weeks * 7 * MS_PER_DAY);
}
