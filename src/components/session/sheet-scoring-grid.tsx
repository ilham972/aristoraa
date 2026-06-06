'use client';

// SheetScoringGrid — the fixed, compact-cell scoring grid for ONE
// generatedSheet, bound by sheetId. Replaces the legacy exercise-centric
// score grid: it marks the sheet's exact questions in print order
// (Warm-up · Main · Revision · Exam-prep), live-saving each tap via
// setSheetMark and committing into the learning engine via
// finalizeSheetScoring.
//
// Design (founder decisions):
//   • Fixed grid — compact numbered cells in a CSS grid per section. Tapping
//     a cell cycles unmarked → correct → wrong → skipped → unmarked. The grid
//     never reflows (no accordion / inline expansion); the actual question
//     images live behind the host tab's "View sheet" drawer.
//   • A wrong cell shows a small flag toggle that raises / clears a "needs
//     explanation" doubt (reuses the existing doubts pipeline, keyed by the
//     question's first tagged concept exercise).
//   • Bulk quick-actions (All ✓ / Rest ✓) batch-mark for strong students.
//   • Finalize records points + pushes attempts to the engine, then shows an
//     inline points/streak summary (not just a toast).
//
// Used by the merged Sheets tab's detail pane. `onFirstMark` lets the host
// auto-mark the student present on the first real mark of the session.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { toast } from 'sonner';
import {
  Check,
  X,
  SkipForward,
  Minus,
  Loader2,
  CheckCircle2,
  Flag,
  Sparkles,
} from 'lucide-react';
import { api, type Id } from '@/lib/convex';

type SlotName = 'warmup' | 'main' | 'revision' | 'examPrep';
type Mark = 'correct' | 'wrong' | 'skipped' | null;

const SECTIONS: Array<{ slot: SlotName; title: string }> = [
  { slot: 'warmup', title: 'Warm-up' },
  { slot: 'main', title: 'Main' },
  { slot: 'revision', title: 'Revision' },
  { slot: 'examPrep', title: 'Exam prep' },
];

// Tap order: unmarked → correct → wrong → skipped → unmarked.
function nextMark(mark: Mark): 'correct' | 'wrong' | 'skipped' | 'unmarked' {
  if (mark === null) return 'correct';
  if (mark === 'correct') return 'wrong';
  if (mark === 'wrong') return 'skipped';
  return 'unmarked';
}

type ScoringQ = {
  questionId: Id<'questionBank'>;
  conceptIds: Id<'exercises'>[];
  conceptNames: string[];
  source: string;
  questionNumberInPaper: string | null;
  marksAvailable: number | null;
  mark: string | null;
};

