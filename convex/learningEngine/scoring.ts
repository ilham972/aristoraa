// Phase 2 — Sheet-synced scoring (System B of sheet_scoring_plan.md).
//
// Closes the learning-engine data loop: the teacher marks a printed sheet's
// exact questions on a sheet-scoped drawer, and `finalizeSheetScoring` pushes
// each correct/wrong into `memoryState` via `applyAttempt` (memory.ts). This
// is what makes the next sheet's Warm-up (recent mistakes) and Revision
// (forgetting-curve) sections fill — until now they stayed empty because the
// legacy `entries` Score tab never called the engine.
//
// Surface:
//   setSheetMark(sheetId, questionId, mark) — live per-tap save. NO engine
//     write (idempotency is enforced at finalize, not per keystroke).
//   finalizeSheetScoring(sheetId) — commit results to the engine idempotently
//     (only marks that changed since the last commit fire an attempt), flip
//     the sheet to completed. Part B (sessionPoints) is layered on in B3.
//   getSheetForScoring(sheetId) — per-section question metadata + current mark
//     for the drawer; reuses sheets.ts:enrichOneQuestion.
//
// Strictly additive: it does NOT touch the legacy `entries` table, the public
// leaderboard, or `src/lib/scoring.ts`. See the spec's §7 DO-NOT list.

import { mutation, query } from "../_generated/server";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { applyAttempt } from "./memory";
import { enrichOneQuestion, type SheetPreviewQuestion } from "./sheets";

// Marks the drawer can write. "unmarked" deletes the key (back to neutral).
const VALID_MARKS = new Set(["correct", "wrong", "skipped", "unmarked"]);

// ── Live mark ─────────────────────────────────────────────────────────────
// Called on every tap. Patches results[questionId]; deletes the key when the
// teacher cycles back to "unmarked". No engine write here — applyAttempt runs
// only at finalize, guarded by the committed-marks diff, so cycling a mark
// back and forth never double-applies to memoryState.
export const setSheetMark = mutation({
  args: {
    sheetId: v.id("generatedSheets"),
    questionId: v.id("questionBank"),
    mark: v.string(), // "correct" | "wrong" | "skipped" | "unmarked"
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    if (!VALID_MARKS.has(args.mark)) {
      throw new Error(
        `setSheetMark: mark must be correct|wrong|skipped|unmarked (got '${args.mark}')`,
      );
    }
    const sheet = await ctx.db.get(args.sheetId);
    if (!sheet) throw new Error("Sheet not found");

    const key = args.questionId as unknown as string;
    const results: Record<string, string> = { ...(sheet.results ?? {}) };
    if (args.mark === "unmarked") {
      delete results[key];
    } else {
      results[key] = args.mark;
    }
    await ctx.db.patch(args.sheetId, { results });
    return { sheetId: args.sheetId, marked: Object.keys(results).length };
  },
});

// ── Finalize ──────────────────────────────────────────────────────────────
// Commit results to the engine, idempotently, then complete the sheet.
//
// Idempotency is the whole point: applyAttempt fires only for questions whose
// mark DIFFERS from committedMarks (the last commit). Re-finalizing an
// unchanged sheet does nothing; flipping one mark and re-finalizing commits
// exactly that one delta. occurredAt is anchored to the PRACTICE day (the
// sheet date at noon UTC), not the marking day, so the FSRS-lite lag maths
// see the real elapsed time.
export const finalizeSheetScoring = mutation({
  args: { sheetId: v.id("generatedSheets") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    const sheet = await ctx.db.get(args.sheetId);
    if (!sheet) throw new Error("Sheet not found");

    const results: Record<string, string> = sheet.results ?? {};
    const committed: Record<string, string> = { ...(sheet.committedMarks ?? {}) };
    const occurredAt = Date.parse(sheet.date + "T12:00:00.000Z");

    let appliedAttempts = 0;
    for (const [questionId, mark] of Object.entries(results)) {
      if (committed[questionId] === mark) continue; // already applied → skip
      const response =
        mark === "correct" ? "good" : mark === "wrong" ? "again" : "skipped";
      if (response !== "skipped") {
        await applyAttempt(ctx, {
          studentId: sheet.studentId,
          questionId: questionId as unknown as Id<"questionBank">,
          response,
          occurredAt,
          source: "sheet-score",
        });
        appliedAttempts += 1;
      }
      committed[questionId] = mark;
    }

    await ctx.db.patch(args.sheetId, {
      committedMarks: committed,
      scoredAt: Date.now(),
      status: "completed",
      completedAt: Date.now(),
    });

    return { appliedAttempts };
  },
});

// ── Read query for the scoring drawer ──────────────────────────────────────

export type ScoringQuestion = SheetPreviewQuestion & {
  // Current teacher mark from sheet.results, or null when unmarked.
  mark: string | null;
};

export type SheetScoringData = {
  sheet: {
    _id: Id<"generatedSheets">;
    date: string;
    status: string | undefined;
    shortId: string;
  };
  student: {
    _id: Id<"students">;
    name: string;
    schoolGrade: number;
  };
  warmup: ScoringQuestion[];
  main: ScoringQuestion[];
  revision: ScoringQuestion[];
  examPrep: ScoringQuestion[];
};

export const getSheetForScoring = query({
  args: { sheetId: v.id("generatedSheets") },
  handler: async (ctx, args): Promise<SheetScoringData | null> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const sheet = await ctx.db.get(args.sheetId);
    if (!sheet) return null;
    const student = await ctx.db.get(sheet.studentId);
    if (!student) return null;

    const results: Record<string, string> = sheet.results ?? {};
    const markFor = (qid: Id<"questionBank">): string | null =>
      results[qid as unknown as string] ?? null;

    const enrichSection = async (
      ids: Id<"questionBank">[],
    ): Promise<ScoringQuestion[]> => {
      const out: ScoringQuestion[] = [];
      for (const qid of ids) {
        // snapshot=undefined → factors null; the drawer doesn't show scores.
        const base = await enrichOneQuestion(ctx, qid, undefined);
        out.push({ ...base, mark: markFor(qid) });
      }
      return out;
    };

    return {
      sheet: {
        _id: sheet._id,
        date: sheet.date,
        status: sheet.status,
        shortId: (sheet._id as unknown as string).slice(-6),
      },
      student: {
        _id: student._id,
        name: student.name,
        schoolGrade: student.schoolGrade,
      },
      warmup: await enrichSection(sheet.warmupQuestionIds),
      main: await enrichSection(sheet.mainQuestionIds),
      revision: await enrichSection(sheet.revisionQuestionIds ?? []),
      examPrep: await enrichSection(sheet.examPrepQuestionIds),
    };
  },
});
