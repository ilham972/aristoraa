'use client';

// /planner — the global planning home (2026-07-15). One nav button for the
// two things the founder called the heart of the engine: the lesson plan
// and sheet generation readiness. Four tabs:
//   Term     — pick a grade → exam countdown + every group's runway +
//              crystallize (per group or whole grade). "See + steer".
//   Forecast — global coverage forecast: every student of the grade,
//              will-they-finish verdicts, worst first.
//   Tracks   — track management (moved from Insights; it's a planning input).
//   Exams    — exam calendar (moved from Insights; every verdict counts
//              down to these dates).
// Insights (/algorithm) keeps the inspection tools: Coverage, Blueprint, Path.

import { Suspense, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  BookOpenCheck,
  CalendarDays,
  CalendarRange,
  Route,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { TracksTab } from '@/components/algorithm/tracks-tab';
import { ExamCalendarTab } from '@/components/algorithm/exam-calendar-tab';
import { TermBoard } from '@/components/planner/term-board';
import { GradeForecast } from '@/components/planner/grade-forecast';

type TabId = 'term' | 'forecast' | 'tracks' | 'exams';

const TABS: { id: TabId; label: string; fullLabel: string; icon: typeof Route }[] = [
  { id: 'term', label: 'Term', fullLabel: 'Term Planner', icon: CalendarRange },
  { id: 'forecast', label: 'Forecast', fullLabel: 'Coverage Forecast', icon: BookOpenCheck },
  { id: 'tracks', label: 'Tracks', fullLabel: 'Learning Tracks', icon: Route },
  { id: 'exams', label: 'Exams', fullLabel: 'Exam Calendar', icon: CalendarDays },
];

const GRADES = [6, 7, 8, 9, 10, 11];

function PlannerPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const rawTab = searchParams.get('tab') ?? 'term';
  const tab: TabId = (['term', 'forecast', 'tracks', 'exams'] as TabId[]).includes(
    rawTab as TabId,
  )
    ? (rawTab as TabId)
    : 'term';

  const gradeParam = parseInt(searchParams.get('g') ?? '10', 10);
  const grade = GRADES.includes(gradeParam) ? gradeParam : 10;

  const setParams = useCallback(
    (next: { tab?: TabId; g?: number }) => {
      const p = new URLSearchParams(searchParams.toString());
      if (next.tab) p.set('tab', next.tab);
      if (next.g !== undefined) p.set('g', String(next.g));
      router.replace(`/planner?${p.toString()}`, { scroll: false });
    },
    [router, searchParams],
  );

  const currentTab = TABS.find((t) => t.id === tab)!;
  const TabIcon = currentTab.icon;

  return (
    <div className="px-4 pt-5 pb-24 max-w-lg mx-auto">
      <div className="flex items-center gap-2 mb-1">
        <TabIcon className="w-5 h-5 text-primary" />
        <h1 className="text-lg font-bold text-foreground">{currentTab.fullLabel}</h1>
      </div>
      {tab === 'term' && (
        <p className="text-[11px] text-muted-foreground mb-3">
          The whole term per grade: what each group teaches next, whether it
          beats the exam, and the locked-in sheets. Delegation to every group
          happens automatically — steer with tracks, exam dates and crystallize.
        </p>
      )}

      {/* Tab switcher */}
      <div className="flex gap-1 p-1 bg-muted rounded-xl mb-3">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setParams({ tab: t.id })}
            className={cn(
              'flex-1 py-2 px-2 rounded-lg text-xs font-semibold transition-all whitespace-nowrap',
              t.id === tab
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Forecast shares the Term tab's grade selection */}
      {tab === 'forecast' && (
        <div className="flex gap-1 p-1 bg-muted rounded-xl overflow-x-auto mb-3">
          {GRADES.map((g) => (
            <button
              key={g}
              onClick={() => setParams({ g })}
              className={cn(
                'flex-1 py-2 px-3 rounded-lg text-xs font-semibold transition-all whitespace-nowrap',
                g === grade
                  ? 'bg-card text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              G{g}
            </button>
          ))}
        </div>
      )}

      {tab === 'term' && <TermBoard grade={grade} setGrade={(g) => setParams({ g })} />}
      {tab === 'forecast' && <GradeForecast grade={grade} />}
      {tab === 'tracks' && <TracksTab />}
      {tab === 'exams' && <ExamCalendarTab />}
    </div>
  );
}

export default function PlannerPage() {
  return (
    <Suspense
      fallback={
        <div className="px-4 pt-5 pb-24 max-w-lg mx-auto">
          <div className="space-y-2 animate-pulse">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-12 bg-muted rounded-xl" />
            ))}
          </div>
        </div>
      }
    >
      <PlannerPageInner />
    </Suspense>
  );
}
