// Phase W queue — public mutations + queries for the Outbox UI and the
// inline-draft/approve flows on Today / Tomorrow / Weekly / Broadcasts.
//
// The shape is intentionally permissive: every caller passes the fields
// they have. W.2 (absence_alert), W.3 (broadcasts), W.4 (tomorrow), and
// W.5 (weekly cards) will each add thin domain-specific wrappers that call
// `draftMessage` with their own payload assembly + sibling merging + etc.
//
// Approve and Retry both KICK the sender by scheduling `processNext` with
// delay=0. The chain takes over from there with random pacing.

import { v } from "convex/values";
import {
  mutation,
  query,
  internalMutation,
  MutationCtx,
} from "../_generated/server";
import { internal } from "../_generated/api";
import { Id } from "../_generated/dataModel";

async function requireTeacher(
  ctx: MutationCtx,
  clerkSubject: string,
): Promise<Id<"teachers">> {
  const t = await ctx.db
    .query("teachers")
    .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", clerkSubject))
    .first();
  if (!t) {
    throw new Error("No teachers row for current user — add yourself via Settings → Teachers");
  }
  return t._id;
}

export const draftMessage = mutation({
  args: {
    templateKey: v.optional(v.string()),
    language: v.optional(v.string()),
    toType: v.string(),                                  // "contact" | "group"
    toPhone: v.optional(v.string()),                     // already E.164 — caller normalizes
    toWhatsappGroupId: v.optional(v.string()),
    studentId: v.optional(v.id("students")),
    conversationId: v.optional(v.id("conversations")),
    body: v.string(),
    mediaStorageId: v.optional(v.id("_storage")),
    mediaType: v.optional(v.string()),
    mediaCaption: v.optional(v.string()),
    priority: v.optional(v.string()),                    // default "normal"
    batchId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    const teacherId = await requireTeacher(ctx, identity.subject);
    const now = Date.now();
    return await ctx.db.insert("messageQueue", {
      templateKey: args.templateKey,
      language: args.language,
      toType: args.toType,
      toPhone: args.toPhone,
      toWhatsappGroupId: args.toWhatsappGroupId,
      studentId: args.studentId,
      conversationId: args.conversationId,
      body: args.body,
      mediaStorageId: args.mediaStorageId,
      mediaType: args.mediaType,
      mediaCaption: args.mediaCaption,
      status: "draft",
      priority: args.priority ?? "normal",
      scheduledNotBefore: now,
      attempts: 0,
      batchId: args.batchId,
      createdByTeacherId: teacherId,
      createdAt: now,
    });
  },
});

export const approveBatch = mutation({
  args: {
    batchId: v.optional(v.string()),                     // null → all drafts created by this teacher
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    const teacherId = await requireTeacher(ctx, identity.subject);
    const now = Date.now();
    // We deliberately do NOT batch in a single query — Convex prefers many
    // small patches over one giant scan when result sets are modest. Lead
    // batches in W.5 will be ≤200 rows so this is fine.
    const drafts = await ctx.db
      .query("messageQueue")
      .withIndex("by_status", (q) => q.eq("status", "draft"))
      .collect();
    let flipped = 0;
    for (const m of drafts) {
      if (args.batchId !== undefined && m.batchId !== args.batchId) continue;
      if (args.batchId === undefined && m.createdByTeacherId !== teacherId) continue;
      await ctx.db.patch(m._id, {
        status: "queued",
        approvedByTeacherId: teacherId,
        approvedAt: now,
        scheduledNotBefore: now,
      });
      flipped += 1;
    }
    if (flipped > 0) {
      await ctx.scheduler.runAfter(0, internal.messaging.outbox.processNext, {});
    }
    return { flipped };
  },
});

export const cancelQueued = mutation({
  args: { id: v.id("messageQueue") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    const m = await ctx.db.get(args.id);
    if (!m) throw new Error("messageQueue row not found");
    if (m.status !== "queued" && m.status !== "draft") {
      throw new Error(`cannot cancel status=${m.status}`);
    }
    await ctx.db.patch(args.id, { status: "cancelled" });
  },
});

