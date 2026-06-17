'use client';

// The Library timetable — paper (self-study) blocks laid out like the Week
// grid, but a cell can hold MORE THAN ONE block because different rooms can
// run at the same time. Each block is a chip coloured by room, showing the
// room name, supervising teacher and headcount (x / capacity). Tap a chip →
// open that block's manager. Tap a cell's "+" → create a new block there.
//
// Unlike the Week grid this scrolls vertically: stacked chips need room to
// breathe, so rows use a min-height rather than squeezing into the viewport.

import { cn } from '@/lib/utils';
import { groupColor } from '@/lib/groups/color';
import { DAYS, WEEKEND_BANDS, todayDayNum, type HourBand } from '@/lib/groups/time-grid';
import type { Id } from '@/lib/convex';

export type BlockCell = {
  blockId: Id<'paperBlocks'>;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  roomId: Id<'rooms'>;
  roomName: string;
  capacity?: number;
  teacherId: Id<'teachers'>;
  teacherName: string;
  memberCount: number;
};

export function LibraryGrid({
  cells,
  onOpenBlock,
  onCreateAt,
}: {
  cells: BlockCell[];
  onOpenBlock: (blockId: Id<'paperBlocks'>) => void;
  onCreateAt: (dayOfWeek: number, band: HourBand) => void;
}) {
  const today = todayDayNum();
  const rows = WEEKEND_BANDS;

  // Blocks anchored at a (day, band) — we render a block in the band where it
  // STARTS. The chip's own time range makes its length clear, so we don't draw
  // multi-band spans (which would collide with other rooms' blocks).
  const blocksAt = (day: number, band: HourBand): BlockCell[] =>
    cells.filter((c) => c.dayOfWeek === day && c.startTime === band.start);

  return (
    <div className="flex-1 min-h-0 overflow-auto -mx-3 px-3">
      <div className="min-w-[640px]">
        {/* Header row */}
        <div className="grid grid-cols-[36px_repeat(7,1fr)] gap-1 mb-1 sticky top-0 z-20 bg-background pb-1">
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

        <div className="flex flex-col gap-[2px]">
          {rows.map((band, ri) => {
            const prev = rows[ri - 1];
            const isAfterGap = prev && prev.end === '12:00' && band.start === '15:00';
            return (
              <div
                key={band.start}
                className={cn(
                  'grid grid-cols-[36px_repeat(7,1fr)] gap-1',
                  isAfterGap && 'mt-1',
                )}
              >
                <div className="sticky left-0 z-10 bg-background text-[10px] text-muted-foreground/70 text-right pr-1 flex items-start justify-end pt-1 tabular-nums">
                  {band.label}
                </div>
                {DAYS.map((d) => {
                  const isMorning = band.start < '12:00';
                  const disabled = !d.weekend && isMorning;
                  const here = blocksAt(d.num, band);

                  if (disabled) {
                    return <div key={d.num} className="rounded-md bg-muted/20 min-h-[34px]" />;
                  }

                  return (
                    <div key={d.num} className="min-h-[34px] flex flex-col gap-[2px]">
                      {here.map((c) => {
                        const color = groupColor(c.roomId);
                        const full = c.capacity != null && c.memberCount >= c.capacity;
                        return (
                          <button
                            key={c.blockId}
                            onClick={() => onOpenBlock(c.blockId)}
                            className="px-1.5 py-1 rounded-md text-left overflow-hidden transition-transform active:scale-95"
                            style={{ backgroundColor: color.solid, color: color.onSolid }}
                            title={`${c.roomName} · ${c.teacherName} · ${c.memberCount}${c.capacity != null ? `/${c.capacity}` : ''}`}
                          >
                            <div className="text-[10px] font-semibold leading-tight truncate">
                              {c.roomName}
                            </div>
                            <div className="flex items-center justify-between gap-1 mt-0.5">
                              <span className="text-[8px] opacity-90 truncate">{c.teacherName}</span>
                              <span
                                className={cn(
                                  'text-[8px] font-bold tabular-nums shrink-0',
                                  full && 'text-amber-200',
                                )}
                              >
                                {c.memberCount}
                                {c.capacity != null ? `/${c.capacity}` : ''}
                              </span>
                            </div>
                          </button>
                        );
                      })}
                      {/* Add-a-block affordance for this cell. */}
                      <button
                        onClick={() => onCreateAt(d.num, band)}
                        className={cn(
                          'rounded-md border border-dashed border-border/40 hover:border-primary/50 hover:bg-primary/5 transition-colors text-muted-foreground/0 hover:text-primary/60 text-sm leading-none flex items-center justify-center',
                          here.length > 0 ? 'h-3.5 text-[10px]' : 'flex-1 min-h-[34px]',
                        )}
                        title="Add paper block here"
                      >
                        +
                      </button>
                    </div>
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
