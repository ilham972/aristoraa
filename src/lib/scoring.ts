// Calculate daily points for a student
// The Nth correct answer in a day earns N * 5 points
// Daily total = 5 * C * (C+1) / 2 where C = total correct answers in the day
export function calculateDailyPoints(correctCount: number): number {
  return 5 * correctCount * (correctCount + 1) / 2;
}

// Get total correct answers from a set of entries (already filtered by student+date)
export function getTotalCorrectForDay(
  dayEntries: Array<{ _id: string; correctCount: number }>,
  excludeEntryId?: string
): number {
  let total = 0;
  for (const entry of dayEntries) {
    if (excludeEntryId && entry._id === excludeEntryId) continue;
    total += entry.correctCount;
  }
  return total;
}

// Calculate points earned from a specific entry, considering cumulative daily scoring
// priorCorrect = number of correct answers before this entry today
// entryCorrect = number of correct answers in this entry
// Points = sum of ((priorCorrect + i) * 5) for i = 1 to entryCorrect
export function calculateEntryPoints(priorCorrect: number, entryCorrect: number): number {
  let points = 0;
  for (let i = 1; i <= entryCorrect; i++) {
    points += (priorCorrect + i) * 5;
  }
  return points;
}

// Get the daily score from a set of entries (already filtered by student+date)
export function getDailyScore(
  dayEntries: Array<{ correctCount: number }>
): { totalCorrect: number; totalPoints: number } {
  let totalCorrect = 0;
  for (const entry of dayEntries) {
    totalCorrect += entry.correctCount;
  }
  return {
    totalCorrect,
    totalPoints: calculateDailyPoints(totalCorrect),
  };
}

// Get weekly scores (Mon-Sat of the given week)
export function getWeekDates(referenceDate: string): string[] {
  const d = new Date(referenceDate + 'T00:00:00');
  const day = d.getDay(); // 0=Sun, 1=Mon, ...
  // Find Monday of this week
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const monday = new Date(d);
  monday.setDate(d.getDate() + mondayOffset);

  const dates: string[] = [];
  for (let i = 0; i < 6; i++) { // Mon to Sat
    const date = new Date(monday);
    date.setDate(monday.getDate() + i);
    dates.push(formatDate(date));
  }
  return dates;
}

