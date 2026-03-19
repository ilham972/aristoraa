'use client';

import { useState, useMemo } from 'react';
import { useQuery, useMutation } from 'convex/react';
import { Check, ChevronLeft, Clock, AlertTriangle, UserX, UserCheck, BookOpen, MoreHorizontal } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { getTodayDateStr } from '@/lib/types';
import { api } from '@/lib/convex';
import { CURRICULUM_MODULES, getModuleForDay, getOrderedUnits, findUnit } from '@/lib/curriculum-data';
import { getTotalCorrectForDay, calculateDailyPoints, getStudentNextExercise, getStudentUpcomingItems, type PositionOptions } from '@/lib/scoring';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription } from '@/components/ui/drawer';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { useCurrentTeacher } from '@/hooks/useCurrentTeacher';
import { useActiveSlot } from '@/hooks/useActiveSlot';
import type { Id } from '@/lib/convex';

type View = 'students' | 'scoring';

interface SelectedExercise {
  _id: Id<"exercises">;
  unitId: string;
  name: string;
  questionCount: number;
  order: number;
}

function formatTime12(time24: string): string {
  const [h, m] = time24.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

export default function ScoreEntryPage() {
  // View state
  const [view, setView] = useState<View>('students');
  const [selectedStudentId, setSelectedStudentId] = useState<Id<"students"> | null>(null);
  const [selectedExercise, setSelectedExercise] = useState<SelectedExercise | null>(null);
  const [selectedUnitId, setSelectedUnitId] = useState<string>('');
  const [selectedModuleId, setSelectedModuleId] = useState<string>('');
  const [questionStates, setQuestionStates] = useState<Record<number, 'correct' | 'wrong' | 'unmarked'>>({});
  const [existingEntryId, setExistingEntryId] = useState<Id<"entries"> | null>(null);
  const [initialQuestionStates, setInitialQuestionStates] = useState<Record<number, 'correct' | 'wrong' | 'unmarked'>>({});
  const [showContinuePrompt, setShowContinuePrompt] = useState(false);
  const [scoringContext, setScoringContext] = useState<'normal' | 'drawer'>('normal');

  // Per-card unit filter for snapshot
  const [cardUnitFilter, setCardUnitFilter] = useState<Record<string, string>>({});

  // Drawer state
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerStudentId, setDrawerStudentId] = useState<Id<"students"> | null>(null);
  const [drawerBrowseUnitId, setDrawerBrowseUnitId] = useState<string>('');
  const [drawerScoring, setDrawerScoring] = useState(false);

  // Attendance mode
  const [attendanceMode, setAttendanceMode] = useState(false);
  const [attendanceTab, setAttendanceTab] = useState<'present' | 'absent'>('present');

  // Manual slot selection
  const [manualSlotId, setManualSlotId] = useState<string>('');

  // Position override dialog
  const [positionDialogOpen, setPositionDialogOpen] = useState(false);
  const [positionDialogStudentId, setPositionDialogStudentId] = useState<Id<"students"> | null>(null);
  const [dialogModule, setDialogModule] = useState('');
  const [dialogGrade, setDialogGrade] = useState('');
  const [dialogTerm, setDialogTerm] = useState('');
  const [dialogPermanent, setDialogPermanent] = useState(false);

  // Unsaved changes
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false);
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);

  const today = getTodayDateStr();
  const todayModule = getModuleForDay(new Date().getDay());

  // Teacher & slot detection
  const { teacher } = useCurrentTeacher();
  const teacherSlotAssignments = useQuery(
    api.slotTeachers.listByTeacher,
    teacher ? { teacherId: teacher._id } : 'skip'
  );
  const allSlots = useQuery(api.scheduleSlots.list);
  const settings = useQuery(api.settings.get);
  const rooms = useQuery(api.rooms.list);
  const centers = useQuery(api.centers.list);

  const teacherSlots = useMemo(() => {
    if (!teacherSlotAssignments || !allSlots) return undefined;
    const slotIds = new Set(teacherSlotAssignments.map((st: typeof teacherSlotAssignments[0]) => st.slotId));
    return allSlots.filter((s: typeof allSlots[0]) => slotIds.has(s._id));
  }, [teacherSlotAssignments, allSlots]);

  const { activeSlot, nextSlot, minutesRemaining, allTodaySlots } = useActiveSlot(teacherSlots);

  const DAY_SHORT = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const availableSlots = useMemo(() => {
    if (!attendanceMode) return allTodaySlots;
    if (!allSlots) return [];
    const jsDay = new Date().getDay();
    const todayDow = jsDay === 0 ? 7 : jsDay;
    return [...allSlots].sort((a, b) => {
      const aToday = a.dayOfWeek === todayDow ? 0 : 1;
      const bToday = b.dayOfWeek === todayDow ? 0 : 1;
      if (aToday !== bToday) return aToday - bToday;
      if (a.dayOfWeek !== b.dayOfWeek) return a.dayOfWeek - b.dayOfWeek;
      return a.startTime.localeCompare(b.startTime);
    });
  }, [attendanceMode, allSlots, allTodaySlots]);

  const allowManual = settings?.allowManualSlotSelection;
  const effectiveSlot = useMemo(() => {
    if ((allowManual || attendanceMode) && manualSlotId) {
      return allSlots?.find((s: NonNullable<typeof allSlots>[0]) => s._id === manualSlotId) ?? null;
    }
    return activeSlot;
  }, [allowManual, attendanceMode, manualSlotId, allSlots, activeSlot]);

  const effectiveStudents = useQuery(
    api.scheduleSlots.getEffectiveStudents,
    effectiveSlot ? { slotId: effectiveSlot._id as Id<"scheduleSlots">, date: today } : 'skip'
  );

  const attendanceRecords = useQuery(
    api.attendance.getBySlotAndDate,
    effectiveSlot ? { slotId: effectiveSlot._id as Id<"scheduleSlots">, date: today } : 'skip'
  );

  const students = useQuery(api.students.list);
  const allEntries = useQuery(api.entries.list);
  const todayEntries = useQuery(api.entries.getByDate, { date: today });
  const allExercises = useQuery(api.exercises.list);
  const modulePositions = useQuery(api.studentModulePositions.list);

  const addEntryMutation = useMutation(api.entries.add);
  const updateEntryMutation = useMutation(api.entries.update);
  const setModulePositionMutation = useMutation(api.studentModulePositions.set);
  const markAbsentMutation = useMutation(api.attendance.markAbsent);
  const markPresentMutation = useMutation(api.attendance.markPresent);

  const slotStudentList = effectiveStudents ?? students;

  const absentStudentIds = useMemo(() => {
    if (!attendanceRecords) return new Set<string>();
    return new Set(attendanceRecords.filter((a: typeof attendanceRecords[0]) => a.status === 'absent').map((a: typeof attendanceRecords[0]) => a.studentId));
  }, [attendanceRecords]);

  const filteredStudents = useMemo(() => {
    if (!slotStudentList || !todayEntries) return [];
    const entered = new Set(todayEntries.map(e => e.studentId));
    return [...slotStudentList].sort((a, b) => {
      const aAbsent = absentStudentIds.has(a._id) ? 1 : 0;
      const bAbsent = absentStudentIds.has(b._id) ? 1 : 0;
      if (aAbsent !== bAbsent) return aAbsent - bAbsent;
      const aHas = entered.has(a._id) ? 1 : 0;
      const bHas = entered.has(b._id) ? 1 : 0;
      return aHas - bHas;
    });
  }, [slotStudentList, todayEntries, absentStudentIds]);

  const progressInfo = useMemo(() => {
    if (!slotStudentList || !todayEntries) return { scored: 0, absent: 0, total: 0 };
    const entered = new Set(todayEntries.map(e => e.studentId));
    const scored = slotStudentList.filter((s: { _id: Id<"students"> }) => entered.has(s._id)).length;
    const absent = slotStudentList.filter((s: { _id: Id<"students"> }) => absentStudentIds.has(s._id as string) && !entered.has(s._id)).length;
    return { scored, absent, total: slotStudentList.length };
  }, [slotStudentList, todayEntries, absentStudentIds]);

  const handled = progressInfo.scored + progressInfo.absent;
  const allHandled = handled >= progressInfo.total && progressInfo.total > 0;

  const hasUnsavedChanges = useMemo(() => {
    if (view !== 'scoring' && !drawerScoring) return false;
    for (const key of Object.keys(questionStates)) {
      if (questionStates[Number(key)] !== initialQuestionStates[Number(key)]) return true;
    }
    return false;
  }, [view, drawerScoring, questionStates, initialQuestionStates]);

  // Compute each student's position in today's module
  const studentPositions = useMemo(() => {
    if (!allExercises || !allEntries || !slotStudentList || !todayModule || !modulePositions) return new Map<string, { moduleId: string; grade: number; term: number; unitId: string; exerciseId: string }>();
    const positions = new Map<string, { moduleId: string; grade: number; term: number; unitId: string; exerciseId: string }>();
    const orderedUnits = getOrderedUnits(todayModule.id);

    for (const student of slotStudentList) {
      const override = modulePositions.find((p: { studentId: string; moduleId: string }) => p.studentId === student._id && p.moduleId === todayModule.id);
      const opts: PositionOptions = {
        positionOverride: override ? { grade: override.grade, term: override.term } : undefined,
        defaultGrade: student.schoolGrade,
      };
      const next = getStudentNextExercise(student._id, todayModule.id, allEntries, allExercises, orderedUnits, opts);
      if (next) {
        const unitInfo = findUnit(next.unitId);
        if (unitInfo) {
          positions.set(student._id, {
            moduleId: todayModule.id,
            grade: unitInfo.grade,
            term: unitInfo.term,
            unitId: next.unitId,
            exerciseId: next.exerciseId,
          });
        }
      }
    }
    return positions;
  }, [slotStudentList, allEntries, allExercises, todayModule, modulePositions]);

  // Snapshot for student cards
  const studentExerciseInfo = useMemo(() => {
    if (!allExercises || !allEntries || !slotStudentList || !todayEntries || !modulePositions) return new Map<string, { doneToday: string[]; upcoming: Array<{ id: string; name: string; type: string }> }>();
    const info = new Map<string, { doneToday: string[]; upcoming: Array<{ id: string; name: string; type: string }> }>();
    for (const student of slotStudentList) {
      const sTodayEntries = todayEntries.filter(e => e.studentId === student._id);
      const doneToday = sTodayEntries
        .map(e => allExercises.find(ex => ex._id === e.exerciseId)?.name)
        .filter((n): n is string => !!n);

      let upcoming: Array<{ id: string; name: string; type: string }> = [];
      if (todayModule) {
        const override = modulePositions.find((p: { studentId: string; moduleId: string }) => p.studentId === student._id && p.moduleId === todayModule.id);
        const opts: PositionOptions = {
          positionOverride: override ? { grade: override.grade, term: override.term } : undefined,
          defaultGrade: student.schoolGrade,
        };
        const orderedUnits = getOrderedUnits(todayModule.id);
        upcoming = getStudentUpcomingItems(student._id, todayModule.id, allEntries, allExercises, orderedUnits, 5, opts);
      }
      info.set(student._id, { doneToday, upcoming });
    }
    return info;
  }, [slotStudentList, todayEntries, allEntries, allExercises, todayModule, modulePositions]);

  const loading = !students || !allEntries || !todayEntries || !allExercises || settings === undefined || !modulePositions;

  if (loading) {
    return (
      <div className="px-4 pt-5 pb-6 max-w-lg mx-auto">
        <h1 className="text-lg font-bold text-foreground mb-4">Enter Scores</h1>
        <div className="animate-pulse space-y-2">
          {[1, 2, 3].map(i => <div key={i} className="h-16 bg-muted rounded-xl" />)}
        </div>
      </div>
    );
  }

  // Slot info
  const slotRoom = effectiveSlot ? rooms?.find((r: NonNullable<typeof rooms>[0]) => r._id === effectiveSlot.roomId) : null;
  const slotCenter = slotRoom ? centers?.find((c: NonNullable<typeof centers>[0]) => c._id === slotRoom.centerId) : null;
  const selectedStudent = selectedStudentId ? (slotStudentList ?? []).find((s: { _id: string; name: string }) => s._id === selectedStudentId) ?? students?.find((s: NonNullable<typeof students>[0]) => s._id === selectedStudentId) : null;
  const studentsWithEntries = new Set(todayEntries.map(e => e.studentId));

  // Timing warning
  const getTimingWarning = () => {
    if (!effectiveSlot || minutesRemaining === null) return null;
    if (minutesRemaining <= 0) return { level: 'critical' as const, text: 'Slot time ended — finish current students' };
    if (minutesRemaining <= 15) return { level: 'urgent' as const, text: `${minutesRemaining} min remaining — finish up!` };
    if (minutesRemaining <= 30) return { level: 'warning' as const, text: `${minutesRemaining} min remaining — keep going` };
    return null;
  };
  const timingWarning = getTimingWarning();

  // ─── Helpers ───

  const getPositionOpts = (studentId: string, moduleId: string, schoolGrade: number): PositionOptions => {
    const override = modulePositions?.find((p: { studentId: string; moduleId: string }) => p.studentId === studentId && p.moduleId === moduleId);
    return {
      positionOverride: override ? { grade: override.grade, term: override.term } : undefined,
      defaultGrade: schoolGrade,
    };
  };

  const getStudentTermUnits = (studentId: string) => {
    const pos = studentPositions.get(studentId);
    if (!pos || !todayModule) return [];
    const mod = CURRICULUM_MODULES.find(m => m.id === pos.moduleId);
    const grade = mod?.grades.find(g => g.grade === pos.grade);
    const term = grade?.terms.find(t => t.term === pos.term);
    return term?.units || [];
  };

  const getUnitSnapshotItems = (studentId: string, unitId: string, limit: number) => {
    const unitItems = allExercises
      .filter(e => e.unitId === unitId)
      .sort((a, b) => a.order - b.order);

    const items: Array<{ id: string; name: string; type: string; isCompleted: boolean }> = [];
    for (const item of unitItems) {
      const isConcept = item.type === 'concept';
      let isCompleted = false;
      if (!isConcept) {
        const entry = allEntries.find(e => e.studentId === studentId && e.exerciseId === item._id);
        isCompleted = !!(entry && entry.correctCount >= item.questionCount && item.questionCount > 0);
      }
      items.push({ id: item._id, name: item.name, type: item.type || 'exercise', isCompleted });
      if (items.length >= limit) break;
    }
    return items;
  };

  const setupScoring = (exercise: typeof allExercises[0], unitId: string, moduleId: string) => {
    setSelectedExercise(exercise);
    setSelectedUnitId(unitId);
    setSelectedModuleId(moduleId);

    const existing = todayEntries.find(e => e.studentId === (drawerScoring ? drawerStudentId : selectedStudentId) && e.exerciseId === exercise._id);
    const states: Record<number, 'correct' | 'wrong' | 'unmarked'> = {};
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
    setInitialQuestionStates({ ...states });
  };

  // ─── Card Tap: go directly to scoring ───

  const handleCardTap = (studentId: Id<"students">) => {
    if (absentStudentIds.has(studentId) && !attendanceMode) return;

    const student = (slotStudentList ?? []).find((s: { _id: string }) => s._id === studentId) ?? students?.find((s: NonNullable<typeof students>[0]) => s._id === studentId);
    if (!student || !todayModule) return;

    setSelectedStudentId(studentId);
    setShowContinuePrompt(false);

    const orderedUnits = getOrderedUnits(todayModule.id);
    const opts = getPositionOpts(studentId, todayModule.id, student.schoolGrade);
    const next = getStudentNextExercise(studentId, todayModule.id, allEntries, allExercises, orderedUnits, opts);

    if (next) {
      const exercise = allExercises.find(e => e._id === next.exerciseId);
      if (exercise) {
        setupScoring(exercise, next.unitId, todayModule.id);
        setScoringContext('normal');
        setView('scoring');
        return;
      }
    }
    toast('No pending exercises for this student');
  };

  // ─── Expand icon: open Drawer ───

  const handleExpandTap = (studentId: Id<"students">) => {
    const pos = studentPositions.get(studentId);
    setDrawerStudentId(studentId);
    setDrawerBrowseUnitId(pos?.unitId ?? '');
    setDrawerScoring(false);
    setDrawerOpen(true);
  };

  // ─── Drawer: exercise tap → scoring inside drawer ───

  const handleDrawerExerciseTap = (exercise: typeof allExercises[0], unitId: string, moduleId: string) => {
    setSelectedStudentId(drawerStudentId);
    setupScoring(exercise, unitId, moduleId);
    setScoringContext('drawer');
    setDrawerScoring(true);
  };

  // ─── Question toggling ───

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

  const activeStudentId = scoringContext === 'drawer' ? drawerStudentId : selectedStudentId;
  const studentDayEntries = activeStudentId
    ? todayEntries.filter(e => e.studentId === activeStudentId)
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

  // ─── Save ───

  const saveEntry = async () => {
    if (!activeStudentId || !selectedExercise) return;

    const questions: Record<string, 'correct' | 'wrong'> = {};
    for (const [k, v] of Object.entries(questionStates)) {
      if (v !== 'unmarked') questions[k] = v;
    }

    if (existingEntryId) {
      await updateEntryMutation({ id: existingEntryId, questions, correctCount, totalAttempted: attempted });
    } else {
      await addEntryMutation({
        studentId: activeStudentId,
        date: today,
        exerciseId: selectedExercise._id,
        unitId: selectedUnitId,
        moduleId: selectedModuleId,
        questions,
        correctCount,
        totalAttempted: attempted,
      });
    }

    if (effectiveSlot) {
      await markPresentMutation({ studentId: activeStudentId, slotId: effectiveSlot._id as Id<"scheduleSlots">, date: today });
    }

    const studentName = (slotStudentList ?? []).find((s: { _id: string; name: string }) => s._id === activeStudentId)?.name ?? '';
    toast.success(`${studentName}: ${correctCount} correct = ${pointsThisEntry} pts`);
  };

  const handleSave = async () => {
    await saveEntry();
    if (scoringContext === 'drawer') {
      setDrawerScoring(false);
      setSelectedExercise(null);
      setQuestionStates({});
      setInitialQuestionStates({});
      setExistingEntryId(null);
    } else {
      setShowContinuePrompt(true);
    }
  };

  const handleContinue = () => {
    setShowContinuePrompt(false);
    if (!selectedStudentId || !todayModule) {
      handleBackToStudents();
      return;
    }
    const student = (slotStudentList ?? []).find((s: { _id: string }) => s._id === selectedStudentId) ?? students?.find((s: NonNullable<typeof students>[0]) => s._id === selectedStudentId);
    if (!student) {
      handleBackToStudents();
      return;
    }
    const orderedUnits = getOrderedUnits(todayModule.id);
    const opts = getPositionOpts(selectedStudentId, todayModule.id, student.schoolGrade);
    const next = getStudentNextExercise(selectedStudentId, todayModule.id, allEntries, allExercises, orderedUnits, opts);

    if (next) {
      const exercise = allExercises.find(e => e._id === next.exerciseId);
      if (exercise) {
        setupScoring(exercise, next.unitId, todayModule.id);
        return;
      }
    }
    toast.success('All exercises completed!');
    handleBackToStudents();
  };

  const handleBackToStudents = () => {
    if (hasUnsavedChanges && !showContinuePrompt) {
      setPendingAction(() => () => doBackToStudents());
      setShowUnsavedDialog(true);
      return;
    }
    doBackToStudents();
  };

  const doBackToStudents = () => {
    setView('students');
    setSelectedStudentId(null);
    setSelectedExercise(null);
    setQuestionStates({});
    setInitialQuestionStates({});
    setExistingEntryId(null);
    setShowContinuePrompt(false);
  };

  const handleDrawerBack = () => {
    if (hasUnsavedChanges) {
      setPendingAction(() => () => {
        setDrawerScoring(false);
        setSelectedExercise(null);
        setQuestionStates({});
        setInitialQuestionStates({});
        setExistingEntryId(null);
      });
      setShowUnsavedDialog(true);
      return;
    }
    setDrawerScoring(false);
    setSelectedExercise(null);
    setQuestionStates({});
    setInitialQuestionStates({});
    setExistingEntryId(null);
  };

  const handleDrawerClose = (open: boolean) => {
    if (!open && drawerScoring && hasUnsavedChanges) {
      setPendingAction(() => () => {
        setDrawerScoring(false);
        setDrawerOpen(false);
      });
      setShowUnsavedDialog(true);
      return;
    }
    if (!open) {
      setDrawerScoring(false);
      setSelectedExercise(null);
      setQuestionStates({});
      setInitialQuestionStates({});
      setExistingEntryId(null);
    }
    setDrawerOpen(open);
  };

  // No active slot
  const noSlot = !effectiveSlot && !allowManual && teacher && teacherSlots && teacherSlots.length > 0;

  // ─── Scoring UI (shared between normal view and drawer) ───

  const renderScoringUI = (onSave: () => Promise<void>, onBack: () => void, backLabel: string) => {
    if (!selectedExercise) return null;
    const exerciseUnitInfo = findUnit(selectedUnitId);
    return (
      <div className="px-4 pb-6">
        {/* Context bar */}
        <div className="flex items-center gap-3 mb-4">
          <button onClick={onBack} className="w-8 h-8 rounded-full bg-muted flex items-center justify-center hover:bg-muted/80 transition-all active:scale-90">
            <ChevronLeft className="w-4 h-4 text-foreground" />
          </button>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-foreground truncate">
              {(slotStudentList ?? []).find((s: { _id: string; name: string }) => s._id === activeStudentId)?.name}
            </p>
            <p className="text-xs text-muted-foreground truncate">
              {selectedExercise.name}
              {exerciseUnitInfo ? ` · ${exerciseUnitInfo.unit.name}` : ''}
            </p>
          </div>
          <Badge variant="secondary" className="text-[10px] shrink-0">
            {selectedExercise.questionCount}Q
          </Badge>
        </div>

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
                {state === 'correct' && '\u2713'}
                {state === 'wrong' && '\u2717'}
                {state === 'unmarked' && qNum}
              </button>
            );
          })}
        </div>

        <Button onClick={onSave} className="w-full h-12 text-base font-semibold rounded-xl">
          Save Entry
        </Button>
      </div>
    );
  };

  // ─── Drawer browse content ───

  const renderDrawerBrowse = () => {
    if (!drawerStudentId) return null;
    const drawerStudent = (slotStudentList ?? []).find((s: { _id: string }) => s._id === drawerStudentId);
    if (!drawerStudent) return null;
    const pos = studentPositions.get(drawerStudentId);
    const dayEntries = todayEntries.filter(e => e.studentId === drawerStudentId);
    const dayCorrect = dayEntries.reduce((sum, e) => sum + e.correctCount, 0);

    // Get units for current term
    let termUnits: Array<{ id: string; name: string }> = [];
    let moduleId = '';
    if (pos && todayModule) {
      moduleId = pos.moduleId;
      const mod = CURRICULUM_MODULES.find(m => m.id === pos.moduleId);
      const grade = mod?.grades.find(g => g.grade === pos.grade);
      const term = grade?.terms.find(t => t.term === pos.term);
      termUnits = term?.units ?? [];
    }

    const activeUnit = drawerBrowseUnitId || (termUnits[0]?.id ?? '');

    return (
      <div className="px-4 pb-6">
        {/* Daily stats */}
        {dayCorrect > 0 && (
          <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-2.5 mb-3 flex items-center justify-between">
            <span className="text-xs font-medium text-emerald-600">{dayCorrect} correct today</span>
            <span className="text-xs font-bold text-emerald-600">{calculateDailyPoints(dayCorrect)} pts</span>
          </div>
        )}

        {/* Context */}
        {pos && (
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs text-muted-foreground">
              <span className="font-semibold">{pos.moduleId}</span> · Grade {pos.grade} · Term {pos.term}
            </p>
            <button
              className="text-[10px] text-primary font-medium"
              onClick={() => {
                setPositionDialogStudentId(drawerStudentId);
                setDialogModule(pos.moduleId);
                setDialogGrade(String(pos.grade));
                setDialogTerm(String(pos.term));
                setDialogPermanent(false);
                setPositionDialogOpen(true);
              }}
            >
              Change
            </button>
          </div>
        )}

        {/* Unit badges */}
        {termUnits.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-3">
            {termUnits.map(unit => {
              const isActive = unit.id === activeUnit;
              const unitNumber = unit.name.match(/^(\d+)\./)?.[1] || unit.name.slice(0, 4);
              return (
                <button
                  key={unit.id}
                  onClick={() => setDrawerBrowseUnitId(unit.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all active:scale-95 ${
                    isActive
                      ? 'bg-primary text-primary-foreground shadow-sm'
                      : 'bg-muted text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {unitNumber}
                </button>
              );
            })}
          </div>
        )}

        {/* Exercise / concept list */}
        {activeUnit && (() => {
          const unit = termUnits.find(u => u.id === activeUnit);
          if (!unit) return null;
          const unitItems = allExercises.filter(e => e.unitId === unit.id).sort((a, b) => a.order - b.order);
          const nextExerciseId = pos?.exerciseId;

          return (
            <div>
              <p className="text-sm font-medium text-foreground mb-2">{unit.name}</p>
              {unitItems.length === 0 ? (
                <p className="text-xs text-muted-foreground">No exercises configured yet</p>
              ) : (
                <div className="space-y-1">
                  {unitItems.map(item => {
                    const isConcept = item.type === 'concept';
                    const isNext = item._id === nextExerciseId;

                    if (isConcept) {
                      return (
                        <div key={item._id} className="flex items-center gap-2 py-1.5 px-2.5 bg-accent/50 rounded-lg">
                          <BookOpen className="w-3.5 h-3.5 text-primary shrink-0" />
                          <span className="text-xs font-medium text-primary flex-1">{item.name}</span>
                          {item.pageNumber && (
                            <span className="text-[10px] text-muted-foreground">p.{item.pageNumber}</span>
                          )}
                        </div>
                      );
                    }

                    const entry = allEntries.find(e => e.studentId === drawerStudentId && e.exerciseId === item._id);
                    const isCompleted = entry && entry.correctCount >= item.questionCount && item.questionCount > 0;

                    return (
                      <Card
                        key={item._id}
                        className={`border-border/50 cursor-pointer transition-all active:scale-[0.98] ${
                          isNext ? 'border-primary/40 bg-primary/5' :
                          isCompleted ? 'opacity-60' :
                          'hover:border-primary/30'
                        }`}
                        onClick={() => handleDrawerExerciseTap(item, unit.id, moduleId)}
                      >
                        <CardContent className="p-2.5 flex items-center gap-2">
                          {isCompleted ? (
                            <div className="w-5 h-5 rounded-full bg-emerald-500/15 flex items-center justify-center shrink-0">
                              <Check className="w-3 h-3 text-emerald-500" />
                            </div>
                          ) : isNext ? (
                            <span className="text-xs text-primary font-bold shrink-0 w-5 text-center">{'\u2192'}</span>
                          ) : (
                            <span className="w-5 shrink-0" />
                          )}
                          <div className="flex-1 min-w-0">
                            <p className={`text-sm font-medium ${isCompleted ? 'text-muted-foreground' : 'text-foreground'}`}>{item.name}</p>
                            <p className="text-xs text-muted-foreground">
                              {item.questionCount} questions
                              {entry ? ` · ${entry.correctCount}/${item.questionCount} correct` : ''}
                              {item.pageNumber ? ` · p.${item.pageNumber}` : ''}
                            </p>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })()}
      </div>
    );
  };

  return (
    <div className="px-4 pt-5 pb-6 max-w-lg mx-auto">
      {/* Header */}
      <div className="mb-2">
        <h1 className="text-lg font-bold text-foreground">Enter Scores</h1>
        {todayModule && (
          <p className="text-xs font-medium" style={{ color: todayModule.color }}>
            {todayModule.id}: {todayModule.name}
          </p>
        )}
      </div>

      {/* Slot info banner */}
      {effectiveSlot && slotRoom && view === 'students' && (
        <div className="bg-primary/5 border border-primary/20 rounded-xl p-3 mb-3">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-primary shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground">
                {slotRoom.name}{slotCenter ? ` @ ${slotCenter.name}` : ''}
              </p>
              <p className="text-xs text-muted-foreground">
                {formatTime12(effectiveSlot.startTime)} - {formatTime12(effectiveSlot.endTime)}
              </p>
            </div>
            <Badge variant="secondary" className="text-[10px] shrink-0">
              {handled}/{progressInfo.total}
            </Badge>
          </div>
          {progressInfo.total > 0 && (
            <div className="mt-2 h-1.5 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-primary rounded-full transition-all"
                style={{ width: `${(handled / progressInfo.total) * 100}%` }}
              />
            </div>
          )}
        </div>
      )}

      {/* Manual slot selection */}
      {(allowManual || attendanceMode) && availableSlots.length > 0 && view === 'students' && (
        <div className="mb-3">
          <Select value={manualSlotId || (activeSlot?._id ?? '')} onValueChange={(v: string | null) => setManualSlotId(v ?? '')}>
            <SelectTrigger className="h-10 text-sm">
              <SelectValue placeholder={attendanceMode ? 'Select a slot for attendance' : 'Select a slot'} />
            </SelectTrigger>
            <SelectContent>
              {availableSlots.map((slot: typeof availableSlots[0]) => {
                const room = rooms?.find((r: NonNullable<typeof rooms>[0]) => r._id === slot.roomId);
                return (
                  <SelectItem key={slot._id} value={slot._id}>
                    {attendanceMode ? `${DAY_SHORT[slot.dayOfWeek]} ` : ''}{formatTime12(slot.startTime)} - {formatTime12(slot.endTime)} ({room?.name ?? 'Room'})
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Timing warning */}
      {timingWarning && view === 'students' && (
        <div className={`rounded-xl p-3 mb-3 flex items-center gap-2 ${
          timingWarning.level === 'critical' ? 'bg-red-500/10 border border-red-500/30 animate-pulse' :
          timingWarning.level === 'urgent' ? 'bg-red-500/10 border border-red-500/20' :
          'bg-amber-500/10 border border-amber-500/20'
        }`}>
          <AlertTriangle className={`w-4 h-4 shrink-0 ${
            timingWarning.level === 'critical' || timingWarning.level === 'urgent' ? 'text-red-500' : 'text-amber-500'
          }`} />
          <p className={`text-xs font-medium ${
            timingWarning.level === 'critical' || timingWarning.level === 'urgent' ? 'text-red-500' : 'text-amber-500'
          }`}>
            {timingWarning.text}
          </p>
        </div>
      )}

      {/* Slot complete banner */}
      {allHandled && effectiveSlot && view === 'students' && (
        <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-3 mb-3 text-center">
          <p className="text-sm font-semibold text-emerald-600">Slot Complete!</p>
          {nextSlot && (
            <Button
              size="sm"
              className="mt-2 rounded-xl"
              onClick={() => {
                setManualSlotId(nextSlot._id);
                setSelectedStudentId(null);
                setSelectedExercise(null);
              }}
            >
              Start Next Slot
            </Button>
          )}
        </div>
      )}

      {/* No active slot message */}
      {noSlot && !allowManual && view === 'students' && (
        <Card className="border-border/50 mb-3">
          <CardContent className="p-4 text-center">
            <p className="text-sm text-muted-foreground mb-2">No active class right now</p>
            {allTodaySlots.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Today&apos;s schedule:</p>
                {allTodaySlots.map((slot: typeof allTodaySlots[0]) => {
                  const room = rooms?.find((r: NonNullable<typeof rooms>[0]) => r._id === slot.roomId);
                  return (
                    <p key={slot._id} className="text-xs text-foreground">
                      {formatTime12(slot.startTime)} - {formatTime12(slot.endTime)} ({room?.name ?? 'Room'})
                    </p>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ═══ Students View ═══ */}
      {view === 'students' && (
        <div>
          {/* Attendance mode toggle */}
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-medium text-muted-foreground">
              {absentStudentIds.size > 0 && !attendanceMode && (
                <Badge variant="destructive" className="text-[10px] mr-1">{absentStudentIds.size} absent</Badge>
              )}
            </span>
            <button
              onClick={() => { setAttendanceMode(!attendanceMode); setAttendanceTab('present'); }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                attendanceMode
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:text-foreground'
              }`}
            >
              {attendanceMode ? <UserX className="w-3.5 h-3.5" /> : <UserCheck className="w-3.5 h-3.5" />}
              Attendance
            </button>
          </div>

          {/* Attendance: no slot */}
          {attendanceMode && !effectiveSlot && (
            <Card className="border-amber-500/30 bg-amber-500/5 mb-3">
              <CardContent className="p-3 text-center">
                <p className="text-sm text-amber-600 dark:text-amber-400 font-medium">
                  {availableSlots.length > 0
                    ? 'Select a time slot above to take attendance'
                    : 'No slots for today — configure schedule in Settings'}
                </p>
              </CardContent>
            </Card>
          )}

          {/* Attendance sub-tabs */}
          {attendanceMode && effectiveSlot && (
            <div className="flex gap-1.5 p-1 bg-muted rounded-xl mb-3">
              <button
                onClick={() => setAttendanceTab('present')}
                className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  attendanceTab === 'present' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground'
                }`}
              >
                Present ({filteredStudents.filter(s => !absentStudentIds.has(s._id)).length})
              </button>
              <button
                onClick={() => setAttendanceTab('absent')}
                className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  attendanceTab === 'absent' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground'
                }`}
              >
                Absent ({absentStudentIds.size})
              </button>
            </div>
          )}

          {/* Student cards */}
          <div className="space-y-1.5">
            {filteredStudents
              .filter(student => {
                if (!attendanceMode) return true;
                if (attendanceTab === 'present') return !absentStudentIds.has(student._id);
                return absentStudentIds.has(student._id);
              })
              .map(student => {
              const hasEntry = studentsWithEntries.has(student._id);
              const isSelected = student._id === selectedStudentId;
              const isAbsent = absentStudentIds.has(student._id);
              const info = studentExerciseInfo.get(student._id);
              const pos = studentPositions.get(student._id);
              const termUnits = getStudentTermUnits(student._id);
              const unitFilter = cardUnitFilter[student._id];

              // Determine snapshot items
              const snapshotLimit = isSelected ? 5 : 3;
              let snapshotItems: Array<{ id: string; name: string; type: string; isCompleted?: boolean }>;
              if (unitFilter) {
                snapshotItems = getUnitSnapshotItems(student._id, unitFilter, snapshotLimit);
              } else {
                snapshotItems = (info?.upcoming ?? []).slice(0, snapshotLimit);
              }

              return (
                <Card
                  key={student._id}
                  className={`transition-all border-border/50 ${
                    isAbsent && !attendanceMode ? 'opacity-50 cursor-not-allowed' :
                    'cursor-pointer active:scale-[0.98]'
                  } ${
                    hasEntry ? 'bg-primary/5 border-primary/20' : 'hover:border-primary/30'
                  } ${isSelected ? 'ring-1 ring-primary/40' : ''}`}
                  onClick={() => {
                    if (attendanceMode && effectiveSlot) {
                      if (isAbsent) {
                        markPresentMutation({ studentId: student._id, slotId: effectiveSlot._id as Id<"scheduleSlots">, date: today });
                        toast.success(`${student.name} marked present`);
                      } else {
                        markAbsentMutation({ studentId: student._id, slotId: effectiveSlot._id as Id<"scheduleSlots">, date: today });
                        toast.success(`${student.name} marked absent`);
                      }
                    } else {
                      handleCardTap(student._id);
                    }
                  }}
                >
                  <CardContent className="p-3">
                    {/* Row 1: Name + position badge + expand */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        {isAbsent ? (
                          <div className="w-7 h-7 rounded-full bg-red-500/15 flex items-center justify-center">
                            <UserX className="w-4 h-4 text-red-500" />
                          </div>
                        ) : hasEntry ? (
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
                          <p className="text-xs text-muted-foreground">Grade {student.schoolGrade}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {!attendanceMode && pos && (
                          <button
                            className="px-2 py-1 rounded-lg bg-muted hover:bg-muted/80 text-[11px] font-mono font-semibold text-foreground transition-all active:scale-95"
                            onClick={e => {
                              e.stopPropagation();
                              setPositionDialogStudentId(student._id);
                              setDialogModule(todayModule?.id ?? '');
                              setDialogGrade(String(pos.grade));
                              setDialogTerm(String(pos.term));
                              setDialogPermanent(false);
                              setPositionDialogOpen(true);
                            }}
                          >
                            G{pos.grade}{'\u00B7'}T{pos.term}
                          </button>
                        )}
                        {!attendanceMode && (
                          <button
                            className="w-7 h-7 rounded-lg bg-muted hover:bg-muted/80 flex items-center justify-center transition-all active:scale-95"
                            onClick={e => {
                              e.stopPropagation();
                              handleExpandTap(student._id);
                            }}
                          >
                            <MoreHorizontal className="w-3.5 h-3.5 text-muted-foreground" />
                          </button>
                        )}
                        {attendanceMode && effectiveSlot && (
                          <Button
                            size="sm"
                            variant={isAbsent ? 'default' : 'destructive'}
                            className="h-7 text-[10px] rounded-lg"
                            onClick={e => {
                              e.stopPropagation();
                              if (isAbsent) {
                                markPresentMutation({ studentId: student._id, slotId: effectiveSlot._id as Id<"scheduleSlots">, date: today });
                                toast.success(`${student.name} marked present`);
                              } else {
                                markAbsentMutation({ studentId: student._id, slotId: effectiveSlot._id as Id<"scheduleSlots">, date: today });
                                toast.success(`${student.name} marked absent`);
                              }
                            }}
                          >
                            {isAbsent ? 'Mark Present' : 'Mark Absent'}
                          </Button>
                        )}
                      </div>
                    </div>

                    {/* Row 2: Unit badges */}
                    {!attendanceMode && termUnits.length > 0 && (
                      <div className="mt-2 ml-10 flex flex-wrap gap-1">
                        {termUnits.map(unit => {
                          const isCurrent = unit.id === pos?.unitId;
                          const isFiltered = unit.id === unitFilter;
                          const unitNumber = unit.name.match(/^(\d+)\./)?.[1] || unit.name.slice(0, 3);
                          return (
                            <button
                              key={unit.id}
                              onClick={e => {
                                e.stopPropagation();
                                setCardUnitFilter(prev => {
                                  const next = { ...prev };
                                  if (next[student._id] === unit.id) {
                                    delete next[student._id];
                                  } else {
                                    next[student._id] = unit.id;
                                  }
                                  return next;
                                });
                              }}
                              className={`px-2 py-0.5 rounded text-[10px] font-medium transition-all active:scale-95 ${
                                isFiltered
                                  ? 'bg-primary text-primary-foreground'
                                  : isCurrent
                                  ? 'bg-primary/20 text-primary'
                                  : 'bg-muted text-muted-foreground'
                              }`}
                            >
                              {unitNumber}
                            </button>
                          );
                        })}
                      </div>
                    )}

                    {/* Row 3: Snapshot */}
                    {!attendanceMode && (
                      (info && info.doneToday.length > 0) || snapshotItems.length > 0
                    ) && (
                      <div className="mt-1.5 ml-10 flex flex-wrap items-center gap-1">
                        {info?.doneToday.map((name, i) => (
                          <span key={`done-${i}`} className="text-[10px] bg-emerald-500/10 text-emerald-600 rounded-md px-1.5 py-0.5 font-medium">
                            {'\u2713'} {name}
                          </span>
                        ))}
                        {snapshotItems.map((item, i) => {
                          const firstExerciseIdx = snapshotItems.findIndex(u => u.type !== 'concept');
                          if (item.type === 'concept') {
                            return (
                              <span key={item.id} className="text-[10px] bg-primary/10 text-primary rounded-md px-1.5 py-0.5 font-medium">
                                {'\u2630'} {item.name}
                              </span>
                            );
                          }
                          const isCompleted = 'isCompleted' in item && item.isCompleted;
                          return (
                            <span key={item.id} className={`text-[10px] rounded-md px-1.5 py-0.5 ${
                              isCompleted
                                ? 'bg-emerald-500/10 text-emerald-600 line-through'
                                : 'bg-muted text-muted-foreground'
                            }`}>
                              {!isCompleted && i === firstExerciseIdx ? '\u2192 ' : ''}{item.name}
                            </span>
                          );
                        })}
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {/* ═══ Scoring View (normal flow) ═══ */}
      {view === 'scoring' && selectedExercise && (
        <div>
          {renderScoringUI(handleSave, handleBackToStudents, 'Students')}

          {/* Continue prompt */}
          {showContinuePrompt && (
            <div className="fixed bottom-0 left-0 right-0 p-4 bg-background/95 backdrop-blur-sm border-t z-40">
              <div className="max-w-lg mx-auto space-y-2">
                <p className="text-sm font-medium text-center text-foreground">Continue to next exercise?</p>
                <div className="flex gap-2">
                  <Button className="flex-1 rounded-xl" onClick={handleContinue}>
                    Next Exercise
                  </Button>
                  <Button variant="outline" className="flex-1 rounded-xl" onClick={() => { setShowContinuePrompt(false); doBackToStudents(); }}>
                    Back to Students
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ═══ Right Drawer (full browse) ═══ */}
      <Drawer direction="right" open={drawerOpen} onOpenChange={handleDrawerClose}>
        <DrawerContent style={{ width: '100%', maxWidth: '100%' }}>
          <div className="flex flex-col h-full">
            {/* Drawer header */}
            <DrawerHeader className="border-b">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => drawerScoring ? handleDrawerBack() : handleDrawerClose(false)}
                  className="w-8 h-8 rounded-full bg-muted flex items-center justify-center hover:bg-muted/80 transition-all active:scale-90"
                >
                  <ChevronLeft className="w-4 h-4 text-foreground" />
                </button>
                <div className="flex-1 min-w-0">
                  <DrawerTitle className="text-sm truncate">
                    {(slotStudentList ?? []).find((s: { _id: string; name: string }) => s._id === drawerStudentId)?.name ?? 'Student'}
                  </DrawerTitle>
                  <DrawerDescription className="text-xs truncate">
                    {drawerScoring && selectedExercise ? selectedExercise.name : 'Browse exercises'}
                  </DrawerDescription>
                </div>
              </div>
            </DrawerHeader>

            {/* Sliding panels */}
            <div className="flex-1 relative overflow-hidden">
              {/* Browse panel */}
              <div className={`absolute inset-0 overflow-y-auto no-scrollbar transition-transform duration-300 ${
                drawerScoring ? '-translate-x-full' : 'translate-x-0'
              }`}>
                <div className="pt-4">
                  {renderDrawerBrowse()}
                </div>
              </div>

              {/* Scoring panel */}
              <div className={`absolute inset-0 overflow-y-auto no-scrollbar transition-transform duration-300 ${
                drawerScoring ? 'translate-x-0' : 'translate-x-full'
              }`}>
                <div className="pt-4">
                  {drawerScoring && selectedExercise && renderScoringUI(
                    handleSave,
                    handleDrawerBack,
                    'Exercises'
                  )}
                </div>
              </div>
            </div>
          </div>
        </DrawerContent>
      </Drawer>

      {/* ═══ Unsaved changes dialog ═══ */}
      <Dialog open={showUnsavedDialog} onOpenChange={(open) => {
        if (!open) { setShowUnsavedDialog(false); setPendingAction(null); }
      }}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Unsaved Changes</DialogTitle>
            <DialogDescription>You have unsaved question marks. Save before leaving?</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => {
              setShowUnsavedDialog(false);
              if (pendingAction) {
                pendingAction();
                setPendingAction(null);
              }
            }}>Leave</Button>
            <Button onClick={async () => {
              await saveEntry();
              setShowUnsavedDialog(false);
              if (pendingAction) {
                pendingAction();
                setPendingAction(null);
              }
            }}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ═══ Position override dialog ═══ */}
      <Dialog open={positionDialogOpen} onOpenChange={setPositionDialogOpen}>
        <DialogContent className="max-w-sm mx-auto">
          <DialogHeader>
            <DialogTitle>Change Position</DialogTitle>
            <DialogDescription>Override module, grade, and term for this student</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-sm">Module</Label>
              <Select value={dialogModule} onValueChange={v => setDialogModule(v ?? '')}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Module" /></SelectTrigger>
                <SelectContent>
                  {CURRICULUM_MODULES.map(m => (
                    <SelectItem key={m.id} value={m.id}>{m.id}: {m.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {dialogModule && (() => {
              const mod = CURRICULUM_MODULES.find(m => m.id === dialogModule);
              if (!mod) return null;
              return (
                <>
                  <div>
                    <Label className="text-sm">Grade</Label>
                    <Select value={dialogGrade} onValueChange={v => { setDialogGrade(v ?? ''); setDialogTerm(''); }}>
                      <SelectTrigger className="mt-1"><SelectValue placeholder="Grade" /></SelectTrigger>
                      <SelectContent>
                        {mod.grades.map(g => (
                          <SelectItem key={g.grade} value={String(g.grade)}>Grade {g.grade}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {dialogGrade && (() => {
                    const grade = mod.grades.find(g => g.grade === parseInt(dialogGrade));
                    if (!grade) return null;
                    return (
                      <div>
                        <Label className="text-sm">Term</Label>
                        <Select value={dialogTerm} onValueChange={v => setDialogTerm(v ?? '')}>
                          <SelectTrigger className="mt-1"><SelectValue placeholder="Term" /></SelectTrigger>
                          <SelectContent>
                            {grade.terms.map(t => (
                              <SelectItem key={t.term} value={String(t.term)}>Term {t.term}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    );
                  })()}
                </>
              );
            })()}

            {/* Permanent toggle */}
            <div className="flex items-center gap-3 pt-1">
              <button
                onClick={() => setDialogPermanent(!dialogPermanent)}
                className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${dialogPermanent ? 'bg-primary' : 'bg-muted-foreground/30'}`}
              >
                <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform ${dialogPermanent ? 'translate-x-5' : ''}`} />
              </button>
              <div>
                <Label className="text-sm">Save permanently</Label>
                <p className="text-xs text-muted-foreground">Sets this as the student&apos;s starting position for this module</p>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPositionDialogOpen(false)}>Cancel</Button>
            <Button
              disabled={!dialogModule || !dialogGrade || !dialogTerm}
              onClick={async () => {
                const newGrade = parseInt(dialogGrade);
                const newTerm = parseInt(dialogTerm);

                if (dialogPermanent && positionDialogStudentId) {
                  await setModulePositionMutation({
                    studentId: positionDialogStudentId,
                    moduleId: dialogModule,
                    grade: newGrade,
                    term: newTerm,
                  });
                  toast.success('Position saved permanently');
                }

                setPositionDialogOpen(false);
              }}
            >
              Apply
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
