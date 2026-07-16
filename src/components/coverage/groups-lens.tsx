'use client';

// GroupsLens — the "Groups" half of Insights → Coverage (2026-07-17). The Term
// Coverage Cockpit moved here out of the Planner's Sheets tab (founder call:
// coverage gets ONE home). The rail answers the question the Sheets tab never
// could — how does every group compare on the same term — and tapping a
// station opens that group's full cockpit underneath, unchanged.
//
// Two queries, deliberately: groupsTermCoverageSummary draws every ring from
// counts alone (no question documents), and only the tapped group pays for the
// full groupTermCoverage with its labels and provenance.

import { useEffect, useMemo, useState } from 'react';
import { Users } from 'lucide-react';
import { api, type Id } from '@/lib/convex';
import { cn } from '@/lib/utils';
import { useCachedQuery } from '@/hooks/use-cached-query';
import { GroupCoverage } from '@/components/planner/group-coverage';

type SummaryRow = {
  groupId: Id<'groups'>;
  name: string;
  grade: number | null;
  status: string;
  term: number | null;
  availableTerms: number[];
  pct: number | null;
  doneCount: number;
  plannedCount: number;
  plannableTotal: number;
  needsBookCount: number;
};

const STATUS_REASON: Record<string, string> = {
  'no-track': 'no track',
  'no-sessions': 'no sessions',
};

// A group "station": the ring outline IS its term coverage — bright emerald
// arc = taught, dim teal arc = planned on top of it. Same visual language as
// the week rail on the Sheets timeline, so the two rails read as one system.
function GroupRing({
  done,
  planned,
  total,
  selected,
  unavailable,
}: {
  done: number;
  planned: number;
  total: number;
  selected: boolean;
  unavailable: boolean;
}) {
  const R = 12;
  const C = 2 * Math.PI * R;
  const safe = Math.max(1, total);
  const doneLen = (Math.min(done / safe, 1) * C);
  const planLen = Math.min(planned / safe, Math.max(0, 1 - done / safe)) * C;
  return (
    <span
      className={cn(
        'relative w-7 h-7 shrink-0 rounded-full flex items-center justify-center',
        selected ? 'bg-primary/15' : 'bg-background',
      )}
    >
      <svg viewBox="0 0 28 28" className="absolute inset-0 w-7 h-7 -rotate-90">
        <circle
          cx="14"
          cy="14"
          r={R}
          fill="none"
          strokeWidth="2.5"
          className={unavailable ? 'stroke-muted/50' : 'stroke-muted'}
          strokeDasharray={unavailable ? '2 3' : undefined}
        />
        {doneLen > 0 && (
          <circle
            cx="14"
            cy="14"
            r={R}
            fill="none"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeDasharray={`${doneLen} ${C}`}
            className="stroke-emerald-400"
          />
        )}
        {planLen > 0 && (
          <circle
            cx="14"
            cy="14"
            r={R}
            fill="none"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeDasharray={`${planLen} ${C}`}
            strokeDashoffset={-doneLen}
            className="stroke-teal-500/40"
          />
        )}
      </svg>
      <span
        className={cn(
          'text-[8px] font-bold tabular-nums leading-none',
          selected ? 'text-primary' : 'text-muted-foreground',
        )}
      >
        {unavailable ? '–' : Math.round((done / safe) * 100)}
      </span>
    </span>
  );
}

