// Phase F.6 — roster resolution seam.
//
// Single source of truth for "who is in this slot?" and "which slots does
// this teacher run?", bridging the new group model and the legacy
// slot-roster tables. Every reader (score-entry, planner, lead) calls these
// instead of querying slotStudents/slotTeachers directly, so a slot can be
// driven by EITHER model during the migration window:
//
//   slot.groupId set  → roster = groupMembers; teacher = group.mentorId
//   slot.groupId unset → roster = slotStudents; teacher = slotTeachers (legacy)
//
// This makes /groups edits show up everywhere once a slot is migrated, while
// un-migrated slots keep working untouched.

import type { QueryCtx, MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";

type Ctx = QueryCtx | MutationCtx;

/** Student ids enrolled in a slot, ignoring date overrides. */
export async function baseStudentIdsForSlot(
  ctx: Ctx,
  slot: Doc<"scheduleSlots">,
): Promise<Id<"students">[]> {
  if (slot.groupId) {
    const members = await ctx.db
      .query("groupMembers")
      .withIndex("by_group", (q) => q.eq("groupId", slot.groupId!))
      .collect();
    return members.map((m) => m.studentId);
  }
  const legacy = await ctx.db
    .query("slotStudents")
    .withIndex("by_slot", (q) => q.eq("slotId", slot._id))
    .collect();
  return legacy.map((s) => s.studentId);
}

/** Student ids for a slot ON a date, with slotOverrides (add/remove) applied. */
export async function effectiveStudentIdsForSlot(
  ctx: Ctx,
  slot: Doc<"scheduleSlots">,
  date: string,
): Promise<Id<"students">[]> {
  const ids = new Set(await baseStudentIdsForSlot(ctx, slot));
  const overrides = await ctx.db
    .query("slotOverrides")
    .withIndex("by_slot_date", (q) => q.eq("slotId", slot._id).eq("date", date))
    .collect();
  for (const o of overrides) {
    if (o.action === "add") ids.add(o.studentId);
    else if (o.action === "remove") ids.delete(o.studentId);
  }
  return Array.from(ids);
}

/** Slot ids a teacher runs: group-mentor slots ∪ legacy slotTeachers slots. */
export async function slotIdsForTeacher(
  ctx: Ctx,
  teacherId: Id<"teachers">,
): Promise<Id<"scheduleSlots">[]> {
  const out = new Set<Id<"scheduleSlots">>();

  const mentorGroups = await ctx.db
    .query("groups")
    .withIndex("by_mentor", (q) => q.eq("mentorId", teacherId))
    .collect();
  for (const g of mentorGroups) {
    const slots = await ctx.db
      .query("scheduleSlots")
      .withIndex("by_group", (q) => q.eq("groupId", g._id))
      .collect();
    for (const s of slots) out.add(s._id);
  }

  // Legacy assignments only count for slots NOT yet owned by a group (group
  // slots are already covered above, and their mentor is authoritative).
  const legacy = await ctx.db
    .query("slotTeachers")
    .withIndex("by_teacher", (q) => q.eq("teacherId", teacherId))
    .collect();
  for (const st of legacy) {
    const slot = await ctx.db.get(st.slotId);
    if (slot && !slot.groupId) out.add(st.slotId);
  }

  return Array.from(out);
}
