// Pure roster-move arithmetic for the /groups "Group" (organize) board.
// NO Convex imports — shared by the applyRosterMoves mutation (final guard)
// and by vitest. A "move" takes a student out of one group (or Unassigned)
// and into another (or Unassigned). The only hard rule is the class-size cap.

export const UNASSIGNED = "__unassigned__";
export const DEFAULT_MAX_SIZE = 10;

// from/to are group ids, or null for the Unassigned column.
export type RosterOp = {
  studentId: string;
  fromGroupId: string | null;
  toGroupId: string | null;
};

// A group's cap is its maxSize when set, else the business hard-cap of 10.
export function effectiveCap(maxSize: number | undefined | null): number {
  return maxSize ?? DEFAULT_MAX_SIZE;
}

// Drop ops that don't actually change anything (target === source).
export function realOps(ops: RosterOp[]): RosterOp[] {
  return ops.filter((o) => o.fromGroupId !== o.toGroupId);
}

// Net change in membership count per group after applying ops. Ignores
// Unassigned (null) and no-op moves. Positive = the group grows.
export function netCountDelta(ops: RosterOp[]): Map<string, number> {
  const delta = new Map<string, number>();
  for (const o of realOps(ops)) {
    if (o.fromGroupId) delta.set(o.fromGroupId, (delta.get(o.fromGroupId) ?? 0) - 1);
    if (o.toGroupId) delta.set(o.toGroupId, (delta.get(o.toGroupId) ?? 0) + 1);
  }
  return delta;
}

// ── Organize-board construction (pure) ──────────────────────────────────────
// Builds the grade-scoped board from plain rows so it can be unit-tested
// without a Convex DB. Key rules (see decisions.md):
//   • A group is a column for grade G if it DECLARES G (grade or
//     additionalGrades) OR contains at least one grade-G student. The second
//     clause is what surfaces untyped/mixed groups (e.g. a group with no grade
//     field that nonetheless holds grade-G students) so their members aren't
//     stranded off every board.
//   • …BUT a phantom group (no members AND no scheduled session) is never
//     shown — the Week-view tap-to-create mints a `new_group` row before the
//     user commits, and backing out leaves an abandoned row. Requiring a
//     member or a session keeps the board consistent with the slot-driven
//     Week grid.
//   • EVERY member of a shown column is a movable chip — including off-grade
//     members (shown with their real grade) and students who are also in other
//     groups (they appear once per group, moved independently). Nothing is
//     hidden as "locked".
//   • Unassigned = grade-G students who are in no group at all.

export type BoardGroup = {
  _id: string;
  name: string;
  grade?: number | null;
  additionalGrades?: number[] | null;
  maxSize?: number | null;
  firstSession?: { dayOfWeek: number; startTime: string } | null;
};
export type BoardMemberRow = { groupId: string; studentId: string };
export type BoardStudent = { _id: string; name: string; schoolGrade: number };

export type BoardChip = { studentId: string; name: string; grade: number };
export type BoardColumn = {
  groupId: string;
  name: string;
  cap: number;
  count: number;
  firstSession: { dayOfWeek: number; startTime: string } | null;
  acceptedGrades: number[]; // empty ⇒ accepts any grade
  primaryGrade: number | null; // the group's `grade` (null ⇒ "Any")
  extraGrades: number[]; // the group's `additionalGrades`
  members: BoardChip[];
};
export type GradeBoard = { columns: BoardColumn[]; unassigned: BoardChip[] };

export function acceptedGradesOf(g: BoardGroup): number[] {
  return [
    ...(g.grade != null ? [g.grade] : []),
    ...(g.additionalGrades ?? []),
  ];
}

export function buildGradeBoard(
  grade: number,
  groups: BoardGroup[],
  members: BoardMemberRow[],
  students: BoardStudent[],
): GradeBoard {
  const studentById = new Map(students.map((s) => [s._id, s]));

  const membersByGroup = new Map<string, BoardMemberRow[]>();
  const assigned = new Set<string>();
  for (const m of members) {
    const arr = membersByGroup.get(m.groupId) ?? [];
    arr.push(m);
    membersByGroup.set(m.groupId, arr);
    assigned.add(m.studentId);
  }

  const columns: BoardColumn[] = [];
  for (const g of groups) {
    const rows = membersByGroup.get(g._id) ?? [];
    const chips: BoardChip[] = [];
    let hasGradeMember = false;
    for (const m of rows) {
      const s = studentById.get(m.studentId);
      if (!s) continue;
      if (s.schoolGrade === grade) hasGradeMember = true;
      chips.push({ studentId: s._id, name: s.name, grade: s.schoolGrade });
    }
    const accepted = acceptedGradesOf(g);
    const declaresGrade = accepted.includes(grade);
    if (!declaresGrade && !hasGradeMember) continue;
    // Hide phantom groups: a row with NO members AND NO scheduled session is
    // an abandoned "new_group" (the Week-view tap-to-create mints one before
    // the user commits). It is never a useful drop target and only clutters
    // the board. A real but currently-empty group keeps its session, so it
    // still shows. Mirrors the Week grid, which is slot-driven.
    const isReal = chips.length > 0 || g.firstSession != null;
    if (!isReal) continue;

    chips.sort((a, b) => a.name.localeCompare(b.name));
    columns.push({
      groupId: g._id,
      name: g.name,
      cap: effectiveCap(g.maxSize),
      count: chips.length,
      firstSession: g.firstSession ?? null,
      acceptedGrades: accepted,
      primaryGrade: g.grade ?? null,
      extraGrades: g.additionalGrades ?? [],
      members: chips,
    });
  }

  const unassigned = students
    .filter((s) => s.schoolGrade === grade && !assigned.has(s._id))
    .map((s) => ({ studentId: s._id, name: s.name, grade: s.schoolGrade }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return { columns, unassigned };
}

export type CapViolation = { groupId: string; count: number; cap: number };

// Validate that no group exceeds its cap once ops are applied. Only groups
// that GROW can violate, so shrinking/unchanged groups are skipped.
export function validateCaps(
  ops: RosterOp[],
  currentCounts: Map<string, number>,
  caps: Map<string, number>,
): { ok: boolean; violations: CapViolation[] } {
  const delta = netCountDelta(ops);
  const violations: CapViolation[] = [];
  for (const [groupId, d] of Array.from(delta.entries())) {
    if (d <= 0) continue;
    const count = (currentCounts.get(groupId) ?? 0) + d;
    const cap = caps.get(groupId) ?? DEFAULT_MAX_SIZE;
    if (count > cap) violations.push({ groupId, count, cap });
  }
  return { ok: violations.length === 0, violations };
}
