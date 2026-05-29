// Phase W.5.D — Weekly performance cards (the moat, text-only variant).
//
// The Sunday-evening routine: the Lead opens /messaging/weekly-cards, reviews a
// pre-built attendance summary per parent for the week that just ended, edits
// any card for a personal touch, and sends. Page-load computes the drafts (pure
// read); a human click queues them. NO cron. Sibling-merged + deduped on
// (parentPhone, weekStartDate) via batchId="weeklycards-<weekStartDate>",
// mirroring W.2/W.4.
//
// CONTENT DECISION (2026-05-29): the card carries ATTENDANCE only. points +
// rank have no data source in the app; learning-engine module mastery is empty
// for nearly all students. Attendance (logged "held" sessions) is the one real,
// populated weekly metric. Richer stats are a separate future build. The Lead
// can reword via the Templates editor (W.5.C); a single card can be hand-edited
// via the per-card edit modal (W.5.D.3 — edited rows go freeform, templateKey
// cleared, and are preserved across re-computes).

import { v } from "convex/values";
import { mutation, query, internalQuery, MutationCtx, QueryCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { Doc, Id } from "../_generated/dataModel";
import { tryNormalizeToE164SL } from "../lib/phone";
import { pickBestTemplate, renderTemplate } from "./templates";
import { effectiveRosterFor } from "../sessionRecords";
import { isQuietHourColombo, nextNonQuietMs } from "./policy";

// ── Date helpers (Asia/Colombo, UTC+05:30, no DST) ────────────────────────

const MS_PER_MIN = 60_000;
const COLOMBO_OFFSET_MS = 330 * MS_PER_MIN;
const MS_PER_DAY = 86_400_000;

function colomboWall(ms: number): Date {
  return new Date(ms + COLOMBO_OFFSET_MS);
}
function ymdFromWall(wall: Date): string {
  const y = wall.getUTCFullYear();
  const m = String(wall.getUTCMonth() + 1).padStart(2, "0");
  const d = String(wall.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
// DayNum 1=Mon..7=Sun for a YYYY-MM-DD.
function dayNumForYmd(ymd: string): number {
  const js = new Date(ymd + "T00:00:00Z").getUTCDay();
  return js === 0 ? 7 : js;
}
function addDaysYmd(ymd: string, n: number): string {
  const base = new Date(ymd + "T00:00:00Z").getTime() + n * MS_PER_DAY;
  return ymdFromWall(new Date(base));
}
// Monday (YYYY-MM-DD) of the ISO week containing `today` in Colombo, shifted by
// offsetWeeks (0 = this week, -1 = last completed week).
function mondayOfWeekColombo(nowMs: number, offsetWeeks: number): string {
  const todayYmd = ymdFromWall(colomboWall(nowMs));
  const dn = dayNumForYmd(todayYmd); // 1=Mon
  return addDaysYmd(todayYmd, -(dn - 1) + offsetWeeks * 7);
}
// "2026-05-25" + Sunday end → "25/05 – 31/05".
function weekLabel(weekStartDate: string): string {
  const end = addDaysYmd(weekStartDate, 6);
  const [, sm, sd] = weekStartDate.split("-");
  const [, em, ed] = end.split("-");
  return `${sd}/${sm} – ${ed}/${em}`;
}

function batchIdForWeek(weekStartDate: string): string {
  return `weeklycards-${weekStartDate}`;
}

// ── Roster (Phase F group path ∪ legacy slotStudents) ─────────────────────

async function rosterForSlot(
  ctx: QueryCtx,
  slot: Doc<"scheduleSlots">,
  date: string,
): Promise<Doc<"students">[]> {
  if (slot.groupId) {
    const roster = await effectiveRosterFor(ctx, slot, date);
    return roster.map((r) => r.student);
  }
  const links = await ctx.db
    .query("slotStudents")
    .withIndex("by_slot", (q) => q.eq("slotId", slot._id))
    .collect();
  const out: Doc<"students">[] = [];
  for (const l of links) {
    const s = await ctx.db.get(l.studentId);
    if (s) out.push(s);
  }
  return out;
}

// ── Weekly attendance aggregation ─────────────────────────────────────────
//
// Counts only LOGGED ("held") sessions toward each student's total, so an
// unlogged or cancelled session never penalises a student's ratio. attended =
// present marks within those held sessions.
type WeekRollup = {
  student: Doc<"students">;
  attended: number;
  total: number;
};

async function weeklyAttendance(
  ctx: QueryCtx,
  weekStartDate: string,
): Promise<Record<string, WeekRollup>> {
  const byStudent: Record<string, WeekRollup> = {};
  for (let i = 0; i < 7; i++) {
    const date = addDaysYmd(weekStartDate, i);
    const dayNum = dayNumForYmd(date);
    const slots = await ctx.db
      .query("scheduleSlots")
      .withIndex("by_day", (q) => q.eq("dayOfWeek", dayNum))
      .collect();
    for (const slot of slots) {
      const log = await ctx.db
        .query("sessionLogs")
        .withIndex("by_slot_date", (q) =>
          q.eq("slotId", slot._id).eq("date", date),
        )
        .first();
      // Only count sessions the tutor actually logged as held.
      if (!log || log.status !== "held") continue;

      const attendance = await ctx.db
        .query("attendance")
        .withIndex("by_slot_date", (q) =>
          q.eq("slotId", slot._id).eq("date", date),
        )
        .collect();
      const statusById = new Map(attendance.map((a) => [a.studentId, a.status]));

      const roster = await rosterForSlot(ctx, slot, date);
      for (const student of roster) {
        let rec = byStudent[student._id];
        if (!rec) {
          rec = { student, attended: 0, total: 0 };
          byStudent[student._id] = rec;
        }
        rec.total += 1;
        if (statusById.get(student._id) === "present") rec.attended += 1;
      }
    }
  }
  return byStudent;
}

// ── Grouping + rendering ──────────────────────────────────────────────────

type Filters = { centerId?: Id<"centers">; grade?: number };

function passesFilters(student: Doc<"students">, f: Filters): boolean {
  if (f.centerId && student.centerId !== f.centerId) return false;
  if (f.grade !== undefined && student.schoolGrade !== f.grade) return false;
  return true;
}

type StudentLine = { studentId: Id<"students">; name: string; attended: number; total: number };

type ParentGroup = {
  phoneE164: string;
  parentContact: Doc<"parentContacts"> | null;
  optedOut: boolean;
  parentName: string;
  language: string;
  students: StudentLine[];
};

function lineFor(language: string, s: StudentLine): string {
  return language === "ta"
    ? `${s.name}: ${s.total} இல் ${s.attended} வகுப்பில் கலந்துள்ளார்`
    : `${s.name}: attended ${s.attended} of ${s.total} classes`;
}

function buildStudentLines(group: ParentGroup): string {
  return group.students.map((s) => lineFor(group.language, s)).join("\n");
}

async function renderWeeklyBody(
  ctx: QueryCtx,
  group: ParentGroup,
  weekStartDate: string,
): Promise<string | null> {
  const rows = await ctx.db
    .query("messageTemplates")
    .withIndex("by_key_lang", (q) => q.eq("key", "weekly_card"))
    .collect();
  const tmpl = pickBestTemplate(rows, group.language);
  if (!tmpl) return null;
  return renderTemplate("weekly_card", tmpl.body, {
    parent_name: group.parentName,
    week_label: weekLabel(weekStartDate),
    student_lines: buildStudentLines(group),
  });
}

type ComputeResult = {
  groups: ParentGroup[];
  noPhone: Array<{ studentId: Id<"students">; name: string }>;
  skippedNoWeekData: number;
};

async function computeWeeklyGroups(
  ctx: QueryCtx,
  weekStartDate: string,
  filters: Filters,
): Promise<ComputeResult> {
  const rollups = await weeklyAttendance(ctx, weekStartDate);

  const noPhone: Array<{ studentId: Id<"students">; name: string }> = [];
  const phoneToStudents: Record<string, StudentLine[]> = {};
  let skippedNoWeekData = 0;

  for (const studentId of Object.keys(rollups)) {
    const { student, attended, total } = rollups[studentId];
    if (!passesFilters(student, filters)) continue;
    if (total === 0) {
      skippedNoWeekData += 1;
      continue; // no held sessions this week → nothing meaningful to report
    }
    const line: StudentLine = { studentId: student._id, name: student.name, attended, total };
    const phone = tryNormalizeToE164SL(student.parentPhone);
    if (!phone) {
      noPhone.push({ studentId: student._id, name: student.name });
      continue;
    }
    if (!phoneToStudents[phone]) phoneToStudents[phone] = [];
    phoneToStudents[phone].push(line);
  }

  const groups: ParentGroup[] = [];
  for (const phoneE164 of Object.keys(phoneToStudents)) {
    const students = phoneToStudents[phoneE164].sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    const parentContact = await ctx.db
      .query("parentContacts")
      .withIndex("by_phone", (q) => q.eq("phoneE164", phoneE164))
      .first();
    const language = parentContact?.language ?? "ta";
    const parentName =
      parentContact?.displayName ?? (language === "ta" ? "வணக்கம்" : "Hello");
    groups.push({
      phoneE164,
      parentContact: parentContact ?? null,
      optedOut: parentContact?.optedOut ?? false,
      parentName,
      language,
      students,
    });
  }
  groups.sort((a, b) => a.parentName.localeCompare(b.parentName));
  return { groups, noPhone, skippedNoWeekData };
}

// ── Queue lookup / upsert ─────────────────────────────────────────────────

async function findWeeklyRow(
  ctx: QueryCtx,
  phoneE164: string,
  weekStartDate: string,
): Promise<Doc<"messageQueue"> | null> {
  const rows = await ctx.db
    .query("messageQueue")
    .withIndex("by_batch", (q) => q.eq("batchId", batchIdForWeek(weekStartDate)))
    .collect();
  return (
    rows.find((r) => r.toPhone === phoneE164 && r.status !== "cancelled") ?? null
  );
}

type UpsertResult = {
  status: "drafted" | "merged" | "already-queued" | "already-sent" | "skipped";
  queueId?: Id<"messageQueue">;
  reason?: string;
};

async function requireTeacherId(
  ctx: MutationCtx,
  clerkSubject: string,
): Promise<Id<"teachers"> | undefined> {
  const t = await ctx.db
    .query("teachers")
    .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", clerkSubject))
    .first();
  return t?._id;
}

// Idempotent create/merge. A draft the Lead has hand-edited (templateKey
// cleared → freeform) is preserved: its body is NOT overwritten on re-compute.
async function upsertWeeklyDraft(
  ctx: MutationCtx,
  group: ParentGroup,
  weekStartDate: string,
  createdByTeacherId?: Id<"teachers">,
): Promise<UpsertResult> {
  if (group.optedOut) return { status: "skipped", reason: "opted-out" };
  if (group.students.length === 0) return { status: "skipped", reason: "no-data" };

  const body = await renderWeeklyBody(ctx, group, weekStartDate);
  if (body === null) return { status: "skipped", reason: "no-template" };

  const primaryStudentId = group.students[0].studentId;
  const existing = await findWeeklyRow(ctx, group.phoneE164, weekStartDate);
  const merged = group.students.length > 1;

  if (existing) {
    if (existing.status === "sent") return { status: "already-sent", queueId: existing._id };
    if (existing.status === "queued" || existing.status === "sending")
      return { status: "already-queued", queueId: existing._id };
    if (existing.status === "failed") {
      await ctx.db.patch(existing._id, {
        body,
        templateKey: "weekly_card",
        language: group.language,
        studentId: primaryStudentId,
        status: "draft",
        attempts: 0,
        lastError: undefined,
      });
      return { status: "drafted", queueId: existing._id };
    }
    // draft: preserve a hand-edited (freeform) body; otherwise refresh.
    if (existing.templateKey === undefined) {
      return { status: merged ? "merged" : "drafted", queueId: existing._id };
    }
    await ctx.db.patch(existing._id, {
      body,
      language: group.language,
      studentId: primaryStudentId,
    });
    return { status: merged ? "merged" : "drafted", queueId: existing._id };
  }

  const now = Date.now();
  const queueId = await ctx.db.insert("messageQueue", {
    templateKey: "weekly_card",
    language: group.language,
    toType: "contact",
    toPhone: group.phoneE164,
    studentId: primaryStudentId,
    body,
    status: "draft",
    priority: "normal",
    scheduledNotBefore: now,
    attempts: 0,
    batchId: batchIdForWeek(weekStartDate),
    createdByTeacherId,
    createdAt: now,
  });
  return { status: merged ? "merged" : "drafted", queueId };
}

function queuePatch(now: number, teacherId?: Id<"teachers">) {
  const inQuiet = isQuietHourColombo(now);
  return {
    patch: {
      status: "queued" as const,
      approvedByTeacherId: teacherId,
      approvedAt: now,
      scheduledNotBefore: inQuiet ? nextNonQuietMs(now) : now,
    },
    deferred: inQuiet,
  };
}

// ── Public queries ────────────────────────────────────────────────────────

// Recent Monday week-starts (Colombo) for the week selector, newest first.
export const recentWeekStarts = query({
  args: { count: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const count = Math.min(args.count ?? 8, 26);
    const now = Date.now();
    const out: Array<{ weekStartDate: string; label: string; isCurrent: boolean }> = [];
    for (let i = 0; i < count; i++) {
      const ws = mondayOfWeekColombo(now, -i);
      out.push({ weekStartDate: ws, label: weekLabel(ws), isCurrent: i === 0 });
    }
    return out;
  },
});

export const previewWeeklyCards = query({
  args: {
    weekStartDate: v.optional(v.string()),
    centerId: v.optional(v.id("centers")),
    grade: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    // Default to last completed week (offset -1).
    const weekStartDate =
      args.weekStartDate ?? mondayOfWeekColombo(Date.now(), -1);
    const label = weekLabel(weekStartDate);
    if (!identity) {
      return {
        weekStartDate,
        weekLabel: label,
        summary: { totalParents: 0, totalStudents: 0, skippedOptOut: 0, skippedNoPhone: 0, skippedNoWeekData: 0 },
        groups: [],
        noPhone: [],
      };
    }

    const filters: Filters = { centerId: args.centerId, grade: args.grade };
    const computed = await computeWeeklyGroups(ctx, weekStartDate, filters);

    let skippedOptOut = 0;
    let totalStudents = 0;
    const groups = [];
    for (const g of computed.groups) {
      if (g.optedOut) {
        skippedOptOut += 1;
        continue;
      }
      const existing = await findWeeklyRow(ctx, g.phoneE164, weekStartDate);
      const preview =
        existing?.body ?? (await renderWeeklyBody(ctx, g, weekStartDate)) ?? "";
      totalStudents += g.students.length;
      groups.push({
        phoneE164: g.phoneE164,
        parentName: g.parentName,
        students: g.students,
        studentNames: g.students.map((s) => s.name),
        preview,
        edited: existing?.templateKey === undefined && existing !== null,
        status: existing?.status ?? "none",
        queueId: existing?._id ?? null,
        sentAt: existing?.sentAt ?? null,
      });
    }

    const rank = (s: string) => (s === "none" || s === "draft" || s === "failed" ? 0 : 1);
    groups.sort(
      (a, b) => rank(a.status) - rank(b.status) || a.parentName.localeCompare(b.parentName),
    );

    return {
      weekStartDate,
      weekLabel: label,
      summary: {
        totalParents: groups.length,
        totalStudents,
        skippedOptOut,
        skippedNoPhone: computed.noPhone.length,
        skippedNoWeekData: computed.skippedNoWeekData,
      },
      groups,
      noPhone: computed.noPhone,
    };
  },
});

export const quietHoursPreflight = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return { inQuietHours: false, nextWindowStart: Date.now() };
    const now = Date.now();
    return { inQuietHours: isQuietHourColombo(now), nextWindowStart: nextNonQuietMs(now) };
  },
});

