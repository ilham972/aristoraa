# Algorithm Plan: Aristora Learning Engine — Phases 0.5 → H

> **Tactical spec.** Read `learning_engine_plan.md` first for strategy / business context. This document is the build spec for the algorithm phases — Sonnet 4.6 executes from here, sub-phase by sub-phase, with the user committing each step.
>
> **Format per sub-phase, in this order, no prose preamble:**
> 1. **Schema diff** — exact field/index additions
> 2. **Algorithm** — pseudocode with named constants, not English
> 3. **Edge cases** — bullet list, each paired with handling
> 4. **Verification** — what query / UI / manual step proves it works
>
> If a sub-phase is missing one of the four blocks, it is not specified enough to ship — escalate to the user, do not guess.

---

## 0. Architecture overview — the seven layers

```
              ┌─────────────────────────────────────────────────────────┐
Layer 7       │  Tuning lab (visual ML control)         Phase G+H       │
              ├─────────────────────────────────────────────────────────┤
Layer 6       │  Calibration loop (post-exam)           Phase F          │
              ├─────────────────────────────────────────────────────────┤
Layer 5       │  Sheet planner + PDF (printed worksheet) Phase D + E    │
              ├─────────────────────────────────────────────────────────┤
Layer 4       │  Student profile + time-to-mastery       Phase C        │
              ├─────────────────────────────────────────────────────────┤
Layer 3       │  Concept importance (exam blueprint)     Phase B        │
              ├─────────────────────────────────────────────────────────┤
Layer 2       │  Mastery estimate (per student × concept) Phase A.3    │
              ├─────────────────────────────────────────────────────────┤
Layer 1       │  Memory state (FSRS-D, S, R)             Phase A.1-A.2 │
              └─────────────────────────────────────────────────────────┘
                            ▲
              ┌─────────────────────────────────────────────────────────┐
Layer 0       │  Question bank + past papers + tagging  Phase 0 (0.3–0.6)│
              └─────────────────────────────────────────────────────────┘
```

Single source of truth at each layer:
- **Layer 1** (`memoryState`) is mutated only by attempt ingestion (A.2)
- **Layer 2** (mastery) is a *derived view* from Layer 1, never stored
- **Layer 3** (`conceptImportance`) is recomputed when papers added/edited
- **Layer 4** (student profile) is a derived view
- **Layer 5** (`generatedSheets`) is the durable artifact + audit
- **Layer 6** (`calibrationRecords`) logs (predicted, actual) per exam term
- **Layer 7** (`tuningParams`) overrides defaults from `learningConfig`

---

## 1. The single mastery formula (used by every layer above L1)

```
# Layer 1 — FSRS-style memory state per (student, concept)
D ∈ [1, 10]   difficulty for this learner       (init 5.0)
S ≥ 0         stability in days at R = 0.9      (init via DEFAULT_INIT_STABILITY)
R(t) = (1 + t / (FACTOR * S)) ^ -1              # power-law forgetting, FACTOR = 9
                                                # t = days since lastReviewAt

# Layer 2 — mastery (derived, not stored)
acc_factor(s, c) = sigmoid(α * (correct_w − wrong_w))    α = 1.2
mastery(s, c, t) = R(s, c, t) * acc_factor(s, c)         ∈ [0, 1]

# correct_w / wrong_w sum per-attempt difficulty weights:
#   weight(q) = 0.6 + 0.2 * q.difficulty  → range [0.8 (d=1) … 1.6 (d=5)]
```

**Why this single formula:** R captures *will the student remember*; acc_factor captures *given they remember, can they execute on hard problems*. Multiplying gives a number that drops both when memory fades AND when accuracy on harder questions is poor. Threshold for "mastered" = `MASTERY_THRESHOLD = 0.75`.

**Why not BKT / pure FSRS / pure PFA:** the user has little tuning data early. FSRS' 17 params can't be learned with N=20 students × few attempts. PFA alone has no time-decay model. Hybrid keeps memory science (FSRS) for the time axis and a transparent accuracy term (PFA-style) for the skill axis — both work with default constants from day one and become tunable in Phase G.

**Multi-concept question credit rule:** if question `q` is tagged to concepts `[c1, c2, c3]`, an attempt updates **all three** with full weight. Optional per-tag weight field reserved on `questionConcepts.weight ∈ (0, 1]` defaults to 1.0 — not used by Phase A, available from Phase G onward.

---

## 2. Default constants (`convex/learningEngine/config.ts`)

```ts
// Memory model
export const FACTOR = 9;                     // FSRS forgetting curve constant
export const DEFAULT_INIT_STABILITY = 1.0;   // days
export const DEFAULT_INIT_DIFFICULTY = 5.0;  // 1..10
export const MASTERY_THRESHOLD = 0.75;
export const ACC_ALPHA = 1.2;

// Stability update on review (FSRS-lite)
export const STAB_GROWTH_GOOD = 1.5;     // S *= 1.5 on correct
export const STAB_GROWTH_HARD = 1.1;
export const STAB_DECAY_AGAIN = 0.4;     // S *= 0.4 on wrong (penalty)

// Difficulty update
export const DIFF_DELTA_GOOD  = -0.15;   // gets easier with success
export const DIFF_DELTA_AGAIN = +0.30;   // gets harder after failure

// Sheet planner
export const SHEET_LEN_DEFAULT = 8;          // questions per sheet
export const SHEET_LEN_WEAK    = 5;
export const SHEET_LEN_STRONG  = 12;
export const WARMUP_RATIO = 0.20;            // ~2 of 8
export const MAIN_RATIO   = 0.65;            // ~5 of 8
export const EXAM_RATIO   = 0.15;            // ~1 of 8

// Sheet scoring weights (additive, normalized factors in [0,1])
export const W_IMPORTANCE = 0.30;
export const W_URGENCY    = 0.25;
export const W_FIT        = 0.20;
export const W_NOVELTY    = 0.15;
export const W_PROXIMITY  = 0.10;

// Exam-date backstop
export const EXAM_BACKSTOP_DAYS = 21;

// Coverage gate (Phase 0.6 → D)
export const MIN_QUESTIONS_PER_CONCEPT = 5;

// Novelty cooldown
export const NOVELTY_COOLDOWN_DAYS = 7;

// Difficulty-fit Gaussian width
export const FIT_SIGMA = 1.5;                // on a 1..5 scale
```

All constants here in Phase A are **literal in code**. Phase G migrates them into a `learningConfig` table so they can be tuned from a UI without redeploy.

---

## 3. Phase ordering & gates

```
0.5 (past papers)  ──┐
0.6 (coverage)     ──┼──▶ A (memory+mastery) ──▶ B (importance) ──▶ C (profile)
                     │                                                  │
                     │                                                  ▼
                     └──▶ (gates D)                                   D (planner)
                                                                        │
                                                                        ▼
                                                                      E (PDF)
                                                                        │
                                                                        ▼
                                                            ┌───────────┴──┐
                                                            ▼              ▼
                                                          F (calib)     G.1 predictor
                                                            │              │
                                                            └──────┬───────┘
                                                                   ▼
                                                            G (tuning lab)
                                                                   │
                                                                   ▼
                                                                H (scale)
```

**Hard gate:** Phase D cannot start until Phase 0.6's coverage dashboard reports `≥ MIN_QUESTIONS_PER_CONCEPT (=5) tagged questions` for every concept in the active grade × term. The dashboard surfaces gaps; the user fills them by cropping more past-paper questions before D is unlocked.

**Soft gate:** Phase F (calibration) requires one full term of student attempt history + one tagged exam paper. Phase G (tuning lab) requires Phase F's calibration data to be useful.

---

# Phase 0.5 — Past papers (cropping + tagging, extends 0.3 + 0.4)

