import { describe, expect, it } from "vitest";
import {
  addDaysYmd,
  blueDueDates,
  buildInterleavedPlan,
  daysBetweenYmd,
  openSetFor,
  rankOpenUnits,
  type BlueQ,
  type InterleaveInput,
  type PlanUnit,
  type YellowQ,
} from "../convex/lib/interleaveCore";

// ── helpers ───────────────────────────────────────────────────────────────

function unit(
  unitId: string,
  order: number,
  greenCount: number,
  opts: { examDate?: string | null; avgR?: number; prefix?: string } = {},
): PlanUnit {
  const prefix = opts.prefix ?? unitId;
  return {
    unitId,
    order,
    green: Array.from({ length: greenCount }, (_, i) => `${prefix}g${i + 1}`),
    examDate: opts.examDate ?? null,
    avgR: opts.avgR ?? 0.5,
  };
}

function baseInput(over: Partial<InterleaveInput> = {}): InterleaveInput {
  return {
    todayYmd: "2026-08-03",
    sessionDates: [],
    revisionDates: [],
    units: [],
    conceptByQid: new Map(),
    blues: [],
    yellows: [],
    spiral: [],
    carry: [],
    introducedConcepts: new Map(),
    mainSize: 8,
    returnShare: 0.35,
    unitsPerSession: 2,
    openCap: 3,
    blueGapAfterYellow: 3,
    blueGapNoYellow: 7,
    revisionMinGapDays: 3,
    revisionCapPerDay: 10,
    deadlineUrgentDays: 21,
    overrides: new Map(),
    ...over,
  };
}

/** Mon/Thu main sessions from a Monday, n dates. */
function mondaysAndThursdays(start: string, n: number): string[] {
  const out: string[] = [];
  let d = start;
  let i = 0;
  while (out.length < n) {
    const dow = new Date(`${d}T00:00:00.000Z`).getUTCDay(); // 0=Sun
    if (dow === 1 || dow === 4) out.push(d);
    d = addDaysYmd(start, ++i);
  }
  return out;
}

// ── date helpers ──────────────────────────────────────────────────────────

describe("date helpers", () => {
  it("counts days between ymds", () => {
    expect(daysBetweenYmd("2026-08-03", "2026-08-10")).toBe(7);
    expect(daysBetweenYmd("2026-08-10", "2026-08-03")).toBe(-7);
    expect(daysBetweenYmd("2026-08-03", "2026-08-03")).toBe(0);
  });
  it("adds days across a month boundary", () => {
    expect(addDaysYmd("2026-08-30", 3)).toBe("2026-09-02");
  });
});

// ── open set ──────────────────────────────────────────────────────────────

describe("openSetFor", () => {
  it("opens at most openCap units, in track order", () => {
    const units = [unit("U1", 0, 4), unit("U2", 1, 4), unit("U3", 2, 4), unit("U4", 3, 4)];
    const st = { lastGreenDate: new Map(), cursor: new Map() };
    expect(openSetFor(units, st, 3).map((u) => u.unitId)).toEqual([
      "U1",
      "U2",
      "U3",
    ]);
  });

  it("only opens the next unit once an earlier one is exhausted", () => {
    const units = [unit("U1", 0, 4), unit("U2", 1, 4), unit("U3", 2, 4), unit("U4", 3, 4)];
    const st = { lastGreenDate: new Map(), cursor: new Map([["U1", 4]]) };
    expect(openSetFor(units, st, 3).map((u) => u.unitId)).toEqual([
      "U2",
      "U3",
      "U4",
    ]);
  });
});

// ── ranking ───────────────────────────────────────────────────────────────

