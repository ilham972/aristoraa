// @vitest-environment edge-runtime
//
// Question routing + unit compression (sessions redesign, 2026-07-18).
// Green = taught in Main; yellow = routed to the Revision department's
// queues. Exercises the real engine in convex/learningEngine/groupPlan.ts:
//   • a routed question leaves Main demand and the Main pick queues,
//   • it reaches students through their revision queues instead,
//   • compressionPreview proposes intro+hardest green / middle yellow,
//   • applyCompression never overwrites a MANUAL route,
//   • reorderConceptQuestions writes decimal difficulty 1.0→5.0.

import { describe, it, expect } from 'vitest';
import { convexTest } from 'convex-test';
import { api } from '../convex/_generated/api';
import schema from '../convex/schema';
import type { Id } from '../convex/_generated/dataModel';

const modules = import.meta.glob('../convex/**/*.ts');
const asUser = (t: ReturnType<typeof convexTest>) =>
  t.withIdentity({ name: 'Tutor', subject: 'tutor-1' });

const UNIT1 = 'M1-G10-T1-0';
const UNIT2 = 'M1-G10-T1-1';

// Track with two units; unit 1 holds 4 questions (difficulty 1..4, one
// concept), unit 2 holds 2. Group with one student and a Monday Main slot.
async function seed(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const trackId = await ctx.db.insert('tracks', {
      name: 'On-level G10',
      level: 100,
      orderedUnitIds: [UNIT1, UNIT2],
      targetGrade: 10,
      targetTerm: 1,
      active: true,
      createdAt: 0,
      updatedAt: 0,
    });
    const studentId = await ctx.db.insert('students', {
      name: 'S',
      schoolGrade: 10,
      parentPhone: '+94770000000',
      schoolName: 'Sch',
      trackId,
    });
    const groupId = await ctx.db.insert('groups', {
      name: 'G',
      autoName: false,
      createdAt: 0,
      updatedAt: 0,
    });
    await ctx.db.insert('groupMembers', { groupId, studentId, joinedAt: 0 });
    const centerId = await ctx.db.insert('centers', {
      name: 'C',
      city: 'X',
      district: 'Y',
      road: 'Z',
    });
    const roomId = await ctx.db.insert('rooms', { centerId, name: 'R1' });
    const mainSlotId = await ctx.db.insert('scheduleSlots', {
      dayOfWeek: 1,
      startTime: '15:00',
      endTime: '16:00',
      roomId,
      groupId,
    });
    const revSlotId = await ctx.db.insert('scheduleSlots', {
      dayOfWeek: 3,
      startTime: '15:00',
      endTime: '16:00',
      roomId,
      groupId,
      sessionType: 'revision',
    });

    const qids: Record<string, Id<'questionBank'>[]> = {};
    for (const [unitId, count] of [
      [UNIT1, 4],
      [UNIT2, 2],
    ] as const) {
      await ctx.db.insert('exercises', {
        unitId,
        name: 'c',
        questionCount: 0,
        order: 0,
        type: 'concept',
      });
      const exId = await ctx.db.insert('exercises', {
        unitId,
        name: '1.1',
        questionCount: count,
        order: 1,
        type: 'exercise',
      });
      qids[unitId] = [];
      for (let i = 0; i < count; i++) {
        qids[unitId].push(
          await ctx.db.insert('questionBank', {
            source: 'textbook',
            linkedExerciseId: exId,
            difficulty: i + 1,
            createdAt: 0,
          }),
        );
      }
    }
    return { groupId, studentId, mainSlotId, revSlotId, qids };
  });
}

const unit1Unseen = async (
  t: ReturnType<typeof convexTest>,
  groupId: Id<'groups'>,
) => {
  const plan = await asUser(t).query(
    api.learningEngine.groupPlan.groupLessonPlan,
    { groupId },
  );
  expect(plan?.status).toBe('ok');
  return plan!.units!.find((u: { unitId: string }) => u.unitId === UNIT1)!
    .unseenCount as number;
};

