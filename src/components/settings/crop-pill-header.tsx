'use client';

import { useMemo } from 'react';
import { parseCropKey } from '@/lib/crop-keys';
import { getSubLabel, getSubLabels, type SubQuestionsMap } from '@/lib/sub-questions';
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
  // Toggle "this sub-part has no instruction of its own" for the active
  // sub-question. `next` is the new noStem value. When omitted, the toggle
  // is hidden (e.g. read-only contexts).
  onToggleNoSubStem?: (mainQ: number, subIndex: number, next: boolean) => void;
}

// Three-row picker shown above the crop body.
//   Row 1 = main-Q numbers (1, 2, 3, …)
//   Row 2 = "Stem" + sub-letters of the active main-Q (or "Whole" if no subs)
//   Row 3 = "Sub-stem" + sub-sub letters of the active sub-Q
//           (only when that sub-Q has level-3 sub-parts)
//
// Bigger touch targets, current target highlighted, existing-cropped keys
// shown with a small dot so the user knows what's already done.
export function CropPillHeader({
  exercise,
  currentKey,
  selectedCropId,
  existingKeys,
  onPickKey,
  onCancelSelection,
  onToggleNoSubStem,
}: Props) {
  const parsed = currentKey ? parseCropKey(currentKey) : null;
  const activeMainQ = parsed?.mainQ ?? 0;
  const activeSubLabel = parsed?.subLabel ?? null;
  const subDef = exercise.subQuestions?.[String(activeMainQ)];
  const hasSubs = !!subDef && subDef.count > 1;

  // Resolve the active sub-question's INDEX (0-based) by matching the label
  // back to its position. The label is derived from index + type, so it's
  // safe — but it does mean a type-toggle on the parent would invalidate
  // a previously-active key (which is fine: the user picks a new pill).
  const activeSubIndex = useMemo(() => {
    if (!subDef || !activeSubLabel) return -1;
    const labels = getSubLabels(subDef.count, subDef.type);
    return labels.indexOf(activeSubLabel);
  }, [subDef, activeSubLabel]);

  const subSubDef =
    activeSubIndex >= 0
      ? subDef?.subSub?.[String(activeSubIndex)]
      : undefined;
  const hasSubSub = !!subSubDef && subSubDef.count > 1;
  // When set, the active sub-part has no instruction of its own — its leaves
  // borrow the main-Q stem and there is nothing to crop at the sub-stem key.
  const noSubStem = !!subSubDef?.noStem;

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

  const subSubBtn = (label: string, key: string) => {
    const isActive = currentKey === key;
    const done = existingSet.has(key);
    return (
      <button
        key={key}
        onClick={() => onPickKey(key)}
        className={`relative h-7 min-w-[30px] px-1.5 rounded-md text-[11px] font-mono font-semibold transition-all active:scale-95 ${
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

  // The "Sub-stem" key — e.g. "5.a" — is the stem for level-3 leaves.
  const subStemKey =
    activeSubIndex >= 0 && subDef
      ? `${activeMainQ}.${getSubLabel(activeSubIndex, subDef.type)}`
      : null;
  const subStemActive = subStemKey != null && currentKey === subStemKey;
  const subStemDone = subStemKey != null && existingSet.has(subStemKey);

  // Status strip removed — keep this header lean. The currently-selected
  // pill (highlighted via `currentKey`) and the sky-blue dot on a re-key
  // selection already convey the same info without an extra banner.
  void selectedCropId;
  void onCancelSelection;

  return (
    <div className="max-w-lg mx-auto px-3 pb-2.5 space-y-1.5">
      {/* Main-Q row */}
      <div className="flex flex-wrap gap-1">
        {Array.from({ length: exercise.questionCount }, (_, i) => i + 1).map(
          mainBtn,
        )}
      </div>

      {/* Sub-letter row (or just Stem / Whole) */}
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
            <span className="text-[10px] text-muted-foreground/60 mx-0.5">·</span>
            {Array.from({ length: subDef!.count }, (_, i) => {
              const label = getSubLabel(i, subDef!.type);
              const key = `${activeMainQ}.${label}`;
              return subBtn(label, key);
            })}
          </>
        )}
      </div>

      {/* Sub-sub row — only when the active sub-question has level-3 leaves.
          Shown below the sub row so the parent/child relationship is clear.
          The "Sub-stem" pill captures the intermediate stem (e.g. "5.a"); the
          rest are leaves (e.g. "5.a.i", "5.a.ii"). */}
      {hasSubSub && subStemKey && (
        <div className="flex flex-wrap gap-1 items-center pl-4 border-l-2 border-primary/20 ml-1">
          {noSubStem ? (
            // No own instruction — the leaves borrow Q{main}'s stem.
            <span className="h-7 px-2 rounded-md text-[11px] font-medium flex items-center text-muted-foreground bg-muted/40 italic">
              borrows Q{activeMainQ} stem
            </span>
          ) : (
            <button
              onClick={() => onPickKey(subStemKey)}
              className={`relative h-7 px-2 rounded-md text-[11px] font-semibold transition-all active:scale-95 ${
                subStemActive
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'bg-muted text-foreground hover:bg-muted/70'
              }`}
            >
              Sub-stem
              {subStemDone && (
                <span
                  className={`absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full ${
                    subStemActive ? 'bg-primary-foreground/70' : 'bg-emerald-500'
                  }`}
                />
              )}
            </button>
          )}
          {/* "No sub-stem" toggle — declares the active sub-part has no
              instruction of its own. */}
          {onToggleNoSubStem && activeSubIndex >= 0 && (
            <button
              onClick={() =>
                onToggleNoSubStem(activeMainQ, activeSubIndex, !noSubStem)
              }
              title="This sub-part has no instruction of its own — its parts borrow the main question's stem"
              className={`h-7 px-2 rounded-md text-[11px] font-semibold transition-all active:scale-95 border ${
                noSubStem
                  ? 'bg-amber-500/15 text-amber-600 border-amber-500/40'
                  : 'bg-transparent text-muted-foreground border-border hover:bg-muted/60'
              }`}
            >
              No sub-stem
            </button>
          )}
          <span className="text-[10px] text-muted-foreground/60 mx-0.5">·</span>
          {Array.from({ length: subSubDef!.count }, (_, i) => {
            const label = getSubLabel(i, subSubDef!.type);
            const key = `${subStemKey}.${label}`;
            return subSubBtn(label, key);
          })}
        </div>
      )}
    </div>
  );
}
