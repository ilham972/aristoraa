// Pure derivation helpers for exercise→concept mapping.
// Called by Phase 0.6c coverage queries and (later) Phase A mastery resolver.
// NO mutations here. The mapping is never stored — always re-derived from
// exercises.order so it automatically reflects any reordering on the Details page.

import { query } from "../_generated/server";
import { v } from "convex/values";
import type { GenericQueryCtx } from "convex/server";
import type { DataModel, Id } from "../_generated/dataModel";

type QueryCtx = GenericQueryCtx<DataModel>;

export interface UnitConceptMapping {
  // exerciseId → ordered list of conceptExerciseIds it inherits.
  exerciseToConcepts: Map<Id<"exercises">, Id<"exercises">[]>;
  // conceptExerciseId → the exerciseId that "owns" it, or null if trailing.
  conceptToExercise: Map<Id<"exercises">, Id<"exercises"> | null>;
  // Concepts that appear after the last exercise in the unit. 0.6c surfaces
  // these as data-entry warnings.
  orphanConceptIds: Id<"exercises">[];
  // Two rows with identical `order` is a data-entry mistake. Tiebreak applied
  // (_creationTime asc) but logged so 0.6c can warn the user.
  duplicateOrderWarnings: Array<{ orderValue: number; ids: Id<"exercises">[] }>;
}

export async function deriveConceptsForUnit(
  ctx: QueryCtx,
  unitId: string,
): Promise<UnitConceptMapping> {
  const rows = await ctx.db
    .query("exercises")
    .withIndex("by_unit", (q) => q.eq("unitId", unitId))
    .collect();

  // Treat undefined `type` as "exercise" for back-compat with pre-0.1 rows.
  const classified = rows
    .map((r) => ({ row: r, t: r.type === "concept" ? "concept" : "exercise" }))
    .sort((a, b) => {
      if (a.row.order !== b.row.order) return a.row.order - b.row.order;
      return a.row._creationTime - b.row._creationTime; // deterministic tiebreak
    });

  // Detect duplicate `order` values (data-entry mistake).
  const orderBuckets = new Map<number, Id<"exercises">[]>();
  for (const c of classified) {
    if (!orderBuckets.has(c.row.order)) orderBuckets.set(c.row.order, []);
    orderBuckets.get(c.row.order)!.push(c.row._id);
  }
  const duplicateOrderWarnings = Array.from(orderBuckets.entries())
    .filter(([, ids]) => ids.length > 1)
    .map(([orderValue, ids]) => ({ orderValue, ids }));

  const exerciseToConcepts = new Map<Id<"exercises">, Id<"exercises">[]>();
  const conceptToExercise = new Map<Id<"exercises">, Id<"exercises"> | null>();
  let pendingConcepts: Id<"exercises">[] = [];

  for (const c of classified) {
    if (c.t === "concept") {
      pendingConcepts.push(c.row._id);
    } else {
      // Exercise row — claim all pending concepts.
      exerciseToConcepts.set(c.row._id, [...pendingConcepts]);
      for (const cid of pendingConcepts) conceptToExercise.set(cid, c.row._id);
      pendingConcepts = [];
    }
  }

  // Anything left = trailing concepts = orphan.
  const orphanConceptIds = pendingConcepts;
  for (const cid of orphanConceptIds) conceptToExercise.set(cid, null);

  return { exerciseToConcepts, conceptToExercise, orphanConceptIds, duplicateOrderWarnings };
}

// Inverse helper: given a concept-type exerciseId, return the exercise that
// "owns" it. Returns null for trailing concepts.
export async function exerciseForConcept(
  ctx: QueryCtx,
  conceptExerciseId: Id<"exercises">,
): Promise<Id<"exercises"> | null> {
  const c = await ctx.db.get(conceptExerciseId);
  if (!c || c.type !== "concept") return null;
  const mapping = await deriveConceptsForUnit(ctx, c.unitId);
  return mapping.conceptToExercise.get(conceptExerciseId) ?? null;
}

// Unified read used by Phase 0.6c coverage and (later) Phase A.
// Returns all questionBank IDs counted as coverage for a concept:
//   - Direct: questionConcepts join rows (past-paper crops, post-0.6b).
//   - Inherited: textbook crops on the parent exercise (auto-derived in 0.6a).
// Deduped by questionBank._id.
export async function questionsTaggedToConcept(
  ctx: QueryCtx,
  conceptExerciseId: Id<"exercises">,
): Promise<Id<"questionBank">[]> {
  // Path 1: direct join.
  const directJoins = await ctx.db
    .query("questionConcepts")
    .withIndex("by_concept_exercise", (q) =>
      q.eq("conceptExerciseId", conceptExerciseId),
    )
    .collect();
  const directIds = directJoins.map((j) => j.questionId);

  // Path 2: inheritance via the parent exercise of this concept.
  const parentExId = await exerciseForConcept(ctx, conceptExerciseId);
  let inheritedIds: Id<"questionBank">[] = [];
  if (parentExId) {
    const inherited = await ctx.db
      .query("questionBank")
      .withIndex("by_linked_exercise", (q) =>
        q.eq("linkedExerciseId", parentExId),
      )
      .collect();
    // Only textbook crops inherit. Past-paper crops never have linkedExerciseId
    // set, but guard anyway to prevent double-counting.
    inheritedIds = inherited
      .filter((q) => q.source === "textbook")
      .map((q) => q._id);
  }

  // Dedupe.
  const seen = new Set<string>();
  const all: Id<"questionBank">[] = [];
  for (const id of [...directIds, ...inheritedIds]) {
    const key = id as unknown as string;
    if (!seen.has(key)) {
      seen.add(key);
      all.push(id);
    }
  }
  return all;
}

// Exposed query for the Concepts subtab drawer (0.6a UI) and the coverage
// page (0.6c). Returns plain arrays — Convex queries cannot return Maps.
export const getUnitMapping = query({
  args: { unitId: v.string() },
  handler: async (ctx, { unitId }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const m = await deriveConceptsForUnit(ctx, unitId);
    return {
      exerciseToConcepts: Array.from(m.exerciseToConcepts.entries()).map(
        ([exerciseId, conceptIds]) => ({ exerciseId, conceptIds }),
      ),
      orphanConceptIds: m.orphanConceptIds,
      duplicateOrderWarnings: m.duplicateOrderWarnings,
    };
  },
});
