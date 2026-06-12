// Phase E.3 — Sheets page surface.
//
// Lives separately from planner.ts (the brain) and pdf.ts (the renderer)
// to give the Lead-facing "sheets dashboard" a clean home. Two surfaces:
//   - listSheetsForSlotDate(slotId, dateStr) — joins slot's students with
//     their sheet row + student off-day flag for the given date. Powers the
//     airplane-style status table.
//   - zipSheetPDFs(slotId, dateStr) — gathers every rendered PDF in that
//     slot/date, packs them into one ZIP (pure-JS fflate, no native deps)
//     with sanitized "<student>_<YYYY-MM-DD>.pdf" filenames, stores the
//     ZIP as a _storage blob, returns the storage id + a summary of who
//     made it in / who was skipped (and why).
//
// Design notes (founder decisions baked in):
//   - "Airplane dashboard": every action is its own explicit button — we
//     do NOT auto-render PDFs as a side effect of clicking ZIP. The ZIP
//     packs whatever PDFs already exist and tells you what's missing.
//   - Off-day students never appear as a "needs PDF" row.
//   - The ZIP filename uses the student's name verbatim (Tamil-safe via
//     fflate's UTF-8 flag); only strict filesystem-illegal chars are
//     scrubbed.

import {
  action,
  internalQuery,
  mutation,
  query,
  type QueryCtx,
} from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { zipSync } from "fflate";
import {
  analyzeManyCropIntegrity,
  type CropIntegrityWithMessage,
} from "./cropIntegrity";
import { effectiveStudentIdsForSlot } from "../lib/roster";

// Local copy of the planner's module-of-day mapping. Defaults are Sunday off
// only; per-student `offDays` overrides this. Names match what students.offDays
// stores ("sunday", "monday", ...).
const WEEKDAY_NAMES: Record<number, string> = {
  0: "sunday",
  1: "monday",
  2: "tuesday",
  3: "wednesday",
  4: "thursday",
  5: "friday",
  6: "saturday",
};

function isOffDayFor(student: Doc<"students">, dateStr: string): boolean {
  const ms = Date.parse(`${dateStr}T00:00:00.000Z`);
  if (Number.isNaN(ms)) return false;
  const weekday = WEEKDAY_NAMES[new Date(ms).getUTCDay()] ?? "";
  const offDays = (student.offDays ?? ["sunday"]).map((d) => d.toLowerCase());
  return offDays.includes(weekday);
}

export type SheetRowForDashboard = {
  studentId: Id<"students">;
  studentName: string;
  schoolGrade: number;
  isOffDay: boolean;
  sheet:
    | {
        _id: Id<"generatedSheets">;
        status: string | undefined;
        pdfStorageId: Id<"_storage"> | undefined;
        pdfUrl: string | null;
        alertCount: number;
        questionCount: number;
        // Count of teacher-entered marks (sheet.results keys). Lets the
        // scoring tab's pills distinguish "in-progress" (some marks, not
        // finalized) from a draft/printed sheet with nothing entered yet.
        markedCount: number;
        generatedAt: number;
      }
    | null;
};

// Shared join logic. Used by the public query (page) and the internal
// query (zip action) so they return the exact same row shape.
async function buildRowsForSlotDate(
  ctx: QueryCtx,
  slotId: Id<"scheduleSlots">,
  dateStr: string,
): Promise<SheetRowForDashboard[]> {
  // Roster seam — resolves group-owned slots via groupMembers, falls back
  // to legacy slotStudents for un-migrated slots. Also applies date-level
  // add/remove overrides from slotOverrides. Without this, sessions created
  // via /groups (which only populates groupMembers, not slotStudents) would
  // show "0 students" here even though Attendance can see them.
  const slot = await ctx.db.get(slotId);
  if (!slot) return [];
  const ids = await effectiveStudentIdsForSlot(ctx, slot, dateStr);
  const students = (
    await Promise.all(ids.map((id) => ctx.db.get(id)))
  ).filter((s): s is Doc<"students"> => s !== null);

  const rows: SheetRowForDashboard[] = [];
  for (const s of students) {
    const sheet = await ctx.db
      .query("generatedSheets")
      .withIndex("by_student_date", (q) =>
        q.eq("studentId", s._id).eq("date", dateStr),
      )
      .first();

    const qCount =
      (sheet?.warmupQuestionIds.length ?? 0) +
      (sheet?.mainQuestionIds.length ?? 0) +
      (sheet?.revisionQuestionIds?.length ?? 0) +
      (sheet?.examPrepQuestionIds.length ?? 0);
    const alertCount = Array.isArray(sheet?.alerts) ? sheet!.alerts.length : 0;

    rows.push({
      studentId: s._id,
      studentName: s.name,
      schoolGrade: s.schoolGrade,
      isOffDay: isOffDayFor(s, dateStr),
      sheet: sheet
        ? {
            _id: sheet._id,
            status: sheet.status,
            pdfStorageId: sheet.pdfStorageId,
            pdfUrl: sheet.pdfStorageId
              ? await ctx.storage.getUrl(sheet.pdfStorageId)
              : null,
            alertCount,
            questionCount: qCount,
            markedCount: Object.keys(sheet.results ?? {}).length,
            generatedAt: sheet.generatedAt,
          }
        : null,
    });
  }

  rows.sort((a, b) => a.studentName.localeCompare(b.studentName));
  return rows;
}

