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
      "{{parent_name}}, இன்று ({{date}}) {{student_name}} {{module}} வகுப்பை " +
      "தவறவிட்டார்கள். ஏதேனும் கவலை இருந்தால் எங்களைத் தொடர்பு கொள்ளவும். — Aristora",
  },
  {
    key: "absence_alert",
    language: "en",
    body:
      "{{parent_name}}, {{student_name}} missed today's {{module}} class " +
      "({{date}}). Please contact us if there is a concern. — Aristora",
  },

  // ─── tomorrow_reminder ─────────────────────────────────────────────────
  {
    key: "tomorrow_reminder",
    language: "ta",
    body:
      "{{parent_name}}, நினைவூட்டல்: நாளை {{student_name}}க்கு {{module}} " +
      "வகுப்பு {{start_time}} மணிக்கு உள்ளது. {{bring_text}} — Aristora",
  },
  {
    key: "tomorrow_reminder",
    language: "en",
    body:
      "{{parent_name}}, reminder: {{student_name}} has {{module}} tomorrow at " +
      "{{start_time}}. {{bring_text}} — Aristora",
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
