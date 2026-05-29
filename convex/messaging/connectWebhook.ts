// Phase W.1.4 — POST our webhook URL to Open-WA so it actually delivers
// inbound events to us. Equivalent to the curl in plan §17.7. Called from
// the "Connect webhook" button on /messaging/settings.

import { action } from "../_generated/server";
import { v } from "convex/values";

export const configure = action({
  args: {
    // Defaults to the Convex site URL + our path; caller can override (for
    // testing or a future prod URL flip).
    webhookUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    const baseUrl = process.env.OPENWA_BASE_URL;
    const apiKey = process.env.OPENWA_API_KEY;
    const sessionId = process.env.OPENWA_SESSION_ID;
    const secret = process.env.OPENWA_WEBHOOK_SECRET;
    const convexSiteUrl = process.env.CONVEX_SITE_URL;
    if (!baseUrl || !apiKey || !sessionId || !secret) {
      throw new Error(
        "Missing OPENWA_* env var. Set MESSAGING_PROVIDER, OPENWA_BASE_URL, " +
          "OPENWA_API_KEY, OPENWA_SESSION_ID, OPENWA_WEBHOOK_SECRET in the Convex dashboard.",
      );
    }
    const url =
      args.webhookUrl ??
      (convexSiteUrl ? `${convexSiteUrl}/api/whatsapp/webhook` : null);
    if (!url) {
      throw new Error(
        "No webhook URL provided and CONVEX_SITE_URL not detected. Pass webhookUrl explicitly.",
      );
    }
    const res = await fetch(`${baseUrl}/sessions/${sessionId}/webhooks`, {
      method: "POST",
      headers: {
        "X-API-Key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url,
        secret,
        events: ["message.received", "session.status", "message.ack"],
      }),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "<unreadable>");
      throw new Error(
        `Open-WA webhook config failed ${res.status}: ${errText.slice(0, 400)}`,
      );
    }
    const data = await res.json().catch(() => ({}));
    return { ok: true, registeredUrl: url, response: data };
  },
});
