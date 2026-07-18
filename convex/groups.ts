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

import { query, mutation, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { ConvexError } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { toggleBand, type SlotRange } from "./lib/slotNormalize";
import { absorbSlotData } from "./lib/slotMerge";
import { buildGradeBoard, effectiveCap, realOps, validateCaps, type RosterOp } from "./lib/rosterMoves";

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

// Resolution order for a student's hourly fee within a specific group:
//   1. groupMembers.hourlyRate (per-group override; 0 ⇒ free seat)
//   2. students.hourlyRate     (student's standard fee across groups)
//   3. RATE_DEFAULT_LKR        (system default, 250)
// `memberRate` is the value on the groupMembers row for this (group, student).
function resolveRate(memberRate: number | undefined, studentRate: number | undefined): number {
  if (memberRate !== undefined) return memberRate;
  if (studentRate !== undefined) return studentRate;
  return RATE_DEFAULT_LKR;
}

// ── Queries ───────────────────────────────────────────────────────────────

export const list = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    return await ctx.db.query("groups").collect();
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

// Members of a group with full student records folded in. memberRate is the
// per-group override (undefined ⇒ falls back to student rate, then default)
// — surfaced separately from the student row so the editor can distinguish
// "this group set 100" from "the student's standard fee is 100".
export const members = query({
  args: { groupId: v.id("groups") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const rows = await ctx.db
      .query("groupMembers")
      .withIndex("by_group", (q) => q.eq("groupId", args.groupId))
      .collect();
    const out: Array<
      Doc<"students"> & {
        membershipId: Id<"groupMembers">;
        joinedAt: number;
        memberRate: number | undefined;
        effectiveRate: number;
      }
    > = [];
    for (const row of rows) {
      const s = await ctx.db.get(row.studentId);
      if (s) {
        out.push({
          ...s,
          membershipId: row._id,
          joinedAt: row.joinedAt,
          memberRate: row.hourlyRate,
          effectiveRate: resolveRate(row.hourlyRate, s.hourlyRate),
        });
      }
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
      if (!group) continue;

      const memberRows = await ctx.db
        .query("groupMembers")
        .withIndex("by_group", (q) => q.eq("groupId", group._id))
        .collect();
      // Per-(group,student) rate map so overrides can apply the correct fee.
      const memberRateById = new Map<string, number | undefined>();
      for (const m of memberRows) memberRateById.set(m.studentId, m.hourlyRate);

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
        (sum, s) =>
          sum + resolveRate(memberRateById.get(s._id), s.hourlyRate) * hours,
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
    const activeGroups = groups;

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
      // Colour resolution: explicit index wins, else hash colorKey. colorKey is
      // the live group id here; the draft grid passes its sourceId so the same
      // group matches colours across views. See src/lib/groups/color.ts.
      colorIndex: number | null;
      colorKey: string;
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
        if (s) ratePerHour += resolveRate(m.hourlyRate, s.hourlyRate);
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
          colorIndex: g.colorIndex ?? null,
          colorKey: g._id,
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
      if (!g) continue;
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
      if (!g) continue;
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
      if (!other) continue;

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
    const memberRateById = new Map<string, number | undefined>();
    for (const m of memberRows) {
      memberRateById.set(m.studentId, m.hourlyRate);
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
        (sum, s) =>
          sum + resolveRate(memberRateById.get(s._id), s.hourlyRate) * hours,
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
      const memberRateById = new Map<string, number | undefined>();
      for (const m of memberRows) {
        memberRateById.set(m.studentId, m.hourlyRate);
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
          (sum, s) =>
            sum + resolveRate(memberRateById.get(s._id), s.hourlyRate) * hours,
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
        perStudent += resolveRate(m.hourlyRate, s.hourlyRate);
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
    additionalGrades: v.optional(v.array(v.number())),
    mentorId: v.optional(v.id("teachers")),
    defaultRoomId: v.optional(v.id("rooms")),
    type: v.optional(v.string()),
    maxSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Unauthenticated");

    // Default mentor = current authenticated teacher. Saves an extra round-
    // trip from the client to look this up on every create. Only applied
    // when the caller didn't explicitly pass one.
    let mentorId = args.mentorId;
    if (mentorId === undefined) {
      const caller = await ctx.db
        .query("teachers")
        .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", identity.subject))
        .first();
      if (caller) mentorId = caller._id;
    }

    // Default centre = settings.defaultCenterId. Default room = that centre's
    // own defaultRoomId. Both apply only when the caller didn't pass them.
    let centerId = args.centerId;
    let defaultRoomId = args.defaultRoomId;
    if (centerId === undefined || defaultRoomId === undefined) {
      const settings = await ctx.db.query("settings").first();
      if (centerId === undefined && settings?.defaultCenterId) {
        centerId = settings.defaultCenterId;
      }
      if (defaultRoomId === undefined && centerId) {
        const center = await ctx.db.get(centerId);
        if (center?.defaultRoomId) defaultRoomId = center.defaultRoomId;
      }
    }

    const now = Date.now();
    return await ctx.db.insert("groups", {
      name: args.name,
      autoName: args.autoName ?? true,
      centerId,
      grade: args.grade,
      additionalGrades: args.additionalGrades,
      mentorId,
      defaultRoomId,
      type: args.type,
      maxSize: args.maxSize,
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
    additionalGrades: v.optional(v.array(v.number())),
    mentorId: v.optional(v.id("teachers")),
    defaultRoomId: v.optional(v.id("rooms")),
    type: v.optional(v.string()),
    maxSize: v.optional(v.number()),
    targetMarksMin: v.optional(v.number()),
    targetMarksMax: v.optional(v.number()),
    colorIndex: v.optional(v.number()),
    loggingStartDate: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Unauthenticated");
    const { id, ...patch } = args;
    await ctx.db.patch(id, { ...patch, updatedAt: Date.now() });
  },
});

// Grade-only patch for the Group-board column editor. Deliberately narrow:
// it touches ONLY grade + additionalGrades so it can't accidentally wipe the
// group's other fields (the general `update` above patches every arg, and an
// unspecified optional arrives as undefined → Convex deletes that field).
// Pass grade=undefined for "Any"; an empty/omitted additionalGrades clears
// the extras.
export const setGroupGrades = mutation({
  args: {
    id: v.id("groups"),
    grade: v.optional(v.number()),
    additionalGrades: v.optional(v.array(v.number())),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Unauthenticated");
    await ctx.db.patch(args.id, {
      grade: args.grade,
      additionalGrades:
        args.additionalGrades && args.additionalGrades.length > 0
          ? args.additionalGrades
          : undefined,
      updatedAt: Date.now(),
    });
  },
});

// Hard delete a group: detaches any owned slots (groupId cleared, slots stay
// as orphans available for reuse) and deletes all groupMembers rows. This is
// the only "remove from system" path — there is no soft-archive concept.
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

// Add a member. Strict grade rule: when the group has any grade set
// (primary or additional), the student's schoolGrade must be in that union.
// Cross-centre is still a soft warning (rendered client-side); cross-grade
// is now a hard block.
export const addMember = mutation({
  args: { groupId: v.id("groups"), studentId: v.id("students") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Unauthenticated");

    const group = await ctx.db.get(args.groupId);
    if (!group) throw new ConvexError("Group not found");

    const acceptedGrades: number[] = [
      ...(group.grade != null ? [group.grade] : []),
      ...(group.additionalGrades ?? []),
    ];
    if (acceptedGrades.length > 0) {
      const student = await ctx.db.get(args.studentId);
      if (!student) throw new ConvexError("Student not found");
      if (!acceptedGrades.includes(student.schoolGrade)) {
        throw new ConvexError(
          `Student is Grade ${student.schoolGrade}; this group accepts ${acceptedGrades.join(", ")}`,
        );
      }
    }

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

// Eligible-student list for the Edit-Group "Add member" picker.
//
// Filters:
//   - Student's schoolGrade must be in (group.grade ∪ group.additionalGrades).
//     If neither is set, falls back to listing all students.
//   - Default: hide students already in any OTHER active group. The toggle
//     `includeInOtherGroups` reveals them (still excludes own-group members,
//     and ignores archived groups).
//   - Always excludes students who are already members of THIS group.
//
// One query keeps grade-matching + cross-group exclusion server-side, so the
// client doesn't have to ship a full students.list + groupMembers.list to do
// the same join on every keystroke.
export const candidateStudents = query({
  args: {
    groupId: v.id("groups"),
    includeInOtherGroups: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];

    const group = await ctx.db.get(args.groupId);
    if (!group) return [];

    const acceptedGrades = new Set<number>([
      ...(group.grade != null ? [group.grade] : []),
      ...(group.additionalGrades ?? []),
    ]);

    // Own-group members (always excluded).
    const ownMembers = await ctx.db
      .query("groupMembers")
      .withIndex("by_group", (q) => q.eq("groupId", args.groupId))
      .collect();
    const ownIds = new Set(ownMembers.map((m) => m.studentId));

    // Students booked in OTHER active groups (excluded unless toggle is on).
    const inOtherActive = new Set<string>();
    if (!args.includeInOtherGroups) {
      const allMembers = await ctx.db.query("groupMembers").collect();
      const activeGroupIds = new Set<string>();
      const allGroups = await ctx.db.query("groups").collect();
      for (const g of allGroups) {
        if (g._id !== args.groupId) activeGroupIds.add(g._id);
      }
      for (const m of allMembers) {
        if (activeGroupIds.has(m.groupId)) inOtherActive.add(m.studentId);
      }
    }

    const all = await ctx.db.query("students").collect();
    return all
      .filter((s) => !ownIds.has(s._id))
      .filter((s) => acceptedGrades.size === 0 || acceptedGrades.has(s.schoolGrade))
      .filter((s) => args.includeInOtherGroups || !inOtherActive.has(s._id))
      .sort((a, b) => a.name.localeCompare(b.name));
  },
});

// Roster-coverage snapshot for the /groups week view header strip:
//   • assignedCount  — unique students who are in ≥ 1 group right now
//   • totalCount     — every student in the system
//   • unassigned     — student rows for any not in a group, grade-sorted
// One query so the "X in groups" pill and the unassigned alert/dialog all
// read from the same scan; the dialog uses the full list, the pills use
// just the counts.
export const studentAssignmentSummary = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return { assignedCount: 0, totalCount: 0, unassigned: [] };
    }

    const allGroups = await ctx.db.query("groups").collect();
    const groupIds = new Set(allGroups.map((g) => g._id as string));

    const allMembers = await ctx.db.query("groupMembers").collect();
    const assigned = new Set<string>();
    for (const m of allMembers) {
      if (groupIds.has(m.groupId)) assigned.add(m.studentId);
    }

    const all = await ctx.db.query("students").collect();
    const unassigned = all
      .filter((s) => !assigned.has(s._id))
      .sort((a, b) => a.schoolGrade - b.schoolGrade || a.name.localeCompare(b.name));

    return {
      assignedCount: assigned.size,
      totalCount: all.length,
      unassigned,
    };
  },
});

// Back-compat: same as `studentAssignmentSummary.unassigned`. Kept so an
// older client bundle deployed before today still resolves the function.
export const unassignedStudents = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];

    const allGroups = await ctx.db.query("groups").collect();
    const groupIds = new Set(allGroups.map((g) => g._id as string));

    const allMembers = await ctx.db.query("groupMembers").collect();
    const assigned = new Set<string>();
    for (const m of allMembers) {
      if (groupIds.has(m.groupId)) assigned.add(m.studentId);
    }

    const all = await ctx.db.query("students").collect();
    return all
      .filter((s) => !assigned.has(s._id))
      .sort((a, b) => a.schoolGrade - b.schoolGrade || a.name.localeCompare(b.name));
  },
});