describe("rankOpenUnits", () => {
  const st = () => ({ lastGreenDate: new Map<string, string>(), cursor: new Map<string, number>() });

  it("puts a never-taught unit first (infinitely stale)", () => {
    const units = [unit("U1", 0, 4), unit("U2", 1, 4)];
    const s = st();
    s.lastGreenDate.set("U1", "2026-08-03");
    const ranked = rankOpenUnits(units, s, "2026-08-06", 21);
    expect(ranked[0].unitId).toBe("U2");
    expect(ranked[0].reason).toBe("new");
    expect(ranked[1].daysSinceGreen).toBe(3);
  });

  it("ranks the stalest unit first", () => {
    const units = [unit("U1", 0, 4), unit("U2", 1, 4), unit("U3", 2, 4)];
    const s = st();
    s.lastGreenDate.set("U1", "2026-08-01");
    s.lastGreenDate.set("U2", "2026-08-08");
    s.lastGreenDate.set("U3", "2026-08-05");
    const ranked = rankOpenUnits(units, s, "2026-08-10", 21);
    expect(ranked.map((r) => r.unitId)).toEqual(["U1", "U3", "U2"]);
    expect(ranked[0].reason).toBe("stale");
  });

  it("breaks staleness ties on weakest group memory", () => {
    const units = [
      unit("U1", 0, 4, { avgR: 0.9 }),
      unit("U2", 1, 4, { avgR: 0.2 }),
    ];
    const s = st();
    s.lastGreenDate.set("U1", "2026-08-03");
    s.lastGreenDate.set("U2", "2026-08-03");
    expect(rankOpenUnits(units, s, "2026-08-06", 21)[0].unitId).toBe("U2");
  });

  it("a near exam beats staleness — the deadline always wins", () => {
    const units = [
      unit("U1", 0, 4), // never taught → maximally stale
      unit("U2", 1, 4, { examDate: "2026-08-14" }),
    ];
    const s = st();
    s.lastGreenDate.set("U2", "2026-08-05");
    const ranked = rankOpenUnits(units, s, "2026-08-06", 21);
    expect(ranked[0].unitId).toBe("U2");
    expect(ranked[0].reason).toBe("deadline");
  });

  it("ignores an exam that has already passed", () => {
    const units = [unit("U1", 0, 4), unit("U2", 1, 4, { examDate: "2026-08-01" })];
    const s = st();
    s.lastGreenDate.set("U1", "2026-07-20");
    s.lastGreenDate.set("U2", "2026-08-05");
    expect(rankOpenUnits(units, s, "2026-08-06", 21)[0].unitId).toBe("U1");
  });
});

// ── the green walk: interleaving, order, truncation ───────────────────────

