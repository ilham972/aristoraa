// Branch-aware editing for planning mode: the same week view / group editor /
// organize board, but writing into the draft tables instead of live. Every
// operation mirrors its live twin in convex/groups.ts and reuses the SAME pure
// logic (toggleBand for session fusion, validateCaps for the ≤10 cap,
// buildGradeBoard for the organize board, the grade-membership rule), so the
// draft behaves identically to live. Foreign keys here are draft-space; Merge
// (convex/timetableDraft.ts) remaps them back to live ids.

import { query, mutation } from "./_generated/server";
import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { toggleBand, type SlotRange } from "./lib/slotNormalize";
import { buildGradeBoard, validateCaps, type RosterOp } from "./lib/rosterMoves";

const RATE_DEFAULT_LKR = 250;
const resolveRate = (memberRate?: number, studentRate?: number): number =>
  memberRate ?? studentRate ?? RATE_DEFAULT_LKR;
const hoursBetween = (a: string, b: string): number => {
  const [sh, sm] = a.split(":").map(Number);
  const [eh, em] = b.split(":").map(Number);
  return Math.max(0, eh + em / 60 - (sh + sm / 60));
};
const rangesOverlap = (aS: string, aE: string, bS: string, bE: string) => aS < bE && aE > bS;
const auth = async (ctx: { auth: { getUserIdentity: () => Promise<unknown> } }) => {
  if (!(await ctx.auth.getUserIdentity())) throw new ConvexError("Unauthenticated");
};

// ─── Reads ──────────────────────────────────────────────────────────────────

// Same shape as groups.weekGrid, but over the draft tables. groupId is a
// draftGroups id (the WeekGrid component only uses it for colour + open).
export const weekGridDraft = query({
  handler: async (ctx) => {
    if (!(await ctx.auth.getUserIdentity())) return { cells: [], groups: [] };
    const groups = await ctx.db.query("draftGroups").collect();
    const cells = [];
    const groupSummaries = [];
    for (const g of groups) {
      const memberRows = await ctx.db
        .query("draftGroupMembers")
        .withIndex("by_group", (q) => q.eq("groupId", g._id))
        .collect();
      let ratePerHour = 0;
      for (const m of memberRows) {
        const s = await ctx.db.get(m.studentId);
        if (s) ratePerHour += resolveRate(m.hourlyRate, s.hourlyRate);
      }
      const slots = await ctx.db
        .query("draftSlots")
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
          memberCount: memberRows.length,
          hours,
          revenue: ratePerHour * hours,
        });
      }
      groupSummaries.push({
        _id: g._id,
        name: g.name,
        grade: g.grade,
        memberCount: memberRows.length,
        sessionCount: slots.length,
      });
    }
    return { cells, groups: groupSummaries };
  },
});

export const getGroupDraft = query({
  args: { id: v.id("draftGroups") },
  handler: async (ctx, args) => {
    if (!(await ctx.auth.getUserIdentity())) return null;
    return await ctx.db.get(args.id);
  },
});

export const membersDraft = query({
  args: { groupId: v.id("draftGroups") },
  handler: async (ctx, args) => {
    if (!(await ctx.auth.getUserIdentity())) return [];
    const rows = await ctx.db
      .query("draftGroupMembers")
      .withIndex("by_group", (q) => q.eq("groupId", args.groupId))
      .collect();
    const out = [];
    for (const row of rows) {
      const s = await ctx.db.get(row.studentId);
      if (s)
        out.push({
          ...s,
          membershipId: row._id,
          joinedAt: row.joinedAt,
          memberRate: row.hourlyRate,
          effectiveRate: resolveRate(row.hourlyRate, s.hourlyRate),
        });
    }
    return out;
  },
});

export const sessionsDraft = query({
  args: { groupId: v.id("draftGroups") },
  handler: async (ctx, args) => {
    if (!(await ctx.auth.getUserIdentity())) return [];
    const slots = await ctx.db
      .query("draftSlots")
      .withIndex("by_group", (q) => q.eq("groupId", args.groupId))
      .collect();
    return slots.sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.startTime.localeCompare(b.startTime));
  },
});

