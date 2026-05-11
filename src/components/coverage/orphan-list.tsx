'use client';

import { useRouter } from 'next/navigation';
import { useQuery } from 'convex/react';
import { Button } from '@/components/ui/button';
import { findUnit } from '@/lib/curriculum-data';
import { MODULE_COLORS } from '@/lib/types';
import { AlertTriangle, ExternalLink } from 'lucide-react';
import { api } from '@/lib/convex';
import type { Id } from '@/lib/convex';

interface Props {
  orphanIds: Id<'exercises'>[];
  duplicateOrderWarnings: Array<{
    unitId: string;
    orderValue: number;
    ids: Id<'exercises'>[];
  }>;
}

export function OrphanList({ orphanIds, duplicateOrderWarnings }: Props) {
  const router = useRouter();
  const orphans = useQuery(
    api.learningEngine.coverage.resolveOrphanConcepts,
    orphanIds.length ? { conceptIds: orphanIds } : 'skip',
  );

  if (orphanIds.length === 0 && duplicateOrderWarnings.length === 0) return null;

  // Group orphans by unit for display.
  const byUnit = new Map<string, Array<{ _id: Id<'exercises'>; name: string }>>();
  for (const c of orphans ?? []) {
    if (!byUnit.has(c.unitId)) byUnit.set(c.unitId, []);
    byUnit.get(c.unitId)!.push({ _id: c._id, name: c.name });
  }

  return (
    <div className="mt-6 space-y-4">
      {orphanIds.length > 0 && (
        <div className="rounded-xl border border-zinc-500/40 bg-zinc-500/5 p-3">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="w-4 h-4 text-zinc-400" />
            <p className="text-xs font-semibold text-foreground">
              Orphan concepts ({orphanIds.length})
            </p>
          </div>
          <p className="text-[11px] text-muted-foreground mb-3">
            These concepts appear after the last exercise in their unit, so no
            exercise inherits them. Move them above an exercise on the Details
            page to make them count.
          </p>
          <div className="space-y-2">
            {Array.from(byUnit.entries()).map(([unitId, items]) => {
              const meta = findUnit(unitId);
              const moduleId = unitId.split('-')[0];
              const moduleColor = MODULE_COLORS[moduleId] ?? '#71717a';
              return (
                <div
                  key={unitId}
                  className="rounded-lg bg-card border border-border p-2"
                  style={{ borderLeftColor: moduleColor, borderLeftWidth: 3 }}
                >
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <p className="text-[11px] font-medium text-foreground truncate">
                      {meta ? `${meta.module.id} · G${meta.grade} · ${meta.unit.name}` : unitId}
                    </p>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-[10px]"
                      onClick={() => {
                        // Prime the Settings → Data Entry → Details view on
                        // this unit so the user lands where they need to
                        // reorder rows.
                        if (typeof window !== 'undefined') {
                          window.sessionStorage.setItem('settings.activeTab', 'data-entry');
                          window.sessionStorage.setItem('dataEntry.activeLayer', 'details');
                          window.sessionStorage.setItem('dataEntry.detailUnitId', unitId);
                        }
                        router.push('/settings');
                      }}
                    >
                      Fix
                      <ExternalLink className="w-3 h-3 ml-1" />
                    </Button>
                  </div>
                  <ul className="text-[11px] text-muted-foreground space-y-0.5 ml-1">
                    {items.map((it) => (
                      <li key={it._id} className="truncate">• {it.name}</li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {duplicateOrderWarnings.length > 0 && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-3">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-4 h-4 text-amber-500" />
            <p className="text-xs font-semibold text-foreground">
              Data-entry warnings: duplicate row order
            </p>
          </div>
          <p className="text-[11px] text-muted-foreground mb-2">
            Two or more rows share an order value in the unit. Tiebreak applied,
            but consider re-ordering on the Details page.
          </p>
          <ul className="text-[11px] text-muted-foreground space-y-1">
            {duplicateOrderWarnings.map((w, i) => {
              const meta = findUnit(w.unitId);
              return (
                <li key={`${w.unitId}-${w.orderValue}-${i}`}>
                  •{' '}
                  <span className="font-medium text-foreground">
                    {meta ? meta.unit.name : w.unitId}
                  </span>{' '}
                  — order = {w.orderValue} on {w.ids.length} rows
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
