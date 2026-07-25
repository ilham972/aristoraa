'use client';

// GroupSheets — the Planner's "Sheets" tab (2026-07-15): every sheet of the
// term for one group, prebuilt end to end. Pick grade → group, then:
//   Run all term sheets — crystallize EVERY session to the horizon in one
//   tap (counts are stable under difficulty re-ordering; planned rows stay
//   re-pickable until printed).
//   Re-plan future — after a Lesson-Builder reorder: drop every future
//   still-planned row and rebuild it from the fresh book order.
//   The timeline — a metro-line master/detail (2026-07-16 redesign): a
//   narrow left rail lists EVERY week of the term as a tiny ring-station —
//   the ring outline is term progress (dim teal = covered before this week,
//   bright emerald = what this week adds), with the exam as a red flag stop
//   on the same line. All weeks fit on one screen, no scrolling. Tapping a
//   station fills the fixed right card with that week's detail (session
//   chips, book-order question grids, horizontal 7+7 day strip at the
//   bottom). When the question bank runs dry (book entry hasn't reached
//   later units) an amber banner says so instead of the old silent stop.

import { useEffect, useMemo, useState } from 'react';
import { useAction, useMutation, useQuery } from 'convex/react';
import {
  ArrowUpDown,
  Ban,
  BookOpen,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  FileText,
  Flag,
  Loader2,
  Minus,
  MoveRight,
  Plus,
  RefreshCw,
  Repeat,
  Sparkles,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { toast } from 'sonner';
import { api, type Id } from '@/lib/convex';
import { sortByBookOrder } from '@/lib/book-order';
import { cn } from '@/lib/utils';
import { useCachedQuery } from '@/hooks/use-cached-query';
import { CropThumbnail } from '@/components/algorithm/sheet-preview';
import { useUnitName, type PlannerGroupRow } from './group-plan-card';
import { shortLabel } from './group-coverage';
import { CompressionDialog } from './compression-dialog';
import { GroupLessonBuilder } from './group-lesson-builder';
import { UnitArrangeDialog } from './unit-arrange-dialog';
import { fmtWeekdayDate, planStatusMessage } from './verdict';

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

// Term parsed from a unit id (M1-G10-T2-005 → 2). Mirror of the backend's
// termFromUnitId — lets the coverage term FOLLOW the tapped week/session, so
// old-term weeks stop showing blank question grids (2026-07-25 fix).
function termOfUnit(unitId: string): number | null {
  const m = /^M\d+-G\d+-T(\d+)-\d+$/.exec(unitId);
  return m ? Number(m[1]) : null;
}

const DOW_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

// A week "station" on the rail: the ring outline IS the term progress.
// Dim teal arc = covered before this week; bright emerald arc = what this
// week adds. A full circle before the exam flag = the term closes in time.
function WeekRing({
  dayNum,
  before,
  delta,
  afterExam,
  selected,
}: {
  dayNum: string;
  before: number;
  delta: number;
  afterExam: boolean;
  selected: boolean;
}) {
  const R = 12;
  const C = 2 * Math.PI * R;
  const beforeLen = (Math.min(before, 100) / 100) * C;
  const deltaLen = (Math.min(delta, Math.max(0, 100 - before)) / 100) * C;
  return (
    <span
      className={cn(
        'relative w-7 h-7 shrink-0 rounded-full flex items-center justify-center',
        selected ? 'bg-primary/15' : 'bg-background',
      )}
    >
      <svg viewBox="0 0 28 28" className="absolute inset-0 w-7 h-7 -rotate-90">
        <circle
          cx="14"
          cy="14"
          r={R}
          fill="none"
          strokeWidth="2.5"
          className={afterExam ? 'stroke-rose-500/25' : 'stroke-muted'}
        />
        {beforeLen > 0 && (
          <circle
            cx="14"
            cy="14"
            r={R}
            fill="none"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeDasharray={`${beforeLen} ${C}`}
            className="stroke-teal-500/40"
          />
        )}
        {deltaLen > 0 && (
          <circle
            cx="14"
            cy="14"
            r={R}
            fill="none"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeDasharray={`${deltaLen} ${C}`}
            strokeDashoffset={-beforeLen}
            className="stroke-emerald-400"
          />
        )}
      </svg>
      <span
        className={cn(
          'text-[8.5px] font-bold tabular-nums leading-none',
          selected ? 'text-primary' : 'text-muted-foreground',
        )}
      >
        {dayNum}
      </span>
    </span>
  );
}

// The exam as a terminus stop on the same metro line.
function ExamStop({ date }: { date: string }) {
  return (
    <div className="flex items-center gap-2 py-1 sm:px-1.5">
      <span className="w-7 flex justify-center shrink-0">
        <span className="w-5 h-5 rounded-full bg-background border-2 border-rose-500/60 flex items-center justify-center">
          <Flag className="w-2.5 h-2.5 text-rose-500" />
        </span>
      </span>
      <span className="hidden sm:block min-w-0 flex-1 text-[8.5px] font-bold text-rose-500 uppercase tracking-widest truncate">
        exam · {fmtWeekdayDate(date)}
      </span>
    </div>
  );
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
  const groups = useCachedQuery(
    api.learningEngine.plannerBoard.plannerGroups,
    {},
  );
  const gradeGroups = useMemo(
    () =>
      (groups ?? [])
        .filter((g: PlannerGroupRow) => g.grade === grade)
        .sort((a: PlannerGroupRow, b: PlannerGroupRow) =>
          a.name.localeCompare(b.name),
        ),
    [groups, grade],
  );

  const [groupId, setGroupId] = useState<Id<'groups'> | null>(null);
  useEffect(() => {
    if (gradeGroups.length === 0) {
      setGroupId(null);
      return;
    }
    if (
      !groupId ||
      !gradeGroups.some((g: PlannerGroupRow) => g.groupId === groupId)
    ) {
      const preferred =
        gradeGroups.find((g: PlannerGroupRow) => g.trackName !== null) ??
        gradeGroups[0];
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
    groupId
      ? { groupId, ...(covTerm !== null ? { term: covTerm } : {}) }
      : 'skip',
  );
  // The group's weekly Main + Revision slot days — the 7+7 day grid.
  const slotDays = useCachedQuery(
    api.learningEngine.groupPlan.groupSlotDays,
    groupId ? { groupId } : 'skip',
  );

  const crystallize = useMutation(
    api.learningEngine.groupPlan.crystallizeUpcoming,
  );
  const replanTermMut = useMutation(api.learningEngine.groupPlan.replanTerm);
  const moveGroupSheetMut = useMutation(
    api.learningEngine.groupPlan.moveGroupSheet,
  );
  const unitName = useUnitName();
  const [busy, setBusy] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<Id<'groupSheets'> | null>(null);
  const [selectedWeek, setSelectedWeek] = useState<string | null>(null);
  const [arrangeUnitId, setArrangeUnitId] = useState<string | null>(null);
  // Chip pills: print-preview dialog target + "show this sheet in the grid".
  const [pdfSheet, setPdfSheet] = useState<{
    id: Id<'groupSheets'>;
    date: string;
  } | null>(null);
  // The card is SESSION-centric (redesign round 2, founder feedback
  // 2026-07-18): row 1 = the week's session chips, row 2 = the selected
  // session's unit chips (one unit's grid at a time), row 3 = its physical
  // A4 sheets. Selecting a session/unit/sheet narrows everything below it.
  const [selDate, setSelDate] = useState<string | null>(null);
  const [selUnitId, setSelUnitId] = useState<string | null>(null);
  // Selected physical A4 sheet's question ids (2 printed pages = 1 sheet of
  // paper): rings just those in the grid. null = whole session.
  const [selSheetIds, setSelSheetIds] = useState<Set<string> | null>(null);
  // Unit-curation dialog (the group Lesson Builder) — opened from a unit name.
  const [builderUnitId, setBuilderUnitId] = useState<string | null>(null);
  // "+ unit" — unit-compression confirm sheet.
  const [compressOpen, setCompressOpen] = useState(false);
  // Day picker: assign a planned sheet to a revision class this week.
  const [assignSheet, setAssignSheet] = useState<{
    id: Id<'groupSheets'>;
    weekStart: string;
    date: string;
  } | null>(null);

  const today = todayYmd();
  const list: SheetRow[] = useMemo(() => sheets ?? [], [sheets]);
  const previewIdx = previewId ? list.findIndex((s) => s.id === previewId) : -1;
  const sheetByDate = useMemo(() => {
    const m = new Map<string, SheetRow>();
    // Two rows CAN share a date (a planned sheet assigned onto a day whose
    // old sheet was delegated) — the live one must win every by-date lookup
    // (day strip, assign-dialog hint), or it becomes untappable.
    for (const s of list) {
      const prev = m.get(s.date);
      if (!prev || (prev.status === 'delegated' && s.status !== 'delegated'))
        m.set(s.date, s);
    }
    return m;
  }, [list]);
  // The term chips are an override, but the tapped week/session is the newer
  // intent — selecting a session from another term re-aims coverage at THAT
  // term (otherwise its question grids render blank). Reset on group switch.
  useEffect(() => {
    setCovTerm(null);
  }, [groupId]);
  const followTermOf = (unitId: string) => {
    const t = termOfUnit(unitId);
    if (t !== null) setCovTerm(t);
  };
  // A4 pages of the SELECTED session — exact after a print-preview render,
  // estimated from crop sizes before one. One physical A4 sheet of paper =
  // 2 printed pages (front + back), so pages are folded in twos.
  const selSheet = selDate ? sheetByDate.get(selDate) : undefined;
  const sheetPages = useCachedQuery(
    api.learningEngine.groupPlan.groupSheetPages,
    selSheet ? { groupSheetId: selSheet.id } : 'skip',
  );
  const a4Sheets = useMemo(() => {
    if (!sheetPages)
      return [] as Array<{ n: number; ids: Set<string>; count: number }>;
    const bySheet = new Map<number, string[]>();
    for (const p of sheetPages.pages) {
      const n = Math.ceil(p.page / 2);
      const acc = bySheet.get(n) ?? [];
      for (const q of p.questionIds) acc.push(q as unknown as string);
      bySheet.set(n, acc);
    }
    return Array.from(bySheet.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([n, ids]) => ({ n, ids: new Set(ids), count: ids.length }));
  }, [sheetPages]);
  // A resize / re-plan changes the page split — a kept A4 selection would
  // ring stale question ids (grid all dimmed, nothing ringed).
  useEffect(() => {
    setSelSheetIds(null);
  }, [sheetPages]);
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

  // Per-SESSION question grids (round 2): for each unit the selected session
  // touches, its questions in BOOK order (coverage returns the ladder = pick
  // order, so we re-sort by label — the point is seeing WHERE in the book
  // the picks landed), each marked by what THIS session does with it. The
  // unit-chip row is derived from this; only ONE unit's grid renders at a
  // time (founder: seeing several stacked grids at once was noise).
  type GridBox = {
    questionId: string;
    label: string | null;
    mark: 'new' | 'review' | 'other' | 'unseen' | 'banned' | 'routed';
  };
  const sessionUnits = useMemo(() => {
    const out: Array<{ unitId: string; picks: number; boxes: GridBox[] }> = [];
    if (
      !coverage ||
      !('status' in coverage) ||
      coverage.status !== 'ok' ||
      !selDate
    )
      return out;
    for (const u of coverage.units) {
      let picks = 0;
      const boxes = u.questions.map((q): GridBox => {
        let mark: GridBox['mark'];
        if (q.sheetDate === selDate) {
          picks += 1;
          mark = q.section === 'spiral' ? 'review' : 'new';
        } else if (q.state === 'done' || q.state === 'planned') {
          mark = 'other';
        } else if (q.state === 'banned') {
          mark = 'banned';
        } else if (q.state === 'revision') {
          // "Yellow": routed to the Revision department's queues.
          mark = 'routed';
        } else {
          mark = 'unseen';
        }
        return {
          questionId: q.questionId as unknown as string,
          label: q.label,
          mark,
        };
      });
      if (picks > 0)
        out.push({ unitId: u.unitId, picks, boxes: sortByBookOrder(boxes) });
    }
    return out;
  }, [coverage, selDate]);
  const activeUnit =
    sessionUnits.find((u) => u.unitId === selUnitId) ?? sessionUnits[0] ?? null;

  // Cumulative term progress per week, split for the ring stations:
  // `before` = % covered before the week starts (dim teal arc), `delta` =
  // what this week adds (bright emerald arc), `cum` = by the end of the week.
  // Lets the founder see whether the fill reaches 100% BEFORE the red exam
  // flag — the deadline check, made visual — and how each week compares to
  // the one before it.
  const weekProgress = useMemo(() => {
    const m = new Map<string, { cum: number; before: number; delta: number }>();
    if (!coverage || !('status' in coverage) || coverage.status !== 'ok')
      return m;
    let total = 0;
    let baseCovered = 0; // covered before the timeline (pre-taught / member)
    const byWeek = new Map<string, number>();
    for (const u of coverage.units) {
      // Excluded (unticked) questions are not part of the plan → not part
      // of 100% either. Routed-to-revision questions leave the MAIN
      // denominator too — they're the Revision department's load, and they
      // re-enter as covered once a revision sheet actually serves them.
      total += u.totalQuestions - u.bannedCount - u.routedCount;
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
      const before = total > 0 ? Math.round((running / total) * 100) : 0;
      running += byWeek.get(w.weekStart) ?? 0;
      const cum = total > 0 ? Math.round((running / total) * 100) : 0;
      m.set(w.weekStart, { cum, before, delta: cum - before });
    }
    return m;
  }, [coverage, weeks]);

  // Default rail selection: the current week, else the first upcoming one,
  // else the last planned week. Re-resolves when the group (and its weeks)
  // changes.
  useEffect(() => {
    if (weeks.length === 0) {
      setSelectedWeek(null);
      return;
    }
    if (selectedWeek && weeks.some((w) => w.weekStart === selectedWeek)) return;
    const thisWeek = weekStartYmd(todayYmd());
    const pick =
      weeks.find((w) => w.weekStart >= thisWeek) ?? weeks[weeks.length - 1];
    setSelectedWeek(pick.weekStart);
  }, [weeks, selectedWeek]);

  // Default session selection inside the selected week: the first upcoming
  // session, else the week's first. Re-resolves when the week changes.
  useEffect(() => {
    const w = weeks.find((x) => x.weekStart === selectedWeek);
    if (!w || w.sheets.length === 0) {
      if (selDate !== null) setSelDate(null);
      return;
    }
    if (selDate && w.sheets.some((s) => s.date === selDate)) return;
    const pick = w.sheets.find((s) => s.date >= today) ?? w.sheets[0];
    setSelDate(pick.date);
    setSelUnitId(null);
    setSelSheetIds(null);
  }, [selectedWeek, weeks, selDate, today]);

  // Book-coverage gap, from the live skeleton: units whose ladder is empty.
  const bookGap = useMemo(() => {
    if (!lessonPlan || lessonPlan.status !== 'ok' || !lessonPlan.units)
      return null;
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
      if (res.status !== 'ok') toast.error(planStatusMessage(res.status));
      else if (res.exhausted)
        toast.warning(
          `Built ${res.written} sheets, then the question bank ran dry — ${res.unplannedSessions} sessions have nothing left to plan. Enter more of the book to continue.`,
          { duration: 8000 },
        );
      else if (res.written === 0)
        toast.info(
          'Every session is already planned — the term is fully built.',
        );
      else
        toast.success(
          `Built ${res.written} sheets — the whole term is planned.`,
        );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(null);
    }
  };

  // The actual re-plan (one atomic backend call: nothing is dropped unless
  // the rebuild succeeds). Shared by the Re-plan button and the "Skip day"
  // follow-up toast, so the confirm dialog lives only on the button.
  const doReplan = async () => {
    if (!groupId) return;
    setBusy('replan');
    try {
      const res = await replanTermMut({ groupId, daysAhead: 180 });
      if (res.exhausted)
        toast.warning(
          `Re-planned ${res.deleted}→${res.written} sheets, then the question bank ran dry — ${res.unplannedSessions} sessions have nothing left to plan. Enter more of the book to continue.`,
          { duration: 8000 },
        );
      else
        toast.success(
          `Re-planned: ${res.deleted} sheets dropped, ${res.written} rebuilt from the current order.`,
        );
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
    await doReplan();
  };

  if (groups !== undefined && gradeGroups.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card p-4 text-center text-sm text-muted-foreground">
        No grade-{grade} groups on the timetable yet.
      </div>
    );
  }

  const coverageReady =
    coverage && 'status' in coverage && coverage.status === 'ok';
  const coveragePct = coverageReady
    ? (() => {
        let d = 0;
        let t = 0;
        for (const u of coverage.units) {
          d += u.doneCount;
          t += u.totalQuestions - u.bannedCount - u.routedCount;
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
            entry:{' '}
            <span className="font-semibold">{unitName(bookGap.nextEmpty)}</span>
            .
          </div>
        </div>
      )}

      {/* ── Coverage — a summary strip only (2026-07-17) ────────────────
          The cockpit itself moved to Insights → Coverage → Groups so coverage
          has one home. The TERM CHIPS stay here: they set covTerm, which the
          week question grids below are built from — losing them would freeze
          the timeline on the backend's default term. */}
      {groupId && (
        <div className="mb-4 rounded-xl border border-border bg-card px-3 py-2.5">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-bold text-foreground uppercase tracking-wide">
              Coverage
            </span>
            {coveragePct !== null && (
              <span className="text-[10px] text-muted-foreground">
                {coveragePct}% of the term covered
              </span>
            )}
            <span className="h-px flex-1 bg-border" />
            <Link
              href={`/algorithm?tab=coverage&lens=groups&group=${groupId as unknown as string}`}
              className="shrink-0 inline-flex items-center gap-1 text-[10px] font-semibold text-primary"
            >
              See full coverage
              <ExternalLink className="w-3 h-3" />
            </Link>
          </div>
          {coverageReady && coverage.availableTerms.length > 1 && (
            <div className="flex items-center gap-1.5 mt-2">
              <span className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wide mr-0.5">
                Term
              </span>
              {coverage.availableTerms.map((t: number) => (
                <button
                  key={t}
                  onClick={() => {
                    setCovTerm(t);
                    // Jump the timeline to the first week teaching this term
                    // so the grids below match the chip.
                    const wk = weeks.find((w) =>
                      w.sheets.some((s) => termOfUnit(s.unitId) === t),
                    );
                    setSelectedWeek(wk ? wk.weekStart : null);
                    setSelDate(null);
                    setSelUnitId(null);
                    setSelSheetIds(null);
                  }}
                  className={cn(
                    'w-7 h-7 rounded-lg border text-[11px] font-bold',
                    t === coverage.term
                      ? 'border-primary/60 bg-primary/10 text-foreground'
                      : 'border-border bg-card text-muted-foreground',
                  )}
                >
                  {t}
                </button>
              ))}
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
              tap a week on the line · detail stays on the right
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

          {list.length > 0 && (
            <div className="flex items-start gap-2 sm:gap-3">
              {/* Left rail — every week is a station on one metro line, the
                  exam a terminus flag. All weeks visible, no scrolling. */}
              <div className="relative w-11 sm:w-44 shrink-0">
                <div className="absolute left-3.5 sm:left-5 top-4 bottom-4 w-px bg-border/70" />
                <div className="relative">
                  {weeks.map((w) => {
                    const prog = weekProgress.get(w.weekStart);
                    const total = w.newTotal + w.reviewTotal;
                    const weekPast = w.sheets.every((s) => s.date < today);
                    const weekAfterExam =
                      exam !== null && w.weekStart > exam.date;
                    const isSel = selectedWeek === w.weekStart;
                    const isThisWeek = w.weekStart === weekStartYmd(today);
                    const firstAfterExam =
                      weekAfterExam &&
                      exam !== null &&
                      weeks.find((x) => x.weekStart > exam.date) === w;
                    return (
                      <div key={w.weekStart}>
                        {firstAfterExam && exam && (
                          <ExamStop date={exam.date} />
                        )}
                        <button
                          onClick={() => {
                            setSelectedWeek(w.weekStart);
                            setSelDate(null);
                            setSelUnitId(null);
                            setSelSheetIds(null);
                            if (w.sheets.length > 0)
                              followTermOf(w.sheets[0].unitId);
                          }}
                          className={cn(
                            'w-full flex items-center gap-2 rounded-lg py-0.5 sm:px-1.5 text-left',
                            isSel && 'sm:bg-primary/10',
                            weekPast && !isSel && 'opacity-50',
                          )}
                        >
                          <span className="relative shrink-0">
                            <WeekRing
                              dayNum={String(Number(w.weekStart.slice(8, 10)))}
                              before={prog?.before ?? 0}
                              delta={prog?.delta ?? 0}
                              afterExam={weekAfterExam}
                              selected={isSel}
                            />
                            {isThisWeek && (
                              <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-primary animate-pulse ring-2 ring-background" />
                            )}
                          </span>
                          <span className="hidden sm:block min-w-0 flex-1 leading-tight">
                            <span
                              className={cn(
                                'block text-[10.5px] font-bold',
                                isSel
                                  ? 'text-foreground'
                                  : weekAfterExam
                                    ? 'text-rose-500/80'
                                    : 'text-muted-foreground',
                              )}
                            >
                              {fmtDayMonth(w.weekStart).day}
                            </span>
                            <span className="block text-[8.5px] text-muted-foreground tabular-nums">
                              {total}q
                              {prog && prog.delta > 0 && (
                                <span className="text-emerald-500 font-semibold">
                                  {' '}
                                  +{prog.delta}%
                                </span>
                              )}
                            </span>
                          </span>
                        </button>
                      </div>
                    );
                  })}
                  {exam !== null &&
                    !weeks.some((w) => w.weekStart > exam.date) && (
                      <ExamStop date={exam.date} />
                    )}
                </div>
              </div>

              {/* Right — the fixed detail card: never moves, only its
                  content swaps when a station is tapped. */}
              <div className="flex-1 min-w-0 sticky top-2 self-start">
                {(() => {
                  const w =
                    weeks.find((x) => x.weekStart === selectedWeek) ?? weeks[0];
                  const wd = fmtDayMonth(w.weekStart);
                  const total = w.newTotal + w.reviewTotal;
                  const weekAfterExam =
                    exam !== null && w.weekStart > exam.date;
                  // Exam mid-week: the week itself is fine but some of its
                  // sessions land after the exam day — call those out too.
                  const afterExamCount =
                    exam === null || weekAfterExam
                      ? 0
                      : w.sheets.filter((s) => s.date > exam.date).length;
                  const prog = weekProgress.get(w.weekStart);
                  return (
                    <div
                      className={cn(
                        'rounded-xl border bg-card overflow-hidden flex flex-col max-h-[calc(100dvh-9rem)]',
                        weekAfterExam ? 'border-rose-500/40' : 'border-border',
                      )}
                    >
                      {/* Selected-week header */}
                      <div className="px-3 py-2.5 shrink-0">
                        <div className="flex items-center gap-2">
                          <span className="text-[12px] font-bold text-foreground shrink-0">
                            Week of {wd.day}
                          </span>
                          {weekAfterExam && (
                            <span className="px-1 py-px rounded bg-rose-500/15 text-rose-500 text-[7.5px] font-bold leading-tight">
                              after exam
                            </span>
                          )}
                          {afterExamCount > 0 && (
                            <span className="px-1 py-px rounded bg-rose-500/15 text-rose-500 text-[7.5px] font-bold leading-tight">
                              {afterExamCount} session
                              {afterExamCount === 1 ? '' : 's'} after exam
                            </span>
                          )}
                          <span className="h-px flex-1 bg-border" />
                          <span className="text-[9.5px] text-muted-foreground tabular-nums shrink-0">
                            {total}q · {w.sheets.length} session
                            {w.sheets.length === 1 ? '' : 's'}
                          </span>
                        </div>
                        {/* Counts, not a mix bar — a two-color composition
                            bar is always 100% full, so it said nothing. */}
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
                        {prog && (
                          <div className="mt-1.5">
                            <div className="h-1 w-full rounded-full bg-muted overflow-hidden">
                              <div
                                className={cn(
                                  'h-full',
                                  weekAfterExam && prog.cum < 100
                                    ? 'bg-rose-500'
                                    : 'bg-emerald-500',
                                )}
                                style={{ width: `${prog.cum}%` }}
                              />
                            </div>
                            <div className="text-[8px] text-muted-foreground mt-0.5">
                              {prog.cum}% of term done by here
                            </div>
                          </div>
                        )}
                      </div>

                      <div className="px-3 pb-3 border-t border-border/60 pt-2.5 space-y-3 overflow-y-auto">
                        {/* Row 1 — the week's SESSIONS, horizontal. Tap =
                            select (everything below follows); tap the
                            selected chip again = open the question drawer.
                            Pills: real-PDF print preview · assign to a
                            revision class. "+ session" is gone (round 2):
                            revision capacity is created on the Revision
                            timetable page — here sheets are only ASSIGNED
                            onto it (the ↻ pill / Rev row). */}
                        <div className="flex gap-1.5 overflow-x-auto pb-0.5">
                          {w.sheets.map((s) => {
                            const d = fmtDayMonth(s.date);
                            const chip =
                              STATUS_CHIP[s.status] ?? STATUS_CHIP.planned;
                            const sel = selDate === s.date;
                            // Day-granular, not week-granular: a Thursday
                            // session after a Wednesday exam must show red
                            // even though its week starts before the exam.
                            const pastExam =
                              exam !== null && s.date > exam.date;
                            return (
                              <div
                                key={s.id as unknown as string}
                                className={cn(
                                  'shrink-0 inline-flex items-stretch rounded-lg border bg-card overflow-hidden',
                                  sel
                                    ? 'border-primary/70 ring-1 ring-primary/30'
                                    : pastExam
                                      ? 'border-rose-500/50'
                                      : 'border-border',
                                )}
                              >
                                <button
                                  onClick={() => {
                                    if (sel) {
                                      setPreviewId(s.id);
                                    } else {
                                      setSelDate(s.date);
                                      setSelUnitId(null);
                                      setSelSheetIds(null);
                                      followTermOf(s.unitId);
                                    }
                                  }}
                                  title={
                                    sel
                                      ? 'Open the question drawer'
                                      : pastExam
                                        ? 'Select this session (falls AFTER the exam)'
                                        : 'Select this session'
                                  }
                                  className="inline-flex items-center gap-1.5 pl-2 pr-1.5 py-1 text-[10px]"
                                >
                                  <span
                                    className={cn(
                                      'font-bold',
                                      pastExam
                                        ? 'text-rose-500'
                                        : 'text-foreground',
                                    )}
                                  >
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
                                  {/* "planned" is the default — badge only the
                                      exceptions (taught / delegated). */}
                                  {s.status !== 'planned' && (
                                    <span
                                      className={cn(
                                        'px-1 py-px rounded border text-[7.5px] font-semibold leading-tight',
                                        chip.className,
                                      )}
                                    >
                                      {chip.label}
                                    </span>
                                  )}
                                </button>
                                <button
                                  onClick={() =>
                                    setPdfSheet({ id: s.id, date: s.date })
                                  }
                                  title="Print preview (real PDF)"
                                  aria-label="Print preview"
                                  className="px-1.5 border-l border-border/60 text-muted-foreground hover:text-foreground flex items-center"
                                >
                                  <FileText className="w-3 h-3" />
                                </button>
                                {s.status === 'planned' && (
                                  <button
                                    onClick={() =>
                                      setAssignSheet({
                                        id: s.id,
                                        weekStart: w.weekStart,
                                        date: s.date,
                                      })
                                    }
                                    title="Assign this sheet to a revision class"
                                    aria-label="Assign to revision"
                                    className="px-1.5 border-l border-border/60 text-muted-foreground hover:text-amber-500 flex items-center"
                                  >
                                    <Repeat className="w-3 h-3" />
                                  </button>
                                )}
                              </div>
                            );
                          })}
                        </div>

                        {/* Row 2 — the selected session's UNITS. One unit's
                            grid shows at a time; "+ unit" (compression — the
                            pace lever) closes the row. */}
                        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
                          {sessionUnits.map((u) => {
                            const on = activeUnit?.unitId === u.unitId;
                            return (
                              <button
                                key={u.unitId}
                                onClick={() => {
                                  setSelUnitId(u.unitId);
                                }}
                                className={cn(
                                  'shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-lg border text-[10px] font-semibold',
                                  on
                                    ? 'border-primary/60 bg-primary/10 text-foreground'
                                    : 'border-border text-muted-foreground',
                                )}
                              >
                                <span className="max-w-[9rem] truncate">
                                  {unitName(u.unitId)}
                                </span>
                                <span className="tabular-nums opacity-70">
                                  {u.picks}q
                                </span>
                              </button>
                            );
                          })}
                          <button
                            onClick={() => setCompressOpen(true)}
                            title="Start the next unit now — the algorithm proposes which questions move to Revision"
                            className="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-dashed border-emerald-500/50 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10"
                          >
                            <Plus className="w-3 h-3" />
                            unit
                          </button>
                        </div>

                        {/* Row 3 — the session's physical A4 SHEETS (one
                            sheet of paper = 2 printed pages), always shown.
                            Tap = ring only that sheet's questions below. */}
                        {a4Sheets.length > 0 && (
                          <div className="flex items-center flex-wrap gap-1">
                            <span className="text-[8.5px] font-semibold text-muted-foreground uppercase tracking-wide">
                              A4
                            </span>
                            {a4Sheets.map((sh) => {
                              const active =
                                selSheetIds !== null &&
                                selSheetIds.size === sh.ids.size &&
                                Array.from(sh.ids).every((q) =>
                                  selSheetIds.has(q),
                                );
                              return (
                                <button
                                  key={sh.n}
                                  onClick={() =>
                                    setSelSheetIds(active ? null : sh.ids)
                                  }
                                  className={cn(
                                    'inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border text-[9px] font-semibold tabular-nums',
                                    active
                                      ? 'border-primary bg-primary/15 text-primary'
                                      : 'border-border text-muted-foreground hover:text-foreground',
                                  )}
                                >
                                  Sheet {sh.n}
                                  <span className="opacity-70">
                                    {sh.count}q
                                  </span>
                                </button>
                              );
                            })}
                            {sheetPages && !sheetPages.exact && (
                              <span className="text-[8px] text-muted-foreground italic">
                                est. — open print preview for exact pages
                              </span>
                            )}
                          </div>
                        )}

                        {/* The selected unit's book-order grid */}
                        {coverage === undefined && (
                          <div className="h-8 bg-muted rounded animate-pulse" />
                        )}
                        {coverage !== undefined && !activeUnit && (
                          <div className="text-[10px] text-muted-foreground italic">
                            No question grid yet — this session&rsquo;s units
                            have no book entered.
                          </div>
                        )}
                        {activeUnit && (
                          <div>
                            <div className="flex items-center gap-2 mb-1">
                              <button
                                onClick={() =>
                                  setBuilderUnitId(activeUnit.unitId)
                                }
                                className="text-[10.5px] font-bold text-foreground truncate underline decoration-dotted decoration-muted-foreground/60 underline-offset-2 text-left"
                                title="Curate this unit's questions (group Lesson Builder)"
                              >
                                {unitName(activeUnit.unitId)}
                              </button>
                              <span className="h-px flex-1 bg-border/60" />
                            </div>
                            <div className="flex flex-wrap gap-1">
                              {activeUnit.boxes.map((b, bi) => {
                                const ring =
                                  selSheetIds !== null &&
                                  selSheetIds.has(b.questionId);
                                return (
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
                                      b.mark === 'banned' &&
                                        'bg-transparent border-dashed border-rose-500/40 text-rose-500/60 line-through',
                                      b.mark === 'routed' &&
                                        'bg-amber-400/20 border-amber-400/70 text-amber-600 dark:text-amber-400',
                                      selSheetIds !== null &&
                                        (ring
                                          ? 'ring-2 ring-primary ring-offset-1 ring-offset-card'
                                          : 'opacity-30'),
                                    )}
                                  >
                                    {shortLabel(b.label, bi)}
                                  </span>
                                );
                              })}
                            </div>
                            <div className="flex flex-wrap gap-x-3 gap-y-1 text-[8.5px] text-muted-foreground mt-1.5">
                              <span className="flex items-center gap-1">
                                <span className="w-2.5 h-2.5 rounded bg-teal-500/30 border border-teal-500/50" />
                                new this session
                              </span>
                              <span className="flex items-center gap-1">
                                <span className="w-2.5 h-2.5 rounded bg-amber-500/30 border border-amber-500/50" />
                                review this session
                              </span>
                              <span className="flex items-center gap-1">
                                <span className="w-2.5 h-2.5 rounded bg-muted border border-border/50" />
                                other session
                              </span>
                              <span className="flex items-center gap-1">
                                <span className="w-2.5 h-2.5 rounded border border-dashed border-border" />
                                not yet
                              </span>
                              <span className="flex items-center gap-1">
                                <span className="w-2.5 h-2.5 rounded border border-dashed border-rose-500/40" />
                                excluded
                              </span>
                              <span className="flex items-center gap-1">
                                <span className="w-2.5 h-2.5 rounded bg-amber-400/25 border border-amber-400/70" />
                                → revision dept
                              </span>
                            </div>
                          </div>
                        )}
                        {/* 7+7 day strip — last row, horizontal Mon→Sun so it
                            tucks under everything else. Filled Main box = a
                            sheet that day (tap to open); amber Rev box = a
                            revision session that day. */}
                        <div className="grid grid-cols-[auto_repeat(7,minmax(0,1fr))] gap-1 items-center pt-2 border-t border-border/60">
                          <span />
                          {DOW_LETTERS.map((L, i) => (
                            <span
                              key={i}
                              className="text-center text-[8.5px] text-muted-foreground"
                            >
                              {L}
                            </span>
                          ))}
                          <span className="text-[8.5px] font-semibold text-muted-foreground pr-1.5">
                            Main
                          </span>
                          {DOW_LETTERS.map((_, i) => {
                            const dow = i + 1;
                            const date = addDaysYmd(w.weekStart, i);
                            const isMainDay = mainDays.has(dow);
                            const sh = sheetByDate.get(date);
                            if (!isMainDay && !sh)
                              return <span key={i} className="h-6" />;
                            return (
                              <button
                                key={i}
                                onClick={() => {
                                  if (!sh) return;
                                  setSelDate(sh.date);
                                  setSelUnitId(null);
                                  setSelSheetIds(null);
                                  followTermOf(sh.unitId);
                                }}
                                disabled={!sh}
                                className={cn(
                                  'h-6 rounded-md border text-[8.5px] font-bold flex items-center justify-center tabular-nums',
                                  sh && sh.date === selDate
                                    ? 'bg-primary/25 border-primary text-primary'
                                    : sh
                                      ? 'bg-primary/15 border-primary/50 text-primary'
                                      : 'border-dashed border-border text-muted-foreground/40',
                                )}
                              >
                                {sh ? sh.newCount + sh.spiralCount : ''}
                              </button>
                            );
                          })}
                          <span className="text-[8.5px] font-semibold text-muted-foreground pr-1.5">
                            Rev
                          </span>
                          {DOW_LETTERS.map((_, i) => {
                            const dow = i + 1;
                            const date = addDaysYmd(w.weekStart, i);
                            const isRevDay = revisionDays.has(dow);
                            // A sheet living on a revision day renders here
                            // (tap to open) — unless the day is also a Main
                            // day, where the Main row already shows it.
                            const sh = !mainDays.has(dow)
                              ? sheetByDate.get(date)
                              : undefined;
                            if (sh) {
                              return (
                                <button
                                  key={i}
                                  onClick={() => {
                                    setSelDate(sh.date);
                                    setSelUnitId(null);
                                    setSelSheetIds(null);
                                    followTermOf(sh.unitId);
                                  }}
                                  className={cn(
                                    'h-6 rounded-md border text-[8.5px] font-bold flex items-center justify-center tabular-nums bg-amber-500/20 text-amber-600 dark:text-amber-400',
                                    sh.date === selDate
                                      ? 'border-amber-500 ring-1 ring-amber-500/50'
                                      : 'border-amber-500/60',
                                  )}
                                >
                                  {sh.newCount + sh.spiralCount}
                                </button>
                              );
                            }
                            return (
                              <span
                                key={i}
                                className={cn(
                                  'h-6 rounded-md border flex items-center justify-center',
                                  isRevDay
                                    ? 'bg-amber-500/15 border-amber-500/50'
                                    : 'border-dashed border-border/60',
                                )}
                              >
                                {isRevDay && (
                                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                                )}
                              </span>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </div>
            </div>
          )}
        </div>
      )}

      {previewIdx >= 0 &&
        groupId &&
        (() => {
          const cur = list[previewIdx];
          const wk = weekStartYmd(cur.date);
          const occupied = new Set(
            list.filter((s) => s.status !== 'delegated').map((s) => s.date),
          );
          const moveTargets: Array<{
            date: string;
            label: string;
            rev: boolean;
          }> = [];
          for (const dow of new Set([
            ...(slotDays?.mainDays ?? []),
            ...(slotDays?.revisionDays ?? []),
          ])) {
            const date = addDaysYmd(wk, dow - 1);
            if (date === cur.date || occupied.has(date)) continue;
            const rev = revisionDays.has(dow) && !mainDays.has(dow);
            moveTargets.push({
              date,
              label: fmtDayMonth(date).weekday,
              rev,
            });
          }
          return (
            <SheetPreviewDrawer
              sheetId={cur.id}
              groupId={groupId}
              unitName={unitName}
              moveTargets={moveTargets}
              hasPrev={previewIdx > 0}
              hasNext={previewIdx < list.length - 1}
              onPrev={() => setPreviewId(list[previewIdx - 1].id)}
              onNext={() => setPreviewId(list[previewIdx + 1].id)}
              onClose={() => setPreviewId(null)}
              onArrange={(unitId) => {
                setPreviewId(null);
                setArrangeUnitId(unitId);
              }}
              onSkipped={() =>
                toast.success(
                  'Day skipped and its sheet removed — the rest of the term has not moved yet.',
                  {
                    duration: 10000,
                    action: {
                      label: 'Re-plan term',
                      onClick: () => void doReplan(),
                    },
                  },
                )
              }
            />
          );
        })()}

      {arrangeUnitId && (
        <UnitArrangeDialog
          unitId={arrangeUnitId}
          unitName={unitName(arrangeUnitId)}
          onClose={() => setArrangeUnitId(null)}
        />
      )}

      {pdfSheet && (
        <PdfPreviewDialog
          sheetId={pdfSheet.id}
          date={pdfSheet.date}
          onClose={() => setPdfSheet(null)}
        />
      )}

      {assignSheet && (
        <DayPickerDialog
          title="Assign to a revision class"
          hint={`${(() => {
            const sh = sheetByDate.get(assignSheet.date);
            return sh ? `${sh.newCount + sh.spiralCount} questions · ` : '';
          })()}the session's sheet moves onto the revision day you pick (this week or the next two).`}
          options={(() => {
            // Upcoming revision days across THREE weeks, not just the
            // sheet's own — the old one-week window went empty the moment
            // this week's revision day had passed (founder bug 2026-07-25).
            const startWeek =
              assignSheet.weekStart >= weekStartYmd(today)
                ? assignSheet.weekStart
                : weekStartYmd(today);
            const dows = Array.from(revisionDays).sort((a, b) => a - b);
            const out: Array<{ date: string; rev: boolean }> = [];
            for (let wk = 0; wk < 3; wk++) {
              for (const dow of dows) {
                const date = addDaysYmd(startWeek, wk * 7 + dow - 1);
                if (date < today || date === assignSheet.date) continue;
                const occ = sheetByDate.get(date);
                if (occ && occ.status !== 'delegated') continue;
                out.push({ date, rev: true });
              }
            }
            return out;
          })()}
          emptyText={
            revisionDays.size === 0
              ? 'This group has no revision class on the timetable yet — book it into a revision day on the home page first.'
              : 'Every revision day in the next 3 weeks is already past or taken.'
          }
          onPick={async (date) => {
            try {
              await moveGroupSheetMut({
                groupSheetId: assignSheet.id,
                toDate: date,
              });
              toast.success('Sheet assigned to the revision class.');
            } catch (e) {
              toast.error(e instanceof Error ? e.message : 'Failed to assign');
            }
            setAssignSheet(null);
          }}
          onClose={() => setAssignSheet(null)}
        />
      )}

      {builderUnitId && groupId && (
        <GroupLessonBuilder
          groupId={groupId}
          groupName={
            gradeGroups.find((g: PlannerGroupRow) => g.groupId === groupId)
              ?.name ?? 'Group'
          }
          unitId={builderUnitId}
          unitName={unitName(builderUnitId)}
          resolveUnitName={unitName}
          onClose={() => setBuilderUnitId(null)}
        />
      )}

      {compressOpen && groupId && (
        <CompressionDialog
          groupId={groupId}
          unitName={unitName}
          onClose={() => setCompressOpen(false)}
        />
      )}
    </>
  );
}

// Small bottom-sheet day picker for "assign to revision class": one tap per
// free day, amber-tagged when the day is revision capacity.
function DayPickerDialog({
  title,
  hint,
  options,
  emptyText,
  onPick,
  onClose,
}: {
  title: string;
  hint: string;
  options: Array<{ date: string; rev: boolean }>;
  emptyText: string;
  onPick: (date: string) => Promise<void>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-2 pb-[calc(4rem+env(safe-area-inset-bottom,0px)+0.5rem)] sm:pb-2"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl bg-card border border-border shadow-xl p-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 mb-1">
          <span className="text-sm font-bold text-foreground flex-1">
            {title}
          </span>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md hover:bg-muted text-muted-foreground"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="text-[10.5px] text-muted-foreground mb-2.5">{hint}</div>
        {options.length === 0 ? (
          <div className="text-[11px] text-muted-foreground italic py-2">
            {emptyText}
          </div>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {options.map((o) => (
              <button
                key={o.date}
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  await onPick(o.date);
                }}
                className={cn(
                  'px-2.5 py-1.5 rounded-lg border text-[11px] font-semibold disabled:opacity-50',
                  o.rev
                    ? 'border-amber-500/50 text-amber-500'
                    : 'border-border text-foreground',
                )}
              >
                {fmtDayMonth(o.date).weekday} {fmtDayMonth(o.date).day}
                {o.rev && ' · rev'}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// Print-preview dialog: renders the planned group sheet through the REAL
// per-student PDF composer (same fonts, stems, clipping, page breaks) and
// embeds the result. "Open" is the fallback for phones whose browser won't
// render PDFs inline — it hands the file to the native viewer.
function PdfPreviewDialog({
  sheetId,
  date,
  onClose,
}: {
  sheetId: Id<'groupSheets'>;
  date: string;
  onClose: () => void;
}) {
  const render = useAction(api.learningEngine.pdf.renderGroupSheetPDF);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pages, setPages] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    render({ groupSheetId: sheetId })
      .then((res) => {
        if (cancelled) return;
        setUrl(res.url);
        setPages(res.pageCount);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(
          e instanceof Error
            ? e.message
            : 'Preview failed — check the crops of this sheet.',
        );
      });
    return () => {
      cancelled = true;
    };
  }, [render, sheetId]);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-2"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl h-[85vh] rounded-2xl bg-card border border-border shadow-xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border shrink-0">
          <FileText className="w-4 h-4 text-primary shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-bold text-foreground truncate">
              Print preview · {fmtWeekdayDate(date)}
            </div>
            <div className="text-[10px] text-muted-foreground">
              {pages !== null
                ? `${pages} page${pages > 1 ? 's' : ''} — exactly what prints`
                : 'The real sheet PDF, exactly what prints'}
            </div>
          </div>
          {url && (
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg border border-border text-[11px] font-semibold text-foreground"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              Open
            </a>
          )}
          <button
            onClick={onClose}
            className="p-1.5 rounded-md hover:bg-muted text-muted-foreground"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 min-h-0 bg-muted/30">
          {!url && !error && (
            <div className="h-full flex flex-col items-center justify-center gap-2 text-muted-foreground">
              <Loader2 className="w-6 h-6 animate-spin" />
              <span className="text-xs">Building the PDF…</span>
            </div>
          )}
          {error && (
            <div className="h-full flex items-center justify-center p-6 text-center text-xs text-rose-500">
              {error}
            </div>
          )}
          {url && (
            <iframe
              src={url}
              title="Sheet PDF preview"
              className="w-full h-full border-0"
            />
          )}
        </div>
      </div>
    </div>
  );
}

function SheetPreviewDrawer({
  sheetId,
  groupId,
  unitName,
  moveTargets,
  hasPrev,
  hasNext,
  onPrev,
  onNext,
  onClose,
  onArrange,
  onSkipped,
}: {
  sheetId: Id<'groupSheets'>;
  groupId: Id<'groups'>;
  unitName: (unitId: string) => string;
  moveTargets: Array<{ date: string; label: string; rev: boolean }>;
  hasPrev: boolean;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
  onArrange: (unitId: string) => void;
  onSkipped: () => void;
}) {
  const sheet = useQuery(api.learningEngine.groupPlan.groupSheetPreview, {
    groupSheetId: sheetId,
  });
  const chip = sheet
    ? (STATUS_CHIP[sheet.status] ?? STATUS_CHIP.planned)
    : null;

  const resizePlanned = useMutation(api.learningEngine.groupPlan.resizePlanned);
  const moveGroupSheet = useMutation(
    api.learningEngine.groupPlan.moveGroupSheet,
  );
  const deletePlanned = useMutation(api.learningEngine.groupPlan.deletePlanned);
  const cancelDay = useMutation(api.sessionRecords.cancelDay);
  const [busy, setBusy] = useState(false);
  const [size, setSize] = useState<number | null>(null);
  // Reset the resize draft when the drawer navigates to a different sheet.
  const [sizeFor, setSizeFor] = useState(sheetId);
  if (sheetId !== sizeFor) {
    setSizeFor(sheetId);
    setSize(null);
  }
  const curSize = sheet ? sheet.questions.length : 0;
  const effSize = size ?? curSize;
  const isPlanned = sheet?.status === 'planned';

  const run = async (fn: () => Promise<unknown>, closeAfter = true) => {
    setBusy(true);
    try {
      await fn();
      if (closeAfter) onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(false);
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

        {/* Re-plan action bar (planned sheets only) */}
        {sheet && isPlanned && (
          <div className="border-t border-border p-2.5 space-y-2 shrink-0">
            {/* Resize */}
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold text-foreground">
                Sheet size
              </span>
              <div className="inline-flex items-center gap-1.5">
                <button
                  onClick={() => setSize(Math.max(1, effSize - 1))}
                  disabled={busy || effSize <= 1}
                  className="w-7 h-7 inline-flex items-center justify-center rounded-md bg-muted text-foreground disabled:opacity-40"
                  aria-label="Fewer"
                >
                  <Minus className="w-3.5 h-3.5" />
                </button>
                <span className="min-w-[1.5rem] text-center text-sm font-bold tabular-nums">
                  {effSize}
                </span>
                <button
                  onClick={() => setSize(Math.min(20, effSize + 1))}
                  disabled={busy || effSize >= 20}
                  className="w-7 h-7 inline-flex items-center justify-center rounded-md bg-muted text-foreground disabled:opacity-40"
                  aria-label="More"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() =>
                    run(() =>
                      resizePlanned({ groupSheetId: sheetId, count: effSize }),
                    )
                  }
                  disabled={busy || effSize === curSize}
                  className="ml-1 px-2.5 py-1.5 rounded-md bg-primary text-primary-foreground text-[11px] font-semibold disabled:opacity-40"
                >
                  Apply
                </button>
              </div>
            </div>

            {/* Arrange + Skip */}
            <div className="flex gap-2">
              <button
                onClick={() => onArrange(sheet.unitId)}
                disabled={busy}
                className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-border text-foreground text-[11px] font-semibold disabled:opacity-50"
              >
                <ArrowUpDown className="w-3.5 h-3.5" />
                Arrange order
              </button>
              <button
                onClick={() => {
                  if (
                    !window.confirm(
                      'Skip this day? The session is marked cancelled and this planned sheet is removed. Re-plan to reflow the term.',
                    )
                  )
                    return;
                  run(async () => {
                    await cancelDay({
                      date: sheet.date,
                      reason: 'other',
                      groupIds: [groupId],
                    });
                    await deletePlanned({ groupSheetId: sheetId });
                    onSkipped();
                  });
                }}
                disabled={busy}
                className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-rose-500/40 text-rose-500 text-[11px] font-semibold disabled:opacity-50"
              >
                <Ban className="w-3.5 h-3.5" />
                Skip day
              </button>
            </div>

            {/* Move to another day this week */}
            {moveTargets.length > 0 && (
              <div>
                <div className="text-[9.5px] font-semibold text-muted-foreground uppercase tracking-wide mb-1 flex items-center gap-1">
                  <MoveRight className="w-3 h-3" />
                  Move to
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {moveTargets.map((t) => (
                    <button
                      key={t.date}
                      onClick={() =>
                        run(() =>
                          moveGroupSheet({
                            groupSheetId: sheetId,
                            toDate: t.date,
                          }),
                        )
                      }
                      disabled={busy}
                      className={cn(
                        'px-2 py-1 rounded-lg border text-[10.5px] font-semibold disabled:opacity-50',
                        t.rev
                          ? 'border-amber-500/50 text-amber-500'
                          : 'border-border text-foreground',
                      )}
                    >
                      {t.label}
                      {t.rev && ' · rev'}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
