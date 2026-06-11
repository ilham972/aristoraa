# Progression: tracks, points, leaderboard, leagues

## The transition you MUST understand first
Two progression systems coexist BY DESIGN (not dead code):
- **Legacy points** — live and primary today: `/leaderboard` +` /progress`
  compute from `api.entries.list` + `api.exercises.list` client-side
  (`src/lib/scoring.ts` — its 12 unused exports are older remnants of this
  same system's previous iteration).
- **Track model (P1–P4, SHIPPED but not primary)** — named cross-grade tracks
  ("levels") with promotions, leagues and a railway map. Controlled by flag
  **`LEADERBOARD_PRIMARY` in `convex/learningEngine/config.ts`, currently
  `'legacy'`**. Founder-gated before flip: track seed + backfill on prod
  (`learningEngine/backfill.ts`), then flag flip, then runtime test.
Never "clean up" either system until the flag flips and legacy is retired.

## Track model surfaces
- `/leaderboard/leagues` — cohort leaderboard, promotion candidates,
  promoteStudent (`convex/learningEngine/leagues.ts`).
- Railway map — `src/components/algorithm/railway-map.tsx` (+ share, picker,
  tracks-tab) reading `api.learningEngine.map/tracks`; rendered inside
  /algorithm, styled like a transit map (founder's design taste).
- Tables: `tracks`, `promotions`, `sessionPoints` (current points store).
- Track ALSO drives the sheet Main block since the exam-mode change — the
  track is becoming the app's progression backbone, not just leaderboard.

## Legacy surfaces (until flag flip)
- `/leaderboard` — points ranking; `/progress` — per-student unit progress;
  both pure client computations over entries/exercises.
- `src/lib/leaderboard-link.ts` + `src/components/navigation.tsx` route the
  nav entry to legacy or leagues based on the flag.

## /curriculum
Exercise/unit management page (add/remove exercises, sub-questions, concept
tagging via `api.exercises.*`). It feeds the OLD exercise-based system AND
provides concept tags consumed by the engine. Mixed-era page: parts serve the
legacy path, parts are current infrastructure. Be careful attributing it.

## Known dead weight here
- `src/components/learning/student-league-card.tsx` — unwired league UI draft.
- `src/components/position-dialog.tsx`, `src/lib/store.ts` — old position
  system leftovers (knip). `studentModulePositions` convex module: zero
  callers — superseded by track/path position.

## Founder-gated checklist (the only remaining track-model work)
1. `npx convex run learningEngine/backfill:...` on prod (seed tracks + map
   students). 2. Flip `LEADERBOARD_PRIMARY` to `'tracks'`. 3. Runtime test on
   prod with real data. Then: retire legacy leaderboard surfaces + lib/scoring
   remnants (add to legacy-map when done).
