// Phase F+: per-occurrence session records.
//
// /groups → Day view shows specific dates (not just "Mon" abstractly), and
// the new SessionDialog lets the tutor mark who attended + how much each
// student paid for that one session. This file owns the date-aware reads
// that drive that surface and the single mutation that writes everything
// (attendance + payments + session log) in one transaction.
//
// Data model lives across three tables (see schema.ts for the field-level
// docs): scheduleSlots (the weekly timetable), groupMembers (who's in the
// group), and the three per-date tables —
//   • sessionLogs       — one row per logged occurrence; existence = logged
//   • attendance        — present/absent per (slot, date, student)
//   • sessionPayments   — cash actually collected per (slot, date, student)
// slotOverrides is still used for ad-hoc roster changes (an extra student
// joining for one day). Per-day TUTOR cancellation is sessionLogs.status,
// not an override.
//
// Credit/balance is always derived, never stored:
//   expected(slot, date, student) = effective rate × hours when present
//   collected(slot, date, student) = Σ sessionPayments.amount
//   credit                         = max(0, expected − collected)

import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { ConvexError } from "convex/values";
import type { GenericQueryCtx } from "convex/server";
import type { DataModel, Doc, Id } from "./_generated/dataModel";
import { RATE_DEFAULT_LKR } from "./groups";

type QueryCtx = GenericQueryCtx<DataModel>;

// ── Helpers ───────────────────────────────────────────────────────────────

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

function addDaysYmd(start: string, n: number): string {
  const d = new Date(start + "T00:00:00");
  d.setDate(d.getDate() + n);
  return ymd(d);
}

// 1=Mon..6=Sat, 7=Sun (matches the time-grid encoding used elsewhere).
function appDowForYmd(s: string): number {
  const d = new Date(s + "T00:00:00");
  const js = d.getDay();
  return js === 0 ? 7 : js;
}

// Effective roster for a (slot, date): base group members + add overrides
// − remove overrides. Returns student docs alongside their per-(group,
// student) rate, so the caller can compute expected revenue without
// re-fetching anything.
async function effectiveRosterFor(
  ctx: QueryCtx,
  slot: Doc<"scheduleSlots">,
  date: string,
): Promise<Array<{ student: Doc<"students">; memberRate: number | undefined; isOverrideAdd: boolean }>> {
  if (!slot.groupId) return [];
  const members = await ctx.db
    .query("groupMembers")
    .withIndex("by_group", (q) => q.eq("groupId", slot.groupId!))
    .collect();
  const memberRateById = new Map<string, number | undefined>();
  for (const m of members) memberRateById.set(m.studentId, m.hourlyRate);

  const overrides = await ctx.db
    .query("slotOverrides")
    .withIndex("by_slot_date", (q) => q.eq("slotId", slot._id).eq("date", date))
    .collect();
  const removedIds = new Set<string>();
  const addedIds = new Set<string>();
  for (const o of overrides) {
    if (o.action === "remove") removedIds.add(o.studentId);
    else if (o.action === "add") addedIds.add(o.studentId);
  }

  const out: Array<{ student: Doc<"students">; memberRate: number | undefined; isOverrideAdd: boolean }> = [];
  // Base members minus removes.
  for (const m of members) {
    if (removedIds.has(m.studentId)) continue;
    const s = await ctx.db.get(m.studentId);
    if (s) out.push({ student: s, memberRate: m.hourlyRate, isOverrideAdd: false });
  }
  // Override-adds that aren't already in the roster.
  const baseIds = new Set(members.map((m) => m.studentId));
  for (const o of overrides) {
    if (o.action !== "add" || baseIds.has(o.studentId)) continue;
    const s = await ctx.db.get(o.studentId);
    if (s) out.push({ student: s, memberRate: undefined, isOverrideAdd: true });
  }
  return out;
}

// ── Queries ───────────────────────────────────────────────────────────────

