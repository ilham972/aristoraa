// Planning mode — the draft timetable "branch". Fork the live timetable into
// draft tables, edit it through the same week view (stage 2), then Pull (live
// → draft) or Merge (draft → live). The decision logic is pure + tested in
// convex/lib/draftReconcile.ts; this module only loads rows, computes their
// fingerprints, and translates the resulting plans into db writes — including
// the draft→live foreign-key remap that keeps identities (and all history)
// intact on Merge. One draft at a time.

import { query, mutation } from "./_generated/server";
import { ConvexError } from "convex/values";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Id, Doc } from "./_generated/dataModel";
import {
  mergePlan,
  pullPlan,
  type LiveRow,
  type DraftRow,
  type Baseline,
} from "./lib/draftReconcile";

// ─── Fingerprints ──────────────────────────────────────────────────────────
// A stable string of a row's meaningful fields. Foreign keys that cross the
// draft/live boundary (slot→group, member→group, teacher→slot) are expressed
// as a TOKEN in the live-id space so a draft row and its live source compare
// equal when unchanged. Rooms/teachers/students/centres are never copied, so
// those ids already match across draft and live. Timestamps are excluded.
const stable = (o: Record<string, unknown>) => JSON.stringify(o);

function fpGroup(g: Doc<"groups"> | Doc<"draftGroups">): string {
  return stable({
    name: g.name,
    autoName: g.autoName,
    centerId: g.centerId ?? null,
    grade: g.grade ?? null,
    additionalGrades: [...(g.additionalGrades ?? [])].sort(),
    mentorId: g.mentorId ?? null,
    defaultRoomId: g.defaultRoomId ?? null,
    type: g.type ?? null,
    maxSize: g.maxSize ?? null,
    targetMarksMin: g.targetMarksMin ?? null,
    targetMarksMax: g.targetMarksMax ?? null,
    loggingStartDate: g.loggingStartDate ?? null,
  });
}
function fpSlot(
  s: Doc<"scheduleSlots"> | Doc<"draftSlots">,
  groupToken: string,
): string {
  return stable({
    dayOfWeek: s.dayOfWeek,
    startTime: s.startTime,
    endTime: s.endTime,
    roomId: s.roomId,
    group: groupToken,
  });
}
function fpMember(
  m: Doc<"groupMembers"> | Doc<"draftGroupMembers">,
  groupToken: string,
): string {
  return stable({
    studentId: m.studentId,
    hourlyRate: m.hourlyRate ?? null,
    group: groupToken,
  });
}
function fpTeacher(
  t: Doc<"slotTeachers"> | Doc<"draftSlotTeachers">,
  slotToken: string,
): string {
  return stable({ teacherId: t.teacherId, slot: slotToken });
}

// Token = the live id a draft FK ultimately points at, or "new:<draftId>" when
// it points at something created inside the draft, or "none" when unset.
const liveTokenFromSource = (
  draftId: Id<"draftGroups"> | Id<"draftSlots">,
  sourceId: Id<"groups"> | Id<"scheduleSlots"> | undefined,
): string => (sourceId ? sourceId : `new:${draftId}`);

// ─── Loading + plan building (shared by Merge and the status query) ─────────
type Loaded = {
  liveGroups: Doc<"groups">[];
  liveSlots: Doc<"scheduleSlots">[];
  liveMembers: Doc<"groupMembers">[];
  liveTeachers: Doc<"slotTeachers">[];
  draftGroups: Doc<"draftGroups">[];
  draftSlots: Doc<"draftSlots">[];
  draftMembers: Doc<"draftGroupMembers">[];
  draftTeachers: Doc<"draftSlotTeachers">[];
  meta: Doc<"draftMeta">;
};