### Schema diff
```ts
pastPapers: defineTable({
  grade: v.number(),                         // 6..11
  term: v.number(),                          // 1 | 2 | 3
  year: v.number(),                          // 2018, 2019, ...
  schoolName: v.optional(v.string()),        // null for own papers
  totalPages: v.number(),
  useAsTrainingSignal: v.boolean(),          // true if old (3+ yrs) or other-school
  isHoldout: v.boolean(),                    // true for current term's own paper
  totalMarks: v.optional(v.number()),
  uploadedAt: v.number(),
})
  .index("by_grade_term_year", ["grade", "term", "year"])
  .index("by_training_signal", ["useAsTrainingSignal"]);

pastPaperPages: defineTable({
  pastPaperId: v.id("pastPapers"),
  pageNumber: v.number(),
  storageId: v.id("_storage"),
}).index("by_paper", ["pastPaperId"])
  .index("by_paper_page", ["pastPaperId", "pageNumber"]);

// Extend questionBank.source to allow "past-paper" (already in schema string field).
// Extend questionBank with:
questionBank: {
  ...,
  pastPaperId: v.optional(v.id("pastPapers")),
  pastPaperPageId: v.optional(v.id("pastPaperPages")),
  marksAvailable: v.optional(v.number()),    // marks this Q is worth in its paper
  questionNumberInPaper: v.optional(v.string()),  // "1.a", "5.iii"
}
// Add index: by_past_paper, by_past_paper_page.

// Extend questionConcepts:
questionConcepts: {
  ...,
  weight: v.optional(v.number()),  // (0, 1], default 1.0; reserved for G
}
```

### Algorithm
None — this is data ingestion. Crop + tag UI reuses the Phase 0.3/0.4 pattern over `pastPaperPages` instead of `textbookPages`.

### Edge cases
- **Tamil-only OCR not used.** Same as textbooks — coords-only crops on rendered page images.
- **Multi-paper same year/grade/term** (e.g. Western Province paper + Central Province paper for 2022 G7 T2) — composite key is `(grade, term, year, schoolName)`. `schoolName === null` reserved for own/centre papers.
- **Paper that becomes "old"**: when current date crosses a paper's term + 3 years, `useAsTrainingSignal` flips true. A nightly script (or just a query that filters by date dynamically) handles this — store `useAsTrainingSignal` as the *user-set* boolean only at upload. A derived flag `isEffectivelyOld(paper, today)` lives in `convex/learningEngine/papers.ts`.
- **Holdout paper accidentally tagged with `useAsTrainingSignal=true`** — UI must enforce: when `isHoldout = true`, training signal toggle is disabled and shown red.
- **Marks per question missing** — leave `marksAvailable` null, importance computation falls back to count-based weight.

### Verification
- Upload 2018 G7 T1 paper → 3 pages. Crop 5 questions. Tag each to 1+ concept. Open Convex dashboard: `pastPapers` has 1 row, `pastPaperPages` has 3, `questionBank` has 5 with `source="past-paper"`, `questionConcepts` has ≥ 5 rows.
- Toggle `isHoldout = true` on a paper → UI disables training-signal toggle.
- `npx tsc --noEmit -p tsconfig.json` → exit 0.

---

# Phase 0.6 — Coverage dashboard (GATE before D)

### Schema diff
None.

### Algorithm
```
# convex/learningEngine/coverage.ts → query coverageByGradeTerm(grade, term)

for each concept-type exercise in (grade, term):
  qs = questionConcepts where conceptExerciseId = concept._id
  total = qs.length
  byDifficulty = group qs by difficulty
  bySource = group qs by source (textbook / past-paper / teacher-authored)

return per concept: { conceptId, conceptName, unitId, total,
                      byDifficulty: {1..5}, bySource: {...},
                      isGated: total < MIN_QUESTIONS_PER_CONCEPT }

# UI rolls up to per-unit and per-grade panels, sorted by gap severity.
```

### Edge cases
- **Concept with 0 questions**: shown red, blocks D for that grade/term entirely (the planner cannot pick a question for a concept with none tagged).
- **Concept with 5+ all difficulty=1**: dashboard warns "no harder questions for this concept" — D will work but exam-prep slot suffers.
- **Concept appears in multiple units** (cross-unit prereq pointer): dedupe by `conceptExerciseId`.
- **Past-paper question tagged to current-grade concept but paper is older grade**: allowed, counts toward coverage.

### Verification
- Coverage page renders for grade 7 term 1.
- Drop 4 of 5 questions for one concept via dashboard delete → that concept turns red, "Phase D blocked" badge appears.
- Add 4 more crops → green, gate clears.

---

# Phase A — Memory + Mastery

## A.1 — Memory state schema

### Schema diff
```ts
memoryState: defineTable({
  studentId: v.id("students"),
  conceptExerciseId: v.id("exercises"),     // concept-type row
  difficulty: v.number(),                    // 1..10  (FSRS D)
  stability: v.number(),                     // days   (FSRS S)
  lastReviewAt: v.number(),                  // ms epoch
  lastResponse: v.string(),                  // "good" | "again" | "hard"
  attemptCount: v.number(),
  correctWeighted: v.number(),               // sum of weight(q) on correct
  wrongWeighted: v.number(),                 // sum of weight(q) on wrong
  initializedAt: v.number(),
})
  .index("by_student", ["studentId"])
  .index("by_student_concept", ["studentId", "conceptExerciseId"])
  .index("by_student_lastReview", ["studentId", "lastReviewAt"]);

// Optional Phase A.2: append-only attempt log for replay/calibration.
attemptLog: defineTable({
  studentId: v.id("students"),
  conceptExerciseId: v.id("exercises"),
  questionId: v.optional(v.id("questionBank")),  // null for legacy entries pre-question-bank
  exerciseId: v.optional(v.id("exercises")),
  questionKey: v.optional(v.string()),
  response: v.string(),                          // "good" | "again" | "skipped"
  difficulty: v.number(),                        // q's difficulty 1..5 (5 = unknown default 3)
  weight: v.number(),                            // computed weight(q)
  occurredAt: v.number(),
  source: v.string(),                            // "session" | "homework" | "diagnostic" | "exam"
})
  .index("by_student_time", ["studentId", "occurredAt"])
  .index("by_student_concept_time", ["studentId", "conceptExerciseId", "occurredAt"]);
```

### Algorithm
None — schema only.

### Edge cases
- No row exists yet for (student, concept) on first attempt → A.2 must lazily create with `DEFAULT_INIT_STABILITY` and `DEFAULT_INIT_DIFFICULTY`.
- Student deleted → cascade: delete `memoryState` and `attemptLog` rows. Add a Convex action `cleanupStudentMemory(studentId)` invoked from `students.remove`.

### Verification
- Schema deploys via `npx convex dev`. `_generated/api.d.ts` regenerates. `npx tsc --noEmit -p tsconfig.json` → exit 0.

## A.2 — Attempt → memory update

### Schema diff
None.

### Algorithm
```
# convex/learningEngine/memory.ts → mutation recordAttempt({
#   studentId, questionId | (exerciseId, questionKey), response, occurredAt
# })

# Resolve concepts:
if questionId is set:
  concepts = questionConcepts.where(questionId).map(qc => qc.conceptExerciseId)
  difficulty = questionBank.get(questionId).difficulty ?? 3
else:
  # Legacy path (existing entries have no questionBank link). Resolve via
  # exercise's unit → concept-type rows in same unit. Use ALL concept rows
  # of the unit (best we can do without question-level tags).
  concepts = exercises.where(unitId = ex.unitId, type = "concept").map(_._id)
  difficulty = 3   # unknown

if response === "skipped": return        # no memory update for skips

weight = 0.6 + 0.2 * difficulty           # 0.8 .. 1.6

# Multi-concept question credit: full weight to each tagged concept.
for concept in concepts:
  state = memoryState.get_or_init(studentId, concept)
  daysSince = (occurredAt - state.lastReviewAt) / 86_400_000  if state.attemptCount > 0 else 0

  # FSRS-lite update (success/failure only — graded "hard" deferred to G):
  if response === "good":
    state.stability *= STAB_GROWTH_GOOD * (1 + 0.1 * (daysSince / max(state.stability, 0.5)))
    state.difficulty += DIFF_DELTA_GOOD
    state.correctWeighted += weight
  elif response === "again":
    state.stability *= STAB_DECAY_AGAIN
    state.difficulty += DIFF_DELTA_AGAIN
    state.wrongWeighted += weight

  state.difficulty = clamp(state.difficulty, 1.0, 10.0)
  state.stability  = clamp(state.stability, 0.1, 365.0)
  state.lastReviewAt = occurredAt
  state.lastResponse = response
  state.attemptCount += 1
  memoryState.put(state)

attemptLog.insert({...})
```

