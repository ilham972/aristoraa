# Decisions — why things are the way they are

Check this BEFORE proposing anything. If an idea appears here as abandoned,
don't re-propose it without new evidence. Format: decision — chose X over Y
because Z.

## The big pivot
- **Learning engine over operations-only** — the app started as score
  tracking + leaderboard (app_prompt.md). Founder realized operations alone
  give no result guarantee: "we don't have standard SOP for service delivery"
  (convesation_about_engine.md). Pivot: SR/AR/interleaving engine that hands
  each student a personal SHEET instead of page+exercise numbers. This became
  the moat and the priority compass (purpose.md).

## Superseded designs (do NOT resurrect)
- **Weekday→module mapping** (Mon=Numbers … 6 modules, 6 days) — original
  backbone, killed by the path-driven redesign: teacher-curated unit path,
  then track-driven Main block after the exam-mode change. Remnants:
  MODULE_DAYS/getTodayModule in src/lib/types.ts (unused).
- **Per-exercise Score tab** — merged into the sheet-based Sheets tab
  (2026-06-07). Scoring is sheet-only; no sheet → no score.
- **sharp for PDF imaging** — abandoned because sharp's native binaries don't
  run in the Convex serverless runtime; replaced with pure-JS pdf-lib
  clipping. sharp still sits in package.json, dead.
- **Grade-based points/position** — replaced by cross-grade named TRACKS +
  leagues + railway map. Legacy still primary until LEADERBOARD_PRIMARY flips
  (founder-gated; see tracks-leaderboard.md).
- **Daily leaderboard images to WhatsApp groups** (app_prompt era) —
  superseded by Phase W messaging hub + weekly cards.
- **Automatic exam-week detection** — exam mode is a MANUAL switch
  (examModeActive) + daily alert; auto-detection rejected.
- **Per-module progress grid on /students cards** (8+ bars per student) —
  removed 2026-06-17. Cards now show only ONE overall %; founder rejected the
  module breakdown (and a tap-to-expand accordion) entirely — all actions +
  track picker sit inline on the compact card. Filters live in one row.
- **Required parentPhone on student add/edit** — caused silent save failures
  (normalizeToE164SL threw on blank/odd input, no catch). Now optional:
  validate only when filled, store "" otherwise, surface errors as toasts.
- **Standalone Sheets management UI** (inspector drawer/body, student rows,
  bulk actions) — superseded by the merged session Sheets tab; files dead.
- **Fixed-width question slots in sheet PDFs** (every crop stretched to
  80mm) — replaced 2026-06-12 by natural-size rendering (crop prints at its
  real textbook size) because mixed text sizes killed the exam-paper feel.
