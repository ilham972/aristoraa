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

export const listByPaper = query({
  args: { pastPaperId: v.id("pastPapers") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    return await ctx.db
      .query("questionBank")
      .withIndex("by_past_paper", (q) => q.eq("pastPaperId", args.pastPaperId))
      .collect();
  },
});

// All crops for a set of pastPaperPage IDs — used to render overlays across
// all pages of a paper in one query instead of one-per-page.
export const listByPaperPages = query({
  args: { pastPaperPageIds: v.array(v.id("pastPaperPages")) },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const rows = await Promise.all(
      args.pastPaperPageIds.map((id) =>
        ctx.db
          .query("questionBank")
          .withIndex("by_past_paper_page", (q) => q.eq("pastPaperPageId", id))
          .collect(),
      ),
    );
    return rows.flat();
  },
});

// All past-paper crops across all papers — used for per-paper crop count
// badges in the Data Entry → Past Papers list.
export const listAllPastPaperCrops = query({
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    return await ctx.db
      .query("questionBank")
      .withIndex("by_source", (q) => q.eq("source", "past-paper"))
      .collect();
  },
});

// Strict 1:1 between (pastPaperId, questionNumberInPaper) and a crop. The
// crop UI calls this whenever the user draws a rect. If a crop already exists
// at that key it's overwritten in place; any duplicates are deleted so the
// data heals as the user re-cuts each question. Always returns the surviving
// crop's id.
export const upsertForPaperQuestion = mutation({
  args: {
    pastPaperId: v.id("pastPapers"),
    questionNumberInPaper: v.string(),
    pastPaperPageId: v.id("pastPaperPages"),
    cropBox: cropBoxValidator,
    marksAvailable: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    const existing = await ctx.db
      .query("questionBank")
      .withIndex("by_past_paper", (q) => q.eq("pastPaperId", args.pastPaperId))
      .filter((q) =>
        q.eq(q.field("questionNumberInPaper"), args.questionNumberInPaper),
      )
      .collect();
    if (existing.length === 0) {
      return await ctx.db.insert("questionBank", {
        source: "past-paper",
        pastPaperId: args.pastPaperId,
        pastPaperPageId: args.pastPaperPageId,
        questionNumberInPaper: args.questionNumberInPaper,
        cropBox: args.cropBox,
        marksAvailable: args.marksAvailable,
        createdAt: Date.now(),
      });
    }
    const [keep, ...dupes] = existing;
    await ctx.db.patch(keep._id, {
      cropBox: args.cropBox,
      pastPaperPageId: args.pastPaperPageId,
      marksAvailable: args.marksAvailable,
    });
    for (const d of dupes) await ctx.db.delete(d._id);
    return keep._id;
  },
});

// Re-key the given crop to a different questionNumberInPaper, deleting any
// existing crop already at the target key to keep the 1:1 invariant.
export const rekeyToPaperQuestion = mutation({
  args: {
    id: v.id("questionBank"),
    pastPaperId: v.id("pastPapers"),
    questionNumberInPaper: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    const existing = await ctx.db
      .query("questionBank")
      .withIndex("by_past_paper", (q) => q.eq("pastPaperId", args.pastPaperId))
      .filter((q) =>
        q.eq(q.field("questionNumberInPaper"), args.questionNumberInPaper),
      )
      .collect();
    for (const e of existing) {
      if (e._id !== args.id) await ctx.db.delete(e._id);
    }
    await ctx.db.patch(args.id, {
      questionNumberInPaper: args.questionNumberInPaper,
    });
  },
});

// ─── Phase 0.4 — structured slot identity for past-paper crops ───────────

