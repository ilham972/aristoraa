'use client';

// Phase F.7 — schedule import panel. Shows on /groups for admins when the
// legacy slot schedule has rosters not yet represented as groups. Lets the
// user PREVIEW the inferred groups, then Import (apply) or, after importing,
// Undo. Fully reversible: apply only adds groups + stamps slot.groupId;
// legacy slotStudents/slotTeachers are never deleted.

import { useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { toast } from 'sonner';
import { ChevronDown, ChevronRight, Download, Undo2, AlertTriangle, Loader2 } from 'lucide-react';
import { api } from '@/lib/convex';
import { Button } from '@/components/ui/button';

export function MigrationPanel({ hasGroups }: { hasGroups: boolean }) {
  const preview = useQuery(api.groupMigration.preview);
  const apply = useMutation(api.groupMigration.apply);
  const rollback = useMutation(api.groupMigration.rollback);
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!preview) return null;
  const importable = preview.groups.length;

  // Nothing to import and groups already exist → offer Undo only.
  if (importable === 0) {
    if (!hasGroups) return null;
    return (
      <div className="rounded-xl border border-border/50 px-3 py-2 mb-4 flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Schedule imported. Legacy data is preserved.
        </p>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs gap-1 text-muted-foreground"
          disabled={busy}
          onClick={async () => {
            if (!confirm('Undo import? Deletes all groups and restores the old schedule. Legacy data is intact.')) return;
            setBusy(true);
            try {
              const r = await rollback();
              toast.success(`Undone — ${r.groupsDeleted} groups removed`);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Undo2 className="w-3 h-3" />}
          Undo import
        </Button>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-primary/30 bg-primary/5 px-3 py-3 mb-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-foreground">Import your existing schedule</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Found <span className="font-semibold text-foreground">{importable} group{importable !== 1 ? 's' : ''}</span> across{' '}
            {preview.groups.reduce((s, g) => s + g.sessionCount, 0)} sessions from the old Schedule tab.
            {preview.skippedEmptySlots > 0 && ` (${preview.skippedEmptySlots} empty slots skipped.)`}
          </p>
        </div>
        <Button
          size="sm"
          className="h-8 rounded-lg gap-1.5 shrink-0"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const r = await apply();
              toast.success(`Imported ${r.groupsCreated} groups · ${r.membersAdded} members`);
            } catch (e) {
              toast.error(e instanceof Error ? e.message : 'Import failed');
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
          Import
        </Button>
      </div>

      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-1 text-xs text-primary mt-2 hover:underline"
      >
        {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        Review what will be created
      </button>

      {expanded && (
        <div className="mt-2 space-y-1.5 max-h-72 overflow-y-auto">
          {preview.groups.map((g, i) => (
            <div key={i} className="rounded-lg bg-card border border-border/50 px-2.5 py-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-foreground">{g.name}</span>
                <span className="text-[10px] text-muted-foreground">
                  {g.memberCount} · {g.sessionCount} session{g.sessionCount !== 1 ? 's' : ''}
                </span>
              </div>
              <p className="text-[11px] text-muted-foreground truncate mt-0.5">
                {g.memberNames.join(', ')}
              </p>
              <div className="flex flex-wrap items-center gap-1 mt-1">
                {g.sessions.map((s, j) => (
                  <span key={j} className="text-[9px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                    {s.label}
                  </span>
                ))}
              </div>
              <div className="flex items-center gap-2 mt-1 text-[10px] text-muted-foreground">
                <span>Mentor: {g.mentorName}</span>
                <span>·</span>
                <span>{g.roomName}</span>
                {g.grade != null && <span>· G{g.grade}</span>}
                {g.mentorMismatch && (
                  <span className="flex items-center gap-0.5 text-amber-600">
                    <AlertTriangle className="w-3 h-3" /> mixed mentors
                  </span>
                )}
              </div>
            </div>
          ))}
          <p className="text-[10px] text-muted-foreground pt-1">
            Slots with different rosters become separate groups. Merge or rename them in the
            editor after importing — it&apos;s fully reversible.
          </p>
        </div>
      )}
    </div>
  );
}
