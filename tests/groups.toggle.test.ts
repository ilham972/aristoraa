// @vitest-environment edge-runtime
//
// Integration tests for the toggleSession editor apply path: add-fuse, shrink,
// interior split, orphan-on-remove, and absorb-on-add (a data-bearing gap
// slot). Exercises the real DB diff in convex/groups.ts.

import { describe, it, expect } from 'vitest';
import { convexTest } from 'convex-test';
import { api } from '../convex/_generated/api';
import schema from '../convex/schema';

const modules = import.meta.glob('../convex/**/*.ts');
const asUser = (t: ReturnType<typeof convexTest>) =>
  t.withIdentity({ name: 'Tutor', subject: 'tutor-1' });

async function seedGroupRoom(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const centerId = await ctx.db.insert('centers', {
      name: 'C', city: 'X', district: 'Y', road: 'Z',
    });
    const roomId = await ctx.db.insert('rooms', { centerId, name: 'R1' });
    const groupId = await ctx.db.insert('groups', {
      name: 'G', autoName: false, createdAt: 0, updatedAt: 0, defaultRoomId: roomId,
    });
    return { centerId, roomId, groupId };
  });
}

const slotsFor = (t: ReturnType<typeof convexTest>, groupId: string) =>
  t.run(async (ctx) =>
    (await ctx.db.query('scheduleSlots').collect())
      .filter((s) => s.groupId === groupId)
      .sort((a, b) => a.startTime.localeCompare(b.startTime)),
  );

describe('toggleSession — add fuses with an adjacent slot', () => {
  it('3-4 + add 4-5 → one 15:00-17:00 slot', async () => {
    const t = convexTest(schema, modules);
    const { groupId, roomId } = await seedGroupRoom(t);
    await asUser(t).mutation(api.groups.toggleSession, {
      groupId, dayOfWeek: 6, startTime: '15:00', endTime: '16:00', roomId,
    });
    const res = await asUser(t).mutation(api.groups.toggleSession, {
      groupId, dayOfWeek: 6, startTime: '16:00', endTime: '17:00', roomId,
    });
    expect(res.action).toBe('added');
    const slots = await slotsFor(t, groupId);
    expect(slots).toHaveLength(1);
    expect(slots[0].startTime).toBe('15:00');
    expect(slots[0].endTime).toBe('17:00');
  });
});

describe('toggleSession — remove an interior hour splits the slot', () => {
  it('3-6 minus 4-5 → 15:00-16:00 and 17:00-18:00', async () => {
    const t = convexTest(schema, modules);
    const { groupId, roomId } = await seedGroupRoom(t);
    await t.run(async (ctx) => {
      await ctx.db.insert('scheduleSlots', {
        dayOfWeek: 6, startTime: '15:00', endTime: '18:00', roomId, groupId,
      });
    });
    const res = await asUser(t).mutation(api.groups.toggleSession, {
      groupId, dayOfWeek: 6, startTime: '16:00', endTime: '17:00', roomId,
    });
    expect(res.action).toBe('removed');
    const slots = await slotsFor(t, groupId);
    expect(slots.map((s) => [s.startTime, s.endTime])).toEqual([
      ['15:00', '16:00'],
      ['17:00', '18:00'],
    ]);
  });
});

describe('toggleSession — removing a standalone hour orphans it', () => {
  it('keeps the row (groupId undefined) and its attendance', async () => {
    const t = convexTest(schema, modules);
    const { groupId, roomId } = await seedGroupRoom(t);
    const slotId = await t.run(async (ctx) => {
      const studentId = await ctx.db.insert('students', {
        name: 'S', schoolGrade: 10, parentPhone: '+94770000000', schoolName: 'Sch',
      });
      const id = await ctx.db.insert('scheduleSlots', {
        dayOfWeek: 6, startTime: '15:00', endTime: '16:00', roomId, groupId,
      });
      await ctx.db.insert('attendance', { studentId, slotId: id, date: '2026-06-06', status: 'present' });
      return id;
    });
    await asUser(t).mutation(api.groups.toggleSession, {
      groupId, dayOfWeek: 6, startTime: '15:00', endTime: '16:00', roomId,
    });
    const live = await slotsFor(t, groupId);
    expect(live).toHaveLength(0);
    await t.run(async (ctx) => {
      const row = await ctx.db.get(slotId);
      expect(row).not.toBe(null);
      expect(row!.groupId).toBeUndefined();
      const att = await ctx.db
        .query('attendance')
        .withIndex('by_slot_date', (q) => q.eq('slotId', slotId).eq('date', '2026-06-06'))
        .collect();
      expect(att).toHaveLength(1); // history preserved
    });
  });
});

describe('toggleSession — add across a data-bearing gap absorbs the gap slot', () => {
  it('3-4(A) + 5-6(B with attendance) + add 4-5 → one slot, B data merged into A', async () => {
    const t = convexTest(schema, modules);
    const { groupId, roomId } = await seedGroupRoom(t);
    const { slotA, slotB } = await t.run(async (ctx) => {
      const studentId = await ctx.db.insert('students', {
        name: 'S', schoolGrade: 10, parentPhone: '+94770000000', schoolName: 'Sch',
      });
      const a = await ctx.db.insert('scheduleSlots', {
        dayOfWeek: 6, startTime: '15:00', endTime: '16:00', roomId, groupId,
      });
      const b = await ctx.db.insert('scheduleSlots', {
        dayOfWeek: 6, startTime: '17:00', endTime: '18:00', roomId, groupId,
      });
      await ctx.db.insert('attendance', { studentId, slotId: b, date: '2026-06-06', status: 'present' });
      await ctx.db.insert('sessionPayments', { slotId: b, date: '2026-06-06', studentId, amount: 250, paidAt: 1 });
      return { slotA: a, slotB: b };
    });
    await asUser(t).mutation(api.groups.toggleSession, {
      groupId, dayOfWeek: 6, startTime: '16:00', endTime: '17:00', roomId,
    });
    const slots = await slotsFor(t, groupId);
    expect(slots).toHaveLength(1);
    expect(slots[0]._id).toBe(slotA);
    expect(slots[0].endTime).toBe('18:00');
    await t.run(async (ctx) => {
      expect(await ctx.db.get(slotB)).toBe(null);
      const att = await ctx.db
        .query('attendance')
        .withIndex('by_slot_date', (q) => q.eq('slotId', slotA).eq('date', '2026-06-06'))
        .collect();
      expect(att).toHaveLength(1);
      expect(att[0].status).toBe('present');
      const pays = await ctx.db
        .query('sessionPayments')
        .withIndex('by_slot_date', (q) => q.eq('slotId', slotA).eq('date', '2026-06-06'))
        .collect();
      expect(pays).toHaveLength(1);
      expect(pays[0].amount).toBe(250);
    });
  });
});
