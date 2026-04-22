import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const list = query({
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
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
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const teachers = await ctx.db
      .query("teachers")
      .withIndex("by_clerk_user", (q) =>
        q.eq("clerkUserId", args.clerkUserId)
      )
      .collect();
    return teachers[0] ?? null;
  },
});

// Valid role values. `teacher` is a legacy alias kept for backward compat —
// new assignments should pick `lead` or `correction` explicitly.
const VALID_ROLES = ["admin", "lead", "correction", "teacher"];

export const add = mutation({
  args: {
    clerkUserId: v.string(),
    name: v.string(),
    role: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");

    if (!VALID_ROLES.includes(args.role)) {
      throw new Error("Invalid role");
    }

    // Allow first teacher to self-register as admin (bootstrap)
    const allTeachers = await ctx.db.query("teachers").collect();
    if (allTeachers.length > 0) {
      // After bootstrap, only admins can add teachers
      const caller = allTeachers.find(
        (t) => t.clerkUserId === identity.subject
      );
      if (!caller || caller.role !== "admin") {
        throw new Error("Only admins can add teachers");
      }
    }

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
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");

    if (!VALID_ROLES.includes(args.role)) {
      throw new Error("Invalid role");
    }

    // Only admins can update teachers
    const callers = await ctx.db
      .query("teachers")
      .withIndex("by_clerk_user", (q) =>
        q.eq("clerkUserId", identity.subject)
      )
      .collect();
    const caller = callers[0];
    if (!caller || caller.role !== "admin") {
      throw new Error("Only admins can update teachers");
    }

    const { id, ...data } = args;
    await ctx.db.patch(id, data);
  },
});

export const remove = mutation({
  args: { id: v.id("teachers") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");

    // Only admins can remove teachers
    const callers = await ctx.db
      .query("teachers")
      .withIndex("by_clerk_user", (q) =>
        q.eq("clerkUserId", identity.subject)
      )
      .collect();
    const caller = callers[0];
    if (!caller || caller.role !== "admin") {
      throw new Error("Only admins can remove teachers");
    }

    // Cascade: remove slot assignments
    const slotTeachers = await ctx.db
      .query("slotTeachers")
      .withIndex("by_teacher", (q) => q.eq("teacherId", args.id))
      .collect();
    for (const st of slotTeachers) await ctx.db.delete(st._id);

    await ctx.db.delete(args.id);
  },
});
