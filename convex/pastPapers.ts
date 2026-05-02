import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const list = query({
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    return await ctx.db.query("pastPapers").collect();
  },
});

export const listByGrade = query({
  args: { grade: v.number() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    return await ctx.db
      .query("pastPapers")
      .withIndex("by_grade", (q) => q.eq("grade", args.grade))
      .collect();
  },
});

export const getById = query({
  args: { id: v.id("pastPapers") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    return await ctx.db.get(args.id);
  },
});

export const create = mutation({
  args: {
    grade: v.number(),
    term: v.number(),
    year: v.number(),
    schoolName: v.optional(v.string()),
    totalPages: v.number(),
    useAsTrainingSignal: v.boolean(),
    isHoldout: v.boolean(),
    totalMarks: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");

    if (args.grade < 6 || args.grade > 11) throw new Error("Grade must be between 6 and 11");
    if (![1, 2, 3].includes(args.term)) throw new Error("Term must be 1, 2, or 3");
    if (args.isHoldout && args.useAsTrainingSignal) {
      throw new Error("Holdout papers cannot be training signals");
    }

    // Duplicate guard: (grade, term, year, schoolName). Convex can't enforce
    // uniqueness across nullable fields so we check in the handler.
    const sameYearPapers = await ctx.db
      .query("pastPapers")
      .withIndex("by_grade_term_year", (q) =>
        q.eq("grade", args.grade).eq("term", args.term).eq("year", args.year)
      )
      .collect();
    const duplicate = sameYearPapers.find(
      (p) => (p.schoolName ?? null) === (args.schoolName ?? null)
    );
    if (duplicate) {
      const label = args.schoolName ? args.schoolName : "own paper";
      throw new Error(
        `A paper for Grade ${args.grade} Term ${args.term} ${args.year} (${label}) already exists`
      );
    }

    return await ctx.db.insert("pastPapers", {
      ...args,
      uploadedAt: Date.now(),
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("pastPapers"),
    schoolName: v.optional(v.string()),
    totalPages: v.optional(v.number()),
    useAsTrainingSignal: v.optional(v.boolean()),
    isHoldout: v.optional(v.boolean()),
    totalMarks: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");

    const paper = await ctx.db.get(args.id);
    if (!paper) throw new Error("Paper not found");

    const newIsHoldout = args.isHoldout ?? paper.isHoldout;
    const newUseAsTraining = args.useAsTrainingSignal ?? paper.useAsTrainingSignal;
    if (newIsHoldout && newUseAsTraining) {
      throw new Error("Holdout papers cannot be training signals");
    }

    const { id, ...patch } = args;
    await ctx.db.patch(id, patch);
  },
});

export const remove = mutation({
  args: { id: v.id("pastPapers") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");

    // Cascade: questionBank rows → their questionConcepts joins
    const questions = await ctx.db
      .query("questionBank")
      .withIndex("by_past_paper", (q) => q.eq("pastPaperId", args.id))
      .collect();
    for (const q of questions) {
      const joins = await ctx.db
        .query("questionConcepts")
        .withIndex("by_question", (jq) => jq.eq("questionId", q._id))
        .collect();
      for (const j of joins) await ctx.db.delete(j._id);
      await ctx.db.delete(q._id);
    }

    // Cascade: pastPaperPages → storage blobs
    const pages = await ctx.db
      .query("pastPaperPages")
      .withIndex("by_paper", (q) => q.eq("pastPaperId", args.id))
      .collect();
    for (const page of pages) {
      await ctx.storage.delete(page.storageId);
      await ctx.db.delete(page._id);
    }

    await ctx.db.delete(args.id);
  },
});
