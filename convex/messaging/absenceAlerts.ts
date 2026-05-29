// Phase W.2 — Absence alerts.
//
// Trigger model (plan §4.2, §8.3): a human marks a student absent in the
// per-session Attendance tab and taps "Save session" (sessionRecords.
// logSession persists attendance.status="absent"). The inline nudge then
// offers Draft / Send now. NO cron — every draft is created by a tap.
//
// Identity unit = (parentPhone, date): ONE absence message per parent per
// day (founder decision 2026-05-29). This is what makes sibling merging and
// dedup the same mechanism — both children of one phone collapse into one
// draft, and a second mark for the same phone/day updates that one row
// instead of inserting another. The row is tagged batchId = "absence-<date>"
// and looked up via the existing messageQueue.by_batch index (no new schema
// column, no migration).
//
// Every send still flows through the existing queue → outbox → provider.ts
// chokepoint; this file only assembles drafts and flips them to "queued".

import { v } from "convex/values";
import {
  mutation,
  query,
  MutationCtx,
  QueryCtx,
} from "../_generated/server";
import { internal } from "../_generated/api";
import { Doc, Id } from "../_generated/dataModel";
import { tryNormalizeToE164SL } from "../lib/phone";
import { pickBestTemplate, renderTemplate } from "./templates";

// ── Small helpers ───────────────────────────────────────────────────────

function batchIdForDate(date: string): string {
  return `absence-${date}`;
}

// "2026-05-29" → "29/05/2026". Done by string surgery to avoid any
// server-side timezone interpretation of the date.
function formatDateForMessage(date: string): string {
  const [y, m, d] = date.split("-");
  if (!y || !m || !d) return date;
  return `${d}/${m}/${y}`;
}

