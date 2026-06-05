// Phase 1 (track model): CRUD + read helpers for learning tracks.
// A track is a flat cross-grade ordered list of curriculum unit ids the
// student's Main block walks. See docs/superpowers/specs/2026-06-05-track-model-phase1-design.md

import { mutation, query } from "../_generated/server";
import { v } from "convex/values";
import type { GenericMutationCtx, GenericQueryCtx } from "convex/server";
import type { DataModel, Doc, Id } from "../_generated/dataModel";
import { resolveTeachingPath } from "./path";
import { TRACK_SKIP_THRESHOLD } from "./config";

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

// A student carries a CUSTOM grade assignment when their assignedGrades is set
// to anything other than exactly [schoolGrade], or any per-module override
// exists. For these students the schoolGrade On-level track is the WRONG track
// (it would override their downgrade and push them to harder material), and the
// byte-identical regression guarantee does NOT hold. The backfill must leave
// them on legacy until a teacher assigns them a proper (remedial) track by hand.
function hasCustomGradeAssignment(s: Doc<"students">): boolean {
  const ag = s.assignedGrades;
  if (ag && ag.length > 0 && !(ag.length === 1 && ag[0] === s.schoolGrade)) {
    return true; // downgraded or multi-grade
  }
  const byMod = s.assignedGradesByModule as Record<string, unknown> | undefined;
  if (byMod && typeof byMod === "object" && Object.keys(byMod).length > 0) {
    return true; // per-module grade override
  }
  return false;
}

// Assign every PLAIN on-level student (no trackId, no custom grade assignment)
// to their schoolGrade's On-level track. Downgraded / custom-grade students are
// skipped and reported, so they stay on legacy until given a remedial track.
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
    let skippedCustomGrade = 0;
    let skippedAlreadyAssigned = 0;
    let skippedNoTrack = 0;
    for (const s of students) {
      if (s.trackId) {
        skippedAlreadyAssigned++;
        continue;
      }
      if (hasCustomGradeAssignment(s)) {
        skippedCustomGrade++;
        continue;
      }
      const tid = onLevelByGrade.get(s.schoolGrade);
      if (!tid) {
        skippedNoTrack++;
        continue;
      }
      await ctx.db.patch(s._id, { trackId: tid });
      assigned++;
    }
    return {
      ok: true as const,
      assigned,
      skippedCustomGrade,
      skippedAlreadyAssigned,
      skippedNoTrack,
    };
  },
});

// ── Remedial-track builder candidate query (Task 4) ────────────────────────

// Builder read query: for a remedial track aiming at targetGrade, list units
// from startGrade..targetGrade with their importance toward the target exam,
// pre-flagging high-importance units for inclusion. Client supplies the unit
// list per (grade,term) (Convex can't read curriculum-data.ts).
export const listCandidateUnitsForTrack = query({
  args: {
    targetGrade: v.number(),
    units: v.array(
      v.object({
        unitId: v.string(),
        unitName: v.string(),
        grade: v.number(),
        term: v.number(),
      }),
    ),
  },
  handler: async (ctx, { targetGrade, units }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];

    // Importance is stored per (grade, term, concept). For each candidate unit
    // we sum its concepts' importance scoped to the TARGET grade's blueprint
    // for that unit's term (cumulative exams tag lower-grade concepts into the
    // target term). Fall back to the unit's own (grade,term) importance.
    const out: Array<{
      unitId: string;
      unitName: string;
      grade: number;
      term: number;
      importance: number;
      suggestedInclude: boolean;
    }> = [];

    for (const u of units) {
      const conceptRows = await ctx.db
        .query("exercises")
        .withIndex("by_unit", (q) => q.eq("unitId", u.unitId))
        .collect();
      const concepts = conceptRows.filter((r) => r.type === "concept");

      let importance = 0;
      for (const c of concepts) {
        // Prefer importance computed for the target grade; else the unit's own grade.
        const targetRow = await ctx.db
          .query("conceptImportance")
          .withIndex("by_grade_term_concept", (q) =>
            q.eq("grade", targetGrade).eq("term", u.term).eq("conceptExerciseId", c._id),
          )
          .unique();
        const ownRow = targetRow
          ? null
          : await ctx.db
              .query("conceptImportance")
              .withIndex("by_grade_term_concept", (q) =>
                q.eq("grade", u.grade).eq("term", u.term).eq("conceptExerciseId", c._id),
              )
              .unique();
        importance += (targetRow ?? ownRow)?.importance ?? 0;
      }

      out.push({
        unitId: u.unitId,
        unitName: u.unitName,
        grade: u.grade,
        term: u.term,
        importance,
        // Target-grade's own units always suggested; lower-grade units only if
        // they carry importance above the skip threshold.
        suggestedInclude: u.grade === targetGrade || importance >= TRACK_SKIP_THRESHOLD,
      });
    }
    return out;
  },
});
