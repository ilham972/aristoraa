// Spaced-repetition ordering for the Revision department's ROUTED ("yellow")
// questions + the Lesson Builder Timeline tab's date prediction (2026-07-19).
//
// The founder's model: a concept's easy intro is TAUGHT in a Main session,
// the middle drill lands in a Revision session a few days later, the hard
// tail returns to Main. Main sheets already run on spaced repetition (the
// spiral, weakest group-average memory first); this module gives the
// Revision half the same brain so both departments act as ONE SR system:
//   • a routed question is DUE only after every tagged concept has been
//     introduced (the student has a memory row for it) AND a minimum gap has
//     passed since the concept's latest review — drilling the same evening
//     it was taught is not spaced repetition;
//   • among due questions the WEAKEST memory is served first (the spiral's
//     rule), tie-broken easy→hard so a stem family's sub-question ladder
//     survives inside revision sheets too, then book order;
//   • introduced-but-not-yet-due questions only top up spare capacity;
//   • NEVER-introduced concepts are held back entirely — a revision teacher
//     drills, they don't teach (compression keeps intros green for the same
//     reason). Questions with no concept tags (legacy data) are served, not
//     starved.
// Pure functions (no ctx) so vitest covers them directly and the Timeline
// prediction provably matches what the real queue will print.

const MS_PER_DAY = 86_400_000;

export type RoutedCandidate = {
  qid: string;
  difficulty: number;
  // Stable book-walk position (unit order, then ladder index) — the final
  // tie-break so ordering is deterministic.
  bookIdx: number;
  conceptIds: string[];
};

export type ConceptMemorySummary = {
  lastReviewAt: number; // ms epoch of the latest attempt on the concept
  r: number; // retrievability now, 0..1
};

// Order the routed questions for ONE revision sheet. Returns qids, most
// urgent first: due (weakest memory → easiest → book order), then
// introduced-but-inside-the-gap as capacity top-up. Un-introduced concepts
// are omitted — they are not this department's job yet.
export function orderRoutedForRevision(
  candidates: RoutedCandidate[],
  memory: Map<string, ConceptMemorySummary>,
  nowMs: number,
  minGapDays: number,
): string[] {
  type Ranked = {
    qid: string;
    due: boolean;
    r: number;
    difficulty: number;
    bookIdx: number;
  };
  const ranked: Ranked[] = [];
  for (const c of candidates) {
    if (c.conceptIds.length === 0) {
      // Untagged legacy question: keep the old serve-it behavior.
      ranked.push({
        qid: c.qid,
        due: true,
        r: 0,
        difficulty: c.difficulty,
        bookIdx: c.bookIdx,
      });
      continue;
    }
    let introduced = true;
    let weakestR = 1;
    let freshestReview = 0;
    for (const cid of c.conceptIds) {
      const m = memory.get(cid);
      if (!m) {
        introduced = false;
        break;
      }
      weakestR = Math.min(weakestR, m.r);
      freshestReview = Math.max(freshestReview, m.lastReviewAt);
    }
    if (!introduced) continue;
    const gapDays = (nowMs - freshestReview) / MS_PER_DAY;
    ranked.push({
      qid: c.qid,
      due: gapDays >= minGapDays,
      r: weakestR,
      difficulty: c.difficulty,
      bookIdx: c.bookIdx,
    });
  }
  ranked.sort(
    (a, b) =>
      Number(b.due) - Number(a.due) ||
      a.r - b.r ||
      a.difficulty - b.difficulty ||
      a.bookIdx - b.bookIdx,
  );
  return ranked.map((x) => x.qid);
}

// ── Auto-split: the ambient middle-drill default (2026-07-19) ────────────
// The founder's model, made the DEFAULT (no tapping, no "+ unit"): in every
// concept the first question introduces, the middle drills, the hard tail
// returns to Main — and the same shape repeats INSIDE a multi-part question
// (family): first sub-question intro, middle subs drill, last sub returns.
// Rule, over one concept's leaves in ladder (easy→hard) order:
//   • group leaves into FAMILIES (sub-questions of one stem; singletons are
//     their own family), in first-appearance order;
//   • Main-track families = the FIRST family (the intro) + the hardest
//     ~hardTailShare tail of families (taught, never delegated);
//   • middle families → every leaf YELLOW;
//   • Main-track families with 3+ leaves → their middle leaves YELLOW too
//     (first + last sub stay green).
// A concept with fewer than 3 leaves has no middle. Returns the YELLOW set;
// callers must let stored routes (manual or auto rows), bans and seen win.
export type ConceptLeaf = { qid: string; familyKey: string | null };

export function autoMiddleSplit(
  leaves: ConceptLeaf[],
  hardTailShare: number,
): Set<string> {
  const yellow = new Set<string>();
  if (leaves.length < 3) return yellow;
  const fams: ConceptLeaf[][] = [];
  const famIdx = new Map<string, number>();
  for (const leaf of leaves) {
    const existing =
      leaf.familyKey !== null ? famIdx.get(leaf.familyKey) : undefined;
    if (existing !== undefined) {
      fams[existing].push(leaf);
    } else {
      if (leaf.familyKey !== null) famIdx.set(leaf.familyKey, fams.length);
      fams.push([leaf]);
    }
  }
  const mainTrack = new Set<number>([0]);
  const tail = Math.ceil(fams.length * hardTailShare);
  for (let i = Math.max(0, fams.length - tail); i < fams.length; i++)
    mainTrack.add(i);
  fams.forEach((fam, i) => {
    if (!mainTrack.has(i)) {
      for (const l of fam) yellow.add(l.qid);
      return;
    }
    if (fam.length >= 3) for (const l of fam.slice(1, -1)) yellow.add(l.qid);
  });
  return yellow;
}

function addDaysYmd(ymd: string, n: number): string {
  const d = new Date(`${ymd}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export type PredictYellow = {
  qid: string;
  difficulty: number;
  bookIdx: number;
  // The date the LAST of its concepts gets (or got) introduced by a green
  // Main pick — real for taught sheets, planned date for future ones. null =
  // the intro is nowhere in the plan yet → the question stays "waiting".
  introDate: string | null;
};

// Predict which revision day each yellow question lands on: it becomes due
// minGapDays after its concept intro, then upcoming revision days drain the
// due set in order (earliest due → easiest → book order), capPerDay each.
// Returns qid → date; a qid missing from the map is waiting (no intro
// scheduled, or the revision days ran out).
export function predictRevisionDates(
  yellows: PredictYellow[],
  revisionDates: string[], // ascending, all >= today
  minGapDays: number,
  capPerDay: number,
): Map<string, string> {
  const out = new Map<string, string>();
  const queue = yellows
    .filter((y) => y.introDate !== null)
    .map((y) => ({
      qid: y.qid,
      difficulty: y.difficulty,
      bookIdx: y.bookIdx,
      dueDate: addDaysYmd(y.introDate!, minGapDays),
    }))
    .sort(
      (a, b) =>
        a.dueDate.localeCompare(b.dueDate) ||
        a.difficulty - b.difficulty ||
        a.bookIdx - b.bookIdx,
    );
  let i = 0;
  for (const date of revisionDates) {
    let served = 0;
    // The queue is due-date sorted, so one pass per day: serve everything
    // due by this date until the day is full.
    while (i < queue.length && served < capPerDay) {
      if (queue[i].dueDate > date) break;
      out.set(queue[i].qid, date);
      i += 1;
      served += 1;
    }
  }
  return out;
}
