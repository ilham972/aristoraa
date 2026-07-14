'use client';

// ─── Topic Journey reader ────────────────────────────────────────────────────
// Full-screen overlay opened from the Tags drawer when a concept is tapped.
// Shows only that concept's marked textbook pages, with a horizontal strip of
// ALL the tag's concepts in grade order (G6 → G11) across the top — so the
// founder can read a topic like Statistics as one continuous story across
// grades: tap any stop to jump, or use Prev / Next at the bottom.
// Rendered as a body portal ABOVE the tag drawer's Sheet, so closing it lands
// back in the drawer exactly as it was. Pages use the downscaled thumbnails
// (phone-friendly); tapping a page opens the existing pinch-zoom view with
// the full-res image.

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from 'convex/react';
import { X, ChevronLeft, ChevronRight, ImageOff, Video, BookOpen } from 'lucide-react';
import { api } from '@/lib/convex';
import type { Id } from '@/lib/convex';
import { findUnit } from '@/lib/curriculum-data';
import { MODULE_COLORS } from '@/lib/types';
import { ZoomedPageView } from './zoomed-page-view';

export type ReaderConcept = {
  _id: Id<'exercises'>;
  name: string;
  videoUrl?: string;
  pageNumber?: number;
  pageNumberEnd?: number;
};

export type ReaderGroup = {
  unitId: string;
  grade: number;
  term: number;
  moduleId: string;
  concepts: ReaderConcept[];
};

interface Props {
  open: boolean;
  onClose: () => void;
  tagName: string;
  tagColor: string;
  groups: ReaderGroup[];
  initialConceptId: Id<'exercises'> | null;
}

type Stop = ReaderConcept & {
  grade: number;
  term: number;
  moduleId: string;
  unitId: string;
  unitName: string;
};

