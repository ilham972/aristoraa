// The INTERLEAVING teaching engine (Phase B, 2026-07-26).
//
// The founder's model, made mechanical:
//   GREEN  = conceptual/important. Taught NEW in the Main session, in book
//            order. The teacher already thinned it by hand in the Curate tab,
//            so the engine never picks "the first N leaves" — it takes the
//            whole green run, in order, and simply decides WHERE TO STOP.
//   YELLOW = middle drill. Handed to the Revision department (lib/revisionSR).
//   BLUE   = hard. Kept in Main (too hard to delegate) but taught LAST — it
//            returns only AFTER its concept's yellow has been drilled, so the
//            class has climbed easy → middle → hard before meeting it.
//
// Two ideas make it interleave instead of march:
//   1. OPEN SET — at most `openCap` units are "in progress" at once. A unit
//      opens only when another one's green runs out, and the next to open is
//      always the next in track order, so the track sequence is respected;
//      we only overlap the seams.
//   2. UNIT-LEVEL SPACED REPETITION — each session teaches `unitsPerSession`
//      units chosen FROM the open set by staleness (longest since its last
//      green) and weakest group-average retrievability. The unit rested last
//      session becomes the stalest, so units rotate. A unit whose term exam
//      is inside `deadlineUrgentDays` jumps the queue: the exam always wins.
//
// The result: an early unit no longer finishes in week 2 and goes cold. Its
// green is still arriving in week 6, its yellow is in revision, and its blue
// is returning to Main — all three colours of every open unit stay alive.
//
// Pure (no ctx) so vitest covers it directly AND the Sheets-tab board, the
// Timeline prediction and the real crystallize all run the SAME function —
// forecast provably equals print.

import { predictRevisionDates } from "./revisionSR";

const MS_PER_DAY = 86_400_000;

function parseYmd(ymd: string): number {
  return Date.parse(`${ymd}T00:00:00.000Z`);
}

export function daysBetweenYmd(from: string, to: string): number {
  return Math.round((parseYmd(to) - parseYmd(from)) / MS_PER_DAY);
}

