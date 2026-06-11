// Sheet redesign (Phase 1) — Teaching Path: the teacher-curated order of units
// to teach within a (grade, term), across all six modules. This is the shared
// contract the redesign meets at: the editor (Phase 2) writes it via
// setTeachingPath; the planner (Phase 4) reads it via resolveTeachingPath to
// drive the Main block to each student's next not-yet-introduced concept.
//
// Why an extra `units` input on the priority query: Convex functions cannot
// import src/lib/curriculum-data.ts (frontend module). The whole learning
// engine already resolves the curriculum client-side and passes ids down —
// see importance.recomputeForGradeTerm and planner.candidatePool. We follow
// that convention: the caller passes the (grade, term) unit list (natural
// curriculum order); we enrich + sort it here.

import { mutation, query } from "../_generated/server";
import { v } from "convex/values";
import type { GenericMutationCtx, GenericQueryCtx } from "convex/server";
import type { DataModel, Id } from "../_generated/dataModel";
import { questionsTaggedToConcept } from "./derivedConcepts";

type QueryCtx = GenericQueryCtx<DataModel>;
type MutationCtx = GenericMutationCtx<DataModel>;
type ReadCtx = QueryCtx | MutationCtx;

// Structural validity check for a unit id without needing the curriculum tree.
// Unit ids are minted as `${moduleId}-G${grade}-T${term}-${i}` in
// src/lib/curriculum-data.ts (e.g. "M1-G7-T2-0"). We accept any id whose
// grade/term segment matches the requested scope; module + index are free.
function isUnitInScope(unitId: string, grade: number, term: number): boolean {
  return new RegExp(`^M\\d+-G${grade}-T${term}-\\d+$`).test(unitId);
}

// ── Internal read helper (used by the planner in Phase 4) ─────────────────
// Returns the saved teaching order for a (grade, term), or null when none is
// saved (caller falls back to natural curriculum order). Stale-id pruning is
// the caller's job — it needs the live curriculum to know what's stale.
export async function resolveTeachingPath(
  ctx: ReadCtx,
  grade: number,
  term: number,
): Promise<string[] | null> {
  const row = await ctx.db
    .query("teachingPath")
    .withIndex("by_grade_term", (q) => q.eq("grade", grade).eq("term", term))
    .unique();
  return row ? row.orderedUnitIds : null;
}

// ── Unit pacing (Phase 7) ─────────────────────────────────────────────────
// Per-unit teacher estimate of new concepts per session-hour. Read by the
// planner to size the Main block; null when the teacher hasn't set one.
export async function resolveUnitPacing(
  ctx: ReadCtx,
  grade: number,
  term: number,
  unitId: string,
): Promise<number | null> {
  const row = await ctx.db
    .query("unitPacing")
    .withIndex("by_grade_term_unit", (q) =>
      q.eq("grade", grade).eq("term", term).eq("unitId", unitId),
    )
    .unique();
  // Treat 0 as "unset" so a row that only carries a saved mainQuestions value
  // (conceptsPerHour 0) doesn't accidentally drive the auto pacing path.
  return row && row.conceptsPerHour > 0 ? row.conceptsPerHour : null;
}

// Per-unit saved Main-block size (Founder, 2026-06-12). Read by the planner
// as the Main section's question target when the next new concept is in this
// unit. null when the teacher hasn't saved one.
export async function resolveUnitMainQuestions(
  ctx: ReadCtx,
  grade: number,
  term: number,
  unitId: string,
): Promise<number | null> {
  const row = await ctx.db
    .query("unitPacing")
    .withIndex("by_grade_term_unit", (q) =>
      q.eq("grade", grade).eq("term", term).eq("unitId", unitId),
    )
    .unique();
  return row && typeof row.mainQuestions === "number" ? row.mainQuestions : null;
}

// Resolve the calling teacher id (best-effort, for the audit field). Mirrors
// the defensive collect()-not-unique() pattern in planner.resolveTeacherId:
// historical bootstrap allowed duplicate teacher rows per clerk user, and
// .unique() would throw. Pick the oldest deterministically.
async function resolveTeacherId(
  ctx: MutationCtx,
): Promise<Id<"teachers"> | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  const rows = await ctx.db
    .query("teachers")
    .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", identity.subject))
    .collect();
  if (rows.length === 0) return null;
  return rows.reduce((a, b) => (a._creationTime <= b._creationTime ? a : b))._id;
}

