'use client';

import { useState, useEffect, useMemo } from 'react';
import { useMutation } from 'convex/react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { GraduationCap, Layers, ChevronDown, RotateCcw, Check } from 'lucide-react';
import { CURRICULUM_MODULES } from '@/lib/curriculum-data';
import { api } from '@/lib/convex';
import type { Id } from '@/lib/convex';
import { resolveAssignedGrades, hasModuleOverride } from '@/lib/student-grades';
import { toast } from 'sonner';

type StudentDoc = {
  _id: Id<'students'>;
  name: string;
  schoolGrade: number;
  assignedGrades?: number[];
  assignedGradesByModule?: Record<string, number[]>;
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  student: StudentDoc | null;
}

export function GradeAssignmentDialog({ open, onOpenChange, student }: Props) {
  const setGlobal = useMutation(api.students.setAssignedGrades);
  const setForModule = useMutation(api.students.setAssignedGradesForModule);

  const allowedGrades = useMemo(() => {
    if (!student) return [];
    const list: number[] = [];
    for (let g = student.schoolGrade; g >= 6; g--) list.push(g);
    return list;
  }, [student]);

  // Working state
  const [globalGrades, setGlobalGrades] = useState<number[]>([]);
  const [overrides, setOverrides] = useState<Record<string, number[]>>({});
  const [expandedModule, setExpandedModule] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Reset state when dialog opens for a new student
  useEffect(() => {
    if (!open || !student) return;
    setGlobalGrades(resolveAssignedGrades(student));
    setOverrides({ ...(student.assignedGradesByModule ?? {}) });
    setExpandedModule(null);
  }, [open, student]);

  if (!student) return null;

  const toggleGlobalGrade = (grade: number) => {
    if (grade === student.schoolGrade) return; // cannot remove school grade
    setGlobalGrades((prev) =>
      prev.includes(grade)
        ? prev.filter((g) => g !== grade)
        : [...prev, grade].sort((a, b) => b - a),
    );
  };

  const toggleModuleGrade = (moduleId: string, grade: number) => {
    if (grade === student.schoolGrade) return;
    setOverrides((prev) => {
      const current = prev[moduleId] ?? globalGrades;
      const next = current.includes(grade)
        ? current.filter((g) => g !== grade)
        : [...current, grade].sort((a, b) => b - a);
      // If override matches global, clear it (avoid storing duplicates).
      const sameAsGlobal =
        next.length === globalGrades.length &&
        next.every((g) => globalGrades.includes(g));
      if (sameAsGlobal) {
        const out = { ...prev };
        delete out[moduleId];
        return out;
      }
      return { ...prev, [moduleId]: next };
    });
  };

  const clearModuleOverride = (moduleId: string) => {
    setOverrides((prev) => {
      const out = { ...prev };
      delete out[moduleId];
      return out;
    });
  };

  const handleSave = async () => {
    if (!student) return;
    setSaving(true);
    try {
      await setGlobal({ id: student._id, assignedGrades: globalGrades });
      // Sync per-module overrides: set those that exist, clear those removed.
      const previous = student.assignedGradesByModule ?? {};
      const allModuleIds = new Set([
        ...Object.keys(overrides),
        ...Object.keys(previous),
      ]);
      for (const moduleId of allModuleIds) {
        const next = overrides[moduleId];
        const prev = previous[moduleId];
        const changed = JSON.stringify(next ?? null) !== JSON.stringify(prev ?? null);
        if (!changed) continue;
        await setForModule({
          id: student._id,
          moduleId,
          assignedGrades: next, // undefined → clears
        });
      }
      toast.success('Grade assignments saved');
      onOpenChange(false);
    } catch (e) {
      console.error(e);
      toast.error('Could not save grade assignments');
    } finally {
      setSaving(false);
    }
  };

  const downgradedModules = CURRICULUM_MODULES.filter((m) => overrides[m.id]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm mx-auto p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-4 pt-4 pb-3 border-b border-border/50">
          <DialogTitle className="flex items-center gap-2 text-base">
            <div className="w-8 h-8 rounded-xl bg-primary/12 flex items-center justify-center">
              <GraduationCap className="w-4 h-4 text-primary" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-bold truncate">{student.name}</p>
              <p className="text-[11px] font-normal text-muted-foreground">
                Grade {student.schoolGrade} · Set teaching grades
              </p>
            </div>
          </DialogTitle>
        </DialogHeader>

        <div className="max-h-[70vh] overflow-y-auto px-4 py-3 space-y-4">
          {/* Global grades */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-[11px] font-bold uppercase tracking-wider text-foreground">
                All Modules
              </h3>
              <span className="text-[10px] text-muted-foreground">
                {globalGrades.length} grade{globalGrades.length === 1 ? '' : 's'}
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground mb-2">
              Pick the grades this student is taught everywhere. School grade is required.
            </p>
            <div className="flex flex-wrap gap-1.5">
              {allowedGrades.map((g) => {
                const checked = globalGrades.includes(g);
                const isLock = g === student.schoolGrade;
                return (
                  <button
                    key={g}
                    type="button"
                    onClick={() => toggleGlobalGrade(g)}
                    disabled={isLock}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all active:scale-95 flex items-center gap-1
                      ${checked
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted text-muted-foreground hover:bg-muted/80'}
                      ${isLock ? 'opacity-90 cursor-default' : ''}`}
                    title={isLock ? 'School grade — always taught' : ''}
                  >
                    {checked && <Check className="w-3 h-3" />}
                    G{g}
                  </button>
                );
              })}
            </div>
          </section>

          {/* Per-module overrides */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-[11px] font-bold uppercase tracking-wider text-foreground flex items-center gap-1.5">
                <Layers className="w-3 h-3" />
                Per-module overrides
              </h3>
              {downgradedModules.length > 0 && (
                <span className="text-[10px] text-muted-foreground">
                  {downgradedModules.length} custom
                </span>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground mb-2">
              Optional. Tap a module to give it different grades than the global list.
            </p>
            <div className="space-y-1.5">
              {CURRICULUM_MODULES.map((mod) => {
                const isExpanded = expandedModule === mod.id;
                const moduleGrades = overrides[mod.id] ?? globalGrades;
                const hasOverride = !!overrides[mod.id];
                return (
                  <div
                    key={mod.id}
                    className={`rounded-xl border transition-all ${
                      hasOverride
                        ? 'border-amber-500/40 bg-amber-500/5'
                        : 'border-border/60 bg-card'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => setExpandedModule(isExpanded ? null : mod.id)}
                      className="w-full px-3 py-2.5 flex items-center gap-2 text-left active:scale-[0.99] transition-all"
                    >
                      <span
                        className="w-7 h-7 rounded-lg flex items-center justify-center text-[11px] font-bold text-white shrink-0"
                        style={{ backgroundColor: mod.color }}
                      >
                        {mod.id}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-foreground truncate">
                          {mod.name}
                        </p>
                        <p className="text-[10px] text-muted-foreground">
                          {moduleGrades.map((g) => `G${g}`).join(' · ')}
                          {hasOverride && (
                            <span className="ml-1.5 text-amber-600 dark:text-amber-400 font-semibold">
                              · custom
                            </span>
                          )}
                        </p>
                      </div>
                      <ChevronDown
                        className={`w-4 h-4 text-muted-foreground transition-transform shrink-0 ${
                          isExpanded ? 'rotate-180' : ''
                        }`}
                      />
                    </button>
                    {isExpanded && (
                      <div className="px-3 pb-3 pt-1 border-t border-border/40">
                        <div className="flex flex-wrap gap-1.5 mb-2">
                          {allowedGrades.map((g) => {
                            const checked = moduleGrades.includes(g);
                            const isLock = g === student.schoolGrade;
                            return (
                              <button
                                key={g}
                                type="button"
                                onClick={() => toggleModuleGrade(mod.id, g)}
                                disabled={isLock}
                                className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all active:scale-95 flex items-center gap-1
                                  ${checked
                                    ? 'text-white'
                                    : 'bg-muted text-muted-foreground hover:bg-muted/80'}
                                  ${isLock ? 'opacity-90 cursor-default' : ''}`}
                                style={checked ? { backgroundColor: mod.color } : undefined}
                              >
                                {checked && <Check className="w-3 h-3" />}
                                G{g}
                              </button>
                            );
                          })}
                        </div>
                        {hasOverride && (
                          <button
                            type="button"
                            onClick={() => clearModuleOverride(mod.id)}
                            className="text-[10px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
                          >
                            <RotateCcw className="w-3 h-3" />
                            Use global ({globalGrades.map((g) => `G${g}`).join(' · ')})
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-border/50 flex gap-2 bg-background">
          <Button
            variant="outline"
            className="flex-1 rounded-xl"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            className="flex-1 rounded-xl"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Re-export so the students page can import the helper too
export { hasModuleOverride };
