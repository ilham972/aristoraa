import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const list = query({
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    return await ctx.db.query("entries").collect();
  },
});

export const getByDate = query({
  args: { date: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    return await ctx.db
      .query("entries")
      .withIndex("by_date", (q) => q.eq("date", args.date))
      .collect();
  },
});

export const getByStudent = query({
  args: { studentId: v.id("students") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    return await ctx.db
      .query("entries")
      .withIndex("by_student", (q) => q.eq("studentId", args.studentId))
      .collect();
  },
});

export const getByStudentAndDate = query({
  args: { studentId: v.id("students"), date: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    return await ctx.db
      .query("entries")
      .withIndex("by_student_date", (q) =>
        q.eq("studentId", args.studentId).eq("date", args.date)
      )
      .collect();
  },
});

export const add = mutation({
  args: {
    studentId: v.id("students"),
    date: v.string(),
    exerciseId: v.id("exercises"),
    unitId: v.string(),
    moduleId: v.string(),
    questions: v.any(),
    correctCount: v.number(),
    totalAttempted: v.number(),
    slotId: v.optional(v.id("scheduleSlots")),
    centerId: v.optional(v.id("centers")),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    return await ctx.db.insert("entries", args);
  },
});

export const listByCenter = query({
  args: { centerId: v.id("centers") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    return await ctx.db
      .query("entries")
      .withIndex("by_center", (q) => q.eq("centerId", args.centerId))
      .collect();
  },
});

export const update = mutation({
  args: {
    id: v.id("entries"),
    questions: v.any(),
    correctCount: v.number(),
    totalAttempted: v.number(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    const { id, ...data } = args;
    await ctx.db.patch(id, data);
  },
});

export const remove = mutation({
  args: { id: v.id("entries") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    await ctx.db.delete(args.id);
  },
});
