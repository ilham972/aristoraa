'use client';

// Pulse — executive command center. One-shot snapshot answering "Am I
// winning this month?" with six KPIs, a revenue sparkline, and a short
// insights list. Reads from analytics.pulseSnapshot which packs the entire
// dashboard into one query.
//
// Range is fixed at 30d here. The richer per-tab filters live on Finance,
// Operations, etc.

import { useQuery } from 'convex/react';
import {
  Activity,
  CalendarCheck,
  Coins,
  TrendingUp,
  Users,
  Wallet,
} from 'lucide-react';
import { api } from '@/lib/convex';
import { fmtLKR } from '@/lib/groups/time-grid';
import { Card, Kpi, Sparkline } from './ui';

export function PulseTab() {
  const data = useQuery(api.analytics.pulseSnapshot, {});

  if (data === undefined) {
    return (
      <div className="animate-pulse space-y-3">
        <div className="grid grid-cols-2 gap-2">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-20 rounded-xl bg-muted/40" />
          ))}
        </div>
        <div className="h-32 rounded-xl bg-muted/30" />
        <div className="h-32 rounded-xl bg-muted/30" />
      </div>
    );
  }

  if (data === null) {
    return (
      <div className="rounded-xl border border-dashed border-border/60 py-10 text-center">
        <p className="text-sm text-muted-foreground">Sign in to view analytics.</p>
      </div>
    );
  }

  // Compute a few quick insights from the snapshot.
  const cancellationRate =
    data.compliance.scheduled === 0
      ? 0
      : Math.round((data.compliance.cancelled / data.compliance.scheduled) * 100);
  const unloggedRate =
    data.compliance.scheduled === 0
      ? 0
      : Math.round((data.compliance.unlogged / data.compliance.scheduled) * 100);
  const placementRate =
    data.students.total === 0
      ? 0
      : Math.round((data.students.active / data.students.total) * 100);

  return (
    <div className="space-y-4">
      {/* KPI strip — six tiles */}
      <div className="grid grid-cols-2 gap-2">
        <Kpi
          icon={<Wallet className="w-3.5 h-3.5" />}
          label="Revenue 30d"
          value={fmtLKR(data.revenue.range)}
          sub={`vs prior 30d ${fmtLKR(data.revenue.prev)}`}
          accent
          delta={data.revenue.deltaPct}
        />
        <Kpi
          icon={<CalendarCheck className="w-3.5 h-3.5" />}
          label="Attendance 30d"
          value={`${data.attendance.pct}%`}
          sub={`${data.attendance.present} present · ${data.attendance.absent} absent`}
          tone={data.attendance.pct < 80 ? 'warn' : 'ok'}
          delta={
            data.attendance.prevPct === 0
              ? null
              : data.attendance.pct - data.attendance.prevPct
          }
        />
        <Kpi
          icon={<Activity className="w-3.5 h-3.5" />}
          label="Log compliance"
          value={`${data.compliance.pct}%`}
          sub={`${data.compliance.unlogged} unlogged · ${data.compliance.held} logged`}
          tone={data.compliance.pct < 80 ? 'warn' : 'ok'}
        />
        <Kpi
          icon={<Coins className="w-3.5 h-3.5" />}
          label="Outstanding"
          value={fmtLKR(data.credit.outstanding)}
          sub="total owed across all students"
          tone={data.credit.outstanding > 0 ? 'warn' : 'ok'}
        />
        <Kpi
          icon={<Users className="w-3.5 h-3.5" />}
          label="Active students"
          value={`${data.students.active}`}
          sub={`${placementRate}% of ${data.students.total} placed`}
        />
        <Kpi
          icon={<TrendingUp className="w-3.5 h-3.5" />}
          label="Sessions held"
          value={`${data.compliance.held}`}
          sub={`${data.compliance.cancelled} cancelled · ${data.compliance.unlogged} missing`}
        />
      </div>

      {/* Revenue sparkline */}
      <Card title="Revenue · last 30 days" icon={<Wallet className="w-3.5 h-3.5" />}>
        <div className="space-y-2">
          <Sparkline
            data={data.dailySeries.map((d) => d.revenue)}
            barClass="bg-primary/70"
            height={56}
          />
          <div className="flex items-center justify-between text-[10px] text-muted-foreground">
            <span>{prettyDate(data.dailySeries[0]?.date)}</span>
            <span>{prettyDate(data.dailySeries[data.dailySeries.length - 1]?.date)}</span>
          </div>
        </div>
      </Card>

      {/* Insights */}
      <Card title="Notable" icon={<Activity className="w-3.5 h-3.5" />}>
        <ul className="space-y-2 text-xs">
          {data.revenue.deltaPct != null && (
            <li className="flex items-start gap-2">
              <span
                className={
                  data.revenue.deltaPct >= 0 ? 'text-emerald-600' : 'text-destructive'
                }
              >
                {data.revenue.deltaPct >= 0 ? '↑' : '↓'}
              </span>
              <span>
                Revenue is {data.revenue.deltaPct >= 0 ? 'up' : 'down'} {Math.abs(data.revenue.deltaPct)}% vs the
                previous 30 days ({fmtLKR(data.revenue.range - data.revenue.prev)} swing).
              </span>
            </li>
          )}
          {cancellationRate > 0 && (
            <li className="flex items-start gap-2">
              <span className="text-amber-600">!</span>
              <span>
                {cancellationRate}% of scheduled sessions were cancelled by you (
                {data.compliance.cancelled} of {data.compliance.scheduled}). See Operations →
                Sessions for the reason breakdown.
              </span>
            </li>
          )}
          {unloggedRate > 5 && (
            <li className="flex items-start gap-2">
              <span className="text-destructive">!</span>
              <span>
                {unloggedRate}% of past sessions are still unlogged ({data.compliance.unlogged}).
                Real revenue + attendance will read low until logged.
              </span>
            </li>
          )}
          {data.credit.outstanding > 0 && (
            <li className="flex items-start gap-2">
              <span className="text-amber-600">₨</span>
              <span>
                {fmtLKR(data.credit.outstanding)} outstanding. Drill into Finance → Credit
                to see who owes what and how long it&apos;s been outstanding.
              </span>
            </li>
          )}
          {data.attendance.pct >= 90 && data.compliance.pct >= 90 && data.credit.outstanding === 0 && (
            <li className="flex items-start gap-2">
              <span className="text-emerald-600">✓</span>
              <span>Everything green this window. No outstanding actions to flag.</span>
            </li>
          )}
        </ul>
      </Card>
    </div>
  );
}

function prettyDate(ymd: string | undefined): string {
  if (!ymd) return '';
  const d = new Date(ymd + 'T00:00:00');
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
