'use client';

import { Scissors, Trash2, Hash, type LucideIcon } from 'lucide-react';

export type CropTool = 'crop' | 'delete';

interface Props {
  tool: CropTool;
  onChange: (t: CropTool) => void;
  disabled?: boolean;
  // When true, render a more compact icon-only variant. Used in the inline
  // header where horizontal space is tight; the zoom-view toolbar has more
  // room and shows labels.
  compact?: boolean;
  badgesInside?: boolean;
  onToggleBadgesInside?: () => void;
}

const ITEMS: Array<{
  id: CropTool;
  label: string;
  Icon: LucideIcon;
  flavour: 'primary' | 'danger';
}> = [
  { id: 'crop', label: 'Crop', Icon: Scissors, flavour: 'primary' },
  { id: 'delete', label: 'Delete', Icon: Trash2, flavour: 'danger' },
];

export function CropToolToolbar({
  tool,
  onChange,
  disabled,
  compact,
  badgesInside,
  onToggleBadgesInside,
}: Props) {
  return (
    <div className={`flex items-center gap-2 shrink-0 ${disabled ? 'opacity-50 pointer-events-none' : ''}`}>
      <div
        className="flex bg-muted rounded-lg p-0.5"
        role="tablist"
        aria-label="Crop tool"
      >
        {ITEMS.map(({ id, label, Icon, flavour }) => {
          const active = tool === id;
          const activeClass =
            flavour === 'danger'
              ? 'bg-destructive text-destructive-foreground shadow-sm'
              : 'bg-primary text-primary-foreground shadow-sm';
          return (
            <button
              key={id}
              role="tab"
              aria-selected={active}
              onClick={() => onChange(id)}
              className={`h-8 ${
                compact ? 'px-1.5' : 'px-2.5'
              } rounded-md text-[11px] font-medium flex items-center gap-1 transition-all active:scale-95 ${
                active ? activeClass : 'text-muted-foreground hover:text-foreground'
              }`}
              aria-label={label}
              title={label}
            >
              <Icon className="w-3.5 h-3.5 shrink-0" />
              {!compact && <span>{label}</span>}
            </button>
          );
        })}
      </div>

      {onToggleBadgesInside && (
        <button
          role="switch"
          aria-checked={badgesInside}
          onClick={onToggleBadgesInside}
          className={`h-8 ${
            compact ? 'px-2' : 'px-3'
          } rounded-full text-[11px] font-medium flex items-center gap-1.5 transition-all active:scale-95 border ${
            badgesInside
              ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40 hover:bg-emerald-500/30'
              : 'bg-muted text-muted-foreground border-border hover:text-foreground'
          }`}
          aria-label="Show question numbers"
          title="Show question numbers"
        >
          <Hash className="w-3.5 h-3.5 shrink-0" />
          {!compact && <span>Q#</span>}
        </button>
      )}
    </div>
  );
}
