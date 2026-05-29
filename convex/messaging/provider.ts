// Phase W messaging provider — single chokepoint for ALL outbound WhatsApp.
//
// Per whatsapp_integration_plan.md §4.1 and §12.2:
//   - Every outbound (absence alert, weekly card, broadcast, reply, forward,
//     auto-ack) goes through getProvider().sendText / sendMedia / sendGroup*.
//   - No call site outside this file may touch Open-WA's REST API directly.
//   - When (if) we migrate to the official WhatsApp Business Cloud API, the
//     swap is one file: replace OpenWAProvider with MetaCloudProvider here.
//
// Dev-mode safety (§11):
//   - When WHATSAPP_DEV_MODE=true (default), every outbound `to` is rewritten
//     to WHATSAPP_DEV_NUMBER at THIS layer, not the call site. That way no
//     caller can accidentally hit a real parent. A "[DEV → orig +94…]" prefix
//     is prepended to the body so the founder can see what would have shipped.
//
// Runtime: this module is only safe to call from Convex actions — it uses
// `fetch`. Mutations and queries cannot invoke the provider directly.

// A WhatsApp group the bot is a member of, as returned by the provider's
// groups endpoint (shape normalized inside the provider).
export interface RawGroup {
  whatsappGroupId: string; // full "120363xxx@g.us" form
  displayName: string;
}

export interface MessagingProvider {
  sendText(args: { to: string; text: string }): Promise<{ providerMessageId: string }>;
  sendMedia(args: {
    to: string;
    mediaUrl: string;
    caption?: string;
    type: "image" | "document";
  }): Promise<{ providerMessageId: string }>;
  // displayName is used only for the dev-mode redirect annotation; the real
  // send targets `groupId`.
  sendGroupText(args: {
    groupId: string;
    text: string;
    displayName?: string;
  }): Promise<{ providerMessageId: string }>;
  sendGroupMedia(args: {
    groupId: string;
    mediaUrl: string;
    caption?: string;
    type: "image" | "document";
  }): Promise<{ providerMessageId: string }>;
  // Lists every group the bot is currently a member of (W.3 broadcasts sync).
  listGroups(): Promise<RawGroup[]>;
}

interface OpenWAConfig {
  baseUrl: string;     // e.g. "http://165.22.223.225:2886/api"
  apiKey: string;      // owa_k1_... — the auto-generated key, NOT API_MASTER_KEY
  sessionId: string;   // "aristora-prod"
  devMode: boolean;
  devNumber: string;   // E.164; required when devMode = true
}

class OpenWAProvider implements MessagingProvider {
  constructor(private readonly cfg: OpenWAConfig) {}

  private contactChatId(toE164: string): string {
    // Open-WA expects "<digits>@c.us" with no plus sign.
    return `${toE164.replace(/^\+/, "")}@c.us`;
  }

  private groupChatId(groupId: string): string {
    // whatsappGroups.whatsappGroupId is stored in the full "...@g.us" form, so
    // it's used directly. Be defensive in case a bare id slips through.
    return groupId.includes("@g.us") ? groupId : `${groupId}@g.us`;
  }

  private applyDevRedirect(to: string, body: string): { to: string; body: string } {
    if (!this.cfg.devMode) return { to, body };
    return {
      to: this.cfg.devNumber,
      body: `[DEV → orig ${to}]\n${body}`,
    };
  }

