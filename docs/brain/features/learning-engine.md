# Learning engine — the moat (/algorithm + convex/learningEngine)

THE priority area (purpose.md): the algorithm that guarantees "A result within
predicted time". Current plans (root, NEVER delete): `learning_engine_plan.md`
(strategy) + `algorithm_plan.md` (phases). Phases A–D shipped; validated via
cumulative-exam holdouts.

## The loop (per student, per session)
1. **Memory model** (`memory.ts`) — FSRS-like per-concept state in
   `memoryState`: stability S + difficulty D. Each scored question updates
   every tagged concept ("good": S grows ×lag-bonus, "again": S decays;
   weights scale 0.8–1.6 with question difficulty 1–5; "skipped": no-op).
   All constants in `config.ts`. Mastery = f(S, D) in `mastery.ts`.
2. **Planner** (`planner.ts`, 2309 lines — the heart):
   - D.1 candidate pool: in-scope concepts, no unmet prerequisites, question
     not used within NOVELTY_COOLDOWN_DAYS.
   - D.2 transparent 5-factor score (weights in config.ts): importance,
     urgency (1−retrievability, overdue boost), fit (Gaussian difficulty↔skill
     match), novelty (hard-filtered, factor kept for future soft-novelty),
     proximity (days to exam via examCalendar).
   - COVERAGE LADDER = THE DEFAULT (departments redesign 2026-07-14; the
     one-day global toggle is retired): fit is OVERRIDDEN per concept by the
     easy→hard ladder over UNSEEN questions (coverageMode.ts, pure + tested)
     — finish the book, no repeats; seen Qs damped ×0.25; too-hard tail
     (>skill+2) deferred. SR timing untouched. fitOverride/Reason in the
     scoringSnapshot. Per-student fallback: students.learningMode =
     "consolidation" (manual switch on /students/[id]/progress) returns THAT
     student to Gaussian fit + repeats; daily engineAlerts.ts cron suggests
     flips both ways (weighted fail-rate, enter 40% / exit 20% hysteresis,
     pure math in convex/lib/consolidationCore.ts).
   - D.3 slot allocator: warm-up = OFF-module, Main block = ON-module —
     driven by TRACK since the exam-mode change (not teachingPath) —
     exam-prep = module-agnostic, targets near-mastered via past papers.
   - Adaptive sheet length: grows/shrinks with completion rate history.
   - `plannerGaps` surfaces concepts with zero candidates (never blocks).
   - D.6 `scoringSnapshot` stores per-question factor values for audit — the
     Lead "why this question?" tooltip reads these, never re-derives.
3. **Scoring** (`scoring.ts`) — sheet marks → `applyAttempt` per question →
   memory updates + points. Single entry point: finalizeSheetScoring.

## Control panels
- `/planner` (nav, 2026-07-15) — THE global planning page, 5 tabs: Term
  (grade → exam countdown + per-group CAPACITY PLAN: demand-vs-sessions
  fits/short block with the exact fix — extra sessions or delegable backlog
  — from groupLessonPlan.examPlan; runway cards; crystallize one/all),
  Calendar (per-group scheme-of-work day-grid to exam day: unit per session,
  crystallized state, Revision slots, cancelled days, tap-day sheet with
  delegate/un-plan — `groupPlan.groupTermCalendar`), Forecast (grade-wide
  student coverage rollup), Tracks + Exams (moved FROM /algorithm). Exams
  tab = grade×term grid per year (+ global Quick entry). Backend
  `plannerBoard.ts` (light `plannerGroups`; `gradeForecastRollup` = ONE pool
  walk per track). Board nav slot freed → leaderboard link in /students.
- `/algorithm` — inspection only: Coverage, Blueprint, Path (stale
  ?tab=tracks|exams redirect to /planner).
- `/algorithm/exam-calendar` — standalone page; **exam mode is MANUAL**:
  `examModeActive` switch + daily alert cron (`calendar.ts`).
- `/algorithm/scoring` — factor weight inspection (`difficultyTab.ts`).

