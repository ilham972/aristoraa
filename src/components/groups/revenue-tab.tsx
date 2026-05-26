'use client';

// Revenue tab on /groups. Sole owner of the page's revenue UI: KPI cards,
// forecast-vs-actual chart, per-day distribution, per-group leaderboard, and
// per-mentor / per-centre / per-grade breakdowns. Data comes from one
// `groups.revenueInsights` query plus `groups.dayRevenue` for today's
// overrides-applied figure (the only thing the insights query can't supply
// without scoping to a specific date).

import { useMemo, useState } from 'react';
import { useQuery } from 'convex/react';
import { TrendingUp, Users, Calendar, Award, Activity, Building2, GraduationCap } from 'lucide-react';
import { api, type Id } from '@/lib/convex';
import { cn } from '@/lib/utils';
import { groupColor } from '@/lib/groups/color';
import { DAYS, fmtLKR, todayDayNum } from '@/lib/groups/time-grid';

type Range = 7 | 30;

function todayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function RevenueTab() {
  const [range, setRange] = useState<Range>(30);
  const insights = useQuery(api.groups.revenueInsights, { days: range });
  const todayActual = useQuery(api.groups.dayRevenue, { date: todayYmd() });

  const loading = insights === undefined;
  const todayDow = todayDayNum();
  const todayForecast = useMemo(
    () => insights?.forecast.perDay.find((d) => d.dayOfWeek === todayDow)?.revenue ?? 0,
    [insights, todayDow],
  );

  const last7Actual = useMemo(() => {
    if (!insights) return 0;
    return insights.actual.perDay.slice(-7).reduce((s, d) => s + d.revenue, 0);
  }, [insights]);

  const avgPerSession = insights && insights.meta.totalSessions > 0
    ? insights.forecast.week / insights.meta.totalSessions
    : 0;

  if (loading) {
    return (
      <div className="animate-pulse space-y-3">
        <div className="grid grid-cols-2 gap-2">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-20 rounded-xl bg-muted/40" />
          ))}
        </div>
        <div className="h-40 rounded-xl bg-muted/30" />
        <div className="h-32 rounded-xl bg-muted/30" />
        <div className="h-48 rounded-xl bg-muted/30" />
      </div>
    );
  }

  const empty = insights.meta.totalSessions === 0;

  if (empty) {
    return (
      <div className="rounded-xl border border-dashed border-border/60 py-10 text-center">
        <p className="text-sm text-muted-foreground mb-1">No revenue to show yet.</p>
        <p className="text-xs text-muted-foreground">Add a group with sessions and members to populate this tab.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ── KPI grid ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-2">
        <Kpi
          icon={<Calendar className="w-3.5 h-3.5" />}
          label="Today"
          value={fmtLKR(todayActual ?? todayForecast)}
          sub={
            todayActual != null && Math.abs(todayActual - todayForecast) > 1
              ? `${todayActual >= todayForecast ? '+' : ''}${fmtLKR(todayActual - todayForecast)} vs forecast`
              : 'forecast'
          }
        />
        <Kpi
          icon={<TrendingUp className="w-3.5 h-3.5" />}
          label="Week forecast"
          value={fmtLKR(insights.forecast.week)}
          sub={`${insights.meta.totalSessions} sessions / wk`}
          accent
        />
        <Kpi
          icon={<Activity className="w-3.5 h-3.5" />}
          label={`Last ${range}d realized`}
          value={fmtLKR(insights.actual.total)}
          sub={`${fmtLKR(last7Actual)} last 7d`}
        />
        <Kpi
          icon={<Users className="w-3.5 h-3.5" />}
          label="Avg / session"
          value={fmtLKR(avgPerSession)}
          sub={`${insights.meta.activeStudents} active students`}
        />
      </div>

      {/* ── Forecast vs actual chart ──────────────────────────────────── */}
      <Card title="Forecast vs realized" right={<RangePicker value={range} onChange={setRange} />}>
        <ForecastVsActualChart
          actualDaily={insights.actual.perDay}
          forecastPerDay={insights.forecast.perDay}
        />
        <Legend />
      </Card>

      {/* ── Per-day distribution ──────────────────────────────────────── */}
      <Card title="Standard week by day">
        <PerDayBars perDay={insights.forecast.perDay} />
      </Card>

      {/* ── Per-group leaderboard ─────────────────────────────────────── */}
      <Card
        title="Groups by weekly revenue"
        right={
          <span className="text-[10px] text-muted-foreground">
            {insights.forecast.perGroup.length} active
          </span>
        }
      >
        <PerGroupList rows={insights.forecast.perGroup} weekTotal={insights.forecast.week} />
      </Card>

      {/* ── Mentor / Centre / Grade breakdowns ────────────────────────── */}
      <div className="grid gap-2">
        <BreakdownCard
          title="By mentor"
          icon={<Award className="w-3.5 h-3.5" />}
          rows={insights.forecast.perMentor.map((r) => ({ label: r.name, value: r.weekRevenue }))}
          weekTotal={insights.forecast.week}
        />
        <BreakdownCard
          title="By centre"
          icon={<Building2 className="w-3.5 h-3.5" />}
          rows={insights.forecast.perCenter.map((r) => ({ label: r.name, value: r.weekRevenue }))}
          weekTotal={insights.forecast.week}
        />
        <BreakdownCard
          title="By grade"
          icon={<GraduationCap className="w-3.5 h-3.5" />}
          rows={insights.forecast.perGrade.map((r) => ({
            label: r.grade != null ? `Grade ${r.grade}` : 'Unassigned',
            value: r.weekRevenue,
          }))}
          weekTotal={insights.forecast.week}
        />
      </div>
    </div>
  );
}

