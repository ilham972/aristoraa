import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const list = query({
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    return await ctx.db.query("textbooks").collect();
  },
});

export const getByGrade = query({
  args: { grade: v.number() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    return await ctx.db
      .query("textbooks")
      .withIndex("by_grade", (q) => q.eq("grade", args.grade))
      .collect();
  },
});

export const create = mutation({
  args: {
    grade: v.number(),
    part: v.number(),
    totalPages: v.number(),
    startUnit: v.optional(v.number()),
    endUnit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");

    // Check if this grade+part already exists
    const existing = await ctx.db
      .query("textbooks")
      .withIndex("by_grade", (q) => q.eq("grade", args.grade))
      .collect();
    const duplicate = existing.find((t) => t.part === args.part);
    if (duplicate) throw new Error(`Grade ${args.grade} Part ${args.part} already exists`);

    return await ctx.db.insert("textbooks", args);
  },
});

export const update = mutation({
  args: {
    id: v.id("textbooks"),
    totalPages: v.number(),
    startUnit: v.optional(v.number()),
    endUnit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    const { id, ...data } = args;
    await ctx.db.patch(id, data);
  },
});

export const remove = mutation({
  args: { id: v.id("textbooks") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");

    // Delete all captured pages for this textbook
    const pages = await ctx.db
      .query("textbookPages")
      .withIndex("by_textbook", (q) => q.eq("textbookId", args.id))
      .collect();
    for (const page of pages) {
      await ctx.storage.delete(page.storageId);
      await ctx.db.delete(page._id);
    }

    await ctx.db.delete(args.id);
  },
});
