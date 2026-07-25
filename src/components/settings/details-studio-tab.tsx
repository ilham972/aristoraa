'use client';

// ─── Settings → "Details" (Studio) tab ──────────────────────────────────────
// A one-screen rebuild of the Data Entry → Details layer, modelled on the Book
// tab: the book stays on screen, everything is a tap, and cropping happens
// right here instead of behind a route hop.
//
//   book badges → unit pills → exercise/theory pills → viewer → sticky bar
//
// Browse mode shows the unit's pages (pinch-zoom, current-page badge) and the
// bar logs page range / question count / sub-parts / theory rows. Crop mode
// swaps the viewer for the fast-crop surface and the bar for the question-key
// pills, auto-advancing key by key and then exercise by exercise.
//
// This tab is ADDITIVE: the original Data Entry tab and /settings/crop route
// are untouched and remain the stable path until the founder retires them.
// The selected-book key is shared with them on purpose.

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useQuery, useMutation } from 'convex/react';
import { Maximize2, Minimize2, Trash2, BookOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { api } from '@/lib/convex';
import type { Id } from '@/lib/convex';
import { toast } from 'sonner';
import { getUnitsForBook } from '@/lib/curriculum-data';
import { useNavVisibility } from '@/contexts/nav-visibility';
import { generateCropKeys } from '@/lib/crop-keys';
import type { SubQuestionsMap } from '@/lib/sub-questions';
import { StudioEntryBar, type StudioMode } from '@/components/settings/studio-entry-bar';
import {
  useStudioCrop,
  StudioCropPages,
  StudioCropControls,
} from '@/components/settings/studio-crop-view';

const SS_BOOK = 'dataEntry.selectedBookId'; // shared with Book / Data Entry tabs
const SS_UNIT = 'detailsStudio.unitId';
const SS_EXERCISE = 'detailsStudio.exerciseId';
const SS_MODE = 'detailsStudio.mode';

interface BookUnit {
  id: string;
  name: string;
  number: number;
  moduleId: string;
  term: number;
}

type ExerciseRow = {
  _id: Id<'exercises'>;
  unitId: string;
  name: string;
  order: number;
  questionCount: number;
  type?: string;
  pageNumber?: number;
  pageNumberEnd?: number;
  subQuestions?: SubQuestionsMap;
};

type TheoryDialogState = {
  editingId: Id<'exercises'> | null;
  afterOrder: number;
  name: string;
  startPage: string;
  endPage: string;
};

export function DetailsStudioTab() {
  const { setHideBottomNav } = useNavVisibility();

  const textbooks = useQuery(api.textbooks.list);
  const allExercises = useQuery(api.exercises.list);
  const allUnitMeta = useQuery(api.unitMetadata.list);

  const updateQcMutation = useMutation(api.exercises.updateQuestionCount);
  const updatePageMutation = useMutation(api.exercises.updatePageNumber);
  const setSubQuestionsMutation = useMutation(api.exercises.setSubQuestions);
  const addConceptMutation = useMutation(api.exercises.addConcept);
  const renameConceptMutation = useMutation(api.exercises.renameConcept);
  const removeExMutation = useMutation(api.exercises.remove);

  const [selectedBookId, setSelectedBookId] = useState<string | null>(() =>
    typeof window === 'undefined' ? null : window.sessionStorage.getItem(SS_BOOK),
  );
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(() =>
    typeof window === 'undefined' ? null : window.sessionStorage.getItem(SS_UNIT),
  );
  const [selectedExerciseId, setSelectedExerciseId] = useState<string | null>(() =>
    typeof window === 'undefined' ? null : window.sessionStorage.getItem(SS_EXERCISE),
  );
  const [mode, setMode] = useState<StudioMode>(() => {
    if (typeof window === 'undefined') return 'browse';
    return window.sessionStorage.getItem(SS_MODE) === 'crop' ? 'crop' : 'browse';
  });
  const [fullscreen, setFullscreen] = useState(false);
  const [theoryDialog, setTheoryDialog] = useState<TheoryDialogState | null>(null);

  // ── Persist selection so leaving and returning lands in the same place ──
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (selectedBookId) window.sessionStorage.setItem(SS_BOOK, selectedBookId);
  }, [selectedBookId]);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (selectedUnitId) window.sessionStorage.setItem(SS_UNIT, selectedUnitId);
    else window.sessionStorage.removeItem(SS_UNIT);
  }, [selectedUnitId]);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (selectedExerciseId) window.sessionStorage.setItem(SS_EXERCISE, selectedExerciseId);
    else window.sessionStorage.removeItem(SS_EXERCISE);
  }, [selectedExerciseId]);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.sessionStorage.setItem(SS_MODE, mode);
  }, [mode]);

  // Full-screen focus mode — same contract as the Book tab.
  useEffect(() => {
    setHideBottomNav(fullscreen);
    document.body.style.overflow = fullscreen ? 'hidden' : '';
    return () => {
      setHideBottomNav(false);
      document.body.style.overflow = '';
    };
  }, [fullscreen, setHideBottomNav]);

  const selectedBook = textbooks?.find(t => t._id === selectedBookId) ?? null;

  const bookUnits = useMemo<BookUnit[]>(() => {
    if (!selectedBook?.startUnit || !selectedBook?.endUnit) return [];
    return getUnitsForBook(selectedBook.grade, selectedBook.startUnit, selectedBook.endUnit);
  }, [selectedBook]);

  const selectedUnit = useMemo(
    () => bookUnits.find(u => u.id === selectedUnitId) ?? null,
    [bookUnits, selectedUnitId],
  );

  const unitMeta = useMemo(
    () => allUnitMeta?.find(m => m.unitId === selectedUnit?.id) ?? null,
    [allUnitMeta, selectedUnit],
  );

  // Items of the selected unit, in book order: exercises and theory rows.
  const unitItems = useMemo<ExerciseRow[]>(
    () =>
      ((allExercises || []) as ExerciseRow[])
        .filter(e => e.unitId === selectedUnit?.id)
        .sort((a, b) => a.order - b.order),
    [allExercises, selectedUnit],
  );

  const unitExercises = useMemo(
    () => unitItems.filter(e => (e.type || 'exercise') === 'exercise'),
    [unitItems],
  );

  const selectedExercise = useMemo(
    () => unitExercises.find(e => e._id === selectedExerciseId) ?? null,
    [unitExercises, selectedExerciseId],
  );

  // ── Crop coverage for every exercise in the unit ──
  const unitExerciseIds = useMemo(() => unitExercises.map(e => e._id), [unitExercises]);
  const unitCrops = useQuery(
    api.questionBank.listByLinkedExercises,
    unitExerciseIds.length > 0 ? { exerciseIds: unitExerciseIds } : 'skip',
  );

  const keysByExercise = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const c of unitCrops || []) {
      if (!c.linkedExerciseId || !c.linkedQuestionKey) continue;
      const set = m.get(c.linkedExerciseId) || new Set<string>();
      set.add(c.linkedQuestionKey);
      m.set(c.linkedExerciseId, set);
    }
    return m;
  }, [unitCrops]);

  const progressFor = useCallback(
    (ex: ExerciseRow) => {
      const total = generateCropKeys(ex.questionCount, ex.subQuestions).length;
      const done = keysByExercise.get(ex._id);
      const captured = done
        ? generateCropKeys(ex.questionCount, ex.subQuestions).filter(k => done.has(k)).length
        : 0;
      return { captured, total };
    },
    [keysByExercise],
  );

  const isExerciseComplete = useCallback(
    (ex: ExerciseRow) => {
      const { captured, total } = progressFor(ex);
      return total > 0 && captured === total;
    },
    [progressFor],
  );

  // ── Default selection: first unit that still needs work, then its first
  // incomplete exercise. Runs once per book. ──
  const initBookRef = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedBook || bookUnits.length === 0 || !allExercises) return;
    if (initBookRef.current === selectedBook._id) return;
    initBookRef.current = selectedBook._id;
    if (selectedUnitId && bookUnits.some(u => u.id === selectedUnitId)) return;
    const exercisesByUnit = new Map<string, ExerciseRow[]>();
    for (const e of allExercises as ExerciseRow[]) {
      if ((e.type || 'exercise') !== 'exercise') continue;
      const arr = exercisesByUnit.get(e.unitId) || [];
      arr.push(e);
      exercisesByUnit.set(e.unitId, arr);
    }
    const firstIncomplete =
      bookUnits.find(u => {
        const exs = exercisesByUnit.get(u.id) || [];
        return exs.length === 0 || exs.some(e => !isExerciseComplete(e));
      }) ?? bookUnits[0];
    setSelectedUnitId(firstIncomplete.id);
    setSelectedExerciseId(null);
  }, [selectedBook, bookUnits, allExercises, selectedUnitId, isExerciseComplete]);

  // Keep a valid exercise selected whenever the unit's items change.
  useEffect(() => {
    if (unitExercises.length === 0) {
      if (selectedExerciseId !== null) setSelectedExerciseId(null);
      return;
    }
    if (selectedExerciseId && unitExercises.some(e => e._id === selectedExerciseId)) return;
    const next = unitExercises.find(e => !isExerciseComplete(e)) ?? unitExercises[0];
    setSelectedExerciseId(next._id);
  }, [unitExercises, selectedExerciseId, isExerciseComplete]);

  // Cropping needs a question count; fall back to browse if it's missing.
  useEffect(() => {
    if (mode === 'crop' && selectedExercise && selectedExercise.questionCount === 0) {
      setMode('browse');
    }
  }, [mode, selectedExercise]);

  // Keep the selected pills in view.
  const unitStripRef = useRef<HTMLDivElement | null>(null);
  const itemStripRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!selectedUnitId) return;
    unitStripRef.current
      ?.querySelector(`[data-studio-unit="${CSS.escape(selectedUnitId)}"]`)
      ?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }, [selectedUnitId]);
  useEffect(() => {
    if (!selectedExerciseId) return;
    itemStripRef.current
      ?.querySelector(`[data-studio-item="${CSS.escape(selectedExerciseId)}"]`)
      ?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }, [selectedExerciseId]);

  // ── Browse viewer: the unit's pages, pinch-zoomable, with the page you're
  // looking at tracked for the Mark buttons (same heuristic as the Book tab). ──
  const smallPages = useQuery(
    api.textbookPages.listSmallPages,
    selectedBook ? { textbookId: selectedBook._id } : 'skip',
  );

  const browsePages = useMemo(() => {
    if (!smallPages) return null;
    const start = unitMeta?.startPage;
    const end = unitMeta?.endPage;
    if (start == null || end == null) return smallPages;
    return smallPages.filter(p => p.pageNumber >= start && p.pageNumber <= end);
  }, [smallPages, unitMeta]);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const scaleRef = useRef(1);
  const [scale, setScale] = useState(1);
  const [currentPage, setCurrentPage] = useState<number | null>(null);

  useEffect(() => {
    scaleRef.current = scale;
  }, [scale]);

  // Jump the browse viewer to the selected exercise's start page.
  useEffect(() => {
    if (mode !== 'browse') return;
    const target = selectedExercise?.pageNumber;
    if (target == null) return;
    const el = scrollRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      const pageEl = el.querySelector<HTMLElement>(`[data-studio-page="${target}"]`);
      if (pageEl) el.scrollTo({ top: pageEl.offsetTop - 8, behavior: 'auto' });
    });
  }, [mode, selectedExercise?._id, selectedExercise?.pageNumber, browsePages]);

  useEffect(() => {
    if (mode !== 'browse') return;
    const el = scrollRef.current;
    if (!el || !browsePages || browsePages.length === 0) return;

    const updateCurrentPage = () => {
      const pageEls = Array.from(el.querySelectorAll<HTMLElement>('[data-studio-page]'));
      if (pageEls.length === 0) return;
      const reference = el.getBoundingClientRect().top + el.clientHeight * 0.38;
      let bestPage = Number(pageEls[0].dataset.studioPage);
      let bestDistance = Number.POSITIVE_INFINITY;
      for (const pageEl of pageEls) {
        const d = Math.abs(pageEl.getBoundingClientRect().top - reference);
        if (d < bestDistance) {
          bestDistance = d;
          bestPage = Number(pageEl.dataset.studioPage);
        }
      }
      if (!Number.isNaN(bestPage)) setCurrentPage(bestPage);
    };

    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(updateCurrentPage);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    raf = requestAnimationFrame(updateCurrentPage);
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener('scroll', onScroll);
    };
  }, [mode, browsePages]);

  // Two-finger pinch zoom on the browse viewer.
  useEffect(() => {
    if (mode !== 'browse') return;
    const el = scrollRef.current;
    if (!el) return;

    const distance = (a: Touch, b: Touch) =>
      Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);

    let pinch:
      | {
          startDist: number;
          startScale: number;
          centerX: number;
          centerY: number;
          contentX: number;
          contentY: number;
        }
      | null = null;

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 2) return;
      const rect = el.getBoundingClientRect();
      const [t1, t2] = [e.touches[0], e.touches[1]];
      const centerX = (t1.clientX + t2.clientX) / 2 - rect.left;
      const centerY = (t1.clientY + t2.clientY) / 2 - rect.top;
      const startScale = scaleRef.current;
      pinch = {
        startDist: distance(t1, t2),
        startScale,
        centerX,
        centerY,
        contentX: (el.scrollLeft + centerX) / startScale,
        contentY: (el.scrollTop + centerY) / startScale,
      };
      e.preventDefault();
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!pinch || e.touches.length !== 2) return;
      const [t1, t2] = [e.touches[0], e.touches[1]];
      const nextScale = Math.max(
        1,
        Math.min(4, pinch.startScale * (distance(t1, t2) / pinch.startDist)),
      );
      scaleRef.current = nextScale;
      setScale(nextScale);
      el.scrollLeft = pinch.contentX * nextScale - pinch.centerX;
      el.scrollTop = pinch.contentY * nextScale - pinch.centerY;
      e.preventDefault();
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) pinch = null;
    };

    el.addEventListener('touchstart', onTouchStart, { passive: false });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd);
    el.addEventListener('touchcancel', onTouchEnd);
    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [mode]);

  // ── Auto-advance: last key of an exercise drawn → next exercise that still
  // has uncropped questions, in this unit, then in the next units. ──
  const handleExerciseComplete = useCallback(() => {
    if (!selectedExercise) return;
    const idx = unitExercises.findIndex(e => e._id === selectedExercise._id);
    const nextInUnit = unitExercises
      .slice(idx + 1)
      .find(e => e.questionCount > 0 && !isExerciseComplete(e));
    if (nextInUnit) {
      setSelectedExerciseId(nextInUnit._id);
      return;
    }
    const unitIdx = bookUnits.findIndex(u => u.id === selectedUnit?.id);
    const byUnit = new Map<string, ExerciseRow[]>();
    for (const e of (allExercises || []) as ExerciseRow[]) {
      if ((e.type || 'exercise') !== 'exercise') continue;
      const arr = byUnit.get(e.unitId) || [];
      arr.push(e);
      byUnit.set(e.unitId, arr);
    }
    const nextUnit = bookUnits
      .slice(unitIdx + 1)
      .find(u => (byUnit.get(u.id) || []).some(e => !isExerciseComplete(e)));
    if (nextUnit) {
      setSelectedUnitId(nextUnit.id);
      setSelectedExerciseId(null);
      toast.success(`Moving to ${nextUnit.name}`);
      return;
    }
    toast.success('Every exercise in this book is cropped 🎉');
    setMode('browse');
  }, [selectedExercise, unitExercises, isExerciseComplete, bookUnits, selectedUnit, allExercises]);

  const crop = useStudioCrop({
    exercise: mode === 'crop' ? selectedExercise : null,
    unitExercises,
    textbookId: selectedBook?._id ?? null,
    unitStartPage: unitMeta?.startPage,
    unitEndPage: unitMeta?.endPage,
    onExerciseComplete: handleExerciseComplete,
  });

  // ── Mutation handlers ──
  const handleSavePages = useCallback(
    async (start: number, end: number | undefined) => {
      if (!selectedExercise) return;
      try {
        await updatePageMutation({ id: selectedExercise._id, pageNumber: start, pageNumberEnd: end });
      } catch (err) {
        console.error('[studio updatePageNumber]', err);
        toast.error('Could not save the page range');
      }
    },
    [selectedExercise, updatePageMutation],
  );

  const handleSaveCount = useCallback(
    async (count: number) => {
      if (!selectedExercise) return;
      try {
        await updateQcMutation({ id: selectedExercise._id, questionCount: count });
      } catch (err) {
        console.error('[studio updateQuestionCount]', err);
        toast.error('Could not save the question count');
      }
    },
    [selectedExercise, updateQcMutation],
  );

  const handleSaveSubQ = useCallback(
    async (map: SubQuestionsMap | null) => {
      if (!selectedExercise) return;
      try {
        await setSubQuestionsMutation({ id: selectedExercise._id, subQuestions: map });
      } catch (err) {
        console.error('[studio setSubQuestions]', err);
        toast.error(err instanceof Error ? err.message : 'Could not save sub-questions');
        throw err;
      }
    },
    [selectedExercise, setSubQuestionsMutation],
  );

  const handleSaveTheory = useCallback(async () => {
    if (!theoryDialog || !selectedUnit) return;
    const name = theoryDialog.name.trim();
    if (!name) return;
    const start = parseInt(theoryDialog.startPage, 10);
    const end = theoryDialog.endPage.trim() ? parseInt(theoryDialog.endPage, 10) : undefined;
    try {
      let id: Id<'exercises'> | null = theoryDialog.editingId;
      if (id) {
        await renameConceptMutation({ id, name });
      } else {
        id = await addConceptMutation({
          unitId: selectedUnit.id,
          name,
          afterOrder: theoryDialog.afterOrder,
        });
      }
      if (id && !isNaN(start) && start >= 1 && (end === undefined || end >= start)) {
        await updatePageMutation({ id, pageNumber: start, pageNumberEnd: end });
      }
      toast.success(theoryDialog.editingId ? 'Theory updated' : 'Theory added');
      setTheoryDialog(null);
    } catch (err) {
      console.error('[studio save theory]', err);
      toast.error('Could not save the theory row');
    }
  }, [theoryDialog, selectedUnit, renameConceptMutation, addConceptMutation, updatePageMutation]);

  const handleDeleteTheory = useCallback(async () => {
    if (!theoryDialog?.editingId) return;
    if (!confirm('Delete this theory row?')) return;
    try {
      await removeExMutation({ id: theoryDialog.editingId });
      toast.success('Deleted');
      setTheoryDialog(null);
    } catch (err) {
      console.error('[studio delete theory]', err);
      toast.error('Could not delete');
    }
  }, [theoryDialog, removeExMutation]);

  // ── Loading ──
  if (!textbooks || !allExercises || !allUnitMeta) {
    return (
      <div className="animate-pulse space-y-2">
        {[1, 2, 3].map(i => (
          <div key={i} className="h-20 bg-muted rounded-xl" />
        ))}
      </div>
    );
  }

  const sortedBooks = [...textbooks].sort((a, b) => a.grade - b.grade || a.part - b.part);
  const contentStyle = { zoom: scale } as CSSProperties & { zoom: number };

  return (
    <div
      className={
        fullscreen
          ? 'fixed inset-0 z-50 bg-background flex flex-col px-3 pb-2 pt-[calc(env(safe-area-inset-top)+8px)]'
          : ''
      }
    >
      {/* ─── Book badges + full-screen toggle ─── */}
      <div className="flex items-start gap-2 mb-2 shrink-0">
        <div className="flex gap-2 overflow-x-auto no-scrollbar flex-1 pb-1">
          {sortedBooks.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No books yet. Create them in the Content tab.
            </p>
          )}
          {sortedBooks.map(book => {
            const isSelected = book._id === selectedBookId;
            const hasRange = book.startUnit != null && book.endUnit != null;
            return (
              <button
                key={book._id}
                onClick={() => {
                  if (!hasRange) {
                    toast.error('Set the unit range in the Content tab first');
                    return;
                  }
                  setSelectedBookId(book._id);
                  setSelectedUnitId(null);
                  setSelectedExerciseId(null);
                  setMode('browse');
                  initBookRef.current = null;
                }}
                className={`shrink-0 px-3 py-2 rounded-xl text-xs font-medium transition-all border ${
                  isSelected
                    ? 'bg-primary text-primary-foreground border-primary'
                    : hasRange
                      ? 'bg-card border-border hover:border-primary/30'
                      : 'bg-muted/50 border-border/30 opacity-50'
                }`}
              >
                <div>G{book.grade} · P{book.part}</div>
                <div
                  className={`text-[10px] ${
                    isSelected ? 'text-primary-foreground/70' : 'text-muted-foreground'
                  }`}
                >
                  {hasRange ? `Units ${book.startUnit}–${book.endUnit}` : 'No range'}
                </div>
              </button>
            );
          })}
        </div>
        <button
          onClick={() => setFullscreen(f => !f)}
          aria-label={fullscreen ? 'Exit full screen' : 'Full screen'}
          className="w-9 h-9 rounded-xl border border-border bg-card flex items-center justify-center text-muted-foreground hover:text-foreground hover:border-primary/30 transition-all active:scale-95 shrink-0"
        >
          {fullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
        </button>
      </div>

      {!selectedBook ? (
        <p className="text-sm text-muted-foreground text-center py-8">Select a book to start</p>
      ) : bookUnits.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">
          No units found for this book&apos;s range
        </p>
      ) : (
        <>
          {/* ─── Unit pills ─── */}
          <div ref={unitStripRef} className="flex gap-1.5 overflow-x-auto no-scrollbar pb-1.5 mb-1.5 shrink-0">
            {bookUnits.map(unit => {
              const exs = ((allExercises || []) as ExerciseRow[]).filter(
                e => e.unitId === unit.id && (e.type || 'exercise') === 'exercise',
              );
              const complete = exs.length > 0 && exs.every(e => isExerciseComplete(e));
              const started = exs.some(e => e.questionCount > 0);
              const isSelected = unit.id === selectedUnitId;
              return (
                <button
                  key={unit.id}
                  data-studio-unit={unit.id}
                  title={unit.name}
                  onClick={() => {
                    setSelectedUnitId(unit.id);
                    setSelectedExerciseId(null);
                    setMode('browse');
                  }}
                  className={`shrink-0 min-w-[42px] px-2 py-1.5 rounded-xl border text-center transition-all active:scale-95 ${
                    complete
                      ? 'bg-emerald-500/15 border-emerald-500/40'
                      : started
                        ? 'bg-amber-500/15 border-amber-500/40'
                        : 'bg-card border-border/50'
                  } ${isSelected ? 'ring-2 ring-primary' : ''}`}
                >
                  <div
                    className={`text-sm font-bold leading-none ${
                      complete ? 'text-emerald-400' : 'text-foreground'
                    }`}
                  >
                    {unit.number}
                  </div>
                </button>
              );
            })}
          </div>

          {/* ─── Exercise + theory pills ─── */}
          <div ref={itemStripRef} className="flex gap-1.5 overflow-x-auto no-scrollbar pb-2 mb-2 shrink-0">
            {unitItems.length === 0 && (
              <p className="text-xs text-muted-foreground py-2">
                No exercises in this unit yet — add them in the Book tab.
              </p>
            )}
            {unitItems.map(item => {
              if ((item.type || 'exercise') === 'concept') {
                return (
                  <button
                    key={item._id}
                    data-studio-item={item._id}
                    title={item.name}
                    onClick={() =>
                      setTheoryDialog({
                        editingId: item._id,
                        afterOrder: item.order,
                        name: item.name,
                        startPage: item.pageNumber != null ? String(item.pageNumber) : '',
                        endPage: item.pageNumberEnd != null ? String(item.pageNumberEnd) : '',
                      })
                    }
                    className="shrink-0 max-w-[110px] px-2.5 py-1.5 rounded-xl border border-primary/30 bg-primary/10 text-primary text-[11px] font-medium truncate transition-all active:scale-95"
                  >
                    {item.name}
                  </button>
                );
              }
              const { captured, total } = progressFor(item);
              const complete = total > 0 && captured === total;
              const isSelected = item._id === selectedExerciseId;
              return (
                <button
                  key={item._id}
                  data-studio-item={item._id}
                  onClick={() => setSelectedExerciseId(item._id)}
                  className={`shrink-0 min-w-[52px] px-2 py-1.5 rounded-xl border text-center transition-all active:scale-95 ${
                    complete
                      ? 'bg-emerald-500/15 border-emerald-500/40'
                      : captured > 0
                        ? 'bg-amber-500/15 border-amber-500/40'
                        : 'bg-card border-border/50'
                  } ${isSelected ? 'ring-2 ring-primary' : ''}`}
                >
                  <div
                    className={`text-xs font-mono font-bold leading-none ${
                      complete ? 'text-emerald-400' : 'text-foreground'
                    }`}
                  >
                    {item.name}
                  </div>
                  <div className="text-[9px] text-muted-foreground mt-1 leading-none">
                    {total > 0 ? `${captured}/${total}` : 'set Qs'}
                  </div>
                </button>
              );
            })}
          </div>

          {/* ─── Viewer ─── */}
          {mode === 'crop' ? (
            <div className={fullscreen ? 'flex-1 min-h-0 overflow-auto' : ''}>
              <StudioCropPages crop={crop} />
            </div>
          ) : (
            <div
              ref={scrollRef}
              className={`rounded-xl border border-border/50 bg-muted/30 overflow-auto overscroll-contain ${
                fullscreen ? 'flex-1 min-h-0' : 'h-[52vh] min-h-[300px]'
              }`}
              style={{ touchAction: 'pan-x pan-y' }}
            >
              {!browsePages ? (
                <div className="p-3 space-y-3">
                  {[1, 2].map(i => (
                    <div key={i} className="aspect-[5/7] rounded-lg bg-muted animate-pulse" />
                  ))}
                </div>
              ) : browsePages.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center px-6 text-center">
                  <BookOpen className="w-10 h-10 text-muted-foreground/30 mb-3" />
                  <p className="text-sm text-muted-foreground">
                    No pages uploaded for this range — upload them in the Content tab. You can
                    still type page numbers and counts below.
                  </p>
                </div>
              ) : (
                <>
                  <div className="sticky top-2 z-10 flex justify-end pr-2 -mb-7 pointer-events-none">
                    {currentPage != null && (
                      <span className="rounded-md bg-foreground/80 text-background text-[11px] font-mono px-1.5 py-0.5 shadow">
                        p. {currentPage}
                      </span>
                    )}
                  </div>
                  <div className="origin-top-left space-y-2 p-2" style={contentStyle}>
                    {browsePages.map(p => (
                      <div
                        key={p.pageNumber}
                        data-studio-page={p.pageNumber}
                        className="relative rounded-lg overflow-hidden border border-border/50 bg-background"
                      >
                        <div className="aspect-[5/7]">
                          {p.url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={p.url}
                              alt={`Page ${p.pageNumber}`}
                              loading="lazy"
                              decoding="async"
                              draggable={false}
                              className="w-full h-full object-contain select-none"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center">
                              <p className="text-xs text-muted-foreground">
                                Page {p.pageNumber} not uploaded
                              </p>
                            </div>
                          )}
                        </div>
                        <span className="absolute bottom-1 right-1 rounded bg-foreground/60 text-background text-[10px] font-mono px-1">
                          {p.pageNumber}
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {/* ─── Sticky entry bar ─── */}
          {selectedExercise && (
            <StudioEntryBar
              key={selectedExercise._id}
              exercise={selectedExercise}
              captured={progressFor(selectedExercise).captured}
              total={progressFor(selectedExercise).total}
              mode={mode}
              onModeChange={setMode}
              currentPage={currentPage}
              onSavePages={handleSavePages}
              onSaveCount={handleSaveCount}
              onSaveSubQ={handleSaveSubQ}
              onAddTheory={() =>
                setTheoryDialog({
                  editingId: null,
                  afterOrder: selectedExercise.order,
                  name: '',
                  startPage: currentPage != null ? String(currentPage) : '',
                  endPage: '',
                })
              }
              cropSlot={<StudioCropControls crop={crop} />}
              fullscreen={fullscreen}
            />
          )}
        </>
      )}

      {/* ─── Theory row dialog ─── */}
      <Dialog open={!!theoryDialog} onOpenChange={o => { if (!o) setTheoryDialog(null); }}>
        <DialogContent className="max-w-sm mx-auto">
          <DialogHeader>
            <DialogTitle>
              {theoryDialog?.editingId ? 'Edit theory' : 'Add theory'}
            </DialogTitle>
          </DialogHeader>
          {theoryDialog && (
            <div className="space-y-3">
              <Input
                value={theoryDialog.name}
                onChange={e =>
                  setTheoryDialog(d => (d ? { ...d, name: e.target.value } : d))
                }
                placeholder="Concept / theory name"
                autoFocus
              />
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  value={theoryDialog.startPage}
                  onChange={e =>
                    setTheoryDialog(d => (d ? { ...d, startPage: e.target.value } : d))
                  }
                  placeholder="from"
                  aria-label="Start page"
                  className="w-16 h-9 text-sm text-center font-mono px-1"
                />
                <span className="text-xs text-muted-foreground">–</span>
                <Input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  value={theoryDialog.endPage}
                  onChange={e =>
                    setTheoryDialog(d => (d ? { ...d, endPage: e.target.value } : d))
                  }
                  placeholder="to"
                  aria-label="End page"
                  className="w-16 h-9 text-sm text-center font-mono px-1"
                />
                {currentPage != null && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-9 text-xs"
                    onClick={() =>
                      setTheoryDialog(d => (d ? { ...d, startPage: String(currentPage) } : d))
                    }
                  >
                    p. {currentPage}
                  </Button>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  onClick={handleSaveTheory}
                  disabled={!theoryDialog.name.trim()}
                  className="flex-1 rounded-xl"
                >
                  {theoryDialog.editingId ? 'Save' : 'Add theory'}
                </Button>
                {theoryDialog.editingId && (
                  <button
                    onClick={handleDeleteTheory}
                    aria-label="Delete theory row"
                    className="w-10 h-10 rounded-xl flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
