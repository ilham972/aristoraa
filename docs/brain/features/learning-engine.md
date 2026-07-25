# Learning engine — the moat (/algorithm + convex/learningEngine)

THE priority area (purpose.md): the algorithm guaranteeing "A result within
predicted time". Plans (root, NEVER delete): `learning_engine_plan.md` +
`algorithm_plan.md`. A–D shipped (cumulative-exam holdout validated).
CHANGING IT: read BOTH plan files first, match algorithm_plan.md blocks;
constants ONLY in config.ts; scorer stays module-blind; repeatCount = TEMPORARY.

## The loop (per student, per session)
1. **Memory model** (`memory.ts`) — FSRS-like per-concept S + D in
   `memoryState`; each scored question updates every tagged concept ("good"
   grows S ×lag-bonus, "again" decays, "skipped" no-op; weights ×0.8–1.6 by
   difficulty). Constants `config.ts`; mastery = f(S,D) in `mastery.ts`.
2. **Planner** (`planner.ts`, 2309 lines — the heart). D.1 pool: in-scope
   concepts, prereqs met, outside NOVELTY_COOLDOWN_DAYS. D.2 transparent
   5-factor score (config.ts): importance, urgency (1−R + overdue), fit,
   novelty, proximity. COVERAGE LADDER = THE DEFAULT (2026-07-14, toggle
   retired): fit is overridden per concept by the easy→hard ladder over UNSEEN
   questions (`coverageMode.ts`, pure+tested) — finish the book, no repeats;
   seen damped ×0.25; too-hard tail (>skill+2) deferred; SR untouched. Fallback
   learningMode="consolidation" restores Gaussian fit + repeats (engineAlerts
   cron suggests flips, 40%/20% hysteresis). D.3 slots: warm-up OFF-module,
   Main ON-module (by TRACK), exam-prep past papers; adaptive length;
   `plannerGaps` surfaces zero-candidate concepts. D.6 `scoringSnapshot` stores
   factor values — "why this question?" reads these, never re-derives.
3. **Scoring** (`scoring.ts`) — marks → applyAttempt → memory + points; ONE
   entry point, finalizeSheetScoring.

## Control panels
- `/planner` (nav, 2026-07-15) — THE global planning page, 6 tabs; backend
  `plannerBoard.ts`. Term: exam countdown + per-group CAPACITY PLAN + runway
  cards + crystallize. Calendar: per-group day-grid. Forecast: grade rollup.
- Sheets tab = the CONTROL ROOM (2026-07-16; redesign 2026-07-18): "Run all
  term sheets" (crystallize, 180d) + "Re-plan" = ATOMIC `replanTerm`
  (2026-07-25, all 4 surfaces; never revert to the delete+crystallize pair — it
  lost sheets on failure); bank-dry banner; Coverage % + TERM CHIPS (covTerm
  FOLLOWS the tapped week/session); Interleaving section (below). Timeline =
  metro master/detail (decisions.md): week ring rail + sticky SESSION-CENTRIC
  card (PDF preview + ↻ assign-to-revision; "+ unit" compression; A4 pills via
  `groupSheetPages`, estimator lib/sheetLayout.ts MUST match pdf.ts). Unit name
  → GROUP LESSON BUILDER (`group-lesson-builder.tsx`, shared
  `lesson/lesson-question-grid.tsx`); tap tile=tick, tap chip=GREEN↔YELLOW.
- Curate tab (`global-curate.tsx`, 2026-07-25) — GLOBAL 3-color curation:
  grade→unit→concept grid; `questionBank.sessionRole` green/yellow/blue +
  `excludedFromPlan`, ONE decision per question for ALL groups (tap=cycle,
  long-press=exclude, drag=difficulty, auto-save); global role overrides
  autoMiddleSplit in loadGroupPlanState (decisions.md).
