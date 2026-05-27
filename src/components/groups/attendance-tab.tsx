'use client';

// Attendance tab on /groups. The analytics sibling of the Revenue tab,
// focused on "did students show up?" and "who still owes me money?".
//
// Data:
//   • attendanceInsights({ days }) — all-time + range rollups by student
//     and by group; meta counters for held / cancelled / unlogged sessions.
//   • weekSessions({ weekStartDate }) — this-week per-student expected and
//     credit, freshest view of the running collection.
//
// Layout (top → bottom):
//   1. KPI strip — outstanding total, this-week expected, log compliance,
//      tutor cancellations
//   2. This-week per-student breakdown (expected vs collected vs credit)
//   3. "Who owes you" — sortable student list (most owed first)
//   4. By-group attendance + credit bars (pressable → opens group editor)
//   5. Cancellation footer — small line summary
//
// No charts library: every visual is a coloured progress bar so the tab
// stays light and on-brand with the rest of /groups.

import { useMemo, useState } from 'react';
import { useQuery } from 'convex/react';
import {
  AlertCircle,
  Award,
  Calendar,
  CheckCircle2,
  Coins,
  TrendingDown,
  Users,
  XCircle,
} from 'lucide-react';
import { api, type Id } from '@/lib/convex';
import { cn } from '@/lib/utils';
import { groupColor } from '@/lib/groups/color';
import { fmtLKR } from '@/lib/groups/time-grid';

type Range = 7 | 30;
type StudentSort = 'credit' | 'attendance' | 'name';

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function thisMondayYmd(): string {
  const d = new Date();
  const js = d.getDay();
  d.setDate(d.getDate() + (js === 0 ? -6 : 1 - js));
  return ymd(d);
}