async function loadAll(ctx: QueryCtx, meta: Doc<"draftMeta">): Promise<Loaded> {
  return {
    liveGroups: await ctx.db.query("groups").collect(),
    liveSlots: await ctx.db.query("scheduleSlots").collect(),
    liveMembers: await ctx.db.query("groupMembers").collect(),
    liveTeachers: await ctx.db.query("slotTeachers").collect(),
    draftGroups: await ctx.db.query("draftGroups").collect(),
    draftSlots: await ctx.db.query("draftSlots").collect(),
    draftMembers: await ctx.db.query("draftGroupMembers").collect(),
    draftTeachers: await ctx.db.query("draftSlotTeachers").collect(),
    meta,
  };
}

// Build the four reconcile inputs (live rows, draft rows, baseline) per table.
function reconcileInputs(d: Loaded) {
  const draftGroupSource = new Map(d.draftGroups.map((g) => [g._id, g.sourceId]));
  const draftSlotSource = new Map(d.draftSlots.map((s) => [s._id, s.sourceId]));

  const groups = {
    live: d.liveGroups.map((g): LiveRow => ({ id: g._id, fp: fpGroup(g) })),
    draft: d.draftGroups.map(
      (g): DraftRow => ({ id: g._id, sourceId: g.sourceId ?? null, fp: fpGroup(g) }),
    ),
    baseline: (d.meta.baseGroups ?? {}) as Baseline,
  };

  const liveSlotGroupToken = (s: Doc<"scheduleSlots">) =>
    s.groupId ? s.groupId : "none";
  const draftSlotGroupToken = (s: Doc<"draftSlots">) =>
    s.groupId ? liveTokenFromSource(s.groupId, draftGroupSource.get(s.groupId)) : "none";

  const slots = {
    live: d.liveSlots.map((s): LiveRow => ({ id: s._id, fp: fpSlot(s, liveSlotGroupToken(s)) })),
    draft: d.draftSlots.map(
      (s): DraftRow => ({ id: s._id, sourceId: s.sourceId ?? null, fp: fpSlot(s, draftSlotGroupToken(s)) }),
    ),
    baseline: (d.meta.baseSlots ?? {}) as Baseline,
  };

  const members = {
    live: d.liveMembers.map((m): LiveRow => ({ id: m._id, fp: fpMember(m, m.groupId) })),
    draft: d.draftMembers.map(
      (m): DraftRow => ({
        id: m._id,
        sourceId: m.sourceId ?? null,
        fp: fpMember(m, liveTokenFromSource(m.groupId, draftGroupSource.get(m.groupId))),
      }),
    ),
    baseline: (d.meta.baseMembers ?? {}) as Baseline,
  };

  const teachers = {
    live: d.liveTeachers.map((t): LiveRow => ({ id: t._id, fp: fpTeacher(t, t.slotId) })),
    draft: d.draftTeachers.map(
      (t): DraftRow => ({
        id: t._id,
        sourceId: t.sourceId ?? null,
        fp: fpTeacher(t, liveTokenFromSource(t.slotId, draftSlotSource.get(t.slotId))),
      }),
    ),
    baseline: (d.meta.baseTeachers ?? {}) as Baseline,
  };

  return { groups, slots, members, teachers };
}

// ─── Internal fork / discard (reused by merge to reset the draft) ───────────
async function doDiscard(ctx: MutationCtx) {
  for (const t of ["draftSlotTeachers", "draftGroupMembers", "draftSlots", "draftGroups"] as const) {
    for (const row of await ctx.db.query(t).collect()) await ctx.db.delete(row._id);
  }
  for (const m of await ctx.db.query("draftMeta").collect()) await ctx.db.delete(m._id);
}

