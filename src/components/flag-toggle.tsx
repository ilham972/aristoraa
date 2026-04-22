'use client';

import { Flag } from 'lucide-react';

type Props = {
  active: boolean;
  onToggle: () => void;
  className?: string;
  ariaLabel?: string;
};

// Small overlay button shown on wrong-marked questions. Correction Officer taps
// it to flag the answer as "needs Lead's explanation", which creates a pending
// doubts row surfaced on the Lead's live dashboard.
export function FlagToggle({ active, onToggle, className, ariaLabel }: Props) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      className={`absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full flex items-center justify-center transition-all active:scale-90 z-10 ring-2 ring-background ${
        active
          ? 'bg-amber-500 text-white shadow-sm'
          : 'bg-card text-muted-foreground border border-border/60'
      } ${className || ''}`}
      aria-pressed={active}
      aria-label={ariaLabel ?? (active ? 'Unflag question' : 'Flag for Lead explanation')}
      title={active ? 'Flagged for Lead' : 'Flag for Lead'}
    >
      <Flag className="w-2.5 h-2.5" strokeWidth={2.5} />
    </button>
  );
}
