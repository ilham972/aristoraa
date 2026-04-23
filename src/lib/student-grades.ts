// Resolve which grades a student is taught for a given module.
//
// Lookup order:
//   1. Per-module override (assignedGradesByModule[moduleId]) if present.
//   2. Global assignedGrades.
//   3. Fallback to [schoolGrade] for legacy data.
//
// Always sorted descending (school grade first, then downgrades).

export type StudentGradesLike = {
  schoolGrade: number;
  assignedGrades?: number[] | null;
  assignedGradesByModule?: Record<string, number[]> | null;
};

export function resolveAssignedGrades(
  student: StudentGradesLike,
  moduleId?: string,
): number[] {
  const override =
    moduleId && student.assignedGradesByModule
      ? student.assignedGradesByModule[moduleId]
      : undefined;
  const list =
    override && override.length > 0
      ? override
      : student.assignedGrades && student.assignedGrades.length > 0
        ? student.assignedGrades
        : [student.schoolGrade];
  // Defensive: dedupe + clamp + ensure school grade is always present.
  const dedup = Array.from(new Set([student.schoolGrade, ...list]))
    .filter((g) => g >= 6 && g <= student.schoolGrade)
    .sort((a, b) => b - a);
  return dedup;
}

// Lowest assigned grade — used as the default scan starting grade in
// PositionOptions.defaultGrade so getStudentNextExercise begins at the
// downgraded grade for weak students.
export function lowestAssignedGrade(
  student: StudentGradesLike,
  moduleId?: string,
): number {
  const grades = resolveAssignedGrades(student, moduleId);
  return grades[grades.length - 1] ?? student.schoolGrade;
}

// Whether a per-module override is set (used to render a small badge on the
// module chip in the students page).
export function hasModuleOverride(
  student: StudentGradesLike,
  moduleId: string,
): boolean {
  const arr = student.assignedGradesByModule?.[moduleId];
  return Array.isArray(arr) && arr.length > 0;
}
