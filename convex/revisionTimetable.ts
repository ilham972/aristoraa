// Revision-class timetable (2026-07-17) — the founder's day-only board:
// columns are weekdays, each day holds the groups (and groupless individual
// students) who come in for revision that day. No time-of-day anywhere.
// The planner Sheets tab reads a group's revision-class days through
// groupPlan.groupSlotDays and lets sheets be assigned onto them.

import { mutation, query, type MutationCtx } from './_generated/server';
import { v } from 'convex/values';
import type { Id } from './_generated/dataModel';

// Same local helper pattern as groupPlan.ts / tracks.ts — attribute writes
// to the signed-in teacher when one exists.
async function resolveTeacherId(
  ctx: MutationCtx,
): Promise<Id<'teachers'> | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  const rows = await ctx.db
    .query('teachers')
    .withIndex('by_clerk_user', (q) => q.eq('clerkUserId', identity.subject))
    .collect();
  if (rows.length === 0) return null;
  return rows.reduce((a, b) => (a._creationTime <= b._creationTime ? a : b))
    ._id;
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const rows = await ctx.db.query('revisionClasses').collect();
    const days = [1, 2, 3, 4, 5, 6, 7].map((d) => ({
      dayOfWeek: d,
      entries: [] as Array<{
        id: string;
        kind: 'group' | 'student';
        name: string;
        grade: number | null;
      }>,
    }));
    for (const r of rows) {
      const day = days[r.dayOfWeek - 1];
      if (!day) continue;
      if (r.groupId) {
        const g = await ctx.db.get(r.groupId);
        if (!g) continue;
        day.entries.push({
          id: r._id as unknown as string,
          kind: 'group',
          name: g.name,
          grade: g.grade ?? null,
        });
      } else if (r.studentId) {
        const s = await ctx.db.get(r.studentId);
        if (!s) continue;
        day.entries.push({
          id: r._id as unknown as string,
          kind: 'student',
          name: s.name,
          grade: s.schoolGrade ?? null,
        });
      }
    }
    for (const d of days)
      d.entries.sort((a, b) =>
        a.kind === b.kind
          ? a.name.localeCompare(b.name)
          : a.kind === 'group'
            ? -1
            : 1,
      );
    return { days };
  },
});

export const add = mutation({
  args: {
    dayOfWeek: v.number(),
    groupId: v.optional(v.id('groups')),
    studentId: v.optional(v.id('students')),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error('Unauthenticated');
    if (args.dayOfWeek < 1 || args.dayOfWeek > 7)
      throw new Error('dayOfWeek must be 1..7');
    if (!args.groupId === !args.studentId)
      throw new Error('Pass exactly one of groupId / studentId');
    const existing = await ctx.db
      .query('revisionClasses')
      .withIndex('by_day', (q) => q.eq('dayOfWeek', args.dayOfWeek))
      .collect();
    const dup = existing.some(
      (r) =>
        (args.groupId && r.groupId === args.groupId) ||
        (args.studentId && r.studentId === args.studentId),
    );
    if (dup) return { ok: true as const, added: false };
    const teacherId = await resolveTeacherId(ctx);
    await ctx.db.insert('revisionClasses', {
      dayOfWeek: args.dayOfWeek,
      ...(args.groupId ? { groupId: args.groupId } : {}),
      ...(args.studentId ? { studentId: args.studentId } : {}),
      createdAt: Date.now(),
      ...(teacherId ? { createdByTeacherId: teacherId } : {}),
    });
    return { ok: true as const, added: true };
  },
});

export const remove = mutation({
  args: { id: v.id('revisionClasses') },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error('Unauthenticated');
    const row = await ctx.db.get(args.id);
    if (row) await ctx.db.delete(args.id);
    return { ok: true as const };
  },
});
