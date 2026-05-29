// Phase W.4 — Tomorrow's-class reminders.
//
// Trigger model (plan §4.2): the Lead opens /messaging/tomorrow after dinner.
// The page load runs previewTomorrow (a pure read — no draft is created on
// view), shows one merged card per parent for tomorrow's classes, and the Lead
// reviews + clicks Send. NO cron, NO auto-draft job. A human click is the only
// thing that ever puts a row on the queue.
//
// Identity unit = (parentPhone, tomorrowDate): ONE reminder per parent per day,
// mirroring W.2's absence model. Two children sharing a parentPhone collapse
// into one message whose body enumerates each child's class + time. The row is
// tagged batchId = "tomorrow-<YYYY-MM-DD>" and looked up via the existing
// messageQueue.by_batch index (no new schema column, no migration).
//
// Every send still flows through the existing queue → outbox → provider.ts
// chokepoint; this file only assembles drafts and flips them to "queued".
//
// dayOfWeek encoding: scheduleSlots / rooms.moduleTimetable use 1=Mon … 7=Sun
// (see src/lib/groups/time-grid.ts + convex/sessionRecords.ts:appDowForYmd).
// NOT 0=Sunday. Computing tomorrow as a raw JS getDay() would silently miss
// every Sunday slot, so we convert (0 → 7).

