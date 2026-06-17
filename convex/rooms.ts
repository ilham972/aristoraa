import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const listByCenter = query({
  args: { centerId: v.id("centers") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    return await ctx.db
      .query("rooms")
      .withIndex("by_center", (q) => q.eq("centerId", args.centerId))
      .collect();
  },
});

export const list = query({
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    return await ctx.db.query("rooms").collect();
  },
});

export const add = mutation({
  args: {
    centerId: v.id("centers"),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    return await ctx.db.insert("rooms", args);
  },
});

export const update = mutation({
  args: {
    id: v.id("rooms"),
    name: v.optional(v.string()),
    // Paper-class capacity for this room. null clears it (no cap).
    capacity: v.optional(v.union(v.number(), v.null())),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    const { id, name, capacity } = args;
    const patch: { name?: string; capacity?: number | undefined } = {};
    if (name !== undefined) patch.name = name;
    if (capacity !== undefined) patch.capacity = capacity === null ? undefined : capacity;
    await ctx.db.patch(id, patch);
  },
});

export const setTimetable = mutation({
  args: {
    id: v.id("rooms"),
    moduleTimetable: v.any(), // { "1": "M1", "2": "M2", ... }
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    await ctx.db.patch(args.id, { moduleTimetable: args.moduleTimetable });
  },
});

export const remove = mutation({
  args: { id: v.id("rooms") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");

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
