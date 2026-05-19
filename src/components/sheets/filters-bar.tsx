'use client';

// Top filters bar for /sheets. Date + slot + search + filter popover.
// Sticky-positioned by the parent. Filter state is owned by the parent —
// this component is pure UI.

import { useState } from 'react';
import {
  Calendar as CalendarIcon,
  Users,
  Search,
  Filter as FilterIcon,
  X,
  AlertTriangle,
} from 'lucide-react';
import type { Id } from '@/lib/convex';

export const GRADE_OPTIONS = [6, 7, 8, 9, 10, 11] as const;

export const STATUS_OPTIONS: Array<{ id: SheetRowStatus; label: string }> = [
  { id: 'off-day',        label: 'Off day' },
  { id: 'no-sheet',       label: 'No draft' },
  { id: 'draft-no-pdf',   label: 'Draft' },
  { id: 'draft-with-pdf', label: 'PDF ready' },
  { id: 'printed',        label: 'Printed' },
  { id: 'completed',      label: 'Done' },
];

export type SheetRowStatus =
  | 'off-day'
  | 'no-sheet'
  | 'draft-no-pdf'
  | 'draft-with-pdf'
  | 'printed'
  | 'completed';

export type SheetFilters = {
  grades: number[];           // empty = all
  statuses: SheetRowStatus[]; // empty = all
  alertsOnly: boolean;
};

export const EMPTY_FILTERS: SheetFilters = {
  grades: [],
  statuses: [],
  alertsOnly: false,
};

export function activeFilterCount(f: SheetFilters): number {
  return (
    (f.grades.length > 0 ? 1 : 0) +
    (f.statuses.length > 0 ? 1 : 0) +
    (f.alertsOnly ? 1 : 0)
  );
}

function todayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function tomorrowYmd(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function FiltersBar({
  dateStr,
  setDateStr,
  slotId,
  setSlotId,
  slotsForDay,
  search,
  setSearch,
  filters,
  setFilters,
}: {
  dateStr: string;
  setDateStr: (s: string) => void;
  slotId: Id<'scheduleSlots'> | null;
  setSlotId: (id: Id<'scheduleSlots'> | null) => void;
  slotsForDay: Array<{
    _id: Id<'scheduleSlots'>;
    startTime: string;
    endTime: string;
  }>;
  search: string;
  setSearch: (s: string) => void;
  filters: SheetFilters;
  setFilters: (next: SheetFilters) => void;
}) {
  const today = todayYmd();
  const tomorrow = tomorrowYmd();
  const [popoverOpen, setPopoverOpen] = useState(false);
  const fCount = activeFilterCount(filters);

  return (
    <section className="rounded-xl border border-border bg-card p-3 space-y-3">
      {/* Date row */}
      <div>
        <div className="flex items-center gap-2 mb-1.5">
          <CalendarIcon className="w-3.5 h-3.5 text-muted-foreground" />
          <label className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">
            Date
          </label>
        </div>
        <div className="flex gap-1 mb-2">
          <button
            onClick={() => setDateStr(today)}
            className={`flex-1 px-2 py-1.5 rounded-md text-[11px] font-semibold transition-colors ${
              dateStr === today
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:text-foreground'
            }`}
          >
            Today
          </button>
          <button
            onClick={() => setDateStr(tomorrow)}
            className={`flex-1 px-2 py-1.5 rounded-md text-[11px] font-semibold transition-colors ${
              dateStr === tomorrow
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:text-foreground'
            }`}
          >
            Tomorrow
          </button>
        </div>
        <input
          type="date"
          value={dateStr}
          onChange={(e) => setDateStr(e.target.value)}
          className="w-full px-2 py-1.5 rounded-md bg-muted text-sm text-foreground border border-border outline-none focus:border-primary"
        />
      </div>

      {/* Slot row */}
      <div>
        <div className="flex items-center gap-2 mb-1.5">
          <Users className="w-3.5 h-3.5 text-muted-foreground" />
          <label className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">
            Slot
          </label>
        </div>
        <select
          value={(slotId as unknown as string) ?? ''}
          onChange={(e) =>
            setSlotId((e.target.value || null) as Id<'scheduleSlots'> | null)
          }
          className="w-full px-2 py-1.5 rounded-md bg-muted text-sm text-foreground border border-border outline-none focus:border-primary"
        >
          <option value="">
            {slotsForDay.length === 0 ? 'No slots this weekday' : 'Pick a slot…'}
          </option>
          {slotsForDay.map((s) => (
            <option key={s._id as unknown as string} value={s._id as unknown as string}>
              {s.startTime}–{s.endTime}
            </option>
          ))}
        </select>
      </div>

      {/* Search + Filter button */}
      <div>
        <div className="flex items-center gap-2 mb-1.5">
          <Search className="w-3.5 h-3.5 text-muted-foreground" />
          <label className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">
            Search &amp; filter
          </label>
        </div>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search students…"
              className="w-full pl-8 pr-7 py-1.5 rounded-md bg-muted text-sm text-foreground border border-border outline-none focus:border-primary"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-muted-foreground/20"
                aria-label="Clear search"
              >
                <X className="w-3 h-3 text-muted-foreground" />
              </button>
            )}
          </div>
          <button
            onClick={() => setPopoverOpen((v) => !v)}
            className={`relative shrink-0 inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border text-[11px] font-semibold transition-colors ${
              fCount > 0 || popoverOpen
                ? 'bg-primary/10 border-primary/40 text-primary'
                : 'bg-muted border-border text-muted-foreground hover:text-foreground'
            }`}
          >
            <FilterIcon className="w-3.5 h-3.5" />
            Filter
            {fCount > 0 && (
              <span className="ml-0.5 px-1 rounded-full bg-primary text-primary-foreground text-[9px] font-bold">
                {fCount}
              </span>
            )}
          </button>
        </div>
      </div>

      {popoverOpen && (
        <FilterPopover
          filters={filters}
          setFilters={setFilters}
          onClose={() => setPopoverOpen(false)}
        />
      )}
    </section>
  );
}

