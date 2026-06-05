# Track Model — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add named, cross-grade "tracks" (levels) that each student rides, so the sheet planner's Main block walks a student's track instead of the flat `(grade, term)` teaching path — with zero behavior change for students left on their on-level track.

**Architecture:** New `tracks` table (a flat ordered list of curriculum unit ids spanning grades) + `students.trackId`. A track's "skip" is expressed by a unit's *absence* from its `orderedUnitIds`. The planner gains a track resolver: when a student has a track, the Main block restricts new-concept candidates to the track's units and orders them by the track's global rank; otherwise it falls back to today's per-(grade,term) `resolveTeachingPath`. On-level tracks are seeded from the existing `teachingPath` so the fallback and the track produce identical sheets — that equivalence is the regression gate.

**Tech Stack:** Convex 1.33 (backend, TypeScript strict), Next.js 16 App Router, React 19, Tailwind v4, shadcn/ui. **No test framework exists in this repo** — verification is dual typecheck + `convex codegen` + manual Convex-dashboard / sheet smoke checks. Do NOT introduce a test runner.

---

## CRITICAL constraints (read before any task)

- **The app is LIVE on production Convex env `loris`.** Never run codegen/deploy against `loris`. Type generation runs against the **DEV** deployment only. If an agent lacks Convex creds in its worktree, the `npx convex codegen` step is a **founder checkpoint** — stop and report; do not improvise.
- **Work in an isolated git worktree** off `feat/track-model-phase1`. Merge to the live branch is founder-gated.
- **Backend typecheck:** `npx tsc --noEmit -p convex/tsconfig.json` (needs `convex/_generated` up to date — run codegen after schema edits).
- **Frontend typecheck:** `npx tsc --noEmit -p tsconfig.json`.
- **Lint (optional):** `npx eslint <changed files>`.
- One task = one commit. Commit messages: `feat(track-X): …`.
- Convex functions CANNOT import `src/lib/curriculum-data.ts` (frontend). The client passes unit ids down — follow the existing convention in `convex/learningEngine/path.ts::listPathUnitsWithPriority`.

---

## File structure

| File | Create/Modify | Responsibility |
|---|---|---|
| `convex/schema.ts` | Modify | Add `tracks` table; add `students.trackId`. |
| `convex/learningEngine/tracks.ts` | Create | Track CRUD, `resolveTrackForStudent` helper, seed, student assignment, remedial-builder candidate query. |
| `convex/learningEngine/planner.ts` | Modify | Track-aware Main-block candidate restriction + ordering + target-grade/term. |
| `src/components/algorithm/tracks-tab.tsx` | Create | Tracks UI: list, seed on-level, remedial-track builder, create/edit. |
| `src/app/algorithm/page.tsx` | Modify | Register the `tracks` tab. |
| `src/components/algorithm/track-picker.tsx` | Create | Reusable per-student track assignment control. |
| `src/app/students/page.tsx` | Modify | Mount the track picker on each student. |

---

## Task 1: Schema — `tracks` table + `students.trackId`

**Files:**
- Modify: `convex/schema.ts` (the `students` table definition; add a new `tracks` table near `teachingPath` ~line 696)

- [ ] **Step 1: Add `trackId` to the `students` table.** Inside `students: defineTable({ ... })`, alongside `assignedGrades` (~line 14), add:

```ts
    // Phase 1 (track model): the single track this student rides, spanning all
    // six modules. Optional — a student with no trackId falls back to the
    // legacy schoolGrade + teachingPath behaviour in the planner.
    trackId: v.optional(v.id("tracks")),
```

- [ ] **Step 2: Add the `tracks` table.** Immediately after the `teachingPath` table definition (~line 705), add:

```ts
  // ─── Phase 1 (track model): named cross-grade learning tracks (levels) ───
  // A track is a flat, teacher-curated, importance-filtered route through the
  // curriculum. `orderedUnitIds` may span multiple grades (e.g. a remedial
  // G7→G9 track). A unit is "skipped" for the track simply by being ABSENT
  // from orderedUnitIds. One track per student (students.trackId). The planner
  // walks this list for the Main block; ranking/promotion/map are later phases.
  tracks: defineTable({
    name: v.string(),                              // "On-level G9", "Remedial G7→G9 (core)"
    targetGrade: v.number(),                       // 6..11 — the exam this track aims at
    targetTerm: v.number(),                        // 1 | 2 | 3 — current target term
    orderedUnitIds: v.array(v.string()),           // cross-grade route, teaching order; ids "M{n}-G{g}-T{t}-{i}"
    level: v.number(),                             // promotion rank (lower = more remedial); used by Phase 3
    mergesIntoTrackId: v.optional(v.id("tracks")), // promote-into pointer; stored now, used by Phase 3/4
    active: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
    updatedByTeacherId: v.optional(v.id("teachers")),
  })
    .index("by_target_grade_term", ["targetGrade", "targetTerm"])
    .index("by_level", ["level"]),
```

