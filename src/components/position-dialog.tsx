'use client';

import { useState, useMemo, useCallback, useEffect } from 'react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { CURRICULUM_MODULES, getOrderedUnits, getModuleById } from '@/lib/curriculum-data';
import { getStudentNextExercise, getExerciseDetails, type PositionOptions } from '@/lib/scoring';
import { getTotalScoreable } from '@/lib/sub-questions';
import { resolveAssignedGrades, lowestAssignedGrade } from '@/lib/student-grades';
import { X, Layers, ArrowDownNarrowWide } from 'lucide-react';
import type { Id } from '@/lib/convex';

// ─── Types ───

type EntryLike = { studentId: string; moduleId: string; exerciseId: string; correctCount: number; totalAttempted: number; questions?: Record<string, string>; _id?: string };
type ExerciseLike = { _id: string; unitId: string; name: string; questionCount: number; order: number; type?: string; pageNumber?: number; moduleId?: string; subQuestions?: Record<string, { count: number; type: 'letter' | 'roman' }> | null };
type PositionLike = { studentId: string; moduleId: string; grade: number; term: number };
type StudentLike = {
  _id: Id<"students">;
  name: string;
  schoolGrade: number;
  badgeColor?: string;
  assignedGrades?: number[];
  assignedGradesByModule?: Record<string, number[]>;
};

interface PositionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  students: StudentLike[];
  allEntries: EntryLike[];
  allExercises: ExerciseLike[];
  modulePositions: PositionLike[];
  initialStudentId: Id<"students">;
  initialModuleId: string;
  /** If provided, dialog opens at this grade instead of auto-detecting from the student's saved position. */
  initialGrade?: number;
  onSelectExercise: (studentId: Id<"students">, exerciseId: string, unitId: string, moduleId: string) => void;
}

// Term background tints
const TERM_TINTS = [
  'bg-sky-500/5 dark:bg-sky-400/5',
  'bg-violet-500/5 dark:bg-violet-400/5',
  'bg-amber-500/5 dark:bg-amber-400/5',
];

const MODULE_VIEW_KEY = 'mt-position-module-view';
const UNIT_ORDER_KEY = 'mt-position-unit-order';

