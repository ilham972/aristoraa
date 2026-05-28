'use client';

// Bottom sheet for cancelling (or restoring) a day's worth of sessions on
// /groups → Day view. Opens from the kebab in the day-strip header.
//
// Features:
//   • Reason chips (sick / poya / festival / students unavailable / personal
//     / other). One reason is required for a cancel.
//   • Mode toggle: single date OR date range (range capped server-side at
//     60 days). Range start defaults to the day the sheet was opened on.
//   • Optional groups filter — by default we cancel every group's session
//     that day, but a multi-select lets the user restrict to specific
//     groups (e.g. only morning groups when only some are off).
//   • Restore button appears when any of the dates already have at least
//     one cancellation, calling `uncancelDay` for the displayed date.
//
// Writes are wired to convex/sessionRecords.{cancelDay, cancelRange,
// uncancelDay}. Toast on success/failure; the parent Day view's reactive
// query refreshes automatically.

import { useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { toast } from 'sonner';
import { Calendar, CheckCircle2 } from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api, type Id } from '@/lib/convex';
import { cn } from '@/lib/utils';

type Reason = 'sick' | 'poya' | 'festival' | 'students_unavailable' | 'personal' | 'other';

const REASONS: Array<{ value: Reason; label: string; hint: string }> = [
  { value: 'sick', label: 'Sick', hint: 'Tutor illness' },
  { value: 'poya', label: 'Poya', hint: 'Full-moon holiday' },
  { value: 'festival', label: 'Festival', hint: 'Public holiday / festival' },
  { value: 'students_unavailable', label: 'Students away', hint: 'Exams / school event' },
  { value: 'personal', label: 'Personal', hint: 'Personal commitment' },
  { value: 'other', label: 'Other', hint: 'Use the note below' },
];

