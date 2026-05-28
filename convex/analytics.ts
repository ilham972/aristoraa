// Business-intelligence queries for /analytics. This file is the BI brain
// for the app — Pulse / Finance / Operations / Students / Growth tabs all
// read from here. Existing per-tab queries in groups.ts + sessionRecords.ts
// stay where they are (Revenue/Attendance tabs still use them); analytics.ts
// only adds the new aggregates the executive view needs:
//
//   • pulseSnapshot         — KPI strip + 30-day revenue sparkline
//   • cancellationBreakdown — sessions cancelled, grouped by reason, with
//                             lost revenue per reason
//   • lostRevenue           — Σ expected on cancelled + absent + unlogged
//                             sessions inside the range
//   • creditAging           — outstanding credit bucketed by age (0–7d,
//                             8–30d, 30+d)
//   • capacityUtilization   — per-group fill rate (members vs maxSize)
//   • acquisitionByMonth    — new students per month (from joinedAt /
//                             groupMembers row creation)
//   • cohortRetention       — % of each month's joiners still active
//   • studentsAtRisk        — students with <70% attendance OR 3+ absences
//                             in the last 14 days
//
// Every aggregate respects groups.loggingStartDate: any session before its
// group's start date is invisible.

import { query } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { RATE_DEFAULT_LKR } from "./groups";

// ── Local helpers ────────────────────────────────────────────────────────

function hoursBetween(startHHMM: string, endHHMM: string): number {
  const [sh, sm] = startHHMM.split(":").map(Number);
  const [eh, em] = endHHMM.split(":").map(Number);
  return Math.max(0, (eh + em / 60) - (sh + sm / 60));
}