export function GroupsLens({
  initialGroupId,
  onInspectUnit,
}: {
  // Arriving from the Sheets tab's "See full coverage" link: open THAT group
  // rather than the first on the rail.
  initialGroupId?: Id<'groups'> | null;
  // A unit with no questions entered hands off to the Bank lens: coverage
  // gaps are what drive which unit to photograph next.
  onInspectUnit?: (unitId: string) => void;
}) {
  const [term, setTerm] = useState<number | null>(null);
  const [groupId, setGroupId] = useState<Id<'groups'> | null>(
    initialGroupId ?? null,
  );

  const summary = useCachedQuery(
    api.learningEngine.groupPlan.groupsTermCoverageSummary,
    term !== null ? { term } : {},
  );

  const rows: SummaryRow[] = useMemo(() => summary ?? [], [summary]);
  const okRows = useMemo(() => rows.filter((r) => r.status === 'ok'), [rows]);

  // Every term any group's track can show, so the chips don't depend on which
  // group happens to be selected.
  const allTerms = useMemo(() => {
    const s = new Set<number>();
    for (const r of okRows) for (const t of r.availableTerms) s.add(t);
    return Array.from(s).sort((a, b) => a - b);
  }, [okRows]);

  // Pin the term the backend resolved on first load, so every ring is
  // comparing the SAME term rather than each group's own default.
  useEffect(() => {
    if (term === null && okRows.length > 0 && okRows[0].term !== null) {
      setTerm(okRows[0].term);
    }
  }, [term, okRows]);

  useEffect(() => {
    if (okRows.length === 0) return;
    if (!groupId || !okRows.some((r) => r.groupId === groupId)) {
      setGroupId(okRows[0].groupId);
    }
  }, [okRows, groupId]);

  if (summary === undefined) {
    return (
      <div className="space-y-2 animate-pulse">
        <div className="h-14 bg-muted rounded-xl" />
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-14 bg-muted rounded-xl" />
        ))}
      </div>
    );
  }

  if (summary === null) {
    return (
      <div className="rounded-xl border border-border bg-card p-4 text-center">
        <p className="text-sm text-muted-foreground">Sign in required.</p>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card p-6 text-center">
        <p className="text-sm text-muted-foreground">No groups yet.</p>
        <p className="text-[11px] text-muted-foreground mt-1">
          Put students into a group on the Week view to see its coverage here.
        </p>
      </div>
    );
  }

  const selected = rows.find((r) => r.groupId === groupId) ?? null;

  return (
    <div>
      {/* Term chips — the rail and the cockpit below both follow these */}
      {allTerms.length > 0 && (
        <div className="flex items-center gap-1.5 mb-3">
          <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mr-0.5">
            Term
          </span>
          {allTerms.map((t) => (
            <button
              key={t}
              onClick={() => setTerm(t)}
              className={cn(
                'w-8 h-8 rounded-lg border text-xs font-bold',
                t === term
                  ? 'border-primary/60 bg-primary/10 text-foreground'
                  : 'border-border bg-card text-muted-foreground',
              )}
            >
              {t}
            </button>
          ))}
        </div>
      )}

      {/* The group rail — every group's term coverage on one line */}
      <div className="overflow-x-auto pb-1 mb-3">
        <div className="relative flex items-start gap-1 w-max px-1">
          {/* the line joining the stations, behind the rings */}
          {rows.length > 1 && (
            <span className="absolute top-[14px] left-8 right-8 h-px bg-border" />
          )}
          {rows.map((r) => {
            const isSel = r.groupId === groupId;
            const unavailable = r.status !== 'ok';
            return (
              <button
                key={r.groupId as unknown as string}
                onClick={() => !unavailable && setGroupId(r.groupId)}
                disabled={unavailable}
                title={
                  unavailable
                    ? `${r.name} — ${STATUS_REASON[r.status] ?? r.status}`
                    : `${r.name} — ${r.doneCount} taught of ${r.plannableTotal}`
                }
                className={cn(
                  'relative z-10 flex flex-col items-center gap-1 w-16 shrink-0',
                  unavailable && 'opacity-50 cursor-default',
                )}
              >
                <GroupRing
                  done={r.doneCount}
                  planned={r.plannedCount}
                  total={r.plannableTotal}
                  selected={isSel}
                  unavailable={unavailable}
                />
                <span
                  className={cn(
                    'text-[9px] font-semibold leading-tight w-full text-center truncate',
                    isSel ? 'text-foreground' : 'text-muted-foreground',
                  )}
                >
                  {r.name}
                </span>
                <span className="text-[8px] text-muted-foreground leading-none">
                  {unavailable
                    ? (STATUS_REASON[r.status] ?? r.status)
                    : r.grade !== null
                      ? `G${r.grade}`
                      : ''}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Rail legend */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-3 text-[8.5px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded-full border-2 border-emerald-400" />
          taught
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded-full border-2 border-teal-500/40" />
          planned
        </span>
        <span className="flex items-center gap-1">
          <Users className="w-2.5 h-2.5" />
          tap a group to open its term
        </span>
      </div>

      {/* The tapped group's cockpit — the term chips live on the rail above,
          so it hides its own. */}
      {selected && selected.status === 'ok' && (
        <>
          <div className="flex items-baseline gap-2 mb-2">
            <h2 className="text-xs font-bold text-foreground uppercase tracking-wide">
              {selected.name}
            </h2>
            <span className="text-[10px] text-muted-foreground">
              {selected.pct}% of Term {selected.term} taught
              {selected.plannedCount > 0 && ` · ${selected.plannedCount} planned`}
              {selected.needsBookCount > 0 &&
                ` · ${selected.needsBookCount} unit${selected.needsBookCount === 1 ? '' : 's'} need book`}
            </span>
          </div>
          <GroupCoverage
            groupId={selected.groupId}
            term={term}
            setTerm={setTerm}
            hideTermChips
            showReplan
            onInspectUnit={onInspectUnit}
          />
        </>
      )}
    </div>
  );
}
