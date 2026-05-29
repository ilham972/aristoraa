'use client';

// Phase W.3 — /messaging/broadcasts.
//
// Compose a schedule-change announcement (template or freeform), pick target
// WhatsApp groups by scope, and send one message to each — all through the
// same queue → outbox → provider chokepoint as every other send. Group
// management (sync from WhatsApp + scope tagging + inactive list) lives in an
// inline "Manage groups" section on the same page (no drill-down).

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useAction, useMutation, useQuery } from 'convex/react';
import { toast } from 'sonner';
import {
  ArrowLeft,
  Loader2,
  Send,
  Megaphone,
  RefreshCw,
  Users,
  ChevronDown,
  Moon,
  CircleSlash,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { api, type Id } from '@/lib/convex';
import { cn } from '@/lib/utils';

const GRADES = [6, 7, 8, 9, 10, 11] as const;
const MODULES = ['M1', 'M2', 'M3', 'M4', 'M5', 'M6'] as const;

type Mode = 'template' | 'freeform';

function fmtWhen(ms: number): string {
  return new Date(ms).toLocaleString([], {
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// Preview mirrors the seeded schedule_change body. Approximate — the actual
// send renders from the (editable) DB template.
function previewText(mode: Mode, bodyText: string, freeform: string): string {
  if (mode === 'template') {
    const t = bodyText.trim();
    return t ? `📢 ${t} — Aristora` : '';
  }
  return freeform.trim();
}

export default function BroadcastsPage() {
  const [mode, setMode] = useState<Mode>('template');
  const [language, setLanguage] = useState<'ta' | 'en'>('ta');
  const [bodyText, setBodyText] = useState('');
  const [freeform, setFreeform] = useState('');

  const [fGrade, setFGrade] = useState('');
  const [fCenter, setFCenter] = useState('');
  const [fModule, setFModule] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);

  const centers = useQuery(api.centers.list) ?? [];
  const groups = useQuery(api.messaging.groupsWa.list, {
    grade: fGrade ? Number(fGrade) : undefined,
    centerId: fCenter ? (fCenter as Id<'centers'>) : undefined,
    moduleId: fModule || undefined,
  });
  const quiet = useQuery(api.messaging.broadcasts.quietHoursCheck, {});

  const draftBatch = useMutation(api.messaging.broadcasts.draftBatch);
  const approveBatch = useMutation(api.messaging.broadcasts.approveBroadcastBatch);

  const preview = previewText(mode, bodyText, freeform);
  const selectedIds = useMemo(() => Array.from(selected), [selected]);
  const hasBody = mode === 'template' ? bodyText.trim().length > 0 : freeform.trim().length > 0;
  const canSend = hasBody && selectedIds.length > 0 && !sending;

  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const doSend = async () => {
    setSending(true);
    try {
      const draftRes = await draftBatch({
        targetGroupIds: selectedIds as Id<'whatsappGroups'>[],
        templateKey: mode === 'template' ? 'schedule_change' : undefined,
        language: mode === 'template' ? language : undefined,
        bodyText: mode === 'template' ? bodyText : undefined,
        freeformBody: mode === 'freeform' ? freeform : undefined,
      });
      const appr = await approveBatch({ batchId: draftRes.batchId });
      if (appr.deferredToMorning > 0 && appr.nextWindowStart) {
        toast.success(
          `Queued ${appr.queued} — quiet hours, sending from ${fmtWhen(appr.nextWindowStart)}`,
        );
      } else {
        toast.success(`Queued ${appr.queued} message${appr.queued === 1 ? '' : 's'}`);
      }
      setSelected(new Set());
      setBodyText('');
      setFreeform('');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not send broadcast');
    } finally {
      setSending(false);
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

      <header className="mb-5">
        <h1 className="text-2xl font-bold tracking-tight inline-flex items-center gap-2">
          <Megaphone className="w-6 h-6 text-teal-500 dark:text-teal-400" /> Broadcasts
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Send one announcement to many parent WhatsApp groups. Same pacing + quiet hours as every send.
        </p>
      </header>

      {/* ── Compose ───────────────────────────────────────────────────── */}
      <Card className="border-border/60 mb-3">
        <CardContent className="p-3.5 space-y-3">
          <SectionLabel>Compose</SectionLabel>
          <div className="flex gap-1.5">
            <ModeTab active={mode === 'template'} onClick={() => setMode('template')}>
              Schedule change
            </ModeTab>
            <ModeTab active={mode === 'freeform'} onClick={() => setMode('freeform')}>
              Freeform
            </ModeTab>
          </div>

          {mode === 'template' ? (
            <>
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-muted-foreground">Language</span>
                <div className="flex rounded-lg border border-input overflow-hidden">
                  {(['ta', 'en'] as const).map((l) => (
                    <button
                      key={l}
                      type="button"
                      onClick={() => setLanguage(l)}
                      className={cn(
                        'px-2.5 py-1 text-[11px] font-medium',
                        language === l
                          ? 'bg-teal-500/15 text-teal-700 dark:text-teal-400'
                          : 'text-muted-foreground hover:bg-muted',
                      )}
                    >
                      {l === 'ta' ? 'Tamil' : 'English'}
                    </button>
                  ))}
                </div>
              </div>
              <textarea
                value={bodyText}
                onChange={(e) => setBodyText(e.target.value)}
                placeholder="e.g. Tomorrow's M3 class moved to 4pm."
                rows={3}
                className="w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring resize-none"
              />
            </>
          ) : (
            <textarea
              value={freeform}
              onChange={(e) => setFreeform(e.target.value)}
              placeholder="Type the exact message to send. (You manage the language.)"
              rows={3}
              className="w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring resize-none"
            />
          )}

          {preview && (
            <div className="rounded-lg bg-muted/60 p-2.5">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Preview</p>
              <p className="text-xs text-foreground whitespace-pre-wrap">{preview}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Targets ───────────────────────────────────────────────────── */}
      <Card className="border-border/60 mb-3">
        <CardContent className="p-3.5 space-y-3">
          <SectionLabel>Target groups</SectionLabel>
          <div className="grid grid-cols-3 gap-2">
            <FilterSelect label="Grade" value={fGrade} onChange={setFGrade}
              options={GRADES.map((g) => ({ value: String(g), label: `Grade ${g}` }))} />
            <FilterSelect label="Center" value={fCenter} onChange={setFCenter}
              options={centers.map((c) => ({ value: c._id, label: c.name }))} />
            <FilterSelect label="Module" value={fModule} onChange={setFModule}
              options={MODULES.map((m) => ({ value: m, label: m }))} />
          </div>

          {groups === undefined ? (
            <div className="flex justify-center py-6">
              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
            </div>
          ) : groups.length === 0 ? (
            <div className="text-center py-6">
              <p className="text-xs text-muted-foreground mb-2">
                No matching groups. Sync from WhatsApp and tag groups below.
              </p>
            </div>
          ) : (
            <ul className="space-y-1.5">
              {groups.map((g) => (
                <li key={g._id}>
                  <button
                    type="button"
                    onClick={() => toggle(g._id)}
                    className={cn(
                      'w-full flex items-center gap-2.5 rounded-lg border p-2.5 text-left transition-colors',
                      selected.has(g._id)
                        ? 'border-teal-500 bg-teal-500/[0.07]'
                        : 'border-border/60 hover:bg-muted/50',
                    )}
                  >
                    <span
                      className={cn(
                        'w-4 h-4 rounded border flex items-center justify-center shrink-0',
                        selected.has(g._id) ? 'bg-teal-500 border-teal-500' : 'border-input',
                      )}
                    >
                      {selected.has(g._id) && <span className="w-1.5 h-1.5 rounded-sm bg-white" />}
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{g.displayName}</p>
                      <p className="text-[10px] text-muted-foreground">{scopeLabel(g.scope, centers)}</p>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* ── Send ──────────────────────────────────────────────────────── */}
      <Button
        className="w-full h-11"
        disabled={!canSend}
        onClick={() => setConfirmOpen(true)}
      >
        <Send className="w-4 h-4 mr-1.5" />
        Send to {selectedIds.length} group{selectedIds.length === 1 ? '' : 's'}
      </Button>

      {/* ── Manage groups (inline accordion) ──────────────────────────── */}
      <ManageGroups open={manageOpen} onToggle={() => setManageOpen((o) => !o)} centers={centers} />

      {/* ── Confirm modal ─────────────────────────────────────────────── */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send to {selectedIds.length} group{selectedIds.length === 1 ? '' : 's'}?</DialogTitle>
            <DialogDescription>
              {quiet?.inQuietHours ? (
                <span className="inline-flex items-start gap-1.5 text-amber-600">
                  <Moon className="w-4 h-4 mt-0.5 shrink-0" />
                  Quiet hours (9pm–7am) are active — messages will start sending around{' '}
                  {quiet.nextWindowStart ? fmtWhen(quiet.nextWindowStart) : '07:00'}, not now.
                </span>
              ) : (
                'Each group receives one message, spaced out to mimic a human (35s–2min apart).'
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={sending}>
              Cancel
            </Button>
            <Button onClick={doSend} disabled={sending}>
              {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : quiet?.inQuietHours ? 'Queue anyway' : 'Send'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Manage groups section ──────────────────────────────────────────────

function ManageGroups({
  open,
  onToggle,
  centers,
}: {
  open: boolean;
  onToggle: () => void;
  centers: Array<{ _id: string; name: string }>;
}) {
  const active = useQuery(api.messaging.groupsWa.list, {});
  const inactive = useQuery(api.messaging.groupsWa.listInactive, {});
  const sync = useAction(api.messaging.groupsWa.syncFromOpenWa);
  const [syncing, setSyncing] = useState(false);

  const onSync = async () => {
    setSyncing(true);
    try {
      const res = await sync({});
      toast.success(`Synced — ${res.added} added, ${res.updated} updated, ${res.deactivated} removed`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Sync failed');
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="mt-4">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between py-2 text-sm font-semibold text-foreground"
      >
        <span className="inline-flex items-center gap-2">
          <Users className="w-4 h-4 text-muted-foreground" /> Manage groups
        </span>
        <ChevronDown className={cn('w-4 h-4 transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="space-y-3 pt-1">
          <Button variant="outline" className="w-full" onClick={onSync} disabled={syncing}>
            {syncing ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> : <RefreshCw className="w-4 h-4 mr-1.5" />}
            Sync groups from WhatsApp
          </Button>

          {active && active.length > 0 && (
            <div className="space-y-2">
              {active.map((g) => (
                <ManageRow key={g._id} group={g} centers={centers} />
              ))}
            </div>
          )}

          {inactive && inactive.length > 0 && (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
                Inactive (bot removed)
              </p>
              <div className="space-y-1">
                {inactive.map((g) => (
                  <div
                    key={g._id}
                    className="flex items-center gap-2 text-xs text-muted-foreground rounded-lg bg-muted/40 px-2.5 py-1.5"
                  >
                    <CircleSlash className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">{g.displayName}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ManageRow({
  group,
  centers,
}: {
  group: {
    _id: string;
    displayName: string;
    syncedAt?: number;
    scope?: { grade?: number; centerId?: string; moduleId?: string; groupId?: string };
  };
  centers: Array<{ _id: string; name: string }>;
}) {
  const setScope = useMutation(api.messaging.groupsWa.setScope);
  const [grade, setGrade] = useState(group.scope?.grade ? String(group.scope.grade) : '');
  const [center, setCenter] = useState(group.scope?.centerId ?? '');
  const [moduleId, setModuleId] = useState(group.scope?.moduleId ?? '');

  const save = async (next: { grade?: string; center?: string; moduleId?: string }) => {
    const g = next.grade ?? grade;
    const c = next.center ?? center;
    const m = next.moduleId ?? moduleId;
    try {
      await setScope({
        id: group._id as Id<'whatsappGroups'>,
        scope: {
          grade: g ? Number(g) : undefined,
          centerId: c ? (c as Id<'centers'>) : undefined,
          moduleId: m || undefined,
        },
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save scope');
    }
  };

  return (
    <div className="rounded-lg border border-border/60 p-2.5">
      <p className="text-sm font-medium text-foreground truncate mb-2">{group.displayName}</p>
      <div className="grid grid-cols-3 gap-2">
        <FilterSelect label="Grade" value={grade}
          onChange={(v) => { setGrade(v); save({ grade: v }); }}
          options={GRADES.map((x) => ({ value: String(x), label: `G${x}` }))} />
        <FilterSelect label="Center" value={center}
          onChange={(v) => { setCenter(v); save({ center: v }); }}
          options={centers.map((c) => ({ value: c._id, label: c.name }))} />
        <FilterSelect label="Module" value={moduleId}
          onChange={(v) => { setModuleId(v); save({ moduleId: v }); }}
          options={MODULES.map((x) => ({ value: x, label: x }))} />
      </div>
    </div>
  );
}

// ── Small shared bits ──────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{children}</p>
  );
}

function ModeTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
        active ? 'bg-teal-500 text-white' : 'bg-muted text-muted-foreground hover:bg-muted/70',
      )}
    >
      {children}
    </button>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <label className="block">
      <span className="text-[10px] text-muted-foreground">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-0.5 w-full h-8 rounded-lg border border-input bg-transparent px-2 text-xs outline-none focus-visible:border-ring"
      >
        <option value="">Any</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function scopeLabel(
  scope: { grade?: number; centerId?: string; moduleId?: string } | undefined,
  centers: Array<{ _id: string; name: string }>,
): string {
  if (!scope) return 'No scope tags';
  const parts: string[] = [];
  if (scope.grade) parts.push(`Grade ${scope.grade}`);
  if (scope.centerId) parts.push(centers.find((c) => c._id === scope.centerId)?.name ?? 'Center');
  if (scope.moduleId) parts.push(scope.moduleId);
  return parts.length ? parts.join(' · ') : 'No scope tags';
}
