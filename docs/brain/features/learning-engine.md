# Learning engine — the moat (/algorithm + convex/learningEngine)

THE priority area (purpose.md): the algorithm guaranteeing "A result within
predicted time". Plans (root, NEVER delete): `learning_engine_plan.md` +
`algorithm_plan.md`. Phases A–D shipped; validated via cumulative-exam holdouts.

## The loop (per student, per session)
1. **Memory model** (`memory.ts`) — FSRS-like per-concept S + D in
   `memoryState`; each scored question updates every tagged concept ("good"
   grows S ×lag-bonus, "again" decays, "skipped" no-op; weights ×0.8–1.6 by
   difficulty). Constants in `config.ts`; mastery = f(S, D) in `mastery.ts`.
2. **Planner** (`planner.ts`, 2309 lines — the heart):
   - D.1 pool: in-scope concepts, prerequisites met, question outside
     NOVELTY_COOLDOWN_DAYS. D.2 transparent 5-factor score (weights in
     config.ts): importance, urgency (1−retrievability + overdue boost), fit
     (Gaussian), novelty (hard-filtered), proximity (exam distance).
   - COVERAGE LADDER = THE DEFAULT (2026-07-14, toggle retired): fit is
     overridden per concept by the easy→hard ladder over UNSEEN questions
     (`coverageMode.ts`, pure + tested) — finish the book, no repeats; seen
     damped ×0.25; too-hard tail (>skill+2) deferred; SR untouched. Fallback:
     learningMode="consolidation" (student progress page) restores Gaussian
     fit + repeats; engineAlerts.ts cron suggests flips (weighted fail-rate,
     40%/20% hysteresis, consolidationCore.ts).
   - D.3 slots: warm-up OFF-module, Main ON-module (by TRACK), exam-prep
     module-agnostic past papers. Adaptive sheet length; `plannerGaps`
     surfaces zero-candidate concepts (never blocks). D.6 `scoringSnapshot`
     stores factor values — "why this question?" reads these, never re-derives.
3. **Scoring** (`scoring.ts`) — marks → applyAttempt per question → memory +
   points; single entry point finalizeSheetScoring.

## Control panels
- `/planner` (nav, 2026-07-15) — THE global planning page, 6 tabs; backend
  `plannerBoard.ts` (nav slot freed → leaderboard link in /students). Term:
  exam countdown + per-group CAPACITY PLAN (demand vs sessions, exact fix) +
  runway cards + crystallize one/all. Calendar: per-group day-grid to exam
  (unit/state, Revision slots, cancelled days, levers). Forecast: grade rollup.
  Tracks + Exams (from /algorithm; grade×term grid + Quick entry).
- Sheets tab = the CONTROL ROOM (2026-07-16; sessions redesign 2026-07-18):
  "Run all term sheets" (crystallize, 180d cap) + "Re-plan"; bank-dry banner;
  Coverage % strip + TERM CHIPS (set covTerm for the week grids — never
  remove). Timeline = metro-line master/detail (rules in decisions.md): week
  ring-station rail + sticky SESSION-CENTRIC card — session chips (PDF
  preview + ↻ assign; NO "+ session", capacity comes from the Revision
  timetable), unit chips + "+ unit", physical A4 sheets (2 printed pages =
  1 paper; `groupSheetPages`, estimator convex/lib/sheetLayout.ts MUST match
  pdf.ts), book-order grid, 7+7 day strip. Unit name → GROUP LESSON BUILDER
  (`group-lesson-builder.tsx`, SHARED grid via
  `components/lesson/lesson-question-grid.tsx`): Main + TIMELINE tabs
  (2026-07-19; Revision tab retired — Main shows ALL, yellow ticks inline);
  tap tile = tick/untick (ban), tap chip = GREEN↔YELLOW route
  (`groupQuestionRoutes`, manual never auto-overwritten). Timeline tab
  (`group-unit-timeline.tsx` + `groupUnitTimeline`) = week rows of day pills:
  teal Main = REAL sheet dates, amber dashed = SR-PREDICTED revision days;
  tap a day = questions by concept, rings mark concept-sharing days;
  "waiting" = intro unscheduled / revision days ran out. "+ unit" = UNIT
  COMPRESSION (`compression-dialog.tsx`): intros + hardest ~20% stay green,
  middle drill flips yellow, then re-plan.
