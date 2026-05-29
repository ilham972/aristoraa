// Phase W.1.4 — Lead-callable "Send test" that exercises the FULL outbox
// chokepoint chain (not the W.1.1 testSend:smoke which bypassed the queue).
//
// Target: the current Lead's `teachers.personalWhatsappPhone`. If unset,
// the mutation throws so the Lead is nudged to set it first.
// With WHATSAPP_DEV_MODE=true the provider rewrites the recipient to
// WHATSAPP_DEV_NUMBER anyway — same end result.

import { mutation } from "../_generated/server";
import { internal } from "../_generated/api";

export const sendTestFromSettings = mutation({
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    const teacher = await ctx.db
      .query("teachers")
      .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", identity.subject))
      .first();
    if (!teacher) {
      throw new Error(
        "No teachers row for current user — add yourself via Settings → Teachers first.",
      );
    }
    if (!teacher.personalWhatsappPhone) {
      throw new Error(
        "Set your personal WhatsApp number first (Messaging → Settings → My WhatsApp).",
      );
    }
    const now = Date.now();
    const body =
      "Aristora messaging chokepoint test.\n" +
      "If you're reading this, the provider + outbox + queue are all wired.\n" +
      `Sent ${new Date(now).toISOString()}.`;
    const id = await ctx.db.insert("messageQueue", {
      toType: "contact",
      toPhone: teacher.personalWhatsappPhone,
      body,
      status: "queued",
      priority: "normal",
      scheduledNotBefore: now,
      attempts: 0,
      createdByTeacherId: teacher._id,
      approvedByTeacherId: teacher._id,
      approvedAt: now,
      createdAt: now,
    });
    await ctx.scheduler.runAfter(0, internal.messaging.outbox.processNext, {});
    return { id, sentTo: teacher.personalWhatsappPhone };
  },
});
