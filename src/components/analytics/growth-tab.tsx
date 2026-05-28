'use client';

// Growth tab — acquisition + retention. Acquisition shows new students per
// month; retention shows what fraction of each month's cohort is still
// active today. Together they answer "Am I scaling?" — the single most
// load-bearing pair of charts for a tutoring business.

import { useQuery } from 'convex/react';
import { Building2, Sparkles, TrendingUp, UserPlus } from 'lucide-react';
import { api } from '@/lib/convex';
import { cn } from '@/lib/utils';
import { Card, Kpi, Sparkline } from './ui';

export function GrowthTab() {
  const acquisition = useQuery(api.analytics.acquisitionByMonth, { months: 12 });
  const retention = useQuery(api.analytics.cohortRetention, { months: 12 });
  const capacity = useQuery(api.analytics.capacityUtilization, {});

  if (acquisition === undefined || retention === undefined || capacity === undefined) {
    return (
      <div className="animate-pulse space-y-3">
        <div className="grid grid-cols-3 gap-2">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-20 rounded-xl bg-muted/40" />
          ))}
        </div>
        <div className="h-40 rounded-xl bg-muted/30" />
        <div className="h-48 rounded-xl bg-muted/30" />
      </div>
    );
  }

  const totalAcquired = acquisition.reduce((s, m) => s + m.count, 0);
  const last3 = acquisition.slice(-3).reduce((s, m) => s + m.count, 0);
  const prev3 = acquisition.slice(-6, -3).reduce((s, m) => s + m.count, 0);
  const acquisitionDelta =
    prev3 === 0 ? null : Math.round(((last3 - prev3) / prev3) * 100);

  const lastCompleteMonth = retention[retention.length - 2] ?? null;
  const overallRetention =
    retention.length === 0
      ? 0
      : Math.round(
          (retention.reduce((s, r) => s + r.retained, 0) /
            Math.max(1, retention.reduce((s, r) => s + r.joined, 0))) *
            100,
        );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2">
        <Kpi
          icon={<UserPlus className="w-3.5 h-3.5" />}
          label="Joined · 12mo"
          value={`${totalAcquired}`}
          sub="new students"
          delta={acquisitionDelta}
        />
        <Kpi
          icon={<TrendingUp className="w-3.5 h-3.5" />}
          label="Retention"
          value={`${overallRetention}%`}
          sub="all-cohort still active"
          tone={overallRetention < 60 ? 'warn' : 'ok'}
        />
        <Kpi
          icon={<Building2 className="w-3.5 h-3.5" />}
          label="Headroom"
          value={`${capacity.summary.headroom}`}
          sub={`${capacity.summary.atCapacity} groups full`}
        />
      </div>

      <Card title="Acquisition · monthly" icon={<UserPlus className="w-3.5 h-3.5" />}>
        {totalAcquired === 0 ? (
          <p className="text-xs text-muted-foreground py-3 text-center">
            No joiners on record yet.
          </p>
        ) : (
          <div className="space-y-2">
            <Sparkline
              data={acquisition.map((a) => a.count)}
              barClass="bg-primary/70"
              height={56}
            />
            <div className="flex items-center justify-between text-[10px] text-muted-foreground">
              <span>{acquisition[0]?.month}</span>
              <span>{acquisition[acquisition.length - 1]?.month}</span>
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-1 mt-2">
              {acquisition.slice(-6).map((a) => (
                <div
                  key={a.month}
                  className="rounded-md bg-muted/40 px-1.5 py-1 text-center"
                >
                  <p className="text-[9px] text-muted-foreground uppercase tracking-wider">
                    {monthLabel(a.month)}
                  </p>
                  <p className="text-xs font-bold tabular-nums text-foreground">
                    {a.count}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>

      <Card title="Cohort retention" icon={<Sparkles className="w-3.5 h-3.5" />}>
        {retention.every((r) => r.joined === 0) ? (
          <p className="text-xs text-muted-foreground py-3 text-center">
            No cohorts to compare yet.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {retention.map((r) => (
              <li key={r.month} className="text-xs">
                <div className="flex items-baseline justify-between mb-0.5 gap-2">
                  <span className="text-foreground">{monthLabel(r.month)}</span>
                  <span className="text-muted-foreground tabular-nums shrink-0 text-[10px]">
                    {r.retained}/{r.joined}{' '}
                    {r.joined > 0 && (
                      <span className="font-semibold text-foreground">{r.retentionPct}%</span>
                    )}
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                  <div
                    className={cn(
                      'h-full',
                      r.retentionPct >= 80
                        ? 'bg-emerald-500'
                        : r.retentionPct >= 60
                          ? 'bg-amber-500'
                          : 'bg-destructive',
                    )}
                    style={{ width: `${r.retentionPct}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
        {lastCompleteMonth && lastCompleteMonth.joined > 0 && (
          <p className="text-[10px] text-muted-foreground mt-3">
            Last full month: {lastCompleteMonth.retained} of {lastCompleteMonth.joined}{' '}
            joiners still active ({lastCompleteMonth.retentionPct}%).
          </p>
        )}
      </Card>
    </div>
  );
}

function monthLabel(ym: string): string {
  // ym = "2026-05" → "May 26"
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, (m ?? 1) - 1, 1);
  return d.toLocaleDateString(undefined, { month: 'short', year: '2-digit' });
}