// Returns every session scheduled in the 7-day window starting at
// `weekStartDate` (Monday). Each entry carries enough info for the Day view
// to colour the day pills and the session cards without re-querying.
//
// Per-session payload:
//   - slot / group / time
//   - date (absolute YYYY-MM-DD)
//   - log status: "unlogged" | "held" | "cancelled"
//   - rosterCount / presentCount / absentCount
//   - expected (Σ rate × hours over present-or-unmarked roster)
//   - collected (Σ sessionPayments.amount)
//   - credit (max 0 over per-student credit; present students only)
export const weekSessions = query({
  args: { weekStartDate: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return { sessions: [], perStudentWeek: [] };

    // 7 candidate dates and the dow they correspond to.
    const days: Array<{ date: string; dow: number }> = [];
    for (let i = 0; i < 7; i++) {
      const date = addDaysYmd(args.weekStartDate, i);
      days.push({ date, dow: appDowForYmd(date) });
    }

    // All slots indexed by dow for cheap lookup.
    const allSlots = await ctx.db.query("scheduleSlots").collect();
    const slotsByDow = new Map<number, Doc<"scheduleSlots">[]>();
    for (const s of allSlots) {
      if (!s.groupId) continue;
      const list = slotsByDow.get(s.dayOfWeek) ?? [];
      list.push(s);
      slotsByDow.set(s.dayOfWeek, list);
    }

    type Entry = {
      slotId: Id<"scheduleSlots">;
      groupId: Id<"groups">;
      groupName: string;
      date: string;
      dayOfWeek: number;
      startTime: string;
      endTime: string;
      hours: number;
      logStatus: "unlogged" | "held" | "cancelled";
      rosterCount: number;
      presentCount: number;
      absentCount: number;
      expected: number;
      collected: number;
      credit: number;
    };

    const sessions: Entry[] = [];
    // Per-student weekly rollup: { studentId, name, expected, collected, credit }
    const perStudentWeek = new Map<string, {
      studentId: Id<"students">;
      name: string;
      expected: number;
      collected: number;
      credit: number;
    }>();

    for (const { date, dow } of days) {
      const slots = slotsByDow.get(dow) ?? [];
      for (const slot of slots) {
        if (!slot.groupId) continue;
        const group = await ctx.db.get(slot.groupId);
        if (!group || group.archived) continue;

        const [log, attendance, payments, roster] = await Promise.all([
          ctx.db
            .query("sessionLogs")
            .withIndex("by_slot_date", (q) => q.eq("slotId", slot._id).eq("date", date))
            .first(),
          ctx.db
            .query("attendance")
            .withIndex("by_slot_date", (q) => q.eq("slotId", slot._id).eq("date", date))
            .collect(),
          ctx.db
            .query("sessionPayments")
            .withIndex("by_slot_date", (q) => q.eq("slotId", slot._id).eq("date", date))
            .collect(),
          effectiveRosterFor(ctx, slot, date),
        ]);

        const attById = new Map(attendance.map((a) => [a.studentId, a]));
        const payByStudent = new Map<string, number>();
        for (const p of payments) {
          payByStudent.set(p.studentId, (payByStudent.get(p.studentId) ?? 0) + p.amount);
        }

        const hours = hoursBetween(slot.startTime, slot.endTime);
        let presentCount = 0;
        let absentCount = 0;
        let expected = 0;
        let collected = 0;
        let credit = 0;

        for (const { student, memberRate } of roster) {
          const att = attById.get(student._id);
          const isPresent = att?.status === "present";
          const isAbsent = att?.status === "absent";
          if (isPresent) presentCount += 1;
          else if (isAbsent) absentCount += 1;

          if (isPresent) {
            const rate = resolveRate(memberRate, student.hourlyRate);
            const exp = rate * hours;
            const paid = payByStudent.get(student._id) ?? 0;
            expected += exp;
            collected += paid;
            const studCredit = Math.max(0, exp - paid);
            credit += studCredit;

            const row = perStudentWeek.get(student._id) ?? {
              studentId: student._id,
              name: student.name,
              expected: 0,
              collected: 0,
              credit: 0,
            };
            row.expected += exp;
            row.collected += paid;
            row.credit += studCredit;
            perStudentWeek.set(student._id, row);
          }
        }

        const logStatus: "unlogged" | "held" | "cancelled" =
          !log ? "unlogged" : log.status === "cancelled_by_tutor" ? "cancelled" : "held";

        sessions.push({
          slotId: slot._id,
          groupId: group._id,
          groupName: group.name,
          date,
          dayOfWeek: slot.dayOfWeek,
          startTime: slot.startTime,
          endTime: slot.endTime,
          hours,
          logStatus,
          rosterCount: roster.length,
          presentCount,
          absentCount,
          expected,
          collected,
          credit,
        });
      }
    }

    sessions.sort((a, b) =>
      a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime),
    );

    return {
      sessions,
      perStudentWeek: Array.from(perStudentWeek.values()).sort(
        (a, b) => b.credit - a.credit || b.expected - a.expected,
      ),
    };
  },
});

