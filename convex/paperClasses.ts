// Paper classes — the "Library" feature. Cheap supervised self-study blocks,
// billed flat 100 LKR / student / day. Deliberately separate from the
// scheduleSlots machinery (no sheets, scoring, learning engine, leaderboard).
//
// A paper block = day + time + room (with a capacity) + one required
// supervising teacher + a roster. Students are placed on their FREE days; the
// "free" check combines three sources of busyness for that weekday/time:
//   1. outside commitments  → studentAvailability.busy (night classes, etc.)
//   2. personal classes     → the student's group scheduleSlots (derived live)
//   3. other paper blocks   → blocks they already sit in (excluding this one)
//
// Availability is a WARNING, not a hard block: addStudent still succeeds (the
// UI greys busy candidates) so the lead can override. Room capacity IS a hard
// cap, and a room can't host a paper block that clashes with a personal class.

import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { ConvexError } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import {
  rangesOverlap,
  busyConflict,
  paperRevenue,
  PAPER_RATE_LKR,
  type BusyWindow,
} from "./lib/paperClasses";

// ── Helpers ───────────────────────────────────────────────────────────────

function hoursBetween(start: string, end: string): number {
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  return Math.max(0, eh + em / 60 - (sh + sm / 60));
}

// All the windows that make `studentId` busy on `dayOfWeek`, with a
// human-readable reason on each. `excludeBlockId` drops the block being
// edited so it doesn't count itself as a clash.
async function busyWindowsForDay(
  ctx: { db: any },
  studentId: Id<"students">,
  dayOfWeek: number,
  excludeBlockId?: Id<"paperBlocks">,
): Promise<BusyWindow[]> {
  const windows: BusyWindow[] = [];

  // 1. Outside commitments.
  const avail = await ctx.db
    .query("studentAvailability")
    .withIndex("by_student", (q: any) => q.eq("studentId", studentId))
    .first();
  for (const w of avail?.busy ?? []) {
    if (w.dayOfWeek !== dayOfWeek) continue;
    windows.push({
      dayOfWeek: w.dayOfWeek,
      startTime: w.startTime,
      endTime: w.endTime,
      reason: w.label ? w.label : "Busy (outside class)",
    });
  }

  // 2. Personal classes — group slots on this day.
  const memberships = await ctx.db
    .query("groupMembers")
    .withIndex("by_student", (q: any) => q.eq("studentId", studentId))
    .collect();
  for (const m of memberships) {
    const slots = await ctx.db
      .query("scheduleSlots")
      .withIndex("by_group", (q: any) => q.eq("groupId", m.groupId))
      .collect();
    const group = await ctx.db.get(m.groupId);
    for (const s of slots) {
      if (s.dayOfWeek !== dayOfWeek) continue;
      windows.push({
        dayOfWeek: s.dayOfWeek,
        startTime: s.startTime,
        endTime: s.endTime,
        reason: `Personal class${group ? `: ${group.name}` : ""}`,
      });
    }
  }

  // 3. Other paper blocks they already sit in.
  const inBlocks = await ctx.db
    .query("paperBlockStudents")
    .withIndex("by_student", (q: any) => q.eq("studentId", studentId))
    .collect();
  for (const row of inBlocks) {
    if (excludeBlockId && row.blockId === excludeBlockId) continue;
    const block = await ctx.db.get(row.blockId);
    if (!block || block.dayOfWeek !== dayOfWeek) continue;
    windows.push({
      dayOfWeek: block.dayOfWeek,
      startTime: block.startTime,
      endTime: block.endTime,
      reason: "Another paper block",
    });
  }

  return windows;
}

// ── Queries ───────────────────────────────────────────────────────────────

