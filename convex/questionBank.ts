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

// Strict 1:1 between (linkedExerciseId, linkedQuestionKey) and a crop. The
// fast-mode crop UI calls this whenever the user draws — if a crop already
// exists at that key it's overwritten in place; any duplicates from before
// this invariant existed are deleted on the same call so the data heals as
// the user re-cuts each question. Always returns the surviving crop's id.
export const upsertForExerciseKey = mutation({
  args: {
    linkedExerciseId: v.id("exercises"),
    linkedQuestionKey: v.string(),
    textbookPageId: v.id("textbookPages"),
    cropBox: cropBoxValidator,
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    const existing = await ctx.db
      .query("questionBank")
      .withIndex("by_linked_exercise", (q) =>
        q.eq("linkedExerciseId", args.linkedExerciseId),
      )
      .filter((q) =>
        q.eq(q.field("linkedQuestionKey"), args.linkedQuestionKey),
      )
      .collect();
    if (existing.length === 0) {
      return await ctx.db.insert("questionBank", {
        source: "textbook",
        textbookPageId: args.textbookPageId,
        cropBox: args.cropBox,
        linkedExerciseId: args.linkedExerciseId,
        linkedQuestionKey: args.linkedQuestionKey,
        createdAt: Date.now(),
      });
    }
    // Keep the first row, overwrite its box + page; delete any duplicates.
    const [keep, ...dupes] = existing;
    await ctx.db.patch(keep._id, {
      cropBox: args.cropBox,
      textbookPageId: args.textbookPageId,
    });
    for (const d of dupes) await ctx.db.delete(d._id);
    return keep._id;
  },
});

// Re-key the given crop to (exerciseId, questionKey), deleting any other
// crop already at that key so the 1:1 invariant survives a re-key. Used by
// the pill-header re-key flow when the user has selected a crop and taps a
// different question pill.
export const rekeyToExerciseKey = mutation({
  args: {
    id: v.id("questionBank"),
    linkedExerciseId: v.id("exercises"),
    linkedQuestionKey: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    const existing = await ctx.db
      .query("questionBank")
      .withIndex("by_linked_exercise", (q) =>
        q.eq("linkedExerciseId", args.linkedExerciseId),
      )
      .filter((q) =>
        q.eq(q.field("linkedQuestionKey"), args.linkedQuestionKey),
      )
      .collect();
    for (const e of existing) {
      if (e._id !== args.id) await ctx.db.delete(e._id);
    }
    await ctx.db.patch(args.id, {
      linkedExerciseId: args.linkedExerciseId,
      linkedQuestionKey: args.linkedQuestionKey,
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
