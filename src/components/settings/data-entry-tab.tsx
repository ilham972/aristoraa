'use client';

import { useState, useMemo, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation } from 'convex/react';
import { ChevronLeft, Plus, Trash2, Scissors, List, BookOpen } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { getUnitsForBook } from '@/lib/curriculum-data';
import { api } from '@/lib/convex';
import type { Id } from '@/lib/convex';
import { toast } from 'sonner';
import { SubQuestionInline } from '@/components/sub-question-inline';
import { getSubLabel, type SubQuestionsMap } from '@/lib/sub-questions';
import { ConceptsUnitDrawer } from '@/components/settings/concepts-unit-drawer';

type Layer = 'exercises' | 'pages' | 'details' | 'concepts';

interface BookUnit {
  id: string;
  name: string;
  number: number;
  moduleId: string;
  term: number;
}

// ─── sessionStorage keys for restoring view state on back-navigation ───
const SS_BOOK = 'dataEntry.selectedBookId';
const SS_LAYER = 'dataEntry.activeLayer';
const SS_DETAIL = 'dataEntry.detailUnitId';

const isLayer = (v: string | null): v is Layer =>
  v === 'exercises' || v === 'pages' || v === 'details' || v === 'concepts';

export function DataEntryTab() {
  const router = useRouter();

  // === QUERIES ===
  const textbooks = useQuery(api.textbooks.list);
  const allExercises = useQuery(api.exercises.list);
  const allUnitMeta = useQuery(api.unitMetadata.list);

  // === MUTATIONS ===
  const bulkAddMutation = useMutation(api.exercises.bulkAdd);
  const trimMutation = useMutation(api.exercises.trimToCount);
  const setUnitPagesMutation = useMutation(api.unitMetadata.setPages);
  const addConceptMutation = useMutation(api.exercises.addConcept);
  const updateQcMutation = useMutation(api.exercises.updateQuestionCount);
  const updatePageMutation = useMutation(api.exercises.updatePageNumber);
  const removeExMutation = useMutation(api.exercises.remove);
  const setSubQuestionsMutation = useMutation(api.exercises.setSubQuestions);

  // === SELECTION STATE (lazy-init from sessionStorage so back-navigation
  // restores the same view) ===
  const [selectedBookId, setSelectedBookId] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    return window.sessionStorage.getItem(SS_BOOK);
  });
  const [activeLayer, setActiveLayer] = useState<Layer>(() => {
    if (typeof window === 'undefined') return 'exercises';
    const v = window.sessionStorage.getItem(SS_LAYER);
    return isLayer(v) ? v : 'exercises';
  });

  // === LAYER 1 — Exercise dialog ===
  const [exDialogUnit, setExDialogUnit] = useState<BookUnit | null>(null);
  const [reviewToggle, setReviewToggle] = useState(false);

  // === LAYER 2 — Page dialog ===
  const [pgDialogUnit, setPgDialogUnit] = useState<BookUnit | null>(null);
  const [pgStart, setPgStart] = useState('');
  const [pgEnd, setPgEnd] = useState('');

  // === LAYER 3 — Detail view ===
  // We hold the detail-unit *id* (not the BookUnit object) so it can be
  // restored synchronously from sessionStorage on mount; the resolved unit
  // is derived from `bookUnits` once the selected book's range is known.
  // Keeps the back-from-crop restore path purely derived — no setState in
  // effect when bookUnits arrive late.
  const [detailUnitId, setDetailUnitId] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    return window.sessionStorage.getItem(SS_DETAIL);
  });
  const [conceptDialogOpen, setConceptDialogOpen] = useState(false);
  const [conceptName, setConceptName] = useState('');
  const [conceptAfterOrder, setConceptAfterOrder] = useState(-1);

  // === Sub-question inline expansion ===
  const [expandedSubQId, setExpandedSubQId] = useState<Id<'exercises'> | null>(null);

  // === LAYER 4 — Concepts drawer ===
  const [conceptsDrawerUnit, setConceptsDrawerUnit] = useState<BookUnit | null>(null);

  // === DERIVED ===
  const selectedBook = textbooks?.find(t => t._id === selectedBookId);

  // ─── Persist selection state. SS keys are read on mount (lazy init above)
  // so back-navigation lands the user exactly where they left off. ───
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (selectedBookId) window.sessionStorage.setItem(SS_BOOK, selectedBookId);
    else window.sessionStorage.removeItem(SS_BOOK);
  }, [selectedBookId]);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.sessionStorage.setItem(SS_LAYER, activeLayer);
  }, [activeLayer]);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (detailUnitId) window.sessionStorage.setItem(SS_DETAIL, detailUnitId);
    else window.sessionStorage.removeItem(SS_DETAIL);
  }, [detailUnitId]);

  const bookUnits = useMemo(() => {
    if (!selectedBook?.startUnit || !selectedBook?.endUnit) return [];
    return getUnitsForBook(selectedBook.grade, selectedBook.startUnit, selectedBook.endUnit);
  }, [selectedBook]);

  // Resolve the persisted detail-unit id to its BookUnit object. Returns
  // null while the book is still loading or if the id no longer matches a
  // unit in the selected book. No effect needed — purely derived.
  const detailUnit = useMemo<BookUnit | null>(
    () =>
      detailUnitId ? bookUnits.find(b => b.id === detailUnitId) ?? null : null,
    [detailUnitId, bookUnits],
  );

  // === Crop counts per exercise (only loaded while in Details view) ===
  const detailExerciseIds = useMemo<Id<'exercises'>[]>(
    () =>
      detailUnit
        ? (allExercises || [])
            .filter(e => e.unitId === detailUnit.id && (e.type || 'exercise') === 'exercise')
            .map(e => e._id)
        : [],
    [detailUnit, allExercises],
  );

  const cropRows = useQuery(
    api.questionBank.listByLinkedExercises,
    detailExerciseIds.length > 0 ? { exerciseIds: detailExerciseIds } : 'skip',
  );

  const cropCountByExerciseId = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of cropRows || []) {
      if (!r.linkedExerciseId) continue;
      m.set(r.linkedExerciseId, (m.get(r.linkedExerciseId) || 0) + 1);
    }
    return m;
  }, [cropRows]);

  // Per-exercise: question-key → list of cropIds. Used by ExerciseCard to
  // render the at-a-glance dots row and the expanded capture grid, and to
  // deep-link into the crop route flashing the right rect.
  type CropRef = { _id: Id<'questionBank'>; key: string };
  const cropsByExerciseId = useMemo(() => {
    const m = new Map<string, CropRef[]>();
    for (const r of cropRows || []) {
      if (!r.linkedExerciseId || !r.linkedQuestionKey) continue;
      const arr = m.get(r.linkedExerciseId) || [];
      arr.push({ _id: r._id, key: r.linkedQuestionKey });
      m.set(r.linkedExerciseId, arr);
    }
    return m;
  }, [cropRows]);

  // === HELPERS ===
  const getUnitExercises = (unitId: string) =>
    (allExercises || []).filter(e => e.unitId === unitId).sort((a, b) => a.order - b.order);

  const getExercisesOnly = (unitId: string) =>
    getUnitExercises(unitId).filter(e => (e.type || 'exercise') === 'exercise');

  const getMaxExNum = (unitId: string) =>
    getExercisesOnly(unitId)
      .filter(e => !e.name.endsWith('.0'))
      .reduce((max, ex) => {
        const sub = parseInt(ex.name.split('.')[1]);
        return !isNaN(sub) && sub > max ? sub : max;
      }, 0);

  const unitHasReview = (unitId: string) =>
    getUnitExercises(unitId).some(e => e.name.endsWith('.0'));

  const getUnitMeta = (unitId: string) =>
    allUnitMeta?.find(m => m.unitId === unitId);

  const getUnitConcepts = (unitId: string) =>
    getUnitExercises(unitId).filter(e => e.type === 'concept');

  const isUnitDone = (unit: BookUnit): boolean => {
    if (activeLayer === 'exercises') {
      return getExercisesOnly(unit.id).length > 0;
    }
    if (activeLayer === 'pages') {
      const meta = getUnitMeta(unit.id);
      return meta?.startPage != null && meta?.endPage != null;
    }
    if (activeLayer === 'concepts') {
      // Concepts subtab "done" = unit has at least one concept-type row AND
      // every concept has a video URL set. This is the metric that matters
      // for the pre-recorded theory video workflow.
      const cs = getUnitConcepts(unit.id);
      return cs.length > 0 && cs.every(c => !!c.videoUrl);
    }
    // details: all exercises have questionCount > 0
    const exs = getExercisesOnly(unit.id);
    return exs.length > 0 && exs.every(e => e.questionCount > 0);
  };

  const layerDoneCount = (layer: Layer): number =>
    bookUnits.filter(u => {
      if (layer === 'exercises') return getExercisesOnly(u.id).length > 0;
      if (layer === 'pages') {
        const meta = getUnitMeta(u.id);
        return meta?.startPage != null && meta?.endPage != null;
      }
      if (layer === 'concepts') {
        const cs = getUnitConcepts(u.id);
        return cs.length > 0 && cs.every(c => !!c.videoUrl);
      }
      const exs = getExercisesOnly(u.id);
      return exs.length > 0 && exs.every(e => e.questionCount > 0);
    }).length;

  // === HANDLERS ===
  const handleUnitTap = (unit: BookUnit) => {
    if (activeLayer === 'exercises') {
      setReviewToggle(unitHasReview(unit.id));
      setExDialogUnit(unit);
    } else if (activeLayer === 'pages') {
      const meta = getUnitMeta(unit.id);
      setPgStart(meta?.startPage?.toString() || '');
      setPgEnd(meta?.endPage?.toString() || '');
      setPgDialogUnit(unit);
    } else if (activeLayer === 'concepts') {
      setConceptsDrawerUnit(unit);
    } else {
      setDetailUnitId(unit.id);
    }
  };

  const handleExerciseSelect = async (count: number) => {
    if (!exDialogUnit) return;
    const { id: unitId, number: unitNumber } = exDialogUnit;
    const currentMax = getMaxExNum(unitId);
    const isNew = getExercisesOnly(unitId).length === 0;

    if (isNew) {
      await bulkAddMutation({ unitId, unitNumber, lastExercise: count, hasReview: reviewToggle });
      toast.success(`Generated exercises for unit ${unitNumber}`);
    } else if (count > currentMax) {
      await bulkAddMutation({
        unitId,
        unitNumber,
        lastExercise: count,
        hasReview: false,
        startFrom: currentMax + 1,
      });
      toast.success(`Added exercises ${unitNumber}.${currentMax + 1} – ${unitNumber}.${count}`);
    } else if (count < currentMax) {
      await trimMutation({ unitId, unitNumber, keepUpTo: count });
      toast.success(`Trimmed to ${unitNumber}.1 – ${unitNumber}.${count}`);
    }
    setExDialogUnit(null);
  };

  const handlePageSave = async () => {
    if (!pgDialogUnit) return;
    const start = parseInt(pgStart);
    const end = parseInt(pgEnd);
    if (isNaN(start) || isNaN(end) || start > end || start < 1) {
      toast.error('Enter valid page numbers');
      return;
    }
    await setUnitPagesMutation({ unitId: pgDialogUnit.id, startPage: start, endPage: end });
    toast.success(`Pages set for unit ${pgDialogUnit.number}`);
    setPgDialogUnit(null);
  };

  const handleSaveConcept = async () => {
    if (!conceptName.trim() || !detailUnit) return;
    await addConceptMutation({ unitId: detailUnit.id, name: conceptName.trim(), afterOrder: conceptAfterOrder });
    setConceptDialogOpen(false);
    setConceptName('');
    toast.success('Concept added');
  };

  const handleCountBlur = async (id: Id<'exercises'>, current: number, value: string) => {
    const val = parseInt(value);
    if (isNaN(val) || val < 0 || val === current) return;
    await updateQcMutation({ id, questionCount: val });
  };

  const handleItemPageBlur = async (
    id: Id<'exercises'>,
    curStart: number | undefined,
    curEnd: number | undefined,
    startVal: string,
    endVal: string,
  ) => {
    const s = parseInt(startVal);
    const e = endVal.trim() ? parseInt(endVal) : undefined;
    if (isNaN(s) || s < 1) return;
    if (e !== undefined && (isNaN(e) || e < s)) return;
    if (s === curStart && e === curEnd) return;
    await updatePageMutation({ id, pageNumber: s, pageNumberEnd: e });
  };

  const handleDeleteItem = async (id: Id<'exercises'>, type?: string) => {
    const label = type === 'concept' ? 'concept' : 'exercise';
    if (confirm(`Delete this ${label}?`)) {
      await removeExMutation({ id });
      toast.success(`Deleted`);
    }
  };

  // === LOADING ===
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

  // ────────────────────────────────────────────────
  // LAYER 3 DETAIL VIEW
  // ────────────────────────────────────────────────
  if (detailUnit && activeLayer === 'details') {
    const unitItems = getUnitExercises(detailUnit.id);
    const meta = getUnitMeta(detailUnit.id);

    return (
      <>
        {/* Header */}
        <div className="flex items-center gap-2 mb-3">
          <button
            className="w-8 h-8 rounded-xl flex items-center justify-center hover:bg-muted transition-colors"
            onClick={() => setDetailUnitId(null)}
          >
            <ChevronLeft className="w-5 h-5 text-muted-foreground" />
          </button>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-foreground truncate">{detailUnit.name}</p>
            {meta?.startPage != null && meta?.endPage != null && (
              <p className="text-xs text-muted-foreground">
                Pages {meta.startPage} – {meta.endPage}
              </p>
            )}
          </div>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 shrink-0"
            onClick={() => router.push(`/settings/crop/${detailUnit.id}`)}
          >
            <Scissors className="w-3.5 h-3.5" />
            Pages
          </Button>
        </div>

        {/* Items list */}
        {unitItems.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">
            No exercises yet. Complete Layer 1 first.
          </p>
        ) : (
          <div className="space-y-0">
            {/* Add concept before first item */}
            <AddTheoryButton
              onClick={() => {
                setConceptAfterOrder(-1);
                setConceptName('');
                setConceptDialogOpen(true);
              }}
            />

            {unitItems.map(item => {
              const isConcept = item.type === 'concept';
              return (
                <div key={item._id}>
                  {isConcept ? (
                    <div className="flex items-center gap-2 py-2 px-3 bg-accent/50 rounded-lg my-0.5">
                      <BookOpen className="w-4 h-4 text-primary shrink-0" />
                      <span className="text-sm font-medium text-primary flex-1 min-w-0 truncate">
                        {item.name}
                      </span>
                      <Input
                        key={`pg-${item._id}-${item.pageNumber}`}
                        type="number"
                        min={1}
                        defaultValue={item.pageNumber || ''}
                        placeholder="fr"
                        className="w-11 h-7 text-xs text-center font-mono px-1"
                        onBlur={e => {
                          const endEl = e.target
                            .closest('div')
                            ?.querySelector<HTMLInputElement>(`[data-pgend="${item._id}"]`);
                          handleItemPageBlur(
                            item._id,
                            item.pageNumber,
                            item.pageNumberEnd,
                            e.target.value,
                            endEl?.value || '',
                          );
                        }}
                      />
                      <span className="text-[10px] text-muted-foreground">-</span>
                      <Input
                        key={`pge-${item._id}-${item.pageNumberEnd}`}
                        data-pgend={item._id}
                        type="number"
                        min={1}
                        defaultValue={item.pageNumberEnd || ''}
                        placeholder="to"
                        className="w-11 h-7 text-xs text-center font-mono px-1"
                        onBlur={e => {
                          handleItemPageBlur(
                            item._id,
                            item.pageNumber,
                            item.pageNumberEnd,
                            String(item.pageNumber || ''),
                            e.target.value,
                          );
                        }}
                      />
                      <button
                        onClick={() => handleDeleteItem(item._id, 'concept')}
                        className="w-6 h-6 rounded-lg flex items-center justify-center hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ) : (
                    <ExerciseCard
                      item={item}
                      cropCount={cropCountByExerciseId.get(item._id) || 0}
                      cropRefs={cropsByExerciseId.get(item._id) || []}
                      expandedSubQId={expandedSubQId}
                      onToggleSubQ={() =>
                        setExpandedSubQId(prev => (prev === item._id ? null : item._id))
                      }
                      onCountBlur={(v) => handleCountBlur(item._id, item.questionCount, v)}
                      onPageBlur={(s, e) =>
                        handleItemPageBlur(item._id, item.pageNumber, item.pageNumberEnd, s, e)
                      }
                      onDelete={() => handleDeleteItem(item._id)}
                      onCrop={() =>
                        router.push(
                          `/settings/crop/${detailUnit.id}?exerciseId=${item._id}`,
                        )
                      }
                      onJumpToCrop={(cropId) =>
                        router.push(
                          `/settings/crop/${detailUnit.id}?exerciseId=${item._id}&flash=${cropId}`,
                        )
                      }
                      onJumpToKey={(key) =>
                        router.push(
                          `/settings/crop/${detailUnit.id}?exerciseId=${item._id}&key=${encodeURIComponent(key)}`,
                        )
                      }
                      onSaveSubQ={async (subQ) => {
                        try {
                          await setSubQuestionsMutation({ id: item._id, subQuestions: subQ });
                        } catch (err) {
                          console.error('[setSubQuestions] failed', err);
                          toast.error(
                            err instanceof Error ? err.message : 'Failed to save sub-questions',
                          );
                          throw err;
                        }
                      }}
                    />
                  )}

                  <AddTheoryButton
                    onClick={() => {
                      setConceptAfterOrder(item.order);
                      setConceptName('');
                      setConceptDialogOpen(true);
                    }}
                  />
                </div>
              );
            })}
          </div>
        )}

        {/* Concept dialog */}
        <Dialog open={conceptDialogOpen} onOpenChange={setConceptDialogOpen}>
          <DialogContent className="max-w-sm mx-auto">
            <DialogHeader>
              <DialogTitle>Add Concept</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <Input
                value={conceptName}
                onChange={e => setConceptName(e.target.value)}
                placeholder="Concept / Theory name"
                autoFocus
              />
              <Button onClick={handleSaveConcept} className="w-full rounded-xl">
                Add Concept
              </Button>
            </div>
          </DialogContent>
        </Dialog>

      </>
    );
  }

  // ────────────────────────────────────────────────
  // MAIN VIEW — Book badges + Layer buttons + Grid
  // ────────────────────────────────────────────────
  return (
    <>
      {/* Book badges */}
      <div className="flex gap-2 overflow-x-auto pb-2 mb-3 no-scrollbar">
        {sortedBooks.length === 0 && (
          <p className="text-sm text-muted-foreground">No books yet. Create them in Content tab.</p>
        )}
        {sortedBooks.map(book => {
          const isSelected = book._id === selectedBookId;
          const hasRange = book.startUnit != null && book.endUnit != null;
          return (
            <button
              key={book._id}
              onClick={() => {
                if (!hasRange) {
                  toast.error('Set unit range in Content tab first');
                  return;
                }
                setSelectedBookId(book._id);
                setDetailUnitId(null);
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
              {hasRange ? (
                <div
                  className={`text-[10px] ${isSelected ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}
                >
                  Units {book.startUnit}–{book.endUnit}
                </div>
              ) : (
                <div className="text-[10px] text-muted-foreground">No range</div>
              )}
            </button>
          );
        })}
      </div>

      {!selectedBook ? (
        <p className="text-sm text-muted-foreground text-center py-8">Select a book to start</p>
      ) : (
        <>
          {/* Layer buttons */}
          <div className="flex gap-1 p-1 bg-muted rounded-xl mb-4">
            {(
              [
                { key: 'exercises', label: 'Exercises' },
                { key: 'pages', label: 'Page Nos' },
                { key: 'details', label: 'Details' },
                { key: 'concepts', label: 'Concepts' },
              ] as { key: Layer; label: string }[]
            ).map(layer => {
              const done = layerDoneCount(layer.key);
              const total = bookUnits.length;
              const isActive = activeLayer === layer.key;
              return (
                <button
                  key={layer.key}
                  onClick={() => {
                    setActiveLayer(layer.key);
                    setDetailUnitId(null);
                  }}
                  className={`flex-1 py-2 px-1 rounded-lg text-xs font-medium transition-all ${
                    isActive ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {layer.label}
                  {total > 0 && (
                    <span className={`ml-1 ${done === total ? 'text-emerald-500' : ''}`}>
                      {done}/{total}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Unit grid */}
          {bookUnits.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              No units found for this book&apos;s range
            </p>
          ) : (
            <div className="grid grid-cols-5 gap-2">
              {bookUnits.map(unit => {
                const done = isUnitDone(unit);
                return (
                  <button
                    key={unit.id}
                    onClick={() => handleUnitTap(unit)}
                    className={`p-2 rounded-xl border text-center transition-all active:scale-95 ${
                      done
                        ? 'bg-emerald-500/10 border-emerald-500/30'
                        : 'bg-card border-border/50 hover:border-primary/30'
                    }`}
                  >
                    <div className={`text-lg font-bold ${done ? 'text-emerald-400' : 'text-foreground'}`}>
                      {unit.number}
                    </div>
                    <div className="text-[10px] text-muted-foreground truncate leading-tight mt-0.5">
                      {unit.name.replace(/^\d+\.\s*/, '')}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* ─── LAYER 1: Exercise Count Dialog ─── */}
      <Dialog open={!!exDialogUnit} onOpenChange={open => !open && setExDialogUnit(null)}>
        <DialogContent className="max-w-sm mx-auto">
          <DialogHeader>
            <DialogTitle className="text-sm">Unit {exDialogUnit?.number}: Exercises</DialogTitle>
          </DialogHeader>
          {exDialogUnit && (
            <ExercisePickerBody
              unit={exDialogUnit}
              currentMax={getMaxExNum(exDialogUnit.id)}
              isNew={getExercisesOnly(exDialogUnit.id).length === 0}
              hasReview={unitHasReview(exDialogUnit.id)}
              reviewToggle={reviewToggle}
              onReviewToggle={() => setReviewToggle(r => !r)}
              onSelect={handleExerciseSelect}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* ─── LAYER 2: Page Number Dialog ─── */}
      <Dialog open={!!pgDialogUnit} onOpenChange={open => !open && setPgDialogUnit(null)}>
        <DialogContent className="max-w-xs mx-auto">
          <DialogHeader>
            <DialogTitle className="text-sm">Unit {pgDialogUnit?.number}: Page Range</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex gap-3 items-center">
              <div className="flex-1">
                <Label className="text-xs">Start Page</Label>
                <Input
                  type="number"
                  min={1}
                  value={pgStart}
                  onChange={e => setPgStart(e.target.value)}
                  placeholder="e.g. 45"
                  className="font-mono mt-1"
                  autoFocus
                />
              </div>
              <span className="text-muted-foreground mt-5">—</span>
              <div className="flex-1">
                <Label className="text-xs">End Page</Label>
                <Input
                  type="number"
                  min={1}
                  value={pgEnd}
                  onChange={e => setPgEnd(e.target.value)}
                  placeholder="e.g. 62"
                  className="font-mono mt-1"
                />
              </div>
            </div>
            <Button onClick={handlePageSave} className="w-full rounded-xl">
              Save
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ─── LAYER 4: Concepts Drawer ─── */}
      <ConceptsUnitDrawer
        open={!!conceptsDrawerUnit}
        onOpenChange={(o) => { if (!o) setConceptsDrawerUnit(null); }}
        unit={conceptsDrawerUnit}
        unitMeta={conceptsDrawerUnit ? getUnitMeta(conceptsDrawerUnit.id) : undefined}
        allExercises={allExercises || []}
      />
    </>
  );
}

// ─── Sub-components ────────────────────────────

function AddTheoryButton({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="w-full flex items-center gap-2 py-1 group">
      <div className="flex-1 h-px bg-border group-hover:bg-primary/40 transition-colors" />
      <span className="text-[11px] text-muted-foreground/60 group-hover:text-primary transition-colors flex items-center gap-0.5">
        <Plus className="w-3 h-3" /> theory
      </span>
      <div className="flex-1 h-px bg-border group-hover:bg-primary/40 transition-colors" />
    </button>
  );
}

// ─── Exercise card (Details view) ────────────────
// Three-row layout, generous touch targets:
//   Row 1 = identity (name, Rev badge, page range, delete)
//   Row 2 = data-entry actions (qCount, sub-Q toggle, crop button)
//   Row 3 = capture-status dots, one per main-Q (filled = ≥1 crop saved)
// Tapping a dot deep-links into the crop route — flashing the matching rect
// if there is one, or pre-selecting that key if there isn't.
function ExerciseCard({
  item,
  cropCount,
  cropRefs,
  expandedSubQId,
  onToggleSubQ,
  onCountBlur,
  onPageBlur,
  onDelete,
  onCrop,
  onJumpToCrop,
  onJumpToKey,
  onSaveSubQ,
}: {
  item: {
    _id: Id<'exercises'>;
    name: string;
    questionCount: number;
    pageNumber?: number;
    pageNumberEnd?: number;
    subQuestions?: SubQuestionsMap;
  };
  cropCount: number;
  cropRefs: { _id: Id<'questionBank'>; key: string }[];
  expandedSubQId: Id<'exercises'> | null;
  onToggleSubQ: () => void;
  onCountBlur: (value: string) => void;
  onPageBlur: (startVal: string, endVal: string) => void;
  onDelete: () => void;
  onCrop: () => void;
  onJumpToCrop: (cropId: Id<'questionBank'>) => void;
  onJumpToKey: (key: string) => void;
  onSaveSubQ: (subQ: SubQuestionsMap | null) => Promise<void>;
}) {
  const isExpanded = expandedSubQId === item._id;
  const hasSubQ = !!item.subQuestions;
  const subQNum = hasSubQ ? Object.keys(item.subQuestions!).length : 0;
  const isReview = item.name.endsWith('.0');

  // Group crops by their question key for quick lookup. Multiple crops may
  // share a key (e.g. stem text + figure for the same sub-part) — we only
  // need the first one for the deep-link.
  const cropsByKey = useMemo(() => {
    const m = new Map<string, Id<'questionBank'>>();
    for (const c of cropRefs) {
      if (!m.has(c.key)) m.set(c.key, c._id);
    }
    return m;
  }, [cropRefs]);

  // Does main question `q` have at least one crop (stem OR any sub-part)?
  // Returns the first crop id encountered so dots can flash-link directly.
  const firstCropForMainQ = (q: number): Id<'questionBank'> | null => {
    const stem = cropsByKey.get(String(q));
    if (stem) return stem;
    const prefix = `${q}.`;
    for (const [k, id] of cropsByKey) {
      if (k.startsWith(prefix)) return id;
    }
    return null;
  };

  return (
    <Card className="border-border/50 my-1">
      <CardContent className="p-3">
        {/* ── Row 1: identity ── */}
        <div className="flex items-center gap-2">
          <span className="text-base font-mono font-semibold text-foreground shrink-0">
            {item.name}
          </span>
          {isReview && (
            <Badge variant="secondary" className="text-[10px] shrink-0">
              Rev
            </Badge>
          )}
          <div className="flex-1" />
          <div className="flex items-center gap-1 shrink-0">
            <Input
              key={`pg-${item._id}-${item.pageNumber}`}
              type="number"
              min={1}
              defaultValue={item.pageNumber || ''}
              placeholder="fr"
              aria-label="Start page"
              className="w-12 h-8 text-xs text-center font-mono px-1"
              onBlur={e => {
                const endEl = e.target
                  .closest('div')
                  ?.querySelector<HTMLInputElement>(`[data-pgend="${item._id}"]`);
                onPageBlur(e.target.value, endEl?.value || '');
              }}
            />
            <span className="text-[10px] text-muted-foreground">–</span>
            <Input
              key={`pge-${item._id}-${item.pageNumberEnd}`}
              data-pgend={item._id}
              type="number"
              min={1}
              defaultValue={item.pageNumberEnd || ''}
              placeholder="to"
              aria-label="End page"
              className="w-12 h-8 text-xs text-center font-mono px-1"
              onBlur={e => onPageBlur(String(item.pageNumber || ''), e.target.value)}
            />
          </div>
          <button
            onClick={onDelete}
            aria-label="Delete exercise"
            className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors shrink-0"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>

        {/* ── Row 2: actions ── */}
        <div className="flex items-center gap-2 mt-2">
          {/* Question count */}
          <div className="flex items-center gap-1.5">
            <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">
              Qs
            </Label>
            <Input
              key={`qc-${item._id}-${item.questionCount}`}
              type="number"
              min={0}
              defaultValue={item.questionCount || ''}
              placeholder="0"
              className="w-14 h-8 text-sm text-center font-mono"
              onBlur={e => onCountBlur(e.target.value)}
            />
          </div>

          <div className="flex-1" />

          {/* Sub-question toggle (only when qCount set) */}
          {item.questionCount > 0 && (
            <button
              onClick={onToggleSubQ}
              title="Sub-questions"
              className={`relative h-8 px-2.5 rounded-lg flex items-center gap-1 text-xs font-medium active:scale-95 transition-all shrink-0
                ${isExpanded
                  ? 'bg-primary text-primary-foreground'
                  : hasSubQ
                    ? 'bg-primary/15 text-primary hover:bg-primary/25'
                    : 'bg-muted text-muted-foreground hover:bg-muted/70'}`}
            >
              <List className="w-3.5 h-3.5" />
              <span>Parts</span>
              {subQNum > 0 && (
                <span className={`ml-0.5 text-[10px] font-bold rounded-full px-1 min-w-[16px] text-center ${
                  isExpanded ? 'bg-primary-foreground/20' : 'bg-primary/30'
                }`}>
                  {subQNum}
                </span>
              )}
            </button>
          )}

          {/* Crop button — Phase 0.3 entry point */}
          <button
            onClick={onCrop}
            title="Crop questions for this exercise"
            disabled={item.questionCount === 0}
            className={`relative h-8 px-2.5 rounded-lg flex items-center gap-1 text-xs font-medium active:scale-95 transition-all shrink-0
              ${item.questionCount === 0
                ? 'bg-muted/50 text-muted-foreground/50 cursor-not-allowed'
                : cropCount > 0
                  ? 'bg-emerald-500/15 text-emerald-500 hover:bg-emerald-500/25'
                  : 'bg-muted text-muted-foreground hover:bg-muted/70 hover:text-foreground'}`}
          >
            <Scissors className="w-3.5 h-3.5" />
            <span>Crop</span>
            {cropCount > 0 && (
              <span className="ml-0.5 text-[10px] font-bold rounded-full px-1 min-w-[16px] text-center bg-emerald-500/30">
                {cropCount}
              </span>
            )}
          </button>
        </div>

        {/* ── Row 3: capture-status dots ── */}
        {item.questionCount > 0 && (
          <div className="flex flex-wrap items-center gap-1 mt-2 pt-2 border-t border-border/30">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70 mr-1">
              Captured
            </span>
            {Array.from({ length: item.questionCount }, (_, i) => i + 1).map(
              (q) => {
                const firstId = firstCropForMainQ(q);
                const filled = !!firstId;
                return (
                  <button
                    key={q}
                    onClick={() => {
                      if (firstId) onJumpToCrop(firstId);
                      else onJumpToKey(String(q));
                    }}
                    title={`Q${q}${filled ? ' — view crop' : ' — start crop'}`}
                    className="w-6 h-6 rounded-md flex items-center justify-center hover:bg-muted/70 active:scale-90 transition-all"
                  >
                    <span
                      className={`w-2.5 h-2.5 rounded-full transition-colors ${
                        filled
                          ? 'bg-emerald-500'
                          : 'border border-muted-foreground/40'
                      }`}
                    />
                  </button>
                );
              },
            )}
          </div>
        )}

        {/* ── Expandable sub-question editor + capture grid ── */}
        {isExpanded && item.questionCount > 0 && (
          <>
            <SubQuestionInline
              questionCount={item.questionCount}
              subQuestions={item.subQuestions ?? null}
              onSave={onSaveSubQ}
            />
            <CaptureGrid
              questionCount={item.questionCount}
              subQuestions={item.subQuestions}
              cropsByKey={cropsByKey}
              onJumpToCrop={onJumpToCrop}
              onJumpToKey={onJumpToKey}
            />
          </>
        )}
      </CardContent>
    </Card>
  );
}

function ExercisePickerBody({
  unit,
  currentMax,
  isNew,
  hasReview,
  reviewToggle,
  onReviewToggle,
  onSelect,
}: {
  unit: BookUnit;
  currentMax: number;
  isNew: boolean;
  hasReview: boolean;
  reviewToggle: boolean;
  onReviewToggle: () => void;
  onSelect: (count: number) => void;
}) {
  const toggleOn = isNew ? reviewToggle : hasReview;

  return (
    <div className="space-y-4">
      {/* Review toggle */}
      <div className="flex items-center gap-3">
        <button
          onClick={isNew ? onReviewToggle : undefined}
          className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${
            toggleOn ? 'bg-primary' : 'bg-muted-foreground/30'
          } ${!isNew ? 'opacity-50 cursor-default' : ''}`}
          disabled={!isNew}
        >
          <span
            className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform ${toggleOn ? 'translate-x-5' : ''}`}
          />
        </button>
        <div>
          <p className="text-sm font-medium">Review ({unit.number}.0)</p>
          {!isNew && (
            <p className="text-[11px] text-muted-foreground">{hasReview ? 'Already added' : 'Not added'}</p>
          )}
        </div>
      </div>

      {/* Number grid */}
      <div>
        <p className="text-xs text-muted-foreground mb-2">
          {isNew ? 'Select number of exercises:' : `Current: ${currentMax}. Tap to change.`}
        </p>
        <div className="grid grid-cols-6 gap-1.5">
          {Array.from({ length: 30 }, (_, i) => i + 1).map(n => {
            const isCurrent = !isNew && n === currentMax;
            const isLower = !isNew && n < currentMax;
            return (
              <button
                key={n}
                onClick={() => onSelect(n)}
                className={`h-10 rounded-lg text-sm font-medium transition-all ${
                  isCurrent
                    ? 'bg-emerald-500 text-white'
                    : isLower
                      ? 'bg-muted hover:bg-destructive/10 hover:text-destructive text-muted-foreground'
                      : 'bg-muted hover:bg-primary/10 hover:text-primary text-foreground'
                }`}
              >
                {n}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Capture status grid (in expanded ExerciseCard) ────────────
// One row per main question: a stem cell plus a cell for each sub-part.
// Each cell is filled emerald if at least one crop has been saved with that
// key, otherwise an empty bordered box. Tapping a filled cell jumps to the
// crop view and flashes the rect; tapping an empty cell jumps with that
// key pre-selected so the user lands ready to draw it.
function CaptureGrid({
  questionCount,
  subQuestions,
  cropsByKey,
  onJumpToCrop,
  onJumpToKey,
}: {
  questionCount: number;
  subQuestions: SubQuestionsMap | undefined;
  cropsByKey: Map<string, Id<'questionBank'>>;
  onJumpToCrop: (cropId: Id<'questionBank'>) => void;
  onJumpToKey: (key: string) => void;
}) {
  const cell = (key: string, label: string) => {
    const cropId = cropsByKey.get(key);
    const filled = !!cropId;
    return (
      <button
        key={key}
        onClick={() =>
          cropId ? onJumpToCrop(cropId) : onJumpToKey(key)
        }
        title={`${key}${filled ? ' — view crop' : ' — start crop'}`}
        className={`min-w-[34px] h-7 px-2 rounded-md text-[10px] font-mono font-bold transition-all active:scale-95
          ${filled
            ? 'bg-emerald-500 text-white hover:bg-emerald-500/90'
            : 'bg-card border border-dashed border-muted-foreground/40 text-muted-foreground hover:border-primary/50 hover:text-foreground'}`}
      >
        {label}
      </button>
    );
  };

  return (
    <div className="bg-muted/30 rounded-lg p-2 mt-2 border border-border/40 space-y-1">
      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 px-1">
        Capture status — tap to view / start
      </p>
      <div className="space-y-1 max-h-[40vh] overflow-y-auto no-scrollbar">
        {Array.from({ length: questionCount }, (_, i) => {
          const q = i + 1;
          const sub = subQuestions?.[String(q)];
          const hasSubs = !!sub && sub.count > 1;
          return (
            <div
              key={q}
              className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-card border border-border/30"
            >
              <span className="text-[11px] font-mono font-semibold text-foreground min-w-[28px]">
                Q{q}
              </span>
              {hasSubs
                ? cell(String(q), 'stem')
                : cell(String(q), 'whole')}
              {hasSubs && (
                <>
                  <span className="text-[10px] text-muted-foreground/50">
                    ·
                  </span>
                  {Array.from({ length: sub.count }, (_, s) => {
                    const label = getSubLabel(s, sub.type);
                    return cell(`${q}.${label}`, label);
                  })}
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
