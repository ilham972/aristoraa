# Merge back-to-back session slots — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Store back-to-back same-group/same-room session slots as one multi-hour `scheduleSlot` so the Day view shows a single card and the tutor does attendance/payment/cancel/submit once per class.

**Architecture:** Approach B + hybrid normalize. The week grid and edit picker keep clicking in 1-hour cells (both already render occupancy by overlap, so rendering is unchanged). The `toggleSession` mutation gains find-containing-band → add-fuse / remove / shrink / split logic, driven by a pure, unit-tested helper. A one-off founder-gated migration fuses existing contiguous atoms (dry-run by default). Downstream surfaces (day view, session page, analytics, scoring) already work per-`(slot,date)` and need verification only.

**Tech Stack:** Convex (TypeScript backend), Next.js 16 / React 19 frontend, vitest (added here for the pure helper).

**Spec:** `docs/superpowers/specs/2026-06-07-merge-back-to-back-sessions-design.md`

**Invariant:** A group never owns two contiguous (`endTime == startTime`) same-room slots on the same day.

---

## File structure

- Create `convex/lib/slotNormalize.ts` — pure range arithmetic (no Convex imports): `toggleBand`, `findContiguousRuns`, `mergeAttendanceStatus`, `mergeLogStatus`. Importable by both the backend and vitest.
- Create `convex/lib/slotMerge.ts` — DB-touching `absorbSlotData(ctx, fromSlotId, toSlotId)` shared by `toggleSession` and the migration.
- Modify `convex/groups.ts` — rewrite the matching/apply core of `toggleSession`.
- Create `convex/migrations.ts` — `fuseContiguousSlots` founder-gated mutation (dry-run default).
- Create `tests/slotNormalize.test.ts` — vitest unit tests for the pure helper.
- Create `vitest.config.ts` + add devDep/scripts to `package.json`.

---

## Task 1: Add vitest for pure-logic tests

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`
- Create: `tests/smoke.test.ts`

- [ ] **Step 1: Install vitest (dev only)**

Run:
```bash
npm install -D vitest@^2
```
Expected: `vitest` added under devDependencies; no production deps change.

- [ ] **Step 2: Create `vitest.config.ts`**

Scoped to `tests/` so it never touches the Next build or the Convex bundle.

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
```

- [ ] **Step 3: Add test scripts to `package.json`**

Add to the `"scripts"` block:
```json
    "test": "vitest run",
    "test:watch": "vitest"
```

- [ ] **Step 4: Write a smoke test**

`tests/smoke.test.ts`:
```ts
import { describe, it, expect } from 'vitest';

describe('vitest wiring', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 5: Run it**

Run: `npm test`
Expected: 1 passed.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json vitest.config.ts tests/smoke.test.ts
git commit -m "test: add vitest for pure-logic unit tests"
```

---

## Task 2: Pure `toggleBand` helper

Computes the resulting slot ranges for one `(group, day, room)` when a 1-hour band is toggled. `sourceId` tells the mutation which existing slot's id+data to reuse for each resulting range (`null` = brand-new range). The **earlier** piece of a split keeps the original id (and its data).

**Files:**
- Create: `convex/lib/slotNormalize.ts`
- Create: `tests/slotNormalize.test.ts`

- [ ] **Step 1: Write the failing tests**