// Whole-week paper-block grid. One cell per block; room + teacher names and
// capacity folded in so the Library grid renders without client fan-out.
export const weekGrid = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return { cells: [] };

    const [blocks, rooms, teachers] = await Promise.all([
      ctx.db.query("paperBlocks").collect(),
      ctx.db.query("rooms").collect(),
      ctx.db.query("teachers").collect(),
    ]);
    const roomById = new Map(rooms.map((r) => [r._id, r]));
    const teacherName = new Map(teachers.map((t) => [t._id, t.name]));

    const cells = [];
    for (const b of blocks) {
      const roster = await ctx.db
        .query("paperBlockStudents")
        .withIndex("by_block", (q) => q.eq("blockId", b._id))
        .collect();
      const room = roomById.get(b.roomId);
      cells.push({
        blockId: b._id,
        dayOfWeek: b.dayOfWeek,
        startTime: b.startTime,
        endTime: b.endTime,
        roomId: b.roomId,
        roomName: room?.name ?? "?",
        capacity: room?.capacity,
        teacherId: b.teacherId,
        teacherName: teacherName.get(b.teacherId) ?? "?",
        memberCount: roster.length,
      });
    }
    return { cells };
  },
});

// Full detail for one block: the block, its room (name + capacity), teacher
// name, and the roster (with student name + grade). Powers the block dialog.
export const block = query({
  args: { blockId: v.id("paperBlocks") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;

    const b = await ctx.db.get(args.blockId);
    if (!b) return null;
    const room = await ctx.db.get(b.roomId);
    const teacher = await ctx.db.get(b.teacherId);

    const rosterRows = await ctx.db
      .query("paperBlockStudents")
      .withIndex("by_block", (q) => q.eq("blockId", b._id))
      .collect();
    const roster: Array<{
      studentId: Id<"students">;
      name: string;
      schoolGrade: number;
    }> = [];
    for (const row of rosterRows) {
      const s = await ctx.db.get(row.studentId);
      if (s) roster.push({ studentId: s._id, name: s.name, schoolGrade: s.schoolGrade });
    }
    roster.sort((a, b) => a.name.localeCompare(b.name));

    return {
      _id: b._id,
      dayOfWeek: b.dayOfWeek,
      startTime: b.startTime,
      endTime: b.endTime,
      roomId: b.roomId,
      roomName: room?.name ?? "?",
      capacity: room?.capacity,
      teacherId: b.teacherId,
      teacherName: teacher?.name ?? "?",
      roster,
    };
  },
});

// Students who could be added to a block, each flagged free / busy (+reason)
// for the block's day & time. Excludes students already on the roster. Busy
// students are returned too (greyed in the UI) so the lead can override.
export const candidateStudents = query({
  args: { blockId: v.id("paperBlocks") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];

    const b = await ctx.db.get(args.blockId);
    if (!b) return [];

    const rosterRows = await ctx.db
      .query("paperBlockStudents")
      .withIndex("by_block", (q) => q.eq("blockId", b._id))
      .collect();
    const onRoster = new Set(rosterRows.map((r) => r.studentId));

    const all = await ctx.db.query("students").collect();
    const out: Array<{
      _id: Id<"students">;
      name: string;
      schoolGrade: number;
      free: boolean;
      reason?: string;
    }> = [];
    for (const s of all) {
      if (onRoster.has(s._id)) continue;
      const windows = await busyWindowsForDay(ctx, s._id, b.dayOfWeek, b._id);
      const conflict = busyConflict(
        { dayOfWeek: b.dayOfWeek, startTime: b.startTime, endTime: b.endTime },
        windows,
      );
      out.push({
        _id: s._id,
        name: s.name,
        schoolGrade: s.schoolGrade,
        free: conflict === null,
        reason: conflict?.reason,
      });
    }
    // Free students first, then alphabetical.
    return out.sort(
      (a, b) => Number(b.free) - Number(a.free) || a.name.localeCompare(b.name),
    );
  },
});

