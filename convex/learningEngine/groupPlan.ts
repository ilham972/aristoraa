// Group Main department (departments redesign, 2026-07-14).
//
// The Main block of a group session is ONE identical sheet for the whole
// roster, planned at GROUP level:
//   bookmark  — derived union of question ids across the group's groupSheets
//               rows and the members' generatedSheets. "Next" always means
//               the next unseen-for-the-group question, easy→hard, in the
//               current unit of the group's track.
//   skeleton  — the lesson plan to exam day (pure math in
//               lib/groupPlanCore.ts): which unit each upcoming session
//               teaches + projected finish vs exam date per unit. Live
//               query, never stored — it self-corrects as reality happens.
//   crystallize — writes question-level groupSheets rows for sessions within
//               GROUP_CRYSTALLIZE_AHEAD_DAYS: new-unit ladder picks + spiral
//               review picks from past units (weakest group-average memory
//               first — the reactive part of the plan).
//   materialize — at session time the Sheets tab generates ordinary
//               per-student sheets from the row via mainQuestionIdsOverride
//               (existing planner path), so PDF/scoring/memory are untouched.
//
// No difficulty cap on Main picks: the Main teacher TEACHES this sheet, so
// the hard tail of a unit belongs here (unlike individual revision, where
// the per-student ladder defers questions >skill+2).

import { internalMutation, mutation, query } from "../_generated/server";
import { v } from "convex/values";
import type { GenericMutationCtx, GenericQueryCtx } from "convex/server";
import type { DataModel, Doc, Id } from "../_generated/dataModel";
import { questionsTaggedToConcept } from "./derivedConcepts";
import { masteryFromState } from "./mastery";
import {
  DEFAULT_QUESTION_DIFFICULTY,
  GROUP_CRYSTALLIZE_AHEAD_DAYS,
  GROUP_MAIN_QUESTIONS_DEFAULT,
  GROUP_PASTPAPER_TAIL_MAX,
  GROUP_SKELETON_HORIZON_DAYS,
  GROUP_SPIRAL_SHARE,
  REVISION_QUEUE_CAP,
} from "./config";
import {
  buildGroupSkeleton,
  type SkeletonUnitInput,
} from "../lib/groupPlanCore";

type QueryCtx = GenericQueryCtx<DataModel>;
type MutationCtx = GenericMutationCtx<DataModel>;
type ReadCtx = QueryCtx | MutationCtx;

const MS_PER_DAY = 86_400_000;

function ymdFromMs(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

// Day-of-week for a YYYY-MM-DD, app convention 1=Mon..7=Sun.
function dowFromYmd(ymd: string): number {
  const d = new Date(`${ymd}T00:00:00.000Z`).getUTCDay(); // 0=Sun..6=Sat
  return d === 0 ? 7 : d;
}

function termFromUnitId(unitId: string): number | null {
  const m = /^M\d+-G\d+-T(\d+)-\d+$/.exec(unitId);
  return m ? Number(m[1]) : null;
}

async function resolveTeacherId(
  ctx: MutationCtx,
): Promise<Id<"teachers"> | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  const rows = await ctx.db
    .query("teachers")
    .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", identity.subject))
    .collect();
  if (rows.length === 0) return null;
  return rows.reduce((a, b) => (a._creationTime <= b._creationTime ? a : b))._id;
}

// ── Group resolution helpers ──────────────────────────────────────────────

export async function groupMemberStudents(
  ctx: ReadCtx,
  groupId: Id<"groups">,
): Promise<Doc<"students">[]> {
  const members = await ctx.db
    .query("groupMembers")
    .withIndex("by_group", (q) => q.eq("groupId", groupId))
    .collect();
  const docs = await Promise.all(members.map((m) => ctx.db.get(m.studentId)));
  return docs.filter((s): s is Doc<"students"> => s !== null);
}

// The track the GROUP rides: the majority track among members (ties broken
// by most members, then track level via _id stability). Null when no member
// has a track — the group plan requires tracks (the Main block is track-
// driven since the exam-mode change).
export async function resolveTrackForGroup(
  ctx: ReadCtx,
  students: Doc<"students">[],
): Promise<Doc<"tracks"> | null> {
  const counts = new Map<string, { id: Id<"tracks">; n: number }>();
  for (const s of students) {
    if (!s.trackId) continue;
    const k = s.trackId as unknown as string;
    const cur = counts.get(k);
    counts.set(k, { id: s.trackId, n: (cur?.n ?? 0) + 1 });
  }
  let best: { id: Id<"tracks">; n: number } | null = null;
  counts.forEach((c) => {
    if (!best || c.n > best.n) best = c;
  });
  if (!best) return null;
  return await ctx.db.get((best as { id: Id<"tracks">; n: number }).id);
}

// The group bookmark: every question id the group has consumed — its own
// groupSheets rows (any status: planned rows hold future claims) plus every
// question on any current member's generatedSheets (legacy transition floor:
// don't re-teach what the roster already did in per-student mode).
async function groupSeenSet(
  ctx: ReadCtx,
  groupId: Id<"groups">,
  students: Doc<"students">[],
): Promise<Set<string>> {
  const seen = new Set<string>();
  const gs = await ctx.db
    .query("groupSheets")
    .withIndex("by_group_date", (q) => q.eq("groupId", groupId))
    .collect();
  for (const row of gs) {
    for (const qid of row.newQuestionIds) seen.add(qid as unknown as string);
    for (const qid of row.spiralQuestionIds) seen.add(qid as unknown as string);
  }
  const perStudent = await Promise.all(
    students.map((s) =>
      ctx.db
        .query("generatedSheets")
        .withIndex("by_student_date", (q) => q.eq("studentId", s._id))
        .collect(),
    ),
  );
  for (const sheets of perStudent) {
    for (const sh of sheets) {
      for (const qid of sh.warmupQuestionIds) seen.add(qid as unknown as string);
      for (const qid of sh.mainQuestionIds) seen.add(qid as unknown as string);
      for (const qid of sh.revisionQuestionIds ?? [])
        seen.add(qid as unknown as string);
      for (const qid of sh.examPrepQuestionIds)
        seen.add(qid as unknown as string);
    }
  }
  return seen;
}

// Per-unit ladders along the track: TEXTBOOK questions in teacher order
// (difficulty, then Lesson Builder drag order, then id), then a capped
// PAST-PAPER tail (founder decision: finish the book first; when a unit's
// book runs out, past-paper questions on the same concepts flow in — the
// daily scan alerts when the current unit crosses that boundary). Also
// returns the question→concept map (spiral ranking needs it).
type UnitLadder = {
  unitId: string;
  ladder: Array<{
    qid: string;
    difficulty: number;
    pickerOrder: number;
    pastPaper: boolean;
  }>;
  conceptByQuestion: Map<string, string>;
};

async function buildUnitLadders(
  ctx: ReadCtx,
  orderedUnitIds: string[],
): Promise<UnitLadder[]> {
  return Promise.all(
    orderedUnitIds.map(async (unitId) => {
    const exRows = await ctx.db
      .query("exercises")
      .withIndex("by_unit", (q) => q.eq("unitId", unitId))
      .collect();
    const conceptByQuestion = new Map<string, string>();
    const qids = new Set<string>();
    const conceptRows = exRows.filter((row) => row.type === "concept");
    const taggedPerConcept = await Promise.all(
      conceptRows.map((row) => questionsTaggedToConcept(ctx, row._id)),
    );
    conceptRows.forEach((row, i) => {
      for (const qid of taggedPerConcept[i]) {
        const k = qid as unknown as string;
        if (!qids.has(k)) {
          qids.add(k);
          conceptByQuestion.set(k, row._id as unknown as string);
        }
      }
    });
    type Rung = {
      qid: string;
      difficulty: number;
      pickerOrder: number;
      pastPaper: boolean;
    };
    const book: Rung[] = [];
    const paper: Rung[] = [];
    const qidList = Array.from(qids);
    const qDocs = await Promise.all(
      qidList.map((k) => ctx.db.get(k as unknown as Id<"questionBank">)),
    );
    qidList.forEach((k, i) => {
      const q = qDocs[i];
      if (!q) return;
      const rung: Rung = {
        qid: k,
        difficulty: q.difficulty ?? DEFAULT_QUESTION_DIFFICULTY,
        pickerOrder: q.pickerOrder ?? Number.MAX_SAFE_INTEGER,
        pastPaper: q.source === "past-paper",
      };
      (rung.pastPaper ? paper : book).push(rung);
    });
    const byLadder = (a: Rung, b: Rung) =>
      a.difficulty - b.difficulty ||
      a.pickerOrder - b.pickerOrder ||
      (a.qid < b.qid ? -1 : 1);
    book.sort(byLadder);
    paper.sort(byLadder);
    return {
      unitId,
      ladder: [...book, ...paper.slice(0, GROUP_PASTPAPER_TAIL_MAX)],
      conceptByQuestion,
    };
    }),
  );
}

