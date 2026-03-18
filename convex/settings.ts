import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const get = query({
  handler: async (ctx) => {
    const settings = await ctx.db.query("settings").first();
    return settings ?? { allowManualSlotSelection: false };
  },
});

export const save = mutation({
  args: {
    allowManualSlotSelection: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("settings").first();
    if (existing) {
      await ctx.db.patch(existing._id, args);
    } else {
      await ctx.db.insert("settings", {
        tuitionName: "Aristora",
        allowManualSlotSelection: args.allowManualSlotSelection,
      });
    }
  },
});
