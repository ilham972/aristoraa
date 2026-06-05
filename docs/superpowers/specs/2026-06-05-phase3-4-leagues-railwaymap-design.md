# Phases 3 + 4 — Cohort Leagues + Railway Map (Final Single-Agent Brief)

> **This file is a complete, self-contained brief for ONE agent to build the LAST two phases in a single pass: Phase 3 (cohort leaderboard + promotion/leagues) and Phase 4 (railway-map visualization + parent share).** Everything here is **additive** — it must NOT change the live public leaderboard or any existing surface until the founder throws the switch. Read this whole file, then skim the three prior specs in `docs/superpowers/specs/` for context. Build Phase 3 then Phase 4. Report to the orchestrator when done; do NOT deploy, do NOT run mutations.

---

## 0. Agent execution rules (read first)

- **Branch:** your own git worktree off `feat/track-model-phase1` (it now contains Phases 1 + 2). One commit per numbered task, messages `feat(league-X)` / `feat(map-X)`.
- **Convex:** only deployment is prod `loris` (rapid-loris-309). Use it for `npx convex codegen` + typecheck ONLY. **Run NO mutation, NO `convex deploy`, NO deploy.** You write code; the founder + orchestrator run data and deploy.
- **Verify after every task:** `npx tsc --noEmit -p tsconfig.json` AND `npx tsc --noEmit -p convex/tsconfig.json` both exit 0. Then `npm run build` must pass before you call the whole thing done. No test framework exists — do not add one.
- **Hard additive boundary (the safety of this build):** Do NOT modify `src/app/leaderboard/page.tsx`, `src/lib/scoring.ts` existing exports, the legacy Score tab, the `entries` table, or the position dialog. All new ranking + the map live on NEW surfaces. The public board only changes when the founder flips a flag (§Phase3.6).
- **Reuse, don't reinvent:** mastery comes from `convex/learningEngine/mastery.ts` (`masteryFromState`/`masteryFor`); tracks from `convex/learningEngine/tracks.ts` (`resolveTrackForStudent`, `listTracks`); points from `sessionPoints` (Phase 2); the leaderboard image-export pattern is in `src/app/leaderboard/page.tsx` (`downloadImage` canvas code) — reuse it for the parent share.

---

## 1. Context — where this sits

Phase 1 put every student on a **track** (an ordered, cross-grade list of curriculum units; `tracks.orderedUnitIds`, `students.trackId`). Phase 2 made sheet scoring feed the engine (`memoryState`) and compute `sessionPoints` (pointsOld triangular + pointsNew difficulty×section). Now:

- **Phase 3 makes competition fair:** rank students **within their track** (their "league"), not their grade — so a remedial student competes with true peers and can win. Completing a track **promotes** them up a level (merge into the next track).
- **Phase 4 makes it visible:** a **railway map** — tracks are train lines, units are stations, lines branch and merge across grades, and each student is a marker showing where they are and where they're heading. Shareable to parents ("your child is here").

This is the moat: no tuition shows a child's personalized catch-up journey as a living map.

---

## 2. Locked decisions (resolved — do not re-litigate)