// Upcoming MAIN session dates for the group: weekly slots expanded over the
// horizon, deduped by date (fused/back-to-back slots = one session), sorted.
// Revision-type slots are the Revision department's time — they never carry
// group sheets, so they're excluded from the skeleton.
async function upcomingSessionDates(
  ctx: ReadCtx,
  groupId: Id<"groups">,
  fromYmd: string,
  horizonDays: number,
): Promise<Array<{ date: string; slotId: Id<"scheduleSlots"> }>> {
  const allSlots = await ctx.db
    .query("scheduleSlots")
    .withIndex("by_group", (q) => q.eq("groupId", groupId))
    .collect();
  const slots = allSlots.filter((s) => (s.sessionType ?? "main") === "main");
  if (slots.length === 0) return [];
  const byDow = new Map<number, Id<"scheduleSlots">>();
  for (const s of slots) {
    const cur = byDow.get(s.dayOfWeek);
    // Earliest slot of the day represents the (possibly fused) session.
    if (!cur) byDow.set(s.dayOfWeek, s._id);
    else {
      const curDoc = slots.find((x) => x._id === cur)!;
      if (s.startTime < curDoc.startTime) byDow.set(s.dayOfWeek, s._id);
    }
  }
  const startMs = Date.parse(`${fromYmd}T00:00:00.000Z`);
  const candidates: Array<{ date: string; slotId: Id<"scheduleSlots"> }> = [];
  for (let i = 0; i < horizonDays; i++) {
    const ymd = ymdFromMs(startMs + i * MS_PER_DAY);
    const slotId = byDow.get(dowFromYmd(ymd));
    if (slotId) candidates.push({ date: ymd, slotId });
  }
  // Cancellation-aware (2026-07-15): a session logged cancelled_by_tutor is
  // not a teaching day — the skeleton flows past it (so the whole plan
  // shifts the moment a class is cancelled) and crystallize never writes a
  // sheet onto it. Bulk cancel logs every slot of the day, so checking the
  // representative (earliest, = fused session) slot is sufficient.
  const cancelled = await cancelledDates(ctx, candidates);
  return candidates.filter((c) => !cancelled.has(c.date));
}

// Which of the given (date, slotId) sessions carry a cancelled_by_tutor log.
async function cancelledDates(
  ctx: ReadCtx,
  sessions: Array<{ date: string; slotId: Id<"scheduleSlots"> }>,
): Promise<Set<string>> {
  const logs = await Promise.all(
    sessions.map((c) =>
      ctx.db
        .query("sessionLogs")
        .withIndex("by_slot_date", (q) =>
          q.eq("slotId", c.slotId).eq("date", c.date),
        )
        .collect(),
    ),
  );
  const out = new Set<string>();
  sessions.forEach((c, i) => {
    if (logs[i].some((l) => l.status === "cancelled_by_tutor")) out.add(c.date);
  });
  return out;
}

// Group-average retrievability per concept: the average over ALL members
// (a member with no memory row counts 0 — if half the group never met the
// concept, the group needs the review). Drives spiral ranking.
async function groupAvgRByConcept(
  ctx: ReadCtx,
  students: Doc<"students">[],
  asOfMs: number,
): Promise<Map<string, number>> {
  const sums = new Map<string, number>();
  const perStudent = await Promise.all(
    students.map((s) =>
      ctx.db
        .query("memoryState")
        .withIndex("by_student", (q) => q.eq("studentId", s._id))
        .collect(),
    ),
  );
  for (const states of perStudent) {
    for (const st of states) {
      const k = st.conceptExerciseId as unknown as string;
      sums.set(k, (sums.get(k) ?? 0) + masteryFromState(st, asOfMs).R);
    }
  }
  const n = Math.max(1, students.length);
  const avg = new Map<string, number>();
  sums.forEach((sum, k) => avg.set(k, sum / n));
  return avg;
}

// ── Shared planning walk (query + crystallize use the same math) ──────────

type GroupPlanState = {
  students: Doc<"students">[];
  track: Doc<"tracks">;
  seen: Set<string>;
  ladders: UnitLadder[];
  sessions: Array<{ date: string; slotId: Id<"scheduleSlots"> }>;
  examDateByTerm: Record<number, string>;
  crystallized: Doc<"groupSheets">[];
  // Units the founder marked "taught before the app" (groupPreTaughtUnits):
  // every ladder question of these is folded into `seen`, so the walk,
  // crystallize, spiral pool and capacity math all skip them. Kept as a set
  // too so the verdict can read "done" even for a marked unit with no book.
  preTaughtUnitIds: Set<string>;
  // Questions the founder UNTICKED in the unit-curation dialog
  // (groupUnitBans): banned from the plan. The pick queues skip them and
  // the skeleton doesn't count them as demand — but they are NOT "seen":
  // coverage shows them as excluded, never as covered.
  banned: Set<string>;
  // Questions per Main session — the group's own override, else the default.
  mainSize: number;
  // Unconsumed "carry to next Main" leftovers (oldest first): the next
  // crystallize serves these BEFORE the ladder, then stamps them consumed.
  mainCarry: Doc<"groupCarryOvers">[];
};

async function loadGroupPlanState(
  ctx: ReadCtx,
  groupId: Id<"groups">,
  todayYmd: string,
): Promise<
  | { status: "no-members" | "no-track" | "no-sessions" }
  | { status: "ok"; state: GroupPlanState }
> {
  const students = await groupMemberStudents(ctx, groupId);
  if (students.length === 0) return { status: "no-members" };
  const track = await resolveTrackForGroup(ctx, students);
  if (!track) return { status: "no-track" };
  const sessions = await upcomingSessionDates(
    ctx,
    groupId,
    todayYmd,
    GROUP_SKELETON_HORIZON_DAYS,
  );
  if (sessions.length === 0) return { status: "no-sessions" };
  const seen = await groupSeenSet(ctx, groupId, students);
  const ladders = await buildUnitLadders(ctx, track.orderedUnitIds);

  // Pre-app starting point: fold every ladder question of a marked unit into
  // the seen-set. From here the whole plan treats those units as covered.
  const preTaughtUnitIds = new Set(
    (
      await ctx.db
        .query("groupPreTaughtUnits")
        .withIndex("by_group", (q) => q.eq("groupId", groupId))
        .collect()
    ).map((r) => r.unitId),
  );
  if (preTaughtUnitIds.size > 0) {
    for (const l of ladders) {
      if (preTaughtUnitIds.has(l.unitId)) {
        for (const rung of l.ladder) seen.add(rung.qid);
      }
    }
  }

  const examRows = await ctx.db
    .query("examCalendar")
    .withIndex("by_grade", (q) => q.eq("grade", track.targetGrade))
    .collect();
  const examDateByTerm: Record<number, string> = {};
  for (const row of examRows) {
    if (row.examDate < todayYmd) continue;
    const cur = examDateByTerm[row.term];
    if (cur === undefined || row.examDate < cur) {
      examDateByTerm[row.term] = row.examDate;
    }
  }

  const crystallized = await ctx.db
    .query("groupSheets")
    .withIndex("by_group_date", (q) =>
      q.eq("groupId", groupId).gte("date", todayYmd),
    )
    .collect();

  const group = await ctx.db.get(groupId);
  const mainSize = Math.max(
    1,
    Math.round(group?.mainQuestionsPerSession ?? GROUP_MAIN_QUESTIONS_DEFAULT),
  );

  // Unit-curation bans: unticked questions, excluded from the whole plan.
  // A question that got taught anyway (seen) stays seen — seen wins.
  const banned = new Set<string>();
  for (const row of await ctx.db
    .query("groupUnitBans")
    .withIndex("by_group", (q) => q.eq("groupId", groupId))
    .collect()) {
    for (const qid of row.questionIds) banned.add(qid as unknown as string);
  }

  const mainCarry = (
    await ctx.db
      .query("groupCarryOvers")
      .withIndex("by_group", (q) => q.eq("groupId", groupId))
      .collect()
  )
    .filter((r) => r.target === "main" && r.consumedAt === undefined)
    .sort((a, b) => a.createdAt - b.createdAt);

  return {
    status: "ok",
    state: {
      students,
      track,
      seen,
      ladders,
      sessions,
      examDateByTerm,
      crystallized,
      preTaughtUnitIds,
      banned,
      mainSize,
      mainCarry,
    },
  };
}

function skeletonInputs(state: GroupPlanState): {
  units: SkeletonUnitInput[];
  currentUnitIdx: number;
} {
  // Carry-over leftovers are SEEN (they were on a printed sheet) but must be
  // re-taught, so they re-enter the demand of their unit here — the skeleton,
  // calendar and exam-capacity math all count them automatically.
  const carryByUnit = new Map<string, number>();
  for (const r of state.mainCarry) {
    carryByUnit.set(
      r.unitId,
      (carryByUnit.get(r.unitId) ?? 0) + r.questionIds.length,
    );
  }
  // Banned (unticked) questions are out of the plan entirely: not demand,
  // not part of the unit's total. seen-but-banned still counts as covered.
  const units: SkeletonUnitInput[] = state.ladders.map((l) => ({
    unitId: l.unitId,
    term: termFromUnitId(l.unitId),
    unseenCount:
      l.ladder.filter((q) => !state.seen.has(q.qid) && !state.banned.has(q.qid))
        .length + (carryByUnit.get(l.unitId) ?? 0),
    totalCount:
      l.ladder.filter((q) => state.seen.has(q.qid) || !state.banned.has(q.qid))
        .length + (carryByUnit.get(l.unitId) ?? 0),
    preTaught: state.preTaughtUnitIds.has(l.unitId),
  }));
  let currentUnitIdx = units.findIndex((u) => u.unseenCount > 0);
  if (currentUnitIdx < 0) currentUnitIdx = units.length;
  return { units, currentUnitIdx };
}

// ── The lesson-plan query (skeleton + crystallized rows merged) ───────────