### Edge cases
- **Same question attempted twice in one session** (correction → student fixes → re-correct): both updates fire. Stability oscillates; over 100s of attempts noise averages out.
- **`response = "wrong"` then `response = "good"` within a minute**: count both, but the algorithm naturally "punishes then rewards" — net stability slightly down. Acceptable.
- **Concept has no `questionConcepts` rows** (legacy path triggered): all concept rows in the unit get the update. Tags this attempt with `source = "legacy-unit-fallback"` for later auditability.
- **Student practices a concept they've never seen** (cold concept): get_or_init creates default-state row. First attempt's `daysSince = 0`, stability stays at `DEFAULT_INIT_STABILITY * STAB_GROWTH_GOOD = 1.5d`.
- **Difficulty unknown on legacy questions** → use `3`. Phase G can run a backfill later.
- **Mutation failure mid-batch** (Convex tx atomicity): each attempt is one mutation, so individual atomic. No batch needed.

### Verification
- Seed student S, concept C. No `memoryState` row exists.
- Call `recordAttempt({S, qId where qId tags C with d=3, "good", now})`. Expect:
  - `memoryState` row exists, `stability ≈ 1.5`, `difficulty ≈ 4.85`, `correctWeighted = 1.2`, `attemptCount = 1`.
  - `attemptLog` row exists.
- Call `recordAttempt({S, qId, "again", now+86400000})`. Expect:
  - `stability ≈ 0.6` (1.5 * 0.4), `difficulty ≈ 5.15`, `wrongWeighted = 1.2`.

## A.3 — Mastery derivation (read-only)

### Schema diff
None.

### Algorithm
```
# convex/learningEngine/mastery.ts → query
#   masteryFor(studentId, conceptExerciseId, atTime?) → { R, accFactor, mastery }
#   masteryAll(studentId, atTime?) → Record<conceptId, {R, accFactor, mastery}>

state = memoryState.where(studentId, conceptExerciseId).first()
if state is null:
  return { R: 0, accFactor: 0.5, mastery: 0 }

t = ((atTime ?? now) - state.lastReviewAt) / 86_400_000   # days
R = (1 + t / (FACTOR * state.stability)) ^ -1
accFactor = sigmoid(ACC_ALPHA * (state.correctWeighted - state.wrongWeighted))
mastery = R * accFactor

return { R: clamp01(R), accFactor: clamp01(accFactor), mastery: clamp01(mastery) }
```

### Edge cases
- **No memory row** → mastery 0, R 0, accFactor 0.5 (neutral). Sheet planner treats as "needs first exposure."
- **`atTime` in the past** (replay) → still computes; t may be negative if before lastReview, clamp t to 0 then.
- **Stability extremely small** (after several `again`s) → R drops fast; expected behaviour, drives urgency.
- **Bulk query for all concepts of a grade**: `masteryAll` should batch with one `memoryState.where(studentId)` index lookup, not one query per concept.

### Verification
- After A.2 verification scenario:
  - `masteryFor(S, C)` immediately after `again` attempt: R ≈ 1.0 (t ≈ 0), accFactor = sigmoid(0) = 0.5 → mastery ≈ 0.5.
  - Same call with `atTime = now + 30d` → R ≪ 1, mastery low. Confirms decay.

## A.4 — Backfill from legacy `entries`

### Schema diff
None.

### Algorithm
```
# convex/learningEngine/backfill.ts → action backfillMemoryFromEntries()
#   Run once after A.1 ships. Idempotent: skip if attemptLog has rows for student.

for each entry in entries (ordered by date asc):
  for (key, state) in entry.questions:
    if state in {"correct", "wrong"}:
      response = "good" if state === "correct" else "again"
      occurredAt = parseDate(entry.date) + slotIndex(entry.slotId, key) * 60_000  # synthetic time
      recordAttempt({
        studentId: entry.studentId,
        exerciseId: entry.exerciseId,    # legacy path → unit fallback
        questionKey: key,
        response,
        occurredAt,
        source: "backfill"
      })
```

### Edge cases
- **Re-running backfill** must be a no-op for already-processed students. Use `attemptLog` presence as guard, OR a one-row `migrations` table tracking last backfilled student/date.
- **Massive entries history** — chunk by 100 entries, schedule next chunk via `ctx.scheduler`. Convex mutations have time limits.
- **Sub-question keys** `"3.a"`, `"5.iii"` — treat each as a separate attempt.
- **Skipped/unmarked** questions are not attempts; ignore.

### Verification
- Pick 1 student with ~50 entries. Run backfill. `attemptLog` rows ≈ sum(correct + wrong question counts). `memoryState` populated for every concept of every unit they touched.
- Call backfill again: 0 new rows.

## A.5 — Per-student mastery dashboard (read-only)

### Schema diff
None.

### Algorithm
```
# Component: src/components/learning/student-mastery.tsx
# Query: masteryAll(studentId) + concept metadata + module/grade context.

# UI: heat-strip per module (M1..M6), each strip = horizontal bar of concept dots
#   colored by mastery bucket:
#     mastery >= 0.85 → green
#     0.50..0.85       → teal
#     0.25..0.50       → amber
#     < 0.25           → red
#     no data          → grey
# Hover/tap: shows concept name, R, accFactor, lastReviewAt, attemptCount.
```

### Edge cases
- **Student with zero attempts** (brand new): all grey dots.
- **Concept count > 80** for a grade: paginate per module strip, lazy-render hover details.
- **Cross-grade view** (downgraded student): show grades they're assigned in, in order.
- **Mobile**: single-column stacked strips, larger dots.

### Verification
- Open dashboard for backfilled student → strips populated. Open for new student → all grey.

---

# Phase B — Concept importance (exam blueprint)

## B.1 — Marks tagging on past-paper questions

### Schema diff
```ts
// Already in 0.5: questionBank.marksAvailable. UI work only here.
```

### Algorithm
Crop+tag UI for past papers (from 0.5) gains a "marks" numeric input next to difficulty. Required for `isHoldout = false AND useAsTrainingSignal = true` papers; optional for others (importance falls back to count).

### Edge cases
- **Marks not entered**: importance fallback uses count (1 mark per question equivalent).
- **Question split across sub-parts** (1a 2 marks, 1b 3 marks): user crops each sub-part as a separate `questionBank` row with its own marks. UI must make this easy.
- **Total marks mismatch** (sum of question marks ≠ paper.totalMarks): warn in dashboard, do not block.

### Verification
- Tag a paper: every cropped Q has marksAvailable. Coverage dashboard for that paper shows total marks ≈ paper.totalMarks.

## B.2 — Concept importance computation

### Schema diff
```ts
conceptImportance: defineTable({
  grade: v.number(),
  term: v.number(),                    // 1 | 2 | 3
  conceptExerciseId: v.id("exercises"),
  importance: v.number(),              // 0..1, normalized within (grade, term)
  rawMarks: v.number(),                // sum of marks across training papers
  paperCount: v.number(),              // how many training papers contributed
  source: v.string(),                  // "data" | "prior"
  computedAt: v.number(),
})
  .index("by_grade_term_concept", ["grade", "term", "conceptExerciseId"])
  .index("by_grade_term", ["grade", "term"]);
```

### Algorithm
```
# convex/learningEngine/importance.ts → action recomputeImportance(grade, term)
#   Triggered manually from B.3 dashboard, OR after a paper edit.

trainingPapers = pastPapers.where(grade, term, useAsTrainingSignal = true, isHoldout = false)

if trainingPapers is empty:
  # Prior fallback: each concept in (grade, term) gets importance proportional
  # to its question count in the textbook.
  for c in concepts(grade, term):
    qCount = exercises.where(unitId in unitsOf(grade, term), type=="exercise",
                              and concept c is in same unit) → count
    rawMarks[c] = qCount
    source[c] = "prior"
else:
  for paper in trainingPapers:
    for q in questionBank.where(pastPaperId = paper._id):
      m = q.marksAvailable ?? 1
      tags = questionConcepts.where(questionId = q._id)
      perTagMarks = m / tags.length     # split equally across tagged concepts
      for tag in tags:
        rawMarks[tag.conceptExerciseId] += perTagMarks
  source = "data"

# Normalize to [0, 1] within (grade, term)
total = sum(rawMarks.values())
for c in rawMarks:
  importance[c] = rawMarks[c] / total

# Upsert conceptImportance rows.
```

