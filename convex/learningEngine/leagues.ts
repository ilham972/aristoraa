// Phase 3 (cohort leagues) — rank students WITHIN their track, not their grade.
//
// A "league" is a track: students compete against true peers (same route), so a
// remedial student can win their league. The rank metric is Σ sessionPoints
// .pointsNew over the period (the difficulty×section effort score from Phase 2);
// track PROGRESS (stations cleared) is a secondary stat, computed from mastery.
//
// Strictly additive (spec §2.6): this reads sessionPoints + memoryState +
// exercises + tracks + students ONLY. It NEVER reads or writes the legacy
// `entries` leaderboard, `src/lib/scoring.ts`, or `position`. The public board
// is unchanged until the founder flips LEADERBOARD_PRIMARY (config.ts).
//
// Unit human-names live in src/lib/curriculum-data.ts which Convex cannot import
// (frontend module) — so these functions return unit *ids*; the client resolves
// names via findUnit(), following the path.ts / planner.ts convention.

import { mutation, query } from "../_generated/server";
import { v } from "convex/values";
import type { GenericMutationCtx, GenericQueryCtx } from "convex/server";
import type { DataModel, Doc, Id } from "../_generated/dataModel";
import { resolveTrackForStudent } from "./tracks";
import { masteryFromState } from "./mastery";
import { MASTERY_THRESHOLD } from "./config";

type QueryCtx = GenericQueryCtx<DataModel>;
type MutationCtx = GenericMutationCtx<DataModel>;
type ReadCtx = QueryCtx | MutationCtx;

// Trackless students bucket sorts last; bigger than any real track.level.
const NO_TRACK_LEVEL = Number.MAX_SAFE_INTEGER;
const NO_TRACK_NAME = "No track (legacy)";

// Resolve the calling teacher id (best-effort audit field). Mirrors
// tracks.ts::resolveTeacherId — duplicate teacher rows mean collect()-not-
// unique() and pick the oldest deterministically.
async function resolveTeacherId(ctx: MutationCtx): Promise<Id<"teachers"> | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  const rows = await ctx.db
    .query("teachers")
    .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", identity.subject))
    .collect();
  if (rows.length === 0) return null;
  return rows.reduce((a, b) => (a._creationTime <= b._creationTime ? a : b))._id;
}

// Concept-type exercise ids in a unit. Cached across students in a single
// query pass (the unit→concepts map is student-independent) so a cohort sweep
// doesn't re-scan the same units per student.
async function conceptIdsForUnit(
  ctx: ReadCtx,
  unitId: string,
  cache?: Map<string, Id<"exercises">[]>,
): Promise<Id<"exercises">[]> {
  const hit = cache?.get(unitId);
  if (hit) return hit;
  const rows = await ctx.db
    .query("exercises")
    .withIndex("by_unit", (q) => q.eq("unitId", unitId))
    .collect();
  const ids = rows.filter((r) => r.type === "concept").map((r) => r._id);
  cache?.set(unitId, ids);
  return ids;
}

// mastery(conceptExerciseId → mastery) for every concept the student has a
// memoryState row on. Concepts with no row are "cold" (mastery 0) — the caller
// treats a missing key as 0.
async function masteryMapForStudent(
  ctx: ReadCtx,
  studentId: Id<"students">,
  atTime: number,
): Promise<Map<string, number>> {
  const states = await ctx.db
    .query("memoryState")
    .withIndex("by_student", (q) => q.eq("studentId", studentId))
    .collect();
  const m = new Map<string, number>();
  for (const s of states) {
    m.set(s.conceptExerciseId as unknown as string, masteryFromState(s, atTime).mastery);
  }
  return m;
}

export type TrackProgress = {
  trackId: Id<"tracks">;
  trackName: string;
  level: number;
  totalUnits: number;
  clearedUnits: number;
  clearedUnitIds: string[]; // the cleared prefix (stations the student has passed)
  currentUnitId: string | null; // first not-cleared unit, or null when complete
  pctCleared: number; // 0..1
  isComplete: boolean;
  mergesIntoTrackId: Id<"tracks"> | null;
};

