import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const list = query({
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    return await ctx.db.query("students").collect();
  },
});

export const get = query({
  args: { id: v.id("students") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    return await ctx.db.get(args.id);
  },
});

export const listByCenter = query({
  args: { centerId: v.id("centers") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    return await ctx.db
      .query("students")
      .withIndex("by_center", (q) => q.eq("centerId", args.centerId))
      .collect();
  },
});

export const add = mutation({
  args: {
    name: v.string(),
    schoolGrade: v.number(),
    parentPhone: v.string(),
    schoolName: v.string(),
    centerId: v.optional(v.id("centers")),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    return await ctx.db.insert("students", args);
  },
});

export const update = mutation({
  args: {
    id: v.id("students"),
    name: v.string(),
    schoolGrade: v.number(),
    parentPhone: v.string(),
    schoolName: v.string(),
    centerId: v.optional(v.id("centers")),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    const { id, ...data } = args;
    await ctx.db.patch(id, data);
  },
});

export const setAssignedGrades = mutation({
  args: {
    id: v.id("students"),
    assignedGrades: v.array(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    const student = await ctx.db.get(args.id);
    if (!student) throw new Error("Student not found");
    // School grade is always required to be in the list.
    const grades = Array.from(new Set([student.schoolGrade, ...args.assignedGrades]))
      .filter((g) => g <= student.schoolGrade && g >= 6)
      .sort((a, b) => b - a);
    await ctx.db.patch(args.id, { assignedGrades: grades });
  },
});

export const setAssignedGradesForModule = mutation({
  args: {
    id: v.id("students"),
    moduleId: v.string(),
    assignedGrades: v.optional(v.array(v.number())), // undefined → clear override
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    const student = await ctx.db.get(args.id);
    if (!student) throw new Error("Student not found");
    const current = (student.assignedGradesByModule ?? {}) as Record<string, number[]>;
    if (args.assignedGrades === undefined) {
      const next = { ...current };
      delete next[args.moduleId];
      await ctx.db.patch(args.id, { assignedGradesByModule: next });
      return;
    }
    const grades = Array.from(new Set([student.schoolGrade, ...args.assignedGrades]))
      .filter((g) => g <= student.schoolGrade && g >= 6)
      .sort((a, b) => b - a);
    await ctx.db.patch(args.id, {
      assignedGradesByModule: { ...current, [args.moduleId]: grades },
    });
  },
});

export const remove = mutation({
  args: { id: v.id("students") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");

    // Delete all entries for this student
    const entries = await ctx.db
      .query("entries")
      .withIndex("by_student", (q) => q.eq("studentId", args.id))
      .collect();
    for (const entry of entries) {
      await ctx.db.delete(entry._id);
    }

    // Delete slot assignments
    const slotStudents = await ctx.db
      .query("slotStudents")
      .withIndex("by_student", (q) => q.eq("studentId", args.id))
      .collect();
    for (const ss of slotStudents) await ctx.db.delete(ss._id);

    // Delete attendance records
    const attendance = await ctx.db
      .query("attendance")
      .withIndex("by_student", (q) => q.eq("studentId", args.id))
      .collect();
    for (const a of attendance) await ctx.db.delete(a._id);

    await ctx.db.delete(args.id);
  },
});
