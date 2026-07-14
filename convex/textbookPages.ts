import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";

export const generateUploadUrl = mutation({
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    return await ctx.storage.generateUploadUrl();
  },
});

export const savePage = mutation({
  args: {
    textbookId: v.id("textbooks"),
    pageNumber: v.number(),
    storageId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");

    // Check if this page already exists — if so, replace it
    const existing = await ctx.db
      .query("textbookPages")
      .withIndex("by_textbook_page", (q) =>
        q.eq("textbookId", args.textbookId).eq("pageNumber", args.pageNumber)
      )
      .first();

    if (existing) {
      // Delete old storage file and update the record
      await ctx.storage.delete(existing.storageId);
      await ctx.db.patch(existing._id, { storageId: args.storageId });
      return existing._id;
    }

    return await ctx.db.insert("textbookPages", args);
  },
});

export const getByTextbook = query({
  args: { textbookId: v.id("textbooks") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    return await ctx.db
      .query("textbookPages")
      .withIndex("by_textbook", (q) => q.eq("textbookId", args.textbookId))
      .collect();
  },
});

export const getCapturedPageNumbers = query({
  args: { textbookId: v.id("textbooks") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const pages = await ctx.db
      .query("textbookPages")
      .withIndex("by_textbook", (q) => q.eq("textbookId", args.textbookId))
      .collect();
    return pages.map((p) => p.pageNumber);
  },
});

export const getPageImage = query({
  args: {
    textbookId: v.id("textbooks"),
    pageNumber: v.number(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const page = await ctx.db
      .query("textbookPages")
      .withIndex("by_textbook_page", (q) =>
        q.eq("textbookId", args.textbookId).eq("pageNumber", args.pageNumber)
      )
      .first();
    if (!page) return null;
    const url = await ctx.storage.getUrl(page.storageId);
    return url;
  },
});

// Whole-book page list for the Data Entry "Book" tab viewer. Serves the
// downscaled thumbnail variant when available so scrolling a 150+ page book
// stays light on phones; falls back to full-res for pages the "Optimize
// images" backfill hasn't processed yet.
export const listSmallPages = query({
  args: { textbookId: v.id("textbooks") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];

    const pages = await ctx.db
      .query("textbookPages")
      .withIndex("by_textbook", (q) => q.eq("textbookId", args.textbookId))
      .collect();
    pages.sort((a, b) => a.pageNumber - b.pageNumber);

    const results: { pageNumber: number; url: string | null }[] = [];
    for (const p of pages) {
      const url = await ctx.storage.getUrl(p.smallStorageId ?? p.storageId);
      results.push({ pageNumber: p.pageNumber, url });
    }
    return results;
  },
});

export const getPagesInRange = query({
  args: {
    textbookId: v.id("textbooks"),
    startPage: v.number(),
    endPage: v.number(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];

    const allPages = await ctx.db
      .query("textbookPages")
      .withIndex("by_textbook", (q) => q.eq("textbookId", args.textbookId))
      .collect();

    const pageMap = new Map(
      allPages
        .filter((p) => p.pageNumber >= args.startPage && p.pageNumber <= args.endPage)
        .map((p) => [p.pageNumber, p])
    );

    const results: { pageNumber: number; url: string | null; pageId: Id<"textbookPages"> | null }[] = [];
    for (let p = args.startPage; p <= args.endPage; p++) {
      const page = pageMap.get(p);
      if (page) {
        const url = await ctx.storage.getUrl(page.storageId);
        results.push({ pageNumber: p, url, pageId: page._id });
      } else {
        results.push({ pageNumber: p, url: null, pageId: null });
      }
    }

    return results;
  },
});

// Pages for a concept's marked book range, looked up by GRADE (a grade can
// span multiple textbook parts; printed page numbers are continuous across
// them, so we search every part). Powers the Topic Journey reader
// (Settings → Tags → concept tap). Returns the downscaled thumbnail for the
// scrolling list plus the full-res URL + pageId so tapping a page can open
// the pinch-zoom view without a second query. Missing pages come back as
// null-URL slots so the reader can show a placeholder instead of silently
// skipping a page.
export const getSmallPagesByGradeRange = query({
  args: {
    grade: v.number(),
    startPage: v.number(),
    endPage: v.number(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (identity === null) return [];

    // Safety clamp — a concept is a handful of pages; never serve more than
    // 40 even if the marked range is corrupt.
    const endPage = Math.min(args.endPage, args.startPage + 39);
    if (endPage < args.startPage) return [];

    const textbooks = await ctx.db
      .query("textbooks")
      .withIndex("by_grade", (q) => q.eq("grade", args.grade))
      .collect();

    const pageMap = new Map<
      number,
      { storageId: Id<"_storage">; smallStorageId?: Id<"_storage">; _id: Id<"textbookPages"> }
    >();
    for (const tb of textbooks) {
      const pages = await ctx.db
        .query("textbookPages")
        .withIndex("by_textbook", (q) => q.eq("textbookId", tb._id))
        .collect();
      for (const p of pages) {
        if (p.pageNumber >= args.startPage && p.pageNumber <= endPage && !pageMap.has(p.pageNumber)) {
          pageMap.set(p.pageNumber, p);
        }
      }
    }

    const results: {
      pageNumber: number;
      url: string | null;
      fullUrl: string | null;
      pageId: Id<"textbookPages"> | null;
    }[] = [];
    for (let n = args.startPage; n <= endPage; n++) {
      const page = pageMap.get(n);
      if (page) {
        const url = await ctx.storage.getUrl(page.smallStorageId ?? page.storageId);
        const fullUrl = page.smallStorageId ? await ctx.storage.getUrl(page.storageId) : url;
        results.push({ pageNumber: n, url, fullUrl, pageId: page._id });
      } else {
        results.push({ pageNumber: n, url: null, fullUrl: null, pageId: null });
      }
    }
    return results;
  },
});

export const getPagesByGrade = query({
  args: { grade: v.number(), pageNumber: v.number() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;

    // Get all textbooks for this grade
    const textbooks = await ctx.db
      .query("textbooks")
      .withIndex("by_grade", (q) => q.eq("grade", args.grade))
      .collect();

    // Search through each textbook for this page number
    for (const textbook of textbooks) {
      const page = await ctx.db
        .query("textbookPages")
        .withIndex("by_textbook_page", (q) =>
          q.eq("textbookId", textbook._id).eq("pageNumber", args.pageNumber)
        )
        .first();
      if (page) {
        const url = await ctx.storage.getUrl(page.storageId);
        return { url, part: textbook.part, grade: textbook.grade };
      }
    }
    return null;
  },
});

export const removePage = mutation({
  args: {
    textbookId: v.id("textbooks"),
    pageNumber: v.number(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");

    const page = await ctx.db
      .query("textbookPages")
      .withIndex("by_textbook_page", (q) =>
        q.eq("textbookId", args.textbookId).eq("pageNumber", args.pageNumber)
      )
      .first();

    if (page) {
      await ctx.storage.delete(page.storageId);
      await ctx.db.delete(page._id);
    }
  },
});
