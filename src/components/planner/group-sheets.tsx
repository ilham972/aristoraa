'use client';

// GroupSheets — the Planner's "Sheets" tab (2026-07-15): every sheet of the
// term for one group, prebuilt end to end. Pick grade → group, then:
//   Run all term sheets — crystallize EVERY session to the horizon in one
//   tap (counts are stable under difficulty re-ordering; planned rows stay
//   re-pickable until printed).
//   Re-plan future — after a Lesson-Builder reorder: drop every future
//   still-planned row and rebuild it from the fresh book order.
//   The grid — the term as a transit map (2026-07-15 redesign): sheets are
//   date cards in a 3-across grid, grouped into unit "line segments" with a
//   colored rail per unit, TODAY as the you-are-here divider. A term stuck
//   on one unit is visible at a glance — and when the question bank runs
//   dry (book entry hasn't reached later units) an amber banner says so
//   instead of the old silent stop.

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Flag,
  RefreshCw,
  Sparkles,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { api, type Id } from '@/lib/convex';
import { cn } from '@/lib/utils';
import { useCachedQuery } from '@/hooks/use-cached-query';
import { CropThumbnail } from '@/components/algorithm/sheet-preview';
import { useUnitName, type PlannerGroupRow } from './group-plan-card';
import { GroupCoverage } from './group-coverage';
import { fmtWeekdayDate } from './verdict';

const STATUS_CHIP: Record<string, { label: string; className: string }> = {
  planned: {
    label: 'planned',
    className: 'bg-primary/15 text-primary border-primary/40',
  },
  materialized: {
    label: 'taught',
    className: 'bg-emerald-500/15 text-emerald-500 border-emerald-500/40',
  },
  delegated: {
    label: 'delegated',
    className: 'bg-amber-500/15 text-amber-500 border-amber-500/40',
  },
};

// Transit-line palette: each unit that appears in the term gets the next
// color, in order of first appearance. Static class strings so Tailwind
// keeps them.
const UNIT_LINES = [
  { rail: 'bg-teal-400', dot: 'bg-teal-400', text: 'text-teal-400' },
  { rail: 'bg-sky-400', dot: 'bg-sky-400', text: 'text-sky-400' },
  { rail: 'bg-violet-400', dot: 'bg-violet-400', text: 'text-violet-400' },
  { rail: 'bg-amber-400', dot: 'bg-amber-400', text: 'text-amber-400' },
  { rail: 'bg-rose-400', dot: 'bg-rose-400', text: 'text-rose-400' },
  { rail: 'bg-lime-400', dot: 'bg-lime-400', text: 'text-lime-400' },
  { rail: 'bg-orange-400', dot: 'bg-orange-400', text: 'text-orange-400' },
  { rail: 'bg-fuchsia-400', dot: 'bg-fuchsia-400', text: 'text-fuchsia-400' },
];

function todayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function fmtDayMonth(ymd: string): { weekday: string; day: string } {
  const d = new Date(`${ymd}T00:00:00`);
  return {
    weekday: d.toLocaleDateString('en-US', { weekday: 'short' }),
    day: d.toLocaleDateString('en-US', { day: 'numeric', month: 'short' }),
  };
}