- INTERLEAVING (Phase B, 2026-07-26) — pure tested `lib/interleaveCore.ts`;
  `runInterleavePlan` feeds it and EVERY writer (crystallize, resize,
  addPlannedSheet) + the board query run it → preview = print. GREEN = whole
  run in book order (Curate already thinned it), stop at the cap. OPEN SET
  ≤GROUP_OPEN_UNITS_CAP units (opens only when an earlier one's green ends);
  GROUP_UNITS_PER_SESSION per session, ranked staleness → weakest avg-R → track
  order; exam inside UNIT_DEADLINE_URGENT_DAYS jumps the queue. BLUE returns
  BLUE_GAP_AFTER_YELLOW_DAYS after its concept's yellow is drilled (no yellow →
  intro + BLUE_GAP_NO_YELLOW_DAYS; yellow unscheduled → waits forever, BY
  DECISION). GROUP_RETURN_SHARE = blue first, spiral top-up; overflow queues
  (never eats green), unfillable slots go back to green. Glass box = Sheets-tab
  "Interleaving" (`interleave-board.tsx`, `groupInterleaveBoard`): unit×session
  weave, why-chips, group levers, per-date `groupSessionPlans` overrides (units
  / green = truncate point / returns / pinned) beating the ranking, surviving
  re-plan.
- `/algorithm` — Coverage = TWO LENSES (2026-07-17): GROUPS = the Cockpit
  (cheap rail `groupsTermCoverageSummary`; the tapped group pays for
  `groupTermCoverage`), BANK = concept stock; book-gap bridges Groups→Bank.
  Plus Blueprint, Path. `/exam-calendar` = MANUAL exam mode (`examModeActive`
  + cron); `/scoring` = `difficultyTab.ts`.

Supporting: `profile.ts`; `path.ts`/`tracks.ts`; `importance.ts`/
`derivedConcepts.ts`; `cropIntegrity.ts`; `pdf.ts`+`pdfHelpers.ts` (pdf-lib);
`leagues.ts`/`map.ts`/`studentDashboard.ts`; UNWIRED `backfill.ts`.
## Departments: group Main plan + Revision queues (2026-07-14)
`groupPlan.ts` + pure `groupPlanCore.ts` (tested): Main block = ONE identical
group sheet; bookmark = DERIVED union (groupSheets + members' generatedSheets),
never stored; skeleton = lesson plan to exam, CANCELLATION-AWARE.
crystallizeUpcoming writes groupSheets via the Phase-B interleaver above
(scanBookExhaustion cron); Sheets tab materializes per student via
mainQuestionIdsOverride. Revision dept ("revision" slots) queues =
group-claimed-but-unseen Qs (delegation + absence catch-up, cap 10) + ROUTED
yellow (groupQuestionRoutes — out of Main demand; ban wins, seen wins). YELLOW
IS THE MIDDLE'S DEFAULT (2026-07-19, `autoMiddleSplit` in pure `revisionSR.ts`,
tested): DERIVED in loadGroupPlanState, never stored — per concept the intro +
hardest ~REVISION_HARD_TAIL_SHARE of families stay Main, middle families AND
middle subs of kept families go yellow; stored routes + global Curate colors
win; no revision capacity → no split. Serving is SR-ORDERED: due = introduced +
REVISION_ROUTE_MIN_GAP_DAYS since last review, weakest R first, easy→hard;
un-introduced HELD BACK (revision teachers drill, never teach); Timeline +
interleaver run the SAME functions → forecast = print. Consolidation students
stay personal. Tuning: mainQuestionsPerSession (3–15), resizePlanned,
groupCarryOvers (tail → next Main FIRST or per-member revision queue;
deletePlanned un-consumes); groupPreTaughtUnits = reversible starting point.
Zero-question units = "no-questions" ≠ "done".

## Per-student views
- Coverage forecast advisor (2026-07-14): `coverageForecast.ts` + pure tested
  core — per unit: pool, seen, 14d pace, capacity to each exam → projected % +
  verdict; TERM-AWARE (only units with an UPCOMING exam compete). UI:
  /students/[id]/progress + /planner Forecast rollup (same core).
- Track Progress (2026-07-10): `trackProgress.ts`; `trackProgressCore.ts` MUST
  mirror planner pacing; completions credit ≤48h (tracks-leaderboard.md).
