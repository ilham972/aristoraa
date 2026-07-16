'use client';

import { useMemo, useState, useCallback, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useMutation } from 'convex/react';
import {
  Layers, BarChart3, ListOrdered,
  RefreshCw, AlertTriangle, FileText,
} from 'lucide-react';
import { PathTab } from '@/components/algorithm/path-tab';
import { api } from '@/lib/convex';
import type { Id } from '@/lib/convex';
import { CURRICULUM_MODULES, getModuleById, findUnit } from '@/lib/curriculum-data';
import { MODULE_COLORS } from '@/lib/types';
import { CoverageBanner } from '@/components/coverage/coverage-banner';
import { UnitCoverageCard, type CoverageRow } from '@/components/coverage/unit-coverage-card';
import { ConceptDetailPanel } from '@/components/coverage/concept-detail-panel';
import { OrphanList } from '@/components/coverage/orphan-list';
import { GroupsLens } from '@/components/coverage/groups-lens';
import { toast } from 'sonner';

// ── Constants ─────────────────────────────────────────────────────────────────

const GRADES = [6, 7, 8, 9, 10, 11];
const TERMS: Array<1 | 2 | 3> = [1, 2, 3];

type TabId = 'coverage' | 'blueprint' | 'path';
type LensId = 'groups' | 'bank';

// The Coverage tab's two lenses. "Groups" leads: it's the day-to-day question
// ("how far is this group?"); Bank is the content-pipeline audit behind it.
const LENSES: { id: LensId; label: string }[] = [
  { id: 'groups', label: 'Groups' },
  { id: 'bank', label: 'Bank' },
];

// Tracks + Exams moved to the global /planner (2026-07-15) — they are
// planning INPUTS; Insights keeps the content-inspection tools.
const TABS: { id: TabId; label: string; fullLabel: string; icon: typeof Layers }[] = [
  { id: 'coverage',  label: 'Coverage',  fullLabel: 'Coverage',       icon: Layers },
  { id: 'blueprint', label: 'Blueprint', fullLabel: 'Exam Blueprint', icon: BarChart3 },
  { id: 'path',      label: 'Path',      fullLabel: 'Teaching Path',  icon: ListOrdered },
];

// ── Shared helpers ────────────────────────────────────────────────────────────

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

