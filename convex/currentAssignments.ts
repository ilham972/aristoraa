import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

// Lead's per-student "next task" queue. One row per (studentId, date) — upserted
// on assign, cleared on completion or reassignment. Phase 4 tablet reads this
// to render the student's home card.

export const listByDate = query({
  args: { date: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    return await ctx.db
      .query("currentAssignments")
      .withIndex("by_date", (q) => q.eq("date", args.date))
      .collect();
  },
});

export const listBySlotDate = query({
  args: { slotId: v.id("scheduleSlots"), date: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    return await ctx.db
      .query("currentAssignments")
      .withIndex("by_slot_date", (q) =>
        q.eq("slotId", args.slotId).eq("date", args.date)
      )
      .collect();
  },
});

export const getForStudent = query({
  args: { studentId: v.id("students"), date: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const row = await ctx.db
      .query("currentAssignments")
      .withIndex("by_student_date", (q) =>
        q.eq("studentId", args.studentId).eq("date", args.date)
      )
      .first();
    return row ?? null;
  },
});

// Upsert: if a row for (studentId, date) already exists, overwrite it.
// Lead picks one assignment at a time per student per day.
export const assign = mutation({
  args: {
    studentId: v.id("students"),
    date: v.string(),
    slotId: v.optional(v.id("scheduleSlots")),
    type: v.string(), // "exercise" | "concept" | "redo" | "resting"
    exerciseId: v.optional(v.id("exercises")),
    redoEntryId: v.optional(v.id("entries")),
    redoQuestionKey: v.optional(v.string()),
    note: v.optional(v.string()),
    assignedByTeacherId: v.optional(v.id("teachers")),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");

    if (!["exercise", "concept", "redo", "resting"].includes(args.type)) {
      throw new Error("Invalid assignment type");
    }

    const existing = await ctx.db
      .query("currentAssignments")
      .withIndex("by_student_date", (q) =>
        q.eq("studentId", args.studentId).eq("date", args.date)
      )
      .first();

    const payload = {
      studentId: args.studentId,
      date: args.date,
      slotId: args.slotId,
      type: args.type,
      exerciseId: args.exerciseId,
      redoEntryId: args.redoEntryId,
      redoQuestionKey: args.redoQuestionKey,
      note: args.note,
      assignedAt: Date.now(),
      assignedByTeacherId: args.assignedByTeacherId,
      completedAt: undefined,
    };

    if (existing) {
      await ctx.db.patch(existing._id, payload);
      return existing._id;
    }
    return await ctx.db.insert("currentAssignments", payload);
  },
});

export const markCompleted = mutation({
  args: { id: v.id("currentAssignments") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    await ctx.db.patch(args.id, { completedAt: Date.now() });
  },
});

export const clear = mutation({
  args: { studentId: v.id("students"), date: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    const rows = await ctx.db
      .query("currentAssignments")
      .withIndex("by_student_date", (q) =>
        q.eq("studentId", args.studentId).eq("date", args.date)
      )
      .collect();
    for (const r of rows) await ctx.db.delete(r._id);
  },
});
