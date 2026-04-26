import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

const cropBoxValidator = v.object({
  x: v.number(),
  y: v.number(),
  w: v.number(),
  h: v.number(),
});

export const listByPage = query({
  args: { textbookPageId: v.id("textbookPages") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    return await ctx.db
      .query("questionBank")
      .withIndex("by_textbook_page", (q) =>
        q.eq("textbookPageId", args.textbookPageId),
      )
      .collect();
  },
});

// All crops across a set of pages — used to render overlays for a whole
// unit's page range in one query instead of one-per-page.
export const listByPages = query({
  args: { textbookPageIds: v.array(v.id("textbookPages")) },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const rows = await Promise.all(
      args.textbookPageIds.map((id) =>
        ctx.db
          .query("questionBank")
          .withIndex("by_textbook_page", (q) => q.eq("textbookPageId", id))
          .collect(),
      ),
    );
    return rows.flat();
  },
});

export const listByLinkedExercise = query({
  args: { exerciseId: v.id("exercises") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    return await ctx.db
      .query("questionBank")
      .withIndex("by_linked_exercise", (q) =>
        q.eq("linkedExerciseId", args.exerciseId),
      )
      .collect();
  },
});

// Crops for any of a set of exercises — used by the Details list to render
// per-exercise crop counts on each row's crop button.
export const listByLinkedExercises = query({
  args: { exerciseIds: v.array(v.id("exercises")) },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const rows = await Promise.all(
      args.exerciseIds.map((id) =>
        ctx.db
          .query("questionBank")
          .withIndex("by_linked_exercise", (q) => q.eq("linkedExerciseId", id))
          .collect(),
      ),
    );
    return rows.flat();
  },
});

export const create = mutation({
  args: {
    source: v.string(), // "textbook" for now
    textbookPageId: v.optional(v.id("textbookPages")),
    cropBox: v.optional(cropBoxValidator),
    linkedExerciseId: v.optional(v.id("exercises")),
    linkedQuestionKey: v.optional(v.string()),
    difficulty: v.optional(v.number()),
    answerKey: v.optional(v.string()),
    expectedTimeMin: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    return await ctx.db.insert("questionBank", {
      ...args,
      createdAt: Date.now(),
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("questionBank"),
    cropBox: v.optional(cropBoxValidator),
    linkedExerciseId: v.optional(v.id("exercises")),
    linkedQuestionKey: v.optional(v.string()),
    difficulty: v.optional(v.number()),
    answerKey: v.optional(v.string()),
    expectedTimeMin: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    const { id, ...patch } = args;
    await ctx.db.patch(id, patch);
  },
});

// Clear the linked exercise/question — patch() can't unset a field by
// passing undefined, so we provide an explicit helper.
export const clearLink = mutation({
  args: { id: v.id("questionBank") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    await ctx.db.patch(args.id, {
      linkedExerciseId: undefined,
      linkedQuestionKey: undefined,
    });
  },
});

export const remove = mutation({
  args: { id: v.id("questionBank") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    // Cascade: delete any questionConcepts join rows for this question.
    const joins = await ctx.db
      .query("questionConcepts")
      .withIndex("by_question", (q) => q.eq("questionId", args.id))
      .collect();
    for (const j of joins) await ctx.db.delete(j._id);
    await ctx.db.delete(args.id);
  },
});