export const gradeBoardDraft = query({
  args: { grade: v.number() },
  handler: async (ctx, args) => {
    if (!(await ctx.auth.getUserIdentity())) return { columns: [], unassigned: [] };
    const [groups, members, students, slots] = await Promise.all([
      ctx.db.query("draftGroups").collect(),
      ctx.db.query("draftGroupMembers").collect(),
      ctx.db.query("students").collect(),
      ctx.db.query("draftSlots").collect(),
    ]);
    const firstSlotByGroup = new Map<string, { dayOfWeek: number; startTime: string }>();
    for (const slot of slots) {
      if (!slot.groupId) continue;
      const cur = firstSlotByGroup.get(slot.groupId);
      if (!cur || slot.dayOfWeek < cur.dayOfWeek || (slot.dayOfWeek === cur.dayOfWeek && slot.startTime < cur.startTime))
        firstSlotByGroup.set(slot.groupId, { dayOfWeek: slot.dayOfWeek, startTime: slot.startTime });
    }
    return buildGradeBoard(
      args.grade,
      groups.map((g) => ({
        _id: g._id,
        name: g.name,
        grade: g.grade,
        additionalGrades: g.additionalGrades,
        maxSize: g.maxSize,
        firstSession: firstSlotByGroup.get(g._id) ?? null,
      })),
      members.map((m) => ({ groupId: m.groupId, studentId: m.studentId })),
      students.map((s) => ({ _id: s._id, name: s.name, schoolGrade: s.schoolGrade })),
    );
  },
});

