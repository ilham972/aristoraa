import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

// List all submissions (for a teacher)
export const listByTeacher = query({
  args: { teacherId: v.id("teachers") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    return await ctx.db
      .query("sessionSubmissions")
      .withIndex("by_teacher", (q) => q.eq("teacherId", args.teacherId))
      .collect();
  },
});

// Check if a specific slot+date is submitted
export const getBySlotAndDate = query({
  args: { slotId: v.id("scheduleSlots"), date: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const results = await ctx.db
      .query("sessionSubmissions")
      .withIndex("by_slot_date", (q) => q.eq("slotId", args.slotId).eq("date", args.date))
      .collect();
    return results[0] ?? null;
  },
});

// Submit a session - writes attendance records + submission record
export const submit = mutation({
  args: {
    slotId: v.id("scheduleSlots"),
    date: v.string(),
    teacherId: v.id("teachers"),
    presentStudentIds: v.array(v.id("students")),
    finishedStudentIds: v.array(v.id("students")),
    allStudentIds: v.array(v.id("students")),
    entryCount: v.number(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");

    // Validate all present students are finished
    const presentSet = new Set(args.presentStudentIds);
    const finishedSet = new Set(args.finishedStudentIds);
    for (const sid of args.presentStudentIds) {
      if (!finishedSet.has(sid)) {
        throw new Error("All present students must be finished before submitting");
      }
    }

    // Check not already submitted
    const existing = await ctx.db
      .query("sessionSubmissions")
      .withIndex("by_slot_date", (q) => q.eq("slotId", args.slotId).eq("date", args.date))
      .first();
    if (existing) throw new Error("Session already submitted");

    // Write attendance records for present students
    for (const sid of args.presentStudentIds) {
      // Check if attendance record already exists
      const existingAtt = await ctx.db
        .query("attendance")
        .withIndex("by_slot_date", (q) => q.eq("slotId", args.slotId).eq("date", args.date))
        .collect();
      const hasRecord = existingAtt.some(a => a.studentId === sid);
      if (!hasRecord) {
        await ctx.db.insert("attendance", {
          studentId: sid,
          slotId: args.slotId,
          date: args.date,
          status: "present",
          sessionFinished: finishedSet.has(sid),
        });
      } else {
        // Update existing record
        const rec = existingAtt.find(a => a.studentId === sid);
        if (rec) {
          await ctx.db.patch(rec._id, { status: "present", sessionFinished: finishedSet.has(sid) });
        }
      }
    }

    // Write absent records for students not present
    const absentStudentIds = args.allStudentIds.filter(sid => !presentSet.has(sid));
    for (const sid of absentStudentIds) {
      const existingAtt = await ctx.db
        .query("attendance")
        .withIndex("by_slot_date", (q) => q.eq("slotId", args.slotId).eq("date", args.date))
        .collect();
      const hasRecord = existingAtt.some(a => a.studentId === sid);
      if (!hasRecord) {
        await ctx.db.insert("attendance", {
          studentId: sid,
          slotId: args.slotId,
          date: args.date,
          status: "absent",
          sessionFinished: false,
        });
      }
    }

    // Insert submission record
    const submissionId = await ctx.db.insert("sessionSubmissions", {
      slotId: args.slotId,
      date: args.date,
      teacherId: args.teacherId,
      presentCount: args.presentStudentIds.length,
      absentCount: absentStudentIds.length,
      entryCount: args.entryCount,
      submittedAt: Date.now(),
    });

    return submissionId;
  },
});