// ── Organize board ("Group" view) ──────────────────────────────────────────
//
// The /groups "Group" view lets the Lead reshuffle rosters when new students
// join or someone needs a different class. The board is grade-scoped: pick a
// grade, see every group that accepts it as a column (+ an Unassigned column),
// then move students between columns. gradeBoard feeds the board; gradeOptions
// fills the grade picker; applyRosterMoves commits a staged batch atomically.

// Distinct grades present across students, ascending. Drives the grade picker.
export const gradeOptions = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const students = await ctx.db.query("students").collect();
    const grades = new Set<number>();
    for (const s of students) grades.add(s.schoolGrade);
    return Array.from(grades).sort((a, b) => a - b);
  },
});

// One-pass snapshot for the organize board at a given grade. A group is a
// column if it DECLARES this grade (grade/additionalGrades) OR holds at least
// one student of this grade (so untyped/mixed groups aren't stranded). EVERY
// member of a shown column is a movable chip — including off-grade and
// multi-group members; nothing is hidden. Unassigned = this-grade students in
// no group at all. Column/member logic lives in the tested pure
// `buildGradeBoard`; this handler only loads data + attaches session labels.
export const gradeBoard = query({
  args: { grade: v.number() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return { columns: [], unassigned: [] };

    const [allGroups, allMembers, allStudents, allSlots] = await Promise.all([
      ctx.db.query("groups").collect(),
      ctx.db.query("groupMembers").collect(),
      ctx.db.query("students").collect(),
      ctx.db.query("scheduleSlots").collect(),
    ]);

    // Earliest weekly session per group → a "Mon 16:00" style label client-side.
    const firstSlotByGroup = new Map<string, { dayOfWeek: number; startTime: string }>();
    for (const slot of allSlots) {
      if (!slot.groupId) continue;
      const cur = firstSlotByGroup.get(slot.groupId);
      if (
        !cur ||
        slot.dayOfWeek < cur.dayOfWeek ||
        (slot.dayOfWeek === cur.dayOfWeek && slot.startTime < cur.startTime)
      ) {
        firstSlotByGroup.set(slot.groupId, {
          dayOfWeek: slot.dayOfWeek,
          startTime: slot.startTime,
        });
      }
    }

    return buildGradeBoard(
      args.grade,
      allGroups.map((g) => ({
        _id: g._id,
        name: g.name,
        grade: g.grade,
        additionalGrades: g.additionalGrades,
        maxSize: g.maxSize,
        firstSession: firstSlotByGroup.get(g._id) ?? null,
        colorIndex: g.colorIndex ?? null,
        colorKey: g._id,
      })),
      allMembers.map((m) => ({ groupId: m.groupId, studentId: m.studentId })),
      allStudents.map((s) => ({ _id: s._id, name: s.name, schoolGrade: s.schoolGrade })),
    );
  },
});

