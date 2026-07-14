# Domain — concept glossary

Each entry: what it means here, then [tables in convex/schema.ts | main module].

- **Student** — a learner enrolled at Aristora; belongs to groups, has mastery
  state, points, track position. [students | convex/students.ts]
- **Teacher** — app user who runs sessions; assigned to slots.
  [teachers, slotTeachers | convex/teachers.ts]
- **Group** — a named class of ≤10 students (the sacred cap, purpose.md) with a
  color and weekly slots. [groups, groupMembers | convex/groups.ts]
- **Schedule slot** — a group's timetable cell (day, time, room). Back-to-back
  slots FUSE into one multi-hour session at display/session level; toggling a
  session can add-fuse, split, orphan or absorb (tested invariants).
  [scheduleSlots, slotStudents, slotOverrides | convex/scheduleSlots.ts,
  convex/lib/slotMerge.ts]
- **Session** — one actual class meeting of a (fused) slot on a date; holds
  attendance, sheets, scoring, payments. [sessionLogs, sessionPayments,
  attendance | convex/sessionRecords.ts, convex/attendance.ts]
- **Sheet** — the per-student worksheet generated for a session; 5 sections
  including Revision and Mistakes; rendered to PDF from question-bank crops.
  Scoring is sheet-based ONLY (old per-exercise Score tab was merged away).
  [generatedSheets, sheetOverrides | convex/learningEngine/sheets.ts]
- **Question bank** — cropped questions from textbooks and past papers, tagged
  with concepts/topics. **Stem/leaf model**: planner picks LEAF sub-questions
  only; shared stems are glued back at render; `noStem` marks leaves without
  their own instruction. [questionBank, questionConcepts | convex/questionBank.ts]
- **Entry / scoring** — per-question correctness recorded during a session;
  feeds memory + points. [entries, attemptLog | convex/entries.ts,
  convex/learningEngine/scoring.ts]
- **Learning engine** — the moat. Plans each student's next questions using
  spaced repetition / adaptive retrieval / interleaving over concept mastery;
  validated via cumulative-exam holdouts. Current plans: learning_engine_plan.md
  + algorithm_plan.md (root). [memoryState, attemptLog, conceptImportance,
  currentAssignments | convex/learningEngine/planner.ts, memory.ts, mastery.ts]
- **Teaching path** — teacher-curated ordered unit path per group (REPLACED the
  old weekday→module mapping — never re-propose that). [teachingPath, unitPacing
  | convex/learningEngine/path.ts]
- **Blueprint / coverage / exam calendar** — engine control panels: exam paper
  structure, concept coverage tracking, exam dates driving urgency.
  [paperStructures*, examCalendar, examTopicTags* | convex/paperStructures.ts,
  convex/learningEngine/coverage.ts, calendar.ts]
- **repeatCount remedy** — TEMPORARY per-question repeat scheduling stopgap with
  count-based cooldown; deliberately does NOT touch SR/mastery. Superseded in
  spirit by consolidation mode; mechanics still live (bank-level counts).
- **Learning mode** — per-student engine switch: "normal" (coverage ladder,
  no repeats — THE default) vs "consolidation" (weak-student fallback:
  difficulty-matched + repeats). Manual, alert-suggested. [students.learningMode
  | convex/engineAlerts.ts, convex/lib/consolidationCore.ts]
- **Group sheet / bookmark / delegation** — the Main department's unit: one
  identical crystallized sheet per (group, session); bookmark = derived union
  of consumed question ids; delegation sends a planned sheet to the Revision
  department (bookmark still advances). Revision sessions
  (scheduleSlots.sessionType) serve each student's queue =
  group-claimed-but-personally-unseen questions. [groupSheets |
  convex/learningEngine/groupPlan.ts, convex/lib/groupPlanCore.ts]
- **Track** — named cross-grade progression level (replaces grade-based
  position); students promote along tracks shown as a railway map; leagues group
  students for competition. **Flag `LEADERBOARD_PRIMARY='legacy'`**: track system
  is shipped but NOT yet primary — legacy points still drive the leaderboard
  until founder-gated prod seed/backfill + flag flip. [tracks, promotions,
  sessionPoints | convex/learningEngine/tracks.ts, leagues.ts, map.ts]
- **Points** — session-based scoring currency for the leaderboard (legacy
  system live; sessionPoints is the current store). [sessionPoints]
- **Doubt** — a student question/uncertainty captured for follow-up.
  [doubts | convex/doubts.ts]
- **Messaging hub** — WhatsApp-style parent communication: contacts, templates,
  queue, broadcasts, weekly cards. Gateway (Phase W, Open-WA) NOT built; full
  spec in whatsapp_integration_plan.md. [parentContacts, messageTemplates,
  messageQueue, messageLog, conversations, whatsappGroups | convex/messaging/*]
- **Center / room** — physical locations; multi-center is the 2-year scaling
  path (purpose.md). `rooms.capacity` is a soft cap for paper-class room
  placement. [centers, rooms | convex/centers.ts, rooms.ts]
- **Paper class / Library** — cheap supervised self-study run by a low-cost
  teacher; billed FLAT 100 LKR/student/DAY (vs personal class 250/hr). Lives in
  its OWN tables, never touches sheets/scoring/engine. STUDENT-CENTRIC: the unit
  is a **paper assignment** = one student in one 1-hour slot (room optional,
  added later). Rooms/teachers per slot are optional; attendance is a single
  daily roll-call. [paperAssignments, paperSlotTeachers, paperAttendance |
  convex/paperClasses.ts]
- **Student availability** — a student's OUTSIDE busy windows (night classes
  etc.); feeds the Library highlight overlay (who's free when). Personal-class
  times are derived live, not stored here. [studentAvailability | convex/studentAvailability.ts]
