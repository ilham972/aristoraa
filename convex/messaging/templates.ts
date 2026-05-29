// Phase W template system.
//
// Source of truth split:
//   - The variable contract per templateKey lives HERE in code (TEMPLATE_VARS).
//   - The body text lives in the `messageTemplates` table so the Lead can edit
//     it without a deploy (especially Tamil copy after they hear how parents
//     actually react).
//
// The renderer fails loudly on:
//   - missing required vars (caller forgot to compute one), or
//   - body referencing a {{var}} not in the supplied object (typo / stale body).
// This is intentional — silent fallback to "{{undefined}}" in a parent's
// inbox is exactly the kind of trust-killer the founder is trying to avoid.

export const TEMPLATE_KEYS = [
  "absence_alert",
  "tomorrow_reminder",
  "weekly_card",
  "schedule_change",
  "auto_ack_parent",
  "homework_pdf_parent",      // W.6
  "exam_result_parent",       // W.7
] as const;

export type TemplateKey = (typeof TEMPLATE_KEYS)[number];

// Required variable names per template. Language-agnostic — every language
// variant of the same key shares the same contract.
export const TEMPLATE_VARS: Record<TemplateKey, readonly string[]> = {
  // W.2: switched from singular student_name + module to a sibling-aware
  // student_names list. One absence message per parent per day can span two
  // children in two different modules, so a single {{module}} would be wrong
  // — it was dropped. The DB bodies are migrated by
  // seedTemplates:ensureAbsenceTemplateV2.
  absence_alert: ["parent_name", "student_names", "date"],
  tomorrow_reminder: [
    "parent_name",
    "student_name",
    "module",
    "start_time",
    "bring_text",
  ],
  weekly_card: [
    "parent_name",
    "student_name",
    "week_label",
    "attended",
    "total_sessions",
    "points",
    "rank_label",
    "strong_module",
    "weak_module",
  ],
  schedule_change: ["body_text"],
  auto_ack_parent: ["parent_name"],
  homework_pdf_parent: ["parent_name", "student_name", "date"],
  exam_result_parent: [
    "parent_name",
    "student_name",
    "term_label",
    "predicted_total",
    "actual_total",
    "top_focus_concept",
  ],
};

const VAR_PATTERN = /\{\{\s*(\w+)\s*\}\}/g;

export function renderTemplate(
  key: TemplateKey,
  body: string,
  vars: Record<string, string | number>,
): string {
  const required = TEMPLATE_VARS[key];
  const missing = required.filter((k) => !(k in vars));
  if (missing.length > 0) {
    throw new Error(
      `renderTemplate(${key}): missing required vars: ${missing.join(", ")}. ` +
        `Provided: ${Object.keys(vars).join(", ") || "(none)"}`,
    );
  }
  return body.replace(VAR_PATTERN, (_match, name: string) => {
    if (!(name in vars)) {
      throw new Error(
        `renderTemplate(${key}): body references unknown var {{${name}}}. ` +
          `Either fix the template body or extend TEMPLATE_VARS.${key}.`,
      );
    }
    return String(vars[name]);
  });
}

// Resolve the best body for a (key, requestedLanguage) pair. Falls back
// requestedLanguage → "ta" → "en" → first active row, throwing only if no
// active row exists for the key at all.
export function pickBestTemplate<T extends { language: string; active: boolean }>(
  candidates: T[],
  requestedLanguage: string,
): T | null {
  const active = candidates.filter((c) => c.active);
  if (active.length === 0) return null;
  return (
    active.find((c) => c.language === requestedLanguage) ??
    active.find((c) => c.language === "ta") ??
    active.find((c) => c.language === "en") ??
    active[0]
  );
}
