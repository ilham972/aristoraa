'use client';

// ─── Book Entry (Data Entry → "Book" sub-tab) ───────────────────────────────
// Combines the old "Exercises" and "Page Nos" layers into one pass over the
// uploaded book: the whole book scrolls in a viewer, unit pills sit on top
// (two dots each: pages / exercises), and a sticky bottom bar logs the
// selected unit — Mark start / Mark end grab the page currently on screen,
// the count picker sets exercises (+ review toggle), one Save commits both.
// Saving auto-advances to the next unlogged unit with its start page
// pre-filled from this unit's end + 1.

import { useState, useMemo, useEffect, useRef, type CSSProperties } from 'react';
import { useQuery, useMutation } from 'convex/react';
import { BookOpen, LocateFixed } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { api } from '@/lib/convex';
import type { Id } from '@/lib/convex';
import { toast } from 'sonner';

export interface BookEntryUnit {
  id: string;
  name: string;
  number: number;
  moduleId: string;
  term: number;
}

type ExerciseRow = {
  _id: Id<'exercises'>;
  unitId: string;
  name: string;
  type?: string;
};

type UnitMetaRow = {
  unitId: string;
  startPage?: number;
  endPage?: number;
};

type UnitExerciseStats = { maxNum: number; hasReview: boolean; count: number };

const EMPTY_STATS: UnitExerciseStats = { maxNum: 0, hasReview: false, count: 0 };