describe("buildInterleavedPlan — green walk", () => {
  it("takes green in strict book order, never picking leaves out of turn", () => {
    const plan = buildInterleavedPlan(
      baseInput({
        sessionDates: ["2026-08-03"],
        units: [unit("U1", 0, 20)],
        unitsPerSession: 1,
      }),
    );
    const g = plan.sessions[0].greenPicks;
    expect(g).toEqual(["U1g1", "U1g2", "U1g3", "U1g4", "U1g5", "U1g6", "U1g7", "U1g8"]);
  });

  it("splits one session's green across `unitsPerSession` units", () => {
    const plan = buildInterleavedPlan(
      baseInput({
        sessionDates: ["2026-08-03"],
        units: [unit("U1", 0, 20), unit("U2", 1, 20), unit("U3", 2, 20)],
      }),
    );
    const s = plan.sessions[0];
    expect(s.unitIds).toHaveLength(2);
    // 8 questions, nothing due for returns yet → green expands to fill.
    expect(s.greenPicks).toHaveLength(8);
    expect(s.greenPicks.filter((q) => q.startsWith("U1"))).toHaveLength(4);
    expect(s.greenPicks.filter((q) => q.startsWith("U2"))).toHaveLength(4);
  });

  it("resumes a truncated unit in a later session, in order", () => {
    const dates = mondaysAndThursdays("2026-08-03", 4);
    const plan = buildInterleavedPlan(
      baseInput({ sessionDates: dates, units: [unit("U1", 0, 30), unit("U2", 1, 30)] }),
    );
    const u1 = plan.sessions.flatMap((s) =>
      s.greenPicks.filter((q) => q.startsWith("U1")),
    );
    expect(u1.slice(0, 6)).toEqual(["U1g1", "U1g2", "U1g3", "U1g4", "U1g5", "U1g6"]);
  });

  it("INTERLEAVES: the unit rested last session comes back next session", () => {
    const dates = mondaysAndThursdays("2026-08-03", 6);
    const plan = buildInterleavedPlan(
      baseInput({
        sessionDates: dates,
        units: [unit("U1", 0, 40), unit("U2", 1, 40), unit("U3", 2, 40)],
      }),
    );
    // With openCap 3 and 2 units per session, all three units must appear
    // within the first three sessions — none goes cold.
    const touched = new Set(plan.sessions.slice(0, 3).flatMap((s) => s.unitIds));
    expect(touched).toEqual(new Set(["U1", "U2", "U3"]));
    // And every unit keeps receiving green across the horizon.
    for (const u of ["U1", "U2", "U3"]) {
      const sessionsWithU = plan.sessions.filter((s) => s.unitIds.includes(u));
      expect(sessionsWithU.length).toBeGreaterThanOrEqual(3);
    }
  });

  it("opens the next unit only when an open one is exhausted", () => {
    const dates = mondaysAndThursdays("2026-08-03", 8);
    const plan = buildInterleavedPlan(
      baseInput({
        sessionDates: dates,
        units: [unit("U1", 0, 4), unit("U2", 1, 40), unit("U3", 2, 40), unit("U4", 3, 40)],
      }),
    );
    expect(plan.sessions[0].openUnitIds).toEqual(["U1", "U2", "U3"]);
    const last = plan.sessions[plan.sessions.length - 1];
    expect(last.openUnitIds).toContain("U4");
    expect(last.openUnitIds).not.toContain("U1");
  });

  it("flows the budget on when a chosen unit runs dry mid-sheet", () => {
    const plan = buildInterleavedPlan(
      baseInput({
        sessionDates: ["2026-08-03"],
        units: [unit("U1", 0, 1), unit("U2", 1, 2), unit("U3", 2, 20)],
      }),
    );
    const s = plan.sessions[0];
    expect(s.greenPicks).toHaveLength(8);
    expect(s.unitIds).toEqual(["U1", "U2", "U3"]);
  });

  it("serves carry-over leftovers before any green", () => {
    const plan = buildInterleavedPlan(
      baseInput({
        sessionDates: ["2026-08-03"],
        units: [unit("U1", 0, 20)],
        carry: ["carryA", "carryB"],
      }),
    );
    const s = plan.sessions[0];
    expect(s.carryPicks).toEqual(["carryA", "carryB"]);
    expect(s.carryPicks.length + s.greenPicks.length).toBe(8);
  });

  it("never runs past the end of the book", () => {
    const dates = mondaysAndThursdays("2026-08-03", 6);
    const plan = buildInterleavedPlan(
      baseInput({ sessionDates: dates, units: [unit("U1", 0, 5)] }),
    );
    const all = plan.sessions.flatMap((s) => s.greenPicks);
    expect(all).toEqual(["U1g1", "U1g2", "U1g3", "U1g4", "U1g5"]);
    expect(new Set(all).size).toBe(all.length);
    expect(plan.greenLeftover).toBe(0);
  });

  it("reports leftover green the horizon never reached", () => {
    const plan = buildInterleavedPlan(
      baseInput({ sessionDates: ["2026-08-03"], units: [unit("U1", 0, 30)] }),
    );
    expect(plan.greenLeftover).toBe(22);
  });
});

// ── founder overrides ─────────────────────────────────────────────────────

describe("buildInterleavedPlan — per-session overrides", () => {
  it("honours a units-per-session override for one date only", () => {
    const dates = mondaysAndThursdays("2026-08-03", 3);
    const plan = buildInterleavedPlan(
      baseInput({
        sessionDates: dates,
        units: [unit("U1", 0, 40), unit("U2", 1, 40), unit("U3", 2, 40)],
        overrides: new Map([[dates[1], { unitsPerSession: 3 }]]),
      }),
    );
    expect(plan.sessions[0].unitIds).toHaveLength(2);
    expect(plan.sessions[1].unitIds).toHaveLength(3);
    expect(plan.sessions[2].unitIds).toHaveLength(2);
  });

  it("honours a green-count override (the truncate lever)", () => {
    const plan = buildInterleavedPlan(
      baseInput({
        sessionDates: ["2026-08-03"],
        units: [unit("U1", 0, 40), unit("U2", 1, 40)],
        overrides: new Map([["2026-08-03", { greenCount: 3 }]]),
      }),
    );
    expect(plan.sessions[0].greenPicks).toHaveLength(3);
  });

  it("pins explicit units over the staleness ranking", () => {
    const plan = buildInterleavedPlan(
      baseInput({
        sessionDates: ["2026-08-03"],
        units: [unit("U1", 0, 40), unit("U2", 1, 40), unit("U3", 2, 40)],
        overrides: new Map([["2026-08-03", { unitIds: ["U3"] }]]),
      }),
    );
    const s = plan.sessions[0];
    expect(s.unitIds).toEqual(["U3"]);
    expect(s.choices[0].reason).toBe("pinned");
    expect(s.greenPicks.every((q) => q.startsWith("U3"))).toBe(true);
  });

  it("can pin a unit that is not in today's open set", () => {
    const plan = buildInterleavedPlan(
      baseInput({
        sessionDates: ["2026-08-03"],
        units: [
          unit("U1", 0, 40),
          unit("U2", 1, 40),
          unit("U3", 2, 40),
          unit("U4", 3, 40),
        ],
        overrides: new Map([["2026-08-03", { unitIds: ["U4"] }]]),
      }),
    );
    expect(plan.sessions[0].unitIds).toEqual(["U4"]);
  });
});

