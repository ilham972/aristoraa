'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation } from 'convex/react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  AlertTriangle,
  Book,
  FileText,
  Minus,
  Plus,
  RotateCw,
  ImageOff,
  CheckCircle2,
} from 'lucide-react';
import { toast } from 'sonner';
import { findUnit } from '@/lib/curriculum-data';
import { MODULE_COLORS } from '@/lib/types';
import { api } from '@/lib/convex';
import type { Id } from '@/lib/convex';
import type { CoverageRow } from './unit-coverage-card';

interface Props {
  row: CoverageRow | null;
  threshold: number;
  onClose: () => void;
}

const DIFFICULTY_META: Record<
  string,
  { label: string; cls: string }
> = {
  '1': { label: 'D1', cls: 'bg-emerald-500/15 text-emerald-600 border-emerald-500/30' },
  '2': { label: 'D2', cls: 'bg-emerald-500/15 text-emerald-600 border-emerald-500/30' },
  '3': { label: 'D3', cls: 'bg-amber-500/15 text-amber-600 border-amber-500/30' },
  '4': { label: 'D4', cls: 'bg-orange-500/15 text-orange-600 border-orange-500/30' },
  '5': { label: 'D5', cls: 'bg-red-500/15 text-red-600 border-red-500/30' },
  unset: { label: 'D?', cls: 'bg-zinc-500/15 text-zinc-500 border-zinc-500/30' },
};

