'use client';

// CompressionDialog — the "+ unit" confirm sheet (sessions redesign,
// 2026-07-18). "I can also start the next unit now": the algorithm proposes
// compressing the CURRENT unit — keep GREEN (taught in Main) the first
// remaining question of each concept + the hardest ~20%; flip the middle
// drill work YELLOW (Revision department queues). The founder can flip any
// chip before confirming; flips are saved as MANUAL routes the algorithm
// never overwrites. Confirming writes the routes, then re-plans every
// future planned sheet so the timeline (and the exam deadline math) updates
// immediately. Opened from the week card AND the group Lesson Builder —
// same decision, two doors.

import { useMemo, useState } from 'react';
import { useMutation } from 'convex/react';
import { Loader2, MoveRight, Sparkles, X } from 'lucide-react';
import { toast } from 'sonner';
import { api, type Id } from '@/lib/convex';
import { cn } from '@/lib/utils';
import { useCachedQuery } from '@/hooks/use-cached-query';

export function CompressionDialog({
  groupId,
  unitName,
  onClose,
  onApplied,
}: {
  groupId: Id<'groups'>;
  unitName: (unitId: string) => string;
  onClose: () => void;
  onApplied?: () => void;
}) {
  const preview = useCachedQuery(
    api.learningEngine.groupPlan.compressionPreview,
    { groupId },
  );
  const applyCompression = useMutation(
    api.learningEngine.groupPlan.applyCompression,
  );
  const deleteFuturePlanned = useMutation(
    api.learningEngine.groupPlan.deleteFuturePlanned,
  );
  const crystallize = useMutation(
    api.learningEngine.groupPlan.crystallizeUpcoming,
  );

  // Founder overrides on top of the proposal: qid → chosen route.
  const [overrides, setOverrides] = useState<
    Map<string, 'main' | 'revision'>
  >(() => new Map());
  const [busy, setBusy] = useState(false);

  const ok = preview && 'status' in preview && preview.status === 'ok';
  const effective = useMemo(() => {
    const m = new Map<string, 'main' | 'revision'>();
    if (ok) {
      for (const q of preview.questions) {
        const k = q.questionId as unknown as string;
        m.set(k, overrides.get(k) ?? q.propose);
      }
    }
    return m;
  }, [ok, preview, overrides]);

  const counts = useMemo(() => {
    let main = 0;
    let revision = 0;
    effective.forEach((r) => {
      if (r === 'revision') revision += 1;
      else main += 1;
    });
    return { main, revision };
  }, [effective]);

  const flip = (qid: string) => {
    setOverrides((cur) => {
      const next = new Map(cur);
      next.set(
        qid,
        effective.get(qid) === 'revision' ? 'main' : 'revision',
      );
      return next;
    });
  };

  const confirm = async () => {
    if (!ok) return;
    setBusy(true);
    try {
      // Proposal-followed yellows are AUTO rows (re-compressible later);
      // anything the founder flipped is a MANUAL row (remembered forever).
      const autoRevisionIds: Id<'questionBank'>[] = [];
      const manualMainIds: Id<'questionBank'>[] = [];
      const manualRevisionIds: Id<'questionBank'>[] = [];
      for (const q of preview.questions) {
        const k = q.questionId as unknown as string;
        const chosen = effective.get(k)!;
        const overridden = overrides.has(k) && chosen !== q.propose;
        if (chosen === 'revision') {
          (overridden ? manualRevisionIds : autoRevisionIds).push(
            q.questionId,
          );
        } else if (overridden) {
          manualMainIds.push(q.questionId);
        }
      }
      await applyCompression({
        groupId,
        unitId: preview.currentUnitId,
        autoRevisionIds,
        manualMainIds,
        manualRevisionIds,
      });
      const del = await deleteFuturePlanned({ groupId });
      const res = await crystallize({ groupId, daysAhead: 180 });
      toast.success(
        `${unitName(preview.nextUnitId)} starts now — ${counts.revision} questions moved to Revision. Re-planned ${del.deleted}→${res.status === 'ok' ? res.written : 0} sheets.`,
        { duration: 6000 },
      );
      onApplied?.();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to compress');
      setBusy(false);
    }
  };

  const statusText: Record<string, string> = {
    'nothing-to-teach': 'Every unit with book entered is already covered.',
    'no-next-unit':
      'No next unit has book entered yet — enter more of the book first.',
    'nothing-to-compress':
      'The current unit has nothing left to move — it is already finished or fully routed.',
    'no-members': 'This group has no members yet.',
    'no-track': 'This group has no track yet.',
    'no-sessions': 'This group has no weekly sessions yet.',
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-2 pb-[calc(4rem+env(safe-area-inset-bottom,0px)+0.5rem)] sm:pb-2"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-card border border-border shadow-xl max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border shrink-0">
          <Sparkles className="w-4 h-4 text-primary shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-bold text-foreground truncate">
              {ok ? `Start ${unitName(preview.nextUnitId)} now` : 'Add a unit'}
            </div>
            {ok && (
              <div className="text-[10px] text-muted-foreground truncate">
                by compressing {unitName(preview.currentUnitId)}
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md hover:bg-muted text-muted-foreground"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-3 py-2.5 space-y-2.5">
          {preview === undefined && (
            <div className="space-y-2 animate-pulse">
              {[1, 2].map((i) => (
                <div key={i} className="h-10 bg-muted rounded-lg" />
              ))}
            </div>
          )}
          {preview !== undefined && !ok && (
            <div className="text-[11px] text-muted-foreground py-3 text-center">
              {statusText[(preview as { status: string } | null)?.status ?? ''] ??
                'Compression unavailable.'}
            </div>
          )}
          {ok && (
            <>
              <div className="text-[11px] leading-snug text-muted-foreground">
                <b className="text-emerald-500">{counts.main} stay in Main</b>{' '}
                (concept intros + the hard ones — the teacher must teach
                those) ·{' '}
                <b className="text-amber-500">
                  {counts.revision} move to Revision
                </b>{' '}
                (drill work the revision classes absorb). Tap a chip to flip
                it — your flips are remembered forever.
              </div>
              {preview.alreadyRouted > 0 && (
                <div className="text-[10px] text-muted-foreground">
                  {preview.alreadyRouted} questions of this unit are already
                  in Revision from an earlier decision.
                </div>
              )}
              <div className="flex flex-wrap gap-1">
                {preview.questions.map((q, i) => {
                  const k = q.questionId as unknown as string;
                  const r = effective.get(k)!;
                  return (
                    <button
                      key={k}
                      onClick={() => flip(k)}
                      title={`difficulty ${q.difficulty}`}
                      className={cn(
                        'min-w-7 h-7 px-1 rounded-md border text-[9px] font-semibold tabular-nums flex items-center justify-center transition-colors',
                        r === 'main'
                          ? 'bg-emerald-500/20 border-emerald-500/60 text-emerald-600 dark:text-emerald-400'
                          : 'bg-amber-400/20 border-amber-400/70 text-amber-600 dark:text-amber-400',
                      )}
                    >
                      {q.label ?? i + 1}
                    </button>
                  );
                })}
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-[8.5px] text-muted-foreground">
                <span className="flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded bg-emerald-500/30 border border-emerald-500/60" />
                  green — taught in Main
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded bg-amber-400/30 border border-amber-400/70" />
                  yellow — Revision queues
                </span>
              </div>
            </>
          )}
        </div>

        {ok && (
          <div className="border-t border-border p-2.5 shrink-0">
            <button
              onClick={confirm}
              disabled={busy}
              className="w-full inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold disabled:opacity-50"
            >
              {busy ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <MoveRight className="w-4 h-4" />
              )}
              {busy
                ? 'Compressing & re-planning…'
                : `Start ${unitName(preview.nextUnitId)} · move ${counts.revision} to Revision`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