// Full payload for one (slot, date) — drives the SessionDialog. Includes
// each member's prior-balance credit across ALL earlier dates so the dialog
// can show a "owes Rs N from before" badge.
export const sessionDetail = query({
  args: { slotId: v.id("scheduleSlots"), date: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const slot = await ctx.db.get(args.slotId);
    if (!slot || !slot.groupId) return null;
    const group = await ctx.db.get(slot.groupId);
    if (!group) return null;

    const [log, attendance, payments, roster] = await Promise.all([
      ctx.db
        .query("sessionLogs")
        .withIndex("by_slot_date", (q) =>
          q.eq("slotId", slot._id).eq("date", args.date),
        )
        .first(),
      ctx.db
        .query("attendance")
        .withIndex("by_slot_date", (q) =>
          q.eq("slotId", slot._id).eq("date", args.date),
        )
        .collect(),
      ctx.db
        .query("sessionPayments")
        .withIndex("by_slot_date", (q) =>
          q.eq("slotId", slot._id).eq("date", args.date),
        )
        .collect(),
      effectiveRosterFor(ctx, slot, args.date),
    ]);

    const attById = new Map(attendance.map((a) => [a.studentId, a]));
    const payByStudent = new Map<string, number>();
    for (const p of payments) {
      payByStudent.set(p.studentId, (payByStudent.get(p.studentId) ?? 0) + p.amount);
    }
    const hours = hoursBetween(slot.startTime, slot.endTime);

    // Prior balance: walk this student's attendance history at any slot,
    // pre-date, count expected minus collected. We accept the cost — this
    // only runs when the dialog opens.
    const priorBalanceFor = async (studentId: Id<"students">): Promise<number> => {
      const prevAttendance = await ctx.db
        .query("attendance")
        .withIndex("by_student", (q) => q.eq("studentId", studentId))
        .collect();
      const prevPayments = await ctx.db
        .query("sessionPayments")
        .withIndex("by_student_date", (q) => q.eq("studentId", studentId))
        .collect();

      let expected = 0;
      for (const a of prevAttendance) {
        if (a.date >= args.date) continue;
        if (a.status !== "present") continue;
        const pSlot = await ctx.db.get(a.slotId);
        if (!pSlot || !pSlot.groupId) continue;
        // Per-(group, student) rate at the time the attendance was recorded
        // — we approximate with the *current* groupMembers row. (We don't
        // version rates yet; if the tutor changes a fee historically, the
        // prior balance shifts. Acceptable for v1.)
        const memberRow = await ctx.db
          .query("groupMembers")
          .withIndex("by_group_student", (q) =>
            q.eq("groupId", pSlot.groupId!).eq("studentId", studentId),
          )
          .first();
        const stud = await ctx.db.get(studentId);
        const rate = resolveRate(memberRow?.hourlyRate, stud?.hourlyRate);
        expected += rate * hoursBetween(pSlot.startTime, pSlot.endTime);
      }
      const paid = prevPayments
        .filter((p) => p.date < args.date)
        .reduce((s, p) => s + p.amount, 0);

      return Math.max(0, expected - paid);
    };

    const rows = await Promise.all(
      roster.map(async ({ student, memberRate, isOverrideAdd }) => {
        const att = attById.get(student._id);
        const rate = resolveRate(memberRate, student.hourlyRate);
        return {
          studentId: student._id,
          name: student.name,
          rate,
          hours,
          expected: rate * hours,
          attended: att?.status === "present"
            ? ("present" as const)
            : att?.status === "absent"
              ? ("absent" as const)
              : ("unset" as const),
          amountPaid: payByStudent.get(student._id) ?? 0,
          isOverrideAdd,
          priorCredit: await priorBalanceFor(student._id),
        };
      }),
    );

    return {
      slotId: slot._id,
      groupId: group._id,
      groupName: group.name,
      date: args.date,
      startTime: slot.startTime,
      endTime: slot.endTime,
      hours,
      logStatus: !log
        ? ("unlogged" as const)
        : log.status === "cancelled_by_tutor"
          ? ("cancelled" as const)
          : ("held" as const),
      note: log?.note,
      members: rows,
    };
  },
});

