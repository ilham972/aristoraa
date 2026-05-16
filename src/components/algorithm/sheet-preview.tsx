'use client';

// Phase E.4 — Lead override drawer.
//
// Full-screen overlay opened from the Sheets dashboard. Lets the Lead audit
// each Q on a draft/printed sheet and Swap / Remove / Add — all writing
// through D.6's `overrideSheet` mutation and then marking the PDF stale so
// the dashboard row flips back to draft-no-pdf with a [Render] button.
//
// Founder decisions baked in:
//   - Swap picker shows top-10 from scoredCandidatePool first, with a
//     "Search more" tab as fallback (substring search over concept names).
//   - Manual re-render — drawer never auto-renders. Header reminds Lead to
//     press Render in the dashboard after closing.
//   - Completed sheets are locked upstream; drawer should not open for them
//     but defends with a banner if it somehow does.
//
// Implementation notes:
//   - The thumbnail / full-crop dialog use the same backgroundImage trick
//     as difficulty-tab.tsx's CroppedPreview. Duplicated here rather than
//     hoisted to a shared file — they're the only two consumers and the
//     difficulty-tab version is the diagnostic surface (do not refactor).
//   - Student scope (unitIds + gradeByModule) is resolved on the client
//     from curriculum-data, same helpers as sheets/page.tsx. Convex side
//     of the planner is unaware of the curriculum tree.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { toast } from 'sonner';
import {
  X,
  AlertTriangle,
  RefreshCw,
  Trash2,
  ArrowLeftRight,
  Plus,
  Search,
  Info,
  Loader2,
  CheckCircle2,
  ChevronRight,
} from 'lucide-react';
import { api, type Id } from '@/lib/convex';
import { CURRICULUM_MODULES } from '@/lib/curriculum-data';

// ── Types ───────────────────────────────────────────────────────────────

type SlotName = 'warmup' | 'main' | 'examPrep';

type CropBox = { x: number; y: number; w: number; h: number };

type Factors = {
  importance: number;
  urgency: number;
  fit: number;
  novelty: number;
  proximity: number;
  baseScore: number;
  urgencyOverride: boolean;
  urgencyOverrideReason: string | null;
};

type SheetQ = {
  questionId: Id<'questionBank'>;
  cropBox: CropBox | null;
  pageImageUrl: string | null;
  conceptIds: Id<'exercises'>[];
  conceptNames: string[];
  source: string;
  questionNumberInPaper: string | null;
  marksAvailable: number | null;
  difficulty: number | null;
  factors: Factors | null;
};

const MODULE_IDS = ['M1', 'M2', 'M3', 'M4', 'M5', 'M6'] as const;

const SECTION_TITLES: Record<SlotName, string> = {
  warmup: 'Warm-up · cross-module review',
  main: 'Main block · today’s module',
  examPrep: 'Exam prep · past papers',
};

// Scoring weights (mirror planner.ts W_IMPORTANCE etc — kept in sync via
// algorithm_plan.md config). Used only for the breakdown bar labels.
const WEIGHTS = {
  importance: 0.3,
  urgency: 0.25,
  fit: 0.2,
  novelty: 0.15,
  proximity: 0.1,
} as const;

// ── Client-side scope resolution (same as sheets/page.tsx) ───────────────

function resolveGradeByModule(student: {
  schoolGrade: number;
  assignedGrades?: number[];
  assignedGradesByModule?: unknown;
}): Record<string, number[]> {
  const defaults =
    student.assignedGrades && student.assignedGrades.length > 0
      ? student.assignedGrades
      : [student.schoolGrade];
  const byMod = (student.assignedGradesByModule ?? {}) as Record<
    string,
    number[]
  >;
  const out: Record<string, number[]> = {};
  for (const m of MODULE_IDS) {
    const override = byMod[m];
    out[m] = Array.isArray(override) && override.length > 0 ? override : defaults;
  }
  return out;
}

function unitIdsForScope(gradeByModule: Record<string, number[]>): string[] {
  const out: string[] = [];
  for (const mod of CURRICULUM_MODULES) {
    const allowedGrades = new Set(gradeByModule[mod.id] ?? []);
    if (allowedGrades.size === 0) continue;
    for (const g of mod.grades) {
      if (!allowedGrades.has(g.grade)) continue;
      for (const t of g.terms) {
        for (const u of t.units) out.push(u.id);
      }
    }
  }
  return out;
}

// ── Drawer (exported entry point) ────────────────────────────────────────

