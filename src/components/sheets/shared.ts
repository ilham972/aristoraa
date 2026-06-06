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
    markedCount: number;
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

// ── Scoring-tab pill status ──────────────────────────────────────────────
// Coarser, scoring-centric view of a roster row used by the merged Sheets
// tab's pills header. Collapses the dashboard's draft-no-pdf/draft-with-pdf
// distinction (irrelevant while scoring) and instead surfaces whether the
// teacher has started marking (`in-progress`) — derived from sheet.markedCount.

export type PillStatus =
  | 'off-day'
  | 'no-sheet'
  | 'draft'
  | 'printed'
  | 'in-progress'
  | 'completed';

export function pillStatus(r: Row): PillStatus {
  if (r.isOffDay) return 'off-day';
  if (!r.sheet) return 'no-sheet';
  if (r.sheet.status === 'completed') return 'completed';
  if (r.sheet.markedCount > 0) return 'in-progress';
  if (r.sheet.status === 'printed') return 'printed';
  return 'draft';
}

// "Needs action first" ordering for the pills queue: students with no sheet
// and printed-but-unscored sheets float to the front; finished + off-day sink.
export const PILL_SORT_RANK: Record<PillStatus, number> = {
  'no-sheet': 0,
  printed: 1,
  draft: 2,
  'in-progress': 3,
  completed: 4,
  'off-day': 5,
};

// Tailwind classes for each pill state. Mirrors the StatusBadge palette on
// the legacy /sheets row so the two surfaces stay visually consistent.
export const PILL_STYLES: Record<PillStatus, { label: string; cls: string }> = {
  'off-day': {
    label: 'Off day',
    cls: 'bg-muted text-muted-foreground border border-transparent',
  },
  'no-sheet': {
    label: 'No sheet',
    cls: 'bg-red-500/10 text-red-700 dark:text-red-400 border border-red-500/30',
  },
  draft: {
    label: 'Draft',
    cls: 'bg-muted text-muted-foreground border border-border',
  },
  printed: {
    label: 'Printed',
    cls: 'bg-primary/15 text-primary border border-primary/30',
  },
  'in-progress': {
    label: 'Scoring',
    cls: 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/30',
  },
  completed: {
    label: 'Done',
    cls: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30',
  },
};
