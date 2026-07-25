// Shared verdict chip styling for every planner surface (term board, group
// plan page, forecast). One source so "won't finish" is the same red
// everywhere.

export type VerdictChip = { label: string; className: string };

export const VERDICT_CHIP: Record<string, VerdictChip> = {
  done: {
    label: 'done',
    className: 'bg-primary/15 text-primary border-primary/40',
  },
  'on-track': {
    label: 'on track',
    className: 'bg-emerald-500/15 text-emerald-500 border-emerald-500/40',
  },
  'at-risk': {
    label: 'at risk',
    className: 'bg-amber-500/15 text-amber-500 border-amber-500/40',
  },
  'wont-finish': {
    label: "won't finish",
    className: 'bg-red-500/15 text-red-500 border-red-500/40',
  },
  'no-exam': {
    label: 'no exam date',
    className: 'bg-muted/40 text-muted-foreground border-border',
  },
  'after-horizon': {
    label: 'beyond horizon',
    className: 'bg-amber-500/15 text-amber-500 border-amber-500/40',
  },
  'no-questions': {
    label: 'no questions',
    className: 'bg-muted/40 text-amber-500 border-amber-500/30',
  },
};

// Solid dot colors for the compact unit runway strip.
export const VERDICT_DOT: Record<string, string> = {
  done: 'bg-primary',
  'on-track': 'bg-emerald-500',
  'at-risk': 'bg-amber-500',
  'wont-finish': 'bg-red-500',
  'no-exam': 'bg-muted-foreground/40',
  'after-horizon': 'bg-amber-500/70',
  'no-questions': 'bg-muted-foreground/40',
};

// Plain-language reasons the planner can't build sheets — shown in toasts
// instead of raw status codes like "no-track" (founder is non-technical).
export function planStatusMessage(status: string): string {
  switch (status) {
    case 'no-members':
      return 'This group has no students yet — add members first.';
    case 'no-track':
      return 'This group has no learning track yet — assign one in the Tracks tab.';
    case 'no-sessions':
      return 'This group has no weekly sessions on the timetable yet.';
    default:
      return `Planning failed (${status}).`;
  }
}

export function fmtShortDate(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00`);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function fmtWeekdayDate(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00`);
  return d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}
