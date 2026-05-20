import { query } from "./_generated/server";
import { v } from "convex/values";
import { slotIdsForTeacher } from "./lib/roster";

// Slots a teacher runs. Phase F: resolves group-mentor slots ∪ any legacy
// slotTeachers rows (see convex/lib/roster.ts). Consumers (lead, score-entry)
// read only `.slotId`. The legacy assign/unassign mutations were removed with
// the old Settings → Schedule tab; group mentor assignment now lives on the
// group (groups.update { mentorId }).
export const listByTeacher = query({
  args: { teacherId: v.id("teachers") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const slotIds = await slotIdsForTeacher(ctx, args.teacherId);
    return slotIds.map((slotId) => ({ slotId, teacherId: args.teacherId }));
  },
});
