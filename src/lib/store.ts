import { Student, Group, Exercise, ScoreEntry, AppSettings } from './types';

const KEYS = {
  students: 'mt_students',
  groups: 'mt_groups',
  exercises: 'mt_exercises',
  entries: 'mt_entries',
  settings: 'mt_settings',
};

function getItem<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function setItem<T>(key: string, value: T): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(key, JSON.stringify(value));
}

// Students
export function getStudents(): Student[] {
  return getItem<Student[]>(KEYS.students, []);
}

export function saveStudents(students: Student[]): void {
  setItem(KEYS.students, students);
}

export function addStudent(student: Student): void {
  const students = getStudents();
  students.push(student);
  saveStudents(students);
}

export function updateStudent(student: Student): void {
  const students = getStudents();
  const idx = students.findIndex(s => s.id === student.id);
  if (idx !== -1) {
    students[idx] = student;
    saveStudents(students);
  }
}

export function deleteStudent(id: string): void {
  saveStudents(getStudents().filter(s => s.id !== id));
  // Also delete entries
  saveEntries(getEntries().filter(e => e.studentId !== id));
}

// Groups
export function getGroups(): Group[] {
  return getItem<Group[]>(KEYS.groups, []);
}

export function saveGroups(groups: Group[]): void {
  setItem(KEYS.groups, groups);
}

// Exercises
export function getExercises(): Exercise[] {
  return getItem<Exercise[]>(KEYS.exercises, []);
}

export function saveExercises(exercises: Exercise[]): void {
  setItem(KEYS.exercises, exercises);
}

export function getExercisesForUnit(unitId: string): Exercise[] {
  return getExercises()
    .filter(e => e.unitId === unitId)
    .sort((a, b) => a.order - b.order);
}

export function addExercise(exercise: Exercise): void {
  const exercises = getExercises();
  exercises.push(exercise);
  saveExercises(exercises);
}

export function updateExercise(exercise: Exercise): void {
  const exercises = getExercises();
  const idx = exercises.findIndex(e => e.id === exercise.id);
  if (idx !== -1) {
    exercises[idx] = exercise;
    saveExercises(exercises);
  }
}

export function deleteExercise(id: string): void {
  saveExercises(getExercises().filter(e => e.id !== id));
  // Also delete related entries
  saveEntries(getEntries().filter(e => e.exerciseId !== id));
}

export function getExerciseById(id: string): Exercise | undefined {
  return getExercises().find(e => e.id === id);
}

// Score Entries
export function getEntries(): ScoreEntry[] {
  return getItem<ScoreEntry[]>(KEYS.entries, []);
}

export function saveEntries(entries: ScoreEntry[]): void {
  setItem(KEYS.entries, entries);
}

export function addEntry(entry: ScoreEntry): void {
  const entries = getEntries();
  entries.push(entry);
  saveEntries(entries);
}

export function updateEntry(entry: ScoreEntry): void {
  const entries = getEntries();
  const idx = entries.findIndex(e => e.id === entry.id);
  if (idx !== -1) {
    entries[idx] = entry;
    saveEntries(entries);
  }
}

export function deleteEntry(id: string): void {
  saveEntries(getEntries().filter(e => e.id !== id));
}

export function getEntriesForStudent(studentId: string): ScoreEntry[] {
  return getEntries().filter(e => e.studentId === studentId);
}

export function getEntriesForDate(date: string): ScoreEntry[] {
  return getEntries().filter(e => e.date === date);
}

export function getEntriesForStudentOnDate(studentId: string, date: string): ScoreEntry[] {
  return getEntries().filter(e => e.studentId === studentId && e.date === date);
}

// Settings
export function getSettings(): AppSettings {
  return getItem<AppSettings>(KEYS.settings, { tuitionName: 'Math Tuition Center' });
}

export function saveSettings(settings: AppSettings): void {
  setItem(KEYS.settings, settings);
}

// Export / Import
export function exportAllData(): string {
  return JSON.stringify({
    students: getStudents(),
    groups: getGroups(),
    exercises: getExercises(),
    entries: getEntries(),
    settings: getSettings(),
  }, null, 2);
}

export function importAllData(json: string): void {
  const data = JSON.parse(json);
  if (data.students) saveStudents(data.students);
  if (data.groups) saveGroups(data.groups);
  if (data.exercises) saveExercises(data.exercises);
  if (data.entries) saveEntries(data.entries);
  if (data.settings) saveSettings(data.settings);
}
