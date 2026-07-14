'use client';

// CoverageForecast — the runway advisor (2026-07-14).
// Per track unit: how much of the book pool this student has SEEN, and an
// honest projection of where he'll be on exam day at his observed sheet
// pace. Companion to coverage mode (the engine serves unseen questions
// easy→hard); useful with the mode off too — it's simply the truth about
// book coverage vs the calendar. Backend: coverageForecastForStudent;
// pure math in convex/lib/coverageForecastCore.ts.

import { useMemo } from 'react';
import { BookOpenCheck } from 'lucide-react';
import { useCachedQuery } from '@/hooks/use-cached-query';
import { api } from '@/lib/convex';
import { cn } from '@/lib/utils';
import { ALL_CURRICULUM_UNITS } from '@/lib/track-progress-args';
import type { StudentLite } from '@/lib/sheets/scope';

const VERDICT_META: Record<
  string,
  { label: string; className: string; showProjected: boolean }
> = {
  done: {
    label: 'done',
    className: 'bg-primary/15 text-primary border-primary/40',
    showProjected: false,
  },
  'on-track': {
    label: 'on track',
    className: 'bg-emerald-500/15 text-emerald-500 border-emerald-500/40',
    showProjected: false,
  },
  'at-risk': {
    label: 'at risk',
    className: 'bg-amber-500/15 text-amber-500 border-amber-500/40',
    showProjected: true,
  },
  'wont-finish': {
    label: "won't finish",
    className: 'bg-red-500/15 text-red-500 border-red-500/40',
    showProjected: true,
  },
  'no-exam': {
    label: 'no exam date',
    className: 'bg-muted/40 text-muted-foreground border-border',
    showProjected: false,
  },
  'no-questions': {
    label: 'no questions cropped',
    className: 'bg-muted/40 text-amber-500 border-amber-500/30',
    showProjected: false,
  },
};

function fmtInDays(days: number): string {
  const d = new Date(Date.now() + days * 86_400_000);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function CoverageForecast({ student }: { student: StudentLite }) {
  const args = useMemo(
    () => ({ studentId: student._id, units: ALL_CURRICULUM_UNITS }),
    [student],
  );
  const data = useCachedQuery(
    api.learningEngine.coverageForecast.coverageForecastForStudent,
    args,
  );

  if (data === undefined) {
    return <div className="h-24 bg-muted rounded-xl animate-pulse mt-4" />;
  }
  if (data === null || data.status === 'no-track') return null;

  const { summary } = data;

  return (
    <div className="mt-4">
      <div className="flex items-center gap-2 mb-2">
        <BookOpenCheck className="w-4 h-4 text-primary" />
        <h2 className="text-sm font-bold text-foreground">Coverage forecast</h2>
      </div>

      {/* Pace summary */}
      <div className="rounded-xl border border-border bg-card px-3 py-2.5 mb-2">
        {summary.hasPace ? (
          <>
            <div className="text-[11px] text-foreground">
              Pace: <b>{summary.sheetsPerWeek!.toFixed(1)}</b> sheets/week ·{' '}
              <b>{summary.questionsPerSheet!.toFixed(0)}</b> q/sheet ≈{' '}
              <b>{summary.questionsPerDay!.toFixed(1)}</b> questions/day
            </div>
            {(() => {
              // Required vs actual pace — the plan-first framing: what the
              // exam demands per day, next to what is actually happening.
              const examDays = data.units
                .filter((u) => u.daysToExam !== null && u.remaining > 0)
                .map((u) => u.daysToExam!);
              const nearest = examDays.length > 0 ? Math.min(...examDays) : null;
              const required =
                nearest !== null && nearest > 0
                  ? summary.datedRemaining / nearest
                  : null;
              return (
                <div className="text-[10px] text-foreground mt-0.5">
                  <b>{summary.datedRemaining}</b> questions due before upcoming exams
                  {nearest !== null && <> · nearest exam in {nearest}d ({fmtInDays(nearest)})</>}
                  {required !== null && (
                    <>
                      {' '}→ needs <b>{required.toFixed(1)} Qs/day</b> (doing{' '}
                      {summary.questionsPerDay!.toFixed(1)} now)
                    </>
                  )}
                </div>
              );
            })()}
            <div className="text-[10px] text-muted-foreground mt-0.5">
              {summary.totalRemaining} left on the whole track
              {summary.daysToFinishAll !== null && <> (~{summary.daysToFinishAll}d)</>}
              {' '}— past terms&apos; leftovers are revision material, not a deadline
            </div>
          </>
        ) : (
          <div className="text-[11px] text-amber-500">
            No sheets in the last {data.paceWindowDays} days — generate sheets
            to get a pace, until then nothing can finish.
          </div>
        )}
      </div>

      {/* Unit rows in track order */}
      <div className="space-y-1.5">
        {data.units.map((u) => {
          const meta = VERDICT_META[u.verdict] ?? VERDICT_META['no-exam'];
          const pct = Math.round(u.coveredPct * 100);
          return (
            <div
              key={u.unitId}
              className="rounded-xl border border-border/60 bg-card px-3 py-2"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0 text-[11px] font-semibold text-foreground truncate">
                  {u.unitName}
                </div>
                <span
                  className={cn(
                    'shrink-0 px-1.5 py-0.5 rounded-md border text-[9px] font-bold',
                    meta.className,
                  )}
                >
                  {meta.label}
                  {meta.showProjected && u.projectedPct !== null && (
                    <> → {Math.round(u.projectedPct * 100)}%</>
                  )}
                </span>
              </div>
              <div className="mt-1.5 h-1.5 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <div className="mt-1 flex items-center justify-between text-[10px] text-muted-foreground">
                <span>
                  {u.seenQuestions}/{u.totalQuestions} seen
                  {u.remaining > 0 && <> · {u.remaining} left</>}
                </span>
                {u.daysToExam !== null && (
                  <span className="tabular-nums">exam in {u.daysToExam}d</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-2 text-[9px] text-muted-foreground">
        &ldquo;Seen&rdquo; = the question appeared on any of this
        student&rsquo;s sheets. Projection assumes the current pace, shared
        across unfinished units by how much each has left.
      </div>
    </div>
  );
}
