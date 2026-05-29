// Phase W outbox — the human-mimic sender.
//
// The whole engine is one self-chaining action: `processNext` picks ONE
// queued message, sends it, then schedules itself for a random 35s–2min
// gap later. The chain stops when the queue is empty (no further runAfter).
// It re-starts when a mutation flips drafts → queued and calls
// `ctx.scheduler.runAfter(0, internal.messaging.outbox.processNext, {})`.
//
// This is NOT a cron. The plan (§4.2, §5) is emphatic about this:
//   - No time-based schedule fires the sender.
//   - Self-chaining IS the human-mimic delay mechanism.
//   - Every batch starts with a human tap; the chain dies when there's
//     nothing left to send.
//
// Per-call ordering:
//   1. Quiet hours? (21:00–07:00 Asia/Colombo) → defer chain to 07:00
//   2. Per-hour cap exceeded? → defer 1 minute
//   3. Per-day cap exceeded? → defer to next 07:00
//   4. Pick highest-priority queued row whose scheduledNotBefore <= now
//      and recipient cooldown elapsed; opted-out recipients get cancelled
//      and we move on.
//   5. Mark "sending", call provider, on success mark "sent" + log, on
//      failure increment attempts (retry up to MAX_RETRIES with backoff,
//      then mark "failed").
//   6. Self-chain at random gap.

import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";
import { Doc, Id } from "../_generated/dataModel";
import { getProvider } from "./provider";
import {
  PACING,
  isQuietHourColombo,
  nextNonQuietMs,
  colomboDayStartMs,
  hourAgo,
  randomGapMs,
  backoffMs,
} from "./policy";
import { getLeadTeachers } from "./recipients";

type LockResult =
  | { kind: "empty" }
  | { kind: "deferred"; runAt: number; reason: string }
  | { kind: "locked"; message: Doc<"messageQueue"> };

// Atomic pick. Convex serializes mutations, so two concurrent processNext
// invocations cannot both lock the same row — the second sees status="sending"
// from the first and skips on.
export const lockNextOrDefer = internalMutation({
  args: { now: v.number() },
  handler: async (ctx, args): Promise<LockResult> => {
    const now = args.now;

    if (isQuietHourColombo(now)) {
      return { kind: "deferred", runAt: nextNonQuietMs(now), reason: "quiet_hours" };
    }

    // Global hour cap. Index lets us filter by direction + time range cheaply.
    const hourStart = hourAgo(now);
    const recentHourLogs = await ctx.db
      .query("messageLog")
      .withIndex("by_direction_time", (q) =>
        q.eq("direction", "out").gte("occurredAt", hourStart),
      )
      .collect();
    if (recentHourLogs.length >= PACING.PER_HOUR_CAP) {
      return { kind: "deferred", runAt: now + 60_000, reason: "hour_cap" };
    }

    const dayStart = colomboDayStartMs(now);
    const dayLogs = await ctx.db
      .query("messageLog")
      .withIndex("by_direction_time", (q) =>
        q.eq("direction", "out").gte("occurredAt", dayStart),
      )
      .collect();
    if (dayLogs.length >= PACING.PER_DAY_CAP) {
      return { kind: "deferred", runAt: nextNonQuietMs(now), reason: "day_cap" };
    }

    // Scan queued in priority order. Within a priority, oldest scheduledNotBefore first.
    const PRIORITIES = ["high", "normal", "low"] as const;
    let blockedByCooldown = false;
    for (const prio of PRIORITIES) {
      const queued = await ctx.db
        .query("messageQueue")
        .withIndex("by_status_priority", (q) =>
          q.eq("status", "queued").eq("priority", prio).lte("scheduledNotBefore", now),
        )
        .order("asc")
        .take(50);
      for (const msg of queued) {
        if (msg.toType === "contact" && msg.toPhone) {
          const contact = await ctx.db
            .query("parentContacts")
            .withIndex("by_phone", (q) => q.eq("phoneE164", msg.toPhone!))
            .first();
          if (contact?.optedOut) {
            await ctx.db.patch(msg._id, {
              status: "cancelled",
              lastError: "recipient_opted_out",
            });
            continue;
          }
          // Per-number cooldown via messageLog.
          const lastSent = await ctx.db
            .query("messageLog")
            .withIndex("by_phone_time", (q) => q.eq("phoneE164", msg.toPhone!))
            .order("desc")
            .first();
          if (
            lastSent &&
            lastSent.direction === "out" &&
            now - lastSent.occurredAt < PACING.PER_NUMBER_COOLDOWN_MS
          ) {
            blockedByCooldown = true;
            continue;
          }
        }
        await ctx.db.patch(msg._id, { status: "sending" });
        const reloaded = (await ctx.db.get(msg._id)) as Doc<"messageQueue">;
        return { kind: "locked", message: reloaded };
      }
    }
    if (blockedByCooldown) {
      return { kind: "deferred", runAt: now + PACING.MIN_GAP_MS, reason: "cooldown" };
    }
    return { kind: "empty" };
  },
});

export const markSent = internalMutation({
  args: {
    id: v.id("messageQueue"),
    providerMessageId: v.string(),
  },
  handler: async (ctx, args) => {
    const msg = await ctx.db.get(args.id);
    if (!msg) return;
    const now = Date.now();
    await ctx.db.patch(args.id, {
      status: "sent",
      providerMessageId: args.providerMessageId,
      sentAt: now,
    });
    await ctx.db.insert("messageLog", {
      direction: "out",
      phoneE164: msg.toPhone,
      whatsappGroupId: msg.toWhatsappGroupId,
      studentId: msg.studentId,
      queueId: args.id,
      conversationId: msg.conversationId,
      body: msg.body,
      providerMessageId: args.providerMessageId,
      status: "sent",
      occurredAt: now,
    });
    if (msg.conversationId) {
      await ctx.db.patch(msg.conversationId, { lastOutboundAt: now });
    }
  },
});

