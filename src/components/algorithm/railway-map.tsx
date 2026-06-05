'use client';

// Phase 4 — the railway map. Tracks are train LINES (orderedUnitIds = stations);
// mergesIntoTrackId draws curved connectors between rows. A picked student is a
// MARKER: stations they've cleared go teal, their current station gets a pulsing
// ring, stations ahead stay muted. Inline SVG (scalable, tappable, mobile-first);
// the station list scrolls horizontally while the track-name gutter stays fixed.
//
// Unit names/grade/term come from curriculum-data.ts (client) and are passed to
// the trackMap query — Convex can't read the curriculum module.

import { useMemo, useState, useCallback } from 'react';
import { useQuery } from 'convex/react';
import { Train, X } from 'lucide-react';
import { api } from '@/lib/convex';
import type { Id } from '@/lib/convex';
import { CURRICULUM_MODULES } from '@/lib/curriculum-data';
import { ParentShareButton } from './railway-share';

// ── Geometry constants ──────────────────────────────────────────────────────
const ROW_H = 92;
const LINE_Y = ROW_H / 2;
const STATION_X0 = 26;
const GAP = 54;
const R = 10;
const TOP_PAD = 10;
const GRADE_LABEL_Y = 18;

type Station = { unitId: string; unitName: string; grade: number; term: number };
type Track = {
  trackId: Id<'tracks'>;
  name: string;
  level: number;
  targetGrade: number;
  targetTerm: number;
  active: boolean;
  mergesIntoTrackId: Id<'tracks'> | null;
  orderedUnitIds: Station[];
};
type Merge = { fromTrackId: Id<'tracks'>; toTrackId: Id<'tracks'>; joinUnitId: string | null };
type StationStatus = 'cleared' | 'current' | 'ahead' | 'none';

// All curriculum units, flattened — the metadata lookup the backend can't build.
function allUnitsMeta(): Station[] {
  const out: Station[] = [];
  for (const mod of CURRICULUM_MODULES)
    for (const g of mod.grades)
      for (const t of g.terms)
        for (const u of t.units)
          out.push({ unitId: u.id, unitName: u.name, grade: g.grade, term: t.term });
  return out;
}

// Contiguous same-grade runs along a track, for the shaded grade bands.
function gradeGroups(stations: Station[]): Array<{ grade: number; start: number; end: number }> {
  const groups: Array<{ grade: number; start: number; end: number }> = [];
  if (stations.length === 0) return groups;
  let start = 0;
  for (let i = 1; i <= stations.length; i++) {
    if (i === stations.length || stations[i].grade !== stations[start].grade) {
      groups.push({ grade: stations[start].grade, start, end: i - 1 });
      start = i;
    }
  }
  return groups;
}

const stationX = (i: number) => STATION_X0 + i * GAP;

