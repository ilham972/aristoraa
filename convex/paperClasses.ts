// Paper classes — the "Library" feature, STUDENT-CENTRIC redesign (2026-06-18).
//
// The unit is a per-student assignment to a 1-hour weekly slot (paperAssignments),
// NOT a room+teacher block. The Library grid is built by tap-and-dropping student
// pills onto hour slots; rooms + teachers are assigned later inside a slot's
// dialog and are OPTIONAL. Billing is flat 100 LKR / student / DAY, driven by a
// single daily roll-call (paperAttendance, one row per student+date).
//
// Deliberately separate from scheduleSlots — paper classes never touch sheets,
// scoring, the learning engine, or the leaderboard. Scope = attendance + billing.

import { query, mutation } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import { ConvexError } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { paperRevenue } from "./lib/paperClasses";

// ── Helpers ───────────────────────────────────────────────────────────────

// "YYYY-MM-DD" → our 1=Mon..7=Sun day-of-week (JS getDay is 0=Sun..6=Sat).
function dayOfWeekFromYmd(ymd: string): number {
  const js = new Date(ymd + "T00:00:00").getDay();
  return js === 0 ? 7 : js;
}

type StudentLite = { studentId: Id<"students">; name: string; schoolGrade: number };

// ── Queries ───────────────────────────────────────────────────────────────

// The student pill rail: every student with their assigned paper-hours count
// (each assignment = one 1-hour atom). Sorted lightest-load first so the
// under-served students (red pills) surface to the top — the rail IS the
// "plan student" surface now. Colour tiers are computed client-side from hours.
export const rail = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];

    const [students, assignments] = await Promise.all([
      ctx.db.query("students").collect(),
      ctx.db.query("paperAssignments").collect(),
    ]);

    const hoursByStudent = new Map<string, number>();
    for (const a of assignments) {
      hoursByStudent.set(String(a.studentId), (hoursByStudent.get(String(a.studentId)) ?? 0) + 1);
    }

    return students
      .map((s) => ({
        studentId: s._id,
        name: s.name,
        schoolGrade: s.schoolGrade,
        assignedHours: hoursByStudent.get(String(s._id)) ?? 0,
      }))
      .sort((a, b) => a.assignedHours - b.assignedHours || a.name.localeCompare(b.name));
  },
});

// The whole-week grid: one cell per occupied (day, hour) slot with a student
// count. The Library grid renders dots + count from this.
export const weekGrid = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return { cells: [] };

    const assignments = await ctx.db.query("paperAssignments").collect();
    const byCell = new Map<string, { dayOfWeek: number; startTime: string; endTime: string; count: number }>();
    for (const a of assignments) {
      const key = `${a.dayOfWeek}|${a.startTime}`;
      const cur = byCell.get(key);
      if (cur) cur.count += 1;
      else byCell.set(key, { dayOfWeek: a.dayOfWeek, startTime: a.startTime, endTime: a.endTime, count: 1 });
    }
    return { cells: Array.from(byCell.values()) };
  },
});

// One student's whole-week map for the highlight overlay: their paper slots,
// their theory (personal-class) slots, and their outside busy windows. Tapping
// a pill fetches this so the grid can light up where they're already committed.
export const studentMap = query({
  args: { studentId: v.id("students") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;

    // Paper slots they already sit in.
    const assignments = await ctx.db
      .query("paperAssignments")
      .withIndex("by_student", (q) => q.eq("studentId", args.studentId))
      .collect();
    const paperSlots = assignments.map((a) => ({ dayOfWeek: a.dayOfWeek, startTime: a.startTime }));

    // Theory slots — the student's group scheduleSlots.
    const memberships = await ctx.db
      .query("groupMembers")
      .withIndex("by_student", (q) => q.eq("studentId", args.studentId))
      .collect();
    const theorySlots: Array<{ dayOfWeek: number; startTime: string; endTime: string; groupName: string }> = [];
    for (const m of memberships) {
      const group = await ctx.db.get(m.groupId);
      const slots = await ctx.db
        .query("scheduleSlots")
        .withIndex("by_group", (q) => q.eq("groupId", m.groupId))
        .collect();
      for (const s of slots) {
        theorySlots.push({
          dayOfWeek: s.dayOfWeek,
          startTime: s.startTime,
          endTime: s.endTime,
          groupName: group?.name ?? "?",
        });
      }
    }

    // Outside busy windows.
    const avail = await ctx.db
      .query("studentAvailability")
      .withIndex("by_student", (q) => q.eq("studentId", args.studentId))
      .first();
    const busy = (avail?.busy ?? []).map((w) => ({
      dayOfWeek: w.dayOfWeek,
      startTime: w.startTime,
      endTime: w.endTime,
      label: w.label,
    }));

    return { paperSlots, theorySlots, busy };
  },
});