// Joined view used by the Sheets page. One row per student in the slot,
// with their sheet for `dateStr` (if any) and the off-day flag derived
// from student.offDays. Stable ordering by student.name so the table
// doesn't shuffle between refreshes.
export const listSheetsForSlotDate = query({
  args: {
    slotId: v.id("scheduleSlots"),
    dateStr: v.string(),
  },
  handler: async (ctx, args): Promise<SheetRowForDashboard[] | null> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    return await buildRowsForSlotDate(ctx, args.slotId, args.dateStr);
  },
});

// Internal twin used by zipSheetPDFs — bypasses the null-when-unauth path
// since the action has already verified identity before calling.
export const _listSheetsForSlotDateInternal = internalQuery({
  args: {
    slotId: v.id("scheduleSlots"),
    dateStr: v.string(),
  },
  handler: async (ctx, args): Promise<SheetRowForDashboard[]> => {
    return await buildRowsForSlotDate(ctx, args.slotId, args.dateStr);
  },
});

// Off-slot fetch — used by the merged /sheets page when the Lead searches
// or filters for students who aren't in the currently picked slot. Same
// row shape as listSheetsForSlotDate so the UI can render one unified row
// component. Caller supplies the studentIds (already filtered client-side
// by name/grade) so this stays O(N) on the provided list.
export const listSavedSheetHeadersForStudentIds = query({
  args: {
    studentIds: v.array(v.id("students")),
    dateStr: v.string(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<SheetRowForDashboard[] | null> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    if (args.studentIds.length === 0) return [];

    const rows: SheetRowForDashboard[] = [];
    for (const studentId of args.studentIds) {
      const s = await ctx.db.get(studentId);
      if (!s) continue;
      const sheet = await ctx.db
        .query("generatedSheets")
        .withIndex("by_student_date", (q) =>
          q.eq("studentId", s._id).eq("date", args.dateStr),
        )
        .first();

      const qCount =
        (sheet?.warmupQuestionIds.length ?? 0) +
        (sheet?.mainQuestionIds.length ?? 0) +
        (sheet?.revisionQuestionIds?.length ?? 0) +
        (sheet?.examPrepQuestionIds.length ?? 0);
      const alertCount = Array.isArray(sheet?.alerts)
        ? sheet!.alerts.length
        : 0;

      rows.push({
        studentId: s._id,
        studentName: s.name,
        schoolGrade: s.schoolGrade,
        isOffDay: isOffDayFor(s, args.dateStr),
        sheet: sheet
          ? {
              _id: sheet._id,
              status: sheet.status,
              pdfStorageId: sheet.pdfStorageId,
              pdfUrl: sheet.pdfStorageId
                ? await ctx.storage.getUrl(sheet.pdfStorageId)
                : null,
              alertCount,
              questionCount: qCount,
              markedCount: Object.keys(sheet.results ?? {}).length,
              generatedAt: sheet.generatedAt,
            }
          : null,
      });
    }

    rows.sort((a, b) => a.studentName.localeCompare(b.studentName));
    return rows;
  },
});

// ──────────────────────────────────────────────────────────────────────
// E.4 — Lead override surface backend.
//
// `getSheetWithCrops` is the frontend twin of internal getSheetForRender,
// adding per-Q score factors (from sheet.scoringSnapshot) so the [Why?]
// drawer can render the breakdown without an extra round-trip.
//
// `markPdfStale` clears pdfStorageId after an override. Founder asked for
// "manual re-render" — the sheet flips to draft-no-pdf in the dashboard
// and the Lead clicks Render when ready, instead of an automatic re-render
// firing per swap.
//
// `searchQuestionsForSwap` powers the "Search more" fallback in the swap
// picker — substring match over concept names, returned in stable order
// with crop preview metadata.

export type SheetOverrideScoringFactors = {
  importance: number;
  urgency: number;
  fit: number;
  novelty: number;
  proximity: number;
  baseScore: number;
  urgencyOverride: boolean;
  urgencyOverrideReason: string | null;
};

export type SheetPreviewQuestion = {
  questionId: Id<"questionBank">;
  cropBox: { x: number; y: number; w: number; h: number } | null;
  pageImageUrl: string | null;
  // Downscaled page variant for thumbnails (null until the page has been
  // through the Settings "Optimize images" backfill). Full-res pageImageUrl
  // remains the zoom/print source.
  pageImageUrlSmall: string | null;
  conceptIds: Id<"exercises">[];
  conceptNames: string[];
  source: string;
  questionNumberInPaper: string | null;
  marksAvailable: number | null;
  difficulty: number | null;
  // Per-Q scoring factors as snapshotted at gen time. Null when the sheet
  // pre-dates D.6 (no scoringSnapshot) or the Q was added via manual
  // override (no score recorded).
  factors: SheetOverrideScoringFactors | null;
};

export type SheetPreviewData = {
  sheet: {
    _id: Id<"generatedSheets">;
    studentId: Id<"students">;
    date: string;
    status: string | undefined;
    pdfStorageId: Id<"_storage"> | undefined;
    pdfUrl: string | null;
    slotId: Id<"scheduleSlots"> | undefined;
    generatedAt: number;
  };
  student: {
    _id: Id<"students">;
    name: string;
    schoolGrade: number;
    assignedGrades: number[] | undefined;
    assignedGradesByModule: unknown;
  };
  warmup: SheetPreviewQuestion[];
  main: SheetPreviewQuestion[];
  revision: SheetPreviewQuestion[];
  examPrep: SheetPreviewQuestion[];
  // Per-question crop-integrity status. The Edit drawer renders a banner
  // listing every blocking issue + a soft warning for non-blocking ones.
  // Stays in sync with what the PDF renderer enforces (see cropIntegrity.ts).
  integrity: {
    blockingCount: number;
    perQuestion: Array<{
      questionId: Id<"questionBank">;
      integrity: CropIntegrityWithMessage;
      slot: "warmup" | "main" | "revision" | "examPrep";
    }>;
  };
};

type ScoringSnapshotRow = {
  questionId: Id<"questionBank">;
  conceptId?: Id<"exercises">;
  slot?: string;
  baseScore?: number;
  factors?: {
    importance?: number;
    urgency?: number;
    fit?: number;
    novelty?: number;
    proximity?: number;
    urgencyOverride?: boolean;
    urgencyOverrideReason?: string | null;
  };
};

// Lookup factors for a question id from the snapshot stored on the sheet.
function findFactors(
  snapshot: unknown,
  qid: Id<"questionBank">,
): SheetOverrideScoringFactors | null {
  if (!Array.isArray(snapshot)) return null;
  const row = (snapshot as ScoringSnapshotRow[]).find(
    (r) => r.questionId === qid,
  );
  if (!row || !row.factors) return null;
  return {
    importance: row.factors.importance ?? 0,
    urgency: row.factors.urgency ?? 0,
    fit: row.factors.fit ?? 0,
    novelty: row.factors.novelty ?? 0,
    proximity: row.factors.proximity ?? 0,
    baseScore: row.baseScore ?? 0,
    urgencyOverride: !!row.factors.urgencyOverride,
    urgencyOverrideReason: row.factors.urgencyOverrideReason ?? null,
  };
}

// Exported so the Phase-2 scoring read query (scoring.ts:getSheetForScoring)
// reuses the exact crop/concept/marks resolution instead of re-deriving it.
export async function enrichOneQuestion(
  ctx: QueryCtx,
  qid: Id<"questionBank">,
  snapshot: unknown,
): Promise<SheetPreviewQuestion> {
  const q = await ctx.db.get(qid);
  if (!q) {
    return {
      questionId: qid,
      cropBox: null,
      pageImageUrl: null,
      pageImageUrlSmall: null,
      conceptIds: [],
      conceptNames: [],
      source: "missing",
      questionNumberInPaper: null,
      marksAvailable: null,
      difficulty: null,
      factors: null,
    };
  }
  let pageImageUrl: string | null = null;
  let pageImageUrlSmall: string | null = null;
  if (q.textbookPageId) {
    const p = await ctx.db.get(q.textbookPageId);
    if (p) {
      pageImageUrl = await ctx.storage.getUrl(p.storageId);
      if (p.smallStorageId)
        pageImageUrlSmall = await ctx.storage.getUrl(p.smallStorageId);
    }
  } else if (q.pastPaperPageId) {
    const p = await ctx.db.get(q.pastPaperPageId);
    if (p) {
      pageImageUrl = await ctx.storage.getUrl(p.storageId);
      if (p.smallStorageId)
        pageImageUrlSmall = await ctx.storage.getUrl(p.smallStorageId);
    }
  }
  const links = await ctx.db
    .query("questionConcepts")
    .withIndex("by_question", (qq) => qq.eq("questionId", q._id))
    .collect();
  const conceptIds: Id<"exercises">[] = [];
  const conceptNames: string[] = [];
  for (const l of links) {
    conceptIds.push(l.conceptExerciseId);
    const c = await ctx.db.get(l.conceptExerciseId);
    if (c?.name) conceptNames.push(c.name);
  }
  return {
    questionId: q._id,
    cropBox: q.cropBox ?? null,
    pageImageUrl,
    pageImageUrlSmall,
    conceptIds,
    conceptNames,
    source: q.source,
    questionNumberInPaper: q.questionNumberInPaper ?? null,
    marksAvailable: q.marksAvailable ?? null,
    difficulty: q.difficulty ?? null,
    factors: findFactors(snapshot, q._id),
  };
}

export const getSheetWithCrops = query({
  args: { sheetId: v.id("generatedSheets") },
  handler: async (ctx, args): Promise<SheetPreviewData | null> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const sheet = await ctx.db.get(args.sheetId);
    if (!sheet) return null;
    const student = await ctx.db.get(sheet.studentId);
    if (!student) return null;

    const snap = sheet.scoringSnapshot;
    const warmup: SheetPreviewQuestion[] = [];
    for (const qid of sheet.warmupQuestionIds) {
      warmup.push(await enrichOneQuestion(ctx, qid, snap));
    }
    const main: SheetPreviewQuestion[] = [];
    for (const qid of sheet.mainQuestionIds) {
      main.push(await enrichOneQuestion(ctx, qid, snap));
    }
    const revision: SheetPreviewQuestion[] = [];
    for (const qid of sheet.revisionQuestionIds ?? []) {
      revision.push(await enrichOneQuestion(ctx, qid, snap));
    }
    const examPrep: SheetPreviewQuestion[] = [];
    for (const qid of sheet.examPrepQuestionIds) {
      examPrep.push(await enrichOneQuestion(ctx, qid, snap));
    }

    // Crop-integrity pass over every picked Q. Same analyzer pdf.ts uses;
    // the drawer renders banners off this so the Lead can fix data BEFORE
    // hitting Render.
    const allIds: Array<{
      id: Id<"questionBank">;
      slot: "warmup" | "main" | "revision" | "examPrep";
    }> = [
      ...sheet.warmupQuestionIds.map((id) => ({ id, slot: "warmup" as const })),
      ...sheet.mainQuestionIds.map((id) => ({ id, slot: "main" as const })),
      ...(sheet.revisionQuestionIds ?? []).map((id) => ({
        id,
        slot: "revision" as const,
      })),
      ...sheet.examPrepQuestionIds.map((id) => ({
        id,
        slot: "examPrep" as const,
      })),
    ];
    const integrityResult = await analyzeManyCropIntegrity(
      ctx,
      allIds.map((r) => r.id),
    );
    const integrityByQ = new Map<string, CropIntegrityWithMessage>();
    for (const row of integrityResult.byQuestion) {
      integrityByQ.set(
        row.questionId as unknown as string,
        row.integrity,
      );
    }
    const perQuestion: SheetPreviewData["integrity"]["perQuestion"] = [];
    for (const r of allIds) {
      const integrity =
        integrityByQ.get(r.id as unknown as string) ??
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
        pdfUrl: sheet.pdfStorageId
          ? await ctx.storage.getUrl(sheet.pdfStorageId)
          : null,
        slotId: sheet.slotId,
        generatedAt: sheet.generatedAt,
      },
      student: {
        _id: student._id,
        name: student.name,
        schoolGrade: student.schoolGrade,
        assignedGrades: student.assignedGrades,
        assignedGradesByModule: student.assignedGradesByModule,
      },
      warmup,
      main,
      revision,
      examPrep,
      integrity: {
        blockingCount: integrityResult.blockingCount,
        perQuestion,
      },
    };
  },
});

