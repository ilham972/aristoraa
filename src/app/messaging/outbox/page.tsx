'use client';

// Phase W.5.B — /messaging/outbox.
//
// Operational visibility into the messageQueue: what was drafted/queued/sent/
// failed, with Cancel (draft|queued) and Retry (failed) actions. Read-only over
// the queue plus the existing cancelQueued / retryFailed mutations — the sender
// is untouched. Replaces "go check the Convex dashboard" from W.2–W.4.

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery } from 'convex/react';
import { toast } from 'sonner';
import { ArrowLeft, Loader2, XCircle, RefreshCw, Inbox as InboxIcon, Clock } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { api, type Id } from '@/lib/convex';
import { cn } from '@/lib/utils';

const STATUSES = ['all', 'draft', 'queued', 'sending', 'sent', 'failed', 'cancelled'] as const;
const TEMPLATES = [
  { value: '', label: 'All types' },
  { value: 'absence_alert', label: 'Absence' },
  { value: 'tomorrow_reminder', label: 'Tomorrow' },
  { value: 'weekly_card', label: 'Weekly card' },
  { value: 'schedule_change', label: 'Broadcast' },
  { value: 'auto_ack_parent', label: 'Auto-ack' },
  { value: '__freeform', label: 'Freeform / replies' },
];

const STATUS_STYLE: Record<string, string> = {
  draft: 'bg-muted text-muted-foreground',
  queued: 'bg-amber-500/10 text-amber-600',
  sending: 'bg-amber-500/10 text-amber-600',
  sent: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  failed: 'bg-destructive/10 text-destructive',
  cancelled: 'bg-muted text-muted-foreground line-through',
};

function fmtWhen(ms: number): string {
  const d = new Date(ms);
  const today = new Date().toDateString() === d.toDateString();
  return today
    ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

type Row = {
  _id: Id<'messageQueue'>;
  status: string;
  templateKey?: string;
  toType: string;
  targetLabel: string;
  body: string;
  batchId?: string;
  scheduledNotBefore: number;
  createdAt: number;
  sentAt?: number;
  lastError?: string;
};

export default function OutboxPage() {
  const [status, setStatus] = useState<string>('all');
  const [templateKey, setTemplateKey] = useState<string>('');
  const [batchSearch, setBatchSearch] = useState<string>('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const queryArgs = useMemo(
    () => ({
      status: status === 'all' ? undefined : status,
      templateKey: templateKey || undefined,
      batchId: batchSearch.trim() || undefined,
      limit: 200,
    }),
    [status, templateKey, batchSearch],
  );

  const rows = useQuery(api.messaging.queue.listOutbox, queryArgs) as Row[] | undefined;
  const cancel = useMutation(api.messaging.queue.cancelQueued);
  const retry = useMutation(api.messaging.queue.retryFailed);

  const onCancel = async (id: Id<'messageQueue'>) => {
    setBusyId(id);
    try {
      await cancel({ id });
      toast.success('Cancelled');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not cancel');
    } finally {
      setBusyId(null);
    }
  };
  const onRetry = async (id: Id<'messageQueue'>) => {
    setBusyId(id);
    try {
      await retry({ id });
      toast.success('Re-queued');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not retry');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="px-4 pt-6 pb-8 max-w-3xl mx-auto">
      <Link
        href="/messaging"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-3"
      >
        <ArrowLeft className="w-3.5 h-3.5" /> Messaging
      </Link>

      <header className="mb-4">
        <h1 className="text-2xl font-bold tracking-tight">Outbox</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Everything queued, sent, or failed. Cancel what hasn&apos;t gone yet; retry failures.
        </p>
      </header>

      {/* Filters */}
      <div className="space-y-2 mb-4">
        <div className="flex flex-wrap gap-1.5">
          {STATUSES.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatus(s)}
              className={cn(
                'h-7 px-2.5 rounded-full text-[11px] font-medium capitalize transition-colors',
                status === s
                  ? 'bg-teal-500 text-white'
                  : 'bg-muted text-muted-foreground hover:text-foreground',
              )}
            >
              {s}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <select
            value={templateKey}
            onChange={(e) => setTemplateKey(e.target.value)}
            className="h-9 rounded-md border border-border/60 bg-background px-2.5 text-xs text-foreground"
          >
            {TEMPLATES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
          <input
            value={batchSearch}
            onChange={(e) => setBatchSearch(e.target.value)}
            placeholder="Batch id (e.g. tomorrow-2026-05-30)"
            className="h-9 flex-1 min-w-[180px] rounded-md border border-border/60 bg-background px-2.5 text-xs text-foreground placeholder:text-muted-foreground"
          />
        </div>
      </div>

      {rows === undefined && (
        <div className="flex justify-center py-16">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      )}
      {rows && rows.length === 0 && (
        <Card className="border-border/60">
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            <InboxIcon className="w-7 h-7 mx-auto mb-2 opacity-40" />
            Nothing in the outbox for this filter.
          </CardContent>
        </Card>
      )}

      <div className="space-y-1.5">
        {(rows ?? []).map((r) => {
          const canCancel = r.status === 'draft' || r.status === 'queued';
          const canRetry = r.status === 'failed';
          const deferred = r.status === 'queued' && r.scheduledNotBefore > Date.now();
          return (
            <Card key={r._id} className="border-border/60">
              <CardContent className="p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        className={cn(
                          'text-[10px] font-semibold px-2 py-0.5 rounded-full capitalize',
                          STATUS_STYLE[r.status] ?? 'bg-muted text-muted-foreground',
                        )}
                      >
                        {r.status}
                      </span>
                      <span className="text-[11px] font-medium text-foreground">
                        {r.toType === 'group' ? r.targetLabel : `···${r.targetLabel.slice(-4)}`}
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        {TEMPLATES.find((t) => t.value === (r.templateKey ?? '__freeform'))?.label ??
                          r.templateKey ??
                          'Freeform'}
                      </span>
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-1 leading-snug line-clamp-2 whitespace-pre-line">
                      {r.body}
                    </p>
                    <div className="flex items-center gap-2 mt-1 text-[10px] text-muted-foreground flex-wrap">
                      <span>{r.status === 'sent' && r.sentAt ? `Sent ${fmtWhen(r.sentAt)}` : `Created ${fmtWhen(r.createdAt)}`}</span>
                      {deferred && (
                        <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
                          <Clock className="w-3 h-3" /> delivers {fmtWhen(r.scheduledNotBefore)}
                        </span>
                      )}
                      {r.batchId && <span className="opacity-70">· {r.batchId}</span>}
                    </div>
                    {r.status === 'failed' && r.lastError && (
                      <p className="text-[10px] text-destructive mt-1 line-clamp-2">{r.lastError}</p>
                    )}
                  </div>
                  {(canCancel || canRetry) && (
                    <button
                      type="button"
                      disabled={busyId === r._id}
                      onClick={() => (canRetry ? onRetry(r._id) : onCancel(r._id))}
                      className={cn(
                        'shrink-0 inline-flex items-center gap-1 h-7 px-2.5 rounded-md text-[11px] font-semibold disabled:opacity-50',
                        canRetry
                          ? 'bg-teal-500 text-white hover:bg-teal-600'
                          : 'border border-border/60 text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {busyId === r._id ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : canRetry ? (
                        <RefreshCw className="w-3 h-3" />
                      ) : (
                        <XCircle className="w-3 h-3" />
                      )}
                      {canRetry ? 'Retry' : 'Cancel'}
                    </button>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
