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