// Copy the whole live structural timetable into the draft tables, remapping
// live FKs to the new draft ids, and record the baseline fingerprints.
async function doFork(ctx: MutationCtx) {
  const liveGroups = await ctx.db.query("groups").collect();
  const liveSlots = await ctx.db.query("scheduleSlots").collect();
  const liveMembers = await ctx.db.query("groupMembers").collect();
  const liveTeachers = await ctx.db.query("slotTeachers").collect();

  const baseGroups: Baseline = {};
  const baseSlots: Baseline = {};
  const baseMembers: Baseline = {};
  const baseTeachers: Baseline = {};

  const groupMap = new Map<Id<"groups">, Id<"draftGroups">>();
  for (const g of liveGroups) {
    baseGroups[g._id] = fpGroup(g);
    const { _id, _creationTime, ...fields } = g;
    const draftId = await ctx.db.insert("draftGroups", { ...fields, sourceId: g._id });
    groupMap.set(g._id, draftId);
  }

  const slotMap = new Map<Id<"scheduleSlots">, Id<"draftSlots">>();
  for (const s of liveSlots) {
    baseSlots[s._id] = fpSlot(s, s.groupId ?? "none");
    const { _id, _creationTime, groupId, ...fields } = s;
    const draftId = await ctx.db.insert("draftSlots", {
      ...fields,
      groupId: groupId ? groupMap.get(groupId) : undefined,
      sourceId: s._id,
    });
    slotMap.set(s._id, draftId);
  }

  for (const m of liveMembers) {
    baseMembers[m._id] = fpMember(m, m.groupId);
    const draftGroupId = groupMap.get(m.groupId);
    if (!draftGroupId) continue; // member of a group that no longer exists
    const { _id, _creationTime, groupId, ...fields } = m;
    await ctx.db.insert("draftGroupMembers", { ...fields, groupId: draftGroupId, sourceId: m._id });
  }

  for (const t of liveTeachers) {
    baseTeachers[t._id] = fpTeacher(t, t.slotId);
    const draftSlotId = slotMap.get(t.slotId);
    if (!draftSlotId) continue;
    const { _id, _creationTime, slotId, ...fields } = t;
    await ctx.db.insert("draftSlotTeachers", { ...fields, slotId: draftSlotId, sourceId: t._id });
  }

  const now = Date.now();
  await ctx.db.insert("draftMeta", {
    status: "active",
    createdAt: now,
    lastPullAt: now,
    baseGroups,
    baseSlots,
    baseMembers,
    baseTeachers,
  });
}

async function getMeta(ctx: QueryCtx): Promise<Doc<"draftMeta"> | null> {
  return await ctx.db.query("draftMeta").first();
}

function requireAuth(identity: unknown) {
  if (!identity) throw new ConvexError("Unauthenticated");
}

// ─── Public surface ─────────────────────────────────────────────────────────

// Is there an active draft, and how many pending changes would Merge apply?
export const status = query({
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return { exists: false as const };
    const meta = await getMeta(ctx);
    if (!meta) return { exists: false as const };

    const loaded = await loadAll(ctx, meta);
    const inputs = reconcileInputs(loaded);
    let creates = 0, patches = 0, deletes = 0, orphans = 0;
    for (const k of ["groups", "slots", "members", "teachers"] as const) {
      const p = mergePlan(inputs[k].draft, inputs[k].live, inputs[k].baseline);
      creates += p.creates.length;
      patches += p.patches.length;
      deletes += p.deletes.length;
      orphans += p.orphans.length;
    }
    return {
      exists: true as const,
      lastPullAt: meta.lastPullAt,
      counts: {
        groups: loaded.draftGroups.length,
        slots: loaded.draftSlots.length,
        members: loaded.draftMembers.length,
      },
      pending: { creates, patches, deletes, orphans },
    };
  },
});

// Start a draft by forking the live timetable. No-op if one already exists.
export const fork = mutation({
  handler: async (ctx) => {
    requireAuth(await ctx.auth.getUserIdentity());
    if (await getMeta(ctx)) return; // already have a draft
    await doFork(ctx);
  },
});

