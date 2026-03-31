import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

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
