'use client';

import { useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery } from 'convex/react';
import { ChevronLeft, Scissors, Image as ImageIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/convex';
import type { Id } from '@/lib/convex';
import { findUnit, extractUnitNumber } from '@/lib/curriculum-data';
import { PageCropOverlay } from '@/components/settings/page-crop-overlay';

/**
 * Dedicated full-screen unit-page crop view.
 *
 * Lives outside the Data Entry drawer specifically to avoid the shadcn/Vaul
 * drawer's gesture handling. iOS Safari's native image-callout recogniser
 * (long-press save/copy/share) was tangling with Vaul's swipe-to-close on
 * right-direction drawers, and even with all the workarounds the drawer
 * environment kept eating crop drags. This route renders plain DOM, full
 * height, no drawer, no Vaul — just the pages with the crop overlay.
 */
export default function UnitCropPage() {
  const params = useParams<{ unitId: string }>();
  const router = useRouter();
  const unitId = params.unitId;

  const [cropMode, setCropMode] = useState(true);

  const textbooks = useQuery(api.textbooks.list);
  const allUnitMeta = useQuery(api.unitMetadata.list);
  const allExercises = useQuery(api.exercises.list);

  const unitInfo = useMemo(() => findUnit(unitId), [unitId]);
  const unitNumber = useMemo(
    () => (unitInfo ? extractUnitNumber(unitInfo.unit.name) : 0),
    [unitInfo],
  );

  // Find the textbook that contains this unit — match by grade + unit number
  // falling within the textbook's startUnit..endUnit range.
  const textbook = useMemo(() => {
    if (!unitInfo || !textbooks) return null;
    return (
      textbooks.find(
        (t) =>
          t.grade === unitInfo.grade &&
          t.startUnit != null &&
          t.endUnit != null &&
          unitNumber >= t.startUnit &&
          unitNumber <= t.endUnit,
      ) ?? null
    );
  }, [unitInfo, textbooks, unitNumber]);

  const meta = useMemo(
    () => allUnitMeta?.find((m) => m.unitId === unitId),
    [allUnitMeta, unitId],
  );

  const unitPages = useQuery(
    api.textbookPages.getPagesInRange,
    textbook && meta?.startPage != null && meta?.endPage != null
      ? {
          textbookId: textbook._id as Id<'textbooks'>,
          startPage: meta.startPage,
          endPage: meta.endPage,
        }
      : 'skip',
  );

  const pageIdsForQuery = useMemo<Id<'textbookPages'>[]>(
    () =>
      (unitPages || [])
        .map((p) => (p as { pageId?: Id<'textbookPages'> | null }).pageId)
        .filter((id): id is Id<'textbookPages'> => !!id),
    [unitPages],
  );

  const pageCrops = useQuery(
    api.questionBank.listByPages,
    pageIdsForQuery.length > 0
      ? { textbookPageIds: pageIdsForQuery }
      : 'skip',
  );

  type PageCrop = NonNullable<typeof pageCrops>[number];
  const cropsByPage = useMemo(() => {
    const map = new Map<string, PageCrop[]>();
    if (!pageCrops) return map;
    for (const c of pageCrops) {
      if (!c.textbookPageId) continue;
      const arr = map.get(c.textbookPageId) || [];
      arr.push(c);
      map.set(c.textbookPageId, arr);
    }
    return map;
  }, [pageCrops]);

  const unitExercises = useMemo(
    () =>
      (allExercises || [])
        .filter((e) => e.unitId === unitId)
        .sort((a, b) => a.order - b.order),
    [allExercises, unitId],
  );

  // ── Render ───────────────────────────────────────────────
  if (!unitInfo) {
    return (
      <div className="px-4 pt-5 pb-6 max-w-lg mx-auto">
        <p className="text-sm text-muted-foreground">Unknown unit.</p>
      </div>
    );
  }

  if (!textbooks || !allUnitMeta || !allExercises) {
    return (
      <div className="px-4 pt-5 pb-6 max-w-lg mx-auto">
        <div className="animate-pulse h-12 bg-muted rounded-xl mb-3" />
        {[1, 2, 3].map((i) => (
          <div key={i} className="animate-pulse h-72 bg-muted rounded-xl mb-3" />
        ))}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Sticky header */}
      <div className="sticky top-0 z-40 bg-background border-b border-border/50">
        <div className="max-w-lg mx-auto px-3 py-2.5 flex items-center gap-2">
          <button
            onClick={() => router.back()}
            className="w-9 h-9 rounded-xl flex items-center justify-center hover:bg-muted transition-colors shrink-0"
            aria-label="Back"
          >
            <ChevronLeft className="w-5 h-5 text-muted-foreground" />
          </button>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-foreground truncate">
              {unitInfo.unit.name}
            </p>
            {meta?.startPage != null && meta?.endPage != null && (
              <p className="text-[11px] text-muted-foreground">
                pp. {meta.startPage}–{meta.endPage}
              </p>
            )}
          </div>
          <span className="text-[10px] font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded shrink-0">
            v6
          </span>
          <Button
            variant={cropMode ? 'default' : 'outline'}
            size="sm"
            className="gap-1.5 shrink-0"
            onClick={() => setCropMode((m) => !m)}
            disabled={meta?.startPage == null || meta?.endPage == null}
          >
            <Scissors className="w-3.5 h-3.5" />
            {cropMode ? 'Done' : 'Crop'}
          </Button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 max-w-lg mx-auto w-full px-3 py-3">
        {meta?.startPage == null || meta?.endPage == null ? (
          <p className="text-sm text-muted-foreground text-center py-12">
            Set the page range for this unit in Data Entry → Page Nos first.
          </p>
        ) : !textbook ? (
          <p className="text-sm text-muted-foreground text-center py-12">
            No textbook found for grade {unitInfo.grade}.
          </p>
        ) : !unitPages ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="w-full aspect-[3/4] bg-muted rounded-lg animate-pulse" />
            ))}
          </div>
        ) : (
          <>
            {cropMode && (
              <div className="mb-3 px-3 py-2 rounded-lg bg-primary/10 border border-primary/30 text-xs text-primary flex items-start gap-2">
                <Scissors className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>
                  Drag across a question to crop it. Tap a saved crop to link it
                  to an exercise.
                </span>
              </div>
            )}

            <div className="space-y-3">
              {unitPages.map((pg) => {
                const pageId =
                  (pg as { pageId?: Id<'textbookPages'> | null }).pageId ?? null;
                if (!pageId) {
                  return (
                    <div key={pg.pageNumber} className="relative">
                      <div className="absolute top-2 left-2 z-10 bg-background/80 backdrop-blur-sm rounded-md px-2 py-0.5 text-xs font-mono border border-border/50">
                        p.{pg.pageNumber}
                      </div>
                      {pg.url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={pg.url}
                          alt={`Page ${pg.pageNumber}`}
                          className="w-full rounded-lg border border-border"
                        />
                      ) : (
                        <div className="w-full aspect-[3/4] bg-muted rounded-lg flex flex-col items-center justify-center gap-2">
                          <ImageIcon className="w-10 h-10 text-muted-foreground/30" />
                          <p className="text-sm text-muted-foreground">
                            Page {pg.pageNumber} not captured
                          </p>
                        </div>
                      )}
                    </div>
                  );
                }
                return (
                  <PageCropOverlay
                    key={pageId}
                    pageId={pageId}
                    pageNumber={pg.pageNumber}
                    imageUrl={pg.url}
                    cropMode={cropMode}
                    crops={cropsByPage.get(pageId) || []}
                    unitExercises={unitExercises}
                  />
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