function resolveRate(memberRate: number | undefined, studentRate: number | undefined): number {
  if (memberRate !== undefined) return memberRate;
  if (studentRate !== undefined) return studentRate;
  return RATE_DEFAULT_LKR;
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function ymOnly(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// ── pulseSnapshot ────────────────────────────────────────────────────────
//
// Single query feeding the Pulse tab's KPI strip + 30-day sparkline. The
// goal is one round-trip read so the executive view paints in one frame.
//
// Returns absolute revenue/attendance/compliance numbers for two windows
// (the chosen range + the previous identical range, so the UI can compute
// % change without another query). Also returns a per-day series for the
// chosen range so the Pulse view can render a sparkline.

export const pulseSnapshot = query({
  args: { days: v.optional(v.number()) },
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const days = 30;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const cutoff = new Date(today);
    cutoff.setDate(cutoff.getDate() - (days - 1));
    const prevCutoff = new Date(cutoff);
    prevCutoff.setDate(prevCutoff.getDate() - days);
    const prevEnd = new Date(cutoff);
    prevEnd.setDate(prevEnd.getDate() - 1);

    const cutoffYmd = ymd(cutoff);
    const prevCutoffYmd = ymd(prevCutoff);
    const prevEndYmd = ymd(prevEnd);
    const todayYmd = ymd(today);

    const [groups, members, slots, attendance, payments, students, logs] =
      await Promise.all([
        ctx.db.query("groups").collect(),
        ctx.db.query("groupMembers").collect(),
        ctx.db.query("scheduleSlots").collect(),
        ctx.db.query("attendance").collect(),
        ctx.db.query("sessionPayments").collect(),
        ctx.db.query("students").collect(),
        ctx.db.query("sessionLogs").collect(),
      ]);

    const groupById = new Map(groups.map((g) => [g._id, g]));
    const slotById = new Map(slots.map((s) => [s._id, s]));
    const studentById = new Map(students.map((s) => [s._id, s]));

    const rateByGroupStudent = new Map<string, number>();
    for (const m of members) {
      const s = studentById.get(m.studentId);
      rateByGroupStudent.set(
        `${m.groupId}|${m.studentId}`,
        resolveRate(m.hourlyRate, s?.hourlyRate),
      );
    }

    const isPreTracking = (slotId: Id<"scheduleSlots">, date: string): boolean => {
      const slot = slotById.get(slotId);
      if (!slot || !slot.groupId) return false;
      const g = groupById.get(slot.groupId);
      if (!g || !g.loggingStartDate) return false;
      return date < g.loggingStartDate;
    };

    // Build daily revenue map (realized = Σ payments by date).
    const realizedByDay = new Map<string, number>();
    for (const p of payments) {
      if (p.date < prevCutoffYmd || p.date > todayYmd) continue;
      if (isPreTracking(p.slotId, p.date)) continue;
      realizedByDay.set(p.date, (realizedByDay.get(p.date) ?? 0) + p.amount);
    }

    // Range sums.
    let revenueRange = 0;
    let revenuePrev = 0;
    for (const [d, amt] of Array.from(realizedByDay.entries())) {
      if (d >= cutoffYmd && d <= todayYmd) revenueRange += amt;
      else if (d >= prevCutoffYmd && d <= prevEndYmd) revenuePrev += amt;
    }

    // Attendance % across range (present / (present + absent)).
    let presentInRange = 0;
    let absentInRange = 0;
    let presentPrev = 0;
    let absentPrev = 0;
    for (const a of attendance) {
      if (isPreTracking(a.slotId, a.date)) continue;
      if (a.date >= cutoffYmd && a.date <= todayYmd) {
        if (a.status === "present") presentInRange += 1;
        else if (a.status === "absent") absentInRange += 1;
      } else if (a.date >= prevCutoffYmd && a.date <= prevEndYmd) {
        if (a.status === "present") presentPrev += 1;
        else if (a.status === "absent") absentPrev += 1;
      }
    }
    const attendancePct =
      presentInRange + absentInRange === 0
        ? 0
        : Math.round((presentInRange / (presentInRange + absentInRange)) * 100);
    const attendancePctPrev =
      presentPrev + absentPrev === 0
        ? 0
        : Math.round((presentPrev / (presentPrev + absentPrev)) * 100);

    // Log compliance (held+cancelled) / scheduled, range only.
    const logsInRange = logs.filter(
      (l) =>
        l.date >= cutoffYmd && l.date <= todayYmd && !isPreTracking(l.slotId, l.date),
    );
    const sessionsHeld = logsInRange.filter((l) => l.status === "held").length;
    const sessionsCancelled = logsInRange.filter((l) => l.status === "cancelled_by_tutor").length;

    // Walk window to count scheduled-past sessions for compliance + unlogged.
    let sessionsScheduled = 0;
    let sessionsUnlogged = 0;
    const now = new Date();
    const loggedKey = new Set(logsInRange.map((l) => `${l.slotId}|${l.date}`));
    for (let i = 0; i < days; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - (days - 1 - i));
      const dateStr = ymd(d);
      const dow = d.getDay() === 0 ? 7 : d.getDay();
      const slotsToday = slots.filter((s) => s.dayOfWeek === dow && s.groupId);
      for (const slot of slotsToday) {
        const g = groupById.get(slot.groupId!);
        if (!g) continue;
        if (g.loggingStartDate && dateStr < g.loggingStartDate) continue;
        const [h, m] = slot.startTime.split(":").map(Number);
        const sessionStart = new Date(d);
        sessionStart.setHours(h, m, 0, 0);
        if (sessionStart >= now) continue;
        sessionsScheduled += 1;
        if (!loggedKey.has(`${slot._id}|${dateStr}`)) sessionsUnlogged += 1;
      }
    }
    const logCompliancePct =
      sessionsScheduled === 0
        ? 100
        : Math.round(((sessionsHeld + sessionsCancelled) / sessionsScheduled) * 100);

    // Outstanding credit (all-time).
    let outstandingCredit = 0;
    const expectedByStudent = new Map<string, number>();
    const collectedByStudent = new Map<string, number>();
    for (const a of attendance) {
      if (a.status !== "present") continue;
      if (isPreTracking(a.slotId, a.date)) continue;
      const slot = slotById.get(a.slotId);
      if (!slot || !slot.groupId) continue;
      const rate =
        rateByGroupStudent.get(`${slot.groupId}|${a.studentId}`) ??
        resolveRate(undefined, studentById.get(a.studentId)?.hourlyRate);
      const exp = rate * hoursBetween(slot.startTime, slot.endTime);
      expectedByStudent.set(a.studentId, (expectedByStudent.get(a.studentId) ?? 0) + exp);
    }
    for (const p of payments) {
      if (isPreTracking(p.slotId, p.date)) continue;
      collectedByStudent.set(p.studentId, (collectedByStudent.get(p.studentId) ?? 0) + p.amount);
    }
    for (const sid of Array.from(expectedByStudent.keys())) {
      const exp = expectedByStudent.get(sid) ?? 0;
      const paid = collectedByStudent.get(sid) ?? 0;
      outstandingCredit += Math.max(0, exp - paid);
    }

    // Active students = unique student IDs in any active group.
    const activeStudents = new Set<string>();
    for (const m of members) {
      if (groupById.has(m.groupId)) activeStudents.add(m.studentId);
    }

    // Daily series for the sparkline (range).
    const dailySeries: Array<{ date: string; revenue: number }> = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - (days - 1 - i));
      const key = ymd(d);
      dailySeries.push({ date: key, revenue: realizedByDay.get(key) ?? 0 });
    }

    return {
      range: { days, fromYmd: cutoffYmd, toYmd: todayYmd },
      revenue: {
        range: revenueRange,
        prev: revenuePrev,
        deltaPct:
          revenuePrev === 0
            ? null
            : Math.round(((revenueRange - revenuePrev) / revenuePrev) * 100),
      },
      attendance: {
        pct: attendancePct,
        prevPct: attendancePctPrev,
        present: presentInRange,
        absent: absentInRange,
      },
      compliance: {
        pct: logCompliancePct,
        held: sessionsHeld,
        cancelled: sessionsCancelled,
        unlogged: sessionsUnlogged,
        scheduled: sessionsScheduled,
      },
      credit: { outstanding: outstandingCredit },
      students: { active: activeStudents.size, total: students.length },
      dailySeries,
    };
  },
});