function FilterPopover({
  filters,
  setFilters,
  onClose,
}: {
  filters: SheetFilters;
  setFilters: (next: SheetFilters) => void;
  onClose: () => void;
}) {
  const toggleGrade = (g: number) => {
    const next = filters.grades.includes(g)
      ? filters.grades.filter((x) => x !== g)
      : [...filters.grades, g].sort();
    setFilters({ ...filters, grades: next });
  };
  const toggleStatus = (s: SheetRowStatus) => {
    const next = filters.statuses.includes(s)
      ? filters.statuses.filter((x) => x !== s)
      : [...filters.statuses, s];
    setFilters({ ...filters, statuses: next });
  };
  const hasAny = activeFilterCount(filters) > 0;

  return (
    <div className="rounded-lg border border-border bg-muted/40 p-3 space-y-3">
      <div>
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-1.5">
          Grade
        </div>
        <div className="flex flex-wrap gap-1">
          {GRADE_OPTIONS.map((g) => {
            const on = filters.grades.includes(g);
            return (
              <button
                key={g}
                onClick={() => toggleGrade(g)}
                className={`px-2 py-1 rounded-md text-[11px] font-semibold border transition-colors ${
                  on
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-card border-border text-muted-foreground hover:text-foreground'
                }`}
              >
                G{g}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-1.5">
          Status
        </div>
        <div className="flex flex-wrap gap-1">
          {STATUS_OPTIONS.map((opt) => {
            const on = filters.statuses.includes(opt.id);
            return (
              <button
                key={opt.id}
                onClick={() => toggleStatus(opt.id)}
                className={`px-2 py-1 rounded-md text-[11px] font-semibold border transition-colors ${
                  on
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-card border-border text-muted-foreground hover:text-foreground'
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>

      <button
        onClick={() =>
          setFilters({ ...filters, alertsOnly: !filters.alertsOnly })
        }
        className={`w-full inline-flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-md text-[11px] font-semibold border transition-colors ${
          filters.alertsOnly
            ? 'bg-amber-500/10 border-amber-500/40 text-amber-700 dark:text-amber-400'
            : 'bg-card border-border text-muted-foreground hover:text-foreground'
        }`}
      >
        <span className="inline-flex items-center gap-1.5">
          <AlertTriangle className="w-3 h-3" />
          Only rows with prereq alerts
        </span>
        <span className="text-[10px]">{filters.alertsOnly ? 'On' : 'Off'}</span>
      </button>

      <div className="flex gap-2">
        <button
          onClick={() => setFilters(EMPTY_FILTERS)}
          disabled={!hasAny}
          className="flex-1 px-2.5 py-1.5 rounded-md text-[11px] font-semibold border border-border bg-card text-foreground hover:bg-muted disabled:opacity-40"
        >
          Clear
        </button>
        <button
          onClick={onClose}
          className="flex-1 px-2.5 py-1.5 rounded-md text-[11px] font-semibold bg-primary text-primary-foreground hover:bg-primary/90"
        >
          Done
        </button>
      </div>
    </div>
  );
}
