'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@/lib/convex';
import type { Id } from '@/lib/convex';
import { toast } from 'sonner';
import { ChevronDown, ChevronUp, RotateCcw } from 'lucide-react';

type PartOverride = {
  partCode: string;
  questionCount?: number;
  marksPerQuestion?: number;
  requiredCount?: number;
};

interface Props {
  paperId: Id<'pastPapers'>;
  grade: number;
  initialOverrides?: PartOverride[];
}

// Per-paper structure overrides for G6–G9 papers. Reads the grade's default
// structure, lets the user edit (count, marks, required) per part. Saves
// only the diverging fields (others fall through to default). Hidden for
// G10/G11 by the parent — national structure never overridden.
export function PaperOverridesEditor({ paperId, grade, initialOverrides }: Props) {
  const structure = useQuery(api.paperStructures.getByGrade, { grade });
  const setPaperOverrides = useMutation(api.paperStructures.setPaperOverrides);

  const [open, setOpen] = useState(
    Array.isArray(initialOverrides) && initialOverrides.length > 0,
  );
  const [draft, setDraft] = useState<Record<string, {
    questionCount: string;
    marksPerQuestion: string;
    requiredCount: string;
  }>>({});
  const [saving, setSaving] = useState(false);

  // Hydrate draft when structure loads — pre-fill with override-or-default.
  useEffect(() => {
    if (!structure) return;
    const next: typeof draft = {};
    const overrideByCode = new Map(
      (initialOverrides ?? []).map((o) => [o.partCode, o]),
    );
    for (const p of structure.parts) {
      const ov = overrideByCode.get(p.partCode);
      next[p.partCode] = {
        questionCount: String(ov?.questionCount ?? p.questionCount),
        marksPerQuestion: String(ov?.marksPerQuestion ?? p.marksPerQuestion),
        requiredCount: String(ov?.requiredCount ?? p.requiredCount),
      };
    }
    setDraft(next);
  }, [structure, initialOverrides]);

  const partsByCode = useMemo(() => {
    const m = new Map<string, NonNullable<typeof structure>['parts'][number]>();
    if (!structure) return m;
    for (const p of structure.parts) m.set(p.partCode, p);
    return m;
  }, [structure]);

  const computeOverrides = (): PartOverride[] => {
    const out: PartOverride[] = [];
    for (const [partCode, vals] of Object.entries(draft)) {
      const def = partsByCode.get(partCode);
      if (!def) continue;
      const qc = parseInt(vals.questionCount, 10);
      const mq = parseInt(vals.marksPerQuestion, 10);
      const rc = parseInt(vals.requiredCount, 10);
      const ov: PartOverride = { partCode };
      if (!isNaN(qc) && qc !== def.questionCount) ov.questionCount = qc;
      if (!isNaN(mq) && mq !== def.marksPerQuestion) ov.marksPerQuestion = mq;
      if (!isNaN(rc) && rc !== def.requiredCount) ov.requiredCount = rc;
      // Only include if at least one field diverges.
      if (ov.questionCount !== undefined ||
          ov.marksPerQuestion !== undefined ||
          ov.requiredCount !== undefined) {
        out.push(ov);
      }
    }
    return out;
  };

  const handleSave = async () => {
    if (!structure) return;
    // Light validation — required ≤ count.
    for (const [partCode, vals] of Object.entries(draft)) {
      const qc = parseInt(vals.questionCount, 10);
      const rc = parseInt(vals.requiredCount, 10);
      if (!isNaN(qc) && !isNaN(rc) && rc > qc) {
        toast.error(`${partCode}: required cannot exceed question count`);
        return;
      }
    }
    setSaving(true);
    try {
      const overrides = computeOverrides();
      await setPaperOverrides({
        paperId,
        partOverrides: overrides.length > 0 ? overrides : undefined,
      });
      toast.success(
        overrides.length > 0
          ? `Saved ${overrides.length} override${overrides.length === 1 ? '' : 's'}`
          : 'Reset to defaults',
      );
    } catch (e) {
      console.error(e);
      toast.error(e instanceof Error ? e.message : 'Could not save overrides');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    if (!structure) return;
    setSaving(true);
    try {
      await setPaperOverrides({ paperId, partOverrides: undefined });
      // Reset draft to defaults.
      const next: typeof draft = {};
      for (const p of structure.parts) {
        next[p.partCode] = {
          questionCount: String(p.questionCount),
          marksPerQuestion: String(p.marksPerQuestion),
          requiredCount: String(p.requiredCount),
        };
      }
      setDraft(next);
      toast.success('Reset to defaults');
    } catch (e) {
      console.error(e);
      toast.error('Could not reset');
    } finally {
      setSaving(false);
    }
  };

  if (structure === undefined) return null;
  if (structure === null) {
    return (
      <div className="rounded-lg border border-dashed border-border/60 bg-muted/30 px-3 py-2.5">
        <p className="text-[11px] text-muted-foreground">
          No structure for Grade {grade}. Set up via Settings → Exam.
        </p>
      </div>
    );
  }

  const hasOverrides = computeOverrides().length > 0;

  return (
    <div className="rounded-lg border border-border/60 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-3 py-2 bg-muted/40 hover:bg-muted/60 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-foreground">
            Customize structure
          </span>
          {hasOverrides && (
            <span className="text-[9px] font-medium uppercase tracking-wide rounded px-1.5 py-0.5 bg-amber-500/20 text-amber-600 dark:text-amber-400">
              Modified
            </span>
          )}
        </div>
        {open ? (
          <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" />
        ) : (
          <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
        )}
      </button>
      {open && (
        <div className="px-3 py-3 space-y-3 bg-card">
          {structure.parts.map((p) => {
            const vals = draft[p.partCode] ?? {
              questionCount: String(p.questionCount),
              marksPerQuestion: String(p.marksPerQuestion),
              requiredCount: String(p.requiredCount),
            };
            return (
              <div key={p._id} className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[10px] font-bold rounded px-1.5 py-0.5 bg-primary/10 text-primary shrink-0">
                    {p.partCode}
                  </span>
                  <span className="text-[11px] text-muted-foreground truncate">
                    {p.partLabel}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  <input
                    type="number"
                    value={vals.questionCount}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        [p.partCode]: { ...vals, questionCount: e.target.value },
                      }))
                    }
                    placeholder={`${p.questionCount}`}
                    className="h-8 px-2 rounded-md bg-muted border border-border/60 text-xs font-mono outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary"
                    aria-label={`${p.partCode} question count`}
                    min={1}
                  />
                  <input
                    type="number"
                    value={vals.marksPerQuestion}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        [p.partCode]: {
                          ...vals,
                          marksPerQuestion: e.target.value,
                        },
                      }))
                    }
                    placeholder={`${p.marksPerQuestion}`}
                    className="h-8 px-2 rounded-md bg-muted border border-border/60 text-xs font-mono outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary"
                    aria-label={`${p.partCode} marks per question`}
                    min={1}
                  />
                  <input
                    type="number"
                    value={vals.requiredCount}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        [p.partCode]: { ...vals, requiredCount: e.target.value },
                      }))
                    }
                    placeholder={`${p.requiredCount}`}
                    className="h-8 px-2 rounded-md bg-muted border border-border/60 text-xs font-mono outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary"
                    aria-label={`${p.partCode} required count`}
                    min={0}
                  />
                </div>
                <div className="grid grid-cols-3 gap-1.5 px-0.5">
                  <span className="text-[9px] text-muted-foreground/60 text-center">qs</span>
                  <span className="text-[9px] text-muted-foreground/60 text-center">marks</span>
                  <span className="text-[9px] text-muted-foreground/60 text-center">required</span>
                </div>
              </div>
            );
          })}
          <div className="flex gap-1.5 pt-1">
            <button
              type="button"
              onClick={handleReset}
              disabled={saving}
              className="h-8 px-2.5 rounded-lg border border-border text-[11px] font-medium hover:bg-muted transition-colors disabled:opacity-50 flex items-center gap-1"
            >
              <RotateCcw className="w-3 h-3" />
              Reset
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="flex-1 h-8 rounded-lg bg-primary text-primary-foreground text-[11px] font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              Save overrides
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