export const retryFailed = mutation({
  args: { id: v.id("messageQueue") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    const m = await ctx.db.get(args.id);
    if (!m) throw new Error("messageQueue row not found");
    if (m.status !== "failed") {
      throw new Error(`retryFailed only valid for status=failed (got ${m.status})`);
    }
    await ctx.db.patch(args.id, {
      status: "queued",
      attempts: 0,
      lastError: undefined,
      scheduledNotBefore: Date.now(),
    });
    await ctx.scheduler.runAfter(0, internal.messaging.outbox.processNext, {});
  },
});

export const listOutbox = query({
  args: {
    status: v.optional(v.string()),
    batchId: v.optional(v.string()),
    templateKey: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const limit = Math.min(args.limit ?? 100, 500);

    // Pick the most selective available index, then JS-filter the rest. Take a
    // wider window when post-filtering so the limit still fills after filtering.
    const window = args.templateKey ? Math.min(limit * 4, 500) : limit;
    let rows;
    if (args.batchId) {
      rows = await ctx.db
        .query("messageQueue")
        .withIndex("by_batch", (q) => q.eq("batchId", args.batchId!))
        .order("desc")
        .take(window);
    } else if (args.status) {
      rows = await ctx.db
        .query("messageQueue")
        .withIndex("by_status", (q) => q.eq("status", args.status!))
        .order("desc")
        .take(window);
    } else {
      rows = await ctx.db.query("messageQueue").order("desc").take(window);
    }
    if (args.templateKey) {
      rows = rows.filter((r) => (r.templateKey ?? "__freeform") === args.templateKey);
    }
    rows = rows.slice(0, limit);

    // Enrich each row with a human target label (group display name needs a
    // lookup; contact is just the phone, masked to the last 4 by the UI).
    const groupNameCache = new Map<string, string>();
    const out = [];
    for (const r of rows) {
      let targetLabel: string;
      if (r.toType === "group" && r.toWhatsappGroupId) {
        let name = groupNameCache.get(r.toWhatsappGroupId);
        if (name === undefined) {
          const g = await ctx.db
            .query("whatsappGroups")
            .withIndex("by_wa_id", (q) => q.eq("whatsappGroupId", r.toWhatsappGroupId!))
            .first();
          name = g?.displayName ?? r.toWhatsappGroupId;
          groupNameCache.set(r.toWhatsappGroupId, name);
        }
        targetLabel = name;
      } else {
        targetLabel = r.toPhone ?? "—";
      }
      out.push({ ...r, targetLabel });
    }
    return out;
  },
});

// Per-batch status tally for the Outbox batch view.
export const batchSummary = query({
  args: { batchId: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const rows = await ctx.db
      .query("messageQueue")
      .withIndex("by_batch", (q) => q.eq("batchId", args.batchId))
      .collect();
    const counts = {
      total: rows.length,
      draft: 0,
      queued: 0,
      sending: 0,
      sent: 0,
      failed: 0,
      cancelled: 0,
    };
    for (const r of rows) {
      if (r.status in counts) (counts as Record<string, number>)[r.status] += 1;
    }
    return counts;
  },
});

export const getQueueRow = query({
  args: { id: v.id("messageQueue") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    return await ctx.db.get(args.id);
  },
});

// Internal: used by the W.1.3 inbound webhook path (auto-ack, forward to
// Lead's personal WA). Bypasses auth + teacher resolution since the caller
// is a server-side action verifying HMAC.
export const internalDraftAndQueue = internalMutation({
  args: {
    templateKey: v.optional(v.string()),
    language: v.optional(v.string()),
    toType: v.string(),
    toPhone: v.optional(v.string()),
    toWhatsappGroupId: v.optional(v.string()),
    studentId: v.optional(v.id("students")),
    conversationId: v.optional(v.id("conversations")),
    body: v.string(),
    priority: v.optional(v.string()),
    scheduledNotBefore: v.optional(v.number()),
    batchId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const id = await ctx.db.insert("messageQueue", {
      templateKey: args.templateKey,
      language: args.language,
      toType: args.toType,
      toPhone: args.toPhone,
      toWhatsappGroupId: args.toWhatsappGroupId,
      studentId: args.studentId,
      conversationId: args.conversationId,
      body: args.body,
      status: "queued",
      priority: args.priority ?? "normal",
      scheduledNotBefore: args.scheduledNotBefore ?? now,
      attempts: 0,
      approvedAt: now,
      batchId: args.batchId,
      createdAt: now,
    });
    await ctx.scheduler.runAfter(0, internal.messaging.outbox.processNext, {});
    return id;
  },
});
