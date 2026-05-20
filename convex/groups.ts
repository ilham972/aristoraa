// Phase F: group-centric scheduling.
//
// Replaces the slot-as-unit edit model of the old Settings → Schedule tab.
// A group is a stable roster (+ mentor + default room + grade + centre).
// Each weekly session is one scheduleSlots row whose groupId points back
// here. Mutations in this file are the ONLY write surface for group
// membership and group-owned slots going forward.
//
// Conflict detection (mentorBusyAt / studentBusyAt) powers the red/amber
// cells in the Edit-Group weekly grid. Conflicts never block — they warn.

import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { ConvexError } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";

// ── Constants ─────────────────────────────────────────────────────────────

export const RATE_DEFAULT_LKR = 250;

// ── Helpers ───────────────────────────────────────────────────────────────

function hoursBetween(startHHMM: string, endHHMM: string): number {
  const [sh, sm] = startHHMM.split(":").map(Number);
  const [eh, em] = endHHMM.split(":").map(Number);
  const start = sh + sm / 60;
  const end = eh + em / 60;
  return Math.max(0, end - start);
}

function rangesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart < bEnd && aEnd > bStart;
}

// ── Queries ───────────────────────────────────────────────────────────────

export const list = query({
  args: { includeArchived: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const all = await ctx.db.query("groups").collect();
    return args.includeArchived ? all : all.filter((g) => !g.archived);
  },
});

export const get = query({
  args: { id: v.id("groups") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    return await ctx.db.get(args.id);
  },
});

// Members of a group with full student records folded in.
export const members = query({
  args: { groupId: v.id("groups") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const rows = await ctx.db
      .query("groupMembers")
      .withIndex("by_group", (q) => q.eq("groupId", args.groupId))
      .collect();
    const out: Array<Doc<"students"> & { membershipId: Id<"groupMembers">; joinedAt: number }> = [];
    for (const row of rows) {
      const s = await ctx.db.get(row.studentId);
      if (s) out.push({ ...s, membershipId: row._id, joinedAt: row.joinedAt });
    }
    return out;
  },
});

// All sessions (scheduleSlots) owned by a group, sorted by day then time.
export const sessions = query({
  args: { groupId: v.id("groups") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const slots = await ctx.db
      .query("scheduleSlots")
      .withIndex("by_group", (q) => q.eq("groupId", args.groupId))
      .collect();
    return slots.sort(
      (a, b) => a.dayOfWeek - b.dayOfWeek || a.startTime.localeCompare(b.startTime),
    );
  },
});

// Returns the day's sessions joined with their group + member count + revenue.
// One-stop query for the /groups day view.
export const dayView = query({
  args: { dayOfWeek: v.number(), date: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const slots = await ctx.db
      .query("scheduleSlots")
      .withIndex("by_day", (q) => q.eq("dayOfWeek", args.dayOfWeek))
      .collect();

    const result = [];
    for (const slot of slots) {
      if (!slot.groupId) continue;
      const group = await ctx.db.get(slot.groupId);
      if (!group || group.archived) continue;

      const memberRows = await ctx.db
        .query("groupMembers")
        .withIndex("by_group", (q) => q.eq("groupId", group._id))
        .collect();

      const memberStudents: Array<Doc<"students">> = [];
      for (const m of memberRows) {
        const s = await ctx.db.get(m.studentId);
        if (s) memberStudents.push(s);
      }

      // Apply date-specific overrides if date provided.
      let effectiveStudents = memberStudents;
      if (args.date) {
        const overrides = await ctx.db
          .query("slotOverrides")
          .withIndex("by_slot_date", (q) =>
            q.eq("slotId", slot._id).eq("date", args.date as string),
          )
          .collect();
        const ids = new Set(memberStudents.map((s) => s._id));
        for (const o of overrides) {
          if (o.action === "add") ids.add(o.studentId);
          else if (o.action === "remove") ids.delete(o.studentId);
        }
        effectiveStudents = memberStudents.filter((s) => ids.has(s._id));
        // Add students from overrides who weren't original members.
        for (const o of overrides) {
          if (o.action === "add" && !memberStudents.find((s) => s._id === o.studentId)) {
            const s = await ctx.db.get(o.studentId);
            if (s) effectiveStudents.push(s);
          }
        }
      }

      const hours = hoursBetween(slot.startTime, slot.endTime);
      const revenue = effectiveStudents.reduce(
        (sum, s) => sum + (s.hourlyRate ?? RATE_DEFAULT_LKR) * hours,
        0,
      );

      result.push({
        slot,
        group,
        members: effectiveStudents,
        rosterCount: memberStudents.length,
        effectiveCount: effectiveStudents.length,
        hours,
        revenue,
      });
    }

    return result.sort((a, b) => a.slot.startTime.localeCompare(b.slot.startTime));
  },
});