// Members of a group with their free/busy status for a block — drives the
// "drop a whole group in" preview so the lead sees who will be skipped.
export const groupDropPreview = query({
  args: { blockId: v.id("paperBlocks"), groupId: v.id("groups") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const b = await ctx.db.get(args.blockId);
    if (!b) return [];

    const rosterRows = await ctx.db
      .query("paperBlockStudents")
      .withIndex("by_block", (q) => q.eq("blockId", b._id))
      .collect();
    const onRoster = new Set(rosterRows.map((r) => r.studentId));

    const members = await ctx.db
      .query("groupMembers")
      .withIndex("by_group", (q) => q.eq("groupId", args.groupId))
      .collect();

    const out: Array<{
      studentId: Id<"students">;
      name: string;
      status: "on-roster" | "free" | "busy";
      reason?: string;
    }> = [];
    for (const m of members) {
      const s = await ctx.db.get(m.studentId);
      if (!s) continue;
      if (onRoster.has(s._id)) {
        out.push({ studentId: s._id, name: s.name, status: "on-roster" });
        continue;
      }
      const windows = await busyWindowsForDay(ctx, s._id, b.dayOfWeek, b._id);
      const conflict = busyConflict(
        { dayOfWeek: b.dayOfWeek, startTime: b.startTime, endTime: b.endTime },
        windows,
      );
      out.push({
        studentId: s._id,
        name: s.name,
        status: conflict ? "busy" : "free",
        reason: conflict?.reason,
      });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  },
});

// Attendance rows for a block on a date (status "present" | "absent").
export const attendanceForDate = query({
  args: { blockId: v.id("paperBlocks"), date: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    return await ctx.db
      .query("paperAttendance")
      .withIndex("by_block_date", (q) =>
        q.eq("blockId", args.blockId).eq("date", args.date),
      )
      .collect();
  },
});

// Flat-100/day paper revenue for a single date, plus a per-block present
// count. Drives the Library view's daily revenue read-out.
export const revenueForDate = query({
  args: { date: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return { total: 0, presentStudents: 0, perBlock: [] };

    const rows = await ctx.db
      .query("paperAttendance")
      .withIndex("by_date", (q) => q.eq("date", args.date))
      .collect();

    const total = paperRevenue(
      rows.map((r) => ({ studentId: r.studentId, date: r.date, status: r.status })),
    );
    const presentStudents = new Set(
      rows.filter((r) => r.status === "present").map((r) => String(r.studentId)),
    ).size;

    const perBlockMap = new Map<string, number>();
    for (const r of rows) {
      if (r.status !== "present") continue;
      perBlockMap.set(String(r.blockId), (perBlockMap.get(String(r.blockId)) ?? 0) + 1);
    }
    const perBlock = Array.from(perBlockMap.entries()).map(([blockId, present]) => ({
      blockId,
      present,
    }));

    return { total, presentStudents, perBlock };
  },
});

// One student's whole week for the planner: personal-class slots, the paper
// blocks they're already in, their outside busy windows, and the paper blocks
// they could still JOIN (free + not already in + room not full). Plus weekly
// hour totals. This is the phase-2 "where can I fit this student in" surface.
export const studentWeek = query({
  args: { studentId: v.id("students") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const student = await ctx.db.get(args.studentId);
    if (!student) return null;

    // Personal-class slots (from the student's groups).
    const memberships = await ctx.db
      .query("groupMembers")
      .withIndex("by_student", (q) => q.eq("studentId", args.studentId))
      .collect();
    const personal: Array<{
      dayOfWeek: number; startTime: string; endTime: string; groupName: string;
    }> = [];
    let personalHours = 0;
    for (const m of memberships) {
      const group = await ctx.db.get(m.groupId);
      const slots = await ctx.db
        .query("scheduleSlots")
        .withIndex("by_group", (q) => q.eq("groupId", m.groupId))
        .collect();
      for (const s of slots) {
        personal.push({
          dayOfWeek: s.dayOfWeek,
          startTime: s.startTime,
          endTime: s.endTime,
          groupName: group?.name ?? "?",
        });
        personalHours += hoursBetween(s.startTime, s.endTime);
      }
    }

    // Paper blocks the student is already in.
    const inRows = await ctx.db
      .query("paperBlockStudents")
      .withIndex("by_student", (q) => q.eq("studentId", args.studentId))
      .collect();
    const inBlockIds = new Set(inRows.map((r) => String(r.blockId)));
    const paperIn: Array<{
      blockId: Id<"paperBlocks">; dayOfWeek: number; startTime: string; endTime: string; roomName: string;
    }> = [];
    let paperHours = 0;
    for (const row of inRows) {
      const b = await ctx.db.get(row.blockId);
      if (!b) continue;
      const room = await ctx.db.get(b.roomId);
      paperIn.push({
        blockId: b._id,
        dayOfWeek: b.dayOfWeek,
        startTime: b.startTime,
        endTime: b.endTime,
        roomName: room?.name ?? "?",
      });
      paperHours += hoursBetween(b.startTime, b.endTime);
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

    // Paper blocks the student could JOIN: not already in, free at that time,
    // room not full.
    const allBlocks = await ctx.db.query("paperBlocks").collect();
    const joinable: Array<{
      blockId: Id<"paperBlocks">; dayOfWeek: number; startTime: string; endTime: string;
      roomName: string; memberCount: number; capacity?: number; full: boolean;
    }> = [];
    for (const b of allBlocks) {
      if (inBlockIds.has(String(b._id))) continue;
      const windows = await busyWindowsForDay(ctx, args.studentId, b.dayOfWeek, b._id);
      const conflict = busyConflict(
        { dayOfWeek: b.dayOfWeek, startTime: b.startTime, endTime: b.endTime },
        windows,
      );
      if (conflict) continue; // not free → not a suggestion
      const room = await ctx.db.get(b.roomId);
      const roster = await ctx.db
        .query("paperBlockStudents")
        .withIndex("by_block", (q) => q.eq("blockId", b._id))
        .collect();
      joinable.push({
        blockId: b._id,
        dayOfWeek: b.dayOfWeek,
        startTime: b.startTime,
        endTime: b.endTime,
        roomName: room?.name ?? "?",
        memberCount: roster.length,
        capacity: room?.capacity,
        full: room?.capacity != null && roster.length >= room.capacity,
      });
    }

    return {
      studentId: student._id,
      name: student.name,
      schoolGrade: student.schoolGrade,
      personal,
      paperIn,
      busy,
      joinable,
      personalHours,
      paperHours,
    };
  },
});

// Weekly load per student for the planner's picker: total personal + paper
// hours, sorted lightest-first so underloaded students surface to the top
// ("who can I pull into the Library").
export const studentsLoad = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];

    const [students, allMembers, allSlots, allPaperRows, allBlocks] = await Promise.all([
      ctx.db.query("students").collect(),
      ctx.db.query("groupMembers").collect(),
      ctx.db.query("scheduleSlots").collect(),
      ctx.db.query("paperBlockStudents").collect(),
      ctx.db.query("paperBlocks").collect(),
    ]);

    const slotHoursByGroup = new Map<string, number>();
    for (const s of allSlots) {
      if (!s.groupId) continue;
      slotHoursByGroup.set(
        String(s.groupId),
        (slotHoursByGroup.get(String(s.groupId)) ?? 0) + hoursBetween(s.startTime, s.endTime),
      );
    }
    const paperHoursByBlock = new Map<string, number>();
    for (const b of allBlocks) {
      paperHoursByBlock.set(String(b._id), hoursBetween(b.startTime, b.endTime));
    }

    const personalByStudent = new Map<string, number>();
    for (const m of allMembers) {
      personalByStudent.set(
        String(m.studentId),
        (personalByStudent.get(String(m.studentId)) ?? 0) + (slotHoursByGroup.get(String(m.groupId)) ?? 0),
      );
    }
    const paperByStudent = new Map<string, number>();
    for (const r of allPaperRows) {
      paperByStudent.set(
        String(r.studentId),
        (paperByStudent.get(String(r.studentId)) ?? 0) + (paperHoursByBlock.get(String(r.blockId)) ?? 0),
      );
    }

    return students
      .map((s) => {
        const personalHours = personalByStudent.get(String(s._id)) ?? 0;
        const paperHours = paperByStudent.get(String(s._id)) ?? 0;
        return {
          studentId: s._id,
          name: s.name,
          schoolGrade: s.schoolGrade,
          personalHours,
          paperHours,
          totalHours: personalHours + paperHours,
        };
      })
      .sort((a, b) => a.totalHours - b.totalHours || a.name.localeCompare(b.name));
  },
});

