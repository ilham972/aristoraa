'use client';

// Right-side full-height drawer for /sheets. Opens on row-click; renders
// the planner Inspector for the (student, date) pair and a sticky bottom
// action bar with every save/print/render verb so the Lead can act without
// closing.
//
// "Edit overrides" — the existing SheetPreviewDrawer is its own
// fixed-position modal. Rather than nest modals, the drawer surfaces a
// button that asks the parent to switch surfaces (close this, open the
// override drawer). When the override drawer closes the Lead is back in
// the row list, not back inside this drawer — a deliberate simplification
// to keep modal state legible.

import { useEffect } from 'react';
import {
  X,
  Save,
  RefreshCw,
  Zap,
  Printer,
  CheckCircle2,
  ExternalLink,
  Pencil,
  Loader2,
  Coffee,
  AlertTriangle,
} from 'lucide-react';
import type { Id } from '@/lib/convex';
import { InspectorBody } from './inspector-body';
import { rowStatus, type Row } from './shared';

export function InspectorDrawer({
  row,
  dateStr,
  unitIds,
  gradeByModule,
  busyLabel,
  onClose,
  onOpenEdit,
  onGenerate,
  onRender,
  onForceRender,
  onMarkPrinted,
  onMarkCompleted,
}: {
  row: Row;
  dateStr: string;
  unitIds: string[];
  gradeByModule: Record<string, number[]>;
  busyLabel: string | null;
  onClose: () => void;
  onOpenEdit: () => void;
  onGenerate: () => void;
  onRender: () => void;
  onForceRender: () => void;
  onMarkPrinted: () => void;
  onMarkCompleted: () => void;
}) {
  const status = rowStatus(row);

  // Lock page scroll while open. Matches SheetPreviewDrawer's pattern.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // ESC closes.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  const hasSheet = !!row.sheet;
  const hasPdf = !!row.sheet?.pdfStorageId;
  const isPrinted = status === 'printed';
  const isCompleted = status === 'completed';
  const isOffDay = status === 'off-day';
  const isFrozen = isPrinted || isCompleted;
  const busy = busyLabel !== null;

  return (
    <div
      className="fixed inset-0 z-40 bg-black/60 flex justify-end"
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-xl h-full bg-card border-l border-border shadow-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <header className="shrink-0 border-b border-border px-3 py-2.5 flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-bold text-foreground truncate">
              {row.studentName}
            </div>
            <div className="text-[10.5px] text-muted-foreground flex items-center gap-1.5">
              <span>G{row.schoolGrade}</span>
              <span>·</span>
              <span>{dateStr}</span>
              {row.sheet && (
                <>
                  <span>·</span>
                  <span>{row.sheet.questionCount} Q</span>
                </>
              )}
              {row.sheet?.alertCount ? (
                <>
                  <span>·</span>
                  <span className="inline-flex items-center gap-0.5 text-amber-600 dark:text-amber-400">
                    <AlertTriangle className="w-2.5 h-2.5" />
                    {row.sheet.alertCount} alert{row.sheet.alertCount === 1 ? '' : 's'}
                  </span>
                </>
              ) : null}
            </div>
          </div>
          <StatusPill status={status} />
          <button
            onClick={onClose}
            className="p-1.5 rounded-md hover:bg-muted text-muted-foreground"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-3 py-3">
          {isOffDay ? (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 flex items-start gap-3">
              <Coffee className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
              <div className="min-w-0">
                <div className="text-sm font-semibold text-foreground mb-0.5">
                  Off-day
                </div>
                <p className="text-[11px] text-muted-foreground">
                  This student is off on {dateStr}. No sheet will be generated.
                </p>
              </div>
            </div>
          ) : (
            <InspectorBody
              studentId={row.studentId}
              dateStr={dateStr}
              unitIds={unitIds}
              gradeByModule={gradeByModule}
            />
          )}
        </div>

        {/* Sticky action bar */}
        <footer className="shrink-0 border-t border-border bg-card/95 backdrop-blur-sm px-3 py-2 pb-[calc(0.5rem+env(safe-area-inset-bottom,0px))]">
          {busy && (
            <div className="mb-1.5 inline-flex items-center gap-1 text-[10.5px] text-muted-foreground">
              <Loader2 className="w-3 h-3 animate-spin" />
              {busyLabel}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-1.5">
            {isOffDay ? (
              <span className="text-[10.5px] text-muted-foreground">
                No actions on an off-day.
              </span>
            ) : (
              <>
                {/* Save / Generate / Replace */}
                <DrawerBtn
                  icon={<Save className="w-3 h-3" />}
                  label={
                    !hasSheet
                      ? 'Generate'
                      : isFrozen
                      ? 'Re-generate'
                      : 'Replace draft'
                  }
                  onClick={onGenerate}
                  tone="primary"
                  disabled={busy || isFrozen}
                />

                {/* Render */}
                <DrawerBtn
                  icon={<RefreshCw className="w-3 h-3" />}
                  label={hasPdf ? 'Re-render' : 'Render'}
                  onClick={onRender}
                  tone={hasPdf ? 'ghost' : 'primary'}
                  disabled={busy || !hasSheet}
                />
                <DrawerBtn
                  icon={<Zap className="w-3 h-3" />}
                  label="Force render"
                  onClick={onForceRender}
                  tone="amber"
                  disabled={busy || !hasSheet}
                />

                {/* Edit overrides */}
                <DrawerBtn
                  icon={<Pencil className="w-3 h-3" />}
                  label="Edit overrides"
                  onClick={onOpenEdit}
                  tone="ghost"
                  disabled={busy || !hasSheet || isCompleted}
                />

                {/* Open PDF */}
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

                {/* Mark printed */}
                <DrawerBtn
                  icon={<Printer className="w-3 h-3" />}
                  label="Mark printed"
                  onClick={onMarkPrinted}
                  tone="primary"
                  disabled={busy || !hasSheet || isCompleted || isPrinted}
                />

                {/* Mark completed */}
                <DrawerBtn
                  icon={<CheckCircle2 className="w-3 h-3" />}
                  label="Mark completed"
                  onClick={onMarkCompleted}
                  tone="emerald"
                  disabled={busy || !hasSheet || isCompleted}
                />
              </>
            )}
          </div>
          {isFrozen && (
            <p className="mt-1.5 text-[10px] text-muted-foreground italic">
              Sheet is {status === 'printed' ? 'printed' : 'completed'} — delete
              from the list to regenerate.
            </p>
          )}
        </footer>
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: ReturnType<typeof rowStatus> }) {
  const map: Record<
    ReturnType<typeof rowStatus>,
    { label: string; cls: string }
  > = {
    'off-day':        { label: 'Off day',   cls: 'bg-muted text-muted-foreground' },
    'no-sheet':       { label: 'No draft',  cls: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/30' },
    'draft-no-pdf':   { label: 'Draft',     cls: 'bg-teal-500/10 text-teal-700 dark:text-teal-400 border border-teal-500/30' },
    'draft-with-pdf': { label: 'PDF ready', cls: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30' },
    printed:          { label: 'Printed',   cls: 'bg-primary/15 text-primary border border-primary/30' },
    completed:        { label: 'Done',      cls: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30' },
  };
  const e = map[status];
  return (
    <span
      className={`shrink-0 px-2 py-0.5 rounded-md text-[10px] font-semibold ${e.cls}`}
    >
      {e.label}
    </span>
  );
}

function DrawerBtn({
  icon,
  label,
  onClick,
  tone,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  tone: 'primary' | 'amber' | 'emerald' | 'ghost';
  disabled?: boolean;
}) {
  const cls = {
    primary: 'bg-primary text-primary-foreground hover:bg-primary/90',
    amber:
      'bg-amber-500/10 border border-amber-500/30 text-amber-700 dark:text-amber-400 hover:bg-amber-500/20',
    emerald:
      'bg-emerald-500/10 border border-emerald-500/30 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/20',
    ghost:
      'bg-muted text-muted-foreground hover:text-foreground hover:bg-muted/80',
  }[tone];
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${cls}`}
    >
      {icon}
      {label}
    </button>
  );
}

// Re-export for the page so it can disambiguate the Row id type.
export type DrawerRowId = Id<'students'>;
