'use client';

// SheetScoringGrid — the section-tabbed scoring surface for ONE
// generatedSheet, bound by sheetId. Replaces the legacy exercise-centric
// score grid: it marks the sheet's exact questions in print order
// (Warm-up · Main · Revision · Exam-prep), live-saving each tap via
// setSheetMark and committing into the learning engine via
// finalizeSheetScoring.
//
// Design (founder decisions):
//   • Section tabs — Warm-up / Main / Revision / Exam-prep as a button group
//     in the header. One section is scored at a time; tabs carry a marked/
//     total count and a status dot (green = all corrected, amber = still has
//     unmarked questions, muted+disabled = empty section).
//   • Fixed grid — compact numbered cells for the active section. Tapping a
//     cell cycles unmarked → correct → wrong → skipped → unmarked.
//   • "View sheet" is an inline toggle (NOT a dialog): it swaps the same
//     content area between the scoring grid and the active section's question
//     images (read-only crops). Switching tabs switches which questions show.
//   • A wrong cell shows a small flag toggle that raises / clears a "needs
//     explanation" doubt (reuses the existing doubts pipeline, keyed by the
//     question's first tagged concept exercise).
//   • Bulk quick-actions (All ✓ / Rest ✓) batch-mark the ACTIVE section.
//   • Finalize records the WHOLE sheet's points + pushes attempts to the
//     engine, then shows an inline points/streak summary (not just a toast).
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
  Eye,
  LayoutGrid,
} from 'lucide-react';
import { api, type Id } from '@/lib/convex';
import { CropThumbnail } from '@/components/algorithm/sheet-preview';

type SlotName = 'warmup' | 'main' | 'revision' | 'examPrep';
type Mark = 'correct' | 'wrong' | 'skipped' | null;
type ViewMode = 'grid' | 'sheet';

