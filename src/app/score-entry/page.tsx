'use client';

import { useState, useMemo } from 'react';
import { useQuery, useMutation } from 'convex/react';
import { ChevronLeft, Check, ChevronRight } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { getTodayDateStr } from '@/lib/types';
import { api } from '@/lib/convex';
import { CURRICULUM_MODULES, getModuleForDay, getOrderedUnits, findUnit } from '@/lib/curriculum-data';
import { getTotalCorrectForDay, calculateDailyPoints, getStudentNextExercise } from '@/lib/scoring';
import { toast } from 'sonner';
import type { Id } from '@/lib/convex';

type Step = 'select-student' | 'select-exercise' | 'mark-questions' | 'saved';

interface SelectedExercise {
  _id: Id<"exercises">;
  unitId: string;
  name: string;
  questionCount: number;
  order: number;
}

export default function ScoreEntryPage() {
  const [step, setStep] = useState<Step>('select-student');
  const [selectedGroup, setSelectedGroup] = useState<string>('all');
  const [selectedStudentId, setSelectedStudentId] = useState<Id<"students"> | null>(null);
  const [selectedExercise, setSelectedExercise] = useState<SelectedExercise | null>(null);
  const [selectedUnitId, setSelectedUnitId] = useState<string>('');
  const [selectedModuleId, setSelectedModuleId] = useState<string>('');
  const [questionStates, setQuestionStates] = useState<Record<number, 'correct' | 'wrong' | 'unmarked'>>({});
  const [existingEntryId, setExistingEntryId] = useState<Id<"entries"> | null>(null);

  // Browse mode state
  const [browseMode, setBrowseMode] = useState(false);
  const [browseModule, setBrowseModule] = useState<string>('');
  const [browseGrade, setBrowseGrade] = useState<string>('');
  const [browseTerm, setBrowseTerm] = useState<string>('');

  const today = getTodayDateStr();
  const todayModule = getModuleForDay(new Date().getDay());

  const students = useQuery(api.students.list);
  const allEntries = useQuery(api.entries.list);
  const todayEntries = useQuery(api.entries.getByDate, { date: today });
  const allExercises = useQuery(api.exercises.list);

  const addEntryMutation = useMutation(api.entries.add);
  const updateEntryMutation = useMutation(api.entries.update);

  const groups = useMemo(() => {
    if (!students) return [];
    return [...new Set(students.map(s => s.group).filter(Boolean))];
  }, [students]);

  const filteredStudents = useMemo(() => {
    if (!students || !todayEntries) return [];
    const list = selectedGroup === 'all' ? students : students.filter(s => s.group === selectedGroup);
    const entered = new Set(todayEntries.map(e => e.studentId));
    return [...list].sort((a, b) => {
      const aHas = entered.has(a._id) ? 1 : 0;
      const bHas = entered.has(b._id) ? 1 : 0;
      return aHas - bHas;
    });
  }, [students, selectedGroup, todayEntries]);

  if (!students || !allEntries || !todayEntries || !allExercises) {
    return (
      <div className="px-4 pt-5 pb-6 max-w-lg mx-auto">
        <h1 className="text-lg font-bold text-foreground mb-4">Enter Scores</h1>
        <div className="animate-pulse space-y-2">
          {[1, 2, 3].map(i => <div key={i} className="h-16 bg-muted rounded-xl" />)}
        </div>
      </div>
    );
  }

  const selectedStudent = selectedStudentId ? students.find(s => s._id === selectedStudentId) : null;
  const studentsWithEntries = new Set(todayEntries.map(e => e.studentId));

  // Step 1 handlers
  const selectStudent = (studentId: Id<"students">) => {
    setSelectedStudentId(studentId);
    setBrowseMode(false);

    if (todayModule) {
      const orderedUnits = getOrderedUnits(todayModule.id);
      const next = getStudentNextExercise(studentId, todayModule.id, allEntries, allExercises, orderedUnits);
      if (next) {
        const exercise = allExercises.find(e => e._id === next.exerciseId);
        if (exercise) {
          setSelectedExercise(exercise);
          setSelectedUnitId(next.unitId);
          setSelectedModuleId(todayModule.id);
          const existing = todayEntries.find(e => e.studentId === studentId && e.exerciseId === exercise._id);
          if (existing) {
            setExistingEntryId(existing._id);
            const states: Record<number, 'correct' | 'wrong' | 'unmarked'> = {};
            for (let i = 1; i <= exercise.questionCount; i++) {
              states[i] = existing.questions[String(i)] || 'unmarked';
            }
            setQuestionStates(states);
          } else {
            setExistingEntryId(null);
            const states: Record<number, 'correct' | 'wrong' | 'unmarked'> = {};
            for (let i = 1; i <= exercise.questionCount; i++) states[i] = 'unmarked';
            setQuestionStates(states);
          }
          setStep('select-exercise');
          return;
        }
      }
    }
    setStep('select-exercise');
  };

  const toggleQuestion = (qNum: number) => {
    setQuestionStates(prev => {
      const current = prev[qNum];
      let next: 'correct' | 'wrong' | 'unmarked';
      if (current === 'unmarked') next = 'correct';
      else if (current === 'correct') next = 'wrong';
      else next = 'unmarked';
      return { ...prev, [qNum]: next };
    });
  };

  const correctCount = Object.values(questionStates).filter(v => v === 'correct').length;
  const wrongCount = Object.values(questionStates).filter(v => v === 'wrong').length;
  const attempted = correctCount + wrongCount;

  const studentDayEntries = selectedStudentId
    ? todayEntries.filter(e => e.studentId === selectedStudentId)
    : [];
  const priorCorrectToday = getTotalCorrectForDay(studentDayEntries, existingEntryId || undefined);
  const totalCorrectToday = priorCorrectToday + correctCount;
  const dailyPoints = calculateDailyPoints(totalCorrectToday);

  const pointsThisEntry = (() => {
    let pts = 0;
    for (let i = 1; i <= correctCount; i++) {
      pts += (priorCorrectToday + i) * 5;
    }
    return pts;
  })();

  const handleSave = async () => {
    if (!selectedStudentId || !selectedExercise) return;

    const questions: Record<string, 'correct' | 'wrong'> = {};
    for (const [k, v] of Object.entries(questionStates)) {
      if (v !== 'unmarked') questions[k] = v;
    }

    if (existingEntryId) {
      await updateEntryMutation({
        id: existingEntryId,
        questions,
        correctCount,
        totalAttempted: attempted,
      });
    } else {
      await addEntryMutation({
        studentId: selectedStudentId,
        date: today,
        exerciseId: selectedExercise._id,
        unitId: selectedUnitId,
        moduleId: selectedModuleId,
        questions,
        correctCount,
        totalAttempted: attempted,
      });
    }

    toast.success(`${selectedStudent?.name}: ${correctCount} correct = ${pointsThisEntry} pts`);
    handleNextStudent();
  };

  const handleNextStudent = () => {
    setSelectedStudentId(null);
    setSelectedExercise(null);
    setQuestionStates({});
    setExistingEntryId(null);
    setBrowseMode(false);
    setStep('select-student');
  };

  const handleAnotherExercise = () => {
    setSelectedExercise(null);
    setQuestionStates({});
    setExistingEntryId(null);
    setBrowseMode(false);
    setStep('select-exercise');
  };

  const confirmExercise = () => {
    if (selectedExercise) {
      const states: Record<number, 'correct' | 'wrong' | 'unmarked'> = {};
      const existing = todayEntries.find(e => e.studentId === selectedStudentId && e.exerciseId === selectedExercise._id);
      if (existing) {
        setExistingEntryId(existing._id);
        for (let i = 1; i <= selectedExercise.questionCount; i++) {
          states[i] = existing.questions[String(i)] || 'unmarked';
        }
      } else {
        setExistingEntryId(null);
        for (let i = 1; i <= selectedExercise.questionCount; i++) states[i] = 'unmarked';
      }
      setQuestionStates(states);
      setStep('mark-questions');
    }
  };

  const selectBrowseExercise = (exercise: SelectedExercise, unitId: string, moduleId: string) => {
    setSelectedExercise(exercise);
    setSelectedUnitId(unitId);
    setSelectedModuleId(moduleId);
    const states: Record<number, 'correct' | 'wrong' | 'unmarked'> = {};
    const existing = todayEntries.find(e => e.studentId === selectedStudentId && e.exerciseId === exercise._id);
    if (existing) {
      setExistingEntryId(existing._id);
      for (let i = 1; i <= exercise.questionCount; i++) {
        states[i] = existing.questions[String(i)] || 'unmarked';
      }
    } else {
      setExistingEntryId(null);
      for (let i = 1; i <= exercise.questionCount; i++) states[i] = 'unmarked';
    }
    setQuestionStates(states);
    setStep('mark-questions');
  };

  // Step indicator
  const steps = ['Student', 'Exercise', 'Questions', 'Done'];
  const stepIndex = step === 'select-student' ? 0 : step === 'select-exercise' ? 1 : step === 'mark-questions' ? 2 : 3;

  return (
    <div className="px-4 pt-5 pb-6 max-w-lg mx-auto">
      {/* Header */}
      <div className="flex items-center gap-2 mb-4">
        {step !== 'select-student' && (
          <button
            className="w-8 h-8 rounded-xl flex items-center justify-center hover:bg-muted transition-colors"
            onClick={() => {
              if (step === 'mark-questions') setStep('select-exercise');
              else if (step === 'select-exercise') { setStep('select-student'); setSelectedStudentId(null); }
              else if (step === 'saved') handleNextStudent(); // kept for safety
            }}
          >
            <ChevronLeft className="w-5 h-5 text-muted-foreground" />
          </button>
        )}
        <div className="flex-1">
          <h1 className="text-lg font-bold text-foreground">Enter Scores</h1>
          {todayModule && (
            <p className="text-xs font-medium" style={{ color: todayModule.color }}>
              {todayModule.id}: {todayModule.name}
            </p>
          )}
        </div>
      </div>

      {/* Step progress indicator */}
      <div className="flex items-center gap-1 mb-5">
        {steps.map((s, i) => (
          <div key={s} className="flex items-center flex-1">
            <div className={`h-1 w-full rounded-full transition-colors ${
              i <= stepIndex ? 'bg-primary' : 'bg-muted'
            }`} />
          </div>
        ))}
      </div>

      {/* Step 1: Select Student */}
      {step === 'select-student' && (
        <div>
          <div className="mb-3">
            <Select value={selectedGroup} onValueChange={(v) => setSelectedGroup(v ?? 'all')}>
              <SelectTrigger className="h-10 text-sm">
                <SelectValue placeholder="Filter by group" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Groups</SelectItem>
                {groups.map(g => (
                  <SelectItem key={g} value={g}>{g}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            {filteredStudents.map(student => {
              const hasEntry = studentsWithEntries.has(student._id);
              const studentDayEntries = todayEntries.filter(e => e.studentId === student._id);
              const dayCorrect = studentDayEntries.reduce((sum, e) => sum + e.correctCount, 0);
              return (
                <Card
                  key={student._id}
                  className={`cursor-pointer transition-all active:scale-[0.98] border-border/50 ${
                    hasEntry ? 'bg-primary/5 border-primary/20' : 'hover:border-primary/30'
                  }`}
                  onClick={() => selectStudent(student._id)}
                >
                  <CardContent className="p-3 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      {hasEntry ? (
                        <div className="w-7 h-7 rounded-full bg-primary/15 flex items-center justify-center">
                          <Check className="w-4 h-4 text-primary" />
                        </div>
                      ) : (
                        <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center">
                          <span className="text-xs font-semibold text-muted-foreground">
                            {student.name.charAt(0).toUpperCase()}
                          </span>
                        </div>
                      )}
                      <div>
                        <p className="font-medium text-foreground text-sm">{student.name}</p>
                        <p className="text-xs text-muted-foreground">Grade {student.schoolGrade}{student.group ? ` · ${student.group}` : ''}</p>
                      </div>
                    </div>
                    {hasEntry && (
                      <Badge variant="secondary" className="text-xs">{dayCorrect} correct</Badge>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {/* Step 2: Select Exercise */}
      {step === 'select-exercise' && selectedStudent && (
        <div>
          <Card className="border-border/50 mb-4">
            <CardContent className="p-3">
              <p className="font-semibold text-foreground">{selectedStudent.name}</p>
              <p className="text-xs text-muted-foreground">Grade {selectedStudent.schoolGrade}</p>
            </CardContent>
          </Card>

          {selectedExercise && !browseMode && (
            <div className="mb-4">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Suggested Next</p>
              <Card className="border-primary/30 bg-primary/5 cursor-pointer active:scale-[0.98] transition-all" onClick={confirmExercise}>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-semibold text-foreground">{selectedExercise.name}</p>
                      {(() => {
                        const unitInfo = findUnit(selectedUnitId);
                        return unitInfo ? (
                          <p className="text-xs text-muted-foreground mt-0.5">
                            Grade {unitInfo.grade} · {unitInfo.unit.name}
                          </p>
                        ) : null;
                      })()}
                      <p className="text-xs text-muted-foreground mt-1">{selectedExercise.questionCount} questions</p>
                    </div>
                    <Button size="sm">Start</Button>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          <Button variant="outline" className="w-full mb-4" onClick={() => setBrowseMode(!browseMode)}>
            {browseMode ? 'Hide Browser' : 'Browse All Exercises'}
          </Button>

          {browseMode && (
            <div className="space-y-3">
              <Select value={browseModule} onValueChange={(v) => { setBrowseModule(v ?? ''); setBrowseGrade(''); setBrowseTerm(''); }}>
                <SelectTrigger className="h-10 text-sm"><SelectValue placeholder="Select Module" /></SelectTrigger>
                <SelectContent>
                  {CURRICULUM_MODULES.map(m => (
                    <SelectItem key={m.id} value={m.id}>{m.id}: {m.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {browseModule && (() => {
                const mod = CURRICULUM_MODULES.find(m => m.id === browseModule)!;
                return (
                  <>
                    <Select value={browseGrade} onValueChange={(v) => { setBrowseGrade(v ?? ''); setBrowseTerm(''); }}>
                      <SelectTrigger className="h-10 text-sm"><SelectValue placeholder="Select Grade" /></SelectTrigger>
                      <SelectContent>
                        {mod.grades.map(g => (
                          <SelectItem key={g.grade} value={String(g.grade)}>Grade {g.grade}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    {browseGrade && (() => {
                      const grade = mod.grades.find(g => g.grade === parseInt(browseGrade))!;
                      return (
                        <>
                          <Select value={browseTerm} onValueChange={(v) => { setBrowseTerm(v ?? ''); }}>
                            <SelectTrigger className="h-10 text-sm"><SelectValue placeholder="Select Term" /></SelectTrigger>
                            <SelectContent>
                              {grade.terms.map(t => (
                                <SelectItem key={t.term} value={String(t.term)}>Term {t.term}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>

                          {browseTerm && (() => {
                            const term = grade.terms.find(t => t.term === parseInt(browseTerm))!;
                            return (
                              <div className="space-y-3">
                                {term.units.map(unit => {
                                  const unitExercises = allExercises.filter(e => e.unitId === unit.id).sort((a, b) => a.order - b.order);
                                  return (
                                    <div key={unit.id}>
                                      <p className="text-sm font-medium text-foreground mb-1.5">{unit.name}</p>
                                      {unitExercises.length === 0 ? (
                                        <p className="text-xs text-muted-foreground ml-2">No exercises</p>
                                      ) : (
                                        <div className="space-y-1 ml-2">
                                          {unitExercises.map(ex => (
                                            <Card
                                              key={ex._id}
                                              className="border-border/50 cursor-pointer hover:border-primary/30 transition-all active:scale-[0.98]"
                                              onClick={() => selectBrowseExercise(ex, unit.id, browseModule)}
                                            >
                                              <CardContent className="p-2.5 flex items-center justify-between">
                                                <div>
                                                  <p className="text-sm font-medium text-foreground">{ex.name}</p>
                                                  <p className="text-xs text-muted-foreground">{ex.questionCount} questions</p>
                                                </div>
                                                <ChevronRight className="w-4 h-4 text-muted-foreground" />
                                              </CardContent>
                                            </Card>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            );
                          })()}
                        </>
                      );
                    })()}
                  </>
                );
              })()}
            </div>
          )}
        </div>
      )}

      {/* Step 3: Mark Questions */}
      {step === 'mark-questions' && selectedStudent && selectedExercise && (
        <div>
          <Card className="border-border/50 mb-4">
            <CardContent className="p-3">
              <p className="font-semibold text-foreground">{selectedStudent.name}</p>
              <p className="text-sm text-muted-foreground mt-0.5">{selectedExercise.name} — {selectedExercise.questionCount} questions</p>
              {(() => {
                const unitInfo = findUnit(selectedUnitId);
                return unitInfo ? (
                  <p className="text-xs text-muted-foreground">Grade {unitInfo.grade} · {unitInfo.unit.name}</p>
                ) : null;
              })()}
            </CardContent>
          </Card>

          {/* Stats bar */}
          <div className="grid grid-cols-3 gap-2 mb-4">
            <div className="bg-muted rounded-xl p-2.5 text-center">
              <p className="text-lg font-bold text-foreground">{attempted}</p>
              <p className="text-[10px] text-muted-foreground">Attempted</p>
            </div>
            <div className="bg-emerald-500/10 rounded-xl p-2.5 text-center">
              <p className="text-lg font-bold text-emerald-500">{correctCount}</p>
              <p className="text-[10px] text-emerald-500/70">Correct</p>
            </div>
            <div className="bg-primary/10 rounded-xl p-2.5 text-center">
              <p className="text-lg font-bold text-primary">{pointsThisEntry}</p>
              <p className="text-[10px] text-primary/70">Points</p>
            </div>
          </div>

          {/* Daily total */}
          <div className="bg-gradient-to-r from-primary to-teal-400 rounded-xl p-3.5 mb-4 text-white">
            <div className="flex justify-between items-center">
              <div>
                <p className="text-xs opacity-75 font-medium">Daily Total</p>
                <p className="text-2xl font-bold">{dailyPoints} pts</p>
              </div>
              <div className="text-right">
                <p className="text-xs opacity-75 font-medium">Correct Today</p>
                <p className="text-xl font-bold">{totalCorrectToday}</p>
              </div>
            </div>
            {correctCount > 0 && (
              <div className="flex gap-1 mt-2.5 flex-wrap">
                {Array.from({ length: correctCount }, (_, i) => (
                  <span key={i} className="text-[10px] bg-white/20 rounded-md px-1.5 py-0.5 font-medium">
                    +{(priorCorrectToday + i + 1) * 5}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Quick actions */}
          <div className="flex gap-2 mb-3">
            <Button
              variant="outline"
              size="sm"
              className="flex-1 rounded-xl text-xs gap-1 border-emerald-500/30 text-emerald-600 hover:bg-emerald-500/10"
              onClick={() => {
                const states: Record<number, 'correct' | 'wrong' | 'unmarked'> = {};
                for (let i = 1; i <= selectedExercise.questionCount; i++) states[i] = 'correct';
                setQuestionStates(states);
              }}
            >
              <Check className="w-3.5 h-3.5" /> All Correct
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="flex-1 rounded-xl text-xs gap-1"
              onClick={() => {
                setQuestionStates(prev => {
                  const next = { ...prev };
                  for (let i = 1; i <= selectedExercise.questionCount; i++) {
                    if (next[i] === 'unmarked') next[i] = 'correct';
                  }
                  return next;
                });
              }}
            >
              <Check className="w-3.5 h-3.5" /> Rest Correct
            </Button>
          </div>

          {/* Question grid */}
          <div className="grid grid-cols-5 gap-2 mb-4">
            {Array.from({ length: selectedExercise.questionCount }, (_, i) => {
              const qNum = i + 1;
              const state = questionStates[qNum] || 'unmarked';
              return (
                <button
                  key={qNum}
                  onClick={() => toggleQuestion(qNum)}
                  className={`
                    h-12 rounded-xl font-bold text-sm transition-all active:scale-90
                    ${state === 'correct' ? 'bg-emerald-500 text-white shadow-md shadow-emerald-500/25' : ''}
                    ${state === 'wrong' ? 'bg-red-500 text-white shadow-md shadow-red-500/25' : ''}
                    ${state === 'unmarked' ? 'bg-muted text-muted-foreground hover:bg-muted/80' : ''}
                  `}
                >
                  {state === 'correct' && '✓'}
                  {state === 'wrong' && '✗'}
                  {state === 'unmarked' && qNum}
                </button>
              );
            })}
          </div>

          <Button onClick={handleSave} className="w-full h-12 text-base font-semibold rounded-xl">
            Save Entry
          </Button>
        </div>
      )}

      {/* Step 4 removed: auto-advances to student list after save */}
    </div>
  );
}
