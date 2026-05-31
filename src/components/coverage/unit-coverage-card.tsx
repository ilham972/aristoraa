'use client';

import { RotateCw } from 'lucide-react';
import { findUnit } from '@/lib/curriculum-data';
import type { Id } from '@/lib/convex';

export type CoverageRow = {
  conceptId: Id<'exercises'>;
  conceptName: string;
  unitId: string;
  order: number;
  total: number;
  effectiveTotal: number;
  repeatBonus: number;
  byDifficulty: { 1: number; 2: number; 3: number; 4: number; 5: number; unset: number };
  bySource: { textbook: number; past_paper: number; teacher_authored: number };
  isGated: boolean;
  hasNoHardQuestions: boolean;
};

interface Props {
  unitId: string;
  rows: CoverageRow[]; // concepts in this unit (already in order)
  orphanIdsInUnit: Set<string>; // conceptId strings that are orphan
  moduleColor: string;
  onSelectConcept: (conceptId: Id<'exercises'>) => void;
}

// Color thresholds for the heat-strip dot.
function dotColorClass(total: number, isOrphan: boolean): string {
  if (isOrphan) return 'bg-zinc-500/70';
  if (total < 5) return 'bg-red-500';
  if (total < 10) return 'bg-amber-500';
  if (total < 20) return 'bg-emerald-500';
  return 'bg-emerald-700';
}

export function UnitCoverageCard({
  unitId,
  rows,
  orphanIdsInUnit,
  moduleColor,
  onSelectConcept,
}: Props) {
  const meta = findUnit(unitId);
  const unitName = meta?.unit.name ?? unitId;
  const hasContent = rows.length > 0 || orphanIdsInUnit.size > 0;

  return (
    <div
      className="rounded-xl border border-border bg-card overflow-hidden mb-2"
      style={{ borderLeftColor: moduleColor, borderLeftWidth: 3 }}
    >
      <div className="px-3 py-2 flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-foreground truncate">{unitName}</p>
        <span className="text-[10px] text-muted-foreground shrink-0">
          {rows.length} concept{rows.length === 1 ? '' : 's'}
        </span>
      </div>

      {hasContent ? (
        <div className="px-3 pb-3">
          <div className="flex flex-wrap gap-1.5">
            {rows.map((r) => {
              const isOrphan = orphanIdsInUnit.has(r.conceptId as unknown as string);
              const hasRepeats = r.repeatBonus > 0;
              // Colour + number reflect the EFFECTIVE count (gate reads this),
              // so a concept lifted over the bar by repeats no longer shows red.
              return (
                <button
                  key={r.conceptId}
                  type="button"
                  onClick={() => onSelectConcept(r.conceptId)}
                  className={`relative w-7 h-7 rounded-md ${dotColorClass(r.effectiveTotal, isOrphan)} hover:scale-110 transition-transform flex items-center justify-center`}
                  title={
                    hasRepeats
                      ? `${r.conceptName} — ${r.total} real +${r.repeatBonus} repeat = ${r.effectiveTotal} effective`
                      : `${r.conceptName} — ${r.total} q${r.total === 1 ? '' : 's'}`
                  }
                >
                  <span className="text-[10px] font-bold text-white leading-none">
                    {r.effectiveTotal}
                  </span>
                  {hasRepeats && (
                    <span className="absolute -bottom-0.5 -left-0.5 flex items-center justify-center w-3 h-3 rounded-full bg-sky-500 border border-card">
                      <RotateCw className="w-2 h-2 text-white" strokeWidth={3} />
                    </span>
                  )}
                  {r.hasNoHardQuestions && (
                    <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-amber-400 border border-card" />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <p className="px-3 pb-3 text-[11px] text-muted-foreground italic">
          No concepts defined yet.
        </p>
      )}
    </div>
  );
}
