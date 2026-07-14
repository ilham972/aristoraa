// @vitest-environment edge-runtime
//
// Integration tests for textbookPages.getSmallPagesByGradeRange — the query
// behind the Topic Journey reader (Settings → Tags → tap a concept). A grade
// can span multiple textbook parts with continuous printed page numbers, so
// the query must search every part of the grade and return ordered slots,
// with null URLs for pages that were never uploaded.

import { describe, it, expect } from 'vitest';
import { convexTest } from 'convex-test';
import { api } from '../convex/_generated/api';
import schema from '../convex/schema';

const modules = import.meta.glob('../convex/**/*.ts');
const asUser = (t: ReturnType<typeof convexTest>) =>
  t.withIdentity({ name: 'Tutor', subject: 'tutor-1' });

async function seedGrade8(t: ReturnType<typeof convexTest>) {
  return t.run(async (ctx) => {
    const part1 = await ctx.db.insert('textbooks', { grade: 8, part: 1, totalPages: 100 });
    const part2 = await ctx.db.insert('textbooks', { grade: 8, part: 2, totalPages: 100 });
    const store = () => ctx.storage.store(new Blob(['img']));
    // Pages 10–11 live in part 1; page 12 in part 2 (continuous numbering).
    await ctx.db.insert('textbookPages', { textbookId: part1, pageNumber: 10, storageId: await store() });
    // Page 11 has an optimized thumbnail variant.
    await ctx.db.insert('textbookPages', {
      textbookId: part1, pageNumber: 11, storageId: await store(), smallStorageId: await store(),
    });
    await ctx.db.insert('textbookPages', { textbookId: part2, pageNumber: 12, storageId: await store() });
  });
}

describe('textbookPages.getSmallPagesByGradeRange', () => {
  it('returns ordered slots across parts, null for missing pages', async () => {
    const t = convexTest(schema, modules);
    await seedGrade8(t);

    const res = await asUser(t).query(api.textbookPages.getSmallPagesByGradeRange, {
      grade: 8, startPage: 10, endPage: 13,
    });

    expect(res.map((r) => r.pageNumber)).toEqual([10, 11, 12, 13]);
    expect(res[0].url).toBeTruthy();
    expect(res[1].url).toBeTruthy();
    expect(res[2].url).toBeTruthy(); // page 12 found in part 2
    expect(res[3].url).toBeNull(); // page 13 never uploaded
    expect(res[3].pageId).toBeNull();
  });

  it('serves the thumbnail as url and full-res as fullUrl when both exist', async () => {
    const t = convexTest(schema, modules);
    await seedGrade8(t);

    const res = await asUser(t).query(api.textbookPages.getSmallPagesByGradeRange, {
      grade: 8, startPage: 10, endPage: 11,
    });

    // Page 10 has no thumbnail — url and fullUrl are the same full-res file.
    expect(res[0].url).toBe(res[0].fullUrl);

    // Page 11 has a thumbnail — url must resolve the small variant and
    // fullUrl the original storage file.
    const { smallUrl, fullUrl } = await t.run(async (ctx) => {
      const page11 = (await ctx.db.query('textbookPages').collect()).find(
        (p) => p.pageNumber === 11,
      )!;
      return {
        smallUrl: await ctx.storage.getUrl(page11.smallStorageId!),
        fullUrl: await ctx.storage.getUrl(page11.storageId),
      };
    });
    expect(res[1].url).toBe(smallUrl);
    expect(res[1].fullUrl).toBe(fullUrl);
  });

  it('returns null slots for a grade with no matching pages', async () => {
    const t = convexTest(schema, modules);
    await seedGrade8(t);

    const res = await asUser(t).query(api.textbookPages.getSmallPagesByGradeRange, {
      grade: 9, startPage: 10, endPage: 11,
    });
    expect(res).toHaveLength(2);
    expect(res.every((r) => r.url === null)).toBe(true);
  });

  it('clamps runaway ranges to 40 pages and rejects inverted ranges', async () => {
    const t = convexTest(schema, modules);
    await seedGrade8(t);

    const huge = await asUser(t).query(api.textbookPages.getSmallPagesByGradeRange, {
      grade: 8, startPage: 1, endPage: 1000,
    });
    expect(huge).toHaveLength(40);

    const inverted = await asUser(t).query(api.textbookPages.getSmallPagesByGradeRange, {
      grade: 8, startPage: 20, endPage: 10,
    });
    expect(inverted).toEqual([]);
  });

  it('returns [] when unauthenticated', async () => {
    const t = convexTest(schema, modules);
    await seedGrade8(t);
    const res = await t.query(api.textbookPages.getSmallPagesByGradeRange, {
      grade: 8, startPage: 10, endPage: 11,
    });
    expect(res).toEqual([]);
  });
});
