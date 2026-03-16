import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const list = query({
  handler: async (ctx) => {
    return await ctx.db.query("students").collect();
  },
});

export const add = mutation({
  args: {
    name: v.string(),
    schoolGrade: v.number(),
    group: v.string(),
    parentPhone: v.string(),
    schoolName: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("students", args);
  },
});

export const update = mutation({
  args: {
    id: v.id("students"),
    name: v.string(),
    schoolGrade: v.number(),
    group: v.string(),
    parentPhone: v.string(),
    schoolName: v.string(),
  },
  handler: async (ctx, args) => {
    const { id, ...data } = args;
    await ctx.db.patch(id, data);
  },
});

export const remove = mutation({
  args: { id: v.id("students") },
  handler: async (ctx, args) => {
    // Delete all entries for this student
    const entries = await ctx.db
      .query("entries")
      .withIndex("by_student", (q) => q.eq("studentId", args.id))
      .collect();
    for (const entry of entries) {
      await ctx.db.delete(entry._id);
    }
    await ctx.db.delete(args.id);
  },
});