// Realized paper-class revenue over the last `days` days (flat 100/student/day).
// Returns the total, the count of billed student-days, and a per-day series for
// charting. Reported separately from personal-class (250/hr) revenue.
export const paperRevenueRange = query({
  args: { days: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return { total: 0, studentDays: 0, days: 0, perDay: [] };

    const days = Math.min(Math.max(args.days ?? 30, 1), 90);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const cutoff = new Date(today);
    cutoff.setDate(cutoff.getDate() - (days - 1));
    const ymd = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const cutoffYmd = ymd(cutoff);

    const rows = (await ctx.db.query("paperAttendance").collect()).filter(
      (r) => r.status === "present" && r.date >= cutoffYmd,
    );

    // Distinct (student, date) → 100 each.
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
      perDay.push({ date: key, revenue: (byDay.get(key)?.size ?? 0) * PAPER_RATE_LKR });
    }

    return {
      total: billed.size * PAPER_RATE_LKR,
      studentDays: billed.size,
      days,
      perDay,
    };
  },
});

// ── Mutations ───────────────────────────────────────────────────────────────

// Hard-block: a room can't host two things at once. Checks both other paper
// blocks and personal-class slots in the same room overlapping this time.
async function assertRoomFree(
  ctx: { db: any },
  roomId: Id<"rooms">,
  dayOfWeek: number,
  startTime: string,
  endTime: string,
  excludeBlockId?: Id<"paperBlocks">,
) {
  const blocks = await ctx.db
    .query("paperBlocks")
    .withIndex("by_room", (q: any) => q.eq("roomId", roomId))
    .collect();
  for (const b of blocks) {
    if (excludeBlockId && b._id === excludeBlockId) continue;
    if (b.dayOfWeek === dayOfWeek && rangesOverlap(b.startTime, b.endTime, startTime, endTime)) {
      throw new ConvexError("Room already has a paper block at this time");
    }
  }
  const slots = await ctx.db
    .query("scheduleSlots")
    .withIndex("by_room", (q: any) => q.eq("roomId", roomId))
    .collect();
  for (const s of slots) {
    if (!s.groupId) continue; // orphan slot — free
    if (s.dayOfWeek === dayOfWeek && rangesOverlap(s.startTime, s.endTime, startTime, endTime)) {
      throw new ConvexError("Room is booked by a personal class at this time");
    }
  }
}

