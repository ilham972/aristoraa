import { mutation } from "./_generated/server";
import { v } from "convex/values";

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