// Throw the draft away and re-fork fresh from current live.
export const reset = mutation({
  handler: async (ctx) => {
    requireAuth(await ctx.auth.getUserIdentity());
    await doDiscard(ctx);
    await doFork(ctx);
  },
});

// Throw the draft away entirely (Planning mode off, nothing kept).
export const discard = mutation({
  handler: async (ctx) => {
    requireAuth(await ctx.auth.getUserIdentity());
    await doDiscard(ctx);
  },
});

// Pull: bring current live into the draft without overwriting draft edits.
export const pull = mutation({
  handler: async (ctx) => {
    requireAuth(await ctx.auth.getUserIdentity());
    const meta = await getMeta(ctx);
    if (!meta) throw new ConvexError("No draft to pull into");
    const loaded = await loadAll(ctx, meta);
    const inputs = reconcileInputs(loaded);

    const liveGroupById = new Map(loaded.liveGroups.map((g) => [g._id, g]));
    const liveSlotById = new Map(loaded.liveSlots.map((s) => [s._id, s]));
    const liveMemberById = new Map(loaded.liveMembers.map((m) => [m._id, m]));
    const liveTeacherById = new Map(loaded.liveTeachers.map((t) => [t._id, t]));
    const draftById = new Map(loaded.draftGroups.map((g) => [g._id, g]));
    const draftSlotById = new Map(loaded.draftSlots.map((s) => [s._id, s]));
    // live group id → existing draft group id (for FK remap of newly-added rows)
    const groupSourceToDraft = new Map<Id<"groups">, Id<"draftGroups">>();
    for (const g of loaded.draftGroups) if (g.sourceId) groupSourceToDraft.set(g.sourceId, g._id);
    const slotSourceToDraft = new Map<Id<"scheduleSlots">, Id<"draftSlots">>();
    for (const s of loaded.draftSlots) if (s.sourceId) slotSourceToDraft.set(s.sourceId, s._id);

    let conflicts = 0;

    // Groups first (so added slots/members can map onto them).
    const gPlan = pullPlan(inputs.groups.draft, inputs.groups.live, inputs.groups.baseline);
    conflicts += gPlan.conflicts.length;
    for (const add of gPlan.adds) {
      const g = liveGroupById.get(add.id as Id<"groups">)!;
      const { _id, _creationTime, ...fields } = g;
      const newId = await ctx.db.insert("draftGroups", { ...fields, sourceId: g._id });
      groupSourceToDraft.set(g._id, newId);
    }
    for (const r of gPlan.refreshes) {
      const g = liveGroupById.get(r.live.id as Id<"groups">)!;
      const { _id, _creationTime, ...fields } = g;
      await ctx.db.patch(r.draftId as Id<"draftGroups">, { ...fields, sourceId: g._id });
    }

    const sPlan = pullPlan(inputs.slots.draft, inputs.slots.live, inputs.slots.baseline);
    conflicts += sPlan.conflicts.length;
    for (const add of sPlan.adds) {
      const s = liveSlotById.get(add.id as Id<"scheduleSlots">)!;
      const { _id, _creationTime, groupId, ...fields } = s;
      const newId = await ctx.db.insert("draftSlots", {
        ...fields,
        groupId: groupId ? groupSourceToDraft.get(groupId) : undefined,
        sourceId: s._id,
      });
      slotSourceToDraft.set(s._id, newId);
    }
    for (const r of sPlan.refreshes) {
      const s = liveSlotById.get(r.live.id as Id<"scheduleSlots">)!;
      const { _id, _creationTime, groupId, ...fields } = s;
      await ctx.db.patch(r.draftId as Id<"draftSlots">, {
        ...fields,
        groupId: groupId ? groupSourceToDraft.get(groupId) : undefined,
      });
    }

    const mPlan = pullPlan(inputs.members.draft, inputs.members.live, inputs.members.baseline);
    conflicts += mPlan.conflicts.length;
    for (const add of mPlan.adds) {
      const m = liveMemberById.get(add.id as Id<"groupMembers">)!;
      const draftGroupId = groupSourceToDraft.get(m.groupId);
      if (!draftGroupId) continue;
      const { _id, _creationTime, groupId, ...fields } = m;
      await ctx.db.insert("draftGroupMembers", { ...fields, groupId: draftGroupId, sourceId: m._id });
    }
    for (const r of mPlan.refreshes) {
      const m = liveMemberById.get(r.live.id as Id<"groupMembers">)!;
      const draftGroupId = groupSourceToDraft.get(m.groupId);
      const { _id, _creationTime, groupId, ...fields } = m;
      await ctx.db.patch(r.draftId as Id<"draftGroupMembers">, {
        ...fields,
        ...(draftGroupId ? { groupId: draftGroupId } : {}),
      });
    }

    const tPlan = pullPlan(inputs.teachers.draft, inputs.teachers.live, inputs.teachers.baseline);
    conflicts += tPlan.conflicts.length;
    for (const add of tPlan.adds) {
      const t = liveTeacherById.get(add.id as Id<"slotTeachers">)!;
      const draftSlotId = slotSourceToDraft.get(t.slotId);
      if (!draftSlotId) continue;
      const { _id, _creationTime, slotId, ...fields } = t;
      await ctx.db.insert("draftSlotTeachers", { ...fields, slotId: draftSlotId, sourceId: t._id });
    }
    for (const r of tPlan.refreshes) {
      const t = liveTeacherById.get(r.live.id as Id<"slotTeachers">)!;
      const draftSlotId = slotSourceToDraft.get(t.slotId);
      const { _id, _creationTime, slotId, ...fields } = t;
      await ctx.db.patch(r.draftId as Id<"draftSlotTeachers">, {
        ...fields,
        ...(draftSlotId ? { slotId: draftSlotId } : {}),
      });
    }

    // Re-baseline against current live (everything the draft now knows about).
    await rebaseline(ctx, meta._id);
    // touch state to avoid unused-var lints; conflicts surfaced via return.
    void draftById; void draftSlotById;
    return { conflicts };
  },
});

