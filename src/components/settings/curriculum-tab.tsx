'use client';

import { useState } from 'react';
import { useQuery, useMutation } from 'convex/react';
import { ChevronLeft, ChevronRight, Plus, Trash2, BookOpen, Camera, Image as ImageIcon } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { CurriculumModule } from '@/lib/types';
import { CURRICULUM_MODULES } from '@/lib/curriculum-data';
import { api } from '@/lib/convex';
import { toast } from 'sonner';
import type { Id } from '@/lib/convex';

type ViewLevel = 'modules' | 'grades' | 'terms' | 'units' | 'exercises';

function extractUnitNumber(name: string): number {
  const match = name.match(/^(\d+)\./);
  return match ? parseInt(match[1]) : 0;
}

function parseLastExercise(input: string, unitNumber: number): number | null {
  const trimmed = input.trim();
  if (trimmed.includes('.')) {
    const sub = parseInt(trimmed.split('.')[1]);
    if (!isNaN(sub) && sub > 0) return sub;
    return null;
  }
  const num = parseInt(trimmed);
  if (!isNaN(num) && num > 0) return num;
  return null;
}

export function CurriculumTab() {
  const [viewLevel, setViewLevel] = useState<ViewLevel>('modules');
  const [selectedModule, setSelectedModule] = useState<CurriculumModule | null>(null);
  const [selectedGrade, setSelectedGrade] = useState<number | null>(null);
  const [selectedTerm, setSelectedTerm] = useState<number | null>(null);
  const [selectedUnit, setSelectedUnit] = useState<{ id: string; name: string } | null>(null);

  const [lastExNum, setLastExNum] = useState('');
  const [hasReview, setHasReview] = useState(false);

  const [conceptDialogOpen, setConceptDialogOpen] = useState(false);
  const [conceptName, setConceptName] = useState('');
  const [conceptInsertAfterOrder, setConceptInsertAfterOrder] = useState(-1);

  const [pagePreviewOpen, setPagePreviewOpen] = useState(false);
  const [previewPageNum, setPreviewPageNum] = useState<number | null>(null);
  const [previewGrade, setPreviewGrade] = useState<number | null>(null);

  const [addMoreOpen, setAddMoreOpen] = useState(false);
  const [addMoreNum, setAddMoreNum] = useState('');

  const allExercises = useQuery(api.exercises.list);
  const bulkAddMutation = useMutation(api.exercises.bulkAdd);
  const addConceptMutation = useMutation(api.exercises.addConcept);
  const updateQuestionCountMutation = useMutation(api.exercises.updateQuestionCount);
  const updatePageNumberMutation = useMutation(api.exercises.updatePageNumber);
  const removeExerciseMutation = useMutation(api.exercises.remove);

  const pageImageResult = useQuery(
    api.textbookPages.getPagesByGrade,
    previewGrade !== null && previewPageNum !== null
      ? { grade: previewGrade, pageNumber: previewPageNum }
      : 'skip'
  );

  if (!allExercises) {
    return (
      <div className="animate-pulse space-y-2">
        {[1, 2, 3].map(i => <div key={i} className="h-20 bg-muted rounded-xl" />)}
      </div>
    );
  }

  const unitItems = selectedUnit
    ? allExercises.filter(e => e.unitId === selectedUnit.id).sort((a, b) => a.order - b.order)
    : [];
  const unitExercisesOnly = unitItems.filter(e => (e.type || 'exercise') === 'exercise');
  const unitNumber = selectedUnit ? extractUnitNumber(selectedUnit.name) : 0;

  const getExerciseCount = (unitId: string) => allExercises.filter(e => e.unitId === unitId && (e.type || 'exercise') === 'exercise').length;
  const getConceptCount = (unitId: string) => allExercises.filter(e => e.unitId === unitId && e.type === 'concept').length;

  const handleBack = () => {
    if (viewLevel === 'exercises') { setViewLevel('units'); setSelectedUnit(null); setLastExNum(''); setHasReview(false); }
    else if (viewLevel === 'units') { setViewLevel('terms'); setSelectedTerm(null); }
    else if (viewLevel === 'terms') { setViewLevel('grades'); setSelectedGrade(null); }
    else if (viewLevel === 'grades') { setViewLevel('modules'); setSelectedModule(null); }
  };

  const handleGenerate = async () => {
    const num = parseLastExercise(lastExNum, unitNumber);
    if (!num) { toast.error('Enter a valid exercise number'); return; }
    await bulkAddMutation({ unitId: selectedUnit!.id, unitNumber, lastExercise: num, hasReview });
    toast.success(`Generated ${hasReview ? num + 1 : num} exercises`);
    setLastExNum('');
  };

  const handleAddMore = async () => {
    const num = parseLastExercise(addMoreNum, unitNumber);
    if (!num) { toast.error('Enter a valid exercise number'); return; }
    const currentMax = unitExercisesOnly.reduce((max, ex) => {
      const s = parseInt(ex.name.split('.')[1]);
      return !isNaN(s) && s > max ? s : max;
    }, 0);
    if (num <= currentMax) { toast.error(`Exercises up to ${unitNumber}.${currentMax} already exist`); return; }
    await bulkAddMutation({ unitId: selectedUnit!.id, unitNumber, lastExercise: num, hasReview: false, startFrom: currentMax + 1 });
    toast.success(`Added exercises ${unitNumber}.${currentMax + 1} to ${unitNumber}.${num}`);
    setAddMoreOpen(false);
    setAddMoreNum('');
  };

  const handleCountBlur = async (id: Id<"exercises">, currentCount: number, inputValue: string) => {
    const val = parseInt(inputValue);
    if (isNaN(val) || val < 0 || val === currentCount) return;
    await updateQuestionCountMutation({ id, questionCount: val });
  };

  const handlePageBlur = async (id: Id<"exercises">, currentPage: number | undefined, inputValue: string) => {
    const val = parseInt(inputValue);
    if (inputValue.trim() === '' && currentPage !== undefined) {
      // Clear not supported with number field, just ignore
      return;
    }
    if (isNaN(val) || val < 0 || val === currentPage) return;
    await updatePageNumberMutation({ id, pageNumber: val });
  };

  const handleDelete = async (id: Id<"exercises">, type?: string) => {
    const label = (type || 'exercise') === 'concept' ? 'concept' : 'exercise';
    if (confirm(`Delete this ${label}?`)) {
      await removeExerciseMutation({ id });
      toast.success(`${label.charAt(0).toUpperCase() + label.slice(1)} deleted`);
    }
  };

  const handleSaveConcept = async () => {
    if (!conceptName.trim()) { toast.error('Enter a concept name'); return; }
    await addConceptMutation({ unitId: selectedUnit!.id, name: conceptName.trim(), afterOrder: conceptInsertAfterOrder });
    setConceptDialogOpen(false);
    setConceptName('');
    toast.success('Concept added');
  };

  const handlePagePreview = (pageNumber: number | undefined) => {
    if (!pageNumber || !selectedGrade) {
      toast.error('Set a page number first');
      return;
    }
    setPreviewGrade(selectedGrade);
    setPreviewPageNum(pageNumber);
    setPagePreviewOpen(true);
  };

  const breadcrumb = () => {
    const parts: string[] = [];
    if (selectedModule) parts.push(selectedModule.id);
    if (selectedGrade !== null) parts.push(`Grade ${selectedGrade}`);
    if (selectedTerm !== null) parts.push(`Term ${selectedTerm}`);
    if (selectedUnit) parts.push(selectedUnit.name);
    return parts.join(' > ');
  };

  return (
    <>
      {viewLevel !== 'modules' && (
        <div className="flex items-center gap-2 mb-3">
          <button className="w-8 h-8 rounded-xl flex items-center justify-center hover:bg-muted transition-colors" onClick={handleBack}>
            <ChevronLeft className="w-5 h-5 text-muted-foreground" />
          </button>
          <p className="text-xs text-muted-foreground">{breadcrumb()}</p>
        </div>
      )}

      {viewLevel === 'modules' && (
        <div className="space-y-1.5">
          {CURRICULUM_MODULES.map(mod => {
            const totalUnits = mod.grades.reduce((sum, g) => sum + g.terms.reduce((s, t) => s + t.units.length, 0), 0);
            const unitsWithExercises = mod.grades.reduce((sum, g) => sum + g.terms.reduce((s, t) => s + t.units.filter(u => getExerciseCount(u.id) > 0).length, 0), 0);
            return (
              <Card key={mod.id} className="border-border/50 cursor-pointer hover:border-primary/30 transition-all active:scale-[0.98]" onClick={() => { setSelectedModule(mod); setViewLevel('grades'); }}>
                <CardContent className="p-3.5">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center text-white font-bold text-sm" style={{ backgroundColor: mod.color }}>{mod.id}</div>
                    <div className="flex-1">
                      <p className="font-semibold text-foreground text-sm">{mod.name}</p>
                      <p className="text-xs text-muted-foreground">{mod.tamilName}</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">{mod.day} · {unitsWithExercises}/{totalUnits} units have exercises</p>
                    </div>
                    <ChevronRight className="w-5 h-5 text-muted-foreground" />
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {viewLevel === 'grades' && selectedModule && (
        <div className="space-y-1.5">
          {selectedModule.grades.map(g => {
            const totalUnits = g.terms.reduce((s, t) => s + t.units.length, 0);
            const withEx = g.terms.reduce((s, t) => s + t.units.filter(u => getExerciseCount(u.id) > 0).length, 0);
            return (
              <Card key={g.grade} className="border-border/50 cursor-pointer hover:border-primary/30 transition-all active:scale-[0.98]" onClick={() => { setSelectedGrade(g.grade); setViewLevel('terms'); }}>
                <CardContent className="p-3.5 flex items-center justify-between">
                  <div>
                    <p className="font-semibold text-foreground text-sm">Grade {g.grade}</p>
                    <p className="text-xs text-muted-foreground">{totalUnits} units · {withEx} with exercises</p>
                  </div>
                  <ChevronRight className="w-5 h-5 text-muted-foreground" />
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {viewLevel === 'terms' && selectedModule && selectedGrade !== null && (
        <div className="space-y-1.5">
          {selectedModule.grades.find(g => g.grade === selectedGrade)?.terms.map(t => (
            <Card key={t.term} className="border-border/50 cursor-pointer hover:border-primary/30 transition-all active:scale-[0.98]" onClick={() => { setSelectedTerm(t.term); setViewLevel('units'); }}>
              <CardContent className="p-3.5 flex items-center justify-between">
                <div>
                  <p className="font-semibold text-foreground text-sm">{t.term === 1 ? '1st' : t.term === 2 ? '2nd' : '3rd'} Term</p>
                  <p className="text-xs text-muted-foreground">{t.units.length} units</p>
                </div>
                <ChevronRight className="w-5 h-5 text-muted-foreground" />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {viewLevel === 'units' && selectedModule && selectedGrade !== null && selectedTerm !== null && (
        <div className="space-y-1.5">
          {selectedModule.grades
            .find(g => g.grade === selectedGrade)
            ?.terms.find(t => t.term === selectedTerm)
            ?.units.map(unit => {
              const exCount = getExerciseCount(unit.id);
              const conCount = getConceptCount(unit.id);
              return (
                <Card key={unit.id} className="border-border/50 cursor-pointer hover:border-primary/30 transition-all active:scale-[0.98]" onClick={() => { setSelectedUnit(unit); setViewLevel('exercises'); }}>
                  <CardContent className="p-3.5 flex items-center justify-between">
                    <div>
                      <p className="font-medium text-foreground text-sm">{unit.name}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {exCount > 0 ? `${exCount} exercise${exCount !== 1 ? 's' : ''}` : 'No exercises yet'}
                        {conCount > 0 && ` · ${conCount} concept${conCount !== 1 ? 's' : ''}`}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {exCount > 0 && <Badge variant="secondary" className="text-[10px]">{exCount}</Badge>}
                      {conCount > 0 && <Badge variant="outline" className="text-[10px] border-primary/30 text-primary">{conCount}</Badge>}
                      <ChevronRight className="w-5 h-5 text-muted-foreground" />
                    </div>
                  </CardContent>
                </Card>
              );
            })}
        </div>
      )}

      {viewLevel === 'exercises' && selectedUnit && (
        <div>
          <p className="text-sm font-medium text-foreground mb-3">{selectedUnit.name}</p>

          {unitItems.length === 0 ? (
            <Card className="border-border/50">
              <CardContent className="p-4 space-y-4">
                <div>
                  <Label className="text-sm font-medium">Last exercise number</Label>
                  <p className="text-xs text-muted-foreground mb-1.5">
                    e.g., enter <span className="font-mono">6</span> to create {unitNumber}.1 through {unitNumber}.6
                  </p>
                  <Input value={lastExNum} onChange={e => setLastExNum(e.target.value)} placeholder={`e.g., 6 or ${unitNumber}.6`} className="font-mono" />
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setHasReview(!hasReview)}
                    className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${hasReview ? 'bg-primary' : 'bg-muted-foreground/30'}`}
                  >
                    <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform ${hasReview ? 'translate-x-5' : ''}`} />
                  </button>
                  <div>
                    <Label className="text-sm">Review exercise</Label>
                    <p className="text-xs text-muted-foreground">Adds {unitNumber}.0 at the start</p>
                  </div>
                </div>
                <Button onClick={handleGenerate} className="w-full rounded-xl">Generate Exercises</Button>
              </CardContent>
            </Card>
          ) : (
            <>
              <div className="space-y-0">
                <button
                  onClick={() => { setConceptInsertAfterOrder(-1); setConceptName(''); setConceptDialogOpen(true); }}
                  className="w-full flex items-center gap-2 py-1 group"
                >
                  <div className="flex-1 h-px bg-border group-hover:bg-primary/40 transition-colors" />
                  <span className="text-[11px] text-muted-foreground/60 group-hover:text-primary transition-colors flex items-center gap-0.5">
                    <Plus className="w-3 h-3" /> theory
                  </span>
                  <div className="flex-1 h-px bg-border group-hover:bg-primary/40 transition-colors" />
                </button>

                {unitItems.map(item => {
                  const isConcept = item.type === 'concept';
                  return (
                    <div key={item._id}>
                      {isConcept ? (
                        <div className="flex items-center gap-2 py-2 px-3 bg-accent/50 rounded-lg my-0.5">
                          <BookOpen className="w-4 h-4 text-primary shrink-0" />
                          <span className="text-sm font-medium text-primary flex-1 min-w-0 truncate">{item.name}</span>
                          <button
                            onClick={() => handlePagePreview(item.pageNumber)}
                            className="w-6 h-6 rounded-lg flex items-center justify-center hover:bg-primary/10 text-muted-foreground hover:text-primary transition-colors"
                            title="View page"
                          >
                            <Camera className="w-3.5 h-3.5" />
                          </button>
                          <Input
                            key={`pg-${item._id}-${item.pageNumber}`}
                            type="number"
                            min={1}
                            defaultValue={item.pageNumber || ''}
                            placeholder="pg"
                            className="w-14 h-7 text-xs text-center font-mono"
                            onBlur={e => handlePageBlur(item._id, item.pageNumber, e.target.value)}
                          />
                          <span className="text-[10px] text-muted-foreground shrink-0">pg</span>
                          <button onClick={() => handleDelete(item._id, 'concept')} className="w-6 h-6 rounded-lg flex items-center justify-center hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : (
                        <Card className="border-border/50 my-0.5">
                          <CardContent className="p-2.5 flex items-center gap-2">
                            <span className="text-sm font-mono font-medium text-foreground w-12 shrink-0">{item.name}</span>
                            {item.name.endsWith('.0') && <Badge variant="secondary" className="text-[10px] shrink-0">Review</Badge>}
                            <div className="flex-1" />
                            <Input
                              key={`${item._id}-${item.questionCount}`}
                              type="number"
                              min={1}
                              defaultValue={item.questionCount || ''}
                              placeholder="Qs"
                              className="w-14 h-8 text-sm text-center font-mono"
                              onBlur={e => handleCountBlur(item._id, item.questionCount, e.target.value)}
                            />
                            <span className="text-[11px] text-muted-foreground shrink-0">qs</span>
                            <button
                              onClick={() => handlePagePreview(item.pageNumber)}
                              className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-primary/10 text-muted-foreground hover:text-primary transition-colors"
                              title="View page"
                            >
                              <Camera className="w-3.5 h-3.5" />
                            </button>
                            <Input
                              key={`pg-${item._id}-${item.pageNumber}`}
                              type="number"
                              min={1}
                              defaultValue={item.pageNumber || ''}
                              placeholder="pg"
                              className="w-14 h-8 text-sm text-center font-mono"
                              onBlur={e => handlePageBlur(item._id, item.pageNumber, e.target.value)}
                            />
                            <span className="text-[11px] text-muted-foreground shrink-0">pg</span>
                            <button onClick={() => handleDelete(item._id)} className="w-6 h-6 rounded-lg flex items-center justify-center hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </CardContent>
                        </Card>
                      )}
                      <button
                        onClick={() => { setConceptInsertAfterOrder(item.order); setConceptName(''); setConceptDialogOpen(true); }}
                        className="w-full flex items-center gap-2 py-1 group"
                      >
                        <div className="flex-1 h-px bg-border group-hover:bg-primary/40 transition-colors" />
                        <span className="text-[11px] text-muted-foreground/60 group-hover:text-primary transition-colors flex items-center gap-0.5">
                          <Plus className="w-3 h-3" /> theory
                        </span>
                        <div className="flex-1 h-px bg-border group-hover:bg-primary/40 transition-colors" />
                      </button>
                    </div>
                  );
                })}
              </div>

              {!addMoreOpen ? (
                <Button variant="outline" size="sm" className="w-full rounded-xl mt-3 gap-1.5" onClick={() => setAddMoreOpen(true)}>
                  <Plus className="w-3.5 h-3.5" />
                  Add more exercises
                </Button>
              ) : (
                <Card className="border-border/50 mt-3">
                  <CardContent className="p-3 space-y-2">
                    <Label className="text-sm">New last exercise number</Label>
                    <div className="flex gap-2">
                      <Input
                        value={addMoreNum}
                        onChange={e => setAddMoreNum(e.target.value)}
                        placeholder={`e.g., ${unitNumber}.${(unitExercisesOnly.reduce((max, ex) => { const s = parseInt(ex.name.split('.')[1]); return !isNaN(s) && s > max ? s : max; }, 0)) + 2}`}
                        className="flex-1 font-mono"
                      />
                      <Button onClick={handleAddMore} size="sm" className="rounded-xl">Add</Button>
                      <Button variant="ghost" size="sm" onClick={() => { setAddMoreOpen(false); setAddMoreNum(''); }}>Cancel</Button>
                    </div>
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </div>
      )}

      <Dialog open={conceptDialogOpen} onOpenChange={setConceptDialogOpen}>
        <DialogContent className="max-w-sm mx-auto">
          <DialogHeader>
            <DialogTitle>Add Concept</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-sm">Concept / Theory Name</Label>
              <Input value={conceptName} onChange={e => setConceptName(e.target.value)} placeholder="e.g., Pythagorean Theorem" className="mt-1" autoFocus />
            </div>
            <Button onClick={handleSaveConcept} className="w-full rounded-xl">Add Concept</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Page Preview Dialog */}
      <Dialog open={pagePreviewOpen} onOpenChange={(open) => { if (!open) { setPagePreviewOpen(false); setPreviewPageNum(null); setPreviewGrade(null); } }}>
        <DialogContent className="max-w-sm mx-auto p-0 overflow-hidden">
          <DialogHeader className="p-4 pb-2">
            <DialogTitle className="text-sm">Textbook Page {previewPageNum}</DialogTitle>
          </DialogHeader>
          <div className="px-4 pb-4">
            {pageImageResult?.url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={pageImageResult.url}
                alt={`Textbook page ${previewPageNum}`}
                className="w-full rounded-lg border border-border"
              />
            ) : pageImageResult === null ? (
              <div className="w-full aspect-[3/4] bg-muted rounded-lg flex flex-col items-center justify-center gap-2">
                <ImageIcon className="w-10 h-10 text-muted-foreground/30" />
                <p className="text-sm text-muted-foreground">Page not captured yet</p>
                <p className="text-xs text-muted-foreground">Capture it in Settings → Content tab</p>
              </div>
            ) : (
              <div className="w-full aspect-[3/4] bg-muted rounded-lg flex items-center justify-center">
                <ImageIcon className="w-8 h-8 text-muted-foreground/40 animate-pulse" />
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
