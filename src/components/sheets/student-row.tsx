'use client';

// One student in the merged /sheets list. Status-driven action set —
// identical rules to the legacy /algorithm/sheets row, plus a row-body
// click that opens the unified inspector drawer (Inspect tab).
//
// All per-row action buttons stopPropagation so they don't also open the
// drawer when clicked.

import {
  AlertTriangle,
  Coffee,
  Save,
  RefreshCw,
  Zap,
  Printer,
  CheckCircle2,
  ExternalLink,
  Pencil,
  Loader2,
  ClipboardCheck,
} from 'lucide-react';
import type { Row } from './shared';
import { rowStatus } from './shared';
import type { SheetRowStatus } from './filters-bar';

export function StudentRow({
  row,
  busyLabel,
  onOpenInspect,
  onOpenEdit,
  onGenerate,
  onRender,
  onForceRender,
  onMarkPrinted,
  onScore,
}: {
  row: Row;
  busyLabel: string | null;
  onOpenInspect: () => void;
  onOpenEdit: () => void;
  onGenerate: () => void;
  onRender: () => void;
  onForceRender: () => void;
  onMarkPrinted: () => void;
  // Phase 2: opens the sheet-scoped scoring drawer. Optional — only the
  // session Sheets tab wires it; other StudentRow consumers omit it and the
  // Score button simply doesn't render.
  onScore?: () => void;
}) {
  const status = rowStatus(row);

  return (
    <div
      className="px-3 py-2.5 cursor-pointer hover:bg-muted/40 transition-colors"
      onClick={onOpenInspect}
    >
      <div className="flex items-center gap-2 mb-1.5">
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold text-foreground truncate">
            {row.studentName}
          </div>
          <div className="text-[10px] text-muted-foreground flex items-center gap-1.5">
            <span>G{row.schoolGrade}</span>
            {row.sheet && (
              <>
                <span>·</span>
                <span>
                  {row.sheet.questionCount} Q{row.sheet.questionCount === 1 ? '' : 's'}
                </span>
              </>
            )}
            {row.sheet && row.sheet.alertCount > 0 && (
              <>
                <span>·</span>
                <span className="inline-flex items-center gap-0.5 text-amber-600 dark:text-amber-400">
                  <AlertTriangle className="w-2.5 h-2.5" />
                  {row.sheet.alertCount}
                </span>
              </>
            )}
          </div>
        </div>
        <StatusBadge status={status} />
      </div>

      <div
        className="flex flex-wrap items-center gap-1.5"
        onClick={(e) => e.stopPropagation()}
      >
        {busyLabel ? (
          <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
            <Loader2 className="w-3 h-3 animate-spin" />
            {busyLabel}
          </span>
        ) : (
          <RowActions
            status={status}
            row={row}
            onOpenEdit={onOpenEdit}
            onGenerate={onGenerate}
            onRender={onRender}
            onForceRender={onForceRender}
            onMarkPrinted={onMarkPrinted}
            onScore={onScore}
          />
        )}
      </div>
    </div>
  );
}

