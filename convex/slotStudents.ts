import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const listBySlot = query({
  args: { slotId: v.id("scheduleSlots") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    return await ctx.db
      .query("slotStudents")
      .withIndex("by_slot", (q) => q.eq("slotId", args.slotId))
      .collect();
  },
});

export const listByStudent = query({
  args: { studentId: v.id("students") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    return await ctx.db
      .query("slotStudents")
      .withIndex("by_student", (q) => q.eq("studentId", args.studentId))
      .collect();
  },
});

export const assign = mutation({
  args: {
    slotId: v.id("scheduleSlots"),
    studentId: v.id("students"),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    // Check if already assigned
    const existing = await ctx.db
      .query("slotStudents")
      .withIndex("by_slot", (q) => q.eq("slotId", args.slotId))
      .collect();
    if (existing.some((ss) => ss.studentId === args.studentId)) return;
    return await ctx.db.insert("slotStudents", args);
  },
});

export const unassign = mutation({
  args: {
    slotId: v.id("scheduleSlots"),
    studentId: v.id("students"),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    const existing = await ctx.db
      .query("slotStudents")
      .withIndex("by_slot", (q) => q.eq("slotId", args.slotId))
      .collect();
    const match = existing.find((ss) => ss.studentId === args.studentId);
    if (match) await ctx.db.delete(match._id);
  },
});

export const addOverride = mutation({
  args: {
    slotId: v.id("scheduleSlots"),
    studentId: v.id("students"),
    date: v.string(),
    action: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    return await ctx.db.insert("slotOverrides", args);
  },
});

export const removeOverride = mutation({
  args: { id: v.id("slotOverrides") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    await ctx.db.delete(args.id);
  },
});

export const listOverrides = query({
  args: { slotId: v.id("scheduleSlots"), date: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    return await ctx.db
      .query("slotOverrides")
      .withIndex("by_slot_date", (q) =>
        q.eq("slotId", args.slotId).eq("date", args.date)
      )
      .collect();
  },
});
