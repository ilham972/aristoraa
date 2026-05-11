import { mutation, query } from "../_generated/server";
import { v } from "convex/values";
import { Doc, Id } from "../_generated/dataModel";
import { applyAttempt } from "./memory";

const MS_PER_DAY = 86_400_000;
// Synthesise per-question timestamps inside an entry's day so attemptLog
// rows have distinct occurredAt values. 09:00 UTC + (index minutes).
const SYNTHETIC_BASE_HOUR_UTC = 9;

// Parse YYYY-MM-DD as UTC midnight + SYNTHETIC_BASE_HOUR_UTC.
function entryBaseTimeMs(dateStr: string): number {
  // dateStr shape "2026-04-15" — accepted as-is by Date.parse with "T..Z".
  const t = Date.parse(`${dateStr}T0${SYNTHETIC_BASE_HOUR_UTC}:00:00Z`);
  if (Number.isNaN(t)) {
    throw new Error(`backfill: cannot parse entry.date '${dateStr}'`);
  }
  return t;
}

// Pull the upper bound (max occurredAt with source = "backfill") for one
// student so re-runs pick up only entries newer than what's already been
// processed. Returns -Infinity when no backfill rows exist yet.
async function lastBackfilledOccurredAt(
  ctx: { db: { query: any } },
  studentId: Id<"students">,
): Promise<number> {
  // Index by_student_time is (studentId, occurredAt). We can scan descending
  // and stop at the first row tagged "backfill".
  const rows = await ctx.db
    .query("attemptLog")
    .withIndex("by_student_time", (q: any) => q.eq("studentId", studentId))
    .order("desc")
    .collect();
  for (const r of rows as Array<Doc<"attemptLog">>) {
    if (r.source === "backfill") return r.occurredAt;
  }
  return -Infinity;
}

// Phase A.4 — backfill one student's full entries history into memoryState +
// attemptLog. Idempotent: re-running only processes entries with date strictly
// newer than the most recent prior backfill row.
//
// One student per mutation is a deliberate boundary — even ~1 year of dense
// entries fits comfortably under Convex's per-mutation write limits, and per-
// student transactions mean partial failures don't poison other students.
export const backfillStudent = mutation({
  args: { studentId: v.id("students") },
  handler: async (ctx, { studentId }) => {
    const cutoffMs = await lastBackfilledOccurredAt(ctx, studentId);

    // Pull all entries for the student in chronological order.
    const entries: Array<Doc<"entries">> = await ctx.db
      .query("entries")
      .withIndex("by_student", (q) => q.eq("studentId", studentId))
      .collect();
    entries.sort((a, b) => a.date.localeCompare(b.date));

    let processedEntries = 0;
    let attemptsRecorded = 0;
    let questionsSkipped = 0;
    let conceptUpdates = 0;

    for (const entry of entries) {
      const baseMs = entryBaseTimeMs(entry.date);
      // Cheap skip: if the entire entry's day is at or before cutoff, drop it.
      // We compare on the day boundary to avoid double-counting same-day
      // partial backfills (re-runs always start fresh from the next day).
      if (baseMs <= cutoffMs) continue;

      const questions = (entry.questions ?? {}) as Record<string, string>;
      // Deterministic key order so re-runs assign identical synthetic times
      // to the same question rows.
      const keys = Object.keys(questions).sort();

      for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        const state = questions[key];
        // Skip / unmarked do not become attempts.
        if (state !== "correct" && state !== "wrong") {
          questionsSkipped += 1;
          continue;
        }
        const response = state === "correct" ? "good" : "again";
        const occurredAt = baseMs + i * 60_000;

        const res = await applyAttempt(ctx, {
          studentId,
          exerciseId: entry.exerciseId,
          questionKey: key,
          response,
          occurredAt,
          // Force tag "backfill" so lastBackfilledOccurredAt picks these up
          // and live runs of recordAttempt are never mistaken for backfill.
          source: "backfill",
        });
        attemptsRecorded += 1;
        conceptUpdates += res.updatedConcepts;
      }
      processedEntries += 1;
    }

    return {
      processedEntries,
      attemptsRecorded,
      questionsSkipped,
      conceptUpdates,
      resumedFromMs: cutoffMs === -Infinity ? null : cutoffMs,
    };
  },
});

// Read-only roll-up so a UI (or admin) can see backfill status per student
// without running it: counts of entries, attemptLog rows, and last backfill
// timestamp. Cheap because each is a single index scan.
export const backfillStatus = query({
  args: { studentId: v.id("students") },
  handler: async (ctx, { studentId }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const entries = await ctx.db
      .query("entries")
      .withIndex("by_student", (q) => q.eq("studentId", studentId))
      .collect();
    const logs = await ctx.db
      .query("attemptLog")
      .withIndex("by_student_time", (q) => q.eq("studentId", studentId))
      .collect();
    let backfillLogs = 0;
    let lastBackfillAt: number | null = null;
    for (const r of logs) {
      if (r.source === "backfill") {
        backfillLogs += 1;
        if (lastBackfillAt === null || r.occurredAt > lastBackfillAt) {
          lastBackfillAt = r.occurredAt;
        }
      }
    }
    return {
      entryCount: entries.length,
      attemptLogTotal: logs.length,
      backfillLogCount: backfillLogs,
      lastBackfillAt,
    };
  },
});
