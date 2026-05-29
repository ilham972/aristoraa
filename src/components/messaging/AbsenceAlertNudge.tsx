'use client';

// Phase W.2 — inline absence-alert nudge (plan §8.3).
//
// Renders under an absent student's row on the per-session Attendance tab,
// once the session has been SAVED (the nudge keys off persisted attendance,
// not the in-flight draft toggle). States:
//   • idle      — "Send absence alert to <Parent>?" with Draft / Send now
//   • opted-out — muted "Opted out — not messaging"
//   • no-phone  — muted "No parent phone on file"
//   • draft     — "Draft saved" + Send now (or "Included in merged alert")
//   • queued    — "Queued" pill (sending shortly)
//   • sent      — "Already sent at HH:MM" (no button)
//   • failed    — "Send failed" + Retry
//
// Send actions go through the normal queue → outbox → provider chokepoint;
// this component never touches the provider directly.

import { useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { toast } from 'sonner';
import { Loader2, Send, FileText, Check, MailWarning, BellOff, PhoneOff, Users } from 'lucide-react';
import { api, type Id } from '@/lib/convex';
import { cn } from '@/lib/utils';

type UpsertResult = {
  status: 'drafted' | 'merged' | 'already-queued' | 'already-sent' | 'skipped';
  reason?: string;
};

function fmtTime(ms: number | null): string {
  if (!ms) return '';
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function AbsenceAlertNudge({
  studentId,
  slotId,
  date,
}: {
  studentId: Id<'students'>;
  slotId: Id<'scheduleSlots'>;
  date: string;
}) {
  const state = useQuery(api.messaging.absenceAlerts.nudgeStateForStudent, {
    studentId,
    slotId,
    date,
  });
  const createDraft = useMutation(api.messaging.absenceAlerts.createDraftForAbsence);
  const draftAndSend = useMutation(api.messaging.absenceAlerts.draftAndSendForAbsence);
  const [busy, setBusy] = useState(false);

  if (state === undefined || state === null) return null;

  const toastForResult = (res: UpsertResult, sending: boolean) => {
    if (res.status === 'skipped') {
      if (res.reason === 'opted-out') toast.error('Parent has opted out — not messaging');
      else if (res.reason === 'no-phone') toast.error('No valid parent phone on file');
      else toast.error('Could not create alert');
      return;
    }
    if (res.status === 'already-sent') toast.info('Already sent earlier today');
    else if (res.status === 'already-queued') toast.info('Already queued');
    else if (sending) toast.success('Queued — the bot will send it shortly');
    else toast.success('Draft saved');
  };

  const onDraft = async () => {
    setBusy(true);
    try {
      const res = (await createDraft({ studentId, slotId, date })) as UpsertResult;
      toastForResult(res, false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not draft');
    } finally {
      setBusy(false);
    }
  };

  const onSend = async () => {
    setBusy(true);
    try {
      const res = (await draftAndSend({ studentId, slotId, date })) as UpsertResult;
      toastForResult(res, true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not send');
    } finally {
      setBusy(false);
    }
  };

  // ── Terminal / muted states ──────────────────────────────────────────
  if (state.kind === 'no-phone' || state.kind === 'no-student') {
    return (
      <Shell muted>
        <PhoneOff className="w-3.5 h-3.5" />
        No parent phone on file
      </Shell>
    );
  }
  if (state.kind === 'opted-out') {
    return (
      <Shell muted>
        <BellOff className="w-3.5 h-3.5" />
        Opted out — not messaging
      </Shell>
    );
  }
  if (state.kind === 'sent') {
    return (
      <Shell tone="ok">
        <Check className="w-3.5 h-3.5" />
        Alert sent{state.sentAt ? ` at ${fmtTime(state.sentAt)}` : ''}
        {state.isMerged && <MergedTag label={state.namesLabel} />}
      </Shell>
    );
  }
  if (state.kind === 'queued') {
    return (
      <Shell tone="pending">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        Queued — sending shortly
        {state.isMerged && <MergedTag label={state.namesLabel} />}
      </Shell>
    );
  }

  // Secondary sibling on a merged alert (idle/draft/failed): no own action,
  // just a note pointing at the single combined message.
  if (
    (state.kind === 'idle' || state.kind === 'draft' || state.kind === 'failed') &&
    state.isMerged &&
    !state.isPrimary
  ) {
    return (
      <Shell muted>
        <Users className="w-3.5 h-3.5" />
        Included in merged alert ({state.namesLabel})
      </Shell>
    );
  }

  // ── Actionable states: idle, draft (primary), failed (primary) ────────
  const headline =
    state.kind === 'idle'
      ? `Send absence alert to ${state.parentName || 'parent'}?`
      : state.kind === 'failed'
        ? 'Send failed — retry?'
        : 'Draft saved — send it?';

  return (
    <div className="mt-2 rounded-lg border border-teal-500/30 bg-teal-500/[0.06] p-2.5">
      <div className="flex items-start gap-2 mb-2">
        <MailWarning className="w-4 h-4 text-teal-500 dark:text-teal-400 shrink-0 mt-0.5" />
        <div className="min-w-0">
          <p className="text-xs font-semibold text-foreground leading-snug">{headline}</p>
          {state.isMerged && (
            <p className="text-[10px] text-muted-foreground mt-0.5">
              One combined message for {state.namesLabel}
            </p>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        {state.kind === 'idle' && (
          <button
            type="button"
            disabled={busy}
            onClick={onDraft}
            className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md text-[11px] font-medium border border-input text-muted-foreground hover:bg-muted disabled:opacity-50"
          >
            <FileText className="w-3 h-3" /> Draft
          </button>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={onSend}
          className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md text-[11px] font-semibold bg-teal-500 text-white hover:bg-teal-600 disabled:opacity-50"
        >
          {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
          Send now
        </button>
      </div>
    </div>
  );
}

function Shell({
  children,
  muted,
  tone,
}: {
  children: React.ReactNode;
  muted?: boolean;
  tone?: 'ok' | 'pending';
}) {
  return (
    <div
      className={cn(
        'mt-2 rounded-lg px-2.5 py-1.5 inline-flex items-center gap-1.5 text-[11px] font-medium',
        muted && 'bg-muted text-muted-foreground',
        tone === 'ok' && 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
        tone === 'pending' && 'bg-amber-500/10 text-amber-600',
      )}
    >
      {children}
    </div>
  );
}

function MergedTag({ label }: { label: string }) {
  return (
    <span className="ml-1 inline-flex items-center gap-1 text-[10px] opacity-80">
      <Users className="w-3 h-3" /> {label}
    </span>
  );
}
