// Phase W: in-app notifications.
//
// Polled by the bell-icon component in the app shell via useQuery (Convex
// reactive — no service worker, no push, no extra infra). Per-user via
// Clerk id; for Phase W:
//   - The Lead role gets all whatsapp_* notifications.
//   - Mentors get whatsapp_parent_reply for inbound messages that match a
//     student in their group (per W.1 brainstorm Q4 decision 2026-05-28).
//
// All inserts go through postNotification (internal) so we can grow the
// per-recipient logic in one place when W.8 lands (fee reminders, doubt
// queue, etc.).

import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";

export const postNotification = internalMutation({
  args: {
    userClerkId: v.string(),
    type: v.string(),
    title: v.string(),
    body: v.optional(v.string()),
    priority: v.string(),                // "low" | "normal" | "high" | "critical"
    actionUrl: v.optional(v.string()),
    payload: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("notifications", {
      userClerkId: args.userClerkId,
      type: args.type,
      title: args.title,
      body: args.body,
      priority: args.priority,
      actionUrl: args.actionUrl,
      payload: args.payload,
      createdAt: Date.now(),
    });
  },
});

export const listForCurrentUser = query({
  args: { limit: v.optional(v.number()), onlyUnseen: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const limit = Math.min(args.limit ?? 25, 100);
    if (args.onlyUnseen) {
      // Unseen rows live where seenAt is undefined. With the by_user_seen_created
      // index, that's the prefix (clerkId, undefined). Convex's index `.eq` on
      // an optional column matches `undefined`.
      const rows = await ctx.db
        .query("notifications")
        .withIndex("by_user_seen_created", (q) =>
          q.eq("userClerkId", identity.subject).eq("seenAt", undefined),
        )
        .order("desc")
        .take(limit);
      return rows;
    }
    return await ctx.db
      .query("notifications")
      .withIndex("by_user_created", (q) => q.eq("userClerkId", identity.subject))
      .order("desc")
      .take(limit);
  },
});

export const unseenCount = query({
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return 0;
    const rows = await ctx.db
      .query("notifications")
      .withIndex("by_user_seen_created", (q) =>
        q.eq("userClerkId", identity.subject).eq("seenAt", undefined),
      )
      .collect();
    return rows.length;
  },
});

export const markSeen = mutation({
  args: { id: v.id("notifications") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    const n = await ctx.db.get(args.id);
    if (!n) return;
    // Owner-only — can't mark someone else's notification seen.
    if (n.userClerkId !== identity.subject) return;
    if (n.seenAt) return;
    await ctx.db.patch(args.id, { seenAt: Date.now() });
  },
});

export const markAllSeen = mutation({
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    const rows = await ctx.db
      .query("notifications")
      .withIndex("by_user_seen_created", (q) =>
        q.eq("userClerkId", identity.subject).eq("seenAt", undefined),
      )
      .collect();
    const now = Date.now();
    for (const r of rows) {
      await ctx.db.patch(r._id, { seenAt: now });
    }
    return { marked: rows.length };
  },
});

export const markActioned = mutation({
  args: { id: v.id("notifications") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    const n = await ctx.db.get(args.id);
    if (!n) return;
    if (n.userClerkId !== identity.subject) return;
    const now = Date.now();
    await ctx.db.patch(args.id, {
      actionedAt: now,
      seenAt: n.seenAt ?? now,
    });
  },
});
