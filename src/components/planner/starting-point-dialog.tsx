'use client';

// StartingPointButton — sets where a cold-started group actually begins
// (2026-07-15). A group that covered Terms 1–2 before the app has an empty
// seen-set, so the planner restarts the term walk at track unit 1. This is
// the fix: tap the last unit taught before the app; it and everything above
// it turn "done" and drop out of every projection (skeleton, crystallize,
// capacity, calendar) — no sheets, points, or memory touched. Reversible:
// tap an earlier unit to move the line back, or "Start from the beginning".

import { useMemo, useState } from 'react';
import { useMutation } from 'convex/react';
import { Check, Flag, RotateCcw, X } from 'lucide-react';
import { toast } from 'sonner';
import { api, type Id } from '@/lib/convex';
import { cn } from '@/lib/utils';

export type StartingPointUnit = {
  unitId: string;
  verdict: string;
  preTaught: boolean;
};

export function StartingPointButton({
  groupId,
  units,
  unitName,
  className,
}: {
  groupId: Id<'groups'>;
  units: StartingPointUnit[];
  unitName: (unitId: string) => string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const preTaughtCount = units.filter((u) => u.preTaught).length;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={cn(
          'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-[11px] font-semibold',
          preTaughtCount > 0
            ? 'border-teal-400/50 bg-teal-400/10 text-teal-300'
            : 'border-border bg-card text-muted-foreground hover:text-foreground',
          className,
        )}
      >
        <Flag className="w-3.5 h-3.5" />
        {preTaughtCount > 0
          ? `Starts after ${preTaughtCount} pre-app unit${preTaughtCount === 1 ? '' : 's'}`
          : 'Set starting point'}
      </button>
      {open && (
        <StartingPointDialog
          groupId={groupId}
          units={units}
          unitName={unitName}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function StartingPointDialog({
  groupId,
  units,
  unitName,
  onClose,
}: {
  groupId: Id<'groups'>;
  units: StartingPointUnit[];
  unitName: (unitId: string) => string;
  onClose: () => void;
}) {
  const setStartingPoint = useMutation(
    api.learningEngine.groupPlan.setGroupStartingPoint,
  );
  const [busy, setBusy] = useState<string | null>(null);

  // Boundary = index of the last pre-taught unit (units are in track order).
  const boundaryIdx = useMemo(() => {
    let last = -1;
    units.forEach((u, i) => {
      if (u.preTaught) last = i;
    });
    return last;
  }, [units]);

  const apply = async (throughUnitId: string | null, key: string) => {
    setBusy(key);
    try {
      const res = await setStartingPoint({ groupId, throughUnitId });
      toast.success(
        res.marked === 0
          ? 'Starting from the beginning — every unit is back in the plan.'
          : `Starting point set: ${res.marked} unit${res.marked === 1 ? '' : 's'} marked taught before the app.`,
      );
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed');
      setBusy(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-2 pb-[calc(4rem+env(safe-area-inset-bottom,0px)+0.5rem)] sm:pb-2"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-card border border-border shadow-xl max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-2 px-4 py-3 border-b border-border">
          <Flag className="w-4 h-4 text-teal-300 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-bold text-foreground">Starting point</div>
            <div className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
              Tap the last unit this group finished before the app. It and every
              unit above it turn green and leave the plan — no sheets, no points,
              no memory changed.
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md hover:bg-muted text-muted-foreground shrink-0"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="overflow-y-auto px-2 py-2">
          {/* Clear — start from the beginning */}
          <button
            onClick={() => apply(null, 'clear')}
            disabled={busy !== null || boundaryIdx < 0}
            className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-left hover:bg-muted/50 disabled:opacity-40"
          >
            <RotateCcw className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            <span className="text-[12px] font-semibold text-foreground">
              Start from the beginning
            </span>
            {boundaryIdx < 0 && (
              <span className="ml-auto text-[10px] text-muted-foreground">current</span>
            )}
          </button>

          <div className="h-px bg-border my-1.5 mx-2" />

          <div className="space-y-0.5">
            {units.map((u, i) => {
              const taught = i <= boundaryIdx;
              const isBoundary = i === boundaryIdx;
              return (
                <button
                  key={u.unitId}
                  onClick={() => apply(u.unitId, u.unitId)}
                  disabled={busy !== null}
                  className={cn(
                    'w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-left disabled:opacity-60',
                    taught ? 'bg-teal-400/10' : 'hover:bg-muted/50',
                  )}
                >
                  <span
                    className={cn(
                      'w-4 h-4 rounded-full border flex items-center justify-center shrink-0',
                      taught
                        ? 'bg-teal-400/80 border-teal-400 text-background'
                        : 'border-border',
                    )}
                  >
                    {taught && <Check className="w-3 h-3" strokeWidth={3} />}
                  </span>
                  <span
                    className={cn(
                      'text-[12px] truncate',
                      taught ? 'text-teal-200 font-semibold' : 'text-foreground',
                    )}
                  >
                    {unitName(u.unitId)}
                  </span>
                  {isBoundary && (
                    <span className="ml-auto text-[9px] font-bold uppercase tracking-wide text-teal-300 shrink-0">
                      starts here
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
