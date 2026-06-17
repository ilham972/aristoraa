'use client';

// The Library timetable — STUDENT-CENTRIC. Each grid cell is a 1-hour slot;
// students are tap-and-dropped into it from the rail above. A cell shows DOTS
// (one per student, capped) plus the headcount. Two interaction modes:
//
//   • place mode (a student picked up in the rail): tapping a cell drops THAT
//     student into the slot. The grid also lights up the picked student's
//     world — their existing paper slots (green), their theory/main classes
//     (a solid coloured block, dots hidden) and their outside-busy windows
//     (muted) — so you instantly see where they're free.
//   • normal mode (nothing picked up): tapping a NON-empty cell opens the
//     slot dialog (rooms + teachers + remove).
//
// Scrolls vertically — stacked dots need room to breathe.

import { cn } from '@/lib/utils';
import { groupColor } from '@/lib/groups/color';
import { DAYS, WEEKEND_BANDS, todayDayNum, type HourBand } from '@/lib/groups/time-grid';

export type SlotCell = {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  count: number;
};

export type StudentHighlight = {
  paperSlots: Array<{ dayOfWeek: number; startTime: string }>;
  theorySlots: Array<{ dayOfWeek: number; startTime: string; endTime: string; groupName: string }>;
  busy: Array<{ dayOfWeek: number; startTime: string; endTime: string; label?: string }>;
} | null;

function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart < bEnd && aEnd > bStart;
}

// A small dot cluster + count for an occupied cell.
function Dots({ count, tone }: { count: number; tone: 'normal' | 'assigned' }) {
  const shown = Math.min(count, 6);
  return (
    <div className="flex items-center gap-1">
      <div className="flex flex-wrap gap-[2px] max-w-[34px]">
        {Array.from({ length: shown }).map((_, i) => (
          <span
            key={i}
            className={cn(
              'w-1.5 h-1.5 rounded-full',
              tone === 'assigned' ? 'bg-emerald-400' : 'bg-primary/70',
            )}
          />
        ))}
      </div>
      <span className="text-[11px] font-bold tabular-nums text-foreground">{count}</span>
    </div>
  );
}

export function LibraryGrid({
  cells,
  highlight,
  placing,
  onDropAt,
  onOpenSlot,
}: {
  cells: SlotCell[];
  highlight: StudentHighlight;
  placing: boolean;
  onDropAt: (dayOfWeek: number, band: HourBand) => void;
  onOpenSlot: (dayOfWeek: number, band: HourBand) => void;
}) {
  const today = todayDayNum();
  const rows = WEEKEND_BANDS;

  const countAt = (day: number, band: HourBand): number =>
    cells.find((c) => c.dayOfWeek === day && c.startTime === band.start)?.count ?? 0;

  const paperSet = new Set(
    (highlight?.paperSlots ?? []).map((p) => `${p.dayOfWeek}|${p.startTime}`),
  );

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
                className={cn('grid grid-cols-[36px_repeat(7,1fr)] gap-1', isAfterGap && 'mt-1')}
              >
                <div className="sticky left-0 z-10 bg-background text-[10px] text-muted-foreground/70 text-right pr-1 flex items-start justify-end pt-1 tabular-nums">
                  {band.label}
                </div>
                {DAYS.map((d) => {
                  const isMorning = band.start < '12:00';
                  const closed = !d.weekend && isMorning;
                  if (closed) {
                    return <div key={d.num} className="rounded-md bg-muted/20 min-h-[40px]" />;
                  }

                  const count = countAt(d.num, band);
                  const assignedHere = paperSet.has(`${d.num}|${band.start}`);
                  const theoryHit = highlight?.theorySlots.find(
                    (t) => t.dayOfWeek === d.num && overlaps(band.start, band.end, t.startTime, t.endTime),
                  );
                  const busyHit = highlight?.busy.find(
                    (b) => b.dayOfWeek === d.num && overlaps(band.start, band.end, b.startTime, b.endTime),
                  );

                  const onClick = () => {
                    if (placing) onDropAt(d.num, band);
                    else if (count > 0) onOpenSlot(d.num, band);
                  };

                  // Theory class — solid coloured block, dots hidden (the
                  // student is in their main class then, so don't pile paper on).
                  if (highlight && theoryHit && !assignedHere) {
                    const c = groupColor(theoryHit.groupName);
                    return (
                      <button
                        key={d.num}
                        onClick={onClick}
                        className="min-h-[40px] rounded-md px-1 py-1 text-left overflow-hidden"
                        style={{ backgroundColor: c.solid, color: c.onSolid }}
                        title={`In class: ${theoryHit.groupName}`}
                      >
                        <span className="text-[9px] font-semibold leading-tight line-clamp-2">
                          {theoryHit.groupName}
                        </span>
                      </button>
                    );
                  }

                  // Outside-busy window — muted, "busy".
                  if (highlight && busyHit && !assignedHere) {
                    return (
                      <button
                        key={d.num}
                        onClick={onClick}
                        className="min-h-[40px] rounded-md px-1 py-1 text-left bg-muted/60 border border-border/50 text-muted-foreground overflow-hidden"
                        title={busyHit.label ?? 'Busy (outside class)'}
                      >
                        <span className="text-[9px] leading-tight line-clamp-2">
                          {busyHit.label ?? 'Busy'}
                        </span>
                      </button>
                    );
                  }

                  return (
                    <button
                      key={d.num}
                      onClick={onClick}
                      className={cn(
                        'min-h-[40px] rounded-md px-1.5 py-1 flex items-center justify-center transition-colors',
                        assignedHere && 'ring-2 ring-emerald-500/70 bg-emerald-500/5',
                        !assignedHere && count > 0 && 'bg-primary/5 border border-primary/20',
                        !assignedHere && count === 0 && placing && 'border border-dashed border-primary/50 hover:bg-primary/5',
                        !assignedHere && count === 0 && !placing && 'border border-dashed border-border/30',
                        placing && 'active:scale-95',
                      )}
                      title={placing ? 'Tap to add the picked student here' : count > 0 ? 'Open slot' : ''}
                    >
                      {count > 0 ? (
                        <Dots count={count} tone={assignedHere ? 'assigned' : 'normal'} />
                      ) : placing ? (
                        <span className="text-primary/60 text-sm leading-none">+</span>
                      ) : null}
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
