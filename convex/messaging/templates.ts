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
  // W.4: switched from singular student_name + module + start_time + bring_text
  // to a sibling-aware {{student_lines}} (a pre-rendered list like
  // "Rahul - M3, 4.00pm;\nPriya - M2, 3.00pm"). One reminder per parent per day
  // can span two children in two modules at two times, so per-child vars were
  // collapsed into one rendered block. {{bring_text}} was dropped (no per-class
  // materials data source). DB bodies are migrated by
  // seedTemplates:ensureTomorrowReminderV2.
  tomorrow_reminder: ["parent_name", "student_lines", "date"],
  // W.5.D: collapsed to a sibling-aware attendance card. The original singular
  // vars (student_name/attended/total_sessions/points/rank_label/strong_module/
  // weak_module) were dropped: points + rank have NO data source in the app, and
  // module strength (learning-engine mastery) is empty for nearly all students.
  // The honest, populated weekly metric is attendance, pre-rendered per child
  // into {{student_lines}}. DB bodies migrated by seedTemplates:ensureWeeklyCardV2.
  weekly_card: ["parent_name", "week_label", "student_lines"],
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

// Distinct {{var}} names referenced in a body, in first-seen order. Used by the
// templates editor (W.5.C) to validate an edited body against the contract.
export function extractTemplateVars(body: string): string[] {
  const seen: string[] = [];
  const re = new RegExp(VAR_PATTERN.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const name = m[1];
    if (!seen.includes(name)) seen.push(name);
  }
  return seen;
}

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