export function SheetScoringGrid({
  sheetId,
  slotId,
  onFirstMark,
}: {
  sheetId: Id<'generatedSheets'>;
  slotId: Id<'scheduleSlots'>;
  // Fired once, after the first successful mark on this grid instance. The
  // host wires this to auto-mark the student present.
  onFirstMark?: () => void;
}) {
  const data = useQuery(api.learningEngine.scoring.getSheetForScoring, { sheetId });
  const setSheetMark = useMutation(api.learningEngine.scoring.setSheetMark);
  const finalize = useMutation(api.learningEngine.scoring.finalizeSheetScoring);
  const flagQuestion = useMutation(api.doubts.flagQuestion);
  const removeFlag = useMutation(api.doubts.removePendingForQuestion);

  const studentId = data?.student._id;
  const doubts = useQuery(
    api.doubts.listByStudent,
    studentId ? { studentId } : 'skip',
  );

  // Questions currently mid-save (disables re-tap until the patch lands).
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [finalizing, setFinalizing] = useState(false);
  const [lastResult, setLastResult] = useState<{
    pointsNew: number;
    correctCount: number;
    totalQuestions: number;
  } | null>(null);

  // Fire onFirstMark exactly once per mounted grid (i.e. per selected sheet).
  const firstMarkFired = useRef(false);
  useEffect(() => {
    firstMarkFired.current = false;
    setLastResult(null);
  }, [sheetId]);

  // questionId(string) → true for every pending "needs explanation" doubt.
  const flaggedKeys = useMemo(() => {
    const s = new Set<string>();
    for (const d of doubts ?? []) {
      if (d.status === 'pending' && d.questionKey) s.add(d.questionKey);
    }
    return s;
  }, [doubts]);

  const tallies = useMemo(() => {
    let correct = 0;
    let wrong = 0;
    let skipped = 0;
    let total = 0;
    if (data) {
      for (const { slot } of SECTIONS) {
        for (const q of data[slot]) {
          total += 1;
          if (q.mark === 'correct') correct += 1;
          else if (q.mark === 'wrong') wrong += 1;
          else if (q.mark === 'skipped') skipped += 1;
        }
      }
    }
    return { correct, wrong, skipped, total, marked: correct + wrong + skipped };
  }, [data]);

  const writeMark = useCallback(
    async (questionId: Id<'questionBank'>, mark: string) => {
      const key = questionId as unknown as string;
      if (pending.has(key)) return;
      setPending((s) => new Set(s).add(key));
      try {
        await setSheetMark({ sheetId, questionId, mark });
        if (!firstMarkFired.current) {
          firstMarkFired.current = true;
          onFirstMark?.();
        }
      } catch (e) {
        toast.error(e instanceof Error ? e.message : String(e));
      } finally {
        setPending((s) => {
          const n = new Set(s);
          n.delete(key);
          return n;
        });
      }
    },
    [pending, setSheetMark, sheetId, onFirstMark],
  );

  const onTap = useCallback(
    (q: ScoringQ) => {
      const current = (q.mark as Mark) ?? null;
      const next = nextMark(current);
      // Cycling a wrong answer away clears any pending flag for it.
      if (current === 'wrong' && next !== 'wrong' && q.conceptIds[0]) {
        removeFlag({
          studentId: data!.student._id,
          exerciseId: q.conceptIds[0],
          questionKey: q.questionId as unknown as string,
        }).catch(() => {});
      }
      void writeMark(q.questionId, next);
    },
    [writeMark, removeFlag, data],
  );

  const onToggleFlag = useCallback(
    (q: ScoringQ) => {
      if (!data || !q.conceptIds[0]) return;
      const key = q.questionId as unknown as string;
      const args = {
        studentId: data.student._id,
        exerciseId: q.conceptIds[0],
        questionKey: key,
      };
      if (flaggedKeys.has(key)) {
        removeFlag(args).catch((e) =>
          toast.error(e instanceof Error ? e.message : String(e)),
        );
      } else {
        flagQuestion({ ...args, slotId, source: 'correction' }).catch((e) =>
          toast.error(e instanceof Error ? e.message : String(e)),
        );
      }
    },
    [data, flaggedKeys, flagQuestion, removeFlag, slotId],
  );

  // Bulk: mark every question correct, or only the still-unmarked ones.
  const bulkCorrect = useCallback(
    async (onlyUnmarked: boolean) => {
      if (!data) return;
      const targets: Id<'questionBank'>[] = [];
      for (const { slot } of SECTIONS) {
        for (const q of data[slot]) {
          if (onlyUnmarked && q.mark) continue;
          if (q.mark === 'correct') continue;
          targets.push(q.questionId);
        }
      }
      for (const questionId of targets) {
        await writeMark(questionId, 'correct');
      }
    },
    [data, writeMark],
  );

  const onFinalize = useCallback(async () => {
    if (finalizing || tallies.marked === 0) return;
    setFinalizing(true);
    try {
      const res = await finalize({ sheetId });
      setLastResult({
        pointsNew: res.pointsNew,
        correctCount: res.correctCount,
        totalQuestions: res.totalQuestions,
      });
      toast.success(
        `Recorded — ${res.correctCount}/${res.totalQuestions} correct · ${Math.round(res.pointsNew)} pts`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setFinalizing(false);
    }
  }, [finalizing, tallies.marked, finalize, sheetId]);

  if (data === undefined) {
    return (
      <div className="space-y-3 animate-pulse">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-20 bg-muted rounded-xl" />
        ))}
      </div>
    );
  }
  if (data === null) {
    return (
      <div className="rounded-xl border border-border bg-card p-4 text-center text-[12px] text-muted-foreground">
        Sheet not found, or you are not signed in.
      </div>
    );
  }

  const isCompleted = data.sheet.status === 'completed';

  return (
    <div className="flex flex-col">
      {isCompleted && (
        <div className="mb-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[11px] text-emerald-700 dark:text-emerald-400">
          Already recorded into the engine. Flip a mark and re-finalize — only
          the changed answer re-commits.
        </div>
      )}

      <div className="space-y-3 pb-2">
        {SECTIONS.map(({ slot, title }) => (
          <Section
            key={slot}
            title={title}
            qs={data[slot] as ScoringQ[]}
            pending={pending}
            flaggedKeys={flaggedKeys}
            onTap={onTap}
            onToggleFlag={onToggleFlag}
          />
        ))}
      </div>

      {/* Bulk quick-actions */}
      <div className="flex items-center gap-1.5 pt-1">
        <BulkBtn
          label="All ✓"
          title="Mark every question correct"
          onClick={() => bulkCorrect(false)}
        />
        <BulkBtn
          label="Rest ✓"
          title="Mark the remaining unmarked questions correct"
          onClick={() => bulkCorrect(true)}
        />
      </div>

      {/* Footer: tallies + finalize + inline summary */}
      <div className="sticky bottom-0 mt-3 -mx-1 px-1 pt-2 pb-1 bg-gradient-to-t from-background via-background to-transparent">
        {lastResult && (
          <div className="mb-2 flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
            <Sparkles className="w-3.5 h-3.5" />
            Recorded · {lastResult.correctCount}/{lastResult.totalQuestions}{' '}
            correct · {Math.round(lastResult.pointsNew)} pts
          </div>
        )}
        <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-3 py-2">
          <div className="flex items-center gap-3 text-[11px] font-semibold tabular-nums">
            <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
              <Check className="w-3.5 h-3.5" />
              {tallies.correct}
            </span>
            <span className="inline-flex items-center gap-1 text-red-600 dark:text-red-400">
              <X className="w-3.5 h-3.5" />
              {tallies.wrong}
            </span>
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              <SkipForward className="w-3.5 h-3.5" />
              {tallies.skipped}
            </span>
            <span className="text-muted-foreground/70">
              {tallies.marked}/{tallies.total}
            </span>
          </div>
          <button
            onClick={onFinalize}
            disabled={finalizing || tallies.marked === 0}
            className="ml-auto inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-semibold disabled:opacity-40"
          >
            {finalizing ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <CheckCircle2 className="w-3.5 h-3.5" />
            )}
            {finalizing ? 'Recording…' : isCompleted ? 'Re-record' : 'Finalize & record'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Section ───────────────────────────────────────────────────────────────

function Section({
  title,
  qs,
  pending,
  flaggedKeys,
  onTap,
  onToggleFlag,
}: {
  title: string;
  qs: ScoringQ[];
  pending: Set<string>;
  flaggedKeys: Set<string>;
  onTap: (q: ScoringQ) => void;
  onToggleFlag: (q: ScoringQ) => void;
}) {
  return (
    <section className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="px-3 py-1.5 border-b border-border bg-muted/30 flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">
          {title}
        </span>
        <span className="ml-auto text-[10px] text-muted-foreground tabular-nums">
          {qs.length} Q{qs.length === 1 ? '' : 's'}
        </span>
      </div>
      {qs.length === 0 ? (
        <div className="px-3 py-3 text-center text-[11px] text-muted-foreground">
          No questions in this section.
        </div>
      ) : (
        <div className="p-2 grid grid-cols-6 sm:grid-cols-8 gap-1.5">
          {qs.map((q, i) => (
            <Cell
              key={q.questionId as unknown as string}
              label={i + 1}
              q={q}
              isBusy={pending.has(q.questionId as unknown as string)}
              isFlagged={flaggedKeys.has(q.questionId as unknown as string)}
              onTap={() => onTap(q)}
              onToggleFlag={() => onToggleFlag(q)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

// ── Cell ────────────────────────────────────────────────────────────────────

const CELL_STYLES: Record<'correct' | 'wrong' | 'skipped', string> = {
  correct: 'bg-emerald-500 text-white shadow-sm shadow-emerald-500/20',
  wrong: 'bg-red-500/90 text-white shadow-sm shadow-red-500/20',
  skipped: 'bg-emerald-200 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300',
};

function Cell({
  label,
  q,
  isBusy,
  isFlagged,
  onTap,
  onToggleFlag,
}: {
  label: number;
  q: ScoringQ;
  isBusy: boolean;
  isFlagged: boolean;
  onTap: () => void;
  onToggleFlag: () => void;
}) {
  const mark = (q.mark as 'correct' | 'wrong' | 'skipped' | null) ?? null;
  const canFlag = q.conceptIds.length > 0;
  return (
    <div className="relative">
      <button
        type="button"
        onClick={onTap}
        disabled={isBusy}
        title={
          q.source === 'past-paper' && q.questionNumberInPaper
            ? `paper ${q.questionNumberInPaper}`
            : undefined
        }
        className={`w-full h-11 rounded-xl text-sm font-bold flex items-center justify-center transition-colors disabled:opacity-60 ${
          mark ? CELL_STYLES[mark] : 'bg-muted text-muted-foreground hover:bg-muted/70'
        }`}
      >
        {isBusy ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : mark === 'correct' ? (
          <Check className="w-4 h-4" />
        ) : mark === 'wrong' ? (
          <X className="w-4 h-4" />
        ) : mark === 'skipped' ? (
          <Minus className="w-4 h-4" />
        ) : (
          label
        )}
      </button>
      {/* Needs-explanation flag — only on a wrong answer with a tagged concept. */}
      {mark === 'wrong' && canFlag && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleFlag();
          }}
          aria-label={isFlagged ? 'Clear needs-explanation flag' : 'Flag for explanation'}
          title={isFlagged ? 'Clear needs-explanation flag' : 'Flag for explanation'}
          className={`absolute -top-1 -right-1 w-4 h-4 rounded-full flex items-center justify-center border ${
            isFlagged
              ? 'bg-amber-400 border-amber-500 text-amber-900'
              : 'bg-card border-border text-muted-foreground hover:text-amber-500'
          }`}
        >
          <Flag className="w-2.5 h-2.5" />
        </button>
      )}
    </div>
  );
}

function BulkBtn({
  label,
  title,
  onClick,
}: {
  label: string;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-muted text-muted-foreground hover:text-foreground hover:bg-muted/80 text-[11px] font-semibold transition-colors"
    >
      {label}
    </button>
  );
}