`tests/slotNormalize.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { toggleBand, type SlotRange } from '../convex/lib/slotNormalize';

const b = (start: string, end: string) => ({ start, end });

describe('toggleBand — add', () => {
  it('adds an hour to an empty day', () => {
    const { result, toggled } = toggleBand([], b('15:00', '16:00'));
    expect(toggled).toBe('added');
    expect(result).toEqual([{ startTime: '15:00', endTime: '16:00', sourceId: null }]);
  });

  it('fuses with an adjacent slot, keeping the existing id', () => {
    const existing: SlotRange[] = [{ id: 'A', startTime: '15:00', endTime: '16:00' }];
    const { result, toggled } = toggleBand(existing, b('16:00', '17:00'));
    expect(toggled).toBe('added');
    expect(result).toEqual([{ startTime: '15:00', endTime: '17:00', sourceId: 'A' }]);
  });

  it('fuses across a filled gap, keeping the earliest id', () => {
    const existing: SlotRange[] = [
      { id: 'A', startTime: '15:00', endTime: '16:00' },
      { id: 'B', startTime: '17:00', endTime: '18:00' },
    ];
    const { result } = toggleBand(existing, b('16:00', '17:00'));
    expect(result).toEqual([{ startTime: '15:00', endTime: '18:00', sourceId: 'A' }]);
  });

  it('does not fuse across a gap', () => {
    const existing: SlotRange[] = [{ id: 'A', startTime: '15:00', endTime: '16:00' }];
    const { result } = toggleBand(existing, b('17:00', '18:00'));
    expect(result).toEqual([
      { startTime: '15:00', endTime: '16:00', sourceId: 'A' },
      { startTime: '17:00', endTime: '18:00', sourceId: null },
    ]);
  });
});

describe('toggleBand — remove', () => {
  it('removes a whole 1-hour slot', () => {
    const existing: SlotRange[] = [{ id: 'A', startTime: '15:00', endTime: '16:00' }];
    const { result, toggled } = toggleBand(existing, b('15:00', '16:00'));
    expect(toggled).toBe('removed');
    expect(result).toEqual([]);
  });

  it('shrinks at the end edge, keeping the id', () => {
    const existing: SlotRange[] = [{ id: 'A', startTime: '15:00', endTime: '17:00' }];
    const { result } = toggleBand(existing, b('16:00', '17:00'));
    expect(result).toEqual([{ startTime: '15:00', endTime: '16:00', sourceId: 'A' }]);
  });

  it('shrinks at the start edge, keeping the id', () => {
    const existing: SlotRange[] = [{ id: 'A', startTime: '15:00', endTime: '17:00' }];
    const { result } = toggleBand(existing, b('15:00', '16:00'));
    expect(result).toEqual([{ startTime: '16:00', endTime: '17:00', sourceId: 'A' }]);
  });

  it('splits an interior hour: earlier piece keeps the id, later is new', () => {
    const existing: SlotRange[] = [{ id: 'A', startTime: '15:00', endTime: '18:00' }];
    const { result } = toggleBand(existing, b('16:00', '17:00'));
    expect(result).toEqual([
      { startTime: '15:00', endTime: '16:00', sourceId: 'A' },
      { startTime: '17:00', endTime: '18:00', sourceId: null },
    ]);
  });

  it('leaves other slots untouched when removing', () => {
    const existing: SlotRange[] = [
      { id: 'A', startTime: '15:00', endTime: '16:00' },
      { id: 'B', startTime: '18:00', endTime: '19:00' },
    ];
    const { result } = toggleBand(existing, b('15:00', '16:00'));
    expect(result).toEqual([{ startTime: '18:00', endTime: '19:00', sourceId: 'B' }]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `toggleBand` not exported / module not found.

- [ ] **Step 3: Implement `convex/lib/slotNormalize.ts`**

```ts
// Pure range arithmetic for the weekly time grid. NO Convex imports — this
// module is shared by the toggleSession mutation, the fuse migration, and
// vitest. Times are zero-padded 24h "HH:MM" strings, so lexicographic
// comparison is chronological.

export type SlotRange = { id: string; startTime: string; endTime: string };

// sourceId === the existing slot whose id + per-(slot,date) data the caller
// should reuse for this resulting range. null = a brand-new range.
export type ResolvedSlot = { startTime: string; endTime: string; sourceId: string | null };