### Edge cases
- **Concept that never appears in any old paper but exists in syllabus**: rawMarks 0, importance 0. Sheet planner still surfaces it via syllabus-pace term, but importance contribution is zero. Add `MIN_IMPORTANCE_FLOOR = 0.005` so genuinely-absent concepts still get a sliver of weight.
- **All papers from one school** (e.g. only Western Province): bias warning in B.3 dashboard. No correction at this layer; user adds papers from other regions to balance.
- **Cumulative term semantics**: Term 2 paper covers Term 1 + Term 2 concepts. When recomputing importance for `(grade, term=2)`, include questions from term-2 papers AND consider that term-1 concepts also contribute to term-2 importance — this is handled by tagging: a Term 2 paper question testing fractions (Term 1 concept) is tagged to that fractions concept, automatically pushing fraction importance for term-2-relevant calculations.
- **Holdout exclusion**: enforced by `isHoldout = false` filter. Recompute MUST never include the current term's holdout.

### Verification
- 0 training papers: recompute → all importances are `count / total` from syllabus, source = "prior".
- Add 2 tagged training papers → recompute → importances reflect mark distribution, source = "data".
- Move a paper from training to holdout → re-run → that paper's contribution disappears.

## B.3 — Exam blueprint dashboard

### Schema diff
None.

### Algorithm
```
# Page: src/app/algorithm/blueprint/page.tsx
# Per (grade, term) view:
#   - "Recompute" button → invokes B.2 action
#   - Treemap or sorted bar chart of conceptImportance, grouped by unit
#   - Side panel: "papers contributing" list with toggle to include/exclude
#   - Warning banners (single-school bias, low paper count, missing marks)
```

### Edge cases
- **Slow recompute on large past-paper corpus**: action runs async, UI shows "computing…" skeleton with progress polled from a `migrationStatus` row.
- **Concept renamed mid-recompute**: importance row points by id, name resolves at render time — no stale state.

### Verification
- Open blueprint for G7 T2 → bars sum to 1.0. Toggle off one paper → "Recompute" → bars shift.

---

# Phase C — Student profile + retention debt

## C.1 — Student profile aggregator

### Schema diff
None — derived view.

### Algorithm
```
# convex/learningEngine/profile.ts → query studentProfile(studentId, asOf?)

mAll = masteryAll(studentId, asOf)            # Layer 2
imp = conceptImportance.where(grade in student.assignedGrades, term in {1,2,3})

profile = []
for c in concepts(student):
  m = mAll[c.id] ?? { mastery: 0, R: 0 }
  i = imp[(c.grade, c.term, c.id)] ?? { importance: MIN_IMPORTANCE_FLOOR }
  profile.push({
    conceptId: c.id,
    grade: c.grade, term: c.term, moduleId: c.moduleId,
    mastery: m.mastery,
    R: m.R,
    importance: i.importance,
    expectedExamContribution: m.mastery * i.importance,
    isMastered: m.mastery >= MASTERY_THRESHOLD,
    isAtRisk: i.importance >= 0.02 AND m.R < 0.5,
    prereqGap: hasUnmasteredPrereq(c, mAll),
  })

# Aggregations:
predictedExamPctPerTerm = {
  t: sum(p.expectedExamContribution for p in profile if p.term == t)
}
# Note: importance is normalized per (grade, term) → max 1.0 → predicted % is 0..100 cleanly.

return { profile, predictedExamPctPerTerm,
         atRiskConcepts: profile.filter(_.isAtRisk).sortBy(-_.importance),
         retentionDebtMarks: estimateMarksAtRisk(profile) }
```

### Edge cases
- **Student downgraded** (assignedGradesByModule): include each module's grade, not just `schoolGrade`.
- **Concept marked not-yet-introduced** (no entries in any student of the cohort): include with mastery=0, importance from prior.
- **Concept on prereq DAG cycle** — not handled at C.1 (cycle detection is Phase G); `hasUnmasteredPrereq` uses BFS with depth limit 10 to avoid infinite loop.

### Verification
- For a backfilled student: `predictedExamPctPerTerm.1` returns a number 0..100. Spot-check ≈ sum(mastery × importance) over Term 1 concepts.

## C.2 — At-risk + retention-debt detection

### Schema diff
None.

### Algorithm
```
# Used by Lead dashboard (Phase 3) and parent reports (Phase G.3).
# atRisk concept = importance >= 0.02 AND R < 0.5
# retentionDebt(student, term) = sum(importance(c) for c in concepts(term) if mastery(c) < 0.5)
#                                * paper.totalMarks(grade, term)
# → "X marks at risk in next exam"
```

### Edge cases
- **Term 3 cumulative**: retention debt for Term 3 sums concepts across all 3 terms of that grade.
- **No exam date in calendar**: cannot compute "marks at risk in upcoming exam"; show "no upcoming exam scheduled."

### Verification
- Run on a student with several wrong attempts on important concepts → retentionDebtMarks > 0 with a list.

## C.3 — Exam calendar

### Schema diff
```ts
examCalendar: defineTable({
  grade: v.number(),
  term: v.number(),
  year: v.number(),
  examDate: v.string(),     // YYYY-MM-DD
  totalMarks: v.optional(v.number()),
  notes: v.optional(v.string()),
})
  .index("by_grade_term_year", ["grade", "term", "year"])
  .index("by_examDate", ["examDate"]);
```

### Algorithm
```
# convex/learningEngine/calendar.ts
#   nextExamFor(grade, asOfDate) → first examCalendar row with examDate >= asOfDate
#   daysToNextExam(grade, asOfDate) → integer days
```

### Edge cases
- **No upcoming exam**: nextExamFor returns null. Sheet planner uses fallback strategy (no proximity boost; pure SR-driven).
- **Two grades for downgraded student**: query takes a list of grades, returns earliest upcoming.

### Verification
- Seed a row for G7 T1 2026-08-15. nextExamFor(7, '2026-05-01') returns it. daysToNextExam = 106.

---

# Phase D — Sheet planner (HARD-GATED on 0.6)

## D.1 — Candidate question pool

### Schema diff
None.

### Algorithm
```
# convex/learningEngine/planner.ts → internal function candidatePool(student, dateStr)
#   Returns Question[] eligible for today's sheet.

todayModule = moduleForDayOfWeek(dateStr)        # M1..M6
profile = studentProfile(student._id, dateStr)
mastered = profile.filter(_.isMastered).map(_.conceptId)
recentlyUsed = generatedSheets.where(studentId = student._id,
                                     date in [today - NOVELTY_COOLDOWN_DAYS, today)
                              ).flatMap(_.questionIds)

candidates = []
for c in profile:
  # prereq enforcement: skip if any prereq concept is unmastered
  if c.prereqGap: continue
  qs = questionConcepts.where(conceptExerciseId = c.conceptId)
        .map(_.questionId)
        .filter(q => q not in recentlyUsed)
  for q in qs:
    candidates.push({ q, concept: c })

return candidates
```

### Edge cases
- **Concept has prereqGap** but the prereq's own importance is high enough that planner should surface the prereq itself: handled in D.3 — when planner cannot fill warm-up from non-gapped concepts, it falls back to surfacing prereqs.
- **All questions for a concept are recently used**: concept has no candidates today. Picker tries again in NOVELTY_COOLDOWN_DAYS.
- **No questions tagged for a concept**: 0.6 gate should have caught this. If reached at runtime, log a `plannerGap` warning and continue.

### Verification
- For seeded student with prereq DAG and 3 days of past sheets: candidatePool returns expected concept-eligible Qs, excludes prereq-gapped ones, excludes recently-used ones.

## D.2 — Per-question scoring (additive)

### Schema diff
None.