export function RailwayMap() {
  const units = useMemo(allUnitsMeta, []);
  const map = useQuery(api.learningEngine.map.trackMap, { units }) as
    | { tracks: Track[]; merges: Merge[] }
    | null
    | undefined;
  const students = useQuery(api.students.list);

  const [studentId, setStudentId] = useState<string>('');
  const pos = useQuery(
    api.learningEngine.map.studentMapPosition,
    studentId ? { studentId: studentId as Id<'students'> } : 'skip',
  );

  const [tapped, setTapped] = useState<
    { trackName: string; station: Station; status: StationStatus } | null
  >(null);

  const studentName =
    students?.find((s: { _id: string; name: string }) => s._id === studentId)?.name ?? '';

  const clearedSet = useMemo(
    () => new Set(pos && 'clearedUnitIds' in pos ? pos.clearedUnitIds : []),
    [pos],
  );
  const studentTrackId = pos && 'trackId' in pos ? pos.trackId : null;
  const currentUnitId = pos && 'currentUnitId' in pos ? pos.currentUnitId : null;
  const isComplete = !!(pos && 'isComplete' in pos && pos.isComplete);

  const statusFor = useCallback(
    (trackId: Id<'tracks'>, unitId: string): StationStatus => {
      if (!studentTrackId || (trackId as unknown as string) !== (studentTrackId as unknown as string))
        return 'none';
      if (clearedSet.has(unitId)) return 'cleared';
      if (currentUnitId === unitId) return 'current';
      return 'ahead';
    },
    [studentTrackId, clearedSet, currentUnitId],
  );

  const geometry = useMemo(() => {
    if (!map) return null;
    const tracks = map.tracks;
    const rowIndexById = new Map<string, number>();
    tracks.forEach((t, i) => rowIndexById.set(t.trackId as unknown as string, i));
    const maxStations = tracks.reduce((m, t) => Math.max(m, t.orderedUnitIds.length), 0);
    const svgWidth = STATION_X0 + Math.max(maxStations, 1) * GAP;
    const svgHeight = TOP_PAD * 2 + tracks.length * ROW_H;

    // Merge curves: source last station → target join station.
    const curves = map.merges
      .map((mg) => {
        const fromIdx = rowIndexById.get(mg.fromTrackId as unknown as string);
        const toIdx = rowIndexById.get(mg.toTrackId as unknown as string);
        if (fromIdx === undefined || toIdx === undefined) return null;
        const from = tracks[fromIdx];
        const to = tracks[toIdx];
        const x1 = stationX(Math.max(from.orderedUnitIds.length - 1, 0));
        const y1 = TOP_PAD + fromIdx * ROW_H + LINE_Y;
        const joinIdx = mg.joinUnitId
          ? to.orderedUnitIds.findIndex((s) => s.unitId === mg.joinUnitId)
          : 0;
        const x2 = stationX(joinIdx < 0 ? 0 : joinIdx);
        const y2 = TOP_PAD + toIdx * ROW_H + LINE_Y;
        const ymid = (y1 + y2) / 2;
        return { d: `M ${x1} ${y1} C ${x1} ${ymid}, ${x2} ${ymid}, ${x2} ${y2}`, key: `${fromIdx}-${toIdx}` };
      })
      .filter((c): c is { d: string; key: string } => c !== null);

    return { tracks, svgWidth, svgHeight, curves };
  }, [map]);

  return (
    <div className="space-y-3">
      {/* Student picker */}
      <div className="flex items-center gap-2">
        <Train className="w-4 h-4 text-primary shrink-0" />
        <select
          value={studentId}
          onChange={(e) => {
            setStudentId(e.target.value);
            setTapped(null);
          }}
          className="flex-1 h-9 px-2 rounded-lg bg-muted text-sm text-foreground border border-border"
        >
          <option value="">Pick a student to show their position…</option>
          {students?.map((s: { _id: string; name: string }) => (
            <option key={s._id} value={s._id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>

      {studentId && pos && 'trackId' in pos && pos.trackId === null && (
        <p className="text-[11px] text-amber-500">No track assigned — this student has no marker on the map.</p>
      )}

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded-full" style={{ background: 'var(--primary)' }} /> cleared
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded-full border-2" style={{ borderColor: 'var(--primary)' }} /> current
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded-full border" style={{ borderColor: 'var(--muted-foreground)' }} /> ahead
        </span>
      </div>

      {/* Map */}
      {map === undefined && <div className="h-48 rounded-xl bg-muted animate-pulse" />}
      {map === null && (
        <div className="rounded-xl border border-border bg-card p-4 text-center text-sm text-muted-foreground">
          Sign in required.
        </div>
      )}
      {map && map.tracks.length === 0 && (
        <div className="rounded-xl border border-border bg-card p-6 text-center">
          <p className="text-sm text-muted-foreground">No tracks yet.</p>
          <p className="text-[11px] text-muted-foreground mt-1">
            Seed on-level tracks or build a remedial track in the Tracks tab.
          </p>
        </div>
      )}

      {map && geometry && map.tracks.length > 0 && (
        <div className="flex border border-border rounded-xl overflow-hidden bg-card">
          {/* Fixed track-name gutter */}
          <div className="shrink-0 w-28 border-r border-border" style={{ paddingTop: TOP_PAD }}>
            {geometry.tracks.map((t, i) => (
              <div
                key={t.trackId as unknown as string}
                style={{ height: ROW_H }}
                className={`flex flex-col justify-center px-2 ${
                  i < geometry.tracks.length - 1 ? 'border-b border-border/40' : ''
                } ${
                  studentTrackId && (t.trackId as unknown as string) === (studentTrackId as unknown as string)
                    ? 'bg-primary/5'
                    : ''
                }`}
              >
                <div className="text-[11px] font-semibold text-foreground leading-tight line-clamp-2">{t.name}</div>
                <div className="text-[9px] text-muted-foreground mt-0.5">
                  L{t.level} · {t.orderedUnitIds.length} st.
                </div>
              </div>
            ))}
          </div>

          {/* Scrollable station area */}
          <div className="overflow-x-auto flex-1">
            <svg
              width={geometry.svgWidth}
              height={geometry.svgHeight}
              className="block"
              style={{ minWidth: geometry.svgWidth }}
            >
              {/* Merge curves (under the lines) */}
              {geometry.curves.map((c) => (
                <path
                  key={c.key}
                  d={c.d}
                  fill="none"
                  stroke="var(--primary)"
                  strokeWidth={2}
                  strokeDasharray="4 4"
                  opacity={0.5}
                />
              ))}

              {/* Track rows */}
              {geometry.tracks.map((t, rowIdx) => {
                const rowTop = TOP_PAD + rowIdx * ROW_H;
                const lineY = rowTop + LINE_Y;
                const stations = t.orderedUnitIds;
                const lastX = stationX(Math.max(stations.length - 1, 0));
                const onStudentTrack =
                  studentTrackId &&
                  (t.trackId as unknown as string) === (studentTrackId as unknown as string);
                // Progress split point on the line (teal up to current station).
                const curIdx = onStudentTrack
                  ? isComplete
                    ? stations.length - 1
                    : stations.findIndex((s) => s.unitId === currentUnitId)
                  : -1;
                const splitX = curIdx >= 0 ? stationX(curIdx) : STATION_X0;

                return (
                  <g key={t.trackId as unknown as string}>
                    {/* Grade bands */}
                    {gradeGroups(stations).map((grp) => {
                      const x = stationX(grp.start) - R - 5;
                      const w = (grp.end - grp.start) * GAP + 2 * (R + 5);
                      const cx = stationX(grp.start) + ((grp.end - grp.start) * GAP) / 2;
                      return (
                        <g key={`${grp.grade}-${grp.start}`}>
                          <rect
                            x={x}
                            y={rowTop + 26}
                            width={w}
                            height={40}
                            rx={8}
                            fill="var(--muted)"
                            opacity={0.5}
                          />
                          <text
                            x={cx}
                            y={rowTop + GRADE_LABEL_Y}
                            textAnchor="middle"
                            fontSize={9}
                            fontWeight={700}
                            fill="var(--muted-foreground)"
                          >
                            G{grp.grade}
                          </text>
                        </g>
                      );
                    })}

                    {/* Base line (muted) + traveled segment (teal) */}
                    <line
                      x1={STATION_X0}
                      y1={lineY}
                      x2={Math.max(lastX, STATION_X0)}
                      y2={lineY}
                      stroke="var(--muted-foreground)"
                      strokeWidth={3}
                      strokeLinecap="round"
                      opacity={0.35}
                    />
                    {onStudentTrack && splitX > STATION_X0 && (
                      <line
                        x1={STATION_X0}
                        y1={lineY}
                        x2={splitX}
                        y2={lineY}
                        stroke="var(--primary)"
                        strokeWidth={3}
                        strokeLinecap="round"
                      />
                    )}

                    {/* Stations */}
                    {stations.map((st, i) => {
                      const cx = stationX(i);
                      const status = statusFor(t.trackId, st.unitId);
                      return (
                        <StationNode
                          key={st.unitId}
                          cx={cx}
                          cy={lineY}
                          status={status}
                          onTap={() => setTapped({ trackName: t.name, station: st, status })}
                        />
                      );
                    })}
                  </g>
                );
              })}
            </svg>
          </div>
        </div>
      )}

      {/* Tapped-station detail */}
      {tapped && (
        <div className="rounded-xl border border-primary/30 bg-card p-3 relative">
          <button
            onClick={() => setTapped(null)}
            className="absolute top-2 right-2 p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted"
            aria-label="Close"
          >
            <X className="w-3.5 h-3.5" />
          </button>
          <div className="text-sm font-semibold text-foreground pr-6">{tapped.station.unitName}</div>
          <div className="text-[11px] text-muted-foreground mt-0.5">
            {tapped.trackName} · G{tapped.station.grade} T{tapped.station.term}
          </div>
          <div className="mt-1.5">
            <StatusBadge status={tapped.status} />
          </div>
        </div>
      )}

      {/* Parent share (§4.4) */}
      {studentId && studentName && (
        <ParentShareButton studentId={studentId as Id<'students'>} studentName={studentName} />
      )}
    </div>
  );
}

function StationNode({
  cx,
  cy,
  status,
  onTap,
}: {
  cx: number;
  cy: number;
  status: StationStatus;
  onTap: () => void;
}) {
  return (
    <g className="cursor-pointer" onClick={onTap}>
      {/* Larger invisible hit target for touch */}
      <circle cx={cx} cy={cy} r={R + 8} fill="transparent" />
      {status === 'current' && (
        <circle cx={cx} cy={cy} r={R + 5} fill="none" stroke="var(--primary)" strokeWidth={2} className="animate-pulse" opacity={0.7} />
      )}
      {status === 'cleared' && <circle cx={cx} cy={cy} r={R} fill="var(--primary)" stroke="var(--primary)" strokeWidth={2} />}
      {status === 'current' && <circle cx={cx} cy={cy} r={R} fill="var(--card)" stroke="var(--primary)" strokeWidth={3} />}
      {status === 'ahead' && <circle cx={cx} cy={cy} r={R} fill="var(--card)" stroke="var(--muted-foreground)" strokeWidth={2} />}
      {status === 'none' && <circle cx={cx} cy={cy} r={R} fill="var(--card)" stroke="var(--muted-foreground)" strokeWidth={1.5} opacity={0.55} />}
    </g>
  );
}

function StatusBadge({ status }: { status: StationStatus }) {
  const map: Record<StationStatus, { label: string; cls: string }> = {
    cleared: { label: '✓ Cleared', cls: 'bg-primary/10 text-primary' },
    current: { label: '● You are here', cls: 'bg-primary/10 text-primary' },
    ahead: { label: 'Ahead — not yet reached', cls: 'bg-muted text-muted-foreground' },
    none: { label: 'Not on this student’s track', cls: 'bg-muted text-muted-foreground' },
  };
  const { label, cls } = map[status];
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ${cls}`}>{label}</span>;
}
