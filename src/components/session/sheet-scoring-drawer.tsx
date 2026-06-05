'use client';

// Phase 2 — sheet-scoped scoring drawer.
//
// Full-screen overlay opened from a "Score" action on a Sheets-tab student
// row, bound to ONE generatedSheets._id by construction (so the teacher can
// never score the wrong sheet). Shows the sheet's exact questions in print
// order — Warm-up · Main · Revision · Exam-prep — each as a tappable row that
// cycles unmarked → correct → wrong → skipped → unmarked, live-saving every
// change via setSheetMark. The sticky footer's "Finalize & record" commits the
// marks into the learning engine (memoryState) idempotently and completes the
// sheet.
//
// Additive: this is a NEW surface beside the legacy entries Score tab; it does
// not modify points/leaderboard/position.

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { toast } from 'sonner';
import { X, Check, Minus, SkipForward, Loader2, CheckCircle2 } from 'lucide-react';
import { api, type Id } from '@/lib/convex';
import { CropThumbnail } from '@/components/algorithm/sheet-preview';

type SlotName = 'warmup' | 'main' | 'revision' | 'examPrep';
type Mark = 'correct' | 'wrong' | 'skipped' | null;

const SECTION_TITLES: Record<SlotName, string> = {
  warmup: 'Warm-up · fix your mistakes',
  main: 'Main block · next on your path',
  revision: 'Revision · spaced repetition',
  examPrep: 'Exam prep · past papers',
};

// Tap order: unmarked → correct → wrong → skipped → unmarked.
function nextMark(mark: Mark): 'correct' | 'wrong' | 'skipped' | 'unmarked' {
  if (mark === null) return 'correct';
  if (mark === 'correct') return 'wrong';
  if (mark === 'wrong') return 'skipped';
  return 'unmarked';
}

