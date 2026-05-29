'use client';

// Phase W.5.C — /messaging/templates.
//
// Edit template body text (especially Tamil) without a deploy. The variable
// CONTRACT stays in code; an edited body is validated against it (client-side
// for instant feedback, re-checked server-side on save) so the fail-loud
// renderer can never meet a stale var in a parent's inbox. Live preview renders
// the body with sample values via previewTemplate (no DB write).

import { useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery } from 'convex/react';
import { toast } from 'sonner';
import { ArrowLeft, Loader2, Pencil, Check, AlertCircle } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/convex';
import { cn } from '@/lib/utils';

const KEY_LABELS: Record<string, string> = {
  absence_alert: 'Absence alert',
  tomorrow_reminder: 'Tomorrow reminder',
  weekly_card: 'Weekly card',
  schedule_change: 'Broadcast / schedule change',
  auto_ack_parent: 'Auto-acknowledgement',
  homework_pdf_parent: 'Homework PDF',
  exam_result_parent: 'Exam result',
};
const LANG_LABEL: Record<string, string> = { ta: 'தமிழ் (Tamil)', en: 'English' };

type Tmpl = {
  id: string;
  key: string;
  language: string;
  body: string;
  active: boolean;
  updatedAt: number;
  updatedByName: string | null;
  vars: string[];
};

const VAR_RE = /\{\{\s*(\w+)\s*\}\}/g;
function usedVars(body: string): string[] {
  const seen: string[] = [];
  let m: RegExpExecArray | null;
  const re = new RegExp(VAR_RE.source, 'g');
  while ((m = re.exec(body)) !== null) if (!seen.includes(m[1])) seen.push(m[1]);
  return seen;
}
function bodyErrors(body: string, vars: string[]): string[] {
  const errs: string[] = [];
  for (const u of usedVars(body)) if (!vars.includes(u)) errs.push(`unknown variable: ${u}`);
  for (const r of vars) if (!usedVars(body).includes(r)) errs.push(`missing required variable: ${r}`);
  if (body.trim().length === 0) errs.push('body is empty');
  return errs;
}

