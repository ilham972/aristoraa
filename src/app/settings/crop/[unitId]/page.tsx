'use client';

import { useEffect, useMemo, useState, useRef, useCallback } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useMutation } from 'convex/react';
import { ChevronLeft, Scissors, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/convex';
import type { Id } from '@/lib/convex';
import { findUnit, extractUnitNumber } from '@/lib/curriculum-data';
import { PageCropOverlay } from '@/components/settings/page-crop-overlay';
import {
  generateCropKeys,
  parseCropKey,
  resumeCropKey,
  nextCropKey,
} from '@/lib/crop-keys';
import { getSubLabel, type SubQuestionsMap } from '@/lib/sub-questions';
import { toast } from 'sonner';

type CropBox = { x: number; y: number; w: number; h: number };

/**
 * Unit-page crop view.
 *
 * Two modes selected by the optional `?exerciseId=...` search param:
 *
 *   - Fast / per-exercise mode:
 *       Pages narrowed to the exercise's pageNumber..pageNumberEnd range.
 *       Sticky pill header in route header lets the user tap a main-Q or
 *       sub-letter; drawing instantly saves with that key + linkedExerciseId,
 *       then auto-advances. Tapping an existing crop selects it (sky-blue
 *       outline) so the next pill-tap re-keys instead of advancing.
 *
 *   - Unit ("see all") mode:
 *       No exerciseId. Shows every page in the unit's range. Crops save
 *       unlinked and use the legacy tap-to-link dialog from PageCropOverlay.
 *
 * Both modes persist scroll position via sessionStorage so closing and
 * re-opening the same view lands the user back on the page they were last
 * viewing.
 */
export default function UnitCropPage() {
  const params = useParams<{ unitId: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const unitId = params.unitId;
  const exerciseIdParam = searchParams.get('exerciseId');
  const exerciseId = exerciseIdParam as Id<'exercises'> | null;
  const isFastMode = !!exerciseId;

  const [cropMode, setCropMode] = useState(true);

  // Document-level contextmenu blocker. Android Chrome shows a long-press
  // image menu via the contextmenu event — preventing it at the document
  // catches it no matter which element gets the touch.
  useEffect(() => {
    if (!cropMode) return;
    const onCtx = (e: Event) => e.preventDefault();
    document.addEventListener('contextmenu', onCtx);
    return () => document.removeEventListener('contextmenu', onCtx);
  }, [cropMode]);

  const textbooks = useQuery(api.textbooks.list);
  const allUnitMeta = useQuery(api.unitMetadata.list);
  const allExercises = useQuery(api.exercises.list);

  const unitInfo = useMemo(() => findUnit(unitId), [unitId]);
  const unitNumber = useMemo(
    () => (unitInfo ? extractUnitNumber(unitInfo.unit.name) : 0),
    [unitInfo],
  );

  const textbook = useMemo(() => {
    if (!unitInfo || !textbooks) return null;
    return (
      textbooks.find(
        (t) =>
          t.grade === unitInfo.grade &&
          t.startUnit != null &&
          t.endUnit != null &&
          unitNumber >= t.startUnit &&
          unitNumber <= t.endUnit,
      ) ?? null
    );
  }, [unitInfo, textbooks, unitNumber]);

  const meta = useMemo(
    () => allUnitMeta?.find((m) => m.unitId === unitId),
    [allUnitMeta, unitId],
  );

  const exercise = useMemo(
    () =>
      isFastMode && allExercises
        ? allExercises.find((e) => e._id === exerciseId) ?? null
        : null,
    [isFastMode, exerciseId, allExercises],
  );

  // Resolve the page range to render. In fast mode prefer the exercise's
  // own pageNumber..pageNumberEnd; fall back to the unit's range when the
  // exercise has no per-row range set yet.
  const pageStart =
    isFastMode
      ? exercise?.pageNumber ?? meta?.startPage
      : meta?.startPage;
  const pageEnd =
    isFastMode
      ? exercise?.pageNumberEnd ?? exercise?.pageNumber ?? meta?.endPage
      : meta?.endPage;

  const unitPages = useQuery(
    api.textbookPages.getPagesInRange,
    textbook && pageStart != null && pageEnd != null
      ? {
          textbookId: textbook._id as Id<'textbooks'>,
          startPage: pageStart,
          endPage: pageEnd,
        }
      : 'skip',
  );

  const pageIdsForQuery = useMemo<Id<'textbookPages'>[]>(
    () =>
      (unitPages || [])
        .map((p) => (p as { pageId?: Id<'textbookPages'> | null }).pageId)
        .filter((id): id is Id<'textbookPages'> => !!id),
    [unitPages],
  );

  const pageCrops = useQuery(
    api.questionBank.listByPages,
    pageIdsForQuery.length > 0
      ? { textbookPageIds: pageIdsForQuery }
      : 'skip',
  );

  type PageCrop = NonNullable<typeof pageCrops>[number];
  const cropsByPage = useMemo(() => {
    const map = new Map<string, PageCrop[]>();
    if (!pageCrops) return map;
    for (const c of pageCrops) {
      if (!c.textbookPageId) continue;
      const arr = map.get(c.textbookPageId) || [];
      arr.push(c);
      map.set(c.textbookPageId, arr);
    }
    return map;
  }, [pageCrops]);

  // In fast mode, only show crops linked to this exercise to reduce noise.
  // Other crops on the same page (e.g. linked to a neighbouring exercise)
  // would distract from the active question.
  const cropsByPageFiltered = useMemo(() => {
    if (!isFastMode || !exerciseId) return cropsByPage;
    const map = new Map<string, PageCrop[]>();
    for (const [k, v] of cropsByPage) {
      map.set(
        k,
        v.filter((c) => c.linkedExerciseId === exerciseId),
      );
    }
    return map;
  }, [cropsByPage, isFastMode, exerciseId]);

  const unitExercises = useMemo(
    () =>
      (allExercises || [])
        .filter((e) => e.unitId === unitId)
        .sort((a, b) => a.order - b.order),
    [allExercises, unitId],
  );

  // ─── Fast-mode key state ──────────────────────────────────────
  const allKeys = useMemo(() => {
    if (!exercise) return [];
    return generateCropKeys(
      exercise.questionCount,
      exercise.subQuestions as SubQuestionsMap | undefined,
    );
  }, [exercise]);

  const existingKeysForExercise = useMemo(() => {
    if (!isFastMode || !exerciseId) return [] as string[];
    return (pageCrops || [])
      .filter((c) => c.linkedExerciseId === exerciseId && c.linkedQuestionKey)
      .map((c) => c.linkedQuestionKey as string);
  }, [pageCrops, isFastMode, exerciseId]);

  // currentKey = whichever question key the next draw / re-key targets.
  // We split it into:
  //   - `userKey`: explicit selection (pill tap, post-save advance, post-
  //     re-key) — only ever set in event handlers, never in effects.
  //   - `resumedKey`: derived from data — the highest already-cropped key
  //     plus one, so the user resumes where they left off without having
  //     to tap anything when the page loads.
  // currentKey is the union: the user's choice wins once they make one,
  // otherwise we fall back to the resume hint. No effect needed.
  const [userKey, setUserKey] = useState<string | null>(null);
  const resumedKey = useMemo<string | null>(() => {
    if (!isFastMode) return null;
    if (!exercise) return null;
    if (!pageCrops) return null;
    if (allKeys.length === 0) return null;
    return resumeCropKey(allKeys, existingKeysForExercise);
  }, [isFastMode, exercise, pageCrops, allKeys, existingKeysForExercise]);
  const currentKey = userKey ?? resumedKey;

  const [selectedCropId, setSelectedCropId] = useState<
    Id<'questionBank'> | null
  >(null);

  // ─── Mutations for fast-mode save / re-key ────────────────────
  const createMut = useMutation(api.questionBank.create);
  const updateMut = useMutation(api.questionBank.update);

  const handleFastDraw = useCallback(
    async (pageId: Id<'textbookPages'>, box: CropBox) => {
      if (!isFastMode || !exerciseId) return;
      if (!currentKey) {
        toast.error('Pick a question first');
        return;
      }
      try {
        await createMut({
          source: 'textbook',
          textbookPageId: pageId,
          cropBox: box,
          linkedExerciseId: exerciseId,
          linkedQuestionKey: currentKey,
        });
        // Drawing always exits any re-key selection.
        setSelectedCropId(null);
        const next = nextCropKey(currentKey, allKeys);
        if (next) setUserKey(next);
      } catch (err) {
        console.error(err);
        toast.error('Could not save crop');
      }
    },
    [isFastMode, exerciseId, currentKey, allKeys, createMut],
  );

  const handleCropTap = useCallback(
    (cropId: Id<'questionBank'>) => {
      const c = (pageCrops || []).find((x) => x._id === cropId);
      if (!c) return;
      setSelectedCropId(cropId);
      if (c.linkedQuestionKey) setUserKey(c.linkedQuestionKey);
    },
    [pageCrops],
  );

  const handlePillTap = useCallback(
    async (key: string) => {
      if (selectedCropId && exerciseId) {
        // Re-key the selected crop in place.
        try {
          await updateMut({
            id: selectedCropId,
            linkedExerciseId: exerciseId,
            linkedQuestionKey: key,
          });
          setSelectedCropId(null);
          setUserKey(key);
        } catch (err) {
          console.error(err);
          toast.error('Could not re-key');
        }
      } else {
        setUserKey(key);
      }
    },
    [selectedCropId, exerciseId, updateMut],
  );

  const cropLabelFor = useCallback(
    (c: { linkedQuestionKey?: string }) =>
      c.linkedQuestionKey ? `Q${c.linkedQuestionKey}` : 'unlinked',
    [],
  );

  // ─── Scroll-position persistence ──────────────────────────────
  // Keyed by unitId + exerciseId so unit-level "see all" and per-exercise
  // views each remember their own scroll positions independently.
  const scrollKey = `crop.scroll.${unitId}.${exerciseIdParam ?? 'all'}`;
  // Save on scroll, debounced via rAF.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    let pending = false;
    const onScroll = () => {
      if (pending) return;
      pending = true;
      requestAnimationFrame(() => {
        pending = false;
        try {
          window.sessionStorage.setItem(scrollKey, String(window.scrollY));
        } catch {
          // ignore quota errors
        }
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [scrollKey]);

  // Restore once pages have rendered. We wait for unitPages to resolve so
  // the document is tall enough to actually scroll to.
  const didRestoreScroll = useRef(false);
  useEffect(() => {
    if (didRestoreScroll.current) return;
    if (!unitPages || unitPages.length === 0) return;
    if (typeof window === 'undefined') return;
    const raw = window.sessionStorage.getItem(scrollKey);
    if (!raw) {
      didRestoreScroll.current = true;
      return;
    }
    const y = parseInt(raw, 10);
    if (isNaN(y)) {
      didRestoreScroll.current = true;
      return;
    }
    didRestoreScroll.current = true;
    // Two rAFs so layout (page aspect ratios) settles before we jump.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => window.scrollTo(0, y));
    });
  }, [unitPages, scrollKey]);

  // ── Render ───────────────────────────────────────────────
  if (!unitInfo) {
    return (
      <div className="px-4 pt-5 pb-6 max-w-lg mx-auto">
        <p className="text-sm text-muted-foreground">Unknown unit.</p>
      </div>
    );
  }

  if (!textbooks || !allUnitMeta || !allExercises) {
    return (
      <div className="px-4 pt-5 pb-6 max-w-lg mx-auto">
        <div className="animate-pulse h-12 bg-muted rounded-xl mb-3" />
        {[1, 2, 3].map((i) => (
          <div key={i} className="animate-pulse h-72 bg-muted rounded-xl mb-3" />
        ))}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Sticky header */}
      <div className="sticky top-0 z-40 bg-background border-b border-border/50">
        <div className="max-w-lg mx-auto px-3 py-2.5 flex items-center gap-2">
          <button
            onClick={() => router.back()}
            className="w-9 h-9 rounded-xl flex items-center justify-center hover:bg-muted transition-colors shrink-0"
            aria-label="Back"
          >
            <ChevronLeft className="w-5 h-5 text-muted-foreground" />
          </button>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-foreground truncate">
              {isFastMode && exercise ? (
                <>Exercise {exercise.name}</>
              ) : (
                unitInfo.unit.name
              )}
            </p>
            {pageStart != null && pageEnd != null && (
              <p className="text-[11px] text-muted-foreground">
                pp. {pageStart}–{pageEnd}
                {isFastMode && exercise && (
                  <>
                    {' · '}
                    <span className="text-muted-foreground/80">
                      {exercise.questionCount} Qs
                    </span>
                  </>
                )}
              </p>
            )}
          </div>
          <Button
            variant={cropMode ? 'default' : 'outline'}
            size="sm"
            className="gap-1.5 shrink-0"
            onClick={() => setCropMode((m) => !m)}
            disabled={pageStart == null || pageEnd == null}
          >
            <Scissors className="w-3.5 h-3.5" />
            {cropMode ? 'Done' : 'Crop'}
          </Button>
        </div>

        {/* Fast-mode pill header — main-Q grid + sub-letter pills */}
        {isFastMode && cropMode && exercise && allKeys.length > 0 && (
          <PillHeader
            exercise={exercise}
            currentKey={currentKey}
            selectedCropId={selectedCropId}
            existingKeys={existingKeysForExercise}
            onPickKey={handlePillTap}
            onCancelSelection={() => setSelectedCropId(null)}
          />
        )}
      </div>

      {/* Body */}
      <div className="flex-1 max-w-lg mx-auto w-full px-3 py-3">
        {pageStart == null || pageEnd == null ? (
          <p className="text-sm text-muted-foreground text-center py-12">
            {isFastMode
              ? 'Set the page range for this exercise first (Details tab).'
              : 'Set the page range for this unit in Data Entry → Page Nos first.'}
          </p>
        ) : !textbook ? (
          <p className="text-sm text-muted-foreground text-center py-12">
            No textbook found for grade {unitInfo.grade}.
          </p>
        ) : !unitPages ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="w-full aspect-[3/4] bg-muted rounded-lg animate-pulse" />
            ))}
          </div>
        ) : (
          <>
            {!isFastMode && cropMode && (
              <div className="mb-3 px-3 py-2 rounded-lg bg-primary/10 border border-primary/30 text-xs text-primary flex items-start gap-2">
                <Scissors className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>
                  Drag across a question to crop it. Tap a saved crop to link
                  it to an exercise.
                </span>
              </div>
            )}

            <div className="space-y-3">
              {unitPages.map((pg) => {
                const pageId =
                  (pg as { pageId?: Id<'textbookPages'> | null }).pageId ?? null;
                return (
                  <PageCropOverlay
                    key={pageId ?? `np-${pg.pageNumber}`}
                    pageId={pageId}
                    pageNumber={pg.pageNumber}
                    imageUrl={pg.url}
                    cropMode={cropMode}
                    crops={
                      pageId ? cropsByPageFiltered.get(pageId) || [] : []
                    }
                    unitExercises={unitExercises}
                    onDrawComplete={
                      isFastMode && pageId
                        ? (box) => handleFastDraw(pageId, box)
                        : undefined
                    }
                    onCropTap={isFastMode ? handleCropTap : undefined}
                    selectedCropId={isFastMode ? selectedCropId : null}
                    cropLabelFor={isFastMode ? cropLabelFor : undefined}
                  />
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Pill header ────────────────────────────────────────────
// Two-row picker: first row = main-Q numbers, second row = sub-letters of
// the currently-selected main-Q (or just "Stem" if it has no sub-parts).
// Bigger touch targets, current target highlighted, existing-cropped keys
// shown with a small dot so the user knows what's already done.

function PillHeader({
  exercise,
  currentKey,
  selectedCropId,
  existingKeys,
  onPickKey,
  onCancelSelection,
}: {
  exercise: {
    _id: Id<'exercises'>;
    questionCount: number;
    subQuestions?: SubQuestionsMap;
  };
  currentKey: string | null;
  selectedCropId: Id<'questionBank'> | null;
  existingKeys: string[];
  onPickKey: (key: string) => void;
  onCancelSelection: () => void;
}) {
  const parsed = currentKey ? parseCropKey(currentKey) : null;
  const activeMainQ = parsed?.mainQ ?? 0;
  const subDef = exercise.subQuestions?.[String(activeMainQ)];
  const hasSubs = !!subDef && subDef.count > 1;
  const existingSet = useMemo(() => new Set(existingKeys), [existingKeys]);

  const mainBtn = (q: number) => {
    const isActive = activeMainQ === q;
    const stemKey = String(q);
    const stemDone = existingSet.has(stemKey);
    return (
      <button
        key={q}
        onClick={() => onPickKey(stemKey)}
        className={`relative h-9 min-w-[36px] px-2 rounded-lg text-sm font-mono font-bold transition-all active:scale-95 ${
          isActive
            ? 'bg-primary text-primary-foreground shadow-sm'
            : 'bg-muted text-foreground hover:bg-muted/70'
        }`}
      >
        {q}
        {stemDone && (
          <span
            className={`absolute top-1 right-1 w-1.5 h-1.5 rounded-full ${
              isActive ? 'bg-primary-foreground/70' : 'bg-emerald-500'
            }`}
          />
        )}
      </button>
    );
  };

  const subBtn = (label: string, key: string) => {
    const isActive = currentKey === key;
    const done = existingSet.has(key);
    return (
      <button
        key={key}
        onClick={() => onPickKey(key)}
        className={`relative h-8 min-w-[34px] px-2 rounded-lg text-xs font-mono font-semibold transition-all active:scale-95 ${
          isActive
            ? 'bg-primary text-primary-foreground shadow-sm'
            : 'bg-muted text-foreground hover:bg-muted/70'
        }`}
      >
        {label}
        {done && (
          <span
            className={`absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full ${
              isActive ? 'bg-primary-foreground/70' : 'bg-emerald-500'
            }`}
          />
        )}
      </button>
    );
  };

  const stemKey = String(activeMainQ);
  const stemActive = currentKey === stemKey;
  const stemDone = existingSet.has(stemKey);

  return (
    <div className="max-w-lg mx-auto px-3 pb-2.5 space-y-1.5">
      {/* Status strip — what the next draw will create / re-key */}
      <div
        className={`flex items-center gap-2 text-[11px] rounded-md px-2 py-1 ${
          selectedCropId
            ? 'bg-sky-500/15 text-sky-400 border border-sky-500/40'
            : 'bg-primary/10 text-primary border border-primary/30'
        }`}
      >
        {selectedCropId ? (
          <>
            <span className="font-medium">Re-key selected →</span>
            <span className="font-mono font-bold">
              {currentKey ?? '—'}
            </span>
            <span className="opacity-60">tap a pill to re-link</span>
            <button
              onClick={onCancelSelection}
              className="ml-auto w-5 h-5 rounded flex items-center justify-center hover:bg-sky-500/20"
              aria-label="Cancel selection"
            >
              <X className="w-3 h-3" />
            </button>
          </>
        ) : (
          <>
            <span className="font-medium">Cropping →</span>
            <span className="font-mono font-bold text-base">
              {currentKey ?? '—'}
            </span>
            <span className="opacity-60 ml-auto">drag on a page</span>
          </>
        )}
      </div>

      {/* Main-Q row */}
      <div className="flex flex-wrap gap-1">
        {Array.from({ length: exercise.questionCount }, (_, i) => i + 1).map(
          mainBtn,
        )}
      </div>

      {/* Sub-letter row (or just Stem) */}
      <div className="flex flex-wrap gap-1 items-center">
        <button
          onClick={() => onPickKey(stemKey)}
          disabled={!activeMainQ}
          className={`relative h-8 px-2.5 rounded-lg text-xs font-semibold transition-all active:scale-95 ${
            !activeMainQ
              ? 'bg-muted/40 text-muted-foreground/50 cursor-not-allowed'
              : stemActive
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'bg-muted text-foreground hover:bg-muted/70'
          }`}
        >
          {hasSubs ? 'Stem' : 'Whole'}
          {stemDone && activeMainQ > 0 && (
            <span
              className={`absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full ${
                stemActive ? 'bg-primary-foreground/70' : 'bg-emerald-500'
              }`}
            />
          )}
        </button>
        {hasSubs && (
          <>
            <span className="text-[10px] text-muted-foreground/60 mx-0.5">
              ·
            </span>
            {Array.from({ length: subDef.count }, (_, i) => {
              const label = getSubLabel(i, subDef.type);
              const key = `${activeMainQ}.${label}`;
              return subBtn(label, key);
            })}
          </>
        )}
      </div>
    </div>
  );
}