### Algorithm
```
# convex/learningEngine/planner.ts → score(q, concept, student, dateStr, todayModule)

# All five factors normalized to [0, 1].
importance = concept.importance                                  # already 0..1

# Urgency: how stale is memory?  1 - R, but boost concepts past their "due date"
R = concept.R
urgency = clamp01(1 - R + (overdueDays(student, concept) > 0 ? 0.2 : 0))

# Difficulty fit: Gaussian peak where q.difficulty matches student.skill on this concept
studentSkillOnConcept = 1 + 4 * concept.mastery            # maps mastery 0..1 → 1..5
qDiff = q.difficulty ?? 3
fit = exp(-((qDiff - studentSkillOnConcept) ** 2) / (2 * FIT_SIGMA ** 2))

# Novelty: 1 if not used in cooldown window, else 0 (D.1 already filtered, so always 1 here)
novelty = 1.0

# Exam proximity: only meaningful for concepts in this term's exam
days = daysToNextExamFor(student.grade, concept.term, dateStr)
if days is null OR days > 90: proximity = 0
else: proximity = clamp01(1 - days / 90)

# Module-of-day affinity: bonus only if concept's module matches today's module
#   Enforced through SLOT ALLOCATION (D.3), not via score, so warm-up & exam-prep
#   slots can deliberately pick OTHER modules.

baseScore = W_IMPORTANCE * importance
          + W_URGENCY    * urgency
          + W_FIT        * fit
          + W_NOVELTY    * novelty
          + W_PROXIMITY  * proximity

return baseScore   # in [0, 1]
```

### Edge cases
- **Concept never seen**: R = 0, urgency = 1, accFactor neutral. fit will favor easy questions because studentSkillOnConcept ≈ 1.
- **Difficulty unknown on q**: default 3, fit treats as middling.
- **Concept past exam-date backstop**: handled in D.5, not here.

### Verification
- Synthetic: 3 concepts, 3 questions each, varying R/importance/difficulty. Print ranked list. Eyeball: high-importance + low-R concepts top the list with mid-difficulty questions.

## D.3 — Slot allocator

### Schema diff
None.

### Algorithm
```
# convex/learningEngine/planner.ts → planSheet(studentId, dateStr) → SheetPlan
#   Returns { warmup: Q[], main: Q[], examPrep: Q[] } chosen by slot rules.

cands = candidatePool(student, dateStr)
todayModule = moduleForDayOfWeek(dateStr)
sheetLen = sheetLengthFor(student)              # 5 / 8 / 12 from student profile knob
warmupN = round(sheetLen * WARMUP_RATIO)
mainN   = round(sheetLen * MAIN_RATIO)
examN   = sheetLen - warmupN - mainN

# WARM-UP: cross-module SR. Pick highest-urgency from concepts NOT in today's module.
warmupCands = cands.filter(c => c.concept.moduleId !== todayModule)
                   .sortBy(c => -score(c.q, c.concept, ...))
warmup = topUnique(warmupCands, warmupN, key: "concept.id")    # diversify by concept

# MAIN BLOCK: today's module, interleaved across distinct concepts within module.
mainCands = cands.filter(c => c.concept.moduleId === todayModule)
                 .sortBy(c => -score(c.q, c.concept, ...))
main = topUnique(mainCands, mainN, key: "concept.id", interleavePolicy: "round-robin")

# EXAM-PREP: past-paper questions tagged to mastered/near-mastered concepts.
examCands = cands.filter(c => c.q.source === "past-paper"
                              AND c.concept.mastery >= 0.5)
                 .sortBy(c => -score(c.q, c.concept, ...))
examPrep = topUnique(examCands, examN, key: "concept.id")

# Phase-of-term reweighting: at week W of term, shift ratios using a piecewise table
#   (Section 5 of learning_engine_plan.md). Computed before sheetLen split above.

# Exam-week override: in last 14 days before any term exam, force fully-mixed mode.
if daysToNextExam(student.grade) < 14:
  return planExamWeekSheet(...)

return { warmup, main, examPrep }
```