export function SheetPreviewDrawer({
  sheetId,
  onClose,
}: {
  sheetId: Id<'generatedSheets'>;
  onClose: () => void;
}) {
  const data = useQuery(api.learningEngine.sheets.getSheetWithCrops, { sheetId });
  const overrideSheet = useMutation(api.learningEngine.planner.overrideSheet);
  const markPdfStale = useMutation(api.learningEngine.sheets.markPdfStale);

  // Picker state. Only one picker is open at a time across the whole drawer.
  const [picker, setPicker] = useState<
    | { mode: 'swap'; slot: SlotName; questionIdBefore: Id<'questionBank'> }
    | { mode: 'add'; slot: SlotName }
    | null
  >(null);

  // Pending mutation marker — disables other actions on the same Q.
  const [pendingQ, setPendingQ] = useState<Id<'questionBank'> | null>(null);

  // Lock scroll on the page while open.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const allQIds = useMemo(() => {
    if (!data) return [] as Id<'questionBank'>[];
    return [
      ...data.warmup.map((q) => q.questionId),
      ...data.main.map((q) => q.questionId),
      ...data.examPrep.map((q) => q.questionId),
    ];
  }, [data]);

  const runOverride = useCallback(
    async (params: {
      slot: SlotName;
      action: 'swap' | 'remove' | 'add';
      questionIdBefore?: Id<'questionBank'>;
      questionIdAfter?: Id<'questionBank'>;
      mark: Id<'questionBank'>;
    }) => {
      setPendingQ(params.mark);
      try {
        await overrideSheet({
          sheetId,
          action: params.action,
          slotName: params.slot,
          questionIdBefore: params.questionIdBefore,
          questionIdAfter: params.questionIdAfter,
        });
        try {
          await markPdfStale({ sheetId });
        } catch {
          // markPdfStale is best-effort; the override already succeeded.
        }
        const verb =
          params.action === 'swap'
            ? 'Swapped'
            : params.action === 'remove'
              ? 'Removed'
              : 'Added';
        toast.success(`${verb}. PDF marked stale — press Render in the dashboard.`);
        setPicker(null);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : String(e));
      } finally {
        setPendingQ(null);
      }
    },
    [overrideSheet, markPdfStale, sheetId],
  );

  const isCompleted = data?.sheet.status === 'completed';

  return (
    <div
      className="fixed inset-0 z-40 bg-black/60 flex items-start justify-center overflow-y-auto p-2 sm:p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl rounded-2xl bg-card border border-border shadow-2xl mt-2 sm:mt-6 mb-6"
        onClick={(e) => e.stopPropagation()}
      >
        <DrawerHeader data={data} onClose={onClose} />

        {data === undefined && (
          <div className="p-6 space-y-2 animate-pulse">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-16 bg-muted rounded-xl" />
            ))}
          </div>
        )}
        {data === null && (
          <div className="p-6 text-center text-sm text-muted-foreground">
            Sheet not found or you are not signed in.
          </div>
        )}

        {data && (
          <>
            {isCompleted && (
              <div className="mx-3 mb-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-400 flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5" />
                This sheet is completed and locked. Overrides will be rejected.
              </div>
            )}
            <div className="px-3 pb-4 space-y-4">
              <Section
                title={SECTION_TITLES.warmup}
                slot="warmup"
                qs={data.warmup}
                pendingQ={pendingQ}
                isLocked={isCompleted}
                onWhyToggle={undefined}
                onSwap={(qid) =>
                  setPicker({ mode: 'swap', slot: 'warmup', questionIdBefore: qid })
                }
                onRemove={(qid) =>
                  runOverride({
                    slot: 'warmup',
                    action: 'remove',
                    questionIdBefore: qid,
                    mark: qid,
                  })
                }
                onAdd={() => setPicker({ mode: 'add', slot: 'warmup' })}
              />
              <Section
                title={SECTION_TITLES.main}
                slot="main"
                qs={data.main}
                pendingQ={pendingQ}
                isLocked={isCompleted}
                onWhyToggle={undefined}
                onSwap={(qid) =>
                  setPicker({ mode: 'swap', slot: 'main', questionIdBefore: qid })
                }
                onRemove={(qid) =>
                  runOverride({
                    slot: 'main',
                    action: 'remove',
                    questionIdBefore: qid,
                    mark: qid,
                  })
                }
                onAdd={() => setPicker({ mode: 'add', slot: 'main' })}
              />
              <Section
                title={SECTION_TITLES.examPrep}
                slot="examPrep"
                qs={data.examPrep}
                pendingQ={pendingQ}
                isLocked={isCompleted}
                onWhyToggle={undefined}
                onSwap={(qid) =>
                  setPicker({
                    mode: 'swap',
                    slot: 'examPrep',
                    questionIdBefore: qid,
                  })
                }
                onRemove={(qid) =>
                  runOverride({
                    slot: 'examPrep',
                    action: 'remove',
                    questionIdBefore: qid,
                    mark: qid,
                  })
                }
                onAdd={() => setPicker({ mode: 'add', slot: 'examPrep' })}
              />
            </div>
          </>
        )}
      </div>

      {data && picker && (
        <SwapAddPicker
          mode={picker.mode}
          slot={picker.slot}
          student={data.student}
          dateStr={data.sheet.date}
          excludeQuestionIds={allQIds}
          onPick={(qidAfter) =>
            runOverride({
              slot: picker.slot,
              action: picker.mode === 'swap' ? 'swap' : 'add',
              questionIdBefore:
                picker.mode === 'swap' ? picker.questionIdBefore : undefined,
              questionIdAfter: qidAfter,
              mark: picker.mode === 'swap' ? picker.questionIdBefore : qidAfter,
            })
          }
          onClose={() => setPicker(null)}
          isWorking={!!pendingQ}
        />
      )}
    </div>
  );
}

