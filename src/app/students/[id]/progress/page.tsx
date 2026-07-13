'use client';

// /students/[id]/progress — the Track Progress page (metro line).
// Spec: docs/superpowers/specs/2026-07-10-track-progress-view-design.md
// Mirrors the mastery page shell; cross-links between the two.

import { use } from 'react';
import Link from 'next/link';
import { useQuery } from 'convex/react';
import { Brain, ChevronLeft, Route } from 'lucide-react';
import { api, type Id } from '@/lib/convex';
import { TrackProgress } from '@/components/students/track-progress';
import { CoverageForecast } from '@/components/students/coverage-forecast';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default function StudentProgressPage({ params }: PageProps) {
  const { id } = use(params);
  const studentId = id as Id<'students'>;
  const student = useQuery(api.students.get, { id: studentId });

  return (
    <div className="px-4 pt-5 pb-24 max-w-lg mx-auto">
      <Link
        href="/students"
        className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground mb-3"
      >
        <ChevronLeft className="w-3.5 h-3.5" />
        Students
      </Link>

      <div className="flex items-center gap-2 mb-4">
        <Route className="w-5 h-5 text-primary" />
        <h1 className="text-lg font-bold text-foreground">Track progress</h1>
        <Link
          href={`/students/${id}/mastery`}
          className="ml-auto inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-muted text-muted-foreground hover:text-foreground text-[11px] font-semibold"
        >
          <Brain className="w-3 h-3" />
          Mastery
        </Link>
      </div>

      {student === undefined && (
        <div className="space-y-2 animate-pulse">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="h-12 bg-muted rounded-xl" />
          ))}
        </div>
      )}

      {student === null && (
        <div className="rounded-xl border border-border bg-card p-4 text-center text-sm text-muted-foreground">
          Student not found.
        </div>
      )}

      {student && (
        <>
          <div className="mb-4 rounded-xl border border-border bg-card px-3 py-2.5">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Student
            </div>
            <div className="text-sm font-bold text-foreground">{student.name}</div>
            <div className="text-[11px] text-muted-foreground">
              Grade {student.schoolGrade}
            </div>
          </div>
          <TrackProgress student={student} />
          <CoverageForecast student={student} />
        </>
      )}
    </div>
  );
}
