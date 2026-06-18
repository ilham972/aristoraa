'use client';

// The "Group" view — reorganize rosters when new students join or someone
// needs a different class. Grade-scoped board: pick a grade, every group that
// declares it OR holds a student of it becomes a column (+ an Unassigned
// column). EVERY member shows as a chip (off-grade members carry a grade
// badge; a student in two groups appears in each, moved independently). Tap a
// chip to pick it up, then tap any column to stage a move there. Nothing is
// written until "Save changes" — moves stage locally, then commit atomically
// via api.groups.applyRosterMoves.

import { useMemo, useState } from 'react';
import { useMutation } from 'convex/react';
import { useCachedQuery as useQuery } from '@/hooks/use-cached-query';
import { toast } from 'sonner';
import { ArrowLeftRight, Check, RotateCcw, X } from 'lucide-react';
import { api, type Id } from '@/lib/convex';
import { cn } from '@/lib/utils';
import { DAYS, fmtTime12 } from '@/lib/groups/time-grid';
import { groupColor } from '@/lib/groups/color';

// Sentinel column id for the Unassigned pile (no group, no cap). Kept local so
// this client file doesn't reach into convex/; ops send null for "unassigned".
const UNASSIGNED = '__unassigned__';

// One chip = one membership (a student in a specific column). A student in two
// groups has two chips, keyed by column, so each moves on its own.
type ChipInfo = {
  chipKey: string;
  studentId: Id<'students'>;
  name: string;
  grade: number;
  origin: string; // column id the chip starts in
};

function chipKeyOf(columnId: string, studentId: string): string {
  return `${columnId}::${studentId}`;
}

function sessionLabel(s: { dayOfWeek: number; startTime: string } | null): string | null {
  if (!s) return null;
  const day = DAYS.find((d) => d.num === s.dayOfWeek)?.short ?? '';
  return `${day} · ${fmtTime12(s.startTime)}`;
}