1. **Cohort = track.** The leaderboard groups by `trackId` and ranks within it. Students with no track (legacy) group under a "No track" bucket.
2. **Within-track ranking metric = `sessionPoints.pointsNew`** summed over the period (the difficulty×section "effort + challenge" score). Track **progress** (stations cleared) is shown as a secondary stat, not the rank key.
3. **A unit is "cleared"** when every concept-type exercise in it has `mastery ≥ MASTERY_THRESHOLD` (0.75, already in `config.ts`). **Track progress** = count of cleared units along `orderedUnitIds`, scanning from the start until the first not-cleared unit (the student's current **station**).
4. **Completion = all units in `orderedUnitIds` cleared.** On completion, if `track.mergesIntoTrackId` is set, the student becomes a **promotion candidate**.
5. **Promotion is human-gated, not automatic.** The system flags candidates; a teacher promotes with one click (reuses `setStudentTrack(studentId, mergesIntoTrackId)`). Log every promotion.
6. **Additive:** new ranking + map are NEW surfaces. The public `/leaderboard` is untouched until the founder flips `LEADERBOARD_PRIMARY` (§Phase3.6).
7. Mobile-first, dark-navy + teal. Tamil unit names render as-is.

---

# PHASE 3 — Cohort leagues + promotion

## 3.1 Schema (additive)
```ts
// convex/schema.ts — promotion audit log (the only new table in Phase 3).
promotions: defineTable({
  studentId: v.id("students"),
  fromTrackId: v.optional(v.id("tracks")),
  toTrackId: v.id("tracks"),
  reason: v.string(),                 // "completed-track" | "manual"
  byTeacherId: v.optional(v.id("teachers")),
  at: v.number(),
}).index("by_student", ["studentId"]).index("by_track", ["toTrackId"]),

// config.ts — make the public board source switchable (default keeps today's behaviour).
export const LEADERBOARD_PRIMARY: "legacy" | "cohort" = "legacy";
```

## 3.2 Backend — `convex/learningEngine/leagues.ts` (new)
```
trackProgressForStudent(studentId) -> { trackId, trackName, totalUnits, clearedUnits,
    currentUnitId, currentUnitName, pctCleared, isComplete }
  - resolve track via resolveTrackForStudent; if none → null.
  - load masteryAll(studentId) (reuse mastery.ts batch read).
  - for each unitId in orderedUnitIds in order: unit is cleared iff every concept-type
    exercise in that unit has mastery >= MASTERY_THRESHOLD. Stop at first uncleared = current station.
  - isComplete = all cleared.

cohortLeaderboard(period, dates, trackId?) -> per track: ranked students by
    Σ sessionPoints.pointsNew over `dates`, each with {studentId, name, pointsNew,
    pointsOld, clearedUnits, totalUnits}. Group by trackId; sort tracks by level.
  - read sessionPoints by_student_date for the period (reuse the index).
  - DO NOT read or modify the legacy entries leaderboard.

promotionCandidates() -> students whose trackProgressForStudent.isComplete && track.mergesIntoTrackId set,
    with {studentId, name, fromTrack, toTrack}.

promoteStudent(studentId, reason) [mutation, auth-guarded] ->
    track = resolveTrackForStudent(student); if !track?.mergesIntoTrackId → throw.
    insert promotions row; patch student.trackId = track.mergesIntoTrackId. (reuses the
    same patch as setStudentTrack — do not duplicate auth logic; import or mirror it.)
```

## 3.3 UI — Leagues board (new surface, additive)
- New page `src/app/leaderboard/leagues/page.tsx` (NOT the existing `/leaderboard`). Period toggle (daily/weekly/monthly) + center filter, mirroring `/leaderboard`'s controls.
- Renders one card-section per track (league), ordered by level: header = track name + "League", then ranked students (rank chip, name, `pointsNew`, and a small `clearedUnits/totalUnits` progress pill). Top-3 styling like the existing board.
- A "Promotions" strip at the top: `promotionCandidates()` list, each with a one-tap **Promote → {toTrack}** button calling `promoteStudent`. Confirm dialog. Toast on success.
- Reuse the canvas `downloadImage` pattern from `/leaderboard` for a per-league shareable PNG.

## 3.4 Per-student league widget
- Small component `src/components/learning/student-league-card.tsx`: given a studentId, shows their league name, rank within it, progress (cleared/total stations), and "next league" (mergesIntoTrackId name) if any. Mountable on the student detail / Lead dashboard. Read-only.

## 3.5 Edge cases
- Student with no track → appears in a "No track (legacy)" league; no promotion.
- Track with `mergesIntoTrackId` pointing at inactive/deleted track → not a promotion candidate.
- Completed track but no merge target → show "Top of track" badge, no promote button.
- Period with no `sessionPoints` rows yet → league shows students at 0 pts (still grouped), progress still computed from mastery.
- Cumulative clearing: a unit with zero concept-type exercises counts as cleared (nothing to master) — skip it, don't block progress.

## 3.6 Public-board switch (BUILD the switch, do NOT flip it)
- Add the `LEADERBOARD_PRIMARY` flag (§3.1). Build a thin branch so that WHEN set to `"cohort"`, navigation/links point to the leagues board as primary. **Leave it `"legacy"`** — the founder flips it after the parallel-run. Do not alter `/leaderboard` itself.

## 3.7 Verification (Phase 3)
1. `trackProgressForStudent` on a student with some mastery returns sane cleared/total + a current station.
2. `cohortLeaderboard` groups students by track and ranks by pointsNew; legacy `/leaderboard` still renders identically.
3. Mark a synthetic student's whole track mastered (via existing engine data) → they appear in `promotionCandidates`; `promoteStudent` moves their trackId + writes a `promotions` row (verify by argument, since you can't run mutations — argue from code).
4. Both typechecks + build pass.

---

# PHASE 4 — Railway map + parent share

## 4.1 Concept
Tracks form a DAG via `mergesIntoTrackId` (edge: track → the track it merges into). Render each track as a **horizontal line of station-nodes** (its `orderedUnitIds`), grades shaded along the line. Where track A merges into track B, draw a **connector** from A's last station to the station in B where the merge lands (B's first station whose unit id matches, else B's start). A student is a **marker** on their track at their current station (from `trackProgressForStudent`). Cleared stations = filled/teal, current = pulsing ring, ahead = muted. This is the "train map".

