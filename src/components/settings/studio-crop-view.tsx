'use client';

// ─── Details Studio — crop mode ─────────────────────────────────────────────
// The per-exercise fast-crop flow from /settings/crop, re-hosted inside the
// Details Studio tab so cropping never costs a route hop. Same mechanics and
// the same components (PageCropOverlay / CropPillHeader / ZoomedPageView), the
// same 1:1 (exercise, key) → crop invariant, and the same resume-where-you-
// left-off key logic. The one addition: when the last key of an exercise is
// drawn, `onExerciseComplete` fires so the shell can slide to the next
// exercise without the user navigating anywhere.
//
// Split into a hook plus two dumb components because the shell renders the
// page area and the key pills in different places (pages in the viewer, pills
// down in the thumb-reach entry bar).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useMutation } from 'convex/react';
import { toast } from 'sonner';
import { api } from '@/lib/convex';
import type { Id } from '@/lib/convex';
import { PageCropOverlay } from '@/components/settings/page-crop-overlay';
import { CropPillHeader } from '@/components/settings/crop-pill-header';
import { ZoomedPageView } from '@/components/settings/zoomed-page-view';
import { CropToolToolbar, type CropTool } from '@/components/settings/crop-tool-toolbar';
import { generateCropKeys, nextCropKey, resumeCropKey } from '@/lib/crop-keys';
import { getSubLabel, type SubQuestionsMap } from '@/lib/sub-questions';

type CropBox = { x: number; y: number; w: number; h: number };

export interface StudioCropExercise {
  _id: Id<'exercises'>;
  name: string;
  questionCount: number;
  pageNumber?: number;
  pageNumberEnd?: number;
  subQuestions?: SubQuestionsMap;
}

interface UnitExercise {
  _id: Id<'exercises'>;
  name: string;
  questionCount: number;
  type?: string;
  order: number;
}

