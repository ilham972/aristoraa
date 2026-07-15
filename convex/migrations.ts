import { mutation } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { tryNormalizeToE164SL } from "./lib/phone";
import { findContiguousRuns, type RoomedSlot } from "./lib/slotNormalize";
import { absorbSlotData } from "./lib/slotMerge";

// Day-of-week to moduleId mapping (the default timetable)
const DAY_TO_MODULE: Record<string, string> = {
  "1": "M1", // Monday → Numbers & Arithmetic
  "2": "M2", // Tuesday → Algebra, Graphs & Matrices
  "3": "M3", // Wednesday → Geometry & Constructions
  "4": "M4", // Thursday → Measurements
  "5": "M5", // Friday → Statistics
  "6": "M6", // Saturday → Sets & Probability
};

/**
 * One-time migration: backfill rooms with the default moduleTimetable
 * if they don't already have one.
 *
 * Run via: npx convex run migrations:backfillRoomTimetables
 */
export const backfillRoomTimetables = mutation({
  handler: async (ctx) => {
    const rooms = await ctx.db.query("rooms").collect();
    let updated = 0;
    let skipped = 0;

    for (const room of rooms) {
      if (room.moduleTimetable && Object.keys(room.moduleTimetable as Record<string, string>).length > 0) {
        skipped++;
        continue;
      }
      await ctx.db.patch(room._id, { moduleTimetable: { ...DAY_TO_MODULE } });
      updated++;
    }

    return `Migration complete: ${updated} rooms updated, ${skipped} already had timetables, ${rooms.length} total rooms`;
  },
});

/**
 * One-time migration (2026-07-15): delete textbook crops whose
 * linkedExerciseId points at a deleted exercise. These are invisible to every
 * planner ladder (the dangling link excludes them from questionsTaggedToConcept)
 * — on prod all 52 were stale duplicates left behind by a delete-and-recreate
 * of two G11 exercises; the live re-crops exist alongside them. Skips any crop
 * referenced by a generated/group sheet (kept but unlinked, same rule as the
 * new exercises.cleanupCropsForExercise guard).
 *
 * Dry run: npx convex run migrations:cleanupOrphanCrops
 * Commit:  npx convex run migrations:cleanupOrphanCrops '{"commit":true}' --prod
 */
export const cleanupOrphanCrops = mutation({
  args: { commit: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const commit = args.commit === true;
    const exerciseIds = new Set<string>(
      (await ctx.db.query("exercises").collect()).map(
        (e) => e._id as unknown as string,
      ),
    );
    const referenced = new Set<string>();
    for (const sh of await ctx.db.query("generatedSheets").collect()) {
      for (const qid of [
        ...sh.warmupQuestionIds,
        ...sh.mainQuestionIds,
        ...(sh.revisionQuestionIds ?? []),
        ...sh.examPrepQuestionIds,
      ])
        referenced.add(qid as unknown as string);
    }
    for (const gs of await ctx.db.query("groupSheets").collect()) {
      for (const qid of [...gs.newQuestionIds, ...gs.spiralQuestionIds])
        referenced.add(qid as unknown as string);
    }

    let deleted = 0;
    let unlinked = 0;
    for (const q of await ctx.db.query("questionBank").collect()) {
      if (!q.linkedExerciseId) continue;
      if (exerciseIds.has(q.linkedExerciseId as unknown as string)) continue;
      if (referenced.has(q._id as unknown as string)) {
        unlinked += 1;
        if (commit) await ctx.db.patch(q._id, { linkedExerciseId: undefined });
      } else {
        deleted += 1;
        if (commit) {
          const joins = await ctx.db
            .query("questionConcepts")
            .withIndex("by_question", (qq) => qq.eq("questionId", q._id))
            .collect();
          for (const j of joins) await ctx.db.delete(j._id);
          await ctx.db.delete(q._id);
        }
      }
    }
    return { mode: commit ? "committed" : "dry-run", deleted, unlinked };
  },
});

/**
 * One-time migration: stamp every group without a loggingStartDate with
 * today's local date. After this runs, all historical Day-view sessions
 * (which existed in the schedule before app adoption) become "pre-tracking"
 * and stop polluting revenue/attendance analytics.
 *
 * Run via: npx convex run migrations:backfillLoggingStartDate
 * Pass a custom date with: npx convex run migrations:backfillLoggingStartDate '{"date":"2026-05-28"}'
 */
export const backfillLoggingStartDate = mutation({
  args: {
    // Optional override. When omitted we use the date the migration runs.
    date: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const today =
      args.date ??
      (() => {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      })();

    const groups = await ctx.db.query("groups").collect();
    let updated = 0;
    let skipped = 0;
    for (const g of groups) {
      if (g.loggingStartDate) {
        skipped += 1;
        continue;
      }
      await ctx.db.patch(g._id, { loggingStartDate: today });
      updated += 1;
    }
    return `Migration complete: ${updated} groups stamped with ${today}, ${skipped} already had a loggingStartDate`;
  },
});

/**
 * Phase W.1.1: normalize every students.parentPhone to Sri Lankan E.164.
 *
 * Reads every students row. For each:
 *   - Already-E.164 and valid → skip (counted under `alreadyNormalized`).
 *   - Local "0XXXXXXXXX" or international "94XXXXXXXXX" → normalize and patch.
 *   - Unparseable (foreign / garbage / missing digits) → leave the field as-is
 *     and add the row to `rejected` so the founder can fix by hand.
 *
 * Run from the project root:
 *   npx convex run migrations:normalizeParentPhones
 *
 * Add `'{"dryRun":true}'` to see the diff without writing.
 *
 * Per the W.1 brainstorm decision (Q-a), the Settings page in W.1.4 will
 * invoke this with a "Normalize phones" button so the founder reviews the
 * `rejected` list before any WhatsApp send goes out.
 */
