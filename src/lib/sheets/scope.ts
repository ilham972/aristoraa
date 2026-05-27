// Sheet-planner scope helpers — shared between /sheets (legacy page) and
// the session-scoped Sheets tab. Resolves a student's per-module grade
// downgrade matrix into the unit-id list the planner needs.

import { ConvexError } from 'convex/values';
import { CURRICULUM_MODULES } from '@/lib/curriculum-data';
import type { Id } from '@/lib/convex';

export const MODULE_IDS = ['M1', 'M2', 'M3', 'M4', 'M5', 'M6'] as const;

export type StudentLite = {
  _id: Id<'students'>;
  name: string;
  schoolGrade: number;
  assignedGrades?: number[];
  assignedGradesByModule?: unknown;
};

export function resolveGradeByModule(student: StudentLite): Record<string, number[]> {
  const defaults =
    student.assignedGrades && student.assignedGrades.length > 0
      ? student.assignedGrades
      : [student.schoolGrade];
  const byMod = (student.assignedGradesByModule ?? {}) as Record<string, number[]>;
  const out: Record<string, number[]> = {};
  for (const m of MODULE_IDS) {
    const override = byMod[m];
    out[m] = Array.isArray(override) && override.length > 0 ? override : defaults;
  }
  return out;
}

export function unitIdsForScope(gradeByModule: Record<string, number[]>): string[] {
  const out: string[] = [];
  for (const mod of CURRICULUM_MODULES) {
    const allowedGrades = new Set(gradeByModule[mod.id] ?? []);
    if (allowedGrades.size === 0) continue;
    for (const g of mod.grades) {
      if (!allowedGrades.has(g.grade)) continue;
      for (const t of g.terms) {
        for (const u of t.units) out.push(u.id);
      }
    }
  }
  return out;
}

export function describeError(e: unknown): string {
  if (e instanceof ConvexError) {
    const data: unknown = (e as ConvexError<string>).data;
    if (typeof data === 'string') return data;
    if (data && typeof data === 'object' && 'message' in data) {
      return String((data as { message: unknown }).message);
    }
    return JSON.stringify(data);
  }
  return e instanceof Error ? e.message : String(e);
}