// ── Header ──────────────────────────────────────────────────────────────

function DrawerHeader({
  data,
  onClose,
}: {
  data:
    | { sheet: { date: string; status: string | undefined }; student: { name: string; schoolGrade: number } }
    | null
    | undefined;
  onClose: () => void;
}) {
  const status = data?.sheet.status ?? 'draft';
  const statusLabel =
    status === 'completed'
      ? 'Done'
      : status === 'printed'
        ? 'Printed'
        : 'Draft';
  return (
    <div className="sticky top-0 z-10 rounded-t-2xl bg-card border-b border-border">
      <div className="px-3 pt-3 pb-2 flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold text-foreground truncate">
            {data?.student.name ?? 'Loading…'}
          </div>
          <div className="text-[10px] text-muted-foreground flex items-center gap-1.5">
            {data && (
              <>
                <span>G{data.student.schoolGrade}</span>
                <span>·</span>
                <span>{data.sheet.date}</span>
                <span>·</span>
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-muted text-foreground text-[10px] font-semibold">
                  {statusLabel}
                </span>
              </>
            )}
          </div>
        </div>
        <button
          onClick={onClose}
          className="shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-md hover:bg-muted text-muted-foreground"
          aria-label="Close"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="mx-3 mb-3 rounded-lg bg-muted/40 px-2.5 py-1.5 text-[10px] text-muted-foreground flex items-center gap-1.5">
        <RefreshCw className="w-3 h-3" />
        PDF will be marked stale on every change — press <strong className="text-foreground">Render</strong> in the dashboard when done.
      </div>
    </div>
  );
}

// ── Section ─────────────────────────────────────────────────────────────

function Section({
  title,
  slot,
  qs,
  pendingQ,
  isLocked,
  onSwap,
  onRemove,
  onAdd,
}: {
  title: string;
  slot: SlotName;
  qs: SheetQ[];
  pendingQ: Id<'questionBank'> | null;
  isLocked: boolean;
  onWhyToggle?: undefined;
  onSwap: (qid: Id<'questionBank'>) => void;
  onRemove: (qid: Id<'questionBank'>) => void;
  onAdd: () => void;
}) {
  return (
    <section className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="px-3 py-2 border-b border-border bg-muted/30 flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">
          {title}
        </span>
        <span className="ml-auto text-[10px] text-muted-foreground tabular-nums">
          {qs.length} Q{qs.length === 1 ? '' : 's'}
        </span>
      </div>
      {qs.length === 0 && (
        <div className="px-3 py-4 text-center text-[11px] text-muted-foreground">
          No questions in this section.
        </div>
      )}
      <div className="divide-y divide-border">
        {qs.map((q, i) => (
          <QRow
            key={q.questionId as unknown as string}
            label={`Q${i + 1}`}
            q={q}
            isBusy={pendingQ === q.questionId}
            isLocked={isLocked}
            onSwap={() => onSwap(q.questionId)}
            onRemove={() => onRemove(q.questionId)}
          />
        ))}
      </div>
      <button
        onClick={onAdd}
        disabled={isLocked}
        className="w-full px-3 py-2 flex items-center justify-center gap-1.5 text-[11px] font-semibold text-primary hover:bg-primary/10 disabled:opacity-40 border-t border-border"
      >
        <Plus className="w-3.5 h-3.5" />
        Add Q to {slot === 'examPrep' ? 'exam prep' : slot}
      </button>
    </section>
  );
}

