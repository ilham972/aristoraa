import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

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

    await ctx.db.insert("exercises", {
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
        await ctx.db.delete(item._id);
      }
    }
  },
});

export const setSubQuestions = mutation({
  args: {
    id: v.id("exercises"),
    subQuestions: v.any(), // Record<string, { count: number, type: 'letter' | 'roman' }> or null to clear
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
    await ctx.db.delete(args.id);
  },
});
