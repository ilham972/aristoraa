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

import { mutation, query } from "../_generated/server";
import { v } from "convex/values";
import type { GenericMutationCtx, GenericQueryCtx } from "convex/server";
import type { DataModel, Doc, Id } from "../_generated/dataModel";
import { questionsTaggedToConcept } from "./derivedConcepts";
import { masteryFromState } from "./mastery";
import {
  DEFAULT_QUESTION_DIFFICULTY,
  GROUP_CRYSTALLIZE_AHEAD_DAYS,
  GROUP_MAIN_QUESTIONS_DEFAULT,
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

async function groupMemberStudents(
  ctx: ReadCtx,
  groupId: Id<"groups">,
): Promise<Doc<"students">[]> {
  const members = await ctx.db
    .query("groupMembers")
    .withIndex("by_group", (q) => q.eq("groupId", groupId))
    .collect();
  const out: Doc<"students">[] = [];
  for (const m of members) {
    const s = await ctx.db.get(m.studentId);
    if (s) out.push(s);
  }
  return out;
}

// The track the GROUP rides: the majority track among members (ties broken
// by most members, then track level via _id stability). Null when no member
// has a track — the group plan requires tracks (the Main block is track-
// driven since the exam-mode change).
async function resolveTrackForGroup(
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
  for (const s of students) {
    const sheets = await ctx.db
      .query("generatedSheets")
      .withIndex("by_student_date", (q) => q.eq("studentId", s._id))
      .collect();
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

// Per-unit ladders along the track: question ids in teacher order
// (difficulty, then Lesson Builder drag order, then id) + the question→
// concept map (spiral ranking needs it). Same tagging helper as the planner.
type UnitLadder = {
  unitId: string;
  ladder: Array<{ qid: string; difficulty: number; pickerOrder: number }>;
  conceptByQuestion: Map<string, string>;
};

async function buildUnitLadders(
  ctx: ReadCtx,
  orderedUnitIds: string[],
): Promise<UnitLadder[]> {
  const out: UnitLadder[] = [];
  for (const unitId of orderedUnitIds) {
    const exRows = await ctx.db
      .query("exercises")
      .withIndex("by_unit", (q) => q.eq("unitId", unitId))
      .collect();
    const conceptByQuestion = new Map<string, string>();
    const qids = new Set<string>();
    for (const row of exRows) {
      if (row.type !== "concept") continue;
      const tagged = await questionsTaggedToConcept(ctx, row._id);
      for (const qid of tagged) {
        const k = qid as unknown as string;
        if (!qids.has(k)) {
          qids.add(k);
          conceptByQuestion.set(k, row._id as unknown as string);
        }
      }
    }
    const docs: Array<{ qid: string; difficulty: number; pickerOrder: number }> =
      [];
    for (const k of Array.from(qids)) {
      const q = await ctx.db.get(k as unknown as Id<"questionBank">);
      if (!q) continue;
      docs.push({
        qid: k,
        difficulty: q.difficulty ?? DEFAULT_QUESTION_DIFFICULTY,
        pickerOrder: q.pickerOrder ?? Number.MAX_SAFE_INTEGER,
      });
    }
    docs.sort(
      (a, b) =>
        a.difficulty - b.difficulty ||
        a.pickerOrder - b.pickerOrder ||
        (a.qid < b.qid ? -1 : 1),
    );
    out.push({ unitId, ladder: docs, conceptByQuestion });
  }
  return out;
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
  const out: Array<{ date: string; slotId: Id<"scheduleSlots"> }> = [];
  for (let i = 0; i < horizonDays; i++) {
    const ymd = ymdFromMs(startMs + i * MS_PER_DAY);
    const slotId = byDow.get(dowFromYmd(ymd));
    if (slotId) out.push({ date: ymd, slotId });
  }
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
  for (const s of students) {
    const states = await ctx.db
      .query("memoryState")
      .withIndex("by_student", (q) => q.eq("studentId", s._id))
      .collect();
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

  return {
    status: "ok",
    state: { students, track, seen, ladders, sessions, examDateByTerm, crystallized },
  };
}

function skeletonInputs(state: GroupPlanState): {
  units: SkeletonUnitInput[];
  currentUnitIdx: number;
} {
  const units: SkeletonUnitInput[] = state.ladders.map((l) => ({
    unitId: l.unitId,
    term: termFromUnitId(l.unitId),
    unseenCount: l.ladder.filter((q) => !state.seen.has(q.qid)).length,
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
      mainQuestionsPerSession: GROUP_MAIN_QUESTIONS_DEFAULT,
      spiralShare: GROUP_SPIRAL_SHARE,
      examDateByTerm: state.examDateByTerm,
      anyPastUnitStarted: currentUnitIdx > 0,
    });

    const crystallizedByDate = new Map(
      state.crystallized.map((c) => [c.date, c]),
    );
    const slotByDate = new Map(state.sessions.map((s) => [s.date, s.slotId]));

    return {
      status: "ok" as const,
      trackId: state.track._id,
      trackName: state.track.name,
      memberCount: state.students.length,
      currentUnitId:
        currentUnitIdx < units.length ? units[currentUnitIdx].unitId : null,
      crystallizeAheadDays: GROUP_CRYSTALLIZE_AHEAD_DAYS,
      mainQuestionsPerSession: GROUP_MAIN_QUESTIONS_DEFAULT,
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
    const horizon = Math.min(
      Math.max(1, Math.round(args.daysAhead ?? GROUP_CRYSTALLIZE_AHEAD_DAYS)),
      30,
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
    if (targets.length === 0) return { status: "ok" as const, written: 0 };

    // Spiral source: unseen questions from units BEFORE the current one,
    // weakest group-average memory first, then ladder order. Recomputed once
    // per crystallize call; picks consume the pool so sessions don't repeat.
    const avgR = await groupAvgRByConcept(ctx, state.students, now);
    const spiralPool: Array<{ qid: string; r: number; idx: number }> = [];
    for (let i = 0; i < Math.min(currentUnitIdx, state.ladders.length); i++) {
      const l = state.ladders[i];
      l.ladder.forEach((q, idx) => {
        if (state.seen.has(q.qid)) return;
        const concept = l.conceptByQuestion.get(q.qid);
        spiralPool.push({
          qid: q.qid,
          r: concept ? (avgR.get(concept) ?? 0) : 0,
          idx: i * 10_000 + idx,
        });
      });
    }
    spiralPool.sort((a, b) => a.r - b.r || a.idx - b.idx);
    let spiralCursor = 0;

    // New-question walk: flat list of unseen ladder questions from the
    // current unit onward, in track order.
    const newQueue: Array<{ qid: string; unitId: string }> = [];
    for (let i = currentUnitIdx; i < state.ladders.length; i++) {
      const l = state.ladders[i];
      for (const q of l.ladder) {
        if (!state.seen.has(q.qid)) newQueue.push({ qid: q.qid, unitId: l.unitId });
      }
    }
    let newCursor = 0;

    const mainSize = GROUP_MAIN_QUESTIONS_DEFAULT;
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
    return { status: "ok" as const, written };
  },
});

// ── Session-time lookups + lifecycle ──────────────────────────────────────

// The planned group sheet for a session, resolved from the slot. The Sheets
// tab uses this: when present, "Generate all" materializes THIS sheet as the
// identical Main block for every roster member.
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
    if (!row) return null;
    return {
      id: row._id,
      status: row.status,
      unitId: row.unitId,
      groupId: row.groupId,
      questionIds: [...row.newQuestionIds, ...row.spiralQuestionIds],
      newCount: row.newQuestionIds.length,
      spiralCount: row.spiralQuestionIds.length,
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
    await ctx.db.delete(args.groupSheetId);
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
): Promise<Id<"questionBank">[]> {
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

  const out: Id<"questionBank">[] = [];
  for (const r of rows) {
    for (const qid of [...r.newQuestionIds, ...r.spiralQuestionIds]) {
      if (out.length >= cap) return out;
      const k = qid as unknown as string;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(qid);
    }
  }
  return out;
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
      { questionIds: Id<"questionBank">[]; consolidation: boolean }
    > = {};
    for (const s of students) {
      const consolidation = (s.learningMode ?? "normal") === "consolidation";
      queues[s._id as unknown as string] = {
        consolidation,
        questionIds: consolidation
          ? []
          : await revisionQueueForStudent(
              ctx,
              s,
              args.dateStr,
              REVISION_QUEUE_CAP,
            ),
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