// Strict 1:1 between (pastPaperId, paperStructurePartId, paperStructureSlotNumber)
// and a crop. Mirrors upsertForPaperQuestion but keys off the structured slot
// instead of free-text question number. Always denormalizes
// "${partCode}.${slotNumber}" into questionNumberInPaper so existing list
// views continue rendering without joining through the structure tables.
export const upsertForPaperSlot = mutation({
  args: {
    pastPaperId: v.id("pastPapers"),
    paperStructurePartId: v.id("paperStructureParts"),
    paperStructureSlotNumber: v.number(),
    pastPaperPageId: v.id("pastPaperPages"),
    cropBox: cropBoxValidator,
    marksAvailable: v.optional(v.number()),
    topicTagId: v.optional(v.id("examTopicTags")),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");

    const part = await ctx.db.get(args.paperStructurePartId);
    if (!part) throw new Error("Paper structure part not found");
    const denormNumber = `${part.partCode}.${args.paperStructureSlotNumber}`;

    const existing = await ctx.db
      .query("questionBank")
      .withIndex("by_paper_slot", (q) =>
        q
          .eq("pastPaperId", args.pastPaperId)
          .eq("paperStructurePartId", args.paperStructurePartId)
          .eq("paperStructureSlotNumber", args.paperStructureSlotNumber),
      )
      .collect();

    if (existing.length === 0) {
      return await ctx.db.insert("questionBank", {
        source: "past-paper",
        pastPaperId: args.pastPaperId,
        pastPaperPageId: args.pastPaperPageId,
        paperStructurePartId: args.paperStructurePartId,
        paperStructureSlotNumber: args.paperStructureSlotNumber,
        questionNumberInPaper: denormNumber,
        cropBox: args.cropBox,
        marksAvailable: args.marksAvailable ?? part.marksPerQuestion,
        topicTagId: args.topicTagId,
        createdAt: Date.now(),
      });
    }
    const [keep, ...dupes] = existing;
    await ctx.db.patch(keep._id, {
      cropBox: args.cropBox,
      pastPaperPageId: args.pastPaperPageId,
      questionNumberInPaper: denormNumber,
      ...(args.marksAvailable !== undefined
        ? { marksAvailable: args.marksAvailable }
        : {}),
      ...(args.topicTagId !== undefined
        ? { topicTagId: args.topicTagId }
        : {}),
    });
    for (const d of dupes) await ctx.db.delete(d._id);
    return keep._id;
  },
});

