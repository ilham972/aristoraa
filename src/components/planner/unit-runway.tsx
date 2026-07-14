'use client';

// UnitRunway — the compact "how much book is left" strip shared by the Term
// board cards and the group plan page. One horizontal scroll row: every
// remaining unit of the group's track in teaching order, coloured by its
// runway verdict, with unseen count + projected finish. Replaces the old
// full-width repeated unit list (founder: too much repetition).

import { cn } from '@/lib/utils';
import { VERDICT_CHIP, VERDICT_DOT, fmtShortDate } from './verdict';

export type RunwayUnit = {
  unitId: string;
  unseenCount: number;
  projectedFinishDate: string | null;
  examDate: string | null;
  verdict: string;
};

export function UnitRunway({
  units,
  unitName,
  current,
}: {
  units: RunwayUnit[];
  unitName: (unitId: string) => string;
  current?: string | null;
}) {
  const remaining = units.filter((u) => u.verdict !== 'done');
  if (remaining.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card px-3 py-2 text-[11px] text-muted-foreground">
        Book finished — every unit on the track is covered. 🎉
      </div>
    );
  }
  return (
    <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-0.5 px-0.5">
      {remaining.map((u) => {
        const isCurrent = current != null && u.unitId === current;
        return (
          <div
            key={u.unitId}
            className={cn(
              'shrink-0 rounded-lg border px-2 py-1.5 min-w-[7.5rem] max-w-[10rem]',
              isCurrent ? 'border-primary/60 bg-primary/5' : 'border-border bg-card',
            )}
          >
            <div className="flex items-center gap-1.5">
              <span
                className={cn(
                  'w-1.5 h-1.5 rounded-full shrink-0',
                  VERDICT_DOT[u.verdict] ?? 'bg-muted-foreground/40',
                )}
              />
              <span className="text-[11px] font-semibold text-foreground truncate">
                {unitName(u.unitId)}
              </span>
            </div>
            <div className="text-[10px] text-muted-foreground mt-0.5 truncate">
              {u.unseenCount} left
              {u.projectedFinishDate && <> · fin {fmtShortDate(u.projectedFinishDate)}</>}
              {u.examDate && <> · exam {fmtShortDate(u.examDate)}</>}
            </div>
            <div
              className={cn(
                'mt-1 inline-block px-1 py-px rounded border text-[8.5px] font-semibold leading-tight',
                (VERDICT_CHIP[u.verdict] ?? VERDICT_CHIP['no-exam']).className,
              )}
            >
              {(VERDICT_CHIP[u.verdict] ?? VERDICT_CHIP['no-exam']).label}
            </div>
          </div>
        );
      })}
    </div>
  );
}
