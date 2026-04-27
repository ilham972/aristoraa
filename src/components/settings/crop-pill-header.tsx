'use client';

import { useMemo } from 'react';
import { X } from 'lucide-react';
import { parseCropKey } from '@/lib/crop-keys';
import { getSubLabel, type SubQuestionsMap } from '@/lib/sub-questions';
import type { Id } from '@/lib/convex';

type Exercise = {
  _id: Id<'exercises'>;
  questionCount: number;
  subQuestions?: SubQuestionsMap;
};

interface Props {
  exercise: Exercise;
  currentKey: string | null;
  selectedCropId: Id<'questionBank'> | null;
  existingKeys: string[];
  onPickKey: (key: string) => void;
  onCancelSelection: () => void;
}

// Two-row picker shown above the crop body. Row 1 = main-Q numbers,
// Row 2 = sub-letters of the currently-selected main-Q (or just "Stem").
// Bigger touch targets, current target highlighted, existing-cropped keys
// shown with a small dot so the user knows what's already done.
export function CropPillHeader({
  exercise,
  currentKey,
  selectedCropId,
  existingKeys,
  onPickKey,
  onCancelSelection,
}: Props) {
  const parsed = currentKey ? parseCropKey(currentKey) : null;
  const activeMainQ = parsed?.mainQ ?? 0;
  const subDef = exercise.subQuestions?.[String(activeMainQ)];
  const hasSubs = !!subDef && subDef.count > 1;
  const existingSet = useMemo(() => new Set(existingKeys), [existingKeys]);

  const mainBtn = (q: number) => {
    const isActive = activeMainQ === q;
    const stemKey = String(q);
    const stemDone = existingSet.has(stemKey);
    return (
      <button
        key={q}
        onClick={() => onPickKey(stemKey)}
        className={`relative h-9 min-w-[36px] px-2 rounded-lg text-sm font-mono font-bold transition-all active:scale-95 ${
          isActive
            ? 'bg-primary text-primary-foreground shadow-sm'
            : 'bg-muted text-foreground hover:bg-muted/70'
        }`}
      >
        {q}
        {stemDone && (
          <span
            className={`absolute top-1 right-1 w-1.5 h-1.5 rounded-full ${
              isActive ? 'bg-primary-foreground/70' : 'bg-emerald-500'
            }`}
          />
        )}
      </button>
    );
  };

  const subBtn = (label: string, key: string) => {
    const isActive = currentKey === key;
    const done = existingSet.has(key);
    return (
      <button
        key={key}
        onClick={() => onPickKey(key)}
        className={`relative h-8 min-w-[34px] px-2 rounded-lg text-xs font-mono font-semibold transition-all active:scale-95 ${
          isActive
            ? 'bg-primary text-primary-foreground shadow-sm'
            : 'bg-muted text-foreground hover:bg-muted/70'
        }`}
      >
        {label}
        {done && (
          <span
            className={`absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full ${
              isActive ? 'bg-primary-foreground/70' : 'bg-emerald-500'
            }`}
          />
        )}
      </button>
    );
  };

  const stemKey = String(activeMainQ);
  const stemActive = currentKey === stemKey;
  const stemDone = existingSet.has(stemKey);

  return (
    <div className="max-w-lg mx-auto px-3 pb-2.5 space-y-1.5">
      {/* Status strip — what the next draw will create / re-key */}
      <div
        className={`flex items-center gap-2 text-[11px] rounded-md px-2 py-1 ${
          selectedCropId
            ? 'bg-sky-500/15 text-sky-400 border border-sky-500/40'
            : 'bg-primary/10 text-primary border border-primary/30'
        }`}
      >
        {selectedCropId ? (
          <>
            <span className="font-medium">Re-key selected →</span>
            <span className="font-mono font-bold">
              {currentKey ?? '—'}
            </span>
            <span className="opacity-60">tap a pill to re-link</span>
            <button
              onClick={onCancelSelection}
              className="ml-auto w-5 h-5 rounded flex items-center justify-center hover:bg-sky-500/20"
              aria-label="Cancel selection"
            >
              <X className="w-3 h-3" />
            </button>
          </>
        ) : (
          <>
            <span className="font-medium">Cropping →</span>
            <span className="font-mono font-bold text-base">
              {currentKey ?? '—'}
            </span>
            <span className="opacity-60 ml-auto">drag on a page</span>
          </>
        )}
      </div>

      {/* Main-Q row */}
      <div className="flex flex-wrap gap-1">
        {Array.from({ length: exercise.questionCount }, (_, i) => i + 1).map(
          mainBtn,
        )}
      </div>

      {/* Sub-letter row (or just Stem) */}
      <div className="flex flex-wrap gap-1 items-center">
        <button
          onClick={() => onPickKey(stemKey)}
          disabled={!activeMainQ}
          className={`relative h-8 px-2.5 rounded-lg text-xs font-semibold transition-all active:scale-95 ${
            !activeMainQ
              ? 'bg-muted/40 text-muted-foreground/50 cursor-not-allowed'
              : stemActive
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'bg-muted text-foreground hover:bg-muted/70'
          }`}
        >
          {hasSubs ? 'Stem' : 'Whole'}
          {stemDone && activeMainQ > 0 && (
            <span
              className={`absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full ${
                stemActive ? 'bg-primary-foreground/70' : 'bg-emerald-500'
              }`}
            />
          )}
        </button>
        {hasSubs && (
          <>
            <span className="text-[10px] text-muted-foreground/60 mx-0.5">
              ·
            </span>
            {Array.from({ length: subDef.count }, (_, i) => {
              const label = getSubLabel(i, subDef.type);
              const key = `${activeMainQ}.${label}`;
              return subBtn(label, key);
            })}
          </>
        )}
      </div>
    </div>
  );
}