// Core station-clearing scan (spec §2.3 / §3.2). A unit is CLEARED when every
// concept-type exercise in it has mastery ≥ MASTERY_THRESHOLD. A unit with zero
// concept-type exercises is cleared vacuously (nothing to master — §3.5). We
// scan orderedUnitIds from the start; the FIRST not-cleared unit is the current
// station and the scan stops there (progress = the cleared prefix).
export async function trackProgressForStudent(
  ctx: ReadCtx,
  student: Doc<"students">,
  opts?: { unitCache?: Map<string, Id<"exercises">[]>; atTime?: number },
): Promise<TrackProgress | null> {
  const track = await resolveTrackForStudent(ctx, student);
  if (!track) return null;

  const atTime = opts?.atTime ?? Date.now();
  const mastery = await masteryMapForStudent(ctx, student._id, atTime);

  const clearedUnitIds: string[] = [];
  let currentUnitId: string | null = null;
  for (const unitId of track.orderedUnitIds) {
    const conceptIds = await conceptIdsForUnit(ctx, unitId, opts?.unitCache);
    const cleared =
      conceptIds.length === 0 ||
      conceptIds.every(
        (cid) => (mastery.get(cid as unknown as string) ?? 0) >= MASTERY_THRESHOLD,
      );
    if (cleared) {
      clearedUnitIds.push(unitId);
    } else {
      currentUnitId = unitId;
      break;
    }
  }

  const totalUnits = track.orderedUnitIds.length;
  const clearedUnits = clearedUnitIds.length;
  return {
    trackId: track._id,
    trackName: track.name,
    level: track.level,
    totalUnits,
    clearedUnits,
    clearedUnitIds,
    currentUnitId,
    pctCleared: totalUnits === 0 ? 1 : clearedUnits / totalUnits,
    isComplete: currentUnitId === null,
    mergesIntoTrackId: track.mergesIntoTrackId ?? null,
  };
}

// ── Cohort grouping (shared by cohortLeaderboard + studentLeagueCard) ────────

export type LeagueStudent = {
  studentId: Id<"students">;
  name: string;
  pointsNew: number;
  pointsOld: number;
  clearedUnits: number;
  totalUnits: number;
  currentUnitId: string | null;
  isComplete: boolean;
};

export type League = {
  trackId: Id<"tracks"> | null; // null = the No-track bucket
  trackName: string;
  level: number;
  mergesIntoTrackId: Id<"tracks"> | null;
  mergesIntoTrackName: string | null;
  students: LeagueStudent[];
};

