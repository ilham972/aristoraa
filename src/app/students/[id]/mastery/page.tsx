'use client';

import { use } from 'react';
import Link from 'next/link';
import { useQuery } from 'convex/react';
import { Brain, ChevronLeft } from 'lucide-react';
import { api, type Id } from '@/lib/convex';
import { StudentMastery } from '@/components/learning/student-mastery';
import { StudentExamOutlook } from '@/components/learning/student-exam-outlook';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default function StudentMasteryPage({ params }: PageProps) {
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
        <Brain className="w-5 h-5 text-primary" />
        <h1 className="text-lg font-bold text-foreground">Mastery</h1>
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
            <div className="text-sm font-bold text-foreground">
              {student.name}
            </div>
            <div className="text-[11px] text-muted-foreground">
              Grade {student.schoolGrade}
              {student.assignedGrades &&
                student.assignedGrades.length > 1 && (
                  <>
                    {' · assigned '}
                    {student.assignedGrades
                      .slice()
                      .sort((a, b) => a - b)
                      .map((g) => `G${g}`)
                      .join(', ')}
                  </>
                )}
            </div>
          </div>
          <StudentExamOutlook studentId={studentId} />
          <StudentMastery studentId={studentId} />
        </>
      )}
    </div>
  );
}
