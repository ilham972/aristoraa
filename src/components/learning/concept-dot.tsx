'use client';

interface Props {
  label: string;
  bg: string;
  ring?: string;
  onClick?: () => void;
}

// Small clickable concept-mastery indicator. Keeps the tap target reasonable
// on mobile while staying compact in a flex-wrap strip. Title is the
// accessibility hover/long-press label.
export function ConceptDot({ label, bg, ring, onClick }: Props) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className={`w-5 h-5 rounded-full ${bg} ${
        ring ? `ring-2 ring-offset-1 ring-offset-card ${ring}` : ''
      } transition-shadow hover:ring-2 hover:ring-offset-1 hover:ring-offset-card hover:ring-foreground/30`}
    />
  );
}
