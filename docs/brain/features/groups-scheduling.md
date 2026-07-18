# Groups & scheduling — /groups (the app home)

## Departments (2026-07-14; plan page redesigned 2026-07-15)
`/groups/[id]/plan` = the group lesson-plan page (Main department control).
Layout shows each fact ONCE: header card (+crystallize), one horizontal
unit-runway strip (shared `components/planner/unit-runway.tsx`), locked-in
crystallized rows (delegate/delete), projection collapsed into unit SPANS
(accordion per unit, not 24 repeated rows), compact Main/Revision day chips
(flip `scheduleSlots.sessionType`). Global view: `/planner` Term board
(nav) — see learning-engine.md. Backend `convex/learningEngine/groupPlan.ts`.

## What the screen does
`src/app/groups/page.tsx` (~1030 lines) is the daily home. Views:
- **Day view (default, date-aware)** — sessions of the selected date; prev/next
  day arrows; tap a session → per-session page `/session/[slotId]/[date]`.
  Bulk cancel/uncancel a whole day or range (CancelDaySheet).
- **Week view** — pure timetable grid (`week-grid.tsx`), NOT date-aware by
  design; shows an "unassigned students" pill; tap empty cell = create group +
  drop first session in one action (if exactly one room exists).
- **Session view** — Yesterday/Today/Tomorrow selector + `session-launcher.tsx`
  to jump into sessions without hunting the grid.
- **Group view** — organize board to move students between groups (new joiners,
  reshuffles). Grade-scoped columns (declares the grade OR holds a grade-G
  student) + Unassigned; EVERY member is a movable chip (off-grade ones get a
  grade badge; multi-group students appear in each group).
  Tap-to-pick/tap-to-drop; stage then Save (atomic). `organize-board.tsx` +
  `groups.gradeBoard`/`gradeOptions`/`applyRosterMoves`; column/cap/diff logic
  in `convex/lib/rosterMoves.ts` (`buildGradeBoard`, tested). Cap = maxSize ??
  10; only membership moves (not sessions/fees). Each chip has a × that drops
  THAT membership → student's own-grade Unassigned (other memberships untouched).
  Column header has a grade chip editing primary + extra grades (live & draft)
  via `groups.setGroupGrades` /
  `setGroupGradesDraft`. Column header also: tap name to rename, a calendar
  icon opens the group's `EditGroupDialog` (weekly sessions), a trash deletes
  (confirm) — all branch-aware. Phantom groups (no members AND no session —
  abandoned `new_group` rows) hidden; cleanup `groups.deletePhantomGroups`.
  ONE grade at a time — the whole-centre sweep is Insights → Roster
  (2026-07-18): `groups.rosterAudit` + `components/algorithm/roster-tab.tsx`,
  every group by grade + students/sessions counts, phantoms SHOWN, delete
  per row. Live only, never the draft branch.
- **Library view** — paper-class (cheap self-study) timetable, STUDENT-CENTRIC.
  Pill rail of all students on top (`paper-student-rail.tsx`); slot grid below
  (`library-grid.tsx`). Tap a pill = pick it up (glow) + highlight their week;
  tap hour slots to drop them in. Tap an occupied slot (nothing picked) →
  `paper-slot-dialog.tsx`.
- **Revision view (2026-07-17)** — DAY-only revision-class board, NO times:
  weekday sections, each holds multiple group chips + individual-student
  chips (for the groupless). `revision-timetable.tsx` +
  `convex/revisionTimetable.ts` (`revisionClasses` table). Planner Sheets tab
  reads a group's revision-class days via `groupSlotDays` (merged into
  revisionDays) and can assign/move/add planned sheets onto them
  (moveGroupSheet accepts slotless days; addPlannedSheet = extra sheet).
  Supersedes "revision capacity = flipped slots ONLY" — see decisions.md.

## Paper classes (the Library) — student-centric (redesigned 2026-06-18)
Deliberately SEPARATE from scheduleSlots — no sheets/scoring/engine/leaderboard.
Scope = attendance + flat 100 LKR/student/DAY billing only. The unit is a
per-student assignment to a 1-hour slot, NOT a room+teacher block. Backend
`convex/paperClasses.ts` (+ pure logic `convex/lib/paperClasses.ts`, tested).
Tables: `paperAssignments` (studentId, dayOfWeek, startTime, endTime, optional
roomId), `paperSlotTeachers` (optional teacher per slot+room), `paperAttendance`
(per student+date — one daily roll-call), `studentAvailability`.
- **Build**: rail pill coloured by assigned hours (0=red, 1–2=yellow, 3+=green).
  Pick up → grid highlights their paper slots (green), theory/main classes
  (solid block, dots hidden) + outside-busy windows. Tap slots to add (mutation
  `assign`; multi-hour = tap several). Queries `rail`, `weekGrid` (dots+count),
  `studentMap` (highlight overlay).
