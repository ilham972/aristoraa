'use client';

// Phase 3 — Cohort Leagues board (NEW additive surface, NOT the public
// /leaderboard). Ranks students WITHIN their track (their league) by Σ
// sessionPoints.pointsNew over the period, so a remedial student competes with
// true peers. Track progress (stations cleared) rides along as a secondary pill.
// A Promotions strip lets a teacher promote students who cleared their track.
//
// The live /leaderboard is untouched; this board only becomes "primary" when the
// founder flips LEADERBOARD_PRIMARY (see leaderboard-link.ts). Mirrors the
// /leaderboard controls (period + centre) and reuses its canvas PNG pattern.

import { useState, useCallback, useMemo } from 'react';
import { useQuery, useMutation } from 'convex/react';
import { Download, Route, ArrowUpCircle, TrendingUp } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { api } from '@/lib/convex';
import type { Id } from '@/lib/convex';
import { getTodayDateStr } from '@/lib/types';
import { getWeekDates, getMonthDates } from '@/lib/scoring';
import { toast } from 'sonner';

type Period = 'daily' | 'weekly' | 'monthly';

type LeagueStudent = {
  studentId: Id<'students'>;
  name: string;
  centerId: Id<'centers'> | null;
  pointsNew: number;
  pointsOld: number;
  clearedUnits: number;
  totalUnits: number;
  currentUnitId: string | null;
  isComplete: boolean;
};

type League = {
  trackId: Id<'tracks'> | null;
  trackName: string;
  level: number;
  mergesIntoTrackId: Id<'tracks'> | null;
  mergesIntoTrackName: string | null;
  students: LeagueStudent[];
};

type Candidate = {
  studentId: Id<'students'>;
  name: string;
  fromTrackId: Id<'tracks'>;
  fromTrackName: string;
  toTrackId: Id<'tracks'>;
  toTrackName: string;
};

const BRAND = 'Aristora';