// ── cancellationBreakdown ────────────────────────────────────────────────
//
// Sessions cancelled in the range, grouped by reason. Each row carries the
// session count AND the lost-revenue estimate (rate × hours × roster size
// for that occurrence, summed). "Other" / no-reason cancellations bucket
// together so old cancellations from before the reason field landed still
// surface somewhere.

export const cancellationBreakdown = query({
  args: { days: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return { rows: [], total: { count: 0, lostRevenue: 0 } };
    const days = Math.min(Math.max(args.days ?? 30, 1), 365);

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const cutoff = new Date(today);
    cutoff.setDate(cutoff.getDate() - (days - 1));
    const cutoffYmd = ymd(cutoff);
    const todayYmd = ymd(today);

    const [logs, slots, groups, members, students] = await Promise.all([
      ctx.db.query("sessionLogs").collect(),
      ctx.db.query("scheduleSlots").collect(),
      ctx.db.query("groups").collect(),
      ctx.db.query("groupMembers").collect(),
      ctx.db.query("students").collect(),
    ]);

    const groupById = new Map(groups.map((g) => [g._id, g]));
    const slotById = new Map(slots.map((s) => [s._id, s]));
    const studentById = new Map(students.map((s) => [s._id, s]));

    const rateByGroupStudent = new Map<string, number>();
    const membersByGroup = new Map<string, Doc<"groupMembers">[]>();
    for (const m of members) {
      const s = studentById.get(m.studentId);
      rateByGroupStudent.set(
        `${m.groupId}|${m.studentId}`,
        resolveRate(m.hourlyRate, s?.hourlyRate),
      );
      const list = membersByGroup.get(m.groupId) ?? [];
      list.push(m);
      membersByGroup.set(m.groupId, list);
    }

    const cancelled = logs.filter(
      (l) =>
        l.status === "cancelled_by_tutor" &&
        l.date >= cutoffYmd &&
        l.date <= todayYmd,
    );

    type Row = { reason: string; count: number; lostRevenue: number };
    const byReason = new Map<string, Row>();
    let totalCount = 0;
    let totalLost = 0;

    for (const l of cancelled) {
      const slot = slotById.get(l.slotId);
      if (!slot || !slot.groupId) continue;
      const group = groupById.get(slot.groupId);
      if (!group) continue;
      // Skip pre-tracking cancels (shouldn't happen since the mutation
      // blocks them, but defensive).
      if (group.loggingStartDate && l.date < group.loggingStartDate) continue;

      const roster = membersByGroup.get(slot.groupId) ?? [];
      const hours = hoursBetween(slot.startTime, slot.endTime);
      let lost = 0;
      for (const m of roster) {
        const rate =
          rateByGroupStudent.get(`${slot.groupId}|${m.studentId}`) ??
          resolveRate(undefined, studentById.get(m.studentId)?.hourlyRate);
        lost += rate * hours;
      }

      const key = l.reason ?? "unspecified";
      const row = byReason.get(key) ?? { reason: key, count: 0, lostRevenue: 0 };
      row.count += 1;
      row.lostRevenue += lost;
      byReason.set(key, row);
      totalCount += 1;
      totalLost += lost;
    }

    return {
      rows: Array.from(byReason.values()).sort((a, b) => b.lostRevenue - a.lostRevenue),
      total: { count: totalCount, lostRevenue: totalLost },
    };
  },
});

