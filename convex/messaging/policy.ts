// Phase W policy + pacing — the constants and small time helpers that make
// the outbox sender behave like a human and not a blast script.
//
// Per whatsapp_integration_plan.md §5.1. Constants are literal here in W.1;
// later phases (G+) may migrate them into a `messagingConfig` table so they
// can be tuned from a UI without redeploy. Until then, change-by-edit.

export const PACING = {
  // Time between consecutive sends. Random within [MIN, MAX] then jittered ±JITTER.
  MIN_GAP_MS: 35_000,                       // 35 seconds floor
  MAX_GAP_MS: 120_000,                      // 2 minutes ceiling
  JITTER_MS: 15_000,                        // extra randomness on top

  // Asia/Colombo wall-clock window during which we never send.
  QUIET_HOURS_START: 21,                    // 21:00 inclusive
  QUIET_HOURS_END: 7,                       // 07:00 exclusive

  // Per-recipient floor — never message the same phone twice within this window.
  // Inbound auto-acks naturally land just outside this floor (~2 min after the
  // parent's message) so the bot feels like it's typing rather than auto-replying.
  PER_NUMBER_COOLDOWN_MS: 5 * 60_000,       // 5 minutes

  // Global volume ceilings. Counted against messageLog `direction = "out"` rows.
  PER_HOUR_CAP: 60,                         // 60/hour
  PER_DAY_CAP: 400,                         // 400/Asia-Colombo-day

  // Transient-failure retry policy (per message). After MAX_RETRIES the row
  // moves to status="failed" and a whatsapp_send_failed notification fires.
  MAX_RETRIES: 3,
  RETRY_BACKOFF_MS: [60_000, 5 * 60_000, 30 * 60_000] as const,
} as const;

// Asia/Colombo is UTC+05:30 year-round (no DST). Bake the offset in instead
// of pulling a tz library — saves a dep and the math stays trivial.
const MS_PER_MIN = 60_000;
const COLOMBO_OFFSET_MS = 330 * MS_PER_MIN;

function colomboWall(ms: number): Date {
  return new Date(ms + COLOMBO_OFFSET_MS);
}

export function isQuietHourColombo(ms: number): boolean {
  const h = colomboWall(ms).getUTCHours();
  return h >= PACING.QUIET_HOURS_START || h < PACING.QUIET_HOURS_END;
}

// Given a moment inside (or about to enter) the quiet window, return the next
// 07:00 Asia/Colombo as UTC ms. Used by the sender to push deferred messages
// forward instead of dropping them.
export function nextNonQuietMs(ms: number): number {
  const d = colomboWall(ms);
  const h = d.getUTCHours();
  const targetY = d.getUTCFullYear();
  const targetMo = d.getUTCMonth();
  const targetD = h < PACING.QUIET_HOURS_END ? d.getUTCDate() : d.getUTCDate() + 1;
  const targetColomboMs = Date.UTC(targetY, targetMo, targetD, PACING.QUIET_HOURS_END, 0, 0);
  return targetColomboMs - COLOMBO_OFFSET_MS;
}

// Asia/Colombo midnight (00:00) as UTC ms for the day containing `ms`.
export function colomboDayStartMs(ms: number): number {
  const d = colomboWall(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0) - COLOMBO_OFFSET_MS;
}

// One hour window ending now (inclusive).
export function hourAgo(ms: number): number {
  return ms - 3_600_000;
}

// Random pacing gap for the next send: uniform in [MIN, MAX] then jittered
// uniformly in ±JITTER, clamped to ≥ MIN/2 so we never go below floor.
export function randomGapMs(): number {
  const base = PACING.MIN_GAP_MS + Math.random() * (PACING.MAX_GAP_MS - PACING.MIN_GAP_MS);
  const jitter = (Math.random() * 2 - 1) * PACING.JITTER_MS;
  return Math.max(Math.round(base + jitter), Math.round(PACING.MIN_GAP_MS / 2));
}

// Backoff for retry attempt N (1-indexed: first retry = index 0).
export function backoffMs(attempt: number): number {
  const i = Math.min(attempt - 1, PACING.RETRY_BACKOFF_MS.length - 1);
  return PACING.RETRY_BACKOFF_MS[i];
}
