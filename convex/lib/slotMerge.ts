// Move every per-(slot,date) record from `fromSlotId` onto `toSlotId`,
// resolving conflicts with the approved rules (see design spec §3). Pure
// arithmetic lives in slotNormalize; this file owns the DB walk only.

import type { GenericMutationCtx } from "convex/server";
import type { DataModel, Id } from "../_generated/dataModel";
import { mergeAttendanceStatus, mergeLogStatus } from "./slotNormalize";

type Ctx = GenericMutationCtx<DataModel>;

export async function absorbSlotData(
  ctx: Ctx,
  fromSlotId: Id<"scheduleSlots">,
  toSlotId: Id<"scheduleSlots">,
): Promise<void> {
  if (fromSlotId === toSlotId) return;

  // ── attendance: per (date, student); present wins, OR sessionFinished ──
  const fromAtt = await ctx.db
    .query("attendance")
    .withIndex("by_slot_date", (q) => q.eq("slotId", fromSlotId))
    .collect();
  for (const a of fromAtt) {
    const targetRows = await ctx.db
      .query("attendance")
      .withIndex("by_slot_date", (q) => q.eq("slotId", toSlotId).eq("date", a.date))
      .collect();
    const target = targetRows.find((t) => t.studentId === a.studentId);
    if (target) {
      await ctx.db.patch(target._id, {
        status: mergeAttendanceStatus([target.status, a.status]) ?? target.status,
        sessionFinished: target.sessionFinished || a.sessionFinished || undefined,
      });
      await ctx.db.delete(a._id);
    } else {
      await ctx.db.patch(a._id, { slotId: toSlotId });
    }
  }

  // ── sessionPayments: summed (collapse to one row per date+student) ──
  const fromPay = await ctx.db
    .query("sessionPayments")
    .withIndex("by_slot_date", (q) => q.eq("slotId", fromSlotId))
    .collect();
  for (const p of fromPay) {
    const targetRows = await ctx.db
      .query("sessionPayments")
      .withIndex("by_slot_date_student", (q) =>
        q.eq("slotId", toSlotId).eq("date", p.date).eq("studentId", p.studentId),
      )
      .collect();
    if (targetRows.length > 0) {
      await ctx.db.patch(targetRows[0]._id, {
        amount: targetRows[0].amount + p.amount,
        paidAt: Math.max(targetRows[0].paidAt, p.paidAt),
      });
      await ctx.db.delete(p._id);
    } else {
      await ctx.db.patch(p._id, { slotId: toSlotId });
    }
  }

  // ── sessionLogs: held > cancelled > none (one row per date) ──
  const fromLogs = await ctx.db
    .query("sessionLogs")
    .withIndex("by_slot_date", (q) => q.eq("slotId", fromSlotId))
    .collect();
  for (const l of fromLogs) {
    const targetRows = await ctx.db
      .query("sessionLogs")
      .withIndex("by_slot_date", (q) => q.eq("slotId", toSlotId).eq("date", l.date))
      .collect();
    const target = targetRows[0];
    if (target) {
      const winner = mergeLogStatus([target.status, l.status]);
      const keepFrom = winner === l.status && winner !== target.status;
      await ctx.db.patch(target._id, {
        status: winner ?? target.status,
        reason:
          winner === "cancelled_by_tutor"
            ? keepFrom
              ? l.reason
              : target.reason
            : undefined,
        note: keepFrom ? l.note : target.note,
        loggedAt: Math.max(target.loggedAt, l.loggedAt),
      });
      await ctx.db.delete(l._id);
    } else {
      await ctx.db.patch(l._id, { slotId: toSlotId });
    }
  }

  // ── sessionSubmissions: keep one row per date; sum the counts so a kept
  // row reflects the whole block. (The migration enforces the "submitted only
  // if ALL atoms submitted" rule separately.) ──
  const fromSubs = await ctx.db
    .query("sessionSubmissions")
    .withIndex("by_slot_date", (q) => q.eq("slotId", fromSlotId))
    .collect();
  for (const s of fromSubs) {
    const targetRows = await ctx.db
      .query("sessionSubmissions")
      .withIndex("by_slot_date", (q) => q.eq("slotId", toSlotId).eq("date", s.date))
      .collect();
    if (targetRows[0]) {
      await ctx.db.patch(targetRows[0]._id, {
        presentCount: targetRows[0].presentCount + s.presentCount,
        absentCount: targetRows[0].absentCount + s.absentCount,
        entryCount: targetRows[0].entryCount + s.entryCount,
        submittedAt: Math.max(targetRows[0].submittedAt, s.submittedAt),
      });
      await ctx.db.delete(s._id);
    } else {
      await ctx.db.patch(s._id, { slotId: toSlotId });
    }
  }

  // ── slotOverrides: dedupe by (date, student) ──
  const fromOv = await ctx.db
    .query("slotOverrides")
    .withIndex("by_slot_date", (q) => q.eq("slotId", fromSlotId))
    .collect();
  for (const o of fromOv) {
    const targetRows = await ctx.db
      .query("slotOverrides")
      .withIndex("by_slot_date", (q) => q.eq("slotId", toSlotId).eq("date", o.date))
      .collect();
    const dupe = targetRows.find((t) => t.studentId === o.studentId);
    if (dupe) await ctx.db.delete(o._id);
    else await ctx.db.patch(o._id, { slotId: toSlotId });
  }

  // ── slotStudents (legacy roster): dedupe by student ──
  const fromSS = await ctx.db
    .query("slotStudents")
    .withIndex("by_slot", (q) => q.eq("slotId", fromSlotId))
    .collect();
  for (const ss of fromSS) {
    const targetRows = await ctx.db
      .query("slotStudents")
      .withIndex("by_slot", (q) => q.eq("slotId", toSlotId))
      .collect();
    const dupe = targetRows.find((t) => t.studentId === ss.studentId);
    if (dupe) await ctx.db.delete(ss._id);
    else await ctx.db.patch(ss._id, { slotId: toSlotId });
  }

  // ── slotTeachers: dedupe by teacher ──
  const fromST = await ctx.db
    .query("slotTeachers")
    .withIndex("by_slot", (q) => q.eq("slotId", fromSlotId))
    .collect();
  for (const st of fromST) {
    const targetRows = await ctx.db
      .query("slotTeachers")
      .withIndex("by_slot", (q) => q.eq("slotId", toSlotId))
      .collect();
    const dupe = targetRows.find((t) => t.teacherId === st.teacherId);
    if (dupe) await ctx.db.delete(st._id);
    else await ctx.db.patch(st._id, { slotId: toSlotId });
  }

  // ── entries (scoring): slotId is metadata only — re-point all ──
  const fromEntries = await ctx.db
    .query("entries")
    .withIndex("by_slot", (q) => q.eq("slotId", fromSlotId))
    .collect();
  for (const e of fromEntries) {
    await ctx.db.patch(e._id, { slotId: toSlotId });
  }
}
