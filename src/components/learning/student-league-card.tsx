'use client';

// Phase 3 (§3.4) — per-student league widget. Read-only. Shows the student's
// league (track), their rank within it, progress (stations cleared), and the
// next league they'd promote into. Mountable on the student detail / Lead
// dashboard. Ranks over the current month by default.

import { useMemo } from 'react';
import { useQuery } from 'convex/react';
import { Route, Trophy, ChevronUp } from 'lucide-react';
import { api } from '@/lib/convex';
import type { Id } from '@/lib/convex';
import { getMonthDates } from '@/lib/scoring';
import { getTodayDateStr } from '@/lib/types';

export function StudentLeagueCard({ studentId }: { studentId: Id<'students'> }) {
  const dates = useMemo(() => {
    const today = getTodayDateStr();
    return getMonthDates(parseInt(today.split('-')[0]), parseInt(today.split('-')[1]));
  }, []);

  const data = useQuery(api.learningEngine.leagues.studentLeagueCard, { studentId, dates });

  if (data === undefined) {
    return <div className="h-20 rounded-xl bg-muted animate-pulse" />;
  }
  if (data === null) return null; // signed out — nothing to show
  if (!data.hasTrack) {
    return (
      <div className="rounded-xl border border-border bg-card p-3">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Route className="w-4 h-4" />
          <span className="text-xs">No track assigned — not in a league yet.</span>
        </div>
      </div>
    );
  }

  const pct = data.totalUnits > 0 ? Math.round((data.clearedUnits / data.totalUnits) * 100) : 0;

  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <div className="flex items-center gap-2 mb-2">
        <Route className="w-4 h-4 text-primary shrink-0" />
        <span className="text-sm font-bold text-foreground flex-1 truncate">{data.trackName} League</span>
        {data.rank != null && (
          <span className="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[11px] font-bold tabular-nums">
            <Trophy className="w-3 h-3" />#{data.rank}
            <span className="text-muted-foreground font-normal">/ {data.leagueSize}</span>
          </span>
        )}
      </div>

      {/* Progress */}
      <div className="flex items-center gap-2 mb-2">
        <div className="h-2 flex-1 rounded-full bg-muted overflow-hidden">
          <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
        </div>
        <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">
          {data.clearedUnits}/{data.totalUnits} stations
        </span>
      </div>

      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-muted-foreground tabular-nums">
          {data.pointsNew.toFixed(0)} pts this month
        </span>
        {data.isComplete && !data.nextTrackName && (
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-500">
            <Trophy className="w-3 h-3" /> Top of track
          </span>
        )}
        {data.isComplete && data.nextTrackName && (
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary">
            <ChevronUp className="w-3 h-3" /> Ready → {data.nextTrackName}
          </span>
        )}
        {!data.isComplete && data.nextTrackName && (
          <span className="text-[11px] text-muted-foreground truncate">Next: {data.nextTrackName}</span>
        )}
      </div>
    </div>
  );
}