// ── Mutations ─────────────────────────────────────────────────────────────

// One-shot write: upserts attendance + sessionPayments + sessionLogs for a
// single (slotId, date) occurrence. Designed for the SessionDialog's "Save"
// button — re-saving overwrites cleanly (re-editable on demand).
//
// entries[].attended:
//   • "present" → attendance.status="present"; amountPaid recorded.
//   • "absent"  → attendance.status="absent"; any sessionPayments for this
//                 (student, slot, date) are wiped (no charge expected).
//   • "unset"   → caller hasn't decided yet; existing attendance + payment
//                 rows are left as-is. (Useful for partial save flows.)
//
// status="cancelled_by_tutor":
//   • Wipes attendance + sessionPayments for this (slot, date).
//   • Writes a single sessionLogs row marking the session as off.
//   • Ignores `entries`.
export const logSession = mutation({
  args: {
    slotId: v.id("scheduleSlots"),
    date: v.string(),
    status: v.string(), // "held" | "cancelled_by_tutor"
    note: v.optional(v.string()),
    entries: v.optional(
      v.array(
        v.object({
          studentId: v.id("students"),
          attended: v.string(), // "present" | "absent" | "unset"
          amountPaid: v.optional(v.number()),
        }),
      ),
    ),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Unauthenticated");
    if (args.status !== "held" && args.status !== "cancelled_by_tutor") {
      throw new ConvexError("Invalid session status");
    }

    const slot = await ctx.db.get(args.slotId);
    if (!slot) throw new ConvexError("Slot not found");

    // Resolve the calling teacher for attribution (optional; null is fine).
    const teacher = await ctx.db
      .query("teachers")
      .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", identity.subject))
      .first();

    // Upsert the log row.
    const existingLog = await ctx.db
      .query("sessionLogs")
      .withIndex("by_slot_date", (q) =>
        q.eq("slotId", args.slotId).eq("date", args.date),
      )
      .first();
    if (existingLog) {
      await ctx.db.patch(existingLog._id, {
        status: args.status,
        note: args.note,
        loggedByTeacherId: teacher?._id ?? existingLog.loggedByTeacherId,
        loggedAt: Date.now(),
      });
    } else {
      await ctx.db.insert("sessionLogs", {
        slotId: args.slotId,
        date: args.date,
        status: args.status,
        note: args.note,
        loggedByTeacherId: teacher?._id,
        loggedAt: Date.now(),
      });
    }

    if (args.status === "cancelled_by_tutor") {
      // Tutor leave: wipe all attendance + payments for this occurrence.
      const att = await ctx.db
        .query("attendance")
        .withIndex("by_slot_date", (q) =>
          q.eq("slotId", args.slotId).eq("date", args.date),
        )
        .collect();
      for (const a of att) await ctx.db.delete(a._id);
      const pays = await ctx.db
        .query("sessionPayments")
        .withIndex("by_slot_date", (q) =>
          q.eq("slotId", args.slotId).eq("date", args.date),
        )
        .collect();
      for (const p of pays) await ctx.db.delete(p._id);
      return;
    }

    if (!args.entries) return;
    for (const e of args.entries) {
      if (e.attended === "unset") continue;

      // Upsert attendance.
      const existingAtt = await ctx.db
        .query("attendance")
        .withIndex("by_slot_date", (q) =>
          q.eq("slotId", args.slotId).eq("date", args.date),
        )
        .collect();
      const attRow = existingAtt.find((a) => a.studentId === e.studentId);
      if (attRow) {
        await ctx.db.patch(attRow._id, { status: e.attended });
      } else {
        await ctx.db.insert("attendance", {
          studentId: e.studentId,
          slotId: args.slotId,
          date: args.date,
          status: e.attended,
        });
      }

      // Payments — collapse to a single row per (slot, date, student) to
      // make the "amount paid" the source of truth for this occurrence.
      // Multiple historical rows could exist if upgraded from an older
      // model; clean them up here.
      const existingPays = await ctx.db
        .query("sessionPayments")
        .withIndex("by_slot_date_student", (q) =>
          q
            .eq("slotId", args.slotId)
            .eq("date", args.date)
            .eq("studentId", e.studentId),
        )
        .collect();

      if (e.attended === "absent") {
        for (const p of existingPays) await ctx.db.delete(p._id);
        continue;
      }

      // Present.
      const amount = Math.max(0, e.amountPaid ?? 0);
      if (existingPays.length === 0) {
        await ctx.db.insert("sessionPayments", {
          slotId: args.slotId,
          date: args.date,
          studentId: e.studentId,
          amount,
          paidAt: Date.now(),
        });
      } else {
        // Patch the first, drop the rest.
        await ctx.db.patch(existingPays[0]._id, { amount, paidAt: Date.now() });
        for (let i = 1; i < existingPays.length; i++) {
          await ctx.db.delete(existingPays[i]._id);
        }
      }
    }
  },
});

