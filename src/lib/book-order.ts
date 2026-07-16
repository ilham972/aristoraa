// Book-order sort, shared by the session sheet-planner "Book order" lens and
// the planner's per-week question grids. Sorts questions by their textbook
// identity ("3" < "3.a" < "3.a.ii" < "12.b") so families sit together —
// VIEW ONLY, never the tick/print order (that stays the easy-first ladder).
const ROMAN_ONLY = /^[ivx]+$/;
const ROMAN_VALS: Record<string, number> = { i: 1, v: 5, x: 10 };

function romanVal(s: string): number {
  let total = 0;
  for (let i = 0; i < s.length; i++) {
    const v0 = ROMAN_VALS[s[i]] ?? 0;
    const v1 = i + 1 < s.length ? (ROMAN_VALS[s[i + 1]] ?? 0) : 0;
    total += v0 < v1 ? -v0 : v0;
  }
  return total;
}

function cmpSeg(a: string, b: string): number {
  const na = parseInt(a, 10);
  const nb = parseInt(b, 10);
  const aNum = Number.isFinite(na);
  const bNum = Number.isFinite(nb);
  if (aNum && bNum && na !== nb) return na - nb;
  if (aNum !== bNum) return aNum ? -1 : 1; // numbered questions first
  if (!aNum && ROMAN_ONLY.test(a) && ROMAN_ONLY.test(b)) {
    const d = romanVal(a) - romanVal(b);
    if (d !== 0) return d; // "ix" before "x"; single i/v/x match alpha order
  }
  return a.localeCompare(b);
}

export function cmpLabel(a: string | null, b: string | null): number {
  if (!a || !b) return a ? -1 : b ? 1 : 0; // unlabeled sink to the end
  const as = a.split('.');
  const bs = b.split('.');
  for (let i = 0; i < Math.max(as.length, bs.length); i++) {
    if (as[i] === undefined) return -1; // "3" before "3.a"
    if (bs[i] === undefined) return 1;
    const d = cmpSeg(as[i].trim().toLowerCase(), bs[i].trim().toLowerCase());
    if (d !== 0) return d;
  }
  return 0;
}

export function sortByBookOrder<T extends { label: string | null }>(
  qs: T[],
): T[] {
  return [...qs].sort((a, b) => cmpLabel(a.label, b.label));
}