export const markFailedOrRetry = internalMutation({
  args: {
    id: v.id("messageQueue"),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    const msg = await ctx.db.get(args.id);
    if (!msg) return;
    const newAttempts = msg.attempts + 1;
    const now = Date.now();
    if (newAttempts < PACING.MAX_RETRIES) {
      await ctx.db.patch(args.id, {
        status: "queued",
        attempts: newAttempts,
        lastError: args.error,
        scheduledNotBefore: now + backoffMs(newAttempts),
      });
      return;
    }
    await ctx.db.patch(args.id, {
      status: "failed",
      attempts: newAttempts,
      lastError: args.error,
    });
    await ctx.db.insert("messageLog", {
      direction: "out",
      phoneE164: msg.toPhone,
      whatsappGroupId: msg.toWhatsappGroupId,
      studentId: msg.studentId,
      queueId: args.id,
      conversationId: msg.conversationId,
      body: msg.body,
      status: "failed",
      errorMessage: args.error,
      occurredAt: now,
    });
    // whatsapp_send_failed → bell icon. Lead only (mentors don't own
    // outbound failures even when their student is on the message).
    const leads = await getLeadTeachers(ctx.db);
    const recipientLabel = msg.toPhone ?? msg.toWhatsappGroupId ?? "?";
    for (const lead of leads) {
      await ctx.db.insert("notifications", {
        userClerkId: lead.clerkUserId,
        type: "whatsapp_send_failed",
        title: `❌ Send failed: ${recipientLabel}`,
        body: args.error.slice(0, 200),
        priority: "high",
        actionUrl: "/messaging/outbox?status=failed",
        payload: { queueId: args.id, error: args.error, recipient: recipientLabel },
        createdAt: now,
      });
    }
  },
});

export const processNext = internalAction({
  args: {},
  handler: async (ctx): Promise<void> => {
    const result: LockResult = await ctx.runMutation(
      internal.messaging.outbox.lockNextOrDefer,
      { now: Date.now() },
    );
    if (result.kind === "empty") {
      return;
    }
    if (result.kind === "deferred") {
      const delay = Math.max(0, result.runAt - Date.now());
      await ctx.scheduler.runAfter(delay, internal.messaging.outbox.processNext, {});
      return;
    }
    const msg = result.message;
    const provider = getProvider();
    try {
      let providerMessageId: string;
      if (msg.toType === "contact") {
        if (!msg.toPhone) throw new Error("toType=contact requires toPhone");
        if (msg.mediaStorageId) {
          // Media flows wire in W.6 — for now, fail loudly so the row moves
          // to retry/failed rather than silently corrupting the queue.
          throw new Error("media outbound not yet wired (lands in W.6)");
        }
        const res = await provider.sendText({ to: msg.toPhone, text: msg.body });
        providerMessageId = res.providerMessageId;
      } else if (msg.toType === "group") {
        if (!msg.toWhatsappGroupId) throw new Error("toType=group requires toWhatsappGroupId");
        if (msg.mediaStorageId) {
          throw new Error("group media not yet wired (lands in W.3+)");
        }
        // W.3: re-check the bot still belongs to the group at send time, and
        // grab its display name for the dev-mode annotation. One read before
        // the same send — pacing logic is untouched.
        const group = await ctx.runQuery(internal.messaging.groupsWa.getByWaId, {
          whatsappGroupId: msg.toWhatsappGroupId,
        });
        if (!group || !group.active) {
          throw new Error("Group no longer accessible to the bot");
        }
        const res = await provider.sendGroupText({
          groupId: msg.toWhatsappGroupId,
          text: msg.body,
          displayName: group.displayName,
        });
        providerMessageId = res.providerMessageId;
      } else {
        throw new Error(`unknown toType: ${msg.toType}`);
      }
      await ctx.runMutation(internal.messaging.outbox.markSent, {
        id: msg._id,
        providerMessageId,
      });
    } catch (err) {
      const errStr = err instanceof Error ? err.message : String(err);
      await ctx.runMutation(internal.messaging.outbox.markFailedOrRetry, {
        id: msg._id,
        error: errStr.slice(0, 500),
      });
    }
    await ctx.scheduler.runAfter(randomGapMs(), internal.messaging.outbox.processNext, {});
  },
});

// Convenience helper for tests + the W.1.4 "Send test" button:
// flip a single draft to queued + immediately kick the chain.
export const queueAndKick = internalMutation({
  args: { id: v.id("messageQueue") },
  handler: async (ctx, args) => {
    const msg = await ctx.db.get(args.id);
    if (!msg) throw new Error("messageQueue row not found");
    if (msg.status !== "draft") {
      throw new Error(`expected status=draft, got ${msg.status}`);
    }
    await ctx.db.patch(args.id, {
      status: "queued",
      approvedAt: Date.now(),
      scheduledNotBefore: Date.now(),
    });
    await ctx.scheduler.runAfter(0, internal.messaging.outbox.processNext, {});
  },
});

// Internal-only inspection helpers for debug + CLI dry-runs (npx convex run
// has no Clerk identity, so the auth-gated listOutbox / getQueueRow return
// null). Not auth-gated; do not surface in any UI.
export const inspectQueueRow = internalQuery({
  args: { id: v.id("messageQueue") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

export const inspectRecentLog = internalQuery({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("messageLog")
      .order("desc")
      .take(args.limit ?? 20);
  },
});