// Mirror of groups.sessionConflicts over draft tables — drives the red (mentor
// busy) / amber (a member booked elsewhere) rings on the dialog's session grid
// so double-booking is warned in the draft exactly like live.
export const sessionConflictsDraft = query({
  args: { groupId: v.id("draftGroups") },
  handler: async (ctx, args) => {
    if (!(await ctx.auth.getUserIdentity())) return { mentorBusy: [], studentBusy: [] };
    const group = await ctx.db.get(args.groupId);
    if (!group) return { mentorBusy: [], studentBusy: [] };

    const memberRows = await ctx.db
      .query("draftGroupMembers")
      .withIndex("by_group", (q) => q.eq("groupId", args.groupId))
      .collect();
    const memberIds = new Set(memberRows.map((m) => m.studentId));

    const allSlots = await ctx.db.query("draftSlots").collect();
    const mentorBusy: Array<{ dayOfWeek: number; startTime: string; endTime: string; groupName: string }> = [];
    const studentBusy: Array<{ dayOfWeek: number; startTime: string; endTime: string; groupName: string; studentName: string }> = [];

    for (const slot of allSlots) {
      if (!slot.groupId || slot.groupId === args.groupId) continue;
      const other = await ctx.db.get(slot.groupId);
      if (!other) continue;

      if (group.mentorId && other.mentorId === group.mentorId) {
        mentorBusy.push({ dayOfWeek: slot.dayOfWeek, startTime: slot.startTime, endTime: slot.endTime, groupName: other.name });
      }
      if (memberIds.size > 0) {
        const otherMembers = await ctx.db
          .query("draftGroupMembers")
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

export const candidateStudentsDraft = query({
  args: { groupId: v.id("draftGroups"), includeInOtherGroups: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    if (!(await ctx.auth.getUserIdentity())) return [];
    const group = await ctx.db.get(args.groupId);
    if (!group) return [];
    const accepted = new Set<number>([
      ...(group.grade != null ? [group.grade] : []),
      ...(group.additionalGrades ?? []),
    ]);
    const ownMembers = await ctx.db
      .query("draftGroupMembers")
      .withIndex("by_group", (q) => q.eq("groupId", args.groupId))
      .collect();
    const ownIds = new Set(ownMembers.map((m) => m.studentId));
    const inOther = new Set<string>();
    if (!args.includeInOtherGroups) {
      for (const m of await ctx.db.query("draftGroupMembers").collect())
        if (m.groupId !== args.groupId) inOther.add(m.studentId);
    }
    const all = await ctx.db.query("students").collect();
    return all
      .filter((s) => !ownIds.has(s._id))
      .filter((s) => accepted.size === 0 || accepted.has(s.schoolGrade))
      .filter((s) => args.includeInOtherGroups || !inOther.has(s._id))
      .sort((a, b) => a.name.localeCompare(b.name));
  },
});

// ─── Mutations ────────────────────────────────────────────────────────────────

export const createGroupDraft = mutation({
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
    await auth(ctx);
    let { centerId, defaultRoomId } = args;
    if (centerId === undefined || defaultRoomId === undefined) {
      const settings = await ctx.db.query("settings").first();
      if (centerId === undefined && settings?.defaultCenterId) centerId = settings.defaultCenterId;
      if (defaultRoomId === undefined && centerId) {
        const center = await ctx.db.get(centerId);
        if (center?.defaultRoomId) defaultRoomId = center.defaultRoomId;
      }
    }
    const now = Date.now();
    return await ctx.db.insert("draftGroups", {
      name: args.name,
      autoName: args.autoName ?? true,
      centerId,
      grade: args.grade,
      additionalGrades: args.additionalGrades,
      mentorId: args.mentorId,
      defaultRoomId,
      type: args.type,
      maxSize: args.maxSize,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const updateGroupDraft = mutation({
  args: {
    id: v.id("draftGroups"),
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
    loggingStartDate: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await auth(ctx);
    const { id, ...patch } = args;
    await ctx.db.patch(id, { ...patch, updatedAt: Date.now() });
  },
});

export const removeGroupDraft = mutation({
  args: { id: v.id("draftGroups") },
  handler: async (ctx, args) => {
    await auth(ctx);
    // Orphan owned draft slots (mirror live groups.remove), delete memberships.
    for (const s of await ctx.db.query("draftSlots").withIndex("by_group", (q) => q.eq("groupId", args.id)).collect())
      await ctx.db.patch(s._id, { groupId: undefined });
    for (const m of await ctx.db.query("draftGroupMembers").withIndex("by_group", (q) => q.eq("groupId", args.id)).collect())
      await ctx.db.delete(m._id);
    await ctx.db.delete(args.id);
  },
});

export const toggleSessionDraft = mutation({
  args: {
    groupId: v.id("draftGroups"),
    dayOfWeek: v.number(),
    startTime: v.string(),
    endTime: v.string(),
    roomId: v.optional(v.id("rooms")),
  },
  handler: async (ctx, args) => {
    await auth(ctx);
    const group = await ctx.db.get(args.groupId);
    if (!group) throw new ConvexError("Group not found");
    const roomId = args.roomId ?? group.defaultRoomId;
    if (!roomId) throw new ConvexError("No room: set a default room on the group first");

    const owned = await ctx.db
      .query("draftSlots")
      .withIndex("by_group", (q) => q.eq("groupId", args.groupId))
      .collect();
    const sameDayRoom = owned.filter((s) => s.dayOfWeek === args.dayOfWeek && s.roomId === roomId);
    const existing: SlotRange[] = sameDayRoom.map((s) => ({ id: s._id, startTime: s.startTime, endTime: s.endTime }));

    const band = { start: args.startTime, end: args.endTime };
    const isAdding = !existing.some((s) => s.startTime <= band.start && s.endTime >= band.end);

    // Block (adds only): another draft group overlapping this band in the room.
    if (isAdding) {
      const roomSlots = await ctx.db.query("draftSlots").collect();
      for (const s of roomSlots) {
        if (s.roomId !== roomId || !s.groupId || s.groupId === args.groupId) continue;
        if (s.dayOfWeek === args.dayOfWeek && rangesOverlap(s.startTime, s.endTime, args.startTime, args.endTime))
          throw new ConvexError("Room already booked at this time by another group");
      }
    }

    const { result, toggled } = toggleBand(existing, band);
    const keptIds = new Set(result.map((r) => r.sourceId).filter((x): x is string => x != null));
    let primarySlotId: Id<"draftSlots"> | undefined;
    for (const r of result) {
      if (r.sourceId) {
        await ctx.db.patch(r.sourceId as Id<"draftSlots">, { startTime: r.startTime, endTime: r.endTime });
        if (!primarySlotId) primarySlotId = r.sourceId as Id<"draftSlots">;
      } else {
        const newId = await ctx.db.insert("draftSlots", {
          dayOfWeek: args.dayOfWeek,
          startTime: r.startTime,
          endTime: r.endTime,
          roomId,
          groupId: args.groupId,
        });
        if (!primarySlotId) primarySlotId = newId;
      }
    }
    // Draft slots carry no attendance/payments, so an absorbed/removed slot is
    // simply deleted (kept range covers it) or orphaned (fully removed).
    for (const s of sameDayRoom) {
      if (keptIds.has(s._id)) continue;
      const covered = result.some((r) => r.sourceId != null && r.startTime <= s.startTime && r.endTime >= s.endTime);
      if (covered) await ctx.db.delete(s._id);
      else await ctx.db.patch(s._id, { groupId: undefined });
    }
    return { action: toggled, slotId: primarySlotId };
  },
});

async function assertGradeOk(
  ctx: { db: { get: (id: Id<"students">) => Promise<Doc<"students"> | null> } },
  group: Doc<"draftGroups">,
  studentId: Id<"students">,
) {
  const accepted = [...(group.grade != null ? [group.grade] : []), ...(group.additionalGrades ?? [])];
  if (accepted.length === 0) return;
  const s = await ctx.db.get(studentId);
  if (!s) throw new ConvexError("Student not found");
  if (!accepted.includes(s.schoolGrade))
    throw new ConvexError(`${s.name} is Grade ${s.schoolGrade}; this group accepts ${accepted.join(", ")}`);
}

export const addMemberDraft = mutation({
  args: { groupId: v.id("draftGroups"), studentId: v.id("students") },
  handler: async (ctx, args) => {
    await auth(ctx);
    const group = await ctx.db.get(args.groupId);
    if (!group) throw new ConvexError("Group not found");
    await assertGradeOk(ctx, group, args.studentId);
    const existing = await ctx.db
      .query("draftGroupMembers")
      .withIndex("by_group_student", (q) => q.eq("groupId", args.groupId).eq("studentId", args.studentId))
      .first();
    if (existing) return existing._id;
    return await ctx.db.insert("draftGroupMembers", {
      groupId: args.groupId,
      studentId: args.studentId,
      joinedAt: Date.now(),
    });
  },
});

export const removeMemberDraft = mutation({
  args: { groupId: v.id("draftGroups"), studentId: v.id("students") },
  handler: async (ctx, args) => {
    await auth(ctx);
    const row = await ctx.db
      .query("draftGroupMembers")
      .withIndex("by_group_student", (q) => q.eq("groupId", args.groupId).eq("studentId", args.studentId))
      .first();
    if (row) await ctx.db.delete(row._id);
  },
});

export const setMemberFeeDraft = mutation({
  args: { groupId: v.id("draftGroups"), studentId: v.id("students"), hourlyRate: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await auth(ctx);
    if (args.hourlyRate !== undefined && args.hourlyRate < 0) throw new ConvexError("Fee cannot be negative");
    const row = await ctx.db
      .query("draftGroupMembers")
      .withIndex("by_group_student", (q) => q.eq("groupId", args.groupId).eq("studentId", args.studentId))
      .first();
    if (!row) throw new ConvexError("Student is not a member of this group");
    await ctx.db.patch(row._id, { hourlyRate: args.hourlyRate });
  },
});

export const applyRosterMovesDraft = mutation({
  args: {
    ops: v.array(
      v.object({
        studentId: v.id("students"),
        fromGroupId: v.union(v.id("draftGroups"), v.null()),
        toGroupId: v.union(v.id("draftGroups"), v.null()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    await auth(ctx);
    const typedOps = args.ops.filter((o) => o.fromGroupId !== o.toGroupId);
    if (typedOps.length === 0) return { applied: 0 };

    const groups = await ctx.db.query("draftGroups").collect();
    const groupById = new Map(groups.map((g) => [g._id as string, g]));
    const allMembers = await ctx.db.query("draftGroupMembers").collect();
    const currentCounts = new Map<string, number>();
    for (const m of allMembers) currentCounts.set(m.groupId, (currentCounts.get(m.groupId) ?? 0) + 1);
    const caps = new Map<string, number>();
    for (const g of groups) caps.set(g._id, g.maxSize ?? 10);

    const ops: RosterOp[] = typedOps.map((o) => ({
      studentId: o.studentId,
      fromGroupId: o.fromGroupId,
      toGroupId: o.toGroupId,
    }));
    const { ok, violations } = validateCaps(ops, currentCounts, caps);
    if (!ok) {
      const v0 = violations[0];
      throw new ConvexError(`${groupById.get(v0.groupId)?.name ?? "A group"} would have ${v0.count} students (max ${v0.cap})`);
    }
    for (const o of typedOps) {
      if (!o.toGroupId) continue;
      await assertGradeOk(ctx, groupById.get(o.toGroupId)!, o.studentId);
    }
    for (const o of typedOps) {
      if (!o.fromGroupId) continue;
      const row = await ctx.db
        .query("draftGroupMembers")
        .withIndex("by_group_student", (q) => q.eq("groupId", o.fromGroupId!).eq("studentId", o.studentId))
        .first();
      if (row) await ctx.db.delete(row._id);
    }
    for (const o of typedOps) {
      if (!o.toGroupId) continue;
      const existing = await ctx.db
        .query("draftGroupMembers")
        .withIndex("by_group_student", (q) => q.eq("groupId", o.toGroupId!).eq("studentId", o.studentId))
        .first();
      if (!existing)
        await ctx.db.insert("draftGroupMembers", { groupId: o.toGroupId, studentId: o.studentId, joinedAt: Date.now() });
    }
    return { applied: typedOps.length };
  },
});
