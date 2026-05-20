// Phase F: auto group naming.
//
// A group's name auto-derives from member first names, joined by "_", and
// re-derives whenever membership changes — UNLESS the user has manually
// edited it (group.autoName === false), in which case we leave it alone.
//
// Format (per the user's chosen "hybrid" rule):
//   ≤ 3 members → full lowercase first name:  asma_risla, niveka, gr8_boys
//   ≥ 4 members → first 2 letters each:       as_ri_ni_sh
//
// Empty group → "new_group" placeholder.

const MAX_FULL_NAMES = 3;

/** First whitespace-delimited token, lowercased, alphanumerics only. */
function firstName(full: string): string {
  const token = full.trim().split(/\s+/)[0] ?? "";
  return token.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Generate the auto name for a group from its members' display names.
 * Order is preserved from the input (callers should pass members in a stable
 * order — e.g. by joinedAt — so the name is deterministic).
 */
export function generateAutoName(memberNames: string[]): string {
  const names = memberNames.map(firstName).filter(Boolean);
  if (names.length === 0) return "new_group";
  if (names.length <= MAX_FULL_NAMES) {
    return names.join("_");
  }
  return names.map((n) => n.slice(0, 2)).join("_");
}