- **Typing the WHOLE question bank as text** — rejected 2026-06-12 (nightly
  typing tax, diagrams stay images anyway). Superseded same day by OPT-IN
  typed overrides: per-question/stem `overrideText` + browser-typeset PNG
  (MathJax math, canvas Tamil) stored on questionBank; PDF prefers it.
  Chose client-side render-at-save over server-side math (MathJax/canvas
  can't run in the Convex runtime; zero per-PDF cost).

## Group organize board — /groups "Group" view (2026-06-18)
- **5th view to reshuffle rosters** — grade-scoped multi-column board. A group
  is a grade-G column if it DECLARES G (grade/additionalGrades) OR holds any
  grade-G student (so untyped/mixed groups aren't stranded). Tap-to-pick/
  tap-to-drop, NOT drag (drag fights horizontal scroll on a phone). Stage
  locally then **Save all** in ONE atomic mutation (`groups.applyRosterMoves`)
  — founder wanted to plan before committing (over instant-write-with-undo).
- **Per-column grade editor** (2026-06-19) — each column header has a grade chip
  (primary grade + up to 2 extras, "Any" clears) reusing the Week-dialog picker,
  so accepted grades (incl. removing an extra) can be edited without opening Edit
  Group. Works in live AND draft (chosen by the `branch` prop). Applies
  immediately (a group property, not a staged roster move) via dedicated
  grade-ONLY mutations `groups.setGroupGrades` / `timetableDraftEdit.
  setGroupGradesDraft` — NOT the general `update` (which patches every arg, so an
  unspecified optional arrives undefined and Convex would delete that field).
  Board columns now carry `primaryGrade`/`extraGrades` (`buildGradeBoard`).
- **Per-chip × "remove from group"** (2026-06-19) — an explicit remove control
  on every chip, because dropping onto the Unassigned column (the only prior way
  to remove) wasn't discoverable, and removing an OFF-grade student that way felt
  wrong (they'd vanish into a grade they don't belong to). × stages a move to
  Unassigned = drop THAT membership only; on save the student lands in their own
  grade's Unassigned and keeps any other group memberships. No backend change —
  `applyRosterMoves` already treats toGroupId=null as a removal.
- **Show EVERY member as a movable chip** — including off-grade members (with a
  grade badge) and students in multiple groups (one chip per group, moved
  independently). The earlier "+N locked" hiding was a BUG (2026-06-18): it hid
  legitimate members (a gr-11 member of a gr-10+11 group, a student in 2 groups)
  and stranded students whose only group had no grade set. Do NOT re-add it.
- **Cap = maxSize ?? 10**, re-checked server-side on final state; board also
  refuses a drop into a full column, a cross-grade drop (typed group), or a
  drop into a group the student is already in. Pure column/cap/diff logic in
  `convex/lib/rosterMoves.ts` (`buildGradeBoard` + cap math, unit-tested). Only
  MEMBERSHIP moves (not sessions/fees — a fee is group-specific).
- **Hide phantom groups** (2026-06-19): a column shows only if the group has ≥1
  member OR ≥1 scheduled session. The Week-view tap-to-create mints a
  `new_group` row BEFORE the user commits; backing out leaves an abandoned row
  (no members, no slots). These are invisible in the slot-driven Week grid but
  used to flood the Group board (84 dead rows found on prod; 5 had a grade set
  → visible columns). Display fix in `buildGradeBoard`; one-off cleanup via
  `groups.deletePhantomGroups` (internalMutation, autoName+0 members+0 slots
  only — never deletes a deliberately named group). `groups.auditPhantomGroups`
  (query) reports the count read-only. Re-runnable anytime the backlog grows.

## Planning mode — draft timetable "branch" (2026-06-18)
- **A saved draft branch, edited in the SAME Week view** — toggle "Planning"
  and the grid reads/writes a private copy; live keeps running untouched.
  Founder wanted to redesign the timetable safely and reversibly.
- **Manual Pull (live→draft) + Merge (draft→live), NOT auto-sync** — the draft
  never absorbs live changes until the user Pulls; live never changes until
  Merge. This sidesteps automatic conflict resolution (founder's framing).
- **Separate draft tables, NOT a `branch` flag on live tables** — chose
  isolation (zero risk to live app/analytics/engine/messaging) over fewer
  tables. `draftGroups/draftSlots/draftGroupMembers/draftSlotTeachers` mirror
  the 4 STRUCTURAL tables + `sourceId`; `draftMeta` holds the baseline. History
  (attendance/scores/sessions) is NOT copied — it hangs off live ids.
- **Merge patches sources in place (identity preserved)**, NOT swap-and-replace
  — so history survives. Pure decision logic in `convex/lib/draftReconcile.ts`
  (fingerprint + baseline; merge never deletes live-only-new rows, pull never
  overwrites draft edits). Engine `convex/timetableDraft.ts`; branch-aware
  editing `convex/timetableDraftEdit.ts` reuses live pure libs (toggleBand,
  validateCaps, buildGradeBoard) so the draft behaves identically.
- **Pull + Merge sit behind confirm dialogs** (founder: sensitive buttons).
- One draft at a time (no named scenarios — YAGNI). Standalone "Group" organize
  board tab is NOT yet branch-aware (still edits live); membership in the draft
  is done via the branch-aware EditGroupDialog. See ideas-backlog.

## Paper classes / Library (redesigned student-centric 2026-06-18)
- **Separate tables, NOT a scheduleSlots flag** — paper classes never drag in
  sheets/scoring/engine/leaderboard. Scope = attendance + billing only.
- **STUDENT-CENTRIC, not room/block-centric** (2026-06-18 rewrite — founder's
  call). The unit is a per-student assignment to a 1-hour slot (`paperAssignments`),
  built by tap-and-dropping student pills onto the grid. Rooms + teachers are
  assigned LATER inside the slot dialog and are OPTIONAL. REPLACES the original
  "paper block = room+teacher+time+roster" model (tables paperBlocks/
  paperBlockStudents, dropped) — do NOT resurrect room-first creation.
- **Flat 100/student/DAY** — driven by ONE daily roll-call (`paperAttendance`,
  per student+date), on the Session view as a 2nd "Library" pill row, NOT in the
  builder. Reported separately from 250/hr personal revenue.
- **Capacity is a SOFT warning now** (rooms.capacity) — shown when a room is
  overfilled in the slot dialog, never blocks. No cap at slot level: cram an hour
  as full as you like; rooms are just where students physically sit.
- **Tap-to-pick / tap-to-drop, not HTML5 drag-drop** — mobile is the primary
  device. Pick a pill → it glows → tap slot/room to drop. Same in the slot dialog
  (rooms side-by-side, horizontal scroll).
- **Pill = student + assigned hours, coloured by load** (0=red, 1–2=yellow,
  3+=green). Picking a pill highlights their paper slots + theory/main classes
  (solid block, dots hidden) + outside-busy windows — this REPLACES the retired
  phase-2 "Plan student" planner (`student-week-planner.tsx`, deleted): the rail
  IS the planner now. Theory clashes WARN visually, never block (lead owns it).
- **Availability = stored outside windows + derived personal slots** — combined
  for the highlight overlay; app knows personal-class times from group slots.

## Track Progress view (2026-07-10)
- **Two-tier done rule** — unit is TAUGHT when every concept attempted once,
  MASTERED when mean mastery also ≥ 0.75. Chose over taught-only (misleads)
  and mastered-only (board feels stuck while SR does its work).
- **Compute fresh on open, NO saved progress table** — derives live from
  track + memoryState (same rows the planner reads) so the view can never
  drift; Convex reactivity updates it while scoring. A `unitCompletions`
  event log for parent messaging is DEFERRED, not rejected.
- **Metro-line visual** (stations/railway) over card checklist — matches the
  transit brand; per-student page + session-strip placement. Distinct from
  the REJECTED per-module bars on /students cards (view, not card clutter).
- **Predictions mirror the planner** — sessions-left math reuses the exact
  autoMainConcepts constants; never invent a separate pace formula.

## Lesson Builder (2026-07-11)
- **Join = shared Main, personal rest** — joined students get the teacher's
  ticked Main block; warm-up/revision/exam-prep stay per-student. Fully
  identical sheets REJECTED (kills personalization + feeds wrong memory).
- **Picker scope = whole unit, grouped by concept**, crop thumbnails, algo
  picks pre-ticked ("engine-picked with manual override" made real).
- **Named lesson sets per unit** (`unitLessonSets`, upsert by unit+name) —
  the teacher's reusable worksheet library; Main-block only BY DESIGN.
- **Teacher ticks beat the cooldown and prereq gaps** — explicit choice wins;
  alerts still surface gaps. Serves the founder's layer-by-layer teaching
  (layer 1 = light intro sweep, deeper layers via revision + harder sets).

## Settings "Book" tab (2026-07-13)
- **Promoted to its own top-level Settings tab** (next to Content) with a
  full-screen focus toggle (fixed overlay, bottom nav hidden via
  NavVisibility) — founder wanted distraction-free entry; Data Entry keeps
  Details/Concepts/Past Papers/Difficulty only.
- **Exercises + Page Nos sub-tabs MERGED** into one Book tab with the
  uploaded book embedded — the physical-book trip was the bottleneck.
  Chose one continuous read-the-book-once pass (pills top, viewer middle,
  sticky entry bar bottom) over per-unit sheets or viewer-beside-dialogs.
- **Two dots per unit pill** (pages/exercises), amber = partial, green =
  both — founder's own refinement of a single done state.
- **Mark start/Mark end** capture the on-screen page; next unit's start
  prefills from previous end + 1. Review (x.0) still creation-only.
- Viewer serves small thumbnails (`listSmallPages`); full-res stays
  crop/PDF-only. Old per-layer dialogs deleted, ExercisePickerBody's grid
  moved into the count drawer.

## Standing constraints (decided, still binding)
- **Stem/leaf**: planner picks LEAF sub-questions only; stems glued at
  render; noStem flag for instruction-less leaves.
- **repeatCount remedy**: TEMPORARY count-based cooldown stopgap; must NOT
  touch SR/mastery; don't extend it.
- **Messaging: NO cron** — every batch human-triggered; all WhatsApp I/O via
  provider.ts chokepoint; Open-WA chosen over Meta Cloud (free, ban risk
  accepted, swap = one file).
- **Day-of-week = 1=Mon..7=Sun** everywhere (a 0-based assumption once
  silently dropped Sunday slots).
- **No default off-days** — centre runs 7 days/week. A student is off ONLY on
  weekdays explicitly in `students.offDays`. Default was `["sunday"]` (three
  duplicated copies) which hid the Generate-sheet button on Sundays + dropped
  Sunday reminders. Fixed 2026-07-13: single source `convex/lib/offDays.ts`
  (`DEFAULT_OFF_DAYS = []`); config/sheets/messaging all delegate to it.
- **Lesson Builder crops: TRUE aspect ratio at page scale, always** (v4,
  2026-07-13) — never letterbox crops in fixed squares, never shrink text
  below page scale. Density comes from PACKING (narrow crops 2-up, wide
  full-width) + slim tick strip, not from scaling down. The picker shows stem
  crops as shared rows (same analyzeCropIntegrity the PDF render uses) so a
  sub-part is never displayed without its instruction text.
- **Lesson Builder order IS difficulty** (2026-07-13) — dragging a concept's
  questions rewrites EVERY question's difficulty 1-5 by position (top=easy)
  + saves exact order in questionBank.pickerOrder (sort tie-break). Founder
  chose this over order-only because visual ordering replaces the Difficulty
  subtab workflow. Easy-first display order stays the default AND the print
  order; stem rows repeat when a family is split by difficulty — intentional
  (a sub-part is never shown without instruction). "Book order" pill is a
  VIEW-ONLY lens (families together, stems once) for inspecting algo picks —
  founder explicitly rejected it changing print order.
- **Coverage-first mode is MANUAL and replaces fit, never SR timing**
  (2026-07-14). Founder insight: each book question is a distinct exam
  pattern — pulling a FRESH question on a due concept IS the repetition, so
  with a short exam runway students should climb each concept's easy→hard
  ladder through unseen questions (whole book, no repeats) before moving to
  past papers. Chose a fit-factor override inside the existing engine over
  the founder's first idea (prebuilt layered revision sheets) — prebuilt
  sheets lose personal timing + interleave and re-create blocked practice
  (founder diagnosed this himself). Manual switch like exam mode; default
  engine = long-runway fallback. Weak students: hard tail deferred by
  skill+2 cap, not a manual flag. 100% book coverage is a TARGET, not law.
- **Departments redesign — coverage ladder is FINAL, global toggle retired**
  (2026-07-14, same day it shipped): ladder = permanent engine default; the
  Gaussian-with-repeats engine survives ONLY as per-student
  `learningMode="consolidation"` (manual, alert-suggested both ways — the
  exam-mode pattern). Repeats are a weak-student remedy, not a mode.
- **Group Main = one identical prebuilt sheet; personalization lives in the
  Revision department** (2026-07-14). Group bookmark advances by group
  sheets, taught OR delegated (delegation = group-level act, founder judges
  "doable without teaching"); absences + delegations reach students via ONE
  queue rule (group-claimed-but-personally-unseen). Main sheet = new ladder
  + spiral (planned repetition, weakest group-avg R first); true reactive SR
  stays individual. Founder chose skeleton+rolling (~7d crystallize) over
  all-at-term-start, and weekly Revision sessions for EVERYONE over
  flagged-only. Note: this supersedes the "prebuilt sheets rejected" line
  above — prebuilt is now GROUP-level with the spiral, while per-student
  timing/interleave lives in the Revision layer.
- **Unit book exhausted → capped past-paper tail + alert** (2026-07-14):
  finish the textbook first, then ≤6 past-paper Qs per unit flow in
  (GROUP_PASTPAPER_TAIL_MAX) so the march to the next unit never stalls.
- **Global Planner = SEE + STEER, nothing new stored** (2026-07-15).
  `/planner` nav page (Term board per grade + Forecast rollup + Tracks +
  Exams). Founder chose a derived board steered by EXISTING levers
  (crystallize, tracks, exam dates, Main/Revision flips) over a stored
  per-grade "scheme of work" table — group plans can never disagree with
  the grade plan. Delegation to groups is automatic (each group derives
  from its track). Tracks + Exams tabs moved OUT of Insights (planning
  inputs live with planning; Insights keeps inspection: Coverage,
  Blueprint, Path). Board nav button removed — leaderboard link now sits
  in the /students header (founder call, frees the nav slot).
- **Group plan page shows each fact once** (2026-07-15): v1's three
  repeating unit lists replaced by ONE runway strip + locked-in rows +
  projection collapsed into unit spans. Don't re-add per-session rows for
  un-crystallized sessions.
- **Forecast demand is TERM-AWARE** (2026-07-15, founder bug report): a
  unit with no UPCOMING exam never competes for pre-exam capacity — its
  exam already happened; leftovers are revision material. v1 counted the
  whole track's backlog ("needs 2051 days, we have 61"). Headline number =
  datedRemaining (due before real exams), whole-track total is secondary.
- **Plan by REQUIRED capacity, not observed pace** (2026-07-15, founder):
  the Term tab leads with demand-vs-capacity ("250 Qs, 18 sessions →
  short 106, add ~14 sessions or delegate backlog"), because counts are
  STABLE under Lesson-Builder difficulty re-ordering (founder's insight:
  order changes, count never does) — so the whole term is plannable today
  while only the crystallized week pins question ids. Observed pace stays
  in the Forecast but reframed as "need X Qs/day, doing Y" (the passive
  "needs 438 days" framing is rejected). Pace changes/absences are handled
  IN the system: skeleton reflow + revision queues + extra time slots.
- **Unfinished-session leftovers = explicit carry queue, never un-seeing**
  (2026-07-15). Teacher logs the sheet's unfinished TAIL (last N) after
  class and chooses the destination: next Main (whole group re-does it —
  crystallize serves carries first, consumes on write) or Revision queues
  (per-member rows, consumed when the queue sheet generates). Chose an
  explicit `groupCarryOvers` queue OVER making the derived bookmark
  "un-see" questions — un-seeing fights every derived count and risks
  re-pick loops; a consumable queue keeps the bookmark honest. Carry
  demand feeds the skeleton so the calendar shifts immediately.
- **Scheme Calendar + full-term prebuild** (2026-07-15, evolved same day):
  first ruling was calendar-projection-only ("frozen sheets go stale");
  founder pushed back with the key insight that COUNTS are stable — so
  full-term crystallize is now allowed (Sheets tab "Run all term sheets",
  crystallize cap raised 30→180d) and staleness is handled by "Re-plan"
  (deleteFuturePlanned + re-crystallize: future PLANNED rows are always
  re-pickable; taught/delegated rows never touched). Calendar stays the
  live view; skeleton is cancellation-aware (sessionLogs cancelled_by_tutor
  skips the date, plan reflows). Delegation available from both surfaces.
- **A book-entry gap must LOOK like a gap, never "done"** (2026-07-15,
  founder bug report "term sheets only cover two units"): root cause was
  data, not the walk — only 2 of 25 G11 track units had any cropped
  questions, and the planner showed empty units as done + toasted "whole
  term planned" when the bank ran dry. Ruling: skeleton verdict
  "no-questions" for totalCount=0 units, crystallize returns
  exhausted/unplannedSessions, Sheets tab banner names the next unit to
  enter. Also: deleting an exercise cascades to its crops (dangling
  linkedExerciseId = invisible questions; 52 stale dupes cleaned off prod).
- **Group starting point = seen-set injection, not a stored bookmark field**
  (2026-07-15). Cold-started groups (Terms 1–2 done before the app) restarted
  the walk at unit 1. Chose a `groupPreTaughtUnits` marker table folded into
  the DERIVED seen-set over a stored "currentUnit" pointer, because the whole
  plan already keys off seen (skeleton, crystallize, spiral, capacity) — one
  injection point makes every surface consistent for free, and stays
  reversible. Boundary model (mark through unit N) over per-unit toggles: the
  track is a teaching sequence, so "we start at N" means everything before N
  is done; non-contiguous pre-teaching isn't worth the complexity. Explicitly
  NOT a teaching record — no points/memory/revision, per-student surfaces
  untouched (individual coverage forecast still shows the real gaps).
- **Topic Journey reader = overlay above the tag drawer, not a route**
  (2026-07-14). Tapping a concept in Settings → Tags opens its marked book
  pages full-screen with a G6→G11 concept strip + Next/Prev — reading one
  topic (e.g. Statistics) across grades as a continuous story. Chose a
  portal overlay over a dedicated page so closing lands back in the drawer
  exactly as left (founder is phone-only; route navigation would lose drawer
  state). Chose the journey strip over a simple per-concept popup because
  the founder's stated goal was continuous cross-grade reading.
- **Deferred, not abandoned**: student tablet app + concept videos
  (new_change.md), W.6 homework PDF, W.7 predicted-vs-actual reports, W.8 fee
  reminders, weekly-card image variant.

## Plan-file verdicts (root *.md)
| File | Verdict |
|---|---|
| learning_engine_plan.md | **CURRENT** strategy — NEVER delete |
| algorithm_plan.md | **CURRENT** tactical spec — NEVER delete |
| whatsapp_integration_plan.md | ACTIVE spec (W.1–W.5 shipped; §17 has infra creds) |
| sheet_structure_redesign_plan.md | ACTIVE spec (path-driven sheets) |
| sheet_scoring_plan.md | ACTIVE spec (sheet-synced scoring) |
| business_strategy.txt | REFERENCE — "Factory Model" 4-role business plan |
| curriculum context.md | REFERENCE — raw Tamil unit lists (seed input) |
| app_prompt.md | HISTORICAL — original spec; Score section already obsolete |
| new_change.md | HISTORICAL — Lead dashboard (built) + tablet app (deferred) |
| convesation_about_engine.md | HISTORICAL — raw pivot conversation |
| phase_0_4/0_5/0_6_plan.md | HISTORICAL — executed build plans |
| open-wa-intro.md | HISTORICAL — vendor docs copy |
