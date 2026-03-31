import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const list = query({
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    return await ctx.db.query("unitMetadata").collect();
  },
});

export const setPages = mutation({
  args: {
    unitId: v.string(),
    startPage: v.number(),
    endPage: v.number(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");

    const existing = await ctx.db
      .query("unitMetadata")
      .withIndex("by_unit", (q) => q.eq("unitId", args.unitId))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        startPage: args.startPage,
        endPage: args.endPage,
      });
      return existing._id;
    }

    return await ctx.db.insert("unitMetadata", args);
  },
});