// ── Attendance insights ───────────────────────────────────────────────────
//
// One-shot read for /groups → Attendance tab. Aggregates the last `days`
// days into:
//   • meta         — counts of held / cancelled / unlogged sessions, plus
//                    student presences vs absences
//   • byStudent    — per-student attendance %, range expected/collected/
//                    credit, and ALL-TIME outstanding credit (most useful
//                    when chasing money)
//   • byGroup      — per-group rollup of the same numbers
//
// All-time credit is computed by walking each student's full attendance +
// payments history; pricey but bounded to one query and the dataset is
// small for a single tutor.

export const attendanceInsights = query({
  args: { days: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return {
        meta: {
          days: 0,
          sessionsHeld: 0,
          sessionsCancelled: 0,
          sessionsUnlogged: 0,
          studentPresences: 0,
          studentAbsences: 0,
        },
        byStudent: [],
        byGroup: [],
      };
    }

    const days = Math.min(Math.max(args.days ?? 30, 1), 365);

    // Date window. We don't filter past sessions earlier than this for
    // "unlogged" counts — only sessions that were supposed to happen within
    // the window matter for compliance.
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const startD = new Date(today);
    startD.setDate(startD.getDate() - (days - 1));
    const startYmd = ymd(startD);
    const todayYmd = ymd(today);

    // ── Reference data ──────────────────────────────────────────────────
    const [groups, allSlots, allMembers, allAttendance, allLogs, allPayments] =
      await Promise.all([
        ctx.db.query("groups").collect(),
        ctx.db.query("scheduleSlots").collect(),
        ctx.db.query("groupMembers").collect(),
        ctx.db.query("attendance").collect(),
        ctx.db.query("sessionLogs").collect(),
        ctx.db.query("sessionPayments").collect(),
      ]);

    const groupById = new Map(groups.map((g) => [g._id, g]));
    const slotById = new Map(allSlots.map((s) => [s._id, s]));

    // Resolve every referenced student once.
    const studentIds = new Set<Id<"students">>();
    for (const m of allMembers) studentIds.add(m.studentId);
    for (const a of allAttendance) studentIds.add(a.studentId);
    for (const p of allPayments) studentIds.add(p.studentId);
    const studentDocs = await Promise.all(
      Array.from(studentIds).map((id) => ctx.db.get(id)),
    );
    const studentById = new Map<string, Doc<"students">>();
    for (const s of studentDocs) {
      if (s) studentById.set(s._id, s);
    }

    // (group, student) → rate map for the per-session expected calculation.
    const rateByGroupStudent = new Map<string, number>();
    for (const m of allMembers) {
      const s = studentById.get(m.studentId);
      rateByGroupStudent.set(
        `${m.groupId}|${m.studentId}`,
        resolveRate(m.hourlyRate, s?.hourlyRate),
      );
    }
    // Fallback rate when a student attended a group they're no longer in.
    const fallbackRateForStudent = (sid: Id<"students">) =>
      resolveRate(undefined, studentById.get(sid)?.hourlyRate);

    // Per-student group affiliations (active groups only) for the chip line.
    const groupNamesByStudent = new Map<string, string[]>();
    for (const m of allMembers) {
      const g = groupById.get(m.groupId);
      if (!g || g.archived) continue;
      const list = groupNamesByStudent.get(m.studentId) ?? [];
      if (!list.includes(g.name)) list.push(g.name);
      groupNamesByStudent.set(m.studentId, list);
    }

    // ── Meta counts within the window ───────────────────────────────────
    const logsInRange = allLogs.filter((l) => l.date >= startYmd && l.date <= todayYmd);
    const sessionsHeld = logsInRange.filter((l) => l.status === "held").length;
    const sessionsCancelled = logsInRange.filter((l) => l.status === "cancelled_by_tutor").length;

    // Unlogged sessions: every (slot, date) in the window whose start time
    // has already passed but which has no sessionLogs row.
    const loggedKey = new Set(
      logsInRange.map((l) => `${l.slotId}|${l.date}`),
    );
    let sessionsUnlogged = 0;
    const now = new Date();
    for (let i = 0; i < days; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - (days - 1 - i));
      const dateStr = ymd(d);
      const js = d.getDay();
      const dow = js === 0 ? 7 : js;
      const slotsToday = allSlots.filter((s) => s.dayOfWeek === dow && s.groupId);
      for (const slot of slotsToday) {
        const g = groupById.get(slot.groupId!);
        if (!g || g.archived) continue;
        if (loggedKey.has(`${slot._id}|${dateStr}`)) continue;
        // Past start time?
        const [h, m] = slot.startTime.split(":").map(Number);
        const sessionStart = new Date(d);
        sessionStart.setHours(h, m, 0, 0);
        if (sessionStart < now) sessionsUnlogged += 1;
      }
    }

    const attendanceInRange = allAttendance.filter(
      (a) => a.date >= startYmd && a.date <= todayYmd,
    );
    const studentPresences = attendanceInRange.filter((a) => a.status === "present").length;
    const studentAbsences = attendanceInRange.filter((a) => a.status === "absent").length;

    // ── Per-student rollup ──────────────────────────────────────────────
    // expectedInRange / collectedInRange / creditInRange come from
    // attendance × payments within the window. totalCredit is a separate
    // walk over the student's FULL history (all-time outstanding).
    type StudentRow = {
      studentId: Id<"students">;
      name: string;
      groupNames: string[];
      presentCount: number;
      absentCount: number;
      attendancePct: number; // 0..100
      rangeExpected: number;
      rangeCollected: number;
      rangeCredit: number;
      totalCredit: number;
    };
    const byStudent = new Map<string, StudentRow>();

    const rowFor = (sid: Id<"students">): StudentRow => {
      const existing = byStudent.get(sid);
      if (existing) return existing;
      const s = studentById.get(sid);
      const row: StudentRow = {
        studentId: sid,
        name: s?.name ?? "?",
        groupNames: groupNamesByStudent.get(sid) ?? [],
        presentCount: 0,
        absentCount: 0,
        attendancePct: 0,
        rangeExpected: 0,
        rangeCollected: 0,
        rangeCredit: 0,
        totalCredit: 0,
      };
      byStudent.set(sid, row);
      return row;
    };

    // Walk attendance once for in-range counts + expected.
    for (const a of attendanceInRange) {
      const row = rowFor(a.studentId);
      if (a.status === "present") row.presentCount += 1;
      else if (a.status === "absent") row.absentCount += 1;

      if (a.status === "present") {
        const slot = slotById.get(a.slotId);
        if (!slot || !slot.groupId) continue;
        const rate =
          rateByGroupStudent.get(`${slot.groupId}|${a.studentId}`) ??
          fallbackRateForStudent(a.studentId);
        row.rangeExpected += rate * hoursBetween(slot.startTime, slot.endTime);
      }
    }

    // Per-(slot,date,student) payments summed, then attributed to the row.
    const paySummed = new Map<string, number>();
    for (const p of allPayments) {
      const k = `${p.slotId}|${p.date}|${p.studentId}`;
      paySummed.set(k, (paySummed.get(k) ?? 0) + p.amount);
    }
    for (const a of attendanceInRange) {
      if (a.status !== "present") continue;
      const row = rowFor(a.studentId);
      const paid = paySummed.get(`${a.slotId}|${a.date}|${a.studentId}`) ?? 0;
      row.rangeCollected += paid;
    }
    // Range credit = max(0, expected − collected). Computed at the row
    // level (not per-session) — partial overpayments on one session can
    // offset under-payments on another in the window, which is what the
    // tutor actually cares about: "this student is up-to-date or not".
    for (const row of Array.from(byStudent.values())) {
      row.rangeCredit = Math.max(0, row.rangeExpected - row.rangeCollected);
      const total = row.presentCount + row.absentCount;
      row.attendancePct = total === 0 ? 0 : Math.round((row.presentCount / total) * 100);
    }

    // All-time outstanding credit: walk full attendance history.
    const allTimeExpected = new Map<string, number>();
    const allTimeCollected = new Map<string, number>();
    for (const a of allAttendance) {
      if (a.status !== "present") continue;
      const slot = slotById.get(a.slotId);
      if (!slot || !slot.groupId) continue;
      const rate =
        rateByGroupStudent.get(`${slot.groupId}|${a.studentId}`) ??
        fallbackRateForStudent(a.studentId);
      const exp = rate * hoursBetween(slot.startTime, slot.endTime);
      allTimeExpected.set(a.studentId, (allTimeExpected.get(a.studentId) ?? 0) + exp);
      const paid = paySummed.get(`${a.slotId}|${a.date}|${a.studentId}`) ?? 0;
      allTimeCollected.set(a.studentId, (allTimeCollected.get(a.studentId) ?? 0) + paid);
    }
    for (const sid of Array.from(allTimeExpected.keys())) {
      const exp = allTimeExpected.get(sid) ?? 0;
      const paid = allTimeCollected.get(sid) ?? 0;
      const credit = Math.max(0, exp - paid);
      if (credit > 0) {
        const row = rowFor(sid as Id<"students">);
        row.totalCredit = credit;
      }
    }

    // ── Per-group rollup ────────────────────────────────────────────────
    type GroupRow = {
      groupId: Id<"groups">;
      name: string;
      memberCount: number;
      sessionsHeld: number;
      sessionsCancelled: number;
      sessionsUnlogged: number;
      presentCount: number;
      absentCount: number;
      attendancePct: number;
      rangeExpected: number;
      rangeCollected: number;
      rangeCredit: number;
      totalCredit: number;
    };
    const byGroup = new Map<string, GroupRow>();
    const groupRowFor = (gid: Id<"groups">): GroupRow => {
      const existing = byGroup.get(gid);
      if (existing) return existing;
      const g = groupById.get(gid);
      const memberCount = allMembers.filter((m) => m.groupId === gid).length;
      const row: GroupRow = {
        groupId: gid,
        name: g?.name ?? "?",
        memberCount,
        sessionsHeld: 0,
        sessionsCancelled: 0,
        sessionsUnlogged: 0,
        presentCount: 0,
        absentCount: 0,
        attendancePct: 0,
        rangeExpected: 0,
        rangeCollected: 0,
        rangeCredit: 0,
        totalCredit: 0,
      };
      byGroup.set(gid, row);
      return row;
    };

    // Held + cancelled per group.
    for (const l of logsInRange) {
      const slot = slotById.get(l.slotId);
      if (!slot || !slot.groupId) continue;
      const g = groupById.get(slot.groupId);
      if (!g || g.archived) continue;
      const row = groupRowFor(slot.groupId);
      if (l.status === "held") row.sessionsHeld += 1;
      else if (l.status === "cancelled_by_tutor") row.sessionsCancelled += 1;
    }
    // Unlogged per group: walk window again, attribute to group.
    for (let i = 0; i < days; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - (days - 1 - i));
      const dateStr = ymd(d);
      const js = d.getDay();
      const dow = js === 0 ? 7 : js;
      const slotsToday = allSlots.filter((s) => s.dayOfWeek === dow && s.groupId);
      for (const slot of slotsToday) {
        const g = groupById.get(slot.groupId!);
        if (!g || g.archived) continue;
        if (loggedKey.has(`${slot._id}|${dateStr}`)) continue;
        const [h, m] = slot.startTime.split(":").map(Number);
        const sessionStart = new Date(d);
        sessionStart.setHours(h, m, 0, 0);
        if (sessionStart < now) {
          const row = groupRowFor(slot.groupId!);
          row.sessionsUnlogged += 1;
        }
      }
    }
    // Per-group attendance + revenue rollup (from in-range attendance).
    for (const a of attendanceInRange) {
      const slot = slotById.get(a.slotId);
      if (!slot || !slot.groupId) continue;
      const g = groupById.get(slot.groupId);
      if (!g || g.archived) continue;
      const row = groupRowFor(slot.groupId);
      if (a.status === "present") row.presentCount += 1;
      else if (a.status === "absent") row.absentCount += 1;
      if (a.status === "present") {
        const rate =
          rateByGroupStudent.get(`${slot.groupId}|${a.studentId}`) ??
          fallbackRateForStudent(a.studentId);
        const exp = rate * hoursBetween(slot.startTime, slot.endTime);
        row.rangeExpected += exp;
        const paid = paySummed.get(`${a.slotId}|${a.date}|${a.studentId}`) ?? 0;
        row.rangeCollected += paid;
      }
    }
    for (const row of Array.from(byGroup.values())) {
      row.rangeCredit = Math.max(0, row.rangeExpected - row.rangeCollected);
      const total = row.presentCount + row.absentCount;
      row.attendancePct = total === 0 ? 0 : Math.round((row.presentCount / total) * 100);
    }
    // All-time credit per group (walk full attendance).
    for (const a of allAttendance) {
      if (a.status !== "present") continue;
      const slot = slotById.get(a.slotId);
      if (!slot || !slot.groupId) continue;
      const g = groupById.get(slot.groupId);
      if (!g || g.archived) continue;
      const row = groupRowFor(slot.groupId);
      const rate =
        rateByGroupStudent.get(`${slot.groupId}|${a.studentId}`) ??
        fallbackRateForStudent(a.studentId);
      const exp = rate * hoursBetween(slot.startTime, slot.endTime);
      const paid = paySummed.get(`${a.slotId}|${a.date}|${a.studentId}`) ?? 0;
      // Per-session credit so partial overpayments don't offset elsewhere
      // at the group level (different students in a group).
      row.totalCredit += Math.max(0, exp - paid);
    }

    return {
      meta: {
        days,
        sessionsHeld,
        sessionsCancelled,
        sessionsUnlogged,
        studentPresences,
        studentAbsences,
      },
      byStudent: Array.from(byStudent.values()).sort(
        (a, b) => b.totalCredit - a.totalCredit || b.rangeCredit - a.rangeCredit || a.name.localeCompare(b.name),
      ),
      byGroup: Array.from(byGroup.values()).sort(
        (a, b) => b.totalCredit - a.totalCredit || b.sessionsHeld - a.sessionsHeld,
      ),
    };
  },
});
