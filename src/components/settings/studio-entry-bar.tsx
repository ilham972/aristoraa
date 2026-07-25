'use client';

// ─── Details Studio — sticky entry bar ──────────────────────────────────────
// The thumb-reach control surface for the selected exercise. Everything the
// old Details cards asked you to type is a tap here: page range grabbed from
// the page you're looking at, question count from a grid, sub-parts from the
// existing SubQuestionInline editor, theory rows inserted in place.
// Presentational — all persistence is owned by the tab shell.

import { useState } from 'react';
import { LocateFixed, List, Plus, Scissors, BookOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { SubQuestionInline } from '@/components/sub-question-inline';
import type { SubQuestionsMap } from '@/lib/sub-questions';
import type { Id } from '@/lib/convex';

export type StudioMode = 'browse' | 'crop';

const COUNT_GRID_MAX = 40;

export interface StudioBarExercise {
  _id: Id<'exercises'>;
  name: string;
  questionCount: number;
  pageNumber?: number;
  pageNumberEnd?: number;
  subQuestions?: SubQuestionsMap;
}

interface Props {
  exercise: StudioBarExercise;
  captured: number;
  total: number;
  mode: StudioMode;
  onModeChange: (m: StudioMode) => void;
  // Page currently centred in the browse viewer — powers the Mark buttons.
  currentPage: number | null;
  onSavePages: (start: number, end: number | undefined) => void | Promise<void>;
  onSaveCount: (count: number) => void | Promise<void>;
  onSaveSubQ: (map: SubQuestionsMap | null) => void | Promise<void>;
  onAddTheory: () => void;
  // Rendered instead of the browse rows while cropping: the key pill header
  // plus the crop toolbar, kept at the bottom of the screen where the thumb is.
  cropSlot?: React.ReactNode;
  // Sits above the app's bottom nav unless the host is in full-screen mode.
  fullscreen?: boolean;
}

export function StudioEntryBar({
  exercise,
  captured,
  total,
  mode,
  onModeChange,
  currentPage,
  onSavePages,
  onSaveCount,
  onSaveSubQ,
  onAddTheory,
  cropSlot,
  fullscreen = false,
}: Props) {
  // Page fields are uncontrolled-ish local state; the shell remounts this bar
  // (key = exercise id) when the selection changes, so they always start from
  // the selected exercise's saved values.
  const [startVal, setStartVal] = useState(
    exercise.pageNumber != null ? String(exercise.pageNumber) : '',
  );
  const [endVal, setEndVal] = useState(
    exercise.pageNumberEnd != null ? String(exercise.pageNumberEnd) : '',
  );
  const [countOpen, setCountOpen] = useState(false);
  const [partsOpen, setPartsOpen] = useState(false);

  const commitPages = (s: string, e: string) => {
    const start = parseInt(s, 10);
    if (isNaN(start) || start < 1) return;
    const end = e.trim() ? parseInt(e, 10) : undefined;
    if (end !== undefined && (isNaN(end) || end < start)) return;
    if (start === exercise.pageNumber && end === exercise.pageNumberEnd) return;
    void onSavePages(start, end);
  };

  const markStart = () => {
    if (currentPage == null) return;
    const s = String(currentPage);
    setStartVal(s);
    commitPages(s, endVal);
  };

  const markEnd = () => {
    if (currentPage == null) return;
    const e = String(currentPage);
    setEndVal(e);
    commitPages(startVal, e);
  };

  const canCrop = exercise.questionCount > 0;
  const subQCount = exercise.subQuestions
    ? Object.keys(exercise.subQuestions).length
    : 0;

  return (
    <div
      className="sticky z-40 mt-3 rounded-xl border border-border bg-card shadow-lg p-2.5 space-y-2 shrink-0"
      style={{
        bottom: fullscreen
          ? 'calc(env(safe-area-inset-bottom) + 8px)'
          : 'calc(4rem + env(safe-area-inset-bottom) + 8px)',
      }}
    >
      {/* Row A — identity + progress + mode switch */}
      <div className="flex items-center gap-2">
        <span className="text-sm font-mono font-bold text-foreground shrink-0">
          {exercise.name}
        </span>
        <span
          className={`text-[11px] shrink-0 ${
            total > 0 && captured === total ? 'text-emerald-500' : 'text-muted-foreground'
          }`}
        >
          {total > 0 ? `${captured}/${total} cropped` : 'no questions yet'}
        </span>
        <div className="flex-1" />
        <div className="flex bg-muted rounded-lg p-0.5 shrink-0">
          <button
            onClick={() => onModeChange('browse')}
            aria-pressed={mode === 'browse'}
            title="Browse the book"
            className={`h-8 px-2.5 rounded-md text-[11px] font-medium flex items-center gap-1 transition-all active:scale-95 ${
              mode === 'browse'
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <BookOpen className="w-3.5 h-3.5" />
            Book
          </button>
          <button
            onClick={() => canCrop && onModeChange('crop')}
            aria-pressed={mode === 'crop'}
            disabled={!canCrop}
            title={canCrop ? 'Crop questions' : 'Set the question count first'}
            className={`h-8 px-2.5 rounded-md text-[11px] font-medium flex items-center gap-1 transition-all active:scale-95 ${
              !canCrop
                ? 'text-muted-foreground/40 cursor-not-allowed'
                : mode === 'crop'
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Scissors className="w-3.5 h-3.5" />
            Crop
          </button>
        </div>
      </div>

      {mode === 'crop' ? (
        cropSlot
      ) : (
        <>
          {/* Row B — page range, marked from whatever page is on screen */}
          <div className="flex items-center gap-1.5">
            <Input
              type="number"
              inputMode="numeric"
              min={1}
              value={startVal}
              onChange={e => setStartVal(e.target.value)}
              onBlur={() => commitPages(startVal, endVal)}
              placeholder="from"
              aria-label="Start page"
              className="w-14 h-9 text-sm text-center font-mono px-1"
            />
            <Button
              variant="outline"
              size="sm"
              className="h-9 px-2 gap-1 shrink-0"
              disabled={currentPage == null}
              onClick={markStart}
            >
              <LocateFixed className="w-3.5 h-3.5" />
              <span className="text-xs">From</span>
            </Button>
            <span className="text-muted-foreground text-xs">–</span>
            <Input
              type="number"
              inputMode="numeric"
              min={1}
              value={endVal}
              onChange={e => setEndVal(e.target.value)}
              onBlur={() => commitPages(startVal, endVal)}
              placeholder="to"
              aria-label="End page"
              className="w-14 h-9 text-sm text-center font-mono px-1"
            />
            <Button
              variant="outline"
              size="sm"
              className="h-9 px-2 gap-1 shrink-0"
              disabled={currentPage == null}
              onClick={markEnd}
            >
              <LocateFixed className="w-3.5 h-3.5" />
              <span className="text-xs">To</span>
            </Button>
          </div>

          {/* Row C — question count, sub-parts, theory */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setCountOpen(true)}
              className="flex-1 h-9 px-3 rounded-lg bg-muted text-left text-xs font-medium text-foreground hover:bg-muted/70 transition-colors truncate"
            >
              {exercise.questionCount > 0
                ? `${exercise.questionCount} question${exercise.questionCount !== 1 ? 's' : ''}`
                : 'Set questions…'}
            </button>
            <button
              onClick={() => setPartsOpen(true)}
              disabled={exercise.questionCount === 0}
              title="Sub-questions"
              className={`h-9 px-2.5 rounded-lg flex items-center gap-1 text-xs font-medium transition-all active:scale-95 shrink-0 ${
                exercise.questionCount === 0
                  ? 'bg-muted/50 text-muted-foreground/50 cursor-not-allowed'
                  : subQCount > 0
                    ? 'bg-primary/15 text-primary hover:bg-primary/25'
                    : 'bg-muted text-muted-foreground hover:bg-muted/70'
              }`}
            >
              <List className="w-3.5 h-3.5" />
              Parts
              {subQCount > 0 && (
                <span className="ml-0.5 text-[10px] font-bold rounded-full px-1 min-w-[16px] text-center bg-primary/30">
                  {subQCount}
                </span>
              )}
            </button>
            <button
              onClick={onAddTheory}
              title="Insert a theory / concept row after this exercise"
              className="h-9 px-2.5 rounded-lg flex items-center gap-1 text-xs font-medium bg-muted text-muted-foreground hover:bg-muted/70 hover:text-foreground transition-all active:scale-95 shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              Theory
            </button>
          </div>
        </>
      )}

      {/* Question-count picker */}
      <Drawer open={countOpen} onOpenChange={setCountOpen}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle className="text-sm">
              Exercise {exercise.name}: how many questions?
            </DrawerTitle>
          </DrawerHeader>
          <div className="p-4 pt-0">
            <p className="text-xs text-muted-foreground mb-2">
              Tap the last question number printed in the book.
            </p>
            <div className="grid grid-cols-6 gap-1.5">
              {Array.from({ length: COUNT_GRID_MAX }, (_, i) => i + 1).map(n => (
                <button
                  key={n}
                  onClick={() => {
                    setCountOpen(false);
                    if (n !== exercise.questionCount) void onSaveCount(n);
                  }}
                  className={`h-10 rounded-lg text-sm font-medium transition-all active:scale-95 ${
                    n === exercise.questionCount
                      ? 'bg-emerald-500 text-white'
                      : 'bg-muted hover:bg-primary/10 hover:text-primary text-foreground'
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
        </DrawerContent>
      </Drawer>

      {/* Sub-parts editor — the existing inline editor, hosted in a drawer */}
      <Drawer open={partsOpen} onOpenChange={setPartsOpen}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle className="text-sm">
              Exercise {exercise.name}: sub-questions
            </DrawerTitle>
          </DrawerHeader>
          <div className="p-4 pt-0 max-h-[65vh] overflow-y-auto">
            {exercise.questionCount > 0 && (
              <SubQuestionInline
                questionCount={exercise.questionCount}
                subQuestions={exercise.subQuestions ?? null}
                onSave={onSaveSubQ}
              />
            )}
          </div>
        </DrawerContent>
      </Drawer>
    </div>
  );
}
