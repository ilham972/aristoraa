// Phase E.1 helpers — internal query/mutation backing the node action in pdf.ts.
//
// Split out of pdf.ts because pdf.ts is "use node" (sharp + pdf-lib are native
// deps). Convex requires node-runtime files contain only actions, so all
// db reads + writes the renderer needs live here.
//
// Surface:
//   getSheetForRender(sheetId) → everything pdf.ts needs in ONE call:
//     - the sheet row (status check, slot identity)
//     - the student row (name for header)
//     - every question id in any slot, joined with its cropBox + source-page
//       storage URL + concept-name footnote
//   setPdfStorageId(sheetId, storageId) → patches the sheet after render.

import { internalQuery, internalMutation } from "../_generated/server";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import {
  analyzeManyCropIntegrity,
  type CropIntegrityWithMessage,
} from "./cropIntegrity";

// Module-of-day mapping. Mirrors planner.ts so the renderer can stamp the
// module-of-day header without depending on planner internals.
const MODULE_BY_UTC_WEEKDAY: Record<number, string | null> = {
  0: null,
  1: "M1",
  2: "M2",
  3: "M3",
  4: "M4",
  5: "M5",
  6: "M6",
};

function moduleForDateStr(dateStr: string): string | null {
  const ms = Date.parse(`${dateStr}T00:00:00.000Z`);
  if (Number.isNaN(ms)) return null;
  return MODULE_BY_UTC_WEEKDAY[new Date(ms).getUTCDay()] ?? null;
}

export type RenderSheetData = {
  sheet: {
    _id: Id<"generatedSheets">;
    studentId: Id<"students">;
    date: string;
    status: string | undefined;
    pdfStorageId: Id<"_storage"> | undefined;
  };
  student: { name: string; schoolGrade: number };
  moduleOfDay: string | null;
  // Ordered question metadata for each slot. The pdf renderer walks
  // warmup → main → examPrep in order, drawing one section per group.
  warmup: QuestionForRender[];
  main: QuestionForRender[];
  examPrep: QuestionForRender[];
  // Integrity issues surfaced from the crop analyzer (blocking + non-blocking
  // attachments). The pdf renderer throws a ConvexError when blockingCount > 0
  // so the user-facing toast tells the Lead exactly which crops need fixing.
  integrity: {
    blockingCount: number;
    perQuestion: Array<{
      questionId: Id<"questionBank">;
      integrity: CropIntegrityWithMessage;
      // Slot the question came from — useful for the UI banner.
      slot: "warmup" | "main" | "examPrep";
    }>;
  };
};

// One auxiliary image to draw above a sub-question on the sheet. The pdf
// renderer embeds these in order (a stem may itself be cropped as multiple
// rows when there are several figures sharing the stem key — they all stack
// above the sub-question).
export type StemAttachment = {
  questionId: Id<"questionBank">;
  cropBox: { x: number; y: number; w: number; h: number } | null;
  pageImageUrl: string | null;
};

export type QuestionForRender = {
  questionId: Id<"questionBank">;
  cropBox: { x: number; y: number; w: number; h: number } | null;
  pageImageUrl: string | null;
  source: string; // "textbook" | "past-paper" | "teacher-authored"
  conceptNames: string[]; // for the footnote
  questionNumberInPaper: string | null;
  marksAvailable: number | null;
  difficulty: number | null;
  // Sub-question stems to draw above this question, in order. Empty for
  // whole questions, stems, past-paper crops, and any crop the integrity
  // analyzer flagged as blocking (those throw before the renderer ever
  // runs).
  stemAttachments: StemAttachment[];
};

