// Phase F.7 — one-time import of the legacy slot schedule into groups.
//
// Strategy: cluster every group-less scheduleSlot by its EXACT student
// roster (sorted studentId set). Each cluster becomes one group whose
// sessions are the clustered slots. Mentor/room/centre/grade are inferred
// (mode) with mismatch flags surfaced in the preview.
//
// Safety: slotStudents / slotTeachers are NOT deleted — the migration only
// ADDS groups/groupMembers and STAMPS scheduleSlots.groupId. So `rollback`
// (delete groups + clear groupId) fully restores the pre-migration state,
// and readers fall back to the untouched legacy tables. The user previews
// before applying; refinements (split/merge/rename) happen in the normal
// /groups editor afterward.

import { mutation, query } from "./_generated/server";
import type { QueryCtx, MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { generateAutoName } from "./lib/naming";

type Ctx = QueryCtx | MutationCtx;

type Cluster = {
  key: string;
  studentIds: Id<"students">[];
  slotIds: Id<"scheduleSlots">[];
};

// Most-frequent value. Keys are Convex Ids (strings) or numbers; we track the
// running winner inline to avoid iterating a Map (disallowed under Convex's
// tsconfig target / downlevelIteration).
function mode<T extends string | number>(items: T[]): T | undefined {
  const counts: Record<string, number> = {};
  let best: T | undefined;
  let bestN = 0;
  for (const it of items) {
    const key = String(it);
    const next = (counts[key] ?? 0) + 1;
    counts[key] = next;
    if (next > bestN) { best = it; bestN = next; }
  }
  return best;
}

// Build clusters from group-less slots keyed by sorted roster. Shared by
// preview + apply so both see identical groupings.
async function buildClusters(ctx: Ctx): Promise<Cluster[]> {
  const slots = await ctx.db.query("scheduleSlots").collect();
  const groupless = slots.filter((s) => !s.groupId);

  const clusters = new Map<string, Cluster>();
  for (const slot of groupless) {
    const links = await ctx.db
      .query("slotStudents")
      .withIndex("by_slot", (q) => q.eq("slotId", slot._id))
      .collect();
    const studentIds = links.map((l) => l.studentId).sort();
    if (studentIds.length === 0) continue; // skip empty slots
    const key = studentIds.join(",");
    const existing = clusters.get(key);
    if (existing) {
      existing.slotIds.push(slot._id);
    } else {
      clusters.set(key, { key, studentIds: [...studentIds], slotIds: [slot._id] });
    }
  }
  return Array.from(clusters.values());
}

const DAY_SHORT = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export const preview = query({
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return { groups: [], skippedEmptySlots: 0, alreadyMigrated: 0 };

    const allSlots = await ctx.db.query("scheduleSlots").collect();
    const alreadyMigrated = allSlots.filter((s) => s.groupId).length;

    // Count empty group-less slots (skipped).
    let skippedEmptySlots = 0;
    for (const s of allSlots) {
      if (s.groupId) continue;
      const links = await ctx.db
        .query("slotStudents")
        .withIndex("by_slot", (q) => q.eq("slotId", s._id))
        .collect();
      if (links.length === 0) skippedEmptySlots++;
    }

    const clusters = await buildClusters(ctx);

    const groups = [];
    for (const c of clusters) {
      const memberNames: string[] = [];
      const memberGrades: number[] = [];
      for (const sid of c.studentIds) {
        const s = await ctx.db.get(sid);
        if (s) {
          memberNames.push(s.name);
          memberGrades.push(s.schoolGrade);
        }
      }

      // Sessions + inferred room + mentor.
      const sessions: { dayOfWeek: number; startTime: string; endTime: string; label: string }[] = [];
      const roomIds: Id<"rooms">[] = [];
      const mentorIds: Id<"teachers">[] = [];
      for (const slotId of c.slotIds) {
        const slot = await ctx.db.get(slotId);
        if (!slot) continue;
        roomIds.push(slot.roomId);
        sessions.push({
          dayOfWeek: slot.dayOfWeek,
          startTime: slot.startTime,
          endTime: slot.endTime,
          label: `${DAY_SHORT[slot.dayOfWeek] ?? "?"} ${slot.startTime}`,
        });
        const sts = await ctx.db
          .query("slotTeachers")
          .withIndex("by_slot", (q) => q.eq("slotId", slotId))
          .collect();
        for (const st of sts) mentorIds.push(st.teacherId);
      }

      const roomId = mode(roomIds);
      const room = roomId ? await ctx.db.get(roomId) : null;
      const mentorId = mode(mentorIds);
      const mentor = mentorId ? await ctx.db.get(mentorId) : null;
      const mentorMismatch = new Set(mentorIds).size > 1;
      const grade = mode(memberGrades);

      sessions.sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.startTime.localeCompare(b.startTime));

      groups.push({
        name: generateAutoName(memberNames),
        memberNames,
        memberCount: memberNames.length,
        sessionCount: sessions.length,
        sessions,
        roomName: room?.name ?? "—",
        mentorName: mentor?.name ?? "—",
        mentorMismatch,
        grade,
      });
    }

    groups.sort((a, b) => b.sessionCount - a.sessionCount);
    return { groups, skippedEmptySlots, alreadyMigrated };
  },
});

