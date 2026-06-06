# Merge back-to-back session slots into one card

**Date:** 2026-06-07
**Status:** Approved design, pending implementation plan
**Strategy:** Approach B (consolidate atoms into multi-hour slots) + hybrid normalize

## Problem

In the Day view (`/groups` home, `DayList`), a group that runs 3–5pm shows as **two
cards** — one for 3–4pm and one for 4–5pm. Tapping each opens a separate session
workspace (`/session/[slotId]/[date]`), forcing the tutor to do attendance,
payments, cancel, and submit **twice** for what is really one class.

### Root cause

Each session is stored as a **1-hour atom** `scheduleSlot`. A 3–5pm class is two
rows: a 3–4 slot and a 4–5 slot (see `convex/groups.ts toggleSession`,
`src/lib/groups/time-grid.ts` — "Each cell is a 1-hour atom"). Per-occurrence data
is keyed per `(slot, date)`:

- `attendance` — per `(slot, date, student)`
- `sessionPayments` — per `(slot, date, student)`
- `sessionLogs` — per `(slot, date)` (held / cancelled)
- `sessionSubmissions` — per `(slot, date)`
- `entries` (scoring) — keyed by `(student, date, exercise)`; `slotId` is only
  optional metadata, so scoring is already shared across atoms.

So contiguous atoms produce N day-view cards and N session workspaces, duplicating
every per-slot workflow.

### Constraint

The user asked not to change **week-view logic**. The week grid (`week-grid.tsx`)
and the edit-group picker (`weekly-session-grid.tsx`) both already render occupancy
by **overlap**, so they display multi-hour slots correctly with zero rendering
changes. Only the toggle *mutation* needs new logic.

## Chosen approach

**Approach B + hybrid normalize.** Store real multi-hour `scheduleSlot` rows
instead of contiguous atoms. The grids keep clicking in 1-hour cells (UI feel
unchanged); the backend silently fuses/splits slots so the stored model is
multi-hour. This was chosen over Approach A (view-layer merge that keeps atoms)
per explicit user decision.

### The invariant

A group never owns two contiguous same-room slots on the same day. Contiguous
atoms — `endTime == startTime`, same `groupId`, same `roomId` — are always fused
into one multi-hour `scheduleSlot`. All downstream surfaces stay per-`(slot, date)`;
there is simply one slot per block now.

## Components

### 1. Merge/split helper (pure, unit-tested)

A pure module that, given a set of a group's slots on one day plus a target
1-hour band, computes the resulting slot set. Encodes:

- **add**: insert the hour, then fuse with any adjacent same-group/same-room slot.
- **remove whole slot**: drop it.
- **shrink edge**: band is the first or last hour of a multi-hour slot → narrow
  the range.
- **split interior**: band is interior → two slots; the **earlier** half keeps the
  original slot id (and its records), the later half is a new slot.

This isolates the range arithmetic from Convex so it can be tested directly.

### 2. `toggleSession` mutation (editor)

Changes its matching from *exact start/end* to *find the group's slot on that day
whose range **contains** the band*, then applies the helper's decision:

- No containing slot → add hour, fuse with adjacent same-group/same-room slot
  (extend neighbor range; delete the absorbed empty atom).
- Band == whole slot → remove (current behavior).
- Band is an edge → shrink the slot range (patch `startTime`/`endTime`).
- Band is interior → split; existing `(slot,date)` records (attendance, payments,
  logs, submissions, overrides) stay with the earlier half; the later half starts
  empty.

Room-conflict checks already use overlap (`rangesOverlap`) and keep working.
The grids (`week-grid.tsx`, `weekly-session-grid.tsx`) and the dialog handler
(`edit-group-dialog.tsx handleToggleCell`) are unchanged — they still pass a
single band.

### 3. One-off migration (founder-gated mutation, dry-run by default)

Walks every group; for each `(group, dayOfWeek)` finds runs of contiguous
same-room atoms. Keeps the **earliest atom as canonical**, extends its `endTime`
to the run's end, and for each absorbed atom moves its data to the canonical slot
then deletes the atom.

Tables moved/re-pointed: `sessionLogs`, `attendance`, `sessionPayments`,
`sessionSubmissions`, `slotOverrides`, `slotStudents`, `slotTeachers`, and
`entries.slotId`.

**Conflict rules** (per `date`, where two fused atoms disagree) — approved:

- **Attendance:** present wins over absent; absent wins over unmarked.
- **Payments:** summed (block expected also sums to rate × total-hours, so this
  stays consistent).
- **Session log:** `held` wins over `cancelled` wins over none.
- **Submission:** submitted only if **all** fused atoms were submitted (an
  incomplete block still prompts).
- **Score entries:** already deduped by `(student, date, exercise)`; just set
  `slotId` to the canonical slot.

Runs in **dry-run mode by default**, returning a report: number of runs to fuse,
slots affected, and counts of each conflict kind. Founder reviews the report,
then re-runs with a commit flag.

### 4. Downstream surfaces — verify, do not rewrite

Day view (`weekSessions`, `DayList`), session page (`/session/[slotId]/[date]`),
analytics (`attendanceInsights`), and scoring all already operate per-slot with
`expected = rate × hours`. A multi-hour slot flows through unchanged: the 3–5pm
group becomes one card → one session page → one attendance/payment/submit pass,
with `hours = 2`. These are verification points, not edits.

## Data flow (after migration + normalization)

```
toggleSession(band) ──► normalize ──► scheduleSlots holds multi-hour rows
                                          │
        ┌─────────────────────────────────┼─────────────────────────────┐
        ▼                                 ▼                               ▼
  weekGrid (overlap render,         weekSessions ──► DayList         sessionDetail ──►
   unchanged)                        (1 card per slot)                session workspace
                                                                      (1 attendance/pay/submit)
```

## Error handling & edge cases

- **Different rooms**: contiguous atoms in different rooms are **not** fused (a
  multi-hour slot has a single `roomId`).
- **Interior split of a logged slot**: records stay with the earlier half; the
  removed hour's duration is simply dropped. Rare; acceptable.
- **Migration idempotency**: re-running the migration is a no-op once the
  invariant holds (no contiguous same-room runs remain).
- **Orphan slots** (`groupId` undefined / deleted group): ignored by the
  migration; existing reuse path in `toggleSession` is preserved.

## Testing

- Unit tests on the merge/split helper: add-fuse, remove-whole, shrink-start,
  shrink-end, split-interior, no-fuse-across-room, no-fuse-across-gap.
- Migration **dry-run report** against a prod snapshot before any commit run.
- Manual: in the edit-group grid, add 3–4 then 4–5 → one block; remove 4–5 →
  back to 3–4; remove the interior hour of a 3-hour block → two blocks. Confirm
  Day view shows one card for a multi-hour group and the session page reads
  `hours = 2`.

## Out of scope

- Approach A (view-layer merge keeping atoms).
- Any change to week-view or edit-grid rendering/interaction beyond the
  `toggleSession` mutation.
- Gap-separated same-day sittings of one group remain separate cards.
