'use client';

// Status-counts strip + per-slot alert total. Pure presentation —
// counts are derived by the parent via countByStatus.

import { AlertTriangle } from 'lucide-react';
import type { Counts } from './shared';

export function SummaryStrip({
  dateStr,
  counts,
}: {
  dateStr: string;
  counts: Counts;
}) {
  return (
    <section className="mt-3 rounded-xl border border-border bg-card p-3">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-1.5">
        {dateStr} · {counts.total} student{counts.total === 1 ? '' : 's'}
      </div>
      <div className="grid grid-cols-3 gap-2 text-[11px]">
        <StatBox label="Off day"   n={counts.offDay}       accent="muted" />
        <StatBox label="No draft"  n={counts.noSheet}      accent="amber" />
        <StatBox label="Drafts"    n={counts.draftNoPdf}   accent="teal" />
        <StatBox label="PDF ready" n={counts.draftWithPdf} accent="emerald" />
        <StatBox label="Printed"   n={counts.printed}      accent="primary" />
        <StatBox label="Done"      n={counts.completed}    accent="emerald" />
      </div>
      {counts.alerts > 0 && (
        <div className="mt-2 flex items-center gap-1.5 text-[11px] text-amber-600 dark:text-amber-400">
          <AlertTriangle className="w-3 h-3" />
          {counts.alerts} prereq alert{counts.alerts === 1 ? '' : 's'} across sheets
        </div>
      )}
    </section>
  );
}

function StatBox({
  label,
  n,
  accent,
}: {
  label: string;
  n: number;
  accent: 'muted' | 'amber' | 'teal' | 'emerald' | 'primary';
}) {
  const cls = {
    muted: 'text-muted-foreground',
    amber: 'text-amber-600 dark:text-amber-400',
    teal: 'text-teal-600 dark:text-teal-400',
    emerald: 'text-emerald-600 dark:text-emerald-400',
    primary: 'text-primary',
  }[accent];
  return (
    <div className="rounded-md bg-muted/40 px-2 py-1.5">
      <div className="text-[9px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`text-base font-bold tabular-nums ${cls}`}>{n}</div>
    </div>
  );
}
