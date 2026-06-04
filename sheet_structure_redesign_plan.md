# Build Spec — Path-Driven Sheet Structure Redesign

> **Audience:** a fresh engineering session (Sonnet) with full access to this repo but **no memory of the conversation that produced this spec.** Read this whole file first, then execute phase by phase. An orchestrator (Opus) will review your work afterward — Section 9 tells you exactly what to hand back.
>
> **This is the existing build-spec format used across `algorithm_plan.md`. Each phase has: Files to read first / Schema diff / Algorithm / Edge cases / Verification. Do not deviate from the format. Do not combine phases. Commit after each phase. Ask the human before starting the next phase if anything is ambiguous.**

---

## 0. What this app is (orient yourself)

Aristora is a math-tutoring app. The core feature is the **Sheets tab** (`src/components/session/sheets-tab.tsx`), which generates a personalised printed practice sheet (PDF) for each student each session. The "brain" that picks questions lives in `convex/learningEngine/planner.ts`. The PDF renderer is `convex/learningEngine/pdf.ts` + `pdfHelpers.ts`. Tunable constants are in `convex/learningEngine/config.ts`. The memory/forgetting model is `convex/learningEngine/mastery.ts`. The full historical spec is `algorithm_plan.md` (read its Phase D and E sections for background).

**Before writing any code, read these files end-to-end so you understand the current shape:**
- `convex/learningEngine/planner.ts` (the whole file — this is what you're changing most)
- `convex/learningEngine/config.ts`
- `convex/learningEngine/pdf.ts` and `convex/learningEngine/pdfHelpers.ts`
- `convex/learningEngine/mastery.ts` and `convex/learningEngine/profile.ts`
- `convex/learningEngine/derivedConcepts.ts`
- `convex/schema.ts` (find `generatedSheets`, `scheduleSlots`, `memoryState`, `attemptLog`, `conceptImportance`, `examCalendar`, `exercises`)
- `src/lib/curriculum-data.ts` (the curriculum tree: modules → grades → terms → units → concepts; and helpers `CURRICULUM_MODULES`, `findUnit`)
- `src/lib/sheets/scope.ts` (`resolveGradeByModule`, `unitIdsForScope`)
- `src/components/session/sheets-tab.tsx`, `src/components/sheets/inspector-body.tsx`, `src/components/sheets/shared.ts`, `src/components/algorithm/sheet-preview.tsx`
- Locate the **Insights / Analytics page** (grade/term tabbed UI). Find it by searching for the analytics tabs. You will mirror its tab pattern in Phase 2.

---

## 1. The problem & the goal

**Today the new topic is decided by the day of the week.** Everywhere the code asks "what is today's topic?", it answers `moduleForDayOfWeek(date)` → Mon=M1, Tue=M2, … Sat=M6. This silently assumes every student attends ~6 days/week, one module per day.

**Reality:** students attend 2–4 days/week, variable per student. The weekday rule means a 2-day/week student would only ever learn two modules and never see the rest. The calendar, not the student's progress, drives teaching. **That is the core thing we are removing.**

**Goal:** each student progresses along **their own path** through the syllabus, driven by progress + a teacher-curated order — not the weekday. A room of 10 students on 10 different topics should feel like 10 private lessons, run by one teacher. This is the product's moat: personalization that does not cost personal time.

---

## 2. The vision (north star)

Three learning-science pillars drive the design — keep them in mind when in doubt:

1. **Active recall** — every question is retrieval practice (already true).
2. **Spaced repetition** — re-surface a concept *just before the student would forget it*. The engine already estimates this via `R` (retention) and `stability` in `mastery.ts`. The **Revision** section's only job is to pull each concept back right before its `R` decays too far. Done faithfully, the student effectively never forgets → "no cramming before exams."
3. **Interleaving** — mix concepts/units rather than blocking one (already done via `pickInterleaved`).

Plus **mastery learning** (prereqs gate new topics) and **error-driven learning** (re-test past mistakes → the new **Mistakes** section).

The **teacher-curated path** is the safety valve: when there isn't time to cover everything, the most exam-valuable units are taught first, so a weak student still locks in the marks that matter most.

---

## 3. Hard constraints — DO NOT break these

1. **Do NOT touch the per-question scoring engine** (the `I/U/F/N/P` factors in `scoreCandidate` / `scoreCandidatePool`). The human built it deliberately for a different purpose and it stays. You may *read* scores to rank candidates; do not change weights or the formula.
2. **Do NOT drop the existing Warm-up or Exam-prep sections.** They stay. (Warm-up's *internal selection rule* changes because it depended on weekday→module — see §5 and Phase 4 — but the section itself remains.)
3. **All schema changes must be backward-compatible.** New `generatedSheets` array fields are **optional**; existing rows without them must still render and display. Never set an optional Id/array field to `undefined` on insert (Convex rejects it) — only spread it when present, following the existing pattern in `saveSheetForStudentImpl`.
4. **Keep the PDF renderer working** for old sheets (sheets with no revision/mistakes arrays must render exactly as before).
5. **Mobile-first UI**, dark-navy + teal accent theme (match existing components). Prefer inline accordions/filters over drill-down navigation.
6. **Typecheck both layers:** root `npx tsc --noEmit -p tsconfig.json` (frontend) AND `npx convex codegen` (backend — root tsc skips `convex/`). Both must pass before each commit.
7. **One phase per commit**, message `feat(redesign-PX): <summary>`. Report after each phase.

---

## 4. Architecture & the shared contract

The redesign has two halves that meet at **one interface**:
- **The Teaching Path** (Phases 1–2): the teacher's chosen order of units, stored per (grade, term).
- **The Sheet Brain** (Phases 3–7): generation reads the path to drive the Main block.

**The single agreed interface** (build it exactly like this in Phase 1; everything else consumes it):

```ts
// convex/learningEngine/path.ts
// READ — used by the planner (Phase 4)
getTeachingPath({ grade: number, term: number })
  => { orderedUnitIds: string[] } | null   // null = no custom order saved; caller falls back to natural curriculum order

// WRITE — used by the editor (Phase 2)
setTeachingPath({ grade: number, term: number, orderedUnitIds: string[] })
  => { ok: true }

// READ — card metadata for the editor (Phase 2)
listPathUnitsWithPriority({ grade: number, term: number })
  => Array<{ unitId, unitName, conceptCount, examPriority /* 0..1, summed conceptImportance */, marks /* sum marksAvailable if available, else null */ }>
  // returned already sorted by saved path order (or natural order if none saved)
```

---

## 5. The new printed sheet structure (FIVE sections)

Each section has ONE distinct, weekday-independent job:

| # | Section | Job | Selection rule (high level) |
|---|---------|-----|------------------------------|
| 1 | **Warm-up** | Quick confidence opener | 1–2 easy questions on already-strong concepts (`mastery ≥ MASTERY_THRESHOLD`), any unit, low difficulty |
| 2 | **Main block** | The new lesson | Next 1–2 **not-yet-introduced** concepts on the student's **path**, prereqs satisfied |
| 3 | **Revision** | Spaced repetition ("never forget") | Introduced concepts that are **due** (R decayed / overdue), interleaved across all units, ranked by urgency × importance |
| 4 | **Mistakes** | Error recovery | Concepts whose most recent attempt was wrong (`lastResponse === "again"`) |
| 5 | **Exam-prep** | Exam simulation | Past-paper questions on mastered concepts (existing rule, unchanged); grows near exams |

**Print order on the sheet:** Warm-up → Main block → Revision → Mistakes → Exam-prep.
**Fill order in the planner** (most-constrained first, sharing one `seen` dedupe set so no question repeats across sections): Main block → Exam-prep → Mistakes → Revision → Warm-up.

> **Note for the human reviewer:** Warm-up and Revision are both spaced-repetition flavored. They are kept distinct: Warm-up = tiny easy confidence opener; Revision = the substantial due-for-review body. Confirm this split at review; it's the cleanest way to honor "keep Warm-up" while removing the weekday rule.

---

## 6. Phases

### Phase 1 — Teaching Path: data model + API (the foundation)

**Files to read first:** `convex/schema.ts`, `src/lib/curriculum-data.ts`, `convex/learningEngine/derivedConcepts.ts`, and wherever `conceptImportance` is queried (search `conceptImportance`).

**Schema diff** (`convex/schema.ts`):
```ts
teachingPath: defineTable({
  grade: v.number(),                 // 6..11
  term: v.number(),                  // 1 | 2 | 3
  orderedUnitIds: v.array(v.string()),
  updatedAt: v.number(),
  updatedByTeacherId: v.optional(v.id("teachers")),
}).index("by_grade_term", ["grade", "term"]);
```

**Algorithm** (`convex/learningEngine/path.ts`, new file):
```
getTeachingPath(grade, term):
  row = teachingPath.by_grade_term(grade, term).unique()
  return row ? { orderedUnitIds: row.orderedUnitIds } : null

setTeachingPath(grade, term, orderedUnitIds):
  validate every id is a real unit in (grade, term) via curriculum-data  # ignore unknown ids
  upsert teachingPath row, updatedAt = now, updatedByTeacherId = resolveTeacherId(ctx)

listPathUnitsWithPriority(grade, term):
  units = curriculum-data units for (grade, term) across ALL modules
  for each unit:
    concepts = concept-type exercises in this unit
    examPriority = sum(conceptImportance.importance for those concepts)  # 0 if none
    marks = sum(marksAvailable across past-paper questions tagged to those concepts) or null
  order = getTeachingPath(grade,term)?.orderedUnitIds ?? natural curriculum order
  return units sorted by `order` (unknown/new units appended in natural order)
```

**Edge cases:**
- No saved path → return natural curriculum order. Never error.
- Saved path missing a unit that now exists (syllabus edited) → append it at the end in natural order.
- Saved path contains a unit id that no longer exists → drop it silently.
- Auth: all functions require `ctx.auth.getUserIdentity()`; return `null`/empty when unauthenticated, matching existing planner queries.

**Verification:**
- `npx convex codegen` passes. Call `setTeachingPath` then `getTeachingPath` for G7 T2 → returns the saved order. `listPathUnitsWithPriority(7,2)` returns cards with `examPriority` summing to ≈ the importance mass of that term.

---

### Phase 2 — Path editor page (Insights, mobile drag-to-reorder)

**Files to read first:** the Insights/Analytics page and its grade/term tab components (mirror their pattern, theme, and mobile behavior). Search for the analytics tabs to find them.

**Schema diff:** none.

**Algorithm / UI:**
- New page under Insights: **"Teaching Path"**.
- Tab row = grade (mirror existing insights grade tabs). Sub-tab row = term (1/2/3).
- Body = vertical list of **unit cards** from `listPathUnitsWithPriority(grade, term)`. Each card shows: unit name, concept count, **exam-priority** (a bar or % from `examPriority`), and marks if available.
- **Drag to reorder** — must work with touch on mobile (use a touch-friendly approach; e.g. `@dnd-kit` if already in the project, else long-press move handles). On drop, call `setTeachingPath(grade, term, newOrder)`.
- Show a subtle "saved" confirmation. The order is the teacher's; exam-priority is shown only as a *hint* — do not auto-sort by it.

**Edge cases:**
- Empty term (no units) → friendly empty state.
- Save failure → toast error, revert optimistic order.
- Reorder is per (grade, term) only — switching tabs loads that pair's order.

**Verification:**
- On a phone-width viewport, drag a low-priority unit above a high-priority one, reload → order persisted. `getTeachingPath` reflects it.

---

### Phase 3 — Sheet sections data model + plumbing (add Revision & Mistakes everywhere, rendering EMPTY)

> Do this BEFORE the selection algorithm so the data shape exists end-to-end and nothing breaks. After this phase the two new sections exist but are always empty — the app must behave exactly as today.

**Files to touch (search each for the existing triplet `warmupQuestionIds` / `mainQuestionIds` / `examPrepQuestionIds` and extend EVERY occurrence):**
`convex/schema.ts`, `convex/learningEngine/planner.ts`, `convex/learningEngine/pdfHelpers.ts`, `convex/learningEngine/pdf.ts`, `src/components/sheets/inspector-body.tsx`, `src/components/algorithm/sheet-preview.tsx`, `src/components/sheets/shared.ts`, and any summary/count helper.

**Schema diff** (`generatedSheets`, both optional for back-compat):
```ts
revisionQuestionIds: v.optional(v.array(v.id("questionBank"))),
mistakesQuestionIds: v.optional(v.array(v.id("questionBank"))),
```

**Algorithm / plumbing:**
- Treat missing arrays as `[]` everywhere you read them (`sheet.revisionQuestionIds ?? []`).
- `planSheetCore` return shape: add `revision: []`, `mistakes: []` (filled in Phase 5).
- `saveSheetForStudentImpl`: write the two arrays (only spread when non-empty? — arrays are fine to always write as `[]`; but to match the existing no-undefined rule, write `[]` not `undefined`). Include them in `scoringSnapshot` slots (`"revision" | "mistakes"`).
- `overrideSheet`: extend `slotName` validation + field mapping to accept `"revision"` and `"mistakes"`. Extend the cross-slot duplicate check to scan all five arrays.
- Novelty cooldown usage counting (`buildCandidatePool`): the loop that bumps usage over recent sheets must also iterate `revisionQuestionIds` and `mistakesQuestionIds`.
- `pdfHelpers.getSheetForRender` / `RenderSheetData`: add `revision`/`mistakes` question lists; include their ids in the integrity `allIds` scan.
- `pdf.buildPDF`: resolve + render two new sections with banners `"REVISION · Spaced repetition"` and `"MISTAKES · Fix & re-test"`, in the print order from §5. Continuous question numbering across all five.
- `inspector-body.tsx` + `sheet-preview.tsx`: render the two new sections (mirror existing `SlotSection`/`Section`), add to `SECTION_TITLES`, `allQIds`, counts, and any `warmup+main+examPrep` sum.

**Edge cases:**
- Old sheet (no new arrays) → renders identically to today; new sections simply absent.
- A question must never appear in two sections (the planner's shared `seen` set guarantees this from Phase 5; the override "add" path must also reject cross-section duplicates).

**Verification:**
- Regenerate + render an existing student's sheet → identical output to before this phase (two new sections empty/absent). Typecheck both layers. Edit drawer opens without error and shows the two new (empty) sections.

---

### Phase 4 — Path-driven Main block + redefined Warm-up (remove weekday→module)

**Files:** `convex/learningEngine/planner.ts`, `convex/learningEngine/config.ts`, `convex/learningEngine/path.ts`.

**Schema diff:** none.

**Algorithm** (replace the Main-block and Warm-up slot logic in `planSheetCore`; keep Exam-prep as-is):
```
# --- MAIN BLOCK: next new concepts on the path ---
inScopeUnits = unitIdsForScope(gradeByModule)            # existing helper
# rank units by (term asc, then teaching-path order for that unit's grade/term)
for unit in inScopeUnits: rank = indexInTeachingPath(unit) ?? naturalOrderIndex(unit)
orderedUnits = inScopeUnits sorted by (term, rank)

newConcepts = []
for unit in orderedUnits:
  for concept in conceptsOfUnit(unit) in natural order:
    if memoryState exists for (student, concept):   continue   # already introduced
    if concept.prereqGap:                            continue   # prereqs not met
    newConcepts.push(concept)
    if newConcepts.length >= MAIN_NEW_CONCEPTS:      break-all
mainCandidates = scored candidates whose concept ∈ newConcepts   # reuse existing scored pool
mainPicked = pickInterleaved(mainCandidates, mainBudget.timeMin, mainBudget.qCap, seen)
# prefer easier questions for brand-new concepts (difficulty fit already handles this since mastery≈0 → skill≈1)

# Fallback if no new concepts left (student has been introduced to everything in scope):
#   deepen — pick harder questions on the least-mastered introduced concepts. Record underFillReason "main-fallback-deepen".

# --- WARM-UP redefined (NO module-of-day) ---
warmupCandidates = scored candidates where concept.mastery >= MASTERY_THRESHOLD   # confidence
warmupPicked = pickInterleaved(warmupCandidates, warmupBudget.timeMin, warmupBudget.qCap, seen)
# fallback: any introduced concept, easiest available.
```
- Add `MAIN_NEW_CONCEPTS` to config (default `2`; Phase 6 makes it session-length-aware).
- **Delete the `todayModule`-based main/warm-up filtering.** `moduleForDateStr` may stay only if still used by the exam-week branch / header; otherwise remove. Exam-prep slot logic is unchanged.
- Keep the existing exam-week override behavior intact (it already collapses module boundaries).

**Edge cases:**
- Student brand-new (no memoryState anywhere) → every path concept is "new"; Main block fills from the top of the path; Warm-up/Revision/Mistakes likely empty → reallocate their time to Main (see Phase 6 budgeting) or ship shorter; record underfill reasons.
- A unit's concepts all prereq-gapped → skip the unit, move to next on path (do not stall).
- No teaching path saved for the (grade, term) → natural curriculum order (still works).

**Verification:**
- A mid-progress student on a non-exam day: Main block contains the next un-introduced concept(s) from the top unsatisfied unit of their saved path — NOT whatever the weekday's module used to be. Reorder the path → regenerate → Main block topic changes accordingly.

---

### Phase 5 — Revision + Mistakes selection

**Files:** `convex/learningEngine/planner.ts`, `convex/learningEngine/config.ts`, `convex/learningEngine/mastery.ts` (read only).

**Schema diff:** none.

**Algorithm** (fill order: Main → Exam-prep → Mistakes → Revision → Warm-up, shared `seen`):
```
# --- MISTAKES ---
mistakeConcepts = memoryState(student) where lastResponse == "again"   # most recent attempt wrong
mistakesCandidates = scored candidates whose concept ∈ mistakeConcepts
mistakesPicked = pickInterleaved(mistakesCandidates, mistakesBudget.timeMin, mistakesBudget.qCap, seen)

# --- REVISION (the forgetting-curve engine) ---
introduced = memoryState(student) where attemptCount > 0
due = introduced where R < REVISION_DUE_R  OR  overdueDays(...) > 0     # about to be forgotten
revisionCandidates = scored candidates whose concept ∈ due
  # rank by existing baseScore (urgency × importance already inside it). Interleave across units.
revisionPicked = pickInterleaved(revisionCandidates, revisionBudget.timeMin, revisionBudget.qCap, seen)
# fallback: introduced concepts with lowest R, even if not strictly "due".
```
- Add `REVISION_DUE_R` to config (default `0.7`).
- Reuse `overdueDays` and the scored pool already computed in `planSheetCore`. Do not recompute scores.

**Edge cases:**
- No mistakes → Mistakes empty; its time budget flows to Revision.
- Nothing due → Revision uses the lowest-R fallback so the section is rarely empty for an active student.
- A concept that is both a mistake and due → Mistakes wins (filled first); `seen` prevents duplication in Revision.

**Verification:**
- Seed a student with one concept whose last response was "again" and one introduced concept with low R. Generate → the wrong concept appears in Mistakes, the low-R concept in Revision, no overlap with Main.

---

### Phase 6 — Session-length awareness + time budgeting

**Files to read first:** `convex/schema.ts` (`scheduleSlots` — find whether a session has start/end times or a duration), `src/components/session/sheets-tab.tsx` (how `slotId` is passed into generation).

**Schema diff:** if no per-session duration exists, add `sessionMinutes: v.optional(v.number())` to the appropriate slot/session table (confirm with the human which table). Otherwise derive minutes from start/end.

**Algorithm:**
- `saveSheetForStudent` already receives `slotId`. Resolve the session's planned length (minutes). Pass it into `planSheetCore` as the time budget with precedence: **explicit session length > student `sessionMinutesOverride` > auto-tuned/default**.
- Extend the phase-of-term ratio tables in `config.ts` from 3 keys to **5** (`warmup, main, revision, mistakes, examPrep`, each summing to 1.0). Suggested defaults (tune later):
  - Default (no exam): `0.10 / 0.45 / 0.25 / 0.10 / 0.10`
  - Early term: `0.05 / 0.60 / 0.20 / 0.10 / 0.05`
  - Late term: `0.10 / 0.35 / 0.30 / 0.10 / 0.15`
  - Exam week: `0.05 / 0.15 / 0.30 / 0.15 / 0.35`
- `MAIN_NEW_CONCEPTS` scales with session length: `clamp(round(sessionMinutes / MINUTES_PER_NEW_CONCEPT), 1, 3)` with `MINUTES_PER_NEW_CONCEPT` default `50`.
- Keep the existing completion-based auto-tuner as a multiplier on the resolved budget.
- If a section's candidate pool is thin, its unused time reallocates to the next fill section (carry leftover `timeMin`).

**Edge cases:**
- 1-hour vs 2-hour session for the same student → 2-hour sheet has more questions and may introduce 2 new concepts vs 1.
- Missing session length → fall back to existing default budget (no regression).

**Verification:**
- Same student, two sessions of different lengths → longer session yields a longer sheet and (if budget allows) more new concepts. Ratios across five sections match the phase table.

---

### Phase 7 — Teaching-time maturity (minimal now, matures later)

**Schema diff:** optional, lightweight:
```ts
// Per-unit teacher estimate of how many new concepts fit per session-hour.
unitPacing: defineTable({
  grade: v.number(), term: v.number(), unitId: v.string(),
  conceptsPerHour: v.number(),   // teacher-set; defaults applied when absent
  updatedAt: v.number(),
}).index("by_grade_term_unit", ["grade","term","unitId"]);
```

**Algorithm:**
- Phase 6's `MAIN_NEW_CONCEPTS` uses `unitPacing.conceptsPerHour` for the current unit when set, else the global default.
- Surface a simple editor (can live on the Path card from Phase 2: a small numeric stepper per unit).
- **Auto-maturation is explicitly out of scope for now** — leave a clearly-commented hook (`// TODO(maturity): adjust conceptsPerHour from observed session completion`) and stop. Do not build the learning loop yet.

**Edge cases:** none beyond defaults-when-absent.

**Verification:** set a unit to `1` concept/hour → main block introduces 1 even in a 2-hour session; set to `2` → introduces 2.

---

## 7. Cross-phase verification (run after Phase 6)

1. Save a custom path for a real student's (grade, term); reorder a high-marks unit to the top.
2. Generate that student's sheet for a normal day → Main block = next un-introduced concept(s) from the top path unit; Warm-up = easy strong concepts; Revision = due concepts across units; Mistakes = last-wrong concepts; Exam-prep unchanged.
3. Render the PDF → five labeled sections, continuous numbering, no duplicate questions.
4. Open the Edit drawer → all five sections editable; swap/remove/add work on the new sections.
5. Regenerate for a 1-hour vs 2-hour session → sheet length and new-concept count differ.
6. An old pre-redesign sheet still renders correctly.
7. Both typechecks pass (`tsc` + `convex codegen`).

---

## 8. Execution protocol

- Work strictly phase 1 → 7, in order.
- After each phase: run both typechecks, run that phase's Verification, commit `feat(redesign-PX): …`, and report what you did + anything you changed from this spec + open questions.
- If a phase reveals a missing decision (e.g. which table holds session length, or whether to keep `moduleForDateStr` for the header), **stop and ask the human** — do not guess on schema-shaping decisions.
- Do not refactor unrelated code. Do not touch the scoring engine. Keep changes additive and backward-compatible.

---

## 9. The summary to hand back to the orchestrator

When all phases are done (or you stop early), produce a concise **HANDOFF SUMMARY** with exactly:
1. **New tables + fields** created (names, fields, indexes) — especially `teachingPath`, the two `generatedSheets` arrays, `unitPacing`.
2. **New/changed function names + signatures** — especially `getTeachingPath`, `setTeachingPath`, `listPathUnitsWithPriority`, and the changed `planSheetCore` return shape.
3. **Files changed, per phase.**
4. **Anything you deviated from in this spec, and why.**
5. **Open questions / things the orchestrator should review** (e.g. the Warm-up vs Revision split in §5, the chosen session-length source, the ratio defaults).

The orchestrator will review against this spec and tell the human whether it was built as intended or needs changes.
```

---

### Appendix: decisions already locked by the founder (do not re-litigate)
- Main block topic is **engine-picked from a teacher-curated path, with manual override** — not weekday, not fully automatic.
- Path ordering is at the **unit** level (not individual concepts) for now.
- **Keep** Warm-up, Main block, Exam-prep; **add** Revision + Mistakes. Nothing existing is dropped.
- Leave the **scoring engine untouched**.
- Phases G (predicted grade) and H (scale) of `algorithm_plan.md` are **not built yet** and are out of scope here.