export const apply = mutation({
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");

    const clusters = await buildClusters(ctx);
    const now = Date.now();
    let groupsCreated = 0;
    let slotsStamped = 0;
    let membersAdded = 0;

    for (const c of clusters) {
      // Gather member/session detail for inference.
      const memberNames: string[] = [];
      const memberGrades: number[] = [];
      const memberCenters: (Id<"centers"> | undefined)[] = [];
      for (const sid of c.studentIds) {
        const s = await ctx.db.get(sid);
        if (s) {
          memberNames.push(s.name);
          memberGrades.push(s.schoolGrade);
          memberCenters.push(s.centerId);
        }
      }

      const roomIds: Id<"rooms">[] = [];
      const mentorIds: Id<"teachers">[] = [];
      for (const slotId of c.slotIds) {
        const slot = await ctx.db.get(slotId);
        if (!slot) continue;
        roomIds.push(slot.roomId);
        const sts = await ctx.db
          .query("slotTeachers")
          .withIndex("by_slot", (q) => q.eq("slotId", slotId))
          .collect();
        for (const st of sts) mentorIds.push(st.teacherId);
      }

      const roomId = mode(roomIds);
      const room = roomId ? await ctx.db.get(roomId) : null;
      const centerId = room?.centerId ?? mode(memberCenters.filter(Boolean) as Id<"centers">[]);
      const mentorId = mode(mentorIds);
      const grade = mode(memberGrades);

      const groupId = await ctx.db.insert("groups", {
        name: generateAutoName(memberNames),
        autoName: true,
        centerId,
        grade,
        mentorId,
        defaultRoomId: roomId,
        archived: false,
        createdAt: now,
        updatedAt: now,
      });
      groupsCreated++;

      for (const sid of c.studentIds) {
        await ctx.db.insert("groupMembers", { groupId, studentId: sid, joinedAt: now });
        membersAdded++;
      }

      for (const slotId of c.slotIds) {
        await ctx.db.patch(slotId, { groupId });
        slotsStamped++;
      }
    }

    return { groupsCreated, slotsStamped, membersAdded };
  },
});

// Full rollback: delete every group + groupMember and clear groupId on all
// slots. Legacy slotStudents/slotTeachers are untouched, so this restores the
// exact pre-migration behaviour. Run via the preview UI's "Undo import".
export const rollback = mutation({
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");

    const slots = await ctx.db.query("scheduleSlots").collect();
    let cleared = 0;
    for (const s of slots) {
      if (s.groupId) { await ctx.db.patch(s._id, { groupId: undefined }); cleared++; }
    }
    const members = await ctx.db.query("groupMembers").collect();
    for (const m of members) await ctx.db.delete(m._id);
    const groups = await ctx.db.query("groups").collect();
    for (const g of groups) await ctx.db.delete(g._id);

    return { slotsCleared: cleared, groupsDeleted: groups.length };
  },
});