export function PositionDialog({
  open, onOpenChange, students, allEntries, allExercises, modulePositions,
  initialStudentId, initialModuleId, initialGrade, onSelectExercise,
}: PositionDialogProps) {
  // ─── State ───
  const [activeStudentId, setActiveStudentId] = useState<Id<"students">>(initialStudentId);
  const [activeModuleId, setActiveModuleId] = useState(initialModuleId);
  const [activeGrade, setActiveGrade] = useState<number>(6);
  const [moduleViewOn, setModuleViewOn] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    try { const v = localStorage.getItem(MODULE_VIEW_KEY); return v === null ? true : JSON.parse(v); } catch { return true; }
  });
  const [unitOrderOn, setUnitOrderOn] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try { const v = localStorage.getItem(UNIT_ORDER_KEY); return v === null ? false : JSON.parse(v); } catch { return false; }
  });

  // Persist toggles
  useEffect(() => {
    localStorage.setItem(MODULE_VIEW_KEY, JSON.stringify(moduleViewOn));
  }, [moduleViewOn]);
  useEffect(() => {
    localStorage.setItem(UNIT_ORDER_KEY, JSON.stringify(unitOrderOn));
  }, [unitOrderOn]);

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setActiveStudentId(initialStudentId);
      setActiveModuleId(initialModuleId);
      // Prefer explicit initialGrade (caller is pointing at a specific view);
      // otherwise auto-detect from the student's current activity-derived position.
      if (initialGrade !== undefined) {
        setActiveGrade(initialGrade);
      } else {
        const student = students.find(s => s._id === initialStudentId);
        if (student) {
          const pos = getStudentPosition(initialStudentId, initialModuleId);
          setActiveGrade(pos?.grade ?? lowestAssignedGrade(student, initialModuleId));
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialStudentId, initialModuleId, initialGrade]);

  // ─── Derived ───
  const activeStudent = useMemo(() => students.find(s => s._id === activeStudentId), [students, activeStudentId]);
  const activeMod = useMemo(() => CURRICULUM_MODULES.find(m => m.id === activeModuleId), [activeModuleId]);

  // Grades the active student is taught in the active module.
  const assignedGradesForActive = useMemo(() => {
    if (!activeStudent) return new Set<number>();
    return new Set(resolveAssignedGrades(activeStudent, activeModuleId));
  }, [activeStudent, activeModuleId]);

  // Module grade tabs filtered to the student's assigned grades
  const moduleGrades = useMemo(() => {
    if (!activeMod) return [];
    return activeMod.grades.filter((g) => assignedGradesForActive.has(g.grade));
  }, [activeMod, assignedGradesForActive]);

  // All-modules grade tabs (union of assigned grades across modules where the
  // student has assignments)
  const allModulesGradeTabs = useMemo(() => {
    if (!activeStudent) return [] as Array<{ grade: number }>;
    const set = new Set<number>();
    for (const mod of CURRICULUM_MODULES) {
      const grades = resolveAssignedGrades(activeStudent, mod.id);
      // Only include grades that actually exist in this module
      for (const g of grades) {
        if (mod.grades.some((mg) => mg.grade === g)) set.add(g);
      }
    }
    return Array.from(set).sort((a, b) => a - b).map((g) => ({ grade: g }));
  }, [activeStudent]);

  // Get student position for a module (auto-derived from activity)
  const getStudentPosition = useCallback((sid: string, modId: string) => {
    const student = students.find(s => s._id === sid);
    const override = modulePositions.find(p => p.studentId === sid && p.moduleId === modId);
    const defaultGrade = student
      ? lowestAssignedGrade(student, modId)
      : (override?.grade ?? 6);
    const grade = override?.grade ?? defaultGrade;
    const term = override?.term ?? 1;
    const units = getOrderedUnits(modId);
    const opts: PositionOptions = {
      positionOverride: override ? { grade: override.grade, term: override.term } : undefined,
      defaultGrade,
    };
    const next = getStudentNextExercise(sid, modId, allEntries, allExercises, units, opts);
    return { grade, term, nextExerciseId: next?.exerciseId ?? null, nextUnitId: next?.unitId ?? null };
  }, [modulePositions, students, allEntries, allExercises]);

  // Current position for active student + module
  const currentPos = useMemo(
    () => getStudentPosition(activeStudentId, activeModuleId),
    [activeStudentId, activeModuleId, getStudentPosition]
  );

  // ─── Module progress for progress bars ───
  // Counts only exercises within the student's assigned grades for that module.
  const moduleProgress = useMemo(() => {
    return CURRICULUM_MODULES.map(mod => {
      const units = getOrderedUnits(mod.id);
      const assigned = activeStudent
        ? new Set(resolveAssignedGrades(activeStudent, mod.id))
        : new Set<number>();

      let total = 0, completed = 0;
      for (const unit of units) {
        if (!assigned.has(unit.grade)) continue;
        const exs = allExercises.filter(e => e.unitId === unit.id && (e.type || 'exercise') === 'exercise');
        for (const ex of exs) {
          total++;
          const entry = allEntries.find(e => e.studentId === activeStudentId && e.exerciseId === ex._id);
          const effQ = getTotalScoreable(ex.questionCount, ex.subQuestions);
          if (entry && entry.totalAttempted >= effQ) completed++;
        }
      }
      return { moduleId: mod.id, color: mod.color, name: mod.name, total, completed, pct: total > 0 ? Math.round((completed / total) * 100) : 0 };
    });
  }, [activeStudentId, activeStudent, allEntries, allExercises]);

  const overallProgress = useMemo(() => {
    const t = moduleProgress.reduce((s, m) => s + m.total, 0);
    const c = moduleProgress.reduce((s, m) => s + m.completed, 0);
    return { total: t, completed: c, pct: t > 0 ? Math.round((c / t) * 100) : 0 };
  }, [moduleProgress]);

  // ─── All module positions (for cross-module current position indicators) ───
  const allModuleCurrentPositions = useMemo(() => {
    if (moduleViewOn) return new Map<string, string>(); // not needed in module mode
    const map = new Map<string, string>();
    for (const mod of CURRICULUM_MODULES) {
      const pos = getStudentPosition(activeStudentId, mod.id);
      if (pos.nextExerciseId) map.set(mod.id, pos.nextExerciseId);
    }
    return map;
  }, [moduleViewOn, activeStudentId, getStudentPosition]);

  // ─── Exercise grid data for current module+grade ───
  const gridData = useMemo(() => {
    type RowType = {
      unitId: string; unitName: string; unitLabel: string;
      grade: number; term: number; moduleId: string; moduleColor: string;
      exercises: Array<{
        exerciseId: string; order: number; label: string; questionCount: number;
        status: 'perfect' | 'skipped' | 'wip' | 'none';
        percentage: number; hasWrong: boolean;
        isCurrentPosition: boolean;
      }>;
    };

    const rows: RowType[] = [];

    if (moduleViewOn) {
      // Single module mode
      if (!activeMod) return [];
      const gradeData = activeMod.grades.find(g => g.grade === activeGrade);
      if (!gradeData) return [];
      // Skip if grade is not assigned to the student
      if (!assignedGradesForActive.has(activeGrade)) return [];

      let unitIdx = 0;
      for (const term of gradeData.terms) {
        for (const unit of term.units) {
          unitIdx++;
          const unitNum = unit.name.match(/^(\d+)\./)?.[1] || String(unitIdx);
          const details = getExerciseDetails(activeStudentId, unit.id, allEntries, allExercises);
          rows.push({
            unitId: unit.id, unitName: unit.name, unitLabel: unitNum,
            grade: gradeData.grade, term: term.term,
            moduleId: activeMod.id, moduleColor: activeMod.color,
            exercises: details.map(d => ({
              ...d,
              label: d.name.includes('.') ? (d.name.split('.').pop() ?? String(d.order)) : String(d.order),
              isCurrentPosition: d.exerciseId === currentPos.nextExerciseId,
            })),
          });
        }
      }
    } else {
      // All modules — group by term across modules. Only include modules where
      // this grade is assigned for this student.
      const termNums = new Set<number>();
      for (const mod of CURRICULUM_MODULES) {
        if (!activeStudent) continue;
        const gradesForMod = new Set(resolveAssignedGrades(activeStudent, mod.id));
        if (!gradesForMod.has(activeGrade)) continue;
        const gd = mod.grades.find(g => g.grade === activeGrade);
        if (gd) for (const t of gd.terms) termNums.add(t.term);
      }

      for (const termNum of Array.from(termNums).sort((a, b) => a - b)) {
        for (const mod of CURRICULUM_MODULES) {
          if (!activeStudent) continue;
          const gradesForMod = new Set(resolveAssignedGrades(activeStudent, mod.id));
          if (!gradesForMod.has(activeGrade)) continue;
          const gradeData = mod.grades.find(g => g.grade === activeGrade);
          if (!gradeData) continue;
          const termData = gradeData.terms.find(t => t.term === termNum);
          if (!termData) continue;

          const nextExId = allModuleCurrentPositions.get(mod.id) ?? null;
          let unitIdx = 0;
          for (const unit of termData.units) {
            unitIdx++;
            const unitNum = unit.name.match(/^(\d+)\./)?.[1] || String(unitIdx);
            const details = getExerciseDetails(activeStudentId, unit.id, allEntries, allExercises);
            rows.push({
              unitId: unit.id, unitName: unit.name, unitLabel: unitNum,
              grade: gradeData.grade, term: termNum,
              moduleId: mod.id, moduleColor: mod.color,
              exercises: details.map(d => ({
                ...d,
                label: d.name.includes('.') ? (d.name.split('.').pop() ?? String(d.order)) : String(d.order),
                isCurrentPosition: d.exerciseId === nextExId,
              })),
            });
          }
        }
      }
    }
    return rows;
  }, [activeMod, activeGrade, activeStudentId, activeStudent, allEntries, allExercises, currentPos.nextExerciseId, moduleViewOn, allModuleCurrentPositions, assignedGradesForActive]);

  // Group rows for tinting
  const termGroups = useMemo(() => {
    const groups: Array<{ term: number; moduleId: string; moduleColor: string; rows: typeof gridData }> = [];

    if (!moduleViewOn && unitOrderOn) {
      const sorted = [...gridData].sort((a, b) => {
        const na = parseInt(a.unitLabel) || 0;
        const nb = parseInt(b.unitLabel) || 0;
        return na - nb;
      });
      for (const row of sorted) {
        const last = groups[groups.length - 1];
        if (last && last.term === row.term) {
          last.rows.push(row);
        } else {
          groups.push({ term: row.term, moduleId: row.moduleId, moduleColor: row.moduleColor, rows: [row] });
        }
      }
    } else {
      for (const row of gridData) {
        const last = groups[groups.length - 1];
        const sameGroup = moduleViewOn
          ? (last && last.term === row.term && last.moduleId === row.moduleId)
          : (last && last.term === row.term);
        if (sameGroup && last) {
          last.rows.push(row);
        } else {
          groups.push({ term: row.term, moduleId: row.moduleId, moduleColor: row.moduleColor, rows: [row] });
        }
      }
    }
    return groups;
  }, [gridData, moduleViewOn, unitOrderOn]);

  // ─── Handlers ───
  const handleStudentSwitch = useCallback((sid: Id<"students">) => {
    setActiveStudentId(sid);
    const student = students.find(s => s._id === sid);
    const pos = getStudentPosition(sid, activeModuleId);
    const mod = getModuleById(activeModuleId);
    const assigned = student ? new Set(resolveAssignedGrades(student, activeModuleId)) : new Set<number>();
    if (mod?.grades.some(g => g.grade === pos.grade) && assigned.has(pos.grade)) {
      setActiveGrade(pos.grade);
    } else if (student) {
      setActiveGrade(lowestAssignedGrade(student, activeModuleId));
    }
  }, [activeModuleId, getStudentPosition, students]);

  const handleModuleSwitch = useCallback((modId: string) => {
    setActiveModuleId(modId);
    const pos = getStudentPosition(activeStudentId, modId);
    const mod = getModuleById(modId);
    const student = students.find(s => s._id === activeStudentId);
    const assigned = student ? new Set(resolveAssignedGrades(student, modId)) : new Set<number>();
    if (mod?.grades.some(g => g.grade === pos.grade) && assigned.has(pos.grade)) {
      setActiveGrade(pos.grade);
    } else if (student) {
      setActiveGrade(lowestAssignedGrade(student, modId));
    }
  }, [activeStudentId, getStudentPosition, students]);

  const handleProgressCellTap = useCallback((exerciseId: string, unitId: string, moduleId: string) => {
    onSelectExercise(activeStudentId, exerciseId, unitId, moduleId);
    onOpenChange(false);
  }, [activeStudentId, onSelectExercise, onOpenChange]);

  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="fixed inset-0 max-w-none w-full h-full rounded-none p-0 translate-x-0 translate-y-0 top-0 left-0 overflow-hidden flex flex-col sm:max-w-none"
      >
        {/* ═══ TOP BAR: Position label + Module toggle + Close ═══ */}
        <div className="flex items-center gap-2 px-4 pt-3 pb-2 border-b border-border/50 shrink-0">
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-bold text-foreground">Position & Progress</h2>
            <p className="text-[10px] text-muted-foreground">
              Position auto-tracks the last exercise scored or video watched.
            </p>
          </div>
          {!moduleViewOn && (
            <button
              onClick={() => setUnitOrderOn(v => !v)}
              className={`w-8 h-8 rounded-lg flex items-center justify-center active:scale-90 transition-all
                ${unitOrderOn ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground'}`}
              title={unitOrderOn ? 'Group by term' : 'Sort by unit number'}
            >
              <ArrowDownNarrowWide className="w-4 h-4" />
            </button>
          )}
          <button
            onClick={() => setModuleViewOn(v => !v)}
            className={`w-8 h-8 rounded-lg flex items-center justify-center active:scale-90 transition-all
              ${moduleViewOn ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground'}`}
            title={moduleViewOn ? 'Hide modules' : 'Show modules'}
          >
            <Layers className="w-4 h-4" />
          </button>
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

          {/* ═══ MODULE SECTION (conditional) ═══ */}
          {moduleViewOn && (
            <>
              {/* Progress bars */}
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

              {/* Module buttons */}
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
            </>
          )}

          {/* ═══ GRADE TABS (filtered to student's assigned grades) ═══ */}
          <div className="flex gap-1 px-4 mb-3 overflow-x-auto py-1">
            {(moduleViewOn ? moduleGrades : allModulesGradeTabs).map(g => {
              const isActive = g.grade === activeGrade;
              return (
                <button
                  key={g.grade}
                  onClick={() => setActiveGrade(g.grade)}
                  className={`shrink-0 px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all active:scale-95
                    ${isActive ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground'}`}
                >
                  G{g.grade}
                </button>
              );
            })}
            {(moduleViewOn ? moduleGrades : allModulesGradeTabs).length === 0 && (
              <span className="text-[11px] text-muted-foreground py-1.5">
                No grades assigned for this student in this module.
              </span>
            )}
          </div>

          {/* ═══ EXERCISE GRID (transposed: units = rows, exercises = columns) ═══ */}
          <div className="px-4 pb-4">
            {gridData.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-8">No units for G{activeGrade}</p>
            ) : (
              <div className="overflow-x-auto -mx-4 px-4">
                <div className="flex flex-col gap-0.5">
                  {termGroups.map((group, gi) => (
                    <div key={`${group.moduleId}-${group.term}`} className={`flex flex-col gap-0.5 rounded-xl p-1 ${TERM_TINTS[group.term - 1] ?? TERM_TINTS[gi % TERM_TINTS.length]}`}>
                      {/* Term label */}
                      <div className="flex items-center gap-1.5 pl-1 mb-0.5">
                        <span className="text-[8px] font-semibold text-muted-foreground/50">T{group.term}</span>
                      </div>
                      {group.rows.map(row => (
                        <div key={row.unitId} className="flex items-center gap-0.5">
                          {/* Sticky unit label + module color dot when module view is off */}
                          <div
                            className="sticky left-0 z-10 shrink-0 text-[9px] font-bold text-muted-foreground text-center bg-inherit rounded-l-lg py-2 flex items-center justify-center gap-0.5"
                            style={{ width: moduleViewOn ? '2rem' : '2.75rem' }}
                          >
                            {!moduleViewOn && (
                              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: row.moduleColor }} />
                            )}
                            {row.unitLabel}
                          </div>
                          {/* Exercise cells - horizontal */}
                          <div className="flex gap-0.5">
                            {row.exercises.map(ex => (
                              <ExerciseCell
                                key={ex.exerciseId}
                                label={ex.label}
                                percentage={ex.percentage}
                                status={ex.status}
                                hasWrong={ex.hasWrong}
                                isCurrentPosition={ex.isCurrentPosition}
                                onClick={() => handleProgressCellTap(ex.exerciseId, row.unitId, row.moduleId)}
                              />
                            ))}
                          </div>
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
              <LegendDot color="bg-emerald-500 ring-1 ring-emerald-500" label="Current position" />
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Exercise Cell ───

function ExerciseCell({
  label, percentage, status, hasWrong, isCurrentPosition, onClick,
}: {
  label: string;
  percentage: number;
  status: 'perfect' | 'skipped' | 'wip' | 'none';
  hasWrong: boolean;
  isCurrentPosition: boolean;
  onClick: () => void;
}) {
  // Determine cell color
  let bgClass = '';
  let textClass = '';

  if (status === 'perfect' && !hasWrong) {
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
      className={`relative w-12 h-10 rounded-lg flex flex-col items-center justify-center transition-all active:scale-90 shrink-0
        ${bgClass} ${textClass}
        ${isCurrentPosition ? 'ring-2 ring-emerald-500 ring-offset-1 ring-offset-background' : ''}`}
    >
      {isCurrentPosition && (
        <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-emerald-500 border-2 border-background" />
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
