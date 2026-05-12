'use client';

// Phase B.3 — Exam blueprint dashboard.
// Per (grade, term) view of concept importance: which concepts get how much
// exam weight based on tagged past-paper marks. Lets the user trigger a
// recompute, audit the contributing papers, and flip a paper's training /
// holdout status to see the bars shift.

import { useMemo, useState, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useMutation } from 'convex/react';
import { BarChart3, RefreshCw, AlertTriangle, FileText } from 'lucide-react';
import { api } from '@/lib/convex';
import type { Id } from '@/lib/convex';
import { CURRICULUM_MODULES, getModuleById, findUnit } from '@/lib/curriculum-data';
import { MODULE_COLORS } from '@/lib/types';
import { toast } from 'sonner';

const GRADES = [6, 7, 8, 9, 10, 11];
const TERMS: Array<1 | 2 | 3> = [1, 2, 3];

// Same cumulative resolver used by the coverage page: T2 view = T1+T2;
// T3 = T1+T2+T3. The Phase B importance scope mirrors this so a Term 2 paper
// testing a Term 1 concept can light up that concept under (G, T=2).
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

type ImportanceRow = {
  _id: Id<'conceptImportance'>;
  conceptExerciseId: Id<'exercises'>;
  conceptName: string;
  unitId: string;
  importance: number;
  rawMarks: number;
};

function BlueprintPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const gradeParam = parseInt(searchParams.get('g') ?? '7', 10);
  const termParam = parseInt(searchParams.get('t') ?? '1', 10);
  const grade = GRADES.includes(gradeParam) ? gradeParam : 7;
  const term = ([1, 2, 3] as number[]).includes(termParam)
    ? (termParam as 1 | 2 | 3)
    : 1;

  const [recomputing, setRecomputing] = useState(false);

  const unitIds = useMemo(() => unitIdsCumulative(grade, term), [grade, term]);

  const data = useQuery(api.learningEngine.importance.getForGradeTerm, {
    grade,
    term,
  });
  const papers = useQuery(
    api.learningEngine.importance.trainingPapersForGradeTerm,
    { grade, term },
  );

  const recompute = useMutation(
    api.learningEngine.importance.recomputeForGradeTerm,
  );
  const updatePaper = useMutation(api.pastPapers.update);

  const setGrade = useCallback(
    (g: number) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set('g', String(g));
      params.set('t', String(term));
      router.replace(`/algorithm/blueprint?${params.toString()}`);
    },
    [router, searchParams, term],
  );
  const setTerm = useCallback(
    (t: number) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set('g', String(grade));
      params.set('t', String(t));
      router.replace(`/algorithm/blueprint?${params.toString()}`);
    },
    [router, searchParams, grade],
  );

  const onRecompute = useCallback(async () => {
    if (recomputing) return;
    setRecomputing(true);
    try {
      const res = await recompute({ grade, term, unitIds });
      toast.success(
        `Recomputed ${res.computed} concepts (${res.source}, ${res.paperCount} papers)`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Recompute failed');
    } finally {
      setRecomputing(false);
    }
  }, [recompute, grade, term, unitIds, recomputing]);

  // Group importance rows by module → unitId.
  const grouped = useMemo(() => {
    if (!data || data.rows.length === 0) {
      return [] as Array<{
        moduleId: string;
        units: Array<{ unitId: string; rows: ImportanceRow[]; unitTotal: number }>;
      }>;
    }
    const moduleMap = new Map<string, Map<string, ImportanceRow[]>>();
    for (const r of data.rows) {
      const mId = r.unitId.split('-')[0] || '?';
      if (!moduleMap.has(mId)) moduleMap.set(mId, new Map());
      const um = moduleMap.get(mId)!;
      if (!um.has(r.unitId)) um.set(r.unitId, []);
      um.get(r.unitId)!.push(r);
    }
    const moduleIds = Array.from(moduleMap.keys()).sort();
    return moduleIds.map((mId) => {
      const unitsMap = moduleMap.get(mId)!;
      const units = Array.from(unitsMap.entries()).map(([unitId, rows]) => {
        const sorted = rows
          .slice()
          .sort((a, b) => b.importance - a.importance);
        const unitTotal = sorted.reduce((s, r) => s + r.importance, 0);
        return { unitId, rows: sorted, unitTotal };
      });
      // Sort units descending by total importance so heavy units bubble up.
      units.sort((a, b) => b.unitTotal - a.unitTotal);
      return { moduleId: mId, units };
    });
  }, [data]);

  // Bias / coverage warnings derived from the training-papers list.
  const trainingList = useMemo(
    () =>
      (papers ?? []).filter((p) => p.useAsTrainingSignal && !p.isHoldout),
    [papers],
  );
  const warnings = useMemo(() => {
    const out: string[] = [];
    if (data?.source === 'prior') {
      out.push(
        'No tagged training papers contributed — falling back to a syllabus prior (each concept inherits its unit’s exercise count). Tag past-paper questions to concepts to sharpen.',
      );
    }
    if (data?.source === 'data') {
      if (trainingList.length < 3) {
        out.push(
          `Only ${trainingList.length} training paper${trainingList.length === 1 ? '' : 's'} contributing — weights are noisy until you tag ~3+ years of papers.`,
        );
      }
      const distinctSchools = new Set(
        trainingList.map((p) => p.schoolName ?? '__OWN__'),
      );
      if (
        trainingList.length >= 2 &&
        distinctSchools.size === 1 &&
        !distinctSchools.has('__OWN__')
      ) {
        const [only] = trainingList;
        out.push(
          `All training papers are from ${only.schoolName}. Add papers from other regions to cancel single-school bias.`,
        );
      }
    }
    return out;
  }, [data, trainingList]);

  // Top-N table for the "examiners weight most" panel.
  const topN = useMemo(() => {
    if (!data || data.rows.length === 0) return [] as ImportanceRow[];
    return data.rows
      .slice()
      .sort((a, b) => b.importance - a.importance)
      .slice(0, 8);
  }, [data]);

  return (
    <div className="px-4 pt-5 pb-24 max-w-lg mx-auto">
      <div className="flex items-center gap-2 mb-4">
        <BarChart3 className="w-5 h-5 text-primary" />
        <h1 className="text-lg font-bold text-foreground">Exam blueprint</h1>
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

      {/* Recompute strip */}
      <div className="rounded-xl border border-border bg-card p-3 mb-3">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[11px] text-muted-foreground uppercase tracking-wide">
              {data?.computedAt
                ? `Last computed ${formatRelative(data.computedAt)}`
                : 'Never computed'}
            </div>
            <div className="text-xs text-foreground mt-0.5">
              {data?.source === 'data' && (
                <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
                  Data &middot; {data.paperCount ?? 0} paper
                  {(data.paperCount ?? 0) === 1 ? '' : 's'}
                </span>
              )}
              {data?.source === 'prior' && (
                <span className="text-amber-600 dark:text-amber-400 font-semibold">
                  Syllabus prior
                </span>
              )}
              {data?.source == null && (
                <span className="text-muted-foreground">
                  Click recompute to seed importance for G{grade} T{term}.
                </span>
              )}
            </div>
          </div>
          <button
            onClick={onRecompute}
            disabled={recomputing}
            className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-semibold disabled:opacity-50"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${recomputing ? 'animate-spin' : ''}`}
            />
            {recomputing ? 'Computing…' : 'Recompute'}
          </button>
        </div>
      </div>

      {/* Warnings */}
      {warnings.length > 0 && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 mb-3 space-y-1.5">
          {warnings.map((w, i) => (
            <div key={i} className="flex items-start gap-2 text-[11px] text-foreground">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
              <span>{w}</span>
            </div>
          ))}
        </div>
      )}

      {/* Loading / empty state */}
      {data === undefined && (
        <div className="space-y-2 animate-pulse">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 bg-muted rounded-xl" />
          ))}
        </div>
      )}
      {data === null && (
        <div className="rounded-xl border border-border bg-card p-4 text-center">
          <p className="text-sm text-muted-foreground">Sign in required.</p>
        </div>
      )}
      {data && data.rows.length === 0 && (
        <div className="rounded-xl border border-border bg-card p-6 text-center">
          <p className="text-sm text-muted-foreground">
            No importance computed yet for G{grade} Term {term}.
          </p>
          <p className="text-[11px] text-muted-foreground mt-1">
            Press Recompute to seed from tagged past papers (or the syllabus
            prior if none exist yet).
          </p>
        </div>
      )}

      {/* Top concepts */}
      {data && data.rows.length > 0 && topN.length > 0 && (
        <section className="mb-5">
          <h2 className="text-xs font-bold text-foreground uppercase tracking-wide mb-2">
            Highest weight
          </h2>
          <div className="rounded-xl border border-border bg-card divide-y divide-border">
            {topN.map((r) => (
              <ImportanceRowItem key={r._id as unknown as string} row={r} />
            ))}
          </div>
        </section>
      )}

      {/* Per-module / per-unit grouped bars */}
      {grouped.map(({ moduleId, units }) => {
        const mod = getModuleById(moduleId);
        const color = MODULE_COLORS[moduleId] ?? '#0D9488';
        return (
          <section key={moduleId} className="mb-5">
            <div className="flex items-center gap-2 mb-2">
              <div
                className="w-1 h-4 rounded-full"
                style={{ backgroundColor: color }}
              />
              <h2 className="text-xs font-bold text-foreground uppercase tracking-wide">
                {moduleId} &middot; {mod?.name ?? ''}
              </h2>
            </div>
            {units.map(({ unitId, rows, unitTotal }) => {
              const ctx = findUnit(unitId);
              const label = ctx
                ? `G${ctx.grade} T${ctx.term} · ${ctx.unit.name}`
                : unitId;
              return (
                <div
                  key={unitId}
                  className="rounded-xl border border-border bg-card p-3 mb-2"
                >
                  <div className="flex items-center justify-between mb-2 gap-2">
                    <div className="text-[11px] text-muted-foreground truncate">
                      {label}
                    </div>
                    <div className="text-[10px] text-muted-foreground shrink-0">
                      {(unitTotal * 100).toFixed(1)}%
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    {rows.map((r) => (
                      <ImportanceBar key={r._id as unknown as string} row={r} color={color} />
                    ))}
                  </div>
                </div>
              );
            })}
          </section>
        );
      })}

      {/* Papers contributing list */}
      {papers && papers.length > 0 && (
        <section className="mb-5">
          <h2 className="text-xs font-bold text-foreground uppercase tracking-wide mb-2">
            Papers · G{grade} Term {term}
          </h2>
          <div className="rounded-xl border border-border bg-card divide-y divide-border">
            {papers.map((p) => (
              <PaperRow
                key={p._id as unknown as string}
                paper={p}
                onToggleTraining={async () => {
                  if (p.isHoldout) {
                    toast.error(
                      'Holdout papers cannot be training signals. Clear the holdout flag first.',
                    );
                    return;
                  }
                  try {
                    await updatePaper({
                      id: p._id,
                      useAsTrainingSignal: !p.useAsTrainingSignal,
                    });
                  } catch (e) {
                    toast.error(
                      e instanceof Error ? e.message : 'Failed to update paper',
                    );
                  }
                }}
                onToggleHoldout={async () => {
                  const nextHoldout = !p.isHoldout;
                  try {
                    await updatePaper({
                      id: p._id,
                      isHoldout: nextHoldout,
                      // Holdout papers cannot be training signals.
                      useAsTrainingSignal: nextHoldout
                        ? false
                        : p.useAsTrainingSignal,
                    });
                  } catch (e) {
                    toast.error(
                      e instanceof Error ? e.message : 'Failed to update paper',
                    );
                  }
                }}
              />
            ))}
          </div>
          <p className="text-[10px] text-muted-foreground mt-2">
            Toggle a paper&apos;s training / holdout state, then press
            Recompute to see the bars shift.
          </p>
        </section>
      )}
    </div>
  );
}

