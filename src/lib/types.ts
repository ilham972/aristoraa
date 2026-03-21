export interface Student {
  id: string;
  name: string;
  schoolGrade: number; // 6-11
  parentPhone: string;
  schoolName: string;
}

export interface CurriculumModule {
  id: string; // M1, M2, etc.
  name: string;
  tamilName: string;
  /** @deprecated Use scheduleSlot.moduleId instead. Kept as default reference. */
  day: string;
  /** @deprecated Use scheduleSlot.moduleId instead. Kept as default reference. */
  dayIndex: number; // 1=Mon, 2=Tue, ... 6=Sat, 0=Sun
  color: string;
  grades: CurriculumGrade[];
}

export interface CurriculumGrade {
  grade: number; // 6-11
  terms: CurriculumTerm[];
}

export interface CurriculumTerm {
  term: number; // 1, 2, 3
  units: CurriculumUnit[];
}

export interface CurriculumUnit {
  id: string; // e.g., M1-G6-T1-0
  name: string; // Tamil name
}

export interface Exercise {
  id: string;
  unitId: string;
  name: string;
  questionCount: number;
  order: number;
}

export interface ScoreEntry {
  id: string;
  studentId: string;
  date: string; // YYYY-MM-DD
  exerciseId: string;
  unitId: string;
  moduleId: string;
  questions: Record<string, 'correct' | 'wrong'>;
  correctCount: number;
  totalAttempted: number;
}

export interface AppSettings {
  allowManualSlotSelection: boolean;
}

export interface Center {
  id: string;
  name: string;
  city: string;
  district: string;
  road: string;
}

export interface Room {
  id: string;
  centerId: string;
  name: string;
}

export interface ScheduleSlot {
  id: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  roomId: string;
  moduleId?: string;
}

export interface SlotStudent {
  id: string;
  slotId: string;
  studentId: string;
}

export interface SlotOverride {
  id: string;
  slotId: string;
  studentId: string;
  date: string;
  action: string;
}

export interface Teacher {
  id: string;
  clerkUserId: string;
  name: string;
  role: string;
}

export interface SlotTeacher {
  id: string;
  slotId: string;
  teacherId: string;
}

export interface AttendanceRecord {
  id: string;
  studentId: string;
  slotId: string;
  date: string;
  status: string;
}

// Time helpers
export function parseTimeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

export function formatMinutesToTime(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function isCurrentTimeInRange(start: string, end: string): boolean {
  const now = new Date();
  const nowMins = now.getHours() * 60 + now.getMinutes();
  return nowMins >= parseTimeToMinutes(start) && nowMins < parseTimeToMinutes(end);
}

export function getMinutesRemaining(endTime: string): number {
  const now = new Date();
  const nowMins = now.getHours() * 60 + now.getMinutes();
  return parseTimeToMinutes(endTime) - nowMins;
}

export const MODULE_COLORS: Record<string, string> = {
  M1: '#1B4F72',
  M2: '#6C3483',
  M3: '#1E8449',
  M4: '#B9770E',
  M5: '#C0392B',
  M6: '#2E86C1',
};

/** @deprecated Use scheduleSlot.moduleId for slot-level module. Kept as legacy default mapping. */
export const MODULE_DAYS: Record<string, string> = {
  M1: 'Monday',
  M2: 'Tuesday',
  M3: 'Wednesday',
  M4: 'Thursday',
  M5: 'Friday',
  M6: 'Saturday',
};

/** @deprecated Use scheduleSlot.moduleId for slot-level module. Kept as fallback. */
export function getTodayModule(): string | null {
  const day = new Date().getDay(); // 0=Sun, 1=Mon, etc.
  const dayToModule: Record<number, string> = {
    1: 'M1', 2: 'M2', 3: 'M3', 4: 'M4', 5: 'M5', 6: 'M6',
  };
  return dayToModule[day] || null;
}

export function getTodayDateStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function getDayName(): string {
  return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][new Date().getDay()];
}