// ── READ — getTeachingPath ────────────────────────────────────────────────
// Used by the planner (via resolveTeachingPath) and by the editor to seed its
// initial order. Returns null when nothing is saved.
export const getTeachingPath = query({
  args: { grade: v.number(), term: v.number() },
  handler: async (ctx, { grade, term }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const ids = await resolveTeachingPath(ctx, grade, term);
    return ids ? { orderedUnitIds: ids } : null;
  },
});

// ── WRITE — setTeachingPath ───────────────────────────────────────────────
// Upserts the order for a (grade, term). Ids whose grade/term segment doesn't
// match the scope are dropped silently (defensive; the client only sends real
// in-scope ids). Duplicates are de-duped, first occurrence wins.
export const setTeachingPath = mutation({
  args: {
    grade: v.number(),
    term: v.number(),
    orderedUnitIds: v.array(v.string()),
  },
  handler: async (ctx, { grade, term, orderedUnitIds }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");

    const seen = new Set<string>();
    const cleaned: string[] = [];
    for (const id of orderedUnitIds) {
      if (!isUnitInScope(id, grade, term)) continue;
      if (seen.has(id)) continue;
      seen.add(id);
      cleaned.push(id);
    }

    const teacherId = await resolveTeacherId(ctx);
    const now = Date.now();
    const existing = await ctx.db
      .query("teachingPath")
      .withIndex("by_grade_term", (q) => q.eq("grade", grade).eq("term", term))
      .unique();

    const patch: Record<string, unknown> = {
      grade,
      term,
      orderedUnitIds: cleaned,
      updatedAt: now,
    };
    if (teacherId) patch.updatedByTeacherId = teacherId;

    if (existing) {
      await ctx.db.patch(existing._id, patch);
      return { ok: true as const, id: existing._id };
    }
    const id = await ctx.db.insert(
      "teachingPath",
      patch as {
        grade: number;
        term: number;
        orderedUnitIds: string[];
        updatedAt: number;
        updatedByTeacherId?: Id<"teachers">;
      },
    );
    return { ok: true as const, id };
  },
});

// ── WRITE — setUnitPacing (Phase 7) ───────────────────────────────────────
// Upsert a unit's concepts-per-hour estimate. conceptsPerHour <= 0 deletes the
// row (revert to the global default). Clamped to a sane ceiling.
export const setUnitPacing = mutation({
  args: {
    grade: v.number(),
    term: v.number(),
    unitId: v.string(),
    conceptsPerHour: v.number(),
  },
  handler: async (ctx, { grade, term, unitId, conceptsPerHour }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    if (!isUnitInScope(unitId, grade, term)) {
      throw new Error(`Unit ${unitId} is not in G${grade} T${term}`);
    }
    const existing = await ctx.db
      .query("unitPacing")
      .withIndex("by_grade_term_unit", (q) =>
        q.eq("grade", grade).eq("term", term).eq("unitId", unitId),
      )
      .unique();
    if (conceptsPerHour <= 0) {
      if (existing) await ctx.db.delete(existing._id);
      return { ok: true as const, cleared: true };
    }
    const clamped = Math.min(10, conceptsPerHour);
    if (existing) {
      await ctx.db.patch(existing._id, {
        conceptsPerHour: clamped,
        updatedAt: Date.now(),
      });
    } else {
      await ctx.db.insert("unitPacing", {
        grade,
        term,
        unitId,
        conceptsPerHour: clamped,
        updatedAt: Date.now(),
      });
    }
    return { ok: true as const, cleared: false };
  },
});