### Edge cases
- **Empty warmup pool** (everything in today's module): downgrade — fill warmup from today's module review concepts (mastery >= 0.5).
- **Empty main pool** (today's module: nothing left to learn for student's grade): substitute past-paper Qs from this module.
- **Empty exam-prep pool** (no past-paper questions tagged yet): replace with regular candidate Qs marked as harder difficulty.
- **Sheet under-filled** even after fallbacks: ship the shorter sheet, log `underFillReason`.
- **Round-robin interleaving in main**: pick top Q from concept A, then top Q from concept B, … wrap around. Prevents 5 fraction questions in a row even when fractions dominate by score.

### Verification
- For a backfilled student on a Tuesday (M2): warmup has concepts from M1/M3-M6, main from M2, examPrep from past papers. No duplicate concept across slots.

## D.4 — Prereq DAG enforcement (preflight)

### Schema diff
None.

### Algorithm
```
# Already partially enforced in D.1 via prereqGap. Add preflight at sheet save:
for q in chosenQs:
  for c in conceptsOf(q):
    for p in prereqsOf(c):
      if mastery(student, p) < MASTERY_THRESHOLD:
        # Surface in sheet metadata as a "prerequisite alert" for Lead.
        sheet.alerts.push({ type: "prereqUnmet", concept: c, prereq: p })

# Do NOT block — Lead can choose to override. Alert shows in D.6 audit + tomorrow's
# sheet preview UI.
```

### Edge cases
- **Cycle detection**: BFS with `visited` set, depth cap 10. If cycle hit, log warning, treat that prereq edge as absent for this run.

### Verification
- Add prereq A → B. Mastery of A = 0.3. Plan a sheet that includes a B question. Sheet alerts has prereqUnmet entry.

## D.5 — Exam-date backstop scheduler

### Schema diff
None.

### Algorithm
```
# convex/learningEngine/scheduler.ts → augment urgency in score() based on exam.
#   Already partially in D.2 (proximity factor). Backstop is a hard rule:

for concept in profile:
  exam = nextExamFor(student.grade)
  if exam is null OR concept.term > exam.term: continue
  daysToExam = daysBetween(today, exam.examDate)
  daysUntilNaturalReview = daysSince(concept.lastReviewAt)
                          + naturalIntervalFromStability(concept.stability)
  if daysUntilNaturalReview > daysToExam - EXAM_BACKSTOP_DAYS:
    # Force review before backstop. Boost urgency to ceiling.
    concept.urgencyOverride = 1.0     # planner uses this in score
```

### Edge cases
- **Exam in 5 days, sheet length = 8**: backstop forces all overdue concepts into the sheet, may overflow. Resolved by exam-week override in D.3 picking only top N by importance.
- **Exam already past**: nextExamFor moves to following term automatically.

### Verification
- Set examDate 25 days out. Concept with stability 30d, lastReviewAt 0d ago → naturalReview 30d. backstop = examDate-21 = 4d. Urgency forced to 1.0.

## D.6 — Sheet record + audit

### Schema diff
```ts
generatedSheets: defineTable({
  studentId: v.id("students"),
  date: v.string(),                        // YYYY-MM-DD
  slotId: v.optional(v.id("scheduleSlots")),
  generatedAt: v.number(),
  generatedByTeacherId: v.optional(v.id("teachers")),
  status: v.string(),                      // "draft" | "printed" | "completed"
  warmupQuestionIds: v.array(v.id("questionBank")),
  mainQuestionIds:   v.array(v.id("questionBank")),
  examPrepQuestionIds: v.array(v.id("questionBank")),
  alerts: v.optional(v.any()),             // [{type, conceptId, prereqId}]
  scoringSnapshot: v.optional(v.any()),    // each q's contributing factors at gen time
  pdfStorageId: v.optional(v.id("_storage")),  // populated by Phase E
  printedAt: v.optional(v.number()),
  completedAt: v.optional(v.number()),
})
  .index("by_student_date", ["studentId", "date"])
  .index("by_date", ["date"])
  .index("by_status", ["status"]);

// Override journal (Lead manual swaps).
sheetOverrides: defineTable({
  sheetId: v.id("generatedSheets"),
  action: v.string(),                      // "swap" | "remove" | "add"
  questionIdBefore: v.optional(v.id("questionBank")),
  questionIdAfter: v.optional(v.id("questionBank")),
  byTeacherId: v.id("teachers"),
  reason: v.optional(v.string()),
  at: v.number(),
}).index("by_sheet", ["sheetId"]);
```

### Algorithm
```
# convex/learningEngine/planner.ts → mutation generateSheetsForSlot(slotId, dateStr)
#   1. List students in slot.
#   2. For each, planSheet(studentId, dateStr).
#   3. Insert generatedSheets row, status="draft", scoringSnapshot recorded.
#   4. Return summary { generatedCount, errors, alerts }.

# mutation overrideSheet(sheetId, action, args) → writes sheetOverrides + mutates sheet
# mutation markPrinted(sheetId)
# mutation markCompleted(sheetId)
```

### Edge cases
- **Re-generation for same student/date**: don't insert duplicate; either replace draft or block if status != "draft".
- **Student absent that day**: sheet generated anyway; if attendance later marks absent, sheet auto-marked "skipped" (no completion).
- **scoringSnapshot bloat**: store only top contributing factors per question, not full ranked list of candidates.

### Verification
- Trigger generation for a slot of 5 students. 5 draft sheets exist. Override one (swap Q3). sheetOverrides has 1 row, sheet updated.

---

# Phase E — PDF rendering & batch print

## E.1 — Image fetch + crop pipeline

### Schema diff
None.

### Algorithm
```
# Server-side render. Choice: Convex action calling node-canvas / pdf-lib.
#   Avoid client-side rendering — too slow for 30 students × 8 questions.

# convex/learningEngine/pdf.ts → action renderSheetPDF(sheetId)

sheet = generatedSheets.get(sheetId)
allQs = [...warmupQs, ...mainQs, ...examPrepQs]

for q in allQs:
  page = textbookPages.get(q.textbookPageId) OR pastPaperPages.get(q.pastPaperPageId)
  pageImageUrl = ctx.storage.getUrl(page.storageId)
  pageImageBuffer = fetch(pageImageUrl)
  cropped = cropImage(pageImageBuffer, q.cropBox)   # via sharp / canvas
  q.croppedDataUrl = base64(cropped)

pdfBuffer = composePDF(sheet, allQs)                # E.2
storageId = ctx.storage.store(pdfBuffer, "application/pdf")
sheet.pdfStorageId = storageId
sheet.status = "printed-ready"
```

### Edge cases
- **Image fetch failure** (storage 5xx): retry 2x with backoff, then mark sheet error and surface to Lead.
- **Memory pressure batching 30 sheets at once**: chunk in 5s, schedule next chunk.
- **Crop coords out of bounds** (corrupt cropBox): clamp to [0,1]; render whatever falls in bounds.
- **Question images of wildly different aspect ratios**: layout engine (E.2) normalizes to fixed slot size with letterboxing.

### Verification
- Render one sheet. Open PDF — every Q image visible, cropped, in correct slot order.

## E.2 — Layout engine

### Schema diff
None.

### Algorithm
```
# A4 portrait, 4mm margins.
# Header: student name, date, module-of-day, "Aristora" mark, slot identifiers.
# Three labeled sections: WARM-UP / MAIN BLOCK / EXAM-PREP
# Each Q: number, cropped image (max 80mm wide), 4 ruled lines for working,
#         small concept-name footnote in muted text.
# Page break: if Q would clip, push to page 2. Header repeats on page 2.

# Library candidates:
#   - pdf-lib (pure JS, runs in Convex action environment) ✓ recommended
#   - puppeteer (heavy, needs Chromium) ✗ avoid for now
#   - jsPDF (browser-first, awkward for actions) ✗
```

### Edge cases
- **Sheet > 2 A4 pages**: warn — sheet length too high; suggest reducing.
- **Tamil characters in question images**: irrelevant — they're rasterized into the cropped image, not text. Header text is English.
- **High-DPI source images**: downsample to 200 DPI for print; crop is already image-coords-driven.

### Verification
- Sheet of 8 Qs renders in 1 page. Sheet of 14 Qs renders in 2 pages with header repeat.

## E.3 — Batch generation + ZIP download

### Schema diff
None.

### Algorithm
```
# Page: src/app/algorithm/sheets/page.tsx
#   - Date picker (default tomorrow)
#   - Slot dropdown
#   - Status table: per-student row { name, status, alerts, [Generate] / [Re-gen] / [Override] / [PDF] }
#   - "Generate ALL drafts" button → calls generateSheetsForSlot in a single action.
#   - "Render ALL PDFs" button → loop renderSheetPDF, on completion of each, status flips.
#   - "Download ZIP" button → action zipSheetPDFs(slotId, date) → returns _storage id of zip.
```

### Edge cases
- **Partial generation failure**: per-student status, retry per row.
- **ZIP > 50MB**: warn; provide alternative "Download per student" links.
- **Browser download blocked**: surface direct link.

### Verification
- 5 students, generate + render + zip → single ZIP downloads, contains 5 PDFs named `<student>_<YYYY-MM-DD>.pdf`.

## E.4 — Lead override UI

### Schema diff
None (uses `sheetOverrides` from D.6).

### Algorithm
```
# Component: src/components/algorithm/sheet-preview.tsx
#   Shows the sheet with each Q rendered.
#   Buttons per Q: [Swap] [Remove] [Why this Q?]
#   [Why this Q?] opens a side panel showing scoringSnapshot factors for that Q.
#   [Swap] opens a candidate picker (top 10 next-best Qs from candidatePool).
#   [Add Q] manual search + insert.
#
#   All actions write sheetOverrides + mutate sheet's question id arrays.
#   Re-render PDF on save.
```

### Edge cases
- **Override after PDF rendered**: re-render automatically; old PDF storage object orphaned (cleanup script later).
- **Concurrent edits**: optimistic lock via sheet.generatedAt; second writer rejected.

### Verification
- Generate sheet, swap Q3 with another candidate. PDF reflects swap. sheetOverrides logs the action.

---

# Phase F — Calibration loop (post-exam)

## F.1 — Holdout exam crop + tag (extends 0.5 + B.1)

### Schema diff
None — uses `pastPapers` with `isHoldout = true`. UI work only.

### Algorithm
```
# Same crop+tag flow as past papers.
# Constraint: while a paper is `isHoldout = true`, the planner MUST NEVER include
# its questions. Enforce in candidatePool() with a hard filter.

# Post-exam workflow:
#   1. User uploads scanned exam paper (or pre-uploaded before exam).
#   2. After exam date passes, user crops + tags + sets marks per Q.
#   3. UI button: "Mark exam as completed → start calibration" → triggers F.2.
```

### Edge cases
- **Holdout uploaded before exam date**: that's fine, just don't tag yet (or tag but planner still excludes by `isHoldout`).
- **User accidentally toggles `useAsTrainingSignal=true` on a holdout**: UI prevents (B.1 already covers).

### Verification
- Holdout paper exists, planner runs → none of its Qs appear in any sheet. Confirmed via sheet audit.

## F.2 — Per-student exam mark entry

### Schema diff
```ts
examScores: defineTable({
  examPaperId: v.id("pastPapers"),
  studentId: v.id("students"),
  questionId: v.id("questionBank"),         // a question on the holdout paper
  marksObtained: v.number(),
  enteredAt: v.number(),
  enteredByTeacherId: v.optional(v.id("teachers")),
})
  .index("by_paper_student", ["examPaperId", "studentId"])
  .index("by_student", ["studentId"])
  .index("by_question", ["questionId"]);
```

### Algorithm
```
# Page: src/app/algorithm/exam-entry/[paperId]/page.tsx
#   Grid: students × questions. Each cell = numeric input (0..marksAvailable).
#   Bulk-paste support (CSV).
#   "Save & calibrate" → triggers F.3 recompute.
```

### Edge cases
- **Student absent for exam**: leave row empty; calibration excludes that student for that paper.
- **Re-entry / correction**: upsert by (paperId, studentId, questionId).

### Verification
- Enter marks for 5 students × 20 Qs. examScores has 100 rows. Save survives reload.

## F.3 — Per-concept calibration

### Schema diff
```ts
calibrationRecords: defineTable({
  examPaperId: v.id("pastPapers"),
  studentId: v.id("students"),
  conceptExerciseId: v.id("exercises"),
  predictedMastery: v.number(),         // mastery at the time of exam (snapshot)
  actualScorePct: v.number(),           // marksObtained / marksAvailable on Qs tagged to this concept
  marksAvailable: v.number(),           // sum of marks on Qs tagged to this concept
  marksObtained: v.number(),
  computedAt: v.number(),
})
  .index("by_paper", ["examPaperId"])
  .index("by_paper_concept", ["examPaperId", "conceptExerciseId"])
  .index("by_student_concept", ["studentId", "conceptExerciseId"]);
```

### Algorithm
```
# convex/learningEngine/calibration.ts → action runCalibration(examPaperId)

paper = pastPapers.get(examPaperId)
examDate = paper-derived from examCalendar
qs = questionBank.where(pastPaperId)
qConcepts = questionConcepts.where(questionId in qs)

# Snapshot mastery as it was on examDate (replay using attemptLog up to that date).
for student in studentsWhoSat(paper):
  attemptLogSnapshot = attemptLog.where(studentId, occurredAt <= examDate)
  # Recompute memory state from snapshot (replay)
  snapshotMastery = replayMastery(student, attemptLogSnapshot, examDate)

  # Bucket exam scores by concept
  perConcept = {}
  for q in qs:
    obtained = examScores.get(paperId, student._id, q._id)?.marksObtained ?? 0
    available = q.marksAvailable
    for tag in qConcepts.where(questionId = q._id):
      perConcept[tag.conceptExerciseId] += { obtained, available }

  for (cId, agg) in perConcept:
    insert calibrationRecords({
      examPaperId, studentId: student._id,
      conceptExerciseId: cId,
      predictedMastery: snapshotMastery[cId],
      actualScorePct: agg.obtained / agg.available,
      marksAvailable: agg.available,
      marksObtained: agg.obtained,
      computedAt: now
    })
```

### Edge cases
- **No attemptLog snapshot before examDate**: predictedMastery from current memoryState rather than replay (degraded mode, log warning).
- **marksAvailable = 0 across concept**: skip — would divide by zero.
- **Multi-concept question marks split**: weight per tag = marksObtained / numTags. Same as B.2's split rule.

### Verification
- After F.2 entry: action computes calibrationRecords. Per-student per-concept row count matches concepts touched by exam.

## F.4 — Calibration scatter + insights

### Schema diff
None.

### Algorithm
```
# Page: src/app/algorithm/calibration/[paperId]/page.tsx
#   - Scatter: x = predictedMastery, y = actualScorePct. Diagonal = perfect calibration.
#   - Color points by importance.
#   - Regression line + R^2.
#   - Per-concept table: |error| sortable. Top over-predicted, top under-predicted.
#   - "Suggested adjustments" panel (read-only in F; actionable in G).
#       e.g. "Concept X consistently over-predicted by 18% across 12 students.
#             Suggest reducing acc_factor's α for this concept, or raising MASTERY_THRESHOLD."
```

### Edge cases
- **Single student / single paper**: scatter still renders, R^2 unstable.
- **All points cluster low**: low predictions across the board; suggests the system was too pessimistic.

### Verification
- Visual: open page after F.3 → scatter shows N students × M concepts points, diagonal drawn, table populated.

## F.5 — Retention-debt callback

### Schema diff
None.

### Algorithm
```
# After F.3, paper flips: useAsTrainingSignal = true, isHoldout = false.
# Trigger B.2 recomputeImportance(grade, term) automatically.
# Now this paper's questions feed the planner forever.
```

### Edge cases
- **User disagrees with one tagged concept**: re-edit tag, re-run F.3 + B.2.
- **Race**: planner may run during recompute. Use a "blueprint version" stamp on conceptImportance, planner reads latest.

### Verification
- After F.4: pastPapers.isHoldout = false, useAsTrainingSignal = true. conceptImportance has refreshed values for that grade/term.

---

# Phase G — Time-to-mastery predictor + tuning lab

## G.1 — Predicted exam score (MVP, single number per concept + per term)

### Schema diff
None — derived view.

### Algorithm
```
# convex/learningEngine/predictor.ts → query
#   predictExamScore(studentId, term, asOf?)
#   Returns: { perConcept: [{ conceptId, predictedAt: examDate, mastery, contribution }],
#              overallPct: 0..100,
#              confidenceBand: { low, high } }

exam = nextExamFor(student.grade, term)
if exam is null: return error("no exam scheduled")

# Project mastery to examDate by simulating ONLY the time decay
# (no scheduling simulation in MVP — that's deferred to a future "what-if" tool).
profile = studentProfile(studentId, asOf)
for c in profile if c.term <= exam.term:
  futureT = daysBetween(asOf, exam.examDate) + daysSince(c.lastReviewAt)
  futureR = (1 + futureT / (FACTOR * c.stability)) ^ -1
  futureMastery = futureR * c.accFactor      # accFactor doesn't decay
  contribution = futureMastery * c.importance

overallPct = sum(contribution) * 100   # importance is normalized to sum 1.0

# Confidence band: ± 1σ of historical calibration error for similar predictions
# (after F has data). Empty band before F.
```

### Edge cases
- **No exam scheduled** → null + UI message.
- **No prior calibration** → confidenceBand omitted, UI shows "no historical accuracy data yet."
- **Cumulative term**: include all concepts up to and including exam.term.

### Verification
- For backfilled student with examDate 30d out: overallPct returns 0..100 number. Manually compute one concept's contribution; matches.

## G.2 — Predictor on Lead dashboard + parent report

### Schema diff
None.

### Algorithm
```
# Lead dashboard student card: "Predicted Term 2: 71% (target 75%) ▼ 2 at-risk concepts"
#
# Parent report PDF:
#   - One page per term
#   - Predicted exam score with confidence band
#   - Top mastered concepts (green check)
#   - Top at-risk concepts (orange) with action: "More practice needed on X, Y, Z"
#   - Last term's predicted vs actual (if F has data) — the "moat" claim
```

### Edge cases
- **First-term student (no historical predicted-vs-actual)**: parent report omits the comparison section.
- **PDF generation reuses Phase E pipeline.**

### Verification
- Generate report for backfilled student. PDF opens, numbers consistent with G.1 query.

## G.3 — Tuning lab: from constants to DB-stored params

### Schema diff
```ts
learningParams: defineTable({
  scope: v.string(),           // "global" | "grade:7" | "concept:<id>"
  paramName: v.string(),       // "FACTOR", "STAB_GROWTH_GOOD", "W_IMPORTANCE", ...
  value: v.number(),
  setAt: v.number(),
  setByTeacherId: v.optional(v.id("teachers")),
  notes: v.optional(v.string()),
})
  .index("by_scope_param", ["scope", "paramName"])
  .index("by_param", ["paramName"]);

paramExperiments: defineTable({
  name: v.string(),
  hypothesis: v.string(),
  cohortFilter: v.any(),       // { grade?, schoolName?, isWeak? }
  baselineParams: v.any(),     // snapshot
  variantParams: v.any(),      // snapshot
  startedAt: v.number(),
  endedAt: v.optional(v.number()),
  status: v.string(),          // "running" | "ended"
  outcomeSummary: v.optional(v.any()),
})
  .index("by_status", ["status"]);
```

### Algorithm
```
# convex/learningEngine/config.ts → resolveParam(name, scope) function:
#   1. Check learningParams for matching scope (most specific first).
#   2. Fall back to literal default in code.
# Every algorithm function (mastery update, planner score, etc.) uses
# resolveParam() instead of importing constants directly.

# UI: src/app/algorithm/tuning/page.tsx
#   - Sidebar: parameter list grouped (memory / scoring / scheduling)
#   - Main: editor with current value, default value, history of changes
#   - "Replay" button: re-runs F.3 calibration with new params on a sample of past data
#                      → side-by-side calibration scatter (current vs proposed)
#   - "Apply" button: writes learningParams row
#   - "Start A/B": creates paramExperiments row, splits cohort, both runs concurrently
```

### Edge cases
- **Param change affects in-flight sheets**: only future generations use new value; existing sheets are immutable artifacts.
- **A/B with very small N**: warn user before launch; require minimum cohort size.
- **Param removed from code**: orphaned learningParams rows ignored; surface in UI as "deprecated."

### Verification
- Change W_IMPORTANCE from 0.30 → 0.40 in tuning lab → next sheet generation reflects new weights, scoringSnapshot shows updated values.

---

# Phase H — Scale, A/B, parallel scoring, leaderboard

## H.1 — Parallel scoring (flat A vs difficulty-weighted B)

### Schema diff
```ts
// Extend entries with a derived "difficulty-weighted" score column,
// computed at insert time.  Or store on a side table to avoid touching entries:
scoringB: defineTable({
  entryId: v.id("entries"),
  pointsB: v.number(),         // difficulty-weighted total for this entry
  computedAt: v.number(),
}).index("by_entry", ["entryId"]);
```

### Algorithm
```
# At every entry insert (or migration backfill):
#   pointsB = sum(weight(q) * 5 for q in entry.questions if q == "correct")
#   where weight(q) uses questionBank.difficulty if linked, else 3.

# Both totals visible to user (admin view) but only A is shown publicly.
# After one term: side-by-side dashboard (engagement, complaints, motivation
# proxy) → user picks winner → flip leaderboards to B.
```

### Edge cases
- **Legacy entries pre-questionBank**: difficulty defaults to 3 → weight 1.2 → very close to flat A. Acceptable.

### Verification
- Side-by-side daily totals: A and B both populated. After flipping leaderboard.scoringMode, public view shifts.

## H.2 — Difficulty auto-calibration (Elo overlay)

### Schema diff
```ts
questionBank.eloDifficulty: v.optional(v.number())   // 1..5 continuous, learned
```

### Algorithm
```
# After each attempt:
#   expected = sigmoid(studentSkillOnConcept - questionElo)
#   observed = response === "good" ? 1 : 0
#   delta = K * (observed - expected)
#   questionBank.eloDifficulty += delta
#   studentSkillOnConcept (derived) shifts via memoryState updates already.
#
# K starts high (0.4), decays over attempts → stabilizes.
# scoring + sheet planner can choose to use eloDifficulty when set.
```

### Edge cases
- **Cold question** (zero attempts): eloDifficulty inherits initial difficulty.
- **Outlier student** dragging Elo around: K decay rate prevents wild swings.

### Verification
- After 50 attempts on a Q across students: eloDifficulty stabilizes within ±0.5 of true difficulty.

## H.3 — Mastery-based leaderboard

### Schema diff
None — derived view.

### Algorithm
```
# Per grade per term:
#   score(student) = sum(mastery(c) * importance(c)) * 100
# Same formula as G.1 overallPct, presented as a leaderboard rank.
# Coexists with daily-points leaderboard, separate tab.
```

### Verification
- Open mastery leaderboard. Top student = highest predicted exam score among grade peers.

## H.4 — Cohort A/B framework polish

### Schema diff
None — uses paramExperiments from G.3.

### Algorithm
```
# Experiment runner:
#   1. Pick cohort by filter (e.g. "G7 students at center X").
#   2. Randomly assign 50/50 to baseline / variant.
#   3. Tag generatedSheets.experimentId = experiment._id, group = "A" | "B".
#   4. After endedAt or N attempts: compute outcome metric (most useful = post-period
#      calibration scatter R^2, or per-group avg predictedExamPct).
#   5. Show A/B side-by-side with statistical significance hint.
```

### Verification
- Start small experiment. Sheets tagged with group. End: outcomeSummary populated.

## H.5 — Franchise SOP

### Schema diff
None.

### Algorithm
None — documentation deliverable.

### Verification
- Centre operator can follow `docs/franchise-sop.md` to onboard a new centre, seed students, generate first sheet, run first calibration.

---

## Per-layer low-data behavior (the user's named weakness)

| Layer | Zero data | One term of data | Multi-term |
|---|---|---|---|
| L1 Memory | Default FSRS-lite params from `config.ts`. R/S/D update on every attempt from defaults. | Same defaults. Calibration in F shows where defaults under/over-fit. | G.3 tuning lab adjusts STAB_GROWTH_*, DIFF_DELTA_*, FACTOR per scope (global / grade / concept). |
| L2 Mastery | Cold concepts → mastery 0; first attempt creates state. | Same formula; ACC_ALPHA literal. | G.3 may tune ACC_ALPHA. |
| L3 Importance | Prior fallback: importance ∝ question count in syllabus. | One paper minimum; noisy weights but better than prior. | Each new paper sharpens; multi-school papers cancel regional bias. |
| L4 Profile | Predicted exam pct uses prior-importance × mastery; numbers exist but unreliable. | Calibration in F gives confidence band. Reliability visible to user. | Confidence band tightens; predictions trustworthy by Term 3. |
| L5 Sheets | Generator works from day one; ratios from `WARMUP_RATIO` etc. | Fine. | Phase-of-term ratio table replaces literals when calibration shows late-term review = under-served. |
| L6 Calibration | N/A — no exams yet. | First scatter; suggestions readable. | Scatter tightens; suggestion engine moves from "try X" to "X reduces RMSE 12%." |
| L7 Tuning lab | Hidden behind feature flag. | Read-only, surfaces calibration. | Full sliders + A/B. |

---

## Verification matrix (cross-phase smoke test)

After each phase ships, run this end-to-end:

1. Seed 1 student, 1 unit, 5 concepts, ≥5 Qs/concept (use seed script).
2. Backfill 30 days of synthetic attempts (`scripts/seed-attempts.ts`).
3. Run mastery dashboard → 5 colored dots.
4. Set examCalendar entry 60 days out.
5. Generate sheet for tomorrow → 8 Qs in 3 slots.
6. Render PDF → opens, all images visible.
7. Override Q3 → sheet + override row.
8. Predict exam pct → number 0..100.
9. Upload synthetic exam paper, tag, enter scores → calibration scatter renders.
10. Tweak W_IMPORTANCE in tuning lab → next sheet shows shifted weights.

If all 10 pass on a single student, the system is end-to-end functional. Scale-test with 30 students before declaring Phase H done.

---

## Open questions for fresh sessions

These are NOT yet decided. Surface to user when the relevant phase arrives — do not invent answers.

1. **Print layout polish (E.2)**: column count, footer, brand mark placement.
2. **PDF library choice**: pdf-lib confirmed working in Convex action env? If not, fall back to `@react-pdf/renderer` server-side.
3. **Cron vs button** (D.6 / E.3): user said "press the button at night, no cron." Confirm at Phase D ship — if user wants automation later, add Convex scheduled function.
4. **Attendance interaction** (D.6): should sheet auto-mark "skipped" if student absent? Or always remain "draft" until manually completed?
5. **Multi-centre data isolation** (H): does each centre have its own `learningParams` scope?
6. **A/B test floor N**: what's the minimum cohort to allow an experiment to start?
7. **Prereq cycle policy** (D.4): warn-and-continue vs hard-block.
8. **Difficulty-weighted scoring rollout** (H.1): cutoff date for the parallel run?
9. **Past-paper image OCR alternative for marks**: Tamil OCR still bad — user enters marks manually. If at scale this hurts, consider tablet-stylus shortcut.
10. **Forgetting-curve replay precision (F.3)**: replaying attemptLog cold is O(N log N) per student per paper. If slow, snapshot memoryState daily.

---

## How to execute this plan with Sonnet 4.6

For each sub-phase, in order:

1. Open this file. Read only the sub-phase block (Schema diff / Algorithm / Edge cases / Verification).
2. Implement the schema diff in `convex/schema.ts`. Run `npx convex dev` once.
3. Implement the algorithm in the file path named in the block.
4. Add UI per the algorithm block.
5. Run `npx tsc --noEmit -p tsconfig.json` → must exit 0.
6. Run the verification step manually.
7. Commit with message `feat(algo-X.Y): <one-line summary>`.
8. Report back to user; ask before starting the next sub-phase.

Do **not** combine sub-phases. Do **not** add features not in the block. If a sub-phase reveals a missing decision, surface it to the user as a new entry in the open-questions list above.

---

## Final note: why this plan is structured this way

The advisor pushed back on three temptations during planning, and the format here reflects the resolutions:

1. **No two competing mastery formulas.** Single FSRS-lite × accuracy_factor formula. Everything else is computation on top.
2. **Sheet score is additive, not multiplicative.** Multiplicative pipelines collapse to zero on any near-zero factor. Additive with normalized factors keeps every dimension contributing.
3. **Time-to-mastery is a number, not a curve.** Forward-simulating mastery trajectories under hypothetical schedules is a research project. MVP is one number per concept and one per term — actionable, fast, sufficient.

The 7-layer architecture is over-spec'd on purpose: it gives you (the user) clean conceptual ownership of each layer for the tuning lab in G, and lets Sonnet 4.6 ship one layer at a time without ever touching another.
