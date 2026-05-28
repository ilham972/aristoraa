'use client';

// Operations tab — Sessions + Capacity subviews. Sessions answers "is the
// business running?": log compliance, cancellation reasons, missing logs.
// Capacity answers "do I have room to grow?": per-group fill rate vs
// maxSize, headroom across all groups.

import { useState } from 'react';
import { useQuery } from 'convex/react';
import {
  Activity,
  AlertCircle,
  Building2,
  CalendarCheck,
  CheckCircle2,
  Layers,
  XCircle,
} from 'lucide-react';
import { api, type Id } from '@/lib/convex';
import { fmtLKR } from '@/lib/groups/time-grid';
import { cn } from '@/lib/utils';
import { Card, Kpi, RangePicker, StackBar, SubTabs } from './ui';

type OpsView = 'sessions' | 'capacity';
type Range = 7 | 30 | 90;

const REASON_LABELS: Record<string, string> = {
  sick: 'Sick',
  poya: 'Poya',
  festival: 'Festival',
  students_unavailable: 'Students away',
  personal: 'Personal',
  other: 'Other',
  unspecified: 'Unspecified',
};

const REASON_COLOR: Record<string, string> = {
  sick: 'bg-red-500',
  poya: 'bg-purple-500',
  festival: 'bg-amber-500',
  students_unavailable: 'bg-orange-500',
  personal: 'bg-blue-500',
  other: 'bg-gray-500',
  unspecified: 'bg-muted-foreground',
};

export function OperationsTab({
  onOpenGroup,
}: {
  onOpenGroup?: (groupId: Id<'groups'>) => void;
}) {
  const [view, setView] = useState<OpsView>('sessions');

  return (
    <div className="space-y-3">
      <SubTabs<OpsView>
        value={view}
        onChange={setView}
        options={[
          { value: 'sessions', label: 'Sessions', icon: <CalendarCheck className="w-3 h-3" /> },
          { value: 'capacity', label: 'Capacity', icon: <Building2 className="w-3 h-3" /> },
        ]}
      />
      {view === 'sessions' && <SessionsSubview />}
      {view === 'capacity' && <CapacitySubview onOpenGroup={onOpenGroup} />}
    </div>
  );
}

