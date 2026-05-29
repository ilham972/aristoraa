'use client';

// Phase W.4 — /messaging/tomorrow.
//
// The evening routine: every parent with a child in class tomorrow, already
// sibling-merged into one card per parent phone, with each child's class +
// start time. Per-card Send plus a top-level "Send all". Opening the page is
// the trigger (previewTomorrow is a pure read — nothing is queued on view).
// All sends flow through the normal queue → outbox → provider chokepoint.

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
  Clock,
  Moon,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { api, type Id } from '@/lib/convex';
import { cn } from '@/lib/utils';

const ACTIONABLE = new Set(['none', 'draft', 'failed']);
const GRADE_OPTIONS = [6, 7, 8, 9, 10, 11, 12, 13];

type ClassLine = { moduleLabel: string; startTime: string; startLabel: string };
type StudentRow = { studentId: Id<'students'>; name: string; classes: ClassLine[] };
type Group = {
  phoneE164: string;
  parentName: string;
  students: StudentRow[];
  studentNames: string[];
  preview: string;
  status: string;
  queueId: Id<'messageQueue'> | null;
  sentAt: number | null;
};

export default function TomorrowRemindersPage() {
  const [centerId, setCenterId] = useState<string>('');
  const [grade, setGrade] = useState<string>('');

  const filters = useMemo(
    () => ({
      centerId: centerId ? (centerId as Id<'centers'>) : undefined,
      grade: grade ? Number(grade) : undefined,
    }),
    [centerId, grade],
  );

  const data = useQuery(api.messaging.tomorrowReminders.previewTomorrow, filters);
  const centers = useQuery(api.centers.list);
  const quiet = useQuery(api.messaging.tomorrowReminders.quietHoursPreflight, {});
  const sendOne = useMutation(api.messaging.tomorrowReminders.sendOneForTomorrow);
  const sendAll = useMutation(api.messaging.tomorrowReminders.sendAllForTomorrow);

  const [busyPhone, setBusyPhone] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sendingAll, setSendingAll] = useState(false);

  const groups = data?.groups ?? [];
  const noPhone = data?.noPhone ?? [];
  const summary = data?.summary;

  const pendingCount = useMemo(
    () => groups.filter((g) => ACTIONABLE.has(g.status)).length,
    [groups],
  );
  const alreadyCount = groups.length - pendingCount;

  const onSendOne = async (phoneE164: string) => {
    setBusyPhone(phoneE164);
    try {
      const res = (await sendOne({ phoneE164, ...filters })) as {
        status: string;
        reason?: string;
        deferred?: boolean;
      };
      if (res.status === 'skipped') {
        toast.error(res.reason === 'opted-out' ? 'Parent opted out' : 'Nothing to send');
      } else if (res.status === 'already-sent' || res.status === 'already-queued') {
        toast.info('Already queued or sent');
      } else if (res.deferred) {
        toast.success('Queued — delivers tomorrow from 07:00');
      } else {
        toast.success('Queued — sending shortly');
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not send');
    } finally {
      setBusyPhone(null);
    }
  };

  const onConfirmSendAll = async () => {
    setSendingAll(true);
    try {
      const res = await sendAll(filters);
      if (res.queued === 0) {
        toast.info('Nothing new to send');
      } else if (res.deferredToMorning > 0) {
        toast.success(`Queued ${res.queued} — delivering tomorrow from 07:00`);
      } else {
        toast.success(`Queued ${res.queued} reminder${res.queued === 1 ? '' : 's'}`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not send all');
    } finally {
      setSendingAll(false);
      setConfirmOpen(false);
    }
  };

  const nothing = data && groups.length === 0 && noPhone.length === 0;

  return (
    <div className="px-4 pt-6 pb-8 max-w-2xl mx-auto">
      <Link
        href="/messaging"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-3"
      >
        <ArrowLeft className="w-3.5 h-3.5" /> Messaging
      </Link>

      <header className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight">
            {data ? `Reminders for ${data.weekdayName}` : 'Tomorrow’s reminders'}
          </h1>
          <p className="text-sm text-muted-foreground mt-1 inline-flex items-center gap-1.5">
            <CalendarDays className="w-3.5 h-3.5" />
            {data?.date ?? '…'} · one message per parent (siblings merged)
          </p>
        </div>
        {pendingCount > 0 && (
          <Button onClick={() => setConfirmOpen(true)} disabled={sendingAll} className="shrink-0 h-9">
            <Send className="w-4 h-4 mr-1" /> Send all ({pendingCount})
          </Button>
        )}
      </header>

      {/* ── Summary chips ──────────────────────────────────────────────── */}
      {summary && (
        <div className="flex flex-wrap gap-1.5 mb-4">
          <Chip label="Parents" value={summary.totalParents} tone="teal" />
          <Chip label="Students" value={summary.totalStudents} tone="teal" />
          <Chip label="Classes" value={summary.sessionsTomorrow} tone="muted" />
          {summary.skippedOptOut > 0 && (
            <Chip label="Opted out" value={summary.skippedOptOut} tone="muted" />
          )}
          {summary.skippedNoPhone > 0 && (
            <Chip label="No phone" value={summary.skippedNoPhone} tone="amber" />
          )}
          {summary.skippedOffDay > 0 && (
            <Chip label="Off-day" value={summary.skippedOffDay} tone="muted" />
          )}
          {summary.skippedCancelledSlots > 0 && (
            <Chip label="Cancelled" value={summary.skippedCancelledSlots} tone="muted" />
          )}
        </div>
      )}

      {/* ── Filters (inline, no drill-down) ────────────────────────────── */}
      <div className="flex flex-wrap gap-2 mb-4">
        <select
          value={centerId}
          onChange={(e) => setCenterId(e.target.value)}
          className="h-9 rounded-md border border-border/60 bg-background px-2.5 text-xs text-foreground"
        >
          <option value="">All centres</option>
          {(centers ?? []).map((c) => (
            <option key={c._id} value={c._id}>
              {c.name}
            </option>
          ))}
        </select>
        <select
          value={grade}
          onChange={(e) => setGrade(e.target.value)}
          className="h-9 rounded-md border border-border/60 bg-background px-2.5 text-xs text-foreground"
        >
          <option value="">All grades</option>
          {GRADE_OPTIONS.map((g) => (
            <option key={g} value={g}>
              Grade {g}
            </option>
          ))}
        </select>
      </div>

      {quiet?.inQuietHours && (
        <div className="mb-4 flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-600 dark:text-amber-400">
          <Moon className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>
            It&apos;s quiet hours (21:00–07:00). Anything you send now is held and delivered
            tomorrow from 07:00 — fine for a morning reminder.
          </span>
        </div>
      )}

      {data === undefined && (
        <div className="flex justify-center py-16">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      )}

      {nothing && (
        <Card className="border-border/60">
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No reminders to send for tomorrow — every class is off-day, cancelled, opted out,
            or has no parent phone on file.
          </CardContent>
        </Card>
      )}

      <div className="space-y-2.5">
        {groups.map((g) => (
          <GroupCard
            key={g.phoneE164}
            group={g}
            busy={busyPhone === g.phoneE164}
            onSend={() => onSendOne(g.phoneE164)}
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
                  <span>— add a valid parent number to remind this family</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── Confirm modal ──────────────────────────────────────────────── */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Send to {pendingCount} parent{pendingCount === 1 ? '' : 's'}?
            </DialogTitle>
            <DialogDescription>
              {alreadyCount > 0 && (
                <span className="block mb-1">{alreadyCount} already queued or sent — skipped.</span>
              )}
              {quiet?.inQuietHours ? (
                <span className="inline-flex items-start gap-1.5 text-amber-600">
                  <Moon className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  Quiet hours now — messages will deliver tomorrow from 07:00. That&apos;s fine for a
                  morning reminder.
                </span>
              ) : (
                'Each parent gets one merged message, spaced out to mimic a human (35s–2min apart).'
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={sendingAll}>
              Cancel
            </Button>
            <Button onClick={onConfirmSendAll} disabled={sendingAll}>
              {sendingAll ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : quiet?.inQuietHours ? (
                'Queue anyway'
              ) : (
                'Send'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Chip({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'teal' | 'muted' | 'amber';
}) {
  const cls = {
    teal: 'bg-teal-500/10 text-teal-600 dark:text-teal-400',
    muted: 'bg-muted text-muted-foreground',
    amber: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  }[tone];
  return (
    <span className={cn('inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full', cls)}>
      <span className="font-bold tabular-nums">{value}</span>
      {label}
    </span>
  );
}

function GroupCard({
  group,
  busy,
  onSend,
}: {
  group: Group;
  busy: boolean;
  onSend: () => void;
}) {
  const actionable = ACTIONABLE.has(group.status);
  const merged = group.studentNames.length > 1;
  return (
    <Card className="border-border/60">
      <CardContent className="p-3.5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground truncate">
              {group.parentName}
              <span className="ml-1.5 text-[10px] font-normal text-muted-foreground">
                ···{group.phoneE164.slice(-4)}
              </span>
            </p>
            <div className="mt-1.5 space-y-1">
              {group.students.map((s) => (
                <div key={s.studentId} className="flex flex-wrap items-center gap-1.5 text-[11px]">
                  {merged && <Users className="w-3 h-3 text-teal-500 dark:text-teal-400" />}
                  <span className="font-medium text-foreground">{s.name}</span>
                  {s.classes.map((c, i) => (
                    <span
                      key={i}
                      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-muted text-muted-foreground"
                    >
                      {c.moduleLabel}
                      <Clock className="w-2.5 h-2.5" />
                      {c.startLabel}
                    </span>
                  ))}
                </div>
              ))}
            </div>
          </div>
          <StatusPill status={group.status} sentAt={group.sentAt} />
        </div>

        <p className="text-[11px] text-muted-foreground mt-2 leading-snug whitespace-pre-line line-clamp-3">
          {group.preview}
        </p>

        {actionable && (
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
        )}
      </CardContent>
    </Card>
  );
}

function StatusPill({ status, sentAt }: { status: string; sentAt: number | null }) {
  const map: Record<string, { label: string; cls: string; icon?: boolean }> = {
    none: { label: 'Not sent', cls: 'bg-muted text-muted-foreground' },
    draft: { label: 'Draft', cls: 'bg-muted text-muted-foreground' },
    queued: { label: 'Queued', cls: 'bg-amber-500/10 text-amber-600' },
    sending: { label: 'Sending', cls: 'bg-amber-500/10 text-amber-600' },
    sent: {
      label: 'Sent',
      cls: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
      icon: true,
    },
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
