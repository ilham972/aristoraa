'use client';

// GroupCoverage — the Term Coverage Cockpit (2026-07-16). The founder's
// "see the WHOLE term" view: pick a term, and every track unit of that term
// is a row with a coverage bar; open one and every question (and sub-question)
// is a tiny box coloured by whether it's been taught, planned, or is still
// untouched. Tap a box and it tells you WHERE it was picked (which sheet date
// + status) — the algorithm's pick made visible. Each unit also carries a
// per-student "did / didn't do" row so late joiners can be hand-corrected.
//
// Reads groupTermCoverage (one query per group+term); writes setStudentUnitDone.
// It shows what the engine plans — it does not pick questions itself.
//
// HOME: Insights → Coverage → Groups (moved off the Planner's Sheets tab on
// 2026-07-17 so coverage has one home). The Sheets tab keeps only a % strip
// that links here. Because Arrange-order needs a Re-plan to bite and that
// button no longer sits alongside, the cockpit carries its own (showReplan).

import { useMemo, useState } from 'react';
import { useMutation } from 'convex/react';
import {
  ArrowUpDown,
  BookOpen,
  Check,
  ChevronDown,
  RefreshCw,
} from 'lucide-react';
import { toast } from 'sonner';
import { api, type Id } from '@/lib/convex';
import { cn } from '@/lib/utils';
import { useCachedQuery } from '@/hooks/use-cached-query';
import { useUnitName } from './group-plan-card';
import { UnitArrangeDialog } from './unit-arrange-dialog';
import { fmtWeekdayDate } from './verdict';

type QBox = {
  questionId: Id<'questionBank'>;
  label: string | null;
  difficulty: number;
  pastPaper: boolean;
  section: 'new' | 'spiral' | null;
  state: 'done' | 'planned' | 'unseen' | 'banned';
  sheetDate: string | null;
  sheetStatus: string | null;
};

type UnitRow = {
  unitId: string;
  term: number;
  totalQuestions: number;
  doneCount: number;
  plannedCount: number;
  bannedCount: number;
  unseenCount: number;
  hasBook: boolean;
  preTaught: boolean;
  studentsDone: string[];
  questions: QBox[];
};

// Compact question-number for the tiny box: keep the last dotted segment
// ("1A.3.b" → "3.b"), drop a leading "Q".
export function shortLabel(label: string | null, idx: number): string {
  if (!label) return String(idx + 1);
  const cleaned = label.replace(/^Q/i, '');
  const parts = cleaned.split(/[.\-]/).filter(Boolean);
  if (parts.length <= 2) return cleaned;
  return parts.slice(-2).join('.');
}

