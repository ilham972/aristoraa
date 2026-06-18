// @vitest-environment edge-runtime
//
// Integration tests for planning mode (the draft timetable branch). Exercises
// the real fork → edit → Merge / Pull paths against the DB, with a focus on
// the two promises that matter most: Merge preserves live identity (so history
// survives) and Merge never destroys things created live after the last Pull.
// Draft edits are made directly here (the branch-aware editor is stage 2).

import { describe, it, expect } from 'vitest';
import { convexTest } from 'convex-test';
import { api } from '../convex/_generated/api';
import schema from '../convex/schema';

const modules = import.meta.glob('../convex/**/*.ts');
const asUser = (t: ReturnType<typeof convexTest>) =>
  t.withIdentity({ name: 'Tutor', subject: 'tutor-1' });

async function seedLive(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const centerId = await ctx.db.insert('centers', { name: 'C', city: 'X', district: 'Y', road: 'Z' });
    const roomId = await ctx.db.insert('rooms', { centerId, name: 'R1' });
    const studentId = await ctx.db.insert('students', {
      name: 'Asha', schoolGrade: 10, parentPhone: '0770000000', schoolName: 'S', centerId,
    });
    const groupId = await ctx.db.insert('groups', {
      name: 'G1', autoName: false, centerId, createdAt: 0, updatedAt: 0, defaultRoomId: roomId,
    });
    const slotId = await ctx.db.insert('scheduleSlots', {
      dayOfWeek: 6, startTime: '15:00', endTime: '16:00', roomId, groupId,
    });
    await ctx.db.insert('groupMembers', { groupId, studentId, joinedAt: 0 });
    return { centerId, roomId, studentId, groupId, slotId };
  });
}

describe('fork tolerates legacy/optional group fields', () => {
  it('forks a group that has the legacy `archived` field set', async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const centerId = await ctx.db.insert('centers', { name: 'C', city: 'X', district: 'Y', road: 'Z' });
      const roomId = await ctx.db.insert('rooms', { centerId, name: 'R1' });
      await ctx.db.insert('groups', {
        name: 'Legacy', autoName: false, centerId, archived: false,
        createdAt: 0, updatedAt: 0, defaultRoomId: roomId,
      });
    });
    await asUser(t).mutation(api.timetableDraft.fork, {});
    const draftGroups = await t.run((ctx) => ctx.db.query('draftGroups').collect());
    expect(draftGroups).toHaveLength(1);
    expect(draftGroups[0].name).toBe('Legacy');
  });
});

describe('fork + merge with no edits is a clean no-op', () => {
  it('keeps the same live group and slot ids', async () => {
    const t = convexTest(schema, modules);
    const { groupId, slotId } = await seedLive(t);
    await asUser(t).mutation(api.timetableDraft.fork, {});
    await asUser(t).mutation(api.timetableDraft.merge, {});
    const live = await t.run(async (ctx) => ({
      groups: await ctx.db.query('groups').collect(),
      slots: await ctx.db.query('scheduleSlots').collect(),
    }));
    expect(live.groups.map((g) => g._id)).toEqual([groupId]);
    expect(live.slots.map((s) => s._id)).toEqual([slotId]);
  });
});

describe('merge patches the live source in place (history preserved)', () => {
  it('editing the draft slot time updates the SAME live slot id', async () => {
    const t = convexTest(schema, modules);
    const { slotId } = await seedLive(t);
    await asUser(t).mutation(api.timetableDraft.fork, {});
    // Edit the draft copy of the slot: move it to 17:00-18:00.
    await t.run(async (ctx) => {
      const ds = await ctx.db.query('draftSlots').first();
      await ctx.db.patch(ds!._id, { startTime: '17:00', endTime: '18:00' });
    });
    await asUser(t).mutation(api.timetableDraft.merge, {});
    const slots = await t.run((ctx) => ctx.db.query('scheduleSlots').collect());
    expect(slots).toHaveLength(1);
    expect(slots[0]._id).toBe(slotId); // same identity → attendance/scores intact
    expect([slots[0].startTime, slots[0].endTime]).toEqual(['17:00', '18:00']);
  });
});