export function TopicJourneyReader({
  open,
  onClose,
  tagName,
  tagColor,
  groups,
  initialConceptId,
}: Props) {
  // Flatten grade-sorted groups into one ordered list of "stops".
  const stops = useMemo<Stop[]>(
    () =>
      groups.flatMap((g) =>
        g.concepts.map((c) => ({
          ...c,
          grade: g.grade,
          term: g.term,
          moduleId: g.moduleId,
          unitId: g.unitId,
          unitName: findUnit(g.unitId)?.unit.name ?? '(unknown unit)',
        })),
      ),
    [groups],
  );

  const [activeIdx, setActiveIdx] = useState(0);
  const [zoomed, setZoomed] = useState<{
    pageId: Id<'textbookPages'>;
    pageNumber: number;
    url: string;
  } | null>(null);

  // Jump to the tapped concept every time the reader opens.
  useEffect(() => {
    if (!open) return;
    setZoomed(null);
    const idx = stops.findIndex((s) => s._id === initialConceptId);
    setActiveIdx(idx >= 0 ? idx : 0);
  }, [open, initialConceptId, stops]);

  const active: Stop | undefined = stops[activeIdx];
  const hasPages = active?.pageNumber != null;

  const pages = useQuery(
    api.textbookPages.getSmallPagesByGradeRange,
    open && active && active.pageNumber != null
      ? {
          grade: active.grade,
          startPage: active.pageNumber,
          endPage: active.pageNumberEnd ?? active.pageNumber,
        }
      : 'skip',
  );

  // Keep the active chip visible in the strip and reset page scroll on jump.
  const chipRefs = useRef(new Map<number, HTMLButtonElement>());
  const scrollRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    chipRefs.current.get(activeIdx)?.scrollIntoView({
      behavior: 'smooth',
      inline: 'center',
      block: 'nearest',
    });
    scrollRef.current?.scrollTo({ top: 0 });
  }, [open, activeIdx]);

  // ESC closes the zoom first, then the reader.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setZoomed((z) => {
        if (z) return null;
        onClose();
        return z;
      });
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open || typeof document === 'undefined') return null;

  const prevStop = activeIdx > 0 ? stops[activeIdx - 1] : null;
  const nextStop = activeIdx < stops.length - 1 ? stops[activeIdx + 1] : null;
  const activeColor = active ? (MODULE_COLORS[active.moduleId] ?? tagColor) : tagColor;

  return createPortal(
    <div className="fixed inset-0 bg-background flex flex-col" style={{ zIndex: 9992 }}>
      {/* ── Header ── */}
      <div className="shrink-0 flex items-center gap-2 px-3 pt-[calc(env(safe-area-inset-top)+8px)] pb-2 border-b border-border/60">
        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: tagColor }} />
        <p className="flex-1 min-w-0 text-sm font-semibold truncate">{tagName}</p>
        <button
          type="button"
          onClick={onClose}
          className="w-8 h-8 rounded-full flex items-center justify-center bg-muted text-muted-foreground hover:text-foreground transition-colors shrink-0"
          aria-label="Close reader"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* ── Concept strip (grade-ordered "stops") ── */}
      <div className="shrink-0 border-b border-border/60">
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar px-3 py-2">
          {stops.map((s, i) => {
            const isFirstOfGrade = i === 0 || stops[i - 1].grade !== s.grade;
            const isActive = i === activeIdx;
            const unmarked = s.pageNumber == null;
            const color = MODULE_COLORS[s.moduleId] ?? tagColor;
            return (
              <div key={s._id} className="flex items-center gap-1.5 shrink-0">
                {isFirstOfGrade && (
                  <span
                    className={`text-[10px] font-bold font-mono px-1.5 py-0.5 rounded-md shrink-0 ${
                      i > 0 ? 'ml-1.5' : ''
                    }`}
                    style={{ backgroundColor: `${color}22`, color }}
                  >
                    G{s.grade}
                  </span>
                )}
                <button
                  type="button"
                  ref={(el) => {
                    if (el) chipRefs.current.set(i, el);
                    else chipRefs.current.delete(i);
                  }}
                  onClick={() => setActiveIdx(i)}
                  className={`max-w-[160px] px-2.5 py-1.5 rounded-full text-[11px] font-medium truncate transition-all border ${
                    isActive
                      ? 'bg-primary text-primary-foreground border-primary'
                      : unmarked
                        ? 'bg-muted/40 text-muted-foreground/60 border-dashed border-border'
                        : 'bg-muted text-muted-foreground border-transparent hover:text-foreground'
                  }`}
                  title={unmarked ? `${s.name} — no pages marked yet` : s.name}
                >
                  {s.name}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Pages ── */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3">
        {!active ? (
          <div className="rounded-xl border border-dashed border-border/60 bg-muted/30 px-4 py-10 text-center">
            <p className="text-xs text-muted-foreground">No concepts in this tag yet.</p>
          </div>
        ) : (
          <div className="space-y-3 pb-4">
            {/* Caption */}
            <div className="flex items-center gap-2 flex-wrap">
              <span
                className="font-mono text-[10px] font-bold rounded px-1.5 py-0.5"
                style={{ backgroundColor: `${activeColor}22`, color: activeColor }}
              >
                G{active.grade}·T{active.term}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-foreground leading-tight truncate">
                  {active.name}
                </p>
                <p className="text-[10px] text-muted-foreground truncate">
                  {active.unitName}
                  {hasPages &&
                    ` · p. ${active.pageNumber}${
                      active.pageNumberEnd && active.pageNumberEnd !== active.pageNumber
                        ? `–${active.pageNumberEnd}`
                        : ''
                    }`}
                </p>
              </div>
              {active.videoUrl && (
                <a
                  href={active.videoUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 rounded-full bg-violet-500/10 text-violet-500 px-2.5 py-1 text-[10px] font-medium shrink-0"
                >
                  <Video className="w-3 h-3" /> Video
                </a>
              )}
            </div>

            {!hasPages ? (
              <div className="rounded-xl border border-dashed border-border/60 bg-muted/30 px-4 py-10 text-center space-y-1">
                <BookOpen className="w-6 h-6 text-muted-foreground mx-auto" />
                <p className="text-xs text-muted-foreground">
                  No book pages marked for this concept yet.
                </p>
                <p className="text-[10px] text-muted-foreground">
                  Mark its start/end pages in Settings → Book, then come back.
                </p>
              </div>
            ) : pages === undefined ? (
              <div className="space-y-3">
                {[1, 2].map((i) => (
                  <div key={i} className="w-full aspect-[3/4] bg-muted rounded-xl animate-pulse" />
                ))}
              </div>
            ) : (
              pages.map((p) =>
                p.url && p.pageId ? (
                  <button
                    key={p.pageNumber}
                    type="button"
                    onClick={() =>
                      setZoomed({
                        pageId: p.pageId!,
                        pageNumber: p.pageNumber,
                        url: p.fullUrl ?? p.url!,
                      })
                    }
                    className="block w-full rounded-xl overflow-hidden ring-1 ring-border bg-white active:scale-[0.99] transition-transform"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={p.url}
                      alt={`Page ${p.pageNumber}`}
                      loading="lazy"
                      className="w-full h-auto"
                    />
                  </button>
                ) : (
                  <div
                    key={p.pageNumber}
                    className="w-full aspect-[3/4] rounded-xl border border-dashed border-border/60 bg-muted/30 flex flex-col items-center justify-center gap-1"
                  >
                    <ImageOff className="w-5 h-5 text-muted-foreground" />
                    <p className="text-[10px] text-muted-foreground">
                      Page {p.pageNumber} not uploaded
                    </p>
                  </div>
                ),
              )
            )}

            {/* End-of-concept navigation */}
            {nextStop && (
              <button
                type="button"
                onClick={() => setActiveIdx(activeIdx + 1)}
                className="w-full rounded-xl border border-border/60 bg-card hover:bg-muted/40 px-3 py-3 flex items-center gap-2 text-left transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide">
                    Next · G{nextStop.grade}
                  </p>
                  <p className="text-sm font-medium truncate">{nextStop.name}</p>
                </div>
                <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── Bottom bar ── */}
      <div className="shrink-0 border-t border-border/60 px-3 py-2 pb-[calc(env(safe-area-inset-bottom)+8px)] flex items-center gap-2">
        <button
          type="button"
          onClick={() => setActiveIdx(activeIdx - 1)}
          disabled={!prevStop}
          className="flex-1 h-10 rounded-xl border border-border text-xs font-medium flex items-center justify-center gap-1 hover:bg-muted transition-colors disabled:opacity-40"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
          <span className="truncate max-w-[110px]">{prevStop ? prevStop.name : 'Start'}</span>
        </button>
        <span className="text-[10px] text-muted-foreground font-mono shrink-0">
          {stops.length === 0 ? '0/0' : `${activeIdx + 1}/${stops.length}`}
        </span>
        <button
          type="button"
          onClick={() => setActiveIdx(activeIdx + 1)}
          disabled={!nextStop}
          className="flex-1 h-10 rounded-xl border border-border text-xs font-medium flex items-center justify-center gap-1 hover:bg-muted transition-colors disabled:opacity-40"
        >
          <span className="truncate max-w-[110px]">{nextStop ? nextStop.name : 'End'}</span>
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* ── Full-res pinch-zoom (existing viewer, crops disabled) ── */}
      {zoomed && (
        <ZoomedPageView
          pageId={zoomed.pageId}
          pageNumber={zoomed.pageNumber}
          imageUrl={zoomed.url}
          crops={[]}
          tool="delete"
          onToolChange={() => {}}
          onClose={() => setZoomed(null)}
        />
      )}
    </div>,
    document.body,
  );
}
