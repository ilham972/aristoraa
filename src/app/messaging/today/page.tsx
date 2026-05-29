'use client';

// Phase W.2 — /messaging/today.
//
// "Things to send today": every parent with an absent child today, already
// sibling-merged (one row per parent phone). Per-row Send, plus a top-level
// "Send all" that drafts + queues everything still unsent in one batch. All
// sends flow through the normal queue → outbox → provider chokepoint.

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery } from 'convex/react';
import { toast } from 'sonner';
import {
  ArrowLeft,
  Loader2,
  Send,
  Check,
  BellOff,
  PhoneOff,
  Users,
  CalendarDays,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { api, type Id } from '@/lib/convex';
import { cn } from '@/lib/utils';

function todayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

const ACTIONABLE = new Set(['none', 'draft', 'failed']);

export default function TodayAbsencesPage() {
  const [date] = useState(() => todayYmd());
  const data = useQuery(api.messaging.absenceAlerts.todayAbsences, { date });
  const draftAndSend = useMutation(api.messaging.absenceAlerts.draftAndSendForAbsence);
  const sendAll = useMutation(api.messaging.absenceAlerts.sendAllForDate);
  const [busyPhone, setBusyPhone] = useState<string | null>(null);
  const [sendingAll, setSendingAll] = useState(false);

  const pendingCount = useMemo(
    () =>
      (data?.groups ?? []).filter((g) => !g.optedOut && ACTIONABLE.has(g.status)).length,
    [data],
  );

  const onSendOne = async (phoneE164: string, studentId: Id<'students'>) => {
    setBusyPhone(phoneE164);
    try {
      const res = (await draftAndSend({ studentId, date })) as { status: string; reason?: string };
      if (res.status === 'skipped') {
        toast.error(res.reason === 'opted-out' ? 'Parent opted out' : 'Could not send');
      } else if (res.status === 'already-sent') {
        toast.info('Already sent earlier today');
      } else {
        toast.success('Queued — sending shortly');
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not send');
    } finally {
      setBusyPhone(null);
    }
  };

  const onSendAll = async () => {
    setSendingAll(true);
    try {
      const res = await sendAll({ date });
      if (res.queued === 0) toast.info('Nothing new to send');
      else toast.success(`Queued ${res.queued} message${res.queued === 1 ? '' : 's'}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not send all');
    } finally {
      setSendingAll(false);
    }
  };

  const groups = data?.groups ?? [];
  const noPhone = data?.noPhone ?? [];
  const nothing = data && groups.length === 0 && noPhone.length === 0;

  return (
    <div className="px-4 pt-6 pb-8 max-w-2xl mx-auto">
      <Link
        href="/messaging"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-3"
      >
        <ArrowLeft className="w-3.5 h-3.5" /> Messaging
      </Link>

      <header className="mb-5 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Today&apos;s absences</h1>
          <p className="text-sm text-muted-foreground mt-1 inline-flex items-center gap-1.5">
            <CalendarDays className="w-3.5 h-3.5" />
            {date} · one message per parent (siblings merged)
          </p>
        </div>
        {pendingCount > 0 && (
          <Button onClick={onSendAll} disabled={sendingAll} className="shrink-0 h-9">
            {sendingAll ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <>
                <Send className="w-4 h-4 mr-1" /> Send all ({pendingCount})
              </>
            )}
          </Button>
        )}
      </header>

      {data === undefined && (
        <div className="flex justify-center py-16">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      )}

      {nothing && (
        <Card className="border-border/60">
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No absences marked today. Mark a student absent on a session to see alerts here.
          </CardContent>
        </Card>
      )}

      <div className="space-y-2.5">
        {groups.map((g) => (
          <GroupCard
            key={g.phoneE164}
            group={g}
            busy={busyPhone === g.phoneE164}
            onSend={() => onSendOne(g.phoneE164, g.primaryStudentId)}
          />
        ))}
      </div>

      {noPhone.length > 0 && (
        <div className="mt-6">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
            No parent phone on file
          </p>
          <Card className="border-border/60">
            <CardContent className="p-3 space-y-1.5">
              {noPhone.map((s) => (
                <div key={s.studentId} className="flex items-center gap-2 text-xs text-muted-foreground">
                  <PhoneOff className="w-3.5 h-3.5 shrink-0" />
                  <span className="text-foreground">{s.name}</span>
                  <span>— add a valid parent number to alert this family</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

type Group = {
  phoneE164: string;
  parentName: string;
  studentNames: string[];
  primaryStudentId: Id<'students'>;
  optedOut: boolean;
  status: string;
  sentAt: number | null;
  preview: string;
};

function GroupCard({
  group,
  busy,
  onSend,
}: {
  group: Group;
  busy: boolean;
  onSend: () => void;
}) {
  const actionable = !group.optedOut && ACTIONABLE.has(group.status);
  return (
    <Card className="border-border/60">
      <CardContent className="p-3.5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground truncate">{group.parentName}</p>
            <div className="flex flex-wrap items-center gap-1 mt-1">
              {group.studentNames.length > 1 && (
                <Users className="w-3 h-3 text-teal-500 dark:text-teal-400" />
              )}
              {group.studentNames.map((n) => (
                <span
                  key={n}
                  className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground"
                >
                  {n}
                </span>
              ))}
            </div>
          </div>
          <StatusPill status={group.status} optedOut={group.optedOut} sentAt={group.sentAt} />
        </div>

        <p className="text-[11px] text-muted-foreground mt-2 leading-snug line-clamp-2">
          {group.preview}
        </p>

        {group.optedOut ? (
          <div className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <BellOff className="w-3.5 h-3.5" /> Opted out — not messaging
          </div>
        ) : actionable ? (
          <div className="mt-2.5">
            <button
              type="button"
              disabled={busy}
              onClick={onSend}
              className="inline-flex items-center gap-1 h-8 px-3 rounded-md text-[11px] font-semibold bg-teal-500 text-white hover:bg-teal-600 disabled:opacity-50"
            >
              {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
              {group.status === 'failed' ? 'Retry' : group.status === 'draft' ? 'Send draft' : 'Send'}
            </button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function StatusPill({
  status,
  optedOut,
  sentAt,
}: {
  status: string;
  optedOut: boolean;
  sentAt: number | null;
}) {
  if (optedOut) return null;
  const map: Record<string, { label: string; cls: string; icon?: boolean }> = {
    none: { label: 'Not sent', cls: 'bg-muted text-muted-foreground' },
    draft: { label: 'Draft', cls: 'bg-muted text-muted-foreground' },
    queued: { label: 'Queued', cls: 'bg-amber-500/10 text-amber-600' },
    sending: { label: 'Sending', cls: 'bg-amber-500/10 text-amber-600' },
    sent: { label: 'Sent', cls: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400', icon: true },
    failed: { label: 'Failed', cls: 'bg-destructive/10 text-destructive' },
  };
  const m = map[status] ?? map.none;
  const time =
    status === 'sent' && sentAt
      ? ` ${new Date(sentAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
      : '';
  return (
    <span
      className={cn(
        'shrink-0 inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full',
        m.cls,
      )}
    >
      {m.icon && <Check className="w-3 h-3" />}
      {m.label}
      {time}
    </span>
  );
}
