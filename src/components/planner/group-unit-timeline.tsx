'use client';

// GroupUnitTimeline — the Lesson Builder's Timeline tab (2026-07-19).
// Replaces the Revision tab: one unit's questions laid on the calendar as
// week rows of mini day pills, so the founder SEES the spaced repetition —
// intro Monday (Main, teal), middle drill a few days later (Revision, amber,
// predicted), hard tail returning to a later Main day. Green dates are REAL
// (planned/taught group sheets); yellow dates are the SR prediction from
// lib/revisionSR.ts — the same brain the real queues serve, so the forecast
// matches what prints. Tap a day = its questions below, grouped by concept;
// every other day touching the same concepts gets a ring — the repetition
// pattern made visible.

import { useMemo, useState } from 'react';
import { CalendarClock, Flag, Hourglass } from 'lucide-react';
import { api, type Id } from '@/lib/convex';
import { cn } from '@/lib/utils';
import { useCachedQuery } from '@/hooks/use-cached-query';

type TimelineQuestion = {
  questionId: Id<'questionBank'>;
  label: string | null;
  difficulty: number;
  conceptId: string | null;
  conceptName: string | null;
  state: 'done' | 'planned' | 'revision' | 'banned' | 'unseen';
  date: string | null;
  predicted: boolean;
};

