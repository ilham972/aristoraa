import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import type { GenericMutationCtx } from "convex/server";
import type { DataModel, Id } from "./_generated/dataModel";

// Deleting an exercise used to strand its questionBank crops: their
// linkedExerciseId dangled, so every planner ladder silently lost them
// (found 2026-07-15: 52 invisible G11 crops on prod). Now crops follow their
// exercise — deleted outright when nothing references them, unlinked (kept
// for history rendering) when a printed sheet does.
async function cleanupCropsForExercise(
  ctx: GenericMutationCtx<DataModel>,
  exerciseId: Id<"exercises">,
): Promise<void> {
  const crops = await ctx.db
    .query("questionBank")
    .withIndex("by_linked_exercise", (q) => q.eq("linkedExerciseId", exerciseId))
    .collect();
  if (crops.length === 0) return;

  const referenced = new Set<string>();
  for (const sh of await ctx.db.query("generatedSheets").collect()) {
    for (const qid of [
      ...sh.warmupQuestionIds,
      ...sh.mainQuestionIds,
      ...(sh.revisionQuestionIds ?? []),
      ...sh.examPrepQuestionIds,
    ])
      referenced.add(qid as unknown as string);
  }
  for (const gs of await ctx.db.query("groupSheets").collect()) {
    for (const qid of [...gs.newQuestionIds, ...gs.spiralQuestionIds])
      referenced.add(qid as unknown as string);
  }

  for (const crop of crops) {
    if (referenced.has(crop._id as unknown as string)) {
      await ctx.db.patch(crop._id, { linkedExerciseId: undefined });
    } else {
      const joins = await ctx.db
        .query("questionConcepts")
        .withIndex("by_question", (q) => q.eq("questionId", crop._id))
        .collect();
      for (const j of joins) await ctx.db.delete(j._id);
      await ctx.db.delete(crop._id);
    }
  }
}

export const list = query({
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    return await ctx.db.query("exercises").collect();
  },
});

export const getByUnit = query({
  args: { unitId: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    return await ctx.db
      .query("exercises")
      .withIndex("by_unit", (q) => q.eq("unitId", args.unitId))
      .collect();
  },
});

export const add = mutation({
  args: {
    unitId: v.string(),
    name: v.string(),
    questionCount: v.number(),
    order: v.number(),
    type: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    return await ctx.db.insert("exercises", {
      ...args,
      type: args.type ?? "exercise",
    });
  },
});

export const bulkAdd = mutation({
  args: {
    unitId: v.string(),
    unitNumber: v.number(),
    lastExercise: v.number(),
    hasReview: v.boolean(),
    startFrom: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");

    const { unitId, unitNumber, lastExercise, hasReview } = args;

    const existing = await ctx.db
      .query("exercises")
      .withIndex("by_unit", (q) => q.eq("unitId", unitId))
      .collect();
    let order = existing.length > 0 ? Math.max(...existing.map((e) => e.order)) + 1 : 0;
    const startFrom = args.startFrom ?? 1;

    if (hasReview && startFrom === 1) {
      await ctx.db.insert("exercises", {
        unitId,
        name: `${unitNumber}.0`,
        questionCount: 0,
        order: order++,
        type: "exercise",
      });
    }

    for (let i = startFrom; i <= lastExercise; i++) {
      await ctx.db.insert("exercises", {
        unitId,
        name: `${unitNumber}.${i}`,
        questionCount: 0,
        order: order++,
        type: "exercise",
      });
    }
  },
});

