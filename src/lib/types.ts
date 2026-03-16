export interface Student {
  id: string;
  name: string;
  schoolGrade: number; // 6-11
  group: string;
  parentPhone: string;
  schoolName: string;
}

export interface Group {
  id: string;
  name: string;
}

export interface CurriculumModule {
  id: string; // M1, M2, etc.
  name: string;
  tamilName: string;
  day: string;
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
  tuitionName: string;
}

export const MODULE_COLORS: Record<string, string> = {
  M1: '#1B4F72',
  M2: '#6C3483',
  M3: '#1E8449',
  M4: '#B9770E',
  M5: '#C0392B',
  M6: '#2E86C1',
};

export const MODULE_DAYS: Record<string, string> = {
  M1: 'Monday',
  M2: 'Tuesday',
  M3: 'Wednesday',
  M4: 'Thursday',
  M5: 'Friday',
  M6: 'Saturday',
};

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