// ── Public mutations ──────────────────────────────────────────────────────

// Per-card edit (W.5.D.3). Saves a hand-written body as a freeform draft
// (templateKey cleared) so re-computes preserve it. Creates the row if needed.
export const saveCardEdit = mutation({
  args: { phoneE164: v.string(), weekStartDate: v.string(), body: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    const text = args.body.trim();
    if (!text) throw new Error("Card body is empty");
    const teacherId = await requireTeacherId(ctx, identity.subject);
    const existing = await findWeeklyRow(ctx, args.phoneE164, args.weekStartDate);
    if (existing) {
      if (existing.status === "sent" || existing.status === "queued" || existing.status === "sending") {
        throw new Error(`Cannot edit a ${existing.status} card`);
      }
      await ctx.db.patch(existing._id, {
        body: text,
        templateKey: undefined, // mark as hand-edited / freeform
      });
      return { queueId: existing._id };
    }
    const now = Date.now();
    const queueId = await ctx.db.insert("messageQueue", {
      toType: "contact",
      toPhone: args.phoneE164,
      body: text,
      status: "draft",
      priority: "normal",
      scheduledNotBefore: now,
      attempts: 0,
      batchId: batchIdForWeek(args.weekStartDate),
      createdByTeacherId: teacherId,
      createdAt: now,
    });
    return { queueId };
  },
});

