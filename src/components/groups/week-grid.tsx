'use client';

// The whole-week grid — the centrepiece of /groups, modelled on the user's
// reference scheduler but adapted for phone: a sticky time column on the left
// with day columns scrolling horizontally. Each cell is one group's session,
// colour-coded by group, showing name + member-count dots + revenue. Tap a
// cell → open that group's editor. Tap an empty cell → create a group there.

import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { resolveGroupColor } from '@/lib/groups/color';
import { fmtLKR, DAYS, WEEKEND_BANDS, todayDayNum, type HourBand } from '@/lib/groups/time-grid';
import type { Id } from '@/lib/convex';

type Cell = {
  slotId: Id<'scheduleSlots'>;
  groupId: Id<'groups'>;
  groupName: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  memberCount: number;
  hours: number;
  revenue: number;
  colorIndex?: number | null;
  colorKey?: string;
};

// Member-count dots, capped at 6 with a "+N" tail (matches the reference UI).
function Dots({ count }: { count: number }) {
  const shown = Math.min(count, 6);
  return (
    <span className="flex items-center gap-[2px]">
      {Array.from({ length: shown }).map((_, i) => (
        <span key={i} className="w-1 h-1 rounded-full bg-current opacity-70" />
      ))}
      {count > 6 && <span className="text-[8px] opacity-80 ml-0.5">+{count - 6}</span>}
      {count === 0 && <span className="text-[8px] opacity-60">empty</span>}
    </span>
  );
}

export function WeekGrid({
  cells,
  onOpenGroup,
  onCreateAt,
}: {
  cells: Cell[];
  onOpenGroup: (groupId: Id<'groups'>) => void;
  onCreateAt: (dayOfWeek: number, band: HourBand) => void;
}) {
  const today = todayDayNum();
  const rows = WEEKEND_BANDS; // superset of all bands

  // Group cells by day for overlap lookup. New sessions are 1-hour atoms, but
  // legacy slots may span multiple hours (e.g. 3–5PM). We render a band as
  // occupied when ANY of the day's cells overlaps it, so a multi-hour session
  // shows as a continuous block instead of leaving phantom empty cells.
  const byDay = useMemo(() => {
    const m = new Map<number, Cell[]>();
    for (const c of cells) {
      const arr = m.get(c.dayOfWeek) ?? [];
      arr.push(c);
      m.set(c.dayOfWeek, arr);
    }
    return m;
  }, [cells]);

  const cellAt = (day: number, band: HourBand): Cell | undefined =>
    (byDay.get(day) ?? []).find(
      (c) => c.startTime < band.end && c.endTime > band.start,
    );

  return (
    // flex-1 min-h-0 lets us fill the parent's remaining vertical space.
    // overflow-x-auto + overflow-y-hidden: slots scroll horizontally only,
    // never vertically. The -mx-3 / px-3 bleeds the scroll-track edge to
    // edge so the first/last column doesn't feel pinched against the page.
    <div className="flex-1 min-h-0 overflow-x-auto overflow-y-hidden -mx-3 px-3">
      <div className="min-w-[640px] flex flex-col h-full">
        {/* Header row. Time-corner cell is sticky-left so the weekday labels
            keep their column anchor while scrolling horizontally. */}
        <div className="grid grid-cols-[36px_repeat(7,1fr)] gap-1 mb-1 shrink-0">
          <div className="sticky left-0 z-20 bg-background" />
          {DAYS.map((d) => (
            <div
              key={d.num}
              className={cn(
                'text-center text-[11px] font-semibold py-1 rounded-md',
                d.num === today ? 'bg-primary/15 text-primary' : 'text-muted-foreground',
              )}
            >
              {d.short}
            </div>
          ))}
        </div>

        {/* Body. Bands are equally distributed across the remaining height
            (auto-rows: minmax(0,1fr)) — that's what keeps everything visible
            without vertical scrolling on a typical phone. The time column
            sticks to the left during horizontal scroll. */}
        <div className="flex-1 min-h-0 flex flex-col gap-[2px]">
          {rows.map((band, ri) => {
            const prev = rows[ri - 1];
            const isAfterGap = prev && prev.end === '12:00' && band.start === '15:00';
            return (
              <div
                key={band.start}
                className={cn(
                  'grid grid-cols-[36px_repeat(7,1fr)] gap-1 flex-1 min-h-0',
                  isAfterGap && 'mt-1',
                )}
              >
                <div className="sticky left-0 z-10 bg-background text-[10px] text-muted-foreground/70 text-right pr-1 flex items-center justify-end tabular-nums">
                  {band.label}
                </div>
                {DAYS.map((d) => {
                  const isMorning = band.start < '12:00';
                  const disabled = !d.weekend && isMorning;
                  const cell = cellAt(d.num, band);

                  if (disabled) {
                    return <div key={d.num} className="rounded-md bg-muted/20" />;
                  }
                  if (!cell) {
                    return (
                      <button
                        key={d.num}
                        onClick={() => onCreateAt(d.num, band)}
                        className="rounded-md border border-dashed border-border/40 hover:border-primary/50 hover:bg-primary/5 transition-colors text-muted-foreground/0 hover:text-primary/60 text-base leading-none flex items-center justify-center"
                      >
                        +
                      </button>
                    );
                  }
                  const color = resolveGroupColor(cell.colorIndex, cell.colorKey ?? cell.groupId);
                  const isHead = cell.startTime === band.start;
                  return (
                    <button
                      key={d.num}
                      onClick={() => onOpenGroup(cell.groupId)}
                      className={cn(
                        'px-1.5 py-0.5 text-left overflow-hidden transition-transform active:scale-95 flex flex-col justify-center min-h-0',
                        isHead ? 'rounded-md' : 'rounded-md -mt-[3px] pt-1',
                      )}
                      style={{ backgroundColor: color.solid, color: color.onSolid }}
                      title={`${cell.groupName} · ${cell.memberCount} · ${fmtLKR(cell.revenue)}`}
                    >
                      {isHead && (
                        <>
                          <div className="text-[10px] font-semibold leading-tight truncate">{cell.groupName}</div>
                          <div className="flex items-center justify-between mt-0.5">
                            <Dots count={cell.memberCount} />
                            <span className="text-[8px] font-medium opacity-90 tabular-nums">{fmtLKR(cell.revenue).replace('Rs ', '')}</span>
                          </div>
                        </>
                      )}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
