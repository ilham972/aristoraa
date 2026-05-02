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
    pastPaperId: v.id("pastPapers"),
    pageNumber: v.number(),
    storageId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");

    const existing = await ctx.db
      .query("pastPaperPages")
      .withIndex("by_paper_page", (q) =>
        q.eq("pastPaperId", args.pastPaperId).eq("pageNumber", args.pageNumber)
      )
      .first();

    if (existing) {
      await ctx.storage.delete(existing.storageId);
      await ctx.db.patch(existing._id, { storageId: args.storageId });
      return existing._id;
    }

    return await ctx.db.insert("pastPaperPages", args);
  },
});

export const getByPaper = query({
  args: { pastPaperId: v.id("pastPapers") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    return await ctx.db
      .query("pastPaperPages")
      .withIndex("by_paper", (q) => q.eq("pastPaperId", args.pastPaperId))
      .collect();
  },
});

export const getCapturedPageNumbers = query({
  args: { pastPaperId: v.id("pastPapers") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const pages = await ctx.db
      .query("pastPaperPages")
      .withIndex("by_paper", (q) => q.eq("pastPaperId", args.pastPaperId))
      .collect();
    return pages.map((p) => p.pageNumber);
  },
});

export const getPageImage = query({
  args: {
    pastPaperId: v.id("pastPapers"),
    pageNumber: v.number(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const page = await ctx.db
      .query("pastPaperPages")
      .withIndex("by_paper_page", (q) =>
        q.eq("pastPaperId", args.pastPaperId).eq("pageNumber", args.pageNumber)
      )
      .first();
    if (!page) return null;
    return await ctx.storage.getUrl(page.storageId);
  },
});

export const getPagesInRange = query({
  args: {
    pastPaperId: v.id("pastPapers"),
    startPage: v.number(),
    endPage: v.number(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];

    const allPages = await ctx.db
      .query("pastPaperPages")
      .withIndex("by_paper", (q) => q.eq("pastPaperId", args.pastPaperId))
      .collect();

    const pageMap = new Map(
      allPages
        .filter((p) => p.pageNumber >= args.startPage && p.pageNumber <= args.endPage)
        .map((p) => [p.pageNumber, p])
    );

    const results: { pageNumber: number; url: string | null; pageId: Id<"pastPaperPages"> | null }[] = [];
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

export const removePage = mutation({
  args: {
    pastPaperId: v.id("pastPapers"),
    pageNumber: v.number(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");

    const page = await ctx.db
      .query("pastPaperPages")
      .withIndex("by_paper_page", (q) =>
        q.eq("pastPaperId", args.pastPaperId).eq("pageNumber", args.pageNumber)
      )
      .first();

    if (page) {
      // Cascade: questionBank rows on this page → their questionConcepts joins
      const questions = await ctx.db
        .query("questionBank")
        .withIndex("by_past_paper_page", (q) => q.eq("pastPaperPageId", page._id))
        .collect();
      for (const q of questions) {
        const joins = await ctx.db
          .query("questionConcepts")
          .withIndex("by_question", (jq) => jq.eq("questionId", q._id))
          .collect();
        for (const j of joins) await ctx.db.delete(j._id);
        await ctx.db.delete(q._id);
      }
      await ctx.storage.delete(page.storageId);
      await ctx.db.delete(page._id);
    }
  },
});
