'use client';

import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useQuery, useMutation } from 'convex/react';
import { BookOpen, CheckCircle2, Send, ChevronLeft, ChevronRight, Sparkles, Zap, SkipForward, Radio, AlertTriangle, RotateCcw, Image as ImageIcon } from 'lucide-react';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { PinchZoomArea } from '@/components/pinch-zoom-area';
import { PositionDialog } from '@/components/position-dialog';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { getTodayDateStr, parseTimeToMinutes } from '@/lib/types';
import { api } from '@/lib/convex';
import { CURRICULUM_MODULES, getModuleForDay, getModuleById, getOrderedUnits, findUnit } from '@/lib/curriculum-data';
import { getTotalCorrectForDay, calculateDailyPoints, getStudentNextExercise, getStudentUpcomingItems, getWeekDates, type PositionOptions } from '@/lib/scoring';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
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
  const [attendanceMode, setAttendanceMode] = useState(false);
  const [sessionCalendarOpen, setSessionCalendarOpen] = useState(false);
  const [manualSlotId, setManualSlotId] = useState('');
  const [attendanceDate, setAttendanceDate] = useState(() => getTodayDateStr());
  // Persisted last manual pick — used as fallback when no upcoming session
  const [lastPickedSlotId, setLastPickedSlotId] = usePersistentState('mt-last-slot', '');
  const [lastPickedDate, setLastPickedDate] = usePersistentState('mt-last-date', '');
  const [calPage, setCalPage] = useState(0);

  // Draft attendance: { "slotId|date": ["studentId1", ...] }
  const [draftAttendance, setDraftAttendance] = usePersistentState<Record<string, string[]>>('mt-draft-att', {});
  const [draftFinished, setDraftFinished] = usePersistentState<Record<string, string[]>>('mt-draft-fin', {});

  // Scoring
  const [selectedStudentId, setSelectedStudentId] = useState<Id<"students"> | null>(null);
  const [selectedUnitId, setSelectedUnitId] = useState('');
  const [scoringExercise, setScoringExercise] = useState<{
    _id: Id<"exercises">; unitId: string; name: string; questionCount: number; order: number; moduleId: string; pageNumber?: number; pageNumberEnd?: number;
  } | null>(null);
  const [questionStates, setQuestionStates] = useState<Record<number, 'correct' | 'wrong' | 'skipped' | 'unmarked'>>({});
  const [existingEntryId, setExistingEntryId] = useState<Id<"entries"> | null>(null);
  const [initialQuestionStates, setInitialQuestionStates] = useState<Record<number, 'correct' | 'wrong' | 'skipped' | 'unmarked'>>({});

  // Live-save refs
  const liveEntryIdRef = useRef<Id<"entries"> | null>(null);
  const saveLockRef = useRef(false);
  const pendingSaveRef = useRef<Record<number, 'correct' | 'wrong' | 'skipped' | 'unmarked'> | null>(null);

  // Dialogs
  const [positionDialogOpen, setPositionDialogOpen] = useState(false);
  const [positionDialogStudentId, setPositionDialogStudentId] = useState<Id<"students"> | null>(null);
  const [positionDialogModuleId, setPositionDialogModuleId] = useState('');
  const [viewingOverride, setViewingOverride] = useState<{ exerciseId: string; unitId: string; moduleId: string } | null>(null);
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false);
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);
  const [conceptDrawerOpen, setConceptDrawerOpen] = useState(false);
  const [pageDrawerOpen, setPageDrawerOpen] = useState(false);

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
  const allTextbooks = useQuery(api.textbooks.list);

  // Page drawer: find the textbook for current exercise's pages
  const pageDrawerTextbook = useMemo(() => {
    if (!pageDrawerOpen || !scoringExercise?.pageNumber || !allTextbooks) return null;
    const unitInfo = findUnit(scoringExercise.unitId);
    if (!unitInfo) return null;
    const unitNum = parseInt(unitInfo.unit.name.match(/^(\d+)\./)?.[1] ?? '');
    if (isNaN(unitNum)) return null;
    const books = allTextbooks.filter(t => t.grade === unitInfo.grade).sort((a, b) => a.part - b.part);
    for (const book of books) {
      if (book.startUnit != null && book.endUnit != null && unitNum >= book.startUnit && unitNum <= book.endUnit) return book;
    }
    return books.length === 1 ? books[0] : null;
  }, [pageDrawerOpen, scoringExercise, allTextbooks]);

  const pageDrawerPages = useQuery(
    api.textbookPages.getPagesInRange,
    pageDrawerOpen && pageDrawerTextbook && scoringExercise?.pageNumber
      ? {
          textbookId: pageDrawerTextbook._id as Id<'textbooks'>,
          startPage: scoringExercise.pageNumber,
          endPage: scoringExercise.pageNumberEnd ?? scoringExercise.pageNumber,
        }
      : 'skip',
  );

  const teacherSlots = useMemo(() => {
    if (!teacherSlotAssignments || !allSlots) return undefined;
    const ids = new Set(teacherSlotAssignments.map((s: { slotId: string }) => s.slotId));
    return allSlots.filter((s: { _id: string }) => ids.has(s._id));
  }, [teacherSlotAssignments, allSlots]);

  // Use teacher-assigned slots if available, otherwise fall back to all slots
  const usableSlots = useMemo(() => {
    if (teacherSlots && teacherSlots.length > 0) return teacherSlots;
    return allSlots ?? undefined;
  }, [teacherSlots, allSlots]);

  const { activeSlot, nextSlot } = useActiveSlot(usableSlots);

  // ─── Derived (early) ───
  const todayDow = useMemo(() => { const d = now.getDay(); return d === 0 ? 7 : d; }, [now]);
  const weekDates = useMemo(() => getWeekDates(today), [today]);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  // Fallback: most recently ended slot (today first, then previous days)
  const fallbackSlot = useMemo(() => {
    if (!usableSlots || usableSlots.length === 0) return null;
    const todayEnded = usableSlots
      .filter((s: { dayOfWeek: number; endTime: string }) => s.dayOfWeek === todayDow && nowMinutes >= parseTimeToMinutes(s.endTime))
      .sort((a: { endTime: string }, b: { endTime: string }) => parseTimeToMinutes(b.endTime) - parseTimeToMinutes(a.endTime));
    if (todayEnded.length > 0) return todayEnded[0];
    for (let diff = 1; diff <= 6; diff++) {
      let dow = todayDow - diff;
      if (dow <= 0) dow += 7;
      const daySlots = usableSlots.filter((s: { dayOfWeek: number }) => s.dayOfWeek === dow)
        .sort((a: { endTime: string }, b: { endTime: string }) => parseTimeToMinutes(b.endTime) - parseTimeToMinutes(a.endTime));
      if (daySlots.length > 0) return daySlots[0];
    }
    return null;
  }, [usableSlots, todayDow, nowMinutes]);

  // Next upcoming slot across future days (not just today)
  const nextWeekSlot = useMemo(() => {
    if (!usableSlots || usableSlots.length === 0) return null;
    for (let diff = 1; diff <= 6; diff++) {
      let dow = todayDow + diff;
      if (dow > 7) dow -= 7;
      const daySlots = usableSlots.filter((s: { dayOfWeek: number }) => s.dayOfWeek === dow)
        .sort((a: { startTime: string }, b: { startTime: string }) => parseTimeToMinutes(a.startTime) - parseTimeToMinutes(b.startTime));
      if (daySlots.length > 0) return daySlots[0];
    }
    return null;
  }, [usableSlots, todayDow]);

  // Persisted last pick slot (resolved from allSlots)
  const lastPickedSlot = useMemo(() => {
    if (!lastPickedSlotId || !allSlots) return null;
    return allSlots.find((s: { _id: string }) => s._id === lastPickedSlotId) ?? null;
  }, [lastPickedSlotId, allSlots]);

  const effectiveSlot = useMemo(() => {
    if (manualSlotId) return allSlots?.find((s: { _id: string }) => s._id === manualSlotId) ?? null;
    // Priority: active → next today → next future day → last manual pick → fallback → first slot
    return activeSlot ?? nextSlot ?? nextWeekSlot ?? lastPickedSlot ?? fallbackSlot ?? usableSlots?.[0] ?? null;
  }, [manualSlotId, allSlots, activeSlot, nextSlot, nextWeekSlot, lastPickedSlot, fallbackSlot, usableSlots]);

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

  const effectiveDate = useMemo(() => {
    if (manualSlotId) return attendanceDate;
    if (activeSlot || nextSlot) return today;
    if (nextWeekSlot) return weekDates[(nextWeekSlot as { dayOfWeek: number }).dayOfWeek - 1];
    if (lastPickedSlot) return lastPickedDate || weekDates[(lastPickedSlot as { dayOfWeek: number }).dayOfWeek - 1] || today;
    if (fallbackSlot) return weekDates[(fallbackSlot as { dayOfWeek: number }).dayOfWeek - 1];
    if (usableSlots?.[0]) return weekDates[(usableSlots[0] as { dayOfWeek: number }).dayOfWeek - 1];
    return today;
  }, [manualSlotId, attendanceDate, activeSlot, nextSlot, nextWeekSlot, lastPickedSlot, lastPickedDate, fallbackSlot, usableSlots, today, weekDates]);
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

  // Auto-select first student when entering scoring page
  useEffect(() => {
    if (!effectiveStudents || effectiveStudents.length === 0) return;
    if (selectedStudentId && effectiveStudents.some((s: { _id: string }) => s._id === selectedStudentId)) return;
    // Select first student — selectStudent handles exercise auto-selection
    selectStudent(effectiveStudents[0]._id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveStudents, selectedStudentId]);

  // Re-attempt exercise auto-selection when data loads (covers timing issues)
  useEffect(() => {
    if (!selectedStudentId || scoringExercise) return;
    if (!allExercises || !slotModule || !studentPositions) return;
    const p = studentPositions.get(selectedStudentId);
    const unitId = p?.unitId || selectedUnitId;
    if (unitId) autoSelectExerciseForUnit(unitId, selectedStudentId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStudentId, scoringExercise, allExercises, slotModule, studentPositions]);

  // ─── Helpers ───
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
  const getBookPart = (unitId: string, grade?: number): number | null => {
    if (!allTextbooks) return null;
    const unitInfo = findUnit(unitId);
    if (!unitInfo) return null;
    const g = grade ?? unitInfo.grade;
    const unitNum = parseInt(unitInfo.unit.name.match(/^(\d+)\./)?.[1] ?? '');
    if (isNaN(unitNum)) return null;
    const books = allTextbooks.filter(t => t.grade === g).sort((a, b) => a.part - b.part);
    for (const book of books) {
      if (book.startUnit != null && book.endUnit != null && unitNum >= book.startUnit && unitNum <= book.endUnit) return book.part;
    }
    // Fallback: if only one book, use it
    if (books.length === 1) return books[0].part;
    return null;
  };
  const getConceptForExercise = (exId: string, unitId: string): string | null => {
    if (!allExercises) return null;
    const items = allExercises.filter(e => e.unitId === unitId).sort((a, b) => a.order - b.order);
    let last: string | null = null;
    for (const it of items) { if (it.type === 'concept') last = it.name; if (it._id === exId) return last; }
    return last;
  };
  // Check if student has entries for any later exercise in the same unit (implicit completion)
  const hasProgressedPast = (sid: string, unitId: string, exOrder: number): boolean => {
    if (!allExercises || !allEntries) return false;
    return allExercises.some(ex =>
      ex.unitId === unitId && (ex.type || 'exercise') === 'exercise' && ex.order > exOrder &&
      allEntries.some(e => e.studentId === sid && e.exerciseId === ex._id && e.totalAttempted > 0)
    );
  };
  const getExerciseStatus = (sid: string, exId: string, qCount: number, unitId: string, exOrder: number): 'perfect' | 'skipped' | 'wip' | 'none' => {
    const entry = allEntries?.find(e => e.studentId === sid && e.exerciseId === exId);
    if (!entry) return 'none';
    if (entry.totalAttempted >= qCount) return 'perfect';
    const qs = entry.questions as Record<string, string>;
    const addressed = Object.values(qs).filter(v => v === 'correct' || v === 'wrong' || v === 'skipped').length;
    if (addressed >= qCount) return 'skipped';
    // Implicit completion: student progressed past this exercise
    if (hasProgressedPast(sid, unitId, exOrder)) return 'skipped';
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
    for (const ex of exs) {
      const en = allEntries.find(e => e.studentId === selectedStudentId && e.exerciseId === ex._id);
      if (!en) return getConceptForExercise(ex._id, selectedUnitId);
      if (en.totalAttempted < ex.questionCount) {
        const qs = en.questions as Record<string, string>;
        const addressed = Object.values(qs).filter(v => v === 'correct' || v === 'wrong' || v === 'skipped').length;
        if (addressed < ex.questionCount && !hasProgressedPast(selectedStudentId, selectedUnitId, ex.order)) {
          return getConceptForExercise(ex._id, selectedUnitId);
        }
      }
    }
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

  const autoSelectExerciseForUnit = (unitId: string, sid: string) => {
    if (!allExercises || !slotModule) {
      setScoringExercise(null); setQuestionStates({}); setInitialQuestionStates({}); setExistingEntryId(null);
      return;
    }
    const exs = allExercises.filter(e => e.unitId === unitId && (e.type || 'exercise') === 'exercise').sort((a, b) => a.order - b.order);
    const nextEx = exs.find(ex => {
      const entry = allEntries?.find(e => e.studentId === sid && e.exerciseId === ex._id);
      if (!entry) return true;
      if (entry.totalAttempted >= ex.questionCount) return false;
      const qs = entry.questions as Record<string, string>;
      const addressed = Object.values(qs).filter(v => v === 'correct' || v === 'wrong' || v === 'skipped').length;
      if (addressed >= ex.questionCount) return false;
      // Implicit completion: student has entries for later exercises
      if (hasProgressedPast(sid, unitId, ex.order)) return false;
      return true;
    });
    // Smart preselect: next incomplete exercise, or last exercise if all done
    const targetEx = nextEx || (exs.length > 0 ? exs[exs.length - 1] : null);
    if (targetEx) {
      const moduleId = findUnit(unitId)?.module.id ?? slotModule.id;
      setupScoring(targetEx, unitId, moduleId);
    } else {
      setScoringExercise(null); setQuestionStates({}); setInitialQuestionStates({}); setExistingEntryId(null);
    }
  };

  const selectStudent = (sid: Id<"students">) => {
    setSelectedStudentId(sid);
    const p = studentPositions.get(sid);
    let unitId = p?.unitId ?? '';
    // Fallback: if no position (all exercises done), find the student's current grade/term unit
    if (!unitId && slotModule) {
      const student = effectiveStudents?.find((s: { _id: string }) => s._id === sid);
      if (student) {
        const ov = modulePositions?.find((mp: { studentId: string; moduleId: string }) => mp.studentId === sid && mp.moduleId === slotModule.id);
        const grade = ov?.grade ?? (student as { schoolGrade: number }).schoolGrade;
        const term = ov?.term ?? 1;
        const mod = CURRICULUM_MODULES.find(m => m.id === slotModule.id);
        const termData = mod?.grades.find(g => g.grade === grade)?.terms.find(t => t.term === term);
        if (termData && termData.units.length > 0) {
          unitId = termData.units[0].id;
        }
      }
    }
    setSelectedUnitId(unitId);
    if (unitId) {
      autoSelectExerciseForUnit(unitId, sid);
    } else {
      setScoringExercise(null); setQuestionStates({}); setInitialQuestionStates({}); setExistingEntryId(null);
    }
  };
  const handleStudentSelect = (sid: Id<"students">) => {
    if (sid === selectedStudentId) return;
    if (hasUnsavedChanges) { setPendingAction(() => () => selectStudent(sid)); setShowUnsavedDialog(true); return; }
    selectStudent(sid);
  };

  const setupScoring = (ex: NonNullable<typeof allExercises>[0], unitId: string, moduleId: string) => {
    setScoringExercise({ _id: ex._id, unitId, name: ex.name, questionCount: ex.questionCount, order: ex.order, moduleId, pageNumber: ex.pageNumber, pageNumberEnd: ex.pageNumberEnd });
    const existing = todayEntries?.find(e => e.studentId === selectedStudentId && e.exerciseId === ex._id)
      ?? allEntries?.find(e => e.studentId === selectedStudentId && e.exerciseId === ex._id);
    const st: Record<number, 'correct' | 'wrong' | 'skipped' | 'unmarked'> = {};
    if (existing) {
      setExistingEntryId(existing._id);
      liveEntryIdRef.current = existing._id;
      for (let i = 1; i <= ex.questionCount; i++) {
        const v = existing.questions[String(i)];
        st[i] = (v === 'correct' || v === 'wrong' || v === 'skipped') ? v : 'unmarked';
      }
    } else { setExistingEntryId(null); liveEntryIdRef.current = null; for (let i = 1; i <= ex.questionCount; i++) st[i] = 'unmarked'; }
    setQuestionStates(st); setInitialQuestionStates({ ...st });
    saveLockRef.current = false; pendingSaveRef.current = null;
  };
  // Live-save: persists question states to DB immediately
  const liveSave = async (states: Record<number, 'correct' | 'wrong' | 'skipped' | 'unmarked'>) => {
    if (!selectedStudentId || !scoringExercise) return;
    if (saveLockRef.current) { pendingSaveRef.current = states; return; }
    saveLockRef.current = true;
    try {
      const qs: Record<string, string> = {};
      let cc = 0, ta = 0;
      for (const [k, v] of Object.entries(states)) {
        if (v !== 'unmarked') { qs[k] = v; if (v === 'correct') cc++; if (v === 'correct' || v === 'wrong') ta++; }
      }
      if (liveEntryIdRef.current) {
        await updateEntryMut({ id: liveEntryIdRef.current, questions: qs, correctCount: cc, totalAttempted: ta });
      } else {
        const newId = await addEntryMut({
          studentId: selectedStudentId, date: today, exerciseId: scoringExercise._id, unitId: scoringExercise.unitId, moduleId: scoringExercise.moduleId, questions: qs, correctCount: cc, totalAttempted: ta,
          slotId: effectiveSlot?._id as Id<"scheduleSlots"> | undefined,
          centerId: slotCenter?._id as Id<"centers"> | undefined,
        });
        liveEntryIdRef.current = newId;
        setExistingEntryId(newId);
      }
      if (sessionKey && !draftPresentIds.has(selectedStudentId)) {
        setDraftAttendance(prev => ({ ...prev, [sessionKey]: [...(prev[sessionKey] || []), selectedStudentId!] }));
      }
      setInitialQuestionStates({ ...states });
    } finally {
      saveLockRef.current = false;
      if (pendingSaveRef.current) {
        const pending = pendingSaveRef.current;
        pendingSaveRef.current = null;
        liveSave(pending);
      }
    }
  };

  // Guarded question tap: checks blocking + absent, then toggles + live-saves
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
    if (questionStates[q] === 'skipped') return;
    const newVal = questionStates[q] === 'unmarked' ? 'correct' as const : questionStates[q] === 'correct' ? 'wrong' as const : 'unmarked' as const;
    const newStates = { ...questionStates, [q]: newVal };
    setQuestionStates(newStates);
    liveSave(newStates);
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
    setBlockingDialogOpen(false);
    // Reset scoring state for new session
    setScoringExercise(null); setSelectedStudentId(null); setSelectedUnitId('');
    setQuestionStates({}); setInitialQuestionStates({}); setExistingEntryId(null); liveEntryIdRef.current = null;
  };

  const handleAlertDotPress = () => {
    if (unsubmittedSessions.length > 0) {
      setHighlightUnsubmitted(true);
      setTimeout(() => setHighlightUnsubmitted(false), 2000);
      const first = unsubmittedSessions[0];
      setManualSlotId(first.slotId);
      setAttendanceDate(first.date);
      setSessionCalendarOpen(true);
    }
  };

  const handleLiveBadgePress = () => {
    setManualSlotId('');
    setAttendanceDate(today);
    // Reset scoring state for live session
    setScoringExercise(null); setSelectedStudentId(null); setSelectedUnitId('');
    setQuestionStates({}); setInitialQuestionStates({}); setExistingEntryId(null); liveEntryIdRef.current = null;
  };

  // Position dialog callbacks
  const handlePositionSelectExercise = (studentId: Id<"students">, exerciseId: string, unitId: string, moduleId: string) => {
    setPositionDialogOpen(false);
    setViewingOverride({ exerciseId, unitId, moduleId });
    setSelectedStudentId(studentId);
    setSelectedUnitId(unitId);
    const ex = allExercises?.find(e => e._id === exerciseId);
    if (ex) setupScoring(ex, unitId, moduleId);
  };

  const handlePositionSave = async (studentId: Id<"students">, moduleId: string, grade: number, term: number) => {
    await setModulePosMut({ studentId, moduleId, grade, term });
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

  const handleNextExercise = () => {
    if (!scoringExercise || !slotModule) return;
    const curOrder = scoringExercise.order;
    const nextEx = selectedUnitExercises.find(ex => {
      if (ex.order <= curOrder) return false;
      const en = allEntries?.find(e => e.studentId === selectedStudentId && e.exerciseId === ex._id);
      if (!en) return true;
      if (en.totalAttempted >= ex.questionCount) return false;
      const qs = en.questions as Record<string, string>;
      const addressed = Object.values(qs).filter(v => v === 'correct' || v === 'wrong' || v === 'skipped').length;
      if (addressed >= ex.questionCount) return false;
      if (hasProgressedPast(selectedStudentId!, selectedUnitId, ex.order)) return false;
      return true;
    });
    if (nextEx) setupScoring(nextEx, selectedUnitId, slotModule.id);
  };

  const handleFinishExercise = async () => {
    if (!selectedStudentId || !scoringExercise) return;
    // Capture context before anything changes
    const finishEntryId = liveEntryIdRef.current;
    const finishStudentId = selectedStudentId;
    const finishExercise = scoringExercise;

    const finalStates = { ...questionStates };
    for (let i = 1; i <= finishExercise.questionCount; i++) {
      if (finalStates[i] === 'unmarked') finalStates[i] = 'skipped';
    }
    setQuestionStates(finalStates);

    // Cancel any queued liveSave — our finish data supersedes it
    pendingSaveRef.current = null;

    // Direct save with captured entry ID (bypasses liveSave race condition)
    const qs: Record<string, string> = {};
    let cc = 0, ta = 0;
    for (const [k, v] of Object.entries(finalStates)) {
      if (v !== 'unmarked') { qs[k] = v; if (v === 'correct') cc++; if (v === 'correct' || v === 'wrong') ta++; }
    }
    try {
      if (finishEntryId) {
        await updateEntryMut({ id: finishEntryId, questions: qs, correctCount: cc, totalAttempted: ta });
      } else {
        const newId = await addEntryMut({
          studentId: finishStudentId, date: today, exerciseId: finishExercise._id,
          unitId: finishExercise.unitId, moduleId: finishExercise.moduleId,
          questions: qs, correctCount: cc, totalAttempted: ta,
          slotId: effectiveSlot?._id as Id<"scheduleSlots"> | undefined,
          centerId: slotCenter?._id as Id<"centers"> | undefined,
        });
        liveEntryIdRef.current = newId;
      }
      if (sessionKey && !draftPresentIds.has(finishStudentId)) {
        setDraftAttendance(prev => ({ ...prev, [sessionKey]: [...(prev[sessionKey] || []), finishStudentId] }));
      }
      setInitialQuestionStates({ ...finalStates });
    } catch (err) {
      console.error('Failed to save finished exercise:', err);
    }

    toast.success(`${(selectedStudent as { name: string })?.name}: ${finishExercise.name} finished!`);
    // Advance to next exercise
    if (slotModule) {
      const curOrder = finishExercise.order;
      const nextEx = selectedUnitExercises.find(ex => {
        if (ex.order <= curOrder) return false;
        const en = allEntries?.find(e => e.studentId === finishStudentId && e.exerciseId === ex._id);
        if (!en) return true;
        if (en.totalAttempted >= ex.questionCount) return false;
        const eqs = en.questions as Record<string, string>;
        const addressed = Object.values(eqs).filter(v => v === 'correct' || v === 'wrong' || v === 'skipped').length;
        if (addressed >= ex.questionCount) return false;
        if (hasProgressedPast(finishStudentId, selectedUnitId, ex.order)) return false;
        return true;
      });
      if (nextEx) setupScoring(nextEx, selectedUnitId, slotModule.id);
      else { setScoringExercise(null); setQuestionStates({}); setInitialQuestionStates({}); setExistingEntryId(null); liveEntryIdRef.current = null; }
    }
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
      {/* ═══ TOP BAR ═══ */}
      <div className="flex items-center justify-between mb-4">
        {/* Left: Session info — tap to open calendar */}
        {effectiveSlot ? (
          <button
            onClick={() => setSessionCalendarOpen(true)}
            className="flex items-center gap-2 active:scale-[0.97] transition-all min-w-0"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-bold text-foreground">{DAY_SHORT[effectiveSlot.dayOfWeek]} {fmt12s(effectiveSlot.startTime)}–{fmt12s(effectiveSlot.endTime)}</span>
                {slotModule && (
                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-md" style={{ backgroundColor: slotModule.color + '20', color: slotModule.color }}>{slotModule.id}</span>
                )}
              </div>
              <p className="text-[11px] text-muted-foreground text-left truncate">
                {slotRoom ? (slotRoom as { name: string }).name : ''}{slotCenter ? ` · ${(slotCenter as { name: string }).name}` : ''}
              </p>
            </div>
          </button>
        ) : (
          <button onClick={() => setSessionCalendarOpen(true)} className="flex items-center gap-2 active:scale-[0.97] transition-all">
            <div>
              <p className="text-sm font-bold text-foreground">{DAY_FULL[now.getDay()]}</p>
              <p className="text-[11px] text-muted-foreground">{now.getDate()} {MONTHS[now.getMonth()]} {now.getFullYear()}</p>
            </div>
          </button>
        )}

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

      {/* ═══ SCORING PAGE ═══ */}
      <div>
        {/* Attendance mode toggle */}
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
            {attendanceMode ? 'Mark Attendance' : 'Students'}
          </span>
          <button onClick={() => setAttendanceMode(!attendanceMode)}
            className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all active:scale-95 ${
              attendanceMode ? 'bg-blue-500/15 text-blue-600 dark:text-blue-400' : 'bg-muted text-muted-foreground'
            }`}>
            Attendance {attendanceMode ? 'ON' : 'OFF'}
          </button>
        </div>

        {/* Student badges — fixed 2-row min height for layout stability */}
        <div className="flex flex-wrap content-start gap-1.5 mb-4 min-h-[78px] p-1 -m-1">
          {attendanceMode ? (
            /* Attendance mode: blue/gray toggles */
            effectiveStudents && effectiveStudents.length > 0 ? (
              effectiveStudents.map((s: { _id: Id<"students">; name: string }) => {
                const isPresent = draftPresentIds.has(s._id) || dbPresentIds.has(s._id);
                return (
                  <button key={s._id} onClick={() => handleAttendanceToggle(s._id)}
                    className={`px-3 py-2 rounded-xl text-xs font-medium transition-all active:scale-95 h-[36px]
                      ${isPresent ? 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300 shadow-sm' : 'bg-muted text-muted-foreground'}`}>
                    {s.name.split(' ')[0]}
                  </button>
                );
              })
            ) : (
              <div className="flex items-center justify-center w-full h-full">
                <p className="text-xs text-muted-foreground/50">
                  {effectiveSlot ? 'No students in this slot' : 'Tap session info to select a slot'}
                </p>
              </div>
            )
          ) : (
            /* Scoring mode: color-coded status badges */
            scoringStudents.length > 0 ? (
              scoringStudents.map((s) => {
                const isSel = s._id === selectedStudentId;
                const colorMap = {
                  gray: 'bg-muted text-muted-foreground',
                  red: 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300',
                  yellow: 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300',
                  green: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300',
                };
                return (
                  <button key={s._id} onClick={() => handleStudentSelect(s._id)}
                    className={`px-3 py-2 rounded-xl text-xs font-medium transition-all active:scale-95 h-[36px]
                      ${colorMap[s.badgeColor]}
                      ${isSel ? 'ring-2 ring-primary ring-offset-1 ring-offset-background' : ''}`}>
                    {s.name.split(' ')[0]}
                  </button>
                );
              })
            ) : (
              <div className="flex items-center justify-center w-full h-full">
                <p className="text-xs text-muted-foreground/50">No students in this session</p>
              </div>
            )
          )}
        </div>

          {/* Selected student scoring UI */}
          {selectedStudentId && selectedStudent && (() => {
            const pos = studentPositions.get(selectedStudentId);
            // When viewing an override (from Position Dialog), show that module's units & badge
            const overrideInfo = viewingOverride ? findUnit(viewingOverride.unitId) : null;
            const displayPos = overrideInfo
              ? { moduleId: viewingOverride!.moduleId, grade: overrideInfo.grade, term: overrideInfo.term, unitId: viewingOverride!.unitId, exerciseId: viewingOverride!.exerciseId }
              : pos;
            const termUnits = overrideInfo
              ? (CURRICULUM_MODULES.find(m => m.id === viewingOverride!.moduleId)?.grades.find(g => g.grade === overrideInfo.grade)?.terms.find(t => t.term === overrideInfo.term)?.units || [])
              : getStudentTermUnits(selectedStudentId);
            const up = selectedUnitId ? getUnitProgress(selectedStudentId, selectedUnitId) : null;
            const dayCorrect = (todayEntries || []).filter(e => e.studentId === selectedStudentId).reduce((s, e) => s + e.correctCount, 0);
            return (
              <div>
                {displayPos && (
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex gap-1">
                      {termUnits.map(unit => {
                        const num = unit.name.match(/^(\d+)\./)?.[1] || unit.name.slice(0, 2);
                        return <button key={unit.id} onClick={() => { setSelectedUnitId(unit.id); autoSelectExerciseForUnit(unit.id, selectedStudentId!); }}
                          className={`w-8 h-8 rounded-lg text-xs font-bold transition-all active:scale-95 ${unit.id === selectedUnitId ? 'bg-primary text-primary-foreground shadow-sm' : 'bg-muted text-muted-foreground hover:text-foreground'}`}>{num}</button>;
                      })}
                    </div>
                    <div className="flex items-center gap-1">
                      {viewingOverride && (
                        <button onClick={() => { setViewingOverride(null); if (selectedStudentId) selectStudent(selectedStudentId); }}
                          className="w-7 h-7 rounded-lg bg-amber-500/15 flex items-center justify-center active:scale-90 transition-transform"
                          title="Reset to current position">
                          <RotateCcw className="w-3 h-3 text-amber-600 dark:text-amber-400" />
                        </button>
                      )}
                      <button onClick={() => { setPositionDialogStudentId(selectedStudentId); setPositionDialogModuleId(slotModule?.id ?? ''); setPositionDialogOpen(true); }}
                        className="px-2.5 py-1.5 rounded-lg bg-muted hover:bg-muted/80 text-[11px] font-mono font-semibold text-foreground transition-all active:scale-95">
                        {displayPos.moduleId} · G{displayPos.grade} · T{displayPos.term}
                      </button>
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
                      {dayCorrect > 0 && <span className="text-[10px] text-emerald-600 font-semibold ml-auto">{dayCorrect}✓ · {calculateDailyPoints(dayCorrect)} pts</span>}
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

                {/* Exercise selector boxes + page button */}
                {selectedUnitExercises.length > 0 && (
                  <div className="flex items-center gap-2 mb-3">
                    <div className="flex gap-1 overflow-x-auto pb-1 p-1 -m-1 flex-1 min-w-0">
                      {selectedUnitExercises.map(ex => {
                        const st = getExerciseStatus(selectedStudentId, ex._id, ex.questionCount, selectedUnitId, ex.order);
                        const isCurrent = scoringExercise && ex._id === scoringExercise._id;
                        const lbl = ex.name.includes('.') ? ex.name.split('.').pop() : String(ex.order);
                        return (
                          <button key={ex._id}
                            onClick={() => slotModule && handleExerciseTap(ex, selectedUnitId, slotModule.id)}
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
                    {scoringExercise?.pageNumber !== undefined && (() => {
                      const part = getBookPart(scoringExercise.unitId);
                      const pg = scoringExercise.pageNumberEnd ? `${scoringExercise.pageNumber}-${scoringExercise.pageNumberEnd}` : String(scoringExercise.pageNumber);
                      return (
                        <button
                          onClick={() => setPageDrawerOpen(true)}
                          className="shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-primary/10 text-primary text-[10px] font-semibold active:scale-95 transition-all"
                        >
                          <BookOpen className="w-3.5 h-3.5" />
                          {part ? `P${part} ` : ''}p.{pg}
                        </button>
                      );
                    })()}
                  </div>
                )}

                {scoringExercise ? (() => {
                  const unmarkedCount = Object.values(questionStates).filter(v => v === 'unmarked').length;
                  const markedCount = correctCount + wrongCount + skippedCount;
                  const progressPct = scoringExercise.questionCount > 0 ? ((markedCount / scoringExercise.questionCount) * 100) : 0;
                  return (
                    <div className="space-y-3">
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
                          const s: Record<number, 'correct' | 'wrong' | 'skipped' | 'unmarked'> = {};
                          for (let i = 1; i <= scoringExercise.questionCount; i++) s[i] = questionStates[i] === 'skipped' ? 'skipped' : 'correct';
                          setQuestionStates(s); liveSave(s);
                        }}
                          className="flex-1 flex items-center justify-center gap-1.5 h-9 rounded-xl text-[11px] font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 active:scale-95 transition-all">
                          <Sparkles className="w-3 h-3" />All ✓
                        </button>
                        <button onClick={() => {
                          if (oldestUnsubmitted) { setBlockingDialogOpen(true); return; }
                          if (selectedStudentId && !presentStudentIds.has(selectedStudentId)) {
                            setAbsentStudentDialog({ studentId: selectedStudentId, type: sessionLifecycle === 'live' ? 'live' : 'future' }); return;
                          }
                          const n = { ...questionStates }; for (let i = 1; i <= scoringExercise.questionCount; i++) { if (n[i] === 'unmarked') n[i] = 'correct'; }
                          setQuestionStates(n); liveSave(n);
                        }}
                          className="flex-1 flex items-center justify-center gap-1.5 h-9 rounded-xl text-[11px] font-semibold bg-muted text-muted-foreground hover:text-foreground active:scale-95 transition-all">
                          <SkipForward className="w-3 h-3" />Rest ✓
                        </button>
                        <button onClick={handleNextExercise}
                          className="flex-1 flex items-center justify-center gap-1.5 h-9 rounded-xl text-[11px] font-semibold bg-primary/10 text-primary active:scale-95 transition-all">
                          <ChevronRight className="w-3 h-3" />Next
                        </button>
                        <button onClick={handleFinishExercise}
                          className="flex-1 flex items-center justify-center gap-1.5 h-9 rounded-xl text-[11px] font-semibold bg-amber-500/10 text-amber-600 dark:text-amber-400 active:scale-95 transition-all">
                          <CheckCircle2 className="w-3 h-3" />Finish
                        </button>
                      </div>

                      {/* Spacer for sticky bar + nav */}
                      <div className="h-28" />
                    </div>
                  );
                })() : selectedUnitId && selectedUnitExercises.length === 0 ? (
                  <div className="text-center py-6 mb-3"><p className="text-xs text-muted-foreground">No exercises in this unit yet</p></div>
                ) : null}
                {/* Spacer for sticky bar + nav when no exercise selected */}
                {!scoringExercise && <div className="h-28" />}
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

      {/* ═══ STICKY BOTTOM BAR — above bottom nav ═══ */}
      <div className="fixed left-0 right-0 z-40 bg-card/95 backdrop-blur-xl border-t border-border/50 px-4 py-2" style={{ bottom: 'calc(4rem + env(safe-area-inset-bottom, 0px))' }}>
        <div className="flex gap-2 max-w-lg mx-auto">
          {selectedStudentId && (!finishedStudentIds.has(selectedStudentId) ? (
            <Button onClick={handleFinishSession}
              className="flex-1 h-12 text-sm font-bold rounded-xl bg-emerald-600 hover:bg-emerald-700">
              <CheckCircle2 className="w-4 h-4 mr-1.5" />End {(selectedStudent as { name: string })?.name?.split(' ')[0]}
            </Button>
          ) : (
            <div className="flex-1 h-12 rounded-xl bg-emerald-500/10 flex items-center justify-center">
              <span className="text-sm font-bold text-emerald-600 flex items-center gap-1.5"><CheckCircle2 className="w-4 h-4" />{(selectedStudent as { name: string })?.name?.split(' ')[0]} Done</span>
            </div>
          ))}
          {sessionLifecycle === 'submitted' ? (
            <div className="flex-1 h-12 rounded-xl bg-emerald-500/10 flex items-center justify-center">
              <span className="text-sm font-bold text-emerald-600 flex items-center gap-1.5"><CheckCircle2 className="w-4 h-4" />Submitted</span>
            </div>
          ) : (
            <button
              onClick={() => { if (sessionLifecycle === 'ended') handleSubmitPress(); }}
              className={`flex-1 h-12 text-sm font-bold rounded-xl transition-all flex items-center justify-center gap-1.5 ${
                sessionLifecycle === 'ended'
                  ? 'bg-red-600 hover:bg-red-700 text-white active:scale-95'
                  : sessionLifecycle === 'live'
                    ? 'bg-blue-500/15 text-blue-500/50'
                    : 'bg-muted/50 text-muted-foreground/50'
              }`}
            >
              <Send className="w-3.5 h-3.5" />Submit
            </button>
          )}
        </div>
      </div>

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

      {/* Position Dialog (full-page) */}
      {positionDialogStudentId && (
        <PositionDialog
          open={positionDialogOpen}
          onOpenChange={setPositionDialogOpen}
          students={scoringStudents}
          allEntries={allEntries ?? []}
          allExercises={allExercises ?? []}
          modulePositions={modulePositions ?? []}
          initialStudentId={positionDialogStudentId}
          initialModuleId={positionDialogModuleId || slotModule?.id || 'M1'}
          onSelectExercise={handlePositionSelectExercise}
          onSavePosition={handlePositionSave}
        />
      )}

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
            <Button onClick={() => setUnfinishedAlertStudents([])}>OK</Button>
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

      {/* ═══ SESSION CALENDAR DIALOG ═══ */}
      <Dialog open={sessionCalendarOpen} onOpenChange={setSessionCalendarOpen}>
        <DialogContent className="max-w-sm mx-auto max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Sessions</DialogTitle><DialogDescription>Select a session slot</DialogDescription></DialogHeader>
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
                        const rm = rooms?.find((r: { _id: string }) => r._id === slot.roomId);
                        const rmTt = (rm as { moduleTimetable?: Record<string, string> } | undefined)?.moduleTimetable;
                        const slotMod = rmTt?.[String(slot.dayOfWeek)] ? getModuleById(rmTt[String(slot.dayOfWeek)]) : null;
                        const sub = submittedSessions?.find((s: { slotId: string; date: string }) => s.slotId === slot._id && s.date === weekDates[dow - 1]);
                        const pCnt = sub ? (sub as { presentCount: number }).presentCount : isActive ? presentStudentIds.size : null;
                        const tCnt = sub ? (sub as { presentCount: number; absentCount: number }).presentCount + (sub as { absentCount: number }).absentCount : isActive && effectiveStudents ? effectiveStudents.length : null;
                        return (
                          <button key={slot._id}
                            onClick={() => {
                              setManualSlotId(slot._id); setAttendanceDate(weekDates[dow - 1]); setSessionCalendarOpen(false);
                              // Persist last manual pick as fallback for future loads
                              setLastPickedSlotId(slot._id); setLastPickedDate(weekDates[dow - 1]);
                              // Reset scoring state for new session
                              setScoringExercise(null); setSelectedStudentId(null); setSelectedUnitId('');
                              setQuestionStates({}); setInitialQuestionStates({}); setExistingEntryId(null); liveEntryIdRef.current = null;
                            }}
                            className={`w-full rounded-xl px-2 py-2 text-[10px] text-left transition-all active:scale-95
                              ${isActive ? 'ring-2 ring-primary ring-offset-1 ring-offset-background' : ''}
                              ${shouldHighlight ? 'ring-2 ring-red-500 ring-offset-1 animate-pulse' : ''}
                              ${lifecycle === 'submitted' ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                                : lifecycle === 'live' ? 'bg-blue-500/15 text-blue-700 dark:text-blue-300'
                                : lifecycle === 'ended' ? 'bg-red-500/10 text-red-700 dark:text-red-300'
                                : 'bg-card text-muted-foreground hover:bg-card/80'}`}>
                            {/* Time + Module badge */}
                            <div className="flex items-center justify-between gap-0.5">
                              <div className="flex items-center gap-1 min-w-0">
                                {lifecycle === 'live' && <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse shrink-0" />}
                                {lifecycle === 'submitted' && <CheckCircle2 className="w-2.5 h-2.5 text-emerald-500 shrink-0" />}
                                <p className="font-bold leading-tight truncate">{fmt12s(slot.startTime)}–{fmt12s(slot.endTime)}</p>
                              </div>
                              {slotMod && <span className="text-[8px] font-bold px-1 py-0.5 rounded shrink-0" style={{ backgroundColor: slotMod.color + '25', color: slotMod.color }}>{slotMod.id}</span>}
                            </div>
                            {/* Room + Count */}
                            <div className="flex items-center justify-between mt-0.5">
                              <p className="opacity-60 leading-tight truncate">{(rm as { name: string } | undefined)?.name || 'Room'}</p>
                              {pCnt !== null && tCnt !== null && tCnt > 0 && (
                                <span className="text-[9px] font-bold opacity-70 shrink-0">{pCnt}/{tCnt}</span>
                              )}
                            </div>
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
        </DialogContent>
      </Dialog>

      {/* Page Viewer Drawer */}
      <Drawer direction="right" open={pageDrawerOpen} onOpenChange={setPageDrawerOpen}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle className="text-sm truncate">
              {scoringExercise?.name}
              {scoringExercise?.pageNumber !== undefined && (
                <span className="text-muted-foreground font-normal">
                  {' '}(p.{scoringExercise.pageNumberEnd ? `${scoringExercise.pageNumber}–${scoringExercise.pageNumberEnd}` : scoringExercise.pageNumber})
                </span>
              )}
            </DrawerTitle>
          </DrawerHeader>

          {!scoringExercise?.pageNumber ? (
            <div className="flex-1 flex items-center justify-center px-4">
              <p className="text-sm text-muted-foreground text-center">No page number set for this exercise.</p>
            </div>
          ) : !pageDrawerPages ? (
            <div className="flex-1 overflow-y-auto px-4 pb-4 no-scrollbar space-y-3">
              {[1, 2, 3].map(i => (
                <div key={i} className="w-full aspect-[3/4] bg-muted rounded-lg animate-pulse" />
              ))}
            </div>
          ) : (
            <PinchZoomArea className="flex-1 overflow-y-auto px-4 pb-4 no-scrollbar">
              <div className="space-y-3">
                {pageDrawerPages.map(pg => (
                  <div key={pg.pageNumber} className="relative">
                    <div className="absolute top-2 left-2 z-10 bg-background/80 backdrop-blur-sm rounded-md px-2 py-0.5 text-xs font-mono border border-border/50">
                      p.{pg.pageNumber}
                    </div>
                    {pg.url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={pg.url}
                        alt={`Page ${pg.pageNumber}`}
                        className="w-full rounded-lg border border-border"
                      />
                    ) : (
                      <div className="w-full aspect-[3/4] bg-muted rounded-lg flex flex-col items-center justify-center gap-2">
                        <ImageIcon className="w-10 h-10 text-muted-foreground/30" />
                        <p className="text-sm text-muted-foreground">Page {pg.pageNumber} not captured</p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </PinchZoomArea>
          )}
        </DrawerContent>
      </Drawer>

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
                            {!isConcept && item.pageNumber && (() => {
                              const part = getBookPart(item.unitId);
                              const pg = item.pageNumberEnd ? `${item.pageNumber}-${item.pageNumberEnd}` : String(item.pageNumber);
                              return <span className="text-muted-foreground ml-auto">{part ? `P${part} ` : ''}p.{pg}</span>;
                            })()}
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
