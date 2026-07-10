// Shared args builder for api.learningEngine.trackProgress.trackProgressForStudent.
// The backend can't read src/lib/curriculum-data.ts, so the client supplies
// unit metadata + the student's scope unit ids (same pattern as the planner
// calls in src/lib/sheets/scope.ts). Used by the full progress page AND the
// session strip so both surfaces stay in lockstep.

import { CURRICULUM_MODULES } from '@/lib/curriculum-data';
import {
  resolveGradeByModule,
  unitIdsForScope,
  type StudentLite,
} from '@/lib/sheets/scope';

export type TrackProgressUnitMeta = {
  unitId: string;
  unitName: string;
  grade: number;
  term: number;
};

// Static — computed once per module load. Every unit across all modules,
// grades and terms (~a few hundred small rows; fine as query args).
export const ALL_CURRICULUM_UNITS: TrackProgressUnitMeta[] = (() => {
  const out: TrackProgressUnitMeta[] = [];
  for (const mod of CURRICULUM_MODULES) {
    for (const g of mod.grades) {
      for (const t of g.terms) {
        for (const u of t.units) {
          out.push({ unitId: u.id, unitName: u.name, grade: g.grade, term: t.term });
        }
      }
    }
  }
  return out;
})();

export function buildTrackProgressArgs(student: StudentLite): {
  units: TrackProgressUnitMeta[];
  scopeUnitIds: string[];
} {
  return {
    units: ALL_CURRICULUM_UNITS,
    scopeUnitIds: unitIdsForScope(resolveGradeByModule(student)),
  };
}
