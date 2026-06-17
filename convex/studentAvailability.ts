// Per-student weekly availability — the OUTSIDE commitments (night classes,
// other tuition) that block a student from a paper (library) slot. One doc per
// student holding all their busy windows; the editor replaces the whole array.
//
// Personal-class times are NOT stored here — convex/paperClasses.ts derives
// those live from the student's group slots when checking who's free.

import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { ConvexError } from "convex/values";

const busyWindow = v.object({
  dayOfWeek: v.number(),
  startTime: v.string(),
  endTime: v.string(),
  label: v.optional(v.string()),
});

// Busy windows for one student (empty array when none on file).
export const get = query({
  args: { studentId: v.id("students") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const row = await ctx.db
      .query("studentAvailability")
      .withIndex("by_student", (q) => q.eq("studentId", args.studentId))
      .first();
    return row?.busy ?? [];
  },
});

// Replace a student's full set of busy windows. Validates each window's range
// (end after start) so a malformed entry can't silently make everyone "free".
export const set = mutation({
  args: {
    studentId: v.id("students"),
    busy: v.array(busyWindow),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Unauthenticated");

    for (const w of args.busy) {
      if (w.dayOfWeek < 1 || w.dayOfWeek > 7) {
        throw new ConvexError("Day must be 1–7 (Mon–Sun)");
      }
      if (w.endTime <= w.startTime) {
        throw new ConvexError("End time must be after start time");
      }
    }

    const existing = await ctx.db
      .query("studentAvailability")
      .withIndex("by_student", (q) => q.eq("studentId", args.studentId))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, { busy: args.busy });
      return existing._id;
    }
    return await ctx.db.insert("studentAvailability", {
      studentId: args.studentId,
      busy: args.busy,
    });
  },
});
