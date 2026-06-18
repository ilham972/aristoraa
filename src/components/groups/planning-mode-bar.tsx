'use client';

// Planning mode controls for the Week view. A toggle flips the week grid onto
// a private DRAFT copy of the timetable; live keeps running untouched. The
// draft is saved, so toggling off (to peek at live) and back on resumes the
// same draft. Pull brings current live INTO the draft; Merge pushes the draft
// OUT to become live. Both are sensitive, so each sits behind a confirm step.
// See convex/timetableDraft.ts (engine) + timetableDraftEdit.ts (editing).

import { useState } from 'react';
import { useMutation } from 'convex/react';
import { useCachedQuery as useQuery } from '@/hooks/use-cached-query';
import { toast } from 'sonner';
import { ArrowDownToLine, GitBranch, Trash2, Upload } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/convex';
import { cn } from '@/lib/utils';

type Confirm = 'pull' | 'merge' | 'discard' | null;

export function PlanningModeBar({
  active,
  onActiveChange,
}: {
  active: boolean;
  onActiveChange: (active: boolean) => void;
}) {
  const status = useQuery(api.timetableDraft.status);
  const fork = useMutation(api.timetableDraft.fork);
  const pull = useMutation(api.timetableDraft.pull);
  const merge = useMutation(api.timetableDraft.merge);
  const discard = useMutation(api.timetableDraft.discard);

  const [confirm, setConfirm] = useState<Confirm>(null);
  const [busy, setBusy] = useState(false);

  const pending = status?.exists ? status.pending : undefined;
  const changeCount = pending
    ? pending.creates + pending.patches + pending.deletes
    : 0;

  // Turning planning on forks a draft the first time; turning off keeps the
  // saved draft so the user can resume later. Discard is the only thing that
  // throws a draft away.
  const toggle = async () => {
    if (!active) {
      try {
        await fork({});
        onActiveChange(true);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Could not start planning mode');
      }
    } else {
      onActiveChange(false);
    }
  };

  const run = async (which: Exclude<Confirm, null>) => {
    setBusy(true);
    try {
      if (which === 'pull') {
        const res = await pull({});
        toast.success(
          res?.conflicts
            ? `Pulled live in — kept your edits on ${res.conflicts} item(s)`
            : 'Pulled the live timetable into your draft',
        );
      } else if (which === 'merge') {
        const s = await merge({});
        toast.success(
          `Merged into live — ${s.groupsAdded} added, ${s.groupsChanged + s.slotsChanged + s.membersChanged} changed, ${s.groupsRemoved} removed`,
        );
      } else {
        await discard({});
        onActiveChange(false);
        toast.success('Draft discarded');
      }
      setConfirm(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        onClick={toggle}
        className={cn(
          'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all border',
          active
            ? 'bg-amber-500/15 text-amber-600 border-amber-500/40'
            : 'bg-muted text-muted-foreground border-transparent hover:text-foreground',
        )}
        title="Edit a private draft of the timetable; merge when ready"
      >
        <GitBranch className="w-3.5 h-3.5" />
        <span className="hidden sm:inline">Planning</span>
      </button>

      {active && (
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setConfirm('pull')}
            className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium bg-muted text-muted-foreground hover:text-foreground transition-colors"
            title="Bring the current live timetable into your draft"
          >
            <ArrowDownToLine className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Pull</span>
          </button>
          <button
            onClick={() => setConfirm('merge')}
            disabled={changeCount === 0}
            className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-40"
            title="Make your draft the live timetable"
          >
            <Upload className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Merge</span>
            {changeCount > 0 && <span className="tabular-nums">({changeCount})</span>}
          </button>
          <button
            onClick={() => setConfirm('discard')}
            className="inline-flex items-center justify-center w-7 h-7 rounded-lg text-muted-foreground hover:text-destructive transition-colors"
            title="Throw the draft away"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      <ConfirmDialog
        which={confirm}
        busy={busy}
        pending={pending}
        onCancel={() => setConfirm(null)}
        onConfirm={() => confirm && run(confirm)}
      />
    </>
  );
}

function ConfirmDialog({
  which,
  busy,
  pending,
  onCancel,
  onConfirm,
}: {
  which: Confirm;
  busy: boolean;
  pending?: { creates: number; patches: number; deletes: number; orphans: number };
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const copy = {
    pull: {
      title: 'Pull live into your draft?',
      body: 'This copies the current live timetable into your draft. Anything you already changed in the draft is kept — only new live changes are brought in.',
      cta: 'Pull live in',
      danger: false,
    },
    merge: {
      title: 'Merge draft into live?',
      body: `This makes your draft the live timetable. ${
        pending
          ? `${pending.creates} added, ${pending.patches} changed, ${pending.deletes} removed.`
          : ''
      } Existing classes are edited in place, so attendance and scores stay attached. This affects the running schedule.`,
      cta: 'Merge into live',
      danger: true,
    },
    discard: {
      title: 'Discard this draft?',
      body: 'Your draft and all its edits are deleted. The live timetable is untouched. This cannot be undone.',
      cta: 'Discard draft',
      danger: true,
    },
  } as const;
  const c = which ? copy[which] : null;

  return (
    <Dialog open={which !== null} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="max-w-sm">
        {c && (
          <>
            <DialogHeader>
              <DialogTitle>{c.title}</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">{c.body}</p>
            <div className="flex justify-end gap-2 mt-2">
              <Button variant="ghost" onClick={onCancel} disabled={busy}>
                Cancel
              </Button>
              <Button
                variant={c.danger ? 'destructive' : 'default'}
                onClick={onConfirm}
                disabled={busy}
              >
                {busy ? 'Working…' : c.cta}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
