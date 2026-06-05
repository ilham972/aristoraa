// Phase 4 (railway map) — read-only geometry + position data for the train map.
//
// Tracks are train LINES (orderedUnitIds = stations); mergesIntoTrackId makes a
// DAG (a remedial line merges into an on-level line). A student is a MARKER at
// their current station. This module returns the line/merge geometry and each
// student's cleared-station set; the SVG component (railway-map.tsx) draws it.
//
// Unit human-names live in src/lib/curriculum-data.ts which Convex cannot import
// — trackMap accepts a `units` lookup arg (path.ts convention). Grade/term are
// also parsed from the unit-id pattern "M{n}-G{g}-T{t}-{i}" as a fallback.

import { query } from "../_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { trackProgressForStudent } from "./leagues";

// Parse grade/term out of a curriculum unit id ("M1-G7-T2-0"). Fallback for
// units the client didn't include in its metadata lookup.
function parseUnitId(unitId: string): { grade: number; term: number } | null {
  const m = /^M\d+-G(\d+)-T(\d+)-\d+$/.exec(unitId);
  if (!m) return null;
  return { grade: parseInt(m[1], 10), term: parseInt(m[2], 10) };
}

function todayYmdUtc(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(
    d.getUTCDate(),
  ).padStart(2, "0")}`;
}

export type MapStation = {
  unitId: string;
  unitName: string;
  grade: number;
  term: number;
};

export type MapTrack = {
  trackId: Id<"tracks">;
  name: string;
  level: number;
  targetGrade: number;
  targetTerm: number;
  active: boolean;
  mergesIntoTrackId: Id<"tracks"> | null;
  orderedUnitIds: MapStation[];
};

export type MapMerge = {
  fromTrackId: Id<"tracks">;
  toTrackId: Id<"tracks">;
  joinUnitId: string | null;
};

export type TrackMap = { tracks: MapTrack[]; merges: MapMerge[] };

// Full line + merge geometry. tracks ordered by level (more remedial first).
export const trackMap = query({
  args: {
    units: v.array(
      v.object({
        unitId: v.string(),
        unitName: v.string(),
        grade: v.number(),
        term: v.number(),
      }),
    ),
  },
  handler: async (ctx, { units }): Promise<TrackMap | null> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;

    const lookup = new Map<string, { unitName: string; grade: number; term: number }>();
    for (const u of units) lookup.set(u.unitId, u);

    const tracks = await ctx.db.query("tracks").collect();
    tracks.sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
    const trackById = new Map<string, Doc<"tracks">>();
    for (const t of tracks) trackById.set(t._id as unknown as string, t);

    const enrichStation = (uid: string): MapStation => {
      const meta = lookup.get(uid);
      const parsed = parseUnitId(uid);
      return {
        unitId: uid,
        unitName: meta?.unitName ?? uid,
        grade: meta?.grade ?? parsed?.grade ?? 0,
        term: meta?.term ?? parsed?.term ?? 0,
      };
    };

    const tracksOut: MapTrack[] = tracks.map((t) => ({
      trackId: t._id,
      name: t.name,
      level: t.level,
      targetGrade: t.targetGrade,
      targetTerm: t.targetTerm,
      active: t.active,
      mergesIntoTrackId: t.mergesIntoTrackId ?? null,
      orderedUnitIds: t.orderedUnitIds.map(enrichStation),
    }));

    // merges: edge from a track to the track it merges into. The join station is
    // the first unit of the target line that the source line also covers (the
    // rejoin point past shared work), else the target's first station. A missing
    // target → no edge (the line just renders without a connector — §4.5).
    const merges: MapMerge[] = [];
    for (const t of tracks) {
      if (!t.mergesIntoTrackId) continue;
      const target = trackById.get(t.mergesIntoTrackId as unknown as string);
      if (!target) continue;
      const fromSet = new Set(t.orderedUnitIds);
      const joinUnitId =
        target.orderedUnitIds.find((uid) => fromSet.has(uid)) ??
        target.orderedUnitIds[0] ??
        null;
      merges.push({
        fromTrackId: t._id,
        toTrackId: t.mergesIntoTrackId,
        joinUnitId,
      });
    }

    return { tracks: tracksOut, merges };
  },
});

export type StudentMapPosition = {
  trackId: Id<"tracks"> | null;
  currentUnitId: string | null;
  clearedUnitIds: string[];
  isComplete: boolean;
};

// Thin wrapper over trackProgressForStudent → the per-station cleared set for
// the marker. trackId null when the student has no track (map shows no marker).
export const studentMapPosition = query({
  args: { studentId: v.id("students") },
  handler: async (ctx, { studentId }): Promise<StudentMapPosition | null> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const student = await ctx.db.get(studentId);
    if (!student) return null;
    const progress = await trackProgressForStudent(ctx, student);
    if (!progress) {
      return { trackId: null, currentUnitId: null, clearedUnitIds: [], isComplete: false };
    }
    return {
      trackId: progress.trackId,
      currentUnitId: progress.currentUnitId,
      clearedUnitIds: progress.clearedUnitIds,
      isComplete: progress.isComplete,
    };
  },
});

export type StudentShareData = {
  hasTrack: boolean;
  trackId: Id<"tracks"> | null;
  trackName: string | null;
  targetGrade: number | null;
  targetTerm: number | null;
  orderedUnitIds: string[]; // names resolved client-side via findUnit
  clearedUnitIds: string[];
  currentUnitId: string | null;
  clearedUnits: number;
  totalUnits: number;
  isComplete: boolean;
  nextExamDate: string | null;
  promotions: Array<{ at: number; fromTrackName: string | null; toTrackName: string }>;
};

// Everything the parent-share PNG needs in one round-trip (§4.4): the student's
// own line, their position, the target exam date (examCalendar at the track's
// target grade/term, soonest upcoming else latest), and their promotion history.
export const studentShareData = query({
  args: { studentId: v.id("students") },
  handler: async (ctx, { studentId }): Promise<StudentShareData | null> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const student = await ctx.db.get(studentId);
    if (!student) return null;

    const progress = await trackProgressForStudent(ctx, student);
    if (!progress) {
      return {
        hasTrack: false,
        trackId: null,
        trackName: null,
        targetGrade: null,
        targetTerm: null,
        orderedUnitIds: [],
        clearedUnitIds: [],
        currentUnitId: null,
        clearedUnits: 0,
        totalUnits: 0,
        isComplete: false,
        nextExamDate: null,
        promotions: [],
      };
    }

    const track = await ctx.db.get(progress.trackId);

    // Target exam: examCalendar rows for the track's target grade, term-matched;
    // prefer the soonest date today-or-later, else the most recent.
    let nextExamDate: string | null = null;
    if (track) {
      const exams = await ctx.db
        .query("examCalendar")
        .withIndex("by_grade", (q) => q.eq("grade", track.targetGrade))
        .collect();
      const matched = exams
        .filter((e) => e.term === track.targetTerm)
        .sort((a, b) => a.examDate.localeCompare(b.examDate));
      if (matched.length > 0) {
        const today = todayYmdUtc();
        nextExamDate = matched.find((e) => e.examDate >= today)?.examDate ??
          matched[matched.length - 1].examDate;
      }
    }

    // Promotion history (oldest → newest), with resolved track names.
    const promoRows = await ctx.db
      .query("promotions")
      .withIndex("by_student", (q) => q.eq("studentId", studentId))
      .collect();
    promoRows.sort((a, b) => a.at - b.at);
    const promotions = await Promise.all(
      promoRows.map(async (p) => {
        const from = p.fromTrackId ? await ctx.db.get(p.fromTrackId) : null;
        const to = await ctx.db.get(p.toTrackId);
        return {
          at: p.at,
          fromTrackName: from?.name ?? null,
          toTrackName: to?.name ?? "(track)",
        };
      }),
    );

    return {
      hasTrack: true,
      trackId: progress.trackId,
      trackName: progress.trackName,
      targetGrade: track?.targetGrade ?? null,
      targetTerm: track?.targetTerm ?? null,
      orderedUnitIds: track?.orderedUnitIds ?? [],
      clearedUnitIds: progress.clearedUnitIds,
      currentUnitId: progress.currentUnitId,
      clearedUnits: progress.clearedUnits,
      totalUnits: progress.totalUnits,
      isComplete: progress.isComplete,
      nextExamDate,
      promotions,
    };
  },
});
