// Consolidation-mode reminders (departments redesign, 2026-07-14).
//
// The per-student learning mode is MANUAL (students.learningMode, flipped on
// the Track Progress page). This job is the nudge, twin of examAlerts: a
// daily scan reads every student's recent attempts and posts an in-app
// notification to Lead/Admin when
//   • a NORMAL student's failure rate says they need consolidation, or
//   • a CONSOLIDATION student has recovered and should go back to normal.
// Pure math in convex/lib/consolidationCore.ts; thresholds in
// learningEngine/config.ts. Deduped per (recipient, student, direction)
// while the previous alert is unactioned — posts once per episode, not daily.

import { internalMutation, query } from "./_generated/server";
import { v } from "convex/values";
import {
  assessConsolidation,
  type ConsolidationAssessment,
} from "./lib/consolidationCore";
import {
  CONSOLIDATION_ENTER_FAIL_RATE,
  CONSOLIDATION_EXIT_FAIL_RATE,
  CONSOLIDATION_MIN_ATTEMPTS,
  CONSOLIDATION_WINDOW_DAYS,
} from "./learningEngine/config";
import type { QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

const MS_PER_DAY = 86_400_000;

async function assessStudent(
  ctx: QueryCtx,
  studentId: Id<"students">,
  learningMode: string | undefined,
  asOfMs: number,
): Promise<ConsolidationAssessment> {
  const windowStart = asOfMs - CONSOLIDATION_WINDOW_DAYS * MS_PER_DAY;
  const attempts = await ctx.db
    .query("attemptLog")
    .withIndex("by_student_time", (q) =>
      q.eq("studentId", studentId).gte("occurredAt", windowStart),
    )
    .collect();
  return assessConsolidation({
    attempts: attempts.map((a) => ({ response: a.response, weight: a.weight })),
    currentMode:
      (learningMode ?? "normal") === "consolidation"
        ? "consolidation"
        : "normal",
    enterFailRate: CONSOLIDATION_ENTER_FAIL_RATE,
    exitFailRate: CONSOLIDATION_EXIT_FAIL_RATE,
    minAttempts: CONSOLIDATION_MIN_ATTEMPTS,
  });
}

// Live status for ONE student — the Track Progress page's mode card reads
// this so the human sees the same numbers the daily scan acts on.
export const consolidationStatus = query({
  args: { studentId: v.id("students") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const student = await ctx.db.get(args.studentId);
    if (!student) return null;
    const a = await assessStudent(
      ctx,
      args.studentId,
      student.learningMode,
      Date.now(),
    );
    return {
      mode: (student.learningMode ?? "normal") as "normal" | "consolidation",
      verdict: a.verdict,
      failRate: a.failRate,
      attemptCount: a.attemptCount,
      windowDays: CONSOLIDATION_WINDOW_DAYS,
    };
  },
});

export const scanAndNotify = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();

    const students = await ctx.db.query("students").collect();
    const teachers = await ctx.db.query("teachers").collect();
    const recipients = teachers.filter(
      (t) => t.role === "lead" || t.role === "admin",
    );
    if (recipients.length === 0) return { posted: 0 };

    let posted = 0;
    for (const s of students) {
      const a = await assessStudent(ctx, s._id, s.learningMode, now);
      if (a.verdict === "ok") continue;

      const type =
        a.verdict === "suggest-consolidation"
          ? "consolidation_suggest"
          : "consolidation_recovered";
      const pct = Math.round((a.failRate ?? 0) * 100);
      const title =
        a.verdict === "suggest-consolidation"
          ? `${s.name} is struggling — consolidation mode?`
          : `${s.name} has recovered — back to normal mode?`;
      const body =
        a.verdict === "suggest-consolidation"
          ? `${s.name} failed ${pct}% (weighted) of ${a.attemptCount} recent questions over ${CONSOLIDATION_WINDOW_DAYS} days. Consider switching them to consolidation mode (repeat-heavy revision).`
          : `${s.name} is down to ${pct}% failures over ${a.attemptCount} recent questions. Consider switching them back to normal mode (coverage ladder, no repeats).`;

      const studentKey = s._id as unknown as string;
      for (const t of recipients) {
        // Dedupe: skip while this recipient still has an unactioned alert of
        // the same direction for this student.
        const recent = await ctx.db
          .query("notifications")
          .withIndex("by_user_created", (q) =>
            q.eq("userClerkId", t.clerkUserId),
          )
          .order("desc")
          .take(100);
        const already = recent.some(
          (n) =>
            n.type === type &&
            !n.actionedAt &&
            (n.payload as { studentId?: string } | undefined)?.studentId ===
              studentKey,
        );
        if (already) continue;

        await ctx.db.insert("notifications", {
          userClerkId: t.clerkUserId,
          type,
          title,
          body,
          priority: "high",
          actionUrl: `/students/${studentKey}/progress`,
          payload: {
            studentId: studentKey,
            failRate: a.failRate,
            attemptCount: a.attemptCount,
          },
          createdAt: now,
        });
        posted += 1;
      }
    }
    return { posted };
  },
});
