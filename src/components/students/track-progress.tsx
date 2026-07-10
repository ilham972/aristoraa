'use client';

// TrackProgress — the metro-line progress view for one student.
// Spec: docs/superpowers/specs/2026-07-10-track-progress-view-design.md
//
// The student's track drawn as a vertical railway: units are stations
// (★ mastered / ✓ taught / pulsing ▶ NOW / ○ upcoming), with a prediction
// banner comparing the projected finish date against the target exam.
// Tapping a station expands its concepts inline (accordion — never a
// drill-down page). Reads api.learningEngine.trackProgress via
// useCachedQuery, so it paints instantly and updates LIVE while scoring.

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  Flag,
  Star,
} from 'lucide-react';
import type { FunctionReturnType } from 'convex/server';
import { useCachedQuery } from '@/hooks/use-cached-query';
import { api } from '@/lib/convex';
import { cn } from '@/lib/utils';
import { buildTrackProgressArgs } from '@/lib/track-progress-args';
import type { StudentLite } from '@/lib/sheets/scope';

export type TrackProgressStudent = StudentLite; // needs _id + grade fields

function fmtYmd(ymd: string): string {
  const ms = Date.parse(`${ymd}T00:00:00.000Z`);
  if (Number.isNaN(ms)) return ymd;
  return new Date(ms).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

export function TrackProgress({ student }: { student: TrackProgressStudent }) {
  const args = useMemo(() => buildTrackProgressArgs(student), [student]);
  const data = useCachedQuery(
    api.learningEngine.trackProgress.trackProgressForStudent,
    { studentId: student._id, ...args },
  );

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const autoExpanded = useRef(false);
  const currentRef = useRef<HTMLDivElement | null>(null);

  const currentUnitId =
    data && data.status === 'ok'
      ? (data.units.find((u) => u.status === 'current')?.unitId ?? null)
      : null;

  // Auto-expand + scroll to the NOW station once, when data first lands.
  useEffect(() => {
    if (autoExpanded.current || !currentUnitId) return;
    autoExpanded.current = true;
    setExpandedId(currentUnitId);
    // Let the expanded content mount before scrolling.
    requestAnimationFrame(() => {
      currentRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
  }, [currentUnitId]);

  if (data === undefined) {
    return (
      <div className="space-y-2 animate-pulse">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="h-12 bg-muted rounded-xl" />
        ))}
      </div>
    );
  }
  if (data === null) {
    return (
      <div className="rounded-xl border border-border bg-card p-4 text-center text-sm text-muted-foreground">
        Not signed in.
      </div>
    );
  }
  if (data.status === 'no-track') {
    return (
      <div className="rounded-xl border border-dashed border-border/60 bg-card p-6 text-center">
        <p className="text-sm font-semibold text-foreground mb-1">No track assigned</p>
        <p className="text-[11px] text-muted-foreground mb-3">
          Assign a track from the student card to see their progress line.
        </p>
        <Link
          href="/students"
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold"
        >
          Open students
        </Link>
      </div>
    );
  }

  const { summary, prediction, units, track } = data;
  const masteredPct =
    summary.unitsTotal > 0 ? (summary.unitsMastered / summary.unitsTotal) * 100 : 0;
  const taughtPct =
    summary.unitsTotal > 0 ? (summary.unitsTaught / summary.unitsTotal) * 100 : 0;

  return (
    <div className="space-y-3">
      {/* ── Summary ─────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-border bg-card px-3 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-primary/15 text-primary text-[10px] font-bold uppercase tracking-wide">
            {track.name}
          </span>
          <span className="text-[11px] text-muted-foreground">
            {summary.conceptsTaught}/{summary.conceptsTotal} concepts
          </span>
        </div>
        <div className="mt-2 text-sm font-bold text-foreground">
          {summary.unitsTaught}/{summary.unitsTotal} units taught ·{' '}
          <span className="text-primary">{summary.unitsMastered} mastered</span>
        </div>
        {/* Two-color bar: teal = mastered, blue = taught-but-revising */}
        <div className="mt-1.5 h-1.5 rounded-full bg-muted overflow-hidden relative">
          <div
            className="absolute inset-y-0 left-0 bg-sky-500/70 rounded-full"
            style={{ width: `${taughtPct}%` }}
          />
          <div
            className="absolute inset-y-0 left-0 bg-primary rounded-full"
            style={{ width: `${masteredPct}%` }}
          />
        </div>
      </div>

      {/* ── Prediction banner ───────────────────────────────────────── */}
      {(prediction.examYmd || prediction.projectedFinishYmd !== null) && (
        <div
          className={cn(
            'rounded-xl border px-3 py-2.5 flex items-start gap-2 text-[12px]',
            prediction.onTrack === true &&
              'border-primary/40 bg-primary/10 text-foreground',
            prediction.onTrack === false &&
              'border-amber-500/40 bg-amber-500/10 text-foreground',
            prediction.onTrack === null && 'border-border bg-card text-foreground',
          )}
        >
          <Flag
            className={cn(
              'w-4 h-4 mt-0.5 shrink-0',
              prediction.onTrack === false ? 'text-amber-500' : 'text-primary',
            )}
          />
          <div>
            {prediction.examYmd && (
              <span className="font-semibold">
                G{track.targetGrade}
                {prediction.examTerm ? ` T${prediction.examTerm}` : ''} exam —{' '}
                {fmtYmd(prediction.examYmd)}
              </span>
            )}
            {prediction.projectedFinishYmd ? (
              <span>
                {prediction.examYmd ? ' · ' : ''}projected finish{' '}
                <span className="font-semibold">
                  {fmtYmd(prediction.projectedFinishYmd)}
                </span>{' '}
                ({prediction.sessionsLeftTotal} sessions ·{' '}
                {prediction.sessionsPerWeek}/wk)
              </span>
            ) : (
              <span>
                {prediction.examYmd ? ' · ' : ''}~{prediction.sessionsLeftTotal}{' '}
                sessions left · no weekly schedule set, so no date projection
              </span>
            )}
            {prediction.onTrack === true && (
              <span className="ml-1 font-bold text-primary">✓ on track</span>
            )}
            {prediction.onTrack === false && (
              <span className="ml-1 font-bold text-amber-500">⚠ behind</span>
            )}
          </div>
        </div>
      )}

      {/* ── Metro line ──────────────────────────────────────────────── */}
      <div className="rounded-xl border border-border bg-card px-3 py-2">
        {units.map((u, i) => {
          const prev = i > 0 ? units[i - 1] : null;
          const showSeparator =
            u.grade !== null &&
            (prev === null || prev.grade !== u.grade || prev.term !== u.term);
          const expanded = expandedId === u.unitId;
          const isCurrent = u.status === 'current';
          return (
            <div key={u.unitId} ref={isCurrent ? currentRef : undefined}>
              {showSeparator && (
                <div className="flex items-center gap-2 py-1.5 pl-9">
                  <span className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/70">
                    Grade {u.grade} · Term {u.term}
                  </span>
                  <div className="flex-1 h-px bg-border/60" />
                </div>
              )}
              <Station
                unit={u}
                expanded={expanded}
                first={i === 0 && !showSeparator}
                last={i === units.length - 1}
                onToggle={() => setExpandedId(expanded ? null : u.unitId)}
              />
            </div>
          );
        })}

        {/* Exam terminus */}
        <div className="flex items-center gap-3 pt-2 pb-1">
          <div className="w-7 flex justify-center">
            <Flag className="w-4 h-4 text-primary" />
          </div>
          <span className="text-[11px] text-muted-foreground">
            {prediction.examYmd
              ? `G${track.targetGrade} exam — ${fmtYmd(prediction.examYmd)}`
              : 'No exam date on the calendar yet'}
          </span>
        </div>
      </div>
    </div>
  );
}