export const groupLessonPlan = query({
  args: { groupId: v.id("groups") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const todayYmd = ymdFromMs(Date.now());
    const loaded = await loadGroupPlanState(ctx, args.groupId, todayYmd);
    if (loaded.status !== "ok") return { status: loaded.status };
    const state = loaded.state;
    const { units, currentUnitIdx } = skeletonInputs(state);

    const skeleton = buildGroupSkeleton({
      sessionDates: state.sessions.map((s) => s.date),
      units,
      mainQuestionsPerSession: state.mainSize,
      spiralShare: GROUP_SPIRAL_SHARE,
      examDateByTerm: state.examDateByTerm,
      anyPastUnitStarted: currentUnitIdx > 0,
    });

    const crystallizedByDate = new Map(
      state.crystallized.map((c) => [c.date, c]),
    );
    const slotByDate = new Map(state.sessions.map((s) => [s.date, s.slotId]));

    // ── Capacity plan vs the nearest exam (Term tab, 2026-07-15) ─────────
    // The founder plans by REQUIRED capacity, not observed pace: demand =
    // every unseen question the track-order walk must serve before the
    // nearest exam (unfinished earlier units included — the walk cannot
    // skip them, only delegation can), capacity = remaining sessions ×
    // new-questions throughput. When short, the gap is returned in the
    // units the founder can act on: extra sessions, or backlog questions
    // to delegate to Revision.
    const upcomingExamDates = Object.values(state.examDateByTerm).sort();
    const nearestExam = upcomingExamDates[0] ?? null;
    let examPlan: {
      examDate: string;
      daysToExam: number;
      sessionsLeft: number;
      newPerSession: number;
      capacity: number;
      demandTotal: number;
      demandExamTerm: number;
      demandBacklog: number;
      shortBy: number;
      extraSessionsNeeded: number;
      spare: number;
      fits: boolean;
    } | null = null;
    if (nearestExam) {
      const mainSize = state.mainSize;
      const spiralCount =
        currentUnitIdx > 0
          ? Math.min(mainSize - 1, Math.round(mainSize * GROUP_SPIRAL_SHARE))
          : 0;
      const newPerSession = Math.max(1, mainSize - spiralCount);
      const sessionsLeft = state.sessions.filter(
        (s) => s.date <= nearestExam,
      ).length;
      // Everything the walk must serve before this exam: units up to the
      // LAST unit whose exam is on or before it (track order).
      let lastDueIdx = -1;
      skeleton.units.forEach((u, i) => {
        if (u.examDate !== null && u.examDate <= nearestExam) lastDueIdx = i;
      });
      let demandTotal = 0;
      let demandExamTerm = 0;
      skeleton.units.forEach((u, i) => {
        if (i > lastDueIdx) return;
        demandTotal += u.unseenCount;
        if (u.examDate !== null && u.examDate <= nearestExam) {
          demandExamTerm += u.unseenCount;
        }
      });
      const capacity = sessionsLeft * newPerSession;
      const shortBy = Math.max(0, demandTotal - capacity);
      examPlan = {
        examDate: nearestExam,
        daysToExam: Math.round(
          (Date.parse(`${nearestExam}T00:00:00.000Z`) -
            Date.parse(`${todayYmd}T00:00:00.000Z`)) /
            MS_PER_DAY,
        ),
        sessionsLeft,
        newPerSession,
        capacity,
        demandTotal,
        demandExamTerm,
        demandBacklog: demandTotal - demandExamTerm,
        shortBy,
        extraSessionsNeeded: Math.ceil(shortBy / newPerSession),
        spare: Math.max(0, capacity - demandTotal),
        fits: shortBy === 0,
      };
    }

    return {
      status: "ok" as const,
      examPlan,
      trackId: state.track._id,
      trackName: state.track.name,
      memberCount: state.students.length,
      currentUnitId:
        currentUnitIdx < units.length ? units[currentUnitIdx].unitId : null,
      crystallizeAheadDays: GROUP_CRYSTALLIZE_AHEAD_DAYS,
      mainQuestionsPerSession: state.mainSize,
      sessions: skeleton.sessions.map((s) => {
        const c = crystallizedByDate.get(s.date);
        return {
          ...s,
          slotId: slotByDate.get(s.date) ?? null,
          crystallized: c
            ? {
                id: c._id,
                status: c.status,
                unitId: c.unitId,
                newCount: c.newQuestionIds.length,
                spiralCount: c.spiralQuestionIds.length,
              }
            : null,
        };
      }),
      units: skeleton.units,
    };
  },
});

// ── Crystallize: write question-level rows for the rolling window ─────────

// Shared pick sources for crystallize + resize. Spiral pool = unseen
// questions from units BEFORE the current one, weakest group-average memory
// first. New queue = carry-over leftovers FIRST (already seen — printed once
// but not done — so the ladder walk can't re-pick them), then the unseen
// ladder from the current unit onward, in track order.
async function buildPickQueues(
  ctx: ReadCtx,
  state: GroupPlanState,
  currentUnitIdx: number,
  now: number,
): Promise<{
  spiralPool: Array<{ qid: string; r: number; idx: number }>;
  newQueue: Array<{ qid: string; unitId: string }>;
  carryItems: Array<{ qid: string; unitId: string }>;
}> {
  const avgR = await groupAvgRByConcept(ctx, state.students, now);
  const spiralPool: Array<{ qid: string; r: number; idx: number }> = [];
  for (let i = 0; i < Math.min(currentUnitIdx, state.ladders.length); i++) {
    const l = state.ladders[i];
    l.ladder.forEach((q, idx) => {
      if (state.seen.has(q.qid) || state.banned.has(q.qid)) return;
      const concept = l.conceptByQuestion.get(q.qid);
      spiralPool.push({
        qid: q.qid,
        r: concept ? (avgR.get(concept) ?? 0) : 0,
        idx: i * 10_000 + idx,
      });
    });
  }
  spiralPool.sort((a, b) => a.r - b.r || a.idx - b.idx);

  const newQueue: Array<{ qid: string; unitId: string }> = [];
  for (let i = currentUnitIdx; i < state.ladders.length; i++) {
    const l = state.ladders[i];
    for (const q of l.ladder) {
      if (!state.seen.has(q.qid) && !state.banned.has(q.qid))
        newQueue.push({ qid: q.qid, unitId: l.unitId });
    }
  }
  const carryItems: Array<{ qid: string; unitId: string }> = [];
  const queuedIds = new Set(newQueue.map((i) => i.qid));
  for (const row of state.mainCarry) {
    for (const qid of row.questionIds) {
      const k = qid as unknown as string;
      if (queuedIds.has(k)) continue;
      queuedIds.add(k);
      carryItems.push({ qid: k, unitId: row.unitId });
    }
  }
  newQueue.unshift(...carryItems);
  return { spiralPool, newQueue, carryItems };
}


export const crystallizeUpcoming = mutation({
  args: {
    groupId: v.id("groups"),
    daysAhead: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    const teacherId = await resolveTeacherId(ctx);
    const now = Date.now();
    const todayYmd = ymdFromMs(now);
    // Cap = the full skeleton horizon (founder decision 2026-07-15: the
    // whole term is prebuilt from the Sheets tab; planned rows stay
    // re-pickable until materialized, so difficulty re-orders never strand
    // them — "Re-plan future" refreshes the lot).
    const horizon = Math.min(
      Math.max(1, Math.round(args.daysAhead ?? GROUP_CRYSTALLIZE_AHEAD_DAYS)),
      GROUP_SKELETON_HORIZON_DAYS,
    );
    const lastYmd = ymdFromMs(now + horizon * MS_PER_DAY);

    const loaded = await loadGroupPlanState(ctx, args.groupId, todayYmd);
    if (loaded.status !== "ok") return { status: loaded.status, written: 0 };
    const state = loaded.state;
    const { currentUnitIdx } = skeletonInputs(state);

    // Sessions inside the window that have no row yet.
    const have = new Set(state.crystallized.map((c) => c.date));
    const targets = state.sessions.filter(
      (s) => s.date <= lastYmd && !have.has(s.date),
    );
    if (targets.length === 0)
      return {
        status: "ok" as const,
        written: 0,
        exhausted: false,
        unplannedSessions: 0,
      };

    const { spiralPool, newQueue, carryItems } = await buildPickQueues(
      ctx,
      state,
      currentUnitIdx,
      now,
    );
    let spiralCursor = 0;
    let newCursor = 0;

    const mainSize = state.mainSize;
    let written = 0;
    let spiralActive = currentUnitIdx > 0;
    for (const s of targets) {
      if (newCursor >= newQueue.length && spiralCursor >= spiralPool.length)
        break; // book fully consumed
      const spiralCount = spiralActive
        ? Math.min(mainSize - 1, Math.round(mainSize * GROUP_SPIRAL_SHARE))
        : 0;
      const newCount = mainSize - spiralCount;

      const newPicks: Id<"questionBank">[] = [];
      let primaryUnitId: string | null = null;
      let lastUnitId: string | null = null;
      while (newPicks.length < newCount && newCursor < newQueue.length) {
        const item = newQueue[newCursor++];
        newPicks.push(item.qid as unknown as Id<"questionBank">);
        if (primaryUnitId === null) primaryUnitId = item.unitId;
        if (lastUnitId !== null && lastUnitId !== item.unitId) {
          spiralActive = true; // crossed a unit boundary mid-window
        }
        lastUnitId = item.unitId;
      }
      const spiralPicks: Id<"questionBank">[] = [];
      while (spiralPicks.length < spiralCount && spiralCursor < spiralPool.length) {
        spiralPicks.push(
          spiralPool[spiralCursor++].qid as unknown as Id<"questionBank">,
        );
      }
      if (newPicks.length === 0 && spiralPicks.length === 0) break;

      await ctx.db.insert("groupSheets", {
        groupId: args.groupId,
        slotId: s.slotId,
        date: s.date,
        unitId: primaryUnitId ?? state.ladders[currentUnitIdx]?.unitId ?? "",
        newQuestionIds: newPicks,
        spiralQuestionIds: spiralPicks,
        status: "planned",
        createdAt: now,
        createdByTeacherId: teacherId ?? undefined,
      });
      written += 1;
    }

    // Consume the carry rows whose questions just landed on sheets. Carry
    // items sit at the FRONT of the queue, so the first `newCursor` items
    // cover them in row order; a partially-placed row keeps its unplaced
    // remainder for the next crystallize.
    if (written > 0 && carryItems.length > 0) {
      const placed = Math.min(newCursor, carryItems.length);
      let covered = 0;
      for (const row of state.mainCarry) {
        if (covered >= placed) break;
        const n = row.questionIds.length;
        if (covered + n <= placed) {
          await ctx.db.patch(row._id, { consumedAt: now });
        } else {
          await ctx.db.patch(row._id, {
            questionIds: row.questionIds.slice(placed - covered),
          });
        }
        covered += n;
      }
    }
    // The founder must know when the run stopped because the QUESTION BANK
    // ran dry (book entry hasn't reached the later units) rather than
    // because the term is fully planned — the old toast lied "whole term
    // planned" in exactly that case (2026-07-15 bug).
    const exhausted =
      written < targets.length &&
      newCursor >= newQueue.length &&
      spiralCursor >= spiralPool.length;
    return {
      status: "ok" as const,
      written,
      exhausted,
      unplannedSessions: targets.length - written,
    };
  },
});

