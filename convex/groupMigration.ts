// One-time admin utility: wipe ALL scheduling data for a clean slate.
//
// The user opted NOT to import the legacy schedule — they're rebuilding
// groups + slots from scratch in /groups. This clears every scheduling table
// so nothing old lingers in /groups or score-entry. Curriculum, question
// bank, students, and progress (entries/attendance) are NOT touched.
//
// Run via: npx convex run groupMigration:resetScheduleData --prod
// (irreversible — only the scheduling layer is removed). Defined as an
// internalMutation so it is NOT exposed on the public API (no client can call
// it); `convex run` invokes it with admin auth, so no user-identity check.

import { internalMutation } from "./_generated/server";

export const resetScheduleData = internalMutation({
  handler: async (ctx) => {
    const tables = [
      "groupMembers",
      "groups",
      "slotStudents",
      "slotTeachers",
      "slotOverrides",
      "scheduleSlots",
    ] as const;

    const deleted: Record<string, number> = {};
    for (const table of tables) {
      const rows = await ctx.db.query(table).collect();
      for (const row of rows) await ctx.db.delete(row._id);
      deleted[table] = rows.length;
    }
    return deleted;
  },
});
