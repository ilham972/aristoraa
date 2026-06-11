'use client';

// AttendanceTab — the per-session attendance + payment surface. Lives as
// one of four tabs on /session/[slotId]/[date], replacing the old fullscreen
// SessionDialog opened from /groups Day view.
//
// Same three responsibilities as before:
//   1. Was the session held? (Cancel-session marks it tutor leave.)
//   2. Who showed up? (Came / Didn't toggle per member.)
//   3. How much cash was collected? (Amount per present student.)
//
// Logic is identical to the previous dialog; the only structural change is
// that the page chrome (group title, date, time, back button) lives one
// level up — this component owns just the roster body and the save footer.

import { useMemo, useState } from 'react';
import { useMutation } from 'convex/react';
// Cached drop-in for useQuery: last result renders instantly from device
// storage while the live subscription refreshes (perf phase 3).
import { useCachedQuery as useQuery } from '@/hooks/use-cached-query';
import { toast } from 'sonner';
import {
  AlertCircle,
  Check,
  Loader2,
  Undo2,
  XCircle,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { api, type Id } from '@/lib/convex';
import { cn } from '@/lib/utils';
import { fmtLKR } from '@/lib/groups/time-grid';
import { AbsenceAlertNudge } from '@/components/messaging/AbsenceAlertNudge';

type AttendedState = 'present' | 'absent' | 'unset';

type DraftRow = {
  studentId: Id<'students'>;
  name: string;
  rate: number;
  expected: number;
  priorCredit: number;
  attended: AttendedState;
  amountPaid: number;
  isOverrideAdd: boolean;
};

export function AttendanceTab({
  slotId,
  date,
}: {
  slotId: Id<'scheduleSlots'>;
  date: string;
}) {
  const detail = useQuery(api.sessionRecords.sessionDetail, { slotId, date });
  const logSession = useMutation(api.sessionRecords.logSession);

  const [draft, setDraft] = useState<DraftRow[] | null>(null);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [seededFor, setSeededFor] = useState<string | null>(null);

  // Seed the draft once per (slot, date) load. After seeding, the user owns
  // the state — server refetches don't clobber in-flight edits.
  const seedKey = `${slotId}|${date}`;
  if (detail && seededFor !== seedKey) {
    setDraft(
      detail.members.map((m) => ({
        studentId: m.studentId,
        name: m.name,
        rate: m.rate,
        expected: m.expected,
        priorCredit: m.priorCredit,
        attended: m.attended === 'unset' ? 'present' : m.attended,
        amountPaid:
          m.attended === 'absent'
            ? 0
            : m.attended === 'present'
              ? m.amountPaid
              : m.expected,
        isOverrideAdd: m.isOverrideAdd,
      })),
    );
    setNote(detail.note ?? '');
    setSeededFor(seedKey);
  }

  const cancelled = detail?.logStatus === 'cancelled';

  // Students whose SAVED attendance is "absent" — only these get the inline
  // absence-alert nudge. Keys off persisted server state (detail.members),
  // NOT the in-flight local draft, so the nudge appears after "Save session".
  const persistedAbsent = new Set(
    (detail?.members ?? [])
      .filter((m) => m.attended === 'absent')
      .map((m) => String(m.studentId)),
  );

  const totals = useMemo(() => {
    if (!draft) return { expected: 0, collected: 0, credit: 0, present: 0, absent: 0 };
    let expected = 0;
    let collected = 0;
    let credit = 0;
    let present = 0;
    let absent = 0;
    for (const r of draft) {
      if (r.attended === 'present') {
        expected += r.expected;
        collected += r.amountPaid;
        credit += Math.max(0, r.expected - r.amountPaid);
        present += 1;
      } else if (r.attended === 'absent') {
        absent += 1;
      }
    }
    return { expected, collected, credit, present, absent };
  }, [draft]);

  const updateRow = (studentId: Id<'students'>, patch: Partial<DraftRow>) => {
    setDraft((d) =>
      d ? d.map((r) => (r.studentId === studentId ? { ...r, ...patch } : r)) : d,
    );
  };

  const setAttended = (studentId: Id<'students'>, attended: AttendedState) => {
    setDraft((d) =>
      d
        ? d.map((r) => {
            if (r.studentId !== studentId) return r;
            if (attended === 'absent') return { ...r, attended, amountPaid: 0 };
            if (attended === 'present' && r.attended !== 'present') {
              return { ...r, attended, amountPaid: r.expected };
            }
            return { ...r, attended };
          })
        : d,
    );
  };

  const handleSave = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      await logSession({
        slotId,
        date,
        status: 'held',
        note: note.trim() || undefined,
        entries: draft.map((r) => ({
          studentId: r.studentId,
          attended: r.attended,
          amountPaid: r.attended === 'present' ? r.amountPaid : 0,
        })),
      });
      toast.success('Session logged');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  const handleCancelSession = async () => {
    setSaving(true);
    try {
      await logSession({
        slotId,
        date,
        status: 'cancelled_by_tutor',
        note: note.trim() || undefined,
      });
      toast.success('Session marked as cancelled');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not cancel');
    } finally {
      setSaving(false);
    }
  };

  const handleReopen = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      await logSession({ slotId, date, status: 'held', note: note.trim() || undefined });
      toast.success('Session re-opened');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not reopen');
    } finally {
      setSaving(false);
    }
  };

  if (!detail) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Status banner sits above the scroll region so it never scrolls away. */}
      {cancelled && (
        <div className="shrink-0 mb-2 rounded-lg bg-muted px-3 py-1.5 flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <XCircle className="w-3.5 h-3.5" />
            Session cancelled by you on this date
          </span>
          <button
            type="button"
            disabled={saving}
            onClick={handleReopen}
            className="text-[11px] font-semibold text-primary hover:underline inline-flex items-center gap-1"
          >
            <Undo2 className="w-3 h-3" /> Reopen
          </button>
        </div>
      )}

      {/* Roster body — scrolls within the tab. */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {cancelled ? (
          <p className="text-sm text-muted-foreground text-center py-12">
            No attendance or payments expected.
            <br />
            Tap <span className="font-semibold text-foreground">Reopen</span> above to record this session anyway.
          </p>
        ) : draft && draft.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-12">
            No members in this group yet.
          </p>
        ) : draft ? (
          <ul className="space-y-2">
            {draft.map((r) => (
              <SessionRow
                key={r.studentId}
                row={r}
                slotId={slotId}
                date={date}
                showNudge={persistedAbsent.has(String(r.studentId))}
                onAttended={(a) => setAttended(r.studentId, a)}
                onAmount={(amt) => updateRow(r.studentId, { amountPaid: amt })}
              />
            ))}
          </ul>
        ) : null}

        {!cancelled && (
          <div className="mt-4 pb-2">
            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
              Note (optional)
            </label>
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. short session — covered only Unit 3"
              className="mt-1 h-8 text-xs"
            />
          </div>
        )}
      </div>

      {/* Footer: totals + actions. Sticks to the bottom of the tab area. */}
      {!cancelled && (
        <div className="shrink-0 border-t border-border/60 pt-3 mt-2">
          <div className="grid grid-cols-3 gap-2 mb-3">
            <Stat label="Expected" value={fmtLKR(totals.expected)} />
            <Stat label="Collected" value={fmtLKR(totals.collected)} />
            <Stat
              label="Credit"
              value={fmtLKR(totals.credit)}
              tone={totals.credit > 0 ? 'warn' : undefined}
            />
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive h-9"
              disabled={saving}
              onClick={handleCancelSession}
            >
              <XCircle className="w-4 h-4 mr-1" /> Cancel session
            </Button>
            <Button
              className="flex-1 h-9"
              disabled={saving || !draft}
              onClick={handleSave}
            >
              {saving ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <>
                  <Check className="w-4 h-4 mr-1" /> Save session
                </>
              )}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'warn';
}) {
  return (
    <div className={cn(
      'rounded-lg border border-border/60 px-2 py-1.5',
      tone === 'warn' && 'border-amber-500/40 bg-amber-500/5',
    )}>
      <p className="text-[9px] text-muted-foreground uppercase tracking-wider">{label}</p>
      <p className={cn(
        'text-xs font-bold tabular-nums',
        tone === 'warn' ? 'text-amber-600' : 'text-foreground',
      )}>
        {value}
      </p>
    </div>
  );
}

