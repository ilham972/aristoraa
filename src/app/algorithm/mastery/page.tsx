'use client';

import { useMemo, useState, Suspense } from 'react';
import { useQuery } from 'convex/react';
import { Activity, Search } from 'lucide-react';
import { api, type Id } from '@/lib/convex';
import { StudentMastery } from '@/components/learning/student-mastery';

function MasteryPageInner() {
  const students = useQuery(api.students.list);
  const [selectedId, setSelectedId] = useState<Id<'students'> | null>(null);
  const [filter, setFilter] = useState('');

  const filtered = useMemo(() => {
    if (!students) return [];
    const q = filter.trim().toLowerCase();
    if (!q) return students;
    return students.filter((s) => s.name.toLowerCase().includes(q));
  }, [students, filter]);

  const selectedStudent = useMemo(() => {
    if (!selectedId || !students) return null;
    return students.find((s) => s._id === selectedId) ?? null;
  }, [selectedId, students]);

  return (
    <div className="px-4 pt-5 pb-24 max-w-lg mx-auto">
      <div className="flex items-center gap-2 mb-4">
        <Activity className="w-5 h-5 text-primary" />
        <h1 className="text-lg font-bold text-foreground">Mastery</h1>
      </div>

      {/* Student picker */}
      {!selectedId && (
        <>
          <div className="relative mb-3">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Search students…"
              className="w-full pl-9 pr-3 py-2 rounded-xl border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
          </div>
          {students === undefined && (
            <div className="space-y-2 animate-pulse">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="h-12 bg-muted rounded-xl" />
              ))}
            </div>
          )}
          {students && filtered.length === 0 && (
            <div className="rounded-xl border border-border bg-card p-4 text-center text-sm text-muted-foreground">
              No students match.
            </div>
          )}
          {students && filtered.length > 0 && (
            <ul className="space-y-1.5">
              {filtered.map((s) => (
                <li key={s._id}>
                  <button
                    onClick={() => setSelectedId(s._id)}
                    className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl border border-border bg-card hover:bg-muted text-left transition-colors"
                  >
                    <span className="text-sm font-medium text-foreground">
                      {s.name}
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      G{s.schoolGrade}
                      {s.assignedGrades && s.assignedGrades.length > 1
                        ? ` (+${s.assignedGrades.length - 1})`
                        : ''}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {/* Selected student view */}
      {selectedId && (
        <>
          <button
            onClick={() => setSelectedId(null)}
            className="mb-3 text-[11px] text-muted-foreground hover:text-foreground"
          >
            ← Switch student
          </button>
          {selectedStudent && (
            <div className="mb-4 rounded-xl border border-border bg-card px-3 py-2.5">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Student
              </div>
              <div className="text-sm font-bold text-foreground">
                {selectedStudent.name}
              </div>
              <div className="text-[11px] text-muted-foreground">
                Grade {selectedStudent.schoolGrade}
                {selectedStudent.assignedGrades &&
                  selectedStudent.assignedGrades.length > 1 && (
                    <>
                      {' · assigned '}
                      {selectedStudent.assignedGrades
                        .slice()
                        .sort((a, b) => a - b)
                        .map((g) => `G${g}`)
                        .join(', ')}
                    </>
                  )}
              </div>
            </div>
          )}
          <StudentMastery studentId={selectedId} />
        </>
      )}
    </div>
  );
}

export default function MasteryPage() {
  return (
    <Suspense
      fallback={
        <div className="px-4 pt-5 max-w-lg mx-auto text-sm text-muted-foreground">
          Loading…
        </div>
      }
    >
      <MasteryPageInner />
    </Suspense>
  );
}
