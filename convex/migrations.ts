import { mutation } from "./_generated/server";

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
