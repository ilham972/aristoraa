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
  group: string;
  totalCorrect: number;
  totalPoints: number;
  dailyBreakdown?: Record<string, number>; // date -> points
}

export function getLeaderboard(
  entries: Array<{ studentId: string; date: string; correctCount: number }>,
  students: Array<{ _id: string; name: string; group: string; schoolGrade: number }>,
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
      group: student.group,
      totalCorrect,
      totalPoints,
      dailyBreakdown,
    };
  });

  return leaderboard
    .filter(e => e.totalPoints > 0 || e.totalCorrect > 0)
    .sort((a, b) => b.totalPoints - a.totalPoints);
}

// Get student's next exercise in a module
export function getStudentNextExercise(
  studentId: string,
  moduleId: string,
  allEntries: Array<{ studentId: string; moduleId: string; exerciseId: string; correctCount: number }>,
  allExercises: Array<{ _id: string; unitId: string; questionCount: number; order: number }>,
  orderedUnits: Array<{ id: string; name: string; grade: number; term: number }>,
): { exerciseId: string; unitId: string } | null {
  // Get all entries for this student in this module
  const studentModuleEntries = allEntries.filter(
    e => e.studentId === studentId && e.moduleId === moduleId
  );

  // For each unit in order, find the first incomplete exercise
  for (const unit of orderedUnits) {
    const unitExercises = allExercises
      .filter(ex => ex.unitId === unit.id)
      .sort((a, b) => a.order - b.order);

    for (const exercise of unitExercises) {
      // Check if this exercise has been completed
      const entry = studentModuleEntries.find(e => e.exerciseId === exercise._id);
      if (!entry) {
        return { exerciseId: exercise._id, unitId: unit.id };
      }
      // If entry exists but not all questions answered correctly, it's still the current exercise
      if (entry.correctCount < exercise.questionCount) {
        return { exerciseId: exercise._id, unitId: unit.id };
      }
    }
  }

  return null; // All exercises completed
}
