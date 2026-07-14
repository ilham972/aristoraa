'use client';

// GradeForecast — the GLOBAL coverage forecast (Planner tab). The same
// honest runway math as the per-student advisor on /students/[id]/progress,
// rolled up for one grade: every student's book coverage + exam-day
// projection, worst first, expandable to the per-unit breakdown inline.
// Backend: plannerBoard.gradeForecastRollup (one pool walk per track).

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { BookOpenCheck, ChevronDown, ChevronRight } from 'lucide-react';
import { api } from '@/lib/convex';
import { cn } from '@/lib/utils';
import { useCachedQuery } from '@/hooks/use-cached-query';
import { ALL_CURRICULUM_UNITS } from '@/lib/track-progress-args';
import { VERDICT_CHIP } from './verdict';

type UnitRow = {
  unitId: string;
  unitName: string;
  term: number | null;
  totalQuestions: number;
  seenQuestions: number;
  remaining: number;
  coveredPct: number;
  projectedPct: number | null;
  daysToExam: number | null;
  verdict: string;
};

type StudentRow = {
  studentId: string;
  name: string;
  trackName: string | null;
  status: 'ok' | 'no-track';
  units: UnitRow[];
  summary: {
    sheetsPerWeek: number | null;
    questionsPerSheet: number | null;
    totalRemaining: number;
    daysToFinishAll: number | null;
    hasPace: boolean;
  } | null;
};

// One overall verdict per student: the worst unit verdict that has a real
// exam deadline. No recent sheets at all → "no pace" beats everything (the
// projection is meaningless without it).
function studentVerdict(s: StudentRow): string {
  if (s.status !== 'ok') return 'no-track';
  if (s.summary && !s.summary.hasPace && s.summary.totalRemaining > 0) return 'no-pace';
  const dated = s.units.filter((u) => u.totalQuestions > 0 && u.daysToExam !== null);
  if (dated.some((u) => u.verdict === 'wont-finish')) return 'wont-finish';
  if (dated.some((u) => u.verdict === 'at-risk')) return 'at-risk';
  if (dated.length > 0) return 'on-track';
  return 'no-exam';
}

const VERDICT_ORDER: Record<string, number> = {
  'wont-finish': 0,
  'no-pace': 1,
  'at-risk': 2,
  'no-track': 3,
  'no-exam': 4,
  'on-track': 5,
};

const EXTRA_CHIP: Record<string, { label: string; className: string }> = {
  'no-pace': {
    label: 'no recent sheets',
    className: 'bg-red-500/15 text-red-500 border-red-500/40',
  },
  'no-track': {
    label: 'no track',
    className: 'bg-amber-500/15 text-amber-500 border-amber-500/40',
  },
};

function chipFor(verdict: string) {
  return EXTRA_CHIP[verdict] ?? VERDICT_CHIP[verdict] ?? VERDICT_CHIP['no-exam'];
}

