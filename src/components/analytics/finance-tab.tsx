'use client';

// Finance tab — Revenue + Credit subviews. Revenue wraps the existing
// RevenueTab content (no behavioural change) plus a new "Lost revenue"
// breakdown chip showing what slipped to cancellations / absences /
// unlogged. Credit replaces the "who owes you" list with a fuller aged-
// receivables view (0–7d / 8–30d / 30+d buckets) + the per-student list.

import { useState } from 'react';
import { useQuery } from 'convex/react';
import { AlertCircle, BarChart3, BookOpen, Clock, Coins, Wallet, XCircle } from 'lucide-react';
import { api, type Id } from '@/lib/convex';
import { fmtLKR } from '@/lib/groups/time-grid';
import { cn } from '@/lib/utils';
import { Card, Kpi, RangePicker, StackBar, SubTabs } from './ui';
import { RevenueTab } from '@/components/groups/revenue-tab';

type FinanceView = 'revenue' | 'credit';
type Range = 7 | 30 | 90;

export function FinanceTab({
  onOpenGroup,
}: {
  onOpenGroup?: (groupId: Id<'groups'>) => void;
}) {
  const [view, setView] = useState<FinanceView>('revenue');

  return (
    <div className="space-y-3">
      <SubTabs<FinanceView>
        value={view}
        onChange={setView}
        options={[
          { value: 'revenue', label: 'Revenue', icon: <Wallet className="w-3 h-3" /> },
          { value: 'credit', label: 'Credit · AR', icon: <Coins className="w-3 h-3" /> },
        ]}
      />

      {view === 'revenue' && <RevenueSubview onOpenGroup={onOpenGroup} />}
      {view === 'credit' && <CreditSubview />}
    </div>
  );
}

function RevenueSubview({
  onOpenGroup,
}: {
  onOpenGroup?: (groupId: Id<'groups'>) => void;
}) {
  const [range, setRange] = useState<Range>(30);
  const lost = useQuery(api.analytics.lostRevenue, { days: range });
  const paper = useQuery(api.paperClasses.paperRevenueRange, { days: range });

  return (
    <div className="space-y-4">
      {/* Lost-revenue strip — new in Phase G */}
      <Card
        title={`Lost revenue · ${range}d`}
        icon={<XCircle className="w-3.5 h-3.5" />}
        right={<RangePicker<Range> value={range} onChange={setRange} options={[7, 30, 90]} />}
      >
        {lost === undefined ? (
          <div className="h-24 rounded-lg bg-muted/30 animate-pulse" />
        ) : (
          <LostRevenueBreakdown lost={lost} />
        )}
      </Card>

      {/* Paper-class (Library) revenue — flat 100/student/day, kept separate
          from the personal-class (250/hr) figures below. */}
      <Card title={`Paper classes · ${range}d`} icon={<BookOpen className="w-3.5 h-3.5" />}>
        {paper === undefined ? (
          <div className="h-16 rounded-lg bg-muted/30 animate-pulse" />
        ) : paper.studentDays === 0 ? (
          <p className="text-xs text-muted-foreground py-3 text-center">
            No paper-class attendance recorded in this period.
          </p>
        ) : (
          <div className="flex items-end justify-between">
            <div>
              <p className="text-base font-bold text-foreground tabular-nums">{fmtLKR(paper.total)}</p>
              <p className="text-[10px] text-muted-foreground">
                {paper.studentDays} student-day{paper.studentDays === 1 ? '' : 's'} · flat 100/day
              </p>
            </div>
            <p className="text-[10px] text-muted-foreground text-right max-w-[45%]">
              Separate from personal-class revenue below.
            </p>
          </div>
        )}
      </Card>

      {/* Existing revenue tab — unchanged */}
      <RevenueTab onOpenGroup={onOpenGroup} />
    </div>
  );
}

