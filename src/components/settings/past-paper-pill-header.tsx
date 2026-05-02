'use client';

import { useRef } from 'react';
import type { Id } from '@/lib/convex';

interface Props {
  questionNumber: string;
  onChangeQuestionNumber: (v: string) => void;
  selectedCropId: Id<'questionBank'> | null;
  existingNumbers: string[];
  onPickNumber: (n: string) => void;
  onCancelSelection: () => void;
}

// Sticky header for the past-paper crop route. Unlike CropPillHeader (which
// shows pre-declared exercise/question keys), this header uses a free-text
// input because past papers have no structured exercise list. The user types
// a question number ("1.a", "3", "Section B Q2") then draws the crop.
//
// Below the input, chips show already-cropped question numbers for this
// paper so the user can tap to re-select or re-key an existing crop.
export function PastPaperPillHeader({
  questionNumber,
  onChangeQuestionNumber,
  selectedCropId,
  existingNumbers,
  onPickNumber,
  onCancelSelection,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="max-w-lg mx-auto px-3 pb-2.5 space-y-1.5">
      {/* Question number input */}
      <div className="flex items-center gap-2">
        <label className="text-[11px] text-muted-foreground shrink-0">Q no.</label>
        <input
          ref={inputRef}
          type="text"
          value={questionNumber}
          onChange={(e) => onChangeQuestionNumber(e.target.value)}
          placeholder='e.g. "1.a" or "3"'
          className="flex-1 h-8 px-2.5 rounded-lg bg-muted text-sm font-mono text-foreground border border-transparent focus:border-primary/50 focus:bg-background outline-none transition-colors placeholder:text-muted-foreground/50"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
        />
        {selectedCropId && (
          <button
            onClick={() => { onCancelSelection(); }}
            className="h-8 px-2.5 rounded-lg bg-sky-500/20 text-sky-500 text-xs font-medium hover:bg-sky-500/30 transition-colors shrink-0"
          >
            Cancel re-key
          </button>
        )}
      </div>

      {/* Chips: already-cropped question numbers */}
      {existingNumbers.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {existingNumbers.map((n) => {
            const isActive = n === questionNumber;
            return (
              <button
                key={n}
                onClick={() => onPickNumber(n)}
                className={`relative h-7 px-2 rounded-lg text-xs font-mono font-semibold transition-all active:scale-95 ${
                  isActive
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'bg-muted text-foreground hover:bg-muted/70'
                }`}
              >
                {n}
                {/* green dot = already has a crop */}
                <span
                  className={`absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full ${
                    isActive ? 'bg-primary-foreground/70' : 'bg-emerald-500'
                  }`}
                />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
