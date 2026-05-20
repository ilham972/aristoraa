// Backend mirror of src/lib/groups/naming.ts (Convex cannot import from
// src/lib). Keep the two in sync. See that file for the rule rationale.

const MAX_FULL_NAMES = 3;

function firstName(full: string): string {
  const token = full.trim().split(/\s+/)[0] ?? "";
  return token.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function generateAutoName(memberNames: string[]): string {
  const names = memberNames.map(firstName).filter(Boolean);
  if (names.length === 0) return "new_group";
  if (names.length <= MAX_FULL_NAMES) return names.join("_");
  return names.map((n) => n.slice(0, 2)).join("_");
}
