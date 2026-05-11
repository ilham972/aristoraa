'use client';

import { useMemo, useState } from 'react';
import { useQuery } from 'convex/react';
import { api, type Id } from '@/lib/convex';
import {
  CURRICULUM_MODULES,
  findUnit,
  getModuleById,
} from '@/lib/curriculum-data';
import { MODULE_COLORS } from '@/lib/types';
import { ConceptDot } from './concept-dot';

type Bucket = 'mastered' | 'good' | 'partial' | 'shaky' | 'cold';

export interface MasteryRow {
  conceptId: Id<'exercises'>;
  unitId: string;
  name: string;
  order: number;
  mastery: number;
  R: number;
  accFactor: number;
  attemptCount: number;
  correctWeighted: number;
  wrongWeighted: number;
  lastReviewAt: number | null;
  stability: number | null;
  difficulty: number | null;
  lastResponse: string | null;
  hasState: boolean;
  // Decorated client-side from curriculum-data:
  moduleId: string;
  grade: number;
  term: number;
}

function bucketOf(row: MasteryRow): Bucket {
  if (!row.hasState) return 'cold';
  if (row.mastery >= 0.85) return 'mastered';
  if (row.mastery >= 0.5) return 'good';
  if (row.mastery >= 0.25) return 'partial';
  return 'shaky';
}

const BUCKET_BG: Record<Bucket, string> = {
  mastered: 'bg-emerald-500',
  good: 'bg-teal-500',
  partial: 'bg-amber-500',
  shaky: 'bg-red-500',
  cold: 'bg-zinc-500/60',
};

const BUCKET_RING: Record<Bucket, string> = {
  mastered: 'ring-emerald-300',
  good: 'ring-teal-300',
  partial: 'ring-amber-300',
  shaky: 'ring-red-300',
  cold: 'ring-zinc-400',
};

interface Props {
  studentId: Id<'students'>;
}

export function StudentMastery({ studentId }: Props) {
  const data = useQuery(api.learningEngine.studentDashboard.studentMastery, {
    studentId,
  });
  const [openConceptId, setOpenConceptId] = useState<Id<'exercises'> | null>(
    null,
  );

  const decorated: MasteryRow[] | null = useMemo(() => {
    if (!data) return null;
    const grades = new Set(data.student.assignedGrades);
    const out: MasteryRow[] = [];
    for (const r of data.rows) {
      const u = findUnit(r.unitId);
      if (!u) continue;
      if (!grades.has(u.grade)) continue;
      out.push({
        ...r,
        moduleId: u.module.id,
        grade: u.grade,
        term: u.term,
      });
    }
    return out;
  }, [data]);

  const grouped = useMemo(() => {
    if (!decorated)
      return [] as Array<{
        moduleId: string;
        rows: MasteryRow[];
      }>;
    const byModule = new Map<string, MasteryRow[]>();
    for (const r of decorated) {
      if (!byModule.has(r.moduleId)) byModule.set(r.moduleId, []);
      byModule.get(r.moduleId)!.push(r);
    }
    // Stable module order from curriculum (M1..M6).
    return CURRICULUM_MODULES.map((m) => ({
      moduleId: m.id,
      rows: (byModule.get(m.id) ?? [])
        .slice()
        .sort(
          (a, b) =>
            a.grade - b.grade ||
            a.term - b.term ||
            a.unitId.localeCompare(b.unitId) ||
            a.order - b.order,
        ),
    }));
  }, [decorated]);

  const summary = useMemo(() => {
    if (!decorated)
      return {
        total: 0,
        mastered: 0,
        cold: 0,
        avgMastery: 0,
      };
    let total = 0;
    let mastered = 0;
    let cold = 0;
    let sum = 0;
    for (const r of decorated) {
      total += 1;
      if (r.mastery >= 0.85) mastered += 1;
      if (!r.hasState) cold += 1;
      sum += r.mastery;
    }
    return {
      total,
      mastered,
      cold,
      avgMastery: total > 0 ? sum / total : 0,
    };
  }, [decorated]);

  const selected = useMemo(() => {
    if (!openConceptId || !decorated) return null;
    return decorated.find((r) => r.conceptId === openConceptId) ?? null;
  }, [openConceptId, decorated]);

  if (data === undefined) {
    return (
      <div className="space-y-2 animate-pulse">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className="h-12 bg-muted rounded-xl" />
        ))}
      </div>
    );
  }
  if (data === null) {
    return (
      <div className="rounded-xl border border-border bg-card p-4 text-center text-sm text-muted-foreground">
        Sign in required.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary row */}
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-xl border border-border bg-card px-3 py-2.5">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Concepts
          </div>
          <div className="text-base font-bold text-foreground">
            {summary.total}
          </div>
        </div>
        <div className="rounded-xl border border-border bg-card px-3 py-2.5">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Mastered
          </div>
          <div className="text-base font-bold text-emerald-500">
            {summary.mastered}
          </div>
        </div>
        <div className="rounded-xl border border-border bg-card px-3 py-2.5">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Avg
          </div>
          <div className="text-base font-bold text-foreground">
            {(summary.avgMastery * 100).toFixed(0)}%
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" /> ≥0.85
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded-full bg-teal-500" /> 0.5–0.85
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded-full bg-amber-500" /> 0.25–0.5
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded-full bg-red-500" /> &lt;0.25
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded-full bg-zinc-500/60" /> no data
        </span>
      </div>

      {/* Module strips */}
      {grouped.map(({ moduleId, rows }) => {
        const mod = getModuleById(moduleId);
        const color = MODULE_COLORS[moduleId] ?? '#0D9488';
        if (rows.length === 0) {
          return (
            <section key={moduleId}>
              <ModuleHeader moduleId={moduleId} name={mod?.name ?? ''} color={color} />
              <div className="rounded-lg border border-dashed border-border bg-card/40 px-3 py-2 text-[11px] text-muted-foreground">
                No concepts in assigned grades.
              </div>
            </section>
          );
        }
        return (
          <section key={moduleId}>
            <ModuleHeader moduleId={moduleId} name={mod?.name ?? ''} color={color} />
            <div className="rounded-xl border border-border bg-card p-2">
              <div className="flex flex-wrap gap-1.5">
                {rows.map((r) => {
                  const b = bucketOf(r);
                  const isOpen = openConceptId === r.conceptId;
                  return (
                    <ConceptDot
                      key={r.conceptId}
                      label={`${r.grade}.${r.term} · ${r.name}`}
                      bg={BUCKET_BG[b]}
                      ring={isOpen ? BUCKET_RING[b] : undefined}
                      onClick={() =>
                        setOpenConceptId((prev) =>
                          prev === r.conceptId ? null : r.conceptId,
                        )
                      }
                    />
                  );
                })}
              </div>
            </div>
          </section>
        );
      })}

      {/* Selected concept detail */}
      {selected && (
        <ConceptDetailCard
          row={selected}
          onClose={() => setOpenConceptId(null)}
        />
      )}
    </div>
  );
}

