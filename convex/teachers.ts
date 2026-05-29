import {
  internalMutation,
  mutation,
  query,
} from "./_generated/server";
import { v } from "convex/values";
import type { MutationCtx } from "./_generated/server";
import { normalizeToE164SL } from "./lib/phone";

export const list = query({
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    return await ctx.db.query("teachers").collect();
  },
});

export const getCurrent = query({
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;

    const teachers = await ctx.db
      .query("teachers")
      .withIndex("by_clerk_user", (q) =>
        q.eq("clerkUserId", identity.subject)
      )
      .collect();

    return teachers[0] ?? null;
  },
});

export const getByClerkUserId = query({
  args: { clerkUserId: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const teachers = await ctx.db
      .query("teachers")
      .withIndex("by_clerk_user", (q) =>
        q.eq("clerkUserId", args.clerkUserId)
      )
      .collect();
    return teachers[0] ?? null;
  },
});

// Valid role values. `teacher` is a legacy alias kept for backward compat —
// new assignments should pick `lead` or `correction` explicitly.
const VALID_ROLES = ["admin", "lead", "correction", "teacher"];

export const add = mutation({
  args: {
    clerkUserId: v.string(),
    name: v.string(),
    role: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");

    if (!VALID_ROLES.includes(args.role)) {
      throw new Error("Invalid role");
    }

    // Allow first teacher to self-register as admin (bootstrap)
    const allTeachers = await ctx.db.query("teachers").collect();
    if (allTeachers.length > 0) {
      // After bootstrap, only admins can add teachers
      const caller = allTeachers.find(
        (t) => t.clerkUserId === identity.subject
      );
      if (!caller || caller.role !== "admin") {
        throw new Error("Only admins can add teachers");
      }
    }

    // Idempotency guard. The historical absence of this check is how the
    // teachers table accumulated duplicates with the same clerkUserId,
    // which then broke any `.unique()` lookup downstream (planner's
    // resolveTeacherId crashed every saveSheetForStudent call).
    const existing = allTeachers.find(
      (t) => t.clerkUserId === args.clerkUserId,
    );
    if (existing) {
      throw new Error(
        `Teacher already exists for clerkUserId ${args.clerkUserId}`,
      );
    }

    return await ctx.db.insert("teachers", args);
  },
});

// Core dedupe routine. For each clerkUserId with >1 rows, keep the oldest
// by _creationTime, remap every FK on slotTeachers / sessionSubmissions /
// doubts / currentAssignments / generatedSheets / sheetOverrides to that
// keeper, then delete the dupes. Safe to re-run.
async function dedupeTeachersImpl(ctx: MutationCtx) {
    const all = await ctx.db.query("teachers").collect();
    type TeacherRow = (typeof all)[number];
    const byClerk = new Map<string, TeacherRow[]>();
    for (const t of all) {
      const list = byClerk.get(t.clerkUserId) ?? [];
      list.push(t);
      byClerk.set(t.clerkUserId, list);
    }

    const report: Array<{
      clerkUserId: string;
      keptId: string;
      removedIds: string[];
      remapped: {
        slotTeachers: number;
        sessionSubmissions: number;
        doubts: number;
        currentAssignments: number;
        generatedSheets: number;
        sheetOverrides: number;
      };
    }> = [];

    const entries = Array.from(byClerk.entries());
    for (const [clerkUserId, rows] of entries) {
      if (rows.length <= 1) continue;
      rows.sort(
        (a: TeacherRow, b: TeacherRow) =>
          a._creationTime - b._creationTime,
      );
      const keeper = rows[0];
      const dupes = rows.slice(1);

      const counters = {
        slotTeachers: 0,
        sessionSubmissions: 0,
        doubts: 0,
        currentAssignments: 0,
        generatedSheets: 0,
        sheetOverrides: 0,
      };

      for (const dupe of dupes) {
        // slotTeachers (required teacherId, has by_teacher index)
        const sts = await ctx.db
          .query("slotTeachers")
          .withIndex("by_teacher", (q) => q.eq("teacherId", dupe._id))
          .collect();
        for (const st of sts) {
          // Avoid creating a duplicate (slotId, teacherId) — if keeper is
          // already on this slot, drop the dupe row instead of remapping.
          const dup = await ctx.db
            .query("slotTeachers")
            .withIndex("by_slot", (q) => q.eq("slotId", st.slotId))
            .collect();
          const keeperAlready = dup.some((r) => r.teacherId === keeper._id);
          if (keeperAlready) {
            await ctx.db.delete(st._id);
          } else {
            await ctx.db.patch(st._id, { teacherId: keeper._id });
          }
          counters.slotTeachers += 1;
        }

        // sessionSubmissions (required teacherId, has by_teacher index)
        const subs = await ctx.db
          .query("sessionSubmissions")
          .withIndex("by_teacher", (q) => q.eq("teacherId", dupe._id))
          .collect();
        for (const s of subs) {
          await ctx.db.patch(s._id, { teacherId: keeper._id });
          counters.sessionSubmissions += 1;
        }

        // The remaining tables have optional teacher FKs and no index by
        // teacher — full table scan, but each table is small enough and
        // this is a one-shot operation.
        const doubts = await ctx.db.query("doubts").collect();
        for (const d of doubts) {
          if (d.resolvedByTeacherId === dupe._id) {
            await ctx.db.patch(d._id, { resolvedByTeacherId: keeper._id });
            counters.doubts += 1;
          }
        }

        const assignments = await ctx.db
          .query("currentAssignments")
          .collect();
        for (const a of assignments) {
          if (a.assignedByTeacherId === dupe._id) {
            await ctx.db.patch(a._id, { assignedByTeacherId: keeper._id });
            counters.currentAssignments += 1;
          }
        }

        const sheets = await ctx.db.query("generatedSheets").collect();
        for (const sh of sheets) {
          if (sh.generatedByTeacherId === dupe._id) {
            await ctx.db.patch(sh._id, {
              generatedByTeacherId: keeper._id,
            });
            counters.generatedSheets += 1;
          }
        }

        const overrides = await ctx.db.query("sheetOverrides").collect();
        for (const o of overrides) {
          if (o.byTeacherId === dupe._id) {
            await ctx.db.patch(o._id, { byTeacherId: keeper._id });
            counters.sheetOverrides += 1;
          }
        }

        await ctx.db.delete(dupe._id);
      }

      report.push({
        clerkUserId,
        keptId: keeper._id,
        removedIds: dupes.map((d: TeacherRow) => d._id),
        remapped: counters,
      });
    }

    return {
      duplicateGroups: report.length,
      details: report,
    };
}