// ── Session-time lookups + lifecycle ──────────────────────────────────────

// The group-plan context for a session, resolved from the slot. Non-null for
// EVERY group-owned slot (so the Sheets tab can always link to the plan
// page); `sheet` is set only when a crystallized group sheet exists for this
// date — then "Generate all" materializes it as the identical Main block for
// every roster member.
export const plannedGroupSheetForSlotDate = query({
  args: { slotId: v.id("scheduleSlots"), dateStr: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const slot = await ctx.db.get(args.slotId);
    if (!slot?.groupId) return null;
    const rows = await ctx.db
      .query("groupSheets")
      .withIndex("by_group_date", (q) =>
        q.eq("groupId", slot.groupId!).eq("date", args.dateStr),
      )
      .collect();
    const row = rows.find((r) => r.status !== "delegated") ?? null;
    return {
      groupId: slot.groupId,
      sheet: row
        ? {
            id: row._id,
            status: row.status,
            unitId: row.unitId,
            questionIds: [...row.newQuestionIds, ...row.spiralQuestionIds],
            newCount: row.newQuestionIds.length,
            spiralCount: row.spiralQuestionIds.length,
          }
        : null,
    };
  },
});

export const markMaterialized = mutation({
  args: { groupSheetId: v.id("groupSheets") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    const row = await ctx.db.get(args.groupSheetId);
    if (!row) throw new Error("Group sheet not found");
    if (row.status === "delegated")
      throw new Error("Sheet was delegated to the Revision department");
    await ctx.db.patch(args.groupSheetId, {
      status: "materialized",
      materializedAt: Date.now(),
    });
  },
});

// Delete a still-planned row so Crystallize can re-plan it (e.g. after the
// teacher edits the book order or the roster changes).
export const deletePlanned = mutation({
  args: { groupSheetId: v.id("groupSheets") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    const row = await ctx.db.get(args.groupSheetId);
    if (!row) return;
    if (row.status !== "planned")
      throw new Error(`Only planned sheets can be deleted (status: ${row.status})`);
    if (row.pdfPreviewStorageId) {
      try {
        await ctx.storage.delete(row.pdfPreviewStorageId);
      } catch {
        // ignore — preview blob already gone
      }
    }
    await ctx.db.delete(args.groupSheetId);
    // Give back any carry-overs this sheet had absorbed: rows fully contained
    // in the deleted sheet's questions become live again, so the leftovers
    // aren't silently lost with the un-plan.
    const rowIds = new Set(
      [...row.newQuestionIds, ...row.spiralQuestionIds].map(
        (q) => q as unknown as string,
      ),
    );
    const carries = await ctx.db
      .query("groupCarryOvers")
      .withIndex("by_group", (q) => q.eq("groupId", row.groupId))
      .collect();
    for (const c of carries) {
      if (c.target !== "main" || c.consumedAt === undefined) continue;
      if (c.questionIds.every((q) => rowIds.has(q as unknown as string))) {
        await ctx.db.patch(c._id, { consumedAt: undefined });
      }
    }
  },
});

// ── Planner tuning levers (2026-07-15) ────────────────────────────────────

// Per-group Main-sheet size — the "this group can take more/less per class"
// lever. Every projection (skeleton, calendar, exam capacity) uses it live.
export const setGroupMainQuestions = mutation({
  args: { groupId: v.id("groups"), count: v.number() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    const group = await ctx.db.get(args.groupId);
    if (!group) throw new Error("Group not found");
    const count = Math.min(15, Math.max(3, Math.round(args.count)));
    await ctx.db.patch(args.groupId, { mainQuestionsPerSession: count });
    return { count };
  },
});

// Group starting point (2026-07-15): mark every track unit up to and
// including `throughUnitId` as "taught before the app", clearing any marks
// beyond it — one tap sets where a cold-started group actually begins.
// `throughUnitId: null` clears every mark (start from the beginning). Pure
// planning bookmark: loadGroupPlanState folds these units' questions into
// the seen-set, so the whole group plan skips them; nothing touches sheets,
// points, memory or per-student surfaces. Fully reversible.
export const setGroupStartingPoint = mutation({
  args: {
    groupId: v.id("groups"),
    throughUnitId: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    const teacherId = await resolveTeacherId(ctx);

    const students = await groupMemberStudents(ctx, args.groupId);
    const track = await resolveTrackForGroup(ctx, students);
    if (!track)
      throw new Error(
        "This group has no track yet — assign tracks before setting a starting point.",
      );

    // Desired marked set = track units in order, up to and including the
    // chosen one. null → nothing marked.
    let desired: Set<string>;
    if (args.throughUnitId === null) {
      desired = new Set();
    } else {
      const idx = track.orderedUnitIds.indexOf(args.throughUnitId);
      if (idx < 0)
        throw new Error("That unit is not on this group's track.");
      desired = new Set(track.orderedUnitIds.slice(0, idx + 1));
    }

    const existing = await ctx.db
      .query("groupPreTaughtUnits")
      .withIndex("by_group", (q) => q.eq("groupId", args.groupId))
      .collect();
    const existingByUnit = new Map(existing.map((r) => [r.unitId, r]));
    const now = Date.now();

    for (const row of existing) {
      if (!desired.has(row.unitId)) await ctx.db.delete(row._id);
    }
    for (const unitId of Array.from(desired)) {
      if (existingByUnit.has(unitId)) continue;
      await ctx.db.insert("groupPreTaughtUnits", {
        groupId: args.groupId,
        unitId,
        createdAt: now,
        createdByTeacherId: teacherId ?? undefined,
      });
    }
    return { marked: desired.size };
  },
});

// Re-pick ONE planned sheet with a different question count (the founder's
// "change tomorrow's sheet only" case). Deletes the row, then re-picks that
// date from the fresh bookmark — carry-overs first, same walk as crystallize.
export const resizePlanned = mutation({
  args: { groupSheetId: v.id("groupSheets"), count: v.number() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    const teacherId = await resolveTeacherId(ctx);
    const row = await ctx.db.get(args.groupSheetId);
    if (!row) throw new Error("Group sheet not found");
    if (row.status !== "planned")
      throw new Error(`Only planned sheets can be resized (status: ${row.status})`);
    const size = Math.min(20, Math.max(1, Math.round(args.count)));
    const now = Date.now();
    const todayYmd = ymdFromMs(now);

    if (row.pdfPreviewStorageId) {
      try {
        await ctx.storage.delete(row.pdfPreviewStorageId);
      } catch {
        // ignore — preview blob already gone
      }
    }
    await ctx.db.delete(args.groupSheetId);
    const loaded = await loadGroupPlanState(ctx, row.groupId, todayYmd);
    if (loaded.status !== "ok") return { status: loaded.status };
    const state = loaded.state;
    const { currentUnitIdx } = skeletonInputs(state);
    const { spiralPool, newQueue, carryItems } = await buildPickQueues(
      ctx,
      state,
      currentUnitIdx,
      now,
    );

    const spiralCount =
      currentUnitIdx > 0
        ? Math.min(size - 1, Math.round(size * GROUP_SPIRAL_SHARE))
        : 0;
    const newCount = size - spiralCount;
    const newPicks: Id<"questionBank">[] = [];
    let primaryUnitId: string | null = null;
    let newCursor = 0;
    while (newPicks.length < newCount && newCursor < newQueue.length) {
      const item = newQueue[newCursor++];
      newPicks.push(item.qid as unknown as Id<"questionBank">);
      if (primaryUnitId === null) primaryUnitId = item.unitId;
    }
    const spiralPicks: Id<"questionBank">[] = [];
    let spiralCursor = 0;
    while (spiralPicks.length < spiralCount && spiralCursor < spiralPool.length) {
      spiralPicks.push(spiralPool[spiralCursor++].qid as unknown as Id<"questionBank">);
    }
    if (newPicks.length === 0 && spiralPicks.length === 0) {
      return { status: "ok" as const, resized: false };
    }
    await ctx.db.insert("groupSheets", {
      groupId: row.groupId,
      slotId: row.slotId,
      date: row.date,
      unitId: primaryUnitId ?? row.unitId,
      newQuestionIds: newPicks,
      spiralQuestionIds: spiralPicks,
      status: "planned",
      createdAt: now,
      createdByTeacherId: teacherId ?? undefined,
    });
    // Consume the carry rows just re-absorbed (same accounting as crystallize).
    if (carryItems.length > 0) {
      const placed = Math.min(newCursor, carryItems.length);
      let covered = 0;
      for (const c of state.mainCarry) {
        if (covered >= placed) break;
        const n = c.questionIds.length;
        if (covered + n <= placed) await ctx.db.patch(c._id, { consumedAt: now });
        else await ctx.db.patch(c._id, { questionIds: c.questionIds.slice(placed - covered) });
        covered += n;
      }
    }
    return { status: "ok" as const, resized: true, size };
  },
});