export function useStudioCrop({
  exercise,
  unitExercises,
  textbookId,
  unitStartPage,
  unitEndPage,
  onExerciseComplete,
}: {
  exercise: StudioCropExercise | null;
  unitExercises: UnitExercise[];
  textbookId: Id<'textbooks'> | null;
  unitStartPage?: number;
  unitEndPage?: number;
  onExerciseComplete: () => void;
}) {
  const [tool, setTool] = useState<CropTool>('crop');
  const [badgesInside, setBadgesInside] = useState(false);
  const [selectedPageNumber, setSelectedPageNumber] = useState<number | null>(null);
  const [userKey, setUserKey] = useState<string | null>(null);
  const [selectedCropId, setSelectedCropId] = useState<Id<'questionBank'> | null>(null);
  const [zoomState, setZoomState] = useState<{
    pageId: Id<'textbookPages'>;
    pageNumber: number;
    imageUrl: string;
    naturalAspect: number | null;
  } | null>(null);

  // Page range: the exercise's own range when set, else the whole unit — the
  // same fallback the crop route uses.
  const pageStart = exercise?.pageNumber ?? unitStartPage;
  const pageEnd = exercise?.pageNumberEnd ?? exercise?.pageNumber ?? unitEndPage;

  const pages = useQuery(
    api.textbookPages.getPagesInRange,
    textbookId && pageStart != null && pageEnd != null
      ? { textbookId, startPage: pageStart, endPage: pageEnd }
      : 'skip',
  );

  // Switching exercise resets the per-exercise editing state so the resume
  // hint (below) recomputes for the newly-selected exercise.
  const lastExerciseId = useRef<string | null>(null);
  useEffect(() => {
    const id = exercise?._id ?? null;
    if (lastExerciseId.current === id) return;
    lastExerciseId.current = id;
    setUserKey(null);
    setSelectedCropId(null);
    setSelectedPageNumber(null);
    setZoomState(null);
  }, [exercise?._id]);

  useEffect(() => {
    if (!pages || pages.length === 0) return;
    if (selectedPageNumber != null && pages.some(p => p.pageNumber === selectedPageNumber)) {
      return;
    }
    setSelectedPageNumber(pages[0].pageNumber);
  }, [pages, selectedPageNumber]);

  const selectedPage = useMemo(() => {
    if (!pages || pages.length === 0) return null;
    return pages.find(p => p.pageNumber === selectedPageNumber) ?? pages[0];
  }, [pages, selectedPageNumber]);

  const pageIds = useMemo<Id<'textbookPages'>[]>(
    () =>
      (pages || [])
        .map(p => (p as { pageId?: Id<'textbookPages'> | null }).pageId)
        .filter((id): id is Id<'textbookPages'> => !!id),
    [pages],
  );

  const pageCrops = useQuery(
    api.questionBank.listByPages,
    pageIds.length > 0 ? { textbookPageIds: pageIds } : 'skip',
  );

  // Red rects flag crops still missing a concept tag or difficulty rating.
  const cropIdList = useMemo(
    () => (pageCrops ?? []).map(c => c._id).sort() as Id<'questionBank'>[],
    [pageCrops],
  );
  const completenessRows = useQuery(
    api.learningEngine.difficultyTab.getCompletenessForCrops,
    cropIdList.length > 0 ? { cropIds: cropIdList } : 'skip',
  );
  const incompleteCropIds = useMemo(() => {
    const s = new Set<string>();
    for (const r of completenessRows ?? []) {
      if (!r.hasConcept || !r.hasDifficulty) s.add(r.cropId as string);
    }
    return s;
  }, [completenessRows]);
  const isCropIncomplete = useCallback(
    (c: { _id: Id<'questionBank'> }) => incompleteCropIds.has(c._id as string),
    [incompleteCropIds],
  );

  // Only this exercise's crops render, so a neighbouring exercise's boxes on
  // the same page don't distract.
  const cropsForSelectedPage = useMemo(() => {
    const pageId = (selectedPage as { pageId?: Id<'textbookPages'> | null } | null)?.pageId;
    if (!pageId || !pageCrops || !exercise) return [];
    return pageCrops.filter(
      c => c.textbookPageId === pageId && c.linkedExerciseId === exercise._id,
    );
  }, [selectedPage, pageCrops, exercise]);

  const allKeys = useMemo(
    () => (exercise ? generateCropKeys(exercise.questionCount, exercise.subQuestions) : []),
    [exercise],
  );

  const existingKeys = useMemo(() => {
    if (!exercise) return [] as string[];
    return (pageCrops || [])
      .filter(c => c.linkedExerciseId === exercise._id && c.linkedQuestionKey)
      .map(c => c.linkedQuestionKey as string);
  }, [pageCrops, exercise]);

  const resumedKey = useMemo(() => {
    if (!exercise || !pageCrops || allKeys.length === 0) return null;
    return resumeCropKey(allKeys, existingKeys);
  }, [exercise, pageCrops, allKeys, existingKeys]);

  const currentKey = userKey ?? resumedKey;

  const upsertForKeyMut = useMutation(api.questionBank.upsertForExerciseKey);
  const updateMut = useMutation(api.questionBank.update);
  const removeMut = useMutation(api.questionBank.remove);
  const setSubQuestionsMut = useMutation(api.exercises.setSubQuestions);

  const handleDraw = useCallback(
    async (pageId: Id<'textbookPages'>, box: CropBox) => {
      if (!exercise) return;
      if (!currentKey) {
        toast.error('Pick a question first');
        return;
      }
      try {
        await upsertForKeyMut({
          linkedExerciseId: exercise._id,
          linkedQuestionKey: currentKey,
          textbookPageId: pageId,
          cropBox: box,
        });
        setSelectedCropId(null);
        const next = nextCropKey(currentKey, allKeys);
        if (next) {
          setUserKey(next);
        } else {
          // Last key of this exercise — hand off to the shell, which selects
          // the next exercise that still has uncropped questions.
          toast.success(`Exercise ${exercise.name} fully cropped`);
          onExerciseComplete();
        }
      } catch (err) {
        console.error('[studio upsertForExerciseKey]', err);
        toast.error(err instanceof Error ? err.message : 'Could not save crop');
      }
    },
    [exercise, currentKey, allKeys, upsertForKeyMut, onExerciseComplete],
  );

  // Tapping a rect selects it (and syncs the pills to its key); it never
  // re-keys, matching the crop route's behaviour.
  const handleCropTap = useCallback(
    (cropId: Id<'questionBank'>) => {
      const c = (pageCrops || []).find(x => x._id === cropId);
      if (!c) return;
      setSelectedCropId(cropId);
      if (c.linkedQuestionKey) setUserKey(c.linkedQuestionKey);
    },
    [pageCrops],
  );

  const handlePickKey = useCallback(
    (key: string) => {
      setUserKey(key);
      const crop = (pageCrops || []).find(
        c => c.linkedExerciseId === exercise?._id && c.linkedQuestionKey === key,
      );
      setSelectedCropId(crop?._id ?? null);
      // Follow the key to whichever page its crop lives on.
      if (crop?.textbookPageId && pages) {
        const pg = pages.find(
          p => (p as { pageId?: Id<'textbookPages'> | null }).pageId === crop.textbookPageId,
        );
        if (pg) setSelectedPageNumber(pg.pageNumber);
      }
    },
    [pageCrops, exercise?._id, pages],
  );

  const handleDelete = useCallback(
    async (cropId: Id<'questionBank'>) => {
      try {
        await removeMut({ id: cropId });
        setSelectedCropId(cur => (cur === cropId ? null : cur));
      } catch (err) {
        console.error('[studio crop delete]', err);
        toast.error('Could not delete');
      }
    },
    [removeMut],
  );

  const handleResize = useCallback(
    async (cropId: Id<'questionBank'>, box: CropBox) => {
      try {
        await updateMut({ id: cropId, cropBox: box });
      } catch (err) {
        console.error('[studio crop resize]', err);
        toast.error('Could not resize');
      }
    },
    [updateMut],
  );

  // "No sub-stem": the active sub-part has no instruction of its own, so its
  // level-3 leaves borrow the main-Q stem. Any orphaned sub-stem crop is
  // removed so it can't linger as an unrenderable row.
  const handleToggleNoSubStem = useCallback(
    async (mainQ: number, subIndex: number, next: boolean) => {
      if (!exercise) return;
      const current = (exercise.subQuestions ?? {}) as SubQuestionsMap;
      const qKey = String(mainQ);
      const subDef = current[qKey];
      const ss = subDef?.subSub?.[String(subIndex)];
      if (!subDef || !ss) return;
      const nextSubSub = { ...(subDef.subSub ?? {}) };
      nextSubSub[String(subIndex)] = { ...ss, noStem: next ? true : undefined };
      try {
        await setSubQuestionsMut({
          id: exercise._id,
          subQuestions: { ...current, [qKey]: { ...subDef, subSub: nextSubSub } },
        });
        if (next) {
          const subStemKey = `${mainQ}.${getSubLabel(subIndex, subDef.type)}`;
          const orphan = (pageCrops || []).find(
            c => c.linkedExerciseId === exercise._id && c.linkedQuestionKey === subStemKey,
          );
          if (orphan) await removeMut({ id: orphan._id });
        }
        toast.success(next ? 'Marked: no sub-stem' : 'Sub-stem re-enabled');
      } catch (err) {
        console.error('[studio setSubQuestions noStem]', err);
        toast.error('Could not update sub-stem setting');
      }
    },
    [exercise, pageCrops, setSubQuestionsMut, removeMut],
  );

  return {
    exercise,
    unitExercises,
    pages,
    selectedPage,
    setSelectedPageNumber,
    pageStart,
    pageEnd,
    tool,
    setTool: (t: CropTool) => {
      setTool(t);
      if (t === 'crop') setSelectedCropId(null);
    },
    badgesInside,
    toggleBadgesInside: () => setBadgesInside(b => !b),
    allKeys,
    existingKeys,
    currentKey,
    selectedCropId,
    setSelectedCropId,
    cropsForSelectedPage,
    isCropIncomplete,
    zoomState,
    setZoomState,
    handleDraw,
    handleCropTap,
    handlePickKey,
    handleDelete,
    handleResize,
    handleToggleNoSubStem,
  };
}

