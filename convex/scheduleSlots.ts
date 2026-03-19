import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const list = query({
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    return await ctx.db.query("scheduleSlots").collect();
  },
});

export const listByDay = query({
  args: { dayOfWeek: v.number() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    return await ctx.db
      .query("scheduleSlots")
      .withIndex("by_day", (q) => q.eq("dayOfWeek", args.dayOfWeek))
      .collect();
  },
});

export const listByRoom = query({
  args: { roomId: v.id("rooms") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    return await ctx.db
      .query("scheduleSlots")
      .withIndex("by_room", (q) => q.eq("roomId", args.roomId))
      .collect();
  },
});

export const add = mutation({
  args: {
    dayOfWeek: v.number(),
    startTime: v.string(),
    endTime: v.string(),
    roomId: v.id("rooms"),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    return await ctx.db.insert("scheduleSlots", args);
  },
});

export const update = mutation({
  args: {
    id: v.id("scheduleSlots"),
    dayOfWeek: v.number(),
    startTime: v.string(),
    endTime: v.string(),
    roomId: v.id("rooms"),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    const { id, ...data } = args;
    await ctx.db.patch(id, data);
  },
});

export const remove = mutation({
  args: { id: v.id("scheduleSlots") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");

    // Cascade: slotStudents, slotOverrides, slotTeachers, attendance
    const slotStudents = await ctx.db
      .query("slotStudents")
      .withIndex("by_slot", (q) => q.eq("slotId", args.id))
      .collect();
    for (const ss of slotStudents) await ctx.db.delete(ss._id);

    const overrides = await ctx.db
      .query("slotOverrides")
      .withIndex("by_slot_date", (q) => q.eq("slotId", args.id))
      .collect();
    for (const o of overrides) await ctx.db.delete(o._id);

    const slotTeachers = await ctx.db
      .query("slotTeachers")
      .withIndex("by_slot", (q) => q.eq("slotId", args.id))
      .collect();
    for (const st of slotTeachers) await ctx.db.delete(st._id);

    const attendance = await ctx.db
      .query("attendance")
      .withIndex("by_slot_date", (q) => q.eq("slotId", args.id))
      .collect();
    for (const a of attendance) await ctx.db.delete(a._id);

    await ctx.db.delete(args.id);
  },
});

export const getEffectiveStudents = query({
  args: { slotId: v.id("scheduleSlots"), date: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];

    // Base students assigned to this slot
    const slotStudents = await ctx.db
      .query("slotStudents")
      .withIndex("by_slot", (q) => q.eq("slotId", args.slotId))
      .collect();

    const baseStudentIds = new Set(slotStudents.map((ss) => ss.studentId));

    // Apply overrides for this date
    const overrides = await ctx.db
      .query("slotOverrides")
      .withIndex("by_slot_date", (q) =>
        q.eq("slotId", args.slotId).eq("date", args.date)
      )
      .collect();

    for (const override of overrides) {
      if (override.action === "add") {
        baseStudentIds.add(override.studentId);
      } else if (override.action === "remove") {
        baseStudentIds.delete(override.studentId);
      }
    }

    // Fetch full student records
    const students = [];
    for (const studentId of Array.from(baseStudentIds)) {
      const student = await ctx.db.get(studentId);
      if (student) students.push(student);
    }

    return students;
  },
});
