# Phase 1 — Track Model + Assignment (Design Spec)

> **Status:** Approved by founder (Ilham), 2026-06-05.
> **Audience:** the orchestrator (Claude) and the build subagents. Read this whole file before planning or coding.
> **Scope:** Phase 1 ONLY of a 4-phase system. Ranking, the railway map, and the new points formula live in their own later specs. Do not build them here.

---

## 0. Why this exists (one paragraph)

Aristora is pivoting from a curriculum *tracker* to a personalized *learning engine* (see `learning_engine_plan.md`, `algorithm_plan.md`). The engine already generates per-student practice sheets whose Main block follows a teacher-curated **teaching path**, today stored once per `(grade, term)` (`teachingPath` table, `convex/learningEngine/path.ts`). The founder wants to express **weak-to-strong student levels as named "tracks"**: importance-filtered, cross-grade routes through the curriculum that a student rides, that other students share (for fair competition), and that eventually **merge** into the mainstream — visualized for parents as a branching/merging railway map. This spec builds the **foundation** for that: the track data model, track authoring, student→track assignment, and the planner change so the Main block walks a student's track instead of the flat `(grade, term)` path.

---

## 1. The 4-phase decomposition (context — only Phase 1 is in scope here)

| # | Sub-project | Ships | Depends on |
|---|---|---|---|
| **1 (THIS SPEC)** | Track model + assignment | `tracks` table; track authoring with engine-proposed skips; `student.trackId`; planner walks the track for the Main block. Students ride tracks; sheets follow tracks. | engine (done) |
| 2 | Sheet-synced scoring + difficulty/section points | Score once on the sheet → feeds engine AND awards difficulty+section-weighted points; retires legacy `entries` Score tab. | 1 |
| 3 | Cohort leaderboard + promotion (leagues) | Rank within your track, not your grade; finishing/mastering a track promotes + merges you up. | 1, 2 |
| 4 | Railway map + parent share | Branching/merging map in a Path sub-tab; parent "you are here". | 1, 3 |

Build order is **strictly 1→2→3→4** (hard dependency chain). Within Phase 1, sub-tasks may parallelize.

---

## 2. Locked decisions from the founder brainstorm (authoritative)

These won the brainstorm; if a later session sees a conflict, these win.