// Log a session's unfinished tail AFTER class. The teacher picks how many
// questions (from the END of the sheet — sessions run out of time at the
// tail) and where they go: "main" = the whole group re-does them next Main
// session (crystallize serves them first); "revision" = every member gets
// them in their personal revision queue. Re-logging the same sheet+target
// replaces the previous log (idempotent tuning, not accumulation).
export const carryOverLeftover = mutation({
  args: {
    groupSheetId: v.id("groupSheets"),
    count: v.number(),
    target: v.union(v.literal("main"), v.literal("revision")),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    const teacherId = await resolveTeacherId(ctx);
    const row = await ctx.db.get(args.groupSheetId);
    if (!row) throw new Error("Group sheet not found");
    if (row.status !== "materialized")
      throw new Error(
        "Leftovers can only be logged on a session whose sheets were generated",
      );
    const all = [...row.newQuestionIds, ...row.spiralQuestionIds];
    const n = Math.min(all.length, Math.max(1, Math.round(args.count)));
    const qids = all.slice(all.length - n);
    const now = Date.now();

    // Replace any previous unconsumed log for this sheet+target.
    const existing = (
      await ctx.db
        .query("groupCarryOvers")
        .withIndex("by_group", (q) => q.eq("groupId", row.groupId))
        .collect()
    ).filter(
      (c) =>
        c.sourceSheetId === args.groupSheetId &&
        c.target === args.target &&
        c.consumedAt === undefined,
    );
    for (const c of existing) await ctx.db.delete(c._id);

    if (args.target === "main") {
      await ctx.db.insert("groupCarryOvers", {
        groupId: row.groupId,
        sourceSheetId: args.groupSheetId,
        unitId: row.unitId,
        questionIds: qids,
        target: "main",
        createdAt: now,
        createdByTeacherId: teacherId ?? undefined,
      });
      return { count: n, target: args.target, rows: 1 };
    }
    // revision → one row per current member.
    const students = await groupMemberStudents(ctx, row.groupId);
    for (const s of students) {
      await ctx.db.insert("groupCarryOvers", {
        groupId: row.groupId,
        studentId: s._id,
        sourceSheetId: args.groupSheetId,
        unitId: row.unitId,
        questionIds: qids,
        target: "revision",
        createdAt: now,
        createdByTeacherId: teacherId ?? undefined,
      });
    }
    return { count: n, target: args.target, rows: students.length };
  },
});

// Stamp revision-target carry rows consumed — called by the Sheets tab right
// after it generates a student's revision-queue sheet (the queue can't
// self-clean for carries: their questions are already "seen").
export const consumeCarryRows = mutation({
  args: { rowIds: v.array(v.id("groupCarryOvers")) },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    const now = Date.now();
    for (const id of args.rowIds) {
      const row = await ctx.db.get(id);
      if (row && row.target === "revision" && row.consumedAt === undefined) {
        await ctx.db.patch(id, { consumedAt: now });
      }
    }
  },
});

// ══════════════════════════════════════════════════════════════════════════
// Stage 3 — Revision department: delegation, catch-up queues, session types
// ══════════════════════════════════════════════════════════════════════════

// Delegate a planned group sheet to the Revision department (founder
// decision: group-level act, bookmark advances exactly as if taught — the
// row already counts toward the derived bookmark whatever its status). The
// questions reach each member through their revision queue instead of a
// taught Main session. One-way: un-delegating would corrupt sheets already
// generated from the queue.
export const delegateToRevision = mutation({
  args: { groupSheetId: v.id("groupSheets") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    const row = await ctx.db.get(args.groupSheetId);
    if (!row) throw new Error("Group sheet not found");
    if (row.status !== "planned")
      throw new Error(
        `Only planned sheets can be delegated (status: ${row.status})`,
      );
    await ctx.db.patch(args.groupSheetId, {
      status: "delegated",
      delegatedAt: Date.now(),
    });
  },
});

// A student's revision queue: every question the GROUP has claimed
// (materialized or delegated rows up to today) that this student has never
// had on a personal sheet. One rule covers both cases the founder named —
// absence catch-up (materialized on a day they missed) and delegated
// material (never taught at all). Oldest session first, new before spiral.
async function revisionQueueForStudent(
  ctx: ReadCtx,
  student: Doc<"students">,
  todayYmd: string,
  cap: number,
): Promise<{
  questionIds: Id<"questionBank">[];
  // Unconsumed carry rows whose questions were placed — the Sheets tab
  // stamps these consumed right after it generates the queue sheet.
  carryRowIds: Id<"groupCarryOvers">[];
}> {
  // Personal seen set (all sections, all time).
  const sheets = await ctx.db
    .query("generatedSheets")
    .withIndex("by_student_date", (q) => q.eq("studentId", student._id))
    .collect();
  const seen = new Set<string>();
  for (const sh of sheets) {
    for (const qid of sh.warmupQuestionIds) seen.add(qid as unknown as string);
    for (const qid of sh.mainQuestionIds) seen.add(qid as unknown as string);
    for (const qid of sh.revisionQuestionIds ?? [])
      seen.add(qid as unknown as string);
    for (const qid of sh.examPrepQuestionIds)
      seen.add(qid as unknown as string);
  }

  const out: Id<"questionBank">[] = [];
  const carryRowIds: Id<"groupCarryOvers">[] = [];

  // Carry-over leftovers FIRST: questions from an unfinished Main session
  // the teacher sent to revision. They are already "seen" (printed once),
  // so they must bypass the seen-check — dedupe only within the queue.
  const inQueue = new Set<string>();
  const carries = (
    await ctx.db
      .query("groupCarryOvers")
      .withIndex("by_student", (q) => q.eq("studentId", student._id))
      .collect()
  )
    .filter((r) => r.target === "revision" && r.consumedAt === undefined)
    .sort((a, b) => a.createdAt - b.createdAt);
  for (const r of carries) {
    if (out.length >= cap) break;
    let placedAny = false;
    for (const qid of r.questionIds) {
      if (out.length >= cap) break;
      const k = qid as unknown as string;
      if (inQueue.has(k)) continue;
      inQueue.add(k);
      out.push(qid);
      placedAny = true;
    }
    if (placedAny) carryRowIds.push(r._id);
  }

  const memberships = await ctx.db
    .query("groupMembers")
    .withIndex("by_student", (q) => q.eq("studentId", student._id))
    .collect();
  const rows: Doc<"groupSheets">[] = [];
  for (const m of memberships) {
    const gs = await ctx.db
      .query("groupSheets")
      .withIndex("by_group_date", (q) => q.eq("groupId", m.groupId))
      .collect();
    for (const r of gs) {
      if (r.date > todayYmd) continue; // future material isn't due yet
      if (r.status !== "materialized" && r.status !== "delegated") continue;
      rows.push(r);
    }
  }
  rows.sort((a, b) => a.date.localeCompare(b.date));

  for (const r of rows) {
    for (const qid of [...r.newQuestionIds, ...r.spiralQuestionIds]) {
      if (out.length >= cap) return { questionIds: out, carryRowIds };
      const k = qid as unknown as string;
      if (seen.has(k) || inQueue.has(k)) continue;
      seen.add(k);
      out.push(qid);
    }
  }
  return { questionIds: out, carryRowIds };
}

// Revision queues for a whole revision-session roster. Returns null unless
// the slot IS a revision session — the Sheets tab uses that as the gate, so
// main sessions keep their group-plan path untouched. Consolidation-mode
// students get an EMPTY queue on purpose: their planner runs fully personal
// (Gaussian + repeats); the queue waits until they recover.
export const revisionQueuesForSlotDate = query({
  args: { slotId: v.id("scheduleSlots"), dateStr: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const slot = await ctx.db.get(args.slotId);
    if (!slot || (slot.sessionType ?? "main") !== "revision") return null;
    if (!slot.groupId) return { queues: {} };
    const students = await groupMemberStudents(ctx, slot.groupId);
    const queues: Record<
      string,
      {
        questionIds: Id<"questionBank">[];
        carryRowIds: Id<"groupCarryOvers">[];
        consolidation: boolean;
      }
    > = {};
    for (const s of students) {
      const consolidation = (s.learningMode ?? "normal") === "consolidation";
      const q = consolidation
        ? { questionIds: [], carryRowIds: [] }
        : await revisionQueueForStudent(ctx, s, args.dateStr, REVISION_QUEUE_CAP);
      queues[s._id as unknown as string] = {
        consolidation,
        questionIds: q.questionIds,
        carryRowIds: q.carryRowIds,
      };
    }
    return { queues };
  },
});

// The group's weekly slots with their department type — the lesson-plan
// page's "Weekly sessions" section reads and toggles these.
export const groupWeeklySlots = query({
  args: { groupId: v.id("groups") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const slots = await ctx.db
      .query("scheduleSlots")
      .withIndex("by_group", (q) => q.eq("groupId", args.groupId))
      .collect();
    return slots
      .map((s) => ({
        slotId: s._id,
        dayOfWeek: s.dayOfWeek,
        startTime: s.startTime,
        endTime: s.endTime,
        sessionType: (s.sessionType ?? "main") as "main" | "revision",
      }))
      .sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.startTime.localeCompare(b.startTime));
  },
});