export function CancelDaySheet({
  open,
  onClose,
  date,
}: {
  open: boolean;
  onClose: () => void;
  date: string;
}) {
  const [mode, setMode] = useState<'single' | 'range'>('single');
  const [rangeTo, setRangeTo] = useState<string>(date);
  const [reason, setReason] = useState<Reason | null>(null);
  const [note, setNote] = useState('');
  const [groupFilter, setGroupFilter] = useState<Set<Id<'groups'>>>(new Set());
  const [showGroupPicker, setShowGroupPicker] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Existing cancellations on the displayed date — surfaces the Restore CTA
  // when present. Range cancellations don't preview existing state because
  // we'd have to load every date in the window; the restore action stays
  // single-date.
  const week = useQuery(api.groups.weekGrid);

  const cancelDay = useMutation(api.sessionRecords.cancelDay);
  const cancelRange = useMutation(api.sessionRecords.cancelRange);
  const uncancelDay = useMutation(api.sessionRecords.uncancelDay);

  const groups = week?.groups ?? [];
  const groupIdsArr = Array.from(groupFilter);

  const handleSubmit = async () => {
    if (!reason) {
      toast.error('Pick a reason');
      return;
    }
    setSubmitting(true);
    try {
      if (mode === 'single') {
        const res = await cancelDay({
          date,
          reason,
          note: note.trim() || undefined,
          groupIds: groupIdsArr.length > 0 ? groupIdsArr : undefined,
        });
        toast.success(`Cancelled ${res.cancelledCount} session${res.cancelledCount === 1 ? '' : 's'}`);
      } else {
        if (rangeTo < date) {
          toast.error('Range end is before start');
          setSubmitting(false);
          return;
        }
        const res = await cancelRange({
          from: date,
          to: rangeTo,
          reason,
          note: note.trim() || undefined,
          groupIds: groupIdsArr.length > 0 ? groupIdsArr : undefined,
        });
        toast.success(`Cancelled ${res.cancelledCount} session${res.cancelledCount === 1 ? '' : 's'}`);
      }
      reset();
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to cancel';
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleRestore = async () => {
    setSubmitting(true);
    try {
      const res = await uncancelDay({
        date,
        groupIds: groupIdsArr.length > 0 ? groupIdsArr : undefined,
      });
      toast.success(`Restored ${res.restoredCount} session${res.restoredCount === 1 ? '' : 's'}`);
      reset();
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to restore';
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const reset = () => {
    setReason(null);
    setNote('');
    setMode('single');
    setRangeTo(date);
    setGroupFilter(new Set());
    setShowGroupPicker(false);
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          reset();
          onClose();
        }
      }}
    >
      <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto rounded-t-2xl">
        <SheetHeader className="pb-2">
          <SheetTitle className="flex items-center gap-2 text-base">
            <Calendar className="w-4 h-4 text-primary" />
            Cancel sessions
          </SheetTitle>
          <SheetDescription className="text-xs">
            {mode === 'single'
              ? `Mark all (or selected) sessions on ${prettyDate(date)} as cancelled.`
              : `Cancel every session from ${prettyDate(date)} to ${prettyDate(rangeTo)}.`}
          </SheetDescription>
        </SheetHeader>

        <div className="px-4 space-y-4">
          {/* Mode toggle */}
          <div className="flex items-center gap-1 p-1 bg-muted rounded-lg w-fit">
            <button
              type="button"
              onClick={() => setMode('single')}
              className={cn(
                'px-3 py-1 rounded text-xs font-medium transition-all',
                mode === 'single' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground',
              )}
            >
              Single day
            </button>
            <button
              type="button"
              onClick={() => setMode('range')}
              className={cn(
                'px-3 py-1 rounded text-xs font-medium transition-all',
                mode === 'range' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground',
              )}
            >
              Date range
            </button>
          </div>

          {mode === 'range' && (
            <div className="flex items-center gap-2 text-xs">
              <span className="text-muted-foreground">From {prettyDate(date)} to</span>
              <Input
                type="date"
                value={rangeTo}
                min={date}
                onChange={(e) => setRangeTo(e.target.value)}
                className="h-8 w-40 text-xs"
              />
            </div>
          )}

          {/* Reason chips */}
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              Reason
            </p>
            <div className="flex flex-wrap gap-1.5">
              {REASONS.map((r) => (
                <button
                  key={r.value}
                  type="button"
                  onClick={() => setReason(r.value)}
                  className={cn(
                    'px-3 py-1.5 rounded-full text-xs font-medium border transition-all',
                    reason === r.value
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-card border-border/60 text-foreground hover:bg-muted/50',
                  )}
                  title={r.hint}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>

          {/* Group filter */}
          <div>
            <button
              type="button"
              onClick={() => setShowGroupPicker((s) => !s)}
              className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
            >
              {groupFilter.size === 0
                ? 'Apply to all groups ▾'
                : `Apply to ${groupFilter.size} group${groupFilter.size === 1 ? '' : 's'} ▾`}
            </button>
            {showGroupPicker && (
              <div className="mt-2 grid grid-cols-2 gap-1 max-h-48 overflow-y-auto p-2 bg-muted/30 rounded-lg">
                {groups.length === 0 && (
                  <p className="col-span-2 text-xs text-muted-foreground text-center py-2">
                    No groups yet.
                  </p>
                )}
                {groups.map((g) => {
                  const isSel = groupFilter.has(g._id);
                  return (
                    <button
                      key={g._id}
                      type="button"
                      onClick={() => {
                        setGroupFilter((prev) => {
                          const next = new Set(prev);
                          if (next.has(g._id)) next.delete(g._id);
                          else next.add(g._id);
                          return next;
                        });
                      }}
                      className={cn(
                        'flex items-center gap-1 px-2 py-1 rounded text-xs text-left transition-colors',
                        isSel
                          ? 'bg-primary/15 text-primary'
                          : 'bg-card text-muted-foreground hover:bg-muted/50',
                      )}
                    >
                      <CheckCircle2
                        className={cn(
                          'w-3 h-3 shrink-0',
                          isSel ? 'opacity-100' : 'opacity-20',
                        )}
                      />
                      <span className="truncate">{g.name}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Note */}
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              Note <span className="opacity-60">(optional)</span>
            </p>
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Extra context for the cancellation"
              className="h-9 text-xs"
              maxLength={200}
            />
          </div>
        </div>

        <SheetFooter className="flex-row gap-2 pt-3">
          {mode === 'single' && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleRestore}
              disabled={submitting}
              className="text-xs"
            >
              Restore day
            </Button>
          )}
          <div className="flex-1" />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              reset();
              onClose();
            }}
            disabled={submitting}
            className="text-xs"
          >
            Close
          </Button>
          <Button
            size="sm"
            onClick={handleSubmit}
            disabled={!reason || submitting}
            className="text-xs"
          >
            {submitting ? 'Working…' : 'Cancel sessions'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function prettyDate(ymd: string): string {
  const d = new Date(ymd + 'T00:00:00');
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}