- `/algorithm` — Coverage = TWO LENSES (2026-07-17): GROUPS = the Cockpit
  (cheap all-group rail `groupsTermCoverageSummary`; the tapped group pays for
  `groupTermCoverage`), BANK = concept stock; book-gap bridges Groups→Bank.
  Plus Blueprint, Path. `/algorithm/exam-calendar` — exam mode MANUAL
  (`examModeActive` + alert cron); `/algorithm/scoring` — `difficultyTab.ts`.

## Supporting modules
`profile.ts` scope/profile; `path.ts`/`tracks.ts`; `importance.ts`/
`derivedConcepts.ts` importance + tagging; `cropIntegrity.ts`; `pdf.ts`+
`pdfHelpers.ts` (pdf-lib); `leagues.ts`/`map.ts`/`studentDashboard.ts` →
tracks-leaderboard.md. UNWIRED: `backfill.ts`; `config.ts`/`mastery.ts`/
`memory.ts` direct-import (see legacy-map).

## Departments: group Main plan + Revision queues (2026-07-14)
`groupPlan.ts` + pure `groupPlanCore.ts` (tested): Main block = ONE identical
group-level sheet; bookmark = DERIVED union (groupSheets + members'
generatedSheets), never stored; skeleton = lesson plan to exam,
CANCELLATION-AWARE. crystallizeUpcoming writes groupSheets (unseen ladder,
textbook then capped past-paper tail, scanBookExhaustion cron; spiral =
unseen past-unit Qs, weakest group-avg R first); Sheets tab materializes per
student via mainQuestionIdsOverride. Revision dept (sessionType="revision"):
queues = group-claimed-but-unseen Qs (delegation + absence catch-up, ONE
rule, cap 10) + ROUTED yellow Qs (groupQuestionRoutes — out of Main
demand/coverage; ban wins, seen wins), SR-ORDERED 2026-07-19 (pure
`convex/lib/revisionSR.ts`, tested): due = all tagged concepts introduced +
REVISION_ROUTE_MIN_GAP_DAYS since last review, weakest R first, easy→hard
tie-break; un-introduced HELD BACK (revision teachers drill, never teach),
inside-gap = top-up only; the Timeline prediction runs the SAME functions →
forecast = print. Consolidation students stay personal. Tuning:
mainQuestionsPerSession (3–15), resizePlanned, groupCarryOvers (tail → next
Main FIRST or per-member revision queue; deletePlanned un-consumes; bookmark
never un-seen). Book-gap honesty: zero-question units = "no-questions" never
"done"; exercise deletes cascade to crops. STARTING POINT: groupPreTaughtUnits
= reversible track-prefix bookmark, no sheet/point/memory effects; UI
/groups/[id]/plan + StartingPointButton.

## Per-student views
- Coverage forecast advisor (2026-07-14): `coverageForecast.ts` + pure tested
  core — per unit: pool, seen, 14d pace, capacity to each exam → projected %
  + verdict; TERM-AWARE (only units with an UPCOMING exam compete). UI:
  /students/[id]/progress + /planner Forecast rollup (same core).
- Track Progress (2026-07-10): `trackProgress.ts`; pure `trackProgressCore.ts`
  MUST mirror planner pacing; completion credits ≤48h.

## Rules for changing the engine
Read BOTH plan files first; behaviour must match algorithm_plan.md blocks.
Constants ONLY in config.ts; scorer stays module-blind (slots are D.3); keep
every factor exposed. repeatCount is a TEMPORARY stopgap — don't deepen it.