export const createBlock = mutation({
  args: {
    dayOfWeek: v.number(),
    startTime: v.string(),
    endTime: v.string(),
    roomId: v.id("rooms"),
    teacherId: v.id("teachers"),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Unauthenticated");
    if (args.endTime <= args.startTime) {
      throw new ConvexError("End time must be after start time");
    }
    await assertRoomFree(ctx, args.roomId, args.dayOfWeek, args.startTime, args.endTime);
    return await ctx.db.insert("paperBlocks", {
      dayOfWeek: args.dayOfWeek,
      startTime: args.startTime,
      endTime: args.endTime,
      roomId: args.roomId,
      teacherId: args.teacherId,
    });
  },
});

export const updateBlock = mutation({
  args: {
    blockId: v.id("paperBlocks"),
    dayOfWeek: v.optional(v.number()),
    startTime: v.optional(v.string()),
    endTime: v.optional(v.string()),
    roomId: v.optional(v.id("rooms")),
    teacherId: v.optional(v.id("teachers")),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Unauthenticated");
    const b = await ctx.db.get(args.blockId);
    if (!b) throw new ConvexError("Paper block not found");

    const next = {
      dayOfWeek: args.dayOfWeek ?? b.dayOfWeek,
      startTime: args.startTime ?? b.startTime,
      endTime: args.endTime ?? b.endTime,
      roomId: args.roomId ?? b.roomId,
      teacherId: args.teacherId ?? b.teacherId,
    };
    if (next.endTime <= next.startTime) {
      throw new ConvexError("End time must be after start time");
    }
    await assertRoomFree(
      ctx,
      next.roomId,
      next.dayOfWeek,
      next.startTime,
      next.endTime,
      b._id,
    );
    await ctx.db.patch(b._id, next);
  },
});

// Delete a block and cascade its roster + attendance.
export const removeBlock = mutation({
  args: { blockId: v.id("paperBlocks") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Unauthenticated");

    const roster = await ctx.db
      .query("paperBlockStudents")
      .withIndex("by_block", (q) => q.eq("blockId", args.blockId))
      .collect();
    for (const r of roster) await ctx.db.delete(r._id);

    const attendance = await ctx.db
      .query("paperAttendance")
      .withIndex("by_block_date", (q) => q.eq("blockId", args.blockId))
      .collect();
    for (const a of attendance) await ctx.db.delete(a._id);

    await ctx.db.delete(args.blockId);
  },
});