export default function TemplatesPage() {
  const templates = useQuery(api.messaging.templatesAdmin.listTemplates, {}) as
    | Tmpl[]
    | undefined;
  const [editing, setEditing] = useState<Tmpl | null>(null);

  const grouped = useMemo(() => {
    const map = new Map<string, Tmpl[]>();
    for (const t of templates ?? []) {
      const list = map.get(t.key) ?? [];
      list.push(t);
      map.set(t.key, list);
    }
    return Array.from(map.entries());
  }, [templates]);

  return (
    <div className="px-4 pt-6 pb-8 max-w-2xl mx-auto">
      <Link
        href="/messaging"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-3"
      >
        <ArrowLeft className="w-3.5 h-3.5" /> Messaging
      </Link>

      <header className="mb-4">
        <h1 className="text-2xl font-bold tracking-tight">Templates</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Edit the wording parents see. Variables in {'{{ }}'} are filled automatically at send
          time — keep them as-is.
        </p>
      </header>

      {templates === undefined && (
        <div className="flex justify-center py-16">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      )}

      <div className="space-y-3">
        {grouped.map(([key, rows]) => (
          <Card key={key} className="border-border/60">
            <CardContent className="p-3.5">
              <p className="text-sm font-semibold text-foreground mb-2">
                {KEY_LABELS[key] ?? key}
              </p>
              <div className="space-y-2">
                {rows
                  .slice()
                  .sort((a, b) => a.language.localeCompare(b.language))
                  .map((t) => (
                    <div
                      key={t.id}
                      className="rounded-md border border-border/60 p-2.5 flex items-start justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                          {LANG_LABEL[t.language] ?? t.language}
                        </span>
                        <p className="text-[12px] text-foreground mt-1.5 leading-snug whitespace-pre-line">
                          {t.body}
                        </p>
                        {t.updatedByName && (
                          <p className="text-[10px] text-muted-foreground mt-1">
                            Last edited by {t.updatedByName} ·{' '}
                            {new Date(t.updatedAt).toLocaleDateString()}
                          </p>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => setEditing(t)}
                        className="shrink-0 inline-flex items-center gap-1 h-7 px-2.5 rounded-md text-[11px] font-semibold border border-border/60 text-muted-foreground hover:text-foreground"
                      >
                        <Pencil className="w-3 h-3" /> Edit
                      </button>
                    </div>
                  ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {editing && (
        <EditModal tmpl={editing} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

function EditModal({ tmpl, onClose }: { tmpl: Tmpl; onClose: () => void }) {
  const update = useMutation(api.messaging.templatesAdmin.updateTemplate);
  const [body, setBody] = useState(tmpl.body);
  const [sampleVars, setSampleVars] = useState<Record<string, string>>(
    Object.fromEntries(tmpl.vars.map((v) => [v, ''])),
  );
  const [saving, setSaving] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const errors = useMemo(() => bodyErrors(body, tmpl.vars), [body, tmpl.vars]);
  const valid = errors.length === 0;

  const preview = useQuery(api.messaging.templatesAdmin.previewTemplate, {
    key: tmpl.key,
    body,
    sampleVars,
  });

  const insertVar = (v: string) => {
    const ta = taRef.current;
    const token = `{{${v}}}`;
    if (!ta) {
      setBody((b) => b + token);
      return;
    }
    const start = ta.selectionStart ?? body.length;
    const end = ta.selectionEnd ?? body.length;
    const next = body.slice(0, start) + token + body.slice(end);
    setBody(next);
    requestAnimationFrame(() => {
      ta.focus();
      const pos = start + token.length;
      ta.setSelectionRange(pos, pos);
    });
  };

  const onSave = async () => {
    setSaving(true);
    try {
      const res = (await update({ key: tmpl.key, language: tmpl.language, body })) as {
        ok: boolean;
        errors?: string[];
      };
      if (res.ok) {
        toast.success('Template saved');
        onClose();
      } else {
        toast.error(res.errors?.[0] ?? 'Validation failed');
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {KEY_LABELS[tmpl.key] ?? tmpl.key} · {LANG_LABEL[tmpl.language] ?? tmpl.language}
          </DialogTitle>
          <DialogDescription>
            Tap a variable to insert it. Preview uses sample values.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {/* Variable chips */}
          {tmpl.vars.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {tmpl.vars.map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => insertVar(v)}
                  className={cn(
                    'text-[10px] font-mono px-1.5 py-0.5 rounded border',
                    usedVars(body).includes(v)
                      ? 'border-teal-500/50 bg-teal-500/10 text-teal-600 dark:text-teal-400'
                      : 'border-border/60 text-muted-foreground hover:text-foreground',
                  )}
                >
                  {`{{${v}}}`}
                </button>
              ))}
            </div>
          )}

          {/* Body editor */}
          <textarea
            ref={taRef}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={5}
            className="w-full resize-none rounded-md border border-border/60 bg-background px-3 py-2 text-[13px] text-foreground focus:outline-none focus:ring-1 focus:ring-teal-500"
          />

          {/* Inline validation */}
          {errors.length > 0 && (
            <div className="space-y-0.5">
              {errors.map((e) => (
                <p key={e} className="text-[11px] text-destructive inline-flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" /> {e}
                </p>
              ))}
            </div>
          )}

          {/* Sample vars */}
          {tmpl.vars.length > 0 && (
            <div className="grid grid-cols-2 gap-1.5">
              {tmpl.vars.map((v) => (
                <input
                  key={v}
                  value={sampleVars[v] ?? ''}
                  onChange={(e) => setSampleVars((s) => ({ ...s, [v]: e.target.value }))}
                  placeholder={v}
                  className="h-8 rounded-md border border-border/60 bg-background px-2 text-[11px] text-foreground placeholder:text-muted-foreground"
                />
              ))}
            </div>
          )}

          {/* Live preview */}
          <div className="rounded-md bg-muted/50 border border-border/60 p-2.5">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Preview</p>
            {preview === undefined ? (
              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
            ) : preview.ok ? (
              <p className="text-[13px] text-foreground whitespace-pre-line leading-snug">
                {preview.rendered}
              </p>
            ) : (
              <p className="text-[11px] text-destructive">{preview.error}</p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={onSave} disabled={!valid || saving}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4 mr-1" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