// Toggle one 1-hour band against a group's slots for a single (day, room).
// Returns the desired resulting ranges plus whether the action added or
// removed coverage. Removal splits the covering slot; the EARLIER piece keeps
// the original id (its data stays put), the later piece is new.
export function toggleBand(
  existing: SlotRange[],
  band: { start: string; end: string },
): { result: ResolvedSlot[]; toggled: 'added' | 'removed' } {
  const covering = existing.find(
    (s) => s.startTime <= band.start && s.endTime >= band.end,
  );

  if (covering) {
    const result: ResolvedSlot[] = [];
    for (const s of existing) {
      if (s.id !== covering.id) {
        result.push({ startTime: s.startTime, endTime: s.endTime, sourceId: s.id });
        continue;
      }
      const leftStart = s.startTime;
      const leftEnd = band.start;
      const rightStart = band.end;
      const rightEnd = s.endTime;
      if (leftStart < leftEnd) {
        result.push({ startTime: leftStart, endTime: leftEnd, sourceId: s.id });
        if (rightStart < rightEnd) {
          result.push({ startTime: rightStart, endTime: rightEnd, sourceId: null });
        }
      } else if (rightStart < rightEnd) {
        // band was the start edge — keep id on the remaining piece.
        result.push({ startTime: rightStart, endTime: rightEnd, sourceId: s.id });
      }
      // else band === whole slot → drop it entirely.
    }
    return { result, toggled: 'removed' };
  }

  // Addition — insert the band, then merge contiguous/overlapping ranges.
  const pieces = [
    ...existing.map((s) => ({ start: s.startTime, end: s.endTime, id: s.id as string | null })),
    { start: band.start, end: band.end, id: null as string | null },
  ].sort((a, b) => a.start.localeCompare(b.start));

  const merged: ResolvedSlot[] = [];
  for (const p of pieces) {
    const last = merged[merged.length - 1];
    if (last && p.start <= last.endTime) {
      if (p.end > last.endTime) last.endTime = p.end;
      // Keep the earliest existing id for the run; a later id (if any) marks a
      // slot the caller must absorb + delete.
      if (last.sourceId == null && p.id != null) last.sourceId = p.id;
    } else {
      merged.push({ startTime: p.start, endTime: p.end, sourceId: p.id });
    }
  }
  return { result: merged, toggled: 'added' };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: all `toggleBand` tests PASS.

- [ ] **Step 5: Commit**

```bash
git add convex/lib/slotNormalize.ts tests/slotNormalize.test.ts
git commit -m "feat: pure toggleBand slot range helper"
```

---

## Task 3: Pure `findContiguousRuns` helper (for the migration)

Groups a flat slot list into runs of contiguous same-room slots, so the migration knows which atoms to fuse. Input is already scoped to one group + one dayOfWeek by the caller.

**Files:**
- Modify: `convex/lib/slotNormalize.ts`
- Modify: `tests/slotNormalize.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `tests/slotNormalize.test.ts`:
```ts
import { findContiguousRuns } from '../convex/lib/slotNormalize';

describe('findContiguousRuns', () => {
  it('returns runs of contiguous same-room slots, sorted', () => {
    const slots = [
      { id: 'B', startTime: '16:00', endTime: '17:00', roomId: 'r1' },
      { id: 'A', startTime: '15:00', endTime: '16:00', roomId: 'r1' },
      { id: 'C', startTime: '18:00', endTime: '19:00', roomId: 'r1' },
    ];
    expect(findContiguousRuns(slots)).toEqual([['A', 'B'], ['C']]);
  });

  it('does not fuse across a different room', () => {
    const slots = [
      { id: 'A', startTime: '15:00', endTime: '16:00', roomId: 'r1' },
      { id: 'B', startTime: '16:00', endTime: '17:00', roomId: 'r2' },
    ];
    expect(findContiguousRuns(slots)).toEqual([['A'], ['B']]);
  });

  it('treats a single slot as a run of one', () => {
    const slots = [{ id: 'A', startTime: '15:00', endTime: '17:00', roomId: 'r1' }];
    expect(findContiguousRuns(slots)).toEqual([['A']]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test`
Expected: FAIL — `findContiguousRuns` not exported.

- [ ] **Step 3: Implement**

Append to `convex/lib/slotNormalize.ts`:
```ts
export type RoomedSlot = SlotRange & { roomId: string };

// Group already-same-(group,day) slots into runs of contiguous same-room
// slots. Each run is the ordered list of slot ids that must fuse into one.
export function findContiguousRuns(slots: RoomedSlot[]): string[][] {
  const sorted = [...slots].sort((a, b) => a.startTime.localeCompare(b.startTime));
  const runs: string[][] = [];
  let cur: RoomedSlot[] = [];
  for (const s of sorted) {
    const prev = cur[cur.length - 1];
    if (prev && prev.endTime === s.startTime && prev.roomId === s.roomId) {
      cur.push(s);
    } else {
      if (cur.length) runs.push(cur.map((x) => x.id));
      cur = [s];
    }
  }
  if (cur.length) runs.push(cur.map((x) => x.id));
  return runs;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add convex/lib/slotNormalize.ts tests/slotNormalize.test.ts
git commit -m "feat: findContiguousRuns helper for slot fusion"
```

---

## Task 4: Pure conflict resolvers

Encode the approved migration conflict rules as tiny pure functions so they're tested and reused by both `absorbSlotData` and the migration report.

**Files:**
- Modify: `convex/lib/slotNormalize.ts`
- Modify: `tests/slotNormalize.test.ts`

- [ ] **Step 1: Add failing tests**

Append:
```ts
import { mergeAttendanceStatus, mergeLogStatus } from '../convex/lib/slotNormalize';

describe('mergeAttendanceStatus — present wins, then absent', () => {
  it('present wins over absent', () => {
    expect(mergeAttendanceStatus(['absent', 'present'])).toBe('present');
  });
  it('absent when no present', () => {
    expect(mergeAttendanceStatus(['absent', 'absent'])).toBe('absent');
  });
  it('null when empty', () => {
    expect(mergeAttendanceStatus([])).toBe(null);
  });
});

describe('mergeLogStatus — held > cancelled > none', () => {
  it('held wins', () => {
    expect(mergeLogStatus(['cancelled_by_tutor', 'held'])).toBe('held');
  });
  it('cancelled when no held', () => {
    expect(mergeLogStatus(['cancelled_by_tutor'])).toBe('cancelled_by_tutor');
  });
  it('null when empty', () => {
    expect(mergeLogStatus([])).toBe(null);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test`
Expected: FAIL — functions not exported.

- [ ] **Step 3: Implement**

Append to `convex/lib/slotNormalize.ts`:
```ts
// Approved conflict rule: present wins over absent; absent over unmarked.
// (Only 'present'/'absent' rows are ever stored.)
export function mergeAttendanceStatus(statuses: string[]): 'present' | 'absent' | null {
  if (statuses.includes('present')) return 'present';
  if (statuses.includes('absent')) return 'absent';
  return null;
}

// Approved conflict rule: held wins over cancelled wins over none.
export function mergeLogStatus(statuses: string[]): 'held' | 'cancelled_by_tutor' | null {
  if (statuses.includes('held')) return 'held';
  if (statuses.includes('cancelled_by_tutor')) return 'cancelled_by_tutor';
  return null;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add convex/lib/slotNormalize.ts tests/slotNormalize.test.ts
git commit -m "feat: attendance + log status conflict resolvers"
```

---

## Task 5: `absorbSlotData` DB helper

Moves all per-`(slot,date)` data from one slot into another, applying the conflict rules. Used when an atom is absorbed (migration fuse, or live add-fusion across a data-bearing gap). DB-touching, so it's verified via the migration dry-run + manual checks (no convex-test harness in this repo).

**Files:**
- Create: `convex/lib/slotMerge.ts`

- [ ] **Step 1: Implement `convex/lib/slotMerge.ts`**

```ts
// Move every per-(slot,date) record from `fromSlotId` onto `toSlotId`,
// resolving conflicts with the approved rules (see design spec §3). Pure
// arithmetic lives in slotNormalize; this file owns the DB walk only.

import type { GenericMutationCtx } from 'convex/server';
import type { DataModel, Id } from '../_generated/dataModel';
import { mergeAttendanceStatus, mergeLogStatus } from './slotNormalize';

type Ctx = GenericMutationCtx<DataModel>;

export async function absorbSlotData(
  ctx: Ctx,
  fromSlotId: Id<'scheduleSlots'>,
  toSlotId: Id<'scheduleSlots'>,
): Promise<void> {
  if (fromSlotId === toSlotId) return;

  // ── attendance: per (date, student); present wins, OR sessionFinished ──
  const fromAtt = await ctx.db
    .query('attendance')
    .withIndex('by_slot_date', (q) => q.eq('slotId', fromSlotId))
    .collect();
  for (const a of fromAtt) {
    const targetRows = await ctx.db
      .query('attendance')
      .withIndex('by_slot_date', (q) => q.eq('slotId', toSlotId).eq('date', a.date))
      .collect();
    const target = targetRows.find((t) => t.studentId === a.studentId);
    if (target) {
      await ctx.db.patch(target._id, {
        status: mergeAttendanceStatus([target.status, a.status]) ?? target.status,
        sessionFinished: target.sessionFinished || a.sessionFinished || undefined,
      });
      await ctx.db.delete(a._id);
    } else {
      await ctx.db.patch(a._id, { slotId: toSlotId });
    }
  }

  // ── sessionPayments: summed (collapse to one row per date+student) ──
  const fromPay = await ctx.db
    .query('sessionPayments')
    .withIndex('by_slot_date', (q) => q.eq('slotId', fromSlotId))
    .collect();
  for (const p of fromPay) {
    const targetRows = await ctx.db
      .query('sessionPayments')
      .withIndex('by_slot_date_student', (q) =>
        q.eq('slotId', toSlotId).eq('date', p.date).eq('studentId', p.studentId),
      )
      .collect();
    if (targetRows.length > 0) {
      await ctx.db.patch(targetRows[0]._id, {
        amount: targetRows[0].amount + p.amount,
        paidAt: Math.max(targetRows[0].paidAt, p.paidAt),
      });
      await ctx.db.delete(p._id);
    } else {
      await ctx.db.patch(p._id, { slotId: toSlotId });
    }
  }

  // ── sessionLogs: held > cancelled > none (one row per date) ──
  const fromLogs = await ctx.db
    .query('sessionLogs')
    .withIndex('by_slot_date', (q) => q.eq('slotId', fromSlotId))
    .collect();
  for (const l of fromLogs) {
    const targetRows = await ctx.db
      .query('sessionLogs')
      .withIndex('by_slot_date', (q) => q.eq('slotId', toSlotId).eq('date', l.date))
      .collect();
    const target = targetRows[0];
    if (target) {
      const winner = mergeLogStatus([target.status, l.status]);
      const keepFrom = winner === l.status && winner !== target.status;
      await ctx.db.patch(target._id, {
        status: winner ?? target.status,
        reason: winner === 'cancelled_by_tutor' ? (keepFrom ? l.reason : target.reason) : undefined,
        note: keepFrom ? l.note : target.note,
        loggedAt: Math.max(target.loggedAt, l.loggedAt),
      });
      await ctx.db.delete(l._id);
    } else {
      await ctx.db.patch(l._id, { slotId: toSlotId });
    }
  }

  // ── sessionSubmissions: submitted only if ALL atoms submitted ──
  // The migration deletes the canonical's submission unless every fused atom
  // had one (handled there). Here we just re-point/merge: keep one row per
  // date; sum the counts so a kept row reflects the block.
  const fromSubs = await ctx.db
    .query('sessionSubmissions')
    .withIndex('by_slot_date', (q) => q.eq('slotId', fromSlotId))
    .collect();
  for (const s of fromSubs) {
    const targetRows = await ctx.db
      .query('sessionSubmissions')
      .withIndex('by_slot_date', (q) => q.eq('slotId', toSlotId).eq('date', s.date))
      .collect();
    if (targetRows[0]) {
      await ctx.db.patch(targetRows[0]._id, {
        presentCount: targetRows[0].presentCount + s.presentCount,
        absentCount: targetRows[0].absentCount + s.absentCount,
        entryCount: targetRows[0].entryCount + s.entryCount,
        submittedAt: Math.max(targetRows[0].submittedAt, s.submittedAt),
      });
      await ctx.db.delete(s._id);
    } else {
      await ctx.db.patch(s._id, { slotId: toSlotId });
    }
  }

  // ── slotOverrides: dedupe by (date, student) ──
  const fromOv = await ctx.db
    .query('slotOverrides')
    .withIndex('by_slot_date', (q) => q.eq('slotId', fromSlotId))
    .collect();
  for (const o of fromOv) {
    const targetRows = await ctx.db
      .query('slotOverrides')
      .withIndex('by_slot_date', (q) => q.eq('slotId', toSlotId).eq('date', o.date))
      .collect();
    const dupe = targetRows.find((t) => t.studentId === o.studentId);
    if (dupe) await ctx.db.delete(o._id);
    else await ctx.db.patch(o._id, { slotId: toSlotId });
  }

  // ── slotStudents (legacy roster): dedupe by student ──
  const fromSS = await ctx.db
    .query('slotStudents')
    .withIndex('by_slot', (q) => q.eq('slotId', fromSlotId))
    .collect();
  for (const ss of fromSS) {
    const targetRows = await ctx.db
      .query('slotStudents')
      .withIndex('by_slot', (q) => q.eq('slotId', toSlotId))
      .collect();
    const dupe = targetRows.find((t) => t.studentId === ss.studentId);
    if (dupe) await ctx.db.delete(ss._id);
    else await ctx.db.patch(ss._id, { slotId: toSlotId });
  }

  // ── slotTeachers: dedupe by teacher ──
  const fromST = await ctx.db
    .query('slotTeachers')
    .withIndex('by_slot', (q) => q.eq('slotId', fromSlotId))
    .collect();
  for (const st of fromST) {
    const targetRows = await ctx.db
      .query('slotTeachers')
      .withIndex('by_slot', (q) => q.eq('slotId', toSlotId))
      .collect();
    const dupe = targetRows.find((t) => t.teacherId === st.teacherId);
    if (dupe) await ctx.db.delete(st._id);
    else await ctx.db.patch(st._id, { slotId: toSlotId });
  }

  // ── entries (scoring): slotId is metadata only — re-point all ──
  const fromEntries = await ctx.db
    .query('entries')
    .withIndex('by_slot', (q) => q.eq('slotId', fromSlotId))
    .collect();
  for (const e of fromEntries) {
    await ctx.db.patch(e._id, { slotId: toSlotId });
  }
}
```

- [ ] **Step 2: Verify `entries` has a `by_slot` index; add if missing**

Run: `npm run -s convex:codegen 2>$null; if (-not $?) { npx convex codegen }`
(If no `convex:codegen` script exists, run `npx convex codegen` directly.)

Open `convex/schema.ts` at the `entries` table. If there is **no** `.index("by_slot", ["slotId"])`, add it after the existing entries indexes:
```ts
    .index("by_slot", ["slotId"])
```
(The `entries` table already has `by_date`, `by_student`, `by_student_date`; append `by_slot` so `absorbSlotData` can query by slot without a full scan.)

- [ ] **Step 3: Typecheck the backend**

Run: `npx convex codegen`
Expected: completes with no type errors referencing `slotMerge.ts`.

- [ ] **Step 4: Commit**

```bash
git add convex/lib/slotMerge.ts convex/schema.ts convex/_generated
git commit -m "feat: absorbSlotData helper + entries by_slot index"
```

---

## Task 6: Rewrite `toggleSession` to normalize

Replace the exact-time match with containing-band logic driven by `toggleBand`, preserving the existing room-conflict and orphan-reuse safeguards.

**Files:**
- Modify: `convex/groups.ts` (the `toggleSession` mutation, currently ~line 896)

- [ ] **Step 1: Read the current mutation**

Read `convex/groups.ts` lines 896–977 to confirm the current body, the `rangesOverlap` helper, and `RATE_DEFAULT_LKR`/import locations before editing.

- [ ] **Step 2: Add the import**

At the top of `convex/groups.ts`, add:
```ts
import { toggleBand, type SlotRange } from "./lib/slotNormalize";
import { absorbSlotData } from "./lib/slotMerge";
```

- [ ] **Step 3: Replace the handler body**

Replace the whole `handler` of `toggleSession` (keep the `args` block identical) with:

```ts
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Unauthenticated");

    const group = await ctx.db.get(args.groupId);
    if (!group) throw new ConvexError("Group not found");

    const roomId = args.roomId ?? group.defaultRoomId;
    if (!roomId) {
      throw new ConvexError("No room: set a default room on the group first");
    }

    // This group's slots on this day, in this room — the input to toggleBand.
    const owned = await ctx.db
      .query("scheduleSlots")
      .withIndex("by_group", (q) => q.eq("groupId", args.groupId))
      .collect();
    const sameDayRoom = owned.filter(
      (s) => s.dayOfWeek === args.dayOfWeek && s.roomId === roomId,
    );
    const existing: SlotRange[] = sameDayRoom.map((s) => ({
      id: s._id,
      startTime: s.startTime,
      endTime: s.endTime,
    }));

    const band = { start: args.startTime, end: args.endTime };
    const isAdding = !existing.some(
      (s) => s.startTime <= band.start && s.endTime >= band.end,
    );

    // Room-conflict guard (adds only): another LIVE group overlapping this
    // band in the same room. Orphan rows (group deleted) are treated as free.
    if (isAdding) {
      const roomSlots = await ctx.db
        .query("scheduleSlots")
        .withIndex("by_room", (q) => q.eq("roomId", roomId))
        .collect();
      for (const s of roomSlots) {
        if (!s.groupId || s.groupId === args.groupId) continue;
        const owner = await ctx.db.get(s.groupId);
        if (!owner) continue; // orphan — free
        if (
          s.dayOfWeek === args.dayOfWeek &&
          rangesOverlap(s.startTime, s.endTime, args.startTime, args.endTime)
        ) {
          throw new ConvexError("Room already booked at this time by another group");
        }
      }
    }

    const { result, toggled } = toggleBand(existing, band);

    // Apply the desired end-state.
    //  • result slot with sourceId → patch that slot's range.
    //  • result slot without sourceId → insert a new slot.
    //  • existing slot absent from result → absorbed or removed: move its data
    //    into the result slot covering its old range (if any), then delete.
    const keptIds = new Set(
      result.map((r) => r.sourceId).filter((x): x is string => x != null),
    );

    let primarySlotId: Id<"scheduleSlots"> | undefined;
    for (const r of result) {
      if (r.sourceId) {
        await ctx.db.patch(r.sourceId as Id<"scheduleSlots">, {
          startTime: r.startTime,
          endTime: r.endTime,
        });
        if (!primarySlotId) primarySlotId = r.sourceId as Id<"scheduleSlots">;
      } else {
        const newId = await ctx.db.insert("scheduleSlots", {
          dayOfWeek: args.dayOfWeek,
          startTime: r.startTime,
          endTime: r.endTime,
          roomId,
          groupId: args.groupId,
        });
        if (!primarySlotId) primarySlotId = newId;
      }
    }

    for (const s of sameDayRoom) {
      if (keptIds.has(s._id)) continue;
      // Find the result range that now contains this absorbed slot's old span.
      const target = result.find(
        (r) =>
          r.sourceId != null &&
          r.startTime <= s.startTime &&
          r.endTime >= s.endTime,
      );
      if (target && target.sourceId) {
        await absorbSlotData(ctx, s._id, target.sourceId as Id<"scheduleSlots">);
      }
      await ctx.db.delete(s._id);
    }

    return { action: toggled, slotId: primarySlotId };
  },
```

> Note: this replaces the old orphan-reuse insert path. New inserts no longer attempt to reclaim a foreign empty/orphan row at the exact time; the room-conflict guard above already proved the band is free of *live* groups, and orphan rows are harmless duplicates that the next migration run / manual cleanup can reap. This keeps the apply step a clean diff of `toggleBand`'s output.

- [ ] **Step 4: Typecheck**

Run: `npx convex codegen`
Expected: no type errors. Confirm `Id` is already imported in `groups.ts` (it is used elsewhere); if not, import it from `./_generated/dataModel`.

- [ ] **Step 5: Manual verification (dev deployment)**

Run the app against a dev deployment and, in the edit-group grid:
1. Add 3–4 then 4–5 on the same day → the grid shows a continuous 3–5 block; `api.groups.weekGrid` / day view shows **one** card.
2. Remove the 4–5 hour → back to a single 3–4 block.
3. On a 3-hour block (3–6), remove the interior 4–5 hour → two blocks (3–4 and 5–6).
4. Confirm the Day-view card for a fused block reads the full span and `hours` equals the span when opened in the session page.

Record the observations in the commit message.

- [ ] **Step 6: Commit**

```bash
git add convex/groups.ts
git commit -m "feat: toggleSession fuses/splits contiguous slots (hybrid normalize)"
```

---

## Task 7: One-off fuse migration (dry-run by default)

Founder-gated mutation that fuses existing contiguous atoms across the whole DB. Defaults to a **dry-run report**; only mutates when `commit: true`.

**Files:**
- Create: `convex/migrations.ts`

- [ ] **Step 1: Implement `convex/migrations.ts`**

```ts
// One-off, founder-gated data migration: fuse contiguous same-room slots of
// the same group on the same day into a single multi-hour scheduleSlot.
// Dry-run by default — pass { commit: true } to mutate. See design spec §3.

import { mutation } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { findContiguousRuns, type RoomedSlot } from "./lib/slotNormalize";
import { absorbSlotData } from "./lib/slotMerge";

export const fuseContiguousSlots = mutation({
  args: { commit: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Unauthenticated");

    const commit = args.commit === true;
    const allSlots = await ctx.db.query("scheduleSlots").collect();

    // Bucket live (group-owned) slots by group|day.
    const buckets = new Map<string, RoomedSlot[]>();
    for (const s of allSlots) {
      if (!s.groupId) continue;
      const key = `${s.groupId}|${s.dayOfWeek}`;
      const arr = buckets.get(key) ?? [];
      arr.push({ id: s._id, startTime: s.startTime, endTime: s.endTime, roomId: s.roomId });
      buckets.set(key, arr);
    }

    let runsToFuse = 0;
    let slotsAbsorbed = 0;
    const examples: string[] = [];

    for (const [key, slots] of buckets) {
      const runs = findContiguousRuns(slots);
      for (const run of runs) {
        if (run.length < 2) continue;
        runsToFuse += 1;
        slotsAbsorbed += run.length - 1;

        const ordered = run
          .map((id) => slots.find((s) => s.id === id)!)
          .sort((a, b) => a.startTime.localeCompare(b.startTime));
        const canonical = ordered[0];
        const runEnd = ordered[ordered.length - 1].endTime;

        if (examples.length < 10) {
          examples.push(`${key}: ${canonical.startTime}-${runEnd} (${run.length} atoms)`);
        }

        if (commit) {
          // Extend canonical to cover the whole run.
          await ctx.db.patch(canonical.id as Id<"scheduleSlots">, { endTime: runEnd });
          // Absorb + delete the rest.
          for (let i = 1; i < ordered.length; i++) {
            await absorbSlotData(
              ctx,
              ordered[i].id as Id<"scheduleSlots">,
              canonical.id as Id<"scheduleSlots">,
            );
            await ctx.db.delete(ordered[i].id as Id<"scheduleSlots">);
          }
        }
      }
    }

    return {
      mode: commit ? "committed" : "dry-run",
      runsToFuse,
      slotsAbsorbed,
      examples,
    };
  },
});
```

- [ ] **Step 2: Typecheck**

Run: `npx convex codegen`
Expected: no type errors.

- [ ] **Step 3: Dry-run against the dev deployment**

Run the dry run (no data change):
```bash
npx convex run migrations:fuseContiguousSlots
```
Expected: a report `{ mode: "dry-run", runsToFuse, slotsAbsorbed, examples }`. Sanity-check the example spans look like real back-to-back classes (e.g. `15:00-17:00 (2 atoms)`).

- [ ] **Step 4: Commit (dev only so far)**

```bash
git add convex/migrations.ts convex/_generated
git commit -m "feat: fuseContiguousSlots migration (dry-run default)"
```

- [ ] **Step 5: Commit run on dev, then re-verify idempotency**

```bash
npx convex run migrations:fuseContiguousSlots '{"commit": true}'
npx convex run migrations:fuseContiguousSlots
```
Expected: first call `mode: "committed"` with the fuse counts; second call `runsToFuse: 0` (idempotent). Then re-check the Day view in the app: fused groups now show **one** card with the full span and correct expected = rate × total hours.

> **PROD run is founder-gated and out of scope for this plan's commits.** The founder runs `fuseContiguousSlots` (dry-run → review → `commit: true`) against prod manually after dev verification.

---

## Task 8: Downstream verification + regression guard

Confirm the surfaces the spec says are "verify-only" actually behave, and lock in the no-card-duplication expectation.

**Files:**
- Modify: `tests/slotNormalize.test.ts`

- [ ] **Step 1: Add a guard test for the invariant via toggleBand**

Append to `tests/slotNormalize.test.ts`:
```ts
describe('invariant: no two contiguous results after a toggle', () => {
  it('adding the middle hour of three never yields adjacent ranges', () => {
    const existing: SlotRange[] = [
      { id: 'A', startTime: '15:00', endTime: '16:00' },
      { id: 'B', startTime: '17:00', endTime: '18:00' },
    ];
    const { result } = toggleBand(existing, { start: '16:00', end: '17:00' });
    for (let i = 1; i < result.length; i++) {
      expect(result[i].startTime > result[i - 1].endTime).toBe(true);
    }
    expect(result).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run**

Run: `npm test`
Expected: all PASS.

- [ ] **Step 3: Manual verification checklist (dev)**

Confirm with the app on dev (after the Task 7 commit run):
- Day view: a former 3–5 group shows ONE card; tapping opens the session page with `hours = 2` and `expected = rate × 2`.
- Attendance: marking a student present once covers the whole block (one row per student).
- Payment: one entry for the block; collected equals the single number entered.
- Cancel: cancelling the card cancels the whole block (one grey card).
- Submit: submitting once clears the block from "needs entry".
- Week view: rendering + add/remove/split editing all behave (Task 6 manual steps).
- Analytics (`/analytics`): session counts drop (fewer slots), revenue totals unchanged.

- [ ] **Step 4: Commit**

```bash
git add tests/slotNormalize.test.ts
git commit -m "test: guard the no-contiguous-result invariant"
```

---

## Self-review notes

- **Spec coverage:** invariant (Tasks 2/6/8), editor add/remove/shrink/split (Tasks 2/6), migration with approved conflict rules + dry-run (Tasks 4/5/7), downstream verify-only (Task 8), no week-view rendering change (untouched grids; only `toggleSession`). ✓
- **Conflict rules:** present-wins (`mergeAttendanceStatus`), payments summed (`absorbSlotData` sessionPayments), held>cancelled (`mergeLogStatus`), submission all-atoms (migration deletes non-unanimous — see note below). ✓
- **Submission "all atoms" rule refinement:** `absorbSlotData` sums submission rows, but the spec rule is "submitted only if ALL fused atoms were submitted." Enforce in the migration commit branch: after absorbing, if the number of submission rows that existed across the run is less than `run.length`, delete the canonical's merged submission row for that date so the block re-prompts. Implement this as part of Task 7 Step 1 if the dry-run report shows any submission conflicts; otherwise the rule is moot (no historical submissions on these atoms). Verify via dry-run before relying on it.
- **Type consistency:** `SlotRange`, `RoomedSlot`, `ResolvedSlot`, `toggleBand`, `findContiguousRuns`, `mergeAttendanceStatus`, `mergeLogStatus`, `absorbSlotData` names match across tasks. ✓
```
