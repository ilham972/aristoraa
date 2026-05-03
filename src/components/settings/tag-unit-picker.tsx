'use client';

import { useEffect, useMemo, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Search, Check, X } from 'lucide-react';
import { CURRICULUM_MODULES } from '@/lib/curriculum-data';
import { MODULE_COLORS } from '@/lib/types';

export type UnitSelection = {
  unitId: string;
  grade: number;
  term: number;
  moduleId: string;
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedUnitIds: string[];
  onSave: (units: UnitSelection[]) => Promise<void>;
}

type UnitRow = UnitSelection & { name: string };

export function TagUnitPicker({ open, onOpenChange, selectedUnitIds, onSave }: Props) {
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState<Set<string>>(() => new Set(selectedUnitIds));
  const [saving, setSaving] = useState(false);
  const [moduleFilter, setModuleFilter] = useState<string>('all');
  const panelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Reset draft and search when picker opens
  useEffect(() => {
    if (open) {
      setDraft(new Set(selectedUnitIds));
      setSearch('');
      setModuleFilter('all');
      // Focus search after animation
      setTimeout(() => searchRef.current?.focus(), 50);
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onOpenChange(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onOpenChange]);

  // Prevent body scroll when open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  const allUnits = useMemo<UnitRow[]>(() => {
    const out: UnitRow[] = [];
    for (const mod of CURRICULUM_MODULES) {
      for (const grade of mod.grades) {
        for (const term of grade.terms) {
          for (const unit of term.units) {
            out.push({
              unitId: unit.id,
              grade: grade.grade,
              term: term.term,
              moduleId: mod.id,
              name: unit.name,
            });
          }
        }
      }
    }
    return out;
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allUnits
      .filter((u) => {
        if (moduleFilter !== 'all' && u.moduleId !== moduleFilter) return false;
        if (!q) return true;
        if (u.name.toLowerCase().includes(q)) return true;
        if (u.moduleId.toLowerCase().includes(q)) return true;
        if (`g${u.grade}`.includes(q)) return true;
        if (`t${u.term}`.includes(q)) return true;
        return false;
      })
      .sort((a, b) => {
        if (a.moduleId !== b.moduleId) return a.moduleId.localeCompare(b.moduleId);
        if (a.grade !== b.grade) return a.grade - b.grade;
        if (a.term !== b.term) return a.term - b.term;
        return a.name.localeCompare(b.name);
      });
  }, [allUnits, search, moduleFilter]);

  const toggle = (unitId: string) => {
    setDraft((prev) => {
      const next = new Set(prev);
      if (next.has(unitId)) next.delete(unitId);
      else next.add(unitId);
      return next;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const byId = new Map(allUnits.map((u) => [u.unitId, u]));
      const selection: UnitSelection[] = [];
      for (const id of draft) {
        const u = byId.get(id);
        if (u) selection.push({ unitId: u.unitId, grade: u.grade, term: u.term, moduleId: u.moduleId });
      }
      await onSave(selection);
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  const moduleIds = ['all', ...CURRICULUM_MODULES.map((m) => m.id)];

  if (typeof document === 'undefined') return null;

  return createPortal(
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 bg-black/50 backdrop-blur-sm transition-opacity duration-200 ${
          open ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        style={{ zIndex: 9998 }}
        onClick={() => onOpenChange(false)}
      />

      {/* Panel – slides up from bottom, fully independent of the drawer */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Link curriculum units"
        className={`fixed inset-x-0 bottom-0 flex flex-col bg-background rounded-t-2xl shadow-2xl transition-transform duration-300 ease-out ${
          open ? 'translate-y-0' : 'translate-y-full pointer-events-none'
        }`}
        style={{ zIndex: 9999, maxHeight: '92dvh' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Drag handle */}
        <div className="flex justify-center pt-3 pb-1 shrink-0">
          <div className="w-10 h-1 rounded-full bg-muted-foreground/30" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-4 pb-3 shrink-0">
          <div>
            <h2 className="text-base font-semibold text-foreground">Link curriculum units</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {draft.size > 0 ? `${draft.size} unit${draft.size !== 1 ? 's' : ''} selected` : 'Tap to select units for this tag'}
            </p>
          </div>
          <button
            onClick={() => onOpenChange(false)}
            className="w-8 h-8 rounded-full flex items-center justify-center bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground transition-colors"
            type="button"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Module filter tabs */}
        <div className="flex gap-1 px-4 pb-2 overflow-x-auto no-scrollbar shrink-0">
          {moduleIds.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setModuleFilter(m)}
              className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                moduleFilter === m
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'bg-muted text-muted-foreground hover:text-foreground'
              }`}
              style={
                moduleFilter === m && m !== 'all'
                  ? { backgroundColor: MODULE_COLORS[m], color: '#fff' }
                  : undefined
              }
            >
              {m === 'all' ? 'All' : m}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="relative mx-4 mb-3 shrink-0">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            ref={searchRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, module, grade or term…"
            className="w-full h-10 pl-9 pr-4 rounded-xl bg-muted border border-border/60 text-sm outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-all"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-muted-foreground/20 flex items-center justify-center hover:bg-muted-foreground/30 transition-colors"
            >
              <X className="w-3 h-3 text-muted-foreground" />
            </button>
          )}
        </div>

        {/* Unit list – this is the only scrollable section */}
        <div
          className="flex-1 overflow-y-auto overscroll-contain px-4 space-y-0.5 min-h-0"
          style={{ WebkitOverflowScrolling: 'touch' }}
        >
          {filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No units match.</p>
          ) : (
            filtered.slice(0, 300).map((u) => {
              const selected = draft.has(u.unitId);
              return (
                <button
                  key={u.unitId}
                  type="button"
                  onClick={() => toggle(u.unitId)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-all active:scale-[0.98] ${
                    selected
                      ? 'bg-primary/10 ring-1 ring-primary/30'
                      : 'hover:bg-muted/60'
                  }`}
                >
                  {/* Checkbox */}
                  <div
                    className={`w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 transition-all ${
                      selected
                        ? 'bg-primary border-primary'
                        : 'border-border bg-transparent'
                    }`}
                  >
                    {selected && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
                  </div>

                  {/* Module badge */}
                  <span
                    className="font-mono text-[9px] font-bold rounded px-1.5 py-0.5 shrink-0"
                    style={{
                      backgroundColor: `${MODULE_COLORS[u.moduleId]}22`,
                      color: MODULE_COLORS[u.moduleId],
                    }}
                  >
                    {u.moduleId}·G{u.grade}·T{u.term}
                  </span>

                  {/* Name */}
                  <span className="text-sm flex-1 truncate text-foreground">{u.name}</span>
                </button>
              );
            })
          )}
          <div className="h-4" />
        </div>

        {/* Footer actions */}
        <div className="shrink-0 px-4 py-4 flex gap-3 border-t border-border/60 bg-background">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={saving}
            className="flex-1 h-11 rounded-xl border border-border text-sm font-medium text-foreground hover:bg-muted transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="flex-1 h-11 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {saving ? (
              <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
            ) : null}
            Save
            {draft.size > 0 && (
              <span className="bg-primary-foreground/20 text-primary-foreground text-xs font-bold rounded-full px-2 py-0.5">
                {draft.size}
              </span>
            )}
          </button>
        </div>
      </div>
    </>,
    document.body
  );
}
