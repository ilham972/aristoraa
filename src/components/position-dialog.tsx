'use client';

import { useState, useMemo, useCallback, useEffect } from 'react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { CURRICULUM_MODULES, getOrderedUnits, getModuleById } from '@/lib/curriculum-data';
import { getStudentNextExercise, getExerciseDetails, type PositionOptions } from '@/lib/scoring';
import { X, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import type { Id } from '@/lib/convex';

// ─── Types ───

type EntryLike = { studentId: string; moduleId: string; exerciseId: string; correctCount: number; totalAttempted: number; questions?: Record<string, string>; _id?: string };
type ExerciseLike = { _id: string; unitId: string; name: string; questionCount: number; order: number; type?: string; pageNumber?: number; moduleId?: string };
type PositionLike = { studentId: string; moduleId: string; grade: number; term: number };
type StudentLike = { _id: Id<"students">; name: string; schoolGrade: number; badgeColor?: string };

interface PositionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  students: StudentLike[];
  allEntries: EntryLike[];
  allExercises: ExerciseLike[];
  modulePositions: PositionLike[];
  initialStudentId: Id<"students">;
  initialModuleId: string;
  onSelectExercise: (studentId: Id<"students">, exerciseId: string, unitId: string, moduleId: string) => void;
  onSavePosition: (studentId: Id<"students">, moduleId: string, grade: number, term: number) => Promise<void>;
}

// Term background tints
const TERM_TINTS = [
  'bg-sky-500/5 dark:bg-sky-400/5',
  'bg-violet-500/5 dark:bg-violet-400/5',
  'bg-amber-500/5 dark:bg-amber-400/5',
];