- [ ] **Step 3: Regenerate Convex types (DEV deployment only — NOT loris).**

Run: `npx convex codegen`
Expected: `convex/_generated/dataModel.d.ts` now includes `tracks`; exit 0.
**If the worktree has no Convex creds → STOP, report to founder (founder checkpoint).**

- [ ] **Step 4: Backend typecheck.**

Run: `npx tsc --noEmit -p convex/tsconfig.json`
Expected: exit 0, no errors.

- [ ] **Step 5: Commit.**

```bash
git add convex/schema.ts convex/_generated
git commit -m "feat(track-1): tracks table + students.trackId schema"
```

---

## Task 2: Backend — track CRUD + `resolveTrackForStudent`

**Files:**
- Create: `convex/learningEngine/tracks.ts`
- Reference (read first): `convex/learningEngine/path.ts` (auth + `resolveTeacherId` + upsert patterns)

- [ ] **Step 1: Create `convex/learningEngine/tracks.ts` with CRUD + helper.**

```ts
// Phase 1 (track model): CRUD + read helpers for learning tracks.
// A track is a flat cross-grade ordered list of curriculum unit ids the
// student's Main block walks. See docs/superpowers/specs/2026-06-05-track-model-phase1-design.md

import { mutation, query } from "../_generated/server";
import { v } from "convex/values";
import type { GenericMutationCtx, GenericQueryCtx } from "convex/server";
import type { DataModel, Doc, Id } from "../_generated/dataModel";

type QueryCtx = GenericQueryCtx<DataModel>;
type MutationCtx = GenericMutationCtx<DataModel>;
type ReadCtx = QueryCtx | MutationCtx;

// Resolve the calling teacher id (best-effort audit field). Mirrors
// path.ts::resolveTeacherId — historical duplicate teacher rows mean we must
// collect()-not-unique() and pick the oldest deterministically.
async function resolveTeacherId(ctx: MutationCtx): Promise<Id<"teachers"> | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  const rows = await ctx.db
    .query("teachers")
    .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", identity.subject))
    .collect();
  if (rows.length === 0) return null;
  return rows.reduce((a, b) => (a._creationTime <= b._creationTime ? a : b))._id;
}

// Internal: the track a student rides, or null. Used by the planner (Task 3).
export async function resolveTrackForStudent(
  ctx: ReadCtx,
  student: Doc<"students">,
): Promise<Doc<"tracks"> | null> {
  if (!student.trackId) return null;
  return await ctx.db.get(student.trackId);
}

export const listTracks = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const rows = await ctx.db.query("tracks").collect();
    return rows.sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
  },
});

export const getTrack = query({
  args: { id: v.id("tracks") },
  handler: async (ctx, { id }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    return await ctx.db.get(id);
  },
});

export const createTrack = mutation({
  args: {
    name: v.string(),
    targetGrade: v.number(),
    targetTerm: v.number(),
    orderedUnitIds: v.array(v.string()),
    level: v.number(),
    mergesIntoTrackId: v.optional(v.id("tracks")),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    const teacherId = await resolveTeacherId(ctx);
    const now = Date.now();
    const id = await ctx.db.insert("tracks", {
      name: args.name,
      targetGrade: args.targetGrade,
      targetTerm: args.targetTerm,
      orderedUnitIds: args.orderedUnitIds,
      level: args.level,
      mergesIntoTrackId: args.mergesIntoTrackId,
      active: true,
      createdAt: now,
      updatedAt: now,
      ...(teacherId ? { updatedByTeacherId: teacherId } : {}),
    });
    return { ok: true as const, id };
  },
});

export const updateTrack = mutation({
  args: {
    id: v.id("tracks"),
    name: v.optional(v.string()),
    targetGrade: v.optional(v.number()),
    targetTerm: v.optional(v.number()),
    orderedUnitIds: v.optional(v.array(v.string())),
    level: v.optional(v.number()),
    mergesIntoTrackId: v.optional(v.id("tracks")),
    active: v.optional(v.boolean()),
  },
  handler: async (ctx, { id, ...rest }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    const existing = await ctx.db.get(id);
    if (!existing) throw new Error("Track not found");
    const teacherId = await resolveTeacherId(ctx);
    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    for (const [k, val] of Object.entries(rest)) {
      if (val !== undefined) patch[k] = val;
    }
    if (teacherId) patch.updatedByTeacherId = teacherId;
    await ctx.db.patch(id, patch);
    return { ok: true as const };
  },
});

export const setStudentTrack = mutation({
  args: { studentId: v.id("students"), trackId: v.union(v.id("tracks"), v.null()) },
  handler: async (ctx, { studentId, trackId }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    await ctx.db.patch(studentId, { trackId: trackId ?? undefined });
    return { ok: true as const };
  },
});
```

