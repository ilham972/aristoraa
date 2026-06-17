'use client';

// PaperStudentRail — the student pill strip at the top of the Library view.
// Every student is a tiny pill showing their name + assigned paper-hours,
// coloured by load so under-served students jump out:
//   0h  → red      (in no paper slot)
//   1–2h → yellow  (lightly served)
//   3h+ → green    (well served)
//
// Tapping a pill "picks it up" (it glows). While a pill is picked up the grid
// enters place-mode: tapping a slot drops THIS student there, and the grid
// lights up the student's existing paper slots, theory classes and busy
// windows. Tap the same pill again to put it down. A search box keeps the
// rail navigable as the roster grows.

import { useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { Id } from '@/lib/convex';

export type RailStudent = {
  studentId: Id<'students'>;
  name: string;
  schoolGrade: number;
  assignedHours: number;
};

// Load tier → pill colour. Kept here (not in the row) so the grid can reuse
// the same thresholds if needed.
function tierClasses(hours: number, picked: boolean): string {
  const base =
    hours === 0
      ? 'bg-destructive/10 text-destructive border-destructive/40'
      : hours <= 2
        ? 'bg-amber-500/10 text-amber-600 border-amber-500/40'
        : 'bg-emerald-500/10 text-emerald-600 border-emerald-500/40';
  return cn(
    base,
    picked && 'ring-2 ring-primary ring-offset-1 ring-offset-background shadow-lg scale-105',
  );
}

export function PaperStudentRail({
  students,
  pickedUpId,
  onPick,
}: {
  students: RailStudent[];
  pickedUpId: Id<'students'> | null;
  onPick: (id: Id<'students'> | null) => void;
}) {
  const [q, setQ] = useState('');

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return students;
    return students.filter((s) => s.name.toLowerCase().includes(needle));
  }, [students, q]);

  const pickedStudent = students.find((s) => s.studentId === pickedUpId) ?? null;

  return (
    <div className="shrink-0 mb-2">
      <div className="flex items-center gap-2 mb-1.5">
        <div className="relative flex-1 min-w-0">
          <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Find a student…"
            className="h-8 pl-7 text-xs"
          />
        </div>
        {pickedStudent && (
          <button
            onClick={() => onPick(null)}
            className="shrink-0 inline-flex items-center gap-1 px-2 h-8 rounded-lg bg-primary/10 text-primary text-[11px] font-semibold"
            title="Put this student down"
          >
            Placing {pickedStudent.name.split(' ')[0]}
            <X className="w-3 h-3" />
          </button>
        )}
      </div>

      {/* Pills — wrap into a few rows, capped with its own scroll so the grid
          keeps the lion's share of the screen. */}
      <div className="flex flex-wrap gap-1 max-h-[88px] overflow-y-auto pr-1">
        {filtered.length === 0 ? (
          <p className="text-[11px] text-muted-foreground py-1">No matching students.</p>
        ) : (
          filtered.map((s) => {
            const picked = s.studentId === pickedUpId;
            return (
              <button
                key={s.studentId}
                onClick={() => onPick(picked ? null : s.studentId)}
                className={cn(
                  'shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-full border text-[11px] font-medium transition-all',
                  tierClasses(s.assignedHours, picked),
                )}
                title={`${s.name} · ${s.assignedHours}h paper`}
              >
                <span className="truncate max-w-[8rem]">{s.name}</span>
                <span className="tabular-nums opacity-80 font-semibold">{s.assignedHours}h</span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
