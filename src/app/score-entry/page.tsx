'use client';

import { useState, useMemo } from 'react';
import { useQuery, useMutation } from 'convex/react';
import { Check, ChevronRight, Clock, AlertTriangle, UserX, UserCheck } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { getTodayDateStr } from '@/lib/types';
import { api } from '@/lib/convex';
import { CURRICULUM_MODULES, getModuleForDay, getOrderedUnits, findUnit } from '@/lib/curriculum-data';
import { getTotalCorrectForDay, calculateDailyPoints, getStudentNextExercise, getStudentUpcomingExercises } from '@/lib/scoring';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { useCurrentTeacher } from '@/hooks/useCurrentTeacher';
import { useActiveSlot } from '@/hooks/useActiveSlot';
import type { Id } from '@/lib/convex';

type Step = 'select-student' | 'select-exercise' | 'mark-questions';

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
  const [step, setStep] = useState<Step>('select-student');
  const [selectedStudentId, setSelectedStudentId] = useState<Id<"students"> | null>(null);
  const [selectedExercise, setSelectedExercise] = useState<SelectedExercise | null>(null);
  const [selectedUnitId, setSelectedUnitId] = useState<string>('');
  const [selectedModuleId, setSelectedModuleId] = useState<string>('');
  const [questionStates, setQuestionStates] = useState<Record<number, 'correct' | 'wrong' | 'unmarked'>>({});
  const [existingEntryId, setExistingEntryId] = useState<Id<"entries"> | null>(null);
  const [initialQuestionStates, setInitialQuestionStates] = useState<Record<number, 'correct' | 'wrong' | 'unmarked'>>({});
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false);
  const [pendingStepTarget, setPendingStepTarget] = useState<number | null>(null);

  // Attendance mode
  const [attendanceMode, setAttendanceMode] = useState(false);
  const [attendanceTab, setAttendanceTab] = useState<'present' | 'absent'>('present');

  // Manual slot selection
  const [manualSlotId, setManualSlotId] = useState<string>('');

  // Browse mode
  const [browseMode, setBrowseMode] = useState(false);
  const [browseModule, setBrowseModule] = useState<string>('');
  const [browseGrade, setBrowseGrade] = useState<string>('');
  const [browseTerm, setBrowseTerm] = useState<string>('');

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

  // Build teacher's slot list with full info
  const teacherSlots = useMemo(() => {
    if (!teacherSlotAssignments || !allSlots) return undefined;
    const slotIds = new Set(teacherSlotAssignments.map((st: typeof teacherSlotAssignments[0]) => st.slotId));
    return allSlots.filter((s: typeof allSlots[0]) => slotIds.has(s._id));
  }, [teacherSlotAssignments, allSlots]);

  const { activeSlot, nextSlot, minutesRemaining, allTodaySlots } = useActiveSlot(teacherSlots);

  // In attendance mode: show ALL slots (any day) so teacher can always take attendance
  const DAY_SHORT = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const availableSlots = useMemo(() => {
    if (!attendanceMode) return allTodaySlots;
    if (!allSlots) return [];
    const jsDay = new Date().getDay();
    const todayDow = jsDay === 0 ? 7 : jsDay;
    return [...allSlots].sort((a, b) => {
      // Today's slots first
      const aToday = a.dayOfWeek === todayDow ? 0 : 1;
      const bToday = b.dayOfWeek === todayDow ? 0 : 1;
      if (aToday !== bToday) return aToday - bToday;
      if (a.dayOfWeek !== b.dayOfWeek) return a.dayOfWeek - b.dayOfWeek;
      return a.startTime.localeCompare(b.startTime);
    });
  }, [attendanceMode, allSlots, allTodaySlots]);

  // Determine effective slot
  const allowManual = settings?.allowManualSlotSelection;
  const effectiveSlot = useMemo(() => {
    if ((allowManual || attendanceMode) && manualSlotId) {
      return allSlots?.find((s: NonNullable<typeof allSlots>[0]) => s._id === manualSlotId) ?? null;
    }
    return activeSlot;
  }, [allowManual, attendanceMode, manualSlotId, allSlots, activeSlot]);

  // Effective students for the slot
  const effectiveStudents = useQuery(
    api.scheduleSlots.getEffectiveStudents,
    effectiveSlot ? { slotId: effectiveSlot._id as Id<"scheduleSlots">, date: today } : 'skip'
  );

  // Attendance for slot
  const attendanceRecords = useQuery(
    api.attendance.getBySlotAndDate,
    effectiveSlot ? { slotId: effectiveSlot._id as Id<"scheduleSlots">, date: today } : 'skip'
  );

  const students = useQuery(api.students.list);
  const allEntries = useQuery(api.entries.list);
  const todayEntries = useQuery(api.entries.getByDate, { date: today });
  const allExercises = useQuery(api.exercises.list);

  const addEntryMutation = useMutation(api.entries.add);
  const updateEntryMutation = useMutation(api.entries.update);
  const markAbsentMutation = useMutation(api.attendance.markAbsent);
  const markPresentMutation = useMutation(api.attendance.markPresent);

  // Which students to show — slot students if available, else all
  const slotStudentList = effectiveStudents ?? students;

  const absentStudentIds = useMemo(() => {
    if (!attendanceRecords) return new Set<string>();
    return new Set(attendanceRecords.filter((a: typeof attendanceRecords[0]) => a.status === 'absent').map((a: typeof attendanceRecords[0]) => a.studentId));
  }, [attendanceRecords]);

  const filteredStudents = useMemo(() => {
    if (!slotStudentList || !todayEntries) return [];
    const entered = new Set(todayEntries.map(e => e.studentId));
    return [...slotStudentList].sort((a, b) => {
      // Absent at bottom
      const aAbsent = absentStudentIds.has(a._id) ? 1 : 0;
      const bAbsent = absentStudentIds.has(b._id) ? 1 : 0;
      if (aAbsent !== bAbsent) return aAbsent - bAbsent;
      // Scored after unscored
      const aHas = entered.has(a._id) ? 1 : 0;
      const bHas = entered.has(b._id) ? 1 : 0;
      return aHas - bHas;
    });
  }, [slotStudentList, todayEntries, absentStudentIds]);

  // Progress tracking
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
    if (step !== 'mark-questions') return false;
    for (const key of Object.keys(questionStates)) {
      if (questionStates[Number(key)] !== initialQuestionStates[Number(key)]) return true;
    }
    return false;
  }, [step, questionStates, initialQuestionStates]);

  // Exercise snapshot for student cards
  const studentExerciseInfo = useMemo(() => {
    if (!allExercises || !allEntries || !slotStudentList || !todayEntries) return new Map<string, { doneToday: string[]; upcoming: Array<{ exerciseId: string; name: string }> }>();
    const info = new Map<string, { doneToday: string[]; upcoming: Array<{ exerciseId: string; name: string }> }>();
    for (const student of slotStudentList) {
      const sTodayEntries = todayEntries.filter(e => e.studentId === student._id);
      const doneToday = sTodayEntries
        .map(e => allExercises.find(ex => ex._id === e.exerciseId)?.name)
        .filter((n): n is string => !!n);

      let upcoming: Array<{ exerciseId: string; name: string }> = [];
      if (todayModule) {
        const orderedUnits = getOrderedUnits(todayModule.id);
        upcoming = getStudentUpcomingExercises(student._id, todayModule.id, allEntries, allExercises, orderedUnits, 5);
      }
      if (upcoming.length === 0) {
        for (const mod of CURRICULUM_MODULES) {
          const units = getOrderedUnits(mod.id);
          const modUpcoming = getStudentUpcomingExercises(student._id, mod.id, allEntries, allExercises, units, 5);
          if (modUpcoming.length > 0) { upcoming = modUpcoming; break; }
        }
      }
      info.set(student._id, { doneToday, upcoming });
    }
    return info;
  }, [slotStudentList, todayEntries, allEntries, allExercises, todayModule]);

  const loading = !students || !allEntries || !todayEntries || !allExercises || settings === undefined;

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

  // Step 1 handlers
  const selectStudent = (studentId: Id<"students">) => {
    if (absentStudentIds.has(studentId) && !attendanceMode) return;

    if (studentId === selectedStudentId && selectedExercise) {
      setStep('select-exercise');
      return;
    }

    setSelectedStudentId(studentId);
    setSelectedExercise(null);
    setQuestionStates({});
    setInitialQuestionStates({});
    setExistingEntryId(null);
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

  const saveEntry = async () => {
    if (!selectedStudentId || !selectedExercise) return;

    const questions: Record<string, 'correct' | 'wrong'> = {};
    for (const [k, v] of Object.entries(questionStates)) {
      if (v !== 'unmarked') questions[k] = v;
    }

    if (existingEntryId) {
      await updateEntryMutation({ id: existingEntryId, questions, correctCount, totalAttempted: attempted });
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

    // Auto-mark present
    if (effectiveSlot) {
      await markPresentMutation({ studentId: selectedStudentId, slotId: effectiveSlot._id as Id<"scheduleSlots">, date: today });
    }

    toast.success(`${selectedStudent?.name}: ${correctCount} correct = ${pointsThisEntry} pts`);
  };

  const handleSave = async () => {
    await saveEntry();
    handleNextStudent();
  };

  const handleNextStudent = () => {
    setSelectedStudentId(null);
    setSelectedExercise(null);
    setQuestionStates({});
    setInitialQuestionStates({});
    setExistingEntryId(null);
    setBrowseMode(false);
    setStep('select-student');
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
      setInitialQuestionStates({ ...states });
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
    setInitialQuestionStates({ ...states });
    setStep('mark-questions');
  };

  // Step indicator
  const stepIndex = step === 'select-student' ? 0 : step === 'select-exercise' ? 1 : 2;
  const stepLabels = [
    selectedStudent ? selectedStudent.name : 'Student',
    selectedExercise ? selectedExercise.name : 'Exercise',
    'Mark',
  ];

  const canNavigateToStep = (i: number): boolean => {
    if (i === stepIndex) return false;
    if (i === 0) return stepIndex > 0;
    if (i === 1) return !!selectedStudentId;
    if (i === 2) return !!selectedExercise;
    return false;
  };

  const doNavigateToStep = (targetIndex: number) => {
    if (targetIndex === 0) setStep('select-student');
    else if (targetIndex === 1) setStep('select-exercise');
    else if (targetIndex === 2) setStep('mark-questions');
  };

  const navigateToStep = (targetIndex: number) => {
    if (!canNavigateToStep(targetIndex)) return;
    if (hasUnsavedChanges) {
      setPendingStepTarget(targetIndex);
      setShowUnsavedDialog(true);
      return;
    }
    doNavigateToStep(targetIndex);
  };

  const handleDialogSave = async () => {
    await saveEntry();
    setShowUnsavedDialog(false);
    setSelectedExercise(null);
    setQuestionStates({});
    setInitialQuestionStates({});
    setExistingEntryId(null);
    setBrowseMode(false);
    if (pendingStepTarget !== null) {
      doNavigateToStep(pendingStepTarget);
      setPendingStepTarget(null);
    }
  };

  const handleDialogLeave = () => {
    setShowUnsavedDialog(false);
    if (pendingStepTarget !== null) {
      doNavigateToStep(pendingStepTarget);
      setPendingStepTarget(null);
    }
  };

  // No active slot and no manual selection
  const noSlot = !effectiveSlot && !allowManual && teacher && teacherSlots && teacherSlots.length > 0;

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
      {effectiveSlot && slotRoom && (
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
          {/* Progress bar */}
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
      {(allowManual || attendanceMode) && availableSlots.length > 0 && (
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
      {timingWarning && (
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
      {allHandled && effectiveSlot && (
        <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-3 mb-3 text-center">
          <p className="text-sm font-semibold text-emerald-600">Slot Complete!</p>
          {nextSlot && (
            <Button
              size="sm"
              className="mt-2 rounded-xl"
              onClick={() => {
                setManualSlotId(nextSlot._id);
                setStep('select-student');
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
      {noSlot && !allowManual && (
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

      {/* Touchable step progress */}
      <div className="flex items-center gap-1.5 mb-3">
        {stepLabels.map((label, i) => {
          const isCompleted = i < stepIndex;
          const isCurrent = i === stepIndex;
          const canNavigate = canNavigateToStep(i);
          const hasValue = i === 0 ? !!selectedStudent : i === 1 ? !!selectedExercise : false;
          return (
            <button
              key={i}
              type="button"
              disabled={!canNavigate}
              onClick={() => navigateToStep(i)}
              className={`flex-1 flex flex-col gap-1 py-1.5 px-1 rounded-lg transition-all min-w-0 ${
                canNavigate ? 'cursor-pointer active:scale-[0.97]' : 'cursor-default'
              }`}
            >
              <div className={`h-1.5 w-full rounded-full transition-colors ${
                isCurrent ? 'bg-primary' : isCompleted || (hasValue && !isCurrent) ? 'bg-primary/40' : 'bg-muted'
              }`} />
              <span className={`text-[10px] font-medium truncate w-full text-center transition-colors ${
                isCurrent ? 'text-primary' : canNavigate ? 'text-primary/60' : 'text-muted-foreground/40'
              }`}>
                {label}
              </span>
            </button>
          );
        })}
      </div>

      {/* Step 1: Select Student */}
      {step === 'select-student' && (
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

          {/* Attendance: no slot selected */}
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
              const sStudentDayEntries = todayEntries.filter(e => e.studentId === student._id);
              const dayCorrect = sStudentDayEntries.reduce((sum, e) => sum + e.correctCount, 0);
              const info = studentExerciseInfo.get(student._id);

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
                      selectStudent(student._id);
                    }
                  }}
                >
                  <CardContent className="p-3">
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
                        {hasEntry && (
                          <Badge variant="secondary" className="text-xs">{dayCorrect} correct</Badge>
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
                    {!attendanceMode && info && (info.doneToday.length > 0 || info.upcoming.length > 0) && (
                      <div className="mt-2 ml-10 flex flex-wrap items-center gap-1">
                        {info.doneToday.map((name, i) => (
                          <span key={`done-${i}`} className="text-[10px] bg-emerald-500/10 text-emerald-600 rounded-md px-1.5 py-0.5 font-medium">
                            ✓ {name}
                          </span>
                        ))}
                        {info.upcoming.slice(0, isSelected ? 5 : 2).map((ex, i) => (
                          <span key={ex.exerciseId} className="text-[10px] bg-muted text-muted-foreground rounded-md px-1.5 py-0.5">
                            {i === 0 ? '→ ' : ''}{ex.name}
                          </span>
                        ))}
                      </div>
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

      {/* Unsaved changes dialog */}
      <Dialog open={showUnsavedDialog} onOpenChange={(open) => {
        if (!open) { setShowUnsavedDialog(false); setPendingStepTarget(null); }
      }}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Unsaved Changes</DialogTitle>
            <DialogDescription>You have unsaved question marks. Save before leaving?</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={handleDialogLeave}>Leave</Button>
            <Button onClick={handleDialogSave}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
