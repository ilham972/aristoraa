// Page-thumbnail backfill (perf phase 6, 2026-06-12).
//
// Question thumbnails used to CSS-crop the FULL page scan (0.5–2MB each);
// a 20-question sheet view could pull tens of MB. Fix: each page row gets an
// optional `smallStorageId` — a ~900px-wide JPEG generated CLIENT-side by the
// Settings → Content → "Optimize images" button (browser canvas; no server
// image processing). Thumbnails read the small variant; tap-to-zoom and the
// PDF renderer keep using the untouched full-res original.
//
// Everything here is additive and idempotent: listMissing only returns pages
// without a small variant, attachSmall only fills the optional field. Safe to
// run the backfill any number of times, including after new page uploads.

import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

// Pages still lacking a small variant, oldest first, capped per call so the
// client can loop in modest batches. Returns the full-res URL to downscale.
export const listMissing = query({
  args: { limit: v.number() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const limit = Math.max(1, Math.min(args.limit, 25));
    const out: Array<{
      table: "textbookPages" | "pastPaperPages";
      pageId: string;
      url: string | null;
    }> = [];

    const textbook = await ctx.db.query("textbookPages").collect();
    for (const p of textbook) {
      if (out.length >= limit) break;
      if (!p.smallStorageId) {
        out.push({
          table: "textbookPages",
          pageId: p._id,
          url: await ctx.storage.getUrl(p.storageId),
        });
      }
    }
    if (out.length < limit) {
      const paper = await ctx.db.query("pastPaperPages").collect();
      for (const p of paper) {
        if (out.length >= limit) break;
        if (!p.smallStorageId) {
          out.push({
            table: "pastPaperPages",
            pageId: p._id,
            url: await ctx.storage.getUrl(p.storageId),
          });
        }
      }
    }
    return out;
  },
});

// Progress counter for the Settings card.
export const progress = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const textbook = await ctx.db.query("textbookPages").collect();
    const paper = await ctx.db.query("pastPaperPages").collect();
    const total = textbook.length + paper.length;
    const done =
      textbook.filter((p) => p.smallStorageId).length +
      paper.filter((p) => p.smallStorageId).length;
    return { total, done };
  },
});

// Mint an upload URL for the small variant (same storage as everything else).
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    return await ctx.storage.generateUploadUrl();
  },
});

// Attach a freshly uploaded small variant to its page row. Only ever fills
// the optional smallStorageId field — the original storageId is never
// touched. Re-running on an already-optimized page replaces the variant.
export const attachSmall = mutation({
  args: {
    table: v.union(v.literal("textbookPages"), v.literal("pastPaperPages")),
    pageId: v.string(),
    smallStorageId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    const id = ctx.db.normalizeId(args.table, args.pageId);
    if (!id) throw new Error(`attachSmall: invalid ${args.table} id`);
    const row = await ctx.db.get(id);
    if (!row) throw new Error("attachSmall: page not found");
    await ctx.db.patch(id, { smallStorageId: args.smallStorageId });
  },
});
