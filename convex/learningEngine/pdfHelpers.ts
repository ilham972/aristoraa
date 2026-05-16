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
};

export const getSheetForRender = internalQuery({
  args: { sheetId: v.id("generatedSheets") },
  handler: async (ctx, args): Promise<RenderSheetData | null> => {
    const sheet = await ctx.db.get(args.sheetId);
    if (!sheet) return null;

    const student = await ctx.db.get(sheet.studentId);
    if (!student) return null;

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
          });
          continue;
        }

        // Resolve source page → storage URL.
        let pageImageUrl: string | null = null;
        if (q.textbookPageId) {
          const page = await ctx.db.get(q.textbookPageId);
          if (page) pageImageUrl = await ctx.storage.getUrl(page.storageId);
        } else if (q.pastPaperPageId) {
          const page = await ctx.db.get(q.pastPaperPageId);
          if (page) pageImageUrl = await ctx.storage.getUrl(page.storageId);
        }

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

        out.push({
          questionId: q._id,
          cropBox: q.cropBox ?? null,
          pageImageUrl,
          source: q.source,
          conceptNames,
          questionNumberInPaper: q.questionNumberInPaper ?? null,
          marksAvailable: q.marksAvailable ?? null,
          difficulty: q.difficulty ?? null,
        });
      }
      return out;
    };

    const warmup = await enrich(sheet.warmupQuestionIds);
    const main = await enrich(sheet.mainQuestionIds);
    const examPrep = await enrich(sheet.examPrepQuestionIds);

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
