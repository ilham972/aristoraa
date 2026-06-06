// @vitest-environment edge-runtime
//
// Integration test for the fuseContiguousSlots migration + absorbSlotData,
// the riskiest (DB-mutating) path. Exercises a real back-to-back pair with
// conflicting attendance and split payments, and asserts the approved
// conflict rules (present wins, payments summed) on the fused slot.

import { describe, it, expect } from 'vitest';
import { convexTest } from 'convex-test';
import { api } from '../convex/_generated/api';
import schema from '../convex/schema';

const modules = import.meta.glob('../convex/**/*.ts');

describe('fuseContiguousSlots migration', () => {
  it('fuses two contiguous atoms, applying conflict rules', async () => {
    const t = convexTest(schema, modules);

    const ids = await t.run(async (ctx) => {
      const centerId = await ctx.db.insert('centers', {
        name: 'C', city: 'X', district: 'Y', road: 'Z',
      });
      const roomId = await ctx.db.insert('rooms', { centerId, name: 'R1' });
      const groupId = await ctx.db.insert('groups', {
        name: 'G', autoName: false, createdAt: 0, updatedAt: 0,
      });
      const studentId = await ctx.db.insert('students', {
        name: 'S', schoolGrade: 10, parentPhone: '+94770000000', schoolName: 'Sch',
      });
      const slotA = await ctx.db.insert('scheduleSlots', {
        dayOfWeek: 6, startTime: '15:00', endTime: '16:00', roomId, groupId,
      });
      const slotB = await ctx.db.insert('scheduleSlots', {
        dayOfWeek: 6, startTime: '16:00', endTime: '17:00', roomId, groupId,
      });
      const date = '2026-06-06';
      // Conflict: present on A, absent on B → present must win.
      await ctx.db.insert('attendance', { studentId, slotId: slotA, date, status: 'present' });
      await ctx.db.insert('attendance', { studentId, slotId: slotB, date, status: 'absent' });
      // Split payment across the two hours → must sum to 350.
      await ctx.db.insert('sessionPayments', { slotId: slotA, date, studentId, amount: 250, paidAt: 1 });
      await ctx.db.insert('sessionPayments', { slotId: slotB, date, studentId, amount: 100, paidAt: 2 });
      return { groupId, slotA, slotB, studentId, date };
    });

    const report = await t.mutation(api.migrations.fuseContiguousSlots, { commit: true });
    expect(report.mode).toBe('committed');
    expect(report.runsToFuse).toBe(1);
    expect(report.slotsAbsorbed).toBe(1);

    await t.run(async (ctx) => {
      const slots = (await ctx.db.query('scheduleSlots').collect()).filter(
        (s) => s.groupId === ids.groupId,
      );
      expect(slots).toHaveLength(1);
      expect(slots[0]._id).toBe(ids.slotA); // canonical = earliest
      expect(slots[0].startTime).toBe('15:00');
      expect(slots[0].endTime).toBe('17:00');

      const att = await ctx.db
        .query('attendance')
        .withIndex('by_slot_date', (q) => q.eq('slotId', slots[0]._id).eq('date', ids.date))
        .collect();
      expect(att).toHaveLength(1);
      expect(att[0].status).toBe('present');

      const pays = await ctx.db
        .query('sessionPayments')
        .withIndex('by_slot_date', (q) => q.eq('slotId', slots[0]._id).eq('date', ids.date))
        .collect();
      expect(pays).toHaveLength(1);
      expect(pays[0].amount).toBe(350);

      // slotB is gone.
      const gone = await ctx.db.get(ids.slotB);
      expect(gone).toBe(null);
    });
  });

  it('is idempotent — a second run fuses nothing', async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const centerId = await ctx.db.insert('centers', {
        name: 'C', city: 'X', district: 'Y', road: 'Z',
      });
      const roomId = await ctx.db.insert('rooms', { centerId, name: 'R1' });
      const groupId = await ctx.db.insert('groups', {
        name: 'G', autoName: false, createdAt: 0, updatedAt: 0,
      });
      await ctx.db.insert('scheduleSlots', {
        dayOfWeek: 6, startTime: '15:00', endTime: '16:00', roomId, groupId,
      });
      await ctx.db.insert('scheduleSlots', {
        dayOfWeek: 6, startTime: '16:00', endTime: '17:00', roomId, groupId,
      });
    });
    await t.mutation(api.migrations.fuseContiguousSlots, { commit: true });
    const second = await t.mutation(api.migrations.fuseContiguousSlots, { commit: true });
    expect(second.runsToFuse).toBe(0);
  });
});
