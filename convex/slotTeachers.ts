import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const listBySlot = query({
  args: { slotId: v.id("scheduleSlots") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    return await ctx.db
      .query("slotTeachers")
      .withIndex("by_slot", (q) => q.eq("slotId", args.slotId))
      .collect();
  },
});

export const listByTeacher = query({
  args: { teacherId: v.id("teachers") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    return await ctx.db
      .query("slotTeachers")
      .withIndex("by_teacher", (q) => q.eq("teacherId", args.teacherId))
      .collect();
  },
});

export const assign = mutation({
  args: {
    slotId: v.id("scheduleSlots"),
    teacherId: v.id("teachers"),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    // Check if already assigned
    const existing = await ctx.db
      .query("slotTeachers")
      .withIndex("by_slot", (q) => q.eq("slotId", args.slotId))
      .collect();
    if (existing.some((st) => st.teacherId === args.teacherId)) return;
    return await ctx.db.insert("slotTeachers", args);
  },
});

export const unassign = mutation({
  args: {
    slotId: v.id("scheduleSlots"),
    teacherId: v.id("teachers"),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    const existing = await ctx.db
      .query("slotTeachers")
      .withIndex("by_slot", (q) => q.eq("slotId", args.slotId))
      .collect();
    const match = existing.find((st) => st.teacherId === args.teacherId);
    if (match) await ctx.db.delete(match._id);
  },
});
