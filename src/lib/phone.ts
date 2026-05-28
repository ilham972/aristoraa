// Sri Lankan phone number → E.164 normalizer.
//
// Accepts the three forms users typically enter:
//   "0771234567"     local, 10 digits starting 0   → "+94771234567"
//   "94771234567"    international, no plus        → "+94771234567"
//   "+94771234567"   already E.164                 → "+94771234567"
// Everything else (foreign numbers, garbage, missing digits) throws.
// Whitespace / hyphens / parentheses are stripped before parsing.
//
// Duplicated verbatim at convex/lib/phone.ts because Convex backend cannot
// import from src/. Keep both copies in sync.

const E164_SL = /^\+94\d{9}$/;

export function normalizeToE164SL(input: string): string {
  const stripped = input.replace(/[\s\-()]/g, "");
  let normalized: string;
  if (stripped.startsWith("+94") && stripped.length === 12) {
    normalized = stripped;
  } else if (stripped.startsWith("94") && stripped.length === 11) {
    normalized = "+" + stripped;
  } else if (stripped.startsWith("0") && stripped.length === 10) {
    normalized = "+94" + stripped.slice(1);
  } else {
    throw new Error(`Not a recognizable Sri Lankan phone number: "${input}"`);
  }
  if (!E164_SL.test(normalized)) {
    throw new Error(`Failed E.164 validation after normalize: "${input}" → "${normalized}"`);
  }
  return normalized;
}

export function tryNormalizeToE164SL(input: string): string | null {
  try {
    return normalizeToE164SL(input);
  } catch {
    return null;
  }
}

export function isValidE164SL(input: string): boolean {
  return E164_SL.test(input);
}
