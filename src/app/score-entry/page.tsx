'use client';

import { useState, useMemo, useEffect, useCallback } from 'react';
import { useQuery, useMutation } from 'convex/react';
import { Check, BookOpen, CheckCircle2, Clock, MapPin, Send, ChevronLeft, ChevronRight, Sparkles, Zap, SkipForward, Radio, ArrowLeft, AlertTriangle } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { getTodayDateStr, parseTimeToMinutes } from '@/lib/types';
import { api } from '@/lib/convex';
import { CURRICULUM_MODULES, getModuleForDay, getModuleById, getOrderedUnits, findUnit } from '@/lib/curriculum-data';
import { getTotalCorrectForDay, calculateDailyPoints, getStudentNextExercise, getStudentUpcomingItems, getWeekDates, type PositionOptions } from '@/lib/scoring';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { useCurrentTeacher } from '@/hooks/useCurrentTeacher';
import { useActiveSlot } from '@/hooks/useActiveSlot';
import type { Id } from '@/lib/convex';

// ─── Helpers ───
const DAY_SHORT = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function fmt12(t: string) {
  const [h, m] = t.split(':').map(Number);
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}
function fmt12s(t: string) {
  const [h, m] = t.split(':').map(Number);
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return m === 0 ? `${h12}${h >= 12 ? 'PM' : 'AM'}` : `${h12}:${String(m).padStart(2, '0')}${h >= 12 ? 'PM' : 'AM'}`;
}
function fmtCountdownCompact(mins: number): { value: string; unit: string } {
  if (mins <= 0) return { value: '0', unit: 'NOW' };
  if (mins >= 1440) { const d = Math.round(mins / 1440); return { value: String(d), unit: d === 1 ? 'day' : 'days' }; }
  if (mins >= 60) { const h = Math.round(mins / 60); return { value: String(h), unit: h === 1 ? 'hr' : 'hrs' }; }
  return { value: String(mins), unit: 'min' };
}

function usePersistentState<T>(key: string, init: T): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [val, setVal] = useState<T>(() => {
    if (typeof window === 'undefined') return init;
    try { const s = localStorage.getItem(key); return s ? JSON.parse(s) : init; } catch { return init; }
  });
  useEffect(() => { localStorage.setItem(key, JSON.stringify(val)); }, [key, val]);
  return [val, setVal];
}

