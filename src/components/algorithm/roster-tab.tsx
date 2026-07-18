'use client';

// RosterTab — Insights → Roster (2026-07-18). The whole-centre group sweep.
//
// Deleting a group already existed on /groups → Group view, but that board is
// scoped to ONE grade, hides phantom (abandoned `new_group`) rows, and shows no
// signal for whether a group is actually alive. So the founder could never scan
// the centre and clean house. This tab is exactly that pass: every group, every
// grade, two signals — students and weekly sessions — and a trash per row.
//
// Live data only. An audit shows what's real, never the planning-mode draft.

import { useMemo, useState } from 'react';
import { Users, CalendarDays, Trash2, ClipboardList } from 'lucide-react';
import { useMutation } from 'convex/react';
import { api, type Id } from '@/lib/convex';
import { cn } from '@/lib/utils';
import { useCachedQuery } from '@/hooks/use-cached-query';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { toast } from 'sonner';

type RosterRow = {
  _id: Id<'groups'>;
  name: string;
  grade: number | null;
  additionalGrades: number[];
  members: number;
  sessions: number;
  isPhantom: boolean;
};

// The badge IS the point of this screen — it's what makes a scan-and-delete
// pass possible without opening every group.
function health(row: RosterRow): { label: string; tone: string } | null {
  if (row.members === 0 && row.sessions === 0) {
    return { label: 'dead', tone: 'bg-red-500/15 text-red-400 border-red-500/30' };
  }
  if (row.members === 0) {
    return { label: 'empty', tone: 'bg-amber-500/15 text-amber-400 border-amber-500/30' };
  }
  return null;
}

export function RosterTab() {
  const data = useCachedQuery(api.groups.rosterAudit, {});
  const removeGroup = useMutation(api.groups.remove);

  const [target, setTarget] = useState<RosterRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  const sections = useMemo(() => {
    const rows: RosterRow[] = data?.groups ?? [];
    const byGrade = new Map<number | null, RosterRow[]>();
    for (const r of rows) {
      const list = byGrade.get(r.grade);
      if (list) list.push(r);
      else byGrade.set(r.grade, [r]);
    }
    // Grades ascending, "No grade" last — the query already sorted the rows.
    return [...byGrade.entries()].sort((a, b) => (a[0] ?? 99) - (b[0] ?? 99));
  }, [data]);

  const confirmDelete = async () => {
    if (!target) return;
    setDeleting(true);
    try {
      await removeGroup({ id: target._id });
      toast.success(`Deleted ${target.name}`);
      setTarget(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not delete group');
    } finally {
      setDeleting(false);
    }
  };

  if (data === undefined) {
    return <div className="p-4 text-sm text-muted-foreground">Loading groups…</div>;
  }

  const total = data.groups.length;
  const deadCount = data.groups.filter((g: RosterRow) => g.members === 0 && g.sessions === 0).length;

  return (
    <div className="space-y-4">
      {/* Summary line — the reason to be here */}
      <div className="flex items-center gap-2 text-xs text-muted-foreground px-1">
        <ClipboardList className="w-3.5 h-3.5 shrink-0" />
        <span>
          {total} {total === 1 ? 'group' : 'groups'} across the centre
          {deadCount > 0 && (
            <>
              {' · '}
              <span className="text-red-400 font-medium">
                {deadCount} with no students and no sessions
              </span>
            </>
          )}
        </span>
      </div>

      {total === 0 && (
        <div className="text-sm text-muted-foreground px-1">No groups yet.</div>
      )}

      {sections.map(([grade, rows]) => (
        <div key={grade ?? 'none'} className="space-y-1.5">
          <div className="flex items-baseline justify-between px-1">
            <h2 className="text-sm font-semibold text-foreground">
              {grade === null ? 'No grade' : `Grade ${grade}`}
            </h2>
            <span className="text-[11px] text-muted-foreground tabular-nums">
              {rows.length} {rows.length === 1 ? 'group' : 'groups'}
            </span>
          </div>

          <div className="rounded-lg border border-border divide-y divide-border overflow-hidden">
            {rows.map((row) => {
              const badge = health(row);
              return (
                <div
                  key={row._id}
                  className="flex items-center gap-3 px-3 py-2.5 bg-card"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-sm font-medium text-foreground truncate">
                        {row.name}
                      </span>
                      {badge && (
                        <span
                          className={cn(
                            'text-[10px] px-1.5 py-0.5 rounded border font-medium shrink-0',
                            badge.tone,
                          )}
                        >
                          {badge.label}
                        </span>
                      )}
                      {row.additionalGrades.map((g) => (
                        <span
                          key={g}
                          className="text-[10px] px-1.5 py-0.5 rounded border border-border text-muted-foreground shrink-0"
                        >
                          +G{g}
                        </span>
                      ))}
                    </div>
                    <div className="flex items-center gap-3 mt-0.5 text-[11px] text-muted-foreground tabular-nums">
                      <span className="flex items-center gap-1">
                        <Users className="w-3 h-3" />
                        {row.members} {row.members === 1 ? 'student' : 'students'}
                      </span>
                      <span className="flex items-center gap-1">
                        <CalendarDays className="w-3 h-3" />
                        {row.sessions}×/week
                      </span>
                    </div>
                  </div>

                  <button
                    onClick={() => setTarget(row)}
                    className="shrink-0 p-2 rounded-md text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors"
                    title={`Delete ${row.name}`}
                    aria-label={`Delete ${row.name}`}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {/* Delete confirm — spells out what survives, because `groups.remove`
          frees weekly slots rather than deleting them and that surprises. */}
      <Dialog open={target !== null} onOpenChange={(o) => !o && setTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete {target?.name}?</DialogTitle>
          </DialogHeader>
          <div className="text-sm text-muted-foreground space-y-2">
            <p>
              {target && target.members > 0 ? (
                <>
                  Its {target.members} {target.members === 1 ? 'student goes' : 'students go'}{' '}
                  back to Unassigned (they are not deleted).
                </>
              ) : (
                <>It holds no students.</>
              )}
            </p>
            {target && target.sessions > 0 && (
              <p>
                Its {target.sessions} weekly {target.sessions === 1 ? 'session' : 'sessions'} stay
                on the timetable as empty slots — clear them on the Week view if you don&apos;t
                want them.
              </p>
            )}
            <p>This affects the live timetable and cannot be undone.</p>
          </div>
          <div className="flex justify-end gap-2 mt-2">
            <Button variant="ghost" onClick={() => setTarget(null)} disabled={deleting}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmDelete} disabled={deleting}>
              {deleting ? 'Deleting…' : 'Delete group'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