// ── WRITE — setUnitMainQuestions (control panel "save for this unit") ──────
// Persist a unit's Main-block question target. count <= 0 clears it (and
// deletes the row when no conceptsPerHour is also saved). Clamped to a sane
// ceiling. Stored on the same unitPacing row as conceptsPerHour.
export const setUnitMainQuestions = mutation({
  args: {
    grade: v.number(),
    term: v.number(),
    unitId: v.string(),
    count: v.number(),
  },
  handler: async (ctx, { grade, term, unitId, count }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    if (!isUnitInScope(unitId, grade, term)) {
      throw new Error(`Unit ${unitId} is not in G${grade} T${term}`);
    }
    const existing = await ctx.db
      .query("unitPacing")
      .withIndex("by_grade_term_unit", (q) =>
        q.eq("grade", grade).eq("term", term).eq("unitId", unitId),
      )
      .unique();
    const now = Date.now();
    if (count <= 0) {
      if (existing) {
        // Drop the row entirely only when there's no pacing to keep.
        if (existing.conceptsPerHour > 0) {
          await ctx.db.patch(existing._id, {
            mainQuestions: undefined,
            updatedAt: now,
          });
        } else {
          await ctx.db.delete(existing._id);
        }
      }
      return { ok: true as const, cleared: true };
    }
    const clamped = Math.min(30, Math.max(1, Math.round(count)));
    if (existing) {
      await ctx.db.patch(existing._id, {
        mainQuestions: clamped,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("unitPacing", {
        grade,
        term,
        unitId,
        conceptsPerHour: 0,
        mainQuestions: clamped,
        updatedAt: now,
      });
    }
    return { ok: true as const, cleared: false };
  },
});

// ── READ — listPathUnitsWithPriority ──────────────────────────────────────
// Card metadata for the editor (Phase 2). For each unit in (grade, term):
//   conceptCount  — number of concept-type exercises in the unit
//   examPriority  — Σ conceptImportance.importance over those concepts (0..1)
//   marks         — Σ marksAvailable over past-paper questions tagged to those
//                   concepts, or null when none carry marks
// Returned sorted by the saved teaching order; units absent from the saved
// order (new/unsaved) are appended in the natural order the caller supplied.
export const listPathUnitsWithPriority = query({
  args: {
    grade: v.number(),
    term: v.number(),
    // Natural curriculum order, resolved client-side from curriculum-data.ts.
    units: v.array(v.object({ unitId: v.string(), unitName: v.string() })),
  },
  handler: async (ctx, { grade, term, units }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];

    // Importance map for the whole (grade, term), one indexed read.
    const importanceRows = await ctx.db
      .query("conceptImportance")
      .withIndex("by_grade_term", (q) => q.eq("grade", grade).eq("term", term))
      .collect();
    const importanceByConcept = new Map<string, number>();
    for (const r of importanceRows) {
      importanceByConcept.set(
        r.conceptExerciseId as unknown as string,
        r.importance,
      );
    }

    // Per-unit pacing (Phase 7), one indexed prefix read.
    const pacingRows = await ctx.db
      .query("unitPacing")
      .withIndex("by_grade_term_unit", (q) =>
        q.eq("grade", grade).eq("term", term),
      )
      .collect();
    const pacingByUnit = new Map<string, number>();
    for (const r of pacingRows) pacingByUnit.set(r.unitId, r.conceptsPerHour);

    type Card = {
      unitId: string;
      unitName: string;
      conceptCount: number;
      examPriority: number;
      marks: number | null;
      conceptsPerHour: number | null;
    };

    const cards: Card[] = [];
    for (const u of units) {
      const conceptRows = await ctx.db
        .query("exercises")
        .withIndex("by_unit", (q) => q.eq("unitId", u.unitId))
        .collect();
      const concepts = conceptRows.filter((r) => r.type === "concept");

      let examPriority = 0;
      let marks = 0;
      let anyMarks = false;
      for (const c of concepts) {
        examPriority +=
          importanceByConcept.get(c._id as unknown as string) ?? 0;

        const taggedQs = await questionsTaggedToConcept(ctx, c._id);
        for (const qId of taggedQs) {
          const q = await ctx.db.get(qId);
          if (!q) continue;
          if (q.source === "past-paper" && typeof q.marksAvailable === "number") {
            marks += q.marksAvailable;
            anyMarks = true;
          }
        }
      }

      cards.push({
        unitId: u.unitId,
        unitName: u.unitName,
        conceptCount: concepts.length,
        examPriority,
        marks: anyMarks ? marks : null,
        conceptsPerHour: pacingByUnit.get(u.unitId) ?? null,
      });
    }

    // Sort by saved path order; unknown/new units keep their natural position
    // (appended after known ones, in the order the caller supplied).
    const saved = await resolveTeachingPath(ctx, grade, term);
    if (!saved || saved.length === 0) return cards;

    const rank = new Map<string, number>();
    saved.forEach((id, i) => rank.set(id, i));
    const BIG = saved.length + units.length;
    return cards
      .map((card, naturalIdx) => ({ card, naturalIdx }))
      .sort((a, b) => {
        const ra = rank.get(a.card.unitId);
        const rb = rank.get(b.card.unitId);
        const ka = ra === undefined ? BIG + a.naturalIdx : ra;
        const kb = rb === undefined ? BIG + b.naturalIdx : rb;
        return ka - kb;
      })
      .map((x) => x.card);
  },
});
