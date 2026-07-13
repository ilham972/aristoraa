// Lesson Builder backend (2026-07-11): the unit question catalog + named
// Main-block lesson sets.
//
// - listUnitQuestions: EVERY plannable question of one unit, grouped by
//   concept in teaching order, with crop-thumbnail URLs — the checkbox list
//   the teacher ticks in the full-screen generate dialog. Uses the same
//   questionsTaggedToConcept helper the planner's candidate pool uses, so
//   "what the picker shows" always equals "what the planner could pick"
//   (leaf questions only; stems are glued at render).
// - unitLessonSets CRUD: a saved tick-set per unit ("Fractions — Layer 1"),
//   offered as one-tap presets for any student/group whose Main block
//   teaches that unit. Main-block only by design — the other sections stay
//   personal per student.

import { mutation, query } from "../_generated/server";
import { v } from "convex/values";
import type { GenericMutationCtx } from "convex/server";
import type { DataModel, Id } from "../_generated/dataModel";
import { questionsTaggedToConcept } from "./derivedConcepts";
import { analyzeCropIntegrity } from "./cropIntegrity";

type MutationCtx = GenericMutationCtx<DataModel>;

// Mirrors tracks.ts::resolveTeacherId (collect-not-unique: historical
// duplicate teacher rows; pick the oldest deterministically).
async function resolveTeacherId(
  ctx: MutationCtx,
): Promise<Id<"teachers"> | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  const rows = await ctx.db
    .query("teachers")
    .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", identity.subject))
    .collect();
  if (rows.length === 0) return null;
  return rows.reduce((a, b) => (a._creationTime <= b._creationTime ? a : b))
    ._id;
}

// ── Unit question catalog ─────────────────────────────────────────────────

export const listUnitQuestions = query({
  args: { unitId: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;

    const exRows = await ctx.db
      .query("exercises")
      .withIndex("by_unit", (q) => q.eq("unitId", args.unitId))
      .collect();
    const concepts = exRows
      .filter((r) => r.type === "concept")
      .sort((a, b) => a.order - b.order);

    // Page-URL cache — many questions share one textbook/past-paper page.
    const pageUrlCache = new Map<
      string,
      { full: string | null; small: string | null }
    >();
    async function pageUrls(
      pageId: Id<"textbookPages"> | Id<"pastPaperPages">,
    ): Promise<{ full: string | null; small: string | null }> {
      const key = pageId as unknown as string;
      const cached = pageUrlCache.get(key);
      if (cached) return cached;
      const p = await ctx.db.get(pageId);
      const out = {
        full: p ? await ctx.storage.getUrl(p.storageId) : null,
        small:
          p && p.smallStorageId
            ? await ctx.storage.getUrl(p.smallStorageId)
            : null,
      };
      pageUrlCache.set(key, out);
      return out;
    }

    // Stem crops glued above a leaf at print time (2026-07-13): the picker
    // shows them too, so a sub-part is never displayed without its
    // instruction text. Same source of truth as the PDF renderer
    // (analyzeCropIntegrity), cached because siblings share stems.
    type StemRef = {
      stemId: Id<"questionBank">;
      cropBox: { x: number; y: number; w: number; h: number } | null;
      pageImageUrl: string | null;
      pageImageUrlSmall: string | null;
      overrideImageUrl: string | null;
    };
    const stemCache = new Map<string, StemRef | null>();
    async function stemRef(id: Id<"questionBank">): Promise<StemRef | null> {
      const key = id as unknown as string;
      const cached = stemCache.get(key);
      if (cached !== undefined) return cached;
      const s = await ctx.db.get(id);
      let ref: StemRef | null = null;
      if (s) {
        const pageId = s.textbookPageId ?? s.pastPaperPageId;
        const urls = pageId
          ? await pageUrls(pageId)
          : { full: null, small: null };
        ref = {
          stemId: s._id,
          cropBox: s.cropBox ?? null,
          pageImageUrl: urls.full,
          pageImageUrlSmall: urls.small,
          overrideImageUrl: s.overrideRender
            ? await ctx.storage.getUrl(s.overrideRender.storageId)
            : null,
        };
      }
      stemCache.set(key, ref);
      return ref;
    }

    // A question tagged to two concepts of the same unit appears ONCE,
    // under the first concept in teaching order (the picker is a flat
    // tick-list; duplicates would double-tick).
    const seen = new Set<string>();
    const out: Array<{
      conceptId: Id<"exercises">;
      conceptName: string;
      questions: Array<{
        questionId: Id<"questionBank">;
        source: string;
        difficulty: number | null;
        expectedTimeMin: number | null;
        label: string | null; // "3.a" / "1A.1" — whatever identity exists
        cropBox: { x: number; y: number; w: number; h: number } | null;
        pageImageUrl: string | null;
        pageImageUrlSmall: string | null;
        overrideImageUrl: string | null;
        stems: StemRef[]; // print order: main stem first, then sub-stem
      }>;
    }> = [];

    for (const concept of concepts) {
      const taggedIds = await questionsTaggedToConcept(ctx, concept._id);
      const questions: (typeof out)[number]["questions"] = [];
      for (const qid of taggedIds) {
        const key = qid as unknown as string;
        if (seen.has(key)) continue;
        seen.add(key);
        const q = await ctx.db.get(qid);
        if (!q) continue;
        const pageId = q.textbookPageId ?? q.pastPaperPageId;
        const urls = pageId
          ? await pageUrls(pageId)
          : { full: null, small: null };
        // Only dotted textbook keys ("5.a", "5.a.i") can have stems — skip
        // the integrity scan for whole questions and past-paper crops.
        const stems: StemRef[] = [];
        if (q.source === "textbook" && q.linkedQuestionKey?.includes(".")) {
          const integrity = await analyzeCropIntegrity(ctx, q._id);
          if (
            integrity.kind === "ok-sub-with-stem" ||
            integrity.kind === "ok-leaf3-with-stems"
          ) {
            for (const sid of integrity.stemQuestionIds) {
              const ref = await stemRef(sid);
              if (ref) stems.push(ref);
            }
          }
        }
        questions.push({
          questionId: q._id,
          source: q.source,
          difficulty: q.difficulty ?? null,
          expectedTimeMin: q.expectedTimeMin ?? null,
          label: q.questionNumberInPaper ?? q.linkedQuestionKey ?? null,
          cropBox: q.cropBox ?? null,
          pageImageUrl: urls.full,
          pageImageUrlSmall: urls.small,
          overrideImageUrl: q.overrideRender
            ? await ctx.storage.getUrl(q.overrideRender.storageId)
            : null,
          stems,
        });
      }
      // Stable, teaching-friendly ordering: easy → hard within the concept.
      questions.sort(
        (a, b) => (a.difficulty ?? 3) - (b.difficulty ?? 3),
      );
      out.push({
        conceptId: concept._id,
        conceptName: concept.name,
        questions,
      });
    }
    return { unitId: args.unitId, concepts: out };
  },
});