export function AttendanceTab({
  onOpenGroup,
}: {
  onOpenGroup?: (groupId: Id<'groups'>) => void;
}) {
  const [range, setRange] = useState<Range>(30);
  const [studentSort, setStudentSort] = useState<StudentSort>('credit');

  const insights = useQuery(api.sessionRecords.attendanceInsights, { days: range });
  const weekData = useQuery(api.sessionRecords.weekSessions, {
    weekStartDate: thisMondayYmd(),
  });

  const loading = insights === undefined || weekData === undefined;

  const sortedStudents = useMemo(() => {
    if (!insights) return [];
    const list = [...insights.byStudent];
    if (studentSort === 'credit') {
      list.sort(
        (a, b) =>
          b.totalCredit - a.totalCredit ||
          b.rangeCredit - a.rangeCredit ||
          a.name.localeCompare(b.name),
      );
    } else if (studentSort === 'attendance') {
      list.sort((a, b) => a.attendancePct - b.attendancePct || a.name.localeCompare(b.name));
    } else {
      list.sort((a, b) => a.name.localeCompare(b.name));
    }
    return list;
  }, [insights, studentSort]);

  const totalOutstanding = useMemo(
    () => (insights?.byStudent ?? []).reduce((s, r) => s + r.totalCredit, 0),
    [insights],
  );
  const studentsOwing = useMemo(
    () => (insights?.byStudent ?? []).filter((r) => r.totalCredit > 0).length,
    [insights],
  );
  const thisWeekExpected = useMemo(
    () => (weekData?.perStudentWeek ?? []).reduce((s, r) => s + r.expected, 0),
    [weekData],
  );
  const thisWeekCollected = useMemo(
    () => (weekData?.perStudentWeek ?? []).reduce((s, r) => s + r.collected, 0),
    [weekData],
  );
  const thisWeekCredit = useMemo(
    () => (weekData?.perStudentWeek ?? []).reduce((s, r) => s + r.credit, 0),
    [weekData],
  );

  if (loading) {
    return (
      <div className="animate-pulse space-y-3">
        <div className="grid grid-cols-2 gap-2">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-20 rounded-xl bg-muted/40" />
          ))}
        </div>
        <div className="h-36 rounded-xl bg-muted/30" />
        <div className="h-48 rounded-xl bg-muted/30" />
        <div className="h-40 rounded-xl bg-muted/30" />
      </div>
    );
  }

  const empty =
    insights.meta.sessionsHeld === 0 &&
    insights.meta.sessionsCancelled === 0 &&
    insights.meta.sessionsUnlogged === 0 &&
    insights.byStudent.length === 0;

  if (empty) {
    return (
      <div className="rounded-xl border border-dashed border-border/60 py-10 text-center">
        <p className="text-sm text-muted-foreground mb-1">No attendance data yet.</p>
        <p className="text-xs text-muted-foreground">
          Log sessions from the Day view to populate this tab.
        </p>
      </div>
    );
  }

  const scheduled =
    insights.meta.sessionsHeld + insights.meta.sessionsCancelled + insights.meta.sessionsUnlogged;
  const logCompliancePct =
    scheduled === 0
      ? 100
      : Math.round(
          ((insights.meta.sessionsHeld + insights.meta.sessionsCancelled) / scheduled) * 100,
        );

  return (
    <div className="space-y-4">
      {/* ── KPI strip ───────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-2">
        <Kpi
          icon={<Coins className="w-3.5 h-3.5" />}
          label="Outstanding"
          value={fmtLKR(totalOutstanding)}
          sub={`${studentsOwing} student${studentsOwing !== 1 ? 's' : ''} owe you`}
          tone={totalOutstanding > 0 ? 'warn' : 'ok'}
        />
        <Kpi
          icon={<Calendar className="w-3.5 h-3.5" />}
          label="This week expected"
          value={fmtLKR(thisWeekExpected)}
          sub={`${fmtLKR(thisWeekCollected)} collected · ${fmtLKR(thisWeekCredit)} credit`}
          accent
        />
        <Kpi
          icon={<CheckCircle2 className="w-3.5 h-3.5" />}
          label={`Log compliance ${range}d`}
          value={`${logCompliancePct}%`}
          sub={`${insights.meta.sessionsUnlogged} unlogged · ${insights.meta.sessionsHeld} logged`}
          tone={logCompliancePct < 80 ? 'warn' : 'ok'}
        />
        <Kpi
          icon={<TrendingDown className="w-3.5 h-3.5" />}
          label={`Cancellations ${range}d`}
          value={`${insights.meta.sessionsCancelled} / ${insights.meta.studentAbsences}`}
          sub="by you / student absences"
        />
      </div>

      {/* ── This week per-student ───────────────────────────────────── */}
      <Card title="This week">
        {weekData.perStudentWeek.length === 0 ? (
          <p className="text-xs text-muted-foreground py-2 text-center">
            No sessions logged this week yet.
          </p>
        ) : (
          <div className="space-y-1">
            {weekData.perStudentWeek.map((row) => {
              const collectedPct =
                row.expected > 0 ? (row.collected / row.expected) * 100 : 0;
              return (
                <div key={row.studentId} className="text-xs">
                  <div className="flex items-baseline justify-between mb-0.5 gap-2">
                    <span className="text-foreground truncate">{row.name}</span>
                    <span className="text-muted-foreground tabular-nums shrink-0 text-[10px]">
                      {fmtLKR(row.collected)} / {fmtLKR(row.expected)}
                      {row.credit > 0 && (
                        <span className="ml-1 text-amber-600 font-semibold">
                          · {fmtLKR(row.credit)} owe
                        </span>
                      )}
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-muted overflow-hidden flex">
                    <div
                      className="h-full bg-emerald-500"
                      style={{ width: `${Math.min(collectedPct, 100)}%` }}
                    />
                    {row.credit > 0 && (
                      <div
                        className="h-full bg-amber-500/70"
                        style={{
                          width: `${Math.max(0, 100 - Math.min(collectedPct, 100))}%`,
                        }}
                      />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* ── Who owes you ────────────────────────────────────────────── */}
      <Card
        title="Who owes you"
        icon={<AlertCircle className="w-3.5 h-3.5" />}
        right={
          <SortPicker
            value={studentSort}
            onChange={setStudentSort}
            options={[
              { value: 'credit', label: 'Owed' },
              { value: 'attendance', label: 'Att%' },
              { value: 'name', label: 'A–Z' },
            ]}
          />
        }
      >
        {sortedStudents.length === 0 ? (
          <p className="text-xs text-muted-foreground py-2 text-center">No students yet.</p>
        ) : (
          <ul className="space-y-1.5">
            {sortedStudents.map((row) => (
              <StudentRow key={row.studentId} row={row} />
            ))}
          </ul>
        )}
      </Card>

      {/* ── By group ────────────────────────────────────────────────── */}
      <Card title="By group" icon={<Users className="w-3.5 h-3.5" />} right={<RangePicker value={range} onChange={setRange} />}>
        {insights.byGroup.length === 0 ? (
          <p className="text-xs text-muted-foreground py-2 text-center">No groups yet.</p>
        ) : (
          <ul className="space-y-1.5">
            {insights.byGroup.map((row) => (
              <GroupRow
                key={row.groupId}
                row={row}
                onOpen={onOpenGroup ? () => onOpenGroup(row.groupId) : undefined}
              />
            ))}
          </ul>
        )}
      </Card>

      {/* ── Cancellation footer ─────────────────────────────────────── */}
      <Card title="Leave summary" icon={<Award className="w-3.5 h-3.5" />}>
        <div className="space-y-1.5 text-xs">
          <Stat
            icon={<XCircle className="w-3.5 h-3.5 text-destructive" />}
            label="Sessions you cancelled"
            value={`${insights.meta.sessionsCancelled} in last ${range} days`}
          />
          <Stat
            icon={<TrendingDown className="w-3.5 h-3.5 text-amber-500" />}
            label="Student absences"
            value={`${insights.meta.studentAbsences} (vs ${insights.meta.studentPresences} attended)`}
          />
          <Stat
            icon={<AlertCircle className="w-3.5 h-3.5 text-destructive" />}
            label="Sessions still un-entered"
            value={`${insights.meta.sessionsUnlogged}`}
          />
        </div>
      </Card>
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
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
  tone?: 'warn' | 'ok';
}) {
  return (
    <div
      className={cn(
        'rounded-xl border px-3 py-2.5',
        accent
          ? 'bg-primary/10 border-primary/30'
          : tone === 'warn'
            ? 'bg-amber-500/5 border-amber-500/30'
            : 'bg-card border-border/60',
      )}
    >
      <div className="flex items-center gap-1.5 mb-1">
        <span
          className={cn(
            'inline-flex',
            accent
              ? 'text-primary'
              : tone === 'warn'
                ? 'text-amber-600'
                : 'text-muted-foreground',
          )}
        >
          {icon}
        </span>
        <p className="text-[10px] text-muted-foreground uppercase tracking-wider truncate">
          {label}
        </p>
      </div>
      <p
        className={cn(
          'text-base font-bold leading-tight tabular-nums',
          tone === 'warn' ? 'text-amber-600' : 'text-foreground',
        )}
      >
        {value}
      </p>
      {sub && <p className="text-[10px] text-muted-foreground mt-0.5 truncate">{sub}</p>}
    </div>
  );
}

function Card({
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
    <div className="rounded-xl bg-card border border-border/60 p-3">
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

function SortPicker<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div className="inline-flex items-center gap-1 p-0.5 bg-muted rounded-md">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'px-2 py-0.5 rounded text-[10px] font-medium',
            value === o.value ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Stat({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-2">
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div className="flex-1 min-w-0">
        <p className="text-muted-foreground text-[11px]">{label}</p>
        <p className="text-foreground tabular-nums font-medium">{value}</p>
      </div>
    </div>
  );
}

function StudentRow({
  row,
}: {
  row: {
    studentId: Id<'students'>;
    name: string;
    groupNames: string[];
    attendancePct: number;
    presentCount: number;
    absentCount: number;
    totalCredit: number;
    rangeCredit: number;
  };
}) {
  const hasCredit = row.totalCredit > 0;
  return (
    <li
      className={cn(
        'rounded-lg border px-2.5 py-2',
        hasCredit ? 'border-amber-500/30 bg-amber-500/5' : 'border-border/60 bg-card',
      )}
    >
      <div className="flex items-center justify-between gap-2 mb-1">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground truncate">{row.name}</p>
          <p className="text-[10px] text-muted-foreground truncate">
            {row.groupNames.length > 0 ? row.groupNames.join(' · ') : 'not in any group'}
          </p>
        </div>
        <div className="text-right shrink-0">
          {hasCredit ? (
            <p className="text-sm font-bold text-amber-600 tabular-nums">
              {fmtLKR(row.totalCredit)}
            </p>
          ) : (
            <p className="text-xs font-medium text-emerald-600 tabular-nums">Settled</p>
          )}
          <p className="text-[10px] text-muted-foreground tabular-nums">
            {row.attendancePct}% att · {row.presentCount}/{row.presentCount + row.absentCount}
          </p>
        </div>
      </div>
      {hasCredit && row.rangeCredit > 0 && row.rangeCredit < row.totalCredit && (
        <p className="text-[10px] text-muted-foreground">
          {fmtLKR(row.rangeCredit)} from recent sessions
        </p>
      )}
    </li>
  );
}

function GroupRow({
  row,
  onOpen,
}: {
  row: {
    groupId: Id<'groups'>;
    name: string;
    memberCount: number;
    sessionsHeld: number;
    sessionsCancelled: number;
    sessionsUnlogged: number;
    attendancePct: number;
    totalCredit: number;
  };
  onOpen?: () => void;
}) {
  const color = groupColor(row.groupId);
  const pct = row.attendancePct;
  const barColor =
    pct >= 90 ? 'bg-emerald-500' : pct >= 70 ? 'bg-amber-500' : 'bg-destructive';

  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        disabled={!onOpen}
        className="w-full rounded-lg border border-border/60 p-2.5 text-left transition-transform enabled:hover:bg-muted/30 enabled:active:scale-[0.99] disabled:cursor-default"
        style={{ borderColor: color.border }}
      >
        <div className="flex items-center gap-2.5 mb-1.5">
          <span
            className="w-1.5 h-8 rounded-full shrink-0"
            style={{ backgroundColor: color.solid }}
          />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-foreground truncate">{row.name}</p>
            <p className="text-[10px] text-muted-foreground">
              {row.memberCount} member{row.memberCount !== 1 ? 's' : ''} ·{' '}
              {row.sessionsHeld} held
              {row.sessionsCancelled > 0 && ` · ${row.sessionsCancelled} cancelled`}
              {row.sessionsUnlogged > 0 && (
                <span className="text-destructive">
                  {' '}
                  · {row.sessionsUnlogged} missing
                </span>
              )}
            </p>
          </div>
          <div className="text-right shrink-0">
            <p className="text-sm font-bold text-foreground tabular-nums">{pct}%</p>
            {row.totalCredit > 0 && (
              <p className="text-[10px] text-amber-600 tabular-nums">
                {fmtLKR(row.totalCredit)}
              </p>
            )}
          </div>
        </div>
        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
          <div
            className={cn('h-full rounded-full transition-all', barColor)}
            style={{ width: `${pct}%` }}
          />
        </div>
      </button>
    </li>
  );
}