// Monday (app convention 1=Mon..7=Sun) of the week a date falls in — the key
// the timeline groups sheets by. A sheet mixes several units, so "which week"
// is the honest header, not "which unit".
function weekStartYmd(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00`);
  const dow = d.getDay() === 0 ? 7 : d.getDay(); // 1=Mon..7=Sun
  d.setDate(d.getDate() - (dow - 1));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

type SheetRow = {
  id: Id<'groupSheets'>;
  date: string;
  unitId: string;
  newCount: number;
  spiralCount: number;
  status: string;
};

export function GroupSheets({ grade }: { grade: number }) {
  const groups = useCachedQuery(api.learningEngine.plannerBoard.plannerGroups, {});
  const gradeGroups = useMemo(
    () =>
      (groups ?? [])
        .filter((g: PlannerGroupRow) => g.grade === grade)
        .sort((a: PlannerGroupRow, b: PlannerGroupRow) => a.name.localeCompare(b.name)),
    [groups, grade],
  );

  const [groupId, setGroupId] = useState<Id<'groups'> | null>(null);
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

  const sheets = useCachedQuery(
    api.learningEngine.groupPlan.groupSheetHistory,
    groupId ? { groupId } : 'skip',
  );
  // The lesson plan powers the book-coverage banner: which track units have
  // no questions in the bank yet (the reason a "full term" run stops early).
  const lessonPlan = useCachedQuery(
    api.learningEngine.groupPlan.groupLessonPlan,
    groupId ? { groupId } : 'skip',
  );
  const crystallize = useMutation(api.learningEngine.groupPlan.crystallizeUpcoming);
  const deleteFuturePlanned = useMutation(
    api.learningEngine.groupPlan.deleteFuturePlanned,
  );
  const unitName = useUnitName();
  const [busy, setBusy] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<Id<'groupSheets'> | null>(null);

  const today = todayYmd();
  const list: SheetRow[] = useMemo(() => sheets ?? [], [sheets]);
  const previewIdx = previewId ? list.findIndex((s) => s.id === previewId) : -1;

  // The exam deadline (nearest upcoming exam) — drawn as a line on the
  // timeline so a plan that overshoots it is impossible to miss.
  const exam = useMemo(() => {
    if (!lessonPlan || lessonPlan.status !== 'ok' || !lessonPlan.examPlan)
      return null;
    return {
      date: lessonPlan.examPlan.examDate,
      daysToExam: lessonPlan.examPlan.daysToExam,
    };
  }, [lessonPlan]);

  // Unit → line color, in order of first appearance (per-sheet unit tint).
  const lineByUnit = useMemo(() => {
    const m = new Map<string, (typeof UNIT_LINES)[number]>();
    for (const s of list) {
      if (!m.has(s.unitId)) m.set(s.unitId, UNIT_LINES[m.size % UNIT_LINES.length]);
    }
    return m;
  }, [list]);

  // Weeks: sheets grouped by their Monday. A sheet interleaves several units,
  // so the honest timeline header is the WEEK, not one unit name.
  const weeks = useMemo(() => {
    const out: Array<{ weekStart: string; sheets: SheetRow[] }> = [];
    for (const s of list) {
      const ws = weekStartYmd(s.date);
      const last = out[out.length - 1];
      if (!last || last.weekStart !== ws) out.push({ weekStart: ws, sheets: [s] });
      else last.sheets.push(s);
    }
    return out;
  }, [list]);

  // Book-coverage gap, from the live skeleton: units whose ladder is empty.
  const bookGap = useMemo(() => {
    if (!lessonPlan || lessonPlan.status !== 'ok' || !lessonPlan.units) return null;
    const units = lessonPlan.units as Array<{
      unitId: string;
      verdict: string;
      totalCount?: number;
    }>;
    const empty = units.filter((u) => u.verdict === 'no-questions');
    if (empty.length === 0) return null;
    return {
      emptyCount: empty.length,
      totalUnits: units.length,
      nextEmpty: empty[0].unitId,
    };
  }, [lessonPlan]);

  const runAll = async () => {
    if (!groupId) return;
    setBusy('run');
    try {
      const res = await crystallize({ groupId, daysAhead: 180 });
      if (res.status !== 'ok') toast.error(`Cannot plan: ${res.status}`);
      else if (res.exhausted)
        toast.warning(
          `Built ${res.written} sheets, then the question bank ran dry — ${res.unplannedSessions} sessions have nothing left to plan. Enter more of the book to continue.`,
          { duration: 8000 },
        );
      else if (res.written === 0)
        toast.info('Every session is already planned — the term is fully built.');
      else toast.success(`Built ${res.written} sheets — the whole term is planned.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(null);
    }
  };

  const replan = async () => {
    if (!groupId) return;
    if (
      !window.confirm(
        'Re-plan the term? Every future sheet that is not yet taught will be re-picked from the current book order. Taught and delegated sheets are untouched.',
      )
    )
      return;
    setBusy('replan');
    try {
      const del = await deleteFuturePlanned({ groupId });
      const res = await crystallize({ groupId, daysAhead: 180 });
      toast.success(
        `Re-planned: ${del.deleted} sheets dropped, ${res.status === 'ok' ? res.written : 0} rebuilt from the current order.`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(null);
    }
  };

  if (groups !== undefined && gradeGroups.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card p-4 text-center text-sm text-muted-foreground">
        No grade-{grade} groups on the timetable yet.
      </div>
    );
  }

  let todayLineShown = false;
  let examLineShown = false;

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

      {/* Exam deadline — the line everything is planned toward */}
      {groupId && (
        <div className="flex items-center gap-1.5 mb-3 text-[11px]">
          <Flag className="w-3.5 h-3.5 text-rose-500 shrink-0" />
          {exam ? (
            <span className="text-foreground">
              Exam <b>{fmtWeekdayDate(exam.date)}</b>
              <span
                className={cn(
                  'ml-1.5 px-1.5 py-px rounded-full font-semibold',
                  exam.daysToExam <= 21
                    ? 'bg-rose-500/15 text-rose-500'
                    : 'bg-muted text-muted-foreground',
                )}
              >
                {exam.daysToExam}d left
              </span>
            </span>
          ) : (
            <span className="text-muted-foreground">
              No exam date set — add one in the Exams tab to plan toward it.
            </span>
          )}
        </div>
      )}

      {/* Term-build actions */}
      <div className="flex gap-2 mb-3">
        <button
          onClick={runAll}
          disabled={busy !== null || !groupId}
          className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-semibold disabled:opacity-50"
        >
          <Sparkles className="w-3.5 h-3.5" />
          {busy === 'run' ? 'Building…' : 'Run all term sheets'}
        </button>
        <button
          onClick={replan}
          disabled={busy !== null || !groupId}
          className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-border text-foreground text-xs font-semibold disabled:opacity-50"
          title="After reordering difficulty in the Lesson Builder: re-pick every future planned sheet from the new order"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          {busy === 'replan' ? 'Re-planning…' : 'Re-plan'}
        </button>
      </div>

      {/* Book-coverage gap: the honest "why the term stops early" banner */}
      {bookGap && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 mb-3 flex gap-2.5">
          <BookOpen className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
          <div className="text-[11px] leading-snug text-foreground">
            <span className="font-semibold text-amber-500">
              {bookGap.emptyCount} of {bookGap.totalUnits} track units have no
              questions yet.
            </span>{' '}
            Sheets stop when the entered book runs out — next unit needing book
            entry: <span className="font-semibold">{unitName(bookGap.nextEmpty)}</span>.
          </div>
        </div>
      )}

      {/* ── Lens 1: COVERAGE (what & how much) ─────────────────────────── */}
      {groupId && <GroupCoverage groupId={groupId} />}

      {/* ── Lens 2: TIMELINE (when — grouped by week) ──────────────────── */}
      {groupId && (
        <div className="mt-6">
          <div className="flex items-center gap-2 mb-2.5">
            <span className="text-[11px] font-bold text-foreground uppercase tracking-wide">
              Timeline
            </span>
            <span className="text-[10px] text-muted-foreground">
              every sheet, by week · each mixes new + review
            </span>
            <span className="h-px flex-1 bg-border" />
          </div>

          {sheets === undefined && (
            <div className="grid grid-cols-3 gap-1.5 animate-pulse">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <div key={i} className="h-16 bg-muted rounded-xl" />
              ))}
            </div>
          )}

          {sheets !== undefined && list.length === 0 && (
            <div className="rounded-xl border border-border bg-card p-4 text-center text-sm text-muted-foreground">
              No sheets yet — press &ldquo;Run all term sheets&rdquo; to build
              the whole term.
            </div>
          )}

          <div className="space-y-3">
            {weeks.map((w) => {
              const showToday =
                !todayLineShown && w.sheets.some((s) => s.date >= today);
              if (showToday) todayLineShown = true;
              const showExam =
                exam !== null && !examLineShown && w.weekStart > exam.date;
              if (showExam) examLineShown = true;
              const wd = fmtDayMonth(w.weekStart);
              return (
                <div key={w.weekStart}>
                  {showExam && (
                    <div className="flex items-center gap-2 my-3">
                      <div className="h-px flex-1 bg-rose-500/50" />
                      <span className="inline-flex items-center gap-1 text-[9px] font-bold text-rose-500 uppercase tracking-widest">
                        <Flag className="w-3 h-3" />
                        exam · {exam && fmtWeekdayDate(exam.date)}
                      </span>
                      <div className="h-px flex-1 bg-rose-500/50" />
                    </div>
                  )}
                  {showToday && (
                    <div className="flex items-center gap-2 my-2.5">
                      <div className="h-px flex-1 bg-primary/40" />
                      <span className="text-[9px] font-bold text-primary uppercase tracking-widest">
                        today
                      </span>
                      <div className="h-px flex-1 bg-primary/40" />
                    </div>
                  )}
                  {/* Week header */}
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-[11px] font-bold text-foreground shrink-0">
                      Week of {wd.day}
                    </span>
                    <span className="h-px flex-1 bg-border" />
                    <span className="text-[9.5px] text-muted-foreground shrink-0">
                      {w.sheets.length} sheet{w.sheets.length > 1 ? 's' : ''}
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-1.5">
                    {w.sheets.map((s) => {
                      const isPast = s.date < today;
                      const afterExam = exam !== null && s.date > exam.date;
                      const d = fmtDayMonth(s.date);
                      const line = lineByUnit.get(s.unitId) ?? UNIT_LINES[0];
                      const chip = STATUS_CHIP[s.status] ?? STATUS_CHIP.planned;
                      return (
                        <button
                          key={s.id as unknown as string}
                          onClick={() => setPreviewId(s.id)}
                          className={cn(
                            'rounded-xl border bg-card text-left overflow-hidden hover:bg-muted/40 active:scale-[0.98] transition-transform',
                            afterExam ? 'border-rose-500/50' : 'border-border',
                            isPast && 'opacity-55',
                          )}
                        >
                          <div className={cn('h-1', line.rail)} />
                          <div className="px-2 pt-1.5 pb-2">
                            <div className="flex items-center justify-between gap-1">
                              <div>
                                <div className="text-[9.5px] text-muted-foreground leading-none">
                                  {d.weekday}
                                </div>
                                <div className="text-xs font-bold text-foreground mt-0.5">
                                  {d.day}
                                </div>
                              </div>
                              {afterExam && (
                                <span className="px-1 py-px rounded bg-rose-500/15 text-rose-500 text-[7.5px] font-bold leading-tight">
                                  after exam
                                </span>
                              )}
                            </div>
                            {/* The sheet's real mix: unit + new/review counts */}
                            <div className="text-[9px] text-foreground/80 truncate mt-1">
                              {unitName(s.unitId)}
                            </div>
                            <div className="flex items-center justify-between mt-1 gap-1">
                              <span className="text-[9.5px] text-muted-foreground tabular-nums">
                                {s.newCount}n
                                {s.spiralCount > 0 && (
                                  <span className="text-amber-500">
                                    +{s.spiralCount}r
                                  </span>
                                )}
                              </span>
                              <span
                                className={cn(
                                  'px-1 py-px rounded border text-[8px] font-semibold leading-tight shrink-0',
                                  chip.className,
                                )}
                              >
                                {chip.label}
                              </span>
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {previewIdx >= 0 && (
        <SheetPreviewDrawer
          sheetId={list[previewIdx].id}
          unitName={unitName}
          hasPrev={previewIdx > 0}
          hasNext={previewIdx < list.length - 1}
          onPrev={() => setPreviewId(list[previewIdx - 1].id)}
          onNext={() => setPreviewId(list[previewIdx + 1].id)}
          onClose={() => setPreviewId(null)}
        />
      )}
    </>
  );
}

function SheetPreviewDrawer({
  sheetId,
  unitName,
  hasPrev,
  hasNext,
  onPrev,
  onNext,
  onClose,
}: {
  sheetId: Id<'groupSheets'>;
  unitName: (unitId: string) => string;
  hasPrev: boolean;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
}) {
  const sheet = useQuery(api.learningEngine.groupPlan.groupSheetPreview, {
    groupSheetId: sheetId,
  });
  const chip = sheet ? (STATUS_CHIP[sheet.status] ?? STATUS_CHIP.planned) : null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-2 pb-[calc(4rem+env(safe-area-inset-bottom,0px)+0.5rem)] sm:pb-2"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-card border border-border shadow-xl max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header with sheet-by-sheet navigation */}
        <div className="flex items-center gap-1 px-3 py-2.5 border-b border-border">
          <button
            onClick={onPrev}
            disabled={!hasPrev}
            className="p-1.5 rounded-md hover:bg-muted text-muted-foreground disabled:opacity-30"
            aria-label="Previous sheet"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <div className="flex-1 min-w-0 text-center">
            {sheet ? (
              <>
                <div className="text-sm font-bold text-foreground">
                  {fmtWeekdayDate(sheet.date)}
                </div>
                <div className="text-[10px] text-muted-foreground truncate">
                  {unitName(sheet.unitId)}
                  {chip && (
                    <span
                      className={cn(
                        'ml-1.5 px-1.5 py-px rounded border text-[9px] font-semibold',
                        chip.className,
                      )}
                    >
                      {chip.label}
                    </span>
                  )}
                </div>
              </>
            ) : (
              <div className="h-8 w-32 mx-auto bg-muted rounded animate-pulse" />
            )}
          </div>
          <button
            onClick={onNext}
            disabled={!hasNext}
            className="p-1.5 rounded-md hover:bg-muted text-muted-foreground disabled:opacity-30"
            aria-label="Next sheet"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md hover:bg-muted text-muted-foreground"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Questions */}
        <div className="overflow-y-auto px-3 py-2">
          {sheet === undefined && (
            <div className="space-y-2 animate-pulse py-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-16 bg-muted rounded-xl" />
              ))}
            </div>
          )}
          {sheet &&
            sheet.questions.map((q, i) => (
              <div
                key={q.questionId as unknown as string}
                className="flex items-center gap-2.5 py-1.5 border-b border-border/50 last:border-0"
              >
                <span className="w-5 text-[11px] font-bold text-muted-foreground tabular-nums shrink-0">
                  {i + 1}
                </span>
                {q.overrideImageUrl ? (
                  // Typed override wins — render the stored PNG directly.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={q.overrideImageUrl}
                    alt={`Question ${i + 1}`}
                    className="max-h-20 rounded-md border border-border/40"
                  />
                ) : (
                  <CropThumbnail
                    imageUrl={q.pageImageUrl}
                    imageUrlSmall={q.pageImageUrlSmall}
                    cropBox={q.cropBox}
                    maxSide={72}
                  />
                )}
                <div className="min-w-0 flex-1 text-right">
                  <span
                    className={cn(
                      'inline-block px-1.5 py-0.5 rounded-md border text-[9px] font-semibold',
                      q.section === 'spiral'
                        ? 'bg-amber-500/15 text-amber-500 border-amber-500/40'
                        : 'bg-primary/10 text-primary border-primary/30',
                    )}
                  >
                    {q.section === 'spiral' ? 'spiral' : 'new'}
                  </span>
                  {q.difficulty !== null && (
                    <div className="text-[9px] text-muted-foreground mt-0.5">
                      diff {q.difficulty}
                    </div>
                  )}
                </div>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}