export function PositionDialog({
  open, onOpenChange, students, allEntries, allExercises, modulePositions,
  initialStudentId, initialModuleId, onSelectExercise, onSavePosition,
}: PositionDialogProps) {
  // ─── State ───
  const [activeStudentId, setActiveStudentId] = useState<Id<"students">>(initialStudentId);
  const [activeModuleId, setActiveModuleId] = useState(initialModuleId);
  const [activeGrade, setActiveGrade] = useState<number>(6);
  const [subTab, setSubTab] = useState<'progress' | 'position'>('progress');
  const [draftPositionExId, setDraftPositionExId] = useState<string | null>(null);
  const [positionDirty, setPositionDirty] = useState(false);

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setActiveStudentId(initialStudentId);
      setActiveModuleId(initialModuleId);
      setSubTab('progress');
      setDraftPositionExId(null);
      setPositionDirty(false);
      // Auto-detect grade from student's current position
      const student = students.find(s => s._id === initialStudentId);
      if (student) {
        const pos = getStudentPosition(initialStudentId, initialModuleId);
        setActiveGrade(pos?.grade ?? student.schoolGrade);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialStudentId, initialModuleId]);

  // ─── Derived ───
  const activeStudent = useMemo(() => students.find(s => s._id === activeStudentId), [students, activeStudentId]);
  const activeMod = useMemo(() => CURRICULUM_MODULES.find(m => m.id === activeModuleId), [activeModuleId]);
  const moduleGrades = useMemo(() => activeMod?.grades ?? [], [activeMod]);

  // Get student position for a module
  const getStudentPosition = useCallback((sid: string, modId: string) => {
    const override = modulePositions.find(p => p.studentId === sid && p.moduleId === modId);
    const student = students.find(s => s._id === sid);
    const grade = override?.grade ?? student?.schoolGrade ?? 6;
    const term = override?.term ?? 1;
    const units = getOrderedUnits(modId);
    const opts: PositionOptions = { positionOverride: override ? { grade: override.grade, term: override.term } : undefined, defaultGrade: student?.schoolGrade ?? 6 };
    const next = getStudentNextExercise(sid, modId, allEntries, allExercises, units, opts);
    return { grade, term, nextExerciseId: next?.exerciseId ?? null, nextUnitId: next?.unitId ?? null };
  }, [modulePositions, students, allEntries, allExercises]);

  // Current position for active student + module
  const currentPos = useMemo(
    () => getStudentPosition(activeStudentId, activeModuleId),
    [activeStudentId, activeModuleId, getStudentPosition]
  );

  // ─── Module progress for progress bars ───
  const moduleProgress = useMemo(() => {
    return CURRICULUM_MODULES.map(mod => {
      const units = getOrderedUnits(mod.id);
      const student = students.find(s => s._id === activeStudentId);
      const override = modulePositions.find(p => p.studentId === activeStudentId && p.moduleId === mod.id);
      const startGrade = override?.grade ?? student?.schoolGrade ?? 6;

      let total = 0, completed = 0;
      for (const unit of units) {
        if (unit.grade < startGrade) continue;
        const exs = allExercises.filter(e => e.unitId === unit.id && (e.type || 'exercise') === 'exercise');
        for (const ex of exs) {
          total++;
          const entry = allEntries.find(e => e.studentId === activeStudentId && e.exerciseId === ex._id);
          if (entry && entry.totalAttempted >= ex.questionCount) completed++;
        }
      }
      return { moduleId: mod.id, color: mod.color, name: mod.name, total, completed, pct: total > 0 ? Math.round((completed / total) * 100) : 0 };
    });
  }, [activeStudentId, allEntries, allExercises, modulePositions, students]);

  const overallProgress = useMemo(() => {
    const t = moduleProgress.reduce((s, m) => s + m.total, 0);
    const c = moduleProgress.reduce((s, m) => s + m.completed, 0);
    return { total: t, completed: c, pct: t > 0 ? Math.round((c / t) * 100) : 0 };
  }, [moduleProgress]);

  // ─── Exercise grid data for current module+grade ───
  const gridData = useMemo(() => {
    if (!activeMod) return [];
    const gradeData = activeMod.grades.find(g => g.grade === activeGrade);
    if (!gradeData) return [];

    const columns: Array<{
      unitId: string; unitName: string; unitLabel: string;
      grade: number; term: number;
      exercises: Array<{
        exerciseId: string; order: number; label: string; questionCount: number;
        status: 'perfect' | 'skipped' | 'wip' | 'none';
        percentage: number; hasWrong: boolean;
        isCurrentPosition: boolean;
      }>;
    }> = [];

    let unitIdx = 0;
    for (const term of gradeData.terms) {
      for (const unit of term.units) {
        unitIdx++;
        const unitNum = unit.name.match(/^(\d+)\./)?.[1] || String(unitIdx);
        const details = getExerciseDetails(activeStudentId, unit.id, allEntries, allExercises);
        columns.push({
          unitId: unit.id,
          unitName: unit.name,
          unitLabel: unitNum,
          grade: gradeData.grade,
          term: term.term,
          exercises: details.map(d => ({
            ...d,
            label: d.name.includes('.') ? (d.name.split('.').pop() ?? String(d.order)) : String(d.order),
            isCurrentPosition: d.exerciseId === currentPos.nextExerciseId,
          })),
        });
      }
    }
    return columns;
  }, [activeMod, activeGrade, activeStudentId, allEntries, allExercises, currentPos.nextExerciseId]);

  // Group columns by term for tinting
  const termGroups = useMemo(() => {
    const groups: Array<{ term: number; columns: typeof gridData }> = [];
    for (const col of gridData) {
      const last = groups[groups.length - 1];
      if (last && last.term === col.term) {
        last.columns.push(col);
      } else {
        groups.push({ term: col.term, columns: [col] });
      }
    }
    return groups;
  }, [gridData]);

  // ─── Position tab: determine which exercises are "before" the draft position ───
  const orderedExerciseIds = useMemo(() => {
    if (!activeMod) return [];
    const ids: string[] = [];
    for (const grade of activeMod.grades) {
      for (const term of grade.terms) {
        for (const unit of term.units) {
          const exs = allExercises.filter(e => e.unitId === unit.id && (e.type || 'exercise') === 'exercise').sort((a, b) => a.order - b.order);
          for (const ex of exs) ids.push(ex._id);
        }
      }
    }
    return ids;
  }, [activeMod, allExercises]);

  const draftSkippedSet = useMemo(() => {
    if (!draftPositionExId) return new Set<string>();
    const idx = orderedExerciseIds.indexOf(draftPositionExId);
    if (idx <= 0) return new Set<string>();
    return new Set(orderedExerciseIds.slice(0, idx));
  }, [draftPositionExId, orderedExerciseIds]);

  // Find grade+term for the draft position exercise
  const draftPositionInfo = useMemo(() => {
    if (!draftPositionExId || !activeMod) return null;
    for (const grade of activeMod.grades) {
      for (const term of grade.terms) {
        for (const unit of term.units) {
          const exs = allExercises.filter(e => e.unitId === unit.id && (e.type || 'exercise') === 'exercise');
          if (exs.some(e => e._id === draftPositionExId)) {
            return { grade: grade.grade, term: term.term, unitId: unit.id };
          }
        }
      }
    }
    return null;
  }, [draftPositionExId, activeMod, allExercises]);

  // ─── Handlers ───
  const handleStudentSwitch = useCallback((sid: Id<"students">) => {
    setActiveStudentId(sid);
    setDraftPositionExId(null);
    setPositionDirty(false);
    // Auto-navigate to student's current position grade
    const pos = getStudentPosition(sid, activeModuleId);
    const student = students.find(s => s._id === sid);
    // If this grade exists in the module, navigate to it
    const mod = getModuleById(activeModuleId);
    const posGrade = pos.grade;
    if (mod?.grades.some(g => g.grade === posGrade)) {
      setActiveGrade(posGrade);
    } else if (student) {
      setActiveGrade(student.schoolGrade);
    }
  }, [activeModuleId, getStudentPosition, students]);

  const handleModuleSwitch = useCallback((modId: string) => {
    setActiveModuleId(modId);
    setDraftPositionExId(null);
    setPositionDirty(false);
    // Auto-navigate to student's position grade in this module
    const pos = getStudentPosition(activeStudentId, modId);
    const mod = getModuleById(modId);
    if (mod?.grades.some(g => g.grade === pos.grade)) {
      setActiveGrade(pos.grade);
    } else {
      const student = students.find(s => s._id === activeStudentId);
      setActiveGrade(student?.schoolGrade ?? 6);
    }
  }, [activeStudentId, getStudentPosition, students]);

  const handleProgressCellTap = useCallback((exerciseId: string, unitId: string) => {
    onSelectExercise(activeStudentId, exerciseId, unitId, activeModuleId);
    onOpenChange(false);
  }, [activeStudentId, activeModuleId, onSelectExercise, onOpenChange]);

  const handlePositionCellTap = useCallback((exerciseId: string) => {
    setDraftPositionExId(exerciseId);
    setPositionDirty(true);
  }, []);

  const handleSavePosition = useCallback(async () => {
    if (!draftPositionInfo) return;
    await onSavePosition(activeStudentId, activeModuleId, draftPositionInfo.grade, draftPositionInfo.term);
    setDraftPositionExId(null);
    setPositionDirty(false);
    toast.success('Position saved');
  }, [activeStudentId, activeModuleId, draftPositionInfo, onSavePosition]);

  const handleDiscardPosition = useCallback(() => {
    setDraftPositionExId(null);
    setPositionDirty(false);
  }, []);

  // ─── Check if grade is below student's school grade ───
  const isBelowGrade = useCallback((grade: number) => {
    const student = students.find(s => s._id === activeStudentId);
    if (!student) return false;
    const override = modulePositions.find(p => p.studentId === activeStudentId && p.moduleId === activeModuleId);
    const startGrade = override?.grade ?? student.schoolGrade;
    return grade < startGrade;
  }, [activeStudentId, activeModuleId, modulePositions, students]);

  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="fixed inset-0 max-w-none w-full h-full rounded-none p-0 translate-x-0 translate-y-0 top-0 left-0 overflow-hidden flex flex-col sm:max-w-none"
      >
        {/* ═══ HEADER ═══ */}
        <div className="flex items-center justify-between px-4 pt-3 pb-2 border-b border-border/50 shrink-0">
          <div>
            <p className="text-sm font-bold text-foreground">{activeStudent?.name ?? 'Student'}</p>
            <p className="text-[10px] text-muted-foreground">Grade {activeStudent?.schoolGrade} &middot; Syllabus Progress</p>
          </div>
          <button onClick={() => onOpenChange(false)} className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center active:scale-90 transition-transform">
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* ═══ STUDENT GRID ═══ */}
          <div className="px-4 pt-3 pb-2">
            <div className="flex gap-1.5 overflow-x-auto p-1 -m-1">
              {students.map(s => (
                <button
                  key={s._id}
                  onClick={() => handleStudentSwitch(s._id)}
                  className={`shrink-0 px-3 py-1.5 rounded-xl text-[11px] font-medium transition-all active:scale-95
                    ${s._id === activeStudentId
                      ? 'bg-primary text-primary-foreground ring-2 ring-primary ring-offset-1 ring-offset-background'
                      : 'bg-muted text-muted-foreground hover:text-foreground'}`}
                >
                  {s.name.split(' ')[0]}
                </button>
              ))}
            </div>
          </div>

          {/* ═══ PROGRESS BARS ═══ */}
          <div className="px-4 pb-3">
            {/* Overall */}
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider w-10 shrink-0">All</span>
              <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${overallProgress.pct}%` }} />
              </div>
              <span className="text-[10px] font-bold text-muted-foreground w-8 text-right">{overallProgress.pct}%</span>
            </div>
            {/* Per-module */}
            <div className="grid grid-cols-6 gap-1">
              {moduleProgress.map(mp => (
                <div key={mp.moduleId} className="flex flex-col items-center">
                  <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
                    <div className="h-full rounded-full transition-all" style={{ width: `${mp.pct}%`, backgroundColor: mp.color }} />
                  </div>
                  <span className="text-[8px] font-bold mt-0.5" style={{ color: mp.color }}>{mp.pct}%</span>
                </div>
              ))}
            </div>
          </div>

          {/* ═══ MODULE BUTTONS ═══ */}
          <div className="grid grid-cols-6 gap-1 px-4 mb-3">
            {CURRICULUM_MODULES.map(mod => {
              const isActive = mod.id === activeModuleId;
              return (
                <button
                  key={mod.id}
                  onClick={() => handleModuleSwitch(mod.id)}
                  className={`py-2 rounded-xl text-[11px] font-bold transition-all active:scale-95 ${isActive ? 'text-white shadow-sm' : 'text-foreground/70'}`}
                  style={{
                    backgroundColor: isActive ? mod.color : mod.color + '15',
                    color: isActive ? '#fff' : mod.color,
                  }}
                >
                  {mod.id}
                </button>
              );
            })}
          </div>

          {/* ═══ GRADE TABS ═══ */}
          <div className="flex gap-1 px-4 mb-3 overflow-x-auto py-1">
            {moduleGrades.map(g => {
              const below = isBelowGrade(g.grade);
              const isActive = g.grade === activeGrade;
              return (
                <button
                  key={g.grade}
                  onClick={() => { setActiveGrade(g.grade); setDraftPositionExId(null); setPositionDirty(false); }}
                  className={`shrink-0 px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all active:scale-95
                    ${isActive ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground'}
                    ${below && !isActive ? 'opacity-40' : ''}`}
                >
                  G{g.grade}
                </button>
              );
            })}
          </div>

          {/* ═══ SUB-TABS: Progress | Position ═══ */}
          <div className="flex gap-1 px-4 mb-3">
            <button
              onClick={() => setSubTab('progress')}
              className={`flex-1 py-2 rounded-lg text-xs font-semibold transition-all
                ${subTab === 'progress' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}
            >
              Progress
            </button>
            <button
              onClick={() => setSubTab('position')}
              className={`flex-1 py-2 rounded-lg text-xs font-semibold transition-all
                ${subTab === 'position' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}
            >
              Position
            </button>
          </div>

          {/* ═══ EXERCISE GRID ═══ */}
          <div className="px-4 pb-4">
            {gridData.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-8">No units for this grade in {activeModuleId}</p>
            ) : (
              <div className="overflow-x-auto p-1 -m-1">
                <div className="flex gap-0.5" style={{ minWidth: 'max-content' }}>
                  {termGroups.map((group, gi) => (
                    <div key={group.term} className={`flex gap-0.5 rounded-xl p-1 ${TERM_TINTS[gi % TERM_TINTS.length]}`}>
                      {group.columns.map(col => (
                        <div key={col.unitId} className="flex flex-col items-center" style={{ minWidth: '3rem' }}>
                          {/* Unit header */}
                          <div className="text-[9px] font-bold text-muted-foreground pb-1 text-center">
                            {col.unitLabel}
                          </div>
                          {/* Exercise cells */}
                          <div className="flex flex-col gap-0.5">
                            {col.exercises.map(ex => {
                              // In position tab, check if this exercise is before the draft position
                              const isDraftSkipped = subTab === 'position' && draftSkippedSet.has(ex.exerciseId);
                              const isDraftPosition = subTab === 'position' && draftPositionExId === ex.exerciseId;

                              return (
                                <ExerciseCell
                                  key={ex.exerciseId}
                                  label={ex.label}
                                  percentage={ex.percentage}
                                  status={ex.status}
                                  hasWrong={ex.hasWrong}
                                  isCurrentPosition={ex.isCurrentPosition}
                                  isBelowGrade={isBelowGrade(col.grade)}
                                  isDraftSkipped={isDraftSkipped}
                                  isDraftPosition={isDraftPosition}
                                  isPositionTab={subTab === 'position'}
                                  onClick={() => {
                                    if (subTab === 'progress') {
                                      handleProgressCellTap(ex.exerciseId, col.unitId);
                                    } else {
                                      handlePositionCellTap(ex.exerciseId);
                                    }
                                  }}
                                />
                              );
                            })}
                          </div>
                          {/* Term label at bottom */}
                          {col === group.columns[0] && (
                            <div className="text-[8px] font-semibold text-muted-foreground/50 mt-1">T{col.term}</div>
                          )}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* ═══ COLOR LEGEND ═══ */}
          <div className="px-4 pb-3">
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              <LegendDot color="bg-emerald-500" label="Done" />
              <LegendDot color="bg-amber-500/40" label="In progress" />
              <LegendDot color="bg-muted border border-border" label="Not started" />
              <LegendDot color="bg-emerald-300 dark:bg-emerald-400/30" label="Skipped" />
              <LegendDot color="bg-red-400/40" label="Has errors" />
            </div>
          </div>
        </div>

        {/* ═══ POSITION TAB FOOTER ═══ */}
        {subTab === 'position' && positionDirty && (
          <div className="shrink-0 flex gap-2 px-4 py-3 border-t border-border/50 bg-background">
            <Button variant="outline" className="flex-1" onClick={handleDiscardPosition}>
              <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
              Discard
            </Button>
            <Button className="flex-1 bg-emerald-600 hover:bg-emerald-700" onClick={handleSavePosition}>
              Save Position
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Exercise Cell ───

function ExerciseCell({
  label, percentage, status, hasWrong, isCurrentPosition,
  isBelowGrade, isDraftSkipped, isDraftPosition, isPositionTab, onClick,
}: {
  label: string;
  percentage: number;
  status: 'perfect' | 'skipped' | 'wip' | 'none';
  hasWrong: boolean;
  isCurrentPosition: boolean;
  isBelowGrade: boolean;
  isDraftSkipped: boolean;
  isDraftPosition: boolean;
  isPositionTab: boolean;
  onClick: () => void;
}) {
  // Determine cell color
  let bgClass = '';
  let textClass = '';

  if (isDraftSkipped) {
    // Position tab: everything before draft position
    bgClass = 'bg-emerald-200 dark:bg-emerald-400/20';
    textClass = 'text-emerald-700 dark:text-emerald-300';
  } else if (status === 'perfect' && !hasWrong) {
    bgClass = 'bg-emerald-500';
    textClass = 'text-white';
  } else if (status === 'perfect' && hasWrong) {
    bgClass = 'bg-red-500/15 dark:bg-red-500/20';
    textClass = 'text-red-600 dark:text-red-300';
  } else if (status === 'wip') {
    bgClass = 'bg-amber-500/20 dark:bg-amber-500/25';
    textClass = 'text-amber-700 dark:text-amber-300';
  } else if (status === 'skipped') {
    bgClass = 'bg-emerald-200 dark:bg-emerald-400/20';
    textClass = 'text-emerald-700 dark:text-emerald-300';
  } else {
    bgClass = 'bg-muted';
    textClass = 'text-muted-foreground';
  }

  return (
    <button
      onClick={onClick}
      className={`relative w-12 h-10 rounded-lg flex flex-col items-center justify-center transition-all active:scale-90
        ${bgClass} ${textClass}
        ${isBelowGrade ? 'opacity-30' : ''}
        ${isDraftPosition ? 'ring-2 ring-primary ring-offset-1 ring-offset-background' : ''}
        ${isCurrentPosition && !isPositionTab ? 'ring-2 ring-emerald-500 ring-offset-1 ring-offset-background' : ''}`}
    >
      {/* Current position indicator */}
      {isCurrentPosition && !isPositionTab && (
        <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-emerald-500 border-2 border-background" />
      )}
      {isDraftPosition && (
        <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-primary border-2 border-background" />
      )}
      <span className="text-[11px] font-bold leading-none">{label}</span>
      {percentage > 0 && (
        <span className={`text-[8px] font-semibold leading-none mt-0.5 ${
          status === 'perfect' && hasWrong ? 'text-red-500 dark:text-red-300' :
          status === 'perfect' && !hasWrong ? 'text-emerald-100' :
          ''
        }`}>{percentage}%</span>
      )}
    </button>
  );
}

// ─── Legend Dot ───

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-1">
      <span className={`w-2 h-2 rounded-sm ${color}`} />
      <span className="text-[9px] text-muted-foreground">{label}</span>
    </div>
  );
}