export function GradeForecast({ grade }: { grade: number }) {
  const data = useCachedQuery(api.learningEngine.plannerBoard.gradeForecastRollup, {
    grade,
    units: ALL_CURRICULUM_UNITS,
  });
  const [openId, setOpenId] = useState<string | null>(null);

  const students = useMemo(() => {
    if (!data || data.status !== 'ok') return [];
    return [...(data.students as StudentRow[])].sort((a, b) => {
      const av = VERDICT_ORDER[studentVerdict(a)] ?? 9;
      const bv = VERDICT_ORDER[studentVerdict(b)] ?? 9;
      return av - bv || a.name.localeCompare(b.name);
    });
  }, [data]);

  const tallies = useMemo(() => {
    const t = new Map<string, number>();
    for (const s of students) {
      const v = studentVerdict(s);
      t.set(v, (t.get(v) ?? 0) + 1);
    }
    return t;
  }, [students]);

  if (data === undefined) {
    return (
      <div className="space-y-2 animate-pulse">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-14 bg-muted rounded-xl" />
        ))}
      </div>
    );
  }
  if (data === null || data.status !== 'ok' || students.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card p-4 text-center text-sm text-muted-foreground">
        No grade-{grade} students yet.
      </div>
    );
  }

  return (
    <>
      <p className="text-[11px] text-muted-foreground mb-3">
        Will each student finish the book before exam day, at their real
        observed pace? Same math as the advisor on the student progress page —
        worst first. Tap a student for the per-unit breakdown.
      </p>

      {/* Verdict tallies */}
      <div className="flex flex-wrap gap-1.5 mb-3">
        {['wont-finish', 'no-pace', 'at-risk', 'no-track', 'on-track'].map((v) => {
          const n = tallies.get(v) ?? 0;
          if (n === 0) return null;
          const chip = chipFor(v);
          return (
            <span
              key={v}
              className={cn('px-2 py-1 rounded-lg border text-[11px] font-semibold', chip.className)}
            >
              {n} {chip.label}
            </span>
          );
        })}
      </div>

      <div className="space-y-1.5">
        {students.map((s) => {
          const v = studentVerdict(s);
          const chip = chipFor(v);
          const pooled = s.units.filter((u) => u.totalQuestions > 0);
          const total = pooled.reduce((sum, u) => sum + u.totalQuestions, 0);
          const seen = pooled.reduce((sum, u) => sum + u.seenQuestions, 0);
          const coveredPct = total > 0 ? seen / total : 0;
          const isOpen = openId === s.studentId;
          const problemUnits = s.units.filter(
            (u) => u.verdict === 'wont-finish' || u.verdict === 'at-risk',
          );
          return (
            <div key={s.studentId} className="rounded-xl border border-border bg-card overflow-hidden">
              <button
                onClick={() => setOpenId(isOpen ? null : s.studentId)}
                className="w-full px-3 py-2 flex items-center gap-2 text-left hover:bg-muted/40"
              >
                {isOpen ? (
                  <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                ) : (
                  <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-semibold text-foreground truncate">{s.name}</div>
                  <div className="flex items-center gap-2 mt-1">
                    <div className="h-1.5 flex-1 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{ width: `${Math.round(coveredPct * 100)}%` }}
                      />
                    </div>
                    <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
                      {Math.round(coveredPct * 100)}% seen
                    </span>
                  </div>
                </div>
                <span
                  className={cn(
                    'shrink-0 px-1.5 py-0.5 rounded-md border text-[9px] font-semibold',
                    chip.className,
                  )}
                >
                  {chip.label}
                </span>
              </button>
              {isOpen && (
                <div className="border-t border-border px-3 py-2">
                  {s.status === 'no-track' && (
                    <div className="text-[11px] text-muted-foreground">
                      Assign a track on the{' '}
                      <Link href={`/students/${s.studentId}/progress`} className="text-primary underline">
                        student page
                      </Link>{' '}
                      to get a forecast.
                    </div>
                  )}
                  {s.status === 'ok' && (
                    <>
                      <div className="text-[10px] text-muted-foreground mb-1.5">
                        {s.trackName}
                        {s.summary?.hasPace && s.summary.sheetsPerWeek !== null && (
                          <>
                            {' '}· {s.summary.sheetsPerWeek.toFixed(1)} sheets/wk ·{' '}
                            {s.summary.totalRemaining} Qs left
                            {s.summary.daysToFinishAll !== null && (
                              <> · all done in ~{s.summary.daysToFinishAll}d</>
                            )}
                          </>
                        )}
                        {s.summary && !s.summary.hasPace && (
                          <> · no sheets in the last 2 weeks — generate sheets to get a pace</>
                        )}
                      </div>
                      {(problemUnits.length > 0 ? problemUnits : pooled.filter((u) => u.remaining > 0).slice(0, 6)).map((u) => {
                        const uChip = chipFor(u.verdict);
                        return (
                          <div key={u.unitId} className="flex items-center gap-2 py-1">
                            <div className="min-w-0 flex-1">
                              <div className="text-[11px] text-foreground truncate">{u.unitName}</div>
                              <div className="text-[9.5px] text-muted-foreground">
                                {u.seenQuestions}/{u.totalQuestions} seen
                                {u.projectedPct !== null && u.verdict !== 'done' && (
                                  <> · projected {Math.round(u.projectedPct * 100)}%</>
                                )}
                                {u.daysToExam !== null && <> · exam in {u.daysToExam}d</>}
                              </div>
                            </div>
                            <span
                              className={cn(
                                'shrink-0 px-1.5 py-0.5 rounded-md border text-[9px] font-semibold',
                                uChip.className,
                              )}
                            >
                              {uChip.label}
                            </span>
                          </div>
                        );
                      })}
                      <Link
                        href={`/students/${s.studentId}/progress`}
                        className="inline-flex items-center gap-1 mt-1 text-[10px] text-primary hover:underline"
                      >
                        <BookOpenCheck className="w-3 h-3" />
                        Full progress page
                      </Link>
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
