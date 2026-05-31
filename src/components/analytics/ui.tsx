'use client';

// Shared UI primitives for /analytics tabs. Kept small + visual — every
// chart is a coloured bar/strip, no charts library. The KPI strip is the
// most-reused piece: tone + accent + delta arrow.

import { ArrowDown, ArrowUp, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';

export function Kpi({
  icon,
  label,
  value,
  sub,
  accent,
  tone,
  delta,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
  tone?: 'warn' | 'ok' | 'bad';
  delta?: number | null;
}) {
  const deltaIcon =
    delta == null
      ? null
      : delta > 0
        ? <ArrowUp className="w-2.5 h-2.5" />
        : delta < 0
          ? <ArrowDown className="w-2.5 h-2.5" />
          : <Minus className="w-2.5 h-2.5" />;
  const deltaTone =
    delta == null
      ? 'text-muted-foreground'
      : delta > 0
        ? 'text-emerald-600'
        : delta < 0
          ? 'text-destructive'
          : 'text-muted-foreground';
  return (
    <div
      className={cn(
        // translateZ(0): force own GPU layer so Android Chrome reliably
        // rasterizes this card's contents (fixes blank/unpainted cards).
        'rounded-xl border px-3 py-2.5 [transform:translateZ(0)]',
        accent
          ? 'bg-primary/10 border-primary/30'
          : tone === 'warn'
            ? 'bg-amber-500/5 border-amber-500/30'
            : tone === 'bad'
              ? 'bg-destructive/5 border-destructive/30'
              : 'bg-card border-border/60',
      )}
    >
      <div className="flex items-center gap-1.5 mb-1">
        <span
          className={cn(
            'inline-flex shrink-0',
            accent
              ? 'text-primary'
              : tone === 'warn'
                ? 'text-amber-600'
                : tone === 'bad'
                  ? 'text-destructive'
                  : 'text-muted-foreground',
          )}
        >
          {icon}
        </span>
        <p className="text-[10px] text-muted-foreground uppercase tracking-wider truncate">
          {label}
        </p>
      </div>
      <div className="flex items-baseline gap-1.5">
        <p
          className={cn(
            'text-base font-bold leading-tight tabular-nums',
            tone === 'warn'
              ? 'text-amber-600'
              : tone === 'bad'
                ? 'text-destructive'
                : 'text-foreground',
          )}
        >
          {value}
        </p>
        {delta != null && (
          <span className={cn('inline-flex items-center text-[10px] font-bold tabular-nums', deltaTone)}>
            {deltaIcon}
            {Math.abs(delta)}%
          </span>
        )}
      </div>
      {sub && <p className="text-[10px] text-muted-foreground mt-0.5 truncate">{sub}</p>}
    </div>
  );
}

export function Card({
  title,
  icon,
  right,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl bg-card border border-border/60 p-3 [transform:translateZ(0)]">
      <div className="flex items-center justify-between mb-2 gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          {icon && <span className="text-muted-foreground shrink-0">{icon}</span>}
          <h3 className="text-xs font-semibold text-foreground uppercase tracking-wider truncate">
            {title}
          </h3>
        </div>
        {right}
      </div>
      {children}
    </div>
  );
}

export function RangePicker<T extends number>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (r: T) => void;
  options: T[];
}) {
  return (
    <div className="inline-flex items-center gap-1 p-0.5 bg-muted rounded-md">
      {options.map((r) => (
        <button
          key={r}
          onClick={() => onChange(r)}
          className={cn(
            'px-2 py-0.5 rounded text-[10px] font-medium',
            value === r ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground',
          )}
        >
          {r}d
        </button>
      ))}
    </div>
  );
}

export function SubTabs<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: string; icon?: React.ReactNode }>;
}) {
  return (
    <div className="flex items-center gap-1 p-0.5 bg-muted rounded-lg w-fit mb-3">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'inline-flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-medium transition-all',
            value === o.value ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground',
          )}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}

// Lightweight horizontal sparkline. Renders bars proportional to value,
// max-normalized. Bars are tinted with `barClass`. width-12 per bar; the
// caller controls how many bars to pass (we don't sample).
export function Sparkline({
  data,
  barClass = 'bg-primary/70',
  height = 32,
}: {
  data: number[];
  barClass?: string;
  height?: number;
}) {
  const max = Math.max(1, ...data);
  return (
    <div className="flex items-end gap-[2px]" style={{ height }}>
      {data.map((v, i) => (
        <div
          key={i}
          className={cn('flex-1 rounded-t', barClass)}
          style={{ height: `${(v / max) * 100}%`, minHeight: 2 }}
          title={String(v)}
        />
      ))}
    </div>
  );
}

// Stacked bar that fills based on the array of (label, value, color) parts.
// Total auto-sums; widths are percentage-of-total.
export function StackBar({
  parts,
  total,
}: {
  parts: Array<{ label: string; value: number; color: string }>;
  total?: number;
}) {
  const sum = total ?? parts.reduce((s, p) => s + p.value, 0);
  if (sum === 0) {
    return <div className="h-2 rounded-full bg-muted" />;
  }
  return (
    <div className="h-2 rounded-full bg-muted overflow-hidden flex">
      {parts.map((p, i) => (
        <div
          key={i}
          className={cn('h-full', p.color)}
          style={{ width: `${(p.value / sum) * 100}%` }}
          title={`${p.label}: ${p.value}`}
        />
      ))}
    </div>
  );
}
