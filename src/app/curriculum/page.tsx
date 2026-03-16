'use client';

import { useState } from 'react';
import { useQuery, useMutation } from 'convex/react';
import { ChevronLeft, ChevronRight, Plus, Pencil, Trash2 } from 'lucide-react';
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

type ViewLevel = 'modules' | 'grades' | 'terms' | 'units' | 'exercises';

export default function CurriculumPage() {
  const [viewLevel, setViewLevel] = useState<ViewLevel>('modules');
  const [selectedModule, setSelectedModule] = useState<CurriculumModule | null>(null);
  const [selectedGrade, setSelectedGrade] = useState<number | null>(null);
  const [selectedTerm, setSelectedTerm] = useState<number | null>(null);
  const [selectedUnit, setSelectedUnit] = useState<{ id: string; name: string } | null>(null);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingExerciseId, setEditingExerciseId] = useState<Id<"exercises"> | null>(null);
  const [exName, setExName] = useState('');
  const [exCount, setExCount] = useState('');

  const allExercises = useQuery(api.exercises.list);
  const addExerciseMutation = useMutation(api.exercises.add);
  const updateExerciseMutation = useMutation(api.exercises.update);
  const removeExerciseMutation = useMutation(api.exercises.remove);

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

  const unitExercises = selectedUnit
    ? allExercises.filter(e => e.unitId === selectedUnit.id).sort((a, b) => a.order - b.order)
    : [];

  const getExerciseCount = (unitId: string) => allExercises.filter(e => e.unitId === unitId).length;

  const handleBack = () => {
    if (viewLevel === 'exercises') { setViewLevel('units'); setSelectedUnit(null); }
    else if (viewLevel === 'units') { setViewLevel('terms'); setSelectedTerm(null); }
    else if (viewLevel === 'terms') { setViewLevel('grades'); setSelectedGrade(null); }
    else if (viewLevel === 'grades') { setViewLevel('modules'); setSelectedModule(null); }
  };

  const handleSaveExercise = async () => {
    if (!exName.trim() || !exCount || parseInt(exCount) <= 0) {
      toast.error('Valid name and question count required');
      return;
    }
    if (editingExerciseId) {
      await updateExerciseMutation({ id: editingExerciseId, name: exName.trim(), questionCount: parseInt(exCount) });
      toast.success('Exercise updated');
    } else {
      const order = unitExercises.length;
      await addExerciseMutation({ unitId: selectedUnit!.id, name: exName.trim(), questionCount: parseInt(exCount), order });
      toast.success('Exercise added');
    }
    setDialogOpen(false);
    setEditingExerciseId(null);
    setExName('');
    setExCount('');
  };

  const handleDeleteExercise = async (id: Id<"exercises">) => {
    if (confirm('Delete this exercise and all related scores?')) {
      await removeExerciseMutation({ id });
      toast.success('Exercise deleted');
    }
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
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-medium text-foreground">{selectedUnit.name}</p>
            <Button size="sm" className="rounded-xl gap-1.5" onClick={() => { setEditingExerciseId(null); setExName(''); setExCount(''); setDialogOpen(true); }}>
              <Plus className="w-3.5 h-3.5" />
              Add
            </Button>
          </div>
          {unitExercises.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No exercises added yet</p>
          ) : (
            <div className="space-y-1.5">
              {unitExercises.map(ex => (
                <Card key={ex._id} className="border-border/50">
                  <CardContent className="p-3 flex items-center justify-between">
                    <div>
                      <p className="font-medium text-foreground text-sm">{ex.name}</p>
                      <p className="text-xs text-muted-foreground">{ex.questionCount} questions</p>
                    </div>
                    <div className="flex gap-0.5">
                      <Button variant="ghost" size="icon-xs" onClick={() => { setEditingExerciseId(ex._id); setExName(ex.name); setExCount(String(ex.questionCount)); setDialogOpen(true); }}>
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon-xs" className="text-destructive hover:text-destructive" onClick={() => handleDeleteExercise(ex._id)}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-sm mx-auto">
          <DialogHeader>
            <DialogTitle>{editingExerciseId ? 'Edit Exercise' : 'Add Exercise'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-sm">Exercise Name</Label>
              <Input value={exName} onChange={e => setExName(e.target.value)} placeholder="e.g., Ex 3.1" className="mt-1" />
            </div>
            <div>
              <Label className="text-sm">Number of Questions</Label>
              <Input type="number" min={1} value={exCount} onChange={e => setExCount(e.target.value)} placeholder="e.g., 12" className="mt-1" />
            </div>
            <Button onClick={handleSaveExercise} className="w-full rounded-xl">{editingExerciseId ? 'Update' : 'Add'}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
