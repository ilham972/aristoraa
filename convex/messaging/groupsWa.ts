// Phase W.3 — WhatsApp group registry + sync.
//
// whatsappGroups mirrors the groups the bot is a member of (plan §7.2). The
// sync pulls the live membership through the provider chokepoint
// (provider.listGroups → Open-WA REST), upserts by whatsappGroupId, and soft-
// deactivates groups the bot has left (active=false, never deleted — keeps the
// messageLog audit trail intact). Scope tags (grade/center/module/group) are
// set by the Lead by hand; sync never touches them.

import { v } from "convex/values";
import {
  action,
  query,
  mutation,
  internalQuery,
  internalMutation,
} from "../_generated/server";
import { internal } from "../_generated/api";
import { getProvider, RawGroup } from "./provider";

// Used by outbox.processNext to re-check active + read displayName at send
// time. Internal (no auth) — the caller is a server action.
export const getByWaId = internalQuery({
  args: { whatsappGroupId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("whatsappGroups")
      .withIndex("by_wa_id", (q) => q.eq("whatsappGroupId", args.whatsappGroupId))
      .first();
  },
});

// Transactional apply of a sync snapshot: upsert each present group, mark any
// previously-active group that's no longer present as inactive.
export const applySync = internalMutation({
  args: {
    groups: v.array(
      v.object({ whatsappGroupId: v.string(), displayName: v.string() }),
    ),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db.query("whatsappGroups").collect();
    const byWaId = new Map(existing.map((g) => [g.whatsappGroupId, g]));
    const presentIds = new Set(args.groups.map((g) => g.whatsappGroupId));

    let added = 0;
    let updated = 0;
    let deactivated = 0;

    for (const g of args.groups) {
      const row = byWaId.get(g.whatsappGroupId);
      if (row) {
        await ctx.db.patch(row._id, {
          displayName: g.displayName,
          active: true,
          syncedAt: now,
        });
        updated += 1;
      } else {
        await ctx.db.insert("whatsappGroups", {
          whatsappGroupId: g.whatsappGroupId,
          displayName: g.displayName,
          active: true,
          syncedAt: now,
          createdAt: now,
        });
        added += 1;
      }
    }

    for (const row of existing) {
      if (!presentIds.has(row.whatsappGroupId) && row.active) {
        await ctx.db.patch(row._id, { active: false });
        deactivated += 1;
      }
    }

    return { added, updated, deactivated };
  },
});

// Lead-triggered sync. Pulls live membership through the provider, then
// applies the snapshot. Returns the diff for a toast.
export const syncFromOpenWa = action({
  args: {},
  handler: async (ctx): Promise<{ added: number; updated: number; deactivated: number }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    const provider = getProvider();
    const groups: RawGroup[] = await provider.listGroups();
    return await ctx.runMutation(internal.messaging.groupsWa.applySync, { groups });
  },
});

const scopeValidator = v.object({
  grade: v.optional(v.number()),
  centerId: v.optional(v.id("centers")),
  moduleId: v.optional(v.string()),
  groupId: v.optional(v.id("groups")),
});

export const setScope = mutation({
  args: { id: v.id("whatsappGroups"), scope: scopeValidator },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    const row = await ctx.db.get(args.id);
    if (!row) throw new Error("whatsappGroups row not found");
    await ctx.db.patch(args.id, { scope: args.scope });
  },
});

// Active groups, optionally narrowed by scope. Empty/undefined scope filters
// match everything (a group with no scope tag is only excluded once a filter
// is applied that it can't satisfy).
export const list = query({
  args: {
    grade: v.optional(v.number()),
    centerId: v.optional(v.id("centers")),
    moduleId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const rows = await ctx.db
      .query("whatsappGroups")
      .withIndex("by_active", (q) => q.eq("active", true))
      .collect();
    return rows.filter((g) => {
      if (args.grade !== undefined && g.scope?.grade !== args.grade) return false;
      if (args.centerId !== undefined && g.scope?.centerId !== args.centerId) return false;
      if (args.moduleId !== undefined && g.scope?.moduleId !== args.moduleId) return false;
      return true;
    });
  },
});

export const listInactive = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    return await ctx.db
      .query("whatsappGroups")
      .withIndex("by_active", (q) => q.eq("active", false))
      .collect();
  },
});