// `short` labels keep the tab row on a single line on mobile (full name lives
// in the tab's tooltip).
const SECTIONS: Array<{ slot: SlotName; title: string; short: string }> = [
  { slot: 'warmup', title: 'Warm-up', short: 'Warm' },
  { slot: 'main', title: 'Main', short: 'Main' },
  { slot: 'revision', title: 'Revision', short: 'Rev' },
  { slot: 'examPrep', title: 'Exam prep', short: 'Exam' },
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

// One section's correction state, used by the tab dot + count.
type SectionState = 'empty' | 'partial' | 'done';

function tallyOf(qs: ScoringQ[]) {
  let correct = 0;
  let wrong = 0;
  let skipped = 0;
  for (const q of qs) {
    if (q.mark === 'correct') correct += 1;
    else if (q.mark === 'wrong') wrong += 1;
    else if (q.mark === 'skipped') skipped += 1;
  }
  const marked = correct + wrong + skipped;
  return { correct, wrong, skipped, marked, total: qs.length };
}

function sectionStateOf(qs: ScoringQ[]): SectionState {
  if (qs.length === 0) return 'empty';
  const { marked, total } = tallyOf(qs);
  return marked >= total ? 'done' : 'partial';
}

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

  // Which section is being scored / viewed, and grid-vs-sheet view mode.
  const [activeSlot, setActiveSlot] = useState<SlotName>('warmup');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');

  // Question crops for the inline "View sheet" mode — only fetched while the
  // sheet view is open (skipped otherwise to avoid the heavier query).
  const crops = useQuery(
    api.learningEngine.sheets.getSheetWithCrops,
    viewMode === 'sheet' ? { sheetId } : 'skip',
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
    setViewMode('grid');
  }, [sheetId]);

  // Keep the active tab on a section that actually has questions. Only moves
  // off the current tab when that tab is empty, so a refetch (after a mark)
  // never yanks the teacher to a different section mid-scoring.
  useEffect(() => {
    if (!data) return;
    setActiveSlot((cur) => {
      if ((data[cur] as ScoringQ[]).length > 0) return cur;
      const firstNonEmpty = SECTIONS.find(
        (s) => (data[s.slot] as ScoringQ[]).length > 0,
      );
      return firstNonEmpty ? firstNonEmpty.slot : cur;
    });
  }, [data]);

  // questionId(string) → true for every pending "needs explanation" doubt.
  const flaggedKeys = useMemo(() => {
    const s = new Set<string>();
    for (const d of doubts ?? []) {
      if (d.status === 'pending' && d.questionKey) s.add(d.questionKey);
    }
    return s;
  }, [doubts]);

  // Per-section count + state for the tab bar.
  const sectionMeta = useMemo(() => {
    const out = {} as Record<
      SlotName,
      { marked: number; total: number; state: SectionState }
    >;
    for (const { slot } of SECTIONS) {
      const qs = (data?.[slot] as ScoringQ[] | undefined) ?? [];
      const t = tallyOf(qs);
      out[slot] = { marked: t.marked, total: t.total, state: sectionStateOf(qs) };
    }
    return out;
  }, [data]);

  const activeQs = useMemo(
    () => ((data?.[activeSlot] as ScoringQ[] | undefined) ?? []),
    [data, activeSlot],
  );
  const activeTally = useMemo(() => tallyOf(activeQs), [activeQs]);

  // Whole-sheet marked/total (shown next to Finalize, which records all).
  const sheetTotal = useMemo(() => {
    let marked = 0;
    let total = 0;
    if (data) {
      for (const { slot } of SECTIONS) {
        const t = tallyOf(data[slot] as ScoringQ[]);
        marked += t.marked;
        total += t.total;
      }
    }
    return { marked, total };
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

  // Bulk: mark the ACTIVE section correct, or only its still-unmarked ones.
  const bulkCorrect = useCallback(
    async (onlyUnmarked: boolean) => {
      const targets: Id<'questionBank'>[] = [];
      for (const q of activeQs) {
        if (onlyUnmarked && q.mark) continue;
        if (q.mark === 'correct') continue;
        targets.push(q.questionId);
      }
      for (const questionId of targets) {
        await writeMark(questionId, 'correct');
      }
    },
    [activeQs, writeMark],
  );

  const onFinalize = useCallback(async () => {
    if (finalizing || sheetTotal.marked === 0) return;
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
  }, [finalizing, sheetTotal.marked, finalize, sheetId]);

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

      {/* Section tabs (left, scroll if cramped) + grid/sheet view toggle
          (right). Single row — never wraps. */}
      <div className="flex items-center gap-1.5 mb-3">
        <div className="flex items-center gap-1 flex-1 min-w-0 overflow-x-auto">
          {SECTIONS.map(({ slot, title, short }) => (
            <SectionTab
              key={slot}
              title={title}
              short={short}
              meta={sectionMeta[slot]}
              active={slot === activeSlot}
              onClick={() => setActiveSlot(slot)}
            />
          ))}
        </div>
        <button
          type="button"
          onClick={() => setViewMode((m) => (m === 'grid' ? 'sheet' : 'grid'))}
          title={viewMode === 'grid' ? 'Show the question images' : 'Back to the scoring grid'}
          className="shrink-0 inline-flex items-center gap-1 px-2 py-1.5 rounded-lg bg-muted text-foreground text-[11px] font-semibold hover:bg-muted/80"
        >
          {viewMode === 'grid' ? (
            <>
              <Eye className="w-3 h-3" />
              Sheet
            </>
          ) : (
            <>
              <LayoutGrid className="w-3 h-3" />
              Grid
            </>
          )}
        </button>
      </div>

      {/* Active section content — grid or inline sheet view. */}
      {viewMode === 'grid' ? (
        <ActiveGrid
          qs={activeQs}
          pending={pending}
          flaggedKeys={flaggedKeys}
          onTap={onTap}
          onToggleFlag={onToggleFlag}
        />
      ) : (
        <SheetSectionView crops={crops} slot={activeSlot} />
      )}

      {/* Bulk quick-actions — active section only, grid mode only. */}
      {viewMode === 'grid' && activeQs.length > 0 && (
        <div className="flex items-center gap-1.5 pt-2">
          <BulkBtn
            label="All ✓"
            title="Mark this section's questions correct"
            onClick={() => bulkCorrect(false)}
          />
          <BulkBtn
            label="Rest ✓"
            title="Mark this section's remaining unmarked questions correct"
            onClick={() => bulkCorrect(true)}
          />
        </div>
      )}

      {/* Footer: active-section tallies + whole-sheet total + finalize. */}
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
              {activeTally.correct}
            </span>
            <span className="inline-flex items-center gap-1 text-red-600 dark:text-red-400">
              <X className="w-3.5 h-3.5" />
              {activeTally.wrong}
            </span>
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              <SkipForward className="w-3.5 h-3.5" />
              {activeTally.skipped}
            </span>
            <span className="text-muted-foreground/70">
              {activeTally.marked}/{activeTally.total} here
            </span>
          </div>
          <div className="ml-auto flex items-center gap-2.5">
            <span className="text-[10px] text-muted-foreground tabular-nums">
              sheet {sheetTotal.marked}/{sheetTotal.total}
            </span>
            <button
              onClick={onFinalize}
              disabled={finalizing || sheetTotal.marked === 0}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-semibold disabled:opacity-40"
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
    </div>
  );
}