function SessionsSubview() {
  const [range, setRange] = useState<Range>(30);
  const breakdown = useQuery(api.analytics.cancellationBreakdown, { days: range });
  const pulse = useQuery(api.analytics.pulseSnapshot, {});

  if (breakdown === undefined || pulse === undefined || pulse === null) {
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

  const total = breakdown.total.count;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2">
        <Kpi
          icon={<CheckCircle2 className="w-3.5 h-3.5" />}
          label="Logged"
          value={`${pulse.compliance.held}`}
          sub={`${pulse.compliance.pct}% of scheduled`}
          tone={pulse.compliance.pct < 80 ? 'warn' : 'ok'}
        />
        <Kpi
          icon={<XCircle className="w-3.5 h-3.5" />}
          label="Cancelled"
          value={`${pulse.compliance.cancelled}`}
          sub={`${total === 0 ? 0 : Math.round((total / (pulse.compliance.scheduled || 1)) * 100)}% of scheduled`}
          tone={pulse.compliance.cancelled > 0 ? 'warn' : 'ok'}
        />
        <Kpi
          icon={<AlertCircle className="w-3.5 h-3.5" />}
          label="Unlogged"
          value={`${pulse.compliance.unlogged}`}
          sub="past sessions w/o log"
          tone={pulse.compliance.unlogged > 0 ? 'bad' : 'ok'}
        />
      </div>

      <Card
        title={`Cancellation reasons · ${range}d`}
        icon={<XCircle className="w-3.5 h-3.5" />}
        right={<RangePicker<Range> value={range} onChange={setRange} options={[7, 30, 90]} />}
      >
        {breakdown.rows.length === 0 ? (
          <p className="text-xs text-muted-foreground py-3 text-center">
            No cancellations in this window.
          </p>
        ) : (
          <div className="space-y-3">
            <div className="space-y-0.5">
              <p className="text-base font-bold text-foreground tabular-nums">
                {breakdown.total.count} session
                {breakdown.total.count === 1 ? '' : 's'} cancelled
              </p>
              <p className="text-[10px] text-amber-600 tabular-nums">
                {fmtLKR(breakdown.total.lostRevenue)} potential revenue lost
              </p>
            </div>
            <StackBar
              parts={breakdown.rows.map((r) => ({
                label: r.reason,
                value: r.lostRevenue,
                color: REASON_COLOR[r.reason] ?? 'bg-muted-foreground',
              }))}
            />
            <ul className="space-y-1.5 text-xs">
              {breakdown.rows.map((r) => {
                const pct =
                  breakdown.total.lostRevenue === 0
                    ? 0
                    : Math.round((r.lostRevenue / breakdown.total.lostRevenue) * 100);
                return (
                  <li key={r.reason} className="flex items-center gap-2">
                    <span
                      className={cn(
                        'w-2 h-2 rounded-full shrink-0',
                        REASON_COLOR[r.reason] ?? 'bg-muted-foreground',
                      )}
                    />
                    <span className="flex-1 truncate text-foreground">
                      {REASON_LABELS[r.reason] ?? r.reason}
                    </span>
                    <span className="text-muted-foreground tabular-nums text-[10px]">
                      {r.count} ·{' '}
                      <span className="text-amber-600 font-semibold">
                        {fmtLKR(r.lostRevenue)}
                      </span>{' '}
                      <span className="opacity-60">({pct}%)</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </Card>

      <Card title="Compliance" icon={<Activity className="w-3.5 h-3.5" />}>
        <div className="space-y-2">
          <StackBar
            parts={[
              { label: 'held', value: pulse.compliance.held, color: 'bg-emerald-500' },
              { label: 'cancelled', value: pulse.compliance.cancelled, color: 'bg-amber-500' },
              { label: 'unlogged', value: pulse.compliance.unlogged, color: 'bg-destructive/70' },
            ]}
            total={pulse.compliance.scheduled}
          />
          <p className="text-[10px] text-muted-foreground">
            {pulse.compliance.scheduled} scheduled past sessions in the last 30 days
          </p>
        </div>
      </Card>
    </div>
  );
}

function CapacitySubview({
  onOpenGroup,
}: {
  onOpenGroup?: (groupId: Id<'groups'>) => void;
}) {
  const cap = useQuery(api.analytics.capacityUtilization, {});

  if (cap === undefined) {
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

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2">
        <Kpi
          icon={<Layers className="w-3.5 h-3.5" />}
          label="Avg fill"
          value={`${cap.summary.avgFillPct}%`}
          sub="across capped groups"
        />
        <Kpi
          icon={<CheckCircle2 className="w-3.5 h-3.5" />}
          label="At capacity"
          value={`${cap.summary.atCapacity}`}
          sub="groups full"
          tone={cap.summary.atCapacity > 0 ? 'warn' : 'ok'}
        />
        <Kpi
          icon={<Building2 className="w-3.5 h-3.5" />}
          label="Headroom"
          value={`${cap.summary.headroom}`}
          sub="empty seats"
        />
      </div>

      <Card title="Fill rate by group" icon={<Layers className="w-3.5 h-3.5" />}>
        {cap.groups.length === 0 ? (
          <p className="text-xs text-muted-foreground py-3 text-center">No groups yet.</p>
        ) : (
          <ul className="space-y-1.5">
            {cap.groups.map((g) => (
              <li key={g.groupId}>
                <button
                  type="button"
                  onClick={onOpenGroup ? () => onOpenGroup(g.groupId) : undefined}
                  disabled={!onOpenGroup}
                  className="w-full rounded-lg border border-border/60 p-2.5 text-left enabled:hover:bg-muted/30 enabled:active:scale-[0.99] disabled:cursor-default"
                >
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-sm font-semibold text-foreground truncate">
                      {g.name}
                    </p>
                    <p className="text-xs font-bold text-foreground tabular-nums">
                      {g.fillPct == null
                        ? `${g.members}`
                        : `${g.members} / ${g.maxSize}`}{' '}
                      {g.fillPct != null && (
                        <span className="ml-1 text-[10px] text-muted-foreground">
                          {g.fillPct}%
                        </span>
                      )}
                    </p>
                  </div>
                  {g.fillPct != null ? (
                    <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                      <div
                        className={cn(
                          'h-full',
                          g.fillPct >= 100
                            ? 'bg-destructive'
                            : g.fillPct >= 80
                              ? 'bg-amber-500'
                              : 'bg-emerald-500',
                        )}
                        style={{ width: `${Math.min(g.fillPct, 100)}%` }}
                      />
                    </div>
                  ) : (
                    <p className="text-[10px] text-muted-foreground">
                      No max size set — capacity not tracked
                    </p>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