// Daily scan (crons.ts): when a group's CURRENT unit has finished every
// textbook question and is now serving the past-paper tail, tell the
// founder — he asked to be alerted at exactly this boundary so he stays in
// control of what "finishing a unit" means. Deduped per (recipient, group,
// unit) while unactioned, same pattern as exam/consolidation alerts.
export const scanBookExhaustion = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const todayYmd = ymdFromMs(now);
    const teachers = await ctx.db.query("teachers").collect();
    const recipients = teachers.filter(
      (t) => t.role === "lead" || t.role === "admin",
    );
    if (recipients.length === 0) return { posted: 0 };

    const groups = await ctx.db.query("groups").collect();
    let posted = 0;
    for (const g of groups) {
      const loaded = await loadGroupPlanState(ctx, g._id, todayYmd);
      if (loaded.status !== "ok") continue;
      const state = loaded.state;
      // Current unit = first with anything unseen; boundary = its book is
      // done but its past-paper tail isn't.
      let current: UnitLadder | null = null;
      let unseenBook = 0;
      let unseenPaper = 0;
      for (const l of state.ladders) {
        const unseen = l.ladder.filter(
          (q) => !state.seen.has(q.qid) && !state.banned.has(q.qid),
        );
        if (unseen.length === 0) continue;
        current = l;
        unseenBook = unseen.filter((q) => !q.pastPaper).length;
        unseenPaper = unseen.filter((q) => q.pastPaper).length;
        break;
      }
      if (!current || unseenBook > 0 || unseenPaper === 0) continue;

      const key = `${g._id as unknown as string}|${current.unitId}`;
      for (const t of recipients) {
        const recent = await ctx.db
          .query("notifications")
          .withIndex("by_user_created", (q) =>
            q.eq("userClerkId", t.clerkUserId),
          )
          .order("desc")
          .take(100);
        const already = recent.some(
          (n) =>
            n.type === "group_book_exhausted" &&
            !n.actionedAt &&
            (n.payload as { key?: string } | undefined)?.key === key,
        );
        if (already) continue;
        await ctx.db.insert("notifications", {
          userClerkId: t.clerkUserId,
          type: "group_book_exhausted",
          title: `${g.name}: unit book finished — past papers now`,
          body: `${g.name} has done every textbook question of its current unit. The next ${unseenPaper} Main picks come from past papers tagged to the same concepts; then the plan moves to the next unit.`,
          priority: "normal",
          actionUrl: `/groups/${g._id as unknown as string}/plan`,
          payload: { key, groupId: g._id, unitId: current.unitId },
          createdAt: now,
        });
        posted += 1;
      }
    }
    return { posted };
  },
});

// ── Term calendar (global Planner "Calendar" tab, 2026-07-15) ─────────────
//
// The whole scheme of work on one day-grid: every session of the group from
// today to just past the nearest exam — Main sessions with the unit the
// skeleton assigns them, crystallized/materialized/delegated state,
// Revision sessions, cancellations (logged in sessionLogs; the skeleton
// already flows PAST cancelled dates, so cancelling a class visibly shifts
// everything that follows). Read-only aggregation; every action it links to
// (crystallize, delegate, cancel) already exists elsewhere.

const CALENDAR_MIN_DAYS = 63; // ~9 weeks even when no exam is scheduled
const CALENDAR_PAST_EXAM_PAD_DAYS = 7;

export const groupTermCalendar = query({
  args: { groupId: v.id("groups") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const now = Date.now();
    const todayYmd = ymdFromMs(now);

    const loaded = await loadGroupPlanState(ctx, args.groupId, todayYmd);
    if (loaded.status !== "ok") return { status: loaded.status };
    const state = loaded.state;
    const { units, currentUnitIdx } = skeletonInputs(state);
    const skeleton = buildGroupSkeleton({
      sessionDates: state.sessions.map((s) => s.date),
      units,
      mainQuestionsPerSession: state.mainSize,
      spiralShare: GROUP_SPIRAL_SHARE,
      examDateByTerm: state.examDateByTerm,
      anyPastUnitStarted: currentUnitIdx > 0,
    });
    const skeletonByDate = new Map(skeleton.sessions.map((s) => [s.date, s]));
    const crystallizedByDate = new Map(
      state.crystallized.map((c) => [c.date, c]),
    );

    // Horizon: a week past the nearest upcoming exam, at least ~9 weeks.
    const upcomingExamDates = Object.values(state.examDateByTerm).sort();
    const nearestExam = upcomingExamDates[0] ?? null;
    let horizonDays = CALENDAR_MIN_DAYS;
    if (nearestExam) {
      const d = Math.round(
        (Date.parse(`${nearestExam}T00:00:00.000Z`) -
          Date.parse(`${todayYmd}T00:00:00.000Z`)) /
          MS_PER_DAY,
      );
      horizonDays = Math.max(
        CALENDAR_MIN_DAYS,
        Math.min(d + CALENDAR_PAST_EXAM_PAD_DAYS, GROUP_SKELETON_HORIZON_DAYS),
      );
    }

    // Every session occurrence in the window (Main fused per day, each
    // Revision slot separately), then one batched cancellation check.
    const allSlots = await ctx.db
      .query("scheduleSlots")
      .withIndex("by_group", (q) => q.eq("groupId", args.groupId))
      .collect();
    const mainByDow = new Map<number, Doc<"scheduleSlots">[]>();
    const revisionByDow = new Map<number, Doc<"scheduleSlots">[]>();
    for (const s of allSlots) {
      const bucket =
        (s.sessionType ?? "main") === "revision" ? revisionByDow : mainByDow;
      const list = bucket.get(s.dayOfWeek) ?? [];
      list.push(s);
      bucket.set(s.dayOfWeek, list);
    }

    type CalSession = {
      slotId: Id<"scheduleSlots">;
      type: "main" | "revision";
      startTime: string;
      endTime: string;
      cancelled: boolean;
      cancelReason: string | null;
    };
    const occurrences: Array<{ date: string; session: CalSession }> = [];
    const startMs = Date.parse(`${todayYmd}T00:00:00.000Z`);
    for (let i = 0; i < horizonDays; i++) {
      const ymd = ymdFromMs(startMs + i * MS_PER_DAY);
      const dow = dowFromYmd(ymd);
      const mains = (mainByDow.get(dow) ?? [])
        .slice()
        .sort((a, b) => a.startTime.localeCompare(b.startTime));
      if (mains.length > 0) {
        occurrences.push({
          date: ymd,
          session: {
            slotId: mains[0]._id,
            type: "main",
            startTime: mains[0].startTime,
            endTime: mains[mains.length - 1].endTime,
            cancelled: false,
            cancelReason: null,
          },
        });
      }
      for (const r of revisionByDow.get(dow) ?? []) {
        occurrences.push({
          date: ymd,
          session: {
            slotId: r._id,
            type: "revision",
            startTime: r.startTime,
            endTime: r.endTime,
            cancelled: false,
            cancelReason: null,
          },
        });
      }
    }
    const logsPerOccurrence = await Promise.all(
      occurrences.map((o) =>
        ctx.db
          .query("sessionLogs")
          .withIndex("by_slot_date", (q) =>
            q.eq("slotId", o.session.slotId).eq("date", o.date),
          )
          .collect(),
      ),
    );
    occurrences.forEach((o, i) => {
      const log = logsPerOccurrence[i].find(
        (l) => l.status === "cancelled_by_tutor",
      );
      if (log) {
        o.session.cancelled = true;
        o.session.cancelReason = log.reason ?? null;
      }
    });

    // Assemble sparse day rows (UI paints the full grid).
    const byDate = new Map<string, CalSession[]>();
    for (const o of occurrences) {
      const list = byDate.get(o.date) ?? [];
      list.push(o.session);
      byDate.set(o.date, list);
    }
    const days = Array.from(byDate.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, sessions]) => {
        const sk = skeletonByDate.get(date);
        const c = crystallizedByDate.get(date);
        return {
          date,
          sessions,
          parts: sk ? sk.parts : null,
          spiralCount: sk?.spiralCount ?? 0,
          crystallized: c
            ? {
                id: c._id,
                status: c.status,
                unitId: c.unitId,
                newCount: c.newQuestionIds.length,
                spiralCount: c.spiralQuestionIds.length,
              }
            : null,
        };
      });

    // Syllabus target: when everything due before the nearest exam actually
    // finishes at the current plan — the founder's "how many days early"
    // number. Null finish = doesn't finish inside the plan horizon.
    let syllabus: {
      finishDate: string | null;
      daysBeforeExam: number | null;
    } | null = null;
    if (nearestExam) {
      let lastDueIdx = -1;
      skeleton.units.forEach((u, i) => {
        if (u.examDate !== null && u.examDate <= nearestExam) lastDueIdx = i;
      });
      // no-questions units can't finish (nothing entered) — they'd force a
      // permanent "never finishes". They're reported separately instead.
      const inScope = skeleton.units
        .filter((_, i) => i <= lastDueIdx)
        .filter((u) => u.verdict !== "done" && u.verdict !== "no-questions");
      if (inScope.length === 0) {
        syllabus = { finishDate: todayYmd, daysBeforeExam: null };
      } else if (inScope.some((u) => u.projectedFinishDate === null)) {
        syllabus = { finishDate: null, daysBeforeExam: null };
      } else {
        const finish = inScope
          .map((u) => u.projectedFinishDate!)
          .sort()
          .pop()!;
        syllabus = {
          finishDate: finish,
          daysBeforeExam: Math.round(
            (Date.parse(`${nearestExam}T00:00:00.000Z`) -
              Date.parse(`${finish}T00:00:00.000Z`)) /
              MS_PER_DAY,
          ),
        };
      }
    }

    // Today's revision-queue depth across the roster (the debt the Revision
    // department is carrying right now).
    let queueStudents = 0;
    let queueTotal = 0;
    for (const s of state.students) {
      if ((s.learningMode ?? "normal") === "consolidation") continue;
      const q = await revisionQueueForStudent(ctx, s, todayYmd, REVISION_QUEUE_CAP);
      if (q.questionIds.length > 0) {
        queueStudents += 1;
        queueTotal += q.questionIds.length;
      }
    }

    return {
      status: "ok" as const,
      trackName: state.track.name,
      memberCount: state.students.length,
      mainQuestionsPerSession: state.mainSize,
      pendingMainCarry: state.mainCarry.reduce(
        (s, r) => s + r.questionIds.length,
        0,
      ),
      unitsWithoutQuestions: skeleton.units.filter(
        (u) => u.verdict === "no-questions",
      ).length,
      syllabus,
      revisionQueueNow: { students: queueStudents, totalQs: queueTotal },
      todayYmd,
      horizonDays,
      examDates: Object.entries(state.examDateByTerm)
        .map(([term, date]) => ({ term: Number(term), date }))
        .sort((a, b) => a.date.localeCompare(b.date)),
      days,
    };
  },
});