1. **Scoring flow (Phase 2):** Score **once, on the sheet**, per **session** (not per day — students have unequal weekly class counts). Scoring is a session ritual logged like attendance; an unscored session shows the red ring on the Day-view card. The legacy `entries`-based Score tab retires after migration. (Phase 2 scope.)
2. **Points formula (Phase 2):** **Difficulty + section weighted.** A correct answer scales with question difficulty (1–5) AND its section. Section multipliers (proposed, tune later): Main 1.0, Revision 1.3, Exam-prep 1.5, Warm-up/mistake **1.0** (deliberately NOT bonused — see trap below). Plus a light per-session streak bonus. Compute alongside the old formula for one term before switching (founder's de-risk call).
   - **Trap 1 — mistake-farming:** getting a question right the first time must always beat wrong-then-right; so the mistake-fix multiplier stays 1.0 (the incentive is that points were never banked until correct — deferred, not bonused).
   - **Trap 2 — weak-student demoralization:** difficulty-weighting pays weak kids less per question by design; this is solved at the root by track-based cohorts (Phase 3), not by leaderboard patches.
3. **Leaderboard (Phase 3):** Rank **within a track cohort**, not by grade ("justice — same-path students compete"). A small set of named tracks (levels) gives real cohorts. Finishing/mastering a track **promotes** the student up a level (a league/promotion system).
4. **Track structure:** A **few named tracks (levels)**, NOT bespoke-per-student. The skip-list is curated **once per track**; the engine (`conceptImportance`) auto-proposes which low-importance units to drop for the track's target exam. Per-student exceptions are allowed but are the exception, not the backbone.
5. **Track granularity:** **One track per student, spanning all six modules** (not one track per module). Uneven students are placed by their overall level; fine-grained per-module exceptions are a later nicety, not Phase 1.
6. **Build process:** Orchestrator (Claude) + subagents. Subagents do focused implementation in their own context; orchestrator reviews against this spec at each gate. Agents work in **isolated git worktrees**; integration to the live branch is founder-gated. **The app is live on production Convex env `loris` — never point agents at prod data; never auto-deploy.**

---

## 3. Phase 1 data model

All additions are **additive and optional** so existing rows keep validating and current sheet generation is unaffected until a student is explicitly assigned a track.

### 3.1 New table: `tracks`

```ts
tracks: defineTable({
  name: v.string(),                       // "On-level G9", "Remedial G7→G9 (core)"
  targetGrade: v.number(),                // 6..11 — the exam this track aims at
  targetTerm: v.number(),                 // 1 | 2 | 3 — current target term (advances over the year)
  orderedUnitIds: v.array(v.string()),    // curated cross-grade route in TEACHING order.
                                          //   unit ids are "M{n}-G{grade}-T{term}-{i}" (curriculum-data.ts)
                                          //   This IS the path the Main block walks.
  level: v.number(),                      // promotion rank among tracks (lower = more remedial). Phase 3 uses it.
  mergesIntoTrackId: v.optional(v.id("tracks")), // promote-into pointer. Stored now, USED by Phase 4 map / Phase 3 promotion.
  active: v.boolean(),                    // soft on/off; inactive tracks hidden from assignment pickers
  createdAt: v.number(),
  updatedAt: v.number(),
  updatedByTeacherId: v.optional(v.id("teachers")),
})
  .index("by_target_grade_term", ["targetGrade", "targetTerm"])
  .index("by_level", ["level"]);
```

Notes:
- `orderedUnitIds` is a **flat** cross-grade list (not segmented by grade/term). It may include units from G7, G8, G9 in one ordered route. This is what makes a track "continuous across grades."
- A track's skip is expressed by **absence** — a unit not in `orderedUnitIds` is skipped for that track. No separate skip table.
- `targetTerm` advances through the year (the same way the current planner advances). Phase 1 sets it; later automation can bump it.

### 3.2 Extend `students`

```ts
// students table — add:
trackId: v.optional(v.id("tracks")),   // the one track this student rides (all modules)
```

- Optional. A student with no `trackId` → planner falls back to today's behavior (school grade + `teachingPath`). This is the safety net.

### 3.3 Relationship to existing tables (do NOT delete in Phase 1)

- `teachingPath (grade, term)` — stays. It **seeds** On-level tracks (§4.1) and remains the natural-order source. Not removed.
- `assignedGrades` / `assignedGradesByModule` on `students` — stays functional during the transition. Tracks supersede them gradually; Phase 1 does not rip them out.
- `unitPacing (grade, term, unitId)` — unchanged; still read by the planner for Main-block sizing.
- `conceptImportance (grade, term, conceptExerciseId)` — read by the remedial-track builder to propose skips.

---

## 4. Algorithm / behavior

### 4.1 Seeding On-level tracks (zero behavior change)

```
# Action: seedOnLevelTracks()  (idempotent; guard on existing On-level track per grade)
for grade in 6..11:
  orderedUnitIds = []
  for term in 1..3:
    path = resolveTeachingPath(grade, term)         # existing helper
            ?? naturalUnitOrder(grade, term)        # fallback: curriculum order
    orderedUnitIds.push(...path)
  upsert tracks {
    name: `On-level G${grade}`,
    targetGrade: grade, targetTerm: <current term for grade from exam calendar, else 1>,
    orderedUnitIds, level: GRADE_BASE_LEVEL(grade),  # e.g. grade*10, leaves room for remedial levels between
    active: true,
  }
```

- After seeding, every existing student is assigned their school grade's On-level track (§6 backfill). Because the track's `orderedUnitIds` equals the concatenation of their current teaching paths, **the Main block produces the same next-concept as before** — this is the regression guarantee.

### 4.2 Remedial track builder (the engine tie-in)

UI + a read query that, given `(targetGrade, startGrade)`:
```
units = []
for grade in startGrade..targetGrade:
  for term in 1..3:
    for unit in unitsOf(grade, term):              # natural order
      importanceForTarget = Σ conceptImportance.importance
                              over unit's concepts, scoped to (targetGrade, relevant term)
      units.push({ unitId, unitName, grade, term, importanceForTarget,
                   suggestedInclude: importanceForTarget >= SKIP_THRESHOLD })
return units   # UI pre-checks suggestedInclude, greys out the rest; teacher overrides; saves as a track
```
- `SKIP_THRESHOLD` is a named constant (tunable). Low-importance units (e.g. "time") fall below it and are proposed for skipping.
- The teacher reorders + toggles, names the track, sets `level` and optional `mergesIntoTrackId`, saves via a `createTrack` / `updateTrack` mutation.

### 4.3 Planner change (load-bearing)

In `convex/learningEngine/planner.ts`, the Main-block path resolution changes from "(grade, term) → teachingPath" to "student → track → orderedUnitIds":
```
track = student.trackId ? tracks.get(student.trackId) : null
if track:
  mainPathUnitIds = track.orderedUnitIds
  budgetGrade, budgetTerm = track.targetGrade, track.targetTerm   # drives warm-up/revision/exam-prep ratios + exam backstop
else:
  # unchanged legacy path
  mainPathUnitIds = concat over terms of resolveTeachingPath(student.schoolGrade, term)
  budgetGrade, budgetTerm = student.schoolGrade, <current term>
# Walk mainPathUnitIds to the student's next not-yet-introduced concept (prereqs permitting) — existing logic, new source list.
```
- Everything downstream of "the ordered unit list" (next-concept walk, prereq gating, pacing, interleaving) is **unchanged** — only the source of the ordered list and the budget grade/term change.
- Exam-date backstop + budget ratios read `budgetGrade/budgetTerm` instead of school grade.

### 4.4 Track assignment UI

- A student can be assigned a track from the student management surface (reuse existing student edit/settings location; confirm exact placement during planning — likely the same place `assignedGrades` is set today).
- Picker lists `active` tracks, grouped/sorted by `level`, showing name + targetGrade.

---

## 5. Edge cases

| Edge case | Handling |
|---|---|
| Student has no `trackId` | Legacy fallback (school grade + teachingPath). No behavior change. |
| Track references a stale unit id (syllabus edited) | Reader prunes ids not in live curriculum at read time (same tolerance pattern as `resolveTeachingPath`). |
| Track `orderedUnitIds` empty | Planner treats as "no main path" → Main block falls back to legacy resolution for that student; log a `plannerGap` warning. |
| Remedial track whose target term hasn't been reached by importance data | `conceptImportance` may be sparse early; builder still lists units with importance 0 and lets the teacher decide. Suggested-include simply all-false; teacher curates manually. |
| Two On-level seeds for same grade (re-run) | `seedOnLevelTracks` is idempotent — upsert by (name = `On-level G${grade}`) or a dedicated guard. Never duplicate. |
| `mergesIntoTrackId` points at an inactive/deleted track | Ignore at read time; Phase 3/4 treat as "no merge target". |
| Student promoted mid-term (Phase 3 will do this) | Out of Phase 1 scope; the pointer just exists now. |
| Per-module unevenness | Out of Phase 1 scope (one track per student). `assignedGradesByModule` remains as the stopgap exception layer. |

---

## 6. Migration + live-safety (app runs on prod env `loris`)

1. Ship schema additively (`tracks` table, `students.trackId`) — nothing reads them until code does.
2. Run `seedOnLevelTracks()` → one On-level track per grade from current teaching paths.
3. Backfill: assign every existing student `trackId = onLevelTrack(student.schoolGrade)`.
4. **Regression gate (MUST pass before any live cutover):** pick ≥3 sample students across grades; generate a sheet with `trackId` set and confirm the Main block yields the **same** next concept(s) as the legacy path for the same date. Diff must be empty. Only then is the planner switch considered safe.
5. `assignedGrades` / `assignedGradesByModule` stay live throughout. No destructive removal in Phase 1.
6. All agent work happens in **git worktrees**; merge to the live branch is a founder-gated manual step; **no auto-deploy to `loris`.**

---

## 7. Verification (proves Phase 1 works)

1. `npx tsc --noEmit -p tsconfig.json` AND `npx tsc --noEmit -p convex/tsconfig.json` → exit 0.
2. After seed: Convex `tracks` has one `On-level G{n}` row per grade with non-empty `orderedUnitIds`.
3. Build a remedial track G7→G9: builder pre-checks high-importance units, greys low-importance ("time") units; save → a `tracks` row with the curated subset in order.
4. Assign a test student to the remedial track → generate their sheet → Main block walks the **track's** units (verify the next concept is from the track, and a skipped unit's concepts never appear).
5. Regression gate (§6.4) passes for ≥3 On-level students: track-driven sheet == legacy sheet.
6. A student with no `trackId` still generates a sheet identically to today.

