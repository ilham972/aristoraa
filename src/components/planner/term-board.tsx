'use client';

// TermBoard — the Planner's home tab. Pick a grade → see that grade's term
// at a glance: exam countdown, every group's lesson-plan state (runway,
// verdicts, crystallized window) and one-tap crystallize per group or for
// the whole grade. "See + steer": nothing new is stored here — the board
// reads the same derived plan the groups run on, and the steering levers
// are the ones that already exist (crystallize, tracks, exam dates,
// Main/Revision slots).

import { useMemo, useState } from 'react';
import { useMutation } from 'convex/react';
import { CalendarDays, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/convex';
import { cn } from '@/lib/utils';
import { useCachedQuery } from '@/hooks/use-cached-query';
import { GroupPlanCard, type PlannerGroupRow } from './group-plan-card';

const GRADES = [6, 7, 8, 9, 10, 11];

function todayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function daysUntil(ymd: string): number {
  return Math.round(
    (Date.parse(`${ymd}T00:00:00.000Z`) - Date.parse(`${todayYmd()}T00:00:00.000Z`)) /
      86_400_000,
  );
}

export function TermBoard({
  grade,
  setGrade,
}: {
  grade: number;
  setGrade: (g: number) => void;
}) {
  const groups = useCachedQuery(api.learningEngine.plannerBoard.plannerGroups, {});
  const exams = useCachedQuery(api.learningEngine.calendar.list, {});
  const crystallize = useMutation(api.learningEngine.groupPlan.crystallizeUpcoming);
  const [busyAll, setBusyAll] = useState(false);

  const gradeGroups = useMemo(
    () =>
      (groups ?? [])
        .filter((g: PlannerGroupRow) => g.grade === grade)
        .sort((a: PlannerGroupRow, b: PlannerGroupRow) => a.name.localeCompare(b.name)),
    [groups, grade],
  );

  // Next upcoming exam per term for this grade.
  const upcomingExams = useMemo(() => {
    const t = todayYmd();
    const byTerm = new Map<number, string>();
    for (const r of exams ?? []) {
      if (r.grade !== grade || r.examDate < t) continue;
      const cur = byTerm.get(r.term);
      if (cur === undefined || r.examDate < cur) byTerm.set(r.term, r.examDate);
    }
    return Array.from(byTerm.entries())
      .map(([term, date]) => ({ term, date, days: daysUntil(date) }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [exams, grade]);

  const countByGrade = useMemo(() => {
    const m = new Map<number, number>();
    for (const g of groups ?? []) {
      if (g.grade !== null) m.set(g.grade, (m.get(g.grade) ?? 0) + 1);
    }
    return m;
  }, [groups]);

  return (
    <>
      {/* Grade chips */}
      <div className="flex gap-1 p-1 bg-muted rounded-xl overflow-x-auto mb-3">
        {GRADES.map((g) => (
          <button
            key={g}
            onClick={() => setGrade(g)}
            className={cn(
              'flex-1 py-2 px-3 rounded-lg text-xs font-semibold transition-all whitespace-nowrap',
              g === grade
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            G{g}
            {(countByGrade.get(g) ?? 0) > 0 && (
              <span className="ml-1 text-[9px] text-muted-foreground">
                {countByGrade.get(g)}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Exam countdown */}
      <div className="mb-3 rounded-xl border border-border bg-card px-3 py-2.5">
        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
          <CalendarDays className="w-3 h-3" />
          Grade {grade} exams ahead
        </div>
        {exams === undefined && <div className="h-5 bg-muted rounded animate-pulse" />}
        {exams !== undefined && upcomingExams.length === 0 && (
          <div className="text-[11px] text-muted-foreground">
            No upcoming exam dates for grade {grade} — add them on the Exams tab so
            the plan has a deadline to aim at.
          </div>
        )}
        <div className="flex flex-wrap gap-1.5">
          {upcomingExams.map((e) => (
            <span
              key={e.term}
              className={cn(
                'px-2 py-1 rounded-lg border text-[11px] font-semibold',
                e.days <= 21
                  ? 'border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400'
                  : 'border-border bg-muted/40 text-foreground',
              )}
            >
              Term {e.term} · {e.date} · in {e.days}d
            </span>
          ))}
        </div>
      </div>

      {/* Crystallize the whole grade */}
      {gradeGroups.length > 1 && (
        <button
          onClick={async () => {
            setBusyAll(true);
            let written = 0;
            let failed = 0;
            for (const g of gradeGroups) {
              try {
                const res = await crystallize({ groupId: g.groupId });
                if (res.status === 'ok') written += res.written;
                else failed += 1;
              } catch {
                failed += 1;
              }
            }
            setBusyAll(false);
            if (written > 0)
              toast.success(
                `Grade ${grade}: ${written} session sheet${written === 1 ? '' : 's'} crystallized${failed > 0 ? ` (${failed} group${failed === 1 ? '' : 's'} skipped)` : ''}`,
              );
            else if (failed > 0)
              toast.error(`Nothing written — ${failed} group${failed === 1 ? '' : 's'} not ready (tracks/sessions missing?)`);
            else toast.info('Every group is already planned ahead.');
          }}
          disabled={busyAll}
          className="w-full mb-3 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-semibold disabled:opacity-50"
        >
          <Sparkles className="w-3.5 h-3.5" />
          {busyAll ? 'Crystallizing…' : `Crystallize all G${grade} groups`}
        </button>
      )}

      {/* Group cards */}
      {groups === undefined && (
        <div className="space-y-2 animate-pulse">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-28 bg-muted rounded-xl" />
          ))}
        </div>
      )}
      {groups !== undefined && gradeGroups.length === 0 && (
        <div className="rounded-xl border border-border bg-card p-4 text-center text-sm text-muted-foreground">
          No grade-{grade} groups on the timetable yet.
        </div>
      )}
      <div className="space-y-2.5">
        {gradeGroups.map((g: PlannerGroupRow) => (
          <GroupPlanCard key={g.groupId as unknown as string} row={g} />
        ))}
      </div>
    </>
  );
}
