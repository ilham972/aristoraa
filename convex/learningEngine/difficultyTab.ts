// Backend queries for the Phase 0.6b "Difficulty" subtab.
//
// The tab is a bulk-rating workflow. Two views:
//   - Textbook crops grouped by (grade → book → unit). For each crop we
//     return the source page URL + cropBox so the client can render a
//     mini-preview, plus the auto-derived parent-exercise concept chips
//     (from 0.6a's deriveConceptsForUnit) shown read-only beside the row.
//   - Past-paper crops grouped by (grade → paper → paper-structure part).
//     For each crop we return the source page URL + cropBox + the picked
//     concept ids (questionConcepts join rows), so the client can render
//     a multi-select per row.
//
// Both queries hydrate URLs server-side to avoid N+1 client calls.

import { query } from "../_generated/server";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { deriveConceptsForUnit } from "./derivedConcepts";

// ─── Textbook view ───────────────────────────────────────────────────────

// All textbook crops that live under any exercise in a given unit, hydrated
// for the Difficulty tab. Sorted by (exercise.order, linkedQuestionKey) so
// the on-screen list matches the user's mental model of the unit.
export const listTextbookCropsForUnit = query({
  args: { unitId: v.string() },
  handler: async (ctx, { unitId }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];

    const unitExercises = await ctx.db
      .query("exercises")
      .withIndex("by_unit", (q) => q.eq("unitId", unitId))
      .collect();
    const exerciseRows = unitExercises.filter((e) => e.type !== "concept");
    if (exerciseRows.length === 0) return [];

    const exerciseById = new Map(exerciseRows.map((e) => [e._id as string, e]));

    // 0.6a derivation: which concepts each exercise inherits from unit order.
    const mapping = await deriveConceptsForUnit(ctx, unitId);
    const conceptById = new Map(
      unitExercises
        .filter((e) => e.type === "concept")
        .map((e) => [e._id as string, e]),
    );

    // Pull crops for each exercise. Past-paper crops never set
    // linkedExerciseId so this naturally excludes them.
    const cropsPerExercise = await Promise.all(
      exerciseRows.map((ex) =>
        ctx.db
          .query("questionBank")
          .withIndex("by_linked_exercise", (q) =>
            q.eq("linkedExerciseId", ex._id),
          )
          .collect(),
      ),
    );
    const allCrops = cropsPerExercise.flat();

    // Hydrate source page image URLs in one batch (group by pageId).
    const pageIdSet = new Set<string>();
    for (const c of allCrops) {
      if (c.textbookPageId) pageIdSet.add(c.textbookPageId as string);
    }
    const pageUrlById = new Map<string, string | null>();
    for (const pid of Array.from(pageIdSet)) {
      const page = await ctx.db.get(pid as Id<"textbookPages">);
      if (!page) {
        pageUrlById.set(pid, null);
        continue;
      }
      const url = await ctx.storage.getUrl(page.storageId);
      pageUrlById.set(pid, url);
    }

    // Sort crops by (exercise.order, linkedQuestionKey natural-ish).
    const sortKeyForCrop = (key: string | undefined) => {
      if (!key) return [Number.POSITIVE_INFINITY, ""] as const;
      // "1", "1.a", "1.b", "1.iii"… — natural sort on leading int then suffix.
      const m = /^(\d+)(.*)$/.exec(key);
      if (!m) return [Number.POSITIVE_INFINITY, key] as const;
      return [parseInt(m[1], 10), m[2]] as const;
    };

    const enriched = allCrops.map((c) => {
      const ex = c.linkedExerciseId
        ? exerciseById.get(c.linkedExerciseId as string)
        : undefined;
      const inheritedConceptIds = ex
        ? mapping.exerciseToConcepts.get(ex._id) ?? []
        : [];
      const inheritedConcepts = inheritedConceptIds
        .map((cid) => conceptById.get(cid as string))
        .filter(Boolean)
        .map((c2) => ({ _id: c2!._id, name: c2!.name }));
      return {
        crop: c,
        exerciseOrder: ex?.order ?? Number.POSITIVE_INFINITY,
        exerciseName: ex?.name ?? "(unknown)",
        pageImageUrl: c.textbookPageId
          ? pageUrlById.get(c.textbookPageId as string) ?? null
          : null,
        inheritedConcepts,
      };
    });

    enriched.sort((a, b) => {
      if (a.exerciseOrder !== b.exerciseOrder) {
        return a.exerciseOrder - b.exerciseOrder;
      }
      const ak = sortKeyForCrop(a.crop.linkedQuestionKey);
      const bk = sortKeyForCrop(b.crop.linkedQuestionKey);
      if (ak[0] !== bk[0]) return ak[0] - bk[0];
      return ak[1] < bk[1] ? -1 : ak[1] > bk[1] ? 1 : 0;
    });

    return enriched;
  },
});

