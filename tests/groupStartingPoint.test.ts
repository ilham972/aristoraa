// @vitest-environment edge-runtime
//
// Integration test for setGroupStartingPoint: the "taught before the app"
// boundary. Exercises the real reconciliation + track resolution in
// convex/learningEngine/groupPlan.ts — one tap marks every track unit up to
// and including the chosen one, moving the line is reversible, and null
// clears everything.

import { describe, it, expect } from 'vitest';
import { convexTest } from 'convex-test';
import { api } from '../convex/_generated/api';
import schema from '../convex/schema';

const modules = import.meta.glob('../convex/**/*.ts');
const asUser = (t: ReturnType<typeof convexTest>) =>
  t.withIdentity({ name: 'Tutor', subject: 'tutor-1' });

const ORDER = ['M1-G10-T1-0', 'M1-G10-T1-1', 'M1-G10-T1-2', 'M2-G10-T1-0'];

async function seed(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const trackId = await ctx.db.insert('tracks', {
      name: 'On-level G10',
      level: 100,
      orderedUnitIds: ORDER,
      targetGrade: 10,
      targetTerm: 1,
      active: true,
      createdAt: 0,
      updatedAt: 0,
    });
    const studentId = await ctx.db.insert('students', {
      name: 'S', schoolGrade: 10, parentPhone: '+94770000000', schoolName: 'Sch',
      trackId,
    });
    const groupId = await ctx.db.insert('groups', {
      name: 'G', autoName: false, createdAt: 0, updatedAt: 0,
    });
    await ctx.db.insert('groupMembers', { groupId, studentId, joinedAt: 0 });
    return { groupId, trackId, studentId };
  });
}

const marked = (t: ReturnType<typeof convexTest>, groupId: string) =>
  t.run(async (ctx) =>
    (await ctx.db.query('groupPreTaughtUnits').collect())
      .filter((r) => r.groupId === groupId)
      .map((r) => r.unitId)
      .sort(),
  );

describe('setGroupStartingPoint', () => {
  it('marks every unit up to and including the chosen one', async () => {
    const t = convexTest(schema, modules);
    const { groupId } = await seed(t);
    const res = await asUser(t).mutation(
      api.learningEngine.groupPlan.setGroupStartingPoint,
      { groupId, throughUnitId: 'M1-G10-T1-2' },
    );
    expect(res.marked).toBe(3);
    expect(await marked(t, groupId)).toEqual(
      ['M1-G10-T1-0', 'M1-G10-T1-1', 'M1-G10-T1-2'].sort(),
    );
  });

  it('moving the line earlier drops the units beyond it (reversible)', async () => {
    const t = convexTest(schema, modules);
    const { groupId } = await seed(t);
    await asUser(t).mutation(api.learningEngine.groupPlan.setGroupStartingPoint, {
      groupId, throughUnitId: 'M2-G10-T1-0', // all 4
    });
    await asUser(t).mutation(api.learningEngine.groupPlan.setGroupStartingPoint, {
      groupId, throughUnitId: 'M1-G10-T1-0', // back to just the first
    });
    expect(await marked(t, groupId)).toEqual(['M1-G10-T1-0']);
  });

  it('null clears every mark', async () => {
    const t = convexTest(schema, modules);
    const { groupId } = await seed(t);
    await asUser(t).mutation(api.learningEngine.groupPlan.setGroupStartingPoint, {
      groupId, throughUnitId: 'M1-G10-T1-1',
    });
    const res = await asUser(t).mutation(
      api.learningEngine.groupPlan.setGroupStartingPoint,
      { groupId, throughUnitId: null },
    );
    expect(res.marked).toBe(0);
    expect(await marked(t, groupId)).toEqual([]);
  });

  it('rejects a unit that is not on the group track', async () => {
    const t = convexTest(schema, modules);
    const { groupId } = await seed(t);
    await expect(
      asUser(t).mutation(api.learningEngine.groupPlan.setGroupStartingPoint, {
        groupId, throughUnitId: 'M9-G10-T9-9',
      }),
    ).rejects.toThrow(/not on this group/i);
  });
});

// End-to-end: the marked unit really drops out of the live plan. Seeds a
// group whose first two track units each hold cropped questions, then proves
// groupLessonPlan begins at unit 1 — and after marking unit 1, begins at
// unit 2 with unit 1 reported "done".
describe('setGroupStartingPoint shifts the live lesson plan', () => {
  async function seedWithBook(t: ReturnType<typeof convexTest>) {
    const base = await seed(t);
    await t.run(async (ctx) => {
      const centerId = await ctx.db.insert('centers', {
        name: 'C', city: 'X', district: 'Y', road: 'Z',
      });
      const roomId = await ctx.db.insert('rooms', { centerId, name: 'R1' });
      await ctx.db.insert('scheduleSlots', {
        dayOfWeek: 1, startTime: '15:00', endTime: '16:00', roomId,
        groupId: base.groupId,
      });
      // Two cropped questions on each of the first two units.
      for (const unitId of ['M1-G10-T1-0', 'M1-G10-T1-1']) {
        await ctx.db.insert('exercises', {
          unitId, name: 'c', questionCount: 0, order: 0, type: 'concept',
        });
        const exId = await ctx.db.insert('exercises', {
          unitId, name: '1.1', questionCount: 2, order: 1, type: 'exercise',
        });
        for (let i = 0; i < 2; i++) {
          await ctx.db.insert('questionBank', {
            source: 'textbook', linkedExerciseId: exId, difficulty: 2,
            createdAt: 0,
          });
        }
      }
    });
    return base;
  }

  it('unmarked → plan starts at unit 1; marked → starts at unit 2', async () => {
    const t = convexTest(schema, modules);
    const { groupId } = await seedWithBook(t);

    const before = await asUser(t).query(
      api.learningEngine.groupPlan.groupLessonPlan, { groupId },
    );
    expect(before?.status).toBe('ok');
    expect(before?.currentUnitId).toBe('M1-G10-T1-0');

    await asUser(t).mutation(api.learningEngine.groupPlan.setGroupStartingPoint, {
      groupId, throughUnitId: 'M1-G10-T1-0',
    });

    const after = await asUser(t).query(
      api.learningEngine.groupPlan.groupLessonPlan, { groupId },
    );
    expect(after?.currentUnitId).toBe('M1-G10-T1-1');
    const u1 = after?.units?.find((u) => u.unitId === 'M1-G10-T1-0');
    expect(u1?.verdict).toBe('done');
    expect(u1?.preTaught).toBe(true);
  });
});