export function SheetScoringDrawer({
  sheetId,
  onClose,
}: {
  sheetId: Id<'generatedSheets'>;
  onClose: () => void;
}) {
  const data = useQuery(api.learningEngine.scoring.getSheetForScoring, { sheetId });
  const setSheetMark = useMutation(api.learningEngine.scoring.setSheetMark);
  const finalize = useMutation(api.learningEngine.scoring.finalizeSheetScoring);

  // Questions currently mid-save (disables re-tap until the patch lands).
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [finalizing, setFinalizing] = useState(false);

  // Lock page scroll while the drawer is open.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const sections: SlotName[] = ['warmup', 'main', 'revision', 'examPrep'];

  const tallies = useMemo(() => {
    let correct = 0;
    let wrong = 0;
    let skipped = 0;
    let total = 0;
    if (data) {
      for (const slot of sections) {
        for (const q of data[slot]) {
          total += 1;
          if (q.mark === 'correct') correct += 1;
          else if (q.mark === 'wrong') wrong += 1;
          else if (q.mark === 'skipped') skipped += 1;
        }
      }
    }
    return { correct, wrong, skipped, total, marked: correct + wrong + skipped };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const onTap = async (questionId: Id<'questionBank'>, current: Mark) => {
    const key = questionId as unknown as string;
    if (pending.has(key)) return;
    setPending((s) => new Set(s).add(key));
    try {
      await setSheetMark({ sheetId, questionId, mark: nextMark(current) });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setPending((s) => {
        const n = new Set(s);
        n.delete(key);
        return n;
      });
    }
  };

  const onFinalize = async () => {
    if (finalizing || tallies.marked === 0) return;
    setFinalizing(true);
    try {
      const res = await finalize({ sheetId });
      toast.success(
        `Recorded — ${res.appliedAttempts} attempt${res.appliedAttempts === 1 ? '' : 's'} pushed to the engine.`,
      );
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setFinalizing(false);
    }
  };

  const isCompleted = data?.sheet.status === 'completed';

  return (
    <div
      className="fixed inset-0 z-40 bg-black/60 flex items-start justify-center overflow-y-auto p-2 sm:p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl rounded-2xl bg-card border border-border shadow-2xl mt-2 sm:mt-6 mb-28 flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 rounded-t-2xl bg-card border-b border-border px-3 pt-3 pb-2 flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-bold text-foreground truncate">
              {data?.student.name ?? 'Loading…'}
            </div>
            <div className="text-[10px] text-muted-foreground flex items-center gap-1.5">
              {data && (
                <>
                  <span>G{data.student.schoolGrade}</span>
                  <span>·</span>
                  <span>{data.sheet.date}</span>
                  <span>·</span>
                  <span className="font-mono">#{data.sheet.shortId}</span>
                  <span>·</span>
                  <span className="tabular-nums">
                    {tallies.marked}/{tallies.total} marked
                  </span>
                  {isCompleted && (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 font-semibold">
                      <CheckCircle2 className="w-3 h-3" />
                      Recorded
                    </span>
                  )}
                </>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-md hover:bg-muted text-muted-foreground"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        {data === undefined && (
          <div className="p-6 space-y-2 animate-pulse">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-16 bg-muted rounded-xl" />
            ))}
          </div>
        )}
        {data === null && (
          <div className="p-6 text-center text-sm text-muted-foreground">
            Sheet not found or you are not signed in.
          </div>
        )}

        {data && (
          <div className="px-3 py-3 space-y-4">
            {isCompleted && (
              <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[11px] text-emerald-700 dark:text-emerald-400">
                Already recorded into the engine. You can flip a mark and
                re-finalize — only the changed answer re-commits.
              </div>
            )}
            {sections.map((slot) => (
              <Section
                key={slot}
                title={SECTION_TITLES[slot]}
                qs={data[slot]}
                pending={pending}
                onTap={onTap}
              />
            ))}
          </div>
        )}
      </div>

      {/* Sticky footer: tallies + finalize */}
      {data && (
        <div
          className="fixed bottom-0 inset-x-0 z-50 bg-card/95 backdrop-blur border-t border-border px-3 py-2.5 pb-[calc(0.625rem+env(safe-area-inset-bottom,0px))]"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="max-w-2xl mx-auto flex items-center gap-3">
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
              {finalizing ? 'Recording…' : 'Finalize & record'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Section ─────────────────────────────────────────────────────────────────

type ScoringQ = {
  questionId: Id<'questionBank'>;
  cropBox: { x: number; y: number; w: number; h: number } | null;
  pageImageUrl: string | null;
  conceptNames: string[];
  source: string;
  questionNumberInPaper: string | null;
  marksAvailable: number | null;
  mark: string | null;
};

function Section({
  title,
  qs,
  pending,
  onTap,
}: {
  title: string;
  qs: ScoringQ[];
  pending: Set<string>;
  onTap: (questionId: Id<'questionBank'>, current: Mark) => void;
}) {
  return (
    <section className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="px-3 py-2 border-b border-border bg-muted/30 flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">
          {title}
        </span>
        <span className="ml-auto text-[10px] text-muted-foreground tabular-nums">
          {qs.length} Q{qs.length === 1 ? '' : 's'}
        </span>
      </div>
      {qs.length === 0 && (
        <div className="px-3 py-4 text-center text-[11px] text-muted-foreground">
          No questions in this section.
        </div>
      )}
      <div className="divide-y divide-border">
        {qs.map((q, i) => (
          <QRow
            key={q.questionId as unknown as string}
            label={`Q${i + 1}`}
            q={q}
            isBusy={pending.has(q.questionId as unknown as string)}
            onTap={() => onTap(q.questionId, (q.mark as Mark) ?? null)}
          />
        ))}
      </div>
    </section>
  );
}

// ── Q row ───────────────────────────────────────────────────────────────────

const MARK_STYLES: Record<
  'correct' | 'wrong' | 'skipped',
  { ring: string; chip: string; label: string; icon: React.ReactNode }
> = {
  correct: {
    ring: 'ring-2 ring-emerald-500/60',
    chip: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
    label: 'Correct',
    icon: <Check className="w-3.5 h-3.5" />,
  },
  wrong: {
    ring: 'ring-2 ring-red-500/60',
    chip: 'bg-red-500/15 text-red-700 dark:text-red-400',
    label: 'Wrong',
    icon: <X className="w-3.5 h-3.5" />,
  },
  skipped: {
    ring: 'ring-2 ring-amber-500/50',
    chip: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
    label: 'Skipped',
    icon: <SkipForward className="w-3.5 h-3.5" />,
  },
};

function QRow({
  label,
  q,
  isBusy,
  onTap,
}: {
  label: string;
  q: ScoringQ;
  isBusy: boolean;
  onTap: () => void;
}) {
  const mark = (q.mark as 'correct' | 'wrong' | 'skipped' | null) ?? null;
  const style = mark ? MARK_STYLES[mark] : null;
  return (
    <button
      type="button"
      onClick={onTap}
      disabled={isBusy}
      className={`w-full text-left px-3 py-2.5 flex gap-2.5 items-center transition-colors hover:bg-muted/40 disabled:opacity-60 ${
        style ? style.ring : ''
      }`}
    >
      <CropThumbnail imageUrl={q.pageImageUrl} cropBox={q.cropBox} maxSide={72} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 mb-1">
          <span className="text-xs font-bold text-foreground shrink-0">{label}</span>
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
              untagged · won&apos;t affect mastery
            </span>
          ) : (
            q.conceptNames.slice(0, 3).map((name, i) => (
              <span
                key={i}
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
      <div className="shrink-0">
        {isBusy ? (
          <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
        ) : style ? (
          <span
            className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-semibold ${style.chip}`}
          >
            {style.icon}
            {style.label}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-semibold bg-muted text-muted-foreground">
            <Minus className="w-3.5 h-3.5" />
            Tap
          </span>
        )}
      </div>
    </button>
  );
}
