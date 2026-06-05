'use client';

// Phase 2 — admin-only scoring parallel-run view.
//
// Side-by-side comparison of the legacy triangular points (Old, what the live
// leaderboard still uses) versus the new difficulty×section weighted points
// (New, proposed). Both are computed from the SAME finalized sheet marks and
// stored in `sessionPoints`; this page is the ONLY surface that reads the new
// numbers. The public /leaderboard is deliberately untouched — the founder
// flips the cutover later after eyeballing the divergence here.

import { useMemo, useState } from 'react';
import { useQuery } from 'convex/react';
import { ListOrdered, ArrowUp, ArrowDown, Minus } from 'lucide-react';
import { api } from '@/lib/convex';
import type { Id } from '@/lib/convex';

const GRADES = [6, 7, 8, 9, 10, 11];

type Period = 'today' | '7d' | '30d';
const PERIODS: { id: Period; label: string; days: number }[] = [
  { id: 'today', label: 'Today', days: 1 },
  { id: '7d', label: 'Last 7d', days: 7 },
  { id: '30d', label: 'Last 30d', days: 30 },
];

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

function lastNDates(n: number): string[] {
  const out: string[] = [];
  const today = new Date();
  for (let i = 0; i < n; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    out.push(ymd(d));
  }
  return out;
}

type Row = {
  studentId: Id<'students'>;
  name: string;
  schoolGrade: number;
  pointsOld: number;
  pointsNew: number;
  correctCount: number;
  sheetCount: number;
  rankOld: number;
  rankNew: number;
};

export default function ScoringComparePage() {
  const [period, setPeriod] = useState<Period>('7d');
  const [grade, setGrade] = useState<number>(7);

  const days = PERIODS.find((p) => p.id === period)!.days;
  const dates = useMemo(() => lastNDates(days), [days]);

  const rows = useQuery(api.learningEngine.scoring.pointsLeaderboard, {
    dates,
    gradeFilter: grade,
  }) as Row[] | null | undefined;

  const byOld = useMemo(
    () => (rows ? [...rows].sort((a, b) => a.rankOld - b.rankOld) : []),
    [rows],
  );
  const byNew = useMemo(
    () => (rows ? [...rows].sort((a, b) => a.rankNew - b.rankNew) : []),
    [rows],
  );

  return (
    <div className="px-4 pt-5 pb-24 max-w-2xl mx-auto">
      <div className="flex items-center gap-2 mb-1">
        <ListOrdered className="w-5 h-5 text-primary" />
        <h1 className="text-lg font-bold text-foreground">Scoring · Old vs New</h1>
      </div>
      <p className="text-[11px] text-muted-foreground mb-4">
        Parallel run from finalized sheets. <strong>Old</strong> is the live
        leaderboard formula; <strong>New</strong> is the proposed difficulty ×
        section weighted points. Nothing here changes the public board.
      </p>

      {/* Period + grade selectors */}
      <div className="flex gap-1 p-1 bg-muted rounded-xl mb-2">
        {PERIODS.map((p) => (
          <button
            key={p.id}
            onClick={() => setPeriod(p.id)}
            className={`flex-1 py-2 px-2 rounded-lg text-xs font-semibold transition-all ${
              p.id === period
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>
      <div className="flex gap-1 p-1 bg-muted rounded-xl mb-4 overflow-x-auto">
        {GRADES.map((g) => (
          <button
            key={g}
            onClick={() => setGrade(g)}
            className={`flex-1 py-2 px-3 rounded-lg text-xs font-semibold transition-all whitespace-nowrap ${
              g === grade
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            G{g}
          </button>
        ))}
      </div>

      {rows === undefined && (
        <div className="space-y-2 animate-pulse">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 bg-muted rounded-xl" />
          ))}
        </div>
      )}
      {rows === null && (
        <div className="rounded-xl border border-border bg-card p-4 text-center">
          <p className="text-sm text-muted-foreground">Sign in required.</p>
        </div>
      )}
      {rows && rows.length === 0 && (
        <div className="rounded-xl border border-border bg-card p-6 text-center">
          <p className="text-sm text-muted-foreground">
            No finalized sheets for G{grade} in this window.
          </p>
          <p className="text-[11px] text-muted-foreground mt-1">
            Score a sheet from the session Sheets tab to populate this.
          </p>
        </div>
      )}

      {rows && rows.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <RankColumn
            title="Old · live formula"
            subtitle="5·C·(C+1)/2"
            rows={byOld}
            metric="old"
          />
          <RankColumn
            title="New · proposed"
            subtitle="difficulty × section + streak"
            rows={byNew}
            metric="new"
          />
        </div>
      )}
    </div>
  );
}

function RankColumn({
  title,
  subtitle,
  rows,
  metric,
}: {
  title: string;
  subtitle: string;
  rows: Row[];
  metric: 'old' | 'new';
}) {
  return (
    <section className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="px-3 py-2 border-b border-border bg-muted/30">
        <div className="text-xs font-bold text-foreground">{title}</div>
        <div className="text-[10px] text-muted-foreground font-mono">{subtitle}</div>
      </div>
      <div className="divide-y divide-border">
        {rows.map((r) => {
          const rank = metric === 'old' ? r.rankOld : r.rankNew;
          const pts = metric === 'old' ? r.pointsOld : r.pointsNew;
          // Movement = how this student's rank differs between the two schemes.
          // Shown on the New column only (the interesting "who'd move" signal).
          const delta = r.rankOld - r.rankNew; // >0 means New ranks them higher
          return (
            <div
              key={r.studentId as unknown as string}
              className="px-3 py-2 flex items-center gap-2"
            >
              <span className="w-6 text-center text-[11px] font-bold text-muted-foreground tabular-nums shrink-0">
                {rank}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-xs text-foreground truncate">{r.name}</div>
                <div className="text-[10px] text-muted-foreground tabular-nums">
                  {r.correctCount} correct · {r.sheetCount} sheet
                  {r.sheetCount === 1 ? '' : 's'}
                </div>
              </div>
              {metric === 'new' && <MovementBadge delta={delta} />}
              <span className="text-[13px] font-bold text-foreground tabular-nums shrink-0 w-12 text-right">
                {metric === 'old' ? pts : pts.toFixed(1)}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function MovementBadge({ delta }: { delta: number }) {
  if (delta === 0) {
    return (
      <span className="inline-flex items-center text-[10px] text-muted-foreground shrink-0">
        <Minus className="w-3 h-3" />
      </span>
    );
  }
  const up = delta > 0;
  return (
    <span
      className={`inline-flex items-center gap-0.5 text-[10px] font-semibold tabular-nums shrink-0 ${
        up ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
      }`}
      title={`Ranks ${Math.abs(delta)} place${Math.abs(delta) === 1 ? '' : 's'} ${
        up ? 'higher' : 'lower'
      } under the new scheme`}
    >
      {up ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}
      {Math.abs(delta)}
    </span>
  );
}
