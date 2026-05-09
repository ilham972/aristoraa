'use client';

// 5-pill segmented control for difficulty 1..5.
// Color ramp: green (easy) → red (hard). Optional `unset` rendering when
// `value === undefined` (used by the bulk-rating tab to flag unrated crops).

interface Props {
  value: number | undefined;
  onChange: (n: number) => void;
  disabled?: boolean;
  size?: 'sm' | 'md';
}

const DIFFICULTY_COLORS: Record<number, { bg: string; text: string; ring: string }> = {
  1: { bg: '#1E8449', text: '#FFFFFF', ring: '#1E8449' }, // green
  2: { bg: '#7CB342', text: '#FFFFFF', ring: '#7CB342' }, // light green
  3: { bg: '#B9770E', text: '#FFFFFF', ring: '#B9770E' }, // amber
  4: { bg: '#E67E22', text: '#FFFFFF', ring: '#E67E22' }, // orange
  5: { bg: '#C0392B', text: '#FFFFFF', ring: '#C0392B' }, // red
};

export function DifficultyPicker({ value, onChange, disabled, size = 'md' }: Props) {
  const dim = size === 'sm' ? 'h-7 w-7 text-[11px]' : 'h-8 w-8 text-xs';
  return (
    <div
      className={`inline-flex items-center gap-1 ${
        disabled ? 'opacity-50 pointer-events-none' : ''
      }`}
      role="radiogroup"
      aria-label="Difficulty"
    >
      {[1, 2, 3, 4, 5].map((n) => {
        const active = value === n;
        const c = DIFFICULTY_COLORS[n];
        return (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(n)}
            disabled={disabled}
            className={`${dim} rounded-md font-mono font-semibold transition-all active:scale-95 border`}
            style={
              active
                ? {
                    backgroundColor: c.bg,
                    color: c.text,
                    borderColor: c.ring,
                  }
                : {
                    backgroundColor: 'transparent',
                    color: c.bg,
                    borderColor: `${c.bg}55`,
                  }
            }
          >
            {n}
          </button>
        );
      })}
    </div>
  );
}
