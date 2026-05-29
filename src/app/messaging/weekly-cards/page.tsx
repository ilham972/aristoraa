'use client';

// Phase W.5.D — /messaging/weekly-cards (text-only).
//
// Sunday-evening routine: one attendance card per parent for the week that just
// ended, sibling-merged. Per-card EDIT for a personal touch (saved freeform,
// preserved across re-computes), per-card Send, and Send-all with quiet-hours
// pre-flight. Page-load computes drafts (pure read); a click queues them.

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery } from 'convex/react';
import { toast } from 'sonner';
import {
  ArrowLeft,
  Loader2,
  Send,
  Check,
  Pencil,
  Users,
  CalendarDays,
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

type StudentLine = { studentId: Id<'students'>; name: string; attended: number; total: number };
type Group = {
  phoneE164: string;
  parentName: string;
  students: StudentLine[];
  studentNames: string[];
  preview: string;
  edited: boolean;
  status: string;
  queueId: Id<'messageQueue'> | null;
  sentAt: number | null;
};

export default function WeeklyCardsPage() {
  const [week, setWeek] = useState<string>('');
  const [centerId, setCenterId] = useState<string>('');
  const [grade, setGrade] = useState<string>('');
  const [editing, setEditing] = useState<Group | null>(null);
  const [busyPhone, setBusyPhone] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sendingAll, setSendingAll] = useState(false);

  const weeks = useQuery(api.messaging.weeklyCards.recentWeekStarts, { count: 8 });
  const centers = useQuery(api.centers.list);
  const quiet = useQuery(api.messaging.weeklyCards.quietHoursPreflight, {});

  // Default selection: last completed week (index 1) once weeks arrive.
  useEffect(() => {
    if (!week && weeks && weeks.length > 0) {
      setWeek(weeks[Math.min(1, weeks.length - 1)].weekStartDate);
    }
  }, [weeks, week]);

  const filters = useMemo(
    () => ({
      weekStartDate: week || undefined,
      centerId: centerId ? (centerId as Id<'centers'>) : undefined,
      grade: grade ? Number(grade) : undefined,
    }),
    [week, centerId, grade],
  );

  const data = useQuery(api.messaging.weeklyCards.previewWeeklyCards, filters);
  const sendOne = useMutation(api.messaging.weeklyCards.sendOneForWeek);
  const sendAll = useMutation(api.messaging.weeklyCards.sendAllForWeek);

  const groups = data?.groups ?? [];
  const noPhone = data?.noPhone ?? [];
  const summary = data?.summary;
  const pendingCount = useMemo(
    () => groups.filter((g) => ACTIONABLE.has(g.status)).length,
    [groups],
  );
  const nothing = data && groups.length === 0 && noPhone.length === 0;

  const onSendOne = async (g: Group) => {
    if (!data) return;
    setBusyPhone(g.phoneE164);
    try {
      const res = (await sendOne({ phoneE164: g.phoneE164, ...filters, weekStartDate: data.weekStartDate })) as {
        status: string;
        reason?: string;
        deferred?: boolean;
      };
      if (res.status === 'skipped') toast.error(res.reason === 'opted-out' ? 'Parent opted out' : 'Nothing to send');
      else if (res.status === 'already-sent' || res.status === 'already-queued') toast.info('Already queued or sent');
      else if (res.deferred) toast.success('Queued — delivers tomorrow from 07:00');
      else toast.success('Queued — sending shortly');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not send');
    } finally {
      setBusyPhone(null);
    }
  };

  const onConfirmSendAll = async () => {
    if (!data) return;
    setSendingAll(true);
    try {
      const res = await sendAll({ ...filters, weekStartDate: data.weekStartDate });
      if (res.queued === 0) toast.info('Nothing new to send');
      else if (res.deferredToMorning > 0) toast.success(`Queued ${res.queued} — delivering tomorrow from 07:00`);
      else toast.success(`Queued ${res.queued} card${res.queued === 1 ? '' : 's'}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not send all');
    } finally {
      setSendingAll(false);
      setConfirmOpen(false);
    }
  };

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
          <h1 className="text-2xl font-bold tracking-tight">Weekly cards</h1>
          <p className="text-sm text-muted-foreground mt-1 inline-flex items-center gap-1.5">
            <CalendarDays className="w-3.5 h-3.5" />
            Week of {data?.weekLabel ?? '…'} · attendance · siblings merged
          </p>
        </div>
        {pendingCount > 0 && (
          <Button onClick={() => setConfirmOpen(true)} disabled={sendingAll} className="shrink-0 h-9">
            <Send className="w-4 h-4 mr-1" /> Send all ({pendingCount})
          </Button>
        )}
      </header>

      {summary && (
        <div className="flex flex-wrap gap-1.5 mb-4">
          <Chip label="Parents" value={summary.totalParents} tone="teal" />
          <Chip label="Students" value={summary.totalStudents} tone="teal" />
          {summary.skippedOptOut > 0 && <Chip label="Opted out" value={summary.skippedOptOut} tone="muted" />}
          {summary.skippedNoPhone > 0 && <Chip label="No phone" value={summary.skippedNoPhone} tone="amber" />}
          {summary.skippedNoWeekData > 0 && <Chip label="No classes" value={summary.skippedNoWeekData} tone="muted" />}
        </div>
      )}

      {/* Filters: week + center + grade */}
      <div className="flex flex-wrap gap-2 mb-4">
        <select
          value={week}
          onChange={(e) => setWeek(e.target.value)}
          className="h-9 rounded-md border border-border/60 bg-background px-2.5 text-xs text-foreground"
        >
          {(weeks ?? []).map((w) => (
            <option key={w.weekStartDate} value={w.weekStartDate}>
              {w.label}
              {w.isCurrent ? ' (this week)' : ''}
            </option>
          ))}
        </select>
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
          <span>Quiet hours (21:00–07:00). Sends now are held and delivered tomorrow from 07:00.</span>
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
            No cards for this week — no logged classes, or everyone is opted out / has no parent phone.
          </CardContent>
        </Card>
      )}

      <div className="space-y-2.5">
        {groups.map((g) => (
          <GroupCard
            key={g.phoneE164}
            group={g}
            busy={busyPhone === g.phoneE164}
            onSend={() => onSendOne(g)}
            onEdit={() => setEditing(g)}
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
                <div key={s.studentId} className="text-xs text-muted-foreground">
                  <span className="text-foreground">{s.name}</span> — add a valid parent number to send a card
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Edit modal */}
      {editing && data && (
        <EditCardModal group={editing} weekStartDate={data.weekStartDate} onClose={() => setEditing(null)} />
      )}

      {/* Send-all confirm */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send to {pendingCount} parent{pendingCount === 1 ? '' : 's'}?</DialogTitle>
            <DialogDescription>
              {quiet?.inQuietHours ? (
                <span className="inline-flex items-start gap-1.5 text-amber-600">
                  <Moon className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  Quiet hours — cards deliver tomorrow from 07:00.
                </span>
              ) : (
                'Each parent gets one merged card, spaced out to mimic a human (35s–2min apart).'
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={sendingAll}>
              Cancel
            </Button>
            <Button onClick={onConfirmSendAll} disabled={sendingAll}>
              {sendingAll ? <Loader2 className="w-4 h-4 animate-spin" /> : quiet?.inQuietHours ? 'Queue anyway' : 'Send'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Chip({ label, value, tone }: { label: string; value: number; tone: 'teal' | 'muted' | 'amber' }) {
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
  onEdit,
}: {
  group: Group;
  busy: boolean;
  onSend: () => void;
  onEdit: () => void;
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
              <span className="ml-1.5 text-[10px] font-normal text-muted-foreground">···{group.phoneE164.slice(-4)}</span>
            </p>
            <div className="mt-1.5 space-y-0.5">
              {group.students.map((s) => (
                <div key={s.studentId} className="flex items-center gap-1.5 text-[11px]">
                  {merged && <Users className="w-3 h-3 text-teal-500 dark:text-teal-400" />}
                  <span className="font-medium text-foreground">{s.name}</span>
                  <span className="text-muted-foreground">
                    {s.attended}/{s.total} attended
                  </span>
                </div>
              ))}
            </div>
          </div>
          <div className="flex flex-col items-end gap-1">
            <StatusPill status={group.status} sentAt={group.sentAt} />
            {group.edited && <span className="text-[9px] text-teal-500 dark:text-teal-400">edited</span>}
          </div>
        </div>

        <p className="text-[11px] text-muted-foreground mt-2 leading-snug whitespace-pre-line line-clamp-4">
          {group.preview}
        </p>

        {actionable && (
          <div className="mt-2.5 flex items-center gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={onSend}
              className="inline-flex items-center gap-1 h-8 px-3 rounded-md text-[11px] font-semibold bg-teal-500 text-white hover:bg-teal-600 disabled:opacity-50"
            >
              {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
              {group.status === 'failed' ? 'Retry' : 'Send'}
            </button>
            <button
              type="button"
              onClick={onEdit}
              className="inline-flex items-center gap-1 h-8 px-3 rounded-md text-[11px] font-semibold border border-border/60 text-muted-foreground hover:text-foreground"
            >
              <Pencil className="w-3 h-3" /> Edit
            </button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function EditCardModal({
  group,
  weekStartDate,
  onClose,
}: {
  group: Group;
  weekStartDate: string;
  onClose: () => void;
}) {
  const save = useMutation(api.messaging.weeklyCards.saveCardEdit);
  const [body, setBody] = useState(group.preview);
  const [saving, setSaving] = useState(false);

  const onSave = async () => {
    setSaving(true);
    try {
      await save({ phoneE164: group.phoneE164, weekStartDate, body });
      toast.success('Card saved — send it when ready');
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit card · {group.parentName}</DialogTitle>
          <DialogDescription>
            A one-off personal touch for this parent. Doesn&apos;t change the template.
          </DialogDescription>
        </DialogHeader>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={6}
          className="w-full resize-none rounded-md border border-border/60 bg-background px-3 py-2 text-[13px] text-foreground focus:outline-none focus:ring-1 focus:ring-teal-500"
        />
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={onSave} disabled={saving || !body.trim()}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4 mr-1" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StatusPill({ status, sentAt }: { status: string; sentAt: number | null }) {
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
    <span className={cn('shrink-0 inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full', m.cls)}>
      {m.icon && <Check className="w-3 h-3" />}
      {m.label}
      {time}
    </span>
  );
}
