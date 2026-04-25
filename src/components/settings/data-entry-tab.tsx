'use client';

import { useState, useMemo } from 'react';
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
import type { SubQuestionsMap } from '@/lib/sub-questions';
import { ConceptsUnitDrawer } from '@/components/settings/concepts-unit-drawer';

type Layer = 'exercises' | 'pages' | 'details' | 'concepts';

interface BookUnit {
  id: string;
  name: string;
  number: number;
  moduleId: string;
  term: number;
}

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

  // === SELECTION STATE ===
  const [selectedBookId, setSelectedBookId] = useState<string | null>(null);
  const [activeLayer, setActiveLayer] = useState<Layer>('exercises');

  // === LAYER 1 — Exercise dialog ===
  const [exDialogUnit, setExDialogUnit] = useState<BookUnit | null>(null);
  const [reviewToggle, setReviewToggle] = useState(false);

  // === LAYER 2 — Page dialog ===
  const [pgDialogUnit, setPgDialogUnit] = useState<BookUnit | null>(null);
  const [pgStart, setPgStart] = useState('');
  const [pgEnd, setPgEnd] = useState('');

  // === LAYER 3 — Detail view ===
  const [detailUnit, setDetailUnit] = useState<BookUnit | null>(null);
  const [conceptDialogOpen, setConceptDialogOpen] = useState(false);
  const [conceptName, setConceptName] = useState('');
  const [conceptAfterOrder, setConceptAfterOrder] = useState(-1);

  // === Sub-question inline expansion ===
  const [expandedSubQId, setExpandedSubQId] = useState<Id<'exercises'> | null>(null);

  // === LAYER 4 — Concepts drawer ===
  const [conceptsDrawerUnit, setConceptsDrawerUnit] = useState<BookUnit | null>(null);

  // === DERIVED ===
  const selectedBook = textbooks?.find(t => t._id === selectedBookId);

  const bookUnits = useMemo(() => {
    if (!selectedBook?.startUnit || !selectedBook?.endUnit) return [];
    return getUnitsForBook(selectedBook.grade, selectedBook.startUnit, selectedBook.endUnit);
  }, [selectedBook]);

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
      setDetailUnit(unit);
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
            onClick={() => setDetailUnit(null)}
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
                    <Card className="border-border/50 my-0.5">
                      <CardContent className="p-2.5">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-mono font-medium text-foreground w-10 shrink-0">
                            {item.name}
                          </span>
                          {item.name.endsWith('.0') && (
                            <Badge variant="secondary" className="text-[10px] shrink-0">
                              Rev
                            </Badge>
                          )}
                          <div className="flex-1" />
                          <Input
                            key={`qc-${item._id}-${item.questionCount}`}
                            type="number"
                            min={0}
                            defaultValue={item.questionCount || ''}
                            placeholder="Qs"
                            className="w-12 h-7 text-xs text-center font-mono"
                            onBlur={e => handleCountBlur(item._id, item.questionCount, e.target.value)}
                          />
                          {item.questionCount > 0 && (
                            <button
                              onClick={() =>
                                setExpandedSubQId(prev => (prev === item._id ? null : item._id))
                              }
                              className={`relative w-7 h-7 rounded-lg flex items-center justify-center active:scale-90 transition-all shrink-0
                                ${expandedSubQId === item._id
                                  ? 'bg-primary text-primary-foreground'
                                  : (item as { subQuestions?: SubQuestionsMap }).subQuestions
                                    ? 'bg-primary/15 text-primary'
                                    : 'bg-muted text-muted-foreground'}`}
                              title="Sub-questions"
                            >
                              <List className="w-3.5 h-3.5" />
                              {(item as { subQuestions?: SubQuestionsMap }).subQuestions && expandedSubQId !== item._id && (
                                <span className="absolute -top-1 -right-1 min-w-[14px] h-[14px] rounded-full bg-primary text-[7px] font-bold text-primary-foreground flex items-center justify-center px-0.5">
                                  {Object.keys((item as { subQuestions?: SubQuestionsMap }).subQuestions!).length}
                                </span>
                              )}
                            </button>
                          )}
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
                            onClick={() => handleDeleteItem(item._id)}
                            className="w-6 h-6 rounded-lg flex items-center justify-center hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                        {expandedSubQId === item._id && item.questionCount > 0 && (
                          <SubQuestionInline
                            questionCount={item.questionCount}
                            subQuestions={(item as { subQuestions?: SubQuestionsMap }).subQuestions ?? null}
                            onSave={async (subQ) => {
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
                      </CardContent>
                    </Card>
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
                setDetailUnit(null);
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
                    setDetailUnit(null);
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
