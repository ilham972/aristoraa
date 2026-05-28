'use client';

// Students tab — attendance, at-risk watch list, this-week roster, and
// roster-health pills. The at-risk list is the most important: it surfaces
// students who are quietly drifting before they become drop-offs.

import { useMemo, useState } from 'react';
import { useQuery } from 'convex/react';
import {
  AlertTriangle,
  CalendarCheck,
  ShieldAlert,
  UserCheck,
  UserRoundX,
  Users,
} from 'lucide-react';
import { api } from '@/lib/convex';
import { fmtLKR } from '@/lib/groups/time-grid';
import { cn } from '@/lib/utils';
import { Card, Kpi, RangePicker } from './ui';

type Range = 7 | 30;

function thisMondayYmd(): string {
  const d = new Date();
  const js = d.getDay();
  d.setDate(d.getDate() + (js === 0 ? -6 : 1 - js));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function StudentsTab() {
  const [range, setRange] = useState<Range>(30);
  const insights = useQuery(api.sessionRecords.attendanceInsights, { days: range });
  const weekData = useQuery(api.sessionRecords.weekSessions, {
    weekStartDate: thisMondayYmd(),
  });
  const atRisk = useQuery(api.analytics.studentsAtRisk, {});
  const assignment = useQuery(api.groups.studentAssignmentSummary, {});

  const loading =
    insights === undefined ||
    weekData === undefined ||
    atRisk === undefined ||
    assignment === undefined;

  const sortedByAttendance = useMemo(() => {
    if (!insights) return [];
    return [...insights.byStudent].sort(
      (a, b) => a.attendancePct - b.attendancePct || a.name.localeCompare(b.name),
    );
  }, [insights]);

  if (loading) {
    return (
      <div className="animate-pulse space-y-3">
        <div className="grid grid-cols-2 gap-2">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-20 rounded-xl bg-muted/40" />
          ))}
        </div>
        <div className="h-40 rounded-xl bg-muted/30" />
        <div className="h-48 rounded-xl bg-muted/30" />
      </div>
    );
  }

  const totalPresent = insights.byStudent.reduce((s, r) => s + r.presentCount, 0);
  const totalAbsent = insights.byStudent.reduce((s, r) => s + r.absentCount, 0);
  const avgAttendance =
    totalPresent + totalAbsent === 0
      ? 0
      : Math.round((totalPresent / (totalPresent + totalAbsent)) * 100);

  const placedPct =
    assignment.totalCount === 0
      ? 0
      : Math.round((assignment.assignedCount / assignment.totalCount) * 100);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        <Kpi
          icon={<CalendarCheck className="w-3.5 h-3.5" />}
          label={`Attendance ${range}d`}
          value={`${avgAttendance}%`}
          sub={`${totalPresent} present · ${totalAbsent} absent`}
          tone={avgAttendance < 80 ? 'warn' : 'ok'}
        />
        <Kpi
          icon={<ShieldAlert className="w-3.5 h-3.5" />}
          label="At risk"
          value={`${atRisk.length}`}
          sub="<70% or 3+ absences (14d)"
          tone={atRisk.length > 0 ? 'warn' : 'ok'}
        />
        <Kpi
          icon={<UserCheck className="w-3.5 h-3.5" />}
          label="Active students"
          value={`${assignment.assignedCount}`}
          sub={`${placedPct}% of ${assignment.totalCount} placed`}
        />
        <Kpi
          icon={<UserRoundX className="w-3.5 h-3.5" />}
          label="Unassigned"
          value={`${assignment.unassigned.length}`}
          sub="not in any group"
          tone={assignment.unassigned.length > 0 ? 'warn' : 'ok'}
        />
      </div>

      {/* At-risk watch list */}
      <Card title="At risk" icon={<AlertTriangle className="w-3.5 h-3.5" />}>
        {atRisk.length === 0 ? (
          <p className="text-xs text-muted-foreground py-3 text-center">
            No students currently at risk.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {atRisk.map((s) => (
              <li
                key={s.studentId}
                className="rounded-lg border border-amber-500/40 bg-amber-500/5 px-2.5 py-2"
              >
                <div className="flex items-center justify-between mb-0.5">
                  <p className="text-sm font-semibold text-foreground truncate">{s.name}</p>
                  <p
                    className={cn(
                      'text-sm font-bold tabular-nums',
                      s.attendancePct < 50 ? 'text-destructive' : 'text-amber-600',
                    )}
                  >
                    {s.attendancePct}%
                  </p>
                </div>
                <p className="text-[10px] text-muted-foreground">
                  {s.present} present · {s.absent} absent (14d) · {s.groupNames.join(' · ') || 'no group'}
                </p>
                <p className="text-[10px] text-amber-700 dark:text-amber-400 mt-0.5">
                  {s.reason === 'both'
                    ? 'Low attendance + many absences'
                    : s.reason === 'low_attendance'
                      ? 'Attendance under 70%'
                      : '3+ absences in 14 days'}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* This week per-student (moved from old Attendance tab) */}
      <Card title="This week" icon={<CalendarCheck className="w-3.5 h-3.5" />}>
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

      {/* Per-student attendance leaderboard (worst first). */}
      <Card
        title="Attendance leaderboard"
        icon={<Users className="w-3.5 h-3.5" />}
        right={<RangePicker<Range> value={range} onChange={setRange} options={[7, 30]} />}
      >
        {sortedByAttendance.length === 0 ? (
          <p className="text-xs text-muted-foreground py-3 text-center">
            No attendance recorded yet.
          </p>
        ) : (
          <ul className="space-y-1">
            {sortedByAttendance.map((s) => (
              <li key={s.studentId} className="text-xs">
                <div className="flex items-baseline justify-between mb-0.5 gap-2">
                  <span className="text-foreground truncate">{s.name}</span>
                  <span className="text-muted-foreground tabular-nums shrink-0 text-[10px]">
                    {s.attendancePct}% · {s.presentCount}/{s.presentCount + s.absentCount}
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                  <div
                    className={cn(
                      'h-full',
                      s.attendancePct >= 90
                        ? 'bg-emerald-500'
                        : s.attendancePct >= 70
                          ? 'bg-amber-500'
                          : 'bg-destructive',
                    )}
                    style={{ width: `${s.attendancePct}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
