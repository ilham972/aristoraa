// @vitest-environment edge-runtime
//
// Integration tests for exercises.setReview — the reconcile path that lets the
// Book-entry Rev toggle add or remove a unit's `N.0` review exercise AFTER the
// unit already has exercises (the toggle used to freeze once exercises existed).

import { describe, it, expect } from 'vitest';
import { convexTest } from 'convex-test';
import { api } from '../convex/_generated/api';
import schema from '../convex/schema';

const modules = import.meta.glob('../convex/**/*.ts');
const asUser = (t: ReturnType<typeof convexTest>) =>
  t.withIdentity({ name: 'Tutor', subject: 'tutor-1' });

const namesFor = (t: ReturnType<typeof convexTest>, unitId: string) =>
  t.run(async (ctx) =>
    (await ctx.db.query('exercises').collect())
      .filter((e) => e.unitId === unitId)
      .map((e) => e.name)
      .sort(),
  );

describe('exercises.setReview', () => {
  it('adds the N.0 review exercise to a unit that already has exercises', async () => {
    const t = convexTest(schema, modules);
    // Seed a unit with exercises but no review (like a bulkAdd with hasReview:false).
    await asUser(t).mutation(api.exercises.bulkAdd, {
      unitId: 'u1', unitNumber: 5, lastExercise: 3, hasReview: false,
    });
    expect(await namesFor(t, 'u1')).toEqual(['5.1', '5.2', '5.3']);

    await asUser(t).mutation(api.exercises.setReview, {
      unitId: 'u1', unitNumber: 5, hasReview: true,
    });
    expect(await namesFor(t, 'u1')).toEqual(['5.0', '5.1', '5.2', '5.3']);
  });

  it('removes the N.0 review exercise (and its entries) when toggled off', async () => {
    const t = convexTest(schema, modules);
    await asUser(t).mutation(api.exercises.bulkAdd, {
      unitId: 'u2', unitNumber: 7, lastExercise: 2, hasReview: true,
    });
    expect(await namesFor(t, 'u2')).toEqual(['7.0', '7.1', '7.2']);

    // Attach a scoring entry to the review exercise to prove cleanup.
    await t.run(async (ctx) => {
      const review = (await ctx.db.query('exercises').collect()).find(
        (e) => e.unitId === 'u2' && e.name === '7.0',
      )!;
      const studentId = await ctx.db.insert('students', {
        name: 'S', schoolGrade: 7, parentPhone: '', schoolName: '',
      });
      await ctx.db.insert('entries', {
        studentId, date: '2026-07-13', exerciseId: review._id,
        unitId: 'u2', moduleId: 'm', questions: {}, correctCount: 0, totalAttempted: 0,
      });
    });

    await asUser(t).mutation(api.exercises.setReview, {
      unitId: 'u2', unitNumber: 7, hasReview: false,
    });
    expect(await namesFor(t, 'u2')).toEqual(['7.1', '7.2']);
    const orphanEntries = await t.run(async (ctx) =>
      (await ctx.db.query('entries').collect()).length,
    );
    expect(orphanEntries).toBe(0);
  });

  it('is a no-op when the review state already matches', async () => {
    const t = convexTest(schema, modules);
    await asUser(t).mutation(api.exercises.bulkAdd, {
      unitId: 'u3', unitNumber: 9, lastExercise: 2, hasReview: true,
    });
    await asUser(t).mutation(api.exercises.setReview, {
      unitId: 'u3', unitNumber: 9, hasReview: true,
    });
    expect(await namesFor(t, 'u3')).toEqual(['9.0', '9.1', '9.2']);
  });
});