- [ ] **Step 2: Backend typecheck.**

Run: `npx tsc --noEmit -p convex/tsconfig.json`
Expected: exit 0.

- [ ] **Step 3: Manual smoke (Convex dashboard, DEV).** Open the DEV Convex dashboard → Functions → run `learningEngine.tracks.createTrack` with `{ name: "Test", targetGrade: 7, targetTerm: 1, orderedUnitIds: [], level: 70 }`. Confirm a `tracks` row appears. Run `learningEngine.tracks.listTracks` → returns it. Delete the test row from the dashboard.

- [ ] **Step 4: Commit.**

```bash
git add convex/learningEngine/tracks.ts
git commit -m "feat(track-2): track CRUD + resolveTrackForStudent + student assignment"
```

---

## Task 3: Backend — seed on-level tracks + backfill assignment

**Files:**
- Modify: `convex/learningEngine/tracks.ts` (append)
- Reference: `convex/learningEngine/path.ts::resolveTeachingPath`

- [ ] **Step 1: Add `seedOnLevelTracks` (idempotent) and `backfillStudentTracks`.** The client passes the natural unit order per (grade, term) since Convex can't read the curriculum; the server applies the saved teaching-path order then concatenates terms. Append to `tracks.ts`:

```ts
import { resolveTeachingPath } from "./path";

// Apply saved teaching-path order to a (grade,term)'s natural unit list, then
// append any units missing from the saved order (new/unsaved) in natural order.
function orderUnitsBySavedPath(naturalUnitIds: string[], saved: string[] | null): string[] {
  if (!saved || saved.length === 0) return naturalUnitIds.slice();
  const rank = new Map<string, number>();
  saved.forEach((id, i) => rank.set(id, i));
  const BIG = saved.length + naturalUnitIds.length;
  return naturalUnitIds
    .map((id, natIdx) => ({ id, key: rank.get(id) ?? BIG + natIdx }))
    .sort((a, b) => a.key - b.key)
    .map((x) => x.id);
}

// Seed/refresh one "On-level G{grade}" track per grade. Idempotent: upserts by
// name. Client provides per-(grade,term) natural unit ids. level = grade*10 so
// remedial levels can slot between grades later.
export const seedOnLevelTracks = mutation({
  args: {
    perGradeTerm: v.array(
      v.object({ grade: v.number(), term: v.number(), naturalUnitIds: v.array(v.string()) }),
    ),
  },
  handler: async (ctx, { perGradeTerm }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");

    // Group incoming (grade,term) → naturalUnitIds.
    const byGrade = new Map<number, Map<number, string[]>>();
    for (const r of perGradeTerm) {
      if (!byGrade.has(r.grade)) byGrade.set(r.grade, new Map());
      byGrade.get(r.grade)!.set(r.term, r.naturalUnitIds);
    }

    const now = Date.now();
    let created = 0;
    let updated = 0;
    for (const [grade, terms] of byGrade) {
      const orderedUnitIds: string[] = [];
      for (const term of [1, 2, 3]) {
        const natural = terms.get(term);
        if (!natural || natural.length === 0) continue;
        const saved = await resolveTeachingPath(ctx, grade, term);
        orderedUnitIds.push(...orderUnitsBySavedPath(natural, saved));
      }
      const name = `On-level G${grade}`;
      const existing = (await ctx.db.query("tracks").collect()).find((t) => t.name === name);
      if (existing) {
        await ctx.db.patch(existing._id, { orderedUnitIds, updatedAt: now });
        updated++;
      } else {
        await ctx.db.insert("tracks", {
          name,
          targetGrade: grade,
          targetTerm: 1,
          orderedUnitIds,
          level: grade * 10,
          active: true,
          createdAt: now,
          updatedAt: now,
        });
        created++;
      }
    }
    return { ok: true as const, created, updated };
  },
});

// Assign every student lacking a trackId to their schoolGrade's On-level track.
export const backfillStudentTracks = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    const tracks = await ctx.db.query("tracks").collect();
    const onLevelByGrade = new Map<number, Id<"tracks">>();
    for (const t of tracks) {
      if (t.name === `On-level G${t.targetGrade}`) onLevelByGrade.set(t.targetGrade, t._id);
    }
    const students = await ctx.db.query("students").collect();
    let assigned = 0;
    for (const s of students) {
      if (s.trackId) continue;
      const tid = onLevelByGrade.get(s.schoolGrade);
      if (!tid) continue;
      await ctx.db.patch(s._id, { trackId: tid });
      assigned++;
    }
    return { ok: true as const, assigned };
  },
});
```