// Every group sheet ever written, oldest first — the Planner Sheets tab's
// term view (past rows dimmed, planned rows previewable/re-pickable).
// ── Term Coverage Cockpit (2026-07-16) ────────────────────────────────────
// The founder's "see the whole term" view. For one group + one term: every
// track unit of that term with its full question ladder (each rung a tiny
// box), the pick STATE + PROVENANCE of every question (which group-sheet date
// and status it landed on), and the per-student "done" marks per unit. Read
// side of the cockpit — reuses loadGroupPlanState so the ladders, seen-set and
// pre-taught folding match the planner exactly (no second source of truth).
export const groupTermCoverage = query({
  args: { groupId: v.id("groups"), term: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const todayYmd = ymdFromMs(Date.now());
    const loaded = await loadGroupPlanState(ctx, args.groupId, todayYmd);
    if (loaded.status !== "ok") return { status: loaded.status };
    const state = loaded.state;

    const availableTerms = Array.from(
      new Set(
        state.ladders
          .map((l) => termFromUnitId(l.unitId))
          .filter((t): t is number => t !== null),
      ),
    ).sort((a, b) => a - b);

    // Default the view to the term we're teaching TOWARD: the nearest upcoming
    // exam's term. Falls back to the last term the track has. Explicit `term`
    // (the founder tapped a chip) always wins.
    const nearestExamTerm = Object.entries(state.examDateByTerm).sort((a, b) =>
      a[1].localeCompare(b[1]),
    )[0]?.[0];
    const resolvedTerm =
      args.term ??
      (nearestExamTerm !== undefined
        ? Number(nearestExamTerm)
        : (availableTerms[availableTerms.length - 1] ?? 1));

    // Provenance map: qid → the group sheet it sits on. ALL sheets (past +
    // future), first occurrence wins. new vs spiral tells the founder whether
    // it was taught as fresh material or folded back in as review.
    const allSheets = await ctx.db
      .query("groupSheets")
      .withIndex("by_group_date", (q) => q.eq("groupId", args.groupId))
      .collect();
    const sheetByQid = new Map<
      string,
      { date: string; status: string; section: "new" | "spiral" }
    >();
    for (const row of allSheets) {
      for (const qid of row.newQuestionIds) {
        const k = qid as unknown as string;
        if (!sheetByQid.has(k))
          sheetByQid.set(k, { date: row.date, status: row.status, section: "new" });
      }
      for (const qid of row.spiralQuestionIds) {
        const k = qid as unknown as string;
        if (!sheetByQid.has(k))
          sheetByQid.set(k, {
            date: row.date,
            status: row.status,
            section: "spiral",
          });
      }
    }

    // Per-student per-unit "done" marks, grouped by unit.
    const doneRows = await ctx.db
      .query("groupStudentUnitProgress")
      .withIndex("by_group", (q) => q.eq("groupId", args.groupId))
      .collect();
    const doneByUnit = new Map<string, Set<string>>();
    for (const r of doneRows) {
      const set = doneByUnit.get(r.unitId) ?? new Set<string>();
      set.add(r.studentId as unknown as string);
      doneByUnit.set(r.unitId, set);
    }

    const termLadders = state.ladders.filter(
      (l) => termFromUnitId(l.unitId) === resolvedTerm,
    );

    const units = await Promise.all(
      termLadders.map(async (l) => {
        const preTaught = state.preTaughtUnitIds.has(l.unitId);
        const qDocs = await Promise.all(
          l.ladder.map((r) =>
            ctx.db.get(r.qid as unknown as Id<"questionBank">),
          ),
        );
        const questions = l.ladder.map((r, i) => {
          const q = qDocs[i];
          const k = r.qid;
          const prov = sheetByQid.get(k);
          let questionState: "done" | "planned" | "unseen" | "banned";
          let sheetDate: string | null = null;
          let sheetStatus: string | null = null;
          if (prov) {
            sheetDate = prov.date;
            sheetStatus = prov.status;
            // materialized = actually taught; planned/delegated = future claim.
            questionState = prov.status === "materialized" ? "done" : "planned";
          } else if (preTaught || state.seen.has(k)) {
            // Pre-app starting point, or a member did it in per-student mode:
            // covered, but no group-sheet date to point at.
            questionState = "done";
          } else if (state.banned.has(k)) {
            // Unticked in the unit-curation dialog: excluded from the plan.
            questionState = "banned";
          } else {
            questionState = "unseen";
          }
          return {
            questionId: r.qid as unknown as Id<"questionBank">,
            label: q?.questionNumberInPaper ?? q?.linkedQuestionKey ?? null,
            difficulty: r.difficulty,
            pastPaper: r.pastPaper,
            section: prov?.section ?? null,
            state: questionState,
            sheetDate,
            sheetStatus,
          };
        });
        const doneCount = questions.filter((q) => q.state === "done").length;
        const plannedCount = questions.filter(
          (q) => q.state === "planned",
        ).length;
        const bannedCount = questions.filter(
          (q) => q.state === "banned",
        ).length;
        return {
          unitId: l.unitId,
          term: resolvedTerm,
          totalQuestions: questions.length,
          doneCount,
          plannedCount,
          bannedCount,
          unseenCount:
            questions.length - doneCount - plannedCount - bannedCount,
          hasBook: questions.length > 0,
          preTaught,
          studentsDone: Array.from(doneByUnit.get(l.unitId) ?? []),
          questions,
        };
      }),
    );

    // One-tap "prior terms already covered": the last track unit whose term is
    // BEFORE the viewed term. Marking through it (setGroupStartingPoint) makes
    // the GROUP prebuild start at this term instead of restarting at unit 1 —
    // the fix for a cold-started group whose plan still shows Term 1.
    const priorUnits = state.track.orderedUnitIds.filter((uid) => {
      const t = termFromUnitId(uid);
      return t !== null && t < resolvedTerm;
    });
    const priorTermsThroughUnitId =
      priorUnits.length > 0 ? priorUnits[priorUnits.length - 1] : null;
    const priorTermsAllPreTaught =
      priorUnits.length > 0 &&
      priorUnits.every((uid) => state.preTaughtUnitIds.has(uid));

    return {
      status: "ok" as const,
      term: resolvedTerm,
      availableTerms,
      priorTermsThroughUnitId,
      priorTermsAllPreTaught,
      students: state.students.map((s) => ({ studentId: s._id, name: s.name })),
      units,
    };
  },
});