export const getSheetForRender = internalQuery({
  args: { sheetId: v.id("generatedSheets") },
  handler: async (ctx, args): Promise<RenderSheetData | null> => {
    const sheet = await ctx.db.get(args.sheetId);
    if (!sheet) return null;

    const student = await ctx.db.get(sheet.studentId);
    if (!student) return null;

    // Compute integrity for every picked crop up front. The renderer uses
    // `stemAttachments` to glue stems above sub-questions and the consumer
    // (pdf.ts) throws when `integrity.blockingCount > 0`.
    const allIds: Array<{ id: Id<"questionBank">; slot: "warmup" | "main" | "examPrep" }> = [
      ...sheet.warmupQuestionIds.map((id) => ({ id, slot: "warmup" as const })),
      ...sheet.mainQuestionIds.map((id) => ({ id, slot: "main" as const })),
      ...sheet.examPrepQuestionIds.map((id) => ({ id, slot: "examPrep" as const })),
    ];
    const integrityList = await analyzeManyCropIntegrity(
      ctx,
      allIds.map((r) => r.id),
    );
    const integrityByQId = new Map<string, CropIntegrityWithMessage>();
    for (let i = 0; i < integrityList.byQuestion.length; i++) {
      integrityByQId.set(
        integrityList.byQuestion[i].questionId as unknown as string,
        integrityList.byQuestion[i].integrity,
      );
    }

    // Helper: resolve a textbookPage or pastPaperPage to a storage URL.
    const pageUrlFor = async (
      q: { textbookPageId?: Id<"textbookPages">; pastPaperPageId?: Id<"pastPaperPages"> },
    ): Promise<string | null> => {
      if (q.textbookPageId) {
        const page = await ctx.db.get(q.textbookPageId);
        if (page) return await ctx.storage.getUrl(page.storageId);
      } else if (q.pastPaperPageId) {
        const page = await ctx.db.get(q.pastPaperPageId);
        if (page) return await ctx.storage.getUrl(page.storageId);
      }
      return null;
    };

    // Resolve stem attachments for a picked sub-question crop (case
    // "ok-sub-with-stem"). For other integrity kinds → [] (whole questions
    // have no stem; blocking kinds throw before render so the field never
    // gets read).
    const resolveStemAttachments = async (
      integrity: CropIntegrityWithMessage,
    ): Promise<QuestionForRender["stemAttachments"]> => {
      if (integrity.kind !== "ok-sub-with-stem") return [];
      const stems: QuestionForRender["stemAttachments"] = [];
      for (const sid of integrity.stemQuestionIds) {
        const stemDoc = await ctx.db.get(sid);
        if (!stemDoc) continue;
        const url = await pageUrlFor(stemDoc);
        stems.push({
          questionId: sid,
          cropBox: stemDoc.cropBox ?? null,
          pageImageUrl: url,
        });
      }
      return stems;
    };

    const enrich = async (
      ids: Id<"questionBank">[],
    ): Promise<QuestionForRender[]> => {
      const out: QuestionForRender[] = [];
      for (const qid of ids) {
        const q = await ctx.db.get(qid);
        if (!q) {
          // Question deleted after sheet save. Render a placeholder marker
          // so the slot ordering doesn't shift silently.
          out.push({
            questionId: qid,
            cropBox: null,
            pageImageUrl: null,
            source: "missing",
            conceptNames: [],
            questionNumberInPaper: null,
            marksAvailable: null,
            difficulty: null,
            stemAttachments: [],
          });
          continue;
        }

        // Resolve source page → storage URL.
        const pageImageUrl = await pageUrlFor(q);

        // Concept-name footnote: join questionConcepts → exercises.name.
        const links = await ctx.db
          .query("questionConcepts")
          .withIndex("by_question", (qq) => qq.eq("questionId", q._id))
          .collect();
        const conceptNames: string[] = [];
        for (const l of links) {
          const c = await ctx.db.get(l.conceptExerciseId);
          if (c?.name) conceptNames.push(c.name);
        }

        const integrity =
          integrityByQId.get(q._id as unknown as string) ??
          ({ kind: "ok-pass-through", message: "", blocking: false } as
            CropIntegrityWithMessage);
        const stemAttachments = await resolveStemAttachments(integrity);

        out.push({
          questionId: q._id,
          cropBox: q.cropBox ?? null,
          pageImageUrl,
          source: q.source,
          conceptNames,
          questionNumberInPaper: q.questionNumberInPaper ?? null,
          marksAvailable: q.marksAvailable ?? null,
          difficulty: q.difficulty ?? null,
          stemAttachments,
        });
      }
      return out;
    };

    const warmup = await enrich(sheet.warmupQuestionIds);
    const main = await enrich(sheet.mainQuestionIds);
    const examPrep = await enrich(sheet.examPrepQuestionIds);

    // Pair each integrity row with the slot it came from so the consumer
    // can render banners that pinpoint a problem location on the sheet.
    const perQuestion: RenderSheetData["integrity"]["perQuestion"] = [];
    for (const r of allIds) {
      const integrity =
        integrityByQId.get(r.id as unknown as string) ??
        ({ kind: "ok-pass-through", message: "", blocking: false } as
          CropIntegrityWithMessage);
      perQuestion.push({ questionId: r.id, integrity, slot: r.slot });
    }

    return {
      sheet: {
        _id: sheet._id,
        studentId: sheet.studentId,
        date: sheet.date,
        status: sheet.status,
        pdfStorageId: sheet.pdfStorageId,
      },
      student: { name: student.name, schoolGrade: student.schoolGrade },
      moduleOfDay: moduleForDateStr(sheet.date),
      warmup,
      main,
      examPrep,
      integrity: {
        blockingCount: integrityList.blockingCount,
        perQuestion,
      },
    };
  },
});

export const setPdfStorageId = internalMutation({
  args: {
    sheetId: v.id("generatedSheets"),
    storageId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    const sheet = await ctx.db.get(args.sheetId);
    if (!sheet) throw new Error("Sheet not found");

    // Orphan the previous PDF if one exists. Spec says cleanup later, but
    // unconditionally deleting the previous storage object here is cheap
    // and avoids accumulation. If the delete fails (already gone) we
    // swallow the error — patching the new id is the load-bearing step.
    if (sheet.pdfStorageId && sheet.pdfStorageId !== args.storageId) {
      try {
        await ctx.storage.delete(sheet.pdfStorageId);
      } catch {
        // ignore — previous blob already gone or unreachable
      }
    }

    await ctx.db.patch(args.sheetId, { pdfStorageId: args.storageId });
    return { sheetId: args.sheetId, storageId: args.storageId };
  },
});
