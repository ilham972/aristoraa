# Paper Classes (the "Library") — design

**Date:** 2026-06-17 · **Status:** shipped to dev, pending prod deploy

## Problem
Personal classes (4 hrs/week/group, 250 LKR/hr) aren't enough for maths;
students don't self-study at home. Founder will bring students in at extra
times for cheap supervised self-study ("paper class" to parents), run by a new
low-cost teacher, billed flat 100 LKR/student/day. The catch: each student is
free on different days (some have outside night classes), so paper attendance
is driven by per-student availability, not a fixed group time.

## Decisions (from brainstorm)
- **Unit:** a *paper block* = day + time + room + (required) supervising teacher
  + roster. "Fixed group paper class" and "individual on a free day" are the
  same object — fill a block by dropping a whole group OR one student at a time.
- **Availability:** stored per student as OUTSIDE busy windows; personal-class
  times are derived live from group slots. A student is free for a block if it
  overlaps none of: outside windows, personal slots, other paper blocks.
  Availability WARNS, never hard-blocks (lead can override).
- **Scope:** attendance + billing ONLY. No sheets / scoring / learning engine /
  leaderboard. Kept in separate tables so it can't pollute that machinery.
- **Billing:** flat 100 LKR per student per DAY (two blocks same day = 100, not
  200). Reported separately from personal-class revenue.
- **Capacity:** per ROOM (`rooms.capacity`), set in Settings → Centers. Hard cap.
- **Teacher:** required on every block.
- **Attendance:** everyone on the roster present unless toggled absent (mirrors
  the session page's roll-call).
- **UI:** a 4th "Library" view in /groups (Option A), grid by room. The unified
  personal+paper overlay (Option B) is deferred to phase 2.

## Data model
- `paperBlocks` (dayOfWeek, startTime, endTime, roomId, teacherId)
- `paperBlockStudents` (blockId, studentId)
- `paperAttendance` (blockId, studentId, date, status)
- `studentAvailability` (studentId, busy: [{dayOfWeek, startTime, endTime, label?}])
- `rooms.capacity?` added.

## Backend
- `convex/lib/paperClasses.ts` — pure logic (overlap, busyConflict, flat-100
  `paperRevenue`); unit-tested in `tests/paperClasses.test.ts`.
- `convex/paperClasses.ts` — weekGrid, block, candidateStudents,
  groupDropPreview, attendanceForDate, revenueForDate; mutations create/update/
  remove block, add/remove student, addGroup, submitAttendance.
- `convex/studentAvailability.ts` — get/set.

## Frontend
- `library-grid.tsx`, `paper-block-dialog.tsx` (create + roster + attendance),
  `students/availability-dialog.tsx`; Library toggle in `groups/page.tsx`;
  per-room capacity input in `settings/centers-tab.tsx`.

## Phase 2 (backlog #8b)
Overlay paper blocks on the Week grid (see each student's whole week + gaps);
per-student free-slot planner; paper-revenue line in /analytics.