describe('merge creates groups/slots that are new in the draft', () => {
  it('a draft-only group + slot become live', async () => {
    const t = convexTest(schema, modules);
    const { roomId } = await seedLive(t);
    await asUser(t).mutation(api.timetableDraft.fork, {});
    await t.run(async (ctx) => {
      const gid = await ctx.db.insert('draftGroups', {
        name: 'NewG', autoName: false, createdAt: 0, updatedAt: 0,
      });
      await ctx.db.insert('draftSlots', {
        dayOfWeek: 7, startTime: '10:00', endTime: '11:00', roomId, groupId: gid,
      });
    });
    await asUser(t).mutation(api.timetableDraft.merge, {});
    const live = await t.run(async (ctx) => ({
      groups: await ctx.db.query('groups').collect(),
      slots: await ctx.db.query('scheduleSlots').collect(),
    }));
    const newG = live.groups.find((g) => g.name === 'NewG');
    expect(newG).toBeTruthy();
    const newSlot = live.slots.find((s) => s.startTime === '10:00');
    expect(newSlot!.groupId).toBe(newG!._id); // FK remapped draft→live
  });
});

describe('merge deletes what the draft removed', () => {
  it('removing the draft group deletes the live group + members', async () => {
    const t = convexTest(schema, modules);
    await seedLive(t);
    await asUser(t).mutation(api.timetableDraft.fork, {});
    await t.run(async (ctx) => {
      for (const m of await ctx.db.query('draftGroupMembers').collect()) await ctx.db.delete(m._id);
      for (const s of await ctx.db.query('draftSlots').collect()) await ctx.db.delete(s._id);
      for (const g of await ctx.db.query('draftGroups').collect()) await ctx.db.delete(g._id);
    });
    await asUser(t).mutation(api.timetableDraft.merge, {});
    const live = await t.run(async (ctx) => ({
      groups: await ctx.db.query('groups').collect(),
      members: await ctx.db.query('groupMembers').collect(),
    }));
    expect(live.groups).toHaveLength(0);
    expect(live.members).toHaveLength(0);
  });
});

describe('pull brings in a live joiner without touching the draft', () => {
  it('a group created live after fork appears in the draft after Pull', async () => {
    const t = convexTest(schema, modules);
    const { centerId, roomId } = await seedLive(t);
    await asUser(t).mutation(api.timetableDraft.fork, {});
    // Live drifts: a new group is created after the fork.
    const liveNew = await t.run((ctx) =>
      ctx.db.insert('groups', { name: 'LiveJoiner', autoName: false, centerId, createdAt: 1, updatedAt: 1, defaultRoomId: roomId }),
    );
    await asUser(t).mutation(api.timetableDraft.pull, {});
    const draftGroups = await t.run((ctx) => ctx.db.query('draftGroups').collect());
    expect(draftGroups.some((g) => g.sourceId === liveNew)).toBe(true);
  });
});

describe('merge never destroys a live-only new entity', () => {
  it('a group created live after fork survives a merge with no draft changes', async () => {
    const t = convexTest(schema, modules);
    const { centerId, roomId } = await seedLive(t);
    await asUser(t).mutation(api.timetableDraft.fork, {});
    const liveNew = await t.run((ctx) =>
      ctx.db.insert('groups', { name: 'LiveOnly', autoName: false, centerId, createdAt: 1, updatedAt: 1, defaultRoomId: roomId }),
    );
    await asUser(t).mutation(api.timetableDraft.merge, {});
    const stillThere = await t.run((ctx) => ctx.db.get(liveNew));
    expect(stillThere).toBeTruthy();
    expect(stillThere!.name).toBe('LiveOnly');
  });
});
