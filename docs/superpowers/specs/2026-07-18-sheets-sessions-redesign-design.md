# Sheets tab: sessions, unit compression, green/yellow routing, shared Lesson Builder

Date: 2026-07-18 · Status: approved-in-conversation, awaiting founder spec review

## Why

The planner Sheets tab plans the whole term, but three things fight the founder:

1. **Wrong words on screen.** A chip on a week card is really a *session's
   question set*; the physical A4 sheets are the pages the PDF prints. The UI
   says "sheet" for both, and pages are invisible.
2. **No pace control.** The engine teaches in blocks (one unit until its
   ladder is empty), so weeks show 1–2 units and the syllabus can overshoot
   the exam date. The teacher — who knows how much they can teach — has no way
   to say "start the next unit now."
3. **Two Lesson Builders.** The loved one lives in Session → Sheets
   (full-screen, dense crop grid). The planner's unit-curation dialog
   (`group-unit-builder.tsx`) is a worse clone.

## Design

### A. Question routing: green / yellow / unticked

Every question of every track unit is in exactly one state per group:

- **Green (Main)** — will be taught in a Main session. The default.
- **Yellow (Revision)** — flows to the Revision department queues instead.
  This is question-level delegation; the exam-capacity math counts yellow
  questions out of Main demand (this is what moves the deadline).
- **Unticked (excluded)** — out of the plan entirely (existing
  `groupUnitBans`, unchanged).

Storage: new table `groupQuestionRoutes` — one row per re-routed question:
`{ groupId, unitId, questionId, route: "main" | "revision",
source: "auto" | "manual", createdAt }`. Green-by-default needs no row.
**Manual rows are never overwritten by the algorithm**; auto rows may be
rewritten by a later compression or re-plan. Manual wins on conflict.

Engine changes:

- `buildPickQueues` / skeleton demand: skip yellow questions in the Main new
  queue and in Main demand (same mechanism as bans, but they remain demand
  for the revision side).
- `revisionQueueForStudent`: after carry-overs and sheet-based backlog, pull
  unseen yellow-routed questions of units the group has started, book order,
  under the existing queue cap.
- Coverage grid gets a **yellow mark** for routed-to-revision questions
  (alongside new/review/other/unseen/excluded).

### B. "+ unit" — unit compression (the pace lever)

Appears in two places: the week card (next to the unit grids) and the group
Lesson Builder. Pressing it proposes starting the **next not-yet-started
track unit** now:

- **Smart default split** for the current (now compressed) unit's untaught
  remainder: keep green the *first question of each concept* (the teaching
  intro) and the *hardest ~20% of the unit* (revision teachers can't teach
  those — founder rule); flip the middle drill work yellow (auto rows).
- A **confirm sheet** shows the proposed split with counts; any question the
  founder flips back before confirming becomes a *manual* route (remembered
  forever).
- Confirming writes the routes, then re-plans future planned sheets
  (`deleteFuturePlanned` + `crystallizeUpcoming`) so the timeline reflects it
  immediately. The exam "short by" math updates because yellow left Main
  demand.

### C. Week card: sessions that contain A4 pages

- Chips renamed **sessions** (the data already is one row per session).
- A session chip expands to its **physical A4 pages** ("Sheet 1", "Sheet 2").
  Tapping the session highlights all its questions in the book-order grid
  (existing pill); tapping one page highlights only that page's questions.
- Page split comes from a **pure pagination function extracted from the PDF
  composer** (same layout math, no render), exposed as a query:
  `groupSheetPageBreaks(groupSheetId) → [{ page, questionIds }]`.
- "+ sheet" is renamed **"+ session"** (same behavior: add an extra teaching
  day this week). The assign-to-revision ↻ flow stays; its day-picker gains
  the session's question count.

### D. One shared Lesson Builder (pull, don't clone)

`SheetPlannerPanel` becomes a shared full-screen builder with two modes; the
dense v4 crop grid, stem rows, concept chips, magnifier, and Arrange mode are
shared code:

- **Student mode** — unchanged (session page): student chips, 4 tabs,
  per-student generation.
- **Group mode** — replaces `group-unit-builder.tsx` (retire it; note in
  legacy-map): group name in the header; **two tabs: Main (green) and
  Revision (yellow)**; the opened unit shown as a chip (no dropdown) plus the
  same **"+ unit"** button; save writes bans + routes for the group.

Tick interaction (both modes where routing applies): **tap the tile** =
tick/untick; **tap the small tick chip** above the crop = flip green ↔ yellow
(a manual route). No double-tap — phone browsers make it flickery.

### E. Decimal difficulty from Arrange order

`reorderConceptQuestions` currently writes `pickerOrder = i` and squashes
difficulty into whole bands 1–5, so the displayed number contradicts the
founder's order. Change: `difficulty = 1 + 4·i/(n−1)` rounded to 0.1 (single
question: 3.0); UI shows one decimal. Order semantics are already rank-based,
so this only adds resolution — the per-student "≤ skill+2" cap and all sorts
handle decimals unchanged.

## Build order (each phase ships alone)

1. **E** — decimal difficulty (tiny, independent).
2. **A** — routes table + engine (queues, demand, revision queue, coverage
   mark) behind the existing UI.
3. **D** — shared Lesson Builder refactor + group mode with green/yellow.
4. **B** — "+ unit" compression flow (confirm sheet, re-plan).
5. **C** — week card sessions/pages + pagination query + renames.

## Testing

- Engine (convex-test): routes respected by pick queues; yellow excluded from
  Main demand but present in revision queues; manual-beats-auto; compression
  split math; pagination function against known crop sizes.
- UI: founder phone-test each phase (existing pattern).

## Out of scope

- Choosing which revision *day* a yellow question lands on — the builder
  decides *what*, the week card's ↻ decides *when* (founder decision).
- Per-unit "+question" buttons (rejected: the plan already includes every
  non-excluded question; nothing to add).
- Any change to per-student SR/mastery/memory.