// ── Section tab ─────────────────────────────────────────────────────────────

const DOT_CLS: Record<SectionState, string> = {
  empty: 'bg-muted-foreground/30',
  partial: 'bg-amber-500',
  done: 'bg-emerald-500',
};

function SectionTab({
  title,
  short,
  meta,
  active,
  onClick,
}: {
  title: string;
  short: string;
  meta: { marked: number; total: number; state: SectionState };
  active: boolean;
  onClick: () => void;
}) {
  const empty = meta.state === 'empty';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={empty}
      title={
        empty
          ? `${title} — no questions`
          : `${title} — ${meta.marked}/${meta.total} marked`
      }
      className={`shrink-0 inline-flex items-center gap-1 px-2 py-1.5 rounded-lg text-[11px] font-semibold border transition-colors ${
        empty
          ? 'border-transparent bg-muted/40 text-muted-foreground/50 cursor-not-allowed'
          : active
            ? 'border-primary bg-primary/10 text-foreground'
            : 'border-border bg-card text-muted-foreground hover:text-foreground'
      }`}
    >
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${DOT_CLS[meta.state]}`} />
      {short}
      {!empty && (
        <span className="tabular-nums text-[10px] text-muted-foreground/80">
          {meta.marked}/{meta.total}
        </span>
      )}
    </button>
  );
}

// ── Active section grid ─────────────────────────────────────────────────────

function ActiveGrid({
  qs,
  pending,
  flaggedKeys,
  onTap,
  onToggleFlag,
}: {
  qs: ScoringQ[];
  pending: Set<string>;
  flaggedKeys: Set<string>;
  onTap: (q: ScoringQ) => void;
  onToggleFlag: (q: ScoringQ) => void;
}) {
  if (qs.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card px-3 py-6 text-center text-[11px] text-muted-foreground">
        No questions in this section.
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-border bg-card p-2 grid grid-cols-6 sm:grid-cols-8 gap-1.5">
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
  );
}

// ── Inline sheet view (read-only crops for the active section) ───────────────

type CropQ = {
  questionId: Id<'questionBank'>;
  cropBox: { x: number; y: number; w: number; h: number } | null;
  pageImageUrl: string | null;
  conceptNames: string[];
  source: string;
  questionNumberInPaper: string | null;
  marksAvailable: number | null;
};

function SheetSectionView({
  crops,
  slot,
}: {
  crops:
    | { warmup: CropQ[]; main: CropQ[]; revision: CropQ[]; examPrep: CropQ[] }
    | null
    | undefined;
  slot: SlotName;
}) {
  if (crops === undefined) {
    return (
      <div className="space-y-2 animate-pulse">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-20 bg-muted rounded-xl" />
        ))}
      </div>
    );
  }
  if (crops === null) {
    return (
      <div className="rounded-xl border border-border bg-card p-4 text-center text-[12px] text-muted-foreground">
        Sheet not found, or you are not signed in.
      </div>
    );
  }
  const qs = crops[slot];
  if (qs.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card px-3 py-6 text-center text-[11px] text-muted-foreground">
        No questions in this section.
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden divide-y divide-border">
      {qs.map((q, i) => (
        <div key={q.questionId as unknown as string} className="px-3 py-2.5 flex gap-2.5">
          <CropThumbnail imageUrl={q.pageImageUrl} cropBox={q.cropBox} maxSide={96} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 mb-1">
              <span className="text-xs font-bold text-foreground shrink-0">
                Q{i + 1}
              </span>
              {q.source === 'past-paper' && q.questionNumberInPaper && (
                <span className="text-[10px] text-muted-foreground">
                  paper {q.questionNumberInPaper}
                </span>
              )}
              {q.marksAvailable !== null && (
                <span className="text-[10px] text-muted-foreground">
                  [{q.marksAvailable}m]
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-1">
              {q.conceptNames.length === 0 ? (
                <span className="text-[10px] text-muted-foreground italic">
                  untagged
                </span>
              ) : (
                q.conceptNames.slice(0, 3).map((name, j) => (
                  <span
                    key={j}
                    className="text-[9px] px-1.5 py-0.5 rounded-md bg-muted text-foreground"
                  >
                    {name}
                  </span>
                ))
              )}
              {q.conceptNames.length > 3 && (
                <span className="text-[9px] text-muted-foreground self-center">
                  +{q.conceptNames.length - 3}
                </span>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
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