export const sendOneForWeek = mutation({
  args: {
    phoneE164: v.string(),
    weekStartDate: v.string(),
    centerId: v.optional(v.id("centers")),
    grade: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<UpsertResult & { deferred?: boolean }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    const teacherId = await requireTeacherId(ctx, identity.subject);

    // If the Lead hand-edited this card, queue the existing freeform row as-is.
    const existing = await findWeeklyRow(ctx, args.phoneE164, args.weekStartDate);
    if (existing && existing.status === "draft" && existing.templateKey === undefined) {
      const now = Date.now();
      const { patch, deferred } = queuePatch(now, teacherId);
      await ctx.db.patch(existing._id, patch);
      await ctx.scheduler.runAfter(0, internal.messaging.outbox.processNext, {});
      return { status: "drafted", queueId: existing._id, deferred };
    }

    const computed = await computeWeeklyGroups(ctx, args.weekStartDate, {
      centerId: args.centerId,
      grade: args.grade,
    });
    const group = computed.groups.find((g) => g.phoneE164 === args.phoneE164);
    if (!group) return { status: "skipped", reason: "no-data" };

    const res = await upsertWeeklyDraft(ctx, group, args.weekStartDate, teacherId);
    if ((res.status === "drafted" || res.status === "merged") && res.queueId) {
      const now = Date.now();
      const { patch, deferred } = queuePatch(now, teacherId);
      await ctx.db.patch(res.queueId, patch);
      await ctx.scheduler.runAfter(0, internal.messaging.outbox.processNext, {});
      return { ...res, deferred };
    }
    return res;
  },
});

