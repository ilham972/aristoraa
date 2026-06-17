'use client';

// PaperRollCall — the daily Library roll-call, shown on the Session view when
// the "Library" pill is selected. One tick-list for everyone in paper class
// that day (everyone present unless toggled absent), driving flat 100 LKR /
// student / day. Mirrors the personal-class attendance UX, minus payments
// (paper billing is a flat per-day rate, not a per-hour fee).

import { useState } from 'react';
import { useMutation } from 'convex/react';
import { useCachedQuery as useQuery } from '@/hooks/use-cached-query';
import { toast } from 'sonner';
import { Check, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { api, type Id } from '@/lib/convex';
import { cn } from '@/lib/utils';
import { fmtLKR } from '@/lib/groups/time-grid';

const PAPER_RATE = 100;

export function PaperRollCall({ date }: { date: string }) {
  const roster = useQuery(api.paperClasses.dayRoster, { date });
  const submit = useMutation(api.paperClasses.submitDayAttendance);
  const [saving, setSaving] = useState(false);

  // Absent set, seeded once per date from saved status (default present).
  const [absent, setAbsent] = useState<Set<string>>(new Set());
  const [seededFor, setSeededFor] = useState<string | null>(null);
  if (roster && seededFor !== date) {
    const a = new Set<string>();
    for (const s of roster.students) if (!s.present) a.add(String(s.studentId));
    setAbsent(a);
    setSeededFor(date);
  }

  if (!roster) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (roster.students.length === 0) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-sm text-muted-foreground text-center px-6">
          No students in paper class on this day.
          <br />
          Build the timetable on the Library view.
        </p>
      </div>
    );
  }

  const presentCount = roster.students.filter((s) => !absent.has(String(s.studentId))).length;
  const revenue = presentCount * PAPER_RATE;

  const toggle = (id: Id<'students'>) => {
    setAbsent((prev) => {
      const next = new Set(prev);
      const k = String(id);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  };

  const save = async () => {
    setSaving(true);
    try {
      const presentStudentIds = roster.students
        .filter((s) => !absent.has(String(s.studentId)))
        .map((s) => s.studentId);
      await submit({ date, presentStudentIds });
      toast.success(`Library attendance saved · ${fmtLKR(revenue)}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 min-h-0 overflow-y-auto">
        <ul className="space-y-1.5">
          {roster.students.map((s) => {
            const isAbsent = absent.has(String(s.studentId));
            return (
              <li key={s.studentId}>
                <button
                  onClick={() => toggle(s.studentId)}
                  className={cn(
                    'w-full flex items-center gap-2 px-2.5 py-2 rounded-xl border text-left transition-colors',
                    isAbsent
                      ? 'border-border/40 bg-muted/20 text-muted-foreground'
                      : 'border-emerald-500/40 bg-emerald-500/10 text-foreground',
                  )}
                >
                  <span className={cn(
                    'w-5 h-5 rounded-full flex items-center justify-center shrink-0',
                    isAbsent ? 'bg-muted-foreground/20' : 'bg-emerald-500 text-white',
                  )}>
                    {isAbsent ? <X className="w-3 h-3" /> : <Check className="w-3 h-3" />}
                  </span>
                  <span className="text-sm flex-1 truncate">{s.name}</span>
                  <span className="text-[10px] text-muted-foreground">G{s.schoolGrade}</span>
                  <span className="text-[11px] font-medium">{isAbsent ? 'Absent' : 'Present'}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="shrink-0 border-t border-border/60 pt-3 mt-2 flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground tabular-nums">
          {presentCount}/{roster.students.length} present ·{' '}
          <span className="text-foreground font-semibold">{fmtLKR(revenue)}</span>
        </span>
        <Button onClick={save} disabled={saving} size="sm" className="h-9">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Check className="w-4 h-4 mr-1" /> Save</>}
        </Button>
      </div>
    </div>
  );
}