function ImportanceRowItem({ row }: { row: ImportanceRow }) {
  const moduleId = row.unitId.split('-')[0] || '';
  const color = MODULE_COLORS[moduleId] ?? '#0D9488';
  const ctx = findUnit(row.unitId);
  return (
    <div className="flex items-center gap-2 px-3 py-2">
      <div
        className="w-1 h-4 rounded-full shrink-0"
        style={{ backgroundColor: color }}
      />
      <div className="min-w-0 flex-1">
        <div className="text-xs text-foreground truncate">{row.conceptName}</div>
        <div className="text-[10px] text-muted-foreground truncate">
          {ctx ? `${moduleId} · G${ctx.grade} T${ctx.term}` : moduleId}
        </div>
      </div>
      <div className="text-[11px] font-semibold text-foreground tabular-nums shrink-0">
        {(row.importance * 100).toFixed(1)}%
      </div>
    </div>
  );
}

function ImportanceBar({ row, color }: { row: ImportanceRow; color: string }) {
  const pct = row.importance * 100;
  // Bar width is the importance % scaled to fill the row visually. Cap at 60%
  // visual width so 1% looks visibly different from 5% without dominating the
  // card on the heavy concepts.
  const visualPct = Math.min(pct * 6, 100);
  return (
    <div className="flex items-center gap-2">
      <div className="min-w-0 flex-1">
        <div className="text-[11px] text-foreground truncate mb-0.5">
          {row.conceptName}
        </div>
        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
          <div
            className="h-full rounded-full"
            style={{
              width: `${visualPct}%`,
              backgroundColor: color,
            }}
          />
        </div>
      </div>
      <div className="text-[10px] text-muted-foreground tabular-nums shrink-0 w-10 text-right">
        {pct.toFixed(1)}%
      </div>
    </div>
  );
}

