'use client';

import { useState, useMemo, useCallback, useEffect } from 'react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { CURRICULUM_MODULES, getOrderedUnits, getModuleById } from '@/lib/curriculum-data';
import { getStudentNextExercise, getExerciseDetails, type PositionOptions } from '@/lib/scoring';
import { X, RotateCcw, Layers, ArrowDownNarrowWide } from 'lucide-react';
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

const MODULE_VIEW_KEY = 'mt-position-module-view';
const UNIT_ORDER_KEY = 'mt-position-unit-order';

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
      // All modules — group by term across modules
      // Collect all terms, then within each term gather units from all modules
      const termNums = new Set<number>();
      for (const mod of CURRICULUM_MODULES) {
        const gd = mod.grades.find(g => g.grade === activeGrade);
        if (gd) for (const t of gd.terms) termNums.add(t.term);
      }

      for (const termNum of Array.from(termNums).sort((a, b) => a - b)) {
        for (const mod of CURRICULUM_MODULES) {
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
  }, [activeMod, activeGrade, activeStudentId, allEntries, allExercises, currentPos.nextExerciseId, moduleViewOn, allModuleCurrentPositions]);

  // Group rows for tinting
  const termGroups = useMemo(() => {
    const groups: Array<{ term: number; moduleId: string; moduleColor: string; rows: typeof gridData }> = [];

    if (!moduleViewOn && unitOrderOn) {
      // Sort all rows by unit number, then group by term
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

  const handleProgressCellTap = useCallback((exerciseId: string, unitId: string, moduleId: string) => {
    onSelectExercise(activeStudentId, exerciseId, unitId, moduleId);
    onOpenChange(false);
  }, [activeStudentId, onSelectExercise, onOpenChange]);

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
  const isBelowGrade = useCallback((grade: number, modId?: string) => {
    const student = students.find(s => s._id === activeStudentId);
    if (!student) return false;
    const mid = modId ?? activeModuleId;
    const override = modulePositions.find(p => p.studentId === activeStudentId && p.moduleId === mid);
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
        {/* ═══ TOP BAR: Progress/Position tabs + Module toggle + Close ═══ */}
        <div className="flex items-center gap-2 px-4 pt-3 pb-2 border-b border-border/50 shrink-0">
          <div className="flex gap-1 flex-1 min-w-0">
            <button
              onClick={() => setSubTab('progress')}
              className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-all
                ${subTab === 'progress' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}
            >
              Progress
            </button>
            <button
              onClick={() => setSubTab('position')}
              className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-all
                ${subTab === 'position' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}
            >
              Position
            </button>
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

          {/* ═══ GRADE TABS ═══ */}
          <div className="flex gap-1 px-4 mb-3 overflow-x-auto py-1">
            {(moduleViewOn ? moduleGrades : (() => {
              // When module view is off, collect all unique grades across all modules
              const gradeSet = new Set<number>();
              for (const mod of CURRICULUM_MODULES) {
                for (const g of mod.grades) gradeSet.add(g.grade);
              }
              return Array.from(gradeSet).sort((a, b) => a - b).map(g => ({ grade: g }));
            })()).map(g => {
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
                            {row.exercises.map(ex => {
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
                                  isBelowGrade={isBelowGrade(row.grade, row.moduleId)}
                                  isDraftSkipped={isDraftSkipped}
                                  isDraftPosition={isDraftPosition}
                                  isPositionTab={subTab === 'position'}
                                  onClick={() => {
                                    if (subTab === 'progress') {
                                      handleProgressCellTap(ex.exerciseId, row.unitId, row.moduleId);
                                    } else {
                                      handlePositionCellTap(ex.exerciseId);
                                    }
                                  }}
                                />
                              );
                            })}
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
      className={`relative w-12 h-10 rounded-lg flex flex-col items-center justify-center transition-all active:scale-90 shrink-0
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