import { v } from "convex/values";
import { mutation, query, MutationCtx, QueryCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { Doc, Id } from "../_generated/dataModel";
import { tryNormalizeToE164SL } from "../lib/phone";
import { pickBestTemplate, renderTemplate } from "./templates";
import { effectiveRosterFor } from "../sessionRecords";
import { isQuietHourColombo, nextNonQuietMs } from "./policy";

// ── Date / time helpers (Asia/Colombo, UTC+05:30, no DST) ─────────────────

const MS_PER_MIN = 60_000;
const COLOMBO_OFFSET_MS = 330 * MS_PER_MIN;

const WEEKDAY_FULL: Record<number, string> = {
  1: "Monday",
  2: "Tuesday",
  3: "Wednesday",
  4: "Thursday",
  5: "Friday",
  6: "Saturday",
  7: "Sunday",
};

// Tomorrow in Asia/Colombo as YYYY-MM-DD, computed by offsetting now() into
// Colombo wall-clock, advancing one day, and formatting off the wall-clock
// fields (NOT toISOString, which would re-apply UTC).
function tomorrowDateInColombo(nowMs: number): string {
  const wall = new Date(nowMs + COLOMBO_OFFSET_MS);
  wall.setUTCDate(wall.getUTCDate() + 1);
  const y = wall.getUTCFullYear();
  const m = String(wall.getUTCMonth() + 1).padStart(2, "0");
  const d = String(wall.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// DayNum (1=Mon … 7=Sun) for a YYYY-MM-DD string, timezone-agnostic.
function dayNumForYmd(ymd: string): number {
  const d = new Date(ymd + "T00:00:00Z");
  const js = d.getUTCDay(); // 0=Sun..6=Sat
  return js === 0 ? 7 : js;
}

// "2026-05-30" → "30/05/2026" by string surgery (no tz interpretation).
function formatDateForMessage(date: string): string {
  const [y, m, d] = date.split("-");
  if (!y || !m || !d) return date;
  return `${d}/${m}/${y}`;
}

// "16:00" → "4.00pm" (Sri Lanka convention, founder-chosen 2026-05-29).
function formatTimeSL(hhmm: string): string {
  const [hStr, mStr] = hhmm.split(":");
  const h = Number(hStr);
  const m = Number(mStr ?? "0");
  if (Number.isNaN(h)) return hhmm;
  const ampm = h >= 12 ? "pm" : "am";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}.${String(m).padStart(2, "0")}${ampm}`;
}

function batchIdForDate(date: string): string {
  return `tomorrow-${date}`;
}

// ── Roster resolution (Phase F group path ∪ legacy slotStudents) ──────────

// One concrete class a student has tomorrow: which group/slot, module label,
// start time. groupKey collapses the multi-atom slot model (a 4–6pm class is
// stored as two 1-hour scheduleSlots rows) into ONE line per class, keeping the
// earliest start time.
type ClassEntry = {
  groupKey: string;
  moduleLabel: string;
  startTime: string; // "HH:MM" 24h, earliest atom
};

async function moduleLabelForSlot(
  ctx: QueryCtx,
  slot: Doc<"scheduleSlots">,
): Promise<string> {
  const room = await ctx.db.get(slot.roomId);
  const tt = (room?.moduleTimetable ?? undefined) as
    | Record<string, string>
    | undefined;
  const fromRoom = tt?.[String(slot.dayOfWeek)];
  if (fromRoom) return fromRoom;
  if (slot.groupId) {
    const group = await ctx.db.get(slot.groupId);
    if (group?.name) return group.name;
  }
  return "class";
}

// Resolve the roster for one slot on `date`: group members (override-aware) for
// Phase-F slots, else the legacy slotStudents archive. Returns student docs.
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

// ── Core computation (shared by the query and the mutations) ──────────────

type StudentPlan = {
  studentId: Id<"students">;
  name: string;
  classes: ClassEntry[]; // deduped by groupKey, earliest start
};

type ParentGroup = {
  phoneE164: string;
  parentContact: Doc<"parentContacts"> | null;
  optedOut: boolean;
  parentName: string;
  language: string;
  students: StudentPlan[]; // sorted by name
};

type Filters = { centerId?: Id<"centers">; grade?: number };

type ComputeResult = {
  groups: ParentGroup[]; // includes opted-out (caller decides visibility)
  noPhone: Array<{ studentId: Id<"students">; name: string }>;
  sessionsTomorrow: number; // distinct non-cancelled classes
  skippedOffDay: number;
  skippedCancelledSlots: number;
};

function passesFilters(student: Doc<"students">, f: Filters): boolean {
  if (f.centerId && student.centerId !== f.centerId) return false;
  if (f.grade !== undefined && student.schoolGrade !== f.grade) return false;
  return true;
}

// offDays defaults to ["sunday"] (sheet-planner convention). A student whose
// off-day is tomorrow's weekday is excluded — we don't tell a parent their
// child "has class tomorrow" on a day the child rests.
function isOffDay(student: Doc<"students">, weekdayLower: string): boolean {
  const off = student.offDays ?? ["sunday"];
  return off.map((d) => d.toLowerCase()).includes(weekdayLower);
}

async function computeTomorrowGroups(
  ctx: QueryCtx,
  date: string,
  filters: Filters,
): Promise<ComputeResult> {
  const dayNum = dayNumForYmd(date);
  const weekdayLower = (WEEKDAY_FULL[dayNum] ?? "").toLowerCase();

  const slots = await ctx.db
    .query("scheduleSlots")
    .withIndex("by_day", (q) => q.eq("dayOfWeek", dayNum))
    .collect();

  // Accumulate per-student class entries (keyed by studentId), tracking which
  // distinct classes run tomorrow for the summary count. Plain objects (not
  // Map) because the Convex tsconfig target predates iterable Map typing.
  const byStudent: Record<
    string,
    { student: Doc<"students">; entries: Record<string, ClassEntry> }
  > = {};
  const classKeysTomorrow = new Set<string>();
  let skippedCancelledSlots = 0;
  let skippedOffDay = 0;

  for (const slot of slots) {
    // Per-occurrence tutor cancellation for (slot, date) → no class tomorrow.
    const log = await ctx.db
      .query("sessionLogs")
      .withIndex("by_slot_date", (q) =>
        q.eq("slotId", slot._id).eq("date", date),
      )
      .first();
    if (log?.status === "cancelled_by_tutor") {
      skippedCancelledSlots += 1;
      continue;
    }

    const moduleLabel = await moduleLabelForSlot(ctx, slot);
    const groupKey = slot.groupId
      ? `g:${slot.groupId}`
      : `s:${slot._id}`; // legacy slots have no group; treat each slot as its own class
    classKeysTomorrow.add(groupKey);

    const roster = await rosterForSlot(ctx, slot, date);
    for (const student of roster) {
      if (!passesFilters(student, filters)) continue;
      if (isOffDay(student, weekdayLower)) {
        skippedOffDay += 1;
        continue;
      }
      let rec = byStudent[student._id];
      if (!rec) {
        rec = { student, entries: {} };
        byStudent[student._id] = rec;
      }
      const existing = rec.entries[groupKey];
      // Collapse multi-atom slots: keep the earliest start for the class.
      if (!existing || slot.startTime < existing.startTime) {
        rec.entries[groupKey] = { groupKey, moduleLabel, startTime: slot.startTime };
      }
    }
  }

  // Bucket students by normalized parent phone; collect no-phone students.
  const noPhone: Array<{ studentId: Id<"students">; name: string }> = [];
  const phoneToStudents: Record<string, StudentPlan[]> = {};
  for (const studentId of Object.keys(byStudent)) {
    const { student, entries } = byStudent[studentId];
    const classes: ClassEntry[] = Object.keys(entries)
      .map((k) => entries[k])
      .sort((a, b) => a.startTime.localeCompare(b.startTime));
    if (classes.length === 0) continue;
    const phone = tryNormalizeToE164SL(student.parentPhone);
    const plan: StudentPlan = {
      studentId: student._id,
      name: student.name,
      classes,
    };
    if (!phone) {
      noPhone.push({ studentId: student._id, name: student.name });
      continue;
    }
    if (!phoneToStudents[phone]) phoneToStudents[phone] = [];
    phoneToStudents[phone].push(plan);
  }

  const groups: ParentGroup[] = [];
  for (const phoneE164 of Object.keys(phoneToStudents)) {
    const plans = phoneToStudents[phoneE164];
    plans.sort((a, b) => a.name.localeCompare(b.name));
    const parentContact = await ctx.db
      .query("parentContacts")
      .withIndex("by_phone", (q) => q.eq("phoneE164", phoneE164))
      .first();
    const language = parentContact?.language ?? "ta";
    const parentName =
      parentContact?.displayName ??
      (language === "ta" ? "வணக்கம்" : "Hello");
    groups.push({
      phoneE164,
      parentContact: parentContact ?? null,
      optedOut: parentContact?.optedOut ?? false,
      parentName,
      language,
      students: plans,
    });
  }
  groups.sort((a, b) => a.parentName.localeCompare(b.parentName));

  return {
    groups,
    noPhone,
    sessionsTomorrow: classKeysTomorrow.size,
    skippedOffDay,
    skippedCancelledSlots,
  };
}

// Pre-rendered "{{student_lines}}" block: one "<name> - <module>, <time>" per
// class, joined with ";\n". The template appends the trailing period.
function buildStudentLines(group: ParentGroup): string {
  const lines: string[] = [];
  for (const s of group.students) {
    for (const c of s.classes) {
      lines.push(`${s.name} - ${c.moduleLabel}, ${formatTimeSL(c.startTime)}`);
    }
  }
  return lines.join(";\n");
}

async function renderTomorrowBody(
  ctx: QueryCtx,
  group: ParentGroup,
  date: string,
): Promise<string | null> {
  const rows = await ctx.db
    .query("messageTemplates")
    .withIndex("by_key_lang", (q) => q.eq("key", "tomorrow_reminder"))
    .collect();
  const tmpl = pickBestTemplate(rows, group.language);
  if (!tmpl) return null;
  return renderTemplate("tomorrow_reminder", tmpl.body, {
    parent_name: group.parentName,
    student_lines: buildStudentLines(group),
    date: formatDateForMessage(date),
  });
}

// ── Queue lookup / upsert (mirrors W.2 absenceAlerts) ─────────────────────

async function findTomorrowRow(
  ctx: QueryCtx,
  phoneE164: string,
  date: string,
): Promise<Doc<"messageQueue"> | null> {
  const rows = await ctx.db
    .query("messageQueue")
    .withIndex("by_batch", (q) => q.eq("batchId", batchIdForDate(date)))
    .collect();
  return (
    rows.find((r) => r.toPhone === phoneE164 && r.status !== "cancelled") ??
    null
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

// Idempotent create/merge for one parent group on `date`. Re-running (e.g.
// after a roster change or a second click) refreshes the draft body rather than
// inserting a duplicate. Already queued/sent rows are left alone.
async function upsertTomorrowDraft(
  ctx: MutationCtx,
  group: ParentGroup,
  date: string,
  createdByTeacherId?: Id<"teachers">,
): Promise<UpsertResult> {
  if (group.optedOut) return { status: "skipped", reason: "opted-out" };
  if (group.students.length === 0)
    return { status: "skipped", reason: "no-class" };

  const body = await renderTomorrowBody(ctx, group, date);
  if (body === null) return { status: "skipped", reason: "no-template" };

  const primaryStudentId = group.students[0].studentId;
  const existing = await findTomorrowRow(ctx, group.phoneE164, date);
  const merged = group.students.reduce((n, s) => n + s.classes.length, 0) > 1;

  if (existing) {
    if (existing.status === "sent")
      return { status: "already-sent", queueId: existing._id };
    if (existing.status === "queued" || existing.status === "sending")
      return { status: "already-queued", queueId: existing._id };
    if (existing.status === "failed") {
      await ctx.db.patch(existing._id, {
        body,
        language: group.language,
        studentId: primaryStudentId,
        status: "draft",
        attempts: 0,
        lastError: undefined,
      });
      return { status: "drafted", queueId: existing._id };
    }
    // draft: refresh body / merged name list.
    await ctx.db.patch(existing._id, {
      body,
      language: group.language,
      studentId: primaryStudentId,
    });
    return { status: merged ? "merged" : "drafted", queueId: existing._id };
  }

  const now = Date.now();
  const queueId = await ctx.db.insert("messageQueue", {
    templateKey: "tomorrow_reminder",
    language: group.language,
    toType: "contact",
    toPhone: group.phoneE164,
    studentId: primaryStudentId,
    body,
    status: "draft",
    priority: "normal",
    scheduledNotBefore: now,
    attempts: 0,
    batchId: batchIdForDate(date),
    createdByTeacherId,
    createdAt: now,
  });
  return { status: merged ? "merged" : "drafted", queueId };
}

// Flip a draft to queued, honouring quiet hours: inside 21:00–07:00 Colombo we
// stamp scheduledNotBefore to the next 07:00 so the deferral is visible on the
// row (the sender enforces it regardless; this just makes it auditable).
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

// ── Public query ──────────────────────────────────────────────────────────

export const previewTomorrow = query({
  args: {
    centerId: v.optional(v.id("centers")),
    grade: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    const date = tomorrowDateInColombo(Date.now());
    const dayNum = dayNumForYmd(date);
    const weekdayName = WEEKDAY_FULL[dayNum] ?? "";
    if (!identity) {
      return {
        date,
        weekdayName,
        summary: {
          totalParents: 0,
          totalStudents: 0,
          sessionsTomorrow: 0,
          skippedOptOut: 0,
          skippedNoPhone: 0,
          skippedOffDay: 0,
          skippedCancelledSlots: 0,
        },
        groups: [],
        noPhone: [],
      };
    }

    const filters: Filters = { centerId: args.centerId, grade: args.grade };
    const computed = await computeTomorrowGroups(ctx, date, filters);

    let skippedOptOut = 0;
    let totalStudents = 0;
    const groups = [];
    for (const g of computed.groups) {
      if (g.optedOut) {
        skippedOptOut += 1;
        continue; // opted-out parents produce no draft and are not listed (req #6)
      }
      const existing = await findTomorrowRow(ctx, g.phoneE164, date);
      const preview =
        existing?.body ?? (await renderTomorrowBody(ctx, g, date)) ?? "";
      totalStudents += g.students.length;
      groups.push({
        phoneE164: g.phoneE164,
        parentName: g.parentName,
        students: g.students.map((s) => ({
          studentId: s.studentId,
          name: s.name,
          classes: s.classes.map((c) => ({
            moduleLabel: c.moduleLabel,
            startTime: c.startTime,
            startLabel: formatTimeSL(c.startTime),
          })),
        })),
        studentNames: g.students.map((s) => s.name),
        preview,
        status: existing?.status ?? "none",
        queueId: existing?._id ?? null,
        sentAt: existing?.sentAt ?? null,
      });
    }

    // Actionable (none/draft/failed) first, then by parent name.
    const rank = (s: string) =>
      s === "none" || s === "draft" || s === "failed" ? 0 : 1;
    groups.sort(
      (a, b) =>
        rank(a.status) - rank(b.status) ||
        a.parentName.localeCompare(b.parentName),
    );

    return {
      date,
      weekdayName,
      summary: {
        totalParents: groups.length,
        totalStudents,
        sessionsTomorrow: computed.sessionsTomorrow,
        skippedOptOut,
        skippedNoPhone: computed.noPhone.length,
        skippedOffDay: computed.skippedOffDay,
        skippedCancelledSlots: computed.skippedCancelledSlots,
      },
      groups,
      noPhone: computed.noPhone,
    };
  },
});

// Quiet-hours pre-flight for the "Send all" confirm modal. Reminders are an
// evening routine, so being inside quiet hours is the EXPECTED case — the UI
// frames it as "delivers tomorrow from 07:00", not an error.
export const quietHoursPreflight = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return { inQuietHours: false, nextWindowStart: Date.now() };
    const now = Date.now();
    return {
      inQuietHours: isQuietHourColombo(now),
      nextWindowStart: nextNonQuietMs(now),
    };
  },
});

// ── Public mutations ──────────────────────────────────────────────────────

// Per-row Send: draft/merge this parent's reminder, queue it, kick the sender.
export const sendOneForTomorrow = mutation({
  args: {
    phoneE164: v.string(),
    centerId: v.optional(v.id("centers")),
    grade: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<UpsertResult & { deferred?: boolean }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    const teacherId = await requireTeacherId(ctx, identity.subject);
    const date = tomorrowDateInColombo(Date.now());

    const computed = await computeTomorrowGroups(ctx, date, {
      centerId: args.centerId,
      grade: args.grade,
    });
    const group = computed.groups.find((g) => g.phoneE164 === args.phoneE164);
    if (!group) return { status: "skipped", reason: "no-class" };

    const res = await upsertTomorrowDraft(ctx, group, date, teacherId);
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

// "Send all": ensure a draft exists for every actionable parent (skipping
// opted-out / already-queued / already-sent), queue them in one batch, kick the
// sender once. Returns counts for the outcome toast.
export const sendAllForTomorrow = mutation({
  args: {
    centerId: v.optional(v.id("centers")),
    grade: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    const teacherId = await requireTeacherId(ctx, identity.subject);
    const date = tomorrowDateInColombo(Date.now());

    const computed = await computeTomorrowGroups(ctx, date, {
      centerId: args.centerId,
      grade: args.grade,
    });

    const toQueue: Id<"messageQueue">[] = [];
    let alreadySent = 0;
    let skipped = 0;
    for (const group of computed.groups) {
      const res = await upsertTomorrowDraft(ctx, group, date, teacherId);
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
      nextWindowStart: deferred ? patch.scheduledNotBefore : null,
    };
  },
});
