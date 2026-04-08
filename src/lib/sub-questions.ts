// ─── Sub-question utilities ───
// subQuestions format on exercise: Record<string, { count: number, type: 'letter' | 'roman' }>
// e.g., { "2": { count: 3, type: "letter" }, "5": { count: 6, type: "roman" } }
// means Q2 has sub-questions a,b,c and Q5 has sub-questions i,ii,iii,iv,v,vi

export type SubQuestionDef = { count: number; type: 'letter' | 'roman' };
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

/**
 * Get total scoreable items for an exercise.
 * questionCount = number of main questions
 * subQuestions = which main questions have sub-parts
 */
export function getTotalScoreable(questionCount: number, subQuestions?: SubQuestionsMap | null): number {
  if (!subQuestions) return questionCount;
  let total = 0;
  for (let q = 1; q <= questionCount; q++) {
    const sub = subQuestions[String(q)];
    total += sub ? sub.count : 1;
  }
  return total;
}

/**
 * Generate ordered question keys for an exercise.
 * Returns keys like: ["1", "2.a", "2.b", "2.c", "3", "4.i", "4.ii", ...]
 */
export function generateQuestionKeys(questionCount: number, subQuestions?: SubQuestionsMap | null): string[] {
  const keys: string[] = [];
  for (let q = 1; q <= questionCount; q++) {
    const sub = subQuestions?.[String(q)];
    if (sub && sub.count > 1) {
      for (let s = 0; s < sub.count; s++) {
        keys.push(`${q}.${getSubLabel(s, sub.type)}`);
      }
    } else {
      keys.push(String(q));
    }
  }
  return keys;
}

/**
 * Build a structure map for UI rendering.
 * Returns array of { mainQ, key, label, subIndex? } for each scoreable item.
 */
export type QuestionItem = {
  mainQ: number;         // main question number (1-based)
  key: string;           // entry key (e.g., "2.b")
  label: string;         // display label (e.g., "b" for sub-question, "3" for standalone)
  isSubQuestion: boolean;
  subIndex?: number;     // 0-based index within sub-questions
  subTotal?: number;     // total sub-questions for this main question
  subType?: 'letter' | 'roman';
};

export function buildQuestionStructure(questionCount: number, subQuestions?: SubQuestionsMap | null): QuestionItem[] {
  const items: QuestionItem[] = [];
  for (let q = 1; q <= questionCount; q++) {
    const sub = subQuestions?.[String(q)];
    if (sub && sub.count > 1) {
      for (let s = 0; s < sub.count; s++) {
        items.push({
          mainQ: q,
          key: `${q}.${getSubLabel(s, sub.type)}`,
          label: getSubLabel(s, sub.type),
          isSubQuestion: true,
          subIndex: s,
          subTotal: sub.count,
          subType: sub.type,
        });
      }
    } else {
      items.push({
        mainQ: q,
        key: String(q),
        label: String(q),
        isSubQuestion: false,
      });
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
