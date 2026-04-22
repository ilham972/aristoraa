import { query } from "./_generated/server";
import { v } from "convex/values";
import type { Id, Doc } from "./_generated/dataModel";

// Lead's live roster query — single round-trip for the dashboard.
// Returns everything needed to render the student grid + doubt queue.
// Scoped to a slot if provided, otherwise to a center for today.

export const liveRoster = query({
  args: {
    slotId: v.optional(v.id("scheduleSlots")),
    centerId: v.optional(v.id("centers")),
    date: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return {
        students: [],
        latestEntryByStudentId: {},
        pendingDoubtsByStudentId: {},
        positionsByStudentId: {},
        currentAssignmentByStudentId: {},
        attendanceByStudentId: {},
      };
    }

    // Resolve student roster
    let studentIds: Id<"students">[] = [];
    if (args.slotId) {
      const slotStudents = await ctx.db
        .query("slotStudents")
        .withIndex("by_slot", (q) => q.eq("slotId", args.slotId!))
        .collect();
      studentIds = slotStudents.map((s) => s.studentId);
    } else if (args.centerId) {
      const centerStudents = await ctx.db
        .query("students")
        .withIndex("by_center", (q) => q.eq("centerId", args.centerId))
        .collect();
      studentIds = centerStudents.map((s) => s._id);
    } else {
      // Fallback: all students
      const all = await ctx.db.query("students").collect();
      studentIds = all.map((s) => s._id);
    }

    const students: Doc<"students">[] = [];
    for (const id of studentIds) {
      const s = await ctx.db.get(id);
      if (s) students.push(s);
    }

    // Latest entry per student (today only — inferred-state thresholds are
    // only meaningful intra-session).
    const latestEntryByStudentId: Record<string, Doc<"entries">> = {};
    for (const sid of studentIds) {
      const entries = await ctx.db
        .query("entries")
        .withIndex("by_student_date", (q) =>
          q.eq("studentId", sid).eq("date", args.date)
        )
        .collect();
      if (entries.length === 0) continue;
      let latest = entries[0];
      for (const e of entries) {
        if (e._creationTime > latest._creationTime) latest = e;
      }
      latestEntryByStudentId[sid] = latest;
    }

    // Pending doubts grouped by student
    const pendingDoubtsByStudentId: Record<string, Doc<"doubts">[]> = {};
    for (const sid of studentIds) {
      const rows = await ctx.db
        .query("doubts")
        .withIndex("by_student", (q) => q.eq("studentId", sid))
        .collect();
      const pending = rows.filter((r) => r.status === "pending");
      if (pending.length > 0) pendingDoubtsByStudentId[sid] = pending;
    }

    // Module positions grouped by student
    const positionsByStudentId: Record<string, Doc<"studentModulePositions">[]> = {};
    for (const sid of studentIds) {
      const rows = await ctx.db
        .query("studentModulePositions")
        .withIndex("by_student_module", (q) => q.eq("studentId", sid))
        .collect();
      if (rows.length > 0) positionsByStudentId[sid] = rows;
    }

    // Current assignment per student for today
    const currentAssignmentByStudentId: Record<string, Doc<"currentAssignments">> = {};
    for (const sid of studentIds) {
      const row = await ctx.db
        .query("currentAssignments")
        .withIndex("by_student_date", (q) =>
          q.eq("studentId", sid).eq("date", args.date)
        )
        .first();
      if (row) currentAssignmentByStudentId[sid] = row;
    }

    // Attendance for today's slot (so we don't render absentees as "idle")
    const attendanceByStudentId: Record<string, Doc<"attendance">> = {};
    if (args.slotId) {
      const attRows = await ctx.db
        .query("attendance")
        .withIndex("by_slot_date", (q) =>
          q.eq("slotId", args.slotId!).eq("date", args.date)
        )
        .collect();
      for (const a of attRows) attendanceByStudentId[a.studentId] = a;
    }

    return {
      students,
      latestEntryByStudentId,
      pendingDoubtsByStudentId,
      positionsByStudentId,
      currentAssignmentByStudentId,
      attendanceByStudentId,
    };
  },
});
