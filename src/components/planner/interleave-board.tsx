'use client';

// InterleaveBoard — the glass box for the interleaving engine (Phase B,
// 2026-07-26). The founder's brief: "the algorithm becomes a black box, I
// can't use it efficiently and can't tune it."
//
// So this screen never says "trust me". It shows, in one picture:
//   THE WEAVE   rows = units, columns = sessions. A filled cell means that
//               session teaches that unit's green; the bar's width is how
//               many questions. A blue dot means a hard question returns
//               from that unit. Interleaving becomes a visible pattern, and
//               a unit going cold becomes a visible gap.
//   WHY         tap a session → the units it teaches, each with the reason
//               the engine chose it (stale 6d / exam in 9d / new / pinned).
//   TUNE        the same card carries that session's levers — units, green
//               count (the truncate point), returns. Saving writes a
//               per-date override; the board redraws from the SAME pure
//               planner that crystallize runs, so the preview is the print.
//
// Everything is phone-first: the weave scrolls horizontally with a sticky
// unit column; the detail card is a normal block below it, not a drawer.

import { useEffect, useMemo, useState } from 'react';
import { useMutation } from 'convex/react';
import {
  AlertTriangle,
  Check,
  Hourglass,
  Layers,
  Pin,
  RotateCcw,
  Sparkles,
  Timer,
  TriangleAlert,
} from 'lucide-react';
import { toast } from 'sonner';
import { api, type Id } from '@/lib/convex';
import { cn } from '@/lib/utils';
import { useCachedQuery } from '@/hooks/use-cached-query';
import { useUnitName } from './group-plan-card';

type Choice = {
  unitId: string;
  reason: 'pinned' | 'deadline' | 'new' | 'stale';
  daysSinceGreen: number | null;
  greenCount: number;
};

type BoardSession = {
  date: string;
  source: 'planned' | 'projected';
  sheetId: Id<'groupSheets'> | null;
  status: string | null;
  unitIds: string[];
  choices: Choice[];
  greenCount: number;
  blueCount: number;
  spiralCount: number;
  carryCount: number;
  blueBacklog: number;
  openUnitIds: string[];
};

type BoardUnit = {
  unitId: string;
  order: number;
  term: number | null;
  examDate: string | null;
  greenLeft: number;
  blueLeft: number;
  yellowLeft: number;
  done: number;
  total: number;
  avgR: number | null;
  preTaught: boolean;
};

function fmtDay(ymd: string): { day: string; mon: string; dow: string } {
  const d = new Date(`${ymd}T00:00:00`);
  return {
    day: String(d.getDate()),
    mon: d.toLocaleDateString('en-US', { month: 'short' }),
    dow: d.toLocaleDateString('en-US', { weekday: 'narrow' }),
  };
}

const REASON_LABEL: Record<Choice['reason'], string> = {
  pinned: 'you pinned it',
  deadline: 'exam close',
  new: 'first time',
  stale: 'rested longest',
};

const REASON_ICON: Record<Choice['reason'], typeof Pin> = {
  pinned: Pin,
  deadline: AlertTriangle,
  new: Sparkles,
  stale: Timer,
};

