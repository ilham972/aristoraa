// ─── Sub-question utilities ───
// subQuestions format on exercise:
//   Record<string, {
//     count: number,
//     type: 'letter' | 'roman',
//     subSub?: Record<string, { count: number; type: 'letter' | 'roman' }>
//   }>
//
// Outer key   = main question number as string. e.g. "2".
// `count/type` = the level-2 layout (a,b,c… or i,ii,iii…).
// `subSub`     = OPTIONAL level-3 layout. Keys are 0-based sub-question
//                indices as strings ("0" = first sub like "a" or "i").
//                Indexes are stable across type toggles; labels are not.
//
// Examples:
//   { "2": { count: 3, type: "letter" } }
//     → Q2 has a, b, c
//   { "5": { count: 3, type: "letter", subSub: { "0": { count: 3, type: "roman" } } } }
//     → Q5 has a, b, c; Q5.a additionally has i, ii, iii (Q5.b and Q5.c don't)
//
// Backward compat: when `subSub` is absent (or empty), all helpers behave
// identically to the original 2-level implementation. Live data must keep
// behaving exactly as before.

export type SubSubDef = { count: number; type: 'letter' | 'roman' };
export type SubQuestionDef = {
  count: number;
  type: 'letter' | 'roman';
  subSub?: Record<string, SubSubDef>;
};
export type SubQuestionsMap = Record<string, SubQuestionDef>;

const LETTERS = 'abcdefghijklmnopqrst'.split('');
const ROMAN = ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x', 'xi', 'xii', 'xiii', 'xiv', 'xv', 'xvi', 'xvii', 'xviii', 'xix', 'xx'];

export function getSubLabel(index: number, type: 'letter' | 'roman'): string {
  if (type === 'roman') return ROMAN[index] ?? String(index + 1);
  return LETTERS[index] ?? String(index + 1);
}

export function getSubLabels(count: number, type: 'letter' | 'roman'): string[] {
  return Array.from({ length: count }, (_, i) => getSubLabel(i, type));
}

// True when this sub-question has its own sub-sub-parts (level-3 leaves).
export function hasSubSub(def: SubQuestionDef | undefined, subIndex: number): boolean {
  const s = def?.subSub?.[String(subIndex)];
  return !!s && s.count > 1;
}

export function getSubSubDef(
  def: SubQuestionDef | undefined,
  subIndex: number,
): SubSubDef | undefined {
  const s = def?.subSub?.[String(subIndex)];
  return s && s.count > 1 ? s : undefined;
}

/**
 * Get total scoreable items for an exercise.
 * Counts LEAVES only:
 *   • Q without sub-parts            → 1
 *   • Q with sub-parts, no sub-sub   → count of sub-parts (level-2 leaves)
 *   • Q with sub-parts AND sub-sub   → count of sub-sub leaves on those subs
 *                                       that have them, +1 per sub without
 *                                       sub-sub.
 * For any 2-level input (no `subSub`) this returns exactly what the
 * previous implementation returned.
 */
export function getTotalScoreable(questionCount: number, subQuestions?: SubQuestionsMap | null): number {
  if (!subQuestions) return questionCount;
  let total = 0;
  for (let q = 1; q <= questionCount; q++) {
    const sub = subQuestions[String(q)];
    if (!sub || sub.count <= 1) {
      total += 1;
      continue;
    }
    if (!sub.subSub) {
      total += sub.count;
      continue;
    }
    for (let s = 0; s < sub.count; s++) {
      const ss = sub.subSub[String(s)];
      total += ss && ss.count > 1 ? ss.count : 1;
    }
  }
  return total;
}

/**
 * Generate ordered question keys for an exercise (LEAF keys only).
 * Examples:
 *   • no sub-parts:        ["1", "2", "3"]
 *   • Q2 has a,b,c:        ["1", "2.a", "2.b", "2.c", "3"]
 *   • Q5 has a,b,c and
 *     Q5.a has i,ii,iii:   ["1", "5.a.i", "5.a.ii", "5.a.iii", "5.b", "5.c"]
 *
 * NOTE: Stem keys ("5", "5.a") are NOT emitted here — they are not
 * scoreable. For crop-key generation (which includes stems) use
 * generateCropKeys() in crop-keys.ts.
 */