// ─── Past-paper view ─────────────────────────────────────────────────────

// All past-paper crops in (paper, structure-part). Hydrated with image URL,
// picked concept ids, and topic-tag context. Sorted by paperStructureSlotNumber.
export const listPastPaperCropsForPart = query({
  args: {
    pastPaperId: v.id("pastPapers"),
    paperStructurePartId: v.id("paperStructureParts"),
  },
  handler: async (ctx, { pastPaperId, paperStructurePartId }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];

    // by_paper_slot index keyed by all three columns. Use it with only the
    // first two prefix columns to enumerate every slot in this part of this
    // paper (range scan).
    const crops = await ctx.db
      .query("questionBank")
      .withIndex("by_paper_slot", (q) =>
        q
          .eq("pastPaperId", pastPaperId)
          .eq("paperStructurePartId", paperStructurePartId),
      )
      .collect();

    // Hydrate page URLs.
    const pageIdSet = new Set<string>();
    for (const c of crops) {
      if (c.pastPaperPageId) pageIdSet.add(c.pastPaperPageId as string);
    }
    const pageUrlById = new Map<string, string | null>();
    for (const pid of Array.from(pageIdSet)) {
      const page = await ctx.db.get(pid as Id<"pastPaperPages">);
      if (!page) {
        pageUrlById.set(pid, null);
        continue;
      }
      const url = await ctx.storage.getUrl(page.storageId);
      pageUrlById.set(pid, url);
    }

    // Pull picked concept ids per crop in one batch.
    const conceptsPerCrop = await Promise.all(
      crops.map((c) =>
        ctx.db
          .query("questionConcepts")
          .withIndex("by_question", (q) => q.eq("questionId", c._id))
          .collect(),
      ),
    );

    const enriched = crops.map((c, i) => ({
      crop: c,
      pageImageUrl: c.pastPaperPageId
        ? pageUrlById.get(c.pastPaperPageId as string) ?? null
        : null,
      pickedConceptIds: conceptsPerCrop[i].map(
        (j) => j.conceptExerciseId,
      ) as Id<"exercises">[],
    }));

    enriched.sort(
      (a, b) =>
        (a.crop.paperStructureSlotNumber ?? Number.POSITIVE_INFINITY) -
        (b.crop.paperStructureSlotNumber ?? Number.POSITIVE_INFINITY),
    );
    return enriched;
  },
});

// ─── Red-overlay completeness ─────────────────────────────────────────────

// Per-crop completeness flags for the red-overlay rendering on the existing
// crop pages (page-crop-overlay.tsx). Caller passes a list of crop ids; we
// return a parallel array of {hasConcept, hasDifficulty}.
//
// hasConcept rules:
//   - Past-paper: ≥1 questionConcepts join row exists.
//   - Textbook: parent exercise has ≥1 inherited concept via 0.6a derivation.
//
// Caches the per-unit derivation across crops in the same unit so we don't
// re-derive once per crop.
export const getCompletenessForCrops = query({
  args: { cropIds: v.array(v.id("questionBank")) },
  handler: async (ctx, { cropIds }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];

    const unitMappingCache = new Map<
      string,
      Awaited<ReturnType<typeof deriveConceptsForUnit>>
    >();

    const results: Array<{
      cropId: Id<"questionBank">;
      hasConcept: boolean;
      hasDifficulty: boolean;
    }> = [];

    for (const cropId of cropIds) {
      const crop = await ctx.db.get(cropId);
      if (!crop) {
        results.push({ cropId, hasConcept: false, hasDifficulty: false });
        continue;
      }
      const hasDifficulty = crop.difficulty !== undefined;

      let hasConcept = false;
      if (crop.source === "past-paper") {
        const joins = await ctx.db
          .query("questionConcepts")
          .withIndex("by_question", (q) => q.eq("questionId", cropId))
          .first();
        hasConcept = joins !== null;
      } else if (crop.source === "textbook") {
        if (crop.linkedExerciseId) {
          const ex = await ctx.db.get(crop.linkedExerciseId);
          if (ex) {
            let mapping = unitMappingCache.get(ex.unitId);
            if (!mapping) {
              mapping = await deriveConceptsForUnit(ctx, ex.unitId);
              unitMappingCache.set(ex.unitId, mapping);
            }
            hasConcept = (mapping.exerciseToConcepts.get(ex._id)?.length ?? 0) > 0;
          }
        }
      }

      results.push({ cropId, hasConcept, hasDifficulty });
    }
    return results;
  },
});
