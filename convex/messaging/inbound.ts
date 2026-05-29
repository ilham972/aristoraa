// Phase W.1.3 — inbound message ingest + session-status handler.
//
// Called from the Convex-hosted webhook in convex/http.ts after HMAC
// verification. Pure DB work — no fetch — so it's an internalMutation,
// atomic across all the side-effects below.
//
// Steps (per whatsapp_integration_plan.md §6):
//   1. Resolve student(s) by parentPhone, parentContact by phoneE164.
//   2. Upsert conversation; bump unreadCount + lastInboundAt.
//   3. Append messageLog (direction="in").
//   4. Opt-out keyword check (English-only for W.1 per Q3 decision
//      2026-05-28). If triggered, flip parentContacts.optedOut and
//      SUPPRESS the auto-ack on this triggering message.
//   5. Post in-app notification(s) to Lead + matched-student mentors
//      (per Q4 decision 2026-05-28).
//   6. Schedule outbound forward to Lead's + mentor's personal WhatsApp
//      (priority=high) for everyone with personalWhatsappPhone set.
//   7. Schedule auto-ack (priority=normal) UNLESS opt-out triggered or
//      we already sent one to this phone within the last 6h.
//   8. Kick the outbox sender chain.

import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import { internal } from "../_generated/api";
import { pickBestTemplate, renderTemplate, TEMPLATE_VARS } from "./templates";
import { getLeadTeachers, getMentorTeachersForStudents } from "./recipients";

const OPT_OUT_KEYWORDS = new Set([
  "STOP",
  "STOPUPDATES",
  "STOP UPDATES",
  "OPT OUT",
  "OPTOUT",
  "UNSUBSCRIBE",
]);

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

function isOptOutMessage(body: string): boolean {
  const normalized = body.trim().toUpperCase();
  return OPT_OUT_KEYWORDS.has(normalized);
}

// Status values where the bot is effectively down. Anything not in this set
// is treated as healthy (no notification posted) to avoid spamming the bell
// on every transition event.
const SESSION_DOWN_STATUSES = new Set([
  "disconnected",
  "destroyed",
  "authfailure",
  "auth_failure",
  "qr_ready",
  "loading",
  "logged_out",
]);

