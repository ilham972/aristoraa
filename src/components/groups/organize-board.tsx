'use client';

// The "Group" view — reorganize rosters when new students join or someone
// needs a different class. Grade-scoped board: pick a grade, every group that
// accepts it becomes a column (+ an Unassigned column). Tap a student to pick
// them up, then tap any column to stage a move there. Nothing is written until
// "Save changes" — moves stage locally so a big reshuffle can be reviewed
// first, then committed atomically by api.groups.applyRosterMoves.

import { useMemo, useState } from 'react';
import { useMutation } from 'convex/react';
import { useCachedQuery as useQuery } from '@/hooks/use-cached-query';
import { toast } from 'sonner';
import { ArrowLeftRight, Check, RotateCcw, Users, X } from 'lucide-react';
import { api, type Id } from '@/lib/convex';
import { cn } from '@/lib/utils';
import { DAYS, fmtTime12 } from '@/lib/groups/time-grid';
import { groupColor } from '@/lib/groups/color';

// Sentinel column id for the Unassigned pile (no group, no cap). Kept local so
// this client file doesn't reach into convex/; ops send null for "unassigned".
const UNASSIGNED = '__unassigned__';

type Chip = { studentId: Id<'students'>; name: string };

function sessionLabel(s: { dayOfWeek: number; startTime: string } | null): string | null {
  if (!s) return null;
  const day = DAYS.find((d) => d.num === s.dayOfWeek)?.short ?? '';
  return `${day} · ${fmtTime12(s.startTime)}`;
}

