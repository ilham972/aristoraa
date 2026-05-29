// Phase W.5.A — Inbox: in-app parent-conversation reads + reply send.
//
// The inbound write path (convex/messaging/inbound.ts, W.1.3) already upserts
// `conversations`, appends inbound `messageLog` rows, bumps unreadCount, and
// posts the whatsapp_parent_reply notification (actionUrl already points here).
// This file is READ-ONLY over that data plus the one reply mutation. It does
// NOT touch inbound.ts and does NOT touch the outbox sender — a reply is just a
// normal queued messageQueue row that the existing sender picks up, so pacing,
// per-number cooldown, quiet hours, and the dev-mode redirect all still apply.

import { v } from "convex/values";
import { mutation, query, MutationCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { Doc, Id } from "../_generated/dataModel";
import { isQuietHourColombo, nextNonQuietMs } from "./policy";

async function requireTeacherId(
  ctx: MutationCtx,
  clerkSubject: string,
): Promise<Id<"teachers"> | undefined> {
  const t = await ctx.db
    .query("teachers")
    .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", clerkSubject))
    .first();
  return t?._id;
}

// Students linked to a conversation's phone. Mirrors inbound.ts: the canonical
// link is students.parentPhone === conversation.phoneE164 (rosters are small,
// no dedicated index yet). Used for the sibling chips in the thread header.
async function siblingsForPhone(
  ctx: { db: MutationCtx["db"] } | { db: any },
  phoneE164: string,
): Promise<Array<{ id: Id<"students">; name: string }>> {
  const students = await ctx.db
    .query("students")
    .filter((q: any) => q.eq(q.field("parentPhone"), phoneE164))
    .collect();
  return students.map((s: Doc<"students">) => ({ id: s._id, name: s.name }));
}

// ── Queries ────────────────────────────────────────────────────────────────

// Conversation list, newest inbound first. One round-trip payload per row:
// parent label, last-message preview, unread badge, opt-out flag.
export const listConversations = query({
  args: {
    archived: v.optional(v.boolean()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const archived = args.archived ?? false;
    const limit = args.limit ?? 100;

    const conversations = await ctx.db
      .query("conversations")
      .withIndex("by_archived_lastInbound", (q) => q.eq("archived", archived))
      .order("desc")
      .take(limit);

    const rows = [];
    for (const c of conversations) {
      const parentContact = c.parentContactId
        ? await ctx.db.get(c.parentContactId)
        : await ctx.db
            .query("parentContacts")
            .withIndex("by_phone", (q) => q.eq("phoneE164", c.phoneE164))
            .first();

      // Most recent message (either direction) for the preview line.
      const lastMsg = await ctx.db
        .query("messageLog")
        .withIndex("by_conversation_time", (q) =>
          q.eq("conversationId", c._id),
        )
        .order("desc")
        .first();

      const primaryStudent = c.primaryStudentId
        ? await ctx.db.get(c.primaryStudentId)
        : null;

      const displayName =
        parentContact?.displayName ??
        primaryStudent?.name ??
        c.phoneE164;

      rows.push({
        conversationId: c._id,
        phoneE164: c.phoneE164,
        displayName,
        lastPreview: lastMsg
          ? lastMsg.body.length > 80
            ? lastMsg.body.slice(0, 80) + "…"
            : lastMsg.body
          : "",
        lastDirection: lastMsg?.direction ?? null,
        lastAt: c.lastInboundAt ?? c.lastOutboundAt ?? c.createdAt,
        unreadCount: c.unreadCount,
        optedOut: parentContact?.optedOut ?? false,
        archived: c.archived,
      });
    }
    return rows;
  },
});

// Full thread: conversation header context + chronological message bubbles.
export const getThread = query({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const c = await ctx.db.get(args.conversationId);
    if (!c) return null;

    const parentContact = c.parentContactId
      ? await ctx.db.get(c.parentContactId)
      : await ctx.db
          .query("parentContacts")
          .withIndex("by_phone", (q) => q.eq("phoneE164", c.phoneE164))
          .first();

    const siblings = await siblingsForPhone(ctx, c.phoneE164);

    // Last 100 messages, chronological (oldest → newest) for bubble rendering.
    const recent = await ctx.db
      .query("messageLog")
      .withIndex("by_conversation_time", (q) =>
        q.eq("conversationId", args.conversationId),
      )
      .order("desc")
      .take(100);
    const messages = recent
      .slice()
      .reverse()
      .map((m) => ({
        id: m._id,
        direction: m.direction, // "in" | "out"
        body: m.body,
        status: m.status,
        occurredAt: m.occurredAt,
      }));

    return {
      conversationId: c._id,
      phoneE164: c.phoneE164,
      displayName: parentContact?.displayName ?? siblings[0]?.name ?? c.phoneE164,
      language: parentContact?.language ?? "ta",
      optedOut: parentContact?.optedOut ?? false,
      archived: c.archived,
      siblings,
      lastOutboundAt: c.lastOutboundAt ?? null,
      messages,
    };
  },
});

// ── Mutations ────────────────────────────────────────────────────────────────

export const markRead = mutation({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    const c = await ctx.db.get(args.conversationId);
    if (!c) return { ok: false };
    if (c.unreadCount !== 0) {
      await ctx.db.patch(args.conversationId, { unreadCount: 0 });
    }
    return { ok: true };
  },
});

export const archive = mutation({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    await ctx.db.patch(args.conversationId, { archived: true });
    return { ok: true };
  },
});

export const unarchive = mutation({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    await ctx.db.patch(args.conversationId, { archived: false });
    return { ok: true };
  },
});

// Send a freeform reply. Enqueues a normal contact messageQueue row (status
// "queued" — the Lead just typed it, no draft step) and kicks the existing
// sender. Quiet hours are honoured by stamping scheduledNotBefore to the next
// 07:00 so the deferral is visible; the sender enforces it regardless. The
// reply rides the same dev-mode redirect + per-number cooldown as every send.
export const replyToConversation = mutation({
  args: { conversationId: v.id("conversations"), body: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    const text = args.body.trim();
    if (!text) throw new Error("Reply is empty");
    const c = await ctx.db.get(args.conversationId);
    if (!c) throw new Error("Conversation not found");

    const teacherId = await requireTeacherId(ctx, identity.subject);
    const now = Date.now();
    const inQuiet = isQuietHourColombo(now);
    const scheduledNotBefore = inQuiet ? nextNonQuietMs(now) : now;

    const primaryStudent = c.primaryStudentId ?? undefined;
    const queueId = await ctx.db.insert("messageQueue", {
      toType: "contact",
      toPhone: c.phoneE164,
      conversationId: args.conversationId,
      studentId: primaryStudent,
      body: text,
      status: "queued",
      priority: "high", // a human-typed reply jumps ahead of batch traffic
      scheduledNotBefore,
      attempts: 0,
      batchId: `inbox-reply-${args.conversationId}`,
      createdByTeacherId: teacherId,
      approvedByTeacherId: teacherId,
      approvedAt: now,
      createdAt: now,
    });

    await ctx.db.patch(args.conversationId, { lastOutboundAt: now });
    await ctx.scheduler.runAfter(0, internal.messaging.outbox.processNext, {});
    return {
      queueId,
      deferred: inQuiet,
      nextWindowStart: inQuiet ? scheduledNotBefore : null,
    };
  },
});
