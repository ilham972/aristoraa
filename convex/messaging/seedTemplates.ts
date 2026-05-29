// Phase W: idempotent seed of messageTemplates rows. Run once on first
// deploy; safe to re-run (skips any (key, language) pair already present).
// Lead edits body text from /messaging/templates later — do NOT overwrite
// edits by re-seeding.
//
// Run via: `npx convex run messaging/seedTemplates:run`
//
// Tamil bodies below are PLACEHOLDERS — Lead will polish them. The English
// versions are usable as-is for the founder's dev/test flow.

import { internalMutation, mutation } from "../_generated/server";

type Seed = {
  key: string;
  language: "ta" | "en";
  body: string;
};

const SEEDS: Seed[] = [
  // ─── absence_alert ─────────────────────────────────────────────────────
  {
    key: "absence_alert",
    language: "ta",
    body:
      "{{parent_name}}, இன்று ({{date}}) {{student_names}} வகுப்பை " +
      "தவறவிட்டார்கள். ஏதேனும் கவலை இருந்தால் எங்களைத் தொடர்பு கொள்ளவும். — Aristora",
  },
  {
    key: "absence_alert",
    language: "en",
    body:
      "{{parent_name}}, {{student_names}} missed today's class " +
      "({{date}}). Please contact us if there is a concern. — Aristora",
  },

  // ─── tomorrow_reminder (W.4 sibling-aware contract) ────────────────────
  {
    key: "tomorrow_reminder",
    language: "ta",
    body:
      "{{parent_name}}, நாளை ({{date}}) நினைவூட்டல்:\n{{student_lines}}.\n" +
      "வகுப்பில் கலந்துகொள்ள உறுதி செய்யவும். — Aristora",
  },
  {
    key: "tomorrow_reminder",
    language: "en",
    body:
      "{{parent_name}}, reminder for tomorrow ({{date}}):\n{{student_lines}}.\n" +
      "Please make sure they attend. — Aristora",
  },

  // ─── weekly_card ───────────────────────────────────────────────────────
  {
    key: "weekly_card",
    language: "ta",
    body:
      "{{student_name}} இன் வாராந்திர அறிக்கை ({{week_label}}):\n" +
      "வருகை: {{attended}}/{{total_sessions}}\n" +
      "புள்ளிகள்: {{points}} — {{rank_label}}\n" +
      "வலிமை: {{strong_module}}\n" +
      "மேம்படுத்த: {{weak_module}}\n" +
      "— Aristora",
  },
  {
    key: "weekly_card",
    language: "en",
    body:
      "Weekly report for {{student_name}} ({{week_label}}):\n" +
      "Attendance: {{attended}}/{{total_sessions}}\n" +
      "Points: {{points}} — {{rank_label}}\n" +
      "Strong: {{strong_module}}\n" +
      "Needs work: {{weak_module}}\n" +
      "— Aristora",
  },

  // ─── schedule_change ───────────────────────────────────────────────────
  {
    key: "schedule_change",
    language: "ta",
    body: "📢 {{body_text}} — Aristora",
  },
  {
    key: "schedule_change",
    language: "en",
    body: "📢 {{body_text}} — Aristora",
  },

  // ─── auto_ack_parent ───────────────────────────────────────────────────
  {
    key: "auto_ack_parent",
    language: "ta",
    body:
      "{{parent_name}}, உங்கள் செய்தியைப் பெற்றோம். விரைவில் பதிலளிக்கிறோம். — Aristora",
  },
  {
    key: "auto_ack_parent",
    language: "en",
    body: "{{parent_name}}, we've received your message. We'll reply shortly. — Aristora",
  },
];

async function seed(ctx: { db: { query: any; insert: any } }): Promise<{
  inserted: number;
  skipped: number;
  total: number;
}> {
  let inserted = 0;
  let skipped = 0;
  const now = Date.now();
  for (const s of SEEDS) {
    const existing = await ctx.db
      .query("messageTemplates")
      .withIndex("by_key_lang", (q: any) =>
        q.eq("key", s.key).eq("language", s.language),
      )
      .first();
    if (existing) {
      skipped += 1;
      continue;
    }
    await ctx.db.insert("messageTemplates", {
      key: s.key,
      language: s.language,
      body: s.body,
      active: true,
      updatedAt: now,
      createdAt: now,
    });
    inserted += 1;
  }
  return { inserted, skipped, total: SEEDS.length };
}

