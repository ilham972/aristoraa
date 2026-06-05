'use client';

import { useMemo, useState, useCallback } from 'react';
import { useQuery, useMutation } from 'convex/react';
import { Route, Sprout, Plus, Check } from 'lucide-react';
import { api } from '@/lib/convex';
import { CURRICULUM_MODULES } from '@/lib/curriculum-data';
import { toast } from 'sonner';

const GRADES = [6, 7, 8, 9, 10, 11];

// All units for a (grade,term) across modules, natural curriculum order.
function naturalUnits(grade: number, term: number) {
  const out: Array<{ unitId: string; unitName: string; grade: number; term: number }> = [];
  for (const mod of CURRICULUM_MODULES) {
    const g = mod.grades.find((gr) => gr.grade === grade);
    if (!g) continue;
    const t = g.terms.find((tt) => tt.term === term);
    if (!t) continue;
    for (const u of t.units) out.push({ unitId: u.id, unitName: u.name, grade, term });
  }
  return out;
}

export function TracksTab() {
  const tracks = useQuery(api.learningEngine.tracks.listTracks);
  const seed = useMutation(api.learningEngine.tracks.seedOnLevelTracks);
  const createTrack = useMutation(api.learningEngine.tracks.createTrack);

  const [seeding, setSeeding] = useState(false);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [targetGrade, setTargetGrade] = useState(9);
  const [startGrade, setStartGrade] = useState(7);
  const [included, setIncluded] = useState<Record<string, boolean>>({});
  const [trackName, setTrackName] = useState('');

  // Units from startGrade..targetGrade for the builder.
  const builderUnits = useMemo(() => {
    const out: Array<{ unitId: string; unitName: string; grade: number; term: number }> = [];
    for (let g = startGrade; g <= targetGrade; g++) {
      for (const term of [1, 2, 3]) out.push(...naturalUnits(g, term));
    }
    return out;
  }, [startGrade, targetGrade]);

  const candidates = useQuery(
    api.learningEngine.tracks.listCandidateUnitsForTrack,
    builderOpen ? { targetGrade, units: builderUnits } : 'skip',
  );

  const onSeed = useCallback(async () => {
    setSeeding(true);
    try {
      const perGradeTerm = GRADES.flatMap((g) =>
        [1, 2, 3].map((term) => ({
          grade: g,
          term,
          naturalUnitIds: naturalUnits(g, term).map((u) => u.unitId),
        })),
      ).filter((r) => r.naturalUnitIds.length > 0);
      const res = await seed({ perGradeTerm });
      toast.success(`Seeded on-level tracks (${res.created} new, ${res.updated} updated)`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Seed failed');
    } finally {
      setSeeding(false);
    }
  }, [seed]);

  // Seed `included` from suggestions when candidates load.
  const candSig = candidates?.map((c) => `${c.unitId}:${c.suggestedInclude ? 1 : 0}`).join('|') ?? '';
  const [seededSig, setSeededSig] = useState('');
  if (candidates && candSig !== seededSig) {
    setSeededSig(candSig);
    const next: Record<string, boolean> = {};
    for (const c of candidates) next[c.unitId] = c.suggestedInclude;
    setIncluded(next);
  }

  const onCreate = useCallback(async () => {
    if (!candidates) return;
    const orderedUnitIds = candidates.filter((c) => included[c.unitId]).map((c) => c.unitId);
    if (orderedUnitIds.length === 0) { toast.error('Select at least one unit'); return; }
    const name = trackName.trim() || `Remedial G${startGrade}→G${targetGrade}`;
    try {
      // level between grades: targetGrade*10 - 5 marks "remedial below on-level".
      await createTrack({ name, targetGrade, targetTerm: 1, orderedUnitIds, level: targetGrade * 10 - 5 });
      toast.success(`Created track "${name}"`);
      setBuilderOpen(false);
      setTrackName('');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Create failed');
    }
  }, [candidates, included, trackName, startGrade, targetGrade, createTrack]);

  return (
    <div className="space-y-4">
      <p className="text-[11px] text-muted-foreground leading-relaxed">
        Tracks are the routes students ride. On-level tracks mirror your teaching paths; remedial
        tracks start grades behind and skip low-importance units. A student rides one track (all
        modules); the Main block walks it.
      </p>

      <div className="flex gap-2">
        <button
          onClick={onSeed}
          disabled={seeding}
          className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-border text-xs font-semibold text-foreground disabled:opacity-50"
        >
          <Sprout className="w-3.5 h-3.5" /> {seeding ? 'Seeding…' : 'Seed on-level tracks'}
        </button>
        <button
          onClick={() => setBuilderOpen((v) => !v)}
          className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-semibold"
        >
          <Plus className="w-3.5 h-3.5" /> New remedial track
        </button>
      </div>

      {builderOpen && (
        <div className="rounded-xl border border-border bg-card p-3 space-y-3">
          <div className="flex items-center gap-2">
            <label className="text-[11px] text-muted-foreground">Start</label>
            <select value={startGrade} onChange={(e) => setStartGrade(Number(e.target.value))}
              className="px-2 py-1 rounded-md bg-muted text-xs border border-border">
              {GRADES.map((g) => <option key={g} value={g}>G{g}</option>)}
            </select>
            <label className="text-[11px] text-muted-foreground">Target</label>
            <select value={targetGrade} onChange={(e) => setTargetGrade(Number(e.target.value))}
              className="px-2 py-1 rounded-md bg-muted text-xs border border-border">
              {GRADES.map((g) => <option key={g} value={g}>G{g}</option>)}
            </select>
          </div>
          <input value={trackName} onChange={(e) => setTrackName(e.target.value)}
            placeholder={`Remedial G${startGrade}→G${targetGrade}`}
            className="w-full px-2 py-1.5 rounded-md bg-muted text-sm border border-border" />
          {candidates === undefined && <div className="h-20 bg-muted rounded-lg animate-pulse" />}
          {candidates && (
            <ul className="space-y-1 max-h-[40vh] overflow-y-auto">
              {candidates.map((c) => (
                <li key={c.unitId}>
                  <button
                    onClick={() => setIncluded((m) => ({ ...m, [c.unitId]: !m[c.unitId] }))}
                    className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg border text-left ${
                      included[c.unitId] ? 'border-primary bg-primary/5' : 'border-border opacity-60'
                    }`}
                  >
                    <span className={`w-4 h-4 rounded flex items-center justify-center shrink-0 ${
                      included[c.unitId] ? 'bg-primary text-primary-foreground' : 'bg-muted'
                    }`}>
                      {included[c.unitId] && <Check className="w-3 h-3" />}
                    </span>
                    <span className="min-w-0 flex-1 text-xs truncate">{c.unitName}</span>
                    <span className="text-[10px] text-muted-foreground shrink-0">
                      G{c.grade}T{c.term} · {(c.importance * 100).toFixed(1)}%
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button onClick={onCreate}
            className="w-full px-3 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-semibold">
            Create track
          </button>
        </div>
      )}

      <div className="space-y-2">
        {tracks === undefined && <div className="h-16 bg-muted rounded-xl animate-pulse" />}
        {tracks?.map((t) => (
          <div key={t._id} className="rounded-xl border border-border bg-card p-3">
            <div className="flex items-center gap-2">
              <Route className="w-4 h-4 text-primary shrink-0" />
              <span className="text-sm font-semibold text-foreground flex-1 truncate">{t.name}</span>
              <span className="text-[10px] text-muted-foreground">L{t.level}</span>
            </div>
            <div className="text-[10px] text-muted-foreground mt-1">
              Target G{t.targetGrade} T{t.targetTerm} · {t.orderedUnitIds.length} units
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
