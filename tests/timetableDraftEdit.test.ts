// @vitest-environment edge-runtime
//
// Integration tests for branch-aware editing (planning mode). Edits go through
// the draftEdit mutations exactly as the week view / group editor / organize
// board would call them, then we assert they (a) land in the draft and (b)
// reach live through Merge — without touching live before Merge.

import { describe, it, expect } from 'vitest';
import { convexTest } from 'convex-test';
import { api } from '../convex/_generated/api';
import schema from '../convex/schema';

const modules = import.meta.glob('../convex/**/*.ts');
const asUser = (t: ReturnType<typeof convexTest>) =>
  t.withIdentity({ name: 'Tutor', subject: 'tutor-1' });

async function seed(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const centerId = await ctx.db.insert('centers', { name: 'C', city: 'X', district: 'Y', road: 'Z' });
    const roomId = await ctx.db.insert('rooms', { centerId, name: 'R1' });
    const groupId = await ctx.db.insert('groups', {
      name: 'G1', autoName: false, centerId, grade: 10, createdAt: 0, updatedAt: 0, defaultRoomId: roomId,
    });
    const s10 = await ctx.db.insert('students', { name: 'Asha', schoolGrade: 10, parentPhone: '07', schoolName: 'S', centerId });
    const s9 = await ctx.db.insert('students', { name: 'Bo', schoolGrade: 9, parentPhone: '07', schoolName: 'S', centerId });
    return { centerId, roomId, groupId, s10, s9 };
  });
}

const draftGroupFor = (t: ReturnType<typeof convexTest>, sourceId: string) =>
  t.run(async (ctx) => (await ctx.db.query('draftGroups').collect()).find((g) => g.sourceId === sourceId)!);

describe('toggleSessionDraft fuses like live and stays in the draft', () => {
  it('adds two adjacent hours as one fused draft slot; live untouched until merge', async () => {
    const t = convexTest(schema, modules);
    const { groupId, roomId } = await seed(t);
    await asUser(t).mutation(api.timetableDraft.fork, {});
    const dg = await draftGroupFor(t, groupId);
    await asUser(t).mutation(api.timetableDraftEdit.toggleSessionDraft, {
      groupId: dg._id, dayOfWeek: 6, startTime: '15:00', endTime: '16:00', roomId,
    });
    await asUser(t).mutation(api.timetableDraftEdit.toggleSessionDraft, {
      groupId: dg._id, dayOfWeek: 6, startTime: '16:00', endTime: '17:00', roomId,
    });
    const draftSlots = await t.run((ctx) => ctx.db.query('draftSlots').collect());
    expect(draftSlots).toHaveLength(1);
    expect([draftSlots[0].startTime, draftSlots[0].endTime]).toEqual(['15:00', '17:00']);
    // Live has no slots yet.
    expect(await t.run((ctx) => ctx.db.query('scheduleSlots').collect())).toHaveLength(0);

    await asUser(t).mutation(api.timetableDraft.merge, {});
    const liveSlots = await t.run((ctx) => ctx.db.query('scheduleSlots').collect());
    expect(liveSlots).toHaveLength(1);
    expect([liveSlots[0].startTime, liveSlots[0].endTime]).toEqual(['15:00', '17:00']);
    expect(liveSlots[0].groupId).toBe(groupId); // remapped onto the existing live group
  });
});

describe('membership edits in the draft reach live via merge', () => {
  it('adds a grade-10 student in the draft, blocks a grade-9 add, merges through', async () => {
    const t = convexTest(schema, modules);
    const { groupId, s10, s9 } = await seed(t);
    await asUser(t).mutation(api.timetableDraft.fork, {});
    const dg = await draftGroupFor(t, groupId);

    await asUser(t).mutation(api.timetableDraftEdit.addMemberDraft, { groupId: dg._id, studentId: s10 });
    await expect(
      asUser(t).mutation(api.timetableDraftEdit.addMemberDraft, { groupId: dg._id, studentId: s9 }),
    ).rejects.toThrow(/Grade 9/);

    // Live still has no members before merge.
    expect(await t.run((ctx) => ctx.db.query('groupMembers').collect())).toHaveLength(0);

    await asUser(t).mutation(api.timetableDraft.merge, {});
    const liveMembers = await t.run((ctx) => ctx.db.query('groupMembers').collect());
    expect(liveMembers).toHaveLength(1);
    expect(liveMembers[0].studentId).toBe(s10);
    expect(liveMembers[0].groupId).toBe(groupId);
  });
});