function joinNames(names: string[]): string {
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

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

// Find the single live absence row for (phone, date), if any. Uses the
// by_batch index; cancelled rows are ignored so a re-mark can re-draft.
async function findAbsenceRow(
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

// All students marked absent on `date` (any slot), with their parent phone
// normalized. Roster is small for a single tutor, so a full attendance scan
// is acceptable (sessionRecords.attendanceInsights does the same).
type AbsentStudent = {
  student: Doc<"students">;
  phoneE164: string | null;
};

async function absentStudentsOnDate(
  ctx: QueryCtx,
  date: string,
): Promise<AbsentStudent[]> {
  const attendance = await ctx.db.query("attendance").collect();
  const absentIds: Id<"students">[] = [];
  const seen = new Set<string>();
  for (const a of attendance) {
    if (a.date !== date || a.status !== "absent") continue;
    if (seen.has(a.studentId)) continue;
    seen.add(a.studentId);
    absentIds.push(a.studentId);
  }
  const out: AbsentStudent[] = [];
  for (const id of absentIds) {
    const student = await ctx.db.get(id);
    if (!student) continue;
    out.push({ student, phoneE164: tryNormalizeToE164SL(student.parentPhone) });
  }
  return out;
}

// One phone's worth of absent students on a date.
type PhoneGroup = {
  phoneE164: string;
  students: Doc<"students">[]; // sorted by name
  parentContact: Doc<"parentContacts"> | null;
  optedOut: boolean;
  parentName: string;
  language: string;
};

async function phoneGroupFor(
  ctx: QueryCtx,
  phoneE164: string,
  date: string,
): Promise<PhoneGroup | null> {
  const absentees = await absentStudentsOnDate(ctx, date);
  const students = absentees
    .filter((a) => a.phoneE164 === phoneE164)
    .map((a) => a.student)
    .sort((a, b) => a.name.localeCompare(b.name));
  if (students.length === 0) return null;
  const parentContact = await ctx.db
    .query("parentContacts")
    .withIndex("by_phone", (q) => q.eq("phoneE164", phoneE164))
    .first();
  const language = parentContact?.language ?? "ta";
  const parentName =
    parentContact?.displayName ?? (language === "ta" ? "வணக்கம்" : "Hello");
  return {
    phoneE164,
    students,
    parentContact,
    optedOut: parentContact?.optedOut ?? false,
    parentName,
    language,
  };
}

// Render the absence body for a group. Returns null if no active template
// exists for the key (renderer would otherwise have nothing to fill).
async function renderAbsenceBody(
  ctx: QueryCtx,
  group: PhoneGroup,
  date: string,
): Promise<string | null> {
  const templateRows = await ctx.db
    .query("messageTemplates")
    .withIndex("by_key_lang", (q) => q.eq("key", "absence_alert"))
    .collect();
  const tmpl = pickBestTemplate(templateRows, group.language);
  if (!tmpl) return null;
  return renderTemplate("absence_alert", tmpl.body, {
    parent_name: group.parentName,
    student_names: joinNames(group.students.map((s) => s.name)),
    date: formatDateForMessage(date),
  });
}

type UpsertResult = {
  status: "drafted" | "merged" | "already-queued" | "already-sent" | "skipped";
  queueId?: Id<"messageQueue">;
  reason?: string;
};

// Core create/merge for one (phone, date). Idempotent: re-running for the
// same phone (e.g. a second sibling) updates the existing draft's body to
// the current merged name list rather than inserting a duplicate.
async function upsertAbsenceDraft(
  ctx: MutationCtx,
  phoneE164: string,
  date: string,
  createdByTeacherId?: Id<"teachers">,
): Promise<UpsertResult> {
  const group = await phoneGroupFor(ctx, phoneE164, date);
  if (!group) return { status: "skipped", reason: "not-absent" };
  if (group.optedOut) return { status: "skipped", reason: "opted-out" };

  const body = await renderAbsenceBody(ctx, group, date);
  if (body === null) return { status: "skipped", reason: "no-template" };

  const primaryStudentId = group.students[0]._id;
  const existing = await findAbsenceRow(ctx, phoneE164, date);

  if (existing) {
    if (existing.status === "sent") {
      return { status: "already-sent", queueId: existing._id };
    }
    if (existing.status === "queued" || existing.status === "sending") {
      return { status: "already-queued", queueId: existing._id };
    }
    if (existing.status === "failed") {
      // Re-arm a failed row as a fresh draft so the Lead can resend.
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
    // status === "draft": merge in the latest name list.
    await ctx.db.patch(existing._id, {
      body,
      language: group.language,
      studentId: primaryStudentId,
    });
    return {
      status: group.students.length > 1 ? "merged" : "drafted",
      queueId: existing._id,
    };
  }

  const now = Date.now();
  const queueId = await ctx.db.insert("messageQueue", {
    templateKey: "absence_alert",
    language: group.language,
    toType: "contact",
    toPhone: phoneE164,
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
  return {
    status: group.students.length > 1 ? "merged" : "drafted",
    queueId,
  };
}

// ── Public mutations ──────────────────────────────────────────────────────

// [Draft] button on the inline nudge. Resolves the student's parent phone
// then drafts/merges. Safe to call repeatedly.
export const createDraftForAbsence = mutation({
  args: {
    studentId: v.id("students"),
    // slotId is informational only — dedup/merge keys off (phone, date), so a
    // caller without a specific slot (the Today tab) may omit it.
    slotId: v.optional(v.id("scheduleSlots")),
    date: v.string(),
  },
  handler: async (ctx, args): Promise<UpsertResult> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    const student = await ctx.db.get(args.studentId);
    if (!student) return { status: "skipped", reason: "no-student" };
    const phoneE164 = tryNormalizeToE164SL(student.parentPhone);
    if (!phoneE164) return { status: "skipped", reason: "no-phone" };
    const teacherId = await requireTeacherId(ctx, identity.subject);
    return await upsertAbsenceDraft(ctx, phoneE164, args.date, teacherId);
  },
});

// [Send now] button: draft/merge, then immediately queue + kick the outbox.
export const draftAndSendForAbsence = mutation({
  args: {
    studentId: v.id("students"),
    slotId: v.optional(v.id("scheduleSlots")),
    date: v.string(),
  },
  handler: async (ctx, args): Promise<UpsertResult> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    const student = await ctx.db.get(args.studentId);
    if (!student) return { status: "skipped", reason: "no-student" };
    const phoneE164 = tryNormalizeToE164SL(student.parentPhone);
    if (!phoneE164) return { status: "skipped", reason: "no-phone" };
    const teacherId = await requireTeacherId(ctx, identity.subject);
    const res = await upsertAbsenceDraft(ctx, phoneE164, args.date, teacherId);
    if (
      (res.status === "drafted" || res.status === "merged") &&
      res.queueId
    ) {
      const now = Date.now();
      await ctx.db.patch(res.queueId, {
        status: "queued",
        approvedByTeacherId: teacherId,
        approvedAt: now,
        scheduledNotBefore: now,
      });
      await ctx.scheduler.runAfter(
        0,
        internal.messaging.outbox.processNext,
        {},
      );
    }
    return res;
  },
});

// Flip a specific set of absence drafts to queued and kick the sender. Used
// by per-row actions where the queueId is already known.
export const approveAbsenceDrafts = mutation({
  args: { queueIds: v.array(v.id("messageQueue")) },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    const teacherId = await requireTeacherId(ctx, identity.subject);
    const now = Date.now();
    let flipped = 0;
    for (const id of args.queueIds) {
      const m = await ctx.db.get(id);
      if (!m || m.status !== "draft") continue;
      await ctx.db.patch(id, {
        status: "queued",
        approvedByTeacherId: teacherId,
        approvedAt: now,
        scheduledNotBefore: now,
      });
      flipped += 1;
    }
    if (flipped > 0) {
      await ctx.scheduler.runAfter(
        0,
        internal.messaging.outbox.processNext,
        {},
      );
    }
    return { flipped };
  },
});

// Today tab "Send all": ensure a draft exists for every absent parent on the
// date (skipping opted-out / no-phone / already-sent), then queue them all in
// one go and kick the sender.
export const sendAllForDate = mutation({
  args: { date: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    const teacherId = await requireTeacherId(ctx, identity.subject);

    const absentees = await absentStudentsOnDate(ctx, args.date);
    const phones = new Set<string>();
    for (const a of absentees) {
      if (a.phoneE164) phones.add(a.phoneE164);
    }

    const toQueue: Id<"messageQueue">[] = [];
    let skipped = 0;
    for (const phone of Array.from(phones)) {
      const res = await upsertAbsenceDraft(ctx, phone, args.date, teacherId);
      if (
        (res.status === "drafted" || res.status === "merged") &&
        res.queueId
      ) {
        toQueue.push(res.queueId);
      } else {
        skipped += 1;
      }
    }

    const now = Date.now();
    for (const id of toQueue) {
      await ctx.db.patch(id, {
        status: "queued",
        approvedByTeacherId: teacherId,
        approvedAt: now,
        scheduledNotBefore: now,
      });
    }
    if (toQueue.length > 0) {
      await ctx.scheduler.runAfter(
        0,
        internal.messaging.outbox.processNext,
        {},
      );
    }
    return { queued: toQueue.length, skipped };
  },
});

// ── Public queries ──────────────────────────────────────────────────────

// State for the inline nudge under one absent student's row. The card keys
// off PERSISTED attendance (the student must already be saved as absent for
// a phone group to exist), matching the "after Save" trigger.
export const nudgeStateForStudent = query({
  args: {
    studentId: v.id("students"),
    slotId: v.id("scheduleSlots"),
    date: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const student = await ctx.db.get(args.studentId);
    if (!student) return { kind: "no-student" as const };
    const phoneE164 = tryNormalizeToE164SL(student.parentPhone);
    if (!phoneE164) return { kind: "no-phone" as const };

    const group = await phoneGroupFor(ctx, phoneE164, args.date);
    // No group means this student isn't persisted-absent yet (e.g. toggled
    // but not saved). The UI only renders the nudge for saved-absent rows,
    // but guard anyway.
    const studentNames = group ? group.students.map((s) => s.name) : [student.name];
    const namesLabel = joinNames(studentNames);

    if (group?.optedOut) {
      return { kind: "opted-out" as const, parentName: group.parentName };
    }

    const existing = await findAbsenceRow(ctx, phoneE164, args.date);
    const parentName = group?.parentName ?? "";
    const isMerged = studentNames.length > 1;
    // The "primary" student owns the actionable card. If a row exists it's
    // whoever the row points at; otherwise it's the first sibling by name, so
    // only ONE idle card shows a Send button (the rest say "included").
    const isPrimary = existing
      ? existing.studentId === args.studentId
      : group
        ? group.students[0]._id === args.studentId
        : true;

    if (existing) {
      if (existing.status === "sent") {
        return {
          kind: "sent" as const,
          queueId: existing._id,
          sentAt: existing.sentAt ?? null,
          namesLabel,
          isMerged,
          isPrimary,
        };
      }
      if (existing.status === "queued" || existing.status === "sending") {
        return {
          kind: "queued" as const,
          queueId: existing._id,
          namesLabel,
          isMerged,
          isPrimary,
        };
      }
      if (existing.status === "draft") {
        return {
          kind: "draft" as const,
          queueId: existing._id,
          body: existing.body,
          namesLabel,
          isMerged,
          isPrimary,
        };
      }
      if (existing.status === "failed") {
        return {
          kind: "failed" as const,
          queueId: existing._id,
          namesLabel,
          isMerged,
          isPrimary,
        };
      }
    }

    return {
      kind: "idle" as const,
      parentName,
      namesLabel,
      isMerged,
      isPrimary,
    };
  },
});

// Today tab: every parent with an absent child on `date`, sibling-merged,
// each with its current send state and a body preview. Plus a list of absent
// students with no usable parent phone (so the Lead can fix the record).
export const todayAbsences = query({
  args: { date: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return { date: args.date, groups: [], noPhone: [] };
    }
    const absentees = await absentStudentsOnDate(ctx, args.date);

    const phones: string[] = [];
    const noPhone: Array<{ studentId: Id<"students">; name: string }> = [];
    const seenPhone = new Set<string>();
    for (const a of absentees) {
      if (!a.phoneE164) {
        noPhone.push({ studentId: a.student._id, name: a.student.name });
        continue;
      }
      if (seenPhone.has(a.phoneE164)) continue;
      seenPhone.add(a.phoneE164);
      phones.push(a.phoneE164);
    }

    const groups = [];
    for (const phone of phones) {
      const group = await phoneGroupFor(ctx, phone, args.date);
      if (!group) continue;
      const existing = await findAbsenceRow(ctx, phone, args.date);
      const preview =
        existing?.body ?? (await renderAbsenceBody(ctx, group, args.date)) ?? "";
      groups.push({
        phoneE164: phone,
        parentName: group.parentName,
        studentNames: group.students.map((s) => s.name),
        primaryStudentId: group.students[0]._id,
        primarySlotId: null as Id<"scheduleSlots"> | null, // not needed; send keys off phone+date
        optedOut: group.optedOut,
        status: existing?.status ?? "none",
        queueId: existing?._id ?? null,
        sentAt: existing?.sentAt ?? null,
        preview,
      });
    }

    // Sort: actionable (none/draft) first, then by parent name.
    const rank = (s: string) =>
      s === "none" || s === "draft" || s === "failed" ? 0 : 1;
    groups.sort(
      (a, b) =>
        rank(a.status) - rank(b.status) ||
        a.parentName.localeCompare(b.parentName),
    );

    return { date: args.date, groups, noPhone };
  },
});
