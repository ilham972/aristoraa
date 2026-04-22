'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from 'convex/react';
import { ChevronLeft, BarChart3 } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { api } from '@/lib/convex';
import { CURRICULUM_MODULES } from '@/lib/curriculum-data';
import { MODULE_COLORS } from '@/lib/types';

const DAYS_TO_SHOW = 14;

function formatDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function shiftDate(date: string, days: number): string {
  const d = new Date(date + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return formatDate(d);
}

function dateLabel(date: string): { num: string; weekday: string } {
  const d = new Date(date + 'T00:00:00');
  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return { num: String(d.getDate()), weekday: weekdays[d.getDay()] };
}

export default function CompareTimelinePage() {
  const router = useRouter();
  const [grade, setGrade] = useState<number>(8);
  const [moduleId, setModuleId] = useState<string>('M1');

  const today = formatDate(new Date());
  const startDate = shiftDate(today, -(DAYS_TO_SHOW - 1));

  const dateColumns = useMemo(() => {
    const cols: string[] = [];
    for (let i = 0; i < DAYS_TO_SHOW; i++) cols.push(shiftDate(startDate, i));
    return cols;
  }, [startDate]);

  const data = useQuery(api.timeline.compare, {
    grade,
    moduleId,
    startDate,
    endDate: today,
  });

  const maxCorrect = useMemo(() => {
    if (!data) return 1;
    let m = 1;
    for (const r of data.rows) {
      for (const c of Object.values(r.countsByDate)) if (c.correct > m) m = c.correct;
    }
    return m;
  }, [data]);

  const moduleColor = MODULE_COLORS[moduleId];

  return (
    <div className="px-4 pt-5 pb-20 max-w-2xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-2 mb-3">
        <button
          onClick={() => router.back()}
          className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center hover:bg-muted/70 transition-all"
          aria-label="Go back"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-bold text-foreground leading-tight flex items-center gap-1.5">
            <BarChart3 className="w-4 h-4" /> Compare students
          </h1>
          <p className="text-[11px] text-muted-foreground">Parallel timelines · Last {DAYS_TO_SHOW} days</p>
        </div>
      </div>

      {/* Filters */}
      <div className="grid grid-cols-2 gap-2 mb-4">
        <div>
          <label className="text-[10px] uppercase tracking-wide text-muted-foreground font-bold block mb-1">Grade</label>
          <Select value={String(grade)} onValueChange={(v) => v && setGrade(Number(v))}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {[6, 7, 8, 9, 10, 11].map((g) => (
                <SelectItem key={g} value={String(g)}>Grade {g}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wide text-muted-foreground font-bold block mb-1">Module</label>
          <Select value={moduleId} onValueChange={(v) => v && setModuleId(v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {CURRICULUM_MODULES.map((m) => (
                <SelectItem key={m.id} value={m.id}>{m.id} · {m.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {!data ? (
        <div className="animate-pulse space-y-2">
          <div className="h-14 bg-muted rounded-xl" />
          <div className="h-14 bg-muted rounded-xl" />
          <div className="h-14 bg-muted rounded-xl" />
        </div>
      ) : data.rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border/60 bg-muted/30 px-4 py-8 text-center">
          <p className="text-sm text-muted-foreground">No students at Grade {grade}.</p>
        </div>
      ) : (
        <div className="rounded-2xl border border-border/60 bg-card p-2 overflow-x-auto">
          {/* Date header row */}
          <div className="flex gap-0.5 pb-1.5 pl-[120px] sticky top-0 bg-card z-10">
            {dateColumns.map((d) => {
              const lbl = dateLabel(d);
              const isToday = d === today;
              return (
                <div
                  key={d}
                  className={`w-7 shrink-0 flex flex-col items-center ${isToday ? 'text-primary font-bold' : 'text-muted-foreground'}`}
                >
                  <span className="text-[8px] uppercase leading-none">{lbl.weekday}</span>
                  <span className="text-[10px] font-semibold leading-none mt-0.5">{lbl.num}</span>
                </div>
              );
            })}
          </div>

          {/* Student rows */}
          <div className="space-y-1">
            {data.rows.map((r) => (
              <button
                key={r.student._id}
                onClick={() => router.push(`/timeline/student/${r.student._id}`)}
                className="w-full flex items-center gap-1 rounded-lg hover:bg-muted/30 active:bg-muted/50 transition-all py-1 pl-2 pr-1 text-left"
              >
                {/* Student label — fixed width so columns align */}
                <div className="w-[108px] shrink-0 min-w-0">
                  <p className="text-xs font-semibold truncate">{r.student.name}</p>
                  <p className="text-[9px] text-muted-foreground tabular-nums">
                    {r.totalCorrect} correct · {r.totalExercises} ex
                  </p>
                </div>
                {/* Bar cells */}
                <div className="flex gap-0.5">
                  {dateColumns.map((d) => {
                    const cell = r.countsByDate[d];
                    const intensity = cell ? Math.min(1, cell.correct / maxCorrect) : 0;
                    return (
                      <div
                        key={d}
                        className="w-7 h-8 shrink-0 rounded bg-muted/40 relative overflow-hidden"
                        title={cell ? `${d}: ${cell.correct} correct, ${cell.wrong} wrong` : d}
                      >
                        {cell && (
                          <div
                            className="absolute bottom-0 left-0 right-0 transition-all"
                            style={{
                              height: `${intensity * 100}%`,
                              backgroundColor: moduleColor,
                              opacity: 0.85,
                            }}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      <p className="mt-3 text-[11px] text-muted-foreground text-center">
        Bar height = correct answers that day. Tap a row to open that student’s timeline.
      </p>
    </div>
  );
}
