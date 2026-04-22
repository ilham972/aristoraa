'use client';

import { useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useQuery } from 'convex/react';
import { ChevronLeft, Video, BookOpen, Calendar as CalendarIcon, BarChart3 } from 'lucide-react';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { Badge } from '@/components/ui/badge';
import { api } from '@/lib/convex';
import type { Id } from '@/lib/convex';
import { CURRICULUM_MODULES, getModuleById } from '@/lib/curriculum-data';
import { MODULE_COLORS } from '@/lib/types';

// Last N days shown by default on the strip
const DAYS_TO_SHOW = 30;

function formatDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function shiftDate(date: string, days: number): string {
  const d = new Date(date + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return formatDate(d);
}

function dateLabel(date: string): { day: string; num: string; weekday: string } {
  const d = new Date(date + 'T00:00:00');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return {
    day: months[d.getMonth()],
    num: String(d.getDate()),
    weekday: weekdays[d.getDay()],
  };
}

export default function StudentTimelinePage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const studentId = params?.id as Id<'students'> | undefined;

  const [moduleFilter, setModuleFilter] = useState<string>('all');
  const [drawerDate, setDrawerDate] = useState<string | null>(null);

  const today = formatDate(new Date());
  const startDate = shiftDate(today, -(DAYS_TO_SHOW - 1));

  const student = useQuery(api.students.get, studentId ? { id: studentId } : 'skip');
  const timeline = useQuery(
    api.timeline.byStudent,
    studentId
      ? { studentId, startDate, endDate: today, moduleId: moduleFilter === 'all' ? undefined : moduleFilter }
      : 'skip'
  );
  const allExercises = useQuery(api.exercises.list);

  // Build date columns
  const dateColumns = useMemo(() => {
    const cols: string[] = [];
    for (let i = 0; i < DAYS_TO_SHOW; i++) cols.push(shiftDate(startDate, i));
    return cols;
  }, [startDate]);

  const byDate = useMemo(() => {
    const map: Record<string, { correct: number; wrong: number; exerciseCount: number; moduleIds: Set<string>; entryIds: string[] }> = {};
    if (!timeline) return map;
    for (const e of timeline.entries) {
      const row = map[e.date] ?? { correct: 0, wrong: 0, exerciseCount: 0, moduleIds: new Set<string>(), entryIds: [] };
      row.correct += e.correctCount;
      row.wrong += Math.max(0, e.totalAttempted - e.correctCount);
      row.exerciseCount += 1;
      row.moduleIds.add(e.moduleId);
      row.entryIds.push(e._id);
      map[e.date] = row;
    }
    return map;
  }, [timeline]);

  const conceptsWatchedByDate = useMemo(() => {
    const map: Record<string, number> = {};
    if (!timeline) return map;
    for (const a of timeline.assignments) {
      if (a.type === 'concept' && a.completedAt) {
        map[a.date] = (map[a.date] ?? 0) + 1;
      }
    }
    return map;
  }, [timeline]);

  const maxCorrect = useMemo(() => {
    let m = 1;
    for (const d of Object.values(byDate)) if (d.correct > m) m = d.correct;
    return m;
  }, [byDate]);

  const totals = useMemo(() => {
    let correct = 0, wrong = 0, exercises = 0, concepts = 0;
    for (const d of Object.values(byDate)) {
      correct += d.correct; wrong += d.wrong; exercises += d.exerciseCount;
    }
    for (const n of Object.values(conceptsWatchedByDate)) concepts += n;
    return { correct, wrong, exercises, concepts };
  }, [byDate, conceptsWatchedByDate]);

  if (!student || !timeline) {
    return (
      <div className="px-4 pt-5 pb-20 max-w-lg mx-auto">
        <div className="animate-pulse space-y-3">
          <div className="h-10 bg-muted rounded-xl" />
          <div className="h-24 bg-muted rounded-2xl" />
          <div className="h-48 bg-muted rounded-2xl" />
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 pt-5 pb-20 max-w-2xl mx-auto">
      {/* Back + header */}
      <div className="flex items-center gap-2 mb-3">
        <button
          onClick={() => router.back()}
          className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center hover:bg-muted/70 transition-all"
          aria-label="Go back"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-bold text-foreground leading-tight truncate">{student.name}</h1>
          <p className="text-[11px] text-muted-foreground">
            Grade {student.schoolGrade} · Last {DAYS_TO_SHOW} days
          </p>
        </div>
        <Link
          href="/timeline/compare"
          className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center hover:bg-muted/70 transition-all"
          aria-label="Compare students"
          title="Compare students"
        >
          <BarChart3 className="w-4 h-4" />
        </Link>
      </div>

      {/* Totals strip */}
      <div className="grid grid-cols-4 gap-2 mb-4">
        <StatCard label="Correct" value={totals.correct} tone="emerald" />
        <StatCard label="Wrong" value={totals.wrong} tone="red" />
        <StatCard label="Exercises" value={totals.exercises} tone="primary" />
        <StatCard label="Concepts" value={totals.concepts} tone="sky" />
      </div>

      {/* Module filter pills */}
      <div className="flex items-center gap-1.5 overflow-x-auto -mx-4 px-4 pb-1 mb-3">
        <FilterPill active={moduleFilter === 'all'} label="All" onClick={() => setModuleFilter('all')} />
        {CURRICULUM_MODULES.map((m) => (
          <FilterPill
            key={m.id}
            active={moduleFilter === m.id}
            label={m.id}
            onClick={() => setModuleFilter(m.id)}
            color={MODULE_COLORS[m.id]}
          />
        ))}
      </div>

      {/* Horizontal date strip */}
      <div className="rounded-2xl border border-border/60 bg-card p-2">
        <div className="flex gap-1 overflow-x-auto pb-1 snap-x">
          {dateColumns.map((d) => {
            const row = byDate[d];
            const concepts = conceptsWatchedByDate[d] ?? 0;
            const hasActivity = !!row || concepts > 0;
            const intensity = row ? Math.min(1, row.correct / maxCorrect) : 0;
            const label = dateLabel(d);
            const isToday = d === today;
            return (
              <button
                key={d}
                onClick={() => hasActivity && setDrawerDate(d)}
                disabled={!hasActivity}
                className={`snap-start shrink-0 w-14 rounded-xl border transition-all ${
                  hasActivity
                    ? 'border-primary/30 bg-primary/5 hover:bg-primary/10 active:scale-95'
                    : 'border-border/40 bg-muted/20 cursor-default'
                } ${isToday ? 'ring-2 ring-primary/60' : ''} flex flex-col items-center py-2 gap-1`}
              >
                <span className="text-[9px] uppercase tracking-wide text-muted-foreground font-semibold">{label.weekday}</span>
                <span className="text-[10px] text-muted-foreground">{label.day}</span>
                <span className="text-base font-bold tabular-nums leading-none">{label.num}</span>
                {/* Correct bar */}
                <div className="w-8 h-1.5 rounded-full bg-emerald-500/10 overflow-hidden mt-1">
                  <div
                    className="h-full bg-emerald-500 transition-all"
                    style={{ width: `${intensity * 100}%` }}
                  />
                </div>
                <div className="flex items-center gap-0.5 min-h-[14px]">
                  {row && row.correct > 0 && (
                    <span className="text-[10px] font-bold text-emerald-600 tabular-nums">{row.correct}</span>
                  )}
                  {concepts > 0 && (
                    <Video className="w-2.5 h-2.5 text-sky-500" />
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Day detail drawer */}
      <Drawer open={!!drawerDate} onOpenChange={(o) => { if (!o) setDrawerDate(null); }}>
        <DrawerContent className="max-h-[80vh]">
          <DrawerHeader>
            <DrawerTitle className="flex items-center gap-2">
              <CalendarIcon className="w-4 h-4" />
              {drawerDate && new Date(drawerDate + 'T00:00:00').toLocaleDateString(undefined, {
                weekday: 'long', month: 'short', day: 'numeric', year: 'numeric',
              })}
            </DrawerTitle>
          </DrawerHeader>
          {drawerDate && (
            <div className="px-4 pb-6 overflow-y-auto space-y-2">
              {timeline.entries
                .filter((e) => e.date === drawerDate)
                .map((e) => {
                  const ex = allExercises?.find((x) => x._id === e.exerciseId);
                  const mod = getModuleById(e.moduleId);
                  const color = MODULE_COLORS[e.moduleId];
                  return (
                    <div key={e._id} className="rounded-xl border border-border/60 bg-card p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <Badge
                              className="text-[9px] px-1.5 py-0 h-4 border-transparent rounded-full"
                              style={color ? { backgroundColor: `${color}26`, color } : undefined}
                            >
                              {e.moduleId}
                            </Badge>
                            <span className="text-[11px] text-muted-foreground truncate">
                              {mod?.name ?? ''}
                            </span>
                          </div>
                          <p className="text-sm font-semibold truncate mt-0.5">
                            {ex?.name ?? 'Exercise'}
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-sm font-bold text-emerald-600 tabular-nums">
                            {e.correctCount}
                            <span className="text-muted-foreground font-normal text-[11px]">/{e.totalAttempted}</span>
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              {timeline.assignments
                .filter((a) => a.date === drawerDate && a.type === 'concept' && a.completedAt)
                .map((a) => {
                  const ex = allExercises?.find((x) => x._id === a.exerciseId);
                  return (
                    <div key={a._id} className="rounded-xl border border-sky-500/40 bg-sky-500/5 p-3 flex items-center gap-2">
                      <Video className="w-4 h-4 text-sky-500 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="text-[10px] uppercase tracking-wide text-sky-600 dark:text-sky-400 font-bold">Concept watched</p>
                        <p className="text-sm font-semibold truncate">{ex?.name ?? 'Concept'}</p>
                      </div>
                    </div>
                  );
                })}
            </div>
          )}
        </DrawerContent>
      </Drawer>
    </div>
  );
}

function StatCard({ label, value, tone }: { label: string; value: number; tone: 'emerald' | 'red' | 'primary' | 'sky' }) {
  const tones: Record<typeof tone, string> = {
    emerald: 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/8',
    red: 'text-red-600 dark:text-red-400 bg-red-500/8',
    primary: 'text-primary bg-primary/8',
    sky: 'text-sky-600 dark:text-sky-400 bg-sky-500/8',
  };
  return (
    <div className={`rounded-xl p-2.5 ${tones[tone]}`}>
      <p className="text-[10px] uppercase tracking-wide font-semibold opacity-80">{label}</p>
      <p className="text-lg font-bold tabular-nums leading-none mt-0.5">{value}</p>
    </div>
  );
}

function FilterPill({ active, label, onClick, color }: { active: boolean; label: string; onClick: () => void; color?: string }) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 h-7 px-3 rounded-full text-xs font-semibold transition-all ${
        active
          ? 'text-white shadow-sm'
          : 'bg-muted text-muted-foreground hover:bg-muted/70'
      }`}
      style={active && color ? { backgroundColor: color } : active ? undefined : undefined}
    >
      {label}
    </button>
  );
}
