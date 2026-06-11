# Groups & scheduling — /groups (the app home)

## What the screen does
`src/app/groups/page.tsx` (~1030 lines) is the daily home. Three views:
- **Day view (default, date-aware)** — sessions of the selected date; prev/next
  day arrows; tap a session → per-session page `/session/[slotId]/[date]`.
  Bulk cancel/uncancel a whole day or range (CancelDaySheet).
- **Week view** — pure timetable grid (`week-grid.tsx`), NOT date-aware by
  design; shows an "unassigned students" pill; tap empty cell = create group +
  drop first session in one action (if exactly one room exists).
- **Session view** — Yesterday/Today/Tomorrow selector + `session-launcher.tsx`
  to jump into sessions without hunting the grid.

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
  exports WEEKDAY_BANDS/bandsForDay/jsDowToDayNum are unused leftovers).
- Colors: `src/lib/groups/color.ts`. Session time helper: `session-time.ts`.
- Attendance backend: `convex/attendance.ts` (marked per session).