// ── lostRevenue ──────────────────────────────────────────────────────────
//
// Breaks down "expected but not realized" revenue within the range into:
//   • cancelled — sessions you called off (sum from cancellationBreakdown)
//   • absent    — sessions held with at least one student-absent row
//   • unlogged  — past sessions with no log row at all
//
// Each bucket carries a count + LKR estimate. Useful for the Finance >
// Revenue chart showing scheduled minus realized.

export const lostRevenue = query({
  args: { days: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return {
        cancelled: { count: 0, amount: 0 },
        absent: { count: 0, amount: 0 },
        unlogged: { count: 0, amount: 0 },
      };
    }
    const days = Math.min(Math.max(args.days ?? 30, 1), 365);

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const cutoff = new Date(today);
    cutoff.setDate(cutoff.getDate() - (days - 1));
    const cutoffYmd = ymd(cutoff);
    const todayYmd = ymd(today);

    const [logs, slots, groups, members, students, attendance] =
      await Promise.all([
        ctx.db.query("sessionLogs").collect(),
        ctx.db.query("scheduleSlots").collect(),
        ctx.db.query("groups").collect(),
        ctx.db.query("groupMembers").collect(),
        ctx.db.query("students").collect(),
        ctx.db.query("attendance").collect(),
      ]);

    const groupById = new Map(groups.map((g) => [g._id, g]));
    const slotById = new Map(slots.map((s) => [s._id, s]));
    const studentById = new Map(students.map((s) => [s._id, s]));

    const rateByGroupStudent = new Map<string, number>();
    const membersByGroup = new Map<string, Doc<"groupMembers">[]>();
    for (const m of members) {
      const s = studentById.get(m.studentId);
      rateByGroupStudent.set(
        `${m.groupId}|${m.studentId}`,
        resolveRate(m.hourlyRate, s?.hourlyRate),
      );
      const list = membersByGroup.get(m.groupId) ?? [];
      list.push(m);
      membersByGroup.set(m.groupId, list);
    }

    const isPreTracking = (slot: Doc<"scheduleSlots"> | undefined, date: string): boolean => {
      if (!slot || !slot.groupId) return false;
      const g = groupById.get(slot.groupId);
      if (!g || !g.loggingStartDate) return false;
      return date < g.loggingStartDate;
    };

    const sessionExpected = (slot: Doc<"scheduleSlots">): number => {
      const roster = membersByGroup.get(slot.groupId!) ?? [];
      const hours = hoursBetween(slot.startTime, slot.endTime);
      let total = 0;
      for (const m of roster) {
        const rate =
          rateByGroupStudent.get(`${slot.groupId}|${m.studentId}`) ??
          resolveRate(undefined, studentById.get(m.studentId)?.hourlyRate);
        total += rate * hours;
      }
      return total;
    };

    // Cancelled buckets: walk sessionLogs(status=cancelled_by_tutor) in range.
    let cancelledCount = 0;
    let cancelledAmt = 0;
    const logsByKey = new Map<string, Doc<"sessionLogs">>();
    for (const l of logs) {
      if (l.date < cutoffYmd || l.date > todayYmd) continue;
      const slot = slotById.get(l.slotId);
      if (isPreTracking(slot, l.date)) continue;
      logsByKey.set(`${l.slotId}|${l.date}`, l);
      if (l.status !== "cancelled_by_tutor") continue;
      if (!slot || !slot.groupId) continue;
      cancelledCount += 1;
      cancelledAmt += sessionExpected(slot);
    }

    // Absent bucket: walk attendance with status=absent in range. Per-row
    // expected = the student's own rate × hours (only this row's value).
    let absentCount = 0;
    let absentAmt = 0;
    for (const a of attendance) {
      if (a.date < cutoffYmd || a.date > todayYmd) continue;
      if (a.status !== "absent") continue;
      const slot = slotById.get(a.slotId);
      if (!slot || !slot.groupId) continue;
      if (isPreTracking(slot, a.date)) continue;
      const rate =
        rateByGroupStudent.get(`${slot.groupId}|${a.studentId}`) ??
        resolveRate(undefined, studentById.get(a.studentId)?.hourlyRate);
      absentCount += 1;
      absentAmt += rate * hoursBetween(slot.startTime, slot.endTime);
    }

    // Unlogged bucket: walk window for past sessions w/ no log row.
    const now = new Date();
    let unloggedCount = 0;
    let unloggedAmt = 0;
    for (let i = 0; i < days; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - (days - 1 - i));
      const dateStr = ymd(d);
      const dow = d.getDay() === 0 ? 7 : d.getDay();
      const slotsToday = slots.filter((s) => s.dayOfWeek === dow && s.groupId);
      for (const slot of slotsToday) {
        if (isPreTracking(slot, dateStr)) continue;
        const [h, m] = slot.startTime.split(":").map(Number);
        const sessionStart = new Date(d);
        sessionStart.setHours(h, m, 0, 0);
        if (sessionStart >= now) continue;
        if (logsByKey.has(`${slot._id}|${dateStr}`)) continue;
        unloggedCount += 1;
        unloggedAmt += sessionExpected(slot);
      }
    }

    return {
      cancelled: { count: cancelledCount, amount: cancelledAmt },
      absent: { count: absentCount, amount: absentAmt },
      unlogged: { count: unloggedCount, amount: unloggedAmt },
    };
  },
});