// Recompute baseline fingerprints from current live, after a fork/pull/merge.
async function rebaseline(ctx: MutationCtx, metaId: Id<"draftMeta">) {
  const baseGroups: Baseline = {};
  const baseSlots: Baseline = {};
  const baseMembers: Baseline = {};
  const baseTeachers: Baseline = {};
  for (const g of await ctx.db.query("groups").collect()) baseGroups[g._id] = fpGroup(g);
  for (const s of await ctx.db.query("scheduleSlots").collect())
    baseSlots[s._id] = fpSlot(s, s.groupId ?? "none");
  for (const m of await ctx.db.query("groupMembers").collect())
    baseMembers[m._id] = fpMember(m, m.groupId);
  for (const t of await ctx.db.query("slotTeachers").collect())
    baseTeachers[t._id] = fpTeacher(t, t.slotId);
  await ctx.db.patch(metaId, {
    lastPullAt: Date.now(),
    baseGroups,
    baseSlots,
    baseMembers,
    baseTeachers,
  });
}

// Idempotent delete: a row may already be gone via an earlier cascade (e.g. a
// group deletion removed its members) before its own table's delete plan runs.
async function safeDelete(ctx: MutationCtx, id: Id<"groupMembers"> | Id<"slotTeachers"> | Id<"groups">) {
  if (await ctx.db.get(id)) await ctx.db.delete(id);
}

