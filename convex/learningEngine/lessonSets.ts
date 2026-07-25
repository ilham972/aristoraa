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
        pickerOrder: number | null;
        expectedTimeMin: number | null;
        label: string | null; // "3.a" / "1A.1" — whatever identity exists
        // GLOBAL curation state (Curate tab, 2026-07-25).
        sessionRole: "green" | "yellow" | "blue" | null;
        excludedFromPlan: boolean;
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
          pickerOrder: q.pickerOrder ?? null,
          expectedTimeMin: q.expectedTimeMin ?? null,
          label: q.questionNumberInPaper ?? q.linkedQuestionKey ?? null,
          sessionRole: q.sessionRole ?? null,
          excludedFromPlan: q.excludedFromPlan ?? false,
          cropBox: q.cropBox ?? null,
          pageImageUrl: urls.full,
          pageImageUrlSmall: urls.small,
          overrideImageUrl: q.overrideRender
            ? await ctx.storage.getUrl(q.overrideRender.storageId)
            : null,
          stems,
        });
      }
      // Stable, teaching-friendly ordering: easy → hard within the concept;
      // pickerOrder (written by drag-reorder) tie-breaks equal difficulties
      // so the teacher's exact dragged order is reproduced. Questions never
      // dragged sort after dragged ones within their bucket.
      questions.sort(
        (a, b) =>
          (a.difficulty ?? 3) - (b.difficulty ?? 3) ||
          (a.pickerOrder ?? Number.MAX_SAFE_INTEGER) -
            (b.pickerOrder ?? Number.MAX_SAFE_INTEGER),
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

// ── Drag-reorder: order IS difficulty (2026-07-13) ────────────────────────
// The teacher drags a concept's questions into easy→hard order in the
// Lesson Builder; this persists it two ways at once:
//   • pickerOrder = exact position (catalog sort tie-break, so the list
//     reproduces the dragged order precisely), and
//   • difficulty  = 1..5 spread evenly over the positions (top fifth = 1 …
//     bottom fifth = 5) — the same field the Settings→Data Entry Difficulty
//     subtab writes, so the planner's easy-first picks follow the drag.
// Overwrites any manually set difficulty for EVERY question in the list —
// founder-chosen semantics ("order is difficulty").
export const reorderConceptQuestions = mutation({
  args: { orderedQuestionIds: v.array(v.id("questionBank")) },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    const n = args.orderedQuestionIds.length;
    if (n === 0) return { ok: true as const, updated: 0 };
    let updated = 0;
    for (let i = 0; i < n; i++) {
      const q = await ctx.db.get(args.orderedQuestionIds[i]);
      if (!q) continue; // deleted mid-drag — skip, positions stay monotonic
      // Decimal spread 1.0→5.0 across the arranged order (2026-07-18): the
      // displayed number finally matches the founder's drag order instead of
      // squashing into whole bands where neighbours looked identical.
      const difficulty =
        n === 1 ? 3 : Math.round((1 + (4 * i) / (n - 1)) * 10) / 10;
      await ctx.db.patch(q._id, { pickerOrder: i, difficulty });
      updated += 1;
    }
    return { ok: true as const, updated };
  },
});

// ── Global curation (Curate tab, 2026-07-25) ──────────────────────────────
// One color decision per question, shared by EVERY group teaching the unit.
// green = conceptual (Main, taught new); yellow = middle (Revision session);
// blue = hard (Main, spaced to return after the concept's yellow). Auto-saved
// on every tap — this is the global lesson design, so there is no draft.
export const setQuestionRole = mutation({
  args: {
    questionId: v.id("questionBank"),
    role: v.union(v.literal("green"), v.literal("yellow"), v.literal("blue")),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    const q = await ctx.db.get(args.questionId);
    if (!q) throw new Error("Question not found");
    // Setting a color also un-excludes: the teacher is choosing to teach it.
    await ctx.db.patch(args.questionId, {
      sessionRole: args.role,
      excludedFromPlan: false,
    });
    return { ok: true as const };
  },
});

// Long-press / ✕ on a tile: drop it from (or restore it to) every group's
// plan. Excluding keeps the stored color so restoring returns it as it was.
export const setQuestionExcluded = mutation({
  args: { questionId: v.id("questionBank"), excluded: v.boolean() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    const q = await ctx.db.get(args.questionId);
    if (!q) throw new Error("Question not found");
    await ctx.db.patch(args.questionId, { excludedFromPlan: args.excluded });
    return { ok: true as const };
  },
});