export const sendAllForWeek = mutation({
  args: {
    weekStartDate: v.string(),
    centerId: v.optional(v.id("centers")),
    grade: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    const teacherId = await requireTeacherId(ctx, identity.subject);

    const computed = await computeWeeklyGroups(ctx, args.weekStartDate, {
      centerId: args.centerId,
      grade: args.grade,
    });

    const toQueue: Id<"messageQueue">[] = [];
    let alreadySent = 0;
    let skipped = 0;
    for (const group of computed.groups) {
      const res = await upsertWeeklyDraft(ctx, group, args.weekStartDate, teacherId);
      if ((res.status === "drafted" || res.status === "merged") && res.queueId) {
        toQueue.push(res.queueId);
      } else if (res.status === "already-sent" || res.status === "already-queued") {
        alreadySent += 1;
      } else {
        skipped += 1;
      }
    }

    const now = Date.now();
    const { patch, deferred } = queuePatch(now, teacherId);
    for (const id of toQueue) {
      await ctx.db.patch(id, patch);
    }
    if (toQueue.length > 0) {
      await ctx.scheduler.runAfter(0, internal.messaging.outbox.processNext, {});
    }
    return {
      queued: toQueue.length,
      alreadySent,
      skipped,
      deferredToMorning: deferred ? toQueue.length : 0,
    };
  },
});

// CLI smoke-test twin (no auth) — exercises aggregate → group → render on a
// deployment without a browser. Catches a render throw before the Lead clicks.
export const previewWeeklyInternal = internalQuery({
  args: { weekStartDate: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const weekStartDate = args.weekStartDate ?? mondayOfWeekColombo(Date.now(), -1);
    const computed = await computeWeeklyGroups(ctx, weekStartDate, {});
    const sample = computed.groups.find((g) => !g.optedOut) ?? null;
    return {
      weekStartDate,
      counts: {
        parents: computed.groups.length,
        noPhone: computed.noPhone.length,
        noWeekData: computed.skippedNoWeekData,
      },
      sampleBody: sample ? await renderWeeklyBody(ctx, sample, weekStartDate) : null,
    };
  },
});