describe('question routing (green/yellow)', () => {
  it('a routed question leaves Main demand and is never crystallized', async () => {
    const t = convexTest(schema, modules);
    const { groupId, qids } = await seed(t);
    expect(await unit1Unseen(t, groupId)).toBe(4);

    await asUser(t).mutation(api.learningEngine.groupPlan.setQuestionRoutes, {
      groupId,
      unitId: UNIT1,
      routes: [{ questionId: qids[UNIT1][1], route: 'revision' }],
    });
    expect(await unit1Unseen(t, groupId)).toBe(3);

    await asUser(t).mutation(
      api.learningEngine.groupPlan.crystallizeUpcoming,
      { groupId, daysAhead: 60 },
    );
    const onSheets = await t.run(async (ctx) => {
      const rows = await ctx.db.query('groupSheets').collect();
      return rows.flatMap((r) => [
        ...r.newQuestionIds,
        ...r.spiralQuestionIds,
      ]);
    });
    expect(onSheets.length).toBeGreaterThan(0);
    expect(onSheets).not.toContain(qids[UNIT1][1]);
  });

  it('a routed question reaches the student through the revision queue', async () => {
    const t = convexTest(schema, modules);
    const { groupId, studentId, revSlotId, qids } = await seed(t);
    await asUser(t).mutation(api.learningEngine.groupPlan.setQuestionRoutes, {
      groupId,
      unitId: UNIT1,
      routes: [{ questionId: qids[UNIT1][2], route: 'revision' }],
    });
    const res = await asUser(t).query(
      api.learningEngine.groupPlan.revisionQueuesForSlotDate,
      { slotId: revSlotId, dateStr: '2026-07-18' },
    );
    const queue = res!.queues[studentId as unknown as string];
    expect(queue.questionIds).toContain(qids[UNIT1][2]);
  });

  it('compressionPreview keeps concept intro + hardest green, flips the middle yellow', async () => {
    const t = convexTest(schema, modules);
    const { groupId, qids } = await seed(t);
    const preview = await asUser(t).query(
      api.learningEngine.groupPlan.compressionPreview,
      { groupId },
    );
    expect(preview?.status).toBe('ok');
    if (preview?.status !== 'ok') return;
    expect(preview.currentUnitId).toBe(UNIT1);
    expect(preview.nextUnitId).toBe(UNIT2);
    const byId = new Map(
      preview.questions.map((q) => [q.questionId, q.propose]),
    );
    // First of the concept (easiest) + hardest 20% (= 1 of 4) stay green.
    expect(byId.get(qids[UNIT1][0])).toBe('main');
    expect(byId.get(qids[UNIT1][3])).toBe('main');
    expect(byId.get(qids[UNIT1][1])).toBe('revision');
    expect(byId.get(qids[UNIT1][2])).toBe('revision');
  });

  it('applyCompression writes auto rows but never overwrites a manual route', async () => {
    const t = convexTest(schema, modules);
    const { groupId, qids } = await seed(t);
    // Founder pinned q2 to Main by hand.
    await asUser(t).mutation(api.learningEngine.groupPlan.setQuestionRoutes, {
      groupId,
      unitId: UNIT1,
      routes: [{ questionId: qids[UNIT1][1], route: 'main' }],
    });
    await asUser(t).mutation(api.learningEngine.groupPlan.applyCompression, {
      groupId,
      unitId: UNIT1,
      autoRevisionIds: [qids[UNIT1][1], qids[UNIT1][2]],
      manualMainIds: [],
      manualRevisionIds: [],
    });
    const rows = await t.run(async (ctx) =>
      ctx.db.query('groupQuestionRoutes').collect(),
    );
    const q2 = rows.find((r) => r.questionId === qids[UNIT1][1])!;
    const q3 = rows.find((r) => r.questionId === qids[UNIT1][2])!;
    expect(q2.route).toBe('main'); // manual pin survived the auto write
    expect(q2.source).toBe('manual');
    expect(q3.route).toBe('revision');
    expect(q3.source).toBe('auto');
  });

  it('reorderConceptQuestions writes decimal difficulty spread 1.0→5.0', async () => {
    const t = convexTest(schema, modules);
    const { qids } = await seed(t);
    await asUser(t).mutation(
      api.learningEngine.lessonSets.reorderConceptQuestions,
      { orderedQuestionIds: qids[UNIT1] },
    );
    const diffs = await t.run(async (ctx) => {
      const out: number[] = [];
      for (const id of qids[UNIT1]) out.push((await ctx.db.get(id))!.difficulty!);
      return out;
    });
    expect(diffs).toEqual([1, 2.3, 3.7, 5]);
  });
});