// Add one student to a block. Hard-enforces room capacity; availability is a
// soft warning handled in the UI, so a busy student can still be added here.
export const addStudent = mutation({
  args: { blockId: v.id("paperBlocks"), studentId: v.id("students") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Unauthenticated");

    const b = await ctx.db.get(args.blockId);
    if (!b) throw new ConvexError("Paper block not found");

    const roster = await ctx.db
      .query("paperBlockStudents")
      .withIndex("by_block", (q) => q.eq("blockId", args.blockId))
      .collect();
    if (roster.some((r) => r.studentId === args.studentId)) {
      return; // already on roster — no-op
    }

    const room = await ctx.db.get(b.roomId);
    if (room?.capacity != null && roster.length >= room.capacity) {
      throw new ConvexError(`Room is full (${room.capacity} max)`);
    }

    await ctx.db.insert("paperBlockStudents", {
      blockId: args.blockId,
      studentId: args.studentId,
    });
  },
});

export const removeStudent = mutation({
  args: { blockId: v.id("paperBlocks"), studentId: v.id("students") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Unauthenticated");
    const row = await ctx.db
      .query("paperBlockStudents")
      .withIndex("by_block", (q) => q.eq("blockId", args.blockId))
      .collect();
    const target = row.find((r) => r.studentId === args.studentId);
    if (target) await ctx.db.delete(target._id);
  },
});

// Drop a whole group's free members into a block. Skips members who are busy
// or already on the roster, and stops at room capacity. Returns what happened
// so the UI can report it.
export const addGroup = mutation({
  args: { blockId: v.id("paperBlocks"), groupId: v.id("groups") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Unauthenticated");

    const b = await ctx.db.get(args.blockId);
    if (!b) throw new ConvexError("Paper block not found");
    const room = await ctx.db.get(b.roomId);

    const roster = await ctx.db
      .query("paperBlockStudents")
      .withIndex("by_block", (q) => q.eq("blockId", args.blockId))
      .collect();
    const onRoster = new Set(roster.map((r) => String(r.studentId)));
    let count = roster.length;

    const members = await ctx.db
      .query("groupMembers")
      .withIndex("by_group", (q) => q.eq("groupId", args.groupId))
      .collect();

    let added = 0;
    const skippedBusy: string[] = [];
    let skippedCapacity = 0;
    for (const m of members) {
      const s = await ctx.db.get(m.studentId);
      if (!s) continue;
      if (onRoster.has(String(s._id))) continue;
      const windows = await busyWindowsForDay(ctx, s._id, b.dayOfWeek, b._id);
      const conflict = busyConflict(
        { dayOfWeek: b.dayOfWeek, startTime: b.startTime, endTime: b.endTime },
        windows,
      );
      if (conflict) {
        skippedBusy.push(s.name);
        continue;
      }
      if (room?.capacity != null && count >= room.capacity) {
        skippedCapacity += 1;
        continue;
      }
      await ctx.db.insert("paperBlockStudents", {
        blockId: args.blockId,
        studentId: s._id,
      });
      onRoster.add(String(s._id));
      count += 1;
      added += 1;
    }
    return { added, skippedBusy, skippedCapacity };
  },
});

// Submit attendance for a block on a date. Everyone on the roster defaults to
// present; `presentStudentIds` is the kept-present set, so any roster member
// NOT listed is marked absent. Mirrors the session page's roll-call model.
export const submitAttendance = mutation({
  args: {
    blockId: v.id("paperBlocks"),
    date: v.string(),
    presentStudentIds: v.array(v.id("students")),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Unauthenticated");

    const roster = await ctx.db
      .query("paperBlockStudents")
      .withIndex("by_block", (q) => q.eq("blockId", args.blockId))
      .collect();
    const present = new Set(args.presentStudentIds.map(String));

    const existing = await ctx.db
      .query("paperAttendance")
      .withIndex("by_block_date", (q) =>
        q.eq("blockId", args.blockId).eq("date", args.date),
      )
      .collect();
    const existingByStudent = new Map(existing.map((e) => [String(e.studentId), e]));

    for (const r of roster) {
      const status = present.has(String(r.studentId)) ? "present" : "absent";
      const prev = existingByStudent.get(String(r.studentId));
      if (prev) {
        if (prev.status !== status) await ctx.db.patch(prev._id, { status });
      } else {
        await ctx.db.insert("paperAttendance", {
          blockId: args.blockId,
          studentId: r.studentId,
          date: args.date,
          status,
        });
      }
    }
  },
});