function LostRevenueBreakdown({
  lost,
}: {
  lost: {
    cancelled: { count: number; amount: number };
    absent: { count: number; amount: number };
    unlogged: { count: number; amount: number };
  };
}) {
  const total = lost.cancelled.amount + lost.absent.amount + lost.unlogged.amount;
  if (total === 0) {
    return (
      <p className="text-xs text-muted-foreground py-3 text-center">
        Nothing slipped — every scheduled session is logged and attended.
      </p>
    );
  }
  return (
    <div className="space-y-3">
      <div>
        <p className="text-base font-bold text-amber-600 tabular-nums">
          {fmtLKR(total)}
        </p>
        <p className="text-[10px] text-muted-foreground">
          potential revenue not realized
        </p>
      </div>
      <StackBar
        parts={[
          { label: 'cancelled', value: lost.cancelled.amount, color: 'bg-amber-500' },
          { label: 'absent', value: lost.absent.amount, color: 'bg-destructive/70' },
          { label: 'unlogged', value: lost.unlogged.amount, color: 'bg-muted-foreground/50' },
        ]}
      />
      <ul className="space-y-1 text-xs">
        <li className="flex items-center justify-between">
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-amber-500" />
            You cancelled
          </span>
          <span className="tabular-nums text-muted-foreground">
            {fmtLKR(lost.cancelled.amount)}{' '}
            <span className="opacity-60">({lost.cancelled.count})</span>
          </span>
        </li>
        <li className="flex items-center justify-between">
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-destructive/70" />
            Student absences
          </span>
          <span className="tabular-nums text-muted-foreground">
            {fmtLKR(lost.absent.amount)}{' '}
            <span className="opacity-60">({lost.absent.count})</span>
          </span>
        </li>
        <li className="flex items-center justify-between">
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-muted-foreground/50" />
            Unlogged sessions
          </span>
          <span className="tabular-nums text-muted-foreground">
            {fmtLKR(lost.unlogged.amount)}{' '}
            <span className="opacity-60">({lost.unlogged.count})</span>
          </span>
        </li>
      </ul>
    </div>
  );
}

function CreditSubview() {
  const aging = useQuery(api.analytics.creditAging, {});

  if (aging === undefined) {
    return (
      <div className="animate-pulse space-y-3">
        <div className="grid grid-cols-3 gap-2">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-20 rounded-xl bg-muted/40" />
          ))}
        </div>
        <div className="h-40 rounded-xl bg-muted/30" />
      </div>
    );
  }

  const total = aging.totals.fresh + aging.totals.mid + aging.totals.old;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2">
        <Kpi
          icon={<Clock className="w-3.5 h-3.5" />}
          label="0–7 days"
          value={fmtLKR(aging.totals.fresh)}
          sub="fresh"
          tone={aging.totals.fresh > 0 ? 'ok' : 'ok'}
        />
        <Kpi
          icon={<Clock className="w-3.5 h-3.5" />}
          label="8–30 days"
          value={fmtLKR(aging.totals.mid)}
          sub="aging"
          tone={aging.totals.mid > 0 ? 'warn' : 'ok'}
        />
        <Kpi
          icon={<AlertCircle className="w-3.5 h-3.5" />}
          label="30+ days"
          value={fmtLKR(aging.totals.old)}
          sub="overdue"
          tone={aging.totals.old > 0 ? 'bad' : 'ok'}
        />
      </div>

      <Card title="Aged receivables" icon={<BarChart3 className="w-3.5 h-3.5" />}>
        {total === 0 ? (
          <p className="text-xs text-muted-foreground py-3 text-center">
            Every student is settled — nothing outstanding.
          </p>
        ) : (
          <>
            <StackBar
              parts={[
                { label: '0–7d', value: aging.totals.fresh, color: 'bg-emerald-500' },
                { label: '8–30d', value: aging.totals.mid, color: 'bg-amber-500' },
                { label: '30+d', value: aging.totals.old, color: 'bg-destructive' },
              ]}
            />
            <p className="text-[10px] text-muted-foreground mt-1">
              Total outstanding {fmtLKR(total)}
            </p>
          </>
        )}
      </Card>

      <Card title="Who owes you" icon={<Coins className="w-3.5 h-3.5" />}>
        {aging.rows.length === 0 ? (
          <p className="text-xs text-muted-foreground py-3 text-center">
            No outstanding balances.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {aging.rows.map((row) => (
              <li
                key={row.studentId}
                className={cn(
                  'rounded-lg border px-2.5 py-2 flex items-center justify-between gap-2',
                  row.bucket === 'old'
                    ? 'bg-destructive/5 border-destructive/30'
                    : row.bucket === 'mid'
                      ? 'bg-amber-500/5 border-amber-500/30'
                      : 'bg-card border-border/60',
                )}
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-foreground truncate">{row.name}</p>
                  <p className="text-[10px] text-muted-foreground">
                    Oldest unpaid {row.oldestUnpaidYmd ?? '?'} · {row.ageDays}d old
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p
                    className={cn(
                      'text-sm font-bold tabular-nums',
                      row.bucket === 'old'
                        ? 'text-destructive'
                        : row.bucket === 'mid'
                          ? 'text-amber-600'
                          : 'text-foreground',
                    )}
                  >
                    {fmtLKR(row.credit)}
                  </p>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    {row.bucket === 'old' ? '30+d' : row.bucket === 'mid' ? '8–30d' : '0–7d'}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
