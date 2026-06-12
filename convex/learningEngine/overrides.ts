// Typed question overrides — "digitalize as you go" (2026-06-12).
//
// A question (or stem — stems are questionBank rows too) can carry a typed
// version of itself: `overrideText` (the editable Tamil/English + $TeX$
// source) and `overrideRender` (a high-res PNG the browser typeset from
// that source, with its physical print size in mm). When present, every
// surface that would show the page crop — the inline sheet view and the
// PDF renderer — shows the typed render instead. Bank-level by design:
// type once, every future sheet for every student uses it.
//
// The PNG is rendered CLIENT-side (MathJax needs a DOM-ish environment and
// canvas, neither of which exist in the Convex runtime) — see
// src/lib/typeset-render.ts. This module only stores/clears the result and
// feeds the editor dialog.

import { mutation, query } from "../_generated/server";
import { ConvexError, v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { analyzeCropIntegrity } from "./cropIntegrity";

// One editable item in the override dialog: the question itself or one of
// its glued stems. Carries the crop reference (so the founder can read the
// original while typing) plus any existing override.
export type OverrideEditTarget = {
  questionId: Id<"questionBank">;
  role: "question" | "stem";
  cropBox: { x: number; y: number; w: number; h: number } | null;
  pageImageUrl: string | null;
  pageImageUrlSmall: string | null;
  overrideText: string | null;
  overrideImageUrl: string | null;
};

async function buildTarget(
  ctx: QueryCtx,
  qid: Id<"questionBank">,
  role: "question" | "stem",
): Promise<OverrideEditTarget | null> {
  const q = await ctx.db.get(qid);
  if (!q) return null;
  let pageImageUrl: string | null = null;
  let pageImageUrlSmall: string | null = null;
  const pageId = q.textbookPageId ?? q.pastPaperPageId;
  if (pageId) {
    const p = await ctx.db.get(pageId);
    if (p) {
      pageImageUrl = await ctx.storage.getUrl(p.storageId);
      if (p.smallStorageId)
        pageImageUrlSmall = await ctx.storage.getUrl(p.smallStorageId);
    }
  }
  return {
    questionId: q._id,
    role,
    cropBox: q.cropBox ?? null,
    pageImageUrl,
    pageImageUrlSmall,
    overrideText: q.overrideText ?? null,
    overrideImageUrl: q.overrideRender
      ? await ctx.storage.getUrl(q.overrideRender.storageId)
      : null,
  };
}

// Everything the editor dialog needs for one picked question: the question
// itself plus its stem attachments (in print order), each independently
// editable.
export const getQuestionOverrideInfo = query({
  args: { questionId: v.id("questionBank") },
  handler: async (
    ctx,
    args,
  ): Promise<{ targets: OverrideEditTarget[] } | null> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const main = await buildTarget(ctx, args.questionId, "question");
    if (!main) return null;
    const targets: OverrideEditTarget[] = [];
    const integrity = await analyzeCropIntegrity(ctx, args.questionId);
    if (
      integrity.kind === "ok-sub-with-stem" ||
      integrity.kind === "ok-leaf3-with-stems"
    ) {
      for (const sid of integrity.stemQuestionIds) {
        const stem = await buildTarget(ctx, sid, "stem");
        if (stem) targets.push(stem);
      }
    }
    targets.push(main);
    return { targets };
  },
});

export const generateOverrideUploadUrl = mutation({
  args: {},
  handler: async (ctx): Promise<string> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Not signed in");
    return await ctx.storage.generateUploadUrl();
  },
});

export const setQuestionOverride = mutation({
  args: {
    questionId: v.id("questionBank"),
    overrideText: v.string(),
    storageId: v.id("_storage"),
    widthMm: v.number(),
    heightMm: v.number(),
  },
  handler: async (ctx, args): Promise<void> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Not signed in");
    const q = await ctx.db.get(args.questionId);
    if (!q) throw new ConvexError("Question not found");
    if (args.overrideText.trim().length === 0)
      throw new ConvexError("Override text is empty — use Revert to remove an override.");
    if (args.widthMm <= 0 || args.heightMm <= 0)
      throw new ConvexError("Invalid render dimensions");
    // Replace: drop the previous snapshot blob so storage doesn't leak.
    if (q.overrideRender && q.overrideRender.storageId !== args.storageId) {
      await ctx.storage.delete(q.overrideRender.storageId);
    }
    await ctx.db.patch(args.questionId, {
      overrideText: args.overrideText,
      overrideRender: {
        storageId: args.storageId,
        widthMm: args.widthMm,
        heightMm: args.heightMm,
      },
    });
  },
});

export const clearQuestionOverride = mutation({
  args: { questionId: v.id("questionBank") },
  handler: async (ctx, args): Promise<void> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Not signed in");
    const q = await ctx.db.get(args.questionId);
    if (!q) throw new ConvexError("Question not found");
    if (q.overrideRender) {
      await ctx.storage.delete(q.overrideRender.storageId);
    }
    await ctx.db.patch(args.questionId, {
      overrideText: undefined,
      overrideRender: undefined,
    });
  },
});
