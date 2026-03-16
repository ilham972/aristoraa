'use client';

import { useState } from 'react';
import { useQuery, useMutation } from 'convex/react';
import { BarChart3, Pencil, Trash2, Plus } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { MODULE_COLORS } from '@/lib/types';
import { api } from '@/lib/convex';
import { CURRICULUM_MODULES, getOrderedUnits, findUnit } from '@/lib/curriculum-data';
import { getStudentNextExercise } from '@/lib/scoring';
import { toast } from 'sonner';
import Link from 'next/link';
import type { Id } from '@/lib/convex';

export default function StudentsPage() {
  const [filterGrade, setFilterGrade] = useState<string>('all');
  const [filterGroup, setFilterGroup] = useState<string>('all');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingStudentId, setEditingStudentId] = useState<Id<"students"> | null>(null);

  const [formName, setFormName] = useState('');
  const [formGrade, setFormGrade] = useState('6');
  const [formGroup, setFormGroup] = useState('');
  const [formPhone, setFormPhone] = useState('');
  const [formSchool, setFormSchool] = useState('');

  const students = useQuery(api.students.list);
  const allEntries = useQuery(api.entries.list);
  const allExercises = useQuery(api.exercises.list);

  const addStudentMutation = useMutation(api.students.add);
  const updateStudentMutation = useMutation(api.students.update);
  const removeStudentMutation = useMutation(api.students.remove);

  if (!students || !allEntries || !allExercises) {
    return (
      <div className="px-4 pt-5 pb-6 max-w-lg mx-auto">
        <h1 className="text-lg font-bold text-foreground mb-4">Students</h1>
        <div className="animate-pulse space-y-2">
          {[1, 2, 3].map(i => <div key={i} className="h-20 bg-muted rounded-xl" />)}
        </div>
      </div>
    );
  }

  const filteredStudents = students.filter(s => {
    if (filterGrade !== 'all' && s.schoolGrade !== parseInt(filterGrade)) return false;
    if (filterGroup !== 'all' && s.group !== filterGroup) return false;
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
        group: formGroup,
        parentPhone: formPhone,
        schoolName: formSchool,
      });
      toast.success('Student updated');
    } else {
      await addStudentMutation({
        name: formName.trim(),
        schoolGrade: parseInt(formGrade),
        group: formGroup,
        parentPhone: formPhone,
        schoolName: formSchool,
      });
      toast.success('Student added');
    }

    setDialogOpen(false);
    resetForm();
  };

  const handleEdit = (student: typeof students[0]) => {
    setEditingStudentId(student._id);
    setFormName(student.name);
    setFormGrade(String(student.schoolGrade));
    setFormGroup(student.group);
    setFormPhone(student.parentPhone);
    setFormSchool(student.schoolName);
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
    setFormGroup('');
    setFormPhone('');
    setFormSchool('');
  };

  const openAdd = () => {
    resetForm();
    setDialogOpen(true);
  };

  const getProgress = (studentId: string) => {
    const progress: Record<string, string> = {};

    for (const mod of CURRICULUM_MODULES) {
      const orderedUnits = getOrderedUnits(mod.id);
      const next = getStudentNextExercise(studentId, mod.id, allEntries, allExercises, orderedUnits);
      if (next) {
        const unitInfo = findUnit(next.unitId);
        if (unitInfo) {
          progress[mod.id] = `G${unitInfo.grade}`;
        }
      } else {
        const hasExercises = allExercises.some(e => orderedUnits.some(u => u.id === e.unitId));
        progress[mod.id] = hasExercises ? 'Done' : '-';
      }
    }
    return progress;
  };

  const uniqueGroups = [...new Set(students.map(s => s.group).filter(Boolean))];

  return (
    <div className="px-4 pt-5 pb-6 max-w-lg mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-bold text-foreground">Students</h1>
        <Button onClick={openAdd} size="sm" className="rounded-xl gap-1.5">
          <Plus className="w-4 h-4" />
          Add
        </Button>
      </div>

      {/* Filters */}
      <div className="flex gap-2 mb-4">
        <Select value={filterGrade} onValueChange={(v) => setFilterGrade(v ?? 'all')}>
          <SelectTrigger className="flex-1 h-10 text-sm">
            <SelectValue placeholder="Grade" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Grades</SelectItem>
            {[6, 7, 8, 9, 10, 11].map(g => (
              <SelectItem key={g} value={String(g)}>Grade {g}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={filterGroup} onValueChange={(v) => setFilterGroup(v ?? 'all')}>
          <SelectTrigger className="flex-1 h-10 text-sm">
            <SelectValue placeholder="Group" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Groups</SelectItem>
            {uniqueGroups.map(g => (
              <SelectItem key={g} value={g}>{g}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <p className="text-xs text-muted-foreground mb-3">{filteredStudents.length} student{filteredStudents.length !== 1 ? 's' : ''}</p>

      <div className="space-y-1.5">
        {filteredStudents.map(student => {
          const progress = getProgress(student._id);
          return (
            <Card key={student._id} className="border-border/50">
              <CardContent className="p-3">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-foreground text-sm truncate">{student.name}</p>
                      <Badge variant="secondary" className="text-[10px] shrink-0">G{student.schoolGrade}</Badge>
                    </div>
                    {student.group && (
                      <p className="text-xs text-muted-foreground mt-0.5">{student.group}</p>
                    )}
                    <div className="flex gap-1 mt-2 flex-wrap">
                      {CURRICULUM_MODULES.map(mod => (
                        <span
                          key={mod.id}
                          className="text-[9px] px-1.5 py-0.5 rounded-md text-white font-medium"
                          style={{ backgroundColor: mod.color }}
                        >
                          {mod.id}:{progress[mod.id] || '-'}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="flex gap-0.5 ml-2 shrink-0">
                    <Link href={`/progress?id=${student._id}`}>
                      <Button variant="ghost" size="icon-xs" title="View Progress">
                        <BarChart3 className="w-3.5 h-3.5" />
                      </Button>
                    </Link>
                    <Button variant="ghost" size="icon-xs" onClick={() => handleEdit(student)} title="Edit">
                      <Pencil className="w-3.5 h-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon-xs" onClick={() => handleDelete(student._id)} title="Delete" className="text-destructive hover:text-destructive">
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

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
              <Label htmlFor="group" className="text-sm">Group</Label>
              <Input id="group" value={formGroup} onChange={e => setFormGroup(e.target.value)} placeholder="e.g., Morning Group" className="mt-1" list="group-list" />
              <datalist id="group-list">
                {uniqueGroups.map(g => <option key={g} value={g} />)}
              </datalist>
            </div>
            <div>
              <Label htmlFor="phone" className="text-sm">Parent Phone</Label>
              <Input id="phone" value={formPhone} onChange={e => setFormPhone(e.target.value)} placeholder="Phone number" className="mt-1" />
            </div>
            <div>
              <Label htmlFor="school" className="text-sm">School Name</Label>
              <Input id="school" value={formSchool} onChange={e => setFormSchool(e.target.value)} placeholder="School name" className="mt-1" />
            </div>
            <Button onClick={handleSave} className="w-full rounded-xl">{editingStudentId ? 'Update' : 'Add Student'}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
