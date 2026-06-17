# Paper classes (Library) — student-centric redesign

Date: 2026-06-18. Supersedes `2026-06-17-paper-classes-library-design.md` (the
room-first "paper block" model). Founder approved this design then said
"implement directly and complete."

## Why
The original Library view was room-first: you created a *paper block* (room +
teacher + time), then added students. The founder found it inefficient — room
selection came first, creation took two dialogs, groups hid in a dropdown,
attendance was buried in the dialog, and there was no view of a student's main
(theory) classes while scheduling. Each student is free at different times, so
the natural unit is the STUDENT, not the room.

## The model
The unit is a **paper assignment**: one student in one 1-hour weekly slot, room
optional. Tables (old paperBlocks/paperBlockStudents dropped — they were empty):
- `paperAssignments` (studentId, dayOfWeek, startTime, endTime, optional roomId)
- `paperSlotTeachers` (optional teacher per dayOfWeek+startTime+roomId)
- `paperAttendance` reshaped → (studentId, date, status); one daily roll-call.
- `studentAvailability` kept (outside busy windows).

## Library view (build)
- **Pill rail** (`paper-student-rail.tsx`): all students, each pill = name +
  assigned hours, coloured 0=red / 1–2=yellow / 3+=green. Search box.
- **Tap-to-pick** (mobile-first; not HTML5 drag): tap a pill → it glows + the
  grid highlights that student's world — their paper slots (green), theory/main
  classes (solid coloured block, dots hidden), outside-busy windows (muted).
- **Grid** (`library-grid.tsx`): 1-hour cells showing dots + headcount. While a
  pill is picked, tapping a cell drops them in (`assign`); tap several hours for
  a multi-hour stretch. Theory/busy clashes WARN visually, never block.
- Backend: `rail`, `weekGrid`, `studentMap`, `assign`.

## Slot dialog (rooms, last step)
`paper-slot-dialog.tsx` — full-screen, opened by tapping an occupied slot.
Rooms side-by-side (horizontal scroll) + an Unassigned column. Tap-to-pick a
student → tap a room to place them. Per-room teacher picker (optional). Room +
teacher both optional; `rooms.capacity` is a soft amber warning, never a block.
Remove takes the student out of the hour. Backend: `slot`, `setRoom`,
`setSlotTeacher`, `unassign`, `assign` (add-to-slot).

## Attendance (Session view)
Removed from the builder. `paper-roll-call.tsx` is a single daily list on the
Session view as a 2nd "Library" pill row (`session-launcher.tsx`): everyone
present unless toggled absent → `submitDayAttendance` → flat 100/day. Backend:
`dayRoster`, `revenueForDate`, `paperRevenueRange` (analytics card).

## Retired
- `paper-block-dialog.tsx`, `student-week-planner.tsx` (deleted). The rail's
  pick-a-pill-to-see-their-week IS the planner now.
- Backend block CRUD + planner queries (createBlock, addGroup, studentWeek, …).

## Decisions captured (founder)
Tap-to-drop not drag (phone) · rooms optional + soft capacity · one daily
roll-call (matches flat-100/day) · pill colours by hours · old paper data was
already deleted, so no migration.