// ── Lesson sets CRUD ──────────────────────────────────────────────────────

export const listForUnit = query({
  args: { unitId: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const rows = await ctx.db
      .query("unitLessonSets")
      .withIndex("by_unit", (q) => q.eq("unitId", args.unitId))
      .collect();
    return rows.sort((a, b) => a.name.localeCompare(b.name));
  },
});

// Upsert by (unitId, name) — saving "Layer 1" again overwrites its ticks.
export const saveLessonSet = mutation({
  args: {
    unitId: v.string(),
    name: v.string(),
    questionIds: v.array(v.id("questionBank")),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    const name = args.name.trim();
    if (name.length === 0) throw new Error("Lesson name is required");
    if (args.questionIds.length === 0) {
      throw new Error("Tick at least one question before saving");
    }
    const teacherId = await resolveTeacherId(ctx);
    const now = Date.now();
    const existing = (
      await ctx.db
        .query("unitLessonSets")
        .withIndex("by_unit", (q) => q.eq("unitId", args.unitId))
        .collect()
    ).find((r) => r.name === name);
    if (existing) {
      await ctx.db.patch(existing._id, {
        questionIds: args.questionIds,
        updatedAt: now,
        ...(teacherId ? { updatedByTeacherId: teacherId } : {}),
      });
      return { ok: true as const, id: existing._id, updated: true };
    }
    const id = await ctx.db.insert("unitLessonSets", {
      unitId: args.unitId,
      name,
      questionIds: args.questionIds,
      createdAt: now,
      updatedAt: now,
      ...(teacherId ? { updatedByTeacherId: teacherId } : {}),
    });
    return { ok: true as const, id, updated: false };
  },
});

export const deleteLessonSet = mutation({
  args: { id: v.id("unitLessonSets") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    await ctx.db.delete(args.id);
    return { ok: true as const };
  },
});
