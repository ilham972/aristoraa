import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const list = query({
  handler: async (ctx) => {
    return await ctx.db.query("exercises").collect();
  },
});

export const getByUnit = query({
  args: { unitId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("exercises")
      .withIndex("by_unit", (q) => q.eq("unitId", args.unitId))
      .collect();
  },
});

export const add = mutation({
  args: {
    unitId: v.string(),
    name: v.string(),
    questionCount: v.number(),
    order: v.number(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("exercises", args);
  },
});

export const update = mutation({
  args: {
    id: v.id("exercises"),
    name: v.string(),
    questionCount: v.number(),
  },
  handler: async (ctx, args) => {
    const { id, ...data } = args;
    await ctx.db.patch(id, data);
  },
});

export const remove = mutation({
  args: { id: v.id("exercises") },
  handler: async (ctx, args) => {
    // Delete all entries for this exercise
    const entries = await ctx.db.query("entries").collect();
    for (const entry of entries) {
      if (entry.exerciseId === args.id) {
        await ctx.db.delete(entry._id);
      }
    }
    await ctx.db.delete(args.id);
  },
});
