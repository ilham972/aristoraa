// Pure derivation helpers for exercise→concept mapping.
// Called by Phase 0.6c coverage queries and (later) Phase A mastery resolver.
// NO mutations here. The mapping is never stored — always re-derived from
// exercises.order so it automatically reflects any reordering on the Details page.

import { query } from "../_generated/server";
import { v } from "convex/values";
import type { GenericQueryCtx } from "convex/server";
import type { DataModel, Id } from "../_generated/dataModel";
import { isLeafCropKey } from "./cropIntegrity";

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
    const parentEx = await ctx.db.get(parentExId);
    const subQuestions = parentEx?.subQuestions;
    const inherited = await ctx.db
      .query("questionBank")
      .withIndex("by_linked_exercise", (q) =>
        q.eq("linkedExerciseId", parentExId),
      )
      .collect();
    // Only textbook crops inherit. Past-paper crops never have linkedExerciseId
    // set, but guard anyway to prevent double-counting.
    //
    // LEAVES ONLY: a stem ("5") / sub-stem ("5.a") is not an answerable
    // question — it only exists to be glued above a leaf at print time (see
    // cropIntegrity.ts). Excluding stems here keeps them out of BOTH the sheet
    // planner's candidate pool AND the coverage count in one place. Keyless
    // textbook crops (malformed/legacy) are kept — they can't be classified.
    inheritedIds = inherited
      .filter((q) => q.source === "textbook")
      .filter(
        (q) =>
          !q.linkedQuestionKey ||
          isLeafCropKey(q.linkedQuestionKey, subQuestions),
      )
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

// Inverse of questionsTaggedToConcept: given a questionBank crop, return every
// concept-type exercise it is tagged to. Same dual-path union:
//   - Direct: questionConcepts join rows (past-paper crops + manual tags).
//   - Inherited: a textbook crop's linkedExerciseId carries the concepts that
//                precede that exercise in the unit's order sequence.
// Deduped by conceptExerciseId. Returns [] when the crop has no path to any
// concept (e.g. an orphan textbook crop whose parent exercise has no concept
// row before it in the unit).
export async function conceptsForQuestion(
  ctx: QueryCtx,
  questionId: Id<"questionBank">,
): Promise<Id<"exercises">[]> {
  // Path 1: direct join.
  const direct = await ctx.db
    .query("questionConcepts")
    .withIndex("by_question", (q) => q.eq("questionId", questionId))
    .collect();
  const directIds = direct.map((d) => d.conceptExerciseId);

  // Path 2: inheritance via the parent exercise of a textbook crop.
  const q = await ctx.db.get(questionId);
  let inheritedIds: Id<"exercises">[] = [];
  if (q && q.source === "textbook" && q.linkedExerciseId) {
    const parent = await ctx.db.get(q.linkedExerciseId);
    if (parent) {
      const mapping = await deriveConceptsForUnit(ctx, parent.unitId);
      inheritedIds = mapping.exerciseToConcepts.get(q.linkedExerciseId) ?? [];
    }
  }

  const seen = new Set<string>();
  const all: Id<"exercises">[] = [];
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
