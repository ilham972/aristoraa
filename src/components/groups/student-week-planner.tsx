'use client';

// Phase-2 per-student planner. Pick a student and see their WHOLE week on one
// grid — personal classes, paper blocks they're in, outside busy times, and
// (the actionable bit) paper blocks they could still JOIN, tappable to add
// them on the spot. The picker is sorted lightest-load-first so underloaded
// students ("who can I pull into the Library") rise to the top.

import { useMemo, useState } from 'react';
import { useMutation } from 'convex/react';
import { useCachedQuery as useQuery } from '@/hooks/use-cached-query';
import { toast } from 'sonner';
import { ArrowLeft, BookOpen, Plus, Search } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { api, type Id } from '@/lib/convex';
import { cn } from '@/lib/utils';
import { DAYS, WEEKEND_BANDS, type HourBand } from '@/lib/groups/time-grid';

const rOverlap = (aS: string, aE: string, bS: string, bE: string) => aS < bE && aE > bS;

export function StudentWeekPlanner({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [studentId, setStudentId] = useState<Id<'students'> | null>(null);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { setStudentId(null); onClose(); } }}>
      <DialogContent className="max-w-md p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-4 pt-4 pb-2 border-b border-border/40">
          <DialogTitle className="text-sm font-semibold flex items-center gap-2">
            {studentId && (
              <button onClick={() => setStudentId(null)} className="text-muted-foreground hover:text-foreground" title="Back to list">
                <ArrowLeft className="w-4 h-4" />
              </button>
            )}
            <BookOpen className="w-4 h-4 text-primary" />
            {studentId ? 'Student week' : 'Plan a student'}
          </DialogTitle>
        </DialogHeader>

        <div className="max-h-[80vh] overflow-y-auto">
          {studentId === null ? (
            <StudentPicker onPick={setStudentId} />
          ) : (
            <StudentWeek studentId={studentId} />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function StudentPicker({ onPick }: { onPick: (id: Id<'students'>) => void }) {
  const load = useQuery(api.paperClasses.studentsLoad);
  const [q, setQ] = useState('');

  const filtered = useMemo(() => {
    const list = load ?? [];
    if (!q.trim()) return list;
    const needle = q.trim().toLowerCase();
    return list.filter((s) => s.name.toLowerCase().includes(needle));
  }, [load, q]);

  return (
    <div className="px-4 py-3">
      <p className="text-[11px] text-muted-foreground mb-2">
        Sorted by weekly hours — lightest first, so the students who need more time are on top.
      </p>
      <div className="relative mb-2">
        <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search students…" className="h-8 pl-7 text-xs" />
      </div>
      {load === undefined ? (
        <p className="text-[11px] text-muted-foreground py-4 text-center">Loading…</p>
      ) : filtered.length === 0 ? (
        <p className="text-[11px] text-muted-foreground py-4 text-center">No students.</p>
      ) : (
        <ul className="space-y-1">
          {filtered.map((s) => (
            <li key={s.studentId}>
              <button
                onClick={() => onPick(s.studentId)}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-muted/60 transition-colors text-left"
              >
                <span className="text-xs flex-1 truncate text-foreground">{s.name}</span>
                <span className="text-[10px] text-muted-foreground">G{s.schoolGrade}</span>
                <span
                  className={cn(
                    'text-[10px] tabular-nums px-1.5 py-0.5 rounded-full font-medium',
                    s.totalHours === 0
                      ? 'bg-destructive/15 text-destructive'
                      : s.totalHours < 4
                        ? 'bg-amber-500/15 text-amber-600'
                        : 'bg-muted text-muted-foreground',
                  )}
                  title={`${s.personalHours}h personal + ${s.paperHours}h paper`}
                >
                  {s.totalHours}h
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

type WeekData = {
  name: string;
  schoolGrade: number;
  personal: Array<{ dayOfWeek: number; startTime: string; endTime: string; groupName: string }>;
  paperIn: Array<{ blockId: Id<'paperBlocks'>; dayOfWeek: number; startTime: string; endTime: string; roomName: string }>;
  busy: Array<{ dayOfWeek: number; startTime: string; endTime: string; label?: string }>;
  joinable: Array<{ blockId: Id<'paperBlocks'>; dayOfWeek: number; startTime: string; endTime: string; roomName: string; memberCount: number; capacity?: number; full: boolean }>;
  personalHours: number;
  paperHours: number;
};

function StudentWeek({ studentId }: { studentId: Id<'students'> }) {
  const data = useQuery(api.paperClasses.studentWeek, { studentId }) as WeekData | null | undefined;
  const addStudent = useMutation(api.paperClasses.addStudent);

  if (data === undefined) {
    return <div className="px-4 py-8 text-center text-xs text-muted-foreground animate-pulse">Loading…</div>;
  }
  if (data === null) {
    return <div className="px-4 py-8 text-center text-xs text-muted-foreground">Student not found.</div>;
  }

  const join = async (blockId: Id<'paperBlocks'>, full: boolean) => {
    if (full && !confirm('That room is at capacity. Add anyway?')) return;
    try {
      await addStudent({ blockId, studentId });
      toast.success('Added to paper block');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not add');
    }
  };

  return (
    <div>
      <div className="px-4 py-2 flex items-center gap-2 border-b border-border/40">
        <span className="text-sm font-semibold text-foreground">{data.name}</span>
        <span className="text-[10px] text-muted-foreground">G{data.schoolGrade}</span>
        <span className="ml-auto flex items-center gap-1 text-[10px]">
          <span className="px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-medium tabular-nums">
            {data.personalHours}h personal
          </span>
          <span className="px-1.5 py-0.5 rounded-full bg-sky-500/15 text-sky-600 font-medium tabular-nums">
            {data.paperHours}h paper
          </span>
        </span>
      </div>

      {/* Legend */}
      <div className="px-4 py-1.5 flex items-center gap-3 text-[9px] text-muted-foreground border-b border-border/40">
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-primary/30" /> Personal</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-sky-500/40" /> Paper</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-muted-foreground/30" /> Busy</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm border border-dashed border-primary/60" /> Can join</span>
      </div>

      <WeekGridView data={data} onJoin={join} />
    </div>
  );
}

function WeekGridView({ data, onJoin }: { data: WeekData; onJoin: (blockId: Id<'paperBlocks'>, full: boolean) => void }) {
  const rows = WEEKEND_BANDS;

  const cell = (day: number, band: HourBand) => {
    const inBand = (s: { dayOfWeek: number; startTime: string; endTime: string }) =>
      s.dayOfWeek === day && rOverlap(s.startTime, s.endTime, band.start, band.end);
    const isHead = (s: { startTime: string }) => s.startTime === band.start;

    const personal = data.personal.find(inBand);
    if (personal) {
      return (
        <div className={cn('rounded-md px-1 py-0.5 overflow-hidden bg-primary/15 text-primary', !isHead(personal) && '-mt-[3px]')}>
          {isHead(personal) && <span className="text-[8px] font-semibold leading-tight block truncate">{personal.groupName}</span>}
        </div>
      );
    }
    const paper = data.paperIn.find(inBand);
    if (paper) {
      return (
        <div className={cn('rounded-md px-1 py-0.5 overflow-hidden bg-sky-500/20 text-sky-700 dark:text-sky-300', !isHead(paper) && '-mt-[3px]')}>
          {isHead(paper) && <span className="text-[8px] font-semibold leading-tight block truncate">{paper.roomName}</span>}
        </div>
      );
    }
    const busy = data.busy.find(inBand);
    if (busy) {
      return (
        <div className={cn('rounded-md px-1 py-0.5 overflow-hidden bg-muted-foreground/15 text-muted-foreground', !isHead(busy) && '-mt-[3px]')}>
          {isHead(busy) && <span className="text-[8px] leading-tight block truncate">{busy.label ?? 'Busy'}</span>}
        </div>
      );
    }
    // Joinable suggestion (only render at its start band).
    const joinable = data.joinable.find((j) => j.dayOfWeek === day && j.startTime === band.start);
    if (joinable) {
      return (
        <button
          onClick={() => onJoin(joinable.blockId, joinable.full)}
          className="w-full h-full rounded-md border border-dashed border-primary/50 hover:bg-primary/10 text-primary flex items-center justify-center gap-0.5 px-0.5 transition-colors"
          title={`Add to ${joinable.roomName} (${joinable.memberCount}${joinable.capacity != null ? `/${joinable.capacity}` : ''})`}
        >
          <Plus className="w-2.5 h-2.5" />
          <span className="text-[7px] font-semibold truncate">{joinable.roomName}</span>
        </button>
      );
    }
    return <div className="rounded-md" />;
  };

  return (
    <div className="overflow-x-auto px-3 py-2">
      <div className="min-w-[560px]">
        <div className="grid grid-cols-[30px_repeat(7,1fr)] gap-1 mb-1">
          <div />
          {DAYS.map((d) => (
            <div key={d.num} className="text-center text-[10px] font-semibold text-muted-foreground">{d.short}</div>
          ))}
        </div>
        <div className="flex flex-col gap-[2px]">
          {rows.map((band, ri) => {
            const prev = rows[ri - 1];
            const isAfterGap = prev && prev.end === '12:00' && band.start === '15:00';
            return (
              <div key={band.start} className={cn('grid grid-cols-[30px_repeat(7,1fr)] gap-1', isAfterGap && 'mt-1')}>
                <div className="text-[9px] text-muted-foreground/70 text-right pr-0.5 flex items-center justify-end tabular-nums">{band.label}</div>
                {DAYS.map((d) => {
                  const isMorning = band.start < '12:00';
                  const disabled = !d.weekend && isMorning;
                  return (
                    <div key={d.num} className={cn('min-h-[22px] text-left', disabled && 'bg-muted/20 rounded-md')}>
                      {!disabled && cell(d.num, band)}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