// ── creditAging ──────────────────────────────────────────────────────────
//
// Outstanding credit per student, bucketed by age of the oldest unpaid
// session. The aging bucket is determined by the earliest "present"
// attendance whose accumulated payments still haven't covered the expected.
// Approximate but actionable — answers "who's been carrying debt longest."

export const creditAging = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return { rows: [], totals: { fresh: 0, mid: 0, old: 0 } };

    const [attendance, payments, slots, groups, members, students] =
      await Promise.all([
        ctx.db.query("attendance").collect(),
        ctx.db.query("sessionPayments").collect(),
        ctx.db.query("scheduleSlots").collect(),
        ctx.db.query("groups").collect(),
        ctx.db.query("groupMembers").collect(),
        ctx.db.query("students").collect(),
      ]);

    const slotById = new Map(slots.map((s) => [s._id, s]));
    const groupById = new Map(groups.map((g) => [g._id, g]));
    const studentById = new Map(students.map((s) => [s._id, s]));

    const rateByGroupStudent = new Map<string, number>();
    for (const m of members) {
      const s = studentById.get(m.studentId);
      rateByGroupStudent.set(
        `${m.groupId}|${m.studentId}`,
        resolveRate(m.hourlyRate, s?.hourlyRate),
      );
    }

    const isPreTracking = (slot: Doc<"scheduleSlots"> | undefined, date: string): boolean => {
      if (!slot || !slot.groupId) return false;
      const g = groupById.get(slot.groupId);
      if (!g || !g.loggingStartDate) return false;
      return date < g.loggingStartDate;
    };

    // Per-student: ordered list of (date, expected) for present sessions.
    const expectedRows = new Map<string, Array<{ date: string; amount: number }>>();
    for (const a of attendance) {
      if (a.status !== "present") continue;
      const slot = slotById.get(a.slotId);
      if (!slot || !slot.groupId) continue;
      if (isPreTracking(slot, a.date)) continue;
      const rate =
        rateByGroupStudent.get(`${slot.groupId}|${a.studentId}`) ??
        resolveRate(undefined, studentById.get(a.studentId)?.hourlyRate);
      const amt = rate * hoursBetween(slot.startTime, slot.endTime);
      const list = expectedRows.get(a.studentId) ?? [];
      list.push({ date: a.date, amount: amt });
      expectedRows.set(a.studentId, list);
    }

    const paidByStudent = new Map<string, number>();
    for (const p of payments) {
      if (isPreTracking(slotById.get(p.slotId), p.date)) continue;
      paidByStudent.set(p.studentId, (paidByStudent.get(p.studentId) ?? 0) + p.amount);
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    type Bucket = "fresh" | "mid" | "old";
    type Row = {
      studentId: Id<"students">;
      name: string;
      credit: number;
      oldestUnpaidYmd: string | null;
      ageDays: number;
      bucket: Bucket;
    };
    const rows: Row[] = [];
    const totals = { fresh: 0, mid: 0, old: 0 };

    for (const sid of Array.from(expectedRows.keys())) {
      const list = (expectedRows.get(sid) ?? []).slice().sort((a, b) => a.date.localeCompare(b.date));
      let paidLeft = paidByStudent.get(sid) ?? 0;
      let oldestUnpaid: string | null = null;
      let unpaid = 0;
      for (const r of list) {
        if (paidLeft >= r.amount) {
          paidLeft -= r.amount;
          continue;
        }
        const leftover = r.amount - paidLeft;
        paidLeft = 0;
        unpaid += leftover;
        if (oldestUnpaid === null) oldestUnpaid = r.date;
      }
      if (unpaid <= 0) continue;

      const dueDate = oldestUnpaid ? new Date(oldestUnpaid + "T00:00:00") : today;
      const ageDays = Math.max(
        0,
        Math.floor((today.getTime() - dueDate.getTime()) / 86_400_000),
      );
      const bucket: Bucket = ageDays <= 7 ? "fresh" : ageDays <= 30 ? "mid" : "old";
      totals[bucket] += unpaid;

      const student = studentById.get(sid as Id<"students">);
      rows.push({
        studentId: sid as Id<"students">,
        name: student?.name ?? "?",
        credit: unpaid,
        oldestUnpaidYmd: oldestUnpaid,
        ageDays,
        bucket,
      });
    }

    rows.sort((a, b) => b.ageDays - a.ageDays || b.credit - a.credit);
    return { rows, totals };
  },
});

