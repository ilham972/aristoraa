'use client';

// /groups/[id]/plan — the group lesson plan (redesigned 2026-07-15).
// The first version repeated the same unit name across three lists; this
// layout shows each fact once:
//   header    — group · track · roster · current unit · crystallize button.
//   runway    — ONE horizontal strip of remaining units (shared UnitRunway,
//               same look as the global /planner Term board).
//   locked in — only the crystallized sheets (the actionable rows:
//               delegate / delete / status).
//   projection— upcoming sessions COLLAPSED INTO UNIT SPANS ("Algebra — 5
//               sessions · Jul 20 → Aug 2"), each expandable to its dates.
//   sessions  — compact Main/Revision day chips (tap to flip department).
// Backend: learningEngine/groupPlan.ts (unchanged).

import { use, useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation } from 'convex/react';
import {
  CalendarRange,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  SendToBack,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { api, type Id } from '@/lib/convex';
import { cn } from '@/lib/utils';
import { ALL_CURRICULUM_UNITS } from '@/lib/track-progress-args';
import { UnitRunway } from '@/components/planner/unit-runway';
import { StartingPointButton } from '@/components/planner/starting-point-dialog';
import {
  VERDICT_CHIP,
  fmtWeekdayDate,
  planStatusMessage,
} from '@/components/planner/verdict';

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

type PlanSession = {
  date: string;
  parts: Array<{ unitId: string; newCount: number }>;
  spiralCount: number;
  slotId: Id<'scheduleSlots'> | null;
  crystallized: {
    id: Id<'groupSheets'>;
    status: string;
    unitId: string;
    newCount: number;
    spiralCount: number;
  } | null;
};

// Consecutive projection sessions grouped by their primary unit.
type UnitSpan = {
  unitId: string;
  sessions: PlanSession[];
  newTotal: number;
};

function buildSpans(sessions: PlanSession[]): UnitSpan[] {
  const spans: UnitSpan[] = [];
  for (const s of sessions) {
    const unitId = s.parts[0]?.unitId ?? 'unknown';
    const last = spans[spans.length - 1];
    const newSum = s.parts.reduce((sum, p) => sum + p.newCount, 0);
    if (last && last.unitId === unitId) {
      last.sessions.push(s);
      last.newTotal += newSum;
    } else {
      spans.push({ unitId, sessions: [s], newTotal: newSum });
    }
  }
  return spans;
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
  const weeklySlots = useQuery(api.learningEngine.groupPlan.groupWeeklySlots, {
    groupId,
  });
  const crystallize = useMutation(api.learningEngine.groupPlan.crystallizeUpcoming);
  const deletePlanned = useMutation(api.learningEngine.groupPlan.deletePlanned);
  const delegateToRevision = useMutation(api.learningEngine.groupPlan.delegateToRevision);
  const setSlotSessionType = useMutation(api.learningEngine.groupPlan.setSlotSessionType);
  const [busy, setBusy] = useState(false);
  const [openSpan, setOpenSpan] = useState<string | null>(null);

  const unitName = useMemo(() => {
    const m = new Map(ALL_CURRICULUM_UNITS.map((u) => [u.unitId, u.unitName]));
    return (unitId: string) => m.get(unitId) ?? unitId;
  }, []);

  const sessions = (plan?.status === 'ok' ? plan.sessions : []) as PlanSession[];
  const lockedIn = sessions.filter((s) => s.crystallized);
  const spans = useMemo(
    () => buildSpans(sessions.filter((s) => !s.crystallized)),
    [sessions],
  );

  return (
    <div className="px-4 pt-5 pb-24 max-w-lg mx-auto">
      <div className="flex items-center justify-between mb-3">
        <Link
          href="/groups"
          className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
          Groups
        </Link>
        <Link
          href="/planner"
          className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
        >
          <CalendarRange className="w-3.5 h-3.5" />
          Global planner
        </Link>
      </div>

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
          {/* Header: everything about the group ONCE */}
          <div className="mb-3 rounded-xl border border-border bg-card px-3 py-2.5">
            <div className="text-sm font-bold text-foreground">{group.name}</div>
            <div className="text-[11px] text-muted-foreground mt-0.5">
              {plan.trackName} · {plan.memberCount} students ·{' '}
              {plan.mainQuestionsPerSession} Qs/session
            </div>
            {plan.currentUnitId && (
              <div className="text-[11px] text-muted-foreground">
                teaching now:{' '}
                <b className="text-foreground">{unitName(plan.currentUnitId)}</b>
              </div>
            )}
            <div className="flex gap-2 mt-2">
              <button
                onClick={async () => {
                  setBusy(true);
                  try {
                    const res = await crystallize({ groupId });
                    if (res.status !== 'ok')
                      toast.error(planStatusMessage(res.status));
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
                className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-semibold disabled:opacity-50"
              >
                <Sparkles className="w-3.5 h-3.5" />
                Crystallize next {plan.crystallizeAheadDays} days
              </button>
            </div>
            <div className="mt-2">
              <StartingPointButton
                groupId={groupId}
                units={plan.units}
                unitName={unitName}
                className="w-full justify-center"
              />
            </div>
          </div>

          {/* Unit runway — the one place units are listed */}
          <div className="mb-4">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5">
              Unit runway
            </div>
            <UnitRunway
              units={plan.units}
              unitName={unitName}
              current={plan.currentUnitId}
            />
          </div>

          {/* Locked-in sheets — the actionable rows */}
          {lockedIn.length > 0 && (
            <div className="mb-4">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5">
                Locked in
              </div>
              <div className="space-y-1.5">
                {lockedIn.map((s) => {
                  const c = s.crystallized!;
                  const chip = STATUS_CHIP[c.status] ?? null;
                  return (
                    <div
                      key={s.date}
                      className="rounded-xl border border-primary/40 bg-primary/5 px-3 py-2 flex items-center justify-between gap-2"
                    >
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-foreground">
                          {fmtWeekdayDate(s.date)}
                        </div>
                        <div className="text-[10px] text-muted-foreground truncate">
                          {unitName(c.unitId)} · {c.newCount} new
                          {c.spiralCount > 0 && <> + {c.spiralCount} spiral</>}
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
                        {c.status === 'planned' && (
                          <>
                            <button
                              onClick={async () => {
                                try {
                                  await delegateToRevision({ groupSheetId: c.id });
                                  toast.success(
                                    'Delegated — the group does this sheet in Revision sessions; the bookmark still advances.',
                                  );
                                } catch (e) {
                                  toast.error(e instanceof Error ? e.message : 'Failed');
                                }
                              }}
                              className="p-1 rounded-md text-muted-foreground hover:text-amber-500"
                              aria-label="Delegate to Revision department"
                              title="Group can do this without teaching — send to Revision"
                            >
                              <SendToBack className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={async () => {
                                try {
                                  await deletePlanned({ groupSheetId: c.id });
                                  toast.success('Sheet un-planned — crystallize again to re-pick.');
                                } catch (e) {
                                  toast.error(e instanceof Error ? e.message : 'Failed');
                                }
                              }}
                              className="p-1 rounded-md text-muted-foreground hover:text-red-500"
                              aria-label="Delete planned sheet"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Projection — unit spans instead of 24 repeated rows */}
          {spans.length > 0 && (
            <div className="mb-4">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5">
                Then, projected
              </div>
              <div className="space-y-1.5">
                {spans.map((span) => {
                  const key = `${span.unitId}|${span.sessions[0].date}`;
                  const isOpen = openSpan === key;
                  const first = span.sessions[0].date;
                  const last = span.sessions[span.sessions.length - 1].date;
                  const verdict =
                    plan.units.find((u) => u.unitId === span.unitId)?.verdict ?? 'no-exam';
                  const chip = VERDICT_CHIP[verdict] ?? VERDICT_CHIP['no-exam'];
                  return (
                    <div key={key} className="rounded-xl border border-border bg-card overflow-hidden">
                      <button
                        onClick={() => setOpenSpan(isOpen ? null : key)}
                        className="w-full px-3 py-2 flex items-center gap-2 text-left hover:bg-muted/40"
                      >
                        {isOpen ? (
                          <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                        ) : (
                          <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-semibold text-foreground truncate">
                            {unitName(span.unitId)}
                          </div>
                          <div className="text-[10px] text-muted-foreground">
                            {span.sessions.length} session{span.sessions.length === 1 ? '' : 's'} ·{' '}
                            {span.newTotal} new Qs ·{' '}
                            {fmtWeekdayDate(first)}
                            {last !== first && <> → {fmtWeekdayDate(last)}</>}
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
                      </button>
                      {isOpen && (
                        <div className="border-t border-border px-3 py-1.5">
                          {span.sessions.map((s) => (
                            <div
                              key={s.date}
                              className="flex items-center justify-between py-1 text-[11px]"
                            >
                              <span className="text-foreground">{fmtWeekdayDate(s.date)}</span>
                              <span className="text-muted-foreground">
                                {s.parts.map((p) => `${unitName(p.unitId)} ×${p.newCount}`).join(' + ')}
                                {s.spiralCount > 0 && <> · spiral ×{s.spiralCount}</>}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Weekly sessions — compact department chips */}
          {weeklySlots && weeklySlots.length > 0 && (
            <div className="mb-4">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5">
                Weekly sessions — tap to switch department
              </div>
              <div className="flex flex-wrap gap-1.5">
                {weeklySlots.map((s) => {
                  const isRevision = s.sessionType === 'revision';
                  const dayName = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][
                    s.dayOfWeek - 1
                  ];
                  return (
                    <button
                      key={s.slotId as unknown as string}
                      onClick={async () => {
                        try {
                          await setSlotSessionType({
                            slotId: s.slotId,
                            sessionType: isRevision ? 'main' : 'revision',
                          });
                          toast.success(
                            isRevision
                              ? `${dayName} ${s.startTime} → Main (group teaching)`
                              : `${dayName} ${s.startTime} → Revision (individual sheets)`,
                          );
                        } catch (e) {
                          toast.error(e instanceof Error ? e.message : 'Failed');
                        }
                      }}
                      className={cn(
                        'rounded-lg border px-2 py-1.5 text-left',
                        isRevision
                          ? 'border-amber-500/50 bg-amber-500/10'
                          : 'border-border bg-card',
                      )}
                    >
                      <div className="text-[11px] font-semibold text-foreground">
                        {dayName} {s.startTime}
                      </div>
                      <div
                        className={cn(
                          'text-[9px] font-semibold',
                          isRevision ? 'text-amber-500' : 'text-primary',
                        )}
                      >
                        {isRevision ? 'REVISION' : 'MAIN'}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