// ── pieces ────────────────────────────────────────────────────────────────

function Kpi({
  icon,
  label,
  value,
  sub,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <div
      className={cn(
        'rounded-xl border px-3 py-2.5',
        accent
          ? 'bg-primary/10 border-primary/30'
          : 'bg-card border-border/60',
      )}
    >
      <div className="flex items-center gap-1.5 mb-1">
        <span className={cn('inline-flex', accent ? 'text-primary' : 'text-muted-foreground')}>
          {icon}
        </span>
        <p className="text-[10px] text-muted-foreground uppercase tracking-wider truncate">
          {label}
        </p>
      </div>
      <p className="text-base font-bold text-foreground leading-tight">{value}</p>
      {sub && <p className="text-[10px] text-muted-foreground mt-0.5 truncate">{sub}</p>}
    </div>
  );
}

function Card({
  title,
  right,
  children,
}: {
  title: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl bg-card border border-border/60 p-3">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-semibold text-foreground uppercase tracking-wider">
          {title}
        </h3>
        {right}
      </div>
      {children}
    </div>
  );
}

function RangePicker({ value, onChange }: { value: Range; onChange: (r: Range) => void }) {
  return (
    <div className="inline-flex items-center gap-1 p-0.5 bg-muted rounded-md">
      {([7, 30] as const).map((r) => (
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

function ForecastVsActualChart({
  actualDaily,
  forecastPerDay,
}: {
  actualDaily: Array<{ date: string; revenue: number }>;
  forecastPerDay: Array<{ dayOfWeek: number; revenue: number }>;
}) {
  // Forecast lookup keyed by JS-DOW-derived day. Convex returns 1=Mon..7=Sun.
  const fcByDow = new Map(forecastPerDay.map((d) => [d.dayOfWeek, d.revenue]));
  const rows = actualDaily.map((d) => {
    const dt = new Date(d.date + 'T00:00:00');
    const jsDow = dt.getDay();
    const dow = jsDow === 0 ? 7 : jsDow;
    return { date: d.date, actual: d.revenue, forecast: fcByDow.get(dow) ?? 0 };
  });

  const max = Math.max(1, ...rows.map((r) => Math.max(r.actual, r.forecast)));

  // Compact x-axis: every nth label so it doesn't crowd on 30-day view.
  const step = rows.length > 14 ? Math.ceil(rows.length / 7) : 1;

  return (
    <div>
      <div className="flex items-end gap-[2px] h-32 px-0.5">
        {rows.map((r, i) => {
          const fh = (r.forecast / max) * 100;
          const ah = (r.actual / max) * 100;
          return (
            <div
              key={r.date}
              className="flex-1 flex flex-col justify-end items-stretch gap-[1px] min-w-0 group/bar relative"
              title={`${r.date}\nForecast: ${fmtLKR(r.forecast)}\nActual: ${fmtLKR(r.actual)}`}
            >
              <div className="relative w-full" style={{ height: `${Math.max(fh, ah)}%` }}>
                {/* Forecast (faint backdrop) */}
                <div
                  className="absolute inset-x-0 bottom-0 bg-primary/15 rounded-sm"
                  style={{ height: `${(fh / Math.max(fh, ah || 1)) * 100}%` }}
                />
                {/* Actual (solid) */}
                <div
                  className="absolute inset-x-0 bottom-0 bg-primary rounded-sm"
                  style={{ height: `${(ah / Math.max(fh, ah || 1)) * 100}%` }}
                />
              </div>
              {i % step === 0 ? null : null}
            </div>
          );
        })}
      </div>
      <div className="flex justify-between mt-1 text-[9px] text-muted-foreground">
        {rows
          .filter((_, i) => i % step === 0 || i === rows.length - 1)
          .map((r) => {
            const dt = new Date(r.date + 'T00:00:00');
            return (
              <span key={r.date}>
                {dt.getMonth() + 1}/{dt.getDate()}
              </span>
            );
          })}
      </div>
    </div>
  );
}

function Legend() {
  return (
    <div className="flex items-center gap-4 mt-2 text-[10px] text-muted-foreground">
      <span className="inline-flex items-center gap-1.5">
        <span className="w-2 h-2 rounded-sm bg-primary" /> Realized
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="w-2 h-2 rounded-sm bg-primary/15 border border-primary/30" /> Forecast
      </span>
    </div>
  );
}

function PerDayBars({ perDay }: { perDay: Array<{ dayOfWeek: number; revenue: number }> }) {
  const byDow = new Map(perDay.map((r) => [r.dayOfWeek, r.revenue]));
  const today = todayDayNum();
  const rows = DAYS.map((d) => ({ ...d, revenue: byDow.get(d.num) ?? 0 }));
  const max = Math.max(1, ...rows.map((r) => r.revenue));

  return (
    <div className="flex items-end gap-1.5 h-28">
      {rows.map((r) => {
        const h = (r.revenue / max) * 100;
        const isToday = r.num === today;
        return (
          <div key={r.num} className="flex-1 flex flex-col items-center gap-1 min-w-0">
            <div className="flex-1 w-full flex items-end">
              <div
                className={cn(
                  'w-full rounded-t-md transition-all',
                  isToday ? 'bg-primary' : 'bg-primary/40',
                )}
                style={{ height: `${Math.max(h, 2)}%` }}
                title={`${r.full}: ${fmtLKR(r.revenue)}`}
              />
            </div>
            <span
              className={cn(
                'text-[10px] font-medium',
                isToday ? 'text-primary' : 'text-muted-foreground',
              )}
            >
              {r.short}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function PerGroupList({
  rows,
  weekTotal,
}: {
  rows: Array<{
    groupId: Id<'groups'>;
    name: string;
    members: number;
    sessions: number;
    hoursPerWeek: number;
    weekRevenue: number;
  }>;
  weekTotal: number;
}) {
  const max = Math.max(1, rows[0]?.weekRevenue ?? 1);

  if (rows.length === 0) {
    return <p className="text-xs text-muted-foreground py-2 text-center">No groups yet.</p>;
  }

  return (
    <div className="space-y-1.5">
      {rows.map((r) => {
        const color = groupColor(r.groupId);
        const pct = (r.weekRevenue / max) * 100;
        const share = weekTotal > 0 ? (r.weekRevenue / weekTotal) * 100 : 0;
        return (
          <div
            key={r.groupId}
            className="relative rounded-lg border border-border/60 p-2.5 overflow-hidden"
            style={{ borderColor: color.border }}
          >
            <div
              className="absolute inset-y-0 left-0 opacity-15"
              style={{ width: `${pct}%`, backgroundColor: color.solid }}
            />
            <div className="relative flex items-center gap-2.5">
              <span
                className="w-1.5 h-9 rounded-full shrink-0"
                style={{ backgroundColor: color.solid }}
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-foreground truncate">{r.name}</p>
                <p className="text-[10px] text-muted-foreground">
                  {r.members} member{r.members !== 1 ? 's' : ''} · {r.sessions} session{r.sessions !== 1 ? 's' : ''} · {r.hoursPerWeek.toFixed(1)}h/wk
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-sm font-bold text-foreground tabular-nums">
                  {fmtLKR(r.weekRevenue)}
                </p>
                <p className="text-[10px] text-muted-foreground tabular-nums">
                  {share.toFixed(0)}%
                </p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function BreakdownCard({
  title,
  icon,
  rows,
  weekTotal,
}: {
  title: string;
  icon: React.ReactNode;
  rows: Array<{ label: string; value: number }>;
  weekTotal: number;
}) {
  if (rows.length === 0) return null;
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="rounded-xl bg-card border border-border/60 p-3">
      <div className="flex items-center gap-1.5 mb-2">
        <span className="text-muted-foreground">{icon}</span>
        <h3 className="text-xs font-semibold text-foreground uppercase tracking-wider">
          {title}
        </h3>
      </div>
      <div className="space-y-1.5">
        {rows.map((r) => {
          const pct = (r.value / max) * 100;
          const share = weekTotal > 0 ? (r.value / weekTotal) * 100 : 0;
          return (
            <div key={r.label} className="text-xs">
              <div className="flex items-baseline justify-between mb-0.5">
                <span className="text-foreground truncate pr-2">{r.label}</span>
                <span className="text-muted-foreground tabular-nums shrink-0">
                  {fmtLKR(r.value)} <span className="opacity-70">· {share.toFixed(0)}%</span>
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
