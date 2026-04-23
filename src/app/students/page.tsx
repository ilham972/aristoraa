'use client';

import { useState, useMemo } from 'react';
import { useQuery, useMutation } from 'convex/react';
import { BarChart3, Pencil, Trash2, Plus, Activity, GraduationCap } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { api } from '@/lib/convex';
import { CURRICULUM_MODULES, getOrderedUnits } from '@/lib/curriculum-data';
import { getTotalScoreable } from '@/lib/sub-questions';
import { resolveAssignedGrades, hasModuleOverride } from '@/lib/student-grades';
import { GradeAssignmentDialog } from '@/components/grade-assignment-dialog';
import { toast } from 'sonner';
import Link from 'next/link';
import type { Id } from '@/lib/convex';

type StudentDoc = {
  _id: Id<'students'>;
  name: string;
  schoolGrade: number;
  parentPhone: string;
  schoolName: string;
  centerId?: Id<'centers'>;
  assignedGrades?: number[];
  assignedGradesByModule?: Record<string, number[]>;
};

export default function StudentsPage() {
  const [filterGrade, setFilterGrade] = useState<string>('all');
  const [filterCenter, setFilterCenter] = useState<string>('all');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingStudentId, setEditingStudentId] = useState<Id<"students"> | null>(null);
  const [gradeDialogStudentId, setGradeDialogStudentId] = useState<Id<"students"> | null>(null);

  const [formName, setFormName] = useState('');
  const [formGrade, setFormGrade] = useState('6');
  const [formPhone, setFormPhone] = useState('');
  const [formSchool, setFormSchool] = useState('');
  const [formCenterId, setFormCenterId] = useState<string>('');

  const students = useQuery(api.students.list) as StudentDoc[] | undefined;
  const allEntries = useQuery(api.entries.list);
  const allExercises = useQuery(api.exercises.list);
  const centers = useQuery(api.centers.list);

  const addStudentMutation = useMutation(api.students.add);
  const updateStudentMutation = useMutation(api.students.update);
  const removeStudentMutation = useMutation(api.students.remove);

  const gradeDialogStudent = useMemo(
    () => students?.find((s) => s._id === gradeDialogStudentId) ?? null,
    [students, gradeDialogStudentId],
  );

  if (!students || !allEntries || !allExercises) {
    return (
      <div className="px-4 pt-5 pb-6 max-w-lg mx-auto">
        <h1 className="text-lg font-bold text-foreground mb-4">Students</h1>
        <div className="animate-pulse space-y-2">
          {[1, 2, 3].map(i => <div key={i} className="h-24 bg-muted rounded-2xl" />)}
        </div>
      </div>
    );
  }

  const filteredStudents = students.filter(s => {
    if (filterGrade !== 'all' && s.schoolGrade !== parseInt(filterGrade)) return false;
    if (filterCenter !== 'all') {
      const studentCenterId = s.centerId;
      if (filterCenter === 'none') { if (studentCenterId) return false; }
      else if (studentCenterId !== filterCenter) return false;
    }
    return true;
  });

  const handleSave = async () => {
    if (!formName.trim()) {
      toast.error('Name is required');
      return;
    }

    if (editingStudentId) {
      await updateStudentMutation({
        id: editingStudentId,
        name: formName.trim(),
        schoolGrade: parseInt(formGrade),
        parentPhone: formPhone,
        schoolName: formSchool,
        centerId: formCenterId ? formCenterId as Id<"centers"> : undefined,
      });
      toast.success('Student updated');
    } else {
      await addStudentMutation({
        name: formName.trim(),
        schoolGrade: parseInt(formGrade),
        parentPhone: formPhone,
        schoolName: formSchool,
        centerId: formCenterId ? formCenterId as Id<"centers"> : undefined,
      });
      toast.success('Student added');
    }

    setDialogOpen(false);
    resetForm();
  };

  const handleEdit = (student: StudentDoc) => {
    setEditingStudentId(student._id);
    setFormName(student.name);
    setFormGrade(String(student.schoolGrade));
    setFormPhone(student.parentPhone);
    setFormSchool(student.schoolName);
    setFormCenterId(student.centerId || '');
    setDialogOpen(true);
  };

  const handleDelete = async (id: Id<"students">) => {
    if (confirm('Delete this student and all their records?')) {
      await removeStudentMutation({ id });
      toast.success('Student deleted');
    }
  };

  const resetForm = () => {
    setEditingStudentId(null);
    setFormName('');
    setFormGrade('6');
    setFormPhone('');
    setFormSchool('');
    setFormCenterId('');
  };

  const openAdd = () => {
    resetForm();
    setDialogOpen(true);
  };

  // Per-module progress: count exercises in the student's assigned grades for
  // that module, return { done, total, pct }.
  const getModuleProgress = (student: StudentDoc, moduleId: string) => {
    const assignedGrades = new Set(resolveAssignedGrades(student, moduleId));
    const units = getOrderedUnits(moduleId).filter((u) => assignedGrades.has(u.grade));
    let total = 0;
    let done = 0;
    for (const unit of units) {
      const exs = allExercises!.filter(
        (e) => e.unitId === unit.id && (e.type ?? 'exercise') === 'exercise',
      );
      for (const ex of exs) {
        total++;
        const entry = allEntries!.find(
          (e) => e.studentId === student._id && e.exerciseId === ex._id,
        );
        if (!entry) continue;
        const effQ = getTotalScoreable(ex.questionCount, ex.subQuestions as Parameters<typeof getTotalScoreable>[1]);
        if (entry.totalAttempted >= effQ) done++;
      }
    }
    return { done, total, pct: total > 0 ? Math.round((done / total) * 100) : 0 };
  };

  return (
    <div className="px-4 pt-5 pb-6 max-w-lg mx-auto">
      <div className="flex items-center justify-between mb-4 gap-2">
        <h1 className="text-lg font-bold text-foreground">Students</h1>
        <div className="flex items-center gap-1.5">
          <Link href="/timeline/compare">
            <Button size="sm" variant="outline" className="rounded-xl gap-1.5">
              <Activity className="w-4 h-4" />
              Timeline
            </Button>
          </Link>
          <Button onClick={openAdd} size="sm" className="rounded-xl gap-1.5">
            <Plus className="w-4 h-4" />
            Add
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-2 mb-4">
        <Select value={filterGrade} onValueChange={(v) => setFilterGrade(v ?? 'all')}>
          <SelectTrigger className="h-10 text-sm flex-1">
            <SelectValue placeholder="Grade" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Grades</SelectItem>
            {[6, 7, 8, 9, 10, 11].map(g => (
              <SelectItem key={g} value={String(g)}>Grade {g}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filterCenter} onValueChange={(v) => setFilterCenter(v ?? 'all')}>
          <SelectTrigger className="h-10 text-sm flex-1">
            <SelectValue placeholder="Center" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Centers</SelectItem>
            <SelectItem value="none">No Center</SelectItem>
            {centers?.map((c: { _id: string; name: string }) => (
              <SelectItem key={c._id} value={c._id}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <p className="text-xs text-muted-foreground mb-3">
        {filteredStudents.length} student{filteredStudents.length !== 1 ? 's' : ''}
      </p>

      <div className="space-y-2">
        {filteredStudents.map(student => {
          const center = student.centerId
            ? centers?.find((c: { _id: string }) => c._id === student.centerId)
            : null;
          const globalGrades = resolveAssignedGrades(student);
          const customCount = CURRICULUM_MODULES.filter((m) =>
            hasModuleOverride(student, m.id),
          ).length;

          return (
            <Card key={student._id} className="border-border/50 overflow-hidden">
              <CardContent className="p-3">
                {/* Header row: name + grade chip + center */}
                <div className="flex items-start gap-2 mb-2.5">
                  <div className="w-9 h-9 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0 text-sm font-bold">
                    {student.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-foreground text-sm truncate leading-tight">
                      {student.name}
                    </p>
                    <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                      <Badge variant="secondary" className="text-[10px] h-4 px-1.5 rounded-md font-bold">
                        G{student.schoolGrade}
                      </Badge>
                      {globalGrades.length > 1 && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded-md bg-amber-500/15 text-amber-600 dark:text-amber-400 font-semibold inline-flex items-center gap-0.5">
                          <GraduationCap className="w-2.5 h-2.5" />
                          {globalGrades.map((g) => `G${g}`).join('·')}
                        </span>
                      )}
                      {customCount > 0 && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded-md bg-violet-500/15 text-violet-600 dark:text-violet-400 font-semibold">
                          {customCount} custom
                        </span>
                      )}
                      {center && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded-md bg-primary/10 text-primary font-medium truncate">
                          {(center as { name: string }).name}
                        </span>
                      )}
                    </div>
                  </div>
                  {/* Action icon row */}
                  <div className="flex items-center gap-0.5 shrink-0">
                    <Link href={`/progress?id=${student._id}`}>
                      <Button variant="ghost" size="icon-xs" title="Progress">
                        <BarChart3 className="w-3.5 h-3.5" />
                      </Button>
                    </Link>
                    <Link href={`/timeline/student/${student._id}`}>
                      <Button variant="ghost" size="icon-xs" title="Timeline">
                        <Activity className="w-3.5 h-3.5" />
                      </Button>
                    </Link>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => setGradeDialogStudentId(student._id)}
                      title="Set teaching grades"
                      className="text-amber-600 dark:text-amber-400 hover:text-amber-700"
                    >
                      <GraduationCap className="w-3.5 h-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon-xs" onClick={() => handleEdit(student)} title="Edit">
                      <Pencil className="w-3.5 h-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => handleDelete(student._id)}
                      title="Delete"
                      className="text-destructive hover:text-destructive"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>

                {/* Per-module progress chips: 2-column grid */}
                <div className="grid grid-cols-2 gap-1.5">
                  {CURRICULUM_MODULES.map((mod) => {
                    const prog = getModuleProgress(student, mod.id);
                    const overridden = hasModuleOverride(student, mod.id);
                    const moduleGrades = resolveAssignedGrades(student, mod.id);
                    return (
                      <div
                        key={mod.id}
                        className="flex items-center gap-1.5 rounded-lg px-2 py-1.5"
                        style={{ backgroundColor: `${mod.color}10` }}
                        title={`${mod.name} · ${moduleGrades.map((g) => `G${g}`).join(' · ')} · ${prog.done}/${prog.total} done`}
                      >
                        <span
                          className="text-[10px] font-bold w-7 shrink-0 text-center rounded text-white py-0.5 inline-flex items-center justify-center gap-0.5"
                          style={{ backgroundColor: mod.color }}
                        >
                          {mod.id}
                          {overridden && (
                            <span className="w-1 h-1 rounded-full bg-amber-300" />
                          )}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="h-1.5 rounded-full bg-background overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all"
                              style={{
                                width: `${prog.pct}%`,
                                backgroundColor: mod.color,
                              }}
                            />
                          </div>
                        </div>
                        <span
                          className="text-[10px] font-bold tabular-nums shrink-0 w-8 text-right"
                          style={{ color: mod.color }}
                        >
                          {prog.total > 0 ? `${prog.pct}%` : '—'}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Add/Edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={(open) => { setDialogOpen(open); if (!open) resetForm(); }}>
        <DialogContent className="max-w-sm mx-auto">
          <DialogHeader>
            <DialogTitle>{editingStudentId ? 'Edit Student' : 'Add Student'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="name" className="text-sm">Name *</Label>
              <Input id="name" value={formName} onChange={e => setFormName(e.target.value)} placeholder="Student name" className="mt-1" />
            </div>
            <div>
              <Label htmlFor="grade" className="text-sm">School Grade</Label>
              <Select value={formGrade} onValueChange={(v) => setFormGrade(v ?? '6')}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[6, 7, 8, 9, 10, 11].map(g => (
                    <SelectItem key={g} value={String(g)}>Grade {g}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="phone" className="text-sm">Parent Phone</Label>
              <Input id="phone" value={formPhone} onChange={e => setFormPhone(e.target.value)} placeholder="Phone number" className="mt-1" />
            </div>
            <div>
              <Label htmlFor="school" className="text-sm">School Name</Label>
              <Input id="school" value={formSchool} onChange={e => setFormSchool(e.target.value)} placeholder="School name" className="mt-1" />
            </div>
            <div>
              <Label className="text-sm">Center</Label>
              <Select value={formCenterId} onValueChange={(v) => setFormCenterId(v ?? '')}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Select center (optional)" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="">No Center</SelectItem>
                  {centers?.map((c: { _id: string; name: string }) => (
                    <SelectItem key={c._id} value={c._id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={handleSave} className="w-full rounded-xl">{editingStudentId ? 'Update' : 'Add Student'}</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Grade assignment dialog */}
      <GradeAssignmentDialog
        open={!!gradeDialogStudentId}
        onOpenChange={(o) => { if (!o) setGradeDialogStudentId(null); }}
        student={gradeDialogStudent}
      />
    </div>
  );
}
