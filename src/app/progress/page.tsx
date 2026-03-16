'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect } from 'react';
import { useQuery } from 'convex/react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { api } from '@/lib/convex';
import { CURRICULUM_MODULES, getOrderedUnits } from '@/lib/curriculum-data';

function ProgressContent() {
  const searchParams = useSearchParams();
  const [selectedStudentId, setSelectedStudentId] = useState<string>('');
  const [activeModule, setActiveModule] = useState('M1');

  const students = useQuery(api.students.list);
  const allEntries = useQuery(api.entries.list);
  const allExercises = useQuery(api.exercises.list);

  useEffect(() => {
    const id = searchParams.get('id');
    if (id) setSelectedStudentId(id);
  }, [searchParams]);

  if (!students || !allEntries || !allExercises) {
    return (
      <div className="px-4 pt-5 pb-6 max-w-lg mx-auto">
        <h1 className="text-lg font-bold text-foreground mb-4">Student Progress</h1>
        <div className="animate-pulse space-y-2">
          <div className="h-10 bg-muted rounded-xl" />
          <div className="h-32 bg-muted rounded-xl" />
        </div>
      </div>
    );
  }

  const student = students.find(s => s._id === selectedStudentId);
  const studentEntries = allEntries.filter(e => e.studentId === selectedStudentId);

  const totalCorrect = studentEntries.reduce((sum, e) => sum + e.correctCount, 0);
  const totalAttempted = studentEntries.reduce((sum, e) => sum + e.totalAttempted, 0);
  const accuracy = totalAttempted > 0 ? Math.round((totalCorrect / totalAttempted) * 100) : 0;
  const completedExercises = new Set(
    studentEntries
      .filter(e => {
        const ex = allExercises.find(x => x._id === e.exerciseId);
        return ex && e.correctCount >= ex.questionCount;
      })
      .map(e => e.exerciseId)
  ).size;

  const mod = CURRICULUM_MODULES.find(m => m.id === activeModule);

  const getModuleProgress = (moduleId: string) => {
    const orderedUnits = getOrderedUnits(moduleId);
    const totalExCount = orderedUnits.reduce((sum, u) => sum + allExercises.filter(e => e.unitId === u.id).length, 0);
    if (totalExCount === 0) return 0;

    let completed = 0;
    for (const unit of orderedUnits) {
      const unitExercises = allExercises.filter(e => e.unitId === unit.id);
      for (const ex of unitExercises) {
        const entry = studentEntries.find(e => e.exerciseId === ex._id);
        if (entry && entry.correctCount >= ex.questionCount) completed++;
      }
    }
    return Math.round((completed / totalExCount) * 100);
  };

  return (
    <div className="px-4 pt-5 pb-6 max-w-lg mx-auto">
      <h1 className="text-lg font-bold text-foreground mb-4">Student Progress</h1>

      <select
        value={selectedStudentId}
        onChange={(e) => setSelectedStudentId(e.target.value)}
        className="w-full h-10 mb-4 px-3 text-sm border border-border rounded-xl bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
      >
        <option value="">Select a student</option>
        {students.map(s => (
          <option key={s._id} value={s._id}>{s.name} (G{s.schoolGrade})</option>
        ))}
      </select>

      {student && (
        <>
          {/* Stats */}
          <div className="grid grid-cols-3 gap-2 mb-4">
            <Card className="border-border/50">
              <CardContent className="p-2.5 text-center">
                <p className="text-lg font-bold text-foreground">{completedExercises}</p>
                <p className="text-[10px] text-muted-foreground">Completed</p>
              </CardContent>
            </Card>
            <Card className="border-border/50">
              <CardContent className="p-2.5 text-center">
                <p className="text-lg font-bold text-primary">{totalCorrect}</p>
                <p className="text-[10px] text-muted-foreground">Correct</p>
              </CardContent>
            </Card>
            <Card className="border-border/50">
              <CardContent className="p-2.5 text-center">
                <p className="text-lg font-bold text-amber-500">{accuracy}%</p>
                <p className="text-[10px] text-muted-foreground">Accuracy</p>
              </CardContent>
            </Card>
          </div>

          {/* Module tabs */}
          <div className="flex gap-1.5 mb-4 overflow-x-auto pb-1">
            {CURRICULUM_MODULES.map(m => (
              <button
                key={m.id}
                onClick={() => setActiveModule(m.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-all ${
                  activeModule === m.id ? 'text-white shadow-sm' : 'text-muted-foreground bg-muted'
                }`}
                style={activeModule === m.id ? { backgroundColor: m.color } : {}}
              >
                {m.id}
              </button>
            ))}
          </div>

          {/* Progress bar */}
          {mod && (
            <div className="mb-4">
              <div className="flex justify-between items-center mb-1.5">
                <p className="text-sm font-medium text-foreground">{mod.name}</p>
                <p className="text-xs text-muted-foreground">{getModuleProgress(mod.id)}%</p>
              </div>
              <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                <div className="h-full rounded-full transition-all" style={{ width: `${getModuleProgress(mod.id)}%`, backgroundColor: mod.color }} />
              </div>
            </div>
          )}

          {/* Curriculum tree */}
          {mod && mod.grades.map(grade => (
            <div key={grade.grade} className="mb-4">
              <h3 className="text-sm font-bold text-foreground mb-2">Grade {grade.grade}</h3>
              {grade.terms.map(term => (
                <div key={term.term} className="mb-3 ml-2">
                  <p className="text-xs font-semibold text-muted-foreground mb-1">
                    {term.term === 1 ? '1st' : term.term === 2 ? '2nd' : '3rd'} Term
                  </p>
                  {term.units.map(unit => {
                    const unitExercises = allExercises.filter(e => e.unitId === unit.id).sort((a, b) => a.order - b.order);
                    return (
                      <div key={unit.id} className="ml-2 mb-2">
                        <p className="text-xs font-medium text-foreground">{unit.name}</p>
                        {unitExercises.length > 0 ? (
                          <div className="ml-2 mt-1 space-y-1">
                            {unitExercises.map(ex => {
                              const entry = studentEntries.find(e => e.exerciseId === ex._id);
                              let status = 'not-started';
                              if (entry) {
                                if (entry.correctCount >= ex.questionCount) status = 'completed';
                                else status = 'in-progress';
                              }
                              return (
                                <div key={ex._id} className="flex items-center justify-between py-1.5 px-2 rounded-lg bg-muted/50">
                                  <div className="flex items-center gap-2">
                                    <div className={`w-2 h-2 rounded-full ${
                                      status === 'completed' ? 'bg-emerald-500' :
                                      status === 'in-progress' ? 'bg-amber-500' : 'bg-muted-foreground/30'
                                    }`} />
                                    <span className="text-xs text-foreground">{ex.name}</span>
                                  </div>
                                  <span className="text-[10px] text-muted-foreground">
                                    {entry ? `${entry.correctCount}/${ex.questionCount}` : `0/${ex.questionCount}`}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <p className="text-[10px] text-muted-foreground ml-2 mt-0.5">No exercises</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          ))}
        </>
      )}
    </div>
  );
}

export default function ProgressPage() {
  return (
    <Suspense fallback={<div className="px-4 pt-5 max-w-lg mx-auto"><p className="text-muted-foreground">Loading...</p></div>}>
      <ProgressContent />
    </Suspense>
  );
}