// ── blue timing ───────────────────────────────────────────────────────────

describe("blueDueDates", () => {
  const blue = (qid: string, conceptIds: string[]): BlueQ => ({
    qid,
    unitId: "U1",
    conceptIds,
    difficulty: 5,
    bookIdx: 0,
  });
  const yellow = (qid: string, conceptIds: string[]): YellowQ => ({
    qid,
    conceptIds,
    difficulty: 3,
    bookIdx: 0,
  });

  it("is due 3 days after its concept's yellow was drilled", () => {
    const { due } = blueDueDates(
      [blue("b1", ["c1"])],
      [yellow("y1", ["c1"])],
      new Map([["y1", "2026-08-06"]]),
      new Map([["c1", "2026-08-03"]]),
      3,
      7,
    );
    expect(due.get("b1")).toBe("2026-08-09");
  });

  it("falls back to intro + 7 when the concept has no yellow at all", () => {
    const { due } = blueDueDates(
      [blue("b1", ["c1"])],
      [],
      new Map(),
      new Map([["c1", "2026-08-03"]]),
      3,
      7,
    );
    expect(due.get("b1")).toBe("2026-08-10");
  });

  it("WAITS forever when its yellow never gets a revision day", () => {
    const { due, waiting } = blueDueDates(
      [blue("b1", ["c1"])],
      [yellow("y1", ["c1"])],
      new Map(), // yellow never scheduled
      new Map([["c1", "2026-08-03"]]),
      3,
      7,
    );
    expect(due.has("b1")).toBe(false);
    expect(waiting).toContain("b1");
  });

  it("waits for the LAST of several concepts", () => {
    const { due } = blueDueDates(
      [blue("b1", ["c1", "c2"])],
      [yellow("y1", ["c1"]), yellow("y2", ["c2"])],
      new Map([
        ["y1", "2026-08-06"],
        ["y2", "2026-08-13"],
      ]),
      new Map([
        ["c1", "2026-08-03"],
        ["c2", "2026-08-03"],
      ]),
      3,
      7,
    );
    expect(due.get("b1")).toBe("2026-08-16");
  });

  it("waits when the concept was never introduced", () => {
    const { due, waiting } = blueDueDates(
      [blue("b1", ["c1"])],
      [],
      new Map(),
      new Map(),
      3,
      7,
    );
    expect(due.has("b1")).toBe(false);
    expect(waiting).toContain("b1");
  });
});

// ── returns: blue takes the budget, spiral tops up ────────────────────────

