'use client';

// GroupUnitBuilderDialog — the group-scoped Lesson Builder (2026-07-17).
// Reached by tapping a unit name in the planner Sheets timeline. Same screen
// language as the session Lesson Builder's Main tab — concept chips, tick
// tiles with stems, book-order lens, lesson sets, Arrange — but CURATION
// semantics: a tick means "this question belongs in the group's term plan".
// The algorithm's picks arrive pre-ticked (everything not banned is on the
// ladder walk); unticking BANS the question (groupUnitBans); saving rebuilds
// every future planned sheet so the plan matches immediately. Taught
// questions are locked — history can't be unticked.

import { useMemo, useState } from 'react';
import { useMutation } from 'convex/react';
import {
  ArrowUpDown,
  BookOpen,
  BookmarkPlus,
  Check,
  Loader2,
  Sparkles,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { sortByBookOrder } from '@/lib/book-order';
import { api, type Id } from '@/lib/convex';
import { cn } from '@/lib/utils';
import { useCachedQuery } from '@/hooks/use-cached-query';
import { CropThumbnail } from '@/components/algorithm/sheet-preview';
import { UnitArrangeDialog } from './unit-arrange-dialog';

type CatalogQ = {
  questionId: Id<'questionBank'>;
  source: string;
  difficulty: number | null;
  label: string | null;
  cropBox: { x: number; y: number; w: number; h: number } | null;
  pageImageUrl: string | null;
  pageImageUrlSmall: string | null;
  overrideImageUrl: string | null;
  stems: Array<{
    stemId: Id<'questionBank'>;
    cropBox: { x: number; y: number; w: number; h: number } | null;
    pageImageUrl: string | null;
    pageImageUrlSmall: string | null;
    overrideImageUrl: string | null;
  }>;
};

export function GroupUnitBuilderDialog({
  groupId,
  unitId,
  unitName,
  onClose,
}: {
  groupId: Id<'groups'>;
  unitId: string;
  unitName: string;
  onClose: () => void;
}) {
  const catalog = useCachedQuery(
    api.learningEngine.lessonSets.listUnitQuestions,
    { unitId },
  );
  const curation = useCachedQuery(
    api.learningEngine.groupPlan.groupUnitCuration,
    {
      groupId,
      unitId,
    },
  );
  const lessonSets = useCachedQuery(api.learningEngine.lessonSets.listForUnit, {
    unitId,
  });
  const saveLessonSet = useMutation(
    api.learningEngine.lessonSets.saveLessonSet,
  );
  const setBans = useMutation(api.learningEngine.groupPlan.setGroupUnitBans);
  const deleteFuturePlanned = useMutation(
    api.learningEngine.groupPlan.deleteFuturePlanned,
  );
  const crystallize = useMutation(
    api.learningEngine.groupPlan.crystallizeUpcoming,
  );

  const [conceptFilter, setConceptFilter] = useState<string | 'all'>('all');
  const [bookView, setBookView] = useState(false);
  const [arranging, setArranging] = useState(false);
  const [saving, setSaving] = useState(false);

  // Group state per question: taught (locked), planned, banned.
  const curOk = curation && 'status' in curation && curation.status === 'ok';
  const stateByQid = useMemo(() => {
    const m = new Map<
      string,
      { taught: boolean; planned: boolean; banned: boolean }
    >();
    if (curOk) {
      for (const q of curation.questions)
        m.set(q.questionId as unknown as string, {
          taught: q.taught,
          planned: q.planned,
          banned: q.banned,
        });
    }
    return m;
  }, [curation, curOk]);

  // Ticks — initialised from the group state at render time when it first
  // arrives (the "reset state when input changes" pattern): everything not
  // banned is in the plan, so it starts ticked.
  const [ticked, setTicked] = useState<Set<string>>(() => new Set());
  const [initial, setInitial] = useState<Set<string>>(() => new Set());
  const [seededFrom, setSeededFrom] = useState<unknown>(undefined);
  if (curOk && curation !== seededFrom) {
    setSeededFrom(curation);
    const init = new Set<string>();
    for (const q of curation.questions) {
      if (q.taught || !q.banned) init.add(q.questionId as unknown as string);
    }
    setTicked(init);
    setInitial(init);
  }

  const toggle = (qid: string) => {
    const st = stateByQid.get(qid);
    if (st?.taught) return; // history is locked
    setTicked((cur) => {
      const next = new Set(cur);
      if (next.has(qid)) next.delete(qid);
      else next.add(qid);
      return next;
    });
  };

  const concepts = useMemo(() => catalog?.concepts ?? [], [catalog]);
  const allQs = useMemo(
    () => concepts.flatMap((c) => c.questions as CatalogQ[]),
    [concepts],
  );
  const totalCount = allQs.length;
  const tickedCount = allQs.filter((q) =>
    ticked.has(q.questionId as unknown as string),
  ).length;
  const dirty = useMemo(() => {
    if (ticked.size !== initial.size) return true;
    for (const k of ticked) if (!initial.has(k)) return true;
    return false;
  }, [ticked, initial]);

  const applyLessonSet = (questionIds: string[]) => {
    const preset = new Set(questionIds);
    setTicked(() => {
      const next = new Set<string>();
      for (const q of allQs) {
        const k = q.questionId as unknown as string;
        const st = stateByQid.get(k);
        if (st?.taught || preset.has(k)) next.add(k);
      }
      return next;
    });
  };

  const saveAsLesson = async () => {
    const name = window.prompt(
      'Name this lesson set (saving the ticked questions for reuse):',
    );
    if (!name?.trim()) return;
    try {
      await saveLessonSet({
        unitId,
        name: name.trim(),
        questionIds: allQs
          .filter((q) => ticked.has(q.questionId as unknown as string))
          .map((q) => q.questionId),
      });
      toast.success(`Lesson set “${name.trim()}” saved.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save lesson set');
    }
  };

  // Save & re-plan: unticked ⇒ banned, then the future planned sheets are
  // dropped and rebuilt so the timeline matches the curation immediately.
  const saveAndReplan = async () => {
    setSaving(true);
    try {
      const banned = allQs
        .filter((q) => {
          const k = q.questionId as unknown as string;
          return !ticked.has(k) && !stateByQid.get(k)?.taught;
        })
        .map((q) => q.questionId);
      await setBans({ groupId, unitId, bannedQuestionIds: banned });
      const del = await deleteFuturePlanned({ groupId });
      const res = await crystallize({ groupId, daysAhead: 180 });
      toast.success(
        `Saved — ${banned.length} excluded. Re-planned: ${del.deleted} sheets dropped, ${
          res.status === 'ok' ? res.written : 0
        } rebuilt.`,
      );
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save');
      setSaving(false);
    }
  };

  const filtered =
    conceptFilter === 'all'
      ? concepts
      : concepts.filter(
          (c) => (c.conceptId as unknown as string) === conceptFilter,
        );

  return (
    <div className="fixed inset-0 z-50 bg-background flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-3 border-b border-border shrink-0">
        <Sparkles className="w-4 h-4 text-primary shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold text-foreground truncate">
            {unitName}
          </div>
          <div className="text-[10px] text-muted-foreground">
            {curation === undefined || catalog === undefined ? (
              'Loading…'
            ) : (
              <>
                <b className="text-foreground">{tickedCount}</b> of {totalCount}{' '}
                in the group&rsquo;s plan · untick to exclude
              </>
            )}
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-md hover:bg-muted text-muted-foreground"
          aria-label="Close"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Toolbar: book-order lens · arrange · lesson sets */}
      <div className="px-3 py-2 border-b border-border/60 shrink-0 space-y-2">
        <div className="flex items-center gap-1.5 overflow-x-auto">
          <button
            onClick={() => setBookView((v) => !v)}
            className={cn(
              'shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-lg border text-[10.5px] font-semibold',
              bookView
                ? 'border-primary/60 bg-primary/10 text-foreground'
                : 'border-border text-muted-foreground',
            )}
          >
            <BookOpen className="w-3 h-3" />
            Book order
          </button>
          <button
            onClick={() => setArranging(true)}
            className="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-border text-[10.5px] font-semibold text-muted-foreground"
          >
            <ArrowUpDown className="w-3 h-3" />
            Arrange
          </button>
          <button
            onClick={saveAsLesson}
            className="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-border text-[10.5px] font-semibold text-muted-foreground"
          >
            <BookmarkPlus className="w-3 h-3" />
            Save lesson
          </button>
          {(lessonSets ?? []).map((ls) => (
            <button
              key={ls._id as unknown as string}
              onClick={() =>
                applyLessonSet(ls.questionIds as unknown as string[])
              }
              className="shrink-0 px-2 py-1 rounded-lg border border-border text-[10.5px] text-foreground"
              title="Apply this lesson set's ticks"
            >
              {ls.name}
            </button>
          ))}
        </div>
        {/* Concept chips */}
        <div className="flex items-center gap-1.5 overflow-x-auto">
          <button
            onClick={() => setConceptFilter('all')}
            className={cn(
              'shrink-0 px-2 py-1 rounded-lg border text-[10.5px] font-semibold',
              conceptFilter === 'all'
                ? 'border-primary/60 bg-primary/10 text-foreground'
                : 'border-border text-muted-foreground',
            )}
          >
            All
          </button>
          {concepts.map((c) => {
            const cid = c.conceptId as unknown as string;
            const n = c.questions.filter((q) =>
              ticked.has(q.questionId as unknown as string),
            ).length;
            return (
              <button
                key={cid}
                onClick={() => setConceptFilter(cid)}
                className={cn(
                  'shrink-0 px-2 py-1 rounded-lg border text-[10.5px]',
                  conceptFilter === cid
                    ? 'border-primary/60 bg-primary/10 text-foreground font-semibold'
                    : 'border-border text-muted-foreground',
                )}
              >
                {c.conceptName}
                <span className="ml-1 tabular-nums opacity-70">
                  {n}/{c.questions.length}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Question list */}
      <div className="flex-1 overflow-y-auto px-3 py-3 pb-28">
        {(catalog === undefined || curation === undefined) && (
          <div className="space-y-2 animate-pulse">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-16 bg-muted rounded-lg" />
            ))}
          </div>
        )}
        {catalog && concepts.length === 0 && (
          <div className="text-center text-sm text-muted-foreground py-8">
            No questions entered for this unit yet — enter the book first.
          </div>
        )}
        {curation !== undefined &&
          !curOk &&
          curation !== null &&
          'status' in (curation ?? {}) && (
            <div className="text-center text-[11px] text-muted-foreground py-2">
              Group plan unavailable ({(curation as { status: string }).status})
              — ticks show the whole unit.
            </div>
          )}
        {catalog &&
          curation !== undefined &&
          filtered.map((c) => {
            const qs = bookView
              ? sortByBookOrder(c.questions as CatalogQ[])
              : (c.questions as CatalogQ[]);
            let prevStem: string | null = null;
            return (
              <div key={c.conceptId as unknown as string} className="mb-4">
                <div className="text-[11px] font-bold text-foreground mb-1.5 flex items-center gap-2">
                  <span className="truncate">{c.conceptName}</span>
                  <span className="h-px flex-1 bg-border" />
                </div>
                <div className="space-y-1.5">
                  {qs.map((q) => {
                    const k = q.questionId as unknown as string;
                    const st = stateByQid.get(k);
                    const isTicked = ticked.has(k);
                    const stem = q.stems[0] ?? null;
                    const stemKey = stem
                      ? (stem.stemId as unknown as string)
                      : null;
                    const showStem = stem !== null && stemKey !== prevStem;
                    prevStem = stemKey;
                    return (
                      <div key={k}>
                        {/* Shared stem row — once per run of siblings */}
                        {showStem && stem && (
                          <div className="flex items-center gap-2 pl-9 pb-1 opacity-80">
                            {stem.overrideImageUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={stem.overrideImageUrl}
                                alt="Stem"
                                className="max-h-10 rounded border border-border/40"
                              />
                            ) : (
                              <CropThumbnail
                                imageUrl={stem.pageImageUrl}
                                imageUrlSmall={stem.pageImageUrlSmall}
                                cropBox={stem.cropBox}
                                maxSide={220}
                              />
                            )}
                          </div>
                        )}
                        <div
                          className={cn(
                            'flex items-center gap-2 rounded-lg border bg-card px-2 py-1.5',
                            st?.taught
                              ? 'border-emerald-500/40'
                              : isTicked
                                ? 'border-border'
                                : 'border-dashed border-rose-500/40 opacity-70',
                          )}
                        >
                          <button
                            onClick={() => toggle(k)}
                            disabled={st?.taught}
                            aria-label={isTicked ? 'Untick' : 'Tick'}
                            className={cn(
                              'shrink-0 w-6 h-6 rounded-md border flex items-center justify-center',
                              st?.taught
                                ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-500'
                                : isTicked
                                  ? 'bg-primary border-primary text-primary-foreground'
                                  : 'border-border text-transparent',
                            )}
                          >
                            <Check className="w-4 h-4" />
                          </button>
                          <span className="w-9 shrink-0 text-[10px] font-semibold text-foreground truncate">
                            {q.label ?? 'Q'}
                          </span>
                          <span className="w-6 shrink-0 text-[9px] tabular-nums text-muted-foreground">
                            {q.difficulty !== null ? `d${q.difficulty}` : ''}
                          </span>
                          <div className="min-w-0 flex-1">
                            {q.overrideImageUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={q.overrideImageUrl}
                                alt={q.label ?? 'Question'}
                                className="max-h-14 rounded border border-border/40"
                              />
                            ) : (
                              <CropThumbnail
                                imageUrl={q.pageImageUrl}
                                imageUrlSmall={q.pageImageUrlSmall}
                                cropBox={q.cropBox}
                                maxSide={120}
                              />
                            )}
                          </div>
                          <span
                            className={cn(
                              'shrink-0 px-1 py-px rounded border text-[7.5px] font-semibold leading-tight',
                              st?.taught
                                ? 'bg-emerald-500/15 text-emerald-500 border-emerald-500/40'
                                : st?.planned && isTicked
                                  ? 'bg-primary/15 text-primary border-primary/40'
                                  : !isTicked
                                    ? 'bg-rose-500/10 text-rose-500 border-rose-500/40'
                                    : 'bg-muted text-muted-foreground border-border',
                            )}
                          >
                            {st?.taught
                              ? 'taught'
                              : !isTicked
                                ? 'excluded'
                                : st?.planned
                                  ? 'planned'
                                  : 'in plan'}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
      </div>

      {/* Save bar */}
      <div className="absolute bottom-0 inset-x-0 border-t border-border bg-card px-3 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] flex gap-2">
        <button
          onClick={onClose}
          disabled={saving}
          className="px-4 py-2.5 rounded-lg border border-border text-foreground text-sm font-semibold disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          onClick={saveAndReplan}
          disabled={saving || !dirty || !curOk}
          className="flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold disabled:opacity-50"
        >
          {saving && <Loader2 className="w-4 h-4 animate-spin" />}
          {saving
            ? 'Saving & re-planning…'
            : dirty
              ? 'Save & re-plan future sheets'
              : 'No changes'}
        </button>
      </div>

      {arranging && (
        <UnitArrangeDialog
          unitId={unitId}
          unitName={unitName}
          onClose={() => setArranging(false)}
        />
      )}
    </div>
  );
}