function PaperRow({
  paper,
  onToggleTraining,
  onToggleHoldout,
}: {
  paper: {
    _id: Id<'pastPapers'>;
    grade: number;
    term: number;
    year: number;
    schoolName?: string;
    useAsTrainingSignal: boolean;
    isHoldout: boolean;
    totalMarks?: number;
  };
  onToggleTraining: () => void;
  onToggleHoldout: () => void;
}) {
  const label = paper.schoolName ?? 'Own paper';
  return (
    <div className="px-3 py-2">
      <div className="flex items-center gap-2">
        <FileText className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="text-xs text-foreground truncate">
            {paper.year} &middot; {label}
          </div>
          <div className="text-[10px] text-muted-foreground">
            G{paper.grade} T{paper.term}
            {paper.totalMarks ? ` · ${paper.totalMarks} marks` : ''}
          </div>
        </div>
      </div>
      <div className="flex gap-2 mt-2">
        <button
          onClick={onToggleTraining}
          disabled={paper.isHoldout}
          className={`flex-1 text-[10px] font-semibold py-1 rounded-md border transition-colors ${
            paper.useAsTrainingSignal
              ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-600 dark:text-emerald-400'
              : 'bg-transparent border-border text-muted-foreground'
          } ${paper.isHoldout ? 'opacity-40 cursor-not-allowed' : ''}`}
        >
          {paper.useAsTrainingSignal ? 'Training ✓' : 'Not training'}
        </button>
        <button
          onClick={onToggleHoldout}
          className={`flex-1 text-[10px] font-semibold py-1 rounded-md border transition-colors ${
            paper.isHoldout
              ? 'bg-red-500/10 border-red-500/40 text-red-600 dark:text-red-400'
              : 'bg-transparent border-border text-muted-foreground'
          }`}
        >
          {paper.isHoldout ? 'Holdout ✓' : 'Not holdout'}
        </button>
      </div>
    </div>
  );
}

function formatRelative(ms: number): string {
  const diff = Date.now() - ms;
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export default function BlueprintPage() {
  return (
    <Suspense
      fallback={
        <div className="px-4 pt-5 max-w-lg mx-auto text-sm text-muted-foreground">
          Loading…
        </div>
      }
    >
      <BlueprintPageInner />
    </Suspense>
  );
}