// ── One station on the line ─────────────────────────────────────────────

type ProgressData = FunctionReturnType<
  typeof api.learningEngine.trackProgress.trackProgressForStudent
>;
type UnitRow = Extract<NonNullable<ProgressData>, { status: 'ok' }>['units'][number];

function Station({
  unit,
  expanded,
  first,
  last,
  onToggle,
}: {
  unit: UnitRow;
  expanded: boolean;
  first: boolean;
  last: boolean;
  onToggle: () => void;
}) {
  const isCurrent = unit.status === 'current';
  const blocked = unit.outOfScope || unit.noSyllabus;
  return (
    <div className="relative">
      {/* rail */}
      <div
        className={cn(
          'absolute left-[13px] w-px bg-border',
          first ? 'top-3' : 'top-0',
          last && !expanded ? 'bottom-3' : 'bottom-0',
        )}
      />
      <button
        onClick={onToggle}
        className="relative w-full flex items-center gap-3 py-2 text-left group"
      >
        {/* marker */}
        <div className="w-7 flex justify-center shrink-0">
          {unit.status === 'mastered' && (
            <span className="w-4 h-4 rounded-full bg-primary flex items-center justify-center">
              <Star className="w-2.5 h-2.5 text-primary-foreground fill-current" />
            </span>
          )}
          {unit.status === 'taught' && (
            <span className="w-4 h-4 rounded-full bg-sky-500 flex items-center justify-center">
              <Check className="w-2.5 h-2.5 text-white" strokeWidth={3.5} />
            </span>
          )}
          {isCurrent && (
            <span className="relative w-4 h-4">
              <span className="absolute inset-0 rounded-full bg-primary/50 animate-ping" />
              <span className="absolute inset-0 rounded-full bg-primary ring-2 ring-primary/30" />
            </span>
          )}
          {unit.status === 'upcoming' && (
            <span
              className={cn(
                'w-3.5 h-3.5 rounded-full border-2 bg-background',
                blocked ? 'border-amber-500/70' : 'border-border',
              )}
            />
          )}
        </div>

        {/* content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 min-w-0">
            <span
              className={cn(
                'text-[12px] truncate',
                isCurrent
                  ? 'font-bold text-foreground'
                  : unit.status === 'upcoming'
                    ? 'text-muted-foreground'
                    : 'font-medium text-foreground',
              )}
            >
              {unit.unitName}
            </span>
            {isCurrent && (
              <span className="shrink-0 px-1.5 py-0.5 rounded bg-primary/15 text-primary text-[9px] font-bold uppercase">
                Now
              </span>
            )}
          </div>
          {/* badges */}
          {(unit.outOfScope || unit.noSyllabus) && (
            <div className="flex items-center gap-1 mt-0.5 text-[10px] text-amber-500">
              <AlertTriangle className="w-3 h-3" />
              {unit.outOfScope
                ? 'Outside grade scope — planner will skip'
                : 'No syllabus data for this unit'}
            </div>
          )}
        </div>

        {/* right meta */}
        <div className="shrink-0 flex items-center gap-2">
          {unit.status === 'mastered' && (
            <span className="text-[10px] font-semibold text-primary">mastered</span>
          )}
          {unit.status === 'taught' && unit.meanMastery !== null && (
            <span className="flex items-center gap-1.5">
              <span className="text-[10px] text-muted-foreground">
                {Math.round(unit.meanMastery * 100)}%
              </span>
              <span className="w-12 h-1 rounded-full bg-muted overflow-hidden">
                <span
                  className="block h-full bg-sky-500 rounded-full"
                  style={{ width: `${Math.round(unit.meanMastery * 100)}%` }}
                />
              </span>
            </span>
          )}
          {(isCurrent || unit.status === 'upcoming') && unit.conceptsTotal > 0 && (
            <span className="text-[10px] text-muted-foreground">
              {unit.conceptsTaught}/{unit.conceptsTotal}
              {unit.sessionsLeft !== null && ` · ~${unit.sessionsLeft} sess`}
            </span>
          )}
          {expanded ? (
            <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/60" />
          )}
        </div>
      </button>

      {/* concepts accordion */}
      {expanded && unit.concepts.length > 0 && (
        <div className="relative pl-10 pb-2 space-y-1">
          {unit.concepts.map((concept) => (
            <div
              key={concept.conceptId as unknown as string}
              className="flex items-center gap-2 text-[11px]"
            >
              {concept.taught ? (
                <Check className="w-3 h-3 text-primary shrink-0" strokeWidth={3} />
              ) : concept.noQuestions ? (
                <AlertTriangle className="w-3 h-3 text-amber-500 shrink-0" />
              ) : (
                <span className="w-3 h-3 flex items-center justify-center shrink-0">
                  <span className="w-1.5 h-1.5 rounded-full border border-muted-foreground/60" />
                </span>
              )}
              <span
                className={cn(
                  'truncate',
                  concept.taught ? 'text-foreground' : 'text-muted-foreground',
                )}
              >
                {concept.name}
              </span>
              {concept.isNext && (
                <span className="shrink-0 px-1.5 py-0.5 rounded bg-primary/15 text-primary text-[9px] font-bold uppercase">
                  next
                </span>
              )}
              {concept.noQuestions && (
                <span className="shrink-0 text-[9px] text-amber-500">
                  no questions cropped
                </span>
              )}
              {concept.taught && concept.mastery !== null && (
                <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
                  {Math.round(concept.mastery * 100)}%
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