// Clear the sheet's pdfStorageId so the dashboard row flips back to
// "Draft (no PDF)" with a Render button. Orphans the previous PDF blob.
// Called by the override drawer after a successful swap/remove/add.
export const markPdfStale = mutation({
  args: { sheetId: v.id("generatedSheets") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    const sheet = await ctx.db.get(args.sheetId);
    if (!sheet) throw new Error("Sheet not found");
    if (!sheet.pdfStorageId) return { sheetId: args.sheetId, cleared: false };
    const oldStorageId = sheet.pdfStorageId;
    await ctx.db.patch(args.sheetId, { pdfStorageId: undefined });
    try {
      await ctx.storage.delete(oldStorageId);
    } catch {
      // already gone — fine
    }
    return { sheetId: args.sheetId, cleared: true };
  },
});

export type SearchedQuestion = {
  questionId: Id<"questionBank">;
  cropBox: { x: number; y: number; w: number; h: number } | null;
  pageImageUrl: string | null;
  conceptNames: string[];
  source: string;
  questionNumberInPaper: string | null;
  difficulty: number | null;
};

// "Search more" fallback for the swap picker. Substring match (case-
// insensitive) over concept name. We walk questionConcepts → concept rows
// matching the term, then expand to the linked questions and dedupe.
// Capped at 25 results so the picker stays scrollable.
export const searchQuestionsForSwap = query({
  args: {
    term: v.string(),
    excludeQuestionIds: v.optional(v.array(v.id("questionBank"))),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<SearchedQuestion[] | null> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const term = args.term.trim().toLowerCase();
    if (term.length < 2) return [];
    const cap = Math.min(args.limit ?? 25, 50);
    const exclude = new Set<string>(
      (args.excludeQuestionIds ?? []).map((id) => id as unknown as string),
    );

    // Walk concepts (type=concept) — usually fewer rows than questions and
    // gives us name-keyed access. We scan max 500 concept rows; in practice
    // a single grade has < 100.
    const conceptMatches: Doc<"exercises">[] = [];
    for await (const ex of ctx.db
      .query("exercises")
      .filter((q) => q.eq(q.field("type"), "concept"))) {
      const name = (ex.name ?? "").toLowerCase();
      if (name.includes(term)) conceptMatches.push(ex);
      if (conceptMatches.length >= 50) break;
    }

    const out: SearchedQuestion[] = [];
    const seen = new Set<string>();
    for (const c of conceptMatches) {
      const links = await ctx.db
        .query("questionConcepts")
        .withIndex("by_concept_exercise", (qq) =>
          qq.eq("conceptExerciseId", c._id),
        )
        .take(20);
      for (const l of links) {
        if (out.length >= cap) break;
        const key = l.questionId as unknown as string;
        if (seen.has(key)) continue;
        if (exclude.has(key)) continue;
        seen.add(key);
        const q = await ctx.db.get(l.questionId);
        if (!q) continue;
        let pageImageUrl: string | null = null;
        if (q.textbookPageId) {
          const p = await ctx.db.get(q.textbookPageId);
          if (p) pageImageUrl = await ctx.storage.getUrl(p.storageId);
        } else if (q.pastPaperPageId) {
          const p = await ctx.db.get(q.pastPaperPageId);
          if (p) pageImageUrl = await ctx.storage.getUrl(p.storageId);
        }
        out.push({
          questionId: q._id,
          cropBox: q.cropBox ?? null,
          pageImageUrl,
          conceptNames: [c.name],
          source: q.source,
          questionNumberInPaper: q.questionNumberInPaper ?? null,
          difficulty: q.difficulty ?? null,
        });
      }
      if (out.length >= cap) break;
    }
    return out;
  },
});

