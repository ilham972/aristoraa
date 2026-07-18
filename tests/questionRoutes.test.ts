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
// concept), unit 2 holds 2. Group with one student, a Monday Main slot and
// (by default) a Wednesday Revision slot — which switches ON the auto-split
// default: unit 1's middle (q2, q3) derives yellow, intro q1 + hardest q4
// stay green; unit 2 (2 questions) has no middle.
async function seed(
  t: ReturnType<typeof convexTest>,
  opts: { revisionSlot?: boolean } = {},
) {
  const withRevision = opts.revisionSlot ?? true;
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
    const revSlotId = withRevision
      ? await ctx.db.insert('scheduleSlots', {
          dayOfWeek: 3,
          startTime: '15:00',
          endTime: '16:00',
          roomId,
          groupId,
          sessionType: 'revision',
        })
      : null;

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

// Simulate "Main taught this unit's concept N days ago": insert the memory
// row the scorer would have written (the SR queue reads lastReviewAt + R).
const introduceConcept = async (
  t: ReturnType<typeof convexTest>,
  studentId: Id<'students'>,
  unitId: string,
  daysAgo: number,
) => {
  await t.run(async (ctx) => {
    const concept = (await ctx.db.query('exercises').collect()).find(
      (e) => e.unitId === unitId && e.type === 'concept',
    )!;
    const at = Date.now() - daysAgo * 86_400_000;
    await ctx.db.insert('memoryState', {
      studentId,
      conceptExerciseId: concept._id,
      difficulty: 5,
      stability: 1,
      lastReviewAt: at,
      lastResponse: 'good',
      attemptCount: 1,
      correctWeighted: 1,
      wrongWeighted: 0,
      initializedAt: at,
    });
  });
};

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
  it('auto-split: the middle derives yellow, leaves Main demand, never crystallizes', async () => {
    const t = convexTest(schema, modules);
    const { groupId, qids } = await seed(t);
    // No tap, no compression: q2+q3 (the middle) are already Revision.
    expect(await unit1Unseen(t, groupId)).toBe(2);

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
    expect(onSheets).not.toContain(qids[UNIT1][2]);
    expect(onSheets).toContain(qids[UNIT1][0]);
    expect(onSheets).toContain(qids[UNIT1][3]);
  });

  it('auto-split needs revision capacity: without it everything stays Main', async () => {
    const t = convexTest(schema, modules);
    const { groupId } = await seed(t, { revisionSlot: false });
    expect(await unit1Unseen(t, groupId)).toBe(4);
  });

  it('a manual green tap overrides the auto yellow and sticks', async () => {
    const t = convexTest(schema, modules);
    const { groupId, qids } = await seed(t);
    await asUser(t).mutation(api.learningEngine.groupPlan.setQuestionRoutes, {
      groupId,
      unitId: UNIT1,
      routes: [{ questionId: qids[UNIT1][1], route: 'main' }],
    });
    // q2 pinned green by hand → only q3 stays auto-yellow.
    expect(await unit1Unseen(t, groupId)).toBe(3);
    const curation = await asUser(t).query(
      api.learningEngine.groupPlan.groupUnitCuration,
      { groupId, unitId: UNIT1 },
    );
    expect(curation?.status).toBe('ok');
    if (curation?.status !== 'ok') return;
    const routeOf = new Map(
      curation.questions.map((q) => [q.questionId, q.route]),
    );
    expect(routeOf.get(qids[UNIT1][0])).toBe('main');
    expect(routeOf.get(qids[UNIT1][1])).toBe('main'); // manual pin
    expect(routeOf.get(qids[UNIT1][2])).toBe('revision'); // auto middle
    expect(routeOf.get(qids[UNIT1][3])).toBe('main'); // hard tail
  });

  it('a routed question reaches the queue only after its concept is introduced (SR gate)', async () => {
    const t = convexTest(schema, modules);
    const { groupId, studentId, revSlotId, qids } = await seed(t);
    await asUser(t).mutation(api.learningEngine.groupPlan.setQuestionRoutes, {
      groupId,
      unitId: UNIT1,
      routes: [{ questionId: qids[UNIT1][2], route: 'revision' }],
    });
    // Concept never taught in Main → the drill is held back (a revision
    // teacher drills, they don't teach — SR queue, 2026-07-19).
    const before = await asUser(t).query(
      api.learningEngine.groupPlan.revisionQueuesForSlotDate,
      { slotId: revSlotId!, dateStr: '2026-07-18' },
    );
    expect(
      before!.queues[studentId as unknown as string].questionIds,
    ).not.toContain(qids[UNIT1][2]);

    // Main introduced the concept 9 days ago → due (gap ≥ 3d), served.
    await introduceConcept(t, studentId, UNIT1, 9);
    const after = await asUser(t).query(
      api.learningEngine.groupPlan.revisionQueuesForSlotDate,
      { slotId: revSlotId!, dateStr: '2026-07-18' },
    );
    expect(
      after!.queues[studentId as unknown as string].questionIds,
    ).toContain(qids[UNIT1][2]);
  });

  it('the queue serves due concepts before fresh ones, easy→hard within a concept', async () => {
    const t = convexTest(schema, modules);
    const { groupId, studentId, revSlotId, qids } = await seed(t);
    await asUser(t).mutation(api.learningEngine.groupPlan.setQuestionRoutes, {
      groupId,
      unitId: UNIT1,
      routes: [
        { questionId: qids[UNIT1][2], route: 'revision' },
        { questionId: qids[UNIT1][1], route: 'revision' },
      ],
    });
    await asUser(t).mutation(api.learningEngine.groupPlan.setQuestionRoutes, {
      groupId,
      unitId: UNIT2,
      routes: [{ questionId: qids[UNIT2][0], route: 'revision' }],
    });
    // Unit-1 concept reviewed YESTERDAY (inside the 3d gap → top-up only);
    // unit-2 concept reviewed 9 days ago (due). Despite track order, the due
    // unit-2 question must come first; unit 1's pair stays easy→hard.
    await introduceConcept(t, studentId, UNIT1, 1);
    await introduceConcept(t, studentId, UNIT2, 9);
    const res = await asUser(t).query(
      api.learningEngine.groupPlan.revisionQueuesForSlotDate,
      { slotId: revSlotId!, dateStr: '2026-07-18' },
    );
    const queue = res!.queues[studentId as unknown as string].questionIds;
    expect(queue).toEqual([qids[UNIT2][0], qids[UNIT1][1], qids[UNIT1][2]]);
  });

  it('a fully planned term never locks curation — planned claims stay editable', async () => {
    // THE founder "tick button not working" root cause (2026-07-19): the
    // seen-set counts PLANNED (re-pickable) group claims, and curation
    // locked every seen question — so after "Run all term sheets" every
    // tick in the Lesson Builder silently ignored taps.
    const t = convexTest(schema, modules);
    const { groupId, qids } = await seed(t);
    await asUser(t).mutation(
      api.learningEngine.groupPlan.crystallizeUpcoming,
      { groupId, daysAhead: 170 },
    );
    const curation = await asUser(t).query(
      api.learningEngine.groupPlan.groupUnitCuration,
      { groupId, unitId: UNIT1 },
    );
    expect(curation?.status).toBe('ok');
    if (curation?.status !== 'ok') return;
    const byId = new Map(curation.questions.map((q) => [q.questionId, q]));
    // q1 sits on a planned sheet: claimed, but NOT taught → still editable.
    expect(byId.get(qids[UNIT1][0])!.taught).toBe(false);
    expect(byId.get(qids[UNIT1][0])!.planned).toBe(true);
    // Overriding still works: send the hard tail to Revision by hand.
    await asUser(t).mutation(api.learningEngine.groupPlan.setQuestionRoutes, {
      groupId,
      unitId: UNIT1,
      routes: [{ questionId: qids[UNIT1][3], route: 'revision' }],
    });
    const after = await asUser(t).query(
      api.learningEngine.groupPlan.groupUnitCuration,
      { groupId, unitId: UNIT1 },
    );
    if (after?.status !== 'ok') throw new Error('curation failed');
    expect(
      after.questions.find((q) => q.questionId === qids[UNIT1][3])!.route,
    ).toBe('revision');
  });

  it('a MATERIALIZED (taught) sheet does lock its questions', async () => {
    const t = convexTest(schema, modules);
    const { groupId, qids } = await seed(t);
    await asUser(t).mutation(
      api.learningEngine.groupPlan.crystallizeUpcoming,
      { groupId, daysAhead: 60 },
    );
    await t.run(async (ctx) => {
      const first = (await ctx.db.query('groupSheets').collect()).sort(
        (a, b) => a.date.localeCompare(b.date),
      )[0];
      await ctx.db.patch(first._id, { status: 'materialized' });
    });
    const curation = await asUser(t).query(
      api.learningEngine.groupPlan.groupUnitCuration,
      { groupId, unitId: UNIT1 },
    );
    if (curation?.status !== 'ok') throw new Error('curation failed');
    const taughtIds = curation.questions
      .filter((q) => q.taught)
      .map((q) => q.questionId);
    expect(taughtIds.length).toBeGreaterThan(0);
    expect(taughtIds).toContain(qids[UNIT1][0]);
  });

  it('compressionPreview: middle is already auto-routed, intro + hardest propose green', async () => {
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
    // q2+q3 derive yellow via the auto-split default → already out of the
    // movable remainder; only intro + hard tail remain, both kept green.
    expect(preview.alreadyRouted).toBe(2);
    const byId = new Map(
      preview.questions.map((q) => [q.questionId, q.propose]),
    );
    expect(byId.get(qids[UNIT1][0])).toBe('main');
    expect(byId.get(qids[UNIT1][3])).toBe('main');
    expect(byId.has(qids[UNIT1][1])).toBe(false);
    expect(byId.has(qids[UNIT1][2])).toBe(false);
  });

  it('compression still works when the whole term is already planned', async () => {
    // Founder bug 2026-07-18: after "Run all term sheets" every question is
    // claimed by a PLANNED row, and "+ unit" reported "everything covered".
    // Planned rows are re-pickable, so their questions must stay movable.
    const t = convexTest(schema, modules);
    const { groupId, qids } = await seed(t);
    await asUser(t).mutation(
      api.learningEngine.groupPlan.crystallizeUpcoming,
      { groupId, daysAhead: 170 },
    );
    const preview = await asUser(t).query(
      api.learningEngine.groupPlan.compressionPreview,
      { groupId },
    );
    expect(preview?.status).toBe('ok');
    if (preview?.status !== 'ok') return;
    expect(preview.currentUnitId).toBe(UNIT1);
    expect(preview.nextUnitId).toBe(UNIT2);
    // Auto-routed middle (q2, q3) is out; the planned-but-re-pickable
    // intro + hard tail stay movable.
    expect(preview.questions.map((q) => q.questionId).sort()).toEqual(
      [qids[UNIT1][0], qids[UNIT1][3]].sort(),
    );
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