export function GroupCoverage({
  groupId,
  term,
  setTerm,
  hideTermChips = false,
  showReplan = false,
  onInspectUnit,
}: {
  groupId: Id<'groups'>;
  term: number | null;
  setTerm: (t: number | null) => void;
  // The Insights "Groups" lens owns the term chips (they sit with the group
  // rail, which is term-wide), so the cockpit must not repeat them.
  hideTermChips?: boolean;
  // "Arrange order" only bites after a re-plan. In the Sheets tab that button
  // is right there; on Insights it's a page away — so the cockpit carries its
  // own, using the identical delete-future + re-crystallize pair.
  showReplan?: boolean;
  // Hand a book-gap off to the Bank lens (Insights only): an empty unit here
  // is exactly the unit worth photographing next.
  onInspectUnit?: (unitId: string) => void;
}) {
  // Same query+args as the parent's copy → deduped by the Convex client, so
  // the week grids in GroupSheets and this summary share one subscription and
  // one term selection.
  const coverage = useCachedQuery(
    api.learningEngine.groupPlan.groupTermCoverage,
    {
      groupId,
      ...(term !== null ? { term } : {}),
    },
  );
  const setDone = useMutation(api.learningEngine.groupPlan.setStudentUnitDone);
  const setStartingPoint = useMutation(
    api.learningEngine.groupPlan.setGroupStartingPoint,
  );
  const deleteFuturePlanned = useMutation(
    api.learningEngine.groupPlan.deleteFuturePlanned,
  );
  const crystallize = useMutation(
    api.learningEngine.groupPlan.crystallizeUpcoming,
  );
  const [markingPrior, setMarkingPrior] = useState(false);
  const [replanning, setReplanning] = useState(false);
  const unitName = useUnitName();

  const [openUnit, setOpenUnit] = useState<string | null>(null);
  const [selectedQ, setSelectedQ] = useState<string | null>(null);
  const [arrangeUnit, setArrangeUnit] = useState<string | null>(null);

  const ready = coverage && 'status' in coverage && coverage.status === 'ok';

  // Keep the selected chip in sync with the resolved term the backend chose.
  const activeTerm = ready ? coverage.term : term;

  const toggleStudentUnit = async (
    studentId: Id<'students'>,
    unitId: string,
    done: boolean,
  ) => {
    try {
      await setDone({ groupId, studentId, unitId, done });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save');
    }
  };

  const markPriorTermsTaught = async (throughUnitId: string | null) => {
    setMarkingPrior(true);
    try {
      await setStartingPoint({ groupId, throughUnitId });
      toast.success(
        throughUnitId
          ? 'Earlier terms marked as taught — the plan now starts here.'
          : 'Cleared — the plan starts from the beginning again.',
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to update');
    } finally {
      setMarkingPrior(false);
    }
  };

  // Same pair the Sheets tab runs: drop every future still-planned row, then
  // rebuild it from the current book order. Taught + delegated are untouched.
  const replan = async () => {
    if (
      !window.confirm(
        'Re-plan the term? Every future sheet that is not yet taught will be re-picked from the current book order. Taught and delegated sheets are untouched.',
      )
    )
      return;
    setReplanning(true);
    try {
      const del = await deleteFuturePlanned({ groupId });
      const res = await crystallize({ groupId, daysAhead: 180 });
      toast.success(
        `Re-planned: ${del.deleted} sheets dropped, ${res.status === 'ok' ? res.written : 0} rebuilt from the current order.`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed');
    } finally {
      setReplanning(false);
    }
  };

  if (coverage === undefined) {
    return (
      <div className="space-y-2 animate-pulse">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-14 bg-muted rounded-xl" />
        ))}
      </div>
    );
  }

  if (!coverage || !('status' in coverage) || coverage.status !== 'ok') {
    const why =
      coverage && 'status' in coverage ? coverage.status : 'not available';
    return (
      <div className="rounded-xl border border-border bg-card p-4 text-center text-sm text-muted-foreground">
        Coverage not available ({why}).
      </div>
    );
  }

  const students = coverage.students;

  return (
    <div>
      {/* One-tap "earlier terms already covered": makes the GROUP prebuild
          start at this term instead of restarting at Term 1. */}
      {coverage.priorTermsThroughUnitId &&
        (coverage.priorTermsAllPreTaught ? (
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 mb-3 flex items-center gap-2 text-[11px]">
            <Check className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
            <span className="flex-1 text-foreground">
              Earlier terms marked as taught — the group builds from Term{' '}
              {activeTerm}.
            </span>
            <button
              onClick={() => markPriorTermsTaught(null)}
              disabled={markingPrior}
              className="shrink-0 text-muted-foreground underline disabled:opacity-50"
            >
              Undo
            </button>
          </div>
        ) : (
          <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 mb-3">
            <div className="text-[11px] text-foreground leading-snug mb-2">
              <span className="font-semibold text-amber-600 dark:text-amber-400">
                This group&rsquo;s plan still starts at Term 1.
              </span>{' '}
              If you already taught the earlier terms in class, mark them done
              so the whole-term build starts at Term {activeTerm}.
            </div>
            <button
              onClick={() =>
                markPriorTermsTaught(coverage.priorTermsThroughUnitId)
              }
              disabled={markingPrior}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-[11px] font-semibold disabled:opacity-50"
            >
              <Check className="w-3.5 h-3.5" />
              Mark earlier terms as taught
            </button>
          </div>
        ))}

      {/* Term chips + group-level actions. The Insights lens hides the chips
          (its rail owns the term) but keeps the Re-plan button. */}
      {(!hideTermChips || showReplan) && (
        <div className="flex items-center gap-1.5 mb-3">
          {!hideTermChips && (
            <>
              <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mr-0.5">
                Term
              </span>
              {coverage.availableTerms.map((t) => (
                <button
                  key={t}
                  onClick={() => {
                    setTerm(t);
                    setOpenUnit(null);
                    setSelectedQ(null);
                  }}
                  className={cn(
                    'w-8 h-8 rounded-lg border text-xs font-bold',
                    t === activeTerm
                      ? 'border-primary/60 bg-primary/10 text-foreground'
                      : 'border-border bg-card text-muted-foreground',
                  )}
                >
                  {t}
                </button>
              ))}
            </>
          )}
          {showReplan && (
            <button
              onClick={replan}
              disabled={replanning}
              title="After changing a unit's order: re-pick every future planned sheet from the new order"
              className="ml-auto inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border text-foreground text-[11px] font-semibold disabled:opacity-50"
            >
              <RefreshCw
                className={cn('w-3.5 h-3.5', replanning && 'animate-spin')}
              />
              {replanning ? 'Re-planning…' : 'Re-plan'}
            </button>
          )}
        </div>
      )}

      {coverage.units.length === 0 && (
        <div className="rounded-xl border border-border bg-card p-4 text-center text-sm text-muted-foreground">
          No Term {activeTerm} units on this group&rsquo;s track.
        </div>
      )}

      <div className="space-y-2">
        {coverage.units.map((u: UnitRow) => (
          <UnitAccordion
            key={u.unitId}
            unit={u}
            name={unitName(u.unitId)}
            students={students}
            open={openUnit === u.unitId}
            onToggleOpen={() =>
              setOpenUnit((cur) => (cur === u.unitId ? null : u.unitId))
            }
            selectedQ={selectedQ}
            onSelectQ={setSelectedQ}
            onToggleStudent={toggleStudentUnit}
            onArrange={() => setArrangeUnit(u.unitId)}
            onInspectUnit={onInspectUnit}
          />
        ))}
      </div>

      {arrangeUnit && (
        <UnitArrangeDialog
          unitId={arrangeUnit}
          unitName={unitName(arrangeUnit)}
          onClose={() => setArrangeUnit(null)}
        />
      )}
    </div>
  );
}

