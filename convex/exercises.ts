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
