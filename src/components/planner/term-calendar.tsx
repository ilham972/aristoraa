'use client';

// TermCalendar — the Planner's "Calendar" tab (2026-07-15): the term's
// scheme of work on one day-grid, per group. Every session from today to
// just past the nearest exam: Main sessions carry the unit the skeleton
// assigns them (module-coloured bar + question count), crystallized state
// as the bar style (locked/generated/delegated), Revision sessions as amber
// R dots, cancelled classes struck through in red — and because the
// skeleton flows past cancelled dates, cancelling a class visibly pushes
// everything after it. Tap a day for details + delegate/un-plan actions.
// Backend: groupPlan.groupTermCalendar.

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useMutation } from 'convex/react';
import { SendToBack, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { api, type Id } from '@/lib/convex';
import { cn } from '@/lib/utils';
import { useCachedQuery } from '@/hooks/use-cached-query';
import { MODULE_COLORS } from '@/lib/types';
import { useUnitName, type PlannerGroupRow } from './group-plan-card';
import { fmtWeekdayDate } from './verdict';

const DAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const MS_PER_DAY = 86_400_000;

function ymdFromMs(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function todayYmd(): string {
  return ymdFromMs(Date.now());
}

// Monday (app convention day 1) of the week containing ymd, local time.
function mondayOf(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00`);
  const jsDow = d.getDay(); // 0=Sun..6=Sat
  const back = jsDow === 0 ? 6 : jsDow - 1;
  return ymdFromMs(d.getTime() - back * MS_PER_DAY);
}

function moduleColor(unitId: string | null | undefined): string {
  if (!unitId) return '#0D9488';
  const moduleId = unitId.split('-')[0] || '';
  return MODULE_COLORS[moduleId] ?? '#0D9488';
}

type CalDay = {
  date: string;
  sessions: Array<{
    slotId: Id<'scheduleSlots'>;
    type: 'main' | 'revision';
    startTime: string;
    endTime: string;
    cancelled: boolean;
    cancelReason: string | null;
  }>;
  parts: Array<{ unitId: string; newCount: number }> | null;
  spiralCount: number;
  crystallized: {
    id: Id<'groupSheets'>;
    status: string;
    unitId: string;
    newCount: number;
    spiralCount: number;
  } | null;
};

export function TermCalendar({ grade }: { grade: number }) {
  const groups = useCachedQuery(api.learningEngine.plannerBoard.plannerGroups, {});
  const gradeGroups = useMemo(
    () =>
      (groups ?? [])
        .filter((g: PlannerGroupRow) => g.grade === grade)
        .sort((a: PlannerGroupRow, b: PlannerGroupRow) => a.name.localeCompare(b.name)),
    [groups, grade],
  );

  const [groupId, setGroupId] = useState<Id<'groups'> | null>(null);
  // Keep the selection valid when the grade (and its group list) changes.
  useEffect(() => {
    if (gradeGroups.length === 0) {
      setGroupId(null);
      return;
    }
    if (!groupId || !gradeGroups.some((g: PlannerGroupRow) => g.groupId === groupId)) {
      const preferred =
        gradeGroups.find((g: PlannerGroupRow) => g.trackName !== null) ?? gradeGroups[0];
      setGroupId(preferred.groupId);
    }
  }, [gradeGroups, groupId]);

  const cal = useCachedQuery(
    api.learningEngine.groupPlan.groupTermCalendar,
    groupId ? { groupId } : 'skip',
  );
  const delegateToRevision = useMutation(api.learningEngine.groupPlan.delegateToRevision);
  const deletePlanned = useMutation(api.learningEngine.groupPlan.deletePlanned);
  const setGroupMainQuestions = useMutation(
    api.learningEngine.groupPlan.setGroupMainQuestions,
  );
  const resizePlanned = useMutation(api.learningEngine.groupPlan.resizePlanned);
  const carryOverLeftover = useMutation(api.learningEngine.groupPlan.carryOverLeftover);
  const unitName = useUnitName();
  const [openDate, setOpenDate] = useState<string | null>(null);
  // Day-sheet tuning state: resize target count / leftover count steppers.
  const [resizeCount, setResizeCount] = useState<number | null>(null);
  const [leftoverCount, setLeftoverCount] = useState(1);
  const [busy, setBusy] = useState(false);

  const dayByDate = useMemo(() => {
    const m = new Map<string, CalDay>();
    if (cal && cal.status === 'ok') {
      for (const d of cal.days as CalDay[]) m.set(d.date, d);
    }
    return m;
  }, [cal]);

  const examByDate = useMemo(() => {
    const m = new Map<string, number>();
    if (cal && cal.status === 'ok') {
      for (const e of cal.examDates) m.set(e.date, e.term);
    }
    return m;
  }, [cal]);

  // Full grid: Monday of this week → end of the horizon week.
  const weeks = useMemo(() => {
    if (!cal || cal.status !== 'ok') return [];
    const start = mondayOf(cal.todayYmd);
    const startMs = new Date(`${start}T00:00:00`).getTime();
    const totalDays =
      Math.ceil(
        (cal.horizonDays +
          (new Date(`${cal.todayYmd}T00:00:00`).getTime() - startMs) / MS_PER_DAY) /
          7,
      ) * 7;
    const out: string[][] = [];
    for (let i = 0; i < totalDays; i += 7) {
      out.push(
        Array.from({ length: 7 }, (_, j) => ymdFromMs(startMs + (i + j) * MS_PER_DAY)),
      );
    }
    return out;
  }, [cal]);

  if (groups !== undefined && gradeGroups.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card p-4 text-center text-sm text-muted-foreground">
        No grade-{grade} groups on the timetable yet.
      </div>
    );
  }

  const openDay = openDate ? dayByDate.get(openDate) : undefined;
  const okCal = cal && cal.status === 'ok' ? cal : null;
  const today = todayYmd();

  return (
    <>
      {/* Group chips */}
      <div className="flex gap-1.5 overflow-x-auto pb-1 mb-2">
        {gradeGroups.map((g: PlannerGroupRow) => (
          <button
            key={g.groupId as unknown as string}
            onClick={() => setGroupId(g.groupId)}
            className={cn(
              'shrink-0 px-2.5 py-1.5 rounded-lg border text-[11px] font-semibold',
              g.groupId === groupId
                ? 'border-primary/60 bg-primary/10 text-foreground'
                : 'border-border bg-card text-muted-foreground',
            )}
          >
            {g.name}
          </button>
        ))}
      </div>

      {cal === undefined && groupId && (
        <div className="space-y-2 animate-pulse">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 bg-muted rounded-xl" />
          ))}
        </div>
      )}

      {cal && cal.status !== 'ok' && (
        <div className="rounded-xl border border-border bg-card p-4 text-center text-sm text-muted-foreground">
          {cal.status === 'no-members' && 'This group has no members yet.'}
          {cal.status === 'no-track' && 'No member rides a track yet — assign tracks first.'}
          {cal.status === 'no-sessions' && 'This group has no weekly sessions on the timetable.'}
        </div>
      )}

      {cal?.status === 'ok' && (
        <>
          <div className="text-[11px] text-muted-foreground mb-1.5">
            {cal.trackName} · {cal.memberCount} students
            {cal.examDates.length > 0 && (
              <>
                {' '}· exam{cal.examDates.length > 1 ? 's' : ''}:{' '}
                {cal.examDates.map((e) => `T${e.term} ${e.date}`).join(', ')}
              </>
            )}
          </div>

          {/* Tuning row: the syllabus target + the Qs/session lever */}
          <div className="mb-2 rounded-xl border border-border bg-card px-3 py-2 space-y-1.5">
            {cal.syllabus && cal.syllabus.finishDate !== null && (
              <div className="text-[11px]">
                <span
                  className={cn(
                    'font-semibold',
                    cal.syllabus.daysBeforeExam !== null && cal.syllabus.daysBeforeExam >= 0
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-red-500',
                  )}
                >
                  Syllabus done ~{fmtWeekdayDate(cal.syllabus.finishDate)}
                  {cal.syllabus.daysBeforeExam !== null && (
                    <>
                      {' '}
                      ({cal.syllabus.daysBeforeExam >= 0
                        ? `${cal.syllabus.daysBeforeExam}d before the exam`
                        : `${-cal.syllabus.daysBeforeExam}d AFTER the exam`})
                    </>
                  )}
                </span>
              </div>
            )}
            {cal.syllabus && cal.syllabus.finishDate === null && (
              <div className="text-[11px] font-semibold text-red-500">
                Syllabus doesn&apos;t finish inside this plan — add sessions,
                raise Qs/session, or delegate to Revision.
              </div>
            )}
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] text-muted-foreground">
                Questions per Main session
              </span>
              <span className="inline-flex items-center gap-1">
                <button
                  onClick={async () => {
                    try {
                      const r = await setGroupMainQuestions({
                        groupId: groupId!,
                        count: cal.mainQuestionsPerSession - 1,
                      });
                      toast.success(`Now ${r.count} Qs/session — plan reflowed`);
                    } catch (e) {
                      toast.error(e instanceof Error ? e.message : 'Failed');
                    }
                  }}
                  className="w-7 h-7 rounded-lg border border-border text-foreground font-bold"
                >
                  −
                </button>
                <span className="w-8 text-center text-sm font-bold text-foreground tabular-nums">
                  {cal.mainQuestionsPerSession}
                </span>
                <button
                  onClick={async () => {
                    try {
                      const r = await setGroupMainQuestions({
                        groupId: groupId!,
                        count: cal.mainQuestionsPerSession + 1,
                      });
                      toast.success(`Now ${r.count} Qs/session — plan reflowed`);
                    } catch (e) {
                      toast.error(e instanceof Error ? e.message : 'Failed');
                    }
                  }}
                  className="w-7 h-7 rounded-lg border border-border text-foreground font-bold"
                >
                  +
                </button>
              </span>
            </div>
            <div className="text-[10px] text-muted-foreground">
              {cal.pendingMainCarry > 0 && (
                <>↩ {cal.pendingMainCarry} leftover Qs queued for the next Main · </>
              )}
              Revision queue now: {cal.revisionQueueNow.totalQs} Qs across{' '}
              {cal.revisionQueueNow.students} student
              {cal.revisionQueueNow.students === 1 ? '' : 's'}
            </div>
          </div>

          {/* Legend */}
          <div className="flex flex-wrap gap-x-3 gap-y-1 mb-2 text-[9.5px] text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-sm border-2 border-primary bg-primary/20" /> locked
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-sm border-2 border-emerald-500 bg-emerald-500/20" /> sheets done
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-sm border-2 border-amber-500 bg-amber-500/20" /> delegated
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-sm bg-muted-foreground/30" /> projected
            </span>
            <span className="inline-flex items-center gap-1 text-amber-500 font-semibold">R revision</span>
            <span className="inline-flex items-center gap-1 text-red-500 font-semibold">✕ cancelled</span>
            <span className="inline-flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-sm border-2 border-red-500" /> exam
            </span>
          </div>

          {/* Day-of-week header */}
          <div className="grid grid-cols-7 gap-1 mb-1">
            {DAY_LABELS.map((l, i) => (
              <div key={i} className="text-center text-[9px] font-semibold text-muted-foreground">
                {l}
              </div>
            ))}
          </div>

          {/* Weeks */}
          <div className="space-y-1">
            {weeks.map((week, wi) => (
              <div key={wi} className="grid grid-cols-7 gap-1">
                {week.map((date) => {
                  const day = dayByDate.get(date);
                  const examTerm = examByDate.get(date);
                  const isPast = date < today;
                  const isToday = date === today;
                  const main = day?.sessions.find((s) => s.type === 'main');
                  const revisions = day?.sessions.filter((s) => s.type === 'revision') ?? [];
                  const dayNum = Number(date.slice(8, 10));
                  const showMonth = dayNum === 1 || (wi === 0 && date === week[0]);
                  const monthLabel = new Date(`${date}T00:00:00`).toLocaleDateString('en-US', { month: 'short' });
                  const c = day?.crystallized ?? null;
                  const unitId = c?.unitId ?? day?.parts?.[0]?.unitId ?? null;
                  const qCount = c
                    ? c.newCount + c.spiralCount
                    : day?.parts
                      ? day.parts.reduce((s, p) => s + p.newCount, 0) + (day?.spiralCount ?? 0)
                      : null;
                  const hasContent = !!day || examTerm !== undefined;
                  return (
                    <button
                      key={date}
                      disabled={!hasContent}
                      onClick={() => {
                        setOpenDate(date);
                        setResizeCount(null);
                        setLeftoverCount(1);
                      }}
                      className={cn(
                        'relative rounded-lg border px-0.5 pt-3.5 pb-1 min-h-[3.1rem] text-left',
                        examTerm !== undefined ? 'border-red-500' : 'border-border',
                        isToday ? 'bg-primary/10' : 'bg-card',
                        isPast && 'opacity-40',
                        !hasContent && 'cursor-default',
                      )}
                    >
                      <span
                        className={cn(
                          'absolute top-0.5 left-1 text-[8.5px] leading-none',
                          isToday ? 'text-primary font-bold' : 'text-muted-foreground',
                        )}
                      >
                        {showMonth ? `${monthLabel} ` : ''}
                        {dayNum}
                      </span>
                      {examTerm !== undefined && (
                        <span className="absolute top-0.5 right-0.5 text-[7.5px] font-bold text-red-500 leading-none">
                          EXAM
                        </span>
                      )}
                      {main && (
                        <div
                          className={cn(
                            'w-full rounded-sm px-0.5 text-center text-[8.5px] font-bold leading-[0.875rem] h-3.5 overflow-hidden',
                            main.cancelled
                              ? 'bg-red-500/15 text-red-500 line-through'
                              : c?.status === 'planned'
                                ? 'border border-primary text-foreground'
                                : c?.status === 'materialized'
                                  ? 'border border-emerald-500 text-foreground'
                                  : c?.status === 'delegated'
                                    ? 'border border-amber-500 text-foreground'
                                    : 'text-foreground/80',
                          )}
                          style={
                            main.cancelled
                              ? undefined
                              : { backgroundColor: `${moduleColor(unitId)}${c ? '55' : '30'}` }
                          }
                        >
                          {main.cancelled ? '✕' : (qCount ?? '·')}
                        </div>
                      )}
                      {revisions.length > 0 && (
                        <div
                          className={cn(
                            'mt-0.5 w-full rounded-sm text-center text-[8.5px] font-bold leading-[0.875rem] h-3.5',
                            revisions.every((r) => r.cancelled)
                              ? 'bg-red-500/15 text-red-500 line-through'
                              : 'bg-amber-500/20 text-amber-600 dark:text-amber-400',
                          )}
                        >
                          R
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>

          <p className="text-[10px] text-muted-foreground mt-2">
            Numbers = questions that session (locked sheets show their real
            count, the rest is the live projection). Cancel/uncancel classes
            from the Groups day view — the plan reflows past cancelled days
            automatically.
          </p>
        </>
      )}

      {/* Day detail sheet */}
      {openDate && (
        <div
          className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-2 pb-[calc(4rem+env(safe-area-inset-bottom,0px)+0.5rem)] sm:pb-2"
          onClick={() => setOpenDate(null)}
        >
          <div
            className="w-full max-w-md rounded-2xl bg-card border border-border p-4 shadow-xl max-h-[70vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-bold text-foreground">
                {fmtWeekdayDate(openDate)}
                {examByDate.has(openDate) && (
                  <span className="ml-2 text-red-500 text-xs">Term {examByDate.get(openDate)} EXAM</span>
                )}
              </h2>
              <button
                onClick={() => setOpenDate(null)}
                className="p-1 rounded-md hover:bg-muted text-muted-foreground"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {!openDay && (
              <p className="text-xs text-muted-foreground">No sessions this day.</p>
            )}

            {openDay?.sessions.map((s) => (
              <div
                key={`${s.slotId as unknown as string}-${s.startTime}`}
                className="rounded-lg border border-border px-2.5 py-2 mb-1.5"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-foreground">
                    {s.type === 'main' ? 'Main session' : 'Revision session'} · {s.startTime}–{s.endTime}
                  </span>
                  {s.cancelled && (
                    <span className="text-[10px] font-bold text-red-500">
                      CANCELLED{s.cancelReason ? ` (${s.cancelReason})` : ''}
                    </span>
                  )}
                </div>
                {s.type === 'main' && !s.cancelled && (
                  <div className="text-[11px] text-muted-foreground mt-0.5">
                    {openDay.crystallized ? (
                      <>
                        {unitName(openDay.crystallized.unitId)} ·{' '}
                        {openDay.crystallized.newCount} new
                        {openDay.crystallized.spiralCount > 0 && (
                          <> + {openDay.crystallized.spiralCount} spiral</>
                        )}{' '}
                        ·{' '}
                        <b className="text-foreground">
                          {openDay.crystallized.status === 'planned'
                            ? 'locked in'
                            : openDay.crystallized.status === 'materialized'
                              ? 'sheets generated'
                              : 'delegated to revision'}
                        </b>{' '}
                        · 1 group sheet → {okCal?.memberCount ?? 0} student sheets
                      </>
                    ) : openDay.parts ? (
                      <>
                        {openDay.parts.map((p) => `${unitName(p.unitId)} ×${p.newCount}`).join(' + ')}
                        {openDay.spiralCount > 0 && <> · spiral ×{openDay.spiralCount}</>}
                        {' '}· projected (not locked yet) → {okCal?.memberCount ?? 0} student sheets
                      </>
                    ) : (
                      <>Free session — book finished or beyond the plan.</>
                    )}
                  </div>
                )}
                {s.type === 'revision' && !s.cancelled && (
                  <div className="text-[11px] text-muted-foreground mt-0.5">
                    Personal queue sheets (catch-up + delegated + leftovers).
                    Queue today: {okCal?.revisionQueueNow.totalQs ?? 0} Qs across{' '}
                    {okCal?.revisionQueueNow.students ?? 0} student
                    {(okCal?.revisionQueueNow.students ?? 0) === 1 ? '' : 's'}.
                  </div>
                )}
                <Link
                  href={`/session/${s.slotId as unknown as string}/${openDay.date}`}
                  className="inline-block mt-1 text-[10px] text-primary hover:underline"
                >
                  Open session →
                </Link>
              </div>
            ))}

            {/* Resize a still-planned sheet (e.g. tomorrow's) — re-picks that
                date with the new count; carry-overs stay first in line. */}
            {openDay?.crystallized?.status === 'planned' && (
              <div className="mt-2 rounded-lg border border-border px-2.5 py-2 flex items-center justify-between gap-2">
                <span className="text-[11px] text-muted-foreground">
                  Questions for THIS session
                </span>
                <span className="inline-flex items-center gap-1">
                  {(() => {
                    const current =
                      openDay.crystallized!.newCount + openDay.crystallized!.spiralCount;
                    const value = resizeCount ?? current;
                    return (
                      <>
                        <button
                          onClick={() => setResizeCount(Math.max(1, value - 1))}
                          className="w-7 h-7 rounded-lg border border-border text-foreground font-bold"
                        >
                          −
                        </button>
                        <span className="w-8 text-center text-sm font-bold text-foreground tabular-nums">
                          {value}
                        </span>
                        <button
                          onClick={() => setResizeCount(Math.min(20, value + 1))}
                          className="w-7 h-7 rounded-lg border border-border text-foreground font-bold"
                        >
                          +
                        </button>
                        <button
                          disabled={busy || value === current}
                          onClick={async () => {
                            setBusy(true);
                            try {
                              await resizePlanned({
                                groupSheetId: openDay.crystallized!.id,
                                count: value,
                              });
                              toast.success(`Re-picked with ${value} questions`);
                              setResizeCount(null);
                            } catch (e) {
                              toast.error(e instanceof Error ? e.message : 'Failed');
                            } finally {
                              setBusy(false);
                            }
                          }}
                          className="ml-1 px-2.5 h-7 rounded-lg bg-primary text-primary-foreground text-[11px] font-semibold disabled:opacity-40"
                        >
                          Apply
                        </button>
                      </>
                    );
                  })()}
                </span>
              </div>
            )}

            {/* Log the unfinished tail after class — teacher decides where it
                goes: whole group re-does it next Main, or it lands in every
                member's revision queue. Both reshape the calendar instantly. */}
            {openDay?.crystallized?.status === 'materialized' && (
              <div className="mt-2 rounded-lg border border-border px-2.5 py-2">
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <span className="text-[11px] text-muted-foreground">
                    Didn&apos;t finish? Last
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <button
                      onClick={() => setLeftoverCount(Math.max(1, leftoverCount - 1))}
                      className="w-7 h-7 rounded-lg border border-border text-foreground font-bold"
                    >
                      −
                    </button>
                    <span className="w-8 text-center text-sm font-bold text-foreground tabular-nums">
                      {Math.min(
                        leftoverCount,
                        openDay.crystallized!.newCount + openDay.crystallized!.spiralCount,
                      )}
                    </span>
                    <button
                      onClick={() =>
                        setLeftoverCount(
                          Math.min(
                            openDay.crystallized!.newCount +
                              openDay.crystallized!.spiralCount,
                            leftoverCount + 1,
                          ),
                        )
                      }
                      className="w-7 h-7 rounded-lg border border-border text-foreground font-bold"
                    >
                      +
                    </button>
                  </span>
                  <span className="text-[11px] text-muted-foreground">questions →</span>
                </div>
                <div className="flex gap-2">
                  <button
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        const r = await carryOverLeftover({
                          groupSheetId: openDay.crystallized!.id,
                          count: leftoverCount,
                          target: 'main',
                        });
                        toast.success(
                          `${r.count} Qs will lead the next Main session — plan reflowed`,
                        );
                        setOpenDate(null);
                      } catch (e) {
                        toast.error(e instanceof Error ? e.message : 'Failed');
                      } finally {
                        setBusy(false);
                      }
                    }}
                    className="flex-1 px-2 py-2 rounded-lg border border-primary/50 text-primary text-[11px] font-semibold disabled:opacity-40"
                  >
                    Next Main session
                  </button>
                  <button
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        const r = await carryOverLeftover({
                          groupSheetId: openDay.crystallized!.id,
                          count: leftoverCount,
                          target: 'revision',
                        });
                        toast.success(
                          `${r.count} Qs queued for revision (${r.rows} students)`,
                        );
                        setOpenDate(null);
                      } catch (e) {
                        toast.error(e instanceof Error ? e.message : 'Failed');
                      } finally {
                        setBusy(false);
                      }
                    }}
                    className="flex-1 px-2 py-2 rounded-lg border border-amber-500/50 text-amber-600 dark:text-amber-400 text-[11px] font-semibold disabled:opacity-40"
                  >
                    Revision queues
                  </button>
                </div>
              </div>
            )}

            {openDay?.crystallized?.status === 'planned' && (
              <div className="flex gap-2 mt-2">
                <button
                  onClick={async () => {
                    try {
                      await delegateToRevision({ groupSheetId: openDay.crystallized!.id });
                      toast.success('Delegated — reaches students via revision queues; bookmark still advances.');
                      setOpenDate(null);
                    } catch (e) {
                      toast.error(e instanceof Error ? e.message : 'Failed');
                    }
                  }}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-amber-500/50 text-amber-600 dark:text-amber-400 text-xs font-semibold"
                >
                  <SendToBack className="w-3.5 h-3.5" />
                  Delegate to Revision
                </button>
                <button
                  onClick={async () => {
                    try {
                      await deletePlanned({ groupSheetId: openDay.crystallized!.id });
                      toast.success('Un-planned — crystallize again to re-pick.');
                      setOpenDate(null);
                    } catch (e) {
                      toast.error(e instanceof Error ? e.message : 'Failed');
                    }
                  }}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-border text-muted-foreground text-xs font-semibold"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Un-plan
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