export const ingest = internalMutation({
  args: {
    phoneE164: v.string(),
    body: v.string(),
    providerMessageId: v.string(),
    occurredAt: v.number(),
    mediaUrls: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const now = args.occurredAt || Date.now();

    // 1. Resolve students by parentPhone. Sri Lankan rosters are small;
    //    a no-index filter is acceptable. If this becomes a bottleneck we
    //    add students.by_parentPhone in W.8.
    const matchedStudents = await ctx.db
      .query("students")
      .filter((q) => q.eq(q.field("parentPhone"), args.phoneE164))
      .collect();
    const matchedStudentIds = matchedStudents.map((s) => s._id);

    // 2. Resolve / create parentContact.
    let parentContact = await ctx.db
      .query("parentContacts")
      .withIndex("by_phone", (q) => q.eq("phoneE164", args.phoneE164))
      .first();

    // 3. Upsert conversation.
    let conversation = await ctx.db
      .query("conversations")
      .withIndex("by_phone", (q) => q.eq("phoneE164", args.phoneE164))
      .first();
    if (!conversation) {
      const convId = await ctx.db.insert("conversations", {
        phoneE164: args.phoneE164,
        parentContactId: parentContact?._id,
        primaryStudentId: matchedStudents[0]?._id,
        lastInboundAt: now,
        unreadCount: 1,
        archived: false,
        createdAt: now,
      });
      conversation = await ctx.db.get(convId);
    } else {
      await ctx.db.patch(conversation._id, {
        lastInboundAt: now,
        unreadCount: conversation.unreadCount + 1,
        parentContactId: conversation.parentContactId ?? parentContact?._id,
        primaryStudentId:
          conversation.primaryStudentId ?? matchedStudents[0]?._id,
      });
      conversation = await ctx.db.get(conversation._id);
    }
    if (!conversation) throw new Error("conversation upsert failed");
    const conversationId = conversation._id;

    // 4. Append messageLog row for the inbound.
    await ctx.db.insert("messageLog", {
      direction: "in",
      phoneE164: args.phoneE164,
      studentId: matchedStudents[0]?._id,
      conversationId,
      body: args.body,
      mediaUrls: args.mediaUrls,
      providerMessageId: args.providerMessageId,
      status: "received",
      occurredAt: now,
    });

    // 5. Opt-out detection.
    const optOutTriggered = isOptOutMessage(args.body);
    if (optOutTriggered) {
      if (parentContact) {
        await ctx.db.patch(parentContact._id, {
          optedOut: true,
          optedOutAt: now,
          updatedAt: now,
        });
        parentContact = await ctx.db.get(parentContact._id);
      } else {
        const pcId = await ctx.db.insert("parentContacts", {
          phoneE164: args.phoneE164,
          language: "ta",
          optedOut: true,
          optedOutAt: now,
          createdAt: now,
          updatedAt: now,
        });
        parentContact = await ctx.db.get(pcId);
      }
    }

    // 6. Resolve recipients.
    const leads = await getLeadTeachers(ctx.db);
    const mentors =
      matchedStudentIds.length > 0
        ? await getMentorTeachersForStudents(ctx.db, matchedStudentIds)
        : [];

    const senderLabel = parentContact?.displayName ?? args.phoneE164;
    const studentNamesList = matchedStudents.map((s) => s.name);
    const studentNamesStr = studentNamesList.join(", ");

    // 7. Post in-app notifications.
    const notifType = optOutTriggered
      ? "whatsapp_parent_optout"
      : matchedStudents.length === 0
        ? "whatsapp_unknown_inbound"
        : "whatsapp_parent_reply";
    const notifTitle = optOutTriggered
      ? `🛑 Opt-out from ${senderLabel}`
      : matchedStudents.length === 0
        ? `Unknown sender ${senderLabel}`
        : `📨 ${senderLabel} (${studentNamesStr})`;
    const notifPriority =
      optOutTriggered || matchedStudents.length > 0 ? "high" : "normal";
    const truncatedBody =
      args.body.length > 200 ? args.body.slice(0, 200) + "…" : args.body;
    const actionUrl = `/messaging/inbox?conversation=${conversationId}`;

    const notifRecipients = new Set<string>();
    for (const lead of leads) notifRecipients.add(lead.clerkUserId);
    if (matchedStudents.length > 0) {
      for (const m of mentors) notifRecipients.add(m.clerkUserId);
    }
    for (const clerkId of Array.from(notifRecipients)) {
      await ctx.db.insert("notifications", {
        userClerkId: clerkId,
        type: notifType,
        title: notifTitle,
        body: truncatedBody,
        priority: notifPriority,
        actionUrl,
        payload: {
          conversationId,
          phoneE164: args.phoneE164,
          optOut: optOutTriggered,
          matchedStudentCount: matchedStudents.length,
        },
        createdAt: now,
      });
    }

    // 8. Forward to Lead's + mentor's personal WhatsApp.
    const forwardPhones = new Set<string>();
    for (const lead of leads) {
      if (lead.personalWhatsappPhone) forwardPhones.add(lead.personalWhatsappPhone);
    }
    if (matchedStudents.length > 0) {
      for (const m of mentors) {
        if (m.personalWhatsappPhone) forwardPhones.add(m.personalWhatsappPhone);
      }
    }
    const forwardPrefix = optOutTriggered ? "🛑 OPT-OUT REQUEST" : "📨 Parent reply";
    const forwardBody =
      matchedStudents.length === 0
        ? `${forwardPrefix} — from ${senderLabel} (no matched student)\n"${args.body}"`
        : `${forwardPrefix} — from ${senderLabel} re ${studentNamesStr}\n"${args.body}"`;
    for (const phone of Array.from(forwardPhones)) {
      await ctx.db.insert("messageQueue", {
        toType: "contact",
        toPhone: phone,
        conversationId,
        body: forwardBody,
        status: "queued",
        priority: "high",
        scheduledNotBefore: now,
        attempts: 0,
        approvedAt: now,
        createdAt: now,
      });
    }

    // 9. Auto-ack (suppressed on opt-out or 6h dedup).
    if (!optOutTriggered && !parentContact?.optedOut) {
      const convQueueRows = await ctx.db
        .query("messageQueue")
        .withIndex("by_conversation", (q) => q.eq("conversationId", conversationId))
        .collect();
      const ackInWindow = convQueueRows.some(
        (m) =>
          m.templateKey === "auto_ack_parent" && m.createdAt >= now - SIX_HOURS_MS,
      );
      if (!ackInWindow) {
        const language = parentContact?.language ?? "ta";
        const templateRows = await ctx.db
          .query("messageTemplates")
          .withIndex("by_key_lang", (q) => q.eq("key", "auto_ack_parent"))
          .collect();
        const tmpl = pickBestTemplate(templateRows, language);
        if (tmpl) {
          // Fallback salutation if no displayName: "வணக்கம்" (Tamil) or "Hello".
          const parent_name =
            parentContact?.displayName ??
            (tmpl.language === "ta" ? "வணக்கம்" : "Hello");
          try {
            const rendered = renderTemplate("auto_ack_parent", tmpl.body, {
              parent_name,
            });
            void TEMPLATE_VARS; // ensure import is used for tree-shaking checks
            await ctx.db.insert("messageQueue", {
              templateKey: "auto_ack_parent",
              language: tmpl.language,
              toType: "contact",
              toPhone: args.phoneE164,
              conversationId,
              studentId: matchedStudents[0]?._id,
              body: rendered,
              status: "queued",
              priority: "normal",
              scheduledNotBefore: now,
              attempts: 0,
              approvedAt: now,
              createdAt: now,
            });
          } catch (err) {
            // Render failure shouldn't fail the whole ingest — log only.
            console.warn("auto-ack render failed", err);
          }
        }
      }
    }

    // 10. Kick the outbox so forwards + ack go out per pacing rules.
    await ctx.scheduler.runAfter(0, internal.messaging.outbox.processNext, {});

    return {
      conversationId,
      matchedStudentCount: matchedStudents.length,
      optOutTriggered,
      forwardCount: forwardPhones.size,
      notificationCount: notifRecipients.size,
    };
  },
});

// Session-status event handler — fires whatsapp_session_down when the bot
// becomes unable to send. Lead notification only (mentors don't need this).
export const handleSessionStatus = internalMutation({
  args: { status: v.string() },
  handler: async (ctx, args) => {
    const normalized = args.status.trim().toLowerCase();
    if (!SESSION_DOWN_STATUSES.has(normalized)) return { posted: 0 };
    const leads = await getLeadTeachers(ctx.db);
    const now = Date.now();
    let posted = 0;
    for (const lead of leads) {
      await ctx.db.insert("notifications", {
        userClerkId: lead.clerkUserId,
        type: "whatsapp_session_down",
        title: `⚠ WhatsApp bot session: ${args.status}`,
        body:
          "The bot is no longer sending. Open the Open-WA dashboard, re-scan the " +
          "QR with the business phone, and confirm status returns to 'ready'.",
        priority: "critical",
        actionUrl: "/messaging/settings",
        payload: { status: args.status },
        createdAt: now,
      });
      posted += 1;
    }
    return { posted };
  },
});