// Scrub characters illegal in Windows / Mac / Linux filenames. Keep Tamil
// + other multibyte chars — fflate emits the ZIP UTF-8 flag so Windows
// Explorer 10+ unzips them correctly. Trim trailing dots/spaces (Windows
// strips those silently which breaks Aristora-side automation).
function safeFilenameSegment(name: string): string {
  const scrubbed = name
    .replace(/[<>:"/\\|?* -]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.\s]+$/g, "");
  return scrubbed.length > 0 ? scrubbed : "unnamed";
}

export type ZipSheetPDFsResult = {
  storageId: Id<"_storage">;
  downloadUrl: string | null;
  includedCount: number;
  // Students whose PDF was included in the ZIP (in filename order).
  included: { studentId: Id<"students">; filename: string }[];
  // Students who couldn't be packed (no draft yet, off-day, no PDF rendered,
  // or PDF blob unreadable). Lead can act on each from the table.
  skipped: {
    studentId: Id<"students">;
    studentName: string;
    reason: "off-day" | "no-sheet" | "no-pdf" | "pdf-fetch-failed";
  }[];
  approxBytes: number;
};

export const zipSheetPDFs = action({
  args: {
    slotId: v.id("scheduleSlots"),
    dateStr: v.string(),
  },
  handler: async (ctx, args): Promise<ZipSheetPDFsResult> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");

    const rows: SheetRowForDashboard[] = await ctx.runQuery(
      internal.learningEngine.sheets._listSheetsForSlotDateInternal,
      { slotId: args.slotId, dateStr: args.dateStr },
    );

    const files: Record<string, Uint8Array> = {};
    const included: { studentId: Id<"students">; filename: string }[] = [];
    const skipped: ZipSheetPDFsResult["skipped"] = [];
    let approxBytes = 0;

    // Track filename collisions (two students with identical scrubbed names).
    // Append " (2)", " (3)" etc — keeps human-readable but deterministic.
    const usedNames = new Set<string>();
    const uniqueFilename = (base: string): string => {
      if (!usedNames.has(base)) {
        usedNames.add(base);
        return base;
      }
      let n = 2;
      // Insert the disambiguator before ".pdf"
      const stem = base.replace(/\.pdf$/i, "");
      while (true) {
        const candidate = `${stem} (${n}).pdf`;
        if (!usedNames.has(candidate)) {
          usedNames.add(candidate);
          return candidate;
        }
        n += 1;
      }
    };

    for (const r of rows) {
      if (r.isOffDay) {
        skipped.push({
          studentId: r.studentId,
          studentName: r.studentName,
          reason: "off-day",
        });
        continue;
      }
      if (!r.sheet) {
        skipped.push({
          studentId: r.studentId,
          studentName: r.studentName,
          reason: "no-sheet",
        });
        continue;
      }
      if (!r.sheet.pdfStorageId) {
        skipped.push({
          studentId: r.studentId,
          studentName: r.studentName,
          reason: "no-pdf",
        });
        continue;
      }
      const blob = await ctx.storage.get(r.sheet.pdfStorageId);
      if (!blob) {
        skipped.push({
          studentId: r.studentId,
          studentName: r.studentName,
          reason: "pdf-fetch-failed",
        });
        continue;
      }
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const fname = uniqueFilename(
        `${safeFilenameSegment(r.studentName)}_${args.dateStr}.pdf`,
      );
      files[fname] = bytes;
      approxBytes += bytes.byteLength;
      included.push({ studentId: r.studentId, filename: fname });
    }

    if (included.length === 0) {
      throw new Error(
        "No PDFs to include in ZIP — render some sheets first or check that the slot/date has draft sheets.",
      );
    }

    // fflate.zipSync is synchronous and fast for our scale (~30 students ×
    // ~1MB each = 30MB blob, well within action memory limits). Async
    // streaming would only matter at 100+ sheets.
    const zipBytes = zipSync(files, { level: 6 });
    const zipBlob = new Blob([zipBytes as BlobPart], { type: "application/zip" });
    const storageId = await ctx.storage.store(zipBlob);
    const downloadUrl = await ctx.storage.getUrl(storageId);

    return {
      storageId,
      downloadUrl,
      includedCount: included.length,
      included,
      skipped,
      approxBytes,
    };
  },
});