// Full detail for one (day, hour) slot — powers the slot dialog. Lists EVERY
// room (so you can drop students into any), each with its assigned students +
// optional supervising teacher, plus an "unassigned" bucket for students in
// the slot not yet placed in a room.
export const slot = query({
  args: { dayOfWeek: v.number(), startTime: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;

    const assignments = await ctx.db
      .query("paperAssignments")
      .withIndex("by_slot", (q) => q.eq("dayOfWeek", args.dayOfWeek).eq("startTime", args.startTime))
      .collect();

    // 1-hour atoms, so end = start + 1h when the slot has no rows to read it from.
    const nextHour = `${String(Number(args.startTime.split(":")[0]) + 1).padStart(2, "0")}:00`;
    const endTime = assignments[0]?.endTime ?? nextHour;

    // Resolve student lites once.
    const studentLite = async (id: Id<"students">): Promise<StudentLite | null> => {
      const s = await ctx.db.get(id);
      return s ? { studentId: s._id, name: s.name, schoolGrade: s.schoolGrade } : null;
    };

    const [rooms, teachers, slotTeachers] = await Promise.all([
      ctx.db.query("rooms").collect(),
      ctx.db.query("teachers").collect(),
      ctx.db
        .query("paperSlotTeachers")
        .withIndex("by_slot", (q) => q.eq("dayOfWeek", args.dayOfWeek).eq("startTime", args.startTime))
        .collect(),
    ]);
    const teacherName = new Map(teachers.map((t) => [String(t._id), t.name]));
    const teacherByRoom = new Map(slotTeachers.map((r) => [String(r.roomId), r.teacherId]));

    // Group assigned students by room (null roomId → unassigned).
    const byRoom = new Map<string, StudentLite[]>();
    const unassigned: StudentLite[] = [];
    for (const a of assignments) {
      const lite = await studentLite(a.studentId);
      if (!lite) continue;
      if (a.roomId) {
        const k = String(a.roomId);
        const arr = byRoom.get(k) ?? [];
        arr.push(lite);
        byRoom.set(k, arr);
      } else {
        unassigned.push(lite);
      }
    }
    const sortByName = (arr: StudentLite[]) => arr.sort((a, b) => a.name.localeCompare(b.name));
    sortByName(unassigned);

    const roomCells = rooms.map((r) => {
      const students = sortByName(byRoom.get(String(r._id)) ?? []);
      const teacherId = teacherByRoom.get(String(r._id));
      return {
        roomId: r._id,
        name: r.name,
        capacity: r.capacity,
        teacherId: teacherId ?? null,
        teacherName: teacherId ? (teacherName.get(String(teacherId)) ?? "?") : null,
        students,
      };
    });

    return {
      dayOfWeek: args.dayOfWeek,
      startTime: args.startTime,
      endTime,
      total: assignments.length,
      rooms: roomCells,
      unassigned,
    };
  },
});