function weekStartYmd(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00`);
  const dow = d.getDay() === 0 ? 7 : d.getDay();
  d.setDate(d.getDate() - (dow - 1));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function addDaysYmd(ymd: string, n: number): string {
  const d = new Date(`${ymd}T00:00:00`);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function fmtDay(ymd: string): string {
  return new Date(`${ymd}T00:00:00`).toLocaleDateString('en-US', {
    day: 'numeric',
    month: 'short',
  });
}

const DOW_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const MAX_WEEKS = 20;

export function GroupUnitTimeline({
  groupId,
  unitId,
}: {
  groupId: Id<'groups'>;
  unitId: string;
}) {
  const data = useCachedQuery(api.learningEngine.groupPlan.groupUnitTimeline, {
    groupId,
    unitId,
  });
  const [selDate, setSelDate] = useState<string | null>(null);

  const ok = data && 'status' in data && data.status === 'ok';
  const questions: TimelineQuestion[] = useMemo(
    () => (ok ? (data.questions as TimelineQuestion[]) : []),
    [data, ok],
  );

  const byDate = useMemo(() => {
    const m = new Map<string, TimelineQuestion[]>();
    for (const q of questions) {
      if (!q.date) continue;
      const acc = m.get(q.date) ?? [];
      acc.push(q);
      m.set(q.date, acc);
    }
    return m;
  }, [questions]);

  const waiting = useMemo(
    () => questions.filter((q) => q.state === 'revision' && q.date === null),
    [questions],
  );

  // Concepts touched by the selected day → ring every other day that shares
  // one (the visible spaced-repetition trace).
  const echoDates = useMemo(() => {
    const out = new Set<string>();
    if (!selDate) return out;
    const cids = new Set(
      (byDate.get(selDate) ?? [])
        .map((q) => q.conceptId)
        .filter((c): c is string => c !== null),
    );
    if (cids.size === 0) return out;
    byDate.forEach((qs, date) => {
      if (date === selDate) return;
      if (qs.some((q) => q.conceptId !== null && cids.has(q.conceptId)))
        out.add(date);
    });
    return out;
  }, [selDate, byDate]);

  if (data === undefined) {
    return (
      <div className="space-y-2 animate-pulse p-3">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-10 bg-muted rounded-xl" />
        ))}
      </div>
    );
  }
  if (!ok) {
    return (
      <div className="p-4 text-center text-sm text-muted-foreground">
        Timeline unavailable (
        {(data as { status: string } | null)?.status ?? 'no data'}) — the
        group needs members, a track and sessions first.
      </div>
    );
  }

  const today = data.todayYmd as string;
  const examDate = data.examDate as string | null;
  const mainDows = new Set(data.mainDows as number[]);
  const revDows = new Set(data.revisionDows as number[]);

  // Weeks: from the earliest dated question (or today) through the latest
  // date / exam. Nothing dated at all → friendly empty state.
  const dates = Array.from(byDate.keys()).sort();
  if (dates.length === 0) {
    return (
      <div className="p-4 text-center text-sm text-muted-foreground">
        Nothing scheduled for this unit yet — press &ldquo;Run all term
        sheets&rdquo; on the Sheets tab to build the plan.
      </div>
    );
  }
  const firstWeek = weekStartYmd(dates[0] < today ? dates[0] : today);
  let lastYmd = dates[dates.length - 1];
  if (examDate && examDate > lastYmd) lastYmd = examDate;
  const weeks: string[] = [];
  for (
    let w = firstWeek;
    w <= weekStartYmd(lastYmd) && weeks.length < MAX_WEEKS;
    w = addDaysYmd(w, 7)
  )
    weeks.push(w);

  const selQs = selDate ? (byDate.get(selDate) ?? []) : [];
  const selByConcept = new Map<string, TimelineQuestion[]>();
  for (const q of selQs) {
    const k = q.conceptName ?? 'Other';
    const acc = selByConcept.get(k) ?? [];
    acc.push(q);
    selByConcept.set(k, acc);
  }

  return (
    <div className="px-3 py-3 space-y-3">
      {/* No revision capacity but yellow work exists — say it, don't hide it */}
      {revDows.size === 0 && waiting.length > 0 && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] text-foreground">
          <b className="text-amber-500">No revision days for this group.</b>{' '}
          Yellow questions can&rsquo;t be placed — add this group to a day on
          the home page&rsquo;s Revision tab first.
        </div>
      )}

      {/* Week rows */}
      <div className="space-y-1">
        <div className="grid grid-cols-[3.2rem_repeat(7,minmax(0,1fr))] gap-1 items-center">
          <span />
          {DOW_LETTERS.map((L, i) => (
            <span
              key={i}
              className="text-center text-[8.5px] text-muted-foreground"
            >
              {L}
            </span>
          ))}
        </div>
        {weeks.map((w) => (
          <div
            key={w}
            className="grid grid-cols-[3.2rem_repeat(7,minmax(0,1fr))] gap-1 items-center"
          >
            <span className="text-[8.5px] font-semibold text-muted-foreground truncate">
              {fmtDay(w)}
            </span>
            {DOW_LETTERS.map((_, i) => {
              const date = addDaysYmd(w, i);
              const dow = i + 1;
              const qs = byDate.get(date) ?? [];
              const isExam = examDate === date;
              const isToday = date === today;
              const past = date < today;
              const sel = selDate === date;
              const echo = echoDates.has(date);
              const mainCount = qs.filter(
                (q) => q.state === 'done' || q.state === 'planned',
              ).length;
              const revCount = qs.filter((q) => q.state === 'revision').length;
              if (qs.length === 0) {
                return (
                  <span
                    key={i}
                    className={cn(
                      'h-7 rounded-md border flex items-center justify-center',
                      isExam
                        ? 'border-rose-500/70 bg-rose-500/10'
                        : mainDows.has(dow) || revDows.has(dow)
                          ? 'border-dashed border-border/70'
                          : 'border-transparent',
                      isToday && 'ring-1 ring-primary/50',
                    )}
                  >
                    {isExam && <Flag className="w-3 h-3 text-rose-500" />}
                    {!isExam && revDows.has(dow) && (
                      <span className="w-1 h-1 rounded-full bg-amber-500/60" />
                    )}
                  </span>
                );
              }
              return (
                <button
                  key={i}
                  onClick={() => setSelDate(sel ? null : date)}
                  className={cn(
                    'h-7 rounded-md border text-[8.5px] font-bold flex items-center justify-center gap-0.5 tabular-nums',
                    revCount > 0 && mainCount === 0
                      ? 'border-dashed bg-amber-400/20 border-amber-400/70 text-amber-600 dark:text-amber-400'
                      : 'bg-teal-500/20 border-teal-500/60 text-teal-600 dark:text-teal-400',
                    past && !sel && 'opacity-55',
                    sel && 'ring-2 ring-primary ring-offset-1 ring-offset-background',
                    !sel && echo && 'ring-1 ring-primary/60',
                    isExam && 'border-rose-500/70',
                    isToday && !sel && 'ring-1 ring-primary/50',
                  )}
                >
                  {mainCount > 0 && <span>{mainCount}</span>}
                  {revCount > 0 && (
                    <span
                      className={cn(
                        mainCount > 0 &&
                          'text-amber-600 dark:text-amber-400',
                      )}
                    >
                      {mainCount > 0 ? `+${revCount}` : revCount}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
        {examDate && (
          <div className="flex items-center gap-1.5 pt-0.5 text-[9px] font-semibold text-rose-500">
            <Flag className="w-3 h-3" /> exam · {fmtDay(examDate)}
          </div>
        )}
      </div>

      {/* Selected day detail */}
      {selDate && (
        <div className="rounded-xl border border-border bg-card px-3 py-2.5">
          <div className="flex items-center gap-2 mb-1.5">
            <CalendarClock className="w-3.5 h-3.5 text-primary shrink-0" />
            <span className="text-[11px] font-bold text-foreground">
              {fmtDay(selDate)}
            </span>
            <span className="text-[9px] text-muted-foreground">
              ringed days share these concepts — that&rsquo;s the repetition
            </span>
          </div>
          {Array.from(selByConcept.entries()).map(([cname, qs]) => (
            <div key={cname} className="mb-1.5 last:mb-0">
              <div className="text-[9px] font-semibold text-muted-foreground mb-0.5 truncate">
                {cname}
              </div>
              <div className="flex flex-wrap gap-1">
                {qs.map((q, qi) => (
                  <span
                    key={q.questionId as unknown as string}
                    title={
                      q.state === 'revision'
                        ? 'Revision (predicted)'
                        : q.state === 'done'
                          ? 'Taught in Main'
                          : 'Planned in Main'
                    }
                    className={cn(
                      'px-1.5 py-0.5 rounded-md border text-[9px] font-semibold tabular-nums',
                      q.state === 'revision'
                        ? 'border-dashed bg-amber-400/15 border-amber-400/70 text-amber-600 dark:text-amber-400'
                        : q.state === 'done'
                          ? 'bg-teal-500/25 border-teal-500/60 text-teal-700 dark:text-teal-300'
                          : 'bg-teal-500/10 border-teal-500/50 text-teal-600 dark:text-teal-400',
                    )}
                  >
                    {q.label ?? `#${qi + 1}`}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Yellow questions with no day yet */}
      {waiting.length > 0 && revDows.size > 0 && (
        <div className="rounded-xl border border-border bg-card px-3 py-2.5">
          <div className="flex items-center gap-1.5 mb-1">
            <Hourglass className="w-3 h-3 text-amber-500" />
            <span className="text-[10px] font-bold text-foreground">
              Waiting ({waiting.length})
            </span>
            <span className="text-[8.5px] text-muted-foreground">
              intro not scheduled yet, or revision days ran out
            </span>
          </div>
          <div className="flex flex-wrap gap-1">
            {waiting.map((q, qi) => (
              <span
                key={q.questionId as unknown as string}
                className="px-1.5 py-0.5 rounded-md border border-dashed border-amber-400/50 text-[9px] font-semibold text-amber-600/80 dark:text-amber-400/80 tabular-nums"
              >
                {q.label ?? `#${qi + 1}`}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[8.5px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded bg-teal-500/25 border border-teal-500/60" />
          Main (real dates)
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded bg-amber-400/20 border border-dashed border-amber-400/70" />
          Revision (predicted, {data.minGapDays}d+ after intro)
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded border border-dashed border-border" />
          free session day
        </span>
        <span className="flex items-center gap-1">
          <Flag className="w-2.5 h-2.5 text-rose-500" />
          exam
        </span>
      </div>
    </div>
  );
}