function CoverageBar({ unit }: { unit: UnitRow }) {
  // Unticked questions leave the denominator — same rule as the % summary and
  // the rail rings, so an excluded question can never hold the bar under 100%.
  const total = Math.max(1, unit.totalQuestions - unit.bannedCount);
  const donePct = (unit.doneCount / total) * 100;
  const planPct = (unit.plannedCount / total) * 100;
  return (
    <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden flex">
      <div className="h-full bg-emerald-500" style={{ width: `${donePct}%` }} />
      <div className="h-full bg-primary/60" style={{ width: `${planPct}%` }} />
    </div>
  );
}

function UnitAccordion({
  unit,
  name,
  students,
  open,
  onToggleOpen,
  selectedQ,
  onSelectQ,
  onToggleStudent,
  onArrange,
  onInspectUnit,
}: {
  unit: UnitRow;
  name: string;
  students: { studentId: Id<'students'>; name: string }[];
  open: boolean;
  onToggleOpen: () => void;
  selectedQ: string | null;
  onSelectQ: (qid: string | null) => void;
  onToggleStudent: (
    studentId: Id<'students'>,
    unitId: string,
    done: boolean,
  ) => void;
  onArrange: () => void;
  onInspectUnit?: (unitId: string) => void;
}) {
  const selected = useMemo(
    () =>
      unit.questions.find(
        (q) => (q.questionId as unknown as string) === selectedQ,
      ) ?? null,
    [unit.questions, selectedQ],
  );
  const doneSet = useMemo(
    () => new Set(unit.studentsDone),
    [unit.studentsDone],
  );

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      {/* Header row — always visible */}
      <button
        onClick={onToggleOpen}
        className="w-full text-left px-3 py-2.5 flex flex-col gap-1.5"
      >
        <div className="flex items-center gap-2">
          <span className="text-[12px] font-bold text-foreground truncate flex-1">
            {name}
          </span>
          {unit.preTaught && (
            <span className="px-1.5 py-px rounded border border-emerald-500/40 bg-emerald-500/10 text-emerald-500 text-[8.5px] font-semibold">
              pre-taught
            </span>
          )}
          {!unit.hasBook ? (
            <span className="px-1.5 py-px rounded border border-amber-500/40 bg-amber-500/10 text-amber-500 text-[8.5px] font-semibold">
              needs book
            </span>
          ) : (
            <span className="text-[9.5px] text-muted-foreground tabular-nums shrink-0">
              {unit.doneCount}
              {unit.plannedCount > 0 && (
                <span className="text-primary">+{unit.plannedCount}</span>
              )}
              /{unit.totalQuestions - unit.bannedCount}
            </span>
          )}
          <ChevronDown
            className={cn(
              'w-4 h-4 text-muted-foreground shrink-0 transition-transform',
              open && 'rotate-180',
            )}
          />
        </div>
        {unit.hasBook && <CoverageBar unit={unit} />}
      </button>

      {open && (
        <div className="px-3 pb-3 border-t border-border/60 pt-2.5">
          {!unit.hasBook ? (
            <div className="flex gap-2 items-start text-[11px] text-muted-foreground">
              <BookOpen className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
              <div>
                No questions entered for this unit yet. Photograph &amp; enter
                the book pages in Settings → Book to see its questions here.
                {onInspectUnit && (
                  <button
                    onClick={() => onInspectUnit(unit.unitId)}
                    className="block mt-1.5 text-primary font-semibold underline underline-offset-2"
                  >
                    Check this unit in the question bank →
                  </button>
                )}
              </div>
            </div>
          ) : (
            <>
              {/* Control the order: opens the arrange-difficulty dialog */}
              <div className="flex justify-end mb-2">
                <button
                  onClick={onArrange}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-border text-[10px] font-semibold text-muted-foreground hover:text-foreground hover:border-primary/40"
                >
                  <ArrowUpDown className="w-3 h-3" />
                  Arrange order
                </button>
              </div>

              {/* The tiny-box question grid */}
              <div className="flex flex-wrap gap-1">
                {unit.questions.map((q, i) => {
                  const k = q.questionId as unknown as string;
                  const isSel = k === selectedQ;
                  return (
                    <button
                      key={k}
                      onClick={() => onSelectQ(isSel ? null : k)}
                      title={q.label ?? undefined}
                      className={cn(
                        'relative w-7 h-7 rounded-md border text-[8.5px] font-semibold leading-none flex items-center justify-center tabular-nums transition-transform active:scale-90',
                        q.state === 'done' &&
                          'bg-emerald-500/20 border-emerald-500/50 text-emerald-600 dark:text-emerald-400',
                        q.state === 'planned' &&
                          'bg-primary/15 border-primary/50 text-primary',
                        q.state === 'unseen' &&
                          'bg-muted/60 border-border text-muted-foreground',
                        q.state === 'banned' &&
                          'bg-transparent border-dashed border-rose-500/40 text-rose-500/60 line-through',
                        isSel &&
                          'ring-2 ring-primary ring-offset-1 ring-offset-card',
                      )}
                    >
                      {shortLabel(q.label, i)}
                      {q.section === 'spiral' && (
                        <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-amber-400" />
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Legend */}
              <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 text-[8.5px] text-muted-foreground">
                <span className="flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded bg-emerald-500/30 border border-emerald-500/50" />
                  taught
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded bg-primary/20 border border-primary/50" />
                  planned
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded bg-muted border border-border" />
                  not yet
                </span>
                {unit.bannedCount > 0 && (
                  <span className="flex items-center gap-1">
                    <span className="w-2.5 h-2.5 rounded border border-dashed border-rose-500/40" />
                    excluded
                  </span>
                )}
                <span className="flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                  spiral review
                </span>
              </div>

              {/* Provenance for the tapped box */}
              {selected && (
                <div className="mt-2.5 rounded-lg border border-border bg-muted/40 px-2.5 py-2 text-[11px]">
                  <div className="font-bold text-foreground">
                    Question {selected.label ?? '—'}
                    <span className="ml-1.5 font-normal text-muted-foreground">
                      · difficulty {selected.difficulty}
                      {selected.pastPaper && ' · past-paper'}
                    </span>
                  </div>
                  <div className="text-muted-foreground mt-0.5">
                    {selected.state === 'unseen' &&
                      'Not picked yet — will be served by a future sheet.'}
                    {selected.state === 'banned' &&
                      'Excluded from the plan (unticked in the unit curation).'}
                    {selected.state !== 'unseen' && selected.sheetDate && (
                      <>
                        {selected.state === 'done' ? 'Taught' : 'Planned'} on{' '}
                        <b className="text-foreground">
                          {fmtWeekdayDate(selected.sheetDate)}
                        </b>{' '}
                        as{' '}
                        {selected.section === 'spiral'
                          ? 'spiral review'
                          : 'new work'}
                        {selected.sheetStatus === 'delegated' &&
                          ' · delegated to Revision'}
                        .
                      </>
                    )}
                    {/* Only "done" with no sheet means pre-app / per-student
                        coverage. "banned" also has no sheetDate, and it is the
                        opposite of covered — it must not fall in here. */}
                    {selected.state === 'done' &&
                      !selected.sheetDate &&
                      'Already covered (before the app or in per-student mode).'}
                  </div>
                </div>
              )}

              {/* Per-student did / didn't do */}
              {students.length > 0 && (
                <div className="mt-3">
                  <div className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
                    Mark unit done per student
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {students.map((s) => {
                      const isDone = doneSet.has(
                        s.studentId as unknown as string,
                      );
                      return (
                        <button
                          key={s.studentId as unknown as string}
                          onClick={() =>
                            onToggleStudent(s.studentId, unit.unitId, !isDone)
                          }
                          className={cn(
                            'inline-flex items-center gap-1 px-2 py-1 rounded-lg border text-[10.5px] font-semibold',
                            isDone
                              ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                              : 'border-border bg-card text-muted-foreground',
                          )}
                        >
                          {isDone && <Check className="w-3 h-3" />}
                          {s.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