export const addConcept = mutation({
  args: {
    unitId: v.string(),
    name: v.string(),
    afterOrder: v.number(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");

    const items = await ctx.db
      .query("exercises")
      .withIndex("by_unit", (q) => q.eq("unitId", args.unitId))
      .collect();

    const insertOrder = args.afterOrder + 1;

    // Shift items at or after the insert position
    for (const item of items) {
      if (item.order >= insertOrder) {
        await ctx.db.patch(item._id, { order: item.order + 1 });
      }
    }

    // Returns the new row's id so callers can immediately set its page range
    // (the Details Studio tab does this in one step). Existing callers that
    // ignore the return value are unaffected.
    return await ctx.db.insert("exercises", {
      unitId: args.unitId,
      name: args.name,
      questionCount: 0,
      order: insertOrder,
      type: "concept",
    });
  },
});

export const updateQuestionCount = mutation({
  args: {
    id: v.id("exercises"),
    questionCount: v.number(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    await ctx.db.patch(args.id, { questionCount: args.questionCount });
  },
});

export const updatePageNumber = mutation({
  args: {
    id: v.id("exercises"),
    pageNumber: v.number(),
    pageNumberEnd: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    await ctx.db.patch(args.id, { pageNumber: args.pageNumber, pageNumberEnd: args.pageNumberEnd });
  },
});

export const update = mutation({
  args: {
    id: v.id("exercises"),
    name: v.string(),
    questionCount: v.number(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    const { id, ...data } = args;
    await ctx.db.patch(id, data);
  },
});

// Set/clear the YouTube video URL and optional summary on a concept-type exercise.
// Pass empty string or undefined to clear.
export const setConceptVideo = mutation({
  args: {
    id: v.id("exercises"),
    videoUrl: v.optional(v.string()),
    conceptSummary: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    await ctx.db.patch(args.id, {
      videoUrl: args.videoUrl && args.videoUrl.trim() !== "" ? args.videoUrl : undefined,
      conceptSummary:
        args.conceptSummary && args.conceptSummary.trim() !== ""
          ? args.conceptSummary
          : undefined,
    });
  },
});

// Rename a concept-type exercise row. Used in the Concepts subtab.
export const renameConcept = mutation({
  args: {
    id: v.id("exercises"),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    const name = args.name.trim();
    if (!name) throw new Error("Name is required");
    await ctx.db.patch(args.id, { name });
  },
});

// Set/replace the prerequisite list on a concept-type exercise. Pass an
// empty array (or undefined) to clear. Prerequisites must be other
// concept-type exercise rows — this is enforced on the client side to keep
// the mutation simple, but server checks self-reference so a concept can
// never be its own prerequisite.
export const setConceptPrerequisites = mutation({
  args: {
    id: v.id("exercises"),
    prerequisiteExerciseIds: v.optional(v.array(v.id("exercises"))),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    const cleaned = (args.prerequisiteExerciseIds ?? []).filter((pid) => pid !== args.id);
    await ctx.db.patch(args.id, {
      prerequisiteExerciseIds: cleaned.length ? cleaned : undefined,
    });
  },
});

export const trimToCount = mutation({
  args: {
    unitId: v.string(),
    unitNumber: v.number(),
    keepUpTo: v.number(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");

    const items = await ctx.db
      .query("exercises")
      .withIndex("by_unit", (q) => q.eq("unitId", args.unitId))
      .collect();

    for (const item of items) {
      if ((item.type || "exercise") !== "exercise") continue;
      if (item.name.endsWith(".0")) continue; // keep review
      const sub = parseInt(item.name.split(".")[1]);
      if (!isNaN(sub) && sub > args.keepUpTo) {
        // Delete related entries first
        const entries = await ctx.db.query("entries").collect();
        for (const entry of entries) {
          if (entry.exerciseId === item._id) {
            await ctx.db.delete(entry._id);
          }
        }
        await cleanupCropsForExercise(ctx, item._id);
        await ctx.db.delete(item._id);
      }
    }
  },
});

// Add or remove a unit's review exercise (`N.0`) AFTER the unit already has
// exercises. bulkAdd can only set the review flag at creation time, so this is
// the path the Book-entry Rev toggle uses to correct a unit's review state
// later. Removing also deletes any scoring entries recorded against `N.0`.
export const setReview = mutation({
  args: {
    unitId: v.string(),
    unitNumber: v.number(),
    hasReview: v.boolean(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");

    const { unitId, unitNumber, hasReview } = args;
    const items = await ctx.db
      .query("exercises")
      .withIndex("by_unit", (q) => q.eq("unitId", unitId))
      .collect();
    const review = items.find(
      (e) => (e.type || "exercise") === "exercise" && e.name.endsWith(".0"),
    );

    if (hasReview && !review) {
      // Insert with the lowest order so the review sits first in the unit.
      const minOrder = items.length > 0 ? Math.min(...items.map((e) => e.order)) : 0;
      await ctx.db.insert("exercises", {
        unitId,
        name: `${unitNumber}.0`,
        questionCount: 0,
        order: minOrder - 1,
        type: "exercise",
      });
    } else if (!hasReview && review) {
      const entries = await ctx.db.query("entries").collect();
      for (const entry of entries) {
        if (entry.exerciseId === review._id) {
          await ctx.db.delete(entry._id);
        }
      }
      await cleanupCropsForExercise(ctx, review._id);
      await ctx.db.delete(review._id);
    }
  },
});

export const setSubQuestions = mutation({
  args: {
    id: v.id("exercises"),
    subQuestions: v.any(), // Record<string, { count: number; type: 'letter' | 'roman'; subSub?: Record<string, { count: number; type: 'letter' | 'roman' }> }> or null to clear. See src/lib/sub-questions.ts.
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    await ctx.db.patch(args.id, { subQuestions: args.subQuestions || undefined });
  },
});

export const remove = mutation({
  args: { id: v.id("exercises") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    // Delete all entries for this exercise
    const entries = await ctx.db.query("entries").collect();
    for (const entry of entries) {
      if (entry.exerciseId === args.id) {
        await ctx.db.delete(entry._id);
      }
    }
    await cleanupCropsForExercise(ctx, args.id);
    await ctx.db.delete(args.id);
  },
});