// Cropped-image thumbnail. Renders only the cropBox region of the source page
// image using the normalized-crop background technique, with the container's
// aspect ratio corrected from the image's natural pixel dimensions once it
// loads (so the crop is never distorted).
function CropThumb({
  url,
  cropBox,
}: {
  url: string | null;
  cropBox: { x: number; y: number; w: number; h: number } | null;
}) {
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null);

  if (!url || !cropBox) {
    return (
      <div className="w-full aspect-[3/1] rounded-lg bg-muted flex items-center justify-center text-muted-foreground">
        <ImageOff className="w-5 h-5" />
      </div>
    );
  }

  const w = Math.max(0.001, Math.min(1, cropBox.w));
  const h = Math.max(0.001, Math.min(1, cropBox.h));
  const x = Math.max(0, Math.min(1, cropBox.x));
  const y = Math.max(0, Math.min(1, cropBox.y));
  const aspect = nat ? (w * nat.w) / (h * nat.h) : w / h;
  const posX = w >= 1 ? 0 : (x / (1 - w)) * 100;
  const posY = h >= 1 ? 0 : (y / (1 - h)) * 100;

  return (
    <div
      className="w-full rounded-lg bg-white overflow-hidden ring-1 ring-border"
      style={{ aspectRatio: String(aspect || 3) }}
    >
      <div
        className="w-full h-full"
        style={{
          backgroundImage: `url("${url}")`,
          backgroundRepeat: 'no-repeat',
          backgroundSize: `${100 / w}% ${100 / h}%`,
          backgroundPosition: `${posX}% ${posY}%`,
        }}
      />
      {/* Hidden probe to read natural dimensions for the aspect ratio. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt=""
        className="hidden"
        onLoad={(e) =>
          setNat({
            w: e.currentTarget.naturalWidth,
            h: e.currentTarget.naturalHeight,
          })
        }
      />
    </div>
  );
}

function RepeatStepper({
  questionId,
  value,
}: {
  questionId: Id<'questionBank'>;
  value: number;
}) {
  const setRepeat = useMutation(api.questionBank.setRepeatCount);
  const [pending, setPending] = useState(false);

  const change = async (next: number) => {
    if (next < 1 || next > 20 || pending) return;
    setPending(true);
    try {
      await setRepeat({ id: questionId, repeatCount: next });
    } catch (err) {
      console.error('[setRepeatCount]', err);
      toast.error('Could not update repeat count');
    } finally {
      setPending(false);
    }
  };

  const active = value > 1;

  return (
    <div
      className={`flex items-center rounded-lg border ${
        active ? 'border-sky-500/40 bg-sky-500/10' : 'border-border bg-muted/40'
      }`}
    >
      <button
        type="button"
        onClick={() => change(value - 1)}
        disabled={value <= 1 || pending}
        className="h-9 w-9 flex items-center justify-center rounded-l-lg text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-30 disabled:hover:bg-transparent transition-colors active:scale-95"
        aria-label="Decrease repeats"
      >
        <Minus className="w-4 h-4" />
      </button>
      <div className="w-12 text-center select-none">
        <span
          className={`text-sm font-bold tabular-nums ${
            active ? 'text-sky-600' : 'text-foreground'
          }`}
        >
          {value}×
        </span>
      </div>
      <button
        type="button"
        onClick={() => change(value + 1)}
        disabled={value >= 20 || pending}
        className="h-9 w-9 flex items-center justify-center rounded-r-lg text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-30 disabled:hover:bg-transparent transition-colors active:scale-95"
        aria-label="Increase repeats"
      >
        <Plus className="w-4 h-4" />
      </button>
    </div>
  );
}

export function ConceptDetailPanel({ row, threshold, onClose }: Props) {
  const router = useRouter();

  const parentExId = useQuery(
    api.learningEngine.derivedConcepts.getUnitMapping,
    row ? { unitId: row.unitId } : 'skip',
  );
  const relevantPapers = useQuery(
    api.learningEngine.coverage.papersRelevantToConcept,
    row ? { conceptExerciseId: row.conceptId } : 'skip',
  );
  const detail = useQuery(
    api.learningEngine.coverage.conceptQuestionsForReview,
    row ? { conceptExerciseId: row.conceptId } : 'skip',
  );

  if (!row) {
    return (
      <Dialog open={false} onOpenChange={(o) => !o && onClose()}>
        <DialogContent />
      </Dialog>
    );
  }

  const meta = findUnit(row.unitId);
  const moduleId = row.unitId.split('-')[0];
  const moduleColor = MODULE_COLORS[moduleId] ?? '#0D9488';

  // Prefer live numbers from the per-question query (reflect repeat edits
  // instantly); fall back to the coverage row before it loads.
  const total = detail?.total ?? row.total;
  const effectiveTotal = detail?.effectiveTotal ?? row.effectiveTotal;
  const repeatBonus = effectiveTotal - total;
  const cleared = effectiveTotal >= threshold;
  const needsMore = Math.max(0, threshold - effectiveTotal);
  const progressPct = Math.min(100, (effectiveTotal / threshold) * 100);

  const parentExerciseId =
    parentExId?.exerciseToConcepts.find((e) =>
      e.conceptIds.some((cid) => cid === row.conceptId),
    )?.exerciseId ?? null;

  function goTextbook() {
    if (parentExerciseId) {
      router.push(`/settings/crop/${row!.unitId}?exerciseId=${parentExerciseId}`);
    } else {
      router.push(`/settings/crop/${row!.unitId}`);
    }
  }

  function goPastPaper() {
    const papers = relevantPapers ?? [];
    if (papers.length === 0) {
      toast.info(
        'No past papers configured for this unit yet. Open Settings → Tags / Exam to link topics to slots first.',
      );
      router.push('/settings');
      return;
    }
    const first = papers[0];
    if (papers.length > 1) {
      toast.success(
        `${papers.length} relevant papers — opening most recent (G${first.grade} T${first.term} ${first.year}).`,
      );
    }
    router.push(`/settings/past-paper-crop/${first._id}`);
  }

  return (
    <Dialog open={true} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        showCloseButton
        className="inset-0 top-0 left-0 h-full max-h-full w-full max-w-full translate-x-0 translate-y-0 rounded-none border-0 p-0 gap-0 grid-rows-[auto_1fr_auto] sm:max-w-full"
      >
        {/* ── Header ── */}
        <DialogHeader className="px-4 pt-4 pb-3 border-b border-border bg-card/60 backdrop-blur">
          <div className="flex items-start gap-3 pr-10">
            <div
              className="w-1.5 self-stretch rounded-full shrink-0"
              style={{ backgroundColor: moduleColor }}
            />
            <div className="flex-1 min-w-0">
              <DialogTitle className="text-base font-semibold text-foreground leading-tight">
                {row.conceptName}
              </DialogTitle>
              <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                {meta
                  ? `${meta.module.id} · G${meta.grade} T${meta.term} · ${meta.unit.name}`
                  : row.unitId}
              </p>
            </div>
          </div>

          {/* Coverage progress */}
          <div className="mt-3 rounded-xl border border-border bg-background p-3">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                {cleared ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                ) : (
                  <AlertTriangle className="w-4 h-4 text-red-500" />
                )}
                <span
                  className={`text-sm font-semibold ${
                    cleared ? 'text-emerald-600' : 'text-red-600'
                  }`}
                >
                  {effectiveTotal} / {threshold}
                </span>
                <span className="text-[11px] text-muted-foreground">
                  effective
                </span>
              </div>
              {cleared ? (
                <Badge className="bg-emerald-500/15 text-emerald-600 border border-emerald-500/30 text-[10px]">
                  Gate cleared
                </Badge>
              ) : (
                <Badge variant="destructive" className="text-[10px]">
                  Needs {needsMore} more
                </Badge>
              )}
            </div>
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${
                  cleared ? 'bg-emerald-500' : 'bg-red-500'
                }`}
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <div className="flex items-center gap-3 mt-2 text-[11px] text-muted-foreground">
              <span>{total} real</span>
              {repeatBonus > 0 && (
                <span className="flex items-center gap-1 text-sky-600 font-medium">
                  <RotateCw className="w-3 h-3" />+{repeatBonus} repeat
                </span>
              )}
              {row.hasNoHardQuestions && (
                <span className="flex items-center gap-1 text-amber-600">
                  <AlertTriangle className="w-3 h-3" />
                  no D4–5
                </span>
              )}
            </div>
          </div>
        </DialogHeader>

        {/* ── Scrollable questions list ── */}
        <div className="overflow-y-auto px-4 py-3 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Questions
            </p>
            <p className="text-[10px] text-muted-foreground">
              Repeat is a temporary stand-in until real questions are added
            </p>
          </div>

          {detail === undefined && (
            <div className="space-y-3 animate-pulse">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-28 rounded-xl bg-muted" />
              ))}
            </div>
          )}

          {detail && detail.questions.length === 0 && (
            <div className="rounded-xl border border-dashed border-border p-6 text-center">
              <p className="text-sm text-muted-foreground">
                No questions cropped for this concept yet.
              </p>
              <p className="text-[11px] text-muted-foreground mt-1">
                Crop some from the textbook or a past paper below — repeats need
                at least one real question to stand on.
              </p>
            </div>
          )}

          {detail?.questions.map((q, i) => {
            const dKey = q.difficulty == null ? 'unset' : String(q.difficulty);
            const dMeta = DIFFICULTY_META[dKey] ?? DIFFICULTY_META.unset;
            return (
              <div
                key={q._id}
                className="rounded-xl border border-border bg-card overflow-hidden"
              >
                <div className="p-3 space-y-3">
                  <CropThumb url={q.pageImageUrl} cropBox={q.cropBox} />
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="text-[11px] font-mono font-bold text-muted-foreground shrink-0">
                        {q.linkedQuestionKey ??
                          q.questionNumberInPaper ??
                          `#${i + 1}`}
                      </span>
                      <Badge
                        variant="outline"
                        className={`text-[10px] border ${dMeta.cls}`}
                      >
                        {dMeta.label}
                      </Badge>
                      <span className="text-[10px] text-muted-foreground truncate">
                        {q.source === 'past-paper'
                          ? 'past paper'
                          : q.source === 'teacher-authored'
                            ? 'authored'
                            : 'textbook'}
                      </span>
                    </div>
                    <RepeatStepper questionId={q._id} value={q.repeatCount} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* ── Footer actions ── */}
        <div className="border-t border-border bg-card/60 backdrop-blur px-4 py-3 grid grid-cols-2 gap-2">
          <Button variant="default" size="sm" onClick={goTextbook}>
            <Book className="w-4 h-4 mr-2" />
            Textbook
          </Button>
          <Button variant="secondary" size="sm" onClick={goPastPaper}>
            <FileText className="w-4 h-4 mr-2" />
            Past papers
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
