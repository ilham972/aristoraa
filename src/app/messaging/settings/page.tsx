'use client';

import { useEffect, useState } from 'react';
import { useAction, useMutation, useQuery } from 'convex/react';
import { api } from '@/lib/convex';
import { useCurrentTeacher } from '@/hooks/useCurrentTeacher';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import {
  ArrowLeft,
  RefreshCw,
  Send,
  Link2,
  PhoneCall,
  ListChecks,
  FileCheck,
  ArrowDownLeft,
  ArrowUpRight,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Power,
} from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

type StatusKind = 'unknown' | 'ready' | 'qr_ready' | 'disconnected' | 'loading' | 'error';

function statusKind(status: string | undefined): StatusKind {
  if (!status) return 'unknown';
  const s = status.toLowerCase();
  if (s === 'ready' || s === 'connected') return 'ready';
  if (s === 'qr_ready') return 'qr_ready';
  if (s === 'loading' || s === 'initializing') return 'loading';
  if (s === 'disconnected' || s === 'destroyed' || s.includes('auth')) return 'disconnected';
  return 'unknown';
}

const STATUS_PILL: Record<StatusKind, { label: string; cls: string; icon: typeof CheckCircle2 }> = {
  ready: { label: 'Ready', cls: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30', icon: CheckCircle2 },
  qr_ready: { label: 'QR scan needed', cls: 'bg-amber-500/15 text-amber-400 border-amber-500/30', icon: AlertTriangle },
  disconnected: { label: 'Disconnected', cls: 'bg-red-500/15 text-red-400 border-red-500/30', icon: XCircle },
  loading: { label: 'Initializing', cls: 'bg-sky-500/15 text-sky-400 border-sky-500/30', icon: Power },
  unknown: { label: 'Unknown', cls: 'bg-slate-500/15 text-slate-400 border-slate-500/30', icon: AlertTriangle },
  error: { label: 'Error', cls: 'bg-red-500/15 text-red-400 border-red-500/30', icon: XCircle },
};

function formatPhone(value: string | null | undefined): string {
  if (!value) return '—';
  return value;
}

function formatTime(ms: number | undefined | null): string {
  if (!ms) return '—';
  const d = new Date(ms);
  return d.toLocaleString();
}

export default function MessagingSettingsPage() {
  const config = useQuery(api.messaging.settings.getConfig);
  const activity = useQuery(api.messaging.settings.recentActivity, { limit: 15 });
  const optedOut = useQuery(api.messaging.settings.optedOutContacts);
  const { teacher } = useCurrentTeacher();
  const setPhone = useMutation(api.teachers.setMyPersonalWhatsappPhone);
  const sendTest = useMutation(api.messaging.sendTest.sendTestFromSettings);
  const optIn = useMutation(api.messaging.contacts.optIn);
  const seedTemplates = useMutation(api.messaging.seedTemplates.run);
  const normalizePhones = useMutation(api.migrations.normalizeParentPhones);
  const checkStatus = useAction(api.messaging.sessionStatus.getStatus);
  const configureWebhook = useAction(api.messaging.connectWebhook.configure);

  const [statusResult, setStatusResult] = useState<Awaited<ReturnType<typeof checkStatus>> | null>(null);
  const [statusBusy, setStatusBusy] = useState(false);
  const [phoneInput, setPhoneInput] = useState('');
  const [phoneSaving, setPhoneSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [webhookBusy, setWebhookBusy] = useState(false);
  const [seedBusy, setSeedBusy] = useState(false);
  const [normalizeBusy, setNormalizeBusy] = useState(false);
  const [normalizeResult, setNormalizeResult] =
    useState<Awaited<ReturnType<typeof normalizePhones>> | null>(null);

  useEffect(() => {
    if (teacher && teacher.personalWhatsappPhone) {
      setPhoneInput(teacher.personalWhatsappPhone);
    }
  }, [teacher]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        setStatusBusy(true);
        const r = await checkStatus({});
        if (!cancelled) setStatusResult(r);
      } catch (err) {
        if (!cancelled) {
          setStatusResult({ ok: false, reachable: false, error: String(err), checkedAt: Date.now() });
        }
      } finally {
        if (!cancelled) setStatusBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [checkStatus]);

  const refresh = async () => {
    setStatusBusy(true);
    try {
      const r = await checkStatus({});
      setStatusResult(r);
    } catch (err) {
      setStatusResult({ ok: false, reachable: false, error: String(err), checkedAt: Date.now() });
    } finally {
      setStatusBusy(false);
    }
  };

  const kind = statusResult?.ok
    ? statusKind(statusResult.session.status)
    : statusResult?.reachable
      ? 'unknown'
      : 'error';
  const pill = STATUS_PILL[kind];

  const handleSavePhone = async () => {
    setPhoneSaving(true);
    try {
      const r = await setPhone({ phone: phoneInput });
      toast.success(r.phone ? `Saved ${r.phone}` : 'Phone cleared');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setPhoneSaving(false);
    }
  };

  const handleSendTest = async () => {
    setSending(true);
    try {
      const r = await sendTest({});
      toast.success(`Test queued → ${r.sentTo}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Send test failed');
    } finally {
      setSending(false);
    }
  };

  const handleConnectWebhook = async () => {
    setWebhookBusy(true);
    try {
      const r = await configureWebhook({});
      toast.success(`Webhook registered: ${r.registeredUrl}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Webhook registration failed');
    } finally {
      setWebhookBusy(false);
    }
  };

  const handleSeedTemplates = async () => {
    setSeedBusy(true);
    try {
      const r = await seedTemplates({});
      toast.success(`Templates: ${r.inserted} new, ${r.skipped} already present`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Seeding failed');
    } finally {
      setSeedBusy(false);
    }
  };

  const handleNormalizePhones = async (dryRun: boolean) => {
    setNormalizeBusy(true);
    try {
      const r = await normalizePhones({ dryRun });
      setNormalizeResult(r);
      toast.success(
        `${r.normalized} normalized · ${r.alreadyNormalized} already E.164 · ${r.rejectedCount} rejected${dryRun ? ' (dry-run)' : ''}`,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Normalize failed');
    } finally {
      setNormalizeBusy(false);
    }
  };

  return (
    <div className="px-4 pt-6 pb-10 max-w-2xl mx-auto space-y-5">
      <header>
        <Link
          href="/messaging"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Back to messaging
        </Link>
        <h1 className="mt-2 text-2xl font-bold tracking-tight">Messaging — Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Open-WA connection, dev-mode safety, and W.1 acceptance-test controls.
        </p>
      </header>

      {config?.devMode && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3.5 py-3 text-sm">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 mt-0.5 text-amber-400 shrink-0" />
            <div>
              <div className="font-semibold text-amber-200">Dev mode is ON</div>
              <div className="text-amber-300/90 text-xs mt-0.5">
                Every outbound message is redirected to{' '}
                <span className="font-mono">{config.devNumber ?? 'WHATSAPP_DEV_NUMBER'}</span>{' '}
                with a <span className="font-mono">[DEV → orig +94…]</span> prefix. No real parent will be messaged.
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Connection */}
      <Card className="border-border/60">
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Bot connection</div>
              <div className="mt-1 flex items-center gap-2">
                <pill.icon className={cn('w-4 h-4', pill.cls.split(' ').find((c) => c.startsWith('text-')))} />
                <Badge variant="outline" className={cn('font-medium', pill.cls)}>
                  {pill.label}
                </Badge>
                {statusResult?.ok && (
                  <span className="text-xs text-muted-foreground">
                    {statusResult.session.status}
                    {statusResult.session.phone ? ` · +${statusResult.session.phone}` : ''}
                  </span>
                )}
              </div>
            </div>
            <Button size="sm" variant="ghost" onClick={refresh} disabled={statusBusy}>
              <RefreshCw className={cn('w-3.5 h-3.5 mr-1.5', statusBusy && 'animate-spin')} />
              Refresh
            </Button>
          </div>
          {statusResult && !statusResult.ok && (
            <div className="text-xs text-red-300/90 bg-red-500/10 border border-red-500/30 rounded px-2.5 py-2">
              {statusResult.error}
            </div>
          )}
          {kind === 'qr_ready' && (
            <div className="text-xs text-amber-200 bg-amber-500/10 border border-amber-500/30 rounded px-2.5 py-2">
              Open the Open-WA dashboard, find session{' '}
              <span className="font-mono">{config?.sessionId?.slice(0, 8)}…</span>, and re-scan the QR
              with the business phone.{' '}
              {config?.baseUrl && (
                <a
                  href={config.baseUrl.replace(/\/api\/?$/, '/dashboard')}
                  target="_blank"
                  rel="noreferrer"
                  className="underline"
                >
                  Open dashboard
                </a>
              )}
            </div>
          )}
          {statusResult?.checkedAt && (
            <div className="text-[11px] text-muted-foreground">Checked {formatTime(statusResult.checkedAt)}</div>
          )}
          <Separator className="my-1" />
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <div className="text-muted-foreground">Provider</div>
              <div className="font-mono">{config?.provider ?? '—'}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Session id</div>
              <div className="font-mono truncate">{config?.sessionId ?? '—'}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Base URL</div>
              <div className="font-mono truncate">{config?.baseUrl ?? '—'}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Webhook secret</div>
              <div className="font-mono">{config?.webhookSecretConfigured ? 'set' : 'missing'}</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* My WhatsApp */}
      <Card className="border-border/60">
        <CardContent className="p-4 space-y-3">
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">My personal WhatsApp</div>
            <div className="text-xs text-muted-foreground mt-0.5">
              Where inbound parent replies get forwarded for you. Also the target of the "Send test" button.
            </div>
          </div>
          <div className="flex gap-2">
            <Input
              value={phoneInput}
              onChange={(e) => setPhoneInput(e.target.value)}
              placeholder="0788079051 or +94788079051"
              className="font-mono"
            />
            <Button onClick={handleSavePhone} disabled={phoneSaving} size="sm">
              Save
            </Button>
          </div>
          {teacher?.personalWhatsappPhone && (
            <div className="text-xs text-muted-foreground">
              Stored: <span className="font-mono">{teacher.personalWhatsappPhone}</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Actions */}
      <Card className="border-border/60">
        <CardContent className="p-4 space-y-3">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Quick actions</div>

          <div className="space-y-2">
            <Button
              onClick={handleSendTest}
              disabled={sending || !teacher?.personalWhatsappPhone}
              className="w-full justify-start"
              variant="outline"
            >
              <Send className="w-4 h-4 mr-2" />
              {sending ? 'Queueing…' : 'Send test message (to my WhatsApp)'}
            </Button>

            <Button
              onClick={handleConnectWebhook}
              disabled={webhookBusy}
              className="w-full justify-start"
              variant="outline"
            >
              <Link2 className="w-4 h-4 mr-2" />
              {webhookBusy ? 'Registering…' : 'Register webhook with Open-WA'}
            </Button>

            <Button
              onClick={handleSeedTemplates}
              disabled={seedBusy}
              className="w-full justify-start"
              variant="outline"
            >
              <FileCheck className="w-4 h-4 mr-2" />
              {seedBusy ? 'Seeding…' : 'Seed message templates (idempotent)'}
            </Button>

            <div className="grid grid-cols-2 gap-2">
              <Button
                onClick={() => handleNormalizePhones(true)}
                disabled={normalizeBusy}
                variant="outline"
              >
                <ListChecks className="w-4 h-4 mr-2" />
                Normalize (dry-run)
              </Button>
              <Button
                onClick={() => handleNormalizePhones(false)}
                disabled={normalizeBusy}
                variant="outline"
              >
                <ListChecks className="w-4 h-4 mr-2" />
                Normalize (apply)
              </Button>
            </div>

            {normalizeResult && (
              <div className="rounded border border-border/60 bg-card/40 px-3 py-2 text-xs space-y-1">
                <div className="font-semibold">
                  Normalize result{normalizeResult.dryRun ? ' (dry-run)' : ''}
                </div>
                <div>
                  Total {normalizeResult.total} · Normalized {normalizeResult.normalized} · Already E.164{' '}
                  {normalizeResult.alreadyNormalized} · Rejected {normalizeResult.rejectedCount}
                </div>
                {normalizeResult.rejected.length > 0 && (
                  <ul className="mt-1.5 space-y-0.5 text-muted-foreground">
                    {normalizeResult.rejected.slice(0, 5).map((r) => (
                      <li key={r.id} className="font-mono">
                        {r.name}: {r.parentPhone}
                      </li>
                    ))}
                    {normalizeResult.rejected.length > 5 && (
                      <li>… +{normalizeResult.rejected.length - 5} more</li>
                    )}
                  </ul>
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Opt-out list */}
      <Card className="border-border/60">
        <CardContent className="p-4 space-y-3">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            Opted-out parents ({optedOut?.length ?? 0})
          </div>
          {optedOut === undefined ? (
            <div className="text-xs text-muted-foreground">Loading…</div>
          ) : optedOut.length === 0 ? (
            <div className="text-xs text-muted-foreground">
              Nobody has opted out yet. Inbound STOP / UNSUBSCRIBE messages will appear here.
            </div>
          ) : (
            <ul className="divide-y divide-border/40">
              {optedOut.map((c) => (
                <li key={c._id} className="flex items-center justify-between py-2">
                  <div>
                    <div className="font-mono text-sm">{c.phoneE164}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {c.displayName ?? 'No name'} · opted out {formatTime(c.optedOutAt)}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={async () => {
                      try {
                        await optIn({ phone: c.phoneE164 });
                        toast.success(`Opted ${c.phoneE164} back in`);
                      } catch (err) {
                        toast.error(err instanceof Error ? err.message : 'Opt-in failed');
                      }
                    }}
                  >
                    Opt back in
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Recent activity */}
      <Card className="border-border/60">
        <CardContent className="p-4 space-y-3">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Recent messaging activity</div>
          {activity === undefined ? (
            <div className="text-xs text-muted-foreground">Loading…</div>
          ) : activity.length === 0 ? (
            <div className="text-xs text-muted-foreground">No messages logged yet.</div>
          ) : (
            <ul className="divide-y divide-border/40">
              {activity.map((row) => {
                const inbound = row.direction === 'in';
                const Icon = inbound ? ArrowDownLeft : ArrowUpRight;
                const colorCls = inbound
                  ? 'text-teal-400'
                  : row.status === 'sent'
                    ? 'text-emerald-400'
                    : 'text-red-400';
                return (
                  <li key={row._id} className="py-2 text-sm">
                    <div className="flex items-start gap-2">
                      <Icon className={cn('w-4 h-4 mt-0.5 shrink-0', colorCls)} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono text-xs">
                            {row.phoneE164 ?? row.whatsappGroupId ?? '—'}
                          </span>
                          <span className="text-[11px] text-muted-foreground shrink-0">
                            {formatTime(row.occurredAt)}
                          </span>
                        </div>
                        <div className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
                          {row.body}
                        </div>
                        <div className="mt-0.5 flex items-center gap-2 text-[11px]">
                          <span className={colorCls}>{inbound ? 'inbound' : `out · ${row.status}`}</span>
                          {row.errorMessage && (
                            <span className="text-red-300/80 truncate">{row.errorMessage}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <div className="text-center text-[11px] text-muted-foreground">
        <PhoneCall className="inline w-3 h-3 mr-1" />
        Acceptance test: see plan §9, Phase W.1.
      </div>
    </div>
  );
}
