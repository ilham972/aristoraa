import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const list = query({
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    return await ctx.db.query("studentModulePositions").collect();
  },
});

export const set = mutation({
  args: {
    studentId: v.id("students"),
    moduleId: v.string(),
    grade: v.number(),
    term: v.number(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");

    // Upsert: find existing override for this student+module
    const existing = await ctx.db
      .query("studentModulePositions")
      .withIndex("by_student_module", (q) =>
        q.eq("studentId", args.studentId).eq("moduleId", args.moduleId)
      )
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, { grade: args.grade, term: args.term });
    } else {
      await ctx.db.insert("studentModulePositions", {
        studentId: args.studentId,
        moduleId: args.moduleId,
        grade: args.grade,
        term: args.term,
      });
    }
  },
});

export const remove = mutation({
  args: {
    studentId: v.id("students"),
    moduleId: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");

    const existing = await ctx.db
      .query("studentModulePositions")
      .withIndex("by_student_module", (q) =>
        q.eq("studentId", args.studentId).eq("moduleId", args.moduleId)
      )
      .first();

    if (existing) {
      await ctx.db.delete(existing._id);
    }
  },
});
