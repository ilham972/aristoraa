'use client';

// ─── Settings → "Book" tab ───────────────────────────────────────────────────
// Hosts the combined book-entry flow (book-entry-view.tsx) as its own
// top-level Settings tab, with a full-screen focus mode: the wrapper flips to
// a fixed overlay (bottom nav hidden via NavVisibility) so the founder can
// work through a whole book without the surrounding chrome. The toggle only
// changes CSS classes — BookEntryView stays mounted, so the selected unit and
// scroll position survive entering/exiting full screen.
// Shares the selected-book sessionStorage key with the Data Entry tab on
// purpose: picking a book here carries over to Details/Concepts and back.

import { useState, useMemo, useEffect } from 'react';
import { useQuery } from 'convex/react';
import { Maximize2, Minimize2 } from 'lucide-react';
import { getUnitsForBook } from '@/lib/curriculum-data';
import { api } from '@/lib/convex';
import { toast } from 'sonner';
import { useNavVisibility } from '@/contexts/nav-visibility';
import { BookEntryView } from '@/components/settings/book-entry-view';

const SS_BOOK = 'dataEntry.selectedBookId'; // shared with Data Entry tab

export function BookTab() {
  const textbooks = useQuery(api.textbooks.list);
  const allExercises = useQuery(api.exercises.list);
  const allUnitMeta = useQuery(api.unitMetadata.list);
  const { setHideBottomNav } = useNavVisibility();

  const [selectedBookId, setSelectedBookId] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    return window.sessionStorage.getItem(SS_BOOK);
  });
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !selectedBookId) return;
    window.sessionStorage.setItem(SS_BOOK, selectedBookId);
  }, [selectedBookId]);

  // Full-screen focus mode: hide the bottom nav and lock body scroll while
  // the overlay is up; always restore on unmount (e.g. switching tabs).
  useEffect(() => {
    setHideBottomNav(fullscreen);
    document.body.style.overflow = fullscreen ? 'hidden' : '';
    return () => {
      setHideBottomNav(false);
      document.body.style.overflow = '';
    };
  }, [fullscreen, setHideBottomNav]);

  const selectedBook = textbooks?.find(t => t._id === selectedBookId);

  const bookUnits = useMemo(() => {
    if (!selectedBook?.startUnit || !selectedBook?.endUnit) return [];
    return getUnitsForBook(selectedBook.grade, selectedBook.startUnit, selectedBook.endUnit);
  }, [selectedBook]);

  if (!textbooks || !allExercises || !allUnitMeta) {
    return (
      <div className="animate-pulse space-y-2">
        {[1, 2, 3].map(i => (
          <div key={i} className="h-20 bg-muted rounded-xl" />
        ))}
      </div>
    );
  }

  const sortedBooks = [...textbooks].sort((a, b) => a.grade - b.grade || a.part - b.part);

  return (
    <div
      className={
        fullscreen
          ? 'fixed inset-0 z-50 bg-background flex flex-col px-3 pb-2 pt-[calc(env(safe-area-inset-top)+8px)]'
          : ''
      }
    >
      {/* Book badges + full-screen toggle */}
      <div className="flex items-start gap-2 mb-3 shrink-0">
        <div className="flex gap-2 overflow-x-auto no-scrollbar flex-1 pb-1">
          {sortedBooks.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No books yet. Create them in Content tab.
            </p>
          )}
          {sortedBooks.map(book => {
            const isSelected = book._id === selectedBookId;
            const hasRange = book.startUnit != null && book.endUnit != null;
            return (
              <button
                key={book._id}
                onClick={() => {
                  if (!hasRange) {
                    toast.error('Set unit range in Content tab first');
                    return;
                  }
                  setSelectedBookId(book._id);
                }}
                className={`shrink-0 px-3 py-2 rounded-xl text-xs font-medium transition-all border ${
                  isSelected
                    ? 'bg-primary text-primary-foreground border-primary'
                    : hasRange
                      ? 'bg-card border-border hover:border-primary/30'
                      : 'bg-muted/50 border-border/30 opacity-50'
                }`}
              >
                <div>G{book.grade} · P{book.part}</div>
                {hasRange ? (
                  <div
                    className={`text-[10px] ${
                      isSelected ? 'text-primary-foreground/70' : 'text-muted-foreground'
                    }`}
                  >
                    Units {book.startUnit}–{book.endUnit}
                  </div>
                ) : (
                  <div className="text-[10px] text-muted-foreground">No range</div>
                )}
              </button>
            );
          })}
        </div>
        <button
          onClick={() => setFullscreen(f => !f)}
          title={fullscreen ? 'Exit full screen' : 'Full screen'}
          aria-label={fullscreen ? 'Exit full screen' : 'Full screen'}
          className="w-9 h-9 rounded-xl border border-border bg-card flex items-center justify-center text-muted-foreground hover:text-foreground hover:border-primary/30 transition-all active:scale-95 shrink-0"
        >
          {fullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
        </button>
      </div>

      {!selectedBook ? (
        <p className="text-sm text-muted-foreground text-center py-8">Select a book to start</p>
      ) : bookUnits.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">
          No units found for this book&apos;s range
        </p>
      ) : (
        <BookEntryView
          key={selectedBook._id}
          fullscreen={fullscreen}
          textbook={selectedBook}
          bookUnits={bookUnits}
          allExercises={allExercises}
          allUnitMeta={allUnitMeta}
        />
      )}
    </div>
  );
}