function formatRelative(ms: number): string {
  const diff = Date.now() - ms;
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ── Types ─────────────────────────────────────────────────────────────────────

type ImportanceRow = {
  _id: Id<'conceptImportance'>;
  conceptExerciseId: Id<'exercises'>;
  conceptName: string;
  unitId: string;
  importance: number;
  rawMarks: number;
};

// ── Shared grade/term selector ────────────────────────────────────────────────

function GradeTermSelector({
  grade,
  term,
  setGrade,
  setTerm,
}: {
  grade: number;
  term: 1 | 2 | 3;
  setGrade: (g: number) => void;
  setTerm: (t: number) => void;
}) {
  return (
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
  );
}

// ── Coverage tab ──────────────────────────────────────────────────────────────
// Two lenses over the word "coverage", which mean genuinely different things:
//   Groups — how far has each GROUP got through a term (the Term Coverage
//            Cockpit, moved here from the Planner's Sheets tab 2026-07-17).
//   Bank   — does the question BANK hold enough material per concept for a
//            grade+term. Keyed by grade, cumulative across terms.
// They share no data and no axis, so they stay separate lenses rather than one
// merged list; the bridge is a book-gap in Groups linking into Bank.

function BankLens({
  grade,
  term,
  setGrade,
  setTerm,
}: {
  grade: number;
  term: 1 | 2 | 3;
  setGrade: (g: number) => void;
  setTerm: (t: number) => void;
}) {
  const [openConceptId, setOpenConceptId] = useState<Id<'exercises'> | null>(null);

  const unitIds = useMemo(() => unitIdsCumulative(grade, term), [grade, term]);

  const data = useQuery(api.learningEngine.coverage.coverageByGradeTerm, { grade, term, unitIds });

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
    return Array.from(moduleMap.keys()).sort().map((mId) => {
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

  const selectedRow = useMemo(() => {
    if (!openConceptId || !data) return null;
    return data.rows.find((r) => r.conceptId === openConceptId) ?? null;
  }, [openConceptId, data]);

  return (
    <>
      <GradeTermSelector grade={grade} term={term} setGrade={setGrade} setTerm={setTerm} />

      {data === undefined && (
        <div className="space-y-2 animate-pulse">
          {[1, 2, 3].map((i) => <div key={i} className="h-20 bg-muted rounded-xl" />)}
        </div>
      )}
      {data === null && (
        <div className="rounded-xl border border-border bg-card p-4 text-center">
          <p className="text-sm text-muted-foreground">Sign in required.</p>
        </div>
      )}
      {data && data.rows.length === 0 && data.orphanConceptIds.length === 0 && (
        <div className="rounded-xl border border-border bg-card p-6 text-center">
          <p className="text-sm text-muted-foreground">No concepts defined for G{grade} Term {term}.</p>
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
          <div className="flex flex-wrap items-center gap-2 mb-3 text-[10px] text-muted-foreground">
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-red-500" />&lt;5</span>
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-amber-500" />5–9</span>
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-emerald-500" />10–19</span>
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-emerald-700" />20+</span>
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-zinc-500/70" />orphan</span>
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
    </>
  );
}

function CoverageTab({
  grade,
  term,
  lens,
  groupId,
  setGrade,
  setTerm,
  setFocus,
}: {
  grade: number;
  term: 1 | 2 | 3;
  lens: LensId;
  groupId: Id<'groups'> | null;
  setGrade: (g: number) => void;
  setTerm: (t: number) => void;
  setFocus: (next: { lens?: LensId; g?: number; t?: number }) => void;
}) {
  // A book-gap in Groups jumps to that unit's grade+term in Bank — one write,
  // because grade, term and lens all change together.
  const inspectUnit = useCallback(
    (unitId: string) => {
      const ctx = findUnit(unitId);
      setFocus({
        lens: 'bank',
        ...(ctx ? { g: ctx.grade, t: ctx.term } : {}),
      });
    },
    [setFocus],
  );

  return (
    <>
      <div className="flex gap-1 p-1 bg-muted rounded-xl mb-3">
        {LENSES.map((l) => (
          <button
            key={l.id}
            onClick={() => setFocus({ lens: l.id })}
            className={`flex-1 py-1.5 px-2 rounded-lg text-[11px] font-semibold transition-all ${
              l.id === lens
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {l.label}
          </button>
        ))}
      </div>
      <p className="text-[11px] text-muted-foreground mb-3">
        {lens === 'groups'
          ? 'How far each group has got through a term. Tap a group on the line to open every question of its term.'
          : 'Whether the question bank holds enough material per concept. Counts questions that exist — not what any group has been taught.'}
      </p>

      {lens === 'groups' ? (
        <GroupsLens initialGroupId={groupId} onInspectUnit={inspectUnit} />
      ) : (
        <BankLens grade={grade} term={term} setGrade={setGrade} setTerm={setTerm} />
      )}
    </>
  );
}

// ── Blueprint tab ─────────────────────────────────────────────────────────────

function BlueprintTab({
  grade,
  term,
  setGrade,
  setTerm,
}: {
  grade: number;
  term: 1 | 2 | 3;
  setGrade: (g: number) => void;
  setTerm: (t: number) => void;
}) {
  const [recomputing, setRecomputing] = useState(false);

  const unitIds = useMemo(() => unitIdsCumulative(grade, term), [grade, term]);

  const data = useQuery(api.learningEngine.importance.getForGradeTerm, { grade, term });
  const papers = useQuery(api.learningEngine.importance.trainingPapersForGradeTerm, { grade, term });
  const recompute = useMutation(api.learningEngine.importance.recomputeForGradeTerm);
  const updatePaper = useMutation(api.pastPapers.update);

  const onRecompute = useCallback(async () => {
    if (recomputing) return;
    setRecomputing(true);
    try {
      const res = await recompute({ grade, term, unitIds });
      toast.success(`Recomputed ${res.computed} concepts (${res.source}, ${res.paperCount} papers)`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Recompute failed');
    } finally {
      setRecomputing(false);
    }
  }, [recompute, grade, term, unitIds, recomputing]);

  const grouped = useMemo(() => {
    if (!data || data.rows.length === 0) {
      return [] as Array<{ moduleId: string; units: Array<{ unitId: string; rows: ImportanceRow[]; unitTotal: number }> }>;
    }
    const moduleMap = new Map<string, Map<string, ImportanceRow[]>>();
    for (const r of data.rows) {
      const mId = r.unitId.split('-')[0] || '?';
      if (!moduleMap.has(mId)) moduleMap.set(mId, new Map());
      const um = moduleMap.get(mId)!;
      if (!um.has(r.unitId)) um.set(r.unitId, []);
      um.get(r.unitId)!.push(r);
    }
    return Array.from(moduleMap.keys()).sort().map((mId) => {
      const unitsMap = moduleMap.get(mId)!;
      const units = Array.from(unitsMap.entries()).map(([unitId, rows]) => {
        const sorted = rows.slice().sort((a, b) => b.importance - a.importance);
        return { unitId, rows: sorted, unitTotal: sorted.reduce((s, r) => s + r.importance, 0) };
      });
      units.sort((a, b) => b.unitTotal - a.unitTotal);
      return { moduleId: mId, units };
    });
  }, [data]);

  const trainingList = useMemo(
    () => (papers ?? []).filter((p) => p.useAsTrainingSignal && !p.isHoldout),
    [papers],
  );

  const warnings = useMemo(() => {
    const out: string[] = [];
    if (data?.source === 'prior') {
      out.push(
        "No tagged training papers contributed — falling back to a syllabus prior (each concept inherits its unit's exercise count). Tag past-paper questions to concepts to sharpen.",
      );
    }
    if (data?.source === 'data') {
      if (trainingList.length < 3) {
        out.push(
          `Only ${trainingList.length} training paper${trainingList.length === 1 ? '' : 's'} contributing — weights are noisy until you tag ~3+ years of papers.`,
        );
      }
      const distinctSchools = new Set(trainingList.map((p) => p.schoolName ?? '__OWN__'));
      if (trainingList.length >= 2 && distinctSchools.size === 1 && !distinctSchools.has('__OWN__')) {
        out.push(
          `All training papers are from ${trainingList[0].schoolName}. Add papers from other regions to cancel single-school bias.`,
        );
      }
    }
    return out;
  }, [data, trainingList]);

  const topN = useMemo(() => {
    if (!data || data.rows.length === 0) return [] as ImportanceRow[];
    return data.rows.slice().sort((a, b) => b.importance - a.importance).slice(0, 8);
  }, [data]);

  return (
    <>
      <GradeTermSelector grade={grade} term={term} setGrade={setGrade} setTerm={setTerm} />

      {/* Recompute strip */}
      <div className="rounded-xl border border-border bg-card p-3 mb-3">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[11px] text-muted-foreground uppercase tracking-wide">
              {data?.computedAt ? `Last computed ${formatRelative(data.computedAt)}` : 'Never computed'}
            </div>
            <div className="text-xs text-foreground mt-0.5">
              {data?.source === 'data' && (
                <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
                  Data &middot; {data.paperCount ?? 0} paper{(data.paperCount ?? 0) === 1 ? '' : 's'}
                </span>
              )}
              {data?.source === 'prior' && (
                <span className="text-amber-600 dark:text-amber-400 font-semibold">Syllabus prior</span>
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
            <RefreshCw className={`w-3.5 h-3.5 ${recomputing ? 'animate-spin' : ''}`} />
            {recomputing ? 'Computing…' : 'Recompute'}
          </button>
        </div>
      </div>

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

      {data === undefined && (
        <div className="space-y-2 animate-pulse">
          {[1, 2, 3].map((i) => <div key={i} className="h-16 bg-muted rounded-xl" />)}
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
            Press Recompute to seed from tagged past papers (or the syllabus prior if none exist yet).
          </p>
        </div>
      )}

      {data && data.rows.length > 0 && topN.length > 0 && (
        <section className="mb-5">
          <h2 className="text-xs font-bold text-foreground uppercase tracking-wide mb-2">Highest weight</h2>
          <div className="rounded-xl border border-border bg-card divide-y divide-border">
            {topN.map((r) => <ImportanceRowItem key={r._id as unknown as string} row={r} />)}
          </div>
        </section>
      )}

      {grouped.map(({ moduleId, units }) => {
        const mod = getModuleById(moduleId);
        const color = MODULE_COLORS[moduleId] ?? '#0D9488';
        return (
          <section key={moduleId} className="mb-5">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-1 h-4 rounded-full" style={{ backgroundColor: color }} />
              <h2 className="text-xs font-bold text-foreground uppercase tracking-wide">
                {moduleId} &middot; {mod?.name ?? ''}
              </h2>
            </div>
            {units.map(({ unitId, rows, unitTotal }) => {
              const ctx = findUnit(unitId);
              const label = ctx ? `G${ctx.grade} T${ctx.term} · ${ctx.unit.name}` : unitId;
              return (
                <div key={unitId} className="rounded-xl border border-border bg-card p-3 mb-2">
                  <div className="flex items-center justify-between mb-2 gap-2">
                    <div className="text-[11px] text-muted-foreground truncate">{label}</div>
                    <div className="text-[10px] text-muted-foreground shrink-0">
                      {(unitTotal * 100).toFixed(1)}%
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    {rows.map((r) => <ImportanceBar key={r._id as unknown as string} row={r} color={color} />)}
                  </div>
                </div>
              );
            })}
          </section>
        );
      })}

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
                    toast.error('Holdout papers cannot be training signals. Clear the holdout flag first.');
                    return;
                  }
                  try {
                    await updatePaper({ id: p._id, useAsTrainingSignal: !p.useAsTrainingSignal });
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : 'Failed to update paper');
                  }
                }}
                onToggleHoldout={async () => {
                  const nextHoldout = !p.isHoldout;
                  try {
                    await updatePaper({
                      id: p._id,
                      isHoldout: nextHoldout,
                      useAsTrainingSignal: nextHoldout ? false : p.useAsTrainingSignal,
                    });
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : 'Failed to update paper');
                  }
                }}
              />
            ))}
          </div>
          <p className="text-[10px] text-muted-foreground mt-2">
            Toggle a paper&apos;s training / holdout state, then press Recompute to see the bars shift.
          </p>
        </section>
      )}
    </>
  );
}

// ── Blueprint sub-components ──────────────────────────────────────────────────

function ImportanceRowItem({ row }: { row: ImportanceRow }) {
  const moduleId = row.unitId.split('-')[0] || '';
  const color = MODULE_COLORS[moduleId] ?? '#0D9488';
  const ctx = findUnit(row.unitId);
  return (
    <div className="flex items-center gap-2 px-3 py-2">
      <div className="w-1 h-4 rounded-full shrink-0" style={{ backgroundColor: color }} />
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
  const visualPct = Math.min(pct * 6, 100);
  return (
    <div className="flex items-center gap-2">
      <div className="min-w-0 flex-1">
        <div className="text-[11px] text-foreground truncate mb-0.5">{row.conceptName}</div>
        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
          <div className="h-full rounded-full" style={{ width: `${visualPct}%`, backgroundColor: color }} />
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
          <div className="text-xs text-foreground truncate">{paper.year} &middot; {label}</div>
          <div className="text-[10px] text-muted-foreground">
            G{paper.grade} T{paper.term}{paper.totalMarks ? ` · ${paper.totalMarks} marks` : ''}
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

// ── Main page ─────────────────────────────────────────────────────────────────

function AlgorithmPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Retired subtabs redirect to their new homes: Sheet → per-session tab on
  // /groups (2026-06); Tracks + Exams → the global /planner (2026-07-15).
  useEffect(() => {
    const t = searchParams.get('tab');
    if (t === 'sheet') router.replace('/groups');
    else if (t === 'tracks') router.replace('/planner?tab=tracks');
    else if (t === 'exams') router.replace('/planner?tab=exams');
  }, [router, searchParams]);

  const rawTab = searchParams.get('tab') ?? 'coverage';
  const tab: TabId = (['coverage', 'blueprint', 'path'] as TabId[]).includes(rawTab as TabId)
    ? (rawTab as TabId)
    : 'coverage';

  const gradeParam = parseInt(searchParams.get('g') ?? '7', 10);
  const termParam = parseInt(searchParams.get('t') ?? '1', 10);
  const grade = GRADES.includes(gradeParam) ? gradeParam : 7;
  const term = ([1, 2, 3] as number[]).includes(termParam) ? (termParam as 1 | 2 | 3) : 1;

  const rawLens = searchParams.get('lens') ?? 'groups';
  const lens: LensId = (['groups', 'bank'] as LensId[]).includes(rawLens as LensId)
    ? (rawLens as LensId)
    : 'groups';

  // Set by the Sheets tab's "See full coverage" link. Not validated here — the
  // rail falls back to its first group if the id isn't one of them.
  const groupId = (searchParams.get('group') as Id<'groups'> | null) ?? null;

  // ONE writer for the query string. Separate per-param setters each rebuilt
  // the URL from the same snapshot, so changing grade and term together lost
  // one of them — the book-gap jump into Bank changes both at once.
  const setParams = useCallback(
    (next: { tab?: TabId; lens?: LensId; g?: number; t?: number }) => {
      const params = new URLSearchParams(searchParams.toString());
      if (next.tab !== undefined) params.set('tab', next.tab);
      if (next.lens !== undefined) params.set('lens', next.lens);
      if (next.g !== undefined) params.set('g', String(next.g));
      if (next.t !== undefined) params.set('t', String(next.t));
      router.replace(`/algorithm?${params.toString()}`, { scroll: false });
    },
    [router, searchParams],
  );

  const setTab = useCallback((t: TabId) => setParams({ tab: t }), [setParams]);
  const setGrade = useCallback((g: number) => setParams({ g }), [setParams]);
  const setTerm = useCallback((t: number) => setParams({ t }), [setParams]);

  const currentTab = TABS.find((t) => t.id === tab)!;
  const TabIcon = currentTab.icon;

  return (
    <div className="px-4 pt-5 pb-24 max-w-lg mx-auto">
      {/* Header */}
      <div className="flex items-center gap-2 mb-4">
        <TabIcon className="w-5 h-5 text-primary" />
        <h1 className="text-lg font-bold text-foreground">{currentTab.fullLabel}</h1>
      </div>

      {/* Tab switcher */}
      <div className="flex gap-1 p-1 bg-muted rounded-xl mb-4">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex-1 py-2 px-2 rounded-lg text-xs font-semibold transition-all ${
              t.id === tab
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'coverage' && (
        <CoverageTab
          grade={grade}
          term={term}
          lens={lens}
          groupId={groupId}
          setGrade={setGrade}
          setTerm={setTerm}
          setFocus={setParams}
        />
      )}
      {tab === 'blueprint' && (
        <BlueprintTab grade={grade} term={term} setGrade={setGrade} setTerm={setTerm} />
      )}
      {tab === 'path' && (
        <PathTab grade={grade} term={term} setGrade={setGrade} setTerm={setTerm} />
      )}
    </div>
  );
}

export default function AlgorithmPage() {
  return (
    <Suspense
      fallback={
        <div className="px-4 pt-5 max-w-lg mx-auto text-sm text-muted-foreground">Loading…</div>
      }
    >
      <AlgorithmPageInner />
    </Suspense>
  );
}