## 4.2 Backend — `convex/learningEngine/map.ts` (new, read-only)
```
trackMap() -> {
  tracks: [{ trackId, name, level, targetGrade, orderedUnitIds:[{unitId, unitName, grade, term}],
             mergesIntoTrackId }],
  merges: [{ fromTrackId, toTrackId, joinUnitId }]
}
  - client passes unit metadata for names/grade/term (Convex can't read curriculum-data.ts —
    follow the path.ts convention: accept a units lookup arg, or resolve names client-side).
  - joinUnitId = first orderedUnitId of toTrack that also appears in fromTrack's tail, else toTrack[0].

studentMapPosition(studentId) -> { trackId, currentUnitId, clearedUnitIds:[...], isComplete }
  (thin wrapper over trackProgressForStudent returning the per-station cleared set).
```

## 4.3 UI — the map (Path sub-tab)
- Add a sub-tab toggle inside the algorithm **Path** area: `Path | Map` (the founder asked for a sub-tab in the Path tab). New component `src/components/algorithm/railway-map.tsx`.
- **Render with inline SVG** (scalable, tappable; mobile-first). Each track = a row; stations = circles spaced along it, colored by the *selected student's* mastery (cleared=teal fill, current=ring, ahead=muted outline); grade bands labeled; merge connectors as curved SVG paths between rows. A student picker at top drives whose position shows.
- Tap a station → small popover: unit name, grade/term, cleared/at/ahead.
- Keep it legible: horizontal scroll for long tracks; one track per row; merges drawn as curves into the target row.

## 4.4 Parent share
- A "Share for parent" button on the map (with a student selected) renders a **PNG** via canvas (reuse `/leaderboard` `downloadImage` pattern): the student's own track line as a simple railway, their position marker ("You are here"), cleared/total stations, target exam (from `examCalendar` at track.targetGrade/targetTerm), and any promotion history (from `promotions`). Aristora brand mark + dark-navy/teal. One tap → downloadable PNG for WhatsApp.

## 4.5 Edge cases
- Track with 1 unit → single station; still renders.
- Student with no track → map shows tracks but no marker; picker note "no track assigned".
- Merge target missing/inactive → draw the line without a connector; no crash.
- Very long track (30+ units) → horizontal scroll; stations stay tappable.
- Mobile: single column, each track row scrolls horizontally; share PNG sized for phone screens.

## 4.6 Verification (Phase 4)
1. `/algorithm` → Path tab → Map sub-tab renders the seeded On-level tracks as lines with stations; a remedial track shows as a shorter line merging into its target.
2. Pick a student with mastery → their cleared stations are teal, current station ringed.
3. "Share for parent" downloads a PNG with the student's line, position, target exam, brand mark.
4. Both typechecks + `npm run build` pass.

---

## 5. Build order (one pass)
1. P3 schema (`promotions`, `LEADERBOARD_PRIMARY`) → codegen → BE tsc. Commit.
2. P3 `leagues.ts` (trackProgressForStudent, cohortLeaderboard, promotionCandidates, promoteStudent) → BE tsc. Commit.
3. P3 leagues page + per-student league card → FE tsc. Commit.
4. P4 `map.ts` (trackMap, studentMapPosition) → BE tsc. Commit.
5. P4 railway-map SVG component + Path sub-tab wiring → FE tsc. Commit.
6. P4 parent-share PNG → FE tsc. Commit.
7. Final: both typechecks + `npm run build` green; report to orchestrator with the §3.7 + §4.6 proofs argued from code (you can't run mutations).

---

## 6. Explicit DO-NOT (founder-gated, NOT in this build)
- Do NOT flip `LEADERBOARD_PRIMARY` to "cohort" or modify `/leaderboard`.
- Do NOT auto-promote students (human-gated only).
- Do NOT switch the public points formula (pointsOld→pointsNew) — that flag is the founder's.
- Do NOT delete or alter `entries`, the legacy Score tab, or position.
- Do NOT deploy or run mutations.

---

## 7. Honest note for the orchestrator (me) at review time
The railway map (Phase 4) is the most novel + visual piece and the highest risk in a "build everything at once" run. At review I will: read `railway-map.tsx` for legibility + the SVG merge-geometry; confirm `trackProgressForStudent` clears units correctly (off-by-one on the "current station" scan is the likely bug); verify the parent PNG renders real data; and confirm every §6 DO-NOT held. If the map quality is weak, it gets a focused polish pass — it's the moat artifact, it earns the extra care.
