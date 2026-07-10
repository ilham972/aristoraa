'use client';

// TrackProgressStrip — one glanceable line of track progress inside the
// session Sheets tab: `◉ Algebra I · 4/7 · ~2 sessions · on track ✓ ›`.
// Taps through to /students/[id]/progress. Same query as the full metro-line
// view (useCachedQuery → instant paint, live updates while scoring).
// Renders nothing while loading or when the student has no track, so it can
// never block the scoring flow.

import { useMemo } from 'react';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { useCachedQuery } from '@/hooks/use-cached-query';
import { api } from '@/lib/convex';
import { cn } from '@/lib/utils';
import { buildTrackProgressArgs } from '@/lib/track-progress-args';
import type { StudentLite } from '@/lib/sheets/scope';

export function TrackProgressStrip({ student }: { student: StudentLite }) {
  const args = useMemo(() => buildTrackProgressArgs(student), [student]);
  const data = useCachedQuery(
    api.learningEngine.trackProgress.trackProgressForStudent,
    { studentId: student._id, ...args },
  );

  if (!data || data.status !== 'ok') return null;

  const current = data.units.find((u) => u.status === 'current') ?? null;
  const { prediction, summary } = data;

  return (
    <Link
      href={`/students/${student._id}/progress`}
      className="flex items-center gap-2 mb-2 px-3 py-2 rounded-xl border border-border bg-card hover:bg-muted/40 transition-colors"
    >
      <span className="relative w-3 h-3 shrink-0">
        <span className="absolute inset-0 rounded-full bg-primary/40 animate-ping" />
        <span className="absolute inset-0 rounded-full bg-primary" />
      </span>
      <span className="min-w-0 flex-1 truncate text-[11px] text-foreground">
        {current ? (
          <>
            <span className="font-semibold">{current.unitName}</span>
            <span className="text-muted-foreground">
              {' · '}
              {current.conceptsTaught}/{current.conceptsTotal}
              {current.sessionsLeft !== null && ` · ~${current.sessionsLeft} sessions`}
            </span>
          </>
        ) : (
          <span className="font-semibold">
            Track swept — {summary.unitsMastered}/{summary.unitsTotal} mastered
          </span>
        )}
        {prediction.onTrack === true && (
          <span className="ml-1.5 font-bold text-primary">on track ✓</span>
        )}
        {prediction.onTrack === false && (
          <span className="ml-1.5 font-bold text-amber-500">behind ⚠</span>
        )}
      </span>
      <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
    </Link>
  );
}