// Cascade-delete a live slot exactly like scheduleSlots.remove does.
async function removeLiveSlot(ctx: MutationCtx, slotId: Id<"scheduleSlots">) {
  if (!(await ctx.db.get(slotId))) return;
  for (const ss of await ctx.db.query("slotStudents").withIndex("by_slot", (q) => q.eq("slotId", slotId)).collect())
    await ctx.db.delete(ss._id);
  for (const o of await ctx.db.query("slotOverrides").withIndex("by_slot_date", (q) => q.eq("slotId", slotId)).collect())
    await ctx.db.delete(o._id);
  for (const st of await ctx.db.query("slotTeachers").withIndex("by_slot", (q) => q.eq("slotId", slotId)).collect())
    await ctx.db.delete(st._id);
  for (const a of await ctx.db.query("attendance").withIndex("by_slot_date", (q) => q.eq("slotId", slotId)).collect())
    await ctx.db.delete(a._id);
  await ctx.db.delete(slotId);
}

// Merge: apply the draft onto live in place (identity preserved), then reset
// the draft to a fresh fork of the new live. Returns a plain-English summary.
export const merge = mutation({
  handler: async (ctx) => {
    requireAuth(await ctx.auth.getUserIdentity());
    const meta = await getMeta(ctx);
    if (!meta) throw new ConvexError("No draft to merge");
    const loaded = await loadAll(ctx, meta);
    const inputs = reconcileInputs(loaded);

    const draftGroupById = new Map(loaded.draftGroups.map((g) => [g._id, g]));
    const draftSlotById = new Map(loaded.draftSlots.map((s) => [s._id, s]));
    const draftMemberById = new Map(loaded.draftMembers.map((m) => [m._id, m]));
    const draftTeacherById = new Map(loaded.draftTeachers.map((t) => [t._id, t]));

    const summary = { groupsAdded: 0, groupsChanged: 0, groupsRemoved: 0, slotsChanged: 0, membersChanged: 0, teachersChanged: 0, orphans: 0 };

    // 1) Groups → build draftGroupId → liveGroupId map.
    const groupIdMap = new Map<Id<"draftGroups">, Id<"groups">>();
    const gPlan = mergePlan(inputs.groups.draft, inputs.groups.live, inputs.groups.baseline);
    summary.orphans += gPlan.orphans.length;
    for (const c of gPlan.creates) {
      const dg = draftGroupById.get(c.id as Id<"draftGroups">)!;
      const { _id, _creationTime, sourceId, ...fields } = dg;
      const newId = await ctx.db.insert("groups", { ...fields });
      groupIdMap.set(dg._id, newId);
      summary.groupsAdded++;
    }
    for (const p of gPlan.patches) {
      const dg = draftGroupById.get(p.draft.id as Id<"draftGroups">)!;
      const { _id, _creationTime, sourceId, createdAt, ...fields } = dg;
      await ctx.db.patch(p.liveId as Id<"groups">, { ...fields, updatedAt: Date.now() });
      groupIdMap.set(dg._id, p.liveId as Id<"groups">);
      summary.groupsChanged++;
    }
    for (const dg of loaded.draftGroups)
      if (dg.sourceId && !groupIdMap.has(dg._id)) groupIdMap.set(dg._id, dg.sourceId);
    for (const liveId of gPlan.deletes) {
      for (const m of await ctx.db.query("groupMembers").withIndex("by_group", (q) => q.eq("groupId", liveId as Id<"groups">)).collect())
        await ctx.db.delete(m._id);
      for (const s of await ctx.db.query("scheduleSlots").withIndex("by_group", (q) => q.eq("groupId", liveId as Id<"groups">)).collect())
        await ctx.db.patch(s._id, { groupId: undefined });
      await ctx.db.delete(liveId as Id<"groups">);
      summary.groupsRemoved++;
    }

    // 2) Slots → build draftSlotId → liveSlotId map.
    const slotIdMap = new Map<Id<"draftSlots">, Id<"scheduleSlots">>();
    const sPlan = mergePlan(inputs.slots.draft, inputs.slots.live, inputs.slots.baseline);
    summary.orphans += sPlan.orphans.length;
    for (const c of sPlan.creates) {
      const ds = draftSlotById.get(c.id as Id<"draftSlots">)!;
      const newId = await ctx.db.insert("scheduleSlots", {
        dayOfWeek: ds.dayOfWeek,
        startTime: ds.startTime,
        endTime: ds.endTime,
        roomId: ds.roomId,
        groupId: ds.groupId ? groupIdMap.get(ds.groupId) : undefined,
      });
      slotIdMap.set(ds._id, newId);
      summary.slotsChanged++;
    }
    for (const p of sPlan.patches) {
      const ds = draftSlotById.get(p.draft.id as Id<"draftSlots">)!;
      await ctx.db.patch(p.liveId as Id<"scheduleSlots">, {
        dayOfWeek: ds.dayOfWeek,
        startTime: ds.startTime,
        endTime: ds.endTime,
        roomId: ds.roomId,
        groupId: ds.groupId ? groupIdMap.get(ds.groupId) : undefined,
      });
      slotIdMap.set(ds._id, p.liveId as Id<"scheduleSlots">);
      summary.slotsChanged++;
    }
    for (const ds of loaded.draftSlots)
      if (ds.sourceId && !slotIdMap.has(ds._id)) slotIdMap.set(ds._id, ds.sourceId);
    for (const liveId of sPlan.deletes) {
      await removeLiveSlot(ctx, liveId as Id<"scheduleSlots">);
      summary.slotsChanged++;
    }

    // 3) Members (FK → live group).
    const mPlan = mergePlan(inputs.members.draft, inputs.members.live, inputs.members.baseline);
    for (const c of mPlan.creates) {
      const dm = draftMemberById.get(c.id as Id<"draftGroupMembers">)!;
      const liveGroupId = groupIdMap.get(dm.groupId);
      if (!liveGroupId) continue;
      await ctx.db.insert("groupMembers", {
        groupId: liveGroupId,
        studentId: dm.studentId,
        joinedAt: dm.joinedAt,
        hourlyRate: dm.hourlyRate,
      });
      summary.membersChanged++;
    }
    for (const p of mPlan.patches) {
      const dm = draftMemberById.get(p.draft.id as Id<"draftGroupMembers">)!;
      const liveGroupId = groupIdMap.get(dm.groupId);
      await ctx.db.patch(p.liveId as Id<"groupMembers">, {
        ...(liveGroupId ? { groupId: liveGroupId } : {}),
        studentId: dm.studentId,
        hourlyRate: dm.hourlyRate,
      });
      summary.membersChanged++;
    }
    for (const liveId of mPlan.deletes) {
      await safeDelete(ctx, liveId as Id<"groupMembers">);
      summary.membersChanged++;
    }

    // 4) Session teachers (FK → live slot).
    const tPlan = mergePlan(inputs.teachers.draft, inputs.teachers.live, inputs.teachers.baseline);
    for (const c of tPlan.creates) {
      const dt = draftTeacherById.get(c.id as Id<"draftSlotTeachers">)!;
      const liveSlotId = slotIdMap.get(dt.slotId);
      if (!liveSlotId) continue;
      await ctx.db.insert("slotTeachers", { slotId: liveSlotId, teacherId: dt.teacherId });
      summary.teachersChanged++;
    }
    for (const p of tPlan.patches) {
      const dt = draftTeacherById.get(p.draft.id as Id<"draftSlotTeachers">)!;
      const liveSlotId = slotIdMap.get(dt.slotId);
      await ctx.db.patch(p.liveId as Id<"slotTeachers">, {
        ...(liveSlotId ? { slotId: liveSlotId } : {}),
        teacherId: dt.teacherId,
      });
      summary.teachersChanged++;
    }
    for (const liveId of tPlan.deletes) {
      await safeDelete(ctx, liveId as Id<"slotTeachers">);
      summary.teachersChanged++;
    }

    // Reset the draft to a clean fork of the new live so planning can continue.
    await doDiscard(ctx);
    await doFork(ctx);
    return summary;
  },
});