export default function LeaguesPage() {
  const [period, setPeriod] = useState<Period>('weekly');
  const [centerFilter, setCenterFilter] = useState<string>('all');
  const [date, setDate] = useState(getTodayDateStr());
  const [promoting, setPromoting] = useState<string | null>(null);

  const dates = useMemo(
    () =>
      period === 'daily'
        ? [date]
        : period === 'weekly'
        ? getWeekDates(date)
        : getMonthDates(parseInt(date.split('-')[0]), parseInt(date.split('-')[1])),
    [period, date],
  );

  const leagues = useQuery(api.learningEngine.leagues.cohortLeaderboard, { dates }) as
    | League[]
    | null
    | undefined;
  const candidates = useQuery(api.learningEngine.leagues.promotionCandidates, {}) as
    | Candidate[]
    | undefined;
  const centers = useQuery(api.centers.list);
  const promote = useMutation(api.learningEngine.leagues.promoteStudent);

  const filterStudents = useCallback(
    (students: LeagueStudent[]): LeagueStudent[] => {
      if (centerFilter === 'all') return students;
      if (centerFilter === 'none') return students.filter((s) => !s.centerId);
      return students.filter((s) => (s.centerId as unknown as string) === centerFilter);
    },
    [centerFilter],
  );

  // Leagues with ≥1 student after the centre filter, each re-ranked by index
  // (the backend already sorted students by pointsNew desc within the league).
  const visibleLeagues = useMemo(() => {
    if (!leagues) return [];
    return leagues
      .map((lg) => ({ ...lg, students: filterStudents(lg.students) }))
      .filter((lg) => lg.students.length > 0);
  }, [leagues, filterStudents]);

  const onPromote = useCallback(
    async (c: Candidate) => {
      const ok = window.confirm(
        `Promote ${c.name} from "${c.fromTrackName}" into "${c.toTrackName}"? They cleared their track. This moves their track and logs a promotion.`,
      );
      if (!ok) return;
      setPromoting(c.studentId as unknown as string);
      try {
        await promote({ studentId: c.studentId, reason: 'completed-track' });
        toast.success(`${c.name} promoted → ${c.toTrackName}`);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Promotion failed');
      } finally {
        setPromoting(null);
      }
    },
    [promote],
  );

  const periodLabel =
    period === 'daily'
      ? `Daily · ${date}`
      : period === 'weekly'
      ? `Weekly · week of ${dates[0]}`
      : `Monthly · ${date.substring(0, 7)}`;

  return (
    <div className="px-4 pt-5 pb-24 max-w-lg mx-auto">
      <div className="flex items-center gap-2 mb-1">
        <Route className="w-5 h-5 text-primary" />
        <h1 className="text-lg font-bold text-foreground">Leagues</h1>
      </div>
      <p className="text-[11px] text-muted-foreground mb-4">
        Ranked <strong>within each track</strong> by effort points — true peers
        compete. Progress pills show stations cleared. This board is additive; the
        public leaderboard is unchanged.
      </p>

      {/* Period toggle */}
      <div className="flex gap-1.5 p-1 bg-muted rounded-xl mb-3">
        {(['daily', 'weekly', 'monthly'] as Period[]).map((p) => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${
              period === p
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {p.charAt(0).toUpperCase() + p.slice(1)}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex gap-2 mb-4">
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="flex-1 h-10 px-3 text-sm border border-border rounded-xl bg-card text-foreground"
        />
        <Select value={centerFilter} onValueChange={(v) => setCenterFilter(v ?? 'all')}>
          <SelectTrigger className="w-32 h-10 text-sm">
            <SelectValue placeholder="Center" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Centers</SelectItem>
            <SelectItem value="none">No Center</SelectItem>
            {centers?.map((c: { _id: string; name: string }) => (
              <SelectItem key={c._id} value={c._id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Promotions strip */}
      {candidates && candidates.length > 0 && (
        <section className="mb-5 rounded-xl border border-primary/30 bg-primary/5 p-3">
          <div className="flex items-center gap-1.5 mb-2">
            <ArrowUpCircle className="w-4 h-4 text-primary" />
            <h2 className="text-xs font-bold text-foreground uppercase tracking-wide">
              Ready to promote ({candidates.length})
            </h2>
          </div>
          <div className="space-y-1.5">
            {candidates.map((c) => (
              <div
                key={c.studentId as unknown as string}
                className="flex items-center gap-2 rounded-lg bg-card border border-border p-2"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-semibold text-foreground truncate">{c.name}</div>
                  <div className="text-[10px] text-muted-foreground truncate">
                    cleared {c.fromTrackName} → {c.toTrackName}
                  </div>
                </div>
                <button
                  onClick={() => onPromote(c)}
                  disabled={promoting === (c.studentId as unknown as string)}
                  className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-primary text-primary-foreground text-[11px] font-semibold disabled:opacity-50"
                >
                  <TrendingUp className="w-3 h-3" />
                  {promoting === (c.studentId as unknown as string)
                    ? 'Promoting…'
                    : `Promote → ${c.toTrackName}`}
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Loading / empty / signed-out */}
      {leagues === undefined && (
        <div className="space-y-2 animate-pulse">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 bg-muted rounded-xl" />
          ))}
        </div>
      )}
      {leagues === null && (
        <div className="rounded-xl border border-border bg-card p-4 text-center">
          <p className="text-sm text-muted-foreground">Sign in required.</p>
        </div>
      )}
      {leagues && visibleLeagues.length === 0 && (
        <div className="rounded-xl border border-border bg-card p-6 text-center">
          <p className="text-sm text-muted-foreground">No students in this view.</p>
          <p className="text-[11px] text-muted-foreground mt-1">
            Assign students to tracks (Algorithm → Tracks), then score sheets to populate points.
          </p>
        </div>
      )}

      {/* One section per league */}
      <div className="space-y-5">
        {visibleLeagues.map((lg) => (
          <LeagueSection key={(lg.trackId as unknown as string) ?? 'no-track'} league={lg} periodLabel={periodLabel} />
        ))}
      </div>
    </div>
  );
}

function LeagueSection({ league, periodLabel }: { league: League; periodLabel: string }) {
  const downloadPng = useCallback(() => {
    downloadLeaguePng(league, periodLabel);
  }, [league, periodLabel]);

  return (
    <section className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border bg-muted/30">
        <Route className="w-4 h-4 text-primary shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold text-foreground truncate">{league.trackName} League</div>
          {league.mergesIntoTrackName && (
            <div className="text-[10px] text-muted-foreground truncate">
              promotes into {league.mergesIntoTrackName}
            </div>
          )}
        </div>
        <button
          onClick={downloadPng}
          className="shrink-0 p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted"
          aria-label="Download league image"
          title="Download as image"
        >
          <Download className="w-4 h-4" />
        </button>
      </div>

      <div className="divide-y divide-border">
        {league.students.map((s, i) => {
          const rank = i + 1;
          const rankStyles: Record<number, string> = {
            1: 'bg-amber-400 text-black',
            2: 'bg-slate-400 text-black',
            3: 'bg-amber-700 text-white',
          };
          return (
            <div key={s.studentId as unknown as string} className="px-3 py-2.5 flex items-center gap-3">
              <div
                className={`w-7 h-7 rounded-lg flex items-center justify-center font-bold text-xs shrink-0 ${
                  rankStyles[rank] || 'bg-muted text-muted-foreground'
                }`}
              >
                {rank}
              </div>
              <div className="min-w-0 flex-1">
                <p className={`text-sm text-foreground truncate ${rank <= 3 ? 'font-bold' : 'font-medium'}`}>
                  {s.name}
                </p>
                <ProgressPill cleared={s.clearedUnits} total={s.totalUnits} isComplete={s.isComplete} />
              </div>
              <div className="text-right shrink-0">
                <p className={`font-bold tabular-nums ${rank <= 3 ? 'text-lg' : 'text-sm'} text-foreground`}>
                  {s.pointsNew.toFixed(0)}
                </p>
                <p className="text-[10px] text-primary">pts</p>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ProgressPill({ cleared, total, isComplete }: { cleared: number; total: number; isComplete: boolean }) {
  const pct = total > 0 ? Math.round((cleared / total) * 100) : 0;
  return (
    <div className="flex items-center gap-1.5 mt-1">
      <div className="h-1.5 w-16 rounded-full bg-muted overflow-hidden">
        <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[10px] text-muted-foreground tabular-nums">
        {isComplete ? '✓ ' : ''}
        {cleared}/{total} stations
      </span>
    </div>
  );
}

// Per-league shareable PNG — reuses the /leaderboard canvas pattern (dark-navy
// gradient, teal top rule, top-3 medal chips), columns RANK / STUDENT /
// STATIONS / POINTS.
function downloadLeaguePng(league: League, periodLabel: string) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const rows = league.students.slice(0, 20);
  const width = 800;
  const rowHeight = 48;
  const headerHeight = 150;
  const footerHeight = 40;
  const height = headerHeight + rows.length * rowHeight + 40 + footerHeight;

  canvas.width = width;
  canvas.height = height;

  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, '#0B1120');
  gradient.addColorStop(1, '#131D2E');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = '#14B8A6';
  ctx.fillRect(0, 0, width, 4);

  ctx.fillStyle = '#FFFFFF';
  ctx.font = 'bold 28px Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(BRAND, width / 2, 50);

  ctx.font = 'bold 18px Arial, sans-serif';
  ctx.fillStyle = '#14B8A6';
  ctx.fillText(`${league.trackName} League`, width / 2, 82);

  ctx.font = '15px Arial, sans-serif';
  ctx.fillStyle = '#7B8FA3';
  ctx.fillText(periodLabel, width / 2, 108);

  const tableTop = headerHeight;
  ctx.fillStyle = '#1A2836';
  ctx.fillRect(30, tableTop, width - 60, 36);
  ctx.fillStyle = '#7B8FA3';
  ctx.font = 'bold 13px Arial, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('RANK', 50, tableTop + 24);
  ctx.fillText('STUDENT', 120, tableTop + 24);
  ctx.textAlign = 'right';
  ctx.fillText('STATIONS', 620, tableTop + 24);
  ctx.fillText('POINTS', 740, tableTop + 24);

  rows.forEach((s, i) => {
    const y = tableTop + 36 + i * rowHeight;
    const rank = i + 1;

    ctx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.01)';
    ctx.fillRect(30, y, width - 60, rowHeight);

    if (rank <= 3) {
      const colors = ['#FBBF24', '#94A3B8', '#D97706'];
      ctx.fillStyle = colors[rank - 1];
      ctx.beginPath();
      ctx.arc(70, y + rowHeight / 2, 14, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#0B1120';
      ctx.font = 'bold 12px Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(String(rank), 70, y + rowHeight / 2 + 4);
    } else {
      ctx.fillStyle = '#7B8FA3';
      ctx.font = '14px Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(String(rank), 70, y + rowHeight / 2 + 5);
    }

    ctx.fillStyle = '#E8EDF2';
    ctx.font = rank <= 3 ? 'bold 15px Arial, sans-serif' : '14px Arial, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(s.name, 120, y + rowHeight / 2 + 5);

    ctx.fillStyle = '#14B8A6';
    ctx.font = '13px Arial, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(`${s.clearedUnits}/${s.totalUnits}`, 620, y + rowHeight / 2 + 5);

    ctx.fillStyle = rank <= 3 ? '#FBBF24' : '#E8EDF2';
    ctx.font = 'bold 16px Arial, sans-serif';
    ctx.fillText(s.pointsNew.toFixed(0), 740, y + rowHeight / 2 + 5);
  });

  const footerY = height - footerHeight;
  ctx.fillStyle = '#7B8FA3';
  ctx.font = '11px Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(`Generated ${new Date().toLocaleDateString()}`, width / 2, footerY + 20);

  const safeName = league.trackName.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  const link = document.createElement('a');
  link.download = `league-${safeName}.png`;
  link.href = canvas.toDataURL('image/png');
  link.click();
  toast.success('League image downloaded!');
}