export const normalizeParentPhones = mutation({
  args: {
    dryRun: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const dryRun = args.dryRun ?? false;
    const students = await ctx.db.query("students").collect();
    let normalized = 0;
    let alreadyNormalized = 0;
    const rejected: Array<{ id: string; name: string; parentPhone: string }> = [];
    for (const s of students) {
      const result = tryNormalizeToE164SL(s.parentPhone);
      if (result === null) {
        rejected.push({ id: s._id, name: s.name, parentPhone: s.parentPhone });
        continue;
      }
      if (result === s.parentPhone) {
        alreadyNormalized += 1;
        continue;
      }
      if (!dryRun) {
        await ctx.db.patch(s._id, { parentPhone: result });
      }
      normalized += 1;
    }
    return {
      dryRun,
      total: students.length,
      normalized,
      alreadyNormalized,
      rejectedCount: rejected.length,
      rejected,
    };
  },
});

/**
 * Fuse contiguous same-room slots of the same group on the same day into a
 * single multi-hour scheduleSlot, so a 3–5pm class is one row (one Day-view
 * card, one attendance/payment/submit pass) instead of two 1-hour atoms.
 *
 * Dry-run by default — returns a report without mutating. Pass
 * '{"commit": true}' to apply. See design spec §3 for conflict rules:
 *   - attendance: present wins; payments summed; sessionLogs held>cancelled
 *     (all handled by absorbSlotData)
 *   - submission: the fused block counts as submitted only if EVERY atom was
 *     submitted for that date, else the merged submission row is dropped so
 *     the block re-prompts.
 *
 * Run via:
 *   npx convex run migrations:fuseContiguousSlots            (dry-run)
 *   npx convex run migrations:fuseContiguousSlots '{"commit": true}'
 */
export const fuseContiguousSlots = mutation({
  args: { commit: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    // No auth gate — run from the CLI (`npx convex run`), which is gated by
    // Convex deploy credentials, matching the other migrations in this file.
    const commit = args.commit === true;
    const allSlots = await ctx.db.query("scheduleSlots").collect();

    // Bucket live (group-owned) slots by group|day.
    const buckets = new Map<string, RoomedSlot[]>();
    for (const s of allSlots) {
      if (!s.groupId) continue;
      const key = `${s.groupId}|${s.dayOfWeek}`;
      const arr = buckets.get(key) ?? [];
      arr.push({ id: s._id, startTime: s.startTime, endTime: s.endTime, roomId: s.roomId });
      buckets.set(key, arr);
    }

    let runsToFuse = 0;
    let slotsAbsorbed = 0;
    let submissionConflicts = 0; // (run, date) pairs where not all atoms submitted
    const examples: string[] = [];

    for (const [key, slots] of Array.from(buckets.entries())) {
      const runs = findContiguousRuns(slots);
      for (const run of runs) {
        if (run.length < 2) continue;
        runsToFuse += 1;
        slotsAbsorbed += run.length - 1;

        const ordered = run
          .map((id) => slots.find((s: RoomedSlot) => s.id === id)!)
          .sort((a, b) => a.startTime.localeCompare(b.startTime));
        const canonical = ordered[0];
        const runEnd = ordered[ordered.length - 1].endTime;

        if (examples.length < 10) {
          examples.push(`${key}: ${canonical.startTime}-${runEnd} (${run.length} atoms)`);
        }

        // Per-date count of how many atoms in this run carry a submission.
        const subCountByDate = new Map<string, number>();
        for (const s of ordered) {
          const subs = await ctx.db
            .query("sessionSubmissions")
            .withIndex("by_slot_date", (q) =>
              q.eq("slotId", s.id as Id<"scheduleSlots">),
            )
            .collect();
          const datesSeen = new Set<string>();
          for (const sub of subs) {
            if (datesSeen.has(sub.date)) continue;
            datesSeen.add(sub.date);
            subCountByDate.set(sub.date, (subCountByDate.get(sub.date) ?? 0) + 1);
          }
        }
        for (const count of Array.from(subCountByDate.values())) {
          if (count < ordered.length) submissionConflicts += 1;
        }

        if (commit) {
          // Extend canonical to cover the whole run.
          await ctx.db.patch(canonical.id as Id<"scheduleSlots">, { endTime: runEnd });
          // Absorb + delete the rest.
          for (let i = 1; i < ordered.length; i++) {
            await absorbSlotData(
              ctx,
              ordered[i].id as Id<"scheduleSlots">,
              canonical.id as Id<"scheduleSlots">,
            );
            await ctx.db.delete(ordered[i].id as Id<"scheduleSlots">);
          }
          // Enforce the all-atoms submission rule: drop the canonical's merged
          // submission row for any date where not every atom was submitted.
          for (const [date, count] of Array.from(subCountByDate.entries())) {
            if (count >= ordered.length) continue;
            const rows = await ctx.db
              .query("sessionSubmissions")
              .withIndex("by_slot_date", (q) =>
                q.eq("slotId", canonical.id as Id<"scheduleSlots">).eq("date", date),
              )
              .collect();
            for (const r of rows) await ctx.db.delete(r._id);
          }
        }
      }
    }

    return {
      mode: commit ? "committed" : "dry-run",
      runsToFuse,
      slotsAbsorbed,
      submissionConflicts,
      examples,
    };
  },
});
