import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const getBySlotAndDate = query({
  args: { slotId: v.id("scheduleSlots"), date: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    return await ctx.db
      .query("attendance")
      .withIndex("by_slot_date", (q) =>
        q.eq("slotId", args.slotId).eq("date", args.date)
      )
      .collect();
  },
});

export const markPresent = mutation({
  args: {
    studentId: v.id("students"),
    slotId: v.id("scheduleSlots"),
    date: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");

    // Find existing record
    const existing = await ctx.db
      .query("attendance")
      .withIndex("by_slot_date", (q) =>
        q.eq("slotId", args.slotId).eq("date", args.date)
      )
      .collect();
    const record = existing.find((a) => a.studentId === args.studentId);

    if (record) {
      await ctx.db.patch(record._id, { status: "present" });
    } else {
      await ctx.db.insert("attendance", {
        studentId: args.studentId,
        slotId: args.slotId,
        date: args.date,
        status: "present",
      });
    }
  },
});

export const markAbsent = mutation({
  args: {
    studentId: v.id("students"),
    slotId: v.id("scheduleSlots"),
    date: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");

    const existing = await ctx.db
      .query("attendance")
      .withIndex("by_slot_date", (q) =>
        q.eq("slotId", args.slotId).eq("date", args.date)
      )
      .collect();
    const record = existing.find((a) => a.studentId === args.studentId);

    if (record) {
      await ctx.db.patch(record._id, { status: "absent" });
    } else {
      await ctx.db.insert("attendance", {
        studentId: args.studentId,
        slotId: args.slotId,
        date: args.date,
        status: "absent",
      });
    }
  },
});

export const markSessionFinished = mutation({
  args: {
    studentId: v.id("students"),
    slotId: v.id("scheduleSlots"),
    date: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");

    const existing = await ctx.db
      .query("attendance")
      .withIndex("by_slot_date", (q) =>
        q.eq("slotId", args.slotId).eq("date", args.date)
      )
      .collect();
    const record = existing.find((a) => a.studentId === args.studentId);

    if (record) {
      await ctx.db.patch(record._id, { status: "present", sessionFinished: true });
    } else {
      await ctx.db.insert("attendance", {
        studentId: args.studentId,
        slotId: args.slotId,
        date: args.date,
        status: "present",
        sessionFinished: true,
      });
    }
  },
});

export const submitSession = mutation({
  args: {
    slotId: v.id("scheduleSlots"),
    date: v.string(),
    presentStudentIds: v.array(v.id("students")),
    finishedStudentIds: v.array(v.id("students")),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");

    const existing = await ctx.db
      .query("attendance")
      .withIndex("by_slot_date", (q) =>
        q.eq("slotId", args.slotId).eq("date", args.date)
      )
      .collect();

    const finishedSet = new Set(args.finishedStudentIds.map(String));

    for (const studentId of args.presentStudentIds) {
      const isFinished = finishedSet.has(String(studentId));
      const record = existing.find((a) => a.studentId === studentId);
      if (record) {
        await ctx.db.patch(record._id, {
          status: "present",
          ...(isFinished ? { sessionFinished: true } : {}),
        });
      } else {
        await ctx.db.insert("attendance", {
          studentId,
          slotId: args.slotId,
          date: args.date,
          status: "present",
          ...(isFinished ? { sessionFinished: true } : {}),
        });
      }
    }
  },
});

export const getStudentStats = query({
  args: { studentId: v.id("students") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return { present: 0, absent: 0, total: 0 };

    const records = await ctx.db
      .query("attendance")
      .withIndex("by_student", (q) => q.eq("studentId", args.studentId))
      .collect();

    const present = records.filter((r) => r.status === "present").length;
    const absent = records.filter((r) => r.status === "absent").length;
    return { present, absent, total: present + absent };
  },
});