export function OrganizeBoard({ branch = 'live' }: { branch?: 'live' | 'draft' }) {
  // Planning mode: read/write the DRAFT roster (same draft branch as the Week
  // view) instead of live. Refs cast to their live twin's type — the draft
  // returns identical shapes (column ids are draftGroups ids at runtime). Saved
  // moves land in the draft; the live rosters change only on Merge.
  const draft = branch === 'draft';
  const grades = useQuery(api.groups.gradeOptions);
  const [grade, setGrade] = useState<number | null>(null);

  // Default to the first available grade once the list arrives.
  const activeGrade = grade ?? grades?.[0] ?? null;

  const board = useQuery(
    (draft ? api.timetableDraftEdit.gradeBoardDraft : api.groups.gradeBoard) as typeof api.groups.gradeBoard,
    activeGrade != null ? { grade: activeGrade } : 'skip',
  );

  // Staged moves: chipKey → target column id (groupId or UNASSIGNED).
  const [pending, setPending] = useState<Map<string, string>>(new Map());
  // Currently "picked up" chip, awaiting a destination tap.
  const [picked, setPicked] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const applyMoves = useMutation(
    (draft ? api.timetableDraftEdit.applyRosterMovesDraft : api.groups.applyRosterMoves) as typeof api.groups.applyRosterMoves,
  );

  // Flatten the board into chips + per-column metadata. Rebuilt every render
  // from the server snapshot.
  const { chipByKey, allChips, capByCol, acceptedByCol } = useMemo(() => {
    const chipByKey = new Map<string, ChipInfo>();
    const allChips: ChipInfo[] = [];
    const capByCol = new Map<string, number>();
    const acceptedByCol = new Map<string, number[]>();
    // Defensive against a stale cached payload (useCachedQuery replays the
    // last result on first paint; an older gradeBoard shape lacked `members`/
    // `acceptedGrades`). Default every field so a partial shape can't crash the
    // iteration — live data replaces it a moment later.
    if (board) {
      for (const col of board.columns ?? []) {
        capByCol.set(col.groupId, col.cap ?? 10);
        acceptedByCol.set(col.groupId, col.acceptedGrades ?? []);
        for (const m of col.members ?? []) {
          const info: ChipInfo = {
            chipKey: chipKeyOf(col.groupId, m.studentId),
            studentId: m.studentId as Id<'students'>,
            name: m.name,
            grade: m.grade,
            origin: col.groupId,
          };
          chipByKey.set(info.chipKey, info);
          allChips.push(info);
        }
      }
      for (const m of board.unassigned ?? []) {
        const info: ChipInfo = {
          chipKey: chipKeyOf(UNASSIGNED, m.studentId),
          studentId: m.studentId as Id<'students'>,
          name: m.name,
          grade: m.grade,
          origin: UNASSIGNED,
        };
        chipByKey.set(info.chipKey, info);
        allChips.push(info);
      }
    }
    return { chipByKey, allChips, capByCol, acceptedByCol };
  }, [board]);

  // Effective column for a chip = staged target, else its origin column.
  const effectiveCol = (chipKey: string) => pending.get(chipKey) ?? chipByKey.get(chipKey)!.origin;

  // Live headcount for a column = chips currently placed there.
  const liveCount = (colId: string): number =>
    allChips.filter((c) => effectiveCol(c.chipKey) === colId).length;

  const pendingCount = useMemo(() => {
    let n = 0;
    for (const [chipKey, target] of Array.from(pending.entries())) {
      const info = chipByKey.get(chipKey);
      if (info && target !== info.origin) n += 1;
    }
    return n;
  }, [pending, chipByKey]);

  const resetGrade = (g: number) => {
    setGrade(g);
    setPending(new Map());
    setPicked(null);
  };

  // Stage the picked chip into `target` (a column id).
  const dropInto = (target: string) => {
    if (!picked) return;
    const info = chipByKey.get(picked);
    if (!info) {
      setPicked(null);
      return;
    }
    if (effectiveCol(picked) === target) {
      setPicked(null);
      return;
    }
    // Can't land a student in a group they're already in (another membership).
    const alreadyThere = allChips.some(
      (c) => c.chipKey !== picked && c.studentId === info.studentId && effectiveCol(c.chipKey) === target,
    );
    if (alreadyThere) {
      toast.error(`${info.name} is already in that group`);
      return;
    }
    if (target !== UNASSIGNED) {
      // Grade rule (same as the backend): a typed group only accepts its grades.
      const accepted = acceptedByCol.get(target) ?? [];
      if (accepted.length > 0 && !accepted.includes(info.grade)) {
        toast.error(`${info.name} is Grade ${info.grade}; that group accepts ${accepted.join(', ')}`);
        return;
      }
      const cap = capByCol.get(target) ?? 10;
      if (liveCount(target) >= cap) {
        toast.error(`That group is full (max ${cap})`);
        return;
      }
    }
    setPending((prev) => {
      const next = new Map(prev);
      if (target === info.origin) next.delete(picked); // back home → no change
      else next.set(picked, target);
      return next;
    });
    setPicked(null);
  };

  // Explicit "remove from group" = stage a move to Unassigned (drop THIS
  // membership only). The student lands in their OWN grade's Unassigned on
  // save; any other group memberships they hold are untouched. No-op for a
  // chip that's already in the Unassigned pile.
  const removeChip = (chipKey: string) => {
    const info = chipByKey.get(chipKey);
    if (!info || info.origin === UNASSIGNED) return;
    setPending((prev) => {
      const next = new Map(prev);
      next.set(chipKey, UNASSIGNED);
      return next;
    });
    if (picked === chipKey) setPicked(null);
  };

  const onChipTap = (chipKey: string, colId: string) => {
    if (picked === chipKey) {
      setPicked(null); // tap the picked chip again to cancel
    } else if (picked) {
      dropInto(colId); // tapping a chip in another column drops onto that column
    } else {
      setPicked(chipKey);
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
    for (const [chipKey, target] of Array.from(pending.entries())) {
      const info = chipByKey.get(chipKey);
      if (!info || target === info.origin) continue;
      ops.push({
        studentId: info.studentId,
        fromGroupId: info.origin === UNASSIGNED ? null : (info.origin as Id<'groups'>),
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
      ) : (board.columns?.length ?? 0) === 0 ? (
        <div className="flex-1 min-h-0 flex items-center justify-center">
          <div className="rounded-xl border border-dashed border-border/60 px-6 py-8 text-center max-w-xs">
            <p className="text-sm text-muted-foreground mb-1">No groups for Grade {activeGrade}.</p>
            <p className="text-xs text-muted-foreground">Create one in the Week view first.</p>
          </div>
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-x-auto -mx-3 px-3 pb-2">
          <div className="flex gap-2 h-full">
            {(board.columns ?? []).map((col) => (
              <Column
                key={col.groupId}
                colId={col.groupId}
                title={col.name}
                subtitle={sessionLabel(col.firstSession)}
                count={liveCount(col.groupId)}
                cap={col.cap}
                accentSeed={col.groupId}
                boardGrade={activeGrade}
                chips={allChips.filter((c) => effectiveCol(c.chipKey) === col.groupId)}
                picked={picked}
                pending={pending}
                onChipTap={onChipTap}
                onRemove={removeChip}
                onColumnTap={() => dropInto(col.groupId)}
                hasPick={picked != null}
              />
            ))}
            <Column
              colId={UNASSIGNED}
              title="Unassigned"
              subtitle="not in a group"
              count={liveCount(UNASSIGNED)}
              accentSeed={null}
              boardGrade={activeGrade}
              chips={allChips.filter((c) => effectiveCol(c.chipKey) === UNASSIGNED)}
              picked={picked}
              pending={pending}
              onChipTap={onChipTap}
              onRemove={removeChip}
              onColumnTap={() => dropInto(UNASSIGNED)}
              hasPick={picked != null}
            />
          </div>
        </div>
      )}

      {/* Moving bar */}
      {picked && chipByKey.get(picked) && (
        <div className="shrink-0 mt-2 flex items-center gap-2 rounded-xl bg-primary/10 border border-primary/30 px-3 py-2">
          <ArrowLeftRight className="w-4 h-4 text-primary shrink-0" />
          <span className="text-xs text-foreground">
            Moving <span className="font-semibold">{chipByKey.get(picked)!.name}</span> — tap a group
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
  accentSeed,
  boardGrade,
  chips,
  picked,
  pending,
  onChipTap,
  onRemove,
  onColumnTap,
  hasPick,
}: {
  colId: string;
  title: string;
  subtitle: string | null;
  count: number;
  cap?: number;
  accentSeed: string | null;
  boardGrade: number | null;
  chips: ChipInfo[];
  picked: string | null;
  pending: Map<string, string>;
  onChipTap: (chipKey: string, colId: string) => void;
  onRemove: (chipKey: string) => void;
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
          const isPicked = picked === c.chipKey;
          const moved = pending.has(c.chipKey) && pending.get(c.chipKey) !== c.origin;
          const offGrade = boardGrade != null && typeof c.grade === 'number' && c.grade !== boardGrade;
          // The × removes THIS membership (→ Unassigned). Pointless in the
          // Unassigned column (the student is already out of every group here).
          const removable = colId !== UNASSIGNED;
          return (
            <div
              key={c.chipKey}
              className={cn(
                'w-full rounded-lg text-xs transition-all border flex items-stretch',
                isPicked
                  ? 'bg-primary text-primary-foreground border-primary shadow-sm scale-[1.02]'
                  : moved
                    ? 'bg-amber-500/10 border-amber-500/40 text-foreground'
                    : 'bg-muted/50 border-transparent text-foreground hover:bg-muted',
              )}
            >
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onChipTap(c.chipKey, colId);
                }}
                className="flex-1 min-w-0 text-left px-2 py-1.5 flex items-center gap-1.5"
              >
                <span className="truncate flex-1">{c.name}</span>
                {offGrade && (
                  <span
                    className={cn(
                      'shrink-0 text-[9px] font-bold px-1 py-px rounded tabular-nums',
                      isPicked ? 'bg-primary-foreground/20' : 'bg-muted-foreground/15 text-muted-foreground',
                    )}
                    title={`Grade ${c.grade}`}
                  >
                    G{c.grade}
                  </span>
                )}
              </button>
              {removable && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemove(c.chipKey);
                  }}
                  title="Remove from group"
                  aria-label={`Remove ${c.name} from group`}
                  className={cn(
                    'shrink-0 px-1.5 flex items-center rounded-r-lg transition-colors',
                    isPicked
                      ? 'text-primary-foreground/70 hover:text-primary-foreground hover:bg-primary-foreground/15'
                      : 'text-muted-foreground/40 hover:text-red-600 hover:bg-red-500/10',
                  )}
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