// Lead-callable wrapper (auth required). Used by /messaging/settings's
// "Seed templates" button in W.1.4.
export const run = mutation({
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    return await seed(ctx);
  },
});

// Internal callable from other internal mutations / actions (e.g. a future
// post-deploy bootstrap). No auth.
export const runInternal = internalMutation({
  handler: async (ctx) => {
    return await seed(ctx);
  },
});

// ── W.2 absence_alert contract migration ─────────────────────────────────
//
// W.1 seeded absence_alert with the singular {{student_name}} + {{module}}
// vars. W.2 switched the contract to sibling-aware {{student_names}} and
// dropped {{module}} (see templates.ts). The renderer fails loudly on
// unknown body vars, so the stored bodies MUST be updated before any absence
// draft can render. This heals the existing rows.
//
// Guard: only rewrites a row whose body still references the OLD vars
// ({{student_name}} or {{module}}). A body already on the new contract — or
// one the Lead has hand-edited to use {{student_names}} — is left untouched.
// Safe to re-run. Run once per deployment:
//   npx convex run messaging/seedTemplates:ensureAbsenceTemplateV2
//   npx convex run --prod messaging/seedTemplates:ensureAbsenceTemplateV2
const ABSENCE_V2: Record<"ta" | "en", string> = {
  ta:
    "{{parent_name}}, இன்று ({{date}}) {{student_names}} வகுப்பை " +
    "தவறவிட்டார்கள். ஏதேனும் கவலை இருந்தால் எங்களைத் தொடர்பு கொள்ளவும். — Aristora",
  en:
    "{{parent_name}}, {{student_names}} missed today's class " +
    "({{date}}). Please contact us if there is a concern. — Aristora",
};

async function ensureAbsenceV2(ctx: { db: { query: any; insert: any; patch: any } }): Promise<{
  patched: number;
  inserted: number;
  unchanged: number;
}> {
  let patched = 0;
  let inserted = 0;
  let unchanged = 0;
  const now = Date.now();
  for (const language of ["ta", "en"] as const) {
    const existing = await ctx.db
      .query("messageTemplates")
      .withIndex("by_key_lang", (q: any) =>
        q.eq("key", "absence_alert").eq("language", language),
      )
      .first();
    const v2 = ABSENCE_V2[language];
    if (!existing) {
      await ctx.db.insert("messageTemplates", {
        key: "absence_alert",
        language,
        body: v2,
        active: true,
        updatedAt: now,
        createdAt: now,
      });
      inserted += 1;
      continue;
    }
    const usesOldVars =
      existing.body.includes("{{student_name}}") ||
      existing.body.includes("{{module}}");
    if (usesOldVars) {
      await ctx.db.patch(existing._id, { body: v2, updatedAt: now });
      patched += 1;
    } else {
      unchanged += 1;
    }
  }
  return { patched, inserted, unchanged };
}

export const ensureAbsenceTemplateV2 = mutation({
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    return await ensureAbsenceV2(ctx);
  },
});

export const ensureAbsenceTemplateV2Internal = internalMutation({
  handler: async (ctx) => {
    return await ensureAbsenceV2(ctx);
  },
});

// ── W.3 schedule_change defensive seed ───────────────────────────────────
//
// W.1 seeded schedule_change, but W.2 found absence_alert was never seeded on
// prod — so don't assume. This inserts the schedule_change ta+en rows only if
// absent; never patches an existing (possibly Lead-edited) body. Run once per
// deployment before the first broadcast:
//   npx convex run messaging/seedTemplates:ensureScheduleChangeOnProdInternal
//   npx convex run --prod messaging/seedTemplates:ensureScheduleChangeOnProdInternal
const SCHEDULE_CHANGE: Record<"ta" | "en", string> = {
  ta: "📢 {{body_text}} — Aristora",
  en: "📢 {{body_text}} — Aristora",
};

