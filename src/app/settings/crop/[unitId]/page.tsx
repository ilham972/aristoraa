'use client';

import { useEffect, useMemo, useState, useRef, useCallback } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useMutation } from 'convex/react';
import { ChevronLeft } from 'lucide-react';
import { api } from '@/lib/convex';
import type { Id } from '@/lib/convex';
import { findUnit, extractUnitNumber } from '@/lib/curriculum-data';
import { PageCropOverlay } from '@/components/settings/page-crop-overlay';
import { CropPillHeader } from '@/components/settings/crop-pill-header';
import { ZoomedPageView } from '@/components/settings/zoomed-page-view';
import {
  CropToolToolbar,
  type CropTool,
} from '@/components/settings/crop-tool-toolbar';
import {
  generateCropKeys,
  resumeCropKey,
  nextCropKey,
} from '@/lib/crop-keys';
import type { SubQuestionsMap } from '@/lib/sub-questions';
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
  // Optional URL params: ?key=2.a pre-selects that key in fast-mode;
  // ?flash=<cropId> scrolls to and briefly highlights the named crop
  // (used by the Details-tab dots / capture grid for deep-linking).
  const keyParam = searchParams.get('key');
  const flashParamRaw = searchParams.get('flash');
  const flashCropId = flashParamRaw
    ? (flashParamRaw as Id<'questionBank'>)
    : null;

  // Active editing tool. The page boots in `crop` so the user lands ready
  // to draw the next question — the most common entry point. Two-finger
  // pinch / pan works in every tool, while `resize` and `delete` operate on
  // existing crops independently.
  const [tool, setTool] = useState<CropTool>('crop');

  // Document-level contextmenu blocker. Android Chrome shows a long-press
  // image menu via the contextmenu event — preventing it at the document
  // catches it no matter which element gets the touch.
  useEffect(() => {
    const onCtx = (e: Event) => e.preventDefault();
    document.addEventListener('contextmenu', onCtx);
    return () => document.removeEventListener('contextmenu', onCtx);
  }, []);

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
  const [selectedPageNumber, setSelectedPageNumber] = useState<number | null>(
    null,
  );

  useEffect(() => {
    if (!isFastMode) return;
    if (!unitPages || unitPages.length === 0) return;
    if (
      selectedPageNumber != null &&
      unitPages.some((p) => p.pageNumber === selectedPageNumber)
    ) {
      return;
    }
    setSelectedPageNumber(unitPages[0].pageNumber);
  }, [isFastMode, unitPages, selectedPageNumber]);

  const selectedFastPage = useMemo(() => {
    if (!isFastMode || !unitPages || unitPages.length === 0) return null;
    return (
      unitPages.find((p) => p.pageNumber === selectedPageNumber) ??
      unitPages[0]
    );
  }, [isFastMode, unitPages, selectedPageNumber]);

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
  // If `?key=` is in the URL it wins over the resume hint — the user
  // arrived from a specific slot in the Details capture grid.
  const initialKeyFromUrl = useMemo<string | null>(() => {
    if (!isFastMode || !keyParam) return null;
    if (allKeys.length === 0) return null;
    return allKeys.includes(keyParam) ? keyParam : null;
  }, [isFastMode, keyParam, allKeys]);
  const resumedKey = useMemo<string | null>(() => {
    if (!isFastMode) return null;
    if (!exercise) return null;
    if (!pageCrops) return null;
    if (allKeys.length === 0) return null;
    return resumeCropKey(allKeys, existingKeysForExercise);
  }, [isFastMode, exercise, pageCrops, allKeys, existingKeysForExercise]);
  const currentKey = userKey ?? initialKeyFromUrl ?? resumedKey;

  const [selectedCropId, setSelectedCropId] = useState<
    Id<'questionBank'> | null
  >(null);

  // Full-screen zoom view state. When a pageId is set we render the modal
  // ZoomedPageView over the scrolling list; the modal owns its own pinch /
  // pan / crop gesture handling.
  const [zoomState, setZoomState] = useState<{
    pageId: Id<'textbookPages'>;
    pageNumber: number;
    imageUrl: string;
    naturalAspect: number | null;
  } | null>(null);

  // ─── Mutations for fast-mode save / re-key ────────────────────
  const updateMut = useMutation(api.questionBank.update);
  const removeMut = useMutation(api.questionBank.remove);
  // Strict 1:1 (exercise, key) → crop. Server enforces by overwriting any
  // existing crop at that key on draw, and by deleting duplicates on
  // re-key. The legacy create/update path could produce duplicates
  // (different pages, race conditions) — these mutations make that
  // structurally impossible.
  const upsertForKeyMut = useMutation(api.questionBank.upsertForExerciseKey);
  const rekeyMut = useMutation(api.questionBank.rekeyToExerciseKey);

  // Most-recently-touched crop (drawn or tapped). Used so when the user
  // switches into Resize mode without explicitly tapping a rect, we can
  // pre-select whatever they last interacted with — the friction-removing
  // flow they asked for.
  const lastTouchedCropIdRef = useRef<Id<'questionBank'> | null>(null);

  const handleFastDraw = useCallback(
    async (pageId: Id<'textbookPages'>, box: CropBox) => {
      if (!isFastMode || !exerciseId) return;
      if (!currentKey) {
        toast.error('Pick a question first');
        return;
      }
      try {
        // 1:1 invariant — server overwrites any existing crop at this
        // (exercise, key) and removes duplicates so re-drawing a question
        // simply replaces the old box.
        const id = await upsertForKeyMut({
          linkedExerciseId: exerciseId,
          linkedQuestionKey: currentKey,
          textbookPageId: pageId,
          cropBox: box,
        });
        lastTouchedCropIdRef.current = id as Id<'questionBank'>;
        // Drawing always exits any re-key selection.
        setSelectedCropId(null);
        const next = nextCropKey(currentKey, allKeys);
        if (next) setUserKey(next);
      } catch (err) {
        console.error(err);
        toast.error('Could not save crop');
      }
    },
    [isFastMode, exerciseId, currentKey, allKeys, upsertForKeyMut],
  );

  const handleCropTap = useCallback(
    (cropId: Id<'questionBank'>) => {
      const c = (pageCrops || []).find((x) => x._id === cropId);
      if (!c) return;
      setSelectedCropId(cropId);
      lastTouchedCropIdRef.current = cropId;
      if (c.linkedQuestionKey) setUserKey(c.linkedQuestionKey);
    },
    [pageCrops],
  );

  // Tool-change handler: switching into Resize mode auto-selects whichever
  // crop was last drawn or tapped, so the user gets handles immediately
  // without a separate select-step. Other transitions are pure mode swaps.
  const handleToolChange = useCallback(
    (next: CropTool) => {
      setTool(next);
      if (next === 'resize') {
        // Default to the last-touched crop if nothing is currently selected
        // and that crop still exists in the live list (it may have been
        // deleted before we get here).
        setSelectedCropId((cur) => {
          if (cur) return cur;
          const fallback = lastTouchedCropIdRef.current;
          if (!fallback) return null;
          const stillExists = (pageCrops || []).some(
            (c) => c._id === fallback,
          );
          return stillExists ? fallback : null;
        });
      } else if (next === 'crop') {
        // Leaving select-style modes: clear the highlight so the next
        // pill-tap doesn't accidentally re-key a previously-selected crop.
        setSelectedCropId(null);
      }
    },
    [pageCrops],
  );

  // Shared delete handler — used by the zoom view's red X. The inline
  // overlay already runs its own delete via the X button it renders.
  const handleCropDelete = useCallback(
    async (cropId: Id<'questionBank'>) => {
      try {
        await removeMut({ id: cropId });
        setSelectedCropId((cur) => (cur === cropId ? null : cur));
        if (lastTouchedCropIdRef.current === cropId) {
          lastTouchedCropIdRef.current = null;
        }
      } catch (err) {
        console.error(err);
        toast.error('Could not delete');
      }
    },
    [removeMut],
  );

  const handlePillTap = useCallback(
    async (key: string) => {
      if (selectedCropId && exerciseId) {
        // Re-key the selected crop in place. Server-side, any other crop
        // already at the target (exercise, key) is deleted to keep the
        // 1:1 invariant.
        try {
          await rekeyMut({
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
    [selectedCropId, exerciseId, rekeyMut],
  );

  const cropLabelFor = useCallback(
    (c: { linkedQuestionKey?: string }) =>
      c.linkedQuestionKey ? c.linkedQuestionKey : 'unlinked',
    [],
  );

  // ─── Flash-on-arrival ────────────────────────────────────────
  // Initialised from `?flash=`. Cleared after ~2.5s so the pulse stops.
  // Kept in state (not derived from the URL) so we can drop it without
  // forcing a navigation that would also clobber `?key=` and `?exerciseId=`.
  const [liveFlashCropId, setLiveFlashCropId] = useState<Id<'questionBank'> | null>(
    flashCropId,
  );
  useEffect(() => {
    setLiveFlashCropId(flashCropId);
  }, [flashCropId]);
  useEffect(() => {
    if (!liveFlashCropId) return;
    const t = window.setTimeout(() => setLiveFlashCropId(null), 2500);
    return () => window.clearTimeout(t);
  }, [liveFlashCropId]);

  // Once pages and crops are loaded, reveal the matching crop. Fast mode
  // swaps to that page; unit mode keeps the older scroll-to-rect behaviour.
  const didFlashScroll = useRef(false);
  useEffect(() => {
    if (didFlashScroll.current) return;
    if (!flashCropId) return;
    if (!pageCrops || !unitPages) return;
    const crop = pageCrops.find((c) => c._id === flashCropId);
    if (!crop?.textbookPageId) {
      didFlashScroll.current = true;
      return;
    }
    didFlashScroll.current = true;
    if (isFastMode) {
      const page = unitPages.find(
        (p) =>
          (p as { pageId?: Id<'textbookPages'> | null }).pageId ===
          crop.textbookPageId,
      );
      if (page) setSelectedPageNumber(page.pageNumber);
      return;
    }
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const el = document.querySelector(
          `[data-page-id="${crop.textbookPageId}"]`,
        );
        el?.scrollIntoView({ behavior: 'auto', block: 'center' });
      });
    });
  }, [flashCropId, pageCrops, unitPages, isFastMode]);

  // ─── Scroll-position persistence ──────────────────────────────
  // Keyed by unitId + exerciseId so unit-level "see all" and per-exercise
  // views each remember their own scroll positions independently.
  const scrollKey = `crop.scroll.${unitId}.${exerciseIdParam ?? 'all'}`;
  // Save on scroll, debounced via rAF.
  useEffect(() => {
    if (isFastMode) return;
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
  }, [scrollKey, isFastMode]);

  // Restore once pages have rendered. We wait for unitPages to resolve so
  // the document is tall enough to actually scroll to. If a `?flash=` was
  // requested, that effect handles scrolling instead — skip the restore so
  // we don't fight it.
  const didRestoreScroll = useRef(false);
  useEffect(() => {
    if (isFastMode) return;
    if (didRestoreScroll.current) return;
    if (flashCropId) {
      didRestoreScroll.current = true;
      return;
    }
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
  }, [unitPages, scrollKey, flashCropId, isFastMode]);

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
        </div>

        {/* Tool toolbar — independent Crop / Resize / Delete modes.
            Two-finger zoom works in all of them, so no separate Adjust tool
            is needed. Always visible so the user can swap tools without
            entering or leaving a single "crop mode". */}
        <div className="max-w-lg mx-auto px-3 pb-2 flex justify-center">
          <CropToolToolbar
            tool={tool}
            onChange={handleToolChange}
            disabled={pageStart == null || pageEnd == null}
          />
        </div>

        {/* Fast-mode pill header — main-Q grid + sub-letter pills. */}
        {isFastMode && exercise && allKeys.length > 0 && (
          <CropPillHeader
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
            {isFastMode && selectedFastPage ? (
              <div className="space-y-2">
                {(() => {
                  const pageId =
                    (
                      selectedFastPage as {
                        pageId?: Id<'textbookPages'> | null;
                      }
                    ).pageId ?? null;
                  return (
                    <PageCropOverlay
                      key={pageId ?? `np-${selectedFastPage.pageNumber}`}
                      pageId={pageId}
                      pageNumber={selectedFastPage.pageNumber}
                      imageUrl={selectedFastPage.url}
                      tool={tool}
                      crops={pageId ? cropsByPageFiltered.get(pageId) || [] : []}
                      unitExercises={unitExercises}
                      onDrawComplete={
                        pageId ? (box) => handleFastDraw(pageId, box) : undefined
                      }
                      onCropTap={handleCropTap}
                      selectedCropId={selectedCropId}
                      cropLabelFor={cropLabelFor}
                      flashCropId={liveFlashCropId}
                      onZoom={
                        pageId && selectedFastPage.url
                          ? (id, na) =>
                              setZoomState({
                                pageId: id,
                                pageNumber: selectedFastPage.pageNumber,
                                imageUrl: selectedFastPage.url!,
                                naturalAspect: na,
                              })
                          : undefined
                      }
                    />
                  );
                })()}
                <div className="flex justify-center">
                  <div
                    className="flex bg-muted rounded-lg p-0.5 gap-0.5"
                    aria-label="Page selector"
                  >
                    {unitPages.map((pg) => {
                      const active =
                        pg.pageNumber === selectedFastPage.pageNumber;
                      return (
                        <button
                          key={pg.pageNumber}
                          type="button"
                          onClick={() => {
                            setSelectedPageNumber(pg.pageNumber);
                            setSelectedCropId(null);
                          }}
                          className={`h-8 min-w-[46px] px-2.5 rounded-md text-[11px] font-semibold transition-all active:scale-95 ${
                            active
                              ? 'bg-primary text-primary-foreground shadow-sm'
                              : 'text-muted-foreground hover:text-foreground hover:bg-background/70'
                          }`}
                          aria-current={active ? 'page' : undefined}
                          aria-label={`Page ${pg.pageNumber}`}
                        >
                          p. {pg.pageNumber}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                {unitPages.map((pg) => {
                  const pageId =
                    (pg as { pageId?: Id<'textbookPages'> | null }).pageId ??
                    null;
                  return (
                    <PageCropOverlay
                      key={pageId ?? `np-${pg.pageNumber}`}
                      pageId={pageId}
                      pageNumber={pg.pageNumber}
                      imageUrl={pg.url}
                      tool={tool}
                      crops={pageId ? cropsByPageFiltered.get(pageId) || [] : []}
                      unitExercises={unitExercises}
                      onDrawComplete={undefined}
                      onCropTap={undefined}
                      selectedCropId={null}
                      cropLabelFor={undefined}
                      flashCropId={liveFlashCropId}
                      onZoom={
                        pageId && pg.url
                          ? (id, na) =>
                              setZoomState({
                                pageId: id,
                                pageNumber: pg.pageNumber,
                                imageUrl: pg.url!,
                                naturalAspect: na,
                              })
                          : undefined
                      }
                    />
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>

      {/* Full-screen zoom view — mounted on top when the user taps a
          page's zoom icon. Crops save through the same fast-mode handlers
          so cropping inside the zoom view is identical to the inline view. */}
      {zoomState && (
        <ZoomedPageView
          pageId={zoomState.pageId}
          pageNumber={zoomState.pageNumber}
          imageUrl={zoomState.imageUrl}
          naturalAspect={zoomState.naturalAspect ?? undefined}
          crops={cropsByPageFiltered.get(zoomState.pageId) || []}
          cropLabelFor={isFastMode ? cropLabelFor : undefined}
          selectedCropId={isFastMode ? selectedCropId : null}
          flashCropId={liveFlashCropId}
          tool={tool}
          onToolChange={handleToolChange}
          onClose={() => setZoomState(null)}
          onDrawComplete={
            isFastMode
              ? (box) => handleFastDraw(zoomState.pageId, box)
              : undefined
          }
          onCropTap={isFastMode ? handleCropTap : undefined}
          onCropResize={async (cropId, box) => {
            try {
              await updateMut({ id: cropId, cropBox: box });
            } catch (err) {
              console.error(err);
              toast.error('Could not resize');
            }
          }}
          onCropDelete={handleCropDelete}
          pillHeader={
            isFastMode && exercise && allKeys.length > 0 ? (
              <CropPillHeader
                exercise={exercise}
                currentKey={currentKey}
                selectedCropId={selectedCropId}
                existingKeys={existingKeysForExercise}
                onPickKey={handlePillTap}
                onCancelSelection={() => setSelectedCropId(null)}
              />
            ) : undefined
          }
        />
      )}
    </div>
  );
}
