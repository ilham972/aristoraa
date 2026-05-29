// Phase W.1.3 — Convex-hosted webhook endpoint for Open-WA.
//
// Hosting choice (deviation from whatsapp_integration_plan.md §4.4):
// the plan documents a Next.js /api/whatsapp/webhook route on Vercel, but
// Convex's native HTTP actions are simpler (no admin-key handling, no
// Vercel cold start, stable URL across deploys, same auth model as the
// rest of the backend). Trade-off accepted; plan updated to match.
//
// Webhook URL Open-WA registers (see plan §17.7):
//   https://qualified-alpaca-97.convex.site/api/whatsapp/webhook   (dev)
//   https://<prod>.convex.site/api/whatsapp/webhook                 (prod)
//
// Verification: every payload is HMAC-SHA256 signed with OPENWA_WEBHOOK_SECRET
// over the raw body. We check the signature in constant time before any DB
// work. Reject = 401, malformed = 400, everything else = 200 (so Open-WA's
// retry logic doesn't loop on events we don't yet handle).

import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { tryNormalizeToE164SL } from "./lib/phone";

const http = httpRouter();

// Constant-time string compare. Web Crypto doesn't ship one and Node's
// timingSafeEqual isn't available in the Convex isolate runtime.
function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

async function computeHmacHex(secret: string, body: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBuf = await crypto.subtle.sign("HMAC", key, enc.encode(body));
  return Array.from(new Uint8Array(sigBuf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

http.route({
  path: "/api/whatsapp/webhook",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const secret = process.env.OPENWA_WEBHOOK_SECRET;
    if (!secret) {
      return new Response("Webhook secret not configured", { status: 500 });
    }

    // Read raw body BEFORE JSON parse so HMAC is computed over the same bytes
    // Open-WA signed.
    const rawBody = await request.text();

    // Open-WA's signature header isn't documented in the version we run; try
    // the common variants. The check is required, but we don't assume any
    // single header name.
    const sigCandidates = [
      "x-webhook-signature",
      "x-hub-signature-256",
      "x-openwa-signature",
      "x-signature",
    ];
    let receivedSig: string | null = null;
    for (const h of sigCandidates) {
      const v = request.headers.get(h);
      if (v) {
        receivedSig = v.trim();
        break;
      }
    }
    if (!receivedSig) {
      return new Response("Missing signature header", { status: 401 });
    }
    // Strip GitHub-style "sha256=" prefix if present.
    if (receivedSig.toLowerCase().startsWith("sha256=")) {
      receivedSig = receivedSig.slice(7);
    }
    const expectedHex = await computeHmacHex(secret, rawBody);
    if (!timingSafeEqualHex(receivedSig.toLowerCase(), expectedHex.toLowerCase())) {
      return new Response("Invalid signature", { status: 401 });
    }

    // Parse JSON. Open-WA's wrapper shape varies by version; pull the data
    // out defensively.
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }

    const eventRaw =
      (payload.event as string | undefined) ??
      (payload.type as string | undefined) ??
      (payload.eventType as string | undefined) ??
      "";
    const eventType = String(eventRaw).toLowerCase();

    // Common shapes: { event, data: {...} } | { type, payload: {...} } | flat.
    const dataObj = (payload.data ??
      payload.payload ??
      payload.message ??
      payload) as Record<string, unknown>;

    // ─── message.received ─────────────────────────────────────────────────
    if (eventType.includes("message") && eventType.includes("receiv")) {
      // Ignore our own outbound echoes.
      const fromMe =
        (dataObj.fromMe as boolean | undefined) ??
        (dataObj.from_me as boolean | undefined) ??
        false;
      if (fromMe) {
        return new Response("ignored: fromMe", { status: 200 });
      }

      const fromRaw =
        (dataObj.from as string | undefined) ??
        (dataObj.author as string | undefined) ??
        (dataObj.chatId as string | undefined);
      if (!fromRaw || typeof fromRaw !== "string") {
        return new Response("missing from", { status: 200 });
      }
      // Direct-message only for W.1.3; group inbound joins in W.3.
      if (!fromRaw.endsWith("@c.us")) {
        return new Response("ignored: non-direct (group?)", { status: 200 });
      }
      const phoneDigits = fromRaw.split("@")[0].replace(/^\+/, "");
      const phoneE164 = tryNormalizeToE164SL("+" + phoneDigits);
      if (!phoneE164) {
        // Non-SL sender (foreign number) — acknowledge without ingest so the
        // bot doesn't retry. Logged via 200 reason for visibility.
        return new Response("ignored: non-SL sender", { status: 200 });
      }

      const body =
        (dataObj.body as string | undefined) ??
        (dataObj.text as string | undefined) ??
        "";
      const providerMessageId =
        (dataObj.id as string | undefined) ??
        (dataObj.messageId as string | undefined) ??
        "unknown";

      // Open-WA may send timestamps in seconds or ms.
      const tsRaw = dataObj.timestamp;
      let occurredAt: number;
      if (typeof tsRaw === "number") {
        occurredAt = tsRaw > 1e12 ? tsRaw : tsRaw * 1000;
      } else {
        occurredAt = Date.now();
      }

      const mediaUrl = dataObj.mediaUrl as string | undefined;
      const mediaUrls = mediaUrl
        ? [mediaUrl]
        : (dataObj.mediaUrls as string[] | undefined);

      await ctx.runMutation(internal.messaging.inbound.ingest, {
        phoneE164,
        body,
        providerMessageId,
        occurredAt,
        mediaUrls,
      });
      return new Response("ok", { status: 200 });
    }

    // ─── session.status ───────────────────────────────────────────────────
    if (eventType.includes("session") && eventType.includes("status")) {
      const status =
        (dataObj.status as string | undefined) ??
        (dataObj.newStatus as string | undefined) ??
        "unknown";
      await ctx.runMutation(internal.messaging.inbound.handleSessionStatus, {
        status,
      });
      return new Response("ok", { status: 200 });
    }

    // ─── message.ack (delivery / read receipts) — deferred ────────────────
    // Future enhancement: update the source messageQueue row's status or
    // log a delivery timestamp. For W.1.3 just acknowledge.
    if (eventType.includes("message") && eventType.includes("ack")) {
      return new Response("ok: ack ignored (W.1.3)", { status: 200 });
    }

    // Unknown event — acknowledge so Open-WA doesn't retry. Log via the 200
    // body so we can spot unhandled events in webhook history.
    return new Response(`ok: unhandled event "${eventRaw}"`, { status: 200 });
  }),
});

export default http;