async function computeCohort(
  ctx: QueryCtx,
  dates: string[],
  filterTrackId?: Id<"tracks">,
): Promise<League[]> {
  // 1. Σ points per student over the period (reuse the by_date index; same read
  // shape as scoring.pointsLeaderboard). NEVER touches the entries board.
  const pointsByStudent = new Map<string, { pointsNew: number; pointsOld: number }>();
  for (const date of dates) {
    const rows = await ctx.db
      .query("sessionPoints")
      .withIndex("by_date", (q) => q.eq("date", date))
      .collect();
    for (const r of rows) {
      const key = r.studentId as unknown as string;
      const agg = pointsByStudent.get(key) ?? { pointsNew: 0, pointsOld: 0 };
      agg.pointsNew += r.pointsNew;
      agg.pointsOld += r.pointsOld;
      pointsByStudent.set(key, agg);
    }
  }

  const tracks = await ctx.db.query("tracks").collect();
  const trackById = new Map<string, Doc<"tracks">>();
  for (const t of tracks) trackById.set(t._id as unknown as string, t);

  const students = await ctx.db.query("students").collect();
  const unitCache = new Map<string, Id<"exercises">[]>();
  const atTime = Date.now();

  const filterKey = filterTrackId ? (filterTrackId as unknown as string) : null;
  const NONE = "__none__";
  const leagues = new Map<string, League>();

  for (const s of students) {
    // Pre-filter cheaply when scoped to one league (the student-card path).
    if (filterKey && (s.trackId as unknown as string | undefined) !== filterKey) {
      continue;
    }

    const progress = s.trackId
      ? await trackProgressForStudent(ctx, s, { unitCache, atTime })
      : null;
    const inTrack = progress !== null; // false also when trackId points at a deleted track
    const key = inTrack ? (progress!.trackId as unknown as string) : NONE;

    if (filterKey && key !== filterKey) continue; // deleted-track edge under filter

    let league = leagues.get(key);
    if (!league) {
      if (inTrack) {
        const mergeId = progress!.mergesIntoTrackId;
        const mergeName = mergeId
          ? (trackById.get(mergeId as unknown as string)?.name ?? null)
          : null;
        league = {
          trackId: progress!.trackId,
          trackName: progress!.trackName,
          level: progress!.level,
          mergesIntoTrackId: mergeId,
          mergesIntoTrackName: mergeName,
          students: [],
        };
      } else {
        league = {
          trackId: null,
          trackName: NO_TRACK_NAME,
          level: NO_TRACK_LEVEL,
          mergesIntoTrackId: null,
          mergesIntoTrackName: null,
          students: [],
        };
      }
      leagues.set(key, league);
    }

    const pts = pointsByStudent.get(s._id as unknown as string) ?? {
      pointsNew: 0,
      pointsOld: 0,
    };
    league.students.push({
      studentId: s._id,
      name: s.name,
      pointsNew: pts.pointsNew,
      pointsOld: pts.pointsOld,
      clearedUnits: progress?.clearedUnits ?? 0,
      totalUnits: progress?.totalUnits ?? 0,
      currentUnitId: progress?.currentUnitId ?? null,
      isComplete: progress?.isComplete ?? false,
    });
  }

  const out = Array.from(leagues.values());
  for (const lg of out) {
    // Rank by the league metric (pointsNew), tie-break on progress then name.
    lg.students.sort(
      (a, b) =>
        b.pointsNew - a.pointsNew ||
        b.clearedUnits - a.clearedUnits ||
        a.name.localeCompare(b.name),
    );
  }
  // Leagues ordered by level (more remedial first); No-track bucket last.
  out.sort((a, b) => a.level - b.level || a.trackName.localeCompare(b.trackName));
  return out;
}

// ── Public queries / mutation ───────────────────────────────────────────────

// Cohort leaderboard: one ranked league per track, ordered by level. Pass a
// trackId to scope to a single league. Returns null when unauthenticated.
export const cohortLeaderboard = query({
  args: {
    dates: v.array(v.string()),
    trackId: v.optional(v.id("tracks")),
  },
  handler: async (ctx, { dates, trackId }): Promise<League[] | null> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    return await computeCohort(ctx, dates, trackId);
  },
});

export type PromotionCandidate = {
  studentId: Id<"students">;
  name: string;
  fromTrackId: Id<"tracks">;
  fromTrackName: string;
  toTrackId: Id<"tracks">;
  toTrackName: string;
};

// Students who have CLEARED their whole track and whose track merges into a
// live next track. A completed track with no merge target (top of ladder) or an
// inactive/deleted target is NOT a candidate (§3.5).
export const promotionCandidates = query({
  args: {},
  handler: async (ctx): Promise<PromotionCandidate[]> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];

    const tracks = await ctx.db.query("tracks").collect();
    const trackById = new Map<string, Doc<"tracks">>();
    for (const t of tracks) trackById.set(t._id as unknown as string, t);

    const students = await ctx.db.query("students").collect();
    const unitCache = new Map<string, Id<"exercises">[]>();
    const atTime = Date.now();

    const out: PromotionCandidate[] = [];
    for (const s of students) {
      if (!s.trackId) continue;
      const progress = await trackProgressForStudent(ctx, s, { unitCache, atTime });
      if (!progress || !progress.isComplete) continue;
      const mergeId = progress.mergesIntoTrackId;
      if (!mergeId) continue; // top of track — no promotion
      const target = trackById.get(mergeId as unknown as string);
      if (!target || !target.active) continue; // inactive/deleted target
      out.push({
        studentId: s._id,
        name: s.name,
        fromTrackId: progress.trackId,
        fromTrackName: progress.trackName,
        toTrackId: mergeId,
        toTrackName: target.name,
      });
    }
    return out;
  },
});