async function ensureScheduleChange(ctx: {
  db: { query: any; insert: any };
}): Promise<{ inserted: number; unchanged: number }> {
  let inserted = 0;
  let unchanged = 0;
  const now = Date.now();
  for (const language of ["ta", "en"] as const) {
    const existing = await ctx.db
      .query("messageTemplates")
      .withIndex("by_key_lang", (q: any) =>
        q.eq("key", "schedule_change").eq("language", language),
      )
      .first();
    if (existing) {
      unchanged += 1;
      continue;
    }
    await ctx.db.insert("messageTemplates", {
      key: "schedule_change",
      language,
      body: SCHEDULE_CHANGE[language],
      active: true,
      updatedAt: now,
      createdAt: now,
    });
    inserted += 1;
  }
  return { inserted, unchanged };
}

export const ensureScheduleChangeOnProd = mutation({
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    return await ensureScheduleChange(ctx);
  },
});

export const ensureScheduleChangeOnProdInternal = internalMutation({
  handler: async (ctx) => {
    return await ensureScheduleChange(ctx);
  },
});

// ── W.4 tomorrow_reminder contract migration ──────────────────────────────
//
// W.1 seeded tomorrow_reminder with the singular {{student_name}} + {{module}}
// + {{start_time}} + {{bring_text}} vars. W.4 switched the contract to the
// sibling-aware {{student_lines}} block and dropped the others (see
// templates.ts). The renderer fails loudly on unknown body vars, so the stored
// bodies MUST be updated to the new contract before any tomorrow draft can
// render — otherwise previewTomorrow throws inside the query and the page errors
// out. This is insert-or-heal: inserts ta+en if absent (prod likely never had
// them — same finding as W.2/W.3), patches a row still on the OLD vars, and
// leaves a row already on the new contract (or Lead-edited) untouched.
//
// Guard: rewrites only a body that still references any OLD var
// ({{student_name}}, {{module}}, {{start_time}}, or {{bring_text}}). Safe to
// re-run. Run once per deployment before the first tomorrow send:
//   npx convex run messaging/seedTemplates:ensureTomorrowReminderV2
//   npx convex run --prod messaging/seedTemplates:ensureTomorrowReminderV2
const TOMORROW_V2: Record<"ta" | "en", string> = {
  ta:
    "{{parent_name}}, நாளை ({{date}}) நினைவூட்டல்:\n{{student_lines}}.\n" +
    "வகுப்பில் கலந்துகொள்ள உறுதி செய்யவும். — Aristora",
  en:
    "{{parent_name}}, reminder for tomorrow ({{date}}):\n{{student_lines}}.\n" +
    "Please make sure they attend. — Aristora",
};

async function ensureTomorrowV2(ctx: {
  db: { query: any; insert: any; patch: any };
}): Promise<{ patched: number; inserted: number; unchanged: number }> {
  let patched = 0;
  let inserted = 0;
  let unchanged = 0;
  const now = Date.now();
  for (const language of ["ta", "en"] as const) {
    const existing = await ctx.db
      .query("messageTemplates")
      .withIndex("by_key_lang", (q: any) =>
        q.eq("key", "tomorrow_reminder").eq("language", language),
      )
      .first();
    const v2 = TOMORROW_V2[language];
    if (!existing) {
      await ctx.db.insert("messageTemplates", {
        key: "tomorrow_reminder",
        language,
        body: v2,
        active: true,
        updatedAt: now,
        createdAt: now,
      });
      inserted += 1;
      continue;
    }
    const usesOldVars =
      existing.body.includes("{{student_name}}") ||
      existing.body.includes("{{module}}") ||
      existing.body.includes("{{start_time}}") ||
      existing.body.includes("{{bring_text}}");
    if (usesOldVars) {
      await ctx.db.patch(existing._id, { body: v2, updatedAt: now });
      patched += 1;
    } else {
      unchanged += 1;
    }
  }
  return { patched, inserted, unchanged };
}

export const ensureTomorrowReminderV2 = internalMutation({
  handler: async (ctx) => {
    return await ensureTomorrowV2(ctx);
  },
});

// Auth'd wrapper, in case the Lead wants to trigger the heal from a future
// settings button (mirrors ensureAbsenceTemplateV2 / ensureScheduleChangeOnProd).
export const ensureTomorrowReminderV2Auth = mutation({
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    return await ensureTomorrowV2(ctx);
  },
});
