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
  ChevronDown,
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
import { GroupCoverage, shortLabel } from './group-coverage';
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

function addDaysYmd(ymd: string, n: number): string {
  const d = new Date(`${ymd}T00:00:00`);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const DOW_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

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
  // Coverage — shared term selection with the summary below (same query+args
  // dedupe). Also powers the per-week book-order question grids: each question
  // carries the sheetDate it was picked onto, so we can bucket by week.
  const [covTerm, setCovTerm] = useState<number | null>(null);
  const coverage = useCachedQuery(
    api.learningEngine.groupPlan.groupTermCoverage,
    groupId ? { groupId, ...(covTerm !== null ? { term: covTerm } : {}) } : 'skip',
  );
  // The group's weekly Main + Revision slot days — the 7+7 day grid.
  const slotDays = useCachedQuery(
    api.learningEngine.groupPlan.groupSlotDays,
    groupId ? { groupId } : 'skip',
  );

  const crystallize = useMutation(api.learningEngine.groupPlan.crystallizeUpcoming);
  const deleteFuturePlanned = useMutation(
    api.learningEngine.groupPlan.deleteFuturePlanned,
  );
  const unitName = useUnitName();
  const [busy, setBusy] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<Id<'groupSheets'> | null>(null);
  const [openWeek, setOpenWeek] = useState<string | null>(null);
  const [coverageOpen, setCoverageOpen] = useState(false);

  const today = todayYmd();
  const list: SheetRow[] = useMemo(() => sheets ?? [], [sheets]);
  const previewIdx = previewId ? list.findIndex((s) => s.id === previewId) : -1;
  const sheetByDate = useMemo(() => {
    const m = new Map<string, SheetRow>();
    for (const s of list) m.set(s.date, s);
    return m;
  }, [list]);
  const mainDays = useMemo(() => new Set(slotDays?.mainDays ?? []), [slotDays]);
  const revisionDays = useMemo(
    () => new Set(slotDays?.revisionDays ?? []),
    [slotDays],
  );

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

  // Weeks: sheets grouped by their Monday. A sheet interleaves several units,
  // so the honest timeline header is the WEEK, not one unit name. Each week
  // also carries its new/review split for the tiny mix bar.
  const weeks = useMemo(() => {
    const out: Array<{
      weekStart: string;
      sheets: SheetRow[];
      newTotal: number;
      reviewTotal: number;
    }> = [];
    for (const s of list) {
      const ws = weekStartYmd(s.date);
      const last = out[out.length - 1];
      if (!last || last.weekStart !== ws)
        out.push({
          weekStart: ws,
          sheets: [s],
          newTotal: s.newCount,
          reviewTotal: s.spiralCount,
        });
      else {
        last.sheets.push(s);
        last.newTotal += s.newCount;
        last.reviewTotal += s.spiralCount;
      }
    }
    return out;
  }, [list]);

  // Per-week book-order grids: for each unit taught that week, its questions in
  // book order, each marked by what THIS week does with it — new pick, review
  // pick, picked another week, or not yet. Built from coverage (every question
  // carries the sheetDate it landed on). Units with no pick this week are
  // dropped from the week.
  const weekGrids = useMemo(() => {
    const m = new Map<
      string,
      Array<{
        unitId: string;
        boxes: Array<{
          questionId: string;
          label: string | null;
          mark: 'new' | 'review' | 'other' | 'unseen';
        }>;
      }>
    >();
    if (!coverage || !('status' in coverage) || coverage.status !== 'ok')
      return m;
    for (const w of weeks) {
      const units: Array<{
        unitId: string;
        boxes: Array<{
          questionId: string;
          label: string | null;
          mark: 'new' | 'review' | 'other' | 'unseen';
        }>;
      }> = [];
      for (const u of coverage.units) {
        let picks = 0;
        const boxes = u.questions.map((q) => {
          const inWeek =
            q.sheetDate !== null && weekStartYmd(q.sheetDate) === w.weekStart;
          let mark: 'new' | 'review' | 'other' | 'unseen';
          if (inWeek) {
            picks += 1;
            mark = q.section === 'spiral' ? 'review' : 'new';
          } else if (q.state === 'done' || q.state === 'planned') {
            mark = 'other';
          } else {
            mark = 'unseen';
          }
          return {
            questionId: q.questionId as unknown as string,
            label: q.label,
            mark,
          };
        });
        if (picks > 0) units.push({ unitId: u.unitId, boxes });
      }
      m.set(w.weekStart, units);
    }
    return m;
  }, [coverage, weeks]);

  // Cumulative term progress by the END of each week: % of the term's
  // questions covered on or before that week (+ anything already covered
  // before the timeline). Lets the founder see whether the fill reaches 100%
  // BEFORE the red exam line — the deadline check, made visual.
  const weekProgress = useMemo(() => {
    const m = new Map<string, number>();
    if (!coverage || !('status' in coverage) || coverage.status !== 'ok')
      return m;
    let total = 0;
    let baseCovered = 0; // covered before the timeline (pre-taught / member)
    const byWeek = new Map<string, number>();
    for (const u of coverage.units) {
      total += u.totalQuestions;
      for (const q of u.questions) {
        if (q.sheetDate) {
          const ws = weekStartYmd(q.sheetDate);
          byWeek.set(ws, (byWeek.get(ws) ?? 0) + 1);
        } else if (q.state === 'done') {
          baseCovered += 1;
        }
      }
    }
    let running = baseCovered;
    for (const w of weeks) {
      running += byWeek.get(w.weekStart) ?? 0;
      m.set(w.weekStart, total > 0 ? Math.round((running / total) * 100) : 0);
    }
    return m;
  }, [coverage, weeks]);

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

  const coverageReady =
    coverage && 'status' in coverage && coverage.status === 'ok';
  const coveragePct = coverageReady
    ? (() => {
        let d = 0;
        let t = 0;
        for (const u of coverage.units) {
          d += u.doneCount;
          t += u.totalQuestions;
        }
        return t > 0 ? Math.round((d / t) * 100) : 0;
      })()
    : null;

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

      {/* ── Coverage — collapsed to a whole-term summary ──────────────── */}
      {groupId && (
        <div className="mb-4">
          <button
            onClick={() => setCoverageOpen((o) => !o)}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-xl border border-border bg-card"
          >
            <span className="text-[11px] font-bold text-foreground uppercase tracking-wide">
              Coverage
            </span>
            {coveragePct !== null && (
              <span className="text-[10px] text-muted-foreground">
                {coveragePct}% of the term covered
              </span>
            )}
            <span className="h-px flex-1 bg-border" />
            <ChevronDown
              className={cn(
                'w-4 h-4 text-muted-foreground transition-transform',
                coverageOpen && 'rotate-180',
              )}
            />
          </button>
          {coverageOpen && (
            <div className="mt-2">
              <GroupCoverage
                groupId={groupId}
                term={covTerm}
                setTerm={setCovTerm}
              />
            </div>
          )}
        </div>
      )}

      {/* ── Timeline — one card per WEEK (the planning workspace) ──────── */}
      {groupId && (
        <div>
          <div className="flex items-center gap-2 mb-2.5">
            <span className="text-[11px] font-bold text-foreground uppercase tracking-wide">
              Timeline
            </span>
            <span className="text-[10px] text-muted-foreground">
              by week · tap a week to see its picks
            </span>
            <span className="h-px flex-1 bg-border" />
          </div>

          {sheets === undefined && (
            <div className="space-y-2 animate-pulse">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-14 bg-muted rounded-xl" />
              ))}
            </div>
          )}

          {sheets !== undefined && list.length === 0 && (
            <div className="rounded-xl border border-border bg-card p-4 text-center text-sm text-muted-foreground">
              No sheets yet — press &ldquo;Run all term sheets&rdquo; to build
              the whole term.
            </div>
          )}

          <div className="space-y-2.5">
            {weeks.map((w) => {
              const showToday =
                !todayLineShown && w.sheets.some((s) => s.date >= today);
              if (showToday) todayLineShown = true;
              const showExam =
                exam !== null && !examLineShown && w.weekStart > exam.date;
              if (showExam) examLineShown = true;
              const wd = fmtDayMonth(w.weekStart);
              const isOpen = openWeek === w.weekStart;
              const total = w.newTotal + w.reviewTotal;
              const newPct = total > 0 ? (w.newTotal / total) * 100 : 0;
              const grids = weekGrids.get(w.weekStart) ?? [];
              const weekPast = w.sheets.every((s) => s.date < today);
              const weekAfterExam = exam !== null && w.weekStart > exam.date;
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
                  <div
                    className={cn(
                      'rounded-xl border bg-card overflow-hidden',
                      weekAfterExam ? 'border-rose-500/40' : 'border-border',
                      weekPast && 'opacity-60',
                    )}
                  >
                    {/* Week card header — one card, no repeated month */}
                    <button
                      onClick={() =>
                        setOpenWeek((cur) =>
                          cur === w.weekStart ? null : w.weekStart,
                        )
                      }
                      className="w-full text-left px-3 py-2.5"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-[12px] font-bold text-foreground shrink-0">
                          Week of {wd.day}
                        </span>
                        {weekAfterExam && (
                          <span className="px-1 py-px rounded bg-rose-500/15 text-rose-500 text-[7.5px] font-bold leading-tight">
                            after exam
                          </span>
                        )}
                        <span className="h-px flex-1 bg-border" />
                        <span className="text-[9.5px] text-muted-foreground tabular-nums shrink-0">
                          {total}q · {w.sheets.length}sh
                        </span>
                        <ChevronDown
                          className={cn(
                            'w-4 h-4 text-muted-foreground shrink-0 transition-transform',
                            isOpen && 'rotate-180',
                          )}
                        />
                      </div>
                      {/* tiny new/review mix bar */}
                      <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden flex mt-2">
                        <div
                          className="h-full bg-teal-400"
                          style={{ width: `${newPct}%` }}
                        />
                        <div
                          className="h-full bg-amber-400"
                          style={{ width: `${100 - newPct}%` }}
                        />
                      </div>
                      <div className="flex gap-3 mt-1 text-[8.5px]">
                        <span className="text-teal-500 font-semibold">
                          {w.newTotal} new
                        </span>
                        {w.reviewTotal > 0 && (
                          <span className="text-amber-500 font-semibold">
                            {w.reviewTotal} review
                          </span>
                        )}
                      </div>
                      {/* Cumulative term progress by the end of this week */}
                      {weekProgress.has(w.weekStart) && (
                        <div className="mt-1.5">
                          <div className="h-1 w-full rounded-full bg-muted overflow-hidden">
                            <div
                              className={cn(
                                'h-full',
                                weekAfterExam &&
                                  (weekProgress.get(w.weekStart) ?? 0) < 100
                                  ? 'bg-rose-500'
                                  : 'bg-emerald-500',
                              )}
                              style={{
                                width: `${weekProgress.get(w.weekStart) ?? 0}%`,
                              }}
                            />
                          </div>
                          <div className="text-[8px] text-muted-foreground mt-0.5">
                            {weekProgress.get(w.weekStart)}% of term done by here
                          </div>
                        </div>
                      )}
                    </button>

                    {isOpen && (
                      <div className="px-3 pb-3 border-t border-border/60 pt-2.5 space-y-3">
                        {/* 7+7 day grid: Main + Revision, Mon→Sun. Filled Main
                            box = a sheet that day (tap to open); Revision box =
                            a revision session that day. */}
                        <div className="flex items-start gap-3">
                          <div className="text-[9px] text-muted-foreground leading-[1.6rem] pt-4">
                            {DOW_LETTERS.map((L, i) => (
                              <div key={i} className="h-6">
                                {L}
                              </div>
                            ))}
                          </div>
                          {(['Main', 'Rev'] as const).map((col) => (
                            <div key={col} className="text-center">
                              <div className="text-[8.5px] font-semibold text-muted-foreground mb-1">
                                {col}
                              </div>
                              <div className="space-y-1">
                                {DOW_LETTERS.map((_, i) => {
                                  const dow = i + 1;
                                  const date = addDaysYmd(w.weekStart, i);
                                  if (col === 'Main') {
                                    const isMainDay = mainDays.has(dow);
                                    const sh = sheetByDate.get(date);
                                    if (!isMainDay && !sh)
                                      return (
                                        <div key={i} className="w-7 h-6" />
                                      );
                                    return (
                                      <button
                                        key={i}
                                        onClick={() =>
                                          sh && setPreviewId(sh.id)
                                        }
                                        disabled={!sh}
                                        className={cn(
                                          'w-7 h-6 rounded-md border text-[8.5px] font-bold flex items-center justify-center tabular-nums',
                                          sh
                                            ? 'bg-primary/15 border-primary/50 text-primary'
                                            : 'border-dashed border-border text-muted-foreground/40',
                                        )}
                                      >
                                        {sh ? sh.newCount + sh.spiralCount : ''}
                                      </button>
                                    );
                                  }
                                  const isRevDay = revisionDays.has(dow);
                                  return (
                                    <div
                                      key={i}
                                      className={cn(
                                        'w-7 h-6 rounded-md border flex items-center justify-center',
                                        isRevDay
                                          ? 'bg-amber-500/15 border-amber-500/50 text-amber-500'
                                          : 'border-dashed border-border/60',
                                      )}
                                    >
                                      {isRevDay && (
                                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          ))}
                          <div className="flex-1 text-[8.5px] text-muted-foreground pt-4 leading-snug">
                            Tap a Main box to open that day&rsquo;s sheet.
                            Revision days are marked; moving sheets onto them
                            comes next.
                          </div>
                        </div>

                        {/* This week's sessions — tap to preview the sheet */}
                        <div className="flex flex-wrap gap-1.5">
                          {w.sheets.map((s) => {
                            const d = fmtDayMonth(s.date);
                            const chip =
                              STATUS_CHIP[s.status] ?? STATUS_CHIP.planned;
                            return (
                              <button
                                key={s.id as unknown as string}
                                onClick={() => setPreviewId(s.id)}
                                className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg border border-border bg-card text-[10px]"
                              >
                                <span className="font-bold text-foreground">
                                  {d.weekday} {d.day}
                                </span>
                                <span className="text-muted-foreground tabular-nums">
                                  {s.newCount}n
                                  {s.spiralCount > 0 && (
                                    <span className="text-amber-500">
                                      +{s.spiralCount}r
                                    </span>
                                  )}
                                </span>
                                <span
                                  className={cn(
                                    'px-1 py-px rounded border text-[7.5px] font-semibold leading-tight',
                                    chip.className,
                                  )}
                                >
                                  {chip.label}
                                </span>
                              </button>
                            );
                          })}
                        </div>

                        {/* Book-order grids: which questions this week covers */}
                        {coverage === undefined && (
                          <div className="h-8 bg-muted rounded animate-pulse" />
                        )}
                        {coverage !== undefined && grids.length === 0 && (
                          <div className="text-[10px] text-muted-foreground italic">
                            Question grid appears once this week&rsquo;s units
                            have book entered (and you&rsquo;re viewing their
                            term in Coverage).
                          </div>
                        )}
                        {grids.map((g) => (
                          <div key={g.unitId}>
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-[10.5px] font-bold text-foreground truncate">
                                {unitName(g.unitId)}
                              </span>
                              <span className="h-px flex-1 bg-border/60" />
                            </div>
                            <div className="flex flex-wrap gap-1">
                              {g.boxes.map((b, bi) => (
                                <span
                                  key={b.questionId}
                                  title={b.label ?? undefined}
                                  className={cn(
                                    'w-6 h-6 rounded-md border text-[8px] font-semibold leading-none flex items-center justify-center tabular-nums',
                                    b.mark === 'new' &&
                                      'bg-teal-500/25 border-teal-500/50 text-teal-600 dark:text-teal-400',
                                    b.mark === 'review' &&
                                      'bg-amber-500/25 border-amber-500/50 text-amber-600 dark:text-amber-400',
                                    b.mark === 'other' &&
                                      'bg-muted/50 border-border/50 text-muted-foreground/50',
                                    b.mark === 'unseen' &&
                                      'bg-transparent border-dashed border-border text-muted-foreground/40',
                                  )}
                                >
                                  {shortLabel(b.label, bi)}
                                </span>
                              ))}
                            </div>
                          </div>
                        ))}
                        {grids.length > 0 && (
                          <div className="flex flex-wrap gap-x-3 gap-y-1 text-[8.5px] text-muted-foreground">
                            <span className="flex items-center gap-1">
                              <span className="w-2.5 h-2.5 rounded bg-teal-500/30 border border-teal-500/50" />
                              new this week
                            </span>
                            <span className="flex items-center gap-1">
                              <span className="w-2.5 h-2.5 rounded bg-amber-500/30 border border-amber-500/50" />
                              review this week
                            </span>
                            <span className="flex items-center gap-1">
                              <span className="w-2.5 h-2.5 rounded bg-muted border border-border/50" />
                              other week
                            </span>
                            <span className="flex items-center gap-1">
                              <span className="w-2.5 h-2.5 rounded border border-dashed border-border" />
                              not yet
                            </span>
                          </div>
                        )}
                      </div>
                    )}
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