// Promote a student into their track's mergesIntoTrackId. Human-gated: a teacher
// taps "Promote" on a candidate. Writes a promotions audit row and patches
// student.trackId (the same single-field patch setStudentTrack does — auth is
// guarded here, at the top). reason defaults to "completed-track" (the candidate
// flow); "manual" is for a hand-reassignment.
export const promoteStudent = mutation({
  args: {
    studentId: v.id("students"),
    reason: v.optional(v.string()), // "completed-track" | "manual"
  },
  handler: async (ctx, { studentId, reason }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");

    const student = await ctx.db.get(studentId);
    if (!student) throw new Error("Student not found");

    const track = await resolveTrackForStudent(ctx, student);
    if (!track?.mergesIntoTrackId) {
      throw new Error("This student's track has no promotion target");
    }
    const target = await ctx.db.get(track.mergesIntoTrackId);
    if (!target) throw new Error("Promotion target track not found");

    const teacherId = await resolveTeacherId(ctx);
    const reasonClean = reason === "manual" ? "manual" : "completed-track";
    await ctx.db.insert("promotions", {
      studentId,
      fromTrackId: track._id,
      toTrackId: track.mergesIntoTrackId,
      reason: reasonClean,
      ...(teacherId ? { byTeacherId: teacherId } : {}),
      at: Date.now(),
    });
    await ctx.db.patch(studentId, { trackId: track.mergesIntoTrackId });
    return {
      ok: true as const,
      toTrackId: track.mergesIntoTrackId,
      toTrackName: target.name,
    };
  },
});

export type StudentLeagueCard =
  | { hasTrack: false }
  | {
      hasTrack: true;
      trackId: Id<"tracks"> | null;
      trackName: string;
      nextTrackName: string | null;
      rank: number | null;
      leagueSize: number;
      pointsNew: number;
      clearedUnits: number;
      totalUnits: number;
      currentUnitId: string | null;
      isComplete: boolean;
    };

// Per-student league widget data (§3.4): league name, rank within it, progress,
// and the next league. Read-only. Ranks over the dates the caller passes.
export const studentLeagueCard = query({
  args: {
    studentId: v.id("students"),
    dates: v.array(v.string()),
  },
  handler: async (ctx, { studentId, dates }): Promise<StudentLeagueCard | null> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;

    const student = await ctx.db.get(studentId);
    if (!student) return null;
    if (!student.trackId) return { hasTrack: false };

    const leagues = await computeCohort(ctx, dates, student.trackId);
    const league = leagues[0];
    if (!league) return { hasTrack: false };

    const idx = league.students.findIndex(
      (s) => (s.studentId as unknown as string) === (studentId as unknown as string),
    );
    const me = idx >= 0 ? league.students[idx] : null;
    return {
      hasTrack: true,
      trackId: league.trackId,
      trackName: league.trackName,
      nextTrackName: league.mergesIntoTrackName,
      rank: idx >= 0 ? idx + 1 : null,
      leagueSize: league.students.length,
      pointsNew: me?.pointsNew ?? 0,
      clearedUnits: me?.clearedUnits ?? 0,
      totalUnits: me?.totalUnits ?? 0,
      currentUnitId: me?.currentUnitId ?? null,
      isComplete: me?.isComplete ?? false,
    };
  },
});
