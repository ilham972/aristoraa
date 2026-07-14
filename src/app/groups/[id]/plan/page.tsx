'use client';

// /groups/[id]/plan — the group lesson plan (departments redesign,
// 2026-07-14). The Main department's control surface: skeleton to exam day
// (which unit each session teaches, projected finish vs exam), rolling
// crystallization of the actual group sheets ~a week ahead, and the status
// of each crystallized sheet. Backend: learningEngine/groupPlan.ts.

import { use, useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation } from 'convex/react';
import {
  CalendarRange,
  ChevronLeft,
  Layers,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { api, type Id } from '@/lib/convex';
import { cn } from '@/lib/utils';
import { ALL_CURRICULUM_UNITS } from '@/lib/track-progress-args';

const VERDICT_CHIP: Record<string, { label: string; className: string }> = {
  done: { label: 'done', className: 'bg-primary/15 text-primary border-primary/40' },
  'on-track': {
    label: 'on track',
    className: 'bg-emerald-500/15 text-emerald-500 border-emerald-500/40',
  },
  'wont-finish': {
    label: "won't finish",
    className: 'bg-red-500/15 text-red-500 border-red-500/40',
  },
  'no-exam': {
    label: 'no exam date',
    className: 'bg-muted/40 text-muted-foreground border-border',
  },
  'after-horizon': {
    label: 'beyond horizon',
    className: 'bg-amber-500/15 text-amber-500 border-amber-500/40',
  },
};

const STATUS_CHIP: Record<string, { label: string; className: string }> = {
  planned: {
    label: 'crystallized',
    className: 'bg-primary/15 text-primary border-primary/40',
  },
  materialized: {
    label: 'sheets generated',
    className: 'bg-emerald-500/15 text-emerald-500 border-emerald-500/40',
  },
  delegated: {
    label: 'delegated to revision',
    className: 'bg-amber-500/15 text-amber-500 border-amber-500/40',
  },
};

function fmtDate(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00`);
  return d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

export default function GroupPlanPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const groupId = id as Id<'groups'>;
  const group = useQuery(api.groups.get, { id: groupId });
  const plan = useQuery(api.learningEngine.groupPlan.groupLessonPlan, {
    groupId,
  });
  const crystallize = useMutation(
    api.learningEngine.groupPlan.crystallizeUpcoming,
  );
  const deletePlanned = useMutation(api.learningEngine.groupPlan.deletePlanned);
  const [busy, setBusy] = useState(false);

  const unitName = useMemo(() => {
    const m = new Map(ALL_CURRICULUM_UNITS.map((u) => [u.unitId, u.unitName]));
    return (unitId: string) => m.get(unitId) ?? unitId;
  }, []);

  const remainingUnits = useMemo(
    () =>
      plan?.status === 'ok'
        ? plan.units.filter((u) => u.verdict !== 'done')
        : [],
    [plan],
  );

  return (
    <div className="px-4 pt-5 pb-24 max-w-lg mx-auto">
      <Link
        href="/groups"
        className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground mb-3"
      >
        <ChevronLeft className="w-3.5 h-3.5" />
        Groups
      </Link>

      <div className="flex items-center gap-2 mb-1">
        <CalendarRange className="w-5 h-5 text-primary" />
        <h1 className="text-lg font-bold text-foreground">Lesson plan</h1>
      </div>
      <p className="text-[11px] text-muted-foreground mb-4">
        One identical Main sheet per session for the whole group: new book
        questions easy→hard + a spiral of review from past units. Sheets lock
        in ("crystallize") a week ahead; the rest is a live projection.
      </p>

      {(group === undefined || plan === undefined) && (
        <div className="space-y-2 animate-pulse">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-12 bg-muted rounded-xl" />
          ))}
        </div>
      )}

      {plan && plan.status !== 'ok' && (
        <div className="rounded-xl border border-border bg-card p-4 text-center text-sm text-muted-foreground">
          {plan.status === 'no-members' && 'This group has no members yet.'}
          {plan.status === 'no-track' &&
            'No member of this group rides a track yet — assign tracks first (the Main block is track-driven).'}
          {plan.status === 'no-sessions' &&
            'This group has no weekly sessions on the timetable.'}
        </div>
      )}

      {group && plan?.status === 'ok' && (
        <>
          <div className="mb-4 rounded-xl border border-border bg-card px-3 py-2.5">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Group
            </div>
            <div className="text-sm font-bold text-foreground">{group.name}</div>
            <div className="text-[11px] text-muted-foreground">
              {plan.trackName} · {plan.memberCount} students ·{' '}
              {plan.mainQuestionsPerSession} Qs/session
              {plan.currentUnitId && (
                <>
                  {' '}
                  · now: <b>{unitName(plan.currentUnitId)}</b>
                </>
              )}
            </div>
          </div>

          <button
            onClick={async () => {
              setBusy(true);
              try {
                const res = await crystallize({ groupId });
                if (res.status !== 'ok') toast.error(`Cannot plan: ${res.status}`);
                else if (res.written === 0)
                  toast.info('Nothing to crystallize — the window is already planned.');
                else
                  toast.success(
                    `Crystallized ${res.written} session sheet${res.written === 1 ? '' : 's'}`,
                  );
              } catch (e) {
                toast.error(e instanceof Error ? e.message : 'Failed');
              } finally {
                setBusy(false);
              }
            }}
            disabled={busy}
            className="w-full mb-4 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-semibold disabled:opacity-50"
          >
            <Sparkles className="w-3.5 h-3.5" />
            Crystallize next {plan.crystallizeAheadDays} days
          </button>

          {/* Unit runway */}
          <div className="mb-4">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5 flex items-center gap-1">
              <Layers className="w-3 h-3" />
              Units remaining
            </div>
            {remainingUnits.length === 0 && (
              <div className="rounded-xl border border-border bg-card p-3 text-center text-xs text-muted-foreground">
                Book finished — every unit on the track is covered. 🎉
              </div>
            )}
            <div className="space-y-1.5">
              {remainingUnits.map((u) => {
                const chip = VERDICT_CHIP[u.verdict] ?? VERDICT_CHIP['no-exam'];
                return (
                  <div
                    key={u.unitId}
                    className="rounded-xl border border-border bg-card px-3 py-2 flex items-center justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-foreground truncate">
                        {unitName(u.unitId)}
                      </div>
                      <div className="text-[10px] text-muted-foreground">
                        {u.unseenCount} unseen
                        {u.projectedFinishDate && (
                          <> · finishes {fmtDate(u.projectedFinishDate)}</>
                        )}
                        {u.examDate && <> · exam {fmtDate(u.examDate)}</>}
                      </div>
                    </div>
                    <span
                      className={cn(
                        'shrink-0 px-1.5 py-0.5 rounded-md border text-[9px] font-semibold',
                        chip.className,
                      )}
                    >
                      {chip.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Session-by-session plan */}
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5">
            Upcoming sessions
          </div>
          <div className="space-y-1.5">
            {plan.sessions.slice(0, 24).map((s) => {
              const chip = s.crystallized
                ? (STATUS_CHIP[s.crystallized.status] ?? null)
                : null;
              return (
                <div
                  key={s.date}
                  className={cn(
                    'rounded-xl border px-3 py-2 flex items-center justify-between gap-2',
                    s.crystallized
                      ? 'border-primary/40 bg-primary/5'
                      : 'border-border bg-card',
                  )}
                >
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-foreground">
                      {fmtDate(s.date)}
                    </div>
                    <div className="text-[10px] text-muted-foreground truncate">
                      {s.parts
                        .map((p) => `${unitName(p.unitId)} ×${p.newCount}`)
                        .join(' + ')}
                      {s.spiralCount > 0 && <> · spiral ×{s.spiralCount}</>}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {chip && (
                      <span
                        className={cn(
                          'px-1.5 py-0.5 rounded-md border text-[9px] font-semibold',
                          chip.className,
                        )}
                      >
                        {chip.label}
                      </span>
                    )}
                    {s.crystallized?.status === 'planned' && (
                      <button
                        onClick={async () => {
                          try {
                            await deletePlanned({
                              groupSheetId: s.crystallized!.id,
                            });
                            toast.success('Sheet un-planned — crystallize again to re-pick.');
                          } catch (e) {
                            toast.error(
                              e instanceof Error ? e.message : 'Failed',
                            );
                          }
                        }}
                        className="p-1 rounded-md text-muted-foreground hover:text-red-500"
                        aria-label="Delete planned sheet"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