describe("buildInterleavedPlan — returns block", () => {
  const dates = mondaysAndThursdays("2026-08-03", 8);

  function withBlue(): InterleaveInput {
    return baseInput({
      sessionDates: dates,
      revisionDates: ["2026-08-06", "2026-08-13", "2026-08-20", "2026-08-27"],
      units: [unit("U1", 0, 40), unit("U2", 1, 40)],
      conceptByQid: new Map(
        Array.from({ length: 40 }, (_, i) => [`U1g${i + 1}`, "c1"] as const),
      ),
      yellows: [
        { qid: "y1", conceptIds: ["c1"], difficulty: 3, bookIdx: 1 },
      ],
      blues: Array.from({ length: 12 }, (_, i) => ({
        qid: `b${i + 1}`,
        unitId: "U1",
        conceptIds: ["c1"],
        difficulty: 5,
        bookIdx: i,
      })),
    });
  }

  it("holds blue back until after its concept's yellow is drilled", () => {
    const plan = buildInterleavedPlan(withBlue());
    const yellowDate = plan.yellowDateByQid.get("y1");
    expect(yellowDate).toBeTruthy();
    const firstBlueDate = plan.sessions.find((s) => s.bluePicks.length > 0)?.date;
    expect(firstBlueDate).toBeTruthy();
    expect(firstBlueDate! > yellowDate!).toBe(true);
    expect(daysBetweenYmd(yellowDate!, firstBlueDate!)).toBeGreaterThanOrEqual(3);
  });

  it("never lets blue overflow past the returns share", () => {
    const plan = buildInterleavedPlan(withBlue());
    // 8 questions × 0.35 → 3 reserved returns.
    for (const s of plan.sessions) expect(s.bluePicks.length).toBeLessThanOrEqual(3);
  });

  it("reports a blue backlog rather than eating green", () => {
    const plan = buildInterleavedPlan(withBlue());
    const withBacklog = plan.sessions.filter((s) => s.blueBacklog > 0);
    expect(withBacklog.length).toBeGreaterThan(0);
    // Green never stalls: every session still teaches something new while
    // the backlog drains.
    for (const s of withBacklog) expect(s.greenPicks.length).toBeGreaterThan(0);
  });

  it("gives unused return slots back to green (sheets are never short)", () => {
    const plan = buildInterleavedPlan(
      baseInput({
        sessionDates: ["2026-08-03"],
        units: [unit("U1", 0, 40), unit("U2", 1, 40)],
      }),
    );
    const s = plan.sessions[0];
    expect(s.bluePicks).toHaveLength(0);
    expect(s.spiralPicks).toHaveLength(0);
    expect(s.greenPicks).toHaveLength(8);
  });

  it("tops the returns block up from the spiral pool when blue is short", () => {
    const plan = buildInterleavedPlan(
      baseInput({
        sessionDates: ["2026-08-03"],
        units: [unit("U1", 0, 40)],
        spiral: ["s1", "s2", "s3", "s4", "s5"],
      }),
    );
    const s = plan.sessions[0];
    expect(s.spiralPicks).toEqual(["s1", "s2", "s3"]);
    expect(s.greenPicks).toHaveLength(5);
  });

  it("never serves the same question twice across the term", () => {
    const plan = buildInterleavedPlan(withBlue());
    const all = plan.sessions.flatMap((s) => [
      ...s.carryPicks,
      ...s.greenPicks,
      ...s.bluePicks,
      ...s.spiralPicks,
    ]);
    expect(new Set(all).size).toBe(all.length);
  });

  it("keeps every sheet at the group's Main size while material lasts", () => {
    const plan = buildInterleavedPlan(withBlue());
    for (const s of plan.sessions.slice(0, 5)) {
      const total =
        s.carryPicks.length +
        s.greenPicks.length +
        s.bluePicks.length +
        s.spiralPicks.length;
      expect(total).toBe(8);
    }
  });
});

// ── determinism ───────────────────────────────────────────────────────────

describe("buildInterleavedPlan — determinism", () => {
  it("produces identical output for identical input (forecast = print)", () => {
    const make = () =>
      baseInput({
        sessionDates: mondaysAndThursdays("2026-08-03", 10),
        revisionDates: ["2026-08-06", "2026-08-13", "2026-08-20"],
        units: [unit("U1", 0, 25), unit("U2", 1, 25), unit("U3", 2, 25)],
        conceptByQid: new Map(
          Array.from({ length: 25 }, (_, i) => [`U1g${i + 1}`, "c1"] as const),
        ),
        yellows: [{ qid: "y1", conceptIds: ["c1"], difficulty: 3, bookIdx: 1 }],
        blues: [
          { qid: "b1", unitId: "U1", conceptIds: ["c1"], difficulty: 5, bookIdx: 0 },
        ],
      });
    const a = buildInterleavedPlan(make());
    const b = buildInterleavedPlan(make());
    expect(JSON.stringify(a.sessions)).toBe(JSON.stringify(b.sessions));
  });
});
