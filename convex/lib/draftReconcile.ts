// Pure reconcile brain for the planning-mode (draft) timetable. NO Convex
// imports — shared by the timetableDraft mutations (which translate plans into
// db writes) and by vitest. Works on a generic per-table view of rows: every
// row reduces to an id + a fingerprint (fp) of its meaningful fields, and a
// draft row also remembers the live row it was copied from (sourceId, or null
// when it was created fresh inside the draft).
//
// "baseline" = the fingerprint of every live row the draft knew about at the
// last fork/Pull. It is what lets us tell apart "the user edited/deleted this
// in the draft" from "live drifted underneath the draft". See decisions.md.

export type LiveRow = { id: string; fp: string };
export type DraftRow = { id: string; sourceId: string | null; fp: string };
// liveId → fingerprint captured at the last fork or Pull.
export type Baseline = Record<string, string>;

export type MergePlan = {
  // draft rows created fresh (no source) → insert into live.
  creates: DraftRow[];
  // draft rows that changed their live source → patch the live row in place.
  patches: { liveId: string; draft: DraftRow }[];
  // live rows known at baseline but dropped from the draft → delete from live.
  deletes: string[];
  // draft rows whose live source vanished (deleted live since fork) → skipped.
  orphans: DraftRow[];
};

// Merge: project the draft onto the live timetable, preserving identity (and
// therefore all history) by patching sources in place rather than swapping.
export function mergePlan(
  draft: DraftRow[],
  live: LiveRow[],
  baseline: Baseline,
): MergePlan {
  const liveById = new Map(live.map((l) => [l.id, l]));
  const draftSourceIds = new Set(
    draft.map((d) => d.sourceId).filter((s): s is string => s !== null),
  );

  const creates: DraftRow[] = [];
  const patches: { liveId: string; draft: DraftRow }[] = [];
  const orphans: DraftRow[] = [];

  for (const d of draft) {
    if (d.sourceId === null) {
      creates.push(d);
      continue;
    }
    const source = liveById.get(d.sourceId);
    if (!source) {
      orphans.push(d); // source was deleted live since fork — don't resurrect.
      continue;
    }
    if (source.fp !== d.fp) patches.push({ liveId: d.sourceId, draft: d });
  }

  // A live row is deleted only if the draft KNEW about it (baseline) and no
  // draft row still points at it. Live rows created after the last pull are
  // invisible to the draft, so Merge must never delete them.
  const deletes = live
    .filter((l) => l.id in baseline && !draftSourceIds.has(l.id))
    .map((l) => l.id);

  return { creates, patches, deletes, orphans };
}

export type PullPlan = {
  // live rows new since baseline → copy into the draft.
  adds: LiveRow[];
  // unedited draft rows whose live source changed → refresh from live.
  refreshes: { draftId: string; live: LiveRow }[];
  // draft-edited rows → left as-is (the user's work is never overwritten).
  keeps: string[];
  // draft-edited rows whose live source ALSO changed → surfaced to the user.
  conflicts: { draftId: string; liveId: string }[];
};

// Pull: bring current live into the draft without ever clobbering draft edits.
export function pullPlan(
  draft: DraftRow[],
  live: LiveRow[],
  baseline: Baseline,
): PullPlan {
  const draftBySource = new Map<string, DraftRow>();
  for (const d of draft) if (d.sourceId !== null) draftBySource.set(d.sourceId, d);

  const adds: LiveRow[] = [];
  const refreshes: { draftId: string; live: LiveRow }[] = [];
  const keeps: string[] = [];
  const conflicts: { draftId: string; liveId: string }[] = [];

  for (const l of live) {
    const d = draftBySource.get(l.id);
    if (!d) {
      // No draft row maps to this live row. If the draft knew it at baseline
      // the user deleted it on purpose — respect that. Otherwise it's new.
      if (!(l.id in baseline)) adds.push(l);
      continue;
    }
    const base = baseline[l.id];
    const draftEdited = d.fp !== base;
    const liveChanged = l.fp !== base;
    if (!draftEdited) {
      if (liveChanged) refreshes.push({ draftId: d.id, live: l });
    } else {
      keeps.push(d.id);
      if (liveChanged) conflicts.push({ draftId: d.id, liveId: l.id });
    }
  }

  return { adds, refreshes, keeps, conflicts };
}