// Lightweight whole-week snapshot for the grid. One pass over all groups +
// their owned slots; returns per-session cells (no full student records, just
// counts + revenue) so the grid renders without N+1 fan-out on the client.
export const weekGrid = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return { cells: [], groups: [] };

    const groups = await ctx.db.query("groups").collect();
    const activeGroups = groups.filter((g) => !g.archived);

    const cells: Array<{
      slotId: Id<"scheduleSlots">;
      groupId: Id<"groups">;
      groupName: string;
      dayOfWeek: number;
      startTime: string;
      endTime: string;
      roomId: Id<"rooms">;
      memberCount: number;
      hours: number;
      revenue: number;
    }> = [];

    const groupSummaries: Array<{
      _id: Id<"groups">;
      name: string;
      grade?: number;
      memberCount: number;
      sessionCount: number;
    }> = [];

    for (const g of activeGroups) {
      const memberRows = await ctx.db
        .query("groupMembers")
        .withIndex("by_group", (q) => q.eq("groupId", g._id))
        .collect();
      let ratePerHour = 0;
      for (const m of memberRows) {
        const s = await ctx.db.get(m.studentId);
        if (s) ratePerHour += s.hourlyRate ?? RATE_DEFAULT_LKR;
      }
      const memberCount = memberRows.length;

      const slots = await ctx.db
        .query("scheduleSlots")
        .withIndex("by_group", (q) => q.eq("groupId", g._id))
        .collect();

      for (const slot of slots) {
        const hours = hoursBetween(slot.startTime, slot.endTime);
        cells.push({
          slotId: slot._id,
          groupId: g._id,
          groupName: g.name,
          dayOfWeek: slot.dayOfWeek,
          startTime: slot.startTime,
          endTime: slot.endTime,
          roomId: slot.roomId,
          memberCount,
          hours,
          revenue: ratePerHour * hours,
        });
      }

      groupSummaries.push({
        _id: g._id,
        name: g.name,
        grade: g.grade,
        memberCount,
        sessionCount: slots.length,
      });
    }

    return { cells, groups: groupSummaries };
  },
});

// Conflict probe used by Edit-Group cell tap. Returns the groupId already
// using that mentor at that (day, startTime, endTime), or null.
export const mentorBusyAt = query({
  args: {
    mentorId: v.id("teachers"),
    dayOfWeek: v.number(),
    startTime: v.string(),
    endTime: v.string(),
    excludeGroupId: v.optional(v.id("groups")),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const daySlots = await ctx.db
      .query("scheduleSlots")
      .withIndex("by_day", (q) => q.eq("dayOfWeek", args.dayOfWeek))
      .collect();
    for (const slot of daySlots) {
      if (!slot.groupId) continue;
      if (!rangesOverlap(slot.startTime, slot.endTime, args.startTime, args.endTime)) continue;
      const g = await ctx.db.get(slot.groupId);
      if (!g || g.archived) continue;
      if (g.mentorId !== args.mentorId) continue;
      if (args.excludeGroupId && g._id === args.excludeGroupId) continue;
      return { groupId: g._id, groupName: g.name, slotId: slot._id };
    }
    return null;
  },
});