  private async post(path: string, payload: unknown): Promise<unknown> {
    const url = `${this.cfg.baseUrl}${path}`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": this.cfg.apiKey,
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "<unreadable>");
      throw new Error(`OpenWA ${path} failed ${res.status}: ${errText.slice(0, 500)}`);
    }
    return res.json().catch(() => ({}));
  }

  private async get(path: string): Promise<unknown> {
    const url = `${this.cfg.baseUrl}${path}`;
    const res = await fetch(url, {
      method: "GET",
      headers: { "X-API-Key": this.cfg.apiKey },
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "<unreadable>");
      throw new Error(`OpenWA ${path} failed ${res.status}: ${errText.slice(0, 500)}`);
    }
    return res.json().catch(() => ({}));
  }

  private extractMessageId(resp: unknown): string {
    // Open-WA's exact response shape isn't stable across versions; probe the
    // common keys and fall back to a placeholder rather than throwing.
    const r = resp as Record<string, unknown> | null;
    if (!r) return "unknown";
    const direct = r.id ?? r.messageId ?? r.providerMessageId;
    if (typeof direct === "string") return direct;
    const data = r.data as Record<string, unknown> | undefined;
    if (data) {
      const nested = data.id ?? data.messageId;
      if (typeof nested === "string") return nested;
    }
    return "unknown";
  }

  async sendText(args: { to: string; text: string }): Promise<{ providerMessageId: string }> {
    const { to, body } = this.applyDevRedirect(args.to, args.text);
    const resp = await this.post(`/sessions/${this.cfg.sessionId}/messages/send-text`, {
      chatId: this.contactChatId(to),
      text: body,
    });
    return { providerMessageId: this.extractMessageId(resp) };
  }

  async sendMedia(_args: {
    to: string;
    mediaUrl: string;
    caption?: string;
    type: "image" | "document";
  }): Promise<{ providerMessageId: string }> {
    // Wired in Phase W.6 (homework PDF auto-delivery). Stubbed so the interface
    // is complete and callers fail fast rather than silently dropping.
    throw new Error("OpenWAProvider.sendMedia not yet wired (lands in Phase W.6)");
  }

  async sendGroupText(args: {
    groupId: string;
    text: string;
    displayName?: string;
  }): Promise<{ providerMessageId: string }> {
    // Dev-mode safety for groups (§11 + W.3 req #4): a group id can't be
    // rewritten to a phone, so we redirect the whole send to the founder's
    // personal number and annotate which group it WOULD have hit. This is the
    // guard that stops test broadcasts blasting real parent groups.
    if (this.cfg.devMode) {
      const label = args.displayName ?? args.groupId;
      const resp = await this.post(`/sessions/${this.cfg.sessionId}/messages/send-text`, {
        chatId: this.contactChatId(this.cfg.devNumber),
        text: `[DEV → orig group "${label}"]\n${args.text}`,
      });
      return { providerMessageId: this.extractMessageId(resp) };
    }
    const resp = await this.post(`/sessions/${this.cfg.sessionId}/messages/send-text`, {
      chatId: this.groupChatId(args.groupId),
      text: args.text,
    });
    return { providerMessageId: this.extractMessageId(resp) };
  }

  async listGroups(): Promise<RawGroup[]> {
    const resp = await this.get(`/sessions/${this.cfg.sessionId}/groups`);
    // Log the raw envelope so a 0-result sync is diagnosable from
    // `npx convex logs` (widen the candidate keys below from what's seen here)
    // rather than needing a deploy round-trip.
    console.log("OpenWA groups raw:", JSON.stringify(resp).slice(0, 1500));
    // Open-WA's exact response shape isn't pinned across versions, so probe
    // the common envelopes + field names rather than hard-coding one. If the
    // first real sync returns 0 groups, inspect `npx convex logs` and widen
    // the candidate keys here.
    const r = resp as Record<string, unknown> | unknown[] | null;
    const arr: unknown[] = Array.isArray(r)
      ? r
      : Array.isArray((r as Record<string, unknown>)?.data)
        ? ((r as Record<string, unknown>).data as unknown[])
        : Array.isArray((r as Record<string, unknown>)?.groups)
          ? ((r as Record<string, unknown>).groups as unknown[])
          : [];
    const out: RawGroup[] = [];
    for (const item of arr) {
      const g = item as Record<string, unknown>;
      const idRaw =
        g.id ?? g.groupId ?? g.chatId ?? g._serialized ??
        (g.id as Record<string, unknown> | undefined)?._serialized;
      const id = typeof idRaw === "string" ? idRaw : undefined;
      if (!id) continue;
      const nameRaw = g.name ?? g.subject ?? g.displayName ?? g.title;
      const displayName =
        typeof nameRaw === "string" && nameRaw.length > 0 ? nameRaw : id;
      out.push({ whatsappGroupId: id, displayName });
    }
    return out;
  }

  async sendGroupMedia(_args: {
    groupId: string;
    mediaUrl: string;
    caption?: string;
    type: "image" | "document";
  }): Promise<{ providerMessageId: string }> {
    throw new Error("OpenWAProvider.sendGroupMedia not yet wired (lands in Phase W.3+)");
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.length === 0) {
    throw new Error(
      `Missing required env var: ${name}. Set it in the Convex dashboard ` +
        `(Settings → Environment Variables) and in .env.local for any frontend reads.`,
    );
  }
  return value;
}

export function getProvider(): MessagingProvider {
  const providerName = process.env.MESSAGING_PROVIDER ?? "openwa";
  if (providerName !== "openwa") {
    // MetaCloudProvider will join this switch when the official-API migration
    // happens (see plan §15 Q6 and §16). Until then, fail loudly.
    throw new Error(`Unknown MESSAGING_PROVIDER: ${providerName}`);
  }
  const baseUrl = requireEnv("OPENWA_BASE_URL");
  const apiKey = requireEnv("OPENWA_API_KEY");
  const sessionId = requireEnv("OPENWA_SESSION_ID");
  const devMode = (process.env.WHATSAPP_DEV_MODE ?? "true").toLowerCase() !== "false";
  // Default to dev mode whenever the var is missing — fail-safe per §11.
  const devNumber = devMode ? requireEnv("WHATSAPP_DEV_NUMBER") : "";
  return new OpenWAProvider({ baseUrl, apiKey, sessionId, devMode, devNumber });
}
