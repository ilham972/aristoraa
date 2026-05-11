'use client';

import { useMemo, useState, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from 'convex/react';
import { Layers } from 'lucide-react';
import { api } from '@/lib/convex';
import type { Id } from '@/lib/convex';
import { CURRICULUM_MODULES, getModuleById } from '@/lib/curriculum-data';
import { MODULE_COLORS } from '@/lib/types';
import { CoverageBanner } from '@/components/coverage/coverage-banner';
import {
  UnitCoverageCard,
  type CoverageRow,
} from '@/components/coverage/unit-coverage-card';
import { ConceptDetailPanel } from '@/components/coverage/concept-detail-panel';
import { OrphanList } from '@/components/coverage/orphan-list';

const GRADES = [6, 7, 8, 9, 10, 11];
const TERMS: Array<1 | 2 | 3> = [1, 2, 3];

// Cumulative unit IDs for (grade, term): T2 view = T1+T2; T3 = T1+T2+T3.
function unitIdsCumulative(grade: number, term: number): string[] {
  const ids: string[] = [];
  for (const mod of CURRICULUM_MODULES) {
    const g = mod.grades.find((gr) => gr.grade === grade);
    if (!g) continue;
    for (const t of g.terms) {
      if (t.term <= term) {
        for (const u of t.units) ids.push(u.id);
      }
    }
  }
  return ids;
}

function CoveragePageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const gradeParam = parseInt(searchParams.get('g') ?? '7', 10);
  const termParam = parseInt(searchParams.get('t') ?? '1', 10);
  const grade = GRADES.includes(gradeParam) ? gradeParam : 7;
  const term = ([1, 2, 3] as number[]).includes(termParam) ? (termParam as 1 | 2 | 3) : 1;

  const [openConceptId, setOpenConceptId] = useState<Id<'exercises'> | null>(null);

  const unitIds = useMemo(() => unitIdsCumulative(grade, term), [grade, term]);

  const data = useQuery(api.learningEngine.coverage.coverageByGradeTerm, {
    grade,
    term,
    unitIds,
  });

  const setGrade = useCallback(
    (g: number) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set('g', String(g));
      params.set('t', String(term));
      router.replace(`/algorithm/coverage?${params.toString()}`);
    },
    [router, searchParams, term],
  );
  const setTerm = useCallback(
    (t: number) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set('g', String(grade));
      params.set('t', String(t));
      router.replace(`/algorithm/coverage?${params.toString()}`);
    },
    [router, searchParams, grade],
  );

  // Group rows by module → unitId.
  const grouped = useMemo(() => {
    if (!data) return [] as Array<{ moduleId: string; units: Array<{ unitId: string; rows: CoverageRow[] }> }>;
    const moduleMap = new Map<string, Map<string, CoverageRow[]>>();
    for (const r of data.rows) {
      const mId = r.unitId.split('-')[0];
      if (!moduleMap.has(mId)) moduleMap.set(mId, new Map());
      const um = moduleMap.get(mId)!;
      if (!um.has(r.unitId)) um.set(r.unitId, []);
      um.get(r.unitId)!.push(r);
    }
    // Sort module IDs (M1..M6) and within each module preserve unit-discovery
    // order — rows arrive in unit-collection order from the backend.
    const moduleIds = Array.from(moduleMap.keys()).sort();
    return moduleIds.map((mId) => {
      const unitsMap = moduleMap.get(mId)!;
      const units = Array.from(unitsMap.entries()).map(([unitId, rows]) => ({
        unitId,
        rows: rows.slice().sort((a, b) => a.order - b.order),
      }));
      return { moduleId: mId, units };
    });
  }, [data]);

  const orphanIdSet = useMemo(() => {
    if (!data) return new Set<string>();
    return new Set<string>(data.orphanConceptIds.map((id) => id as unknown as string));
  }, [data]);

  // Find the selected row across all rows for the detail panel.
  const selectedRow = useMemo(() => {
    if (!openConceptId || !data) return null;
    return data.rows.find((r) => r.conceptId === openConceptId) ?? null;
  }, [openConceptId, data]);

  return (
    <div className="px-4 pt-5 pb-24 max-w-lg mx-auto">
      <div className="flex items-center gap-2 mb-4">
        <Layers className="w-5 h-5 text-primary" />
        <h1 className="text-lg font-bold text-foreground">Coverage</h1>
      </div>

      {/* Grade + term selectors */}
      <div className="space-y-2 mb-4">
        <div className="flex gap-1 p-1 bg-muted rounded-xl overflow-x-auto">
          {GRADES.map((g) => (
            <button
              key={g}
              onClick={() => setGrade(g)}
              className={`flex-1 py-2 px-3 rounded-lg text-xs font-semibold transition-all whitespace-nowrap ${
                g === grade
                  ? 'bg-card text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              G{g}
            </button>
          ))}
        </div>
        <div className="flex gap-1 p-1 bg-muted rounded-xl">
          {TERMS.map((t) => (
            <button
              key={t}
              onClick={() => setTerm(t)}
              className={`flex-1 py-2 px-3 rounded-lg text-xs font-semibold transition-all ${
                t === term
                  ? 'bg-card text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Term {t}
              {t > 1 && (
                <span className="ml-1 text-[10px] text-muted-foreground/70 font-normal">
                  (+T1{t === 3 ? '+T2' : ''})
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {data === undefined && (
        <div className="space-y-2 animate-pulse">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 bg-muted rounded-xl" />
          ))}
        </div>
      )}

      {data === null && (
        <div className="rounded-xl border border-border bg-card p-4 text-center">
          <p className="text-sm text-muted-foreground">Sign in required.</p>
        </div>
      )}

      {data && data.rows.length === 0 && data.orphanConceptIds.length === 0 && (
        <div className="rounded-xl border border-border bg-card p-6 text-center">
          <p className="text-sm text-muted-foreground">
            No concepts defined for G{grade} Term {term}.
          </p>
          <p className="text-[11px] text-muted-foreground mt-1">
            Add concept rows in Settings → Data Entry → Concepts.
          </p>
        </div>
      )}

      {data && (data.rows.length > 0 || data.orphanConceptIds.length > 0) && (
        <>
          <CoverageBanner
            grade={grade}
            term={term}
            threshold={data.threshold}
            gatedCount={data.gatedCount}
            orphanCount={data.orphanCount}
            noHardCount={data.noHardCount}
            isPhaseDBlocked={data.isPhaseDBlocked}
          />

          {/* Legend */}
          <div className="flex flex-wrap items-center gap-2 mb-3 text-[10px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-sm bg-red-500" /> &lt;5
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-sm bg-amber-500" /> 5–9
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500" /> 10–19
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-sm bg-emerald-700" /> 20+
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-sm bg-zinc-500/70" /> orphan
            </span>
          </div>

          {grouped.map(({ moduleId, units }) => {
            const mod = getModuleById(moduleId);
            const color = MODULE_COLORS[moduleId] ?? '#0D9488';
            return (
              <section key={moduleId} className="mb-5">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-1 h-4 rounded-full" style={{ backgroundColor: color }} />
                  <h2 className="text-xs font-bold text-foreground uppercase tracking-wide">
                    {moduleId} · {mod?.name ?? ''}
                  </h2>
                </div>
                {units.map(({ unitId, rows }) => (
                  <UnitCoverageCard
                    key={unitId}
                    unitId={unitId}
                    rows={rows}
                    orphanIdsInUnit={orphanIdSet}
                    moduleColor={color}
                    onSelectConcept={setOpenConceptId}
                  />
                ))}
              </section>
            );
          })}

          <OrphanList
            orphanIds={data.orphanConceptIds as Id<'exercises'>[]}
            duplicateOrderWarnings={data.duplicateOrderWarnings}
          />
        </>
      )}

      <ConceptDetailPanel
        row={selectedRow}
        threshold={data?.threshold ?? 5}
        onClose={() => setOpenConceptId(null)}
      />
    </div>
  );
}

export default function CoveragePage() {
  return (
    <Suspense fallback={<div className="px-4 pt-5 max-w-lg mx-auto text-sm text-muted-foreground">Loading…</div>}>
      <CoveragePageInner />
    </Suspense>
  );
}