- **Rooms**: assigned LAST, inside `paper-slot-dialog.tsx` (full-screen, rooms
  side-by-side, tap-and-drop a student → a room). Room + per-room teacher both
  OPTIONAL; `rooms.capacity` is a soft amber warning, never a block. Mutations
  `setRoom`, `setSlotTeacher`, `unassign`. Tap-to-pick/tap-to-drop, not HTML5 DnD
  (mobile is the primary device).
- **Attendance** is NOT in the builder — it's the daily Library roll-call on the
  Session view (`paper-roll-call.tsx`, second pill row in `session-launcher.tsx`).
  Everyone present unless toggled absent → `submitDayAttendance` → flat 100/day.
  Queries `dayRoster`, `revenueForDate`, `paperRevenueRange` (analytics card).
- Outside busy windows edited on /students via `availability-dialog.tsx`; theory
  slots derived live from group scheduleSlots. Both feed the highlight overlay.

## Planning mode — draft timetable branch (2026-06-18)
Week-view "Planning" toggle (`planning-mode-bar.tsx`) flips the grid onto a
private DRAFT copy; live keeps running. Pull = live→draft, Merge = draft→live
(both behind confirm dialogs), Discard = drop it. Engine
`convex/timetableDraft.ts` + pure tested `convex/lib/draftReconcile.ts`; editing
`convex/timetableDraftEdit.ts` mirrors every live op on the draft tables (reuses
toggleBand/validateCaps/buildGradeBoard). Tables: draftGroups/draftSlots/
draftGroupMembers/draftSlotTeachers + draftMeta baseline — only the 4 STRUCTURAL
tables, history isn't copied. Branch-aware surfaces share ONE draft: Week grid,
`EditGroupDialog`, Group/organize board (each via a `branch`). Per-slot teacher
draft UI + pre-Merge diff preview pending. Rules → decisions.md.

## Data flow
Page calls `api.groups.*` (weekGrid, sessions, toggleSession, members,
candidateStudents…), `api.sessionRecords.*` (weekSessions, cancelDay,
cancelRange, uncancelDay), `api.rooms.list`, prefetches teachers/centers for
the editor. Group editing: `edit-group-dialog.tsx` (816 lines — members, fees,
room, weekly sessions). Backend: `convex/groups.ts`, `convex/scheduleSlots.ts`,
`convex/rooms.ts`, `convex/slotTeachers.ts`.

## Key invariants (tested — tests/ has integration tests)
- Day numbering is **1=Mon..7=Sun** everywhere (JS getDay is converted).
- **Slot fusion**: back-to-back slots of a group display/run as ONE multi-hour
  session. `convex/lib/slotMerge.ts` + `toggleSession` handle add-fuse, split,
  orphan and absorb cases. Don't touch fusion without reading those tests.
- Group creation auto-names (`autoName: true`, `src/lib/groups/naming.ts`,
  `convex/lib/naming.ts` is the unused backend twin — see legacy-map).
- Cancelling a day creates overrides; revenue/attendance respect them.

## Migration state (Phase F)
/groups replaced an older scheduling tab. F.1–F.5 shipped. **F.6–F.8 pending:
reader migration, live-data migration, retiring the old tab.** Some old-tab
code still exists and is wired — check decisions.md before assuming.
Revenue + attendance analytics moved OUT of /groups into /analytics; the
leftover `src/components/groups/attendance-tab.tsx` (536 lines) is dead
(knip-confirmed), `revenue-tab.tsx` is still imported by analytics.

## Where things live
- Time/band helpers: `src/lib/groups/time-grid.ts` (DAYS, fmtTime12, fmtLKR;
  WEEKDAY_BANDS/bandsForDay/jsDowToDayNum unused — see legacy-map).
- Colors: `src/lib/groups/color.ts` — `resolveGroupColor(colorIndex, colorKey)`:
  stored `colorIndex` (tap dialog dot to cycle) else hash of `colorKey` (live id;
  draft passes `sourceId` so live/draft match). Session time: `session-time.ts`.
  Attendance backend: `convex/attendance.ts` (marked per session).