// ── capacityUtilization ──────────────────────────────────────────────────
//
// Per-group fill rate: members vs maxSize. Groups without a maxSize set are
// excluded from the rate calculation but still surface in the list with a
// null fillPct so the lead can spot un-capped groups.

export const capacityUtilization = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return { groups: [], summary: { avgFillPct: 0, atCapacity: 0, headroom: 0 } };

    const [groups, members] = await Promise.all([
      ctx.db.query("groups").collect(),
      ctx.db.query("groupMembers").collect(),
    ]);

    const memberCount = new Map<string, number>();
    for (const m of members) {
      memberCount.set(m.groupId, (memberCount.get(m.groupId) ?? 0) + 1);
    }

    type Row = {
      groupId: Id<"groups">;
      name: string;
      members: number;
      maxSize: number | null;
      fillPct: number | null;
      seatsLeft: number | null;
    };
    const rows: Row[] = groups.map((g) => {
      const count = memberCount.get(g._id) ?? 0;
      const maxSize = g.maxSize ?? null;
      const fillPct = maxSize != null && maxSize > 0
        ? Math.round((count / maxSize) * 100)
        : null;
      const seatsLeft = maxSize != null ? Math.max(0, maxSize - count) : null;
      return {
        groupId: g._id,
        name: g.name,
        members: count,
        maxSize,
        fillPct,
        seatsLeft,
      };
    });

    const cappedRows = rows.filter((r) => r.fillPct != null);
    const avgFillPct =
      cappedRows.length === 0
        ? 0
        : Math.round(
            cappedRows.reduce((s, r) => s + (r.fillPct ?? 0), 0) / cappedRows.length,
          );
    const atCapacity = cappedRows.filter((r) => (r.fillPct ?? 0) >= 100).length;
    const headroom = cappedRows.reduce((s, r) => s + (r.seatsLeft ?? 0), 0);

    return {
      groups: rows.sort((a, b) => (b.fillPct ?? -1) - (a.fillPct ?? -1)),
      summary: { avgFillPct, atCapacity, headroom },
    };
  },
});

