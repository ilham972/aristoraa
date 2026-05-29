// Phase W.5.C — Templates editor backend.
//
// Lets the Lead polish template body text (especially the Tamil copy) from the
// UI without a code deploy. The variable CONTRACT still lives in code
// (TEMPLATE_VARS in templates.ts) and is the source of truth — an edited body
// is validated against it so the fail-loud renderer can never hit a stale var
// in a parent's inbox. This file only reads/writes the messageTemplates table.

import { v } from "convex/values";
import { mutation, query, MutationCtx } from "../_generated/server";
import { Id } from "../_generated/dataModel";
import {
  TEMPLATE_KEYS,
  TEMPLATE_VARS,
  TemplateKey,
  extractTemplateVars,
  renderTemplate,
} from "./templates";

function isKnownKey(k: string): k is TemplateKey {
  return (TEMPLATE_KEYS as readonly string[]).includes(k);
}

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

// Validate an edited body against the key's contract. Returns the list of
// problems (empty = valid). Rejects unknown vars and missing required vars.
function validateBody(key: TemplateKey, body: string): string[] {
  const errors: string[] = [];
  const required = TEMPLATE_VARS[key];
  const used = extractTemplateVars(body);
  for (const u of used) {
    if (!required.includes(u)) errors.push(`unknown variable: ${u}`);
  }
  for (const r of required) {
    if (!used.includes(r)) errors.push(`missing required variable: ${r}`);
  }
  if (body.trim().length === 0) errors.push("body is empty");
  return errors;
}

// All template rows, each annotated with its contract + last-editor name, so
// the editor can render variable chips and provenance without extra queries.
export const listTemplates = query({
  args: { activeOnly: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    let rows = await ctx.db.query("messageTemplates").collect();
    if (args.activeOnly) rows = rows.filter((r) => r.active);

    const nameCache = new Map<string, string>();
    const out = [];
    for (const r of rows) {
      let editor: string | null = null;
      if (r.updatedByTeacherId) {
        const cached = nameCache.get(r.updatedByTeacherId);
        if (cached !== undefined) editor = cached;
        else {
          const t = await ctx.db.get(r.updatedByTeacherId);
          editor = t?.name ?? null;
          nameCache.set(r.updatedByTeacherId, editor ?? "");
        }
      }
      out.push({
        id: r._id,
        key: r.key,
        language: r.language,
        body: r.body,
        active: r.active,
        updatedAt: r.updatedAt,
        updatedByName: editor || null,
        // Contract for this key (empty array for any unknown/legacy key).
        vars: isKnownKey(r.key) ? [...TEMPLATE_VARS[r.key]] : [],
      });
    }
    // Stable order: by key, then language (ta before en reads naturally here).
    out.sort((a, b) => a.key.localeCompare(b.key) || a.language.localeCompare(b.language));
    return out;
  },
});

// Live preview without saving. Missing sample vars are filled with a visible
// ‹placeholder› so the preview always renders; unknown body vars surface as an
// error string instead of throwing.
export const previewTemplate = query({
  args: {
    key: v.string(),
    body: v.string(),
    sampleVars: v.optional(v.record(v.string(), v.string())),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return { ok: false as const, error: "Unauthenticated" };
    if (!isKnownKey(args.key)) return { ok: false as const, error: `unknown template key: ${args.key}` };
    const required = TEMPLATE_VARS[args.key];
    const vars: Record<string, string> = {};
    for (const r of required) {
      vars[r] = args.sampleVars?.[r] ?? `‹${r}›`;
    }
    try {
      const rendered = renderTemplate(args.key, args.body, vars);
      return { ok: true as const, rendered };
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : "render failed" };
    }
  },
});

// Save an edited body for (key, language). Validates against the contract;
// rejects with the error list rather than persisting a body the renderer would
// later throw on. Inserts if the row doesn't exist yet.
export const updateTemplate = mutation({
  args: { key: v.string(), language: v.string(), body: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    if (!isKnownKey(args.key)) {
      return { ok: false as const, errors: [`unknown template key: ${args.key}`] };
    }
    const errors = validateBody(args.key, args.body);
    if (errors.length > 0) return { ok: false as const, errors };

    const teacherId = await requireTeacherId(ctx, identity.subject);
    const now = Date.now();
    const existing = await ctx.db
      .query("messageTemplates")
      .withIndex("by_key_lang", (q) => q.eq("key", args.key).eq("language", args.language))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        body: args.body,
        updatedByTeacherId: teacherId,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("messageTemplates", {
        key: args.key,
        language: args.language,
        body: args.body,
        active: true,
        updatedByTeacherId: teacherId,
        updatedAt: now,
        createdAt: now,
      });
    }
    return { ok: true as const };
  },
});