function ModuleHeader({
  moduleId,
  name,
  color,
}: {
  moduleId: string;
  name: string;
  color: string;
}) {
  return (
    <div className="flex items-center gap-2 mb-2">
      <div
        className="w-1 h-4 rounded-full"
        style={{ backgroundColor: color }}
      />
      <h2 className="text-xs font-bold text-foreground uppercase tracking-wide">
        {moduleId} · {name}
      </h2>
    </div>
  );
}

function formatRelative(ms: number | null): string {
  if (ms === null) return '—';
  const diffMs = Date.now() - ms;
  const days = diffMs / 86_400_000;
  if (days < 1) return 'today';
  if (days < 2) return '1 day ago';
  if (days < 30) return `${Math.floor(days)} days ago`;
  if (days < 365) return `${Math.floor(days / 30)} mo ago`;
  return `${Math.floor(days / 365)} yr ago`;
}

function ConceptDetailCard({
  row,
  onClose,
}: {
  row: MasteryRow;
  onClose: () => void;
}) {
  return (
    <div className="rounded-xl border border-primary/40 bg-card p-3 shadow-sm">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
            {row.moduleId} · G{row.grade} · Term {row.term}
          </div>
          <div className="text-sm font-bold text-foreground">{row.name}</div>
        </div>
        <button
          onClick={onClose}
          className="text-[11px] px-2 py-1 rounded-md hover:bg-muted text-muted-foreground"
          aria-label="Close concept details"
        >
          Close
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2 text-[11px]">
        <Stat label="Mastery" value={`${(row.mastery * 100).toFixed(0)}%`} />
        <Stat label="Retention R" value={`${(row.R * 100).toFixed(0)}%`} />
        <Stat
          label="Acc factor"
          value={`${(row.accFactor * 100).toFixed(0)}%`}
        />
        <Stat label="Attempts" value={String(row.attemptCount)} />
        <Stat
          label="Stability"
          value={
            row.stability !== null ? `${row.stability.toFixed(1)} d` : '—'
          }
        />
        <Stat
          label="Difficulty"
          value={
            row.difficulty !== null ? row.difficulty.toFixed(2) : '—'
          }
        />
        <Stat label="Last review" value={formatRelative(row.lastReviewAt)} />
        <Stat
          label="Last response"
          value={row.lastResponse ?? '—'}
        />
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-md bg-muted/50 px-2 py-1.5">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-semibold text-foreground">{value}</span>
    </div>
  );
}