// ── acquisitionByMonth ───────────────────────────────────────────────────
//
// New students per month, derived from groupMembers.joinedAt (the first
// time a student was assigned to any group). Returns the last 12 months by
// default.

export const acquisitionByMonth = query({
  args: { months: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const months = Math.min(Math.max(args.months ?? 12, 1), 36);

    const members = await ctx.db.query("groupMembers").collect();

    // First joinedAt per student.
    const firstJoin = new Map<string, number>();
    for (const m of members) {
      const cur = firstJoin.get(m.studentId);
      if (cur === undefined || m.joinedAt < cur) firstJoin.set(m.studentId, m.joinedAt);
    }

    const buckets = new Map<string, number>();
    for (const [, ts] of Array.from(firstJoin.entries())) {
      const d = new Date(ts);
      buckets.set(ymOnly(d), (buckets.get(ymOnly(d)) ?? 0) + 1);
    }

    const out: Array<{ month: string; count: number }> = [];
    const now = new Date();
    for (let i = months - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = ymOnly(d);
      out.push({ month: key, count: buckets.get(key) ?? 0 });
    }
    return out;
  },
});

// ── cohortRetention ──────────────────────────────────────────────────────
//
// Group students by the month they joined; report what % of each cohort is
// still in any active group today. Crude but useful first signal — actual
// retention dashboards would compute survival curves per cohort.

export const cohortRetention = query({
  args: { months: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const months = Math.min(Math.max(args.months ?? 12, 1), 36);

    const [members, groups] = await Promise.all([
      ctx.db.query("groupMembers").collect(),
      ctx.db.query("groups").collect(),
    ]);
    const activeGroupIds = new Set(groups.map((g) => g._id as string));

    // First joinedAt + current-still-member flag.
    const firstJoin = new Map<string, number>();
    const stillActive = new Set<string>();
    for (const m of members) {
      const cur = firstJoin.get(m.studentId);
      if (cur === undefined || m.joinedAt < cur) firstJoin.set(m.studentId, m.joinedAt);
      if (activeGroupIds.has(m.groupId)) stillActive.add(m.studentId);
    }

    const cohort = new Map<string, { joined: number; retained: number }>();
    for (const [sid, ts] of Array.from(firstJoin.entries())) {
      const key = ymOnly(new Date(ts));
      const c = cohort.get(key) ?? { joined: 0, retained: 0 };
      c.joined += 1;
      if (stillActive.has(sid)) c.retained += 1;
      cohort.set(key, c);
    }

    const out: Array<{ month: string; joined: number; retained: number; retentionPct: number }> = [];
    const now = new Date();
    for (let i = months - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = ymOnly(d);
      const c = cohort.get(key) ?? { joined: 0, retained: 0 };
      out.push({
        month: key,
        joined: c.joined,
        retained: c.retained,
        retentionPct: c.joined === 0 ? 0 : Math.round((c.retained / c.joined) * 100),
      });
    }
    return out;
  },
});

