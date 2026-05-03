'use client';

import { useEffect, useMemo, useState } from 'react';
import { Search, Check } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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

  // Reset draft ONLY when dialog opens (not when selectedUnitIds changes while open)
  // This prevents selections from being cleared if the parent query refetches
  useEffect(() => {
    if (open) {
      setDraft(new Set(selectedUnitIds));
    }
  }, [open]); // Deliberately exclude selectedUnitIds from dependencies

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
  }, [allUnits, search]);

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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md mx-auto max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Linked units</DialogTitle>
        </DialogHeader>
        <div className="relative mb-2">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search units across modules / grades / terms..."
            className="pl-8 h-9 text-sm"
            autoFocus
          />
        </div>
        <div className="flex-1 overflow-y-auto rounded-lg border border-border/60 divide-y divide-border/50">
          {filtered.length === 0 ? (
            <p className="text-xs text-muted-foreground p-4 text-center">No units match.</p>
          ) : (
            filtered.slice(0, 200).map((u) => {
              const selected = draft.has(u.unitId);
              return (
                <button
                  key={u.unitId}
                  onClick={() => toggle(u.unitId)}
                  className={`w-full flex items-center gap-2 px-2.5 py-2 text-left transition-colors ${
                    selected ? 'bg-primary/10' : 'hover:bg-muted/60'
                  }`}
                >
                  <span
                    className="font-mono text-[9px] font-bold rounded px-1 py-0.5 shrink-0"
                    style={{
                      backgroundColor: `${MODULE_COLORS[u.moduleId]}22`,
                      color: MODULE_COLORS[u.moduleId],
                    }}
                  >
                    {u.moduleId}·G{u.grade}·T{u.term}
                  </span>
                  <span className="text-xs flex-1 truncate">{u.name}</span>
                  {selected && <Check className="w-3.5 h-3.5 text-primary shrink-0" />}
                </button>
              );
            })
          )}
        </div>
        <div className="flex gap-2 pt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="flex-1" disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} className="flex-1" disabled={saving}>
            Save{' '}
            {draft.size > 0 && (
              <Badge variant="secondary" className="ml-1.5 text-[9px] px-1">
                {draft.size}
              </Badge>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
