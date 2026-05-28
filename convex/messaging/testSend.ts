// Phase W.1.1 smoke test — proves the provider chokepoint works end-to-end
// against the live Open-WA container, without any UI or queue infrastructure.
//
// Run from the project root:
//   npx convex run messaging/testSend:smoke '{"to":"+94788079051","text":"hello"}'
//
// With WHATSAPP_DEV_MODE=true (default), the actual recipient will be
// WHATSAPP_DEV_NUMBER no matter what you pass for `to`. The body is prefixed
// with "[DEV → orig <to>]" so the original target is visible.

import { internalAction } from "../_generated/server";
import { v } from "convex/values";
import { getProvider } from "./provider";
import { normalizeToE164SL } from "../lib/phone";

export const smoke = internalAction({
  args: {
    to: v.string(),
    text: v.optional(v.string()),
  },
  handler: async (_ctx, args) => {
    const toE164 = normalizeToE164SL(args.to);
    const text =
      args.text ??
      "வணக்கம், Aristora bot இணைப்பு சோதனை. (W.1.1 smoke test — if you see this, the provider chokepoint is wired.)";
    const provider = getProvider();
    const result = await provider.sendText({ to: toE164, text });
    return {
      ok: true,
      providerMessageId: result.providerMessageId,
      sentTo: toE164,
      devMode: (process.env.WHATSAPP_DEV_MODE ?? "true").toLowerCase() !== "false",
      devNumber: process.env.WHATSAPP_DEV_NUMBER ?? null,
    };
  },
});
