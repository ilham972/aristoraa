import { getSubLabel } from './sub-questions';
import type { SubQuestionsMap } from './sub-questions';

/**
 * Crop-key semantics:
 *   "2"      → main-stem of Q2 (or whole-question if Q2 has no sub-parts)
 *   "2.a"    → sub-part 2.a (or sub-stem if 2.a itself has sub-sub-parts)
 *   "5.a.i"  → leaf 5.a.i (level-3)
 * Multiple crops may share the same key (e.g. several figures inside Q2.a).
 *
 * Crop-key generation emits BOTH stems AND leaves so the cropping UI can
 * surface a "Stem" target for each level — for a 3-level question the
 * printed sheet needs the mainQ stem AND the sub-Q stem above the leaf.
 */

export type CropKey = string;

export function generateCropKeys(
  questionCount: number,
  subQuestions?: SubQuestionsMap | null,
): CropKey[] {
  const keys: CropKey[] = [];
  for (let q = 1; q <= questionCount; q++) {
    keys.push(String(q));
    const sub = subQuestions?.[String(q)];
    if (!sub || sub.count <= 1) continue;
    for (let s = 0; s < sub.count; s++) {
      const subLabel = getSubLabel(s, sub.type);
      keys.push(`${q}.${subLabel}`);
      const ss = sub.subSub?.[String(s)];
      if (ss && ss.count > 1) {
        for (let t = 0; t < ss.count; t++) {
          keys.push(`${q}.${subLabel}.${getSubLabel(t, ss.type)}`);
        }
      }
    }
  }
  return keys;
}

/**
 * Parse a crop key into its component parts.
 *
 * Backward-compat: `mainQ` and `subLabel` keep their original semantics —
 * `subLabel` is the **immediate** sub-letter ("a", "i", etc.) and is null
 * for a stem like "5". For 3-level leaves ("5.a.i"), `subLabel` is "a" and
 * `subSubLabel` is "i". Callers that don't know about 3-level can keep
 * reading `subLabel` and will see the level-2 letter.
 */
export function parseCropKey(key: CropKey): {
  mainQ: number;
  subLabel: string | null;
  subSubLabel: string | null;
} {
  const parts = key.split('.');
  const mainQ = parseInt(parts[0], 10) || 0;
  const subLabel = parts.length >= 2 ? parts[1] : null;
  const subSubLabel = parts.length >= 3 ? parts.slice(2).join('.') : null;
  return { mainQ, subLabel, subSubLabel };
}

export function nextCropKey(current: CropKey | null, allKeys: CropKey[]): CropKey | null {
  if (!current) return allKeys[0] ?? null;
  const idx = allKeys.indexOf(current);
  if (idx < 0 || idx >= allKeys.length - 1) return null;
  return allKeys[idx + 1];
}

/**
 * Find a smart resume target: continue from the highest-ordered key already
 * cropped (advance one step). If nothing cropped yet, return the first key.
 * Preserves the user's "fast cropping" expectation by skipping forward to
 * where they last were.
 */
export function resumeCropKey(
  allKeys: CropKey[],
  existingKeys: CropKey[],
): CropKey | null {
  if (allKeys.length === 0) return null;
  if (existingKeys.length === 0) return allKeys[0];
  let highestIdx = -1;
  for (const k of existingKeys) {
    const i = allKeys.indexOf(k);
    if (i > highestIdx) highestIdx = i;
  }
  if (highestIdx < 0) return allKeys[0];
  return allKeys[Math.min(highestIdx + 1, allKeys.length - 1)];
}