export function addDaysYmd(ymd: string, n: number): string {
  const d = new Date(parseYmd(ymd));
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// ── Inputs ────────────────────────────────────────────────────────────────

export type PlanUnit = {
  unitId: string;
  /** Track index — the tie-break, and the order units open in. */
  order: number;
  /** Unseen GREEN qids in book order (difficulty → teacher drag order). */
  green: string[];
  /** Term exam for this unit's term, or null. */
  examDate: string | null;
  /** Group-average retrievability across the unit's concepts, 0..1. */
  avgR: number;
};

export type BlueQ = {
  qid: string;
  unitId: string;
  conceptIds: string[];
  difficulty: number;
  /** Stable book-walk position — final tie-break. */
  bookIdx: number;
};

export type YellowQ = {
  qid: string;
  conceptIds: string[];
  difficulty: number;
  bookIdx: number;
};

/** Per-date founder overrides ("today: 3 units, 6 green, 2 returns"). */
export type SessionOverride = {
  unitsPerSession?: number;
  greenCount?: number;
  returnCount?: number;
  /** Pinned units — teach exactly these, ignoring the staleness ranking. */
  unitIds?: string[];
};

export type InterleaveInput = {
  todayYmd: string;
  /** Ascending Main session dates (already cancellation-filtered). */
  sessionDates: string[];
  /** Ascending Revision days — where yellow gets drilled. */
  revisionDates: string[];
  units: PlanUnit[];
  /** qid → conceptId, for every green question (drives intro dates). */
  conceptByQid: Map<string, string>;
  blues: BlueQ[];
  yellows: YellowQ[];
  /** Ranked fallback pool: unseen leftovers from CLOSED units. */
  spiral: string[];
  /** Carry-over leftovers, oldest first — always served before green. */
  carry: string[];
  /** Concepts already introduced by real history: conceptId → ymd. */
  introducedConcepts: Map<string, string>;
  /**
   * unitId → the last date this unit actually received green, from the
   * group's sheet history. Seeds the staleness clock so a running group's
   * plan doesn't treat every open unit as brand new on the first re-plan.
   */
  lastGreenByUnit?: Map<string, string>;

  mainSize: number;
  returnShare: number;
  unitsPerSession: number;
  openCap: number;
  blueGapAfterYellow: number;
  blueGapNoYellow: number;
  revisionMinGapDays: number;
  revisionCapPerDay: number;
  deadlineUrgentDays: number;
  overrides: Map<string, SessionOverride>;
};

// ── Outputs ───────────────────────────────────────────────────────────────

export type UnitChoice = {
  unitId: string;
  /** Why this unit is on today's sheet — surfaced as a chip in the UI. */
  reason: "pinned" | "deadline" | "new" | "stale";
  /** Days since this unit last received green; null = never taught. */
  daysSinceGreen: number | null;
  avgR: number;
  greenCount: number;
};

export type PlannedSession = {
  date: string;
  /** Units contributing GREEN, in sheet order. */
  unitIds: string[];
  carryPicks: string[];
  greenPicks: string[];
  bluePicks: string[];
  spiralPicks: string[];
  /** The open set on this date (track order) — the "what's in flight" rail. */
  openUnitIds: string[];
  choices: UnitChoice[];
  /** Blue questions already due on this date that didn't fit. */
  blueBacklog: number;
};

export type InterleavePlan = {
  sessions: PlannedSession[];
  /** conceptId → ymd the concept's green intro lands (real or planned). */
  introByConcept: Map<string, string>;
  /** qid → predicted revision date for every yellow. */
  yellowDateByQid: Map<string, string>;
  /** qid → date a blue becomes DUE in Main; absent = waiting on its yellow. */
  blueDueByQid: Map<string, string>;
  /** Blue questions that never became due inside the horizon. */
  blueWaiting: string[];
  /** Green questions the horizon never reached. */
  greenLeftover: number;
};

// ── Ranking: which open units get taught on this date ──────────────────────

type RankState = {
  lastGreenDate: Map<string, string>;
  cursor: Map<string, number>;
};

function remainingGreen(u: PlanUnit, st: RankState): number {
  return u.green.length - (st.cursor.get(u.unitId) ?? 0);
}

/** The open set: the first `openCap` units, in track order, that still have
 *  green left. A unit only opens once an earlier one is exhausted. */
export function openSetFor(
  units: PlanUnit[],
  st: RankState,
  openCap: number,
): PlanUnit[] {
  const out: PlanUnit[] = [];
  for (const u of units) {
    if (remainingGreen(u, st) <= 0) continue;
    out.push(u);
    if (out.length >= openCap) break;
  }
  return out;
}

/** Rank the open set for one date: deadline-critical first, then the unit
 *  that has gone longest without green, then weakest memory, then track
 *  order. Never-taught units rank as infinitely stale so they get started. */
export function rankOpenUnits(
  open: PlanUnit[],
  st: RankState,
  date: string,
  deadlineUrgentDays: number,
): UnitChoice[] {
  const rows = open.map((u) => {
    const last = st.lastGreenDate.get(u.unitId) ?? null;
    const daysSinceGreen = last === null ? null : daysBetweenYmd(last, date);
    const daysToExam =
      u.examDate !== null ? daysBetweenYmd(date, u.examDate) : null;
    const urgent =
      daysToExam !== null &&
      daysToExam >= 0 &&
      daysToExam <= deadlineUrgentDays;
    return {
      u,
      urgent,
      daysToExam: daysToExam ?? Number.MAX_SAFE_INTEGER,
      daysSinceGreen,
      staleness: daysSinceGreen === null ? Number.MAX_SAFE_INTEGER : daysSinceGreen,
    };
  });
  rows.sort(
    (a, b) =>
      Number(b.urgent) - Number(a.urgent) ||
      (a.urgent ? a.daysToExam - b.daysToExam : 0) ||
      b.staleness - a.staleness ||
      a.u.avgR - b.u.avgR ||
      a.u.order - b.u.order,
  );
  return rows.map((r) => ({
    unitId: r.u.unitId,
    reason: r.urgent
      ? ("deadline" as const)
      : r.daysSinceGreen === null
        ? ("new" as const)
        : ("stale" as const),
    daysSinceGreen: r.daysSinceGreen,
    avgR: r.u.avgR,
    greenCount: 0,
  }));
}

// ── The green walk ────────────────────────────────────────────────────────

type GreenWalkResult = {
  perSession: Array<{
    date: string;
    unitIds: string[];
    choices: UnitChoice[];
    greenPicks: string[];
    carryPicks: string[];
    openUnitIds: string[];
    returnBudget: number;
  }>;
  introByConcept: Map<string, string>;
  greenLeftover: number;
};

/**
 * Walk green across the horizon. `elasticReturns` decides what happens to
 * the reserved returns budget: on the FIRST pass we don't yet know how much
 * blue is due, so returns are reserved nominally; on the SECOND pass the
 * caller passes the real per-date return fill so unused return slots are
 * handed back to green (a sheet is never short just because no blue is due).
 */
function greenWalk(
  input: InterleaveInput,
  returnFillByDate: Map<string, number> | null,
): GreenWalkResult {
  const st: RankState = {
    lastGreenDate: new Map(input.lastGreenByUnit ?? []),
    cursor: new Map(),
  };
  const introByConcept = new Map(input.introducedConcepts);
  const carryQueue = [...input.carry];
  const perSession: GreenWalkResult["perSession"] = [];
  const unitById = new Map(input.units.map((u) => [u.unitId, u]));

  for (const date of input.sessionDates) {
    const ov = input.overrides.get(date);
    const size = Math.max(1, input.mainSize);

    const carryPicks = carryQueue.splice(0, Math.min(size, carryQueue.length));

    const nominalReturn = Math.min(
      Math.max(0, size - carryPicks.length),
      ov?.returnCount ?? Math.round(size * input.returnShare),
    );
    // Second pass: only the slots returns can actually fill stay reserved.
    const reserved =
      returnFillByDate === null
        ? nominalReturn
        : Math.min(nominalReturn, returnFillByDate.get(date) ?? 0);

    let greenBudget = Math.max(0, size - carryPicks.length - reserved);
    if (ov?.greenCount !== undefined) {
      greenBudget = Math.max(
        0,
        Math.min(ov.greenCount, size - carryPicks.length),
      );
    }

    const open = openSetFor(input.units, st, input.openCap);
    const ranked = rankOpenUnits(open, st, date, input.deadlineUrgentDays);

    let chosen: UnitChoice[];
    if (ov?.unitIds && ov.unitIds.length > 0) {
      const pinned = new Set(ov.unitIds);
      // A pinned unit is taught even if it isn't in today's open set — the
      // founder's hand always beats the ranking. It must still have green.
      const extra = input.units
        .filter(
          (u) =>
            pinned.has(u.unitId) &&
            remainingGreen(u, st) > 0 &&
            !ranked.some((r) => r.unitId === u.unitId),
        )
        .map((u) => ({
          unitId: u.unitId,
          reason: "pinned" as const,
          daysSinceGreen: st.lastGreenDate.has(u.unitId)
            ? daysBetweenYmd(st.lastGreenDate.get(u.unitId)!, date)
            : null,
          avgR: u.avgR,
          greenCount: 0,
        }));
      chosen = [
        ...ranked
          .filter((r) => pinned.has(r.unitId))
          .map((r) => ({ ...r, reason: "pinned" as const })),
        ...extra,
      ];
    } else {
      const n = Math.max(1, ov?.unitsPerSession ?? input.unitsPerSession);
      chosen = ranked.slice(0, n);
    }

    const greenPicks: string[] = [];
    const countByUnit = new Map<string, number>();
    const take = (unitId: string, cap: number) => {
      const u = unitById.get(unitId);
      if (!u) return;
      let c = st.cursor.get(unitId) ?? 0;
      let taken = 0;
      while (
        taken < cap &&
        greenPicks.length < greenBudget &&
        c < u.green.length
      ) {
        greenPicks.push(u.green[c]);
        c += 1;
        taken += 1;
      }
      st.cursor.set(unitId, c);
      if (taken > 0) {
        countByUnit.set(unitId, (countByUnit.get(unitId) ?? 0) + taken);
        st.lastGreenDate.set(unitId, date);
      }
    };

    if (chosen.length > 0 && greenBudget > 0) {
      const perUnitCap = Math.ceil(greenBudget / chosen.length);
      for (const c of chosen) take(c.unitId, perUnitCap);
      // A chosen unit ran dry mid-sheet: rather than print a short sheet, the
      // budget flows on down the ranking (and then down the track) — this is
      // exactly how a session comes to hold 3 units instead of 2.
      if (greenPicks.length < greenBudget) {
        for (const r of ranked) {
          if (greenPicks.length >= greenBudget) break;
          take(r.unitId, greenBudget - greenPicks.length);
        }
      }
      if (greenPicks.length < greenBudget) {
        for (const u of input.units) {
          if (greenPicks.length >= greenBudget) break;
          take(u.unitId, greenBudget - greenPicks.length);
        }
      }
    }

    for (const qid of greenPicks) {
      const cid = input.conceptByQid.get(qid);
      if (!cid) continue;
      const cur = introByConcept.get(cid);
      if (!cur || date < cur) introByConcept.set(cid, date);
    }

    // Sheet order = the order units contributed.
    const unitIds: string[] = [];
    const seenUnit = new Set<string>();
    for (const c of chosen) {
      if (countByUnit.has(c.unitId) && !seenUnit.has(c.unitId)) {
        seenUnit.add(c.unitId);
        unitIds.push(c.unitId);
      }
    }
    countByUnit.forEach((_, unitId) => {
      if (!seenUnit.has(unitId)) {
        seenUnit.add(unitId);
        unitIds.push(unitId);
      }
    });

    const choices: UnitChoice[] = unitIds.map((unitId) => {
      const base =
        chosen.find((c) => c.unitId === unitId) ??
        ranked.find((r) => r.unitId === unitId);
      const u = unitById.get(unitId);
      return {
        unitId,
        reason: base?.reason ?? "stale",
        daysSinceGreen: base?.daysSinceGreen ?? null,
        avgR: u?.avgR ?? 0,
        greenCount: countByUnit.get(unitId) ?? 0,
      };
    });

    perSession.push({
      date,
      unitIds,
      choices,
      greenPicks,
      carryPicks,
      openUnitIds: open.map((u) => u.unitId),
      returnBudget: Math.max(0, size - carryPicks.length - greenPicks.length),
    });
  }

  let greenLeftover = 0;
  for (const u of input.units) greenLeftover += remainingGreen(u, st);
  return { perSession, introByConcept, greenLeftover };
}

// ── Blue: when does a hard question come back to Main? ─────────────────────

/**
 * Blue becomes due `blueGapAfterYellow` days after the LAST yellow of its
 * concept is drilled in revision. A concept with no yellow at all falls back
 * to `blueGapNoYellow` days after its green intro. A concept whose yellow
 * exists but never gets a revision day returns null — the blue WAITS, by
 * design (founder, 2026-07-26: "yellow is more important than blue").
 */
export function blueDueDates(
  blues: BlueQ[],
  yellows: YellowQ[],
  yellowDateByQid: Map<string, string>,
  introByConcept: Map<string, string>,
  blueGapAfterYellow: number,
  blueGapNoYellow: number,
): { due: Map<string, string>; waiting: string[] } {
  // Per concept: does it have yellow at all, and when is the last one drilled?
  const hasYellow = new Set<string>();
  const lastYellowDate = new Map<string, string>();
  const yellowUnscheduled = new Set<string>();
  for (const y of yellows) {
    for (const cid of y.conceptIds) {
      hasYellow.add(cid);
      const d = yellowDateByQid.get(y.qid);
      if (!d) {
        yellowUnscheduled.add(cid);
        continue;
      }
      const cur = lastYellowDate.get(cid);
      if (!cur || d > cur) lastYellowDate.set(cid, d);
    }
  }

  const due = new Map<string, string>();
  const waiting: string[] = [];
  for (const b of blues) {
    const cids = b.conceptIds;
    if (cids.length === 0) {
      // Untagged legacy question: nothing to wait for, treat as introduced.
      waiting.push(b.qid);
      continue;
    }
    let latest: string | null = null;
    let blocked = false;
    for (const cid of cids) {
      let d: string | null = null;
      if (hasYellow.has(cid)) {
        const yd = lastYellowDate.get(cid) ?? null;
        // Some of this concept's yellow has no revision day inside the
        // horizon — if NONE landed, the blue waits.
        if (yd === null) {
          blocked = true;
          break;
        }
        d = addDaysYmd(yd, blueGapAfterYellow);
      } else {
        const intro = introByConcept.get(cid) ?? null;
        if (intro === null) {
          blocked = true;
          break;
        }
        d = addDaysYmd(intro, blueGapNoYellow);
      }
      if (latest === null || d > latest) latest = d;
    }
    if (blocked || latest === null) {
      waiting.push(b.qid);
      continue;
    }
    due.set(b.qid, latest);
  }
  return { due, waiting };
}

// ── The whole plan ────────────────────────────────────────────────────────

function fillReturns(
  input: InterleaveInput,
  budgets: Array<{ date: string; budget: number }>,
  blueDue: Map<string, string>,
): {
  blueByDate: Map<string, string[]>;
  spiralByDate: Map<string, string[]>;
  backlogByDate: Map<string, number>;
  fillByDate: Map<string, number>;
} {
  const queue = input.blues
    .filter((b) => blueDue.has(b.qid))
    .map((b) => ({ ...b, dueDate: blueDue.get(b.qid)! }))
    .sort(
      (a, b) =>
        a.dueDate.localeCompare(b.dueDate) ||
        a.difficulty - b.difficulty ||
        a.bookIdx - b.bookIdx,
    );
  const spiralQueue = [...input.spiral];
  let i = 0;
  const blueByDate = new Map<string, string[]>();
  const spiralByDate = new Map<string, string[]>();
  const backlogByDate = new Map<string, number>();
  const fillByDate = new Map<string, number>();

  for (const { date, budget } of budgets) {
    const blue: string[] = [];
    while (blue.length < budget && i < queue.length) {
      if (queue[i].dueDate > date) break;
      blue.push(queue[i].qid);
      i += 1;
    }
    // Everything already due that today's sheet couldn't take.
    let backlog = 0;
    for (let j = i; j < queue.length && queue[j].dueDate <= date; j++)
      backlog += 1;

    const spiral: string[] = [];
    while (spiral.length + blue.length < budget && spiralQueue.length > 0) {
      spiral.push(spiralQueue.shift()!);
    }
    blueByDate.set(date, blue);
    spiralByDate.set(date, spiral);
    backlogByDate.set(date, backlog);
    fillByDate.set(date, blue.length + spiral.length);
  }
  return { blueByDate, spiralByDate, backlogByDate, fillByDate };
}

/**
 * Build the whole interleaved term plan. Runs the walk TWICE on purpose:
 * pass 1 reserves the returns budget nominally to learn where each concept's
 * green intro lands (blue due dates depend on it); pass 2 re-walks with the
 * real return fill so unused return slots become extra green. Deterministic
 * and pure — the Sheets board, the crystallizer and the Timeline all call it.
 */
export function buildInterleavedPlan(
  input: InterleaveInput,
): InterleavePlan {
  // Pass 1 — green only, to date every concept's intro.
  const pass1 = greenWalk(input, null);

  const predictYellow = (introByConcept: Map<string, string>) =>
    predictRevisionDates(
      input.yellows.map((y) => {
        let intro: string | null = null;
        for (const cid of y.conceptIds) {
          const d = introByConcept.get(cid) ?? null;
          if (d === null) return { ...y, introDate: null };
          if (intro === null || d > intro) intro = d;
        }
        return {
          qid: y.qid,
          difficulty: y.difficulty,
          bookIdx: y.bookIdx,
          introDate: y.conceptIds.length === 0 ? input.todayYmd : intro,
        };
      }),
      input.revisionDates,
      input.revisionMinGapDays,
      input.revisionCapPerDay,
    );

  const yellow1 = predictYellow(pass1.introByConcept);
  const blue1 = blueDueDates(
    input.blues,
    input.yellows,
    yellow1,
    pass1.introByConcept,
    input.blueGapAfterYellow,
    input.blueGapNoYellow,
  );
  const fill1 = fillReturns(
    input,
    pass1.perSession.map((s) => ({ date: s.date, budget: s.returnBudget })),
    blue1.due,
  );

  // Pass 2 — the real walk: green expands into return slots nothing can fill.
  const pass2 = greenWalk(input, fill1.fillByDate);
  const yellowDateByQid = predictYellow(pass2.introByConcept);
  const blue2 = blueDueDates(
    input.blues,
    input.yellows,
    yellowDateByQid,
    pass2.introByConcept,
    input.blueGapAfterYellow,
    input.blueGapNoYellow,
  );
  const fill2 = fillReturns(
    input,
    pass2.perSession.map((s) => ({ date: s.date, budget: s.returnBudget })),
    blue2.due,
  );

  const sessions: PlannedSession[] = pass2.perSession.map((s) => ({
    date: s.date,
    unitIds: s.unitIds,
    carryPicks: s.carryPicks,
    greenPicks: s.greenPicks,
    bluePicks: fill2.blueByDate.get(s.date) ?? [],
    spiralPicks: fill2.spiralByDate.get(s.date) ?? [],
    openUnitIds: s.openUnitIds,
    choices: s.choices,
    blueBacklog: fill2.backlogByDate.get(s.date) ?? 0,
  }));

  const placed = new Set<string>();
  for (const s of sessions) for (const q of s.bluePicks) placed.add(q);
  const blueWaiting = [
    ...blue2.waiting,
    ...input.blues.filter((b) => blue2.due.has(b.qid) && !placed.has(b.qid)).map((b) => b.qid),
  ];

  return {
    sessions,
    introByConcept: pass2.introByConcept,
    yellowDateByQid,
    blueDueByQid: blue2.due,
    blueWaiting,
    greenLeftover: pass2.greenLeftover,
  };
}