// Returns memberIds among `studentIds` who are already booked into another
// group at that (day, time). Used to amber-flag cells in the Edit-Group grid.
export const studentsBusyAt = query({
  args: {
    studentIds: v.array(v.id("students")),
    dayOfWeek: v.number(),
    startTime: v.string(),
    endTime: v.string(),
    excludeGroupId: v.optional(v.id("groups")),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const daySlots = await ctx.db
      .query("scheduleSlots")
      .withIndex("by_day", (q) => q.eq("dayOfWeek", args.dayOfWeek))
      .collect();

    const busy: Array<{ studentId: Id<"students">; groupId: Id<"groups">; groupName: string }> = [];
    for (const slot of daySlots) {
      if (!slot.groupId) continue;
      if (!rangesOverlap(slot.startTime, slot.endTime, args.startTime, args.endTime)) continue;
      if (args.excludeGroupId && slot.groupId === args.excludeGroupId) continue;
      const g = await ctx.db.get(slot.groupId);
      if (!g || g.archived) continue;
      const members = await ctx.db
        .query("groupMembers")
        .withIndex("by_group", (q) => q.eq("groupId", g._id))
        .collect();
      const memberIds = new Set(members.map((m) => m.studentId));
      for (const sid of args.studentIds) {
        if (memberIds.has(sid)) {
          busy.push({ studentId: sid, groupId: g._id, groupName: g.name });
        }
      }
    }
    return busy;
  },
});

// Busy ranges from OTHER groups for this group's mentor and members. The
// Edit-Group session grid calls this once and marks any cell overlapping a
// returned range: mentorBusy → red (hard-ish: a mentor can't be in two
// places), studentBusy → amber (a student double-booked). Cross-centre is
// computed client-side from member centre vs group centre.
export const sessionConflicts = query({
  args: { groupId: v.id("groups") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return { mentorBusy: [], studentBusy: [] };

    const group = await ctx.db.get(args.groupId);
    if (!group) return { mentorBusy: [], studentBusy: [] };

    const memberRows = await ctx.db
      .query("groupMembers")
      .withIndex("by_group", (q) => q.eq("groupId", args.groupId))
      .collect();
    const memberIds = new Set(memberRows.map((m) => m.studentId));

    const allSlots = await ctx.db.query("scheduleSlots").collect();

    const mentorBusy: Array<{ dayOfWeek: number; startTime: string; endTime: string; groupName: string }> = [];
    const studentBusy: Array<{ dayOfWeek: number; startTime: string; endTime: string; groupName: string; studentName: string }> = [];

    for (const slot of allSlots) {
      if (!slot.groupId || slot.groupId === args.groupId) continue;
      const other = await ctx.db.get(slot.groupId);
      if (!other || other.archived) continue;

      if (group.mentorId && other.mentorId === group.mentorId) {
        mentorBusy.push({
          dayOfWeek: slot.dayOfWeek,
          startTime: slot.startTime,
          endTime: slot.endTime,
          groupName: other.name,
        });
      }

      if (memberIds.size > 0) {
        const otherMembers = await ctx.db
          .query("groupMembers")
          .withIndex("by_group", (q) => q.eq("groupId", other._id))
          .collect();
        for (const om of otherMembers) {
          if (memberIds.has(om.studentId)) {
            const s = await ctx.db.get(om.studentId);
            studentBusy.push({
              dayOfWeek: slot.dayOfWeek,
              startTime: slot.startTime,
              endTime: slot.endTime,
              groupName: other.name,
              studentName: s?.name ?? "?",
            });
          }
        }
      }
    }

    return { mentorBusy, studentBusy };
  },
});

