// Exam-mode reminder (Founder, 2026-06-11).
//
// Exam-week mode is now a MANUAL switch on each examCalendar row (see
// calendar.setExamMode + determinePhase in learningEngine/planner.ts). This
// job is the nudge: a daily scan posts an in-app notification to Lead/Admin
// accounts when an exam is within EXAM_WEEK_DAYS but its switch is still off,
// so the teacher decides when to turn exam mode on.
//
// Triggered by convex/crons.ts. Deduped per (recipient, examCalendarId) while
// the previous alert is unactioned, so it posts once per exam — not daily.

import { internalMutation } from "./_generated/server";
import { EXAM_WEEK_DAYS } from "./learningEngine/config";

const MS_PER_DAY = 86_400_000;

function ymdFromMs(ms: number): string {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function daysBetweenYmd(from: string, to: string): number {
  const f = Date.parse(`${from}T00:00:00.000Z`);
  const t = Date.parse(`${to}T00:00:00.000Z`);
  if (Number.isNaN(f) || Number.isNaN(t)) return 0;
  return Math.round((t - f) / MS_PER_DAY);
}

export const scanAndNotify = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const todayYmd = ymdFromMs(now);
    const horizonYmd = ymdFromMs(now + EXAM_WEEK_DAYS * MS_PER_DAY);

    // Upcoming exams inside the reminder window whose manual switch is still off.
    const exams = await ctx.db.query("examCalendar").collect();
    const due = exams.filter(
      (r) =>
        r.examDate >= todayYmd &&
        r.examDate <= horizonYmd &&
        r.examModeActive !== true,
    );
    if (due.length === 0) return { posted: 0 };

    // Recipients: Lead/Admin teachers (they manage exam mode).
    const teachers = await ctx.db.query("teachers").collect();
    const recipients = teachers.filter(
      (t) => t.role === "lead" || t.role === "admin",
    );
    if (recipients.length === 0) return { posted: 0 };

    let posted = 0;
    for (const row of due) {
      const days = daysBetweenYmd(todayYmd, row.examDate);
      const rowKey = row._id as unknown as string;
      for (const t of recipients) {
        // Dedupe: skip if this recipient already has an unactioned reminder for
        // this exam row. Scan their recent notifications (small per user).
        const recent = await ctx.db
          .query("notifications")
          .withIndex("by_user_created", (q) =>
            q.eq("userClerkId", t.clerkUserId),
          )
          .order("desc")
          .take(100);
        const already = recent.some(
          (n) =>
            n.type === "exam_mode_suggest" &&
            !n.actionedAt &&
            (n.payload as { examCalendarId?: string } | undefined)
              ?.examCalendarId === rowKey,
        );
        if (already) continue;

        await ctx.db.insert("notifications", {
          userClerkId: t.clerkUserId,
          type: "exam_mode_suggest",
          title: `Exam mode suggested — G${row.grade} Term ${row.term}`,
          body: `G${row.grade} Term ${row.term} exam is in ${days} day${
            days === 1 ? "" : "s"
          }. Turn on Exam mode to focus sheets on the exam.`,
          priority: "high",
          actionUrl: "/algorithm/exam-calendar",
          payload: {
            examCalendarId: rowKey,
            grade: row.grade,
            term: row.term,
            examDate: row.examDate,
          },
          createdAt: now,
        });
        posted += 1;
      }
    }
    return { posted };
  },
});