export default function ScoreEntryPage() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const iv = setInterval(() => setNow(new Date()), 60_000); return () => clearInterval(iv); }, []);

  // ─── State ───
  const [currentPage, setCurrentPage] = useState<'attendance' | 'scoring'>('attendance');
  const [manualSlotId, setManualSlotId] = useState('');
  const [attendanceDate, setAttendanceDate] = useState(() => getTodayDateStr());
  const [calPage, setCalPage] = useState(0);

  // Draft attendance: { "slotId|date": ["studentId1", ...] }
  const [draftAttendance, setDraftAttendance] = usePersistentState<Record<string, string[]>>('mt-draft-att', {});
  const [draftFinished, setDraftFinished] = usePersistentState<Record<string, string[]>>('mt-draft-fin', {});

  // Scoring
  const [selectedStudentId, setSelectedStudentId] = useState<Id<"students"> | null>(null);
  const [selectedUnitId, setSelectedUnitId] = useState('');
  const [scoringExercise, setScoringExercise] = useState<{
    _id: Id<"exercises">; unitId: string; name: string; questionCount: number; order: number; moduleId: string; pageNumber?: number;
  } | null>(null);
  const [questionStates, setQuestionStates] = useState<Record<number, 'correct' | 'wrong' | 'skipped' | 'unmarked'>>({});
  const [existingEntryId, setExistingEntryId] = useState<Id<"entries"> | null>(null);
  const [initialQuestionStates, setInitialQuestionStates] = useState<Record<number, 'correct' | 'wrong' | 'skipped' | 'unmarked'>>({});

  // Dialogs
  const [positionDialogOpen, setPositionDialogOpen] = useState(false);
  const [positionDialogStudentId, setPositionDialogStudentId] = useState<Id<"students"> | null>(null);
  const [dialogModule, setDialogModule] = useState('');
  const [dialogGrade, setDialogGrade] = useState('');
  const [dialogTerm, setDialogTerm] = useState('');
  const [dialogPermanent, setDialogPermanent] = useState(false);
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false);
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);
  const [conceptDrawerOpen, setConceptDrawerOpen] = useState(false);

  // New dialogs
  const [submitDialogOpen, setSubmitDialogOpen] = useState(false);
  const [unfinishedAlertStudents, setUnfinishedAlertStudents] = useState<string[]>([]);
  const [absentStudentDialog, setAbsentStudentDialog] = useState<{ studentId: Id<"students">; type: 'live' | 'future' } | null>(null);
  const [blockingDialogOpen, setBlockingDialogOpen] = useState(false);
  const [attendanceGuardDialog, setAttendanceGuardDialog] = useState<{ studentId: Id<"students">; name: string } | null>(null);
  const [highlightUnsubmitted, setHighlightUnsubmitted] = useState(false);

  const today = getTodayDateStr();

  // ─── Data ───
  const { teacher } = useCurrentTeacher();
  const teacherSlotAssignments = useQuery(api.slotTeachers.listByTeacher, teacher ? { teacherId: teacher._id } : 'skip');
  const allSlots = useQuery(api.scheduleSlots.list);
  const rooms = useQuery(api.rooms.list);
  const centers = useQuery(api.centers.list);
  const settings = useQuery(api.settings.get);
  const students = useQuery(api.students.list);
  const allEntries = useQuery(api.entries.list);
  const todayEntries = useQuery(api.entries.getByDate, { date: today });
  const allExercises = useQuery(api.exercises.list);
  const modulePositions = useQuery(api.studentModulePositions.list);
  const submittedSessions = useQuery(api.sessionSubmissions.listByTeacher, teacher ? { teacherId: teacher._id } : 'skip');

  const teacherSlots = useMemo(() => {
    if (!teacherSlotAssignments || !allSlots) return undefined;
    const ids = new Set(teacherSlotAssignments.map((s: { slotId: string }) => s.slotId));
    return allSlots.filter((s: { _id: string }) => ids.has(s._id));
  }, [teacherSlotAssignments, allSlots]);

  const { activeSlot, nextSlot, minutesRemaining } = useActiveSlot(teacherSlots);

  const effectiveSlot = useMemo(() => {
    if (manualSlotId) return allSlots?.find((s: { _id: string }) => s._id === manualSlotId) ?? null;
    return activeSlot ?? nextSlot ?? null;
  }, [manualSlotId, allSlots, activeSlot, nextSlot]);

  // Derive module from room's timetable for the slot's day
  const slotModule = useMemo(() => {
    if (!effectiveSlot) return null;
    const room = rooms?.find((r: { _id: string }) => r._id === effectiveSlot.roomId);
    if (room?.moduleTimetable) {
      const moduleId = (room.moduleTimetable as Record<string, string>)[String(effectiveSlot.dayOfWeek)];
      if (moduleId) return getModuleById(moduleId) ?? null;
    }
    return getModuleForDay(effectiveSlot.dayOfWeek) ?? null;
  }, [effectiveSlot, rooms]);

  const effectiveDate = manualSlotId ? attendanceDate : today;
  const sessionKey = effectiveSlot ? `${effectiveSlot._id}|${effectiveDate}` : '';

  const effectiveStudents = useQuery(
    api.scheduleSlots.getEffectiveStudents,
    effectiveSlot ? { slotId: effectiveSlot._id as Id<"scheduleSlots">, date: effectiveDate } : 'skip'
  );
  const attendanceRecords = useQuery(
    api.attendance.getBySlotAndDate,
    effectiveSlot ? { slotId: effectiveSlot._id as Id<"scheduleSlots">, date: effectiveDate } : 'skip'
  );

  // ─── Mutations ───
  const addEntryMut = useMutation(api.entries.add);
  const updateEntryMut = useMutation(api.entries.update);
  const setModulePosMut = useMutation(api.studentModulePositions.set);
  const submitSessionNewMut = useMutation(api.sessionSubmissions.submit);

  // ─── Derived ───
  const todayDow = useMemo(() => { const d = now.getDay(); return d === 0 ? 7 : d; }, [now]);
  const weekDates = useMemo(() => getWeekDates(today), [today]);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  // Draft present IDs for current session
  const draftPresentIds = useMemo(() => new Set(draftAttendance[sessionKey] || []), [draftAttendance, sessionKey]);
  const draftFinishedIds = useMemo(() => new Set(draftFinished[sessionKey] || []), [draftFinished, sessionKey]);

  // DB-submitted present/finished IDs
  const dbPresentIds = useMemo(() => {
    if (!attendanceRecords) return new Set<string>();
    return new Set(attendanceRecords.filter((a: { status: string }) => a.status === 'present').map((a: { studentId: string }) => a.studentId));
  }, [attendanceRecords]);
  const dbFinishedIds = useMemo(() => {
    if (!attendanceRecords) return new Set<string>();
    return new Set(attendanceRecords.filter((a: { sessionFinished?: boolean }) => a.sessionFinished).map((a: { studentId: string }) => a.studentId));
  }, [attendanceRecords]);

  // Combined: draft OR db
  const presentStudentIds = useMemo(() => {
    const combined = new Set(draftPresentIds);
    for (const id of dbPresentIds) combined.add(id);
    return combined;
  }, [draftPresentIds, dbPresentIds]);
  const finishedStudentIds = useMemo(() => {
    const combined = new Set(draftFinishedIds);
    for (const id of dbFinishedIds) combined.add(id);
    return combined;
  }, [draftFinishedIds, dbFinishedIds]);

  const studentsWithEntries = useMemo(() => {
    if (!todayEntries) return new Set<string>();
    return new Set(todayEntries.map(e => e.studentId));
  }, [todayEntries]);

  const weekSlotsByDay = useMemo(() => {
    if (!allSlots) return {} as Record<number, NonNullable<typeof allSlots>>;
    const m: Record<number, NonNullable<typeof allSlots>> = {};
    for (let d = 1; d <= 6; d++)
      m[d] = allSlots.filter((s: { dayOfWeek: number }) => s.dayOfWeek === d).sort((a: { startTime: string }, b: { startTime: string }) => a.startTime.localeCompare(b.startTime));
    return m;
  }, [allSlots]);

  const studentPositions = useMemo(() => {
    if (!allExercises || !allEntries || !effectiveStudents || !slotModule || !modulePositions)
      return new Map<string, { moduleId: string; grade: number; term: number; unitId: string; exerciseId: string }>();
    const pos = new Map<string, { moduleId: string; grade: number; term: number; unitId: string; exerciseId: string }>();
    const units = getOrderedUnits(slotModule.id);
    for (const st of effectiveStudents) {
      const ov = modulePositions.find((p: { studentId: string; moduleId: string }) => p.studentId === st._id && p.moduleId === slotModule.id);
      const opts: PositionOptions = { positionOverride: ov ? { grade: ov.grade, term: ov.term } : undefined, defaultGrade: st.schoolGrade };
      const next = getStudentNextExercise(st._id, slotModule.id, allEntries, allExercises, units, opts);
      if (next) {
        const ui = findUnit(next.unitId);
        if (ui) pos.set(st._id, { moduleId: slotModule.id, grade: ui.grade, term: ui.term, unitId: next.unitId, exerciseId: next.exerciseId });
      }
    }
    return pos;
  }, [effectiveStudents, allEntries, allExercises, slotModule, modulePositions]);

  // Session countdown
  const sessionCountdown = useMemo(() => {
    if (!effectiveSlot) return null;
    const slotDow = effectiveSlot.dayOfWeek;
    if (slotDow === todayDow) {
      const startM = parseTimeToMinutes(effectiveSlot.startTime);
      const endM = parseTimeToMinutes(effectiveSlot.endTime);
      if (nowMinutes >= startM && nowMinutes < endM) return { minsLeft: endM - nowMinutes, state: 'live' as const };
      if (nowMinutes >= endM) return { minsLeft: 0, state: 'ended' as const };
      return { minsLeft: startM - nowMinutes, state: 'upcoming' as const };
    }
    let dayDiff = slotDow - todayDow;
    if (dayDiff <= 0) dayDiff += 7;
    const startM = parseTimeToMinutes(effectiveSlot.startTime);
    return { minsLeft: dayDiff * 1440 + startM - nowMinutes, state: 'upcoming' as const };
  }, [effectiveSlot, nowMinutes, todayDow]);

  // Session lifecycle for the currently selected slot+date
  const sessionLifecycle = useMemo((): 'upcoming' | 'live' | 'ended' | 'submitted' | null => {
    if (!effectiveSlot) return null;
    const isSubmitted = submittedSessions?.some(s => s.slotId === effectiveSlot._id && s.date === effectiveDate);
    if (isSubmitted) return 'submitted';
    if (sessionCountdown?.state === 'live') return 'live';
    if (sessionCountdown?.state === 'ended') return 'ended';
    // Check if it's a past date
    if (effectiveDate < today) return 'ended';
    return 'upcoming';
  }, [effectiveSlot, effectiveDate, submittedSessions, sessionCountdown, today]);

  // Slot lifecycle for calendar coloring
  const getSlotLifecycle = useCallback((slotId: string, date: string, startTime: string, endTime: string): 'upcoming' | 'live' | 'ended' | 'submitted' => {
    const isSubmitted = submittedSessions?.some(s => s.slotId === slotId && s.date === date);
    if (isSubmitted) return 'submitted';
    if (date < today) return 'ended';
    if (date > today) return 'upcoming';
    const startM = parseTimeToMinutes(startTime);
    const endM = parseTimeToMinutes(endTime);
    if (nowMinutes >= startM && nowMinutes < endM) return 'live';
    if (nowMinutes >= endM) return 'ended';
    return 'upcoming';
  }, [submittedSessions, today, nowMinutes]);

  // Unsubmitted sessions for this teacher (current week)
  const unsubmittedSessions = useMemo(() => {
    if (!teacherSlots || submittedSessions === undefined) return [];
    const result: Array<{ slotId: string; date: string; startTime: string; endTime: string; dayOfWeek: number }> = [];
    for (const slot of teacherSlots) {
      const dateForSlot = weekDates[slot.dayOfWeek - 1];
      if (!dateForSlot) continue;
      const isPast = dateForSlot < today;
      const isToday = dateForSlot === today;
      const ended = isPast || (isToday && nowMinutes >= parseTimeToMinutes(slot.endTime));
      if (ended) {
        const isSubmitted = submittedSessions?.some(s => s.slotId === slot._id && s.date === dateForSlot);
        if (!isSubmitted) {
          result.push({ slotId: slot._id, date: dateForSlot, startTime: slot.startTime, endTime: slot.endTime, dayOfWeek: slot.dayOfWeek });
        }
      }
    }
    return result.sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));
  }, [teacherSlots, submittedSessions, weekDates, today, nowMinutes]);

  // Oldest unsubmitted session that blocks scoring (excludes current session)
  const oldestUnsubmitted = useMemo(() => {
    if (unsubmittedSessions.length === 0) return null;
    const current = effectiveSlot ? `${effectiveSlot._id}|${effectiveDate}` : '';
    return unsubmittedSessions.find(s => `${s.slotId}|${s.date}` !== current) ?? null;
  }, [unsubmittedSessions, effectiveSlot, effectiveDate]);

  // isViewingOther: manually selected a different slot while a live one exists
  const isViewingOther = !!manualSlotId && effectiveSlot?._id !== activeSlot?._id;

  // Scoring students: ALL students with badge colors
  const scoringStudents = useMemo(() => {
    if (!effectiveStudents) return [];
    return effectiveStudents.map((s: { _id: Id<"students">; name: string; schoolGrade: number }) => {
      const isPresent = presentStudentIds.has(s._id);
      const isFinished = finishedStudentIds.has(s._id);
      const hasEntries = studentsWithEntries.has(s._id);
      let badgeColor: 'gray' | 'red' | 'yellow' | 'green';
      if (!isPresent && !hasEntries) badgeColor = 'red';
      else if (isFinished) badgeColor = 'green';
      else if (hasEntries) badgeColor = 'yellow';
      else badgeColor = 'gray';
      return { ...s, badgeColor, isPresent };
    }).sort((a, b) => {
      const order = { gray: 0, yellow: 1, green: 2, red: 3 };
      return order[a.badgeColor] - order[b.badgeColor];
    });
  }, [effectiveStudents, presentStudentIds, finishedStudentIds, studentsWithEntries]);

  const hasUnsavedChanges = useMemo(() => {
    if (!scoringExercise) return false;
    for (const k of Object.keys(questionStates)) if (questionStates[Number(k)] !== initialQuestionStates[Number(k)]) return true;
    return false;
  }, [scoringExercise, questionStates, initialQuestionStates]);

  // ─── Helpers ───
  const getRoomName = useCallback((roomId: string) => rooms?.find((r: { _id: string; name: string }) => r._id === roomId)?.name || 'Room', [rooms]);
  const slotRoom = effectiveSlot ? rooms?.find((r: { _id: string }) => r._id === effectiveSlot.roomId) : null;
  const slotCenter = slotRoom ? centers?.find((c: { _id: string }) => c._id === (slotRoom as { centerId: string }).centerId) : null;
  const selectedStudent = selectedStudentId ? effectiveStudents?.find((s: { _id: string }) => s._id === selectedStudentId) : null;

  const getPositionOpts = (sid: string, mid: string, grade: number): PositionOptions => {
    const ov = modulePositions?.find((p: { studentId: string; moduleId: string }) => p.studentId === sid && p.moduleId === mid);
    return { positionOverride: ov ? { grade: ov.grade, term: ov.term } : undefined, defaultGrade: grade };
  };
  const getStudentTermUnits = (sid: string) => {
    const p = studentPositions.get(sid);
    if (!p || !slotModule) return [];
    const mod = CURRICULUM_MODULES.find(m => m.id === p.moduleId);
    return mod?.grades.find(g => g.grade === p.grade)?.terms.find(t => t.term === p.term)?.units || [];
  };
  const getConceptForExercise = (exId: string, unitId: string): string | null => {
    if (!allExercises) return null;
    const items = allExercises.filter(e => e.unitId === unitId).sort((a, b) => a.order - b.order);
    let last: string | null = null;
    for (const it of items) { if (it.type === 'concept') last = it.name; if (it._id === exId) return last; }
    return last;
  };
  const getExerciseStatus = (sid: string, exId: string, qCount: number): 'perfect' | 'skipped' | 'wip' | 'none' => {
    const entry = allEntries?.find(e => e.studentId === sid && e.exerciseId === exId);
    if (!entry) return 'none';
    if (entry.totalAttempted >= qCount) return 'perfect';
    const qs = entry.questions as Record<string, string>;
    const hasSkips = Object.values(qs).some(v => v === 'skipped');
    if (hasSkips) return 'skipped';
    return 'wip';
  };
  type ExerciseBreakdown = { exId: string; qCount: number; correct: number; wrong: number; skipped: number; unanswered: number };
  const getUnitProgress = (sid: string, unitId: string) => {
    if (!allExercises || !allEntries) return { total: 0, correctQ: 0, wrongQ: 0, skippedQ: 0, totalQ: 0, exercises: [] as ExerciseBreakdown[] };
    const exs = allExercises.filter(e => e.unitId === unitId && (e.type || 'exercise') === 'exercise').sort((a, b) => a.order - b.order);
    let correctQ = 0, wrongQ = 0, skippedQ = 0, totalQ = 0;
    const exercises: ExerciseBreakdown[] = [];
    for (const ex of exs) {
      totalQ += ex.questionCount;
      const en = allEntries.find(e => e.studentId === sid && e.exerciseId === ex._id);
      let c = 0, w = 0, sk = 0;
      if (en) {
        c = en.correctCount;
        const qs = en.questions as Record<string, string>;
        sk = Object.values(qs).filter(v => v === 'skipped').length;
        w = en.totalAttempted - en.correctCount - sk;
        if (w < 0) w = 0;
      }
      correctQ += c; wrongQ += w; skippedQ += sk;
      exercises.push({ exId: ex._id, qCount: ex.questionCount, correct: c, wrong: w, skipped: sk, unanswered: ex.questionCount - c - w - sk });
    }
    return { total: exs.length, correctQ, wrongQ, skippedQ, totalQ, exercises };
  };

  const selectedUnitExercises = useMemo(() => {
    if (!selectedUnitId || !allExercises) return [];
    return allExercises.filter(e => e.unitId === selectedUnitId && (e.type || 'exercise') === 'exercise').sort((a, b) => a.order - b.order);
  }, [selectedUnitId, allExercises]);
  const selectedUnitName = useMemo(() => selectedUnitId ? (findUnit(selectedUnitId)?.unit.name || '') : '', [selectedUnitId]);
  const currentConcept = useMemo(() => {
    if (!selectedStudentId || !selectedUnitId || !allExercises || !allEntries) return null;
    if (scoringExercise) return getConceptForExercise(scoringExercise._id, scoringExercise.unitId);
    const exs = allExercises.filter(e => e.unitId === selectedUnitId && (e.type || 'exercise') === 'exercise').sort((a, b) => a.order - b.order);
    for (const ex of exs) { const en = allEntries.find(e => e.studentId === selectedStudentId && e.exerciseId === ex._id); if (!en || en.totalAttempted < ex.questionCount) return getConceptForExercise(ex._id, selectedUnitId); }
    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStudentId, selectedUnitId, scoringExercise, allExercises, allEntries]);

  const correctCount = Object.values(questionStates).filter(v => v === 'correct').length;
  const wrongCount = Object.values(questionStates).filter(v => v === 'wrong').length;
  const skippedCount = Object.values(questionStates).filter(v => v === 'skipped').length;
  const attempted = correctCount + wrongCount;
  const studentDayEntries = selectedStudentId ? (todayEntries || []).filter(e => e.studentId === selectedStudentId) : [];
  const priorCorrectToday = getTotalCorrectForDay(studentDayEntries, existingEntryId || undefined);
  const totalCorrectToday = priorCorrectToday + correctCount;
  const dailyPoints = calculateDailyPoints(totalCorrectToday);
  const pointsThisEntry = (() => { let p = 0; for (let i = 1; i <= correctCount; i++) p += (priorCorrectToday + i) * 5; return p; })();

  // ─── Handlers ───
  const handleAttendanceToggle = (sid: Id<"students">) => {
    if (!sessionKey) return;
    const isCurrentlyPresent = draftPresentIds.has(sid) || dbPresentIds.has(sid);
    if (isCurrentlyPresent && studentsWithEntries.has(sid)) {
      const name = effectiveStudents?.find((s: { _id: string; name: string }) => s._id === sid)?.name || 'This student';
      setAttendanceGuardDialog({ studentId: sid, name });
      return;
    }
    setDraftAttendance(prev => {
      const current = [...(prev[sessionKey] || [])];
      const idx = current.indexOf(sid);
      if (idx >= 0) current.splice(idx, 1);
      else current.push(sid);
      return { ...prev, [sessionKey]: current };
    });
  };

  const handleForceAbsent = (sid: Id<"students">) => {
    if (!sessionKey) return;
    setDraftAttendance(prev => {
      const current = [...(prev[sessionKey] || [])];
      const idx = current.indexOf(sid);
      if (idx >= 0) current.splice(idx, 1);
      return { ...prev, [sessionKey]: current };
    });
    setAttendanceGuardDialog(null);
  };

  const handleCalendarSlotTap = (slotId: string, dow: number) => {
    if (manualSlotId === slotId && attendanceDate === weekDates[dow - 1]) {
      setManualSlotId(''); setAttendanceDate(today);
    } else {
      setManualSlotId(slotId); setAttendanceDate(weekDates[dow - 1]);
    }
  };

  const selectStudent = (sid: Id<"students">) => {
    setSelectedStudentId(sid); setScoringExercise(null);
    setQuestionStates({}); setInitialQuestionStates({}); setExistingEntryId(null);
    const p = studentPositions.get(sid); setSelectedUnitId(p?.unitId ?? '');
  };
  const handleStudentSelect = (sid: Id<"students">) => {
    if (sid === selectedStudentId) return;
    if (hasUnsavedChanges) { setPendingAction(() => () => selectStudent(sid)); setShowUnsavedDialog(true); return; }
    selectStudent(sid);
  };

  const setupScoring = (ex: NonNullable<typeof allExercises>[0], unitId: string, moduleId: string) => {
    setScoringExercise({ _id: ex._id, unitId, name: ex.name, questionCount: ex.questionCount, order: ex.order, moduleId, pageNumber: ex.pageNumber });
    const existing = todayEntries?.find(e => e.studentId === selectedStudentId && e.exerciseId === ex._id);
    const st: Record<number, 'correct' | 'wrong' | 'skipped' | 'unmarked'> = {};
    if (existing) {
      setExistingEntryId(existing._id);
      for (let i = 1; i <= ex.questionCount; i++) {
        const v = existing.questions[String(i)];
        st[i] = (v === 'correct' || v === 'wrong' || v === 'skipped') ? v : 'unmarked';
      }
    } else { setExistingEntryId(null); for (let i = 1; i <= ex.questionCount; i++) st[i] = 'unmarked'; }
    setQuestionStates(st); setInitialQuestionStates({ ...st });
  };
  const toggleQuestion = (q: number) => setQuestionStates(prev => ({ ...prev, [q]: prev[q] === 'unmarked' ? 'correct' : prev[q] === 'correct' ? 'wrong' : 'unmarked' }));

  // Guarded question tap: checks blocking + absent before toggling
  const handleQuestionTap = (q: number) => {
    if (oldestUnsubmitted) { setBlockingDialogOpen(true); return; }
    if (selectedStudentId && !presentStudentIds.has(selectedStudentId)) {
      if (sessionLifecycle === 'live') {
        setAbsentStudentDialog({ studentId: selectedStudentId, type: 'live' });
      } else {
        setAbsentStudentDialog({ studentId: selectedStudentId, type: 'future' });
      }
      return;
    }
    if (questionStates[q] !== 'skipped') toggleQuestion(q);
  };

  // Guarded exercise tap: same blocking checks
  const handleExerciseTap = (ex: NonNullable<typeof allExercises>[0], unitId: string, moduleId: string) => {
    if (oldestUnsubmitted) { setBlockingDialogOpen(true); return; }
    if (selectedStudentId && !presentStudentIds.has(selectedStudentId)) {
      if (sessionLifecycle === 'live') {
        setAbsentStudentDialog({ studentId: selectedStudentId, type: 'live' });
      } else {
        setAbsentStudentDialog({ studentId: selectedStudentId, type: 'future' });
      }
      return;
    }
    setupScoring(ex, unitId, moduleId);
  };

  const handleMarkPresentFromDialog = () => {
    if (!absentStudentDialog || !sessionKey) return;
    setDraftAttendance(prev => {
      const current = [...(prev[sessionKey] || [])];
      if (!current.includes(absentStudentDialog.studentId)) current.push(absentStudentDialog.studentId);
      return { ...prev, [sessionKey]: current };
    });
    setAbsentStudentDialog(null);
    toast.success('Student marked present');
  };

  const handleGoToUnsubmitted = () => {
    if (!oldestUnsubmitted) return;
    setManualSlotId(oldestUnsubmitted.slotId);
    setAttendanceDate(oldestUnsubmitted.date);
    setCurrentPage('attendance');
    setBlockingDialogOpen(false);
  };

  const handleAlertDotPress = () => {
    if (unsubmittedSessions.length > 0) {
      setHighlightUnsubmitted(true);
      setTimeout(() => setHighlightUnsubmitted(false), 2000);
      const first = unsubmittedSessions[0];
      setManualSlotId(first.slotId);
      setAttendanceDate(first.date);
      setCurrentPage('attendance');
    }
  };

  const handleLiveBadgePress = () => {
    setManualSlotId('');
    setAttendanceDate(today);
    setCurrentPage('attendance');
  };

  const saveEntry = async () => {
    if (!selectedStudentId || !scoringExercise) return;
    const qs: Record<string, string> = {};
    for (const [k, v] of Object.entries(questionStates)) { if (v !== 'unmarked') qs[k] = v; }
    if (existingEntryId) {
      await updateEntryMut({ id: existingEntryId, questions: qs, correctCount, totalAttempted: attempted });
    } else {
      await addEntryMut({
        studentId: selectedStudentId, date: today, exerciseId: scoringExercise._id, unitId: scoringExercise.unitId, moduleId: scoringExercise.moduleId, questions: qs, correctCount, totalAttempted: attempted,
        slotId: effectiveSlot?._id as Id<"scheduleSlots"> | undefined,
        centerId: slotCenter?._id as Id<"centers"> | undefined,
      });
    }
    if (sessionKey && !draftPresentIds.has(selectedStudentId)) {
      setDraftAttendance(prev => ({ ...prev, [sessionKey]: [...(prev[sessionKey] || []), selectedStudentId!] }));
    }
  };

  const handleSave = async () => {
    await saveEntry();
    toast.success(`${(selectedStudent as { name: string })?.name}: ${correctCount} correct = ${pointsThisEntry} pts`);
    if (!scoringExercise || !slotModule) return;
    const curOrder = scoringExercise.order;
    const nextEx = selectedUnitExercises.find(ex => {
      if (ex.order <= curOrder) return false;
      const en = allEntries?.find(e => e.studentId === selectedStudentId && e.exerciseId === ex._id);
      return !en || en.totalAttempted < ex.questionCount;
    });
    if (nextEx) setupScoring(nextEx, selectedUnitId, slotModule.id);
    else { setScoringExercise(null); setQuestionStates({}); setInitialQuestionStates({}); setExistingEntryId(null); }
  };

  const handleFinishExercise = async () => {
    if (!selectedStudentId || !scoringExercise) return;
    const finalStates = { ...questionStates };
    for (let i = 1; i <= scoringExercise.questionCount; i++) {
      if (finalStates[i] === 'unmarked') finalStates[i] = 'skipped';
    }
    setQuestionStates(finalStates);
    const qs: Record<string, string> = {};
    let cc = 0, ta = 0;
    for (const [k, v] of Object.entries(finalStates)) { if (v !== 'unmarked') { qs[k] = v; if (v === 'correct') cc++; if (v === 'correct' || v === 'wrong') ta++; } }
    if (existingEntryId) {
      await updateEntryMut({ id: existingEntryId, questions: qs, correctCount: cc, totalAttempted: ta });
    } else {
      await addEntryMut({
        studentId: selectedStudentId, date: today, exerciseId: scoringExercise._id, unitId: scoringExercise.unitId, moduleId: scoringExercise.moduleId, questions: qs, correctCount: cc, totalAttempted: ta,
        slotId: effectiveSlot?._id as Id<"scheduleSlots"> | undefined,
        centerId: slotCenter?._id as Id<"centers"> | undefined,
      });
    }
    if (sessionKey && !draftPresentIds.has(selectedStudentId)) {
      setDraftAttendance(prev => ({ ...prev, [sessionKey]: [...(prev[sessionKey] || []), selectedStudentId!] }));
    }
    toast.success(`${(selectedStudent as { name: string })?.name}: Exercise finished!`);
    setScoringExercise(null); setQuestionStates({}); setInitialQuestionStates({}); setExistingEntryId(null);
  };

  const handleFinishSession = () => {
    if (!selectedStudentId || !sessionKey) return;
    setDraftFinished(prev => {
      const cur = [...(prev[sessionKey] || [])];
      if (!cur.includes(selectedStudentId)) cur.push(selectedStudentId);
      return { ...prev, [sessionKey]: cur };
    });
    toast.success(`${(selectedStudent as { name: string })?.name}: Session complete!`);
  };

  const handleSubmitPress = () => {
    if (!effectiveSlot || !effectiveStudents || !teacher) return;
    const presentIds = Array.from(presentStudentIds);
    const unfinished = presentIds.filter(id => !finishedStudentIds.has(id));
    if (unfinished.length > 0) {
      const names = unfinished.map(id => effectiveStudents.find((s: { _id: string; name: string }) => s._id === id)?.name || 'Unknown');
      setUnfinishedAlertStudents(names);
      return;
    }
    setSubmitDialogOpen(true);
  };

  const handleConfirmSubmit = async () => {
    if (!effectiveSlot || !effectiveStudents || !teacher) return;
    const presentIds = Array.from(presentStudentIds) as Id<"students">[];
    const finishedIds = Array.from(finishedStudentIds) as Id<"students">[];
    const allIds = effectiveStudents.map((s: { _id: Id<"students"> }) => s._id);
    const entryCount = (allEntries || []).filter(e => presentIds.includes(e.studentId as Id<"students">) && e.date === effectiveDate).length;
    try {
      await submitSessionNewMut({
        slotId: effectiveSlot._id as Id<"scheduleSlots">,
        date: effectiveDate,
        teacherId: teacher._id,
        presentStudentIds: presentIds,
        finishedStudentIds: finishedIds,
        allStudentIds: allIds,
        entryCount,
      });
      if (sessionKey) {
        setDraftAttendance(prev => { const n = { ...prev }; delete n[sessionKey]; return n; });
        setDraftFinished(prev => { const n = { ...prev }; delete n[sessionKey]; return n; });
      }
      setSubmitDialogOpen(false);
      toast.success('Session submitted!');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to submit');
    }
  };

  const clearScoring = () => {
    if (hasUnsavedChanges) {
      setPendingAction(() => () => { setScoringExercise(null); setQuestionStates({}); setInitialQuestionStates({}); setExistingEntryId(null); });
      setShowUnsavedDialog(true);
    } else { setScoringExercise(null); setQuestionStates({}); setInitialQuestionStates({}); setExistingEntryId(null); }
  };

  // ─── Loading ───
  const loading = !students || !allEntries || !todayEntries || !allExercises || settings === undefined || !modulePositions || !allSlots || !rooms || submittedSessions === undefined;
  if (loading) return (
    <div className="px-4 pt-5 pb-6 max-w-lg mx-auto">
      <div className="animate-pulse space-y-3">
        <div className="h-9 bg-muted rounded-lg w-full" />
        <div className="h-20 bg-muted rounded-xl" />
        <div className="flex flex-wrap gap-1.5">{[1, 2, 3, 4, 5].map(i => <div key={i} className="h-9 w-16 bg-muted rounded-lg" />)}</div>
      </div>
    </div>
  );

  // ═══ RENDER ═══
  return (
    <div className="px-4 pt-4 pb-6 max-w-lg mx-auto">
      {/* ═══ SHARED TOP BAR ═══ */}
      <div className="flex items-center justify-between mb-4">
        {/* Left: Back button (scoring) or Today's date (attendance) */}
        <div className="flex items-center gap-2">
          {currentPage === 'scoring' && (
            <button onClick={() => { setCurrentPage('attendance'); setSelectedStudentId(null); setScoringExercise(null); }}
              className="w-8 h-8 rounded-xl bg-muted flex items-center justify-center shrink-0 active:scale-90 transition-transform">
              <ArrowLeft className="w-4 h-4 text-muted-foreground" />
            </button>
          )}
          <div>
            <p className="text-sm font-bold text-foreground">{DAY_FULL[now.getDay()]}</p>
            <p className="text-[11px] text-muted-foreground">{now.getDate()} {MONTHS[now.getMonth()]} {now.getFullYear()}</p>
          </div>
        </div>

        {/* Center: Unsubmitted alert dot */}
        {unsubmittedSessions.length > 0 && (
          <button onClick={handleAlertDotPress} className="relative p-2 active:scale-90 transition-transform" title={`${unsubmittedSessions.length} unsubmitted`}>
            <span className="w-3 h-3 rounded-full bg-red-500 animate-pulse block" />
            <span className="absolute -top-0.5 -right-0.5 text-[9px] font-bold text-red-500">{unsubmittedSessions.length}</span>
          </button>
        )}

        {/* Right: Countdown / LIVE badge */}
        <div className="shrink-0">
          {activeSlot && isViewingOther ? (
            // Browsing a different slot while one is live
            <button onClick={handleLiveBadgePress} className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-emerald-500/15 active:scale-95 transition-all">
              <Radio className="w-3 h-3 text-emerald-500 animate-pulse" />
              <span className="text-[10px] font-bold text-emerald-600">LIVE</span>
            </button>
          ) : sessionCountdown?.state === 'live' ? (
            // Currently viewing the live slot
            <div className="text-center px-2.5 py-1.5 rounded-xl bg-emerald-500/15 min-w-[44px]">
              <div className="flex items-center justify-center gap-1">
                <Radio className="w-3 h-3 text-emerald-500 animate-pulse" />
                <p className="text-sm font-black text-emerald-600 leading-none">{sessionCountdown.minsLeft}</p>
              </div>
              <p className="text-[9px] font-semibold text-emerald-500/70">min</p>
            </div>
          ) : sessionCountdown && sessionCountdown.state === 'upcoming' ? (
            // Next session countdown
            (() => {
              const cd = fmtCountdownCompact(sessionCountdown.minsLeft);
              return (
                <div className="text-center px-2.5 py-1.5 rounded-xl bg-primary/10 min-w-[44px]">
                  <p className="text-sm font-black text-primary leading-none">{cd.value}</p>
                  <p className="text-[9px] font-semibold text-primary/70">{cd.unit}</p>
                </div>
              );
            })()
          ) : null}
        </div>
      </div>

      {/* ═══ PAGE: ATTENDANCE ═══ */}
      {currentPage === 'attendance' && (
        <div className="space-y-3">
          {/* Student Badges — attendance toggles */}
          <div className="min-h-[84px] flex flex-wrap content-start gap-1.5 overflow-hidden">
            {effectiveSlot && effectiveStudents && effectiveStudents.length > 0 ? (
              effectiveStudents.map((s: { _id: Id<"students">; name: string }) => {
                const isPresent = draftPresentIds.has(s._id) || dbPresentIds.has(s._id);
                return (
                  <button key={s._id} onClick={() => handleAttendanceToggle(s._id)}
                    className={`px-3 py-2 rounded-xl text-xs font-medium transition-all active:scale-95 h-[38px]
                      ${isPresent ? 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300 shadow-sm' : 'bg-muted text-muted-foreground'}`}>
                    {s.name.split(' ')[0]}
                  </button>
                );
              })
            ) : (
              <div className="flex items-center justify-center w-full h-full">
                <p className="text-xs text-muted-foreground/50">
                  {effectiveSlot ? 'No students in this slot' : 'Select a slot to mark attendance'}
                </p>
              </div>
            )}
          </div>

          {/* Session Info Card — pressable → goes to scoring */}
          <button
            onClick={() => effectiveSlot && setCurrentPage('scoring')}
            className={`w-full rounded-2xl border overflow-hidden text-left transition-all active:scale-[0.98]
              ${sessionLifecycle === 'live' ? 'bg-blue-500/5 border-blue-500/30'
                : sessionLifecycle === 'ended' ? 'bg-red-500/5 border-red-500/30'
                : sessionLifecycle === 'submitted' ? 'bg-emerald-500/5 border-emerald-500/30'
                : 'bg-card border-border/50'}`}
          >
            <div className="px-4 py-3 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  {effectiveSlot ? (
                    <>
                      <span className="text-sm font-bold text-foreground">{DAY_SHORT[effectiveSlot.dayOfWeek]} {fmt12s(effectiveSlot.startTime)}–{fmt12s(effectiveSlot.endTime)}</span>
                      {slotModule && (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md" style={{ backgroundColor: slotModule.color + '20', color: slotModule.color }}>{slotModule.id}</span>
                      )}
                    </>
                  ) : (
                    <span className="text-sm text-muted-foreground">No session selected</span>
                  )}
                </div>
                {effectiveSlot && slotRoom && (
                  <p className="text-[11px] text-muted-foreground mt-0.5">{(slotRoom as { name: string }).name}{slotCenter ? ` · ${(slotCenter as { name: string }).name}` : ''}</p>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {effectiveStudents && effectiveStudents.length > 0 && (
                  <div className="text-center px-2 py-1 rounded-lg bg-muted/50">
                    <p className="text-sm font-black text-foreground leading-none">{presentStudentIds.size}<span className="text-muted-foreground font-medium">/{effectiveStudents.length}</span></p>
                  </div>
                )}
                {/* Lifecycle badge */}
                {sessionLifecycle === 'live' && (
                  <span className="flex items-center gap-1 text-[10px] font-bold text-blue-600 bg-blue-500/15 px-2 py-1 rounded-lg">
                    <Radio className="w-2.5 h-2.5 animate-pulse" />LIVE
                  </span>
                )}
                {sessionLifecycle === 'ended' && (
                  <span className="text-[10px] font-bold text-red-600 bg-red-500/15 px-2 py-1 rounded-lg">ENDED</span>
                )}
                {sessionLifecycle === 'submitted' && (
                  <span className="text-[10px] font-bold text-emerald-600 bg-emerald-500/15 px-2 py-1 rounded-lg flex items-center gap-1">
                    <CheckCircle2 className="w-2.5 h-2.5" />DONE
                  </span>
                )}
                {sessionLifecycle === 'upcoming' && effectiveSlot && (
                  <span className="text-[10px] font-bold text-muted-foreground bg-muted px-2 py-1 rounded-lg">UPCOMING</span>
                )}
              </div>
            </div>
            {/* Progress bar */}
            {effectiveSlot && effectiveStudents && effectiveStudents.length > 0 && (
              <div className="h-1 bg-muted"><div className="h-full bg-primary transition-all duration-300" style={{ width: `${(presentStudentIds.size / effectiveStudents.length) * 100}%` }} /></div>
            )}
          </button>

          {/* Submit button — only when session ended and not submitted */}
          {sessionLifecycle === 'ended' && effectiveSlot && (
            <Button onClick={handleSubmitPress} className="w-full h-10 rounded-xl text-sm font-semibold bg-red-600 hover:bg-red-700">
              <Send className="w-3.5 h-3.5 mr-1.5" />Submit Session
            </Button>
          )}

          {/* Weekly Calendar — 3 days at a time, color-coded */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">This Week</p>
              <div className="flex items-center gap-1">
                <button onClick={() => setCalPage(0)}
                  className={`w-7 h-7 rounded-lg flex items-center justify-center transition-all active:scale-90 ${calPage === 0 ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => setCalPage(1)}
                  className={`w-7 h-7 rounded-lg flex items-center justify-center transition-all active:scale-90 ${calPage === 1 ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {(calPage === 0 ? [1, 2, 3] : [4, 5, 6]).map(dow => {
                const daySlots = weekSlotsByDay[dow] || [];
                const isToday = dow === todayDow;
                return (
                  <div key={dow} className={`rounded-xl p-2 ${isToday ? 'bg-primary/10 border border-primary/20' : 'bg-muted/30 border border-transparent'}`}>
                    <p className={`text-[10px] font-bold text-center mb-1.5 ${isToday ? 'text-primary' : 'text-muted-foreground'}`}>{DAY_SHORT[dow]}</p>
                    <div className="space-y-1">
                      {daySlots.map((slot: { _id: string; startTime: string; endTime: string; roomId: string; dayOfWeek: number }) => {
                        const isActive = slot._id === effectiveSlot?._id && weekDates[dow - 1] === effectiveDate;
                        const lifecycle = getSlotLifecycle(slot._id, weekDates[dow - 1], slot.startTime, slot.endTime);
                        const shouldHighlight = highlightUnsubmitted && lifecycle === 'ended';
                        return (
                          <button key={slot._id} onClick={() => handleCalendarSlotTap(slot._id, dow)}
                            className={`w-full rounded-lg px-1.5 py-1 text-[10px] text-left transition-all active:scale-95
                              ${isActive ? 'ring-2 ring-primary ring-offset-1 ring-offset-background' : ''}
                              ${shouldHighlight ? 'ring-2 ring-red-500 ring-offset-1 animate-pulse' : ''}
                              ${lifecycle === 'submitted' ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                                : lifecycle === 'live' ? 'bg-blue-500/15 text-blue-700 dark:text-blue-300'
                                : lifecycle === 'ended' ? 'bg-red-500/10 text-red-700 dark:text-red-300'
                                : 'bg-card text-muted-foreground hover:bg-card/80'}`}>
                            <div className="flex items-center gap-1">
                              {lifecycle === 'live' && <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse shrink-0" />}
                              {lifecycle === 'submitted' && <CheckCircle2 className="w-2.5 h-2.5 text-emerald-500 shrink-0" />}
                              <p className="font-medium leading-tight truncate">{fmt12s(slot.startTime)}–{fmt12s(slot.endTime)}</p>
                            </div>
                            <p className="opacity-70 leading-tight truncate">{getRoomName(slot.roomId)}</p>
                          </button>
                        );
                      })}
                      {daySlots.length === 0 && <p className="text-[10px] text-muted-foreground/30 text-center py-2">—</p>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ═══ PAGE: SCORING ═══ */}
      {currentPage === 'scoring' && (
        <div>
          {/* Student badges — ALL students, color-coded */}
          {scoringStudents.length > 0 ? (
            <div className="flex flex-wrap gap-1.5 mb-4">
              {scoringStudents.map((s) => {
                const isSel = s._id === selectedStudentId;
                const colorMap = {
                  gray: 'bg-muted text-muted-foreground',
                  red: 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300',
                  yellow: 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300',
                  green: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300',
                };
                return (
                  <button key={s._id} onClick={() => handleStudentSelect(s._id)}
                    className={`px-3 py-2 rounded-xl text-xs font-medium transition-all active:scale-95 min-h-[36px]
                      ${colorMap[s.badgeColor]}
                      ${isSel ? 'ring-2 ring-primary ring-offset-1 ring-offset-background' : ''}`}>
                    {s.name.split(' ')[0]}
                  </button>
                );
              })}
            </div>
          ) : (
            <Card className="border-border/50 mb-4"><CardContent className="p-6 text-center"><p className="text-sm text-muted-foreground">No students in this session</p></CardContent></Card>
          )}

          {/* Selected student scoring UI */}
          {selectedStudentId && selectedStudent && (() => {
            const pos = studentPositions.get(selectedStudentId);
            const termUnits = getStudentTermUnits(selectedStudentId);
            const up = selectedUnitId ? getUnitProgress(selectedStudentId, selectedUnitId) : null;
            const dayCorrect = (todayEntries || []).filter(e => e.studentId === selectedStudentId).reduce((s, e) => s + e.correctCount, 0);
            return (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <p className="text-sm font-bold text-foreground">{(selectedStudent as { name: string }).name}</p>
                    {dayCorrect > 0 && <p className="text-[11px] text-emerald-600 font-medium">{dayCorrect} correct · {calculateDailyPoints(dayCorrect)} pts</p>}
                  </div>
                  {!finishedStudentIds.has(selectedStudentId) && !scoringExercise && <Button size="sm" onClick={handleFinishSession} className="h-8 rounded-xl text-xs bg-emerald-600 hover:bg-emerald-700"><CheckCircle2 className="w-3.5 h-3.5 mr-1" />Finish</Button>}
                  {finishedStudentIds.has(selectedStudentId) && <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300 text-[10px]">Done</Badge>}
                </div>

                {pos && (
                  <div className="flex items-center justify-between mb-3">
                    <button onClick={() => { setPositionDialogStudentId(selectedStudentId); setDialogModule(slotModule?.id ?? ''); setDialogGrade(String(pos.grade)); setDialogTerm(String(pos.term)); setDialogPermanent(false); setPositionDialogOpen(true); }}
                      className="px-2.5 py-1.5 rounded-lg bg-muted hover:bg-muted/80 text-[11px] font-mono font-semibold text-foreground transition-all active:scale-95">
                      {pos.moduleId} · G{pos.grade} · T{pos.term}
                    </button>
                    <div className="flex gap-1">
                      {termUnits.map(unit => {
                        const num = unit.name.match(/^(\d+)\./)?.[1] || unit.name.slice(0, 2);
                        return <button key={unit.id} onClick={() => { setSelectedUnitId(unit.id); setScoringExercise(null); setQuestionStates({}); setInitialQuestionStates({}); setExistingEntryId(null); }}
                          className={`w-8 h-8 rounded-lg text-xs font-bold transition-all active:scale-95 ${unit.id === selectedUnitId ? 'bg-primary text-primary-foreground shadow-sm' : 'bg-muted text-muted-foreground hover:text-foreground'}`}>{num}</button>;
                      })}
                    </div>
                  </div>
                )}

                {selectedUnitId && up && up.total > 0 && (
                  <div className="mb-3">
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-xs font-medium text-foreground truncate flex-1 mr-2">{selectedUnitName}</p>
                      <span className="text-[10px] text-muted-foreground shrink-0">{up.correctQ + up.wrongQ + up.skippedQ}/{up.totalQ}Q</span>
                    </div>
                    <div className="h-2.5 bg-muted rounded-full overflow-hidden flex">
                      {up.exercises.map((exb, ei) => {
                        const segW = up.totalQ > 0 ? (exb.qCount / up.totalQ) * 100 : 0;
                        return (
                          <div key={ei} className="h-full flex" style={{ width: `${segW}%` }}>
                            {exb.correct > 0 && <div className="h-full bg-emerald-500" style={{ width: `${(exb.correct / exb.qCount) * 100}%` }} />}
                            {exb.wrong > 0 && <div className="h-full bg-red-400" style={{ width: `${(exb.wrong / exb.qCount) * 100}%` }} />}
                            {exb.skipped > 0 && <div className="h-full bg-emerald-300" style={{ width: `${(exb.skipped / exb.qCount) * 100}%` }} />}
                          </div>
                        );
                      })}
                    </div>
                    <div className="flex items-center gap-3 mt-1">
                      <span className="text-[10px] text-emerald-600 flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />{up.correctQ}</span>
                      <span className="text-[10px] text-red-500 flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-red-400" />{up.wrongQ}</span>
                      {up.skippedQ > 0 && <span className="text-[10px] text-emerald-400 flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-emerald-300" />{up.skippedQ} skip</span>}
                    </div>
                  </div>
                )}

                {currentConcept && (
                  <button onClick={() => setConceptDrawerOpen(true)} className="flex items-center gap-2 bg-primary/10 rounded-xl px-3 py-2 mb-3 w-full text-left active:scale-[0.98] transition-transform">
                    <BookOpen className="w-3.5 h-3.5 text-primary shrink-0" />
                    <span className="text-xs font-medium text-primary truncate">Next: {currentConcept}</span>
                    <ChevronRight className="w-3.5 h-3.5 text-primary/50 ml-auto shrink-0" />
                  </button>
                )}

                {!scoringExercise ? (
                  selectedUnitExercises.length > 0 ? (
                    <div className="grid grid-cols-5 gap-2 mb-3">
                      {selectedUnitExercises.map(ex => {
                        const st = getExerciseStatus(selectedStudentId, ex._id, ex.questionCount);
                        const lbl = ex.name.includes('.') ? ex.name.split('.').pop() : ex.name;
                        return <button key={ex._id} onClick={() => slotModule && handleExerciseTap(ex, selectedUnitId, slotModule.id)}
                          className={`aspect-square rounded-xl text-xs font-bold transition-all active:scale-90 flex items-center justify-center
                            ${st === 'perfect' ? 'bg-emerald-500 text-white shadow-sm shadow-emerald-500/25'
                              : st === 'skipped' ? 'bg-emerald-300 text-emerald-800 dark:bg-emerald-400/30 dark:text-emerald-300 shadow-sm'
                              : st === 'wip' ? 'bg-amber-400 text-white shadow-sm shadow-amber-400/25'
                              : 'bg-muted text-muted-foreground hover:bg-muted/80'}`}>{lbl}</button>;
                      })}
                    </div>
                  ) : selectedUnitId ? <div className="text-center py-6 mb-3"><p className="text-xs text-muted-foreground">No exercises in this unit yet</p></div> : null
                ) : (() => {
                  const euInfo = findUnit(scoringExercise.unitId);
                  const unmarkedCount = Object.values(questionStates).filter(v => v === 'unmarked').length;
                  const markedCount = correctCount + wrongCount + skippedCount;
                  const progressPct = scoringExercise.questionCount > 0 ? ((markedCount / scoringExercise.questionCount) * 100) : 0;
                  return (
                    <div className="space-y-3">
                      {/* Header */}
                      <div className="flex items-center gap-3">
                        <button onClick={clearScoring} className="w-8 h-8 rounded-xl bg-muted flex items-center justify-center shrink-0 active:scale-90 transition-transform">
                          <ChevronLeft className="w-4 h-4 text-muted-foreground" />
                        </button>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-bold text-foreground leading-tight">{scoringExercise.name}</p>
                          {euInfo && <p className="text-[11px] text-muted-foreground truncate">{euInfo.unit.name}</p>}
                        </div>
                        {scoringExercise.pageNumber !== undefined && (
                          <span className="text-[10px] text-muted-foreground bg-muted rounded-lg px-2 py-1 shrink-0">p.{scoringExercise.pageNumber}</span>
                        )}
                      </div>

                      {/* Tiny exercise number boxes */}
                      <div className="flex gap-1 overflow-x-auto pb-1">
                        {selectedUnitExercises.map(ex => {
                          const st = getExerciseStatus(selectedStudentId, ex._id, ex.questionCount);
                          const isCurrent = ex._id === scoringExercise._id;
                          const lbl = ex.name.includes('.') ? ex.name.split('.').pop() : String(ex.order);
                          return (
                            <button key={ex._id}
                              onClick={() => slotModule && setupScoring(ex, selectedUnitId, slotModule.id)}
                              className={`shrink-0 w-7 h-7 rounded-md text-[10px] font-bold flex items-center justify-center transition-all
                                ${isCurrent ? 'ring-2 ring-primary ring-offset-1' : ''}
                                ${st === 'perfect' ? 'bg-emerald-500 text-white'
                                  : st === 'skipped' ? 'bg-emerald-300 text-emerald-800'
                                  : st === 'wip' ? 'bg-amber-400 text-white'
                                  : 'bg-muted text-muted-foreground'}`}>
                              {lbl}
                            </button>
                          );
                        })}
                      </div>

                      {/* Scoring progress strip */}
                      <div className="rounded-2xl bg-card border border-border/50 p-3">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{markedCount}/{scoringExercise.questionCount} marked</span>
                          <span className="text-[10px] font-bold text-primary">{Math.round(progressPct)}%</span>
                        </div>
                        <div className="h-1.5 bg-muted rounded-full overflow-hidden flex">
                          {correctCount > 0 && <div className="h-full bg-emerald-500 transition-all duration-300" style={{ width: `${(correctCount / scoringExercise.questionCount) * 100}%` }} />}
                          {wrongCount > 0 && <div className="h-full bg-red-400 transition-all duration-300" style={{ width: `${(wrongCount / scoringExercise.questionCount) * 100}%` }} />}
                          {skippedCount > 0 && <div className="h-full bg-emerald-300 transition-all duration-300" style={{ width: `${(skippedCount / scoringExercise.questionCount) * 100}%` }} />}
                        </div>
                        <div className="flex items-center gap-4 mt-2">
                          <span className="flex items-center gap-1.5 text-[11px] font-semibold text-emerald-600"><span className="w-2 h-2 rounded-full bg-emerald-500" />{correctCount}</span>
                          <span className="flex items-center gap-1.5 text-[11px] font-semibold text-red-500"><span className="w-2 h-2 rounded-full bg-red-400" />{wrongCount}</span>
                          {skippedCount > 0 && <span className="flex items-center gap-1.5 text-[11px] text-emerald-400"><span className="w-2 h-2 rounded-full bg-emerald-300" />{skippedCount}</span>}
                          <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><span className="w-2 h-2 rounded-full bg-muted-foreground/30" />{unmarkedCount}</span>
                          <div className="ml-auto flex items-center gap-1">
                            <Zap className="w-3 h-3 text-primary" />
                            <span className="text-[11px] font-bold text-primary">+{pointsThisEntry}</span>
                          </div>
                        </div>
                      </div>

                      {/* Question grid */}
                      <div className="grid grid-cols-5 gap-1.5">
                        {Array.from({ length: scoringExercise.questionCount }, (_, i) => {
                          const q = i + 1, s = questionStates[q] || 'unmarked';
                          return (
                            <button key={q} onClick={() => handleQuestionTap(q)}
                              className={`relative h-11 rounded-xl font-bold text-sm transition-all duration-150 active:scale-90
                                ${s === 'correct'
                                  ? 'bg-emerald-500 text-white shadow-sm shadow-emerald-500/20'
                                  : s === 'wrong'
                                    ? 'bg-red-500/90 text-white shadow-sm shadow-red-500/20'
                                    : s === 'skipped'
                                      ? 'bg-emerald-200 text-emerald-600 dark:bg-emerald-400/20 dark:text-emerald-300'
                                      : 'bg-muted text-muted-foreground hover:bg-muted/70'}`}>
                              {s === 'correct' ? '\u2713' : s === 'wrong' ? '\u2717' : s === 'skipped' ? '~' : q}
                            </button>
                          );
                        })}
                      </div>

                      {/* Quick actions */}
                      <div className="flex gap-1.5">
                        <button onClick={() => {
                          if (oldestUnsubmitted) { setBlockingDialogOpen(true); return; }
                          if (selectedStudentId && !presentStudentIds.has(selectedStudentId)) {
                            setAbsentStudentDialog({ studentId: selectedStudentId, type: sessionLifecycle === 'live' ? 'live' : 'future' }); return;
                          }
                          const s: Record<number, 'correct' | 'wrong' | 'unmarked'> = {}; for (let i = 1; i <= scoringExercise.questionCount; i++) s[i] = 'correct'; setQuestionStates(s);
                        }}
                          className="flex-1 flex items-center justify-center gap-1.5 h-9 rounded-xl text-[11px] font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 active:scale-95 transition-all">
                          <Sparkles className="w-3 h-3" />All Correct
                        </button>
                        <button onClick={() => {
                          if (oldestUnsubmitted) { setBlockingDialogOpen(true); return; }
                          if (selectedStudentId && !presentStudentIds.has(selectedStudentId)) {
                            setAbsentStudentDialog({ studentId: selectedStudentId, type: sessionLifecycle === 'live' ? 'live' : 'future' }); return;
                          }
                          setQuestionStates(prev => { const n = { ...prev }; for (let i = 1; i <= scoringExercise.questionCount; i++) { if (n[i] === 'unmarked') n[i] = 'correct'; } return n; });
                        }}
                          className="flex-1 flex items-center justify-center gap-1.5 h-9 rounded-xl text-[11px] font-semibold bg-muted text-muted-foreground hover:text-foreground active:scale-95 transition-all">
                          <SkipForward className="w-3 h-3" />Rest Correct
                        </button>
                      </div>

                      {/* Daily points card */}
                      {(correctCount > 0 || priorCorrectToday > 0) && (
                        <div className="rounded-2xl overflow-hidden">
                          <div className="bg-gradient-to-br from-primary/90 to-teal-500 p-3 text-white">
                            <div className="flex items-center justify-between">
                              <div>
                                <p className="text-[10px] font-medium opacity-70 uppercase tracking-wider">Today&apos;s Total</p>
                                <p className="text-xl font-black tracking-tight">{dailyPoints}<span className="text-xs font-semibold opacity-70 ml-1">pts</span></p>
                              </div>
                              <div className="w-10 h-10 rounded-xl bg-white/15 flex items-center justify-center">
                                <p className="text-lg font-black">{totalCorrectToday}</p>
                              </div>
                            </div>
                            {correctCount > 0 && (
                              <div className="flex gap-1 mt-2 flex-wrap">
                                {Array.from({ length: correctCount }, (_, i) => (
                                  <span key={i} className="text-[9px] bg-white/20 backdrop-blur-sm rounded-md px-1.5 py-0.5 font-bold tabular-nums">+{(priorCorrectToday + i + 1) * 5}</span>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Action buttons */}
                      <div className="flex gap-2 pt-1">
                        <Button variant="outline" onClick={handleSave} disabled={attempted === 0}
                          className="flex-1 h-11 text-sm font-bold rounded-xl border-border/50 disabled:opacity-30">
                          Save & Next
                        </Button>
                        <Button onClick={handleFinishExercise}
                          className="flex-1 h-11 text-sm font-bold rounded-xl bg-emerald-600 hover:bg-emerald-700">
                          <CheckCircle2 className="w-4 h-4 mr-1.5" />Finish
                        </Button>
                      </div>
                    </div>
                  );
                })()}
              </div>
            );
          })()}

          {/* Summary when no student selected */}
          {!selectedStudentId && scoringStudents.length > 0 && (() => {
            const inProg = scoringStudents.filter(s => s.badgeColor === 'yellow').length;
            const fin = scoringStudents.filter(s => s.badgeColor === 'green').length;
            const absent = scoringStudents.filter(s => s.badgeColor === 'red').length;
            const pending = scoringStudents.filter(s => s.badgeColor === 'gray').length;
            return (
              <div className="rounded-2xl bg-card border border-border/50 p-5">
                <div className="grid grid-cols-4 gap-2 mb-4">
                  <div className="text-center"><p className="text-2xl font-bold text-muted-foreground">{pending}</p><p className="text-[10px] text-muted-foreground">Pending</p></div>
                  <div className="text-center"><p className="text-2xl font-bold text-amber-500">{inProg}</p><p className="text-[10px] text-amber-500/70">Scoring</p></div>
                  <div className="text-center"><p className="text-2xl font-bold text-emerald-500">{fin}</p><p className="text-[10px] text-emerald-500/70">Done</p></div>
                  <div className="text-center"><p className="text-2xl font-bold text-red-500">{absent}</p><p className="text-[10px] text-red-500/70">Absent</p></div>
                </div>
                <p className="text-xs text-muted-foreground text-center">Tap a student to start scoring</p>
              </div>
            );
          })()}
        </div>
      )}

      {/* ═══ DIALOGS ═══ */}

      {/* Unsaved changes */}
      <Dialog open={showUnsavedDialog} onOpenChange={o => { if (!o) { setShowUnsavedDialog(false); setPendingAction(null); } }}>
        <DialogContent showCloseButton={false}>
          <DialogHeader><DialogTitle>Unsaved Changes</DialogTitle><DialogDescription>You have unsaved marks. Save before leaving?</DialogDescription></DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowUnsavedDialog(false); if (pendingAction) { pendingAction(); setPendingAction(null); } }}>Leave</Button>
            <Button onClick={async () => { await saveEntry(); setShowUnsavedDialog(false); if (pendingAction) { pendingAction(); setPendingAction(null); } }}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Position override */}
      <Dialog open={positionDialogOpen} onOpenChange={setPositionDialogOpen}>
        <DialogContent className="max-w-sm mx-auto">
          <DialogHeader><DialogTitle>Change Position</DialogTitle><DialogDescription>Override module, grade, and term</DialogDescription></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-sm">Module</Label>
              <Select value={dialogModule} onValueChange={v => setDialogModule(v ?? '')}><SelectTrigger className="mt-1"><SelectValue placeholder="Module" /></SelectTrigger><SelectContent>{CURRICULUM_MODULES.map(m => <SelectItem key={m.id} value={m.id}>{m.id}: {m.name}</SelectItem>)}</SelectContent></Select>
            </div>
            {dialogModule && (() => {
              const mod = CURRICULUM_MODULES.find(m => m.id === dialogModule);
              if (!mod) return null;
              return (<>
                <div><Label className="text-sm">Grade</Label><Select value={dialogGrade} onValueChange={v => { setDialogGrade(v ?? ''); setDialogTerm(''); }}><SelectTrigger className="mt-1"><SelectValue placeholder="Grade" /></SelectTrigger><SelectContent>{mod.grades.map(g => <SelectItem key={g.grade} value={String(g.grade)}>Grade {g.grade}</SelectItem>)}</SelectContent></Select></div>
                {dialogGrade && (() => { const gr = mod.grades.find(g => g.grade === parseInt(dialogGrade)); if (!gr) return null; return <div><Label className="text-sm">Term</Label><Select value={dialogTerm} onValueChange={v => setDialogTerm(v ?? '')}><SelectTrigger className="mt-1"><SelectValue placeholder="Term" /></SelectTrigger><SelectContent>{gr.terms.map(t => <SelectItem key={t.term} value={String(t.term)}>Term {t.term}</SelectItem>)}</SelectContent></Select></div>; })()}
              </>);
            })()}
            <div className="flex items-center gap-3 pt-1">
              <button onClick={() => setDialogPermanent(!dialogPermanent)} className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${dialogPermanent ? 'bg-primary' : 'bg-muted-foreground/30'}`}><span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform ${dialogPermanent ? 'translate-x-5' : ''}`} /></button>
              <div><Label className="text-sm">Save permanently</Label><p className="text-xs text-muted-foreground">Sets starting position for this module</p></div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPositionDialogOpen(false)}>Cancel</Button>
            <Button disabled={!dialogModule || !dialogGrade || !dialogTerm} onClick={async () => {
              if (dialogPermanent && positionDialogStudentId) { await setModulePosMut({ studentId: positionDialogStudentId, moduleId: dialogModule, grade: parseInt(dialogGrade), term: parseInt(dialogTerm) }); toast.success('Position saved'); }
              setPositionDialogOpen(false);
            }}>Apply</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Attendance guard — student has scoring data but teacher wants to mark absent */}
      <Dialog open={!!attendanceGuardDialog} onOpenChange={o => { if (!o) setAttendanceGuardDialog(null); }}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Student Has Scoring Data</DialogTitle>
            <DialogDescription>{attendanceGuardDialog?.name} has scoring entries for this session. Mark as absent anyway?</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAttendanceGuardDialog(null)}>Keep Present</Button>
            <Button variant="destructive" onClick={() => attendanceGuardDialog && handleForceAbsent(attendanceGuardDialog.studentId)}>Mark Absent</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Submit confirmation */}
      <Dialog open={submitDialogOpen} onOpenChange={setSubmitDialogOpen}>
        <DialogContent className="max-w-sm mx-auto">
          <DialogHeader><DialogTitle>Submit Session</DialogTitle></DialogHeader>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Date</span><span className="font-medium">{effectiveSlot ? `${DAY_SHORT[effectiveSlot.dayOfWeek]}, ${effectiveDate}` : ''}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Time</span><span className="font-medium">{effectiveSlot ? `${fmt12(effectiveSlot.startTime)} – ${fmt12(effectiveSlot.endTime)}` : ''}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Room</span><span className="font-medium">{slotRoom ? (slotRoom as { name: string }).name : ''}</span></div>
            {slotModule && <div className="flex justify-between"><span className="text-muted-foreground">Module</span><span className="font-medium" style={{ color: slotModule.color }}>{slotModule.id}: {slotModule.name}</span></div>}
            <div className="border-t border-border/50 pt-2 mt-2" />
            <div className="flex justify-between"><span className="text-muted-foreground">Present</span><span className="font-bold text-emerald-600">{presentStudentIds.size} students</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Absent</span><span className="font-bold text-red-500">{(effectiveStudents?.length || 0) - presentStudentIds.size} students</span></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSubmitDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleConfirmSubmit} className="bg-emerald-600 hover:bg-emerald-700"><Send className="w-3.5 h-3.5 mr-1.5" />Confirm Submit</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Unfinished students alert */}
      <Dialog open={unfinishedAlertStudents.length > 0} onOpenChange={o => { if (!o) setUnfinishedAlertStudents([]); }}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><AlertTriangle className="w-5 h-5 text-amber-500" />Students Not Finished</DialogTitle>
            <DialogDescription>Finish all present students before submitting. Go to the scoring page and press &quot;Finish&quot; for each student.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap gap-1.5 my-2">
            {unfinishedAlertStudents.map((name, i) => (
              <span key={i} className="px-2.5 py-1 rounded-lg bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300 text-xs font-medium">{name}</span>
            ))}
          </div>
          <DialogFooter>
            <Button onClick={() => { setUnfinishedAlertStudents([]); setCurrentPage('scoring'); }}>Go to Scoring</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Absent student dialog */}
      <Dialog open={!!absentStudentDialog} onOpenChange={o => { if (!o) setAbsentStudentDialog(null); }}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Student Not Present</DialogTitle>
            <DialogDescription>
              {absentStudentDialog?.type === 'live'
                ? 'This student is marked absent. Mark them as present to start scoring.'
                : 'This student is not present in this session. Switch to a live session to score.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            {absentStudentDialog?.type === 'live' ? (
              <>
                <Button variant="outline" onClick={() => setAbsentStudentDialog(null)}>Cancel</Button>
                <Button onClick={handleMarkPresentFromDialog} className="bg-blue-600 hover:bg-blue-700">Mark Present</Button>
              </>
            ) : (
              <Button onClick={() => setAbsentStudentDialog(null)}>OK</Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Blocking dialog — older session unsubmitted */}
      <Dialog open={blockingDialogOpen} onOpenChange={setBlockingDialogOpen}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><AlertTriangle className="w-5 h-5 text-red-500" />Previous Session Not Submitted</DialogTitle>
            <DialogDescription>
              Submit your {oldestUnsubmitted ? `${DAY_SHORT[oldestUnsubmitted.dayOfWeek]} ${fmt12s(oldestUnsubmitted.startTime)}–${fmt12s(oldestUnsubmitted.endTime)}` : ''} session before scoring in another session.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBlockingDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleGoToUnsubmitted} className="bg-red-600 hover:bg-red-700">Go to Session</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Concept Drawer */}
      <Sheet open={conceptDrawerOpen} onOpenChange={setConceptDrawerOpen}>
        <SheetContent side="right" className="overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Unit Overview</SheetTitle>
          </SheetHeader>
          {selectedStudentId && selectedUnitId && slotModule && (() => {
            const pos = studentPositions.get(selectedStudentId);
            if (!pos) return null;
            const units = getOrderedUnits(slotModule.id);
            const items = getStudentUpcomingItems(
              selectedStudentId, slotModule.id, allEntries || [], allExercises || [], units, 20,
              getPositionOpts(selectedStudentId, slotModule.id, (selectedStudent as { schoolGrade: number })?.schoolGrade ?? 6)
            );
            const unitItems = (allExercises || []).filter(e => e.unitId === selectedUnitId).sort((a, b) => a.order - b.order);
            const unitInfo = findUnit(selectedUnitId);
            return (
              <div className="px-4 pb-4 space-y-4">
                {unitInfo && (
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Current Unit</p>
                    <p className="text-sm font-bold text-foreground mb-2">{unitInfo.unit.name}</p>
                    <div className="space-y-1">
                      {unitItems.map(item => {
                        const isConcept = item.type === 'concept';
                        const entry = (allEntries || []).find(e => e.studentId === selectedStudentId && e.exerciseId === item._id);
                        const isDone = !isConcept && entry && entry.totalAttempted >= item.questionCount;
                        return (
                          <div key={item._id} className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs ${isConcept ? 'bg-primary/5' : isDone ? 'bg-emerald-500/10' : 'bg-muted/30'}`}>
                            {isConcept ? (
                              <BookOpen className="w-3 h-3 text-primary shrink-0" />
                            ) : isDone ? (
                              <CheckCircle2 className="w-3 h-3 text-emerald-500 shrink-0" />
                            ) : (
                              <div className="w-3 h-3 rounded-full border border-muted-foreground/30 shrink-0" />
                            )}
                            <span className={`${isConcept ? 'text-primary font-medium' : isDone ? 'text-emerald-600' : 'text-foreground'}`}>{item.name}</span>
                            {!isConcept && item.pageNumber && <span className="text-muted-foreground ml-auto">p.{item.pageNumber}</span>}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
                {items.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Upcoming</p>
                    <div className="space-y-1">
                      {items.map(item => (
                        <div key={item.id} className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs ${item.type === 'concept' ? 'bg-primary/5' : 'bg-muted/30'}`}>
                          {item.type === 'concept' ? <BookOpen className="w-3 h-3 text-primary shrink-0" /> : <div className="w-3 h-3 rounded-full border border-muted-foreground/30 shrink-0" />}
                          <span className={item.type === 'concept' ? 'text-primary font-medium' : 'text-foreground'}>{item.name}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}
        </SheetContent>
      </Sheet>
    </div>
  );
}
