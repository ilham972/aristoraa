import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";

// Shape returned by settings.get for callers; consistent across the
// "no settings row" / "no auth" / "row exists" branches so the client can
// always access optional fields like defaultCenterId without unions.
type SettingsShape = {
  allowManualSlotSelection: boolean;
  defaultCenterId: Id<"centers"> | undefined;
  tuitionName?: string;
  coverageModeActive: boolean;
};

export const get = query({
  handler: async (ctx): Promise<SettingsShape> => {
    const identity = await ctx.auth.getUserIdentity();
    const fallback: SettingsShape = {
      allowManualSlotSelection: false,
      defaultCenterId: undefined,
      coverageModeActive: false,
    };
    if (!identity) return fallback;
    const row = await ctx.db.query("settings").first();
    if (!row) return fallback;
    return {
      allowManualSlotSelection: row.allowManualSlotSelection ?? false,
      defaultCenterId: row.defaultCenterId,
      tuitionName: row.tuitionName,
      coverageModeActive: row.coverageModeActive ?? false,
    };
  },
});

// Manual coverage-mode switch (2026-07-14). Dedicated setter, same pattern
// as setDefaultCenter — the exam-calendar page toggles this one value
// without touching the rest of the settings row.
export const setCoverageMode = mutation({
  args: { active: v.boolean() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    const existing = await ctx.db.query("settings").first();
    if (existing) {
      await ctx.db.patch(existing._id, { coverageModeActive: args.active });
    } else {
      await ctx.db.insert("settings", {
        tuitionName: "Aristora",
        coverageModeActive: args.active,
      });
    }
  },
});

export const save = mutation({
  args: {
    allowManualSlotSelection: v.optional(v.boolean()),
    defaultCenterId: v.optional(v.id("centers")),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");

    const existing = await ctx.db.query("settings").first();
    if (existing) {
      await ctx.db.patch(existing._id, args);
    } else {
      await ctx.db.insert("settings", {
        tuitionName: "Aristora",
        allowManualSlotSelection: args.allowManualSlotSelection,
        defaultCenterId: args.defaultCenterId,
      });
    }
  },
});

// Explicit setter for the default centre. Pass undefined / omit to clear.
// Distinct from `save` so the centres tab doesn't have to read+merge every
// other settings field just to toggle this one value.
export const setDefaultCenter = mutation({
  // `clear` flag instead of nullable id: lets us distinguish "set to X" from
  // "clear" without relying on JS null propagating cleanly through the
  // validator (v.union(v.id, v.null) was rejecting client-side null in some
  // browsers — bug surface we sidestep by carrying a boolean).
  args: {
    centerId: v.optional(v.id("centers")),
    clear: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    const existing = await ctx.db.query("settings").first();
    const value = args.clear ? undefined : args.centerId;
    if (existing) {
      await ctx.db.patch(existing._id, { defaultCenterId: value });
    } else {
      await ctx.db.insert("settings", {
        tuitionName: "Aristora",
        defaultCenterId: value,
      });
    }
  },
});