// Revenue for a single group on a single date (overrides honored) OR for the
// "standard week" (no overrides, sums all sessions in the week). Date in
// YYYY-MM-DD; date===undefined ⇒ weekly forecast.
export const revenue = query({
  args: { groupId: v.id("groups"), date: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return 0;

    const memberRows = await ctx.db
      .query("groupMembers")
      .withIndex("by_group", (q) => q.eq("groupId", args.groupId))
      .collect();
    const baseStudents: Array<Doc<"students">> = [];
    for (const m of memberRows) {
      const s = await ctx.db.get(m.studentId);
      if (s) baseStudents.push(s);
    }

    const slots = await ctx.db
      .query("scheduleSlots")
      .withIndex("by_group", (q) => q.eq("groupId", args.groupId))
      .collect();

    let total = 0;
    for (const slot of slots) {
      const hours = hoursBetween(slot.startTime, slot.endTime);
      let attending = baseStudents;
      if (args.date) {
        // Only count this session if its dayOfWeek matches the given date.
        const d = new Date(args.date + "T00:00:00");
        // Convex schema uses 1=Mon..6=Sat (Sun=0 in JS; here app uses 1..6).
        const jsDow = d.getDay(); // 0=Sun..6=Sat
        // Map JS dow → app dow (1=Mon..6=Sat, 0=Sun=7 if you store it; the
        // existing schedule-tab uses 1..6 only, so Sunday sessions skip).
        const appDow = jsDow === 0 ? 7 : jsDow;
        if (slot.dayOfWeek !== appDow) continue;
        const overrides = await ctx.db
          .query("slotOverrides")
          .withIndex("by_slot_date", (q) =>
            q.eq("slotId", slot._id).eq("date", args.date as string),
          )
          .collect();
        const ids = new Set(baseStudents.map((s) => s._id));
        for (const o of overrides) {
          if (o.action === "add") ids.add(o.studentId);
          else if (o.action === "remove") ids.delete(o.studentId);
        }
        const merged: Array<Doc<"students">> = baseStudents.filter((s) => ids.has(s._id));
        for (const o of overrides) {
          if (o.action === "add" && !baseStudents.find((s) => s._id === o.studentId)) {
            const s = await ctx.db.get(o.studentId);
            if (s) merged.push(s);
          }
        }
        attending = merged;
      }
      total += attending.reduce(
        (sum, s) => sum + (s.hourlyRate ?? RATE_DEFAULT_LKR) * hours,
        0,
      );
    }
    return total;
  },
});

// Aggregate revenue across all active groups for a single date.
export const dayRevenue = query({
  args: { date: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return 0;
    const groups = await ctx.db.query("groups").collect();
    let total = 0;
    for (const g of groups) {
      if (g.archived) continue;
      // Reuse the per-group calc inline so we don't fan out N+1 queries.
      const slots = await ctx.db
        .query("scheduleSlots")
        .withIndex("by_group", (q) => q.eq("groupId", g._id))
        .collect();
      const d = new Date(args.date + "T00:00:00");
      const jsDow = d.getDay();
      const appDow = jsDow === 0 ? 7 : jsDow;
      const todaySlots = slots.filter((s) => s.dayOfWeek === appDow);
      if (todaySlots.length === 0) continue;

      const memberRows = await ctx.db
        .query("groupMembers")
        .withIndex("by_group", (q) => q.eq("groupId", g._id))
        .collect();
      const baseStudents: Array<Doc<"students">> = [];
      for (const m of memberRows) {
        const s = await ctx.db.get(m.studentId);
        if (s) baseStudents.push(s);
      }

      for (const slot of todaySlots) {
        const hours = hoursBetween(slot.startTime, slot.endTime);
        const overrides = await ctx.db
          .query("slotOverrides")
          .withIndex("by_slot_date", (q) =>
            q.eq("slotId", slot._id).eq("date", args.date),
          )
          .collect();
        const ids = new Set(baseStudents.map((s) => s._id));
        for (const o of overrides) {
          if (o.action === "add") ids.add(o.studentId);
          else if (o.action === "remove") ids.delete(o.studentId);
        }
        const attending: Array<Doc<"students">> = baseStudents.filter((s) => ids.has(s._id));
        for (const o of overrides) {
          if (o.action === "add" && !baseStudents.find((s) => s._id === o.studentId)) {
            const s = await ctx.db.get(o.studentId);
            if (s) attending.push(s);
          }
        }
        total += attending.reduce(
          (sum, s) => sum + (s.hourlyRate ?? RATE_DEFAULT_LKR) * hours,
          0,
        );
      }
    }
    return total;
  },
});

