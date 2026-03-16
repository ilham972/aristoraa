import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const get = query({
  handler: async (ctx) => {
    const settings = await ctx.db.query("settings").first();
    return settings ?? { tuitionName: "Math Tuition Center" };
  },
});

export const save = mutation({
  args: { tuitionName: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("settings").first();
    if (existing) {
      await ctx.db.patch(existing._id, { tuitionName: args.tuitionName });
    } else {
      await ctx.db.insert("settings", { tuitionName: args.tuitionName });
    }
  },
});
