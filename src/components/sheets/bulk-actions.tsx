'use client';

// Slot-level bulk actions panel — Generate / Render / Force render /
// Download ZIP. Mirrors the panel from the legacy /algorithm/sheets page
// 1:1 so the morning workflow stays identical.

import {
  Save,
  RefreshCw,
  Zap,
  Archive,
  Download,
  Loader2,
} from 'lucide-react';
import type { Counts } from './shared';

export type BulkBusy = {
  kind: 'generate' | 'render' | 'force-render' | 'zip' | null;
  total: number;
  done: number;
} | null;

export type LastZip = {
  url: string | null;
  included: number;
  skipped: number;
  bytes: number;
} | null;

export function BulkActions({
  counts,
  busy,
  onGenerate,
  onRender,
  onForceRender,
  onZip,
  lastZip,
}: {
  counts: Counts;
  busy: BulkBusy;
  onGenerate: () => void;
  onRender: () => void;
  onForceRender: () => void;
  onZip: () => void;
  lastZip: LastZip;
}) {
  const someBusy = !!busy?.kind;
  const eligibleTotal = counts.total - counts.offDay;
  const pdfsReady = counts.draftWithPdf + counts.printed + counts.completed;
  return (
    <section className="mt-3 rounded-xl border border-border bg-card p-3 space-y-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">
        Slot actions
      </div>
      <div className="grid grid-cols-2 gap-2">
        <BulkButton
          icon={<Save className="w-3.5 h-3.5" />}
          label="Generate drafts"
          hint={`${eligibleTotal} student${eligibleTotal === 1 ? '' : 's'}`}
          onClick={onGenerate}
          busy={busy?.kind === 'generate'}
          progress={busy?.kind === 'generate' ? busy : null}
          disabled={someBusy}
          tone="primary"
        />
        <BulkButton
          icon={<RefreshCw className="w-3.5 h-3.5" />}
          label="Render PDFs"
          hint={`${counts.draftNoPdf} to render`}
          onClick={onRender}
          busy={busy?.kind === 'render'}
          progress={busy?.kind === 'render' ? busy : null}
          disabled={someBusy || counts.draftNoPdf === 0}
          tone="primary"
        />
        <BulkButton
          icon={<Zap className="w-3.5 h-3.5" />}
          label="Force render"
          hint="skip missing imgs"
          onClick={onForceRender}
          busy={busy?.kind === 'force-render'}
          progress={busy?.kind === 'force-render' ? busy : null}
          disabled={someBusy || counts.draftNoPdf === 0}
          tone="amber"
        />
        <BulkButton
          icon={<Archive className="w-3.5 h-3.5" />}
          label="Download ZIP"
          hint={`${pdfsReady} PDF${pdfsReady === 1 ? '' : 's'} ready`}
          onClick={onZip}
          busy={busy?.kind === 'zip'}
          progress={null}
          disabled={someBusy || pdfsReady === 0}
          tone="emerald"
        />
      </div>
      {lastZip && (
        <div className="rounded-md bg-muted/40 px-2 py-2 text-[11px] flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-foreground">
              ZIP: <strong>{lastZip.included}</strong> PDF
              {lastZip.included === 1 ? '' : 's'}
              {lastZip.skipped > 0 && (
                <span className="text-muted-foreground">
                  {' '}· {lastZip.skipped} skipped
                </span>
              )}
            </div>
            <div className="text-[10px] text-muted-foreground">
              ~{(lastZip.bytes / 1024 / 1024).toFixed(1)} MB
            </div>
          </div>
          {lastZip.url && (
            <a
              href={lastZip.url}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-md bg-emerald-500/10 border border-emerald-500/30 text-emerald-700 dark:text-emerald-400 text-[10px] font-semibold"
            >
              <Download className="w-3 h-3" />
              Open
            </a>
          )}
        </div>
      )}
    </section>
  );
}

function BulkButton({
  icon,
  label,
  hint,
  onClick,
  busy,
  progress,
  disabled,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  hint: string;
  onClick: () => void;
  busy: boolean;
  progress: { total: number; done: number } | null;
  disabled: boolean;
  tone: 'primary' | 'amber' | 'emerald';
}) {
  const base =
    'flex flex-col gap-0.5 px-3 py-2 rounded-lg text-left transition-colors disabled:opacity-50';
  const cls = {
    primary: 'bg-primary text-primary-foreground hover:bg-primary/90',
    amber:
      'bg-amber-500/10 border border-amber-500/30 text-amber-700 dark:text-amber-400 hover:bg-amber-500/20',
    emerald:
      'bg-emerald-500/10 border border-emerald-500/30 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/20',
  }[tone];
  return (
    <button
      onClick={onClick}
      disabled={disabled || busy}
      className={`${base} ${cls}`}
    >
      <div className="flex items-center gap-1.5 text-[11px] font-semibold">
        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : icon}
        {label}
      </div>
      <div className="text-[10px] opacity-80">
        {busy && progress ? `${progress.done}/${progress.total}…` : hint}
      </div>
    </button>
  );
}