export function generateQuestionKeys(questionCount: number, subQuestions?: SubQuestionsMap | null): string[] {
  const keys: string[] = [];
  for (let q = 1; q <= questionCount; q++) {
    const sub = subQuestions?.[String(q)];
    if (!sub || sub.count <= 1) {
      keys.push(String(q));
      continue;
    }
    for (let s = 0; s < sub.count; s++) {
      const subLabel = getSubLabel(s, sub.type);
      const ss = sub.subSub?.[String(s)];
      if (ss && ss.count > 1) {
        for (let t = 0; t < ss.count; t++) {
          keys.push(`${q}.${subLabel}.${getSubLabel(t, ss.type)}`);
        }
      } else {
        keys.push(`${q}.${subLabel}`);
      }
    }
  }
  return keys;
}

/**
 * Build a structure map for UI rendering.
 * Returns array of { mainQ, key, label, … } for each LEAF scoreable item.
 */
export type QuestionItem = {
  mainQ: number;         // main question number (1-based)
  key: string;           // entry key (e.g., "2.b", "5.a.i")
  label: string;         // display label for the deepest level
  isSubQuestion: boolean; // true if at least 2-level deep
  // Level-2 (sub) info — present when the item lives inside a sub-question.
  subIndex?: number;
  subLabel?: string;
  subTotal?: number;
  subType?: 'letter' | 'roman';
  // Level-3 (sub-sub) info — present when the item is a 3-level leaf.
  subSubIndex?: number;
  subSubLabel?: string;
  subSubTotal?: number;
  subSubType?: 'letter' | 'roman';
};

export function buildQuestionStructure(questionCount: number, subQuestions?: SubQuestionsMap | null): QuestionItem[] {
  const items: QuestionItem[] = [];
  for (let q = 1; q <= questionCount; q++) {
    const sub = subQuestions?.[String(q)];
    if (!sub || sub.count <= 1) {
      items.push({
        mainQ: q,
        key: String(q),
        label: String(q),
        isSubQuestion: false,
      });
      continue;
    }
    for (let s = 0; s < sub.count; s++) {
      const subLabel = getSubLabel(s, sub.type);
      const ss = sub.subSub?.[String(s)];
      if (ss && ss.count > 1) {
        for (let t = 0; t < ss.count; t++) {
          const ssLabel = getSubLabel(t, ss.type);
          items.push({
            mainQ: q,
            key: `${q}.${subLabel}.${ssLabel}`,
            label: ssLabel,
            isSubQuestion: true,
            subIndex: s,
            subLabel,
            subTotal: sub.count,
            subType: sub.type,
            subSubIndex: t,
            subSubLabel: ssLabel,
            subSubTotal: ss.count,
            subSubType: ss.type,
          });
        }
      } else {
        items.push({
          mainQ: q,
          key: `${q}.${subLabel}`,
          label: subLabel,
          isSubQuestion: true,
          subIndex: s,
          subLabel,
          subTotal: sub.count,
          subType: sub.type,
        });
      }
    }
  }
  return items;
}

/**
 * Group question items by main question number for UI rendering.
 */
export type QuestionGroup = {
  mainQ: number;
  hasSubQuestions: boolean;
  subType?: 'letter' | 'roman';
  items: QuestionItem[];
};

export function groupByMainQuestion(questionCount: number, subQuestions?: SubQuestionsMap | null): QuestionGroup[] {
  const structure = buildQuestionStructure(questionCount, subQuestions);
  const groups: QuestionGroup[] = [];
  let currentGroup: QuestionGroup | null = null;

  for (const item of structure) {
    if (!currentGroup || currentGroup.mainQ !== item.mainQ) {
      currentGroup = {
        mainQ: item.mainQ,
        hasSubQuestions: item.isSubQuestion,
        subType: item.subType,
        items: [item],
      };
      groups.push(currentGroup);
    } else {
      currentGroup.items.push(item);
    }
  }
  return groups;
}

/**
 * Get the status of a question group (for collapsed sub-question cells).
 * Returns exercise-like status based on sub-question completion.
 */
export function getGroupStatus(
  group: QuestionGroup,
  questionStates: Record<string, string>,
): { status: 'perfect' | 'wip' | 'none' | 'has-errors'; done: number; total: number } {
  let done = 0, hasWrong = false, hasAny = false;
  const total = group.items.length;

  for (const item of group.items) {
    const state = questionStates[item.key];
    if (state === 'correct' || state === 'wrong' || state === 'skipped') {
      done++;
      hasAny = true;
      if (state === 'wrong') hasWrong = true;
    }
  }

  if (done === total && !hasWrong) return { status: 'perfect', done, total };
  if (done === total && hasWrong) return { status: 'has-errors', done, total };
  if (hasAny) return { status: 'wip', done, total };
  return { status: 'none', done, total };
}
