'use client';

// LearningModeCard — per-student engine mode switch (departments redesign,
// 2026-07-14). Replaces the retired global Coverage Mode toggle.
//   normal        — coverage ladder: unseen book questions easy→hard, no
//                   repeats (the engine default for every regular student).
//   consolidation — weak-student fallback: difficulty-matched picks with
//                   repeats in the INDIVIDUAL sections until they stabilise.
// The switch is manual; the daily engine-alert scan only suggests flips.
// This card shows the same numbers the scan acts on (engineAlerts.
// consolidationStatus) so the human decides with the data in view.

import { useMutation } from 'convex/react';
import { LifeBuoy, TrendingUp } from 'lucide-react';
import { useCachedQuery } from '@/hooks/use-cached-query';
import { api, type Id } from '@/lib/convex';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

export function LearningModeCard({ studentId }: { studentId: Id<'students'> }) {
  const status = useCachedQuery(api.engineAlerts.consolidationStatus, {
    studentId,
  });
  const setLearningMode = useMutation(api.students.setLearningMode);

  if (!status) return null;

  const consolidating = status.mode === 'consolidation';
  const pct =
    status.failRate === null ? null : Math.round(status.failRate * 100);
  const suggestsOn = status.verdict === 'suggest-consolidation';
  const suggestsOff = status.verdict === 'suggest-normal';

  return (
    <div
      className={cn(
        'mb-4 rounded-xl border px-3 py-2.5',
        consolidating
          ? 'border-amber-500/50 bg-amber-500/10'
          : 'border-border bg-card',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
            {consolidating ? (
              <LifeBuoy className="w-3.5 h-3.5 text-amber-500" />
            ) : (
              <TrendingUp className="w-3.5 h-3.5 text-primary" />
            )}
            {consolidating ? 'Consolidation mode' : 'Normal mode'}
          </div>
          <div className="text-[10px] text-muted-foreground mt-0.5">
            {consolidating
              ? 'Repeat-heavy revision: difficulty-matched picks, failed questions return until stable.'
              : 'Coverage ladder: unseen book questions easy→hard, no repeats.'}
            {pct !== null && (
              <>
                {' '}
                Failures last {status.windowDays}d: <b>{pct}%</b> of{' '}
                {status.attemptCount} questions.
              </>
            )}
          </div>
          {(suggestsOn || suggestsOff) && (
            <div
              className={cn(
                'text-[10px] font-semibold mt-1',
                suggestsOn ? 'text-amber-500' : 'text-emerald-500',
              )}
            >
              {suggestsOn
                ? 'System suggests: switch to consolidation.'
                : 'System suggests: recovered — switch back to normal.'}
            </div>
          )}
        </div>
        <button
          onClick={async () => {
            const next = consolidating ? 'normal' : 'consolidation';
            try {
              await setLearningMode({ id: studentId, mode: next });
              toast.success(
                next === 'consolidation'
                  ? 'Consolidation mode ON — repeat-heavy revision'
                  : 'Back to normal mode — coverage ladder',
              );
            } catch (e) {
              toast.error(e instanceof Error ? e.message : 'Failed to update');
            }
          }}
          className={cn(
            'shrink-0 w-11 h-6 rounded-full transition-colors relative',
            consolidating ? 'bg-amber-500' : 'bg-muted-foreground/30',
          )}
          aria-label="Toggle consolidation mode"
        >
          <span
            className={cn(
              'absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-all',
              consolidating ? 'left-[22px]' : 'left-0.5',
            )}
          />
        </button>
      </div>
    </div>
  );
}