// Forecast revenue for a standard week (no overrides applied).
export const weekRevenue = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return 0;
    const groups = await ctx.db.query("groups").collect();
    let total = 0;
    for (const g of groups) {
      if (g.archived) continue;
      const slots = await ctx.db
        .query("scheduleSlots")
        .withIndex("by_group", (q) => q.eq("groupId", g._id))
        .collect();
      if (slots.length === 0) continue;
      const memberRows = await ctx.db
        .query("groupMembers")
        .withIndex("by_group", (q) => q.eq("groupId", g._id))
        .collect();
      let perStudent = 0;
      for (const m of memberRows) {
        const s = await ctx.db.get(m.studentId);
        if (!s) continue;
        perStudent += s.hourlyRate ?? RATE_DEFAULT_LKR;
      }
      for (const slot of slots) {
        total += perStudent * hoursBetween(slot.startTime, slot.endTime);
      }
    }
    return total;
  },
});

// ── Mutations ─────────────────────────────────────────────────────────────

export const create = mutation({
  args: {
    name: v.string(),
    autoName: v.optional(v.boolean()),
    centerId: v.optional(v.id("centers")),
    grade: v.optional(v.number()),
    mentorId: v.optional(v.id("teachers")),
    defaultRoomId: v.optional(v.id("rooms")),
    type: v.optional(v.string()),
    maxSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Unauthenticated");
    const now = Date.now();
    return await ctx.db.insert("groups", {
      name: args.name,
      autoName: args.autoName ?? true,
      centerId: args.centerId,
      grade: args.grade,
      mentorId: args.mentorId,
      defaultRoomId: args.defaultRoomId,
      type: args.type,
      maxSize: args.maxSize,
      archived: false,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("groups"),
    name: v.optional(v.string()),
    autoName: v.optional(v.boolean()),
    centerId: v.optional(v.id("centers")),
    grade: v.optional(v.number()),
    mentorId: v.optional(v.id("teachers")),
    defaultRoomId: v.optional(v.id("rooms")),
    type: v.optional(v.string()),
    maxSize: v.optional(v.number()),
    targetMarksMin: v.optional(v.number()),
    targetMarksMax: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Unauthenticated");
    const { id, ...patch } = args;
    await ctx.db.patch(id, { ...patch, updatedAt: Date.now() });
  },
});

export const archive = mutation({
  args: { id: v.id("groups"), archived: v.boolean() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Unauthenticated");
    await ctx.db.patch(args.id, { archived: args.archived, updatedAt: Date.now() });
  },
});

// Hard delete a group: detaches any owned slots (groupId cleared, slots stay
// for history) and deletes all groupMembers rows. Use archive() for soft.
export const remove = mutation({
  args: { id: v.id("groups") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Unauthenticated");

    const slots = await ctx.db
      .query("scheduleSlots")
      .withIndex("by_group", (q) => q.eq("groupId", args.id))
      .collect();
    for (const slot of slots) {
      await ctx.db.patch(slot._id, { groupId: undefined });
    }

    const members = await ctx.db
      .query("groupMembers")
      .withIndex("by_group", (q) => q.eq("groupId", args.id))
      .collect();
    for (const m of members) await ctx.db.delete(m._id);

    await ctx.db.delete(args.id);
  },
});

// Add a member. Caller is responsible for surfacing cross-centre /
// cross-grade warnings (queries for that are below).
export const addMember = mutation({
  args: { groupId: v.id("groups"), studentId: v.id("students") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Unauthenticated");
    const existing = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_student", (q) =>
        q.eq("groupId", args.groupId).eq("studentId", args.studentId),
      )
      .first();
    if (existing) return existing._id;
    return await ctx.db.insert("groupMembers", {
      groupId: args.groupId,
      studentId: args.studentId,
      joinedAt: Date.now(),
    });
  },
});

export const removeMember = mutation({
  args: { groupId: v.id("groups"), studentId: v.id("students") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Unauthenticated");
    const row = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_student", (q) =>
        q.eq("groupId", args.groupId).eq("studentId", args.studentId),
      )
      .first();
    if (row) await ctx.db.delete(row._id);
  },
});