function RowActions({
  status,
  row,
  onOpenEdit,
  onGenerate,
  onRender,
  onForceRender,
  onMarkPrinted,
  onScore,
}: {
  status: SheetRowStatus;
  row: Row;
  onOpenEdit: () => void;
  onGenerate: () => void;
  onRender: () => void;
  onForceRender: () => void;
  onMarkPrinted: () => void;
  onScore?: () => void;
}) {
  const editBtn =
    (status === 'draft-no-pdf' || status === 'draft-with-pdf' || status === 'printed') ? (
      <ActionBtn icon={<Pencil className="w-3 h-3" />} label="Edit" onClick={onOpenEdit} tone="ghost" />
    ) : null;

  // Phase 2: Score the sheet into the learning engine. Available wherever a
  // saved sheet exists (draft → printed → completed). Re-scoring a completed
  // sheet is allowed; finalize only re-commits changed marks.
  const scoreBtn =
    onScore &&
    (status === 'draft-no-pdf' ||
      status === 'draft-with-pdf' ||
      status === 'printed' ||
      status === 'completed') ? (
      <ActionBtn
        icon={<ClipboardCheck className="w-3 h-3" />}
        label={status === 'completed' ? 'Re-score' : 'Score'}
        onClick={onScore}
        tone="primary"
      />
    ) : null;

  if (status === 'off-day') {
    return (
      <span className="text-[10px] text-muted-foreground">No action — off day.</span>
    );
  }
  if (status === 'no-sheet') {
    return <ActionBtn icon={<Save className="w-3 h-3" />} label="Generate" onClick={onGenerate} tone="primary" />;
  }
  if (status === 'draft-no-pdf') {
    return (
      <>
        <ActionBtn icon={<RefreshCw className="w-3 h-3" />} label="Render" onClick={onRender} tone="primary" />
        <ActionBtn icon={<Zap className="w-3 h-3" />} label="Force render" onClick={onForceRender} tone="amber" />
        {editBtn}
        <ActionBtn icon={<Save className="w-3 h-3" />} label="Re-generate" onClick={onGenerate} tone="ghost" />
        {scoreBtn}
      </>
    );
  }
  if (status === 'draft-with-pdf') {
    return (
      <>
        {row.sheet?.pdfUrl && (
          <a
            href={row.sheet.pdfUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-emerald-500/10 border border-emerald-500/30 text-emerald-700 dark:text-emerald-400 text-[10px] font-semibold"
          >
            <ExternalLink className="w-3 h-3" />
            Open PDF
          </a>
        )}
        {editBtn}
        <ActionBtn icon={<RefreshCw className="w-3 h-3" />} label="Re-render" onClick={onRender} tone="ghost" />
        <ActionBtn icon={<Zap className="w-3 h-3" />} label="Force re-render" onClick={onForceRender} tone="ghost" />
        <ActionBtn icon={<Printer className="w-3 h-3" />} label="Mark printed" onClick={onMarkPrinted} tone="primary" />
        {scoreBtn}
      </>
    );
  }
  if (status === 'printed') {
    return (
      <>
        {row.sheet?.pdfUrl && (
          <a
            href={row.sheet.pdfUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-muted text-foreground text-[10px] font-semibold"
          >
            <ExternalLink className="w-3 h-3" />
            Open PDF
          </a>
        )}
        {editBtn}
        {scoreBtn}
        <span className="text-[10px] text-muted-foreground">
          Locked — printed. Delete the row to regenerate.
        </span>
      </>
    );
  }
  // completed
  return (
    <>
      {row.sheet?.pdfUrl && (
        <a
          href={row.sheet.pdfUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-muted text-foreground text-[10px] font-semibold"
        >
          <ExternalLink className="w-3 h-3" />
          Open PDF
        </a>
      )}
      {scoreBtn}
    </>
  );
}

function ActionBtn({
  icon,
  label,
  onClick,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  tone: 'primary' | 'amber' | 'ghost';
}) {
  const cls = {
    primary: 'bg-primary text-primary-foreground hover:bg-primary/90',
    amber:
      'bg-amber-500/10 border border-amber-500/30 text-amber-700 dark:text-amber-400 hover:bg-amber-500/20',
    ghost:
      'bg-muted text-muted-foreground hover:text-foreground hover:bg-muted/80',
  }[tone];
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-semibold transition-colors ${cls}`}
    >
      {icon}
      {label}
    </button>
  );
}

function StatusBadge({ status }: { status: SheetRowStatus }) {
  const map: Record<
    SheetRowStatus,
    { label: string; cls: string; icon: React.ReactNode }
  > = {
    'off-day': {
      label: 'Off day',
      cls: 'bg-muted text-muted-foreground',
      icon: <Coffee className="w-3 h-3" />,
    },
    'no-sheet': {
      label: 'No draft',
      cls: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/30',
      icon: <AlertTriangle className="w-3 h-3" />,
    },
    'draft-no-pdf': {
      label: 'Draft',
      cls: 'bg-teal-500/10 text-teal-700 dark:text-teal-400 border border-teal-500/30',
      icon: <Save className="w-3 h-3" />,
    },
    'draft-with-pdf': {
      label: 'PDF ready',
      cls: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30',
      icon: <CheckCircle2 className="w-3 h-3" />,
    },
    printed: {
      label: 'Printed',
      cls: 'bg-primary/15 text-primary border border-primary/30',
      icon: <Printer className="w-3 h-3" />,
    },
    completed: {
      label: 'Done',
      cls: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30',
      icon: <CheckCircle2 className="w-3 h-3" />,
    },
  };
  const e = map[status];
  return (
    <span
      className={`shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-semibold ${e.cls}`}
    >
      {e.icon}
      {e.label}
    </span>
  );
}