// Get month dates
export function getMonthDates(year: number, month: number): string[] {
  const dates: string[] = [];
  const daysInMonth = new Date(year, month, 0).getDate();
  for (let d = 1; d <= daysInMonth; d++) {
    dates.push(`${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
  }
  return dates;
}

export function formatDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Get leaderboard data for a date/period and grade
export interface LeaderboardEntry {
  studentId: string;
  studentName: string;
  totalCorrect: number;
  totalPoints: number;
  dailyBreakdown?: Record<string, number>; // date -> points
}

export function getLeaderboard(
  entries: Array<{ studentId: string; date: string; correctCount: number }>,
  students: Array<{ _id: string; name: string; schoolGrade: number }>,
  dates: string[],
  gradeFilter?: number,
): LeaderboardEntry[] {
  const filteredStudents = gradeFilter
    ? students.filter(s => s.schoolGrade === gradeFilter)
    : students;

  const dateSet = new Set(dates);
  const relevantEntries = entries.filter(e => dateSet.has(e.date));

  const leaderboard: LeaderboardEntry[] = filteredStudents.map(student => {
    const studentEntries = relevantEntries.filter(e => e.studentId === student._id);
    const dailyBreakdown: Record<string, number> = {};
    let totalCorrect = 0;

    // Group by date
    const byDate: Record<string, typeof studentEntries> = {};
    for (const entry of studentEntries) {
      if (!byDate[entry.date]) byDate[entry.date] = [];
      byDate[entry.date].push(entry);
    }

    for (const date of dates) {
      const dayEntries = byDate[date] || [];
      let dayCorrect = 0;
      for (const e of dayEntries) {
        dayCorrect += e.correctCount;
      }
      dailyBreakdown[date] = calculateDailyPoints(dayCorrect);
      totalCorrect += dayCorrect;
    }

    const totalPoints = Object.values(dailyBreakdown).reduce((a, b) => a + b, 0);

    return {
      studentId: student._id,
      studentName: student.name,
      totalCorrect,
      totalPoints,
      dailyBreakdown,
    };
  });

  return leaderboard
    .filter(e => e.totalPoints > 0 || e.totalCorrect > 0)
    .sort((a, b) => b.totalPoints - a.totalPoints);
}

export interface PositionOptions {
  positionOverride?: { grade: number; term: number };
  defaultGrade?: number; // student's school grade — used when no entries exist
}

// Should this unit be skipped based on position options?
function shouldSkipUnit(
  unit: { grade: number; term: number },
  startGrade: number,
  startTerm: number,
): boolean {
  if (unit.grade < startGrade) return true;
  if (unit.grade === startGrade && unit.term < startTerm) return true;
  return false;
}

// Check if an exercise entry is "done" — all questions addressed (correct, wrong, or skipped)
function isEntryComplete(entry: { totalAttempted: number; questions?: Record<string, string> }, qCount: number): boolean {
  if (entry.totalAttempted >= qCount) return true;
  if (entry.questions) {
    const addressed = Object.values(entry.questions).filter(v => v === 'correct' || v === 'wrong' || v === 'skipped').length;
    if (addressed >= qCount) return true;
  }
  return false;
}

// Determine the starting grade/term for scanning
function getStartPosition(
  hasEntries: boolean,
  options?: PositionOptions,
): { grade: number; term: number } {
  if (options?.positionOverride) {
    return options.positionOverride;
  }
  if (!hasEntries && options?.defaultGrade) {
    return { grade: options.defaultGrade, term: 1 };
  }
  return { grade: 6, term: 1 }; // absolute minimum
}

// Get student's next N upcoming exercises in a module (skips concepts — theory items)
export function getStudentUpcomingExercises(
  studentId: string,
  moduleId: string,
  allEntries: Array<{ studentId: string; moduleId: string; exerciseId: string; correctCount: number; totalAttempted: number; questions?: Record<string, string> }>,
  allExercises: Array<{ _id: string; unitId: string; name: string; questionCount: number; order: number; type?: string }>,
  orderedUnits: Array<{ id: string; name: string; grade: number; term: number }>,
  count: number = 5,
  options?: PositionOptions,
): Array<{ exerciseId: string; unitId: string; name: string }> {
  const studentModuleEntries = allEntries.filter(
    e => e.studentId === studentId && e.moduleId === moduleId
  );
  const start = getStartPosition(studentModuleEntries.length > 0, options);
  const results: Array<{ exerciseId: string; unitId: string; name: string }> = [];
  for (const unit of orderedUnits) {
    if (shouldSkipUnit(unit, start.grade, start.term)) continue;
    const unitExercises = allExercises
      .filter(ex => ex.unitId === unit.id && (ex.type || 'exercise') === 'exercise')
      .sort((a, b) => a.order - b.order);
    for (const exercise of unitExercises) {
      const entry = studentModuleEntries.find(e => e.exerciseId === exercise._id);
      if (!entry || !isEntryComplete(entry, exercise.questionCount)) {
        // Implicit completion: skip if student has entries for later exercises
        const hasLater = !entry ? false : unitExercises.some(ex =>
          ex.order > exercise.order &&
          studentModuleEntries.some(e => e.exerciseId === ex._id && e.totalAttempted > 0)
        );
        if (!hasLater) {
          results.push({ exerciseId: exercise._id, unitId: unit.id, name: exercise.name });
          if (results.length >= count) return results;
        }
      }
    }
  }
  return results;
}

// Get student's next N upcoming items (exercises + concepts) for snapshot display
// Shows the full sequence so teacher can see which theory to teach next
export function getStudentUpcomingItems(
  studentId: string,
  moduleId: string,
  allEntries: Array<{ studentId: string; moduleId: string; exerciseId: string; correctCount: number; totalAttempted: number; questions?: Record<string, string> }>,
  allExercises: Array<{ _id: string; unitId: string; name: string; questionCount: number; order: number; type?: string }>,
  orderedUnits: Array<{ id: string; name: string; grade: number; term: number }>,
  count: number = 5,
  options?: PositionOptions,
): Array<{ id: string; unitId: string; name: string; type: string }> {
  const studentModuleEntries = allEntries.filter(
    e => e.studentId === studentId && e.moduleId === moduleId
  );
  const start = getStartPosition(studentModuleEntries.length > 0, options);
  const results: Array<{ id: string; unitId: string; name: string; type: string }> = [];

  for (const unit of orderedUnits) {
    if (shouldSkipUnit(unit, start.grade, start.term)) continue;
    const unitItems = allExercises
      .filter(ex => ex.unitId === unit.id)
      .sort((a, b) => a.order - b.order);

    // Find the first incomplete exercise in this unit
    let firstIncompleteIdx = -1;
    for (let i = 0; i < unitItems.length; i++) {
      const item = unitItems[i];
      if ((item.type || 'exercise') === 'concept') continue;
      const entry = studentModuleEntries.find(e => e.exerciseId === item._id);
      if (!entry || !isEntryComplete(entry, item.questionCount)) {
        // Implicit completion: skip if student has entries for later exercises
        const exerciseItems = unitItems.filter(x => (x.type || 'exercise') === 'exercise');
        const hasLater = !entry ? false : exerciseItems.some(ex =>
          ex.order > item.order &&
          studentModuleEntries.some(e => e.exerciseId === ex._id && e.totalAttempted > 0)
        );
        if (!hasLater) {
          firstIncompleteIdx = i;
          break;
        }
      }
    }

    if (firstIncompleteIdx === -1 && results.length === 0) continue;

    let startIdx = firstIncompleteIdx >= 0 ? firstIncompleteIdx : 0;
    if (results.length === 0 && firstIncompleteIdx >= 0) {
      while (startIdx > 0 && unitItems[startIdx - 1].type === 'concept') {
        startIdx--;
      }
    }

    const fromIdx = results.length === 0 ? startIdx : 0;
    for (let i = fromIdx; i < unitItems.length; i++) {
      const item = unitItems[i];
      const isExercise = (item.type || 'exercise') === 'exercise';
      if (isExercise) {
        const entry = studentModuleEntries.find(e => e.exerciseId === item._id);
        if (entry && isEntryComplete(entry, item.questionCount)) continue;
        // Implicit completion: skip if student has entries for later exercises
        if (entry) {
          const exerciseItems = unitItems.filter(x => (x.type || 'exercise') === 'exercise');
          const hasLater = exerciseItems.some(ex =>
            ex.order > item.order &&
            studentModuleEntries.some(e => e.exerciseId === ex._id && e.totalAttempted > 0)
          );
          if (hasLater) continue;
        }
      }
      results.push({ id: item._id, unitId: unit.id, name: item.name, type: item.type || 'exercise' });
      if (results.length >= count) return results;
    }
  }
  return results;
}

// Get student's next exercise in a module (skips concepts — theory items)
export function getStudentNextExercise(
  studentId: string,
  moduleId: string,
  allEntries: Array<{ studentId: string; moduleId: string; exerciseId: string; correctCount: number; totalAttempted: number; questions?: Record<string, string> }>,
  allExercises: Array<{ _id: string; unitId: string; questionCount: number; order: number; type?: string }>,
  orderedUnits: Array<{ id: string; name: string; grade: number; term: number }>,
  options?: PositionOptions,
): { exerciseId: string; unitId: string } | null {
  const studentModuleEntries = allEntries.filter(
    e => e.studentId === studentId && e.moduleId === moduleId
  );
  const start = getStartPosition(studentModuleEntries.length > 0, options);

  for (const unit of orderedUnits) {
    if (shouldSkipUnit(unit, start.grade, start.term)) continue;
    const unitExercises = allExercises
      .filter(ex => ex.unitId === unit.id && (ex.type || 'exercise') === 'exercise')
      .sort((a, b) => a.order - b.order);

    for (const exercise of unitExercises) {
      const entry = studentModuleEntries.find(e => e.exerciseId === exercise._id);
      if (!entry) {
        return { exerciseId: exercise._id, unitId: unit.id };
      }
      if (!isEntryComplete(entry, exercise.questionCount)) {
        // Implicit completion: if student has entries for later exercises, skip this one
        const hasLater = unitExercises.some(ex =>
          ex.order > exercise.order &&
          studentModuleEntries.some(e => e.exerciseId === ex._id && e.totalAttempted > 0)
        );
        if (!hasLater) return { exerciseId: exercise._id, unitId: unit.id };
      }
    }
  }

  return null;
}

// ─── Shared helpers for exercise progress (used by score-entry page & position dialog) ───

type EntryLike = { studentId: string; exerciseId: string; correctCount: number; totalAttempted: number; questions?: Record<string, string> | unknown };
type ExerciseLike = { _id: string; unitId: string; name: string; questionCount: number; order: number; type?: string };

export function hasProgressedPast(
  sid: string, unitId: string, exOrder: number,
  allEntries: EntryLike[], allExercises: ExerciseLike[],
): boolean {
  return allExercises.some(ex =>
    ex.unitId === unitId && (ex.type || 'exercise') === 'exercise' && ex.order > exOrder &&
    allEntries.some(e => e.studentId === sid && e.exerciseId === ex._id && e.totalAttempted > 0)
  );
}

export function getExerciseStatus(
  sid: string, exId: string, qCount: number, unitId: string, exOrder: number,
  allEntries: EntryLike[], allExercises: ExerciseLike[],
): 'perfect' | 'skipped' | 'wip' | 'none' {
  const entry = allEntries.find(e => e.studentId === sid && e.exerciseId === exId);
  if (!entry) return 'none';
  if (entry.totalAttempted >= qCount) return 'perfect';
  const qs = (entry.questions ?? {}) as Record<string, string>;
  const addressed = Object.values(qs).filter(v => v === 'correct' || v === 'wrong' || v === 'skipped').length;
  if (addressed >= qCount) return 'skipped';
  if (hasProgressedPast(sid, unitId, exOrder, allEntries, allExercises)) return 'skipped';
  return 'wip';
}

export type ExerciseBreakdown = { exId: string; qCount: number; correct: number; wrong: number; skipped: number; unanswered: number };

export function getUnitProgressData(
  sid: string, unitId: string,
  allEntries: EntryLike[], allExercises: ExerciseLike[],
): { total: number; correctQ: number; wrongQ: number; skippedQ: number; totalQ: number; exercises: ExerciseBreakdown[] } {
  const exs = allExercises.filter(e => e.unitId === unitId && (e.type || 'exercise') === 'exercise').sort((a, b) => a.order - b.order);
  let correctQ = 0, wrongQ = 0, skippedQ = 0, totalQ = 0;
  const exercises: ExerciseBreakdown[] = [];
  for (const ex of exs) {
    totalQ += ex.questionCount;
    const en = allEntries.find(e => e.studentId === sid && e.exerciseId === ex._id);
    let c = 0, w = 0, sk = 0;
    if (en) {
      c = en.correctCount;
      const qs = (en.questions ?? {}) as Record<string, string>;
      sk = Object.values(qs).filter(v => v === 'skipped').length;
      w = en.totalAttempted - en.correctCount - sk;
      if (w < 0) w = 0;
    }
    correctQ += c; wrongQ += w; skippedQ += sk;
    exercises.push({ exId: ex._id, qCount: ex.questionCount, correct: c, wrong: w, skipped: sk, unanswered: ex.questionCount - c - w - sk });
  }
  return { total: exs.length, correctQ, wrongQ, skippedQ, totalQ, exercises };
}

/** Get detailed exercise info for a unit: status, percentage, wrong count */
export function getExerciseDetails(
  sid: string, unitId: string,
  allEntries: EntryLike[], allExercises: ExerciseLike[],
): Array<{
  exerciseId: string; order: number; name: string; questionCount: number;
  status: 'perfect' | 'skipped' | 'wip' | 'none';
  percentage: number; hasWrong: boolean;
}> {
  const exs = allExercises.filter(e => e.unitId === unitId && (e.type || 'exercise') === 'exercise').sort((a, b) => a.order - b.order);
  return exs.map(ex => {
    const entry = allEntries.find(e => e.studentId === sid && e.exerciseId === ex._id);
    const correct = entry?.correctCount ?? 0;
    const percentage = ex.questionCount > 0 ? Math.round((correct / ex.questionCount) * 100) : 0;
    const qs = ((entry?.questions ?? {}) as Record<string, string>);
    const skippedQ = Object.values(qs).filter(v => v === 'skipped').length;
    const wrong = entry ? entry.totalAttempted - entry.correctCount - skippedQ : 0;
    const status = getExerciseStatus(sid, ex._id, ex.questionCount, unitId, ex.order, allEntries, allExercises);
    return { exerciseId: ex._id, order: ex.order, name: ex.name, questionCount: ex.questionCount, status, percentage, hasWrong: wrong > 0 };
  });
}