export function InterleaveBoard({ groupId }: { groupId: Id<'groups'> }) {
  const [weeks, setWeeks] = useState(10);
  const data = useCachedQuery(
    api.learningEngine.groupPlan.groupInterleaveBoard,
    { groupId, weeks },
  );
  const setLevers = useMutation(
    api.learningEngine.groupPlan.setGroupInterleaveLevers,
  );
  const setOverride = useMutation(
    api.learningEngine.groupPlan.setSessionPlanOverride,
  );
  const replanTerm = useMutation(api.learningEngine.groupPlan.replanTerm);
  const unitName = useUnitName();

  const [selDate, setSelDate] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const ok = data && 'status' in data && data.status === 'ok';
  const sessions: BoardSession[] = useMemo(
    () => (ok ? ((data as { sessions: BoardSession[] }).sessions ?? []) : []),
    [data, ok],
  );
  const units: BoardUnit[] = useMemo(
    () => (ok ? ((data as { units: BoardUnit[] }).units ?? []) : []),
    [data, ok],
  );

  // Only units that actually appear in the horizon get a lane — an 80-unit
  // track would otherwise render 80 empty rows on a phone.
  const laneUnits = useMemo(() => {
    const live = new Set<string>();
    for (const s of sessions) {
      for (const u of s.unitIds) live.add(u);
      for (const u of s.openUnitIds) live.add(u);
    }
    return units
      .filter((u) => live.has(u.unitId))
      .sort((a, b) => a.order - b.order);
  }, [sessions, units]);

  useEffect(() => {
    setSelDate(null);
  }, [groupId]);

  const selected = useMemo(
    () => sessions.find((s) => s.date === selDate) ?? null,
    [sessions, selDate],
  );

  if (data === undefined) {
    return (
      <div className="space-y-2 animate-pulse p-3">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="h-9 bg-muted rounded-lg" />
        ))}
      </div>
    );
  }
  if (!ok) {
    return (
      <div className="p-4 text-center text-sm text-muted-foreground">
        The weave needs members, a track and weekly sessions first (
        {(data as { status?: string } | null)?.status ?? 'no data'}).
      </div>
    );
  }

  const board = data as unknown as {
    todayYmd: string;
    trackName: string;
    mainSize: number;
    levers: { unitsPerSession: number; openCap: number; returnShare: number };
    defaults: {
      unitsPerSession: number;
      openCap: number;
      returnShare: number;
    };
    blueGapAfterYellow: number;
    blueGapNoYellow: number;
    hasRevisionCapacity: boolean;
    totals: { green: number; blue: number; yellow: number; spiral: number };
    greenLeftover: number;
    blueWaiting: Array<{ unitId: string; count: number }>;
    blueWaitingTotal: number;
    overrides: Array<{ date: string }>;
  };
  const overrideDates = new Set(board.overrides.map((o) => o.date));

  const saveLever = async (
    patch: Partial<{
      unitsPerSession: number;
      openCap: number;
      returnShare: number;
    }>,
  ) => {
    setBusy(true);
    try {
      await setLevers({ groupId, ...patch });
      toast.success('Lever saved — run Re-plan to apply it to planned sheets.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  };

  const maxGreen = Math.max(1, ...sessions.map((s) => s.greenCount));

  return (
    <div className="space-y-3">
      {/* ── Levers ────────────────────────────────────────────────────── */}
      <div className="rounded-xl border bg-card p-3 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Layers className="h-4 w-4 text-teal-500 shrink-0" />
            <span className="text-sm font-medium truncate">
              How the engine spreads {board.trackName}
            </span>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const r = await replanTerm({ groupId, daysAhead: 180 });
                toast.success(
                  `Re-planned — ${r.written} session${r.written === 1 ? '' : 's'} rebuilt.`,
                );
              } catch (e) {
                toast.error(e instanceof Error ? e.message : 'Re-plan failed');
              } finally {
                setBusy(false);
              }
            }}
            className="shrink-0 rounded-lg border px-2.5 py-1 text-xs font-medium hover:bg-accent disabled:opacity-50"
          >
            Re-plan
          </button>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <Stepper
            label="Units / session"
            hint="how many units one class teaches"
            value={board.levers.unitsPerSession}
            min={1}
            max={6}
            isDefault={
              board.levers.unitsPerSession === board.defaults.unitsPerSession
            }
            disabled={busy}
            onChange={(v) => saveLever({ unitsPerSession: v })}
          />
          <Stepper
            label="Units open"
            hint="how many units are in progress at once"
            value={board.levers.openCap}
            min={1}
            max={8}
            isDefault={board.levers.openCap === board.defaults.openCap}
            disabled={busy}
            onChange={(v) => saveLever({ openCap: v })}
          />
          <Stepper
            label="Returns %"
            hint="share of the sheet kept for blue + review"
            value={Math.round(board.levers.returnShare * 100)}
            min={0}
            max={90}
            step={5}
            suffix="%"
            isDefault={
              Math.abs(board.levers.returnShare - board.defaults.returnShare) <
              0.001
            }
            disabled={busy}
            onChange={(v) => saveLever({ returnShare: v / 100 })}
          />
        </div>

        <p className="text-[11px] leading-snug text-muted-foreground">
          Green is taught in book order until the cap, then the next unit takes
          over. Blue returns {board.blueGapAfterYellow} days after its
          concept&apos;s yellow is drilled in revision ({board.blueGapNoYellow}{' '}
          days after the intro if the concept has no yellow).
        </p>

        {!board.hasRevisionCapacity && (
          <div className="flex gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-2 text-[11px] leading-snug">
            <TriangleAlert className="h-3.5 w-3.5 shrink-0 text-amber-500 mt-0.5" />
            <span>
              This group has no revision class, so nothing routes to yellow and
              every blue falls back to the {board.blueGapNoYellow}-day rule
              after its intro. Add a revision day to get the full climb.
            </span>
          </div>
        )}
      </div>

      {/* ── Stock ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-4 gap-2">
        <Stat tone="green" label="green left" value={board.totals.green} />
        <Stat tone="amber" label="yellow" value={board.totals.yellow} />
        <Stat tone="blue" label="blue" value={board.totals.blue} />
        <Stat
          tone="muted"
          label="waiting"
          value={board.blueWaitingTotal}
          hint="blue held back until its yellow is drilled"
        />
      </div>

      {/* ── The weave ─────────────────────────────────────────────────── */}
      <div className="rounded-xl border bg-card overflow-hidden">
        <div className="flex items-center justify-between px-3 py-2 border-b">
          <span className="text-xs font-medium text-muted-foreground">
            The weave — next {weeks} weeks
          </span>
          <div className="flex gap-1">
            {[4, 10, 20].map((w) => (
              <button
                key={w}
                type="button"
                onClick={() => setWeeks(w)}
                className={cn(
                  'rounded-md px-2 py-0.5 text-[11px] font-medium',
                  weeks === w
                    ? 'bg-teal-500/15 text-teal-600 dark:text-teal-400'
                    : 'text-muted-foreground hover:bg-accent',
                )}
              >
                {w}w
              </button>
            ))}
          </div>
        </div>

        {laneUnits.length === 0 || sessions.length === 0 ? (
          <div className="p-4 text-center text-sm text-muted-foreground">
            Nothing to weave yet — no upcoming sessions, or the book has no
            green questions left on this track.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <div className="min-w-max">
              {/* date header */}
              <div className="flex sticky top-0 z-20 bg-card border-b">
                <div className="w-28 shrink-0 sticky left-0 z-30 bg-card border-r px-2 py-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  Unit
                </div>
                {sessions.map((s) => {
                  const d = fmtDay(s.date);
                  const sel = s.date === selDate;
                  return (
                    <button
                      key={s.date}
                      type="button"
                      onClick={() => setSelDate(sel ? null : s.date)}
                      className={cn(
                        'w-11 shrink-0 border-r last:border-r-0 py-1 text-center transition-colors',
                        sel ? 'bg-teal-500/15' : 'hover:bg-accent',
                      )}
                    >
                      <div className="text-[9px] leading-none text-muted-foreground">
                        {d.dow}
                      </div>
                      <div className="text-[12px] leading-tight font-semibold tabular-nums">
                        {d.day}
                      </div>
                      <div className="text-[9px] leading-none text-muted-foreground">
                        {d.mon}
                      </div>
                      <div className="mt-0.5 flex justify-center gap-0.5">
                        {s.source === 'planned' && (
                          <span
                            className="h-1 w-1 rounded-full bg-teal-500"
                            title="sheet already built"
                          />
                        )}
                        {overrideDates.has(s.date) && (
                          <span
                            className="h-1 w-1 rounded-full bg-fuchsia-500"
                            title="you set this session by hand"
                          />
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* unit lanes */}
              {laneUnits.map((u) => (
                <div key={u.unitId} className="flex border-b last:border-b-0">
                  <div
                    className={cn(
                      'w-28 shrink-0 sticky left-0 z-10 bg-card border-r px-2 py-1.5',
                    )}
                  >
                    <div className="truncate text-[11px] font-medium leading-tight">
                      {unitName(u.unitId)}
                    </div>
                    <div className="flex items-center gap-1.5 text-[9px] text-muted-foreground tabular-nums">
                      <span className="text-emerald-600 dark:text-emerald-400">
                        {u.greenLeft}g
                      </span>
                      <span className="text-amber-600 dark:text-amber-400">
                        {u.yellowLeft}y
                      </span>
                      <span className="text-sky-600 dark:text-sky-400">
                        {u.blueLeft}b
                      </span>
                    </div>
                  </div>
                  {sessions.map((s) => {
                    const c = s.choices.find((x) => x.unitId === u.unitId);
                    const open = s.openUnitIds.includes(u.unitId);
                    const sel = s.date === selDate;
                    const w = c
                      ? Math.max(20, Math.round((c.greenCount / maxGreen) * 100))
                      : 0;
                    return (
                      <button
                        key={s.date}
                        type="button"
                        onClick={() => setSelDate(sel ? null : s.date)}
                        className={cn(
                          'w-11 shrink-0 border-r last:border-r-0 h-9 px-1 flex items-center justify-center transition-colors',
                          sel && 'bg-teal-500/10',
                        )}
                        title={
                          c
                            ? `${unitName(u.unitId)} · ${c.greenCount} green · ${REASON_LABEL[c.reason]}`
                            : open
                              ? `${unitName(u.unitId)} — open, resting this session`
                              : undefined
                        }
                      >
                        {c ? (
                          <span
                            className={cn(
                              'h-4 rounded-full',
                              c.reason === 'deadline'
                                ? 'bg-rose-500'
                                : c.reason === 'pinned'
                                  ? 'bg-fuchsia-500'
                                  : 'bg-emerald-500',
                            )}
                            style={{ width: `${w}%` }}
                          />
                        ) : open ? (
                          <span className="h-1 w-1 rounded-full bg-muted-foreground/35" />
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              ))}

              {/* returns lane — blue + spiral, the bottom rail */}
              <div className="flex border-t bg-muted/30">
                <div className="w-28 shrink-0 sticky left-0 z-10 bg-muted/30 border-r px-2 py-1.5">
                  <div className="text-[11px] font-medium leading-tight">
                    Returns
                  </div>
                  <div className="text-[9px] text-muted-foreground">
                    blue + review
                  </div>
                </div>
                {sessions.map((s) => {
                  const sel = s.date === selDate;
                  return (
                    <button
                      key={s.date}
                      type="button"
                      onClick={() => setSelDate(sel ? null : s.date)}
                      className={cn(
                        'w-11 shrink-0 border-r last:border-r-0 h-9 flex items-center justify-center gap-0.5',
                        sel && 'bg-teal-500/10',
                      )}
                      title={`${s.blueCount} blue · ${s.spiralCount} review${s.blueBacklog > 0 ? ` · ${s.blueBacklog} blue waiting for room` : ''}`}
                    >
                      {Array.from({ length: Math.min(3, s.blueCount) }).map(
                        (_, i) => (
                          <span
                            key={`b${i}`}
                            className="h-1.5 w-1.5 rounded-full bg-sky-500"
                          />
                        ),
                      )}
                      {Array.from({ length: Math.min(2, s.spiralCount) }).map(
                        (_, i) => (
                          <span
                            key={`s${i}`}
                            className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40"
                          />
                        ),
                      )}
                      {s.blueBacklog > 0 && (
                        <span className="text-[8px] font-semibold text-rose-500 tabular-nums">
                          +{s.blueBacklog}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Blue waiting on yellow ────────────────────────────────────── */}
      {board.blueWaitingTotal > 0 && (
        <div className="rounded-xl border border-sky-500/30 bg-sky-500/5 p-3">
          <div className="flex items-center gap-2 mb-1.5">
            <Hourglass className="h-3.5 w-3.5 text-sky-500" />
            <span className="text-xs font-medium">
              {board.blueWaitingTotal} blue waiting on their yellow
            </span>
          </div>
          <p className="text-[11px] leading-snug text-muted-foreground mb-2">
            These hard questions stay out of Main until the revision class
            drills their concept&apos;s yellow. That is deliberate — but if a
            unit sits here for weeks, its revision queue is the bottleneck.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {board.blueWaiting.slice(0, 12).map((w) => (
              <span
                key={w.unitId}
                className="rounded-md bg-sky-500/10 px-2 py-0.5 text-[10px] font-medium text-sky-700 dark:text-sky-300"
              >
                {unitName(w.unitId)} · {w.count}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ── Session detail + per-session levers ───────────────────────── */}
      {selected && (
        <SessionCard
          key={selected.date}
          groupId={groupId}
          session={selected}
          mainSize={board.mainSize}
          levers={board.levers}
          hasOverride={overrideDates.has(selected.date)}
          allUnits={laneUnits}
          unitName={unitName}
          onSave={async (patch) => {
            setBusy(true);
            try {
              await setOverride({ groupId, date: selected.date, ...patch });
              toast.success('Session plan saved — Re-plan to build the sheet.');
            } catch (e) {
              toast.error(e instanceof Error ? e.message : 'Could not save');
            } finally {
              setBusy(false);
            }
          }}
        />
      )}

      {board.greenLeftover > 0 && (
        <p className="px-1 text-[11px] text-muted-foreground">
          {board.greenLeftover} green questions sit beyond this horizon — widen
          the window or add sessions to see where they land.
        </p>
      )}
    </div>
  );
}

// ── Session detail card ─────────────────────────────────────────────────

function SessionCard({
  groupId,
  session,
  mainSize,
  levers,
  hasOverride,
  allUnits,
  unitName,
  onSave,
}: {
  groupId: Id<'groups'>;
  session: BoardSession;
  mainSize: number;
  levers: { unitsPerSession: number; openCap: number; returnShare: number };
  hasOverride: boolean;
  allUnits: BoardUnit[];
  unitName: (unitId: string) => string;
  onSave: (patch: {
    unitsPerSession?: number | null;
    greenCount?: number | null;
    returnCount?: number | null;
    unitIds?: string[] | null;
  }) => Promise<void>;
}) {
  void groupId;
  const [nUnits, setNUnits] = useState(
    session.unitIds.length || levers.unitsPerSession,
  );
  const [green, setGreen] = useState(session.greenCount);
  const [returns, setReturns] = useState(session.blueCount + session.spiralCount);
  const [pinned, setPinned] = useState<string[]>([]);

  const locked = session.status === 'materialized' || session.status === 'delegated';
  const total =
    session.carryCount +
    session.greenCount +
    session.blueCount +
    session.spiralCount;
  const seg = (n: number) => (total > 0 ? (n / total) * 100 : 0);

  const d = new Date(`${session.date}T00:00:00`);
  const title = d.toLocaleDateString('en-US', {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
  });

  return (
    <div className="rounded-xl border bg-card p-3 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-semibold">{title}</div>
          <div className="text-[11px] text-muted-foreground">
            {session.source === 'planned'
              ? `Sheet built${session.status ? ` · ${session.status}` : ''}`
              : 'Projected — not built yet'}
            {' · '}
            {total} questions
          </div>
        </div>
        {hasOverride && (
          <button
            type="button"
            onClick={() =>
              onSave({
                unitsPerSession: null,
                greenCount: null,
                returnCount: null,
                unitIds: null,
              })
            }
            className="shrink-0 flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-medium hover:bg-accent"
          >
            <RotateCcw className="h-3 w-3" />
            Auto
          </button>
        )}
      </div>

      {/* composition bar */}
      <div>
        <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted">
          {session.carryCount > 0 && (
            <div
              className="bg-orange-400"
              style={{ width: `${seg(session.carryCount)}%` }}
            />
          )}
          <div
            className="bg-emerald-500"
            style={{ width: `${seg(session.greenCount)}%` }}
          />
          <div
            className="bg-sky-500"
            style={{ width: `${seg(session.blueCount)}%` }}
          />
          <div
            className="bg-muted-foreground/40"
            style={{ width: `${seg(session.spiralCount)}%` }}
          />
        </div>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground">
          {session.carryCount > 0 && (
            <Legend color="bg-orange-400" label={`${session.carryCount} carried over`} />
          )}
          <Legend color="bg-emerald-500" label={`${session.greenCount} green`} />
          <Legend color="bg-sky-500" label={`${session.blueCount} blue back`} />
          <Legend
            color="bg-muted-foreground/40"
            label={`${session.spiralCount} review`}
          />
        </div>
      </div>

      {/* why these units */}
      <div className="space-y-1.5">
        {session.choices.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">
            No new teaching this session — the sheet is all returns.
          </p>
        ) : (
          session.choices.map((c) => {
            const Icon = REASON_ICON[c.reason];
            return (
              <div
                key={c.unitId}
                className="flex items-center gap-2 rounded-lg bg-muted/50 px-2 py-1.5"
              >
                <span className="text-[11px] font-medium truncate flex-1 min-w-0">
                  {unitName(c.unitId)}
                </span>
                <span className="shrink-0 text-[10px] tabular-nums text-emerald-600 dark:text-emerald-400">
                  {c.greenCount} green
                </span>
                <span className="shrink-0 flex items-center gap-1 rounded-md bg-background px-1.5 py-0.5 text-[9px] text-muted-foreground">
                  <Icon className="h-2.5 w-2.5" />
                  {c.reason === 'stale' && c.daysSinceGreen !== null
                    ? `rested ${c.daysSinceGreen}d`
                    : REASON_LABEL[c.reason]}
                </span>
              </div>
            );
          })
        )}
      </div>

      {/* per-session levers */}
      {locked ? (
        <p className="rounded-lg bg-muted/50 px-2 py-1.5 text-[11px] text-muted-foreground">
          This session has already been taught — its plan is history now.
        </p>
      ) : (
        <div className="space-y-2 border-t pt-3">
          <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Plan this session by hand
          </div>
          <div className="grid grid-cols-3 gap-2">
            <Stepper
              label="Units"
              value={nUnits}
              min={1}
              max={6}
              onChange={setNUnits}
            />
            <Stepper
              label="Green"
              value={green}
              min={0}
              max={mainSize}
              onChange={setGreen}
            />
            <Stepper
              label="Returns"
              value={returns}
              min={0}
              max={mainSize}
              onChange={setReturns}
            />
          </div>

          <div>
            <div className="mb-1 text-[10px] text-muted-foreground">
              Pin exact units (optional — overrides the engine&apos;s choice)
            </div>
            <div className="flex flex-wrap gap-1.5">
              {allUnits
                .filter((u) => u.greenLeft > 0)
                .slice(0, 10)
                .map((u) => {
                  const on = pinned.includes(u.unitId);
                  return (
                    <button
                      key={u.unitId}
                      type="button"
                      onClick={() =>
                        setPinned((p) =>
                          on
                            ? p.filter((x) => x !== u.unitId)
                            : [...p, u.unitId],
                        )
                      }
                      className={cn(
                        'rounded-md border px-2 py-0.5 text-[10px] font-medium transition-colors',
                        on
                          ? 'border-fuchsia-500 bg-fuchsia-500/15 text-fuchsia-700 dark:text-fuchsia-300'
                          : 'hover:bg-accent',
                      )}
                    >
                      {on && <Pin className="mr-1 inline h-2.5 w-2.5" />}
                      {unitName(u.unitId)}
                    </button>
                  );
                })}
            </div>
          </div>

          <button
            type="button"
            onClick={() =>
              onSave({
                unitsPerSession: nUnits,
                greenCount: green,
                returnCount: returns,
                unitIds: pinned.length > 0 ? pinned : null,
              })
            }
            className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-teal-600 px-3 py-2 text-xs font-semibold text-white hover:bg-teal-700"
          >
            <Check className="h-3.5 w-3.5" />
            Save this session&apos;s plan
          </button>
          <p className="text-[10px] leading-snug text-muted-foreground">
            Saved plans survive re-planning. Run{' '}
            <span className="font-medium">Re-plan</span> above to rebuild the
            sheets with your choices.
          </p>
        </div>
      )}
    </div>
  );
}

// ── Small pieces ────────────────────────────────────────────────────────

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className={cn('h-1.5 w-1.5 rounded-full', color)} />
      {label}
    </span>
  );
}

function Stat({
  tone,
  label,
  value,
  hint,
}: {
  tone: 'green' | 'amber' | 'blue' | 'muted';
  label: string;
  value: number;
  hint?: string;
}) {
  const toneCls = {
    green: 'text-emerald-600 dark:text-emerald-400',
    amber: 'text-amber-600 dark:text-amber-400',
    blue: 'text-sky-600 dark:text-sky-400',
    muted: 'text-muted-foreground',
  }[tone];
  return (
    <div className="rounded-lg border bg-card px-2 py-1.5" title={hint}>
      <div className={cn('text-base font-semibold tabular-nums', toneCls)}>
        {value}
      </div>
      <div className="text-[10px] leading-tight text-muted-foreground">
        {label}
      </div>
    </div>
  );
}

function Stepper({
  label,
  hint,
  value,
  min,
  max,
  step = 1,
  suffix,
  isDefault,
  disabled,
  onChange,
}: {
  label: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  isDefault?: boolean;
  disabled?: boolean;
  onChange: (v: number) => void;
}) {
  return (
    <div className="rounded-lg border bg-background p-1.5" title={hint}>
      <div className="mb-1 truncate text-[9px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="flex items-center justify-between gap-1">
        <button
          type="button"
          disabled={disabled || value <= min}
          onClick={() => onChange(Math.max(min, value - step))}
          className="h-6 w-6 shrink-0 rounded-md border text-sm leading-none disabled:opacity-30 hover:bg-accent"
        >
          −
        </button>
        <span
          className={cn(
            'text-sm font-semibold tabular-nums',
            isDefault === false && 'text-teal-600 dark:text-teal-400',
          )}
        >
          {value}
          {suffix}
        </span>
        <button
          type="button"
          disabled={disabled || value >= max}
          onClick={() => onChange(Math.min(max, value + step))}
          className="h-6 w-6 shrink-0 rounded-md border text-sm leading-none disabled:opacity-30 hover:bg-accent"
        >
          +
        </button>
      </div>
    </div>
  );
}