// Re-key the given crop to a different slot. Deletes any pre-existing crop
// at the target slot to keep the 1:1 invariant. Recomputes the denormalized
// questionNumberInPaper. Works on legacy crops (no slot fields set yet) too.
export const rekeyToPaperSlot = mutation({
  args: {
    id: v.id("questionBank"),
    pastPaperId: v.id("pastPapers"),
    paperStructurePartId: v.id("paperStructureParts"),
    paperStructureSlotNumber: v.number(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");

    const part = await ctx.db.get(args.paperStructurePartId);
    if (!part) throw new Error("Paper structure part not found");
    const denormNumber = `${part.partCode}.${args.paperStructureSlotNumber}`;

    const existing = await ctx.db
      .query("questionBank")
      .withIndex("by_paper_slot", (q) =>
        q
          .eq("pastPaperId", args.pastPaperId)
          .eq("paperStructurePartId", args.paperStructurePartId)
          .eq("paperStructureSlotNumber", args.paperStructureSlotNumber),
      )
      .collect();
    for (const e of existing) {
      if (e._id !== args.id) await ctx.db.delete(e._id);
    }

    await ctx.db.patch(args.id, {
      pastPaperId: args.pastPaperId,
      paperStructurePartId: args.paperStructurePartId,
      paperStructureSlotNumber: args.paperStructureSlotNumber,
      questionNumberInPaper: denormNumber,
    });
  },
});

// Patch a single crop's topic tag. Pass topicTagId === null to clear; passing
// undefined leaves the field untouched.
export const setTopicTag = mutation({
  args: {
    id: v.id("questionBank"),
    topicTagId: v.union(v.id("examTopicTags"), v.null()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    await ctx.db.patch(args.id, {
      topicTagId: args.topicTagId === null ? undefined : args.topicTagId,
    });
  },
});

// Replace-all: deletes every existing questionConcepts row for this crop and
// inserts the new set. Keeps things simple — no diffing.
export const setConcepts = mutation({
  args: {
    id: v.id("questionBank"),
    conceptExerciseIds: v.array(v.id("exercises")),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    const existing = await ctx.db
      .query("questionConcepts")
      .withIndex("by_question", (q) => q.eq("questionId", args.id))
      .collect();
    for (const r of existing) await ctx.db.delete(r._id);
    for (const conceptId of args.conceptExerciseIds) {
      await ctx.db.insert("questionConcepts", {
        questionId: args.id,
        conceptExerciseId: conceptId,
      });
    }
  },
});

// All crops carrying a given topic tag. Used by the tag-detail-page question
// list and downstream importance rollups.
export const listByTopicTag = query({
  args: { topicTagId: v.id("examTopicTags") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    return await ctx.db
      .query("questionBank")
      .withIndex("by_topic_tag", (q) => q.eq("topicTagId", args.topicTagId))
      .collect();
  },
});

// All past-paper crops at a given (grade, partCode, slotNumber) across every
// paper of that grade. Mirrors getLearnedOptionsForSlot's traversal but
// returns the raw crop rows for any caller that needs them.
export const listByGradeSlot = query({
  args: {
    grade: v.number(),
    partCode: v.string(),
    slotNumber: v.number(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];

    const structure = await ctx.db
      .query("paperStructures")
      .withIndex("by_grade", (q) => q.eq("grade", args.grade))
      .first();
    if (!structure) return [];
    const parts = await ctx.db
      .query("paperStructureParts")
      .withIndex("by_structure", (q) => q.eq("structureId", structure._id))
      .collect();
    const part = parts.find((p) => p.partCode === args.partCode);
    if (!part) return [];

    const papers = await ctx.db
      .query("pastPapers")
      .withIndex("by_grade", (q) => q.eq("grade", args.grade))
      .collect();

    const all = await Promise.all(
      papers.map((paper) =>
        ctx.db
          .query("questionBank")
          .withIndex("by_paper_slot", (q) =>
            q
              .eq("pastPaperId", paper._id)
              .eq("paperStructurePartId", part._id)
              .eq("paperStructureSlotNumber", args.slotNumber),
          )
          .collect(),
      ),
    );
    return all.flat();
  },
});

// ─── Concept join queries (read-side) ────────────────────────────────────

// All concept-type exercise IDs joined to a given crop. Powers the concept
// multi-select in the past-paper crop UI.
export const listConcepts = query({
  args: { questionId: v.id("questionBank") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    return await ctx.db
      .query("questionConcepts")
      .withIndex("by_question", (q) => q.eq("questionId", args.questionId))
      .collect();
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
    source: v.string(), // "textbook" | "past-paper" | "teacher-authored"
    textbookPageId: v.optional(v.id("textbookPages")),
    cropBox: v.optional(cropBoxValidator),
    linkedExerciseId: v.optional(v.id("exercises")),
    linkedQuestionKey: v.optional(v.string()),
    difficulty: v.optional(v.number()),
    answerKey: v.optional(v.string()),
    expectedTimeMin: v.optional(v.number()),
    // Past-paper provenance (Phase 0.5)
    pastPaperId: v.optional(v.id("pastPapers")),
    pastPaperPageId: v.optional(v.id("pastPaperPages")),
    marksAvailable: v.optional(v.number()),
    questionNumberInPaper: v.optional(v.string()),
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
    // Past-paper provenance (Phase 0.5)
    pastPaperId: v.optional(v.id("pastPapers")),
    pastPaperPageId: v.optional(v.id("pastPaperPages")),
    marksAvailable: v.optional(v.number()),
    questionNumberInPaper: v.optional(v.string()),
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
