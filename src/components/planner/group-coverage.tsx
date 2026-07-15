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

import { useMemo, useState } from 'react';
import { useMutation } from 'convex/react';
import { ArrowUpDown, BookOpen, Check, ChevronDown } from 'lucide-react';
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
  state: 'done' | 'planned' | 'unseen';
  sheetDate: string | null;
  sheetStatus: string | null;
};

type UnitRow = {
  unitId: string;
  term: number;
  totalQuestions: number;
  doneCount: number;
  plannedCount: number;
  unseenCount: number;
  hasBook: boolean;
  preTaught: boolean;
  studentsDone: string[];
  questions: QBox[];
};

// Compact question-number for the tiny box: keep the last dotted segment
// ("1A.3.b" → "3.b"), drop a leading "Q".
function shortLabel(label: string | null, idx: number): string {
  if (!label) return String(idx + 1);
  const cleaned = label.replace(/^Q/i, '');
  const parts = cleaned.split(/[.\-]/).filter(Boolean);
  if (parts.length <= 2) return cleaned;
  return parts.slice(-2).join('.');
}

export function GroupCoverage({ groupId }: { groupId: Id<'groups'> }) {
  const [term, setTerm] = useState<number | null>(null);
  const coverage = useCachedQuery(api.learningEngine.groupPlan.groupTermCoverage, {
    groupId,
    ...(term !== null ? { term } : {}),
  });
  const setDone = useMutation(api.learningEngine.groupPlan.setStudentUnitDone);
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
      {/* Term chips */}
      <div className="flex items-center gap-1.5 mb-3">
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
      </div>

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
  const total = Math.max(1, unit.totalQuestions);
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
              /{unit.totalQuestions}
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
              No questions entered for this unit yet. Photograph &amp; enter the
              book pages in Settings → Book to see its questions here.
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
                        isSel && 'ring-2 ring-primary ring-offset-1 ring-offset-card',
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
                    {selected.state !== 'unseen' && selected.sheetDate && (
                      <>
                        {selected.state === 'done' ? 'Taught' : 'Planned'} on{' '}
                        <b className="text-foreground">
                          {fmtWeekdayDate(selected.sheetDate)}
                        </b>{' '}
                        as {selected.section === 'spiral' ? 'spiral review' : 'new work'}
                        {selected.sheetStatus === 'delegated' &&
                          ' · delegated to Revision'}
                        .
                      </>
                    )}
                    {selected.state !== 'unseen' && !selected.sheetDate &&
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