// ── studentsAtRisk ───────────────────────────────────────────────────────
//
// "Watch list" — students with <70% attendance in the last 14 days OR 3+
// absences in the same window. Surfaces churn signals before they become
// drop-offs.

export const studentsAtRisk = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const cutoff = new Date(today);
    cutoff.setDate(cutoff.getDate() - 13);
    const cutoffYmd = ymd(cutoff);
    const todayYmd = ymd(today);

    const [attendance, slots, groups, students, members] = await Promise.all([
      ctx.db.query("attendance").collect(),
      ctx.db.query("scheduleSlots").collect(),
      ctx.db.query("groups").collect(),
      ctx.db.query("students").collect(),
      ctx.db.query("groupMembers").collect(),
    ]);

    const slotById = new Map(slots.map((s) => [s._id, s]));
    const groupById = new Map(groups.map((g) => [g._id, g]));
    const studentById = new Map(students.map((s) => [s._id, s]));

    const isPreTracking = (slot: Doc<"scheduleSlots"> | undefined, date: string): boolean => {
      if (!slot || !slot.groupId) return false;
      const g = groupById.get(slot.groupId);
      if (!g || !g.loggingStartDate) return false;
      return date < g.loggingStartDate;
    };

    // Per-student present/absent counts in window.
    const counts = new Map<string, { present: number; absent: number }>();
    for (const a of attendance) {
      if (a.date < cutoffYmd || a.date > todayYmd) continue;
      const slot = slotById.get(a.slotId);
      if (isPreTracking(slot, a.date)) continue;
      const row = counts.get(a.studentId) ?? { present: 0, absent: 0 };
      if (a.status === "present") row.present += 1;
      else if (a.status === "absent") row.absent += 1;
      counts.set(a.studentId, row);
    }

    // Group affiliations for the chip.
    const groupNamesByStudent = new Map<string, string[]>();
    for (const m of members) {
      const g = groupById.get(m.groupId);
      if (!g) continue;
      const list = groupNamesByStudent.get(m.studentId) ?? [];
      if (!list.includes(g.name)) list.push(g.name);
      groupNamesByStudent.set(m.studentId, list);
    }

    const out: Array<{
      studentId: Id<"students">;
      name: string;
      groupNames: string[];
      present: number;
      absent: number;
      attendancePct: number;
      reason: "low_attendance" | "many_absences" | "both";
    }> = [];
    for (const [sid, c] of Array.from(counts.entries())) {
      const total = c.present + c.absent;
      if (total === 0) continue;
      const pct = Math.round((c.present / total) * 100);
      const lowAtt = pct < 70;
      const manyAbs = c.absent >= 3;
      if (!lowAtt && !manyAbs) continue;
      const reason: "low_attendance" | "many_absences" | "both" =
        lowAtt && manyAbs ? "both" : lowAtt ? "low_attendance" : "many_absences";
      const stud = studentById.get(sid as Id<"students">);
      out.push({
        studentId: sid as Id<"students">,
        name: stud?.name ?? "?",
        groupNames: groupNamesByStudent.get(sid) ?? [],
        present: c.present,
        absent: c.absent,
        attendancePct: pct,
        reason,
      });
    }
    out.sort((a, b) => a.attendancePct - b.attendancePct || b.absent - a.absent);
    return out;
  },
});
