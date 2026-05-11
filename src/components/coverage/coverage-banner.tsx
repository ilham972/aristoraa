'use client';

import { AlertTriangle, AlertCircle } from 'lucide-react';

interface Props {
  grade: number;
  term: number;
  threshold: number;
  gatedCount: number;
  orphanCount: number;
  noHardCount: number;
  isPhaseDBlocked: boolean;
}

// Top-of-page banner. Red blocking variant when any concept is gated or
// orphan; amber advisory variant when only "no hard questions" warnings exist.
// Renders nothing when the (grade, term) view is clean.
export function CoverageBanner({
  grade,
  term,
  threshold,
  gatedCount,
  orphanCount,
  noHardCount,
  isPhaseDBlocked,
}: Props) {
  if (isPhaseDBlocked) {
    return (
      <div className="rounded-xl border-2 border-red-500/60 bg-red-500/15 p-4 mb-4">
        <div className="flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-500 mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-red-500 mb-1">
              Sheet generation is BLOCKED for G{grade} Term {term}
            </p>
            <ul className="text-xs text-red-400 space-y-0.5">
              {gatedCount > 0 && (
                <li>
                  {gatedCount} concept{gatedCount === 1 ? '' : 's'} under
                  threshold (need ≥{threshold} questions each)
                </li>
              )}
              {orphanCount > 0 && (
                <li>
                  {orphanCount} orphan concept{orphanCount === 1 ? '' : 's'} —
                  fix unit ordering on the Details page
                </li>
              )}
              {noHardCount > 0 && (
                <li>
                  {noHardCount} concept{noHardCount === 1 ? '' : 's'} have no
                  difficulty 4–5 questions — exam-prep slot will be weak
                </li>
              )}
            </ul>
          </div>
        </div>
      </div>
    );
  }

  if (noHardCount > 0) {
    return (
      <div className="rounded-xl border border-amber-500/60 bg-amber-500/10 p-3 mb-4">
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
          <p className="text-xs text-amber-500">
            {noHardCount} concept{noHardCount === 1 ? '' : 's'} have no
            difficulty 4–5 questions — exam-prep slot will be weak for G{grade}
            T{term}.
          </p>
        </div>
      </div>
    );
  }

  return null;
}
