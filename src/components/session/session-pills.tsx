'use client';

// SessionPills — the day's sessions as a row of tiny, pressable time pills,
// grouped into Morning / Afternoon / Evening bands (each led by a sun/moon
// icon). Each pill shows just the 12-hour start hour (no am/pm — the band
// icon disambiguates 8am vs 8pm). Colour encodes state so the user can scan
// the day and instantly spot which past sessions are still UNLOGGED (red):
//
//   live now      → filled primary, gently pulsing
//   needs entry   → red (past + unlogged) — the don't-miss signal
//   logged        → emerald
//   cancelled     → muted, struck through
//   upcoming      → subtle outline
//   pre-tracking  → muted, non-pressable (existed before tracking began)
//
// The currently-open session gets a primary ring layered on top of its
// state colour. Tapping a pill swaps the workspace below — no navigation.

import { Sunrise, Sun, Moon } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Id } from '@/lib/convex';
import { fmtTime12 } from '@/lib/groups/time-grid';
import { timeBand, hourLabel, isLive, isPast, type TimeBand } from '@/lib/groups/session-time';

export type PillSession = {
  slotId: Id<'scheduleSlots'>;
  date: string;
  groupName: string;
  startTime: string;
  endTime: string;
  logStatus: 'unlogged' | 'held' | 'cancelled' | 'pre-tracking';
};

type PillState = 'live' | 'needs-entry' | 'logged' | 'cancelled' | 'upcoming' | 'pre-tracking';

function pillState(s: PillSession, now: Date): PillState {
  if (s.logStatus === 'pre-tracking') return 'pre-tracking';
  if (s.logStatus === 'cancelled') return 'cancelled';
  if (s.logStatus === 'held') return 'logged';
  if (isLive(s.date, s.startTime, s.endTime, now)) return 'live';
  if (isPast(s.date, s.startTime, now)) return 'needs-entry';
  return 'upcoming';
}

const BANDS: Array<{ key: TimeBand; Icon: typeof Sun; label: string }> = [
  { key: 'morning', Icon: Sunrise, label: 'Morning' },
  { key: 'afternoon', Icon: Sun, label: 'Afternoon' },
  { key: 'evening', Icon: Moon, label: 'Evening' },
];

export function SessionPills({
  sessions,
  selected,
  onSelect,
  now,
}: {
  sessions: PillSession[];
  selected: { slotId: Id<'scheduleSlots'>; date: string } | null;
  onSelect: (s: { slotId: Id<'scheduleSlots'>; date: string }) => void;
  now: Date;
}) {
  const grouped = BANDS.map((b) => ({
    ...b,
    items: sessions.filter((s) => timeBand(s.startTime) === b.key),
  })).filter((b) => b.items.length > 0);

  return (
    <div className="flex items-center gap-1 overflow-x-auto pb-1">
      {grouped.map((b, gi) => (
        <div key={b.key} className="flex items-center gap-1 shrink-0">
          {gi > 0 && <span className="w-px h-5 bg-border/60 mx-1" />}
          <b.Icon className="w-3.5 h-3.5 text-muted-foreground shrink-0" aria-label={b.label} />
          {b.items.map((s) => {
            const st = pillState(s, now);
            const isSel = selected?.slotId === s.slotId && selected?.date === s.date;
            const disabled = st === 'pre-tracking';
            return (
              <button
                key={s.slotId}
                type="button"
                disabled={disabled}
                onClick={() => !disabled && onSelect({ slotId: s.slotId, date: s.date })}
                title={`${s.groupName} · ${fmtTime12(s.startTime)} – ${fmtTime12(s.endTime)}`}
                className={cn(
                  'shrink-0 w-8 h-8 rounded-lg text-xs font-bold tabular-nums flex items-center justify-center transition-all',
                  st === 'live' && 'bg-primary text-primary-foreground animate-pulse',
                  st === 'needs-entry' && 'bg-destructive/15 text-destructive border border-destructive/50',
                  st === 'logged' && 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30',
                  st === 'cancelled' && 'bg-muted text-muted-foreground/60 line-through',
                  st === 'upcoming' && 'bg-muted text-muted-foreground border border-border/60',
                  st === 'pre-tracking' && 'bg-muted/30 text-muted-foreground/40 cursor-not-allowed',
                  isSel && 'ring-2 ring-primary ring-offset-2 ring-offset-background',
                )}
              >
                {hourLabel(s.startTime)}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
