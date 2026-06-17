'use client';

// Per-student availability editor. Records the OUTSIDE commitments (night
// classes, other tuition) that make a student busy, so the Library
// (paper-class) roster can grey out anyone who isn't free for a block.
// Personal-class times are NOT entered here — they're known from the
// student's groups automatically.

import { useState } from 'react';
import { useMutation } from 'convex/react';
import { useCachedQuery as useQuery } from '@/hooks/use-cached-query';
import { toast } from 'sonner';
import { Plus, Trash2, CalendarClock } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { api, type Id } from '@/lib/convex';
import { DAYS, fmtTime12 } from '@/lib/groups/time-grid';

const HOUR_OPTIONS = Array.from({ length: 15 }, (_, i) => {
  const h = 8 + i;
  return `${String(h).padStart(2, '0')}:00`;
});

type Window = { dayOfWeek: number; startTime: string; endTime: string; label?: string };

export function AvailabilityDialog({
  studentId,
  studentName,
  open,
  onClose,
}: {
  studentId: Id<'students'> | null;
  studentName?: string;
  open: boolean;
  onClose: () => void;
}) {
  const saved = useQuery(
    api.studentAvailability.get,
    studentId ? { studentId } : 'skip',
  );
  const setAvailability = useMutation(api.studentAvailability.set);

  const [windows, setWindows] = useState<Window[]>([]);
  const [saving, setSaving] = useState(false);

  // Seed the editor from saved data once per opened student (during render,
  // not an effect) so a query refresh can't wipe out in-progress edits.
  const [seededFor, setSeededFor] = useState<string | null>(null);
  const studentKey = studentId ? `${studentId}` : null;
  if (studentKey === null && seededFor !== null) {
    // Dialog closed — forget so the next open re-seeds from saved.
    setSeededFor(null);
  } else if (saved !== undefined && studentKey !== null && seededFor !== studentKey) {
    setSeededFor(studentKey);
    setWindows(saved as Window[]);
  }

  const addWindow = () =>
    setWindows((w) => [...w, { dayOfWeek: 1, startTime: '18:00', endTime: '20:00', label: '' }]);

  const updateWindow = (i: number, patch: Partial<Window>) =>
    setWindows((w) => w.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));

  const removeWindow = (i: number) =>
    setWindows((w) => w.filter((_, idx) => idx !== i));

  const save = async () => {
    if (!studentId) return;
    for (const w of windows) {
      if (w.endTime <= w.startTime) {
        toast.error('Each window must end after it starts');
        return;
      }
    }
    setSaving(true);
    try {
      await setAvailability({
        studentId,
        busy: windows.map((w) => ({
          dayOfWeek: w.dayOfWeek,
          startTime: w.startTime,
          endTime: w.endTime,
          label: w.label?.trim() ? w.label.trim() : undefined,
        })),
      });
      toast.success('Availability saved');
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-4 pt-4 pb-2 border-b border-border/40">
          <DialogTitle className="text-sm font-semibold flex items-center gap-2">
            <CalendarClock className="w-4 h-4 text-primary" />
            Busy times{studentName ? ` · ${studentName}` : ''}
          </DialogTitle>
          <p className="text-[11px] text-muted-foreground">
            Outside commitments (night classes etc.) so the Library knows when they
            can&apos;t come. Personal classes are already known.
          </p>
        </DialogHeader>

        <div className="max-h-[70vh] overflow-y-auto px-4 py-3 space-y-2">
          {windows.length === 0 ? (
            <p className="text-xs text-muted-foreground py-3 text-center">
              No busy times — this student is free whenever the Library runs.
            </p>
          ) : (
            windows.map((w, i) => (
              <div key={i} className="rounded-lg border border-border/50 p-2 space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <Select value={String(w.dayOfWeek)} onValueChange={(v) => updateWindow(i, { dayOfWeek: Number(v) })}>
                    <SelectTrigger className="h-8 text-xs w-[84px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {DAYS.map((d) => <SelectItem key={d.num} value={String(d.num)}>{d.short}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Select value={w.startTime} onValueChange={(v) => updateWindow(i, { startTime: v ?? '18:00' })}>
                    <SelectTrigger className="h-8 text-xs flex-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {HOUR_OPTIONS.map((t) => <SelectItem key={t} value={t}>{fmtTime12(t)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <span className="text-[10px] text-muted-foreground">to</span>
                  <Select value={w.endTime} onValueChange={(v) => updateWindow(i, { endTime: v ?? '20:00' })}>
                    <SelectTrigger className="h-8 text-xs flex-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {HOUR_OPTIONS.map((t) => <SelectItem key={t} value={t}>{fmtTime12(t)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <button
                    onClick={() => removeWindow(i)}
                    className="text-muted-foreground hover:text-destructive shrink-0"
                    title="Remove"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                <Input
                  value={w.label ?? ''}
                  onChange={(e) => updateWindow(i, { label: e.target.value })}
                  placeholder="Label (optional, e.g. Physics tuition)"
                  className="h-7 text-xs"
                />
              </div>
            ))
          )}

          <Button variant="outline" size="sm" className="w-full rounded-lg gap-1.5" onClick={addWindow}>
            <Plus className="w-3.5 h-3.5" /> Add busy time
          </Button>
        </div>

        <div className="px-4 py-3 border-t border-border/40">
          <Button onClick={save} disabled={saving || saved === undefined} className="w-full rounded-xl">
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