// ── Q row ───────────────────────────────────────────────────────────────

function QRow({
  label,
  q,
  isBusy,
  isLocked,
  onSwap,
  onRemove,
}: {
  label: string;
  q: SheetQ;
  isBusy: boolean;
  isLocked: boolean;
  onSwap: () => void;
  onRemove: () => void;
}) {
  const [whyOpen, setWhyOpen] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  return (
    <div className="px-3 py-2.5">
      <div className="flex gap-2.5">
        <CropThumbnail
          imageUrl={q.pageImageUrl}
          cropBox={q.cropBox}
          maxSide={84}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 mb-1">
            <span className="text-xs font-bold text-foreground shrink-0">{label}</span>
            {q.factors?.urgencyOverride && (
              <span
                className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded-md bg-red-500/15 text-red-600 dark:text-red-400 text-[9px] font-bold"
                title={q.factors.urgencyOverrideReason ?? ''}
              >
                EXAM BACKSTOP
              </span>
            )}
            {q.source === 'past-paper' && q.questionNumberInPaper && (
              <span className="text-[10px] text-muted-foreground">
                paper {q.questionNumberInPaper}
              </span>
            )}
            {q.marksAvailable !== null && (
              <span className="text-[10px] text-muted-foreground">
                [{q.marksAvailable}m]
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-1 mb-1.5">
            {q.conceptNames.length === 0 ? (
              <span className="text-[10px] text-muted-foreground italic">
                untagged
              </span>
            ) : (
              q.conceptNames.slice(0, 3).map((name, i) => (
                <span
                  key={i}
                  className="text-[9px] px-1.5 py-0.5 rounded-md bg-muted text-foreground"
                >
                  {name}
                </span>
              ))
            )}
            {q.conceptNames.length > 3 && (
              <span className="text-[9px] text-muted-foreground self-center">
                +{q.conceptNames.length - 3}
              </span>
            )}
          </div>
          {q.factors && <FactorMiniBars factors={q.factors} />}
          {!q.factors && (
            <div className="text-[10px] text-muted-foreground italic">
              No score recorded (manual add or pre-D.6 sheet).
            </div>
          )}
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {isBusy ? (
          <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
            <Loader2 className="w-3 h-3 animate-spin" />
            Working…
          </span>
        ) : (
          <>
            <RowBtn
              icon={<Info className="w-3 h-3" />}
              label={whyOpen ? 'Hide' : 'Why?'}
              tone="ghost"
              onClick={() => setWhyOpen((v) => !v)}
            />
            <RowBtn
              icon={<ArrowLeftRight className="w-3 h-3" />}
              label="Swap"
              tone="primary"
              onClick={onSwap}
              disabled={isLocked}
            />
            {confirmRemove ? (
              <>
                <RowBtn
                  icon={<Trash2 className="w-3 h-3" />}
                  label="Confirm remove"
                  tone="danger"
                  onClick={() => {
                    setConfirmRemove(false);
                    onRemove();
                  }}
                  disabled={isLocked}
                />
                <RowBtn
                  icon={null}
                  label="Cancel"
                  tone="ghost"
                  onClick={() => setConfirmRemove(false)}
                />
              </>
            ) : (
              <RowBtn
                icon={<Trash2 className="w-3 h-3" />}
                label="Remove"
                tone="danger"
                onClick={() => setConfirmRemove(true)}
                disabled={isLocked}
              />
            )}
          </>
        )}
      </div>

      {whyOpen && q.factors && (
        <div className="mt-2 rounded-md bg-muted/40 border border-border/60 p-2">
          <FactorBarFull factors={q.factors} />
        </div>
      )}
    </div>
  );
}

function RowBtn({
  icon,
  label,
  tone,
  onClick,
  disabled,
}: {
  icon: React.ReactNode | null;
  label: string;
  tone: 'primary' | 'ghost' | 'danger';
  onClick: () => void;
  disabled?: boolean;
}) {
  const cls = {
    primary: 'bg-primary text-primary-foreground hover:bg-primary/90',
    ghost: 'bg-muted text-muted-foreground hover:text-foreground hover:bg-muted/80',
    danger:
      'bg-red-500/10 border border-red-500/30 text-red-600 dark:text-red-400 hover:bg-red-500/20',
  }[tone];
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-semibold transition-colors disabled:opacity-40 ${cls}`}
    >
      {icon}
      {label}
    </button>
  );
}

// ── Factor bars ─────────────────────────────────────────────────────────

function FactorMiniBars({ factors }: { factors: Factors }) {
  const rows: Array<{ k: string; v: number; w: number; danger?: boolean }> = [
    { k: 'I', v: factors.importance, w: WEIGHTS.importance },
    {
      k: 'U',
      v: factors.urgency,
      w: WEIGHTS.urgency,
      danger: factors.urgencyOverride,
    },
    { k: 'F', v: factors.fit, w: WEIGHTS.fit },
    { k: 'N', v: factors.novelty, w: WEIGHTS.novelty },
    { k: 'P', v: factors.proximity, w: WEIGHTS.proximity },
  ];
  return (
    <div className="flex items-center gap-1.5">
      {rows.map((r) => (
        <div key={r.k} className="flex items-center gap-0.5 min-w-0">
          <span
            className={`text-[9px] font-bold ${r.danger ? 'text-red-500' : 'text-muted-foreground'}`}
          >
            {r.k}
          </span>
          <div className="w-6 h-1 rounded-full bg-card overflow-hidden border border-border">
            <div
              className={`h-full ${r.danger ? 'bg-red-500' : 'bg-primary'}`}
              style={{ width: `${Math.min(1, Math.max(0, r.v)) * 100}%` }}
            />
          </div>
        </div>
      ))}
      <span className="ml-1 text-[9px] text-muted-foreground tabular-nums">
        Σ {factors.baseScore.toFixed(2)}
      </span>
    </div>
  );
}

function FactorBarFull({ factors }: { factors: Factors }) {
  const rows: Array<{ label: string; value: number; weight: number; suffix?: string; reason?: string | null }> = [
    { label: 'Importance', value: factors.importance, weight: WEIGHTS.importance },
    {
      label: 'Urgency',
      value: factors.urgency,
      weight: WEIGHTS.urgency,
      suffix: factors.urgencyOverride ? 'OVERRIDE' : undefined,
      reason: factors.urgencyOverrideReason,
    },
    { label: 'Fit', value: factors.fit, weight: WEIGHTS.fit },
    { label: 'Novelty', value: factors.novelty, weight: WEIGHTS.novelty },
    { label: 'Proximity', value: factors.proximity, weight: WEIGHTS.proximity },
  ];
  return (
    <>
      {rows.map((r) => (
        <div key={r.label} className="flex items-center gap-2 mb-1 last:mb-0">
          <div className="w-20 text-[10px] text-muted-foreground shrink-0 flex items-center gap-1">
            {r.label}
            {r.suffix && (
              <span className="text-[9px] text-red-500 font-semibold">
                {r.suffix}
              </span>
            )}
          </div>
          <div className="flex-1 h-1.5 rounded-full bg-card overflow-hidden border border-border">
            <div
              className={`h-full rounded-full ${r.suffix ? 'bg-red-500' : 'bg-primary'}`}
              style={{ width: `${Math.min(1, Math.max(0, r.value)) * 100}%` }}
            />
          </div>
          <div className="text-[10px] text-muted-foreground tabular-nums shrink-0 w-20 text-right">
            {r.value.toFixed(2)} × {r.weight} = {(r.value * r.weight).toFixed(2)}
          </div>
        </div>
      ))}
      {factors.urgencyOverrideReason && (
        <div className="mt-1 text-[10px] text-red-500">
          {factors.urgencyOverrideReason}
        </div>
      )}
      <div className="mt-1.5 pt-1.5 border-t border-border/60 flex items-center justify-between text-[10px]">
        <span className="text-muted-foreground">Base score</span>
        <span className="font-bold text-foreground tabular-nums">
          {factors.baseScore.toFixed(3)}
        </span>
      </div>
    </>
  );
}

// ── Crop thumbnail + full preview (same approach as difficulty-tab) ──────

function CropThumbnail({
  imageUrl,
  cropBox,
  maxSide,
}: {
  imageUrl: string | null;
  cropBox: CropBox | null;
  maxSide: number;
}) {
  const MIN_SIDE = Math.max(32, Math.round(maxSide * 0.5));
  const [loaded, setLoaded] = useState<{ url: string; w: number; h: number } | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  useEffect(() => {
    if (!imageUrl) return;
    let cancelled = false;
    const img = new window.Image();
    img.onload = () => {
      if (cancelled) return;
      setLoaded({ url: imageUrl, w: img.naturalWidth, h: img.naturalHeight });
    };
    img.src = imageUrl;
    return () => {
      cancelled = true;
    };
  }, [imageUrl]);

  const naturalDims =
    loaded && loaded.url === imageUrl ? { w: loaded.w, h: loaded.h } : null;

  if (!imageUrl || !cropBox) {
    return (
      <div
        className="rounded-md bg-muted border border-border/40 shrink-0 flex items-center justify-center text-[9px] text-muted-foreground"
        style={{ width: maxSide, height: maxSide }}
      >
        no img
      </div>
    );
  }

  const safeW = Math.max(cropBox.w, 0.001);
  const safeH = Math.max(cropBox.h, 0.001);
  const fallbackImgAspect = 0.71;
  const imgAspect = naturalDims ? naturalDims.w / naturalDims.h : fallbackImgAspect;
  const cropAspect = (imgAspect * safeW) / safeH;
  let boxW: number;
  let boxH: number;
  if (cropAspect >= 1) {
    boxW = maxSide;
    boxH = Math.max(MIN_SIDE, maxSide / cropAspect);
  } else {
    boxH = maxSide;
    boxW = Math.max(MIN_SIDE, maxSide * cropAspect);
  }
  const imgW = boxW / safeW;
  const imgH = boxH / safeH;
  const bgX = -cropBox.x * imgW;
  const bgY = -cropBox.y * imgH;

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setPreviewOpen(true);
        }}
        className="shrink-0 flex items-center justify-center cursor-zoom-in"
        style={{ width: maxSide, height: maxSide }}
        aria-label="Show full saved crop"
      >
        <div
          className="rounded-md bg-muted border border-border/40 overflow-hidden hover:ring-2 hover:ring-primary/40 transition-shadow"
          style={{
            width: boxW,
            height: boxH,
            backgroundImage: `url(${imageUrl})`,
            backgroundRepeat: 'no-repeat',
            backgroundSize: `${imgW}px ${imgH}px`,
            backgroundPosition: `${bgX}px ${bgY}px`,
          }}
        />
      </button>
      {previewOpen && (
        <FullCropDialog
          imageUrl={imageUrl}
          cropBox={cropBox}
          naturalDims={naturalDims}
          onClose={() => setPreviewOpen(false)}
        />
      )}
    </>
  );
}

function FullCropDialog({
  imageUrl,
  cropBox,
  naturalDims,
  onClose,
}: {
  imageUrl: string;
  cropBox: CropBox;
  naturalDims: { w: number; h: number } | null;
  onClose: () => void;
}) {
  const safeW = Math.max(cropBox.w, 0.001);
  const safeH = Math.max(cropBox.h, 0.001);
  const cropPxW = naturalDims ? Math.round(naturalDims.w * safeW) : null;
  const cropPxH = naturalDims ? Math.round(naturalDims.h * safeH) : null;
  const cropAspect = naturalDims
    ? (naturalDims.w * safeW) / (naturalDims.h * safeH)
    : safeW / safeH;
  const MAX_VW = 70;
  const MAX_VH = 60;
  let dispW: string;
  let dispH: string;
  if (cropAspect >= MAX_VW / MAX_VH) {
    dispW = `${MAX_VW}vw`;
    dispH = `${MAX_VW / cropAspect}vw`;
  } else {
    dispH = `${MAX_VH}vh`;
    dispW = `${MAX_VH * cropAspect}vh`;
  }
  const imgWcss = `calc(${dispW} / ${safeW})`;
  const imgHcss = `calc(${dispH} / ${safeH})`;
  const bgXcss = `calc(-${cropBox.x} * ${imgWcss})`;
  const bgYcss = `calc(-${cropBox.y} * ${imgHcss})`;
  return (
    <div
      className="fixed inset-0 z-[60] bg-black/70 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="rounded-2xl bg-card border border-border p-3 shadow-xl max-w-[90vw] max-h-[90vh] overflow-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-2">
          <div className="text-xs font-bold text-foreground">Saved crop preview</div>
          <button
            onClick={onClose}
            className="text-[11px] px-2 py-1 rounded-md hover:bg-muted text-muted-foreground"
          >
            Close
          </button>
        </div>
        <div
          className="rounded-md bg-muted border border-border overflow-hidden mx-auto"
          style={{
            width: dispW,
            height: dispH,
            backgroundImage: `url(${imageUrl})`,
            backgroundRepeat: 'no-repeat',
            backgroundSize: `${imgWcss} ${imgHcss}`,
            backgroundPosition: `${bgXcss} ${bgYcss}`,
          }}
        />
        {naturalDims && cropPxW !== null && cropPxH !== null && (
          <div className="mt-2 text-[10px] text-muted-foreground font-mono">
            source: {naturalDims.w}×{naturalDims.h} px · crop:{' '}
            {cropPxW}×{cropPxH} px
          </div>
        )}
      </div>
    </div>
  );
}

// ── Swap / Add picker ───────────────────────────────────────────────────

type PickerStudent = {
  _id: Id<'students'>;
  schoolGrade: number;
  assignedGrades: number[] | undefined;
  assignedGradesByModule: unknown;
};

function SwapAddPicker({
  mode,
  slot,
  student,
  dateStr,
  excludeQuestionIds,
  onPick,
  onClose,
  isWorking,
}: {
  mode: 'swap' | 'add';
  slot: SlotName;
  student: PickerStudent;
  dateStr: string;
  excludeQuestionIds: Id<'questionBank'>[];
  onPick: (qid: Id<'questionBank'>) => void;
  onClose: () => void;
  isWorking: boolean;
}) {
  const [tab, setTab] = useState<'top10' | 'search'>('top10');
  const [searchTerm, setSearchTerm] = useState('');
  const [confirmId, setConfirmId] = useState<Id<'questionBank'> | null>(null);

  const scope = useMemo(() => {
    const gbm = resolveGradeByModule(student);
    return { gradeByModule: gbm, unitIds: unitIdsForScope(gbm) };
  }, [student]);

  const scored = useQuery(api.learningEngine.planner.scoredCandidatePool, {
    studentId: student._id,
    dateStr,
    unitIds: scope.unitIds,
    gradeByModule: scope.gradeByModule,
    limit: 50,
  });

  const top10 = useMemo(() => {
    if (!scored) return [];
    const excludeSet = new Set(
      excludeQuestionIds.map((id) => id as unknown as string),
    );
    const filtered = scored.candidates.filter(
      (c) => !excludeSet.has(c.question._id as unknown as string),
    );
    return filtered.slice(0, 10);
  }, [scored, excludeQuestionIds]);

  const searched = useQuery(
    api.learningEngine.sheets.searchQuestionsForSwap,
    tab === 'search' && searchTerm.trim().length >= 2
      ? {
          term: searchTerm.trim(),
          excludeQuestionIds,
          limit: 25,
        }
      : 'skip',
  );

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 flex items-start justify-center overflow-y-auto p-2 sm:p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl rounded-2xl bg-card border border-border shadow-2xl mt-2 sm:mt-6 mb-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 rounded-t-2xl bg-card border-b border-border px-3 pt-3 pb-2 flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-bold text-foreground">
              {mode === 'swap' ? 'Swap question' : 'Add question'}
            </div>
            <div className="text-[10px] text-muted-foreground">
              {slot === 'examPrep' ? 'exam prep' : slot} · pick a replacement
            </div>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-md hover:bg-muted text-muted-foreground"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-3 pt-2 flex gap-1.5">
          <PickerTab active={tab === 'top10'} onClick={() => setTab('top10')}>
            Top 10
          </PickerTab>
          <PickerTab active={tab === 'search'} onClick={() => setTab('search')}>
            Search more
          </PickerTab>
        </div>

        {tab === 'top10' && (
          <div className="p-3 space-y-2">
            {scored === undefined && (
              <div className="space-y-2 animate-pulse">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-16 bg-muted rounded-xl" />
                ))}
              </div>
            )}
            {scored === null && (
              <div className="text-center text-[11px] text-muted-foreground">
                Not signed in.
              </div>
            )}
            {scored && top10.length === 0 && (
              <div className="text-center text-[11px] text-muted-foreground">
                No more candidates available for this student/date.
              </div>
            )}
            {scored &&
              top10.map((c) => (
                <CandidateRow
                  key={c.question._id as unknown as string}
                  imageUrl={null /* top10 doesn't ship URLs — show meta-only */}
                  cropBox={null}
                  source={c.question.source}
                  questionNumberInPaper={c.question.questionNumberInPaper ?? null}
                  difficulty={c.question.difficulty ?? null}
                  conceptNames={[c.concept.name ?? '—']}
                  factors={{
                    importance: c.factors.importance,
                    urgency: c.factors.urgency,
                    fit: c.factors.fit,
                    novelty: c.factors.novelty,
                    proximity: c.factors.proximity,
                    baseScore: c.factors.baseScore,
                    urgencyOverride: c.factors.urgencyOverride !== null,
                    urgencyOverrideReason: c.factors.urgencyOverrideReason ?? null,
                  }}
                  isConfirming={confirmId === c.question._id}
                  isWorking={isWorking}
                  onAsk={() => setConfirmId(c.question._id as Id<'questionBank'>)}
                  onConfirm={() => onPick(c.question._id as Id<'questionBank'>)}
                  onCancel={() => setConfirmId(null)}
                />
              ))}
          </div>
        )}

        {tab === 'search' && (
          <div className="p-3 space-y-2">
            <label className="flex items-center gap-2 rounded-md bg-muted border border-border px-2 py-1.5">
              <Search className="w-3.5 h-3.5 text-muted-foreground" />
              <input
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Concept name…"
                className="flex-1 bg-transparent text-sm text-foreground outline-none"
                autoFocus
              />
            </label>
            {searchTerm.trim().length < 2 && (
              <div className="text-center text-[11px] text-muted-foreground py-4">
                Type at least 2 letters of a concept name.
              </div>
            )}
            {searchTerm.trim().length >= 2 && searched === undefined && (
              <div className="space-y-2 animate-pulse">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-16 bg-muted rounded-xl" />
                ))}
              </div>
            )}
            {searched && searched.length === 0 && (
              <div className="text-center text-[11px] text-muted-foreground py-4">
                No matches for “{searchTerm}”.
              </div>
            )}
            {searched &&
              searched.map((q) => (
                <CandidateRow
                  key={q.questionId as unknown as string}
                  imageUrl={q.pageImageUrl}
                  cropBox={q.cropBox}
                  source={q.source}
                  questionNumberInPaper={q.questionNumberInPaper}
                  difficulty={q.difficulty}
                  conceptNames={q.conceptNames}
                  factors={null}
                  isConfirming={confirmId === q.questionId}
                  isWorking={isWorking}
                  onAsk={() => setConfirmId(q.questionId)}
                  onConfirm={() => onPick(q.questionId)}
                  onCancel={() => setConfirmId(null)}
                />
              ))}
          </div>
        )}
      </div>
    </div>
  );
}

function PickerTab({
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
      onClick={onClick}
      className={`px-3 py-1.5 rounded-t-md text-[11px] font-semibold transition-colors ${
        active
          ? 'bg-primary text-primary-foreground'
          : 'bg-muted text-muted-foreground hover:text-foreground'
      }`}
    >
      {children}
    </button>
  );
}

function CandidateRow({
  imageUrl,
  cropBox,
  source,
  questionNumberInPaper,
  difficulty,
  conceptNames,
  factors,
  isConfirming,
  isWorking,
  onAsk,
  onConfirm,
  onCancel,
}: {
  imageUrl: string | null;
  cropBox: CropBox | null;
  source: string;
  questionNumberInPaper: string | null;
  difficulty: number | null;
  conceptNames: string[];
  factors: Factors | null;
  isConfirming: boolean;
  isWorking: boolean;
  onAsk: () => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-2.5 flex gap-2.5">
      <CropThumbnail imageUrl={imageUrl} cropBox={cropBox} maxSide={72} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 mb-1">
          <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-muted text-foreground font-semibold">
            {source === 'past-paper' ? 'paper' : 'book'}
          </span>
          {questionNumberInPaper && (
            <span className="text-[10px] text-muted-foreground">
              {questionNumberInPaper}
            </span>
          )}
          {difficulty !== null && (
            <span className="text-[10px] text-muted-foreground">
              d={difficulty}
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-1 mb-1.5">
          {conceptNames.length === 0 ? (
            <span className="text-[10px] text-muted-foreground italic">
              untagged
            </span>
          ) : (
            conceptNames.slice(0, 3).map((name, i) => (
              <span
                key={i}
                className="text-[9px] px-1.5 py-0.5 rounded-md bg-muted text-foreground"
              >
                {name}
              </span>
            ))
          )}
        </div>
        {factors && <FactorMiniBars factors={factors} />}
      </div>
      <div className="shrink-0 flex flex-col gap-1.5">
        {isConfirming ? (
          <>
            <button
              onClick={onConfirm}
              disabled={isWorking}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-primary text-primary-foreground text-[10px] font-semibold hover:bg-primary/90 disabled:opacity-40"
            >
              {isWorking ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <CheckCircle2 className="w-3 h-3" />
              )}
              Confirm
            </button>
            <button
              onClick={onCancel}
              disabled={isWorking}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-muted text-muted-foreground text-[10px] font-semibold hover:bg-muted/80 disabled:opacity-40"
            >
              Cancel
            </button>
          </>
        ) : (
          <button
            onClick={onAsk}
            disabled={isWorking}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-primary text-primary-foreground text-[10px] font-semibold hover:bg-primary/90 disabled:opacity-40"
          >
            Pick
            <ChevronRight className="w-3 h-3" />
          </button>
        )}
      </div>
    </div>
  );
}
