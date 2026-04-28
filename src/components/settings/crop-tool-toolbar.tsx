'use client';

import { Move, Scissors, Maximize2, Trash2 } from 'lucide-react';

export type CropTool = 'adjust' | 'crop' | 'resize' | 'delete';

interface Props {
  tool: CropTool;
  onChange: (t: CropTool) => void;
  disabled?: boolean;
  // When true, render a more compact icon-only variant. Used in the inline
  // header where horizontal space is tight; the zoom-view toolbar has more
  // room and shows labels.
  compact?: boolean;
}

const ITEMS: Array<{
  id: CropTool;
  label: string;
  Icon: typeof Move;
  // Visual flavour for the active state — Crop wears the primary colour,
  // Delete wears destructive, Adjust/Resize stay neutral.
  flavour: 'neutral' | 'primary' | 'danger';
}> = [
  { id: 'adjust', label: 'Adjust', Icon: Move, flavour: 'neutral' },
  { id: 'crop', label: 'Crop', Icon: Scissors, flavour: 'primary' },
  { id: 'resize', label: 'Resize', Icon: Maximize2, flavour: 'neutral' },
  { id: 'delete', label: 'Delete', Icon: Trash2, flavour: 'danger' },
];

export function CropToolToolbar({ tool, onChange, disabled, compact }: Props) {
  return (
    <div
      className={`flex bg-muted rounded-lg p-0.5 shrink-0 ${
        disabled ? 'opacity-50 pointer-events-none' : ''
      }`}
      role="tablist"
      aria-label="Crop tool"
    >
      {ITEMS.map(({ id, label, Icon, flavour }) => {
        const active = tool === id;
        const activeClass =
          flavour === 'danger'
            ? 'bg-destructive text-destructive-foreground shadow-sm'
            : flavour === 'primary'
              ? 'bg-primary text-primary-foreground shadow-sm'
              : 'bg-card text-foreground shadow-sm';
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
  );
}
