'use client';

import { useState, useMemo } from 'react';
import { useMutation } from 'convex/react';
// Cached drop-in for useQuery: last result renders instantly from device
// storage while the live subscription refreshes (perf phase 3).
import { useCachedQuery as useQuery } from '@/hooks/use-cached-query';
import {
  BarChart3, Pencil, Trash2, Plus, Activity, GraduationCap, Brain, Search,
} from 'lucide-react';
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
import { TrackPicker } from '@/components/algorithm/track-picker';
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
  trackId?: Id<'tracks'>;
};

type Progress = { done: number; total: number; pct: number };

type SortKey = 'name' | 'progress' | 'grade';

export default function StudentsPage() {
  const [search, setSearch] = useState('');
  const [filterGrade, setFilterGrade] = useState<string>('all');
  const [filterCenter, setFilterCenter] = useState<string>('all');
  const [filterTrack, setFilterTrack] = useState<string>('all');
  const [sortBy, setSortBy] = useState<SortKey>('name');

  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
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
  const tracks = useQuery(api.learningEngine.tracks.listTracks);

  const addStudentMutation = useMutation(api.students.add);
  const updateStudentMutation = useMutation(api.students.update);
  const removeStudentMutation = useMutation(api.students.remove);

  const gradeDialogStudent = useMemo(
    () => students?.find((s) => s._id === gradeDialogStudentId) ?? null,
    [students, gradeDialogStudentId],
  );

  // --- Efficient progress indexes -----------------------------------------
  // Old code did allEntries.find() per exercise per module per student on every
  // render. We build O(1) lookup maps once instead: exercises grouped by unit
  // (with effective scoreable count precomputed) and entries keyed by
  // student+exercise.
  const exercisesByUnit = useMemo(() => {
    const map = new Map<string, { id: Id<'exercises'>; effQ: number }[]>();
    if (!allExercises) return map;
    for (const ex of allExercises) {
      if ((ex.type ?? 'exercise') !== 'exercise') continue;
      const effQ = getTotalScoreable(
        ex.questionCount,
        ex.subQuestions as Parameters<typeof getTotalScoreable>[1],
      );
      const arr = map.get(ex.unitId) ?? [];
      arr.push({ id: ex._id, effQ });
      map.set(ex.unitId, arr);
    }
    return map;
  }, [allExercises]);

  const entriesByKey = useMemo(() => {
    const map = new Map<string, number>();
    if (!allEntries) return map;
    for (const e of allEntries) {
      map.set(`${e.studentId}|${e.exerciseId}`, e.totalAttempted);
    }
    return map;
  }, [allEntries]);

  // Progress for a student across the given modules (one module for the
  // per-module chips, all modules for the overall ring).
  const progressFor = useMemo(() => {
    return (student: StudentDoc, moduleIds: string[]): Progress => {
      let total = 0;
      let done = 0;
      for (const moduleId of moduleIds) {
        const assignedGrades = new Set(resolveAssignedGrades(student, moduleId));
        const units = getOrderedUnits(moduleId).filter((u) => assignedGrades.has(u.grade));
        for (const unit of units) {
          const exs = exercisesByUnit.get(unit.id) ?? [];
          for (const ex of exs) {
            total++;
            const attempted = entriesByKey.get(`${student._id}|${ex.id}`);
            if (attempted !== undefined && attempted >= ex.effQ) done++;
          }
        }
      }
      return { done, total, pct: total > 0 ? Math.round((done / total) * 100) : 0 };
    };
  }, [exercisesByUnit, entriesByKey]);

  const ALL_MODULE_IDS = useMemo(() => CURRICULUM_MODULES.map((m) => m.id), []);

  // Overall progress per student, computed once (also drives progress sort).
  const overallByStudent = useMemo(() => {
    const map = new Map<string, Progress>();
    if (!students) return map;
    for (const s of students) map.set(s._id, progressFor(s, ALL_MODULE_IDS));
    return map;
  }, [students, progressFor, ALL_MODULE_IDS]);

  if (!students || !allEntries || !allExercises) {
    return (
      <div className="px-4 pt-5 pb-6 max-w-lg mx-auto">
        <h1 className="text-lg font-bold text-foreground mb-4">Students</h1>
        <div className="animate-pulse space-y-2">
          {[1, 2, 3].map(i => <div key={i} className="h-16 bg-muted rounded-2xl" />)}
        </div>
      </div>
    );
  }

  const filteredStudents = students
    .filter(s => {
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        if (!s.name.toLowerCase().includes(q) && !s.schoolName.toLowerCase().includes(q)) {
          return false;
        }
      }
      if (filterGrade !== 'all' && s.schoolGrade !== parseInt(filterGrade)) return false;
      if (filterCenter !== 'all') {
        if (filterCenter === 'none') { if (s.centerId) return false; }
        else if (s.centerId !== filterCenter) return false;
      }
      if (filterTrack !== 'all') {
        if (filterTrack === 'none') { if (s.trackId) return false; }
        else if (s.trackId !== filterTrack) return false;
      }
      return true;
    })
    .sort((a, b) => {
      if (sortBy === 'grade') return a.schoolGrade - b.schoolGrade || a.name.localeCompare(b.name);
      if (sortBy === 'progress') {
        const pa = overallByStudent.get(a._id)?.pct ?? 0;
        const pb = overallByStudent.get(b._id)?.pct ?? 0;
        return pa - pb || a.name.localeCompare(b.name);
      }
      return a.name.localeCompare(b.name);
    });

  const hasActiveFilter =
    search.trim() !== '' || filterGrade !== 'all' || filterCenter !== 'all' || filterTrack !== 'all';

  const handleSave = async () => {
    if (!formName.trim()) {
      toast.error('Name is required');
      return;
    }
    setSaving(true);
    try {
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
    } catch (err) {
      // Most common cause: phone number not in a recognizable Sri Lankan
      // format. Surface it instead of silently failing.
      const msg = err instanceof Error ? err.message : 'Failed to save student';
      toast.error(
        /phone/i.test(msg)
          ? 'Phone number not recognized. Use 07XXXXXXXX or +94XXXXXXXXX, or leave it blank.'
          : msg,
      );
    } finally {
      setSaving(false);
    }
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
      try {
        await removeStudentMutation({ id });
        toast.success('Student deleted');
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to delete');
      }
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

  const progColor = (pct: number) =>
    pct >= 70 ? 'text-emerald-600 dark:text-emerald-400'
      : pct >= 40 ? 'text-amber-600 dark:text-amber-400'
        : 'text-red-500';
  const progBar = (pct: number) =>
    pct >= 70 ? 'bg-emerald-500' : pct >= 40 ? 'bg-amber-500' : 'bg-red-500';

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

      {/* Filters — single scrollable row */}
      <div className="flex items-center gap-2 mb-3 overflow-x-auto pb-1 -mx-1 px-1">
        <div className="relative shrink-0 w-40">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search…"
            className="h-9 pl-9 text-sm"
          />
        </div>
        <Select value={filterGrade} onValueChange={(v) => setFilterGrade(v ?? 'all')}>
          <SelectTrigger className="h-9 text-sm shrink-0 w-[112px]"><SelectValue placeholder="Grade" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Grades</SelectItem>
            {[6, 7, 8, 9, 10, 11].map(g => (
              <SelectItem key={g} value={String(g)}>Grade {g}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filterCenter} onValueChange={(v) => setFilterCenter(v ?? 'all')}>
          <SelectTrigger className="h-9 text-sm shrink-0 w-[120px]"><SelectValue placeholder="Center" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Centers</SelectItem>
            <SelectItem value="none">No Center</SelectItem>
            {centers?.map((c: { _id: string; name: string }) => (
              <SelectItem key={c._id} value={c._id}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filterTrack} onValueChange={(v) => setFilterTrack(v ?? 'all')}>
          <SelectTrigger className="h-9 text-sm shrink-0 w-[112px]"><SelectValue placeholder="Track" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Tracks</SelectItem>
            <SelectItem value="none">No Track</SelectItem>
            {tracks?.map((t: { _id: string; name: string }) => (
              <SelectItem key={t._id} value={t._id}>{t.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={sortBy} onValueChange={(v) => setSortBy((v as SortKey) ?? 'name')}>
          <SelectTrigger className="h-9 text-sm shrink-0 w-[150px]"><SelectValue placeholder="Sort" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="name">Sort: Name</SelectItem>
            <SelectItem value="grade">Sort: Grade</SelectItem>
            <SelectItem value="progress">Sort: Lowest progress</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center justify-between mb-3">
        <p className="text-xs text-muted-foreground">
          {filteredStudents.length} student{filteredStudents.length !== 1 ? 's' : ''}
        </p>
        {hasActiveFilter && (
          <button
            onClick={() => { setSearch(''); setFilterGrade('all'); setFilterCenter('all'); setFilterTrack('all'); }}
            className="text-xs text-primary font-medium"
          >
            Clear filters
          </button>
        )}
      </div>

      {filteredStudents.length === 0 ? (
        <div className="text-center py-12 text-sm text-muted-foreground">
          No students match these filters.
        </div>
      ) : (
        <div className="space-y-2">
          {filteredStudents.map(student => {
            const center = student.centerId
              ? centers?.find((c: { _id: string }) => c._id === student.centerId)
              : null;
            const globalGrades = resolveAssignedGrades(student);
            const customCount = CURRICULUM_MODULES.filter((m) =>
              hasModuleOverride(student, m.id),
            ).length;
            const overall = overallByStudent.get(student._id) ?? { done: 0, total: 0, pct: 0 };

            return (
              <Card key={student._id} className="border-border/50 overflow-hidden">
                <CardContent className="p-3 space-y-2.5">
                  {/* Top: identity + overall progress */}
                  <div className="flex items-center gap-2.5">
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
                          <span className="text-[9px] px-1.5 py-0.5 rounded-md bg-primary/10 text-primary font-medium truncate max-w-[7rem]">
                            {(center as { name: string }).name}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="shrink-0 w-14 text-right" title={`${overall.done}/${overall.total} exercises done`}>
                      <div className={`text-sm font-bold tabular-nums ${progColor(overall.pct)}`}>
                        {overall.total > 0 ? `${overall.pct}%` : '—'}
                      </div>
                      <div className="h-1 mt-1 rounded-full bg-muted overflow-hidden">
                        <div
                          className={`h-full rounded-full ${progBar(overall.pct)}`}
                          style={{ width: `${overall.pct}%` }}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Bottom: track picker + actions */}
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <TrackPicker studentId={student._id} trackId={student.trackId} />
                    <div className="flex items-center gap-0.5 ml-auto">
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
                      <Link href={`/students/${student._id}/mastery`}>
                        <Button variant="ghost" size="icon-xs" title="Mastery">
                          <Brain className="w-3.5 h-3.5" />
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
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

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
              <Input id="phone" value={formPhone} onChange={e => setFormPhone(e.target.value)} placeholder="07XXXXXXXX (optional)" className="mt-1" />
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
            <Button onClick={handleSave} disabled={saving} className="w-full rounded-xl">
              {saving ? 'Saving…' : editingStudentId ? 'Update' : 'Add Student'}
            </Button>
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