describe('createGroupDraft + merge creates a brand-new live group', () => {
  it('a group invented in the draft lands live with its session', async () => {
    const t = convexTest(schema, modules);
    const { roomId } = await seed(t);
    await asUser(t).mutation(api.timetableDraft.fork, {});
    const newDraftId = await asUser(t).mutation(api.timetableDraftEdit.createGroupDraft, {
      name: 'Newbies', autoName: false, grade: 8, defaultRoomId: roomId,
    });
    await asUser(t).mutation(api.timetableDraftEdit.toggleSessionDraft, {
      groupId: newDraftId, dayOfWeek: 7, startTime: '09:00', endTime: '10:00', roomId,
    });
    await asUser(t).mutation(api.timetableDraft.merge, {});
    const live = await t.run(async (ctx) => ({
      groups: await ctx.db.query('groups').collect(),
      slots: await ctx.db.query('scheduleSlots').collect(),
    }));
    const g = live.groups.find((x) => x.name === 'Newbies');
    expect(g).toBeTruthy();
    expect(live.slots.find((s) => s.startTime === '09:00')!.groupId).toBe(g!._id);
  });
});

describe('sessionConflictsDraft flags a shared mentor in the draft', () => {
  it('reports mentorBusy for another draft group the same mentor teaches', async () => {
    const t = convexTest(schema, modules);
    const { centerId, roomId } = await seed(t);
    const teacherId = await t.run((ctx) =>
      ctx.db.insert('teachers', { clerkUserId: 'tx', name: 'Mr T', role: 'mentor' }),
    );
    // Two live groups sharing a mentor; the other one already has a session.
    const gA = await t.run((ctx) =>
      ctx.db.insert('groups', { name: 'A', autoName: false, centerId, grade: 10, mentorId: teacherId, createdAt: 0, updatedAt: 0, defaultRoomId: roomId }),
    );
    const gB = await t.run((ctx) =>
      ctx.db.insert('groups', { name: 'B', autoName: false, centerId, grade: 10, mentorId: teacherId, createdAt: 0, updatedAt: 0, defaultRoomId: roomId }),
    );
    await t.run((ctx) => ctx.db.insert('scheduleSlots', { dayOfWeek: 6, startTime: '15:00', endTime: '16:00', roomId, groupId: gB }));
    await asUser(t).mutation(api.timetableDraft.fork, {});
    const dgA = await draftGroupFor(t, gA);
    const res = await asUser(t).query(api.timetableDraftEdit.sessionConflictsDraft, { groupId: dgA._id });
    expect(res.mentorBusy.some((c) => c.startTime === '15:00' && c.groupName === 'B')).toBe(true);
  });
});

describe('applyRosterMovesDraft respects the size cap', () => {
  it('blocks a move that would exceed maxSize', async () => {
    const t = convexTest(schema, modules);
    const { centerId, roomId } = await seed(t);
    const small = await t.run((ctx) =>
      ctx.db.insert('groups', { name: 'Small', autoName: false, centerId, grade: 10, maxSize: 1, createdAt: 0, updatedAt: 0, defaultRoomId: roomId }),
    );
    const a = await t.run((ctx) => ctx.db.insert('students', { name: 'A', schoolGrade: 10, parentPhone: '07', schoolName: 'S', centerId }));
    const b = await t.run((ctx) => ctx.db.insert('students', { name: 'B', schoolGrade: 10, parentPhone: '07', schoolName: 'S', centerId }));
    await t.run((ctx) => ctx.db.insert('groupMembers', { groupId: small, studentId: a, joinedAt: 0 }));
    await asUser(t).mutation(api.timetableDraft.fork, {});
    const dgSmall = await draftGroupFor(t, small);
    await expect(
      asUser(t).mutation(api.timetableDraftEdit.applyRosterMovesDraft, {
        ops: [{ studentId: b, fromGroupId: null, toGroupId: dgSmall._id }],
      }),
    ).rejects.toThrow(/max 1/);
  });
});
