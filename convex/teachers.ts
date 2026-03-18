import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const list = query({
  handler: async (ctx) => {
    return await ctx.db.query("teachers").collect();
  },
});

export const getCurrent = query({
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;

    const teachers = await ctx.db
      .query("teachers")
      .withIndex("by_clerk_user", (q) =>
        q.eq("clerkUserId", identity.subject)
      )
      .collect();

    return teachers[0] ?? null;
  },
});

export const getByClerkUserId = query({
  args: { clerkUserId: v.string() },
  handler: async (ctx, args) => {
    const teachers = await ctx.db
      .query("teachers")
      .withIndex("by_clerk_user", (q) =>
        q.eq("clerkUserId", args.clerkUserId)
      )
      .collect();
    return teachers[0] ?? null;
  },
});

export const add = mutation({
  args: {
    clerkUserId: v.string(),
    name: v.string(),
    role: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("teachers", args);
  },
});

export const update = mutation({
  args: {
    id: v.id("teachers"),
    name: v.string(),
    role: v.string(),
  },
  handler: async (ctx, args) => {
    const { id, ...data } = args;
    await ctx.db.patch(id, data);
  },
});

export const remove = mutation({
  args: { id: v.id("teachers") },
  handler: async (ctx, args) => {
    // Cascade: remove slot assignments
    const slotTeachers = await ctx.db
      .query("slotTeachers")
      .withIndex("by_teacher", (q) => q.eq("teacherId", args.id))
      .collect();
    for (const st of slotTeachers) await ctx.db.delete(st._id);

    await ctx.db.delete(args.id);
  },
});