// Toggle a session for a group at (day, startTime, endTime). If a slot with
// this group+day+time already exists, removes it; otherwise creates one in
// the group's defaultRoomId (or the explicit roomId arg).
//
// Returns { action: "added"|"removed"|"error", slotId?, message? }.
export const toggleSession = mutation({
  args: {
    groupId: v.id("groups"),
    dayOfWeek: v.number(),
    startTime: v.string(),
    endTime: v.string(),
    roomId: v.optional(v.id("rooms")),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Unauthenticated");

    const group = await ctx.db.get(args.groupId);
    if (!group) throw new ConvexError("Group not found");

    // Existing session for this group at this slot?
    const owned = await ctx.db
      .query("scheduleSlots")
      .withIndex("by_group", (q) => q.eq("groupId", args.groupId))
      .collect();
    const existing = owned.find(
      (s) =>
        s.dayOfWeek === args.dayOfWeek &&
        s.startTime === args.startTime &&
        s.endTime === args.endTime,
    );
    if (existing) {
      await ctx.db.patch(existing._id, { groupId: undefined });
      return { action: "removed" as const, slotId: existing._id };
    }

    const roomId = args.roomId ?? group.defaultRoomId;
    if (!roomId) {
      throw new ConvexError("No room: set a default room on the group first");
    }

    // Hard block: another group already in that exact (day, time, room).
    const roomSlots = await ctx.db
      .query("scheduleSlots")
      .withIndex("by_room", (q) => q.eq("roomId", roomId))
      .collect();
    const collision = roomSlots.find(
      (s) =>
        s.dayOfWeek === args.dayOfWeek &&
        rangesOverlap(s.startTime, s.endTime, args.startTime, args.endTime) &&
        s.groupId &&
        s.groupId !== args.groupId,
    );
    if (collision) {
      throw new ConvexError("Room already booked at this time by another group");
    }

    // Reuse an empty (groupId=undefined) slot if one happens to match
    // exactly; otherwise insert.
    const reusable = roomSlots.find(
      (s) =>
        s.dayOfWeek === args.dayOfWeek &&
        s.startTime === args.startTime &&
        s.endTime === args.endTime &&
        !s.groupId,
    );
    if (reusable) {
      await ctx.db.patch(reusable._id, { groupId: args.groupId });
      return { action: "added" as const, slotId: reusable._id };
    }
    const newId = await ctx.db.insert("scheduleSlots", {
      dayOfWeek: args.dayOfWeek,
      startTime: args.startTime,
      endTime: args.endTime,
      roomId,
      groupId: args.groupId,
    });
    return { action: "added" as const, slotId: newId };
  },
});

// Daily override on a group session: mark an extra student attending today,
// or mark a regular member absent. Writes the existing slotOverrides table
// (overrides remain slot+date keyed; only group membership got moved).
export const setAttendanceOverride = mutation({
  args: {
    slotId: v.id("scheduleSlots"),
    studentId: v.id("students"),
    date: v.string(),
    action: v.string(), // "add" | "remove"
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Unauthenticated");
    if (args.action !== "add" && args.action !== "remove") {
      throw new ConvexError("Invalid action");
    }
    const existing = await ctx.db
      .query("slotOverrides")
      .withIndex("by_slot_date", (q) =>
        q.eq("slotId", args.slotId).eq("date", args.date),
      )
      .collect();
    const dupe = existing.find((o) => o.studentId === args.studentId);
    if (dupe) {
      if (dupe.action === args.action) return dupe._id;
      await ctx.db.patch(dupe._id, { action: args.action });
      return dupe._id;
    }
    return await ctx.db.insert("slotOverrides", {
      slotId: args.slotId,
      studentId: args.studentId,
      date: args.date,
      action: args.action,
    });
  },
});

export const clearAttendanceOverride = mutation({
  args: { id: v.id("slotOverrides") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Unauthenticated");
    await ctx.db.delete(args.id);
  },
});

// All overrides for a given date across every group session. Drives the
// "Today's exceptions" strip on /groups.
export const overridesForDate = query({
  args: { date: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const all = await ctx.db.query("slotOverrides").collect();
    return all.filter((o) => o.date === args.date);
  },
});
