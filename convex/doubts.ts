import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

// Source constants documented in schema.ts
// "correction" | "student-app" | "lead-manual"
// Status: "pending" | "in-progress" | "resolved"

export const listPending = query({
  args: { centerId: v.optional(v.id("centers")) },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    if (args.centerId) {
      return await ctx.db
        .query("doubts")
        .withIndex("by_center_status", (q) =>
          q.eq("centerId", args.centerId).eq("status", "pending")
        )
        .collect();
    }
    return await ctx.db
      .query("doubts")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .collect();
  },
});

export const listBySlotPending = query({
  args: { slotId: v.id("scheduleSlots") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    return await ctx.db
      .query("doubts")
      .withIndex("by_slot_status", (q) =>
        q.eq("slotId", args.slotId).eq("status", "pending")
      )
      .collect();
  },
});

export const listByStudent = query({
  args: { studentId: v.id("students") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    return await ctx.db
      .query("doubts")
      .withIndex("by_student", (q) => q.eq("studentId", args.studentId))
      .collect();
  },
});

// Pending doubts scoped to a single (student, exercise). Used by the
// score-entry page to drive the flag toggle UI for the active exercise.
export const listPendingForStudentExercise = query({
  args: {
    studentId: v.id("students"),
    exerciseId: v.id("exercises"),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const rows = await ctx.db
      .query("doubts")
      .withIndex("by_student_exercise", (q) =>
        q.eq("studentId", args.studentId).eq("exerciseId", args.exerciseId)
      )
      .collect();
    return rows.filter((r) => r.status === "pending");
  },
});

export const create = mutation({
  args: {
    studentId: v.id("students"),
    centerId: v.optional(v.id("centers")),
    slotId: v.optional(v.id("scheduleSlots")),
    source: v.string(),
    exerciseId: v.optional(v.id("exercises")),
    conceptExerciseId: v.optional(v.id("exercises")),
    questionKey: v.optional(v.string()),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    return await ctx.db.insert("doubts", {
      ...args,
      raisedAt: Date.now(),
      status: "pending",
    });
  },
});

// Idempotent flag for a (student, exercise, questionKey) triple.
// If a pending doubt already exists for the same triple, no-ops and returns that id.
// Used by the Correction Officer flag toggle so repeated taps (or reconnects) don't
// create duplicate rows.
export const flagQuestion = mutation({
  args: {
    studentId: v.id("students"),
    exerciseId: v.id("exercises"),
    questionKey: v.string(),
    centerId: v.optional(v.id("centers")),
    slotId: v.optional(v.id("scheduleSlots")),
    source: v.optional(v.string()), // defaults to "correction"
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");

    const existing = await ctx.db
      .query("doubts")
      .withIndex("by_student_exercise", (q) =>
        q.eq("studentId", args.studentId).eq("exerciseId", args.exerciseId)
      )
      .collect();

    const match = existing.find(
      (d) => d.status === "pending" && d.questionKey === args.questionKey
    );
    if (match) return match._id;

    return await ctx.db.insert("doubts", {
      studentId: args.studentId,
      exerciseId: args.exerciseId,
      questionKey: args.questionKey,
      centerId: args.centerId,
      slotId: args.slotId,
      source: args.source ?? "correction",
      note: args.note,
      raisedAt: Date.now(),
      status: "pending",
    });
  },
});

// Remove every pending doubt matching (student, exercise, questionKey).
// Used when the Correction Officer un-flags a question or changes a wrong
// answer back to correct/skipped.
export const removePendingForQuestion = mutation({
  args: {
    studentId: v.id("students"),
    exerciseId: v.id("exercises"),
    questionKey: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");

    const rows = await ctx.db
      .query("doubts")
      .withIndex("by_student_exercise", (q) =>
        q.eq("studentId", args.studentId).eq("exerciseId", args.exerciseId)
      )
      .collect();

    for (const d of rows) {
      if (d.status === "pending" && d.questionKey === args.questionKey) {
        await ctx.db.delete(d._id);
      }
    }
  },
});

export const markInProgress = mutation({
  args: { id: v.id("doubts") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    await ctx.db.patch(args.id, { status: "in-progress" });
  },
});

export const resolve = mutation({
  args: {
    id: v.id("doubts"),
    resolvedByTeacherId: v.optional(v.id("teachers")),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    await ctx.db.patch(args.id, {
      status: "resolved",
      resolvedAt: Date.now(),
      resolvedByTeacherId: args.resolvedByTeacherId,
    });
  },
});

export const remove = mutation({
  args: { id: v.id("doubts") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    await ctx.db.delete(args.id);
  },
});