export function OrganizeBoard() {
  const grades = useQuery(api.groups.gradeOptions);
  const [grade, setGrade] = useState<number | null>(null);

  // Default to the first available grade once the list arrives.
  const activeGrade = grade ?? grades?.[0] ?? null;

  const board = useQuery(
    api.groups.gradeBoard,
    activeGrade != null ? { grade: activeGrade } : 'skip',
  );

  // Staged moves: studentId → target column id (groupId or UNASSIGNED).
  const [pending, setPending] = useState<Map<string, string>>(new Map());
  // Currently "picked up" student, awaiting a destination tap.
  const [picked, setPicked] = useState<Id<'students'> | null>(null);
  const [saving, setSaving] = useState(false);

  const applyMoves = useMutation(api.groups.applyRosterMoves);

  // Where each movable student currently lives (their home column), plus a
  // flat name lookup. Rebuilt from the server snapshot every render.
  const { origin, nameById, allMovable, fixedCountByGroup, capByGroup } = useMemo(() => {
    const origin = new Map<string, string>();
    const nameById = new Map<string, string>();
    const allMovable: Chip[] = [];
    const fixedCountByGroup = new Map<string, number>();
    const capByGroup = new Map<string, number>();
    if (board) {
      for (const col of board.columns) {
        capByGroup.set(col.groupId, col.cap);
        // Locked members (other-grade / multi-group) never move but still
        // occupy a seat against the cap.
        fixedCountByGroup.set(col.groupId, col.count - col.chips.length);
        for (const c of col.chips) {
          origin.set(c.studentId, col.groupId);
          nameById.set(c.studentId, c.name);
          allMovable.push(c);
        }
      }
      for (const c of board.unassigned) {
        origin.set(c.studentId, UNASSIGNED);
        nameById.set(c.studentId, c.name);
        allMovable.push(c);
      }
    }
    return { origin, nameById, allMovable, fixedCountByGroup, capByGroup };
  }, [board]);

  // Effective column for a student = staged target, else home column.
  const effectiveCol = (studentId: string) => pending.get(studentId) ?? origin.get(studentId)!;

  // Live headcount for a group = locked seats + movable students now placed
  // there. Unassigned has no cap so it isn't tracked here.
  const liveCount = (colId: string): number => {
    if (colId === UNASSIGNED) return allMovable.filter((c) => effectiveCol(c.studentId) === UNASSIGNED).length;
    const fixed = fixedCountByGroup.get(colId) ?? 0;
    const moved = allMovable.filter((c) => effectiveCol(c.studentId) === colId).length;
    return fixed + moved;
  };

  const pendingCount = useMemo(() => {
    let n = 0;
    for (const [studentId, target] of Array.from(pending.entries())) {
      if (target !== origin.get(studentId)) n += 1;
    }
    return n;
  }, [pending, origin]);

  const resetGrade = (g: number) => {
    setGrade(g);
    setPending(new Map());
    setPicked(null);
  };

  // Stage the picked student into `target` (a column id).
  const dropInto = (target: string) => {
    if (!picked) return;
    const home = origin.get(picked)!;
    if (effectiveCol(picked) === target) {
      setPicked(null);
      return;
    }
    if (target !== UNASSIGNED) {
      const cap = capByGroup.get(target) ?? 10;
      if (liveCount(target) >= cap) {
        toast.error(`That group is full (max ${cap})`);
        return;
      }
    }
    setPending((prev) => {
      const next = new Map(prev);
      if (target === home) next.delete(picked); // back home → no longer a change
      else next.set(picked, target);
      return next;
    });
    setPicked(null);
  };

  const onChipTap = (studentId: Id<'students'>, colId: string) => {
    if (picked === studentId) {
      setPicked(null); // tap the picked chip again to cancel
    } else if (picked) {
      dropInto(colId); // tapping a chip in another column drops onto that column
    } else {
      setPicked(studentId);
    }
  };

  const discard = () => {
    setPending(new Map());
    setPicked(null);
  };

  const save = async () => {
    const ops: Array<{
      studentId: Id<'students'>;
      fromGroupId: Id<'groups'> | null;
      toGroupId: Id<'groups'> | null;
    }> = [];
    for (const [studentId, target] of Array.from(pending.entries())) {
      const home = origin.get(studentId);
      if (target === home) continue;
      ops.push({
        studentId: studentId as Id<'students'>,
        fromGroupId: home === UNASSIGNED ? null : (home as Id<'groups'>),
        toGroupId: target === UNASSIGNED ? null : (target as Id<'groups'>),
      });
    }
    if (ops.length === 0) return;
    setSaving(true);
    try {
      const res = await applyMoves({ ops });
      toast.success(`Saved ${res.applied} move${res.applied === 1 ? '' : 's'}`);
      setPending(new Map());
      setPicked(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not save moves';
      // Convex wraps thrown ConvexError messages; show the human part.
      toast.error(msg.replace(/^.*ConvexError:\s*/, ''));
    } finally {
      setSaving(false);
    }
  };

  // ── Loading / empty ───────────────────────────────────────────────────────
  if (grades === undefined) {
    return (
      <div className="flex-1 min-h-0 animate-pulse flex gap-2">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="w-44 rounded-xl bg-muted/30" />
        ))}
      </div>
    );
  }
  if (grades.length === 0) {
    return (
      <div className="flex-1 min-h-0 flex items-center justify-center">
        <p className="text-sm text-muted-foreground">No students yet.</p>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {/* Grade picker + pending controls */}
      <div className="shrink-0 flex items-center gap-2 mb-2 flex-wrap">
        <div className="flex items-center gap-1 overflow-x-auto">
          {grades.map((g) => (
            <button
              key={g}
              onClick={() => resetGrade(g)}
              className={cn(
                'shrink-0 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors',
                g === activeGrade
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-muted/70',
              )}
            >
              Grade {g}
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          {pendingCount > 0 && (
            <span className="text-[11px] font-medium text-amber-600 tabular-nums">
              {pendingCount} pending
            </span>
          )}
          <button
            onClick={discard}
            disabled={pendingCount === 0 || saving}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium border border-border/60 text-muted-foreground disabled:opacity-40 hover:bg-muted transition-colors"
          >
            <RotateCcw className="w-3 h-3" /> Discard
          </button>
          <button
            onClick={save}
            disabled={pendingCount === 0 || saving}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-primary text-primary-foreground disabled:opacity-40 hover:bg-primary/90 transition-colors"
          >
            <Check className="w-3 h-3" /> {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>

      {/* Columns */}
      {board === undefined ? (
        <div className="flex-1 min-h-0 animate-pulse flex gap-2">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="w-44 rounded-xl bg-muted/30" />
          ))}
        </div>
      ) : board.columns.length === 0 ? (
        <div className="flex-1 min-h-0 flex items-center justify-center">
          <div className="rounded-xl border border-dashed border-border/60 px-6 py-8 text-center max-w-xs">
            <p className="text-sm text-muted-foreground mb-1">No groups for Grade {activeGrade}.</p>
            <p className="text-xs text-muted-foreground">Create one in the Week view first.</p>
          </div>
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-x-auto -mx-3 px-3 pb-2">
          <div className="flex gap-2 h-full">
            {board.columns.map((col) => (
              <Column
                key={col.groupId}
                colId={col.groupId}
                title={col.name}
                subtitle={sessionLabel(col.firstSession)}
                count={liveCount(col.groupId)}
                cap={col.cap}
                lockedCount={col.lockedCount}
                accentSeed={col.groupId}
                chips={allMovable.filter((c) => effectiveCol(c.studentId) === col.groupId)}
                picked={picked}
                pending={pending}
                origin={origin}
                onChipTap={onChipTap}
                onColumnTap={() => dropInto(col.groupId)}
                hasPick={picked != null}
              />
            ))}
            <Column
              colId={UNASSIGNED}
              title="Unassigned"
              subtitle="not in a group"
              count={liveCount(UNASSIGNED)}
              lockedCount={0}
              accentSeed={null}
              chips={allMovable.filter((c) => effectiveCol(c.studentId) === UNASSIGNED)}
              picked={picked}
              pending={pending}
              origin={origin}
              onChipTap={onChipTap}
              onColumnTap={() => dropInto(UNASSIGNED)}
              hasPick={picked != null}
            />
          </div>
        </div>
      )}

      {/* Moving bar */}
      {picked && (
        <div className="shrink-0 mt-2 flex items-center gap-2 rounded-xl bg-primary/10 border border-primary/30 px-3 py-2">
          <ArrowLeftRight className="w-4 h-4 text-primary shrink-0" />
          <span className="text-xs text-foreground">
            Moving <span className="font-semibold">{nameById.get(picked)}</span> — tap a group
          </span>
          <button
            onClick={() => setPicked(null)}
            className="ml-auto inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
          >
            <X className="w-3.5 h-3.5" /> Cancel
          </button>
        </div>
      )}
    </div>
  );
}

function Column({
  colId,
  title,
  subtitle,
  count,
  cap,
  lockedCount,
  accentSeed,
  chips,
  picked,
  pending,
  origin,
  onChipTap,
  onColumnTap,
  hasPick,
}: {
  colId: string;
  title: string;
  subtitle: string | null;
  count: number;
  cap?: number;
  lockedCount: number;
  accentSeed: string | null;
  chips: Chip[];
  picked: Id<'students'> | null;
  pending: Map<string, string>;
  origin: Map<string, string>;
  onChipTap: (studentId: Id<'students'>, colId: string) => void;
  onColumnTap: () => void;
  hasPick: boolean;
}) {
  const color = accentSeed ? groupColor(accentSeed) : null;
  const full = cap != null && count >= cap;

  return (
    <div
      onClick={hasPick ? onColumnTap : undefined}
      className={cn(
        'shrink-0 w-44 h-full flex flex-col rounded-xl border bg-card/40',
        hasPick ? 'cursor-pointer hover:border-primary/60' : '',
        full ? 'border-amber-500/40' : 'border-border/60',
      )}
      style={color ? { borderColor: full ? undefined : color.border } : undefined}
    >
      {/* Header */}
      <div className="shrink-0 px-2.5 py-2 border-b border-border/40">
        <div className="flex items-center justify-between gap-1">
          <p className="text-xs font-semibold text-foreground truncate" title={title}>
            {title}
          </p>
          <span
            className={cn(
              'text-[10px] font-bold tabular-nums shrink-0',
              full ? 'text-amber-600' : 'text-muted-foreground',
            )}
          >
            {count}
            {cap != null ? `/${cap}` : ''}
          </span>
        </div>
        {subtitle && <p className="text-[10px] text-muted-foreground truncate">{subtitle}</p>}
      </div>

      {/* Chips */}
      <div className="flex-1 min-h-0 overflow-y-auto p-1.5 space-y-1">
        {chips.length === 0 && (
          <p className="text-[10px] text-muted-foreground/60 text-center py-3">
            {hasPick ? 'tap to drop here' : 'empty'}
          </p>
        )}
        {chips.map((c) => {
          const isPicked = picked === c.studentId;
          const moved = pending.has(c.studentId) && pending.get(c.studentId) !== origin.get(c.studentId);
          return (
            <button
              key={c.studentId}
              onClick={(e) => {
                e.stopPropagation();
                onChipTap(c.studentId, colId);
              }}
              className={cn(
                'w-full text-left px-2 py-1.5 rounded-lg text-xs transition-all border',
                isPicked
                  ? 'bg-primary text-primary-foreground border-primary shadow-sm scale-[1.02]'
                  : moved
                    ? 'bg-amber-500/10 border-amber-500/40 text-foreground'
                    : 'bg-muted/50 border-transparent text-foreground hover:bg-muted',
              )}
            >
              <span className="truncate block">{c.name}</span>
            </button>
          );
        })}
        {lockedCount > 0 && (
          <p
            className="text-[10px] text-muted-foreground/70 text-center pt-1"
            title="Other-grade members, or students in more than one group — edit them in the group editor"
          >
            +{lockedCount} locked
          </p>
        )}
      </div>
    </div>
  );
}