- [ ] **Step 2: Backend typecheck.**

Run: `npx tsc --noEmit -p convex/tsconfig.json`
Expected: exit 0.

- [ ] **Step 3: Commit.** (Running the seed/backfill against data is Task 7's gated step, not here.)

```bash
git add convex/learningEngine/tracks.ts
git commit -m "feat(track-3): seedOnLevelTracks + backfillStudentTracks mutations"
```

---

## Task 4: Backend — remedial-track builder candidate query

**Files:**
- Modify: `convex/learningEngine/tracks.ts` (append)
- Reference: `convex/learningEngine/path.ts::listPathUnitsWithPriority` (importance lookup pattern), `convex/learningEngine/config.ts` (constants)

- [ ] **Step 1: Add a `SKIP_THRESHOLD` constant.** In `convex/learningEngine/config.ts`, append:

```ts
// Track builder: units whose summed concept-importance for the TARGET exam is
// below this are proposed for skipping in a remedial track (e.g. "time" unit).
export const TRACK_SKIP_THRESHOLD = 0.01;
```

- [ ] **Step 2: Add `listCandidateUnitsForTrack`.** Returns each candidate unit (from start..target grade) with its importance toward the target exam and a `suggestedInclude` flag. Append to `tracks.ts`:

```ts
import { TRACK_SKIP_THRESHOLD } from "./config";

// Builder read query: for a remedial track aiming at targetGrade, list units
// from startGrade..targetGrade with their importance toward the target exam,
// pre-flagging high-importance units for inclusion. Client supplies the unit
// list per (grade,term) (Convex can't read curriculum-data.ts).
export const listCandidateUnitsForTrack = query({
  args: {
    targetGrade: v.number(),
    units: v.array(
      v.object({
        unitId: v.string(),
        unitName: v.string(),
        grade: v.number(),
        term: v.number(),
      }),
    ),
  },
  handler: async (ctx, { targetGrade, units }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];

    // Importance is stored per (grade, term, concept). For each candidate unit
    // we sum its concepts' importance scoped to the TARGET grade's blueprint
    // for that unit's term (cumulative exams tag lower-grade concepts into the
    // target term). Fall back to the unit's own (grade,term) importance.
    const out: Array<{
      unitId: string;
      unitName: string;
      grade: number;
      term: number;
      importance: number;
      suggestedInclude: boolean;
    }> = [];

    for (const u of units) {
      const conceptRows = await ctx.db
        .query("exercises")
        .withIndex("by_unit", (q) => q.eq("unitId", u.unitId))
        .collect();
      const concepts = conceptRows.filter((r) => r.type === "concept");

      let importance = 0;
      for (const c of concepts) {
        // Prefer importance computed for the target grade; else the unit's own grade.
        const targetRow = await ctx.db
          .query("conceptImportance")
          .withIndex("by_grade_term_concept", (q) =>
            q.eq("grade", targetGrade).eq("term", u.term).eq("conceptExerciseId", c._id),
          )
          .unique();
        const ownRow = targetRow
          ? null
          : await ctx.db
              .query("conceptImportance")
              .withIndex("by_grade_term_concept", (q) =>
                q.eq("grade", u.grade).eq("term", u.term).eq("conceptExerciseId", c._id),
              )
              .unique();
        importance += (targetRow ?? ownRow)?.importance ?? 0;
      }

      out.push({
        unitId: u.unitId,
        unitName: u.unitName,
        grade: u.grade,
        term: u.term,
        importance,
        // Target-grade's own units always suggested; lower-grade units only if
        // they carry importance above the skip threshold.
        suggestedInclude: u.grade === targetGrade || importance >= TRACK_SKIP_THRESHOLD,
      });
    }
    return out;
  },
});
```

> NOTE to implementer: confirm the `conceptImportance` index name `by_grade_term_concept` and the `exercises` `by_unit` index exist (they are used in `path.ts`/`importance.ts`). If a name differs, match the real one — do not invent.

- [ ] **Step 3: Backend typecheck.**

Run: `npx tsc --noEmit -p convex/tsconfig.json`
Expected: exit 0.

- [ ] **Step 4: Commit.**

```bash
git add convex/learningEngine/tracks.ts convex/learningEngine/config.ts
git commit -m "feat(track-4): remedial-track builder candidate query + skip threshold"
```

---

## Task 5: Backend — planner reads the student's track (HIGHEST RISK)

**Files:**
- Modify: `convex/learningEngine/planner.ts`
- **Read first (mandatory):** `planSheetCore` (~line 1405 onward), the Main-block candidate selection, and the teaching-path sort block (~line 1574-1612). Understand how `resolveTeachingPath` is used as a sort key and how new-concept candidates are gathered before changing anything.

**Integration contract (do NOT deviate):**
1. Near the top of `planSheetCore`, resolve the student's track once:
   `const track = await resolveTrackForStudent(ctx, profile.student);` (import from `./tracks`).
2. **Candidate restriction (new concepts only):** when `track` is non-null, the Main-block *new-concept* candidate set must be limited to concepts whose `unitId ∈ new Set(track.orderedUnitIds)`. Revision/warm-up/exam-prep candidates are NOT restricted (they surface already-learned concepts and past papers). When `track` is null, behaviour is unchanged.
3. **Ordering:** replace the per-(grade,term) `resolveTeachingPath` sort key with a single global rank from the track when present: build `const trackRank = new Map(track.orderedUnitIds.map((id, i) => [id, i]))` and sort Main-block concepts by `trackRank.get(unitId) ?? Infinity`, then existing tiebreakers (concept order). When `track` is null, keep the existing `pathByGradeTerm` logic exactly.
4. **Target grade/term for phase + exam proximity:** when `track` is non-null, the phase-of-term determination (`determinePhase`) and exam-proximity lookups use `track.targetGrade` / `track.targetTerm` instead of `student.schoolGrade`. When null, unchanged.

- [ ] **Step 1: Add the import.** At the top of `planner.ts` near the existing `import { resolveTeachingPath, resolveUnitPacing } from "./path";` (line 57), add:

```ts
import { resolveTrackForStudent } from "./tracks";
```

- [ ] **Step 2: Resolve the track in `planSheetCore`.** Immediately after `profile` is available inside `planSheetCore`, add:

```ts
    const track = await resolveTrackForStudent(ctx, profile.student);
    const trackUnitSet = track ? new Set(track.orderedUnitIds) : null;
    const trackRank = track
      ? new Map(track.orderedUnitIds.map((id, i) => [id, i] as const))
      : null;
    const budgetGrade = track ? track.targetGrade : profile.student.schoolGrade;
    const budgetTerm = track ? track.targetTerm : undefined; // see Step 4
```

- [ ] **Step 3: Restrict new-concept Main candidates.** Locate where Main-block *new* concepts are filtered/collected. Add a guard so that when `trackUnitSet` is set, a new concept is eligible only if `trackUnitSet.has(concept.unitId)`. (Exact insertion point: the filter that builds the "new concept" pool for the Main block — identify it while reading; do not touch revision/warmup/examprep pools.)

```ts
    // Track restriction: new-concept Main candidates must lie on the track.
    // (No-op when the student has no track.)
    // Apply inside the existing new-concept filter:
    //   .filter((c) => trackUnitSet === null || trackUnitSet.has(c.concept.unitId))
```

- [ ] **Step 4: Swap the ordering sort key.** At the teaching-path sort block (~line 1587-1612), when `trackRank` is non-null, rank by `trackRank.get(concept.unitId) ?? Number.POSITIVE_INFINITY` as the primary key (before the existing grade/term/order tiebreakers); when null, keep the existing `pathByGradeTerm` resolution untouched. For Step 2's `budgetTerm`, pass `track?.targetGrade ?? student.schoolGrade` into `determinePhase` and the exam-proximity lookups in place of `schoolGrade`.

- [ ] **Step 5: Backend typecheck.**

Run: `npx tsc --noEmit -p convex/tsconfig.json`
Expected: exit 0.

- [ ] **Step 6: REGRESSION GATE (the proof — do this before committing).** With a DEV deployment that has at least one On-level track seeded (run `seedOnLevelTracks` + `backfillStudentTracks` from the dashboard against DEV test data):
  - Pick a backfilled student whose On-level track equals their legacy path.
  - Generate/preview their sheet for a fixed date with `trackId` set.
  - Temporarily clear their `trackId` (dashboard) and regenerate for the same date.
  - **The Main-block concept sequence must be identical.** If it differs, the track ordering/restriction is wrong — fix before proceeding.
  - Repeat for ≥3 students across different grades. Document the result in the commit body.

- [ ] **Step 7: Commit.**

```bash
git add convex/learningEngine/planner.ts
git commit -m "feat(track-5): planner walks student's track for the Main block (regression-verified)"
```

---

## Task 6: Frontend — Tracks tab (list + seed + remedial builder)

**Files:**
- Create: `src/components/algorithm/tracks-tab.tsx`
- Modify: `src/app/algorithm/page.tsx`
- Reference: `src/components/algorithm/path-tab.tsx` (component patterns, `naturalUnits` helper), `src/app/algorithm/page.tsx` (tab registration, `GradeTermSelector`)

- [ ] **Step 1: Register the tab in `src/app/algorithm/page.tsx`.**
  - Line 27: change `type TabId = 'coverage' | 'blueprint' | 'path' | 'exams';` → add `| 'tracks'`.
  - In the `TABS` array (~line 29) add (import `Route` from `lucide-react` at the top): `{ id: 'tracks', label: 'Tracks', fullLabel: 'Learning Tracks', icon: Route },`.
  - Update the two `(['coverage','blueprint','path','exams'] as TabId[])` validity lists (lines ~1039) to include `'tracks'`.
  - Add render branch after the `exams` branch (~line 1113): `{tab === 'tracks' && <TracksTab />}` and `import { TracksTab } from '@/components/algorithm/tracks-tab';`.

- [ ] **Step 2: Create `src/components/algorithm/tracks-tab.tsx`.** It must: list tracks (`api.learningEngine.tracks.listTracks`); a "Seed on-level tracks" button that computes per-(grade,term) natural unit ids client-side (reuse `naturalUnits` from `path-tab.tsx` across all grades/terms) and calls `seedOnLevelTracks`; and a remedial-track builder (pick targetGrade + startGrade → call `listCandidateUnitsForTrack` with the client unit list → render checkboxes pre-checked by `suggestedInclude`, greying skip-suggested units → on save call `createTrack` with the included unit ids in order). Mobile-first, dark-navy + teal, mirror `path-tab.tsx` styling.

```tsx
'use client';

import { useMemo, useState, useCallback } from 'react';
import { useQuery, useMutation } from 'convex/react';
import { Route, Sprout, Plus, Check } from 'lucide-react';
import { api } from '@/lib/convex';
import { CURRICULUM_MODULES } from '@/lib/curriculum-data';
import { toast } from 'sonner';

const GRADES = [6, 7, 8, 9, 10, 11];

// All units for a (grade,term) across modules, natural curriculum order.
function naturalUnits(grade: number, term: number) {
  const out: Array<{ unitId: string; unitName: string; grade: number; term: number }> = [];
  for (const mod of CURRICULUM_MODULES) {
    const g = mod.grades.find((gr) => gr.grade === grade);
    if (!g) continue;
    const t = g.terms.find((tt) => tt.term === term);
    if (!t) continue;
    for (const u of t.units) out.push({ unitId: u.id, unitName: u.name, grade, term });
  }
  return out;
}

export function TracksTab() {
  const tracks = useQuery(api.learningEngine.tracks.listTracks);
  const seed = useMutation(api.learningEngine.tracks.seedOnLevelTracks);
  const createTrack = useMutation(api.learningEngine.tracks.createTrack);

  const [seeding, setSeeding] = useState(false);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [targetGrade, setTargetGrade] = useState(9);
  const [startGrade, setStartGrade] = useState(7);
  const [included, setIncluded] = useState<Record<string, boolean>>({});
  const [trackName, setTrackName] = useState('');

  // Units from startGrade..targetGrade for the builder.
  const builderUnits = useMemo(() => {
    const out: Array<{ unitId: string; unitName: string; grade: number; term: number }> = [];
    for (let g = startGrade; g <= targetGrade; g++) {
      for (const term of [1, 2, 3]) out.push(...naturalUnits(g, term));
    }
    return out;
  }, [startGrade, targetGrade]);

  const candidates = useQuery(
    api.learningEngine.tracks.listCandidateUnitsForTrack,
    builderOpen ? { targetGrade, units: builderUnits } : 'skip',
  );

  const onSeed = useCallback(async () => {
    setSeeding(true);
    try {
      const perGradeTerm = GRADES.flatMap((g) =>
        [1, 2, 3].map((term) => ({
          grade: g,
          term,
          naturalUnitIds: naturalUnits(g, term).map((u) => u.unitId),
        })),
      ).filter((r) => r.naturalUnitIds.length > 0);
      const res = await seed({ perGradeTerm });
      toast.success(`Seeded on-level tracks (${res.created} new, ${res.updated} updated)`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Seed failed');
    } finally {
      setSeeding(false);
    }
  }, [seed]);

  // Seed `included` from suggestions when candidates load.
  const candSig = candidates?.map((c) => `${c.unitId}:${c.suggestedInclude ? 1 : 0}`).join('|') ?? '';
  const [seededSig, setSeededSig] = useState('');
  if (candidates && candSig !== seededSig) {
    setSeededSig(candSig);
    const next: Record<string, boolean> = {};
    for (const c of candidates) next[c.unitId] = c.suggestedInclude;
    setIncluded(next);
  }

  const onCreate = useCallback(async () => {
    if (!candidates) return;
    const orderedUnitIds = candidates.filter((c) => included[c.unitId]).map((c) => c.unitId);
    if (orderedUnitIds.length === 0) { toast.error('Select at least one unit'); return; }
    const name = trackName.trim() || `Remedial G${startGrade}→G${targetGrade}`;
    try {
      // level between grades: targetGrade*10 - 5 marks "remedial below on-level".
      await createTrack({ name, targetGrade, targetTerm: 1, orderedUnitIds, level: targetGrade * 10 - 5 });
      toast.success(`Created track "${name}"`);
      setBuilderOpen(false);
      setTrackName('');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Create failed');
    }
  }, [candidates, included, trackName, startGrade, targetGrade, createTrack]);

  return (
    <div className="space-y-4">
      <p className="text-[11px] text-muted-foreground leading-relaxed">
        Tracks are the routes students ride. On-level tracks mirror your teaching paths; remedial
        tracks start grades behind and skip low-importance units. A student rides one track (all
        modules); the Main block walks it.
      </p>

      <div className="flex gap-2">
        <button
          onClick={onSeed}
          disabled={seeding}
          className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-border text-xs font-semibold text-foreground disabled:opacity-50"
        >
          <Sprout className="w-3.5 h-3.5" /> {seeding ? 'Seeding…' : 'Seed on-level tracks'}
        </button>
        <button
          onClick={() => setBuilderOpen((v) => !v)}
          className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-semibold"
        >
          <Plus className="w-3.5 h-3.5" /> New remedial track
        </button>
      </div>

      {builderOpen && (
        <div className="rounded-xl border border-border bg-card p-3 space-y-3">
          <div className="flex items-center gap-2">
            <label className="text-[11px] text-muted-foreground">Start</label>
            <select value={startGrade} onChange={(e) => setStartGrade(Number(e.target.value))}
              className="px-2 py-1 rounded-md bg-muted text-xs border border-border">
              {GRADES.map((g) => <option key={g} value={g}>G{g}</option>)}
            </select>
            <label className="text-[11px] text-muted-foreground">Target</label>
            <select value={targetGrade} onChange={(e) => setTargetGrade(Number(e.target.value))}
              className="px-2 py-1 rounded-md bg-muted text-xs border border-border">
              {GRADES.map((g) => <option key={g} value={g}>G{g}</option>)}
            </select>
          </div>
          <input value={trackName} onChange={(e) => setTrackName(e.target.value)}
            placeholder={`Remedial G${startGrade}→G${targetGrade}`}
            className="w-full px-2 py-1.5 rounded-md bg-muted text-sm border border-border" />
          {candidates === undefined && <div className="h-20 bg-muted rounded-lg animate-pulse" />}
          {candidates && (
            <ul className="space-y-1 max-h-[40vh] overflow-y-auto">
              {candidates.map((c) => (
                <li key={c.unitId}>
                  <button
                    onClick={() => setIncluded((m) => ({ ...m, [c.unitId]: !m[c.unitId] }))}
                    className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg border text-left ${
                      included[c.unitId] ? 'border-primary bg-primary/5' : 'border-border opacity-60'
                    }`}
                  >
                    <span className={`w-4 h-4 rounded flex items-center justify-center shrink-0 ${
                      included[c.unitId] ? 'bg-primary text-primary-foreground' : 'bg-muted'
                    }`}>
                      {included[c.unitId] && <Check className="w-3 h-3" />}
                    </span>
                    <span className="min-w-0 flex-1 text-xs truncate">{c.unitName}</span>
                    <span className="text-[10px] text-muted-foreground shrink-0">
                      G{c.grade}T{c.term} · {(c.importance * 100).toFixed(1)}%
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button onClick={onCreate}
            className="w-full px-3 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-semibold">
            Create track
          </button>
        </div>
      )}

      <div className="space-y-2">
        {tracks === undefined && <div className="h-16 bg-muted rounded-xl animate-pulse" />}
        {tracks?.map((t) => (
          <div key={t._id} className="rounded-xl border border-border bg-card p-3">
            <div className="flex items-center gap-2">
              <Route className="w-4 h-4 text-primary shrink-0" />
              <span className="text-sm font-semibold text-foreground flex-1 truncate">{t.name}</span>
              <span className="text-[10px] text-muted-foreground">L{t.level}</span>
            </div>
            <div className="text-[10px] text-muted-foreground mt-1">
              Target G{t.targetGrade} T{t.targetTerm} · {t.orderedUnitIds.length} units
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Frontend typecheck.**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: exit 0.

- [ ] **Step 4: Manual smoke.** `npm run dev` → open `/algorithm?tab=tracks`. Click "Seed on-level tracks" → toast + 6 On-level rows appear. Open "New remedial track", pick start G7 target G9 → candidate list loads with high-importance units checked, low ones greyed → create → new row appears.

- [ ] **Step 5: Commit.**

```bash
git add src/components/algorithm/tracks-tab.tsx src/app/algorithm/page.tsx
git commit -m "feat(track-6): Learning Tracks tab — seed on-level + remedial builder"
```

---

## Task 7: Frontend — per-student track assignment

**Files:**
- Create: `src/components/algorithm/track-picker.tsx`
- Modify: `src/app/students/page.tsx` (mount the picker per student row; read its existing student-list + mutation patterns first)

- [ ] **Step 1: Create `src/components/algorithm/track-picker.tsx`.** A compact select bound to a student's `trackId`, calling `setStudentTrack`.

```tsx
'use client';

import { useQuery, useMutation } from 'convex/react';
import { api } from '@/lib/convex';
import type { Id } from '@/lib/convex';
import { toast } from 'sonner';

export function TrackPicker({
  studentId,
  trackId,
}: {
  studentId: Id<'students'>;
  trackId?: Id<'tracks'> | null;
}) {
  const tracks = useQuery(api.learningEngine.tracks.listTracks);
  const setStudentTrack = useMutation(api.learningEngine.tracks.setStudentTrack);

  return (
    <select
      value={trackId ?? ''}
      onChange={async (e) => {
        const v = e.target.value;
        try {
          await setStudentTrack({
            studentId,
            trackId: v ? (v as Id<'tracks'>) : null,
          });
          toast.success('Track updated');
        } catch (err) {
          toast.error(err instanceof Error ? err.message : 'Failed');
        }
      }}
      className="px-2 py-1 rounded-md bg-muted text-xs border border-border max-w-[10rem]"
    >
      <option value="">No track (legacy)</option>
      {tracks?.map((t) => (
        <option key={t._id} value={t._id}>
          {t.name}
        </option>
      ))}
    </select>
  );
}
```

- [ ] **Step 2: Mount it in `src/app/students/page.tsx`.** Read the file to find the per-student row/card. Import `TrackPicker` and render `<TrackPicker studentId={s._id} trackId={s.trackId} />` in each student's row. Ensure the students query returns `trackId` (it will once the field exists; if the page maps an explicit projection, add `trackId`).

- [ ] **Step 3: Frontend typecheck.**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: exit 0.

- [ ] **Step 4: Manual smoke.** `/students` → each student shows a track dropdown → change one → toast → reload persists.

- [ ] **Step 5: Commit.**

```bash
git add src/components/algorithm/track-picker.tsx src/app/students/page.tsx
git commit -m "feat(track-7): per-student track assignment picker"
```

---

## Task 8: Migration run + final regression gate (FOUNDER-GATED)

This task runs mutations against data. **Run against DEV first; against `loris` only with the founder present.**

- [ ] **Step 1 (DEV):** From the DEV Convex dashboard, run `learningEngine.tracks.seedOnLevelTracks` (the Tracks tab "Seed" button does this), then `learningEngine.tracks.backfillStudentTracks`. Confirm: 6 On-level tracks; every student has a `trackId`.
- [ ] **Step 2 (DEV regression):** For ≥3 students across grades, confirm their sheet (Main block) is identical with vs without `trackId` (Task 5 Step 6 procedure). Must match.
- [ ] **Step 3 (DEV remedial check):** Build a remedial G7→G9 track, assign a test student, generate their sheet → confirm Main concepts come only from the track's units and skipped units never appear.
- [ ] **Step 4:** Report results to founder. **Production seed/backfill on `loris` is a separate, founder-initiated step — not part of this plan's automated execution.**

---

## Self-review notes (done by planner)

- **Spec coverage:** §3.1 tracks table → T1; §3.2 trackId → T1; §3.3 keep teachingPath/assignedGrades (no deletion) → respected (no task removes them); §4.1 seed on-level → T3; §4.2 remedial builder → T4+T6; §4.3 planner switch → T5; §4.4 assignment UI → T7; §6 migration + regression gate → T3/T8; §7 verification → per-task verify steps + T8.
- **Out of scope (spec §8)** — no ranking, map, points, promotion logic. Confirmed none added; `mergesIntoTrackId` is stored only.
- **Type consistency:** `resolveTrackForStudent`, `seedOnLevelTracks` (`perGradeTerm`), `backfillStudentTracks`, `listCandidateUnitsForTrack` (`targetGrade`,`units`), `createTrack`, `setStudentTrack` names used identically across backend + frontend tasks. `TRACK_SKIP_THRESHOLD` defined in config (T4) before use.
- **Known verify-against-reality items flagged inline:** `conceptImportance` index name (`by_grade_term_concept`), `exercises.by_unit` index, and the exact `students` query projection in `students/page.tsx` — implementer confirms against the live code, does not invent.
