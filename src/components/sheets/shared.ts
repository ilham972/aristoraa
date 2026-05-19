// Shared types + helpers for /sheets page components.
//
// Row is the unified shape returned by both
// api.learningEngine.sheets.listSheetsForSlotDate (slot students) and
// api.learningEngine.sheets.listSavedSheetHeadersForStudentIds (off-slot
// search/filter matches). Keep this in sync with SheetRowForDashboard on
// the backend.

import type { Id } from '@/lib/convex';
import type { SheetRowStatus } from './filters-bar';

export type Row = {
  studentId: Id<'students'>;
  studentName: string;
  schoolGrade: number;
  isOffDay: boolean;
  sheet: {
    _id: Id<'generatedSheets'>;
    status: string | undefined;
    pdfStorageId: Id<'_storage'> | undefined;
    pdfUrl: string | null;
    alertCount: number;
    questionCount: number;
    generatedAt: number;
  } | null;
};

export function rowStatus(r: Row): SheetRowStatus {
  if (r.isOffDay) return 'off-day';
  if (!r.sheet) return 'no-sheet';
  if (r.sheet.status === 'completed') return 'completed';
  if (r.sheet.status === 'printed') return 'printed';
  return r.sheet.pdfStorageId ? 'draft-with-pdf' : 'draft-no-pdf';
}

export type Counts = {
  total: number;
  offDay: number;
  noSheet: number;
  draftNoPdf: number;
  draftWithPdf: number;
  printed: number;
  completed: number;
  alerts: number;
};

export function countByStatus(rows: Row[]): Counts {
  const c: Counts = {
    total: rows.length,
    offDay: 0,
    noSheet: 0,
    draftNoPdf: 0,
    draftWithPdf: 0,
    printed: 0,
    completed: 0,
    alerts: 0,
  };
  for (const r of rows) {
    c.alerts += r.sheet?.alertCount ?? 0;
    switch (rowStatus(r)) {
      case 'off-day':        c.offDay += 1;       break;
      case 'no-sheet':       c.noSheet += 1;      break;
      case 'draft-no-pdf':   c.draftNoPdf += 1;   break;
      case 'draft-with-pdf': c.draftWithPdf += 1; break;
      case 'printed':        c.printed += 1;      break;
      case 'completed':      c.completed += 1;    break;
    }
  }
  return c;
}
