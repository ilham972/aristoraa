// Phase 1 (track model): CRUD + read helpers for learning tracks.
// A track is a flat cross-grade ordered list of curriculum unit ids the
// student's Main block walks. See docs/superpowers/specs/2026-06-05-track-model-phase1-design.md

import { mutation, query } from "../_generated/server";
import { v } from "convex/values";
import type { GenericMutationCtx, GenericQueryCtx } from "convex/server";
import type { DataModel, Doc, Id } from "../_generated/dataModel";

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
