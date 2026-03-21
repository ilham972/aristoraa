'use client';

import { useState, useMemo, useEffect, useCallback } from 'react';
import { useQuery, useMutation } from 'convex/react';
import { Check, BookOpen, CheckCircle2, Clock, MapPin, Send, ChevronLeft, ChevronRight, Sparkles, Zap, SkipForward, Radio } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
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
  const [manualSlotId, setManualSlotId] = useState('');
  const [attendanceDate, setAttendanceDate] = useState(() => getTodayDateStr());
  const [calPage, setCalPage] = useState(0); // 0 = Mon-Wed, 1 = Thu-Sat

  // Draft attendance: { "slotId|date": ["studentId1", ...] }
  const [draftAttendance, setDraftAttendance] = usePersistentState<Record<string, string[]>>('mt-draft-att', {});
  const [draftFinished, setDraftFinished] = usePersistentState<Record<string, string[]>>('mt-draft-fin', {});

  // Tab 2: Scoring
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

  // Derive module from room's timetable for the slot's day, falling back to global day-of-week mapping
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
  // DB attendance (for submitted sessions only)
  const attendanceRecords = useQuery(
    api.attendance.getBySlotAndDate,
    effectiveSlot ? { slotId: effectiveSlot._id as Id<"scheduleSlots">, date: effectiveDate } : 'skip'
  );

  // ─── Mutations ───
  const submitSessionMut = useMutation(api.attendance.submitSession);
  const addEntryMut = useMutation(api.entries.add);
  const updateEntryMut = useMutation(api.entries.update);
  const setModulePosMut = useMutation(api.studentModulePositions.set);

  // ─── Derived ───
  const todayDow = useMemo(() => { const d = now.getDay(); return d === 0 ? 7 : d; }, [now]);
  const weekDates = useMemo(() => getWeekDates(today), [today]);

  // Draft present IDs for current session
  const draftPresentIds = useMemo(() => new Set(draftAttendance[sessionKey] || []), [draftAttendance, sessionKey]);
  const draftFinishedIds = useMemo(() => new Set(draftFinished[sessionKey] || []), [draftFinished, sessionKey]);

  // DB-submitted present IDs (for sessions already submitted)
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

  // Present students for Tab 2
  const presentStudents = useMemo(() => {
    if (!effectiveStudents) return [];
    return effectiveStudents
      .filter((s: { _id: string }) => presentStudentIds.has(s._id) || studentsWithEntries.has(s._id))
      .sort((a: { _id: string }, b: { _id: string }) => {
        const av = finishedStudentIds.has(a._id) ? 2 : studentsWithEntries.has(a._id) ? 1 : 0;
        const bv = finishedStudentIds.has(b._id) ? 2 : studentsWithEntries.has(b._id) ? 1 : 0;
        return av - bv;
      });
  }, [effectiveStudents, presentStudentIds, studentsWithEntries, finishedStudentIds]);

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

  // isViewingOther: manually selected a different slot
  const isViewingOther = !!manualSlotId && effectiveSlot?._id !== activeSlot?._id;

  // Countdown: minutes until session starts (negative = already started / ended)
  const sessionCountdown = useMemo(() => {
    if (!effectiveSlot) return null;
    const nowM = now.getHours() * 60 + now.getMinutes();
    const slotDow = effectiveSlot.dayOfWeek;
    if (slotDow === todayDow) {
      const startM = parseTimeToMinutes(effectiveSlot.startTime);
      const endM = parseTimeToMinutes(effectiveSlot.endTime);
      if (nowM >= startM && nowM < endM) return { minsLeft: endM - nowM, state: 'live' as const };
      if (nowM >= endM) return { minsLeft: 0, state: 'ended' as const };
      return { minsLeft: startM - nowM, state: 'upcoming' as const };
    }
    // Future day: compute rough minutes
    let dayDiff = slotDow - todayDow;
    if (dayDiff <= 0) dayDiff += 7;
    const startM = parseTimeToMinutes(effectiveSlot.startTime);
    return { minsLeft: dayDiff * 1440 + startM - nowM, state: 'upcoming' as const };
  }, [effectiveSlot, now, todayDow]);

  // Pending submissions from draft
  const pendingSessions = useMemo(() => {
    const sessions: Array<{ key: string; slotId: string; date: string; presentCount: number; finishedCount: number }> = [];
    for (const [key, ids] of Object.entries(draftAttendance)) {
      if (ids.length === 0) continue;
      const [slotId, date] = key.split('|');
      const finCount = (draftFinished[key] || []).length;
      sessions.push({ key, slotId, date, presentCount: ids.length, finishedCount: finCount });
    }
    return sessions.sort((a, b) => a.date.localeCompare(b.date));
  }, [draftAttendance, draftFinished]);

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
  // Exercise status: 'perfect' = all attempted no skips, 'skipped' = all attempted but has skips, 'wip' = partial, 'none' = not started
  const getExerciseStatus = (sid: string, exId: string, qCount: number): 'perfect' | 'skipped' | 'wip' | 'none' => {
    const entry = allEntries?.find(e => e.studentId === sid && e.exerciseId === exId);
    if (!entry) return 'none';
    if (entry.totalAttempted >= qCount) return 'perfect'; // all questions answered (correct or wrong)
    // Check if it was "finished" with skips (totalAttempted < qCount but entry exists with some answers)
    // We detect skipped by checking if the questions object has skip markers or if totalAttempted < qCount but entry was saved as finished
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

  const canSubmitSession = (endTime: string, date: string): boolean => {
    if (date < today) return true; // past dates always submittable
    if (date > today) return false;
    const nowM = now.getHours() * 60 + now.getMinutes();
    return nowM >= parseTimeToMinutes(endTime);
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
    setDraftAttendance(prev => {
      const current = [...(prev[sessionKey] || [])];
      const idx = current.indexOf(sid);
      if (idx >= 0) current.splice(idx, 1);
      else current.push(sid);
      return { ...prev, [sessionKey]: current };
    });
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
    // Ensure student is in draft present (they're scoring, so they're present)
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
    // Mark unmarked questions as skipped
    const finalStates = { ...questionStates };
    for (let i = 1; i <= scoringExercise.questionCount; i++) {
      if (finalStates[i] === 'unmarked') finalStates[i] = 'skipped';
    }
    setQuestionStates(finalStates);
    // Save with skipped
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
    // Go back to grid
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

  const handleSubmitSession = async (key: string) => {
    const [slotId, date] = key.split('|');
    const presentIds = draftAttendance[key] || [];
    const finIds = draftFinished[key] || [];
    await submitSessionMut({
      slotId: slotId as Id<"scheduleSlots">,
      date,
      presentStudentIds: presentIds as Id<"students">[],
      finishedStudentIds: finIds as Id<"students">[],
    });
    setDraftAttendance(prev => { const n = { ...prev }; delete n[key]; return n; });
    setDraftFinished(prev => { const n = { ...prev }; delete n[key]; return n; });
    toast.success('Session submitted!');
  };

  const clearScoring = () => {
    if (hasUnsavedChanges) {
      setPendingAction(() => () => { setScoringExercise(null); setQuestionStates({}); setInitialQuestionStates({}); setExistingEntryId(null); });
      setShowUnsavedDialog(true);
    } else { setScoringExercise(null); setQuestionStates({}); setInitialQuestionStates({}); setExistingEntryId(null); }
  };

  // ─── Loading ───
  const loading = !students || !allEntries || !todayEntries || !allExercises || settings === undefined || !modulePositions || !allSlots || !rooms;
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
      <Tabs defaultValue="attendance">
        <TabsList className="w-full mb-4 h-10">
          <TabsTrigger value="attendance" className="flex-1 text-xs font-semibold">Attendance</TabsTrigger>
          <TabsTrigger value="scoring" className="flex-1 text-xs font-semibold">
            Scoring{presentStudents.length > 0 && <span className="ml-1.5 w-5 h-5 rounded-full bg-primary/20 text-primary text-[10px] font-bold inline-flex items-center justify-center">{presentStudents.length}</span>}
          </TabsTrigger>
          <TabsTrigger value="submissions" className="flex-1 text-xs font-semibold">
            Submit{pendingSessions.length > 0 && <span className="ml-1.5 w-5 h-5 rounded-full bg-amber-500/20 text-amber-600 text-[10px] font-bold inline-flex items-center justify-center">{pendingSessions.length}</span>}
          </TabsTrigger>
        </TabsList>

        {/* ═══ TAB 1: ATTENDANCE ═══ */}
        <TabsContent value="attendance" className="space-y-3">
          {/* Student Badges — fixed 2-row grid */}
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

          {/* Compact Info Strip */}
          <div className="rounded-2xl bg-card border border-border/50 overflow-hidden">
            <div className="px-4 py-3 flex items-center gap-3">
              {/* Date + slot info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-bold text-foreground">{DAY_SHORT[now.getDay() === 0 ? 7 : now.getDay()]}</p>
                  <span className="text-[11px] text-muted-foreground">{now.getDate()} {MONTHS[now.getMonth()].slice(0, 3)}</span>
                  {slotModule && (
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md" style={{ backgroundColor: slotModule.color + '20', color: slotModule.color }}>{slotModule.id}</span>
                  )}
                </div>
                {effectiveSlot && slotRoom ? (
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className="text-[11px] text-foreground font-medium">{fmt12s(effectiveSlot.startTime)}–{fmt12s(effectiveSlot.endTime)}</span>
                    <span className="text-[11px] text-muted-foreground">· {(slotRoom as { name: string }).name}</span>
                  </div>
                ) : (
                  <p className="text-[11px] text-muted-foreground mt-0.5">No sessions scheduled</p>
                )}
                {isViewingOther && effectiveSlot && (
                  <p className="text-[10px] text-amber-500 font-medium mt-0.5">Viewing: {DAY_SHORT[effectiveSlot.dayOfWeek]} {fmt12s(effectiveSlot.startTime)}</p>
                )}
              </div>
              {/* Right side: countdown + attendance */}
              <div className="flex items-center gap-2 shrink-0">
                {effectiveStudents && effectiveStudents.length > 0 && (
                  <div className="text-center px-2 py-1 rounded-lg bg-muted/50">
                    <p className="text-sm font-black text-foreground leading-none">{draftPresentIds.size}<span className="text-muted-foreground font-medium">/{effectiveStudents.length}</span></p>
                  </div>
                )}
                {sessionCountdown ? (
                  <div className={`text-center px-2.5 py-1.5 rounded-xl min-w-[44px] ${sessionCountdown.state === 'live' ? 'bg-emerald-500/15' : sessionCountdown.state === 'ended' ? 'bg-destructive/10' : 'bg-primary/10'}`}>
                    {sessionCountdown.state === 'live' ? (
                      <>
                        <div className="flex items-center justify-center gap-1">
                          <Radio className="w-3 h-3 text-emerald-500 animate-pulse" />
                          <p className="text-sm font-black text-emerald-600 leading-none">{sessionCountdown.minsLeft}</p>
                        </div>
                        <p className="text-[9px] font-semibold text-emerald-500/70">LIVE</p>
                      </>
                    ) : sessionCountdown.state === 'ended' ? (
                      <>
                        <p className="text-sm font-black text-destructive leading-none">0</p>
                        <p className="text-[9px] font-semibold text-destructive/70">END</p>
                      </>
                    ) : (() => {
                      const cd = fmtCountdownCompact(sessionCountdown.minsLeft);
                      return <>
                        <p className="text-sm font-black text-primary leading-none">{cd.value}</p>
                        <p className="text-[9px] font-semibold text-primary/70">{cd.unit}</p>
                      </>;
                    })()}
                  </div>
                ) : null}
              </div>
            </div>
            {/* Progress bar */}
            {effectiveSlot && effectiveStudents && effectiveStudents.length > 0 && (
              <div className="h-1 bg-muted"><div className="h-full bg-primary transition-all duration-300" style={{ width: `${(draftPresentIds.size / effectiveStudents.length) * 100}%` }} /></div>
            )}
          </div>

          {/* Weekly Calendar — 3 days at a time */}
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
                      {daySlots.map((slot: { _id: string; startTime: string; endTime: string; roomId: string }) => {
                        const isActive = slot._id === effectiveSlot?._id && weekDates[dow - 1] === effectiveDate;
                        const dKey = `${slot._id}|${weekDates[dow - 1]}`;
                        const hasDraft = (draftAttendance[dKey] || []).length > 0;
                        return (
                          <button key={slot._id} onClick={() => handleCalendarSlotTap(slot._id, dow)}
                            className={`w-full rounded-lg px-1.5 py-1 text-[10px] text-left transition-all active:scale-95
                              ${isActive ? 'bg-primary text-primary-foreground shadow-sm' : hasDraft ? 'bg-primary/20 text-primary' : 'bg-card text-muted-foreground hover:bg-card/80'}`}>
                            <p className="font-medium leading-tight">{fmt12s(slot.startTime)}–{fmt12s(slot.endTime)}</p>
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
        </TabsContent>

        {/* ═══ TAB 2: SCORING ═══ */}
        <TabsContent value="scoring">
          {presentStudents.length > 0 ? (
            <div className="flex flex-wrap gap-1.5 mb-4">
              {presentStudents.map((s: { _id: Id<"students">; name: string }) => {
                const fin = finishedStudentIds.has(s._id);
                const hasE = studentsWithEntries.has(s._id);
                const isSel = s._id === selectedStudentId;
                return (
                  <button key={s._id} onClick={() => handleStudentSelect(s._id)}
                    className={`px-3 py-2 rounded-xl text-xs font-medium transition-all active:scale-95 min-h-[36px]
                      ${fin ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300' : hasE ? 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300' : 'bg-muted text-muted-foreground'}
                      ${isSel ? 'ring-2 ring-primary ring-offset-1 ring-offset-background' : ''}`}>
                    {s.name.split(' ')[0]}
                  </button>
                );
              })}
            </div>
          ) : (
            <Card className="border-border/50 mb-4"><CardContent className="p-6 text-center"><p className="text-sm text-muted-foreground">No present students</p><p className="text-xs text-muted-foreground mt-1">Mark attendance in the Attendance tab first</p></CardContent></Card>
          )}

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
                    {/* Segmented progress bar: one segment per exercise, each split by questions */}
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
                        return <button key={ex._id} onClick={() => slotModule && setupScoring(ex, selectedUnitId, slotModule.id)}
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
                            <button key={q} onClick={() => s !== 'skipped' ? toggleQuestion(q) : undefined}
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
                        <button onClick={() => { const s: Record<number, 'correct' | 'wrong' | 'unmarked'> = {}; for (let i = 1; i <= scoringExercise.questionCount; i++) s[i] = 'correct'; setQuestionStates(s); }}
                          className="flex-1 flex items-center justify-center gap-1.5 h-9 rounded-xl text-[11px] font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 active:scale-95 transition-all">
                          <Sparkles className="w-3 h-3" />All Correct
                        </button>
                        <button onClick={() => setQuestionStates(prev => { const n = { ...prev }; for (let i = 1; i <= scoringExercise.questionCount; i++) { if (n[i] === 'unmarked') n[i] = 'correct'; } return n; })}
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

          {!selectedStudentId && presentStudents.length > 0 && (() => {
            const inProg = presentStudents.filter((s: { _id: string }) => studentsWithEntries.has(s._id) && !finishedStudentIds.has(s._id)).length;
            const fin = presentStudents.filter((s: { _id: string }) => finishedStudentIds.has(s._id)).length;
            return (
              <div className="rounded-2xl bg-card border border-border/50 p-5">
                <div className="grid grid-cols-3 gap-3 mb-4">
                  <div className="text-center"><p className="text-2xl font-bold text-muted-foreground">{presentStudents.length - inProg - fin}</p><p className="text-[10px] text-muted-foreground">Pending</p></div>
                  <div className="text-center"><p className="text-2xl font-bold text-amber-500">{inProg}</p><p className="text-[10px] text-amber-500/70">Scoring</p></div>
                  <div className="text-center"><p className="text-2xl font-bold text-emerald-500">{fin}</p><p className="text-[10px] text-emerald-500/70">Done</p></div>
                </div>
                <p className="text-xs text-muted-foreground text-center">Tap a student to start scoring</p>
              </div>
            );
          })()}
        </TabsContent>

        {/* ═══ TAB 3: SUBMISSIONS ═══ */}
        <TabsContent value="submissions">
          {pendingSessions.length > 0 ? (
            <div className="space-y-3">
              {pendingSessions.map(session => {
                const slot = allSlots?.find((s: { _id: string }) => s._id === session.slotId);
                if (!slot) return null;
                const room = rooms?.find((r: { _id: string }) => r._id === slot.roomId);
                const center = room ? centers?.find((c: { _id: string }) => c._id === (room as { centerId: string }).centerId) : null;
                const canSubmit = canSubmitSession(slot.endTime, session.date);
                const dayIdx = slot.dayOfWeek;
                const entryCount = allEntries?.filter(e => {
                  const presentSet = new Set(draftAttendance[session.key] || []);
                  return presentSet.has(e.studentId) && e.date === session.date;
                }).length || 0;

                return (
                  <div key={session.key} className="rounded-2xl bg-card border border-border/50 p-4">
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <p className="text-sm font-bold text-foreground">{DAY_SHORT[dayIdx]} · {session.date}</p>
                        <p className="text-xs text-muted-foreground">{fmt12(slot.startTime)} – {fmt12(slot.endTime)}</p>
                        {room && <p className="text-xs text-muted-foreground">{(room as { name: string }).name}{center ? ` · ${(center as { name: string }).name}` : ''}</p>}
                      </div>
                      <div className="text-right">
                        <p className="text-lg font-bold text-primary">{session.presentCount}</p>
                        <p className="text-[10px] text-muted-foreground">present</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 mb-3 text-xs text-muted-foreground">
                      <span>{session.finishedCount} finished</span>
                      <span>·</span>
                      <span>{entryCount} entries</span>
                    </div>

                    <Button
                      onClick={() => handleSubmitSession(session.key)}
                      disabled={!canSubmit}
                      className={`w-full h-10 rounded-xl text-sm font-semibold transition-all ${canSubmit ? 'bg-primary hover:bg-primary/90' : 'opacity-40 cursor-not-allowed'}`}>
                      <Send className="w-3.5 h-3.5 mr-1.5" />
                      {canSubmit ? 'Submit Session' : `Submittable after ${fmt12(slot.endTime)}`}
                    </Button>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="rounded-2xl bg-card border border-border/50 p-8 text-center">
              <p className="text-sm text-muted-foreground">No pending submissions</p>
              <p className="text-xs text-muted-foreground mt-1">Sessions with attendance will appear here</p>
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* ═══ DIALOGS ═══ */}
      <Dialog open={showUnsavedDialog} onOpenChange={o => { if (!o) { setShowUnsavedDialog(false); setPendingAction(null); } }}>
        <DialogContent showCloseButton={false}>
          <DialogHeader><DialogTitle>Unsaved Changes</DialogTitle><DialogDescription>You have unsaved marks. Save before leaving?</DialogDescription></DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowUnsavedDialog(false); if (pendingAction) { pendingAction(); setPendingAction(null); } }}>Leave</Button>
            <Button onClick={async () => { await saveEntry(); setShowUnsavedDialog(false); if (pendingAction) { pendingAction(); setPendingAction(null); } }}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
            // Also get all items in the selected unit
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