export function BookEntryView({
  textbook,
  bookUnits,
  allExercises,
  allUnitMeta,
  fullscreen = false,
}: {
  textbook: { _id: Id<'textbooks'>; grade: number; part: number; totalPages: number };
  bookUnits: BookEntryUnit[];
  allExercises: ExerciseRow[];
  allUnitMeta: UnitMetaRow[];
  // Full-screen focus mode (Book tab overlay): the viewer stretches to fill
  // the remaining height and the entry bar sits at the real screen bottom
  // (the app's bottom nav is hidden by the host while this is on).
  fullscreen?: boolean;
}) {
  const pages = useQuery(api.textbookPages.listSmallPages, { textbookId: textbook._id });

  const bulkAddMutation = useMutation(api.exercises.bulkAdd);
  const trimMutation = useMutation(api.exercises.trimToCount);
  const setReviewMutation = useMutation(api.exercises.setReview);
  const setUnitPagesMutation = useMutation(api.unitMetadata.setPages);

  // === DERIVED LOOKUPS ===
  const metaByUnit = useMemo(() => {
    const m = new Map<string, UnitMetaRow>();
    for (const meta of allUnitMeta) m.set(meta.unitId, meta);
    return m;
  }, [allUnitMeta]);

  const exStats = useMemo(() => {
    const m = new Map<string, UnitExerciseStats>();
    for (const e of allExercises) {
      if ((e.type || 'exercise') !== 'exercise') continue;
      const cur = m.get(e.unitId) || { maxNum: 0, hasReview: false, count: 0 };
      cur.count++;
      if (e.name.endsWith('.0')) {
        cur.hasReview = true;
      } else {
        const sub = parseInt(e.name.split('.')[1]);
        if (!isNaN(sub) && sub > cur.maxNum) cur.maxNum = sub;
      }
      m.set(e.unitId, cur);
    }
    return m;
  }, [allExercises]);

  const pagesDone = (unitId: string) => {
    const meta = metaByUnit.get(unitId);
    return meta?.startPage != null && meta?.endPage != null;
  };
  const exercisesDone = (unitId: string) => (exStats.get(unitId)?.count ?? 0) > 0;
  const unitFullyDone = (unitId: string) => pagesDone(unitId) && exercisesDone(unitId);

  // === SELECTION + FORM STATE ===
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null);
  const [startVal, setStartVal] = useState('');
  const [endVal, setEndVal] = useState('');
  const [countVal, setCountVal] = useState<number | null>(null);
  const [reviewVal, setReviewVal] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const selectedUnit = useMemo(
    () => (selectedUnitId ? bookUnits.find(u => u.id === selectedUnitId) ?? null : null),
    [selectedUnitId, bookUnits],
  );
  const selectedStats = selectedUnit ? exStats.get(selectedUnit.id) ?? EMPTY_STATS : EMPTY_STATS;
  const selectedIsNew = selectedStats.count === 0;

  // === VIEWER STATE ===
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const stripRef = useRef<HTMLDivElement | null>(null);
  const scaleRef = useRef(1);
  const [scale, setScale] = useState(1);
  const [currentPage, setCurrentPage] = useState<number | null>(null);
  // A jump target set before the page images exist yet (initial load) is kept
  // here and retried once the pages render.
  const pendingScroll = useRef<number | null>(null);

  const attemptScroll = () => {
    const n = pendingScroll.current;
    if (n == null) return;
    const el = scrollRef.current;
    const pageEl = el?.querySelector<HTMLElement>(`[data-book-page="${n}"]`);
    if (!el || !pageEl) return;
    pendingScroll.current = null;
    el.scrollTo({ top: pageEl.offsetTop - 8, behavior: 'auto' });
  };

  const scrollToPage = (n: number | undefined) => {
    if (n == null) return;
    pendingScroll.current = n;
    requestAnimationFrame(attemptScroll);
  };

  useEffect(() => {
    // Retry a pending jump once the page list has rendered.
    if (pages && pages.length > 0) requestAnimationFrame(attemptScroll);
  }, [pages]);

  // Start page guess: the nearest previous unit with a logged end page → +1.
  // Only that confident case is prefilled; anything else stays blank.
  const guessStart = (unit: BookEntryUnit): number | undefined => {
    const idx = bookUnits.findIndex(u => u.id === unit.id);
    for (let i = idx - 1; i >= 0; i--) {
      const meta = metaByUnit.get(bookUnits[i].id);
      if (meta?.endPage != null) return meta.endPage + 1;
    }
    return undefined;
  };

  const selectUnit = (unit: BookEntryUnit, opts?: { prefillStart?: number }) => {
    const meta = metaByUnit.get(unit.id);
    const stats = exStats.get(unit.id) ?? EMPTY_STATS;
    const start = meta?.startPage ?? opts?.prefillStart ?? guessStart(unit);
    setSelectedUnitId(unit.id);
    setStartVal(start != null ? String(start) : '');
    setEndVal(meta?.endPage != null ? String(meta.endPage) : '');
    setCountVal(stats.maxNum > 0 ? stats.maxNum : null);
    setReviewVal(stats.count === 0 ? false : stats.hasReview);
    scrollToPage(start);
  };

  // Initial selection: first unit that isn't fully logged.
  const initDone = useRef(false);
  useEffect(() => {
    if (initDone.current || bookUnits.length === 0) return;
    initDone.current = true;
    const firstIncomplete = bookUnits.find(u => !unitFullyDone(u.id)) ?? bookUnits[0];
    selectUnit(firstIncomplete);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookUnits]);

  // Keep the selected pill visible in the strip.
  useEffect(() => {
    if (!selectedUnitId) return;
    stripRef.current
      ?.querySelector(`[data-unit-pill="${CSS.escape(selectedUnitId)}"]`)
      ?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }, [selectedUnitId]);

  useEffect(() => {
    scaleRef.current = scale;
  }, [scale]);

  // ── Current-page tracking: the page nearest a reference line ~38% down
  // the viewer is "the page you're looking at" (same heuristic as the
  // Details pages drawer). ──
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !pages || pages.length === 0) return;

    const updateCurrentPage = () => {
      const pageEls = Array.from(el.querySelectorAll<HTMLElement>('[data-book-page]'));
      if (pageEls.length === 0) return;
      const viewportCenter = el.getBoundingClientRect().top + el.clientHeight * 0.38;
      let bestPage = Number(pageEls[0].dataset.bookPage);
      let bestDistance = Number.POSITIVE_INFINITY;
      for (const pageEl of pageEls) {
        const rect = pageEl.getBoundingClientRect();
        const distanceFromCenter = Math.abs(rect.top - viewportCenter);
        if (distanceFromCenter < bestDistance) {
          bestDistance = distanceFromCenter;
          bestPage = Number(pageEl.dataset.bookPage);
        }
      }
      if (!Number.isNaN(bestPage)) setCurrentPage(bestPage);
    };

    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(updateCurrentPage);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    raf = requestAnimationFrame(updateCurrentPage);
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener('scroll', onScroll);
    };
  }, [pages]);

  // ── Pinch zoom (same mechanics as the Details pages drawer) ──
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const distance = (a: Touch, b: Touch) =>
      Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);

    let pinch:
      | {
          startDist: number;
          startScale: number;
          centerX: number;
          centerY: number;
          contentX: number;
          contentY: number;
        }
      | null = null;

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 2) return;
      const rect = el.getBoundingClientRect();
      const t1 = e.touches[0];
      const t2 = e.touches[1];
      const centerX = (t1.clientX + t2.clientX) / 2 - rect.left;
      const centerY = (t1.clientY + t2.clientY) / 2 - rect.top;
      const startScale = scaleRef.current;
      pinch = {
        startDist: distance(t1, t2),
        startScale,
        centerX,
        centerY,
        contentX: (el.scrollLeft + centerX) / startScale,
        contentY: (el.scrollTop + centerY) / startScale,
      };
      e.preventDefault();
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!pinch || e.touches.length !== 2) return;
      const t1 = e.touches[0];
      const t2 = e.touches[1];
      const nextScale = Math.max(
        1,
        Math.min(4, pinch.startScale * (distance(t1, t2) / pinch.startDist)),
      );
      scaleRef.current = nextScale;
      setScale(nextScale);
      el.scrollLeft = pinch.contentX * nextScale - pinch.centerX;
      el.scrollTop = pinch.contentY * nextScale - pinch.centerY;
      e.preventDefault();
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) pinch = null;
    };

    el.addEventListener('touchstart', onTouchStart, { passive: false });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd);
    el.addEventListener('touchcancel', onTouchEnd);
    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchEnd);
    };
  }, []);

  // === SAVE ===
  const handleSave = async () => {
    if (!selectedUnit || saving) return;
    const startStr = startVal.trim();
    const endStr = endVal.trim();
    const hasAnyPage = startStr !== '' || endStr !== '';
    const start = parseInt(startStr);
    const end = parseInt(endStr);
    const pagesValid = !isNaN(start) && !isNaN(end) && start >= 1 && start <= end;
    if (hasAnyPage && !pagesValid) {
      toast.error('Enter a valid start and end page');
      return;
    }

    const stats = exStats.get(selectedUnit.id) ?? EMPTY_STATS;
    const isNew = stats.count === 0;
    let savedSomething = false;

    setSaving(true);
    try {
      if (pagesValid) {
        await setUnitPagesMutation({
          unitId: selectedUnit.id,
          startPage: start,
          endPage: end,
        });
        savedSomething = true;
      }

      if (countVal != null && countVal > 0) {
        if (isNew) {
          await bulkAddMutation({
            unitId: selectedUnit.id,
            unitNumber: selectedUnit.number,
            lastExercise: countVal,
            hasReview: reviewVal,
          });
          savedSomething = true;
        } else if (countVal > stats.maxNum) {
          await bulkAddMutation({
            unitId: selectedUnit.id,
            unitNumber: selectedUnit.number,
            lastExercise: countVal,
            hasReview: false,
            startFrom: stats.maxNum + 1,
          });
          savedSomething = true;
        } else if (countVal < stats.maxNum) {
          await trimMutation({
            unitId: selectedUnit.id,
            unitNumber: selectedUnit.number,
            keepUpTo: countVal,
          });
          savedSomething = true;
        }
      }

      // Review reconcile for units that already have exercises. (New units get
      // their review from bulkAdd above; there's nothing to reconcile.)
      if (!isNew && reviewVal !== stats.hasReview) {
        await setReviewMutation({
          unitId: selectedUnit.id,
          unitNumber: selectedUnit.number,
          hasReview: reviewVal,
        });
        savedSomething = true;
      }

      if (!savedSomething) {
        toast.info('Nothing new to save');
        return;
      }

      toast.success(`Unit ${selectedUnit.number} saved`);

      // Auto-advance to the next unlogged unit; its start page is this
      // unit's end + 1 unless it already has its own pages logged.
      const idx = bookUnits.findIndex(u => u.id === selectedUnit.id);
      const next = bookUnits.slice(idx + 1).find(u => !unitFullyDone(u.id));
      if (next) {
        selectUnit(next, { prefillStart: pagesValid ? end + 1 : undefined });
      } else {
        toast.success('All units of this book are logged 🎉');
      }
    } catch (err) {
      console.error('[BookEntryView] save failed', err);
      toast.error(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const contentStyle = { zoom: scale } as CSSProperties & { zoom: number };

  return (
    <div className={fullscreen ? 'flex flex-col flex-1 min-h-0' : ''}>
      {/* ─── Unit pill strip ─── */}
      <div ref={stripRef} className="flex gap-1.5 overflow-x-auto no-scrollbar pb-2 mb-2 shrink-0">
        {bookUnits.map(unit => {
          const pg = pagesDone(unit.id);
          const ex = exercisesDone(unit.id);
          const isSelected = unit.id === selectedUnitId;
          const stateClasses =
            pg && ex
              ? 'bg-emerald-500/15 border-emerald-500/40'
              : pg || ex
                ? 'bg-amber-500/15 border-amber-500/40'
                : 'bg-card border-border/50';
          return (
            <button
              key={unit.id}
              data-unit-pill={unit.id}
              onClick={() => selectUnit(unit)}
              title={unit.name}
              className={`shrink-0 min-w-[44px] px-2 py-1.5 rounded-xl border text-center transition-all active:scale-95 ${stateClasses} ${
                isSelected ? 'ring-2 ring-primary' : ''
              }`}
            >
              <div
                className={`text-sm font-bold leading-none ${
                  pg && ex ? 'text-emerald-400' : 'text-foreground'
                }`}
              >
                {unit.number}
              </div>
              <div className="flex items-center justify-center gap-1 mt-1.5">
                <span
                  title="Pages logged"
                  className={`w-1.5 h-1.5 rounded-full ${
                    pg ? 'bg-emerald-500' : 'bg-muted-foreground/30'
                  }`}
                />
                <span
                  title="Exercises logged"
                  className={`w-1.5 h-1.5 rounded-full ${
                    ex ? 'bg-emerald-500' : 'bg-muted-foreground/30'
                  }`}
                />
              </div>
            </button>
          );
        })}
      </div>

      {/* ─── Book viewer ─── */}
      <div
        ref={scrollRef}
        className={`rounded-xl border border-border/50 bg-muted/30 overflow-auto overscroll-contain ${
          fullscreen ? 'flex-1 min-h-0' : 'h-[50vh] min-h-[300px]'
        }`}
        style={{ touchAction: 'pan-x pan-y' }}
      >
        {!pages ? (
          <div className="p-3 space-y-3">
            {[1, 2].map(i => (
              <div key={i} className="aspect-[5/7] rounded-lg bg-muted animate-pulse" />
            ))}
          </div>
        ) : pages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center px-6 text-center">
            <BookOpen className="w-10 h-10 text-muted-foreground/30 mb-3" />
            <p className="text-sm text-muted-foreground">
              No pages uploaded for this book yet — upload them in the Content tab. You can
              still log pages and exercises below by typing.
            </p>
          </div>
        ) : (
          <>
            {/* Floating current-page badge (outside the zoomed content so it
                stays put while pinching) */}
            <div className="sticky top-2 z-10 flex justify-end pr-2 -mb-7 pointer-events-none">
              {currentPage != null && (
                <span className="rounded-md bg-foreground/80 text-background text-[11px] font-mono px-1.5 py-0.5 shadow">
                  p. {currentPage}
                </span>
              )}
            </div>
            <div className="origin-top-left space-y-2 p-2" style={contentStyle}>
              {pages.map(p => (
                <div
                  key={p.pageNumber}
                  data-book-page={p.pageNumber}
                  className="relative rounded-lg overflow-hidden border border-border/50 bg-background"
                >
                  <div className="aspect-[5/7]">
                    {p.url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={p.url}
                        alt={`Page ${p.pageNumber}`}
                        loading="lazy"
                        decoding="async"
                        draggable={false}
                        className="w-full h-full object-contain select-none"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <p className="text-xs text-muted-foreground">
                          Page {p.pageNumber} not uploaded
                        </p>
                      </div>
                    )}
                  </div>
                  <span className="absolute bottom-1 right-1 rounded bg-foreground/60 text-background text-[10px] font-mono px-1">
                    {p.pageNumber}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* ─── Sticky entry bar (sits above the app's bottom nav) ─── */}
      {selectedUnit && (
        <div
          className="sticky z-40 mt-3 rounded-xl border border-border bg-card shadow-lg p-3 space-y-2.5 shrink-0"
          style={{
            bottom: fullscreen
              ? 'calc(env(safe-area-inset-bottom) + 8px)'
              : 'calc(4rem + env(safe-area-inset-bottom) + 8px)',
          }}
        >
          <div className="flex items-center gap-2">
            <p className="text-xs font-semibold text-foreground flex-1 truncate">
              {selectedUnit.name}
            </p>
            <span className="text-[10px] text-muted-foreground shrink-0">
              {pagesDone(selectedUnit.id) ? 'pages ✓' : 'pages …'} ·{' '}
              {exercisesDone(selectedUnit.id) ? 'ex ✓' : 'ex …'}
            </span>
          </div>

          {/* Pages row: editable fields + Mark buttons grabbing the page on screen */}
          <div className="flex items-center gap-1.5">
            <Input
              type="number"
              inputMode="numeric"
              min={1}
              value={startVal}
              onChange={e => setStartVal(e.target.value)}
              placeholder="start"
              aria-label="Start page"
              className="w-14 h-9 text-sm text-center font-mono px-1"
            />
            <Button
              variant="outline"
              size="sm"
              className="h-9 px-2 gap-1 shrink-0"
              disabled={currentPage == null}
              onClick={() => currentPage != null && setStartVal(String(currentPage))}
            >
              <LocateFixed className="w-3.5 h-3.5" />
              <span className="text-xs">Start</span>
            </Button>
            <span className="text-muted-foreground text-xs">–</span>
            <Input
              type="number"
              inputMode="numeric"
              min={1}
              value={endVal}
              onChange={e => setEndVal(e.target.value)}
              placeholder="end"
              aria-label="End page"
              className="w-14 h-9 text-sm text-center font-mono px-1"
            />
            <Button
              variant="outline"
              size="sm"
              className="h-9 px-2 gap-1 shrink-0"
              disabled={currentPage == null}
              onClick={() => currentPage != null && setEndVal(String(currentPage))}
            >
              <LocateFixed className="w-3.5 h-3.5" />
              <span className="text-xs">End</span>
            </Button>
          </div>

          {/* Exercises + review + save row */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPickerOpen(true)}
              className="flex-1 h-9 px-3 rounded-lg bg-muted text-left text-xs font-medium text-foreground hover:bg-muted/70 transition-colors truncate"
            >
              {countVal != null && countVal > 0
                ? `${countVal} exercise${countVal !== 1 ? 's' : ''}`
                : 'Set exercises…'}
            </button>
            <button
              onClick={() => setReviewVal(r => !r)}
              title={
                reviewVal
                  ? `Unit has a review exercise (${selectedUnit.number}.0) — tap to remove`
                  : `No review exercise — tap to add ${selectedUnit.number}.0`
              }
              className={`h-9 px-2.5 rounded-lg text-xs font-medium transition-all shrink-0 ${
                reviewVal
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground'
              }`}
            >
              Rev{reviewVal ? ' ✓' : ''}
            </button>
            <Button onClick={handleSave} disabled={saving} className="h-9 px-4 rounded-lg shrink-0">
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </div>
      )}

      {/* ─── Exercise count picker ─── */}
      <Drawer open={pickerOpen} onOpenChange={setPickerOpen}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle className="text-sm">
              Unit {selectedUnit?.number}: number of exercises
            </DrawerTitle>
          </DrawerHeader>
          <div className="p-4 pt-0">
            <p className="text-xs text-muted-foreground mb-2">
              {selectedIsNew
                ? 'Count the exercise headings while scrolling the unit, then tap the last number.'
                : `Current: ${selectedStats.maxNum}. Tap to change (lower numbers trim).`}
            </p>
            <div className="grid grid-cols-6 gap-1.5">
              {Array.from({ length: 30 }, (_, i) => i + 1).map(n => {
                const isCurrent = n === countVal;
                const isLower = !selectedIsNew && n < selectedStats.maxNum;
                return (
                  <button
                    key={n}
                    onClick={() => {
                      setCountVal(n);
                      setPickerOpen(false);
                    }}
                    className={`h-10 rounded-lg text-sm font-medium transition-all ${
                      isCurrent
                        ? 'bg-emerald-500 text-white'
                        : isLower
                          ? 'bg-muted hover:bg-destructive/10 hover:text-destructive text-muted-foreground'
                          : 'bg-muted hover:bg-primary/10 hover:text-primary text-foreground'
                    }`}
                  >
                    {n}
                  </button>
                );
              })}
            </div>
          </div>
        </DrawerContent>
      </Drawer>
    </div>
  );
}
