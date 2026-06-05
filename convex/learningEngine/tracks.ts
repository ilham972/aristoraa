// Phase 1 (track model): CRUD + read helpers for learning tracks.
// A track is a flat cross-grade ordered list of curriculum unit ids the
// student's Main block walks. See docs/superpowers/specs/2026-06-05-track-model-phase1-design.md

import { mutation, query } from "../_generated/server";
import { v } from "convex/values";
import type { GenericMutationCtx, GenericQueryCtx } from "convex/server";
import type { DataModel, Doc, Id } from "../_generated/dataModel";
import { resolveTeachingPath } from "./path";

type QueryCtx = GenericQueryCtx<DataModel>;
type MutationCtx = GenericMutationCtx<DataModel>;
type ReadCtx = QueryCtx | MutationCtx;

// Resolve the calling teacher id (best-effort audit field). Mirrors
// path.ts::resolveTeacherId — historical duplicate teacher rows mean we must
// collect()-not-unique() and pick the oldest deterministically.
async function resolveTeacherId(ctx: MutationCtx): Promise<Id<"teachers"> | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  const rows = await ctx.db
    .query("teachers")
    .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", identity.subject))
    .collect();
  if (rows.length === 0) return null;
  return rows.reduce((a, b) => (a._creationTime <= b._creationTime ? a : b))._id;
}

// Internal: the track a student rides, or null. Used by the planner (Task 3).
export async function resolveTrackForStudent(
  ctx: ReadCtx,
  student: Doc<"students">,
): Promise<Doc<"tracks"> | null> {
  if (!student.trackId) return null;
  return await ctx.db.get(student.trackId);
}

export const listTracks = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const rows = await ctx.db.query("tracks").collect();
    return rows.sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
  },
});

export const getTrack = query({
  args: { id: v.id("tracks") },
  handler: async (ctx, { id }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    return await ctx.db.get(id);
  },
});

export const createTrack = mutation({
  args: {
    name: v.string(),
    targetGrade: v.number(),
    targetTerm: v.number(),
    orderedUnitIds: v.array(v.string()),
    level: v.number(),
    mergesIntoTrackId: v.optional(v.id("tracks")),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    const teacherId = await resolveTeacherId(ctx);
    const now = Date.now();
    const id = await ctx.db.insert("tracks", {
      name: args.name,
      targetGrade: args.targetGrade,
      targetTerm: args.targetTerm,
      orderedUnitIds: args.orderedUnitIds,
      level: args.level,
      mergesIntoTrackId: args.mergesIntoTrackId,
      active: true,
      createdAt: now,
      updatedAt: now,
      ...(teacherId ? { updatedByTeacherId: teacherId } : {}),
    });
    return { ok: true as const, id };
  },
});

export const updateTrack = mutation({
  args: {
    id: v.id("tracks"),
    name: v.optional(v.string()),
    targetGrade: v.optional(v.number()),
    targetTerm: v.optional(v.number()),
    orderedUnitIds: v.optional(v.array(v.string())),
    level: v.optional(v.number()),
    mergesIntoTrackId: v.optional(v.id("tracks")),
    active: v.optional(v.boolean()),
  },
  handler: async (ctx, { id, ...rest }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    const existing = await ctx.db.get(id);
    if (!existing) throw new Error("Track not found");
    const teacherId = await resolveTeacherId(ctx);
    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    for (const [k, val] of Object.entries(rest)) {
      if (val !== undefined) patch[k] = val;
    }
    if (teacherId) patch.updatedByTeacherId = teacherId;
    await ctx.db.patch(id, patch);
    return { ok: true as const };
  },
});

export const setStudentTrack = mutation({
  args: { studentId: v.id("students"), trackId: v.union(v.id("tracks"), v.null()) },
  handler: async (ctx, { studentId, trackId }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    await ctx.db.patch(studentId, { trackId: trackId ?? undefined });
    return { ok: true as const };
  },
});

// ── Seed on-level tracks + backfill student assignment (Task 3) ────────────

// Apply saved teaching-path order to a (grade,term)'s natural unit list, then
// append any units missing from the saved order (new/unsaved) in natural order.
function orderUnitsBySavedPath(naturalUnitIds: string[], saved: string[] | null): string[] {
  if (!saved || saved.length === 0) return naturalUnitIds.slice();
  const rank = new Map<string, number>();
  saved.forEach((id, i) => rank.set(id, i));
  const BIG = saved.length + naturalUnitIds.length;
  return naturalUnitIds
    .map((id, natIdx) => ({ id, key: rank.get(id) ?? BIG + natIdx }))
    .sort((a, b) => a.key - b.key)
    .map((x) => x.id);
}

// Seed/refresh one "On-level G{grade}" track per grade. Idempotent: upserts by
// name. Client provides per-(grade,term) natural unit ids. level = grade*10 so
// remedial levels can slot between grades later.
export const seedOnLevelTracks = mutation({
  args: {
    perGradeTerm: v.array(
      v.object({ grade: v.number(), term: v.number(), naturalUnitIds: v.array(v.string()) }),
    ),
  },
  handler: async (ctx, { perGradeTerm }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");

    // Group incoming (grade,term) → naturalUnitIds.
    const byGrade = new Map<number, Map<number, string[]>>();
    for (const r of perGradeTerm) {
      if (!byGrade.has(r.grade)) byGrade.set(r.grade, new Map());
      byGrade.get(r.grade)!.set(r.term, r.naturalUnitIds);
    }

    const now = Date.now();
    let created = 0;
    let updated = 0;
    for (const [grade, terms] of Array.from(byGrade)) {
      const orderedUnitIds: string[] = [];
      for (const term of [1, 2, 3]) {
        const natural = terms.get(term);
        if (!natural || natural.length === 0) continue;
        const saved = await resolveTeachingPath(ctx, grade, term);
        orderedUnitIds.push(...orderUnitsBySavedPath(natural, saved));
      }
      const name = `On-level G${grade}`;
      const existing = (await ctx.db.query("tracks").collect()).find((t) => t.name === name);
      if (existing) {
        await ctx.db.patch(existing._id, { orderedUnitIds, updatedAt: now });
        updated++;
      } else {
        await ctx.db.insert("tracks", {
          name,
          targetGrade: grade,
          targetTerm: 1,
          orderedUnitIds,
          level: grade * 10,
          active: true,
          createdAt: now,
          updatedAt: now,
        });
        created++;
      }
    }
    return { ok: true as const, created, updated };
  },
});

// Assign every student lacking a trackId to their schoolGrade's On-level track.
export const backfillStudentTracks = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    const tracks = await ctx.db.query("tracks").collect();
    const onLevelByGrade = new Map<number, Id<"tracks">>();
    for (const t of tracks) {
      if (t.name === `On-level G${t.targetGrade}`) onLevelByGrade.set(t.targetGrade, t._id);
    }
    const students = await ctx.db.query("students").collect();
    let assigned = 0;
    for (const s of students) {
      if (s.trackId) continue;
      const tid = onLevelByGrade.get(s.schoolGrade);
      if (!tid) continue;
      await ctx.db.patch(s._id, { trackId: tid });
      assigned++;
    }
    return { ok: true as const, assigned };
  },
});