---

## 8. Explicitly OUT of Phase 1 scope

- Cohort/track-based leaderboard ranking (Phase 3).
- Promotion/merge *triggering* (Phase 3) — only the `mergesIntoTrackId` pointer is stored now.
- Railway-map visualization + parent share (Phase 4).
- New difficulty/section points formula + sheet-synced scoring (Phase 2; see `sheet_scoring_plan.md`).
- Per-module track granularity, auto-advancing `targetTerm`, prereq cycle detection.

---

## 9. Key files (for the build agents)

- `convex/schema.ts` — add `tracks`, extend `students.trackId`.
- `convex/learningEngine/path.ts` — track CRUD + seed + builder read query live here or a new `convex/learningEngine/tracks.ts`.
- `convex/learningEngine/planner.ts` — the Main-block path-resolution switch (§4.3).
- `convex/learningEngine/importance.ts` + `conceptImportance` — read for skip suggestions.
- `src/components/algorithm/path-tab.tsx` — existing path editor; track authoring UI sits alongside it (the Path area gains track management; the map sub-tab is Phase 4).
- `src/lib/curriculum-data.ts` — unit ids + natural order (frontend; ids passed down to Convex per existing convention).
- Student edit surface — track assignment control (confirm exact file in planning).

---

## 10. Open questions to resolve in planning (not blockers)

1. Exact home for track CRUD UI (extend Path tab vs a new sibling tab in the algorithm area).
2. Exact `level` numbering scheme (leave gaps for remedial levels between grades).
3. Where `targetTerm` advancement is triggered (manual in Phase 1; confirm UI control).
4. Whether track CRUD lives in `path.ts` or a new `tracks.ts` (lean: new `tracks.ts` for separation).