// The day's Library roll-call roster: every student with a paper assignment on
// that date's weekday, plus their saved attendance status (default present).
// Drives the Session-view "Library" pill roll-call + the daily revenue.
export const dayRoster = query({
  args: { date: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return { date: args.date, students: [] as Array<StudentLite & { present: boolean }> };

    const dow = dayOfWeekFromYmd(args.date);
    const assignments = await ctx.db
      .query("paperAssignments")
      .withIndex("by_day", (q) => q.eq("dayOfWeek", dow))
      .collect();
    const studentIds = Array.from(new Set(assignments.map((a) => String(a.studentId))));

    const attendance = await ctx.db
      .query("paperAttendance")
      .withIndex("by_date", (q) => q.eq("date", args.date))
      .collect();
    const statusByStudent = new Map(attendance.map((r) => [String(r.studentId), r.status]));

    const students: Array<StudentLite & { present: boolean }> = [];
    for (const sid of studentIds) {
      const s = await ctx.db.get(sid as Id<"students">);
      if (!s) continue;
      students.push({
        studentId: s._id,
        name: s.name,
        schoolGrade: s.schoolGrade,
        present: statusByStudent.get(sid) !== "absent", // default present
      });
    }
    students.sort((a, b) => a.name.localeCompare(b.name));
    return { date: args.date, students };
  },
});

// Flat-100/day paper revenue for a single date + count of present students.
// Drives the Library view's daily read-out.
export const revenueForDate = query({
  args: { date: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return { total: 0, presentStudents: 0 };

    const rows = await ctx.db
      .query("paperAttendance")
      .withIndex("by_date", (q) => q.eq("date", args.date))
      .collect();
    const total = paperRevenue(rows.map((r) => ({ studentId: r.studentId, date: r.date, status: r.status })));
    const presentStudents = rows.filter((r) => r.status === "present").length;
    return { total, presentStudents };
  },
});

// Realized paper revenue over the last `days` days (flat 100/student/day).
// Returns total, billed student-days, and a per-day series for the analytics
// finance card. Reported separately from personal-class (250/hr) revenue.
export const paperRevenueRange = query({
  args: { days: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return { total: 0, studentDays: 0, days: 0, perDay: [] };

    const days = Math.min(Math.max(args.days ?? 30, 1), 90);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const ymd = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const cutoff = new Date(today);
    cutoff.setDate(cutoff.getDate() - (days - 1));
    const cutoffYmd = ymd(cutoff);

    const rows = (await ctx.db.query("paperAttendance").collect()).filter(
      (r) => r.status === "present" && r.date >= cutoffYmd,
    );

    const billed = new Set<string>();
    const byDay = new Map<string, Set<string>>();
    for (const r of rows) {
      billed.add(`${r.studentId}|${r.date}`);
      const set = byDay.get(r.date) ?? new Set<string>();
      set.add(String(r.studentId));
      byDay.set(r.date, set);
    }

    const perDay: Array<{ date: string; revenue: number }> = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - (days - 1 - i));
      const key = ymd(d);
      perDay.push({ date: key, revenue: (byDay.get(key)?.size ?? 0) * 100 });
    }

    return { total: billed.size * 100, studentDays: billed.size, days, perDay };
  },
});

// ── Mutations ───────────────────────────────────────────────────────────────

async function requireAuth(ctx: QueryCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError("Unauthenticated");
}

// Drop a student into a (day, hour) slot. Idempotent — re-adding is a no-op.
// roomId is left unset (placed later in the slot dialog).
export const assign = mutation({
  args: {
    studentId: v.id("students"),
    dayOfWeek: v.number(),
    startTime: v.string(),
    endTime: v.string(),
  },
  handler: async (ctx, args) => {
    await requireAuth(ctx);
    const existing = await ctx.db
      .query("paperAssignments")
      .withIndex("by_slot", (q) => q.eq("dayOfWeek", args.dayOfWeek).eq("startTime", args.startTime))
      .collect();
    if (existing.some((a) => a.studentId === args.studentId)) return; // already in slot
    await ctx.db.insert("paperAssignments", {
      studentId: args.studentId,
      dayOfWeek: args.dayOfWeek,
      startTime: args.startTime,
      endTime: args.endTime,
    });
  },
});

