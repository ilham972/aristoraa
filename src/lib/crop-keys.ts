import { getSubLabel } from './sub-questions';
import type { SubQuestionsMap } from './sub-questions';

/**
 * Crop-key semantics (Phase 0.3, option 1a — no schema change):
 *   "2"    → main-stem of Q2 (or whole-question if Q2 has no sub-parts)
 *   "2.a"  → sub-part 2.a
 * Multiple crops may share the same key (e.g. several figures inside Q2.a).
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
    if (sub && sub.count > 1) {
      for (let s = 0; s < sub.count; s++) {
        keys.push(`${q}.${getSubLabel(s, sub.type)}`);
      }
    }
  }
  return keys;
}

export function parseCropKey(key: CropKey): { mainQ: number; subLabel: string | null } {
  const dot = key.indexOf('.');
  if (dot < 0) return { mainQ: parseInt(key, 10) || 0, subLabel: null };
  return {
    mainQ: parseInt(key.slice(0, dot), 10) || 0,
    subLabel: key.slice(dot + 1),
  };
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
