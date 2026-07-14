'use client';

// GroupPlanCard — one group on the Term board. The light listing row comes
// from plannerGroups; this card also subscribes the group's full lesson-plan
// walk (groupLessonPlan) to show the runway + verdicts. Only the selected
// grade's cards are mounted, so the heavy query never fans out to every
// group at once.

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useMutation } from 'convex/react';
import { AlertTriangle, ChevronRight, Sparkles, Users } from 'lucide-react';
import { toast } from 'sonner';
import { api, type Id } from '@/lib/convex';
import { cn } from '@/lib/utils';
import { useCachedQuery } from '@/hooks/use-cached-query';
import { ALL_CURRICULUM_UNITS } from '@/lib/track-progress-args';
import { UnitRunway } from './unit-runway';
import { fmtShortDate, fmtWeekdayDate } from './verdict';

export type PlannerGroupRow = {
  groupId: Id<'groups'>;
  name: string;
  grade: number | null;
  memberCount: number;
  studentsWithTrack: number;
  trackName: string | null;
  mainSlotCount: number;
  revisionSlotCount: number;
  nextSessionDate: string | null;
  crystallizedAhead: number;
  plannedThrough: string | null;
};

export function useUnitName(): (unitId: string) => string {
  return useMemo(() => {
    const m = new Map(ALL_CURRICULUM_UNITS.map((u) => [u.unitId, u.unitName]));
    return (unitId: string) => m.get(unitId) ?? unitId;
  }, []);
}

export function GroupPlanCard({ row }: { row: PlannerGroupRow }) {
  const plan = useCachedQuery(api.learningEngine.groupPlan.groupLessonPlan, {
    groupId: row.groupId,
  });
  const crystallize = useMutation(api.learningEngine.groupPlan.crystallizeUpcoming);
  const [busy, setBusy] = useState(false);
  const unitName = useUnitName();

  const wontFinish =
    plan?.status === 'ok'
      ? plan.units.filter((u) => u.verdict === 'wont-finish').length
      : 0;

  return (
    <div className="rounded-xl border border-border bg-card p-3">
      {/* Header: name + roster + planned-through */}
      <div className="flex items-center justify-between gap-2">
        <Link
          href={`/groups/${row.groupId as unknown as string}/plan`}
          className="min-w-0 flex items-center gap-1.5 group"
        >
          <span className="text-sm font-bold text-foreground truncate group-hover:text-primary">
            {row.name}
          </span>
          <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        </Link>
        <div className="flex items-center gap-1.5 shrink-0 text-[10px] text-muted-foreground">
          <Users className="w-3 h-3" />
          {row.memberCount}
          {row.trackName && <span className="truncate max-w-[7rem]">· {row.trackName}</span>}
        </div>
      </div>

      {/* Status line */}
      <div className="text-[11px] text-muted-foreground mt-0.5">
        {plan?.status === 'ok' && plan.currentUnitId && (
          <>
            now: <b className="text-foreground">{unitName(plan.currentUnitId)}</b>
          </>
        )}
        {row.nextSessionDate && <> · next {fmtWeekdayDate(row.nextSessionDate)}</>}
        {row.plannedThrough ? (
          <> · sheets ready → {fmtShortDate(row.plannedThrough)}</>
        ) : (
          <> · <span className="text-amber-500 font-semibold">no sheets crystallized</span></>
        )}
      </div>

      {/* Problem states */}
      {plan && plan.status !== 'ok' && (
        <div className="mt-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-amber-600 dark:text-amber-400">
          {plan.status === 'no-members' && 'No members yet — fill the group on the Groups board.'}
          {plan.status === 'no-track' && (
            <>
              No member rides a track yet ({row.studentsWithTrack}/{row.memberCount} assigned) —
              assign tracks on the Students page first.
            </>
          )}
          {plan.status === 'no-sessions' && 'No weekly sessions on the timetable.'}
        </div>
      )}

      {plan === undefined && (
        <div className="mt-2 h-14 rounded-lg bg-muted animate-pulse" />
      )}

      {plan?.status === 'ok' && (
        <>
          {wontFinish > 0 && (
            <div className="mt-1.5 flex items-center gap-1 text-[11px] font-semibold text-red-500">
              <AlertTriangle className="w-3 h-3" />
              {wontFinish} unit{wontFinish === 1 ? '' : 's'} won&apos;t finish before the exam
            </div>
          )}
          <div className="mt-2">
            <UnitRunway
              units={plan.units}
              unitName={unitName}
              current={plan.currentUnitId}
            />
          </div>
          <button
            onClick={async () => {
              setBusy(true);
              try {
                const res = await crystallize({ groupId: row.groupId });
                if (res.status !== 'ok') toast.error(`${row.name}: ${res.status}`);
                else if (res.written === 0)
                  toast.info(`${row.name}: window already planned.`);
                else toast.success(`${row.name}: ${res.written} sheet${res.written === 1 ? '' : 's'} crystallized`);
              } catch (e) {
                toast.error(e instanceof Error ? e.message : 'Failed');
              } finally {
                setBusy(false);
              }
            }}
            disabled={busy}
            className={cn(
              'mt-2 w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold disabled:opacity-50',
              row.crystallizedAhead > 0
                ? 'border border-border text-foreground hover:bg-muted'
                : 'bg-primary text-primary-foreground',
            )}
          >
            <Sparkles className="w-3 h-3" />
            Crystallize next {plan.crystallizeAheadDays} days
          </button>
        </>
      )}
    </div>
  );
}