// Remove a student from a (day, hour) slot entirely (and their room placement
// for it). If this leaves them in zero slots, the rail pill goes red.
export const unassign = mutation({
  args: { studentId: v.id("students"), dayOfWeek: v.number(), startTime: v.string() },
  handler: async (ctx, args) => {
    await requireAuth(ctx);
    const rows = await ctx.db
      .query("paperAssignments")
      .withIndex("by_slot", (q) => q.eq("dayOfWeek", args.dayOfWeek).eq("startTime", args.startTime))
      .collect();
    for (const r of rows) if (r.studentId === args.studentId) await ctx.db.delete(r._id);
  },
});

// Place a student in a room within a slot (or clear with roomId=null). Room is
// physical seating only; capacity is a soft client-side warning, never enforced.
export const setRoom = mutation({
  args: {
    studentId: v.id("students"),
    dayOfWeek: v.number(),
    startTime: v.string(),
    roomId: v.union(v.id("rooms"), v.null()),
  },
  handler: async (ctx, args) => {
    await requireAuth(ctx);
    const rows = await ctx.db
      .query("paperAssignments")
      .withIndex("by_slot", (q) => q.eq("dayOfWeek", args.dayOfWeek).eq("startTime", args.startTime))
      .collect();
    const target = rows.find((r) => r.studentId === args.studentId);
    if (!target) throw new ConvexError("Student is not in this slot");
    await ctx.db.patch(target._id, { roomId: args.roomId ?? undefined });
  },
});

// Assign / clear the supervising teacher for a (slot, room). teacherId=null
// clears it. Optional — a room can run with no teacher recorded.
export const setSlotTeacher = mutation({
  args: {
    dayOfWeek: v.number(),
    startTime: v.string(),
    roomId: v.id("rooms"),
    teacherId: v.union(v.id("teachers"), v.null()),
  },
  handler: async (ctx, args) => {
    await requireAuth(ctx);
    const rows = await ctx.db
      .query("paperSlotTeachers")
      .withIndex("by_slot", (q) => q.eq("dayOfWeek", args.dayOfWeek).eq("startTime", args.startTime))
      .collect();
    const existing = rows.find((r) => String(r.roomId) === String(args.roomId));
    if (args.teacherId === null) {
      if (existing) await ctx.db.delete(existing._id);
      return;
    }
    if (existing) {
      await ctx.db.patch(existing._id, { teacherId: args.teacherId });
    } else {
      await ctx.db.insert("paperSlotTeachers", {
        dayOfWeek: args.dayOfWeek,
        startTime: args.startTime,
        roomId: args.roomId,
        teacherId: args.teacherId,
      });
    }
  },
});

// Submit the day's Library roll-call. The roster is everyone assigned on that
// date's weekday; anyone NOT in presentStudentIds is marked absent. One
// attendance row per (student, date) — flat 100/day billing reads it.
export const submitDayAttendance = mutation({
  args: { date: v.string(), presentStudentIds: v.array(v.id("students")) },
  handler: async (ctx, args) => {
    await requireAuth(ctx);
    const dow = dayOfWeekFromYmd(args.date);
    const assignments = await ctx.db
      .query("paperAssignments")
      .withIndex("by_day", (q) => q.eq("dayOfWeek", dow))
      .collect();
    const rosterIds = Array.from(new Set(assignments.map((a) => String(a.studentId))));
    const present = new Set(args.presentStudentIds.map(String));

    const existing = await ctx.db
      .query("paperAttendance")
      .withIndex("by_date", (q) => q.eq("date", args.date))
      .collect();
    const byStudent = new Map(existing.map((r) => [String(r.studentId), r]));

    for (const sid of rosterIds) {
      const status = present.has(sid) ? "present" : "absent";
      const prev = byStudent.get(sid);
      if (prev) {
        if (prev.status !== status) await ctx.db.patch(prev._id, { status });
      } else {
        await ctx.db.insert("paperAttendance", {
          studentId: sid as Id<"students">,
          date: args.date,
          status,
        });
      }
    }
  },
});