function SessionRow({
  row,
  slotId,
  date,
  showNudge,
  onAttended,
  onAmount,
}: {
  row: DraftRow;
  slotId: Id<'scheduleSlots'>;
  date: string;
  showNudge: boolean;
  onAttended: (a: AttendedState) => void;
  onAmount: (amt: number) => void;
}) {
  const isPresent = row.attended === 'present';
  const isAbsent = row.attended === 'absent';
  const credit = isPresent ? Math.max(0, row.expected - row.amountPaid) : 0;

  return (
    <li className="rounded-xl border border-border/60 p-2.5 bg-card">
      <div className="flex items-center gap-2.5 mb-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-foreground truncate">{row.name}</p>
          <p className="text-[10px] text-muted-foreground">
            {fmtLKR(row.rate)}/hr · expected {fmtLKR(row.expected)}
            {row.isOverrideAdd && <span className="ml-1 text-primary">· guest</span>}
          </p>
        </div>
        {row.priorCredit > 0 && (
          <span
            title={`Outstanding from earlier sessions: ${fmtLKR(row.priorCredit)}`}
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-amber-500/10 text-amber-600 text-[10px] font-semibold"
          >
            <AlertCircle className="w-3 h-3" /> owes {fmtLKR(row.priorCredit)}
          </span>
        )}
      </div>

      <div className="flex items-center gap-1.5">
        <div className="flex rounded-lg border border-input overflow-hidden shrink-0">
          <button
            type="button"
            onClick={() => onAttended('present')}
            className={cn(
              'px-2.5 py-1 text-[11px] font-medium transition-colors',
              isPresent
                ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
                : 'text-muted-foreground hover:bg-muted',
            )}
          >
            Came
          </button>
          <button
            type="button"
            onClick={() => onAttended('absent')}
            className={cn(
              'px-2.5 py-1 text-[11px] font-medium border-l border-input transition-colors',
              isAbsent
                ? 'bg-destructive/10 text-destructive'
                : 'text-muted-foreground hover:bg-muted',
            )}
          >
            Didn&apos;t
          </button>
        </div>

        <div className={cn('flex items-center gap-1 flex-1 min-w-0', !isPresent && 'opacity-40')}>
          <span className="text-[10px] text-muted-foreground shrink-0">Rs</span>
          <Input
            inputMode="numeric"
            disabled={!isPresent}
            value={isPresent ? String(row.amountPaid) : '0'}
            onChange={(e) => {
              const v = Number(e.target.value.replace(/[^0-9]/g, ''));
              onAmount(Number.isFinite(v) ? v : 0)
            }}
            onFocus={(e) => e.target.select()}
            className="h-7 text-xs tabular-nums"
          />
          {isPresent && (
            <div className="flex gap-1 shrink-0">
              <PresetBtn label="Full" active={row.amountPaid === row.expected} onClick={() => onAmount(row.expected)} />
              <PresetBtn label="½" active={row.amountPaid === Math.round(row.expected / 2)} onClick={() => onAmount(Math.round(row.expected / 2))} />
              <PresetBtn label="0" active={row.amountPaid === 0} onClick={() => onAmount(0)} />
            </div>
          )}
        </div>
      </div>

      {isPresent && credit > 0 && (
        <p className="text-[10px] text-amber-600 mt-1.5 inline-flex items-center gap-1">
          <AlertCircle className="w-3 h-3" />
          {fmtLKR(credit)} credit today
        </p>
      )}

      {showNudge && (
        <AbsenceAlertNudge studentId={row.studentId} slotId={slotId} date={date} />
      )}
    </li>
  );
}

function PresetBtn({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'h-7 px-1.5 rounded-md text-[10px] border tabular-nums',
        active
          ? 'bg-primary text-primary-foreground border-primary'
          : 'border-input text-muted-foreground hover:bg-muted',
      )}
    >
      {label}
    </button>
  );
}
