import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const listByCenter = query({
  args: { centerId: v.id("centers") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("rooms")
      .withIndex("by_center", (q) => q.eq("centerId", args.centerId))
      .collect();
  },
});

export const list = query({
  handler: async (ctx) => {
    return await ctx.db.query("rooms").collect();
  },
});

export const add = mutation({
  args: {
    centerId: v.id("centers"),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("rooms", args);
  },
});

export const update = mutation({
  args: {
    id: v.id("rooms"),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    const { id, ...data } = args;
    await ctx.db.patch(id, data);
  },
});

export const remove = mutation({
  args: { id: v.id("rooms") },
  handler: async (ctx, args) => {
    // Cascade: slots → slotStudents/slotOverrides/slotTeachers/attendance
    const slots = await ctx.db
      .query("scheduleSlots")
      .withIndex("by_room", (q) => q.eq("roomId", args.id))
      .collect();

    for (const slot of slots) {
      const slotStudents = await ctx.db
        .query("slotStudents")
        .withIndex("by_slot", (q) => q.eq("slotId", slot._id))
        .collect();
      for (const ss of slotStudents) await ctx.db.delete(ss._id);

      const overrides = await ctx.db
        .query("slotOverrides")
        .withIndex("by_slot_date", (q) => q.eq("slotId", slot._id))
        .collect();
      for (const o of overrides) await ctx.db.delete(o._id);

      const slotTeachers = await ctx.db
        .query("slotTeachers")
        .withIndex("by_slot", (q) => q.eq("slotId", slot._id))
        .collect();
      for (const st of slotTeachers) await ctx.db.delete(st._id);

      const attendance = await ctx.db
        .query("attendance")
        .withIndex("by_slot_date", (q) => q.eq("slotId", slot._id))
        .collect();
      for (const a of attendance) await ctx.db.delete(a._id);

      await ctx.db.delete(slot._id);
    }

    await ctx.db.delete(args.id);
  },
});
