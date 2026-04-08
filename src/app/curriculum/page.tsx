'use client';

import { useState } from 'react';
import { useQuery, useMutation } from 'convex/react';
import { ChevronLeft, ChevronRight, Plus, Trash2, BookOpen, List } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { CURRICULUM_MODULES } from '@/lib/curriculum-data';
import { CurriculumModule } from '@/lib/types';
import { api } from '@/lib/convex';
import { toast } from 'sonner';
import type { Id } from '@/lib/convex';
import { SubQuestionInline } from '@/components/sub-question-inline';
import type { SubQuestionsMap } from '@/lib/sub-questions';

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

export default function CurriculumPage() {
  const [viewLevel, setViewLevel] = useState<ViewLevel>('modules');
  const [selectedModule, setSelectedModule] = useState<CurriculumModule | null>(null);
  const [selectedGrade, setSelectedGrade] = useState<number | null>(null);
  const [selectedTerm, setSelectedTerm] = useState<number | null>(null);
  const [selectedUnit, setSelectedUnit] = useState<{ id: string; name: string } | null>(null);

  // Generation form state
  const [lastExNum, setLastExNum] = useState('');
  const [hasReview, setHasReview] = useState(false);

  // Concept dialog state
  const [conceptDialogOpen, setConceptDialogOpen] = useState(false);
  const [conceptName, setConceptName] = useState('');
  const [conceptInsertAfterOrder, setConceptInsertAfterOrder] = useState(-1);

  // Add more exercises state
  const [addMoreOpen, setAddMoreOpen] = useState(false);
  const [addMoreNum, setAddMoreNum] = useState('');

  // Sub-question inline expansion
  const [expandedSubQId, setExpandedSubQId] = useState<Id<"exercises"> | null>(null);

  const allExercises = useQuery(api.exercises.list);
  const bulkAddMutation = useMutation(api.exercises.bulkAdd);
  const addConceptMutation = useMutation(api.exercises.addConcept);
  const updateQuestionCountMutation = useMutation(api.exercises.updateQuestionCount);
  const removeExerciseMutation = useMutation(api.exercises.remove);
  const setSubQuestionsMutation = useMutation(api.exercises.setSubQuestions);

  if (!allExercises) {
    return (
      <div className="px-4 pt-5 pb-6 max-w-lg mx-auto">
        <h1 className="text-lg font-bold text-foreground mb-4">Curriculum</h1>
        <div className="animate-pulse space-y-2">
          {[1, 2, 3].map(i => <div key={i} className="h-16 bg-muted rounded-xl" />)}
        </div>
      </div>
    );
  }

  const unitItems = selectedUnit
    ? allExercises.filter(e => e.unitId === selectedUnit.id).sort((a, b) => a.order - b.order)
    : [];
  const unitExercisesOnly = unitItems.filter(e => (e.type || 'exercise') === 'exercise');
  const unitNumber = selectedUnit ? extractUnitNumber(selectedUnit.name) : 0;

  const getExerciseCount = (unitId: string) => allExercises.filter(e => e.unitId === unitId && (e.type || 'exercise') === 'exercise').length;

  const handleBack = () => {
    if (viewLevel === 'exercises') { setViewLevel('units'); setSelectedUnit(null); setLastExNum(''); setHasReview(false); }
    else if (viewLevel === 'units') { setViewLevel('terms'); setSelectedTerm(null); }
    else if (viewLevel === 'terms') { setViewLevel('grades'); setSelectedGrade(null); }
    else if (viewLevel === 'grades') { setViewLevel('modules'); setSelectedModule(null); }
  };

  const handleGenerate = async () => {
    const num = parseLastExercise(lastExNum, unitNumber);
    if (!num) {
      toast.error('Enter a valid exercise number (e.g., 6 or ' + unitNumber + '.6)');
      return;
    }
    await bulkAddMutation({
      unitId: selectedUnit!.id,
      unitNumber,
      lastExercise: num,
      hasReview,
    });
    toast.success(`Generated ${hasReview ? num + 1 : num} exercises`);
    setLastExNum('');
  };

  const handleAddMore = async () => {
    const num = parseLastExercise(addMoreNum, unitNumber);
    if (!num) {
      toast.error('Enter a valid exercise number');
      return;
    }
    // Find current max exercise sub-number
    const currentMax = unitExercisesOnly.reduce((max, ex) => {
      const parts = ex.name.split('.');
      const sub = parseInt(parts[1]);
      return !isNaN(sub) && sub > max ? sub : max;
    }, 0);
    if (num <= currentMax) {
      toast.error(`Exercises up to ${unitNumber}.${currentMax} already exist`);
      return;
    }
    await bulkAddMutation({
      unitId: selectedUnit!.id,
      unitNumber,
      lastExercise: num,
      hasReview: false,
      startFrom: currentMax + 1,
    });
    toast.success(`Added exercises ${unitNumber}.${currentMax + 1} to ${unitNumber}.${num}`);
    setAddMoreOpen(false);
    setAddMoreNum('');
  };

  const handleCountBlur = async (id: Id<"exercises">, currentCount: number, inputValue: string) => {
    const val = parseInt(inputValue);
    if (isNaN(val) || val < 0 || val === currentCount) return;
    await updateQuestionCountMutation({ id, questionCount: val });
  };

  const handleDelete = async (id: Id<"exercises">, type?: string) => {
    const label = (type || 'exercise') === 'concept' ? 'concept' : 'exercise';
    if (confirm(`Delete this ${label}?`)) {
      await removeExerciseMutation({ id });
      toast.success(`${label.charAt(0).toUpperCase() + label.slice(1)} deleted`);
    }
  };

  const handleSaveConcept = async () => {
    if (!conceptName.trim()) {
      toast.error('Enter a concept name');
      return;
    }
    await addConceptMutation({
      unitId: selectedUnit!.id,
      name: conceptName.trim(),
      afterOrder: conceptInsertAfterOrder,
    });
    setConceptDialogOpen(false);
    setConceptName('');
    toast.success('Concept added');
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
    <div className="px-4 pt-5 pb-6 max-w-lg mx-auto">
      <div className="flex items-center gap-2 mb-4">
        {viewLevel !== 'modules' && (
          <button
            className="w-8 h-8 rounded-xl flex items-center justify-center hover:bg-muted transition-colors"
            onClick={handleBack}
          >
            <ChevronLeft className="w-5 h-5 text-muted-foreground" />
          </button>
        )}
        <div>
          <h1 className="text-lg font-bold text-foreground">Curriculum</h1>
          {viewLevel !== 'modules' && (
            <p className="text-xs text-muted-foreground">{breadcrumb()}</p>
          )}
        </div>
      </div>

      {/* Modules */}
      {viewLevel === 'modules' && (
        <div className="space-y-1.5">
          {CURRICULUM_MODULES.map(mod => {
            const totalUnits = mod.grades.reduce((sum, g) => sum + g.terms.reduce((s, t) => s + t.units.length, 0), 0);
            const unitsWithExercises = mod.grades.reduce((sum, g) => sum + g.terms.reduce((s, t) => s + t.units.filter(u => getExerciseCount(u.id) > 0).length, 0), 0);
            return (
              <Card
                key={mod.id}
                className="border-border/50 cursor-pointer hover:border-primary/30 transition-all active:scale-[0.98]"
                onClick={() => { setSelectedModule(mod); setViewLevel('grades'); }}
              >
                <CardContent className="p-3.5">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center text-white font-bold text-sm" style={{ backgroundColor: mod.color }}>
                      {mod.id}
                    </div>
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

      {/* Grades */}
      {viewLevel === 'grades' && selectedModule && (
        <div className="space-y-1.5">
          {selectedModule.grades.map(g => {
            const totalUnits = g.terms.reduce((s, t) => s + t.units.length, 0);
            const withEx = g.terms.reduce((s, t) => s + t.units.filter(u => getExerciseCount(u.id) > 0).length, 0);
            return (
              <Card
                key={g.grade}
                className="border-border/50 cursor-pointer hover:border-primary/30 transition-all active:scale-[0.98]"
                onClick={() => { setSelectedGrade(g.grade); setViewLevel('terms'); }}
              >
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

      {/* Terms */}
      {viewLevel === 'terms' && selectedModule && selectedGrade !== null && (
        <div className="space-y-1.5">
          {selectedModule.grades.find(g => g.grade === selectedGrade)?.terms.map(t => (
            <Card
              key={t.term}
              className="border-border/50 cursor-pointer hover:border-primary/30 transition-all active:scale-[0.98]"
              onClick={() => { setSelectedTerm(t.term); setViewLevel('units'); }}
            >
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

      {/* Units */}
      {viewLevel === 'units' && selectedModule && selectedGrade !== null && selectedTerm !== null && (
        <div className="space-y-1.5">
          {selectedModule.grades
            .find(g => g.grade === selectedGrade)
            ?.terms.find(t => t.term === selectedTerm)
            ?.units.map(unit => {
              const exCount = getExerciseCount(unit.id);
              return (
                <Card
                  key={unit.id}
                  className="border-border/50 cursor-pointer hover:border-primary/30 transition-all active:scale-[0.98]"
                  onClick={() => { setSelectedUnit(unit); setViewLevel('exercises'); }}
                >
                  <CardContent className="p-3.5 flex items-center justify-between">
                    <div>
                      <p className="font-medium text-foreground text-sm">{unit.name}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {exCount > 0 ? `${exCount} exercise${exCount !== 1 ? 's' : ''}` : 'No exercises yet'}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {exCount > 0 && <Badge variant="secondary" className="text-[10px]">{exCount}</Badge>}
                      <ChevronRight className="w-5 h-5 text-muted-foreground" />
                    </div>
                  </CardContent>
                </Card>
              );
            })}
        </div>
      )}

      {/* Exercises */}
      {viewLevel === 'exercises' && selectedUnit && (
        <div>
          <p className="text-sm font-medium text-foreground mb-3">{selectedUnit.name}</p>

          {unitItems.length === 0 ? (
            /* ── Generation Form ── */
            <Card className="border-border/50">
              <CardContent className="p-4 space-y-4">
                <div>
                  <Label className="text-sm font-medium">Last exercise number</Label>
                  <p className="text-xs text-muted-foreground mb-1.5">
                    e.g., enter <span className="font-mono">6</span> to create {unitNumber}.1 through {unitNumber}.6
                  </p>
                  <Input
                    value={lastExNum}
                    onChange={e => setLastExNum(e.target.value)}
                    placeholder={`e.g., 6 or ${unitNumber}.6`}
                    className="font-mono"
                  />
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

                <Button onClick={handleGenerate} className="w-full rounded-xl">
                  Generate Exercises
                </Button>
              </CardContent>
            </Card>
          ) : (
            /* ── Exercise & Concept List ── */
            <>
              <div className="space-y-0">
                {/* Insert before first item */}
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

                {unitItems.map((item, idx) => {
                  const isConcept = item.type === 'concept';

                  return (
                    <div key={item._id}>
                      {isConcept ? (
                        /* Concept row */
                        <div className="flex items-center gap-2 py-2 px-3 bg-accent/50 rounded-lg my-0.5">
                          <BookOpen className="w-4 h-4 text-primary shrink-0" />
                          <span className="text-sm font-medium text-primary flex-1">{item.name}</span>
                          <button
                            onClick={() => handleDelete(item._id, 'concept')}
                            className="w-6 h-6 rounded-lg flex items-center justify-center hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : (
                        /* Exercise row */
                        <Card className="border-border/50 my-0.5">
                          <CardContent className="p-2.5">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-mono font-medium text-foreground w-12 shrink-0">
                                {item.name}
                              </span>
                              {item.name.endsWith('.0') && (
                                <Badge variant="secondary" className="text-[10px] shrink-0">Review</Badge>
                              )}
                              <div className="flex-1" />
                              <Input
                                key={`${item._id}-${item.questionCount}`}
                                type="number"
                                min={1}
                                defaultValue={item.questionCount || ''}
                                placeholder="Qs"
                                className="w-16 h-8 text-sm text-center font-mono"
                                onBlur={e => handleCountBlur(item._id, item.questionCount, e.target.value)}
                              />
                              <span className="text-[11px] text-muted-foreground shrink-0">qs</span>
                              {item.questionCount > 0 && (
                                <button
                                  onClick={() =>
                                    setExpandedSubQId(prev => (prev === item._id ? null : item._id))
                                  }
                                  className={`relative w-7 h-7 rounded-lg flex items-center justify-center active:scale-90 transition-all
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
                              <button
                                onClick={() => handleDelete(item._id)}
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

                      {/* Insert after this item */}
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

              {/* Add more exercises */}
              {!addMoreOpen ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full rounded-xl mt-3 gap-1.5"
                  onClick={() => setAddMoreOpen(true)}
                >
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
                      <Button variant="ghost" size="sm" onClick={() => { setAddMoreOpen(false); setAddMoreNum(''); }}>
                        Cancel
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </div>
      )}

      {/* Concept Dialog */}
      <Dialog open={conceptDialogOpen} onOpenChange={setConceptDialogOpen}>
        <DialogContent className="max-w-sm mx-auto">
          <DialogHeader>
            <DialogTitle>Add Concept</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-sm">Concept / Theory Name</Label>
              <Input
                value={conceptName}
                onChange={e => setConceptName(e.target.value)}
                placeholder="e.g., Pythagorean Theorem"
                className="mt-1"
                autoFocus
              />
            </div>
            <Button onClick={handleSaveConcept} className="w-full rounded-xl">Add Concept</Button>
          </div>
        </DialogContent>
      </Dialog>

    </div>
  );
}