// Toggle a student's "did / didn't do" mark for one unit (Term Coverage
// Cockpit). Existence = done. Pure per-student bookmark: no sheet/point/memory
// effects — it drives the catch-up list and each student's progress.
export const setStudentUnitDone = mutation({
  args: {
    groupId: v.id("groups"),
    studentId: v.id("students"),
    unitId: v.string(),
    done: v.boolean(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    const existing = await ctx.db
      .query("groupStudentUnitProgress")
      .withIndex("by_group_student_unit", (q) =>
        q
          .eq("groupId", args.groupId)
          .eq("studentId", args.studentId)
          .eq("unitId", args.unitId),
      )
      .collect();
    if (args.done) {
      if (existing.length === 0) {
        const teacherId = await resolveTeacherId(ctx);
        await ctx.db.insert("groupStudentUnitProgress", {
          groupId: args.groupId,
          studentId: args.studentId,
          unitId: args.unitId,
          createdAt: Date.now(),
          ...(teacherId ? { createdByTeacherId: teacherId } : {}),
        });
      }
    } else {
      for (const r of existing) await ctx.db.delete(r._id);
    }
    return { ok: true as const };
  },
});

// ── Unit curation (2026-07-17, group Lesson Builder) ─────────────────────
// Per-question group state for ONE unit — the curation dialog's tick layer.
// The dialog pairs this with lessonSets.listUnitQuestions (the same tiles the
// session Lesson Builder shows) by questionId.
export const groupUnitCuration = query({
  args: { groupId: v.id("groups"), unitId: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const todayYmd = ymdFromMs(Date.now());
    const loaded = await loadGroupPlanState(ctx, args.groupId, todayYmd);
    if (loaded.status !== "ok") return { status: loaded.status };
    const state = loaded.state;
    const ladder = state.ladders.find((l) => l.unitId === args.unitId);
    if (!ladder) return { status: "no-unit" as const };

    // Provenance: which group sheet claimed each question (first wins).
    const allSheets = await ctx.db
      .query("groupSheets")
      .withIndex("by_group_date", (q) => q.eq("groupId", args.groupId))
      .collect();
    const statusByQid = new Map<string, string>();
    for (const row of allSheets) {
      for (const qid of [...row.newQuestionIds, ...row.spiralQuestionIds]) {
        const k = qid as unknown as string;
        if (!statusByQid.has(k)) statusByQid.set(k, row.status);
      }
    }

    const preTaught = state.preTaughtUnitIds.has(args.unitId);
    const questions = ladder.ladder.map((r) => {
      const sheetStatus = statusByQid.get(r.qid) ?? null;
      const taught =
        sheetStatus === "materialized" || preTaught || state.seen.has(r.qid);
      return {
        questionId: r.qid as unknown as Id<"questionBank">,
        taught, // locked in the dialog — can't ban what's already done
        planned: !taught && sheetStatus !== null,
        banned: state.banned.has(r.qid),
      };
    });
    return { status: "ok" as const, questions };
  },
});

// Save the curation ticks: banned = every unit question the founder left
// UNTICKED. Taught questions can never be banned (silently dropped — the UI
// locks them anyway). Empty ban list deletes the row. The caller follows up
// with deleteFuturePlanned + crystallizeUpcoming so planned sheets match.
export const setGroupUnitBans = mutation({
  args: {
    groupId: v.id("groups"),
    unitId: v.string(),
    bannedQuestionIds: v.array(v.id("questionBank")),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    const teacherId = await resolveTeacherId(ctx);
    const todayYmd = ymdFromMs(Date.now());
    const loaded = await loadGroupPlanState(ctx, args.groupId, todayYmd);
    if (loaded.status !== "ok") return { status: loaded.status, banned: 0 };
    const state = loaded.state;
    const ladder = state.ladders.find((l) => l.unitId === args.unitId);
    if (!ladder) return { status: "no-unit" as const, banned: 0 };

    // Only real, un-taught questions of THIS unit can be banned.
    const unitQids = new Set(ladder.ladder.map((r) => r.qid));
    const clean = args.bannedQuestionIds.filter((qid) => {
      const k = qid as unknown as string;
      return unitQids.has(k) && !state.seen.has(k);
    });

    const existing = (
      await ctx.db
        .query("groupUnitBans")
        .withIndex("by_group", (q) => q.eq("groupId", args.groupId))
        .collect()
    ).filter((r) => r.unitId === args.unitId);
    for (const r of existing.slice(1)) await ctx.db.delete(r._id); // dedupe
    const row = existing[0];
    if (clean.length === 0) {
      if (row) await ctx.db.delete(row._id);
    } else if (row) {
      await ctx.db.patch(row._id, {
        questionIds: clean,
        updatedAt: Date.now(),
        ...(teacherId ? { updatedByTeacherId: teacherId } : {}),
      });
    } else {
      await ctx.db.insert("groupUnitBans", {
        groupId: args.groupId,
        unitId: args.unitId,
        questionIds: clean,
        updatedAt: Date.now(),
        ...(teacherId ? { updatedByTeacherId: teacherId } : {}),
      });
    }
    return { status: "ok" as const, banned: clean.length };
  },
});

// The group's weekly slot layout by day-of-week (1=Mon..7=Sun), split into
// Main and Revision departments — powers the 7+7 day grid in each week card
// (Term Coverage Cockpit control room, 2026-07-16).
export const groupSlotDays = query({
  args: { groupId: v.id("groups") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const slots = await ctx.db
      .query("scheduleSlots")
      .withIndex("by_group", (q) => q.eq("groupId", args.groupId))
      .collect();
    const mainDays = new Set<number>();
    const revisionDays = new Set<number>();
    for (const s of slots) {
      if ((s.sessionType ?? "main") === "revision")
        revisionDays.add(s.dayOfWeek);
      else mainDays.add(s.dayOfWeek);
    }
    return {
      mainDays: Array.from(mainDays).sort((a, b) => a - b),
      revisionDays: Array.from(revisionDays).sort((a, b) => a - b),
    };
  },
});

export const groupSheetHistory = query({
  args: { groupId: v.id("groups") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const rows = await ctx.db
      .query("groupSheets")
      .withIndex("by_group_date", (q) => q.eq("groupId", args.groupId))
      .collect();
    return rows
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((r) => ({
        id: r._id,
        date: r.date,
        unitId: r.unitId,
        newCount: r.newQuestionIds.length,
        spiralCount: r.spiralQuestionIds.length,
        status: r.status,
      }));
  },
});

// One sheet's questions with their crops, print order (new then spiral) —
// the Sheets tab's preview drawer. Same page-URL resolution as lessonSets.
export const groupSheetPreview = query({
  args: { groupSheetId: v.id("groupSheets") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const row = await ctx.db.get(args.groupSheetId);
    if (!row) return null;

    const pageUrlCache = new Map<
      string,
      { full: string | null; small: string | null }
    >();
    async function pageUrls(
      pageId: Id<"textbookPages"> | Id<"pastPaperPages">,
    ): Promise<{ full: string | null; small: string | null }> {
      const key = pageId as unknown as string;
      const cached = pageUrlCache.get(key);
      if (cached) return cached;
      const p = await ctx.db.get(pageId);
      const out = {
        full: p ? await ctx.storage.getUrl(p.storageId) : null,
        small:
          p && p.smallStorageId
            ? await ctx.storage.getUrl(p.smallStorageId)
            : null,
      };
      pageUrlCache.set(key, out);
      return out;
    }

    async function describe(
      qid: Id<"questionBank">,
      section: "new" | "spiral",
    ) {
      const q = await ctx.db.get(qid);
      if (!q) return null;
      const pageId = q.textbookPageId ?? q.pastPaperPageId;
      const urls = pageId ? await pageUrls(pageId) : { full: null, small: null };
      return {
        questionId: qid,
        section,
        source: q.source,
        difficulty: q.difficulty ?? null,
        cropBox: q.cropBox ?? null,
        pageImageUrl: urls.full,
        pageImageUrlSmall: urls.small,
        overrideImageUrl: q.overrideRender
          ? await ctx.storage.getUrl(q.overrideRender.storageId)
          : null,
      };
    }

    const questions = (
      await Promise.all([
        ...row.newQuestionIds.map((qid) => describe(qid, "new" as const)),
        ...row.spiralQuestionIds.map((qid) => describe(qid, "spiral" as const)),
      ])
    ).filter((q): q is NonNullable<typeof q> => q !== null);

    return {
      id: row._id,
      groupId: row.groupId,
      date: row.date,
      unitId: row.unitId,
      status: row.status,
      questions,
    };
  },
});

// Move a PLANNED sheet to another of the group's session days (Main or
// Revision) — the control-room "shift this sheet" lever. Keeps the same
// questions; just re-homes the row onto that day's slot. Refuses if the target
// isn't a session day or already holds a live sheet.
export const moveGroupSheet = mutation({
  args: { groupSheetId: v.id("groupSheets"), toDate: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    const row = await ctx.db.get(args.groupSheetId);
    if (!row) throw new Error("Group sheet not found");
    if (row.status !== "planned")
      throw new Error("Only planned sheets can be moved");
    const dow = dowFromYmd(args.toDate);
    const slots = (
      await ctx.db
        .query("scheduleSlots")
        .withIndex("by_group", (q) => q.eq("groupId", row.groupId))
        .collect()
    ).filter((s) => s.dayOfWeek === dow);
    if (slots.length === 0)
      throw new Error("That day has no session for this group");
    // Earliest slot represents the (possibly fused) session.
    const slot = slots.reduce((a, b) => (a.startTime <= b.startTime ? a : b));
    const clash = (
      await ctx.db
        .query("groupSheets")
        .withIndex("by_group_date", (q) =>
          q.eq("groupId", row.groupId).eq("date", args.toDate),
        )
        .collect()
    ).some((r) => r._id !== row._id && r.status !== "delegated");
    if (clash) throw new Error("That day already has a sheet");
    await ctx.db.patch(args.groupSheetId, {
      date: args.toDate,
      slotId: slot._id,
    });
    return { ok: true as const };
  },
});

// Delete every future still-planned row (materialized/delegated untouched)
// so "Re-plan the term" can rebuild from the current book order — the
// founder's iteration loop: reorder difficulty in the Lesson Builder, then
// re-plan; counts stay identical, order refreshes. Carries absorbed by the
// deleted rows are given back, same as deletePlanned.
export const deleteFuturePlanned = mutation({
  args: { groupId: v.id("groups") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    const todayYmd = ymdFromMs(Date.now());
    const rows = (
      await ctx.db
        .query("groupSheets")
        .withIndex("by_group_date", (q) =>
          q.eq("groupId", args.groupId).gte("date", todayYmd),
        )
        .collect()
    ).filter((r) => r.status === "planned");
    if (rows.length === 0) return { deleted: 0 };

    const freedIds = new Set<string>();
    for (const r of rows) {
      for (const q of [...r.newQuestionIds, ...r.spiralQuestionIds]) {
        freedIds.add(q as unknown as string);
      }
      if (r.pdfPreviewStorageId) {
        try {
          await ctx.storage.delete(r.pdfPreviewStorageId);
        } catch {
          // ignore — preview blob already gone
        }
      }
      await ctx.db.delete(r._id);
    }
    const carries = await ctx.db
      .query("groupCarryOvers")
      .withIndex("by_group", (q) => q.eq("groupId", args.groupId))
      .collect();
    for (const c of carries) {
      if (c.target !== "main" || c.consumedAt === undefined) continue;
      if (c.questionIds.every((q) => freedIds.has(q as unknown as string))) {
        await ctx.db.patch(c._id, { consumedAt: undefined });
      }
    }
    return { deleted: rows.length };
  },
});

// Flip a slot between the Main and Revision departments. Lives here (not
// scheduleSlots.ts) because it's a departments concern: the skeleton and
// the revision queues both key off it.
export const setSlotSessionType = mutation({
  args: {
    slotId: v.id("scheduleSlots"),
    sessionType: v.union(v.literal("main"), v.literal("revision")),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    const slot = await ctx.db.get(args.slotId);
    if (!slot) throw new Error("Slot not found");
    await ctx.db.patch(args.slotId, {
      sessionType: args.sessionType === "main" ? undefined : args.sessionType,
    });
  },
});
