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
