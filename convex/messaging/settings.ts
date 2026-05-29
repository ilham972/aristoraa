// Phase W.1.4 — public queries that back /messaging/settings.
//
// Splits the read-side helpers so the Settings page doesn't have to call
// internal-only inspectors. Everything here is auth-gated.

import { query } from "../_generated/server";
import { v } from "convex/values";

export const getConfig = query({
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    return {
      provider: process.env.MESSAGING_PROVIDER ?? "openwa",
      baseUrl: process.env.OPENWA_BASE_URL ?? null,
      sessionId: process.env.OPENWA_SESSION_ID ?? null,
      // Dev mode is intentionally exposed — the Settings page surfaces it as
      // a prominent banner so the Lead can't accidentally think they're live.
      devMode: (process.env.WHATSAPP_DEV_MODE ?? "true").toLowerCase() !== "false",
      devNumber: process.env.WHATSAPP_DEV_NUMBER ?? null,
      // API key + webhook secret are NEVER returned. Read-only existence flag:
      apiKeyConfigured: Boolean(process.env.OPENWA_API_KEY),
      webhookSecretConfigured: Boolean(process.env.OPENWA_WEBHOOK_SECRET),
    };
  },
});

export const recentActivity = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const limit = Math.min(args.limit ?? 20, 100);
    return await ctx.db
      .query("messageLog")
      .withIndex("by_direction_time", (q) => q.eq("direction", "out"))
      .order("desc")
      .take(limit)
      .then(async (outLogs) => {
        const inLogs = await ctx.db
          .query("messageLog")
          .withIndex("by_direction_time", (q) => q.eq("direction", "in"))
          .order("desc")
          .take(limit);
        return [...outLogs, ...inLogs]
          .sort((a, b) => b.occurredAt - a.occurredAt)
          .slice(0, limit);
      });
  },
});

export const optedOutContacts = query({
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const all = await ctx.db.query("parentContacts").collect();
    return all.filter((c) => c.optedOut).sort((a, b) => (b.optedOutAt ?? 0) - (a.optedOutAt ?? 0));
  },
});