## Supporting modules
- `profile.ts` — studied-scope + per-concept profile (the planner's input).
- `path.ts` / `tracks.ts` — teaching path & track resolution (domain.md).
- `importance.ts` / `derivedConcepts.ts` — concept importance (Phase B) +
  question↔concept tagging graph. `cropIntegrity.ts` — crop validation tool.
- `pdf.ts` (1230) + `pdfHelpers.ts` — sheet PDF rendering (pdf-lib).
- `leagues.ts`, `map.ts`, `studentDashboard.ts` — see tracks-leaderboard.md.
- UNWIRED: `backfill.ts` (one-off A.4 backfill tool — founder-gated track
  seeding step may still need it), `config.ts` has no api callers by design
  (direct-import constants), `mastery.ts`/`memory.ts` likewise direct-import.

## Departments: group Main plan + Revision queues (2026-07-14)
`groupPlan.ts` + pure `convex/lib/groupPlanCore.ts` (tested): the Main block
of a group session is ONE identical sheet planned at group level. Bookmark =
DERIVED union (groupSheets rows + members' generatedSheets), never stored.
Skeleton query = lesson plan to exam day (unit per session, finish-vs-exam
verdicts); crystallizeUpcoming writes groupSheets rows ~7d ahead (new = next
unseen ladder of current unit — textbook first, then capped past-paper tail,
alert cron scanBookExhaustion at the boundary; spiral = unseen Qs from past
units, weakest group-avg R first). Sheets tab materializes rows per student
via mainQuestionIdsOverride (PDF/scoring/memory unchanged). Revision dept:
scheduleSlots.sessionType="revision"; queues = group-claimed-but-unseen Qs
(delegation + absence catch-up, ONE rule, cap 10); consolidation students
get the fully-personal planner instead. UI: /groups/[id]/plan (redesigned
2026-07-15: one runway strip + locked-in rows + unit-SPAN projection) +
/planner Term board + Calendar. Heavy walks batched with Promise.all.
Skeleton is CANCELLATION-AWARE (2026-07-15): dates whose representative
slot has a sessionLogs `cancelled_by_tutor` row are skipped — the plan
reflows past them and crystallize never writes onto a cancelled day.
Tuning levers (2026-07-15, all on the /planner Calendar): per-group
`groups.mainQuestionsPerSession` (setGroupMainQuestions, clamp 3–15);
`resizePlanned` re-picks ONE planned sheet with a new count; leftover log
`groupCarryOvers` (carryOverLeftover: last-N tail of a materialized sheet →
target "main" = next crystallize serves them FIRST then stamps consumedAt,
target "revision" = one row per member, prepended to their queue, consumed
by the Sheets tab via consumeCarryRows after generating). skeletonInputs
adds unconsumed main-carry to unit demand, so skeleton/calendar/examPlan
all count re-teaching; deletePlanned un-consumes absorbed carries. The
bookmark is NEVER un-seen — carries are an explicit queue on top.

## Coverage forecast advisor (2026-07-14)
`coverageForecast.ts` (query) + pure math `convex/lib/coverageForecastCore.ts`
(unit-tested): per track unit — book-question pool (questionsTaggedToConcept),
seen count (all the student's sheets), pace from last 14d of sheets, capacity
before each term's exam vs remaining → projected % + verdict (done/on-track/
at-risk/wont-finish/no-exam/no-questions); proportional-share allocation
across unfinished units. TERM-AWARE (2026-07-15): only units with an
UPCOMING exam compete for capacity — past terms' leftovers are revision
material, not a deadline; summary carries datedRemaining/daysToFinishDated. UI `coverage-forecast.tsx` on /students/[id]/progress
below the metro line; GLOBAL grade rollup on /planner Forecast tab
(`plannerBoard.gradeForecastRollup`, same pure core + PACE_WINDOW_DAYS).

## Track Progress + 2026-07-10 safety fixes
- `trackProgress.ts` — live per-student unit/track progress query (metro-line
  view + session strip); pure math in `convex/lib/trackProgressCore.ts`
  MUST keep mirroring the planner's pacing constants.
- Planner fixes: track units now unioned into pool scope (cross-grade tracks
  no longer silently skipped); completion stats credit attempts within 48h of
  sheet date; getSavedSheet is duplicate-row safe (collect, not unique).

## Rules for changing the engine
- Read BOTH plan files first; behaviour must match algorithm_plan.md blocks.
- Constants live ONLY in config.ts. The scorer stays module-blind (slot
  concerns belong to D.3). Keep every factor exposed in return values.
- repeatCount remedy is a TEMPORARY stopgap outside SR/mastery — don't deepen it.
