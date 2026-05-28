// Phase W: parentContacts CRUD + opt-out switch.
//
// parentContacts.phoneE164 is the identity column. Uniqueness is enforced
// inside the upsertParentContact mutation (no DB constraint). All callers
// must pass normalized E.164 — see convex/lib/phone.ts.

import { mutation, query, internalMutation } from "../_generated/server";
import { v } from "convex/values";
import { normalizeToE164SL } from "../lib/phone";

export const upsertParentContact = mutation({
  args: {
    phone: v.string(),                 // any input; normalized inside
    displayName: v.optional(v.string()),
    language: v.optional(v.string()),  // defaults "ta"
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    const phoneE164 = normalizeToE164SL(args.phone);
    const existing = await ctx.db
      .query("parentContacts")
      .withIndex("by_phone", (q) => q.eq("phoneE164", phoneE164))
      .first();
    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, {
        displayName: args.displayName ?? existing.displayName,
        language: args.language ?? existing.language,
        notes: args.notes ?? existing.notes,
        updatedAt: now,
      });
      return existing._id;
    }
    return await ctx.db.insert("parentContacts", {
      phoneE164,
      displayName: args.displayName,
      language: args.language ?? "ta",
      optedOut: false,
      notes: args.notes,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const getParentContactByPhone = query({
  args: { phone: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    // Don't throw on bad input here — the query may be invoked with raw user
    // input from search boxes; return null instead so the UI degrades cleanly.
    let phoneE164: string;
    try {
      phoneE164 = normalizeToE164SL(args.phone);
    } catch {
      return null;
    }
    return await ctx.db
      .query("parentContacts")
      .withIndex("by_phone", (q) => q.eq("phoneE164", phoneE164))
      .first();
  },
});

export const optOut = mutation({
  args: { phone: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    const phoneE164 = normalizeToE164SL(args.phone);
    const existing = await ctx.db
      .query("parentContacts")
      .withIndex("by_phone", (q) => q.eq("phoneE164", phoneE164))
      .first();
    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, { optedOut: true, optedOutAt: now, updatedAt: now });
      return existing._id;
    }
    return await ctx.db.insert("parentContacts", {
      phoneE164,
      language: "ta",
      optedOut: true,
      optedOutAt: now,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const optIn = mutation({
  args: { phone: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    const phoneE164 = normalizeToE164SL(args.phone);
    const existing = await ctx.db
      .query("parentContacts")
      .withIndex("by_phone", (q) => q.eq("phoneE164", phoneE164))
      .first();
    if (!existing) return null;
    await ctx.db.patch(existing._id, {
      optedOut: false,
      optedOutAt: undefined,
      updatedAt: Date.now(),
    });
    return existing._id;
  },
});

// Internal: used by convex/messaging/inbound.ts (W.1.3) when an inbound
// message matches an opt-out keyword. Bypasses auth (called from a webhook
// path that has its own HMAC verification).
export const internalOptOutByPhone = internalMutation({
  args: { phoneE164: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("parentContacts")
      .withIndex("by_phone", (q) => q.eq("phoneE164", args.phoneE164))
      .first();
    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, { optedOut: true, optedOutAt: now, updatedAt: now });
      return existing._id;
    }
    return await ctx.db.insert("parentContacts", {
      phoneE164: args.phoneE164,
      language: "ta",
      optedOut: true,
      optedOutAt: now,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const listOptedOut = query({
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const all = await ctx.db.query("parentContacts").collect();
    return all.filter((c) => c.optedOut);
  },
});
