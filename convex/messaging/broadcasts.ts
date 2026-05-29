// Phase W.3 — manual broadcasts to WhatsApp groups.
//
// Mirrors the W.2 absence pattern (draft → approve → outbox), but targets
// groups instead of contacts. Every row is a normal messageQueue row with
// toType="group"; the existing outbox/pacing/quiet-hours machinery handles
// the rest. No parallel sender, no cron — a human clicks Send.
//
// Flow: draftBatch (status="draft", shared batchId) → approveBroadcastBatch
// (flip to "queued" + kick). Quiet hours are honoured by stamping
// scheduledNotBefore to the next 07:00 window so the deferral is visible in
// the Outbox, not just silently applied by the sender.

import { v } from "convex/values";
import { mutation, query, MutationCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { Id } from "../_generated/dataModel";
import { renderTemplate, pickBestTemplate, TemplateKey, TEMPLATE_KEYS } from "./templates";
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

function isKnownTemplateKey(k: string): k is TemplateKey {
  return (TEMPLATE_KEYS as readonly string[]).includes(k);
}

export const quietHoursCheck = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return { inQuietHours: false, nextWindowStart: Date.now() };
    const now = Date.now();
    return {
      inQuietHours: isQuietHourColombo(now),
      nextWindowStart: nextNonQuietMs(now),
    };
  },
});

// Create one draft per target group. Template mode renders `templateKey` with
// `bodyText` (schedule_change's only var is body_text); freeform sends the
// literal text. Inactive groups are skipped. All rows share one batchId.
export const draftBatch = mutation({
  args: {
    targetGroupIds: v.array(v.id("whatsappGroups")),
    templateKey: v.optional(v.string()),
    language: v.optional(v.string()),
    bodyText: v.optional(v.string()),     // the announcement text for template mode
    freeformBody: v.optional(v.string()), // literal text for freeform mode
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    const teacherId = await requireTeacherId(ctx, identity.subject);
    if (args.targetGroupIds.length === 0) throw new Error("No target groups selected");

    const language = args.language ?? "ta";

    // Resolve the message body once (same text to every group in this batch).
    let body: string;
    let templateKey: string | undefined;
    if (args.templateKey) {
      if (!isKnownTemplateKey(args.templateKey)) {
        throw new Error(`Unknown templateKey: ${args.templateKey}`);
      }
      const text = (args.bodyText ?? "").trim();
      if (!text) throw new Error("Announcement text is empty");
      const rows = await ctx.db
        .query("messageTemplates")
        .withIndex("by_key_lang", (q) => q.eq("key", args.templateKey!))
        .collect();
      const tmpl = pickBestTemplate(rows, language);
      if (!tmpl) throw new Error(`No active template for ${args.templateKey}`);
      body = renderTemplate(args.templateKey, tmpl.body, { body_text: text });
      templateKey = args.templateKey;
    } else {
      const text = (args.freeformBody ?? "").trim();
      if (!text) throw new Error("Message is empty");
      body = text;
      templateKey = undefined;
    }

    const batchId = `broadcast-${Date.now()}`;
    const now = Date.now();
    let count = 0;
    let skippedInactive = 0;
    for (const gid of args.targetGroupIds) {
      const group = await ctx.db.get(gid);
      if (!group) continue;
      if (!group.active) {
        skippedInactive += 1;
        continue;
      }
      await ctx.db.insert("messageQueue", {
        templateKey,
        language: templateKey ? language : undefined,
        toType: "group",
        toWhatsappGroupId: group.whatsappGroupId,
        body,
        status: "draft",
        priority: "normal",
        scheduledNotBefore: now,
        attempts: 0,
        batchId,
        createdByTeacherId: teacherId,
        createdAt: now,
      });
      count += 1;
    }
    return { batchId, count, skippedInactive };
  },
});

// Flip every draft in the batch to queued and kick the sender. If we're inside
// quiet hours, stamp scheduledNotBefore to the next 07:00 so the Outbox shows
// the deferral and the UI can report deferredToMorning.
export const approveBroadcastBatch = mutation({
  args: { batchId: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    const teacherId = await requireTeacherId(ctx, identity.subject);

    const now = Date.now();
    const inQuiet = isQuietHourColombo(now);
    const scheduledNotBefore = inQuiet ? nextNonQuietMs(now) : now;

    const drafts = await ctx.db
      .query("messageQueue")
      .withIndex("by_batch", (q) => q.eq("batchId", args.batchId))
      .collect();
    let queued = 0;
    for (const m of drafts) {
      if (m.status !== "draft") continue;
      await ctx.db.patch(m._id, {
        status: "queued",
        approvedByTeacherId: teacherId,
        approvedAt: now,
        scheduledNotBefore,
      });
      queued += 1;
    }
    if (queued > 0) {
      await ctx.scheduler.runAfter(0, internal.messaging.outbox.processNext, {});
    }
    return {
      queued,
      deferredToMorning: inQuiet ? queued : 0,
      nextWindowStart: inQuiet ? scheduledNotBefore : null,
    };
  },
});
