'use client';

// GroupSheets — the Planner's "Sheets" tab (2026-07-15): every sheet of the
// term for one group, prebuilt end to end. Pick grade → group, then:
//   Run all term sheets — crystallize EVERY session to the horizon in one
//   tap (counts are stable under difficulty re-ordering; planned rows stay
//   re-pickable until printed).
//   Re-plan future — after a Lesson-Builder reorder: drop every future
//   still-planned row and rebuild it from the fresh book order.
//   The list — the whole term chronologically (past dimmed, today marked);
//   tap a sheet to preview its real question crops one by one, with ‹ ›
//   to walk sheet-by-sheet through the term.

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { ChevronLeft, ChevronRight, RefreshCw, Sparkles, X } from 'lucide-react';
import { toast } from 'sonner';
import { api, type Id } from '@/lib/convex';
import { cn } from '@/lib/utils';
import { useCachedQuery } from '@/hooks/use-cached-query';
import { CropThumbnail } from '@/components/algorithm/sheet-preview';
import { useUnitName, type PlannerGroupRow } from './group-plan-card';
import { fmtWeekdayDate } from './verdict';

const STATUS_CHIP: Record<string, { label: string; className: string }> = {
  planned: {
    label: 'planned',
    className: 'bg-primary/15 text-primary border-primary/40',
  },
  materialized: {
    label: 'taught',
    className: 'bg-emerald-500/15 text-emerald-500 border-emerald-500/40',
  },
  delegated: {
    label: 'delegated',
    className: 'bg-amber-500/15 text-amber-500 border-amber-500/40',
  },
};

function todayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function GroupSheets({ grade }: { grade: number }) {
  const groups = useCachedQuery(api.learningEngine.plannerBoard.plannerGroups, {});
  const gradeGroups = useMemo(
    () =>
      (groups ?? [])
        .filter((g: PlannerGroupRow) => g.grade === grade)
        .sort((a: PlannerGroupRow, b: PlannerGroupRow) => a.name.localeCompare(b.name)),
    [groups, grade],
  );

  const [groupId, setGroupId] = useState<Id<'groups'> | null>(null);
  useEffect(() => {
    if (gradeGroups.length === 0) {
      setGroupId(null);
      return;
    }
    if (!groupId || !gradeGroups.some((g: PlannerGroupRow) => g.groupId === groupId)) {
      const preferred =
        gradeGroups.find((g: PlannerGroupRow) => g.trackName !== null) ?? gradeGroups[0];
      setGroupId(preferred.groupId);
    }
  }, [gradeGroups, groupId]);

  const sheets = useCachedQuery(
    api.learningEngine.groupPlan.groupSheetHistory,
    groupId ? { groupId } : 'skip',
  );
  const crystallize = useMutation(api.learningEngine.groupPlan.crystallizeUpcoming);
  const deleteFuturePlanned = useMutation(
    api.learningEngine.groupPlan.deleteFuturePlanned,
  );
  const unitName = useUnitName();
  const [busy, setBusy] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<Id<'groupSheets'> | null>(null);

  const today = todayYmd();
  const list = sheets ?? [];
  const previewIdx = previewId ? list.findIndex((s) => s.id === previewId) : -1;

  const runAll = async () => {
    if (!groupId) return;
    setBusy('run');
    try {
      const res = await crystallize({ groupId, daysAhead: 180 });
      if (res.status !== 'ok') toast.error(`Cannot plan: ${res.status}`);
      else if (res.written === 0)
        toast.info('Every session is already planned — the term is fully built.');
      else toast.success(`Built ${res.written} sheets — the whole term is planned.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(null);
    }
  };

  const replan = async () => {
    if (!groupId) return;
    if (
      !window.confirm(
        'Re-plan the term? Every future sheet that is not yet taught will be re-picked from the current book order. Taught and delegated sheets are untouched.',
      )
    )
      return;
    setBusy('replan');
    try {
      const del = await deleteFuturePlanned({ groupId });
      const res = await crystallize({ groupId, daysAhead: 180 });
      toast.success(
        `Re-planned: ${del.deleted} sheets dropped, ${res.status === 'ok' ? res.written : 0} rebuilt from the current order.`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(null);
    }
  };

  if (groups !== undefined && gradeGroups.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card p-4 text-center text-sm text-muted-foreground">
        No grade-{grade} groups on the timetable yet.
      </div>
    );
  }

  return (
    <>
      {/* Group chips */}
      <div className="flex gap-1.5 overflow-x-auto pb-1 mb-2">
        {gradeGroups.map((g: PlannerGroupRow) => (
          <button
            key={g.groupId as unknown as string}
            onClick={() => setGroupId(g.groupId)}
            className={cn(
              'shrink-0 px-2.5 py-1.5 rounded-lg border text-[11px] font-semibold',
              g.groupId === groupId
                ? 'border-primary/60 bg-primary/10 text-foreground'
                : 'border-border bg-card text-muted-foreground',
            )}
          >
            {g.name}
          </button>
        ))}
      </div>

      {/* Term-build actions */}
      <div className="flex gap-2 mb-3">
        <button
          onClick={runAll}
          disabled={busy !== null || !groupId}
          className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-semibold disabled:opacity-50"
        >
          <Sparkles className="w-3.5 h-3.5" />
          {busy === 'run' ? 'Building…' : 'Run all term sheets'}
        </button>
        <button
          onClick={replan}
          disabled={busy !== null || !groupId}
          className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-border text-foreground text-xs font-semibold disabled:opacity-50"
          title="After reordering difficulty in the Lesson Builder: re-pick every future planned sheet from the new order"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          {busy === 'replan' ? 'Re-planning…' : 'Re-plan'}
        </button>
      </div>

      {sheets === undefined && groupId && (
        <div className="space-y-2 animate-pulse">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-12 bg-muted rounded-xl" />
          ))}
        </div>
      )}

      {sheets !== undefined && list.length === 0 && (
        <div className="rounded-xl border border-border bg-card p-4 text-center text-sm text-muted-foreground">
          No sheets yet — press &ldquo;Run all term sheets&rdquo; to build the
          whole term.
        </div>
      )}

      {/* The term, sheet by sheet */}
      <div className="space-y-1.5">
        {list.map((s, i) => {
          const chip = STATUS_CHIP[s.status] ?? STATUS_CHIP.planned;
          const isPast = s.date < today;
          const firstUpcoming = !isPast && (i === 0 || list[i - 1].date < today);
          return (
            <div key={s.id as unknown as string}>
              {firstUpcoming && i > 0 && (
                <div className="flex items-center gap-2 my-2">
                  <div className="h-px flex-1 bg-primary/40" />
                  <span className="text-[9px] font-bold text-primary uppercase">today</span>
                  <div className="h-px flex-1 bg-primary/40" />
                </div>
              )}
              <button
                onClick={() => setPreviewId(s.id)}
                className={cn(
                  'w-full rounded-xl border border-border bg-card px-3 py-2 flex items-center justify-between gap-2 text-left hover:bg-muted/40',
                  isPast && 'opacity-55',
                )}
              >
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-foreground">
                    {fmtWeekdayDate(s.date)}
                  </div>
                  <div className="text-[10px] text-muted-foreground truncate">
                    {unitName(s.unitId)} · {s.newCount} new
                    {s.spiralCount > 0 && <> + {s.spiralCount} spiral</>}
                  </div>
                </div>
                <span
                  className={cn(
                    'shrink-0 px-1.5 py-0.5 rounded-md border text-[9px] font-semibold',
                    chip.className,
                  )}
                >
                  {chip.label}
                </span>
              </button>
            </div>
          );
        })}
      </div>

      {previewIdx >= 0 && (
        <SheetPreviewDrawer
          sheetId={list[previewIdx].id}
          unitName={unitName}
          hasPrev={previewIdx > 0}
          hasNext={previewIdx < list.length - 1}
          onPrev={() => setPreviewId(list[previewIdx - 1].id)}
          onNext={() => setPreviewId(list[previewIdx + 1].id)}
          onClose={() => setPreviewId(null)}
        />
      )}
    </>
  );
}

function SheetPreviewDrawer({
  sheetId,
  unitName,
  hasPrev,
  hasNext,
  onPrev,
  onNext,
  onClose,
}: {
  sheetId: Id<'groupSheets'>;
  unitName: (unitId: string) => string;
  hasPrev: boolean;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
}) {
  const sheet = useQuery(api.learningEngine.groupPlan.groupSheetPreview, {
    groupSheetId: sheetId,
  });
  const chip = sheet ? (STATUS_CHIP[sheet.status] ?? STATUS_CHIP.planned) : null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-2 pb-[calc(4rem+env(safe-area-inset-bottom,0px)+0.5rem)] sm:pb-2"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-card border border-border shadow-xl max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header with sheet-by-sheet navigation */}
        <div className="flex items-center gap-1 px-3 py-2.5 border-b border-border">
          <button
            onClick={onPrev}
            disabled={!hasPrev}
            className="p-1.5 rounded-md hover:bg-muted text-muted-foreground disabled:opacity-30"
            aria-label="Previous sheet"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <div className="flex-1 min-w-0 text-center">
            {sheet ? (
              <>
                <div className="text-sm font-bold text-foreground">
                  {fmtWeekdayDate(sheet.date)}
                </div>
                <div className="text-[10px] text-muted-foreground truncate">
                  {unitName(sheet.unitId)}
                  {chip && (
                    <span
                      className={cn(
                        'ml-1.5 px-1.5 py-px rounded border text-[9px] font-semibold',
                        chip.className,
                      )}
                    >
                      {chip.label}
                    </span>
                  )}
                </div>
              </>
            ) : (
              <div className="h-8 w-32 mx-auto bg-muted rounded animate-pulse" />
            )}
          </div>
          <button
            onClick={onNext}
            disabled={!hasNext}
            className="p-1.5 rounded-md hover:bg-muted text-muted-foreground disabled:opacity-30"
            aria-label="Next sheet"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md hover:bg-muted text-muted-foreground"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Questions */}
        <div className="overflow-y-auto px-3 py-2">
          {sheet === undefined && (
            <div className="space-y-2 animate-pulse py-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-16 bg-muted rounded-xl" />
              ))}
            </div>
          )}
          {sheet &&
            sheet.questions.map((q, i) => (
              <div
                key={q.questionId as unknown as string}
                className="flex items-center gap-2.5 py-1.5 border-b border-border/50 last:border-0"
              >
                <span className="w-5 text-[11px] font-bold text-muted-foreground tabular-nums shrink-0">
                  {i + 1}
                </span>
                {q.overrideImageUrl ? (
                  // Typed override wins — render the stored PNG directly.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={q.overrideImageUrl}
                    alt={`Question ${i + 1}`}
                    className="max-h-20 rounded-md border border-border/40"
                  />
                ) : (
                  <CropThumbnail
                    imageUrl={q.pageImageUrl}
                    imageUrlSmall={q.pageImageUrlSmall}
                    cropBox={q.cropBox}
                    maxSide={72}
                  />
                )}
                <div className="min-w-0 flex-1 text-right">
                  <span
                    className={cn(
                      'inline-block px-1.5 py-0.5 rounded-md border text-[9px] font-semibold',
                      q.section === 'spiral'
                        ? 'bg-amber-500/15 text-amber-500 border-amber-500/40'
                        : 'bg-primary/10 text-primary border-primary/30',
                    )}
                  >
                    {q.section === 'spiral' ? 'spiral' : 'new'}
                  </span>
                  {q.difficulty !== null && (
                    <div className="text-[9px] text-muted-foreground mt-0.5">
                      diff {q.difficulty}
                    </div>
                  )}
                </div>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}
