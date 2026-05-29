// Phase W.1.4 — query the live Open-WA REST API for session health.
//
// Used by /messaging/settings on load + a "Refresh" button. Returns the
// raw status the bot reports so the UI can decide what to show
// (ready / qr_ready / disconnected / loading / …).
//
// fetch() requires action context; the mutation/query layers can't talk to
// the VPS directly.

import { action } from "../_generated/server";

interface SessionRow {
  id: string;
  name: string;
  status: string;
  phone?: string;
  pushName?: string;
  connectedAt?: string;
  lastActive?: string;
}

export const getStatus = action({
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    const baseUrl = process.env.OPENWA_BASE_URL;
    const apiKey = process.env.OPENWA_API_KEY;
    const sessionId = process.env.OPENWA_SESSION_ID;
    if (!baseUrl || !apiKey || !sessionId) {
      return {
        ok: false as const,
        reachable: false,
        error: "Missing env vars (set OPENWA_BASE_URL / OPENWA_API_KEY / OPENWA_SESSION_ID)",
        checkedAt: Date.now(),
      };
    }
    try {
      const res = await fetch(`${baseUrl}/sessions`, {
        headers: { "X-API-Key": apiKey },
      });
      if (!res.ok) {
        return {
          ok: false as const,
          reachable: true,
          error: `HTTP ${res.status}`,
          checkedAt: Date.now(),
        };
      }
      const sessions = (await res.json()) as SessionRow[];
      // Match by id OR name — the env var may hold either form. Section 17.6
      // of the plan documents the UUID form is required for REST routes,
      // but a fresh re-scan creates a new UUID, so name fallback is useful.
      const ours = sessions.find(
        (s) => s.id === sessionId || s.name === sessionId,
      );
      if (!ours) {
        return {
          ok: false as const,
          reachable: true,
          error: `Session "${sessionId}" not found among ${sessions.length} active sessions`,
          sessions,
          checkedAt: Date.now(),
        };
      }
      const sendable = ours.status === "ready" || ours.status === "connected";
      return {
        ok: true as const,
        reachable: true,
        session: ours,
        sendable,
        checkedAt: Date.now(),
      };
    } catch (err) {
      return {
        ok: false as const,
        reachable: false,
        error: err instanceof Error ? err.message : String(err),
        checkedAt: Date.now(),
      };
    }
  },
});