export type StudioCrop = ReturnType<typeof useStudioCrop>;

// ─── Page area ────────────────────────────────────────────────────────────
export function StudioCropPages({ crop }: { crop: StudioCrop }) {
  const { exercise, selectedPage, pages, pageStart, pageEnd } = crop;

  if (!exercise) return null;

  if (pageStart == null || pageEnd == null) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-muted/20 px-4 py-10 text-center">
        <p className="text-xs text-muted-foreground">
          Set a page range for this exercise first — use From / To in the bar below.
        </p>
      </div>
    );
  }

  if (!pages) {
    return <div className="rounded-xl bg-muted animate-pulse aspect-[3/4]" />;
  }

  if (!selectedPage) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-muted/20 px-4 py-10 text-center">
        <p className="text-xs text-muted-foreground">
          No pages uploaded for pp. {pageStart}–{pageEnd} yet.
        </p>
      </div>
    );
  }

  const pageId =
    (selectedPage as { pageId?: Id<'textbookPages'> | null }).pageId ?? null;

  return (
    <div className="space-y-2">
      <PageCropOverlay
        key={pageId ?? `np-${selectedPage.pageNumber}`}
        pageId={pageId}
        pageNumber={selectedPage.pageNumber}
        imageUrl={selectedPage.url}
        tool={crop.tool}
        crops={crop.cropsForSelectedPage}
        unitExercises={crop.unitExercises}
        onDrawComplete={pageId ? box => crop.handleDraw(pageId, box) : undefined}
        onCropTap={crop.handleCropTap}
        selectedCropId={crop.selectedCropId}
        cropLabelFor={c => c.linkedQuestionKey ?? 'unlinked'}
        badgesInside={crop.badgesInside}
        isCropIncomplete={crop.isCropIncomplete}
        onZoom={
          pageId && selectedPage.url
            ? (id, na) =>
                crop.setZoomState({
                  pageId: id,
                  pageNumber: selectedPage.pageNumber,
                  imageUrl: selectedPage.url!,
                  naturalAspect: na,
                })
            : undefined
        }
      />

      {pages.length > 1 && (
        <div className="flex justify-center">
          <div className="flex bg-muted rounded-lg p-0.5 gap-0.5 overflow-x-auto no-scrollbar max-w-full">
            {pages.map(pg => {
              const active = pg.pageNumber === selectedPage.pageNumber;
              return (
                <button
                  key={pg.pageNumber}
                  onClick={() => {
                    crop.setSelectedPageNumber(pg.pageNumber);
                    crop.setSelectedCropId(null);
                  }}
                  aria-current={active ? 'page' : undefined}
                  className={`h-8 min-w-[46px] px-2.5 rounded-md text-[11px] font-semibold shrink-0 transition-all active:scale-95 ${
                    active
                      ? 'bg-primary text-primary-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground hover:bg-background/70'
                  }`}
                >
                  p. {pg.pageNumber}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {crop.zoomState && (
        <ZoomedPageView
          pageId={crop.zoomState.pageId}
          pageNumber={crop.zoomState.pageNumber}
          imageUrl={crop.zoomState.imageUrl}
          naturalAspect={crop.zoomState.naturalAspect ?? undefined}
          crops={crop.cropsForSelectedPage}
          cropLabelFor={c => c.linkedQuestionKey ?? 'unlinked'}
          selectedCropId={crop.selectedCropId}
          badgesInside={crop.badgesInside}
          onToggleBadgesInside={crop.toggleBadgesInside}
          isCropIncomplete={crop.isCropIncomplete}
          tool={crop.tool}
          onToolChange={crop.setTool}
          onClose={() => crop.setZoomState(null)}
          onDrawComplete={box => crop.handleDraw(crop.zoomState!.pageId, box)}
          onCropTap={crop.handleCropTap}
          onCropResize={crop.handleResize}
          onCropDelete={crop.handleDelete}
          pillHeader={<StudioCropControls crop={crop} />}
        />
      )}
    </div>
  );
}

// ─── Key pills + tools (rendered inside the sticky entry bar) ─────────────
export function StudioCropControls({ crop }: { crop: StudioCrop }) {
  const { exercise } = crop;
  if (!exercise || crop.allKeys.length === 0) return null;
  return (
    <div className="space-y-1.5">
      <div className="flex justify-center">
        <CropToolToolbar
          tool={crop.tool}
          onChange={crop.setTool}
          badgesInside={crop.badgesInside}
          onToggleBadgesInside={crop.toggleBadgesInside}
        />
      </div>
      <div className="-mx-3 max-h-[28vh] overflow-y-auto no-scrollbar">
        <CropPillHeader
          exercise={exercise}
          currentKey={crop.currentKey}
          selectedCropId={crop.selectedCropId}
          existingKeys={crop.existingKeys}
          onPickKey={crop.handlePickKey}
          onCancelSelection={() => crop.setSelectedCropId(null)}
          onToggleNoSubStem={crop.handleToggleNoSubStem}
        />
      </div>
    </div>
  );
}