// Admin-callable public dedupe (UI/dashboard entry point).
export const dedupeByClerkUser = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    const callers = await ctx.db
      .query("teachers")
      .withIndex("by_clerk_user", (q) =>
        q.eq("clerkUserId", identity.subject),
      )
      .collect();
    const caller = callers[0];
    if (!caller || caller.role !== "admin") {
      throw new Error("Only admins can dedupe teachers");
    }
    return await dedupeTeachersImpl(ctx);
  },
});

// CLI-only counterpart, runnable with `npx convex run teachers:dedupeByClerkUserInternal`.
// Same routine, no auth check (internal mutations can't be called from the
// network — only from the dashboard or convex CLI by a dev who already has
// deployment credentials).
export const dedupeByClerkUserInternal = internalMutation({
  args: {},
  handler: async (ctx) => {
    return await dedupeTeachersImpl(ctx);
  },
});

export const update = mutation({
  args: {
    id: v.id("teachers"),
    name: v.string(),
    role: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");

    if (!VALID_ROLES.includes(args.role)) {
      throw new Error("Invalid role");
    }

    // Only admins can update teachers
    const callers = await ctx.db
      .query("teachers")
      .withIndex("by_clerk_user", (q) =>
        q.eq("clerkUserId", identity.subject)
      )
      .collect();
    const caller = callers[0];
    if (!caller || caller.role !== "admin") {
      throw new Error("Only admins can update teachers");
    }

    const { id, ...data } = args;
    await ctx.db.patch(id, data);
  },
});

// Phase W.1.4: set the current user's own personalWhatsappPhone. No admin
// check — every teacher owns their own forward target. Accepts any input
// the SL phone normalizer can parse; clears the field when phone is empty.
export const setMyPersonalWhatsappPhone = mutation({
  args: { phone: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    const teacher = await ctx.db
      .query("teachers")
      .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", identity.subject))
      .first();
    if (!teacher) throw new Error("No teachers row for current user");
    const trimmed = args.phone.trim();
    if (trimmed === "") {
      await ctx.db.patch(teacher._id, { personalWhatsappPhone: undefined });
      return { phone: null };
    }
    const normalized = normalizeToE164SL(trimmed);
    await ctx.db.patch(teacher._id, { personalWhatsappPhone: normalized });
    return { phone: normalized };
  },
});

export const remove = mutation({
  args: { id: v.id("teachers") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");

    // Only admins can remove teachers
    const callers = await ctx.db
      .query("teachers")
      .withIndex("by_clerk_user", (q) =>
        q.eq("clerkUserId", identity.subject)
      )
      .collect();
    const caller = callers[0];
    if (!caller || caller.role !== "admin") {
      throw new Error("Only admins can remove teachers");
    }

    // Cascade: remove slot assignments
    const slotTeachers = await ctx.db
      .query("slotTeachers")
      .withIndex("by_teacher", (q) => q.eq("teacherId", args.id))
      .collect();
    for (const st of slotTeachers) await ctx.db.delete(st._id);

    await ctx.db.delete(args.id);
  },
});