// Set (or clear) a per-group fee override for one student. Pass
// hourlyRate=0 for a free seat, a positive number for a custom rate, or
// undefined to clear the override and fall back to the student's standard
// rate.
export const setMemberFee = mutation({
  args: {
    groupId: v.id("groups"),
    studentId: v.id("students"),
    hourlyRate: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Unauthenticated");
    if (args.hourlyRate !== undefined && args.hourlyRate < 0) {
      throw new ConvexError("Fee cannot be negative");
    }
    const row = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_student", (q) =>
        q.eq("groupId", args.groupId).eq("studentId", args.studentId),
      )
      .first();
    if (!row) throw new ConvexError("Student is not a member of this group");
    await ctx.db.patch(row._id, { hourlyRate: args.hourlyRate });
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

// Commit a staged batch of roster moves from the organize board, atomically.
// Each op moves one student out of `fromGroupId` (null = was Unassigned) into
// `toGroupId` (null = move to Unassigned). All ops apply in one transaction:
// it re-checks the size cap and the grade rule on the FINAL state, so the
// batch either lands whole or not at all (no partial reshuffle on failure).
// Per-group fee overrides do NOT follow a student — a fee is group-specific,
// so the new membership starts on the student's standard rate.
export const applyRosterMoves = mutation({
  args: {
    ops: v.array(
      v.object({
        studentId: v.id("students"),
        fromGroupId: v.union(v.id("groups"), v.null()),
        toGroupId: v.union(v.id("groups"), v.null()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Unauthenticated");

    // Keep the branded Id types for DB writes; project to plain strings only
    // for the pure cap math.
    const typedOps = args.ops.filter((o) => o.fromGroupId !== o.toGroupId);
    if (typedOps.length === 0) return { applied: 0 };
    const ops: RosterOp[] = typedOps.map((o) => ({
      studentId: o.studentId,
      fromGroupId: o.fromGroupId,
      toGroupId: o.toGroupId,
    }));

    // Load every involved group once: current member count + cap + record.
    const groupIds = new Set<string>();
    for (const o of typedOps) {
      if (o.fromGroupId) groupIds.add(o.fromGroupId);
      if (o.toGroupId) groupIds.add(o.toGroupId);
    }
    const groupById = new Map<string, Doc<"groups">>();
    const currentCounts = new Map<string, number>();
    const caps = new Map<string, number>();
    for (const gid of Array.from(groupIds)) {
      const g = await ctx.db.get(gid as Id<"groups">);
      if (!g) throw new ConvexError("Group not found");
      groupById.set(gid, g);
      caps.set(gid, effectiveCap(g.maxSize));
      const rows = await ctx.db
        .query("groupMembers")
        .withIndex("by_group", (q) => q.eq("groupId", gid as Id<"groups">))
        .collect();
      currentCounts.set(gid, rows.length);
    }

    // Final-state cap guard (mirrors the board's per-drop check).
    const { ok, violations } = validateCaps(ops, currentCounts, caps);
    if (!ok) {
      const v0 = violations[0];
      const g = groupById.get(v0.groupId);
      throw new ConvexError(
        `${g?.name ?? "A group"} would have ${v0.count} students (max ${v0.cap})`,
      );
    }

    // Grade guard on every add target (same rule as addMember).
    for (const o of typedOps) {
      if (!o.toGroupId) continue;
      const g = groupById.get(o.toGroupId)!;
      const accepted = [
        ...(g.grade != null ? [g.grade] : []),
        ...(g.additionalGrades ?? []),
      ];
      if (accepted.length === 0) continue;
      const s = await ctx.db.get(o.studentId);
      if (!s) throw new ConvexError("Student not found");
      if (!accepted.includes(s.schoolGrade)) {
        throw new ConvexError(
          `${s.name} is Grade ${s.schoolGrade}; ${g.name} accepts ${accepted.join(", ")}`,
        );
      }
    }

    // Apply: removes first, then adds (keeps intermediate counts low and a
    // swap from a full group never trips an index-time invariant).
    for (const o of typedOps) {
      if (!o.fromGroupId) continue;
      const row = await ctx.db
        .query("groupMembers")
        .withIndex("by_group_student", (q) =>
          q.eq("groupId", o.fromGroupId!).eq("studentId", o.studentId),
        )
        .first();
      if (row) await ctx.db.delete(row._id);
    }
    for (const o of typedOps) {
      if (!o.toGroupId) continue;
      const existing = await ctx.db
        .query("groupMembers")
        .withIndex("by_group_student", (q) =>
          q.eq("groupId", o.toGroupId!).eq("studentId", o.studentId),
        )
        .first();
      if (!existing) {
        await ctx.db.insert("groupMembers", {
          groupId: o.toGroupId,
          studentId: o.studentId,
          joinedAt: Date.now(),
        });
      }
    }

    return { applied: typedOps.length };
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

    const roomId = args.roomId ?? group.defaultRoomId;
    if (!roomId) {
      throw new ConvexError("No room: set a default room on the group first");
    }

    // This group's slots on this day, in this room — the input to toggleBand.
    const owned = await ctx.db
      .query("scheduleSlots")
      .withIndex("by_group", (q) => q.eq("groupId", args.groupId))
      .collect();
    const sameDayRoom = owned.filter(
      (s) => s.dayOfWeek === args.dayOfWeek && s.roomId === roomId,
    );
    const existing: SlotRange[] = sameDayRoom.map((s) => ({
      id: s._id,
      startTime: s.startTime,
      endTime: s.endTime,
    }));

    const band = { start: args.startTime, end: args.endTime };
    const isAdding = !existing.some(
      (s) => s.startTime <= band.start && s.endTime >= band.end,
    );

    // Hard block (adds only): another LIVE group overlapping this band in the
    // same room. A row whose groupId points at a deleted group is an orphan —
    // treat it as free, otherwise a stale ownership would permanently block.
    if (isAdding) {
      const roomSlots = await ctx.db
        .query("scheduleSlots")
        .withIndex("by_room", (q) => q.eq("roomId", roomId))
        .collect();
      for (const s of roomSlots) {
        if (!s.groupId || s.groupId === args.groupId) continue;
        const owner = await ctx.db.get(s.groupId);
        if (!owner) continue; // orphan — free
        if (
          s.dayOfWeek === args.dayOfWeek &&
          rangesOverlap(s.startTime, s.endTime, args.startTime, args.endTime)
        ) {
          throw new ConvexError("Room already booked at this time by another group");
        }
      }
    }

    const { result, toggled } = toggleBand(existing, band);

    // Apply the desired end-state:
    //  • result slot WITH sourceId → patch that slot's range.
    //  • result slot WITHOUT sourceId → insert a new slot.
    //  • existing slot absent from result → either absorbed into a fused slot
    //    (move its data, then delete) or fully removed (orphan it so its
    //    history survives and the row stays reusable, matching prior behavior).
    const keptIds = new Set(
      result.map((r) => r.sourceId).filter((x): x is string => x != null),
    );

    let primarySlotId: Id<"scheduleSlots"> | undefined;
    for (const r of result) {
      if (r.sourceId) {
        await ctx.db.patch(r.sourceId as Id<"scheduleSlots">, {
          startTime: r.startTime,
          endTime: r.endTime,
        });
        if (!primarySlotId) primarySlotId = r.sourceId as Id<"scheduleSlots">;
      } else {
        const newId = await ctx.db.insert("scheduleSlots", {
          dayOfWeek: args.dayOfWeek,
          startTime: r.startTime,
          endTime: r.endTime,
          roomId,
          groupId: args.groupId,
        });
        if (!primarySlotId) primarySlotId = newId;
      }
    }

    for (const s of sameDayRoom) {
      if (keptIds.has(s._id)) continue;
      // Absorbed → its old span now sits inside a kept (fused) slot.
      const target = result.find(
        (r) =>
          r.sourceId != null &&
          r.startTime <= s.startTime &&
          r.endTime >= s.endTime,
      );
      if (target && target.sourceId) {
        await absorbSlotData(ctx, s._id, target.sourceId as Id<"scheduleSlots">);
        await ctx.db.delete(s._id);
      } else {
        // Fully removed — preserve history, keep the row reusable.
        await ctx.db.patch(s._id, { groupId: undefined });
      }
    }

    return { action: toggled, slotId: primarySlotId };
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

// ── Revenue insights ─────────────────────────────────────────────────────
//
// One-shot snapshot powering the /groups → Revenue tab. Returns:
//   • standard-week forecast (rate × hours, current roster, no overrides)
//   • per-group / per-day / per-mentor / per-centre / per-grade forecasts
//   • last-N-days realized revenue using the attendance table
//       realized = Σ (hourlyRate × hours) over students with status="present"
//
// One query so the tab paints in one pass. All revenue is LKR; falls back to
// RATE_DEFAULT_LKR when a student has no explicit hourlyRate.

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export const revenueInsights = query({
  args: { days: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return {
        forecast: { week: 0, perDay: [], perGroup: [], perMentor: [], perCenter: [], perGrade: [] },
        actual: { days: 0, total: 0, perDay: [] },
        meta: { totalSessions: 0, totalHoursPerWeek: 0, activeStudents: 0 },
      };
    }

    const days = Math.min(Math.max(args.days ?? 30, 1), 90);

    // ── reference data ──────────────────────────────────────────────────
    const [groups, centers, teachers, allMembers, allSlots] = await Promise.all([
      ctx.db.query("groups").collect(),
      ctx.db.query("centers").collect(),
      ctx.db.query("teachers").collect(),
      ctx.db.query("groupMembers").collect(),
      ctx.db.query("scheduleSlots").collect(),
    ]);

    const groupById = new Map(groups.map((g) => [g._id, g]));
    const centerName = new Map(centers.map((c) => [c._id, c.name]));
    const teacherName = new Map(teachers.map((t) => [t._id, t.name]));

    // Build per-group: members + their resolved per-hour fee. We resolve
    // each (group, student) row independently because a student may be in
    // two groups with different per-group overrides.
    const studentIds = new Set<Id<"students">>();
    for (const m of allMembers) studentIds.add(m.studentId);
    const studentList = await Promise.all(
      Array.from(studentIds).map((id) => ctx.db.get(id)),
    );
    const studentRateById = new Map<string, number | undefined>();
    for (const s of studentList) {
      if (s) studentRateById.set(s._id, s.hourlyRate);
    }

    // membersByGroup uses the resolved per-(group,student) rate so each
    // group's hourly fee is the simple sum of these.
    const membersByGroup = new Map<string, { studentId: Id<"students">; rate: number }[]>();
    // Lookup for the attendance loop below: "<groupId>|<studentId>" → rate.
    // Lets realized-revenue charge the per-group rate without rebuilding the
    // membership map.
    const rateByGroupStudent = new Map<string, number>();
    for (const m of allMembers) {
      const rate = resolveRate(m.hourlyRate, studentRateById.get(m.studentId));
      const list = membersByGroup.get(m.groupId) ?? [];
      list.push({ studentId: m.studentId, rate });
      membersByGroup.set(m.groupId, list);
      rateByGroupStudent.set(`${m.groupId}|${m.studentId}`, rate);
    }

    // Slots keyed by group (active groups only); also keep a flat list of
    // owned-slot rows for the per-day forecast loop.
    const ownedSlots = allSlots.filter((s) => {
      if (!s.groupId) return false;
      return groupById.has(s.groupId);
    });

    // ── Forecast aggregates ─────────────────────────────────────────────
    type GroupRow = { groupId: Id<"groups">; name: string; members: number; sessions: number; hoursPerWeek: number; weekRevenue: number };
    const perGroup = new Map<string, GroupRow>();
    const perDay = new Array(8).fill(0) as number[]; // index 1..7; 0 unused
    const perMentor = new Map<string, { mentorId: Id<"teachers"> | null; name: string; weekRevenue: number }>();
    const perCenter = new Map<string, { centerId: Id<"centers"> | null; name: string; weekRevenue: number }>();
    const perGrade = new Map<string, { grade: number | null; weekRevenue: number }>();

    let totalHoursPerWeek = 0;
    let weekTotal = 0;

    for (const slot of ownedSlots) {
      const groupId = slot.groupId!;
      const g = groupById.get(groupId)!;
      const list = membersByGroup.get(groupId) ?? [];
      const ratePerHour = list.reduce((s, m) => s + m.rate, 0);
      const hours = hoursBetween(slot.startTime, slot.endTime);
      const rev = ratePerHour * hours;

      weekTotal += rev;
      totalHoursPerWeek += hours;
      perDay[slot.dayOfWeek] = (perDay[slot.dayOfWeek] ?? 0) + rev;

      const gRow = perGroup.get(groupId) ?? {
        groupId,
        name: g.name,
        members: list.length,
        sessions: 0,
        hoursPerWeek: 0,
        weekRevenue: 0,
      };
      gRow.sessions += 1;
      gRow.hoursPerWeek += hours;
      gRow.weekRevenue += rev;
      perGroup.set(groupId, gRow);

      const mKey = g.mentorId ? String(g.mentorId) : "_none";
      const mRow = perMentor.get(mKey) ?? {
        mentorId: g.mentorId ?? null,
        name: g.mentorId ? teacherName.get(g.mentorId) ?? "?" : "Unassigned",
        weekRevenue: 0,
      };
      mRow.weekRevenue += rev;
      perMentor.set(mKey, mRow);

      const cKey = g.centerId ? String(g.centerId) : "_none";
      const cRow = perCenter.get(cKey) ?? {
        centerId: g.centerId ?? null,
        name: g.centerId ? centerName.get(g.centerId) ?? "?" : "Unassigned",
        weekRevenue: 0,
      };
      cRow.weekRevenue += rev;
      perCenter.set(cKey, cRow);

      const gradeKey = g.grade != null ? String(g.grade) : "_none";
      const grRow = perGrade.get(gradeKey) ?? { grade: g.grade ?? null, weekRevenue: 0 };
      grRow.weekRevenue += rev;
      perGrade.set(gradeKey, grRow);
    }

    // ── Actual realized revenue from attendance (last `days` days) ──────
    // Strategy: collect attendance with status="present" since cutoff, look
    // up slot once, multiply hourlyRate × hours. Skips orphan / non-group
    // slots automatically (revenue concept only applies to group slots).
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const cutoff = new Date(today);
    cutoff.setDate(cutoff.getDate() - (days - 1));
    const cutoffYmd = ymd(cutoff);

    const attendance = await ctx.db.query("attendance").collect();
    // Cache slot rows so we don't refetch.
    const slotById = new Map(allSlots.map((s) => [s._id, s]));
    // Drop attendance rows on pre-tracking dates so realized revenue lines up
    // with the Day view + Attendance tab (which both hide pre-tracking).
    const isPreTracking = (slotId: Id<"scheduleSlots">, date: string): boolean => {
      const slot = slotById.get(slotId);
      if (!slot || !slot.groupId) return false;
      const g = groupById.get(slot.groupId);
      if (!g || !g.loggingStartDate) return false;
      return date < g.loggingStartDate;
    };
    const recent = attendance.filter(
      (a) =>
        a.status === "present" &&
        a.date >= cutoffYmd &&
        !isPreTracking(a.slotId, a.date),
    );
    const realizedByDay = new Map<string, number>();
    let realizedTotal = 0;

    // Pre-fetch any student rate we don't already have (students who attended
    // but were since removed from the roster). These fall back to the
    // student's standard rate when there's no per-group override on file.
    const missingStudentIds = new Set<Id<"students">>();
    for (const a of recent) {
      if (!studentRateById.has(a.studentId)) missingStudentIds.add(a.studentId);
    }
    if (missingStudentIds.size > 0) {
      const extra = await Promise.all(
        Array.from(missingStudentIds).map((id) => ctx.db.get(id)),
      );
      for (const s of extra) {
        if (s) studentRateById.set(s._id, s.hourlyRate);
      }
    }

    for (const a of recent) {
      const slot = slotById.get(a.slotId);
      if (!slot || !slot.groupId) continue;
      const hours = hoursBetween(slot.startTime, slot.endTime);
      // Prefer the per-group override; fall back to student rate; then default.
      const rate =
        rateByGroupStudent.get(`${slot.groupId}|${a.studentId}`) ??
        resolveRate(undefined, studentRateById.get(a.studentId));
      const rev = rate * hours;
      realizedTotal += rev;
      realizedByDay.set(a.date, (realizedByDay.get(a.date) ?? 0) + rev);
    }

    // Fill missing days with 0 so the chart has a continuous x-axis.
    const actualPerDay: Array<{ date: string; revenue: number }> = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - (days - 1 - i));
      const key = ymd(d);
      actualPerDay.push({ date: key, revenue: realizedByDay.get(key) ?? 0 });
    }

    const forecastPerDay = perDay
      .map((rev, dow) => ({ dayOfWeek: dow, revenue: rev }))
      .filter((r) => r.dayOfWeek >= 1 && r.dayOfWeek <= 7);

    const activeStudents = new Set<Id<"students">>();
    for (const list of Array.from(membersByGroup.values())) {
      for (const m of list) activeStudents.add(m.studentId);
    }

    return {
      forecast: {
        week: weekTotal,
        perDay: forecastPerDay,
        perGroup: Array.from(perGroup.values()).sort((a, b) => b.weekRevenue - a.weekRevenue),
        perMentor: Array.from(perMentor.values()).sort((a, b) => b.weekRevenue - a.weekRevenue),
        perCenter: Array.from(perCenter.values()).sort((a, b) => b.weekRevenue - a.weekRevenue),
        perGrade: Array.from(perGrade.values()).sort((a, b) => b.weekRevenue - a.weekRevenue),
      },
      actual: {
        days,
        total: realizedTotal,
        perDay: actualPerDay,
      },
      meta: {
        totalSessions: ownedSlots.length,
        totalHoursPerWeek,
        activeStudents: activeStudents.size,
      },
    };
  },
});

// ── Roster audit (Insights → Roster) ────────────────────────────────────────
// Every group in the centre in ONE list, keyed by grade, with the two signals
// that decide "can this go?": how many students it holds and how many weekly
// slots it owns. The organize board answers this per grade and hides phantoms;
// this is the whole-centre sweep, so phantoms ARE included — nowhere else in
// the app can the founder see them. Live data only: an audit shows what's real,
// never the planning-mode draft branch.

export const rosterAudit = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return { groups: [] };

    const [allGroups, allMembers, allSlots] = await Promise.all([
      ctx.db.query("groups").collect(),
      ctx.db.query("groupMembers").collect(),
      ctx.db.query("scheduleSlots").collect(),
    ]);

    const memberCount = new Map<string, number>();
    for (const m of allMembers) {
      memberCount.set(m.groupId, (memberCount.get(m.groupId) ?? 0) + 1);
    }
    const slotCount = new Map<string, number>();
    for (const s of allSlots) {
      if (!s.groupId) continue;
      slotCount.set(s.groupId, (slotCount.get(s.groupId) ?? 0) + 1);
    }

    const groups = allGroups.map((g) => {
      const members = memberCount.get(g._id) ?? 0;
      const sessions = slotCount.get(g._id) ?? 0;
      return {
        _id: g._id,
        name: g.name,
        grade: g.grade ?? null,
        additionalGrades: g.additionalGrades ?? [],
        members,
        sessions,
        // Same rule as isPhantomGroup, computed from the counts we already
        // have instead of two more indexed reads per group.
        isPhantom: g.autoName === true && members === 0 && sessions === 0,
      };
    });

    // Grade asc (ungraded last), then name — the order the founder reads in.
    groups.sort((a, b) => {
      const ga = a.grade ?? 99;
      const gb = b.grade ?? 99;
      if (ga !== gb) return ga - gb;
      return a.name.localeCompare(b.name);
    });

    return { groups };
  },
});

// ── Phantom-group cleanup ───────────────────────────────────────────────────
// The Week-view tap-to-create mints a `new_group` row before the user commits;
// backing out leaves an abandoned row with no members and no slots. These are
// invisible in the slot-driven Week grid but used to clutter the Group board.
// `auditPhantomGroups` is read-only (run on prod to see the damage);
// `deletePhantomGroups` removes them. Both treat a group as a phantom ONLY when
// it has autoName=true AND zero members AND zero schedule slots — a deliberately
// named group is never touched even if currently empty.

async function isPhantomGroup(
  ctx: { db: any },
  g: Doc<"groups">,
): Promise<boolean> {
  if (!g.autoName) return false;
  const member = await ctx.db
    .query("groupMembers")
    .withIndex("by_group", (q: any) => q.eq("groupId", g._id))
    .first();
  if (member) return false;
  const slot = await ctx.db
    .query("scheduleSlots")
    .withIndex("by_group", (q: any) => q.eq("groupId", g._id))
    .first();
  return slot === null;
}

export const auditPhantomGroups = query({
  args: {},
  handler: async (ctx) => {
    const groups = await ctx.db.query("groups").collect();
    const phantoms: Array<{ _id: Id<"groups">; name: string; grade?: number }> = [];
    for (const g of groups) {
      if (await isPhantomGroup(ctx, g)) {
        phantoms.push({ _id: g._id, name: g.name, grade: g.grade });
      }
    }
    return { total: groups.length, phantomCount: phantoms.length, phantoms };
  },
});

export const deletePhantomGroups = internalMutation({
  args: {},
  handler: async (ctx) => {
    const groups = await ctx.db.query("groups").collect();
    const deleted: Array<{ _id: Id<"groups">; name: string }> = [];
    for (const g of groups) {
      if (await isPhantomGroup(ctx, g)) {
        await ctx.db.delete(g._id);
        deleted.push({ _id: g._id, name: g.name });
      }
    }
    return { deletedCount: deleted.length, deleted };
  },
});
