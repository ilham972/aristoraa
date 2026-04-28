# Plan: Aristora — Personalized Learning Engine (SR + AR + Interleaving)

> **For a fresh Claude session:** read this file top-to-bottom before touching any code. It captures the full pedagogical pivot, every user decision made during planning, the exact codebase state, what has shipped, what is next, and the open questions. When you finish reading this, you should be able to continue the build without asking the user to re-explain context.

---

## 0. Source documents to read first

Read in this order, then come back to this file:

1. **This file** — strategic pivot, phase plan, and current state.
2. **`new_change.md`** (this repo root) — the earlier Lead-dashboard / doubt-queue / student-tablet plan. Context for the operational layer this engine sits on top of.
3. **`app_prompt.md`** (repo root) — original full app spec. Note: Score Entry section there is commented out because workflow changed (see `new_change.md`).
4. **`business_strategy.txt`** (repo root) — "Factory Model" 4-role business plan. Team has since shrunk to 2 (Lead + Correction Officer) per `new_change.md`.
5. **`curriculum context.md`** (repo root) — raw curriculum JSON reference. **Do NOT re-read unless needed** — it's embedded as seed data.
6. **User memory** at `C:\Users\Ilham\.claude\projects\C--Users-Ilham-aaa-projects-math-tracker\memory\`:
   - `MEMORY.md` (index)
   - `project_learning_engine.md` — condensed strategic pivot (reinforces this plan)
   - `project_math_tracker.md` — general app overview (may be slightly stale)
   - `feedback_ux_navigation.md` — prefer inline filters over deep drill-down
   - `feedback_theme_preference.md` — dark navy + teal, transit-app inspired

---

## 1. Business context (one paragraph)

The user (Ilham, brand **Aristora**) runs a math tuition business in Sri Lanka for Grade 6–11 students on the Sri Lankan Tamil-medium government syllabus. 6 modules, one per weekday (M1 Mon – M6 Sat; Sun off). Each student has independent progress per module. The existing app is a progress tracker + leaderboard + Lead-dashboard (operational layer). This plan adds the **learning engine on top** — spaced repetition, active recall, interleaving — with per-student personalized practice sheets and cumulative term exam validation. The user's goal: no other tuition in Sri Lanka can match the retention + exam outcomes this system produces.

---

## 2. The strategic pivot — why we are building this

The current app is a **tracker**, not a **learning system**. It records scores but has no standard-of-practice for *what each student should do next to maximize learning*. Today the teacher picks "next exercise" from textbook order, which is **blocked practice** — known to produce high in-session confidence and poor long-term retention.

**The pivot:** replace "next exercise" with a **per-student personalized sheet** generated nightly. Each sheet delivers all three proven methods at once:

- **Spaced repetition (SR)** — re-surface previously-learned concepts at expanding intervals, fresh instances not the same question.
- **Active recall (AR)** — retrieval under uncertainty; interleaving forces the student to first *recognize* which technique applies before solving.
- **Interleaving** — mix problem types within a single session. Research is unambiguous: blocked practice feels better, interleaved practice *is* better on delayed tests and transfer. For math, the "which technique?" skill is exactly what exams test.

The sheet is printed at the center (teacher prints before class) or sent as PDF for homework. Questions come from cropped textbook images (not OCR — Tamil encoding is unusable). The student never asks "what exercise?"; they just do today's sheet.

**Outcome target:** every student — weak and strong — shows measurable exam-performance improvement term over term, quantified by the holdout exam calibration loop (Section 5).

---

## 3. The three methods — what they mean specifically for math

| Method | What it means in math | Why it matters |
|---|---|---|
| **Active recall** | Problems where the student must first decide *which technique applies*, then solve without worked examples. | Blocked textbook exercises already reveal the technique by context. Interleaving kills that crutch. |
| **Spaced repetition** | Fresh instances of previously-learned *problem types* scheduled at expanding intervals, recalibrated per student response. Not flashcards — a tagged problem bank is required so a "fresh" instance exists. | Cumulative exams (see Section 5) punish forgetting across terms; SR is the only systematic defense. |
| **Interleaving** | Mixed problem types within a single sheet. Student must pattern-match before solving. | Most math exam failures are "didn't recognize the type," not "couldn't execute the technique." |

These three only work together. Spaced repetition alone is weak in math because repetition without fresh instances = memorizing answers. Interleaving alone doesn't build retention across long gaps. Together they are multiplicative.

---

## 4. The core architectural shift

**Before:** a student's state is a pointer — `studentModulePositions` says "Rahul is on Ex 3.1 of Grade 7 Algebra Unit 10."

**After:** a student's state is a **mastery distribution over concepts**:
```
Rahul's mastery — fractions: 0.82, linear equations: 0.41,
factoring: 0.12, percentages: 0.67, ... ~80 concepts total.
Last practiced fractions 4 days ago (due for review).
Prerequisite gap blocks quadratic factoring (needs factoring ≥ 0.7).
```

Every consequence flows from this: the sheet generator, Lead dashboard views, parent reports, leaderboard design. `studentModulePositions` becomes a *derived* view, not source of truth.

**"Concept" definition (this is critical — we got this wrong once and corrected it):**
A concept IS the existing `exercises` row where `type === "concept"` (the theory chunk already inline in each unit's timeline, already has name + page range + videoUrl + conceptSummary). **Do NOT create a parallel `concepts` table.** Questions from the question bank reference concept-type exercise rows via the `questionConcepts` join table. Prerequisites live on `exercises.prerequisiteExerciseIds` for concept-type rows only (can cross units/books).

---

## 5. Sri Lankan exam structure = cumulative (load-bearing for the design)

Each grade has 3 term exams:
- **Term 1 exam** tests only Term 1 units of that grade.
- **Term 2 exam** tests Term 1 + Term 2 units (cumulative).
- **Term 3 exam** tests all three terms (full year).

**Why this is the perfect testing ground:** traditional tuition fails at Term 2/3 because Term 1 material fades. SR is designed to prevent exactly this. The system's biggest advantage shows in Term 3, where full-year retention is what's tested.

### Practice budget shifts through the year

Algorithm reads (current date, student grade, exam calendar) and auto-computes the mix:

| Phase | New acquisition | Prior-term SR | Mixed exam-prep |
|---|---|---|---|
| Early Term 1 | ~90% | ~0% | ~10% (past-grade if downgraded) |
| Late Term 1 | ~75% | ~15% (within-term) | ~10% |
| Early Term 2 | ~60% Term 2 new | ~35% Term 1 review | ~5% |
| Late Term 2 | ~50% Term 2 new | ~30% Term 1 review | ~20% mixed past-paper |
| Early Term 3 | ~50% Term 3 new | ~20% T2 + ~20% T1 review | ~10% |
| Late Term 3 | ~25% Term 3 new | ~60% comprehensive review | ~15% full-paper simulation |

### SR interval has an exam-date backstop

Standard SM-2 expansion (1d, 3d, 7d, 16d, 35d…) is for general retention. Ours must clip: if next natural interval would push review past `(exam date − 21 days)`, land the review *inside* that window. Guarantees every concept is freshly cycled before its relevant exam.

### Holdout validation loop (user specifically asked for this)

**Training signal:** syllabus units + concept graph + student practice responses + **OLD term papers (3+ years old, or other schools')** — these old papers can be tagged with concepts to give the algorithm an *emphasis prior* (which concepts examiners weight how much).

**Holdout:** the **current term's paper** the student is about to sit. **NEVER fed to the algorithm, never seen by any teacher interacting with the system during prep.**

**Feedback loop:** after the exam:
1. Per concept: predicted mastery vs. actual exam score on that concept's questions.
2. Build calibration plot (scatter on diagonal = calibrated).
3. Tune SR weights, difficulty progressions, concept emphasis for next term.
4. After the exam, that paper joins the "old" pool for next year's training.

**Each term = one experiment.** Term 1 is baseline, Term 2 applies first tune, Term 3 measures long retention. By Term 4–5 the system is genuinely calibrated. Patience: first 4–6 months will *look* mediocre before the feedback loop's effect is visible.

### Parent-facing story (huge business differentiator)

> "System predicted Rahul 74% in algebra. Actual: 71%. Geometry predicted 62%, actual 58%. Overall within 5 points. Adjusted his schedule — more logarithms, less basic arithmetic for next term."

No other tuition in Sri Lanka can say this. That's the moat.

---

## 6. Weekday module schedule — hybridize, don't abandon

**User initially asked:** should we abandon "Tuesday = algebra" now that we're doing SR + interleaving?

**Decision:** NO. Keep the weekday module as the main-block anchor, but **every daily sheet has 3 strips**:

| Strip | Size | Content | Purpose |
|---|---|---|---|
| Warm-up | 2–3 Qs | Cross-module SR — any concept overdue for review | Daily SR across all 6 modules; kills the "7-day gap" retention problem |
| Main block | ~70% | Today's module, interleaved across sub-types within the module | Initial acquisition + within-module discrimination |
| Exam-prep | 1–2 Qs | Mixed-module from past papers, grows as term progresses | "Which technique?" training for exam format |

Last 2 weeks before any term exam: fully mixed / full-paper simulation. Parent and student keep the "Tuesday is algebra" mental model; the engine gets the cross-module exposure it needs.

---

## 7. User decisions captured (authoritative — these answers win over anything else)

These came from explicit user answers during the brainstorm. If a fresh session sees a conflict, these answers win.

| # | Question | Answer |
|---|---|---|
| 1 | Digital question bank with answer keys? | Partially — textbook seeded with page numbers + exercise numbers. Building per-question **image cropping** mechanism in Data Entry tab (OCR unusable due to Tamil encoding). Answer keys will be added later by user. |
| 2 | Question-level or exercise-level concept tagging? | **Question-level.** More work but enables real interleaving. |
| 3 | Prerequisite graph — who builds it? | User + teacher, via UI. Per-student downgrade already exists in `students` table (`assignedGrades`, `assignedGradesByModule`) for flexible grade mixing per module. Prereq DAG lives on `exercises.prerequisiteExerciseIds` for concept-type rows. |
| 4 | Printer? | Not yet. Will buy. For now, **print before class** from a laptop. |
| 5 | Keep live theory teaching, or full video-only? | Keep partial live component — weak students need human explanation. Not 100% video. |
| 6 | Mastery threshold for "move on"? | ~0.75. Tunable. |
| 7 | Scoring — flat `N×5` (A) or difficulty-weighted (B)? | **B (difficulty-weighted).** But run both A and B in parallel for one term to de-risk before switching fully. Don't destabilize the current working motivator. |
| 8 | Validation plan / how we measure success? | **Term exam papers as CLEAN HOLDOUT.** Algorithm NEVER sees current term's paper. After exam: per-concept calibration (predicted vs. actual) drives next term's tuning. **Old papers (3+ years old or other schools') CAN be used as emphasis-weighting training signal** without corrupting the holdout. Cumulative exam structure (T1 → T1; T2 → T1+T2; T3 → full year) means Term 3 is where the system proves itself. |
| 9 | Weekday-module dedication — keep or drop? | **Keep hybridized.** Weekday module = main block. Daily sheet adds cross-module warm-up strip + exam-prep strip. |
| 10 | Build sequencing? | Phase 0 → A → B → C (see Section 10). Claude phases; user commits phase by phase. |
| 11 | Mid-year joiners? | Lead-configurable policy per student: catch-up mode vs. partial-scope. Not auto. |

---

## 8. Edge cases the design must handle

| Edge case | Mechanism |
|---|---|
| Concept needs video watched before questions | Generator emits a `WATCH` row for new concepts with `videoUrl` + mastery=0. Practice problems gated. If student lies and fails first problem, next sheet re-surfaces the video as remediation. |
| Student hasn't finished a single unit | Unit completion stops being a gate. Student can have 40% mastery on 10 concepts across 4 units — system spirals back. This is actually how real learning works. |
| Weak vs. strong student | Same algorithm, different knob settings. Weak: 5-Q sheet, 50% review, low difficulty. Strong: 12-Q sheet, 20% review, high difficulty. |
| Prerequisite gap (G10 topic, G8 gap) | Prerequisite graph blocks the G10 topic. Emits "prerequisite gap detected" — Lead sees it, assigns the G8 remediation explicitly. Existing per-student downgrade (`students.assignedGradesByModule`) already supports this. |
| Printer jams / offline | Generate night before. Morning: pre-printed stack. Student absent → sheet recycles tomorrow. |
| Question density per concept | Textbook alone ~2–3 Qs per concept = not enough for SR. Fill with past exam papers (user has these). Templates/variants later. Coverage dashboard (sub-phase 0.6) shows concepts with < 5 questions. |
| Home sheets | PDF via WhatsApp or through student tablet app. Not blocking MVP. |
| "Retention debt" (student carries unlearned T1 concepts into T2, T3) | Lead dashboard surfaces per-student "N Term-1 concepts below threshold → X marks at risk in next exam." Triggers remediation *before* exam week. |
| Past-paper freshness | Current term's paper = holdout, never seen. Old papers → training for emphasis. After exam, paper joins the old pool. |

---

## 9. Data model — what exists, what was added, what is still to come

### Existing tables (already in `convex/schema.ts`)

- `students` — incl. `assignedGrades[]` and `assignedGradesByModule` (per-module grade downgrade)
- `exercises` — has `type: "exercise" | "concept"`, `pageNumber`, `pageNumberEnd`, `subQuestions`, `videoUrl`, `conceptSummary`
- `entries` — score entries; `questions` shape = `Record<string, 'correct' | 'wrong' | 'skipped' | 'unmarked'>` with keys like `"1"`, `"3.a"`, `"5.iii"`
- `textbooks`, `unitMetadata`, `textbookPages` (with `storageId: Id<"_storage">`) — page-image infrastructure already exists and is usable for cropping
- `doubts`, `currentAssignments` — from Lead-dashboard phase
- `teachers` (role: admin/teacher/lead/correction), `scheduleSlots`, `slotStudents`, `slotTeachers`, `attendance`, `rooms`, `centers`, `sessionSubmissions`, `studentModulePositions`

### Added in this session (Phase 0.1 + 0.2 — already shipped, already pushed)

- `exercises.prerequisiteExerciseIds?: Id<"exercises">[]` — prerequisite DAG on concept-type rows
- `questionBank` table — one row per cropped question image:
  ```
  source: string ("textbook" | "past-paper" | "teacher-authored")
  textbookPageId?: Id<"textbookPages">
  cropBox?: { x, y, w, h }  // normalized 0–1 coordinates
  difficulty?: number        // 1–5
  answerKey?: string
  expectedTimeMin?: number
  linkedExerciseId?: Id<"exercises">
  linkedQuestionKey?: string  // "1", "3.a", "5.iii"
  createdAt: number
  ```
  Indexes: `by_source`, `by_textbook_page`, `by_linked_exercise`
- `questionConcepts` join table (Convex cannot index array members):
  ```
  questionId: Id<"questionBank">
  conceptExerciseId: Id<"exercises">  // points at concept-type exercise row
  ```
  Indexes: `by_question`, `by_concept_exercise`

### Still to add (upcoming sub-phases)

- **Past-paper tables** (sub-phase 0.5):
  ```
  pastPapers: { grade, term, year, totalPages, useAsTrainingSignal: boolean }
  pastPaperPages: { pastPaperId, pageNumber, storageId }
  ```
  `useAsTrainingSignal = true` for old papers (3+ years), `false` for current-term holdouts.
- **Mastery tracking** (Phase A):
  ```
  masteryByStudentConcept: {
    studentId, conceptExerciseId, mastery (0–1),
    lastAttemptAt?, nextReviewAt?, intervalDays?,
    attemptCount, correctCount
  }
  ```
  Indexes: `by_student`, `by_student_concept`, `by_next_review`.
- **Per-concept calibration** (Phase A/B boundary): table logging per-exam per-concept (predicted, actual) pairs for tuning dashboards.
- **Per-student sheet records** (Phase B): `generatedSheets` keyed by (studentId, date) with the list of questionBank IDs used, for audit + printing.

---

## 10. Phase plan — where we are, what is next

### Phase 0 — Data foundation for the learning engine

| Sub-phase | Scope | Status |
|---|---|---|
| 0.1 | Schema: `questionBank`, `questionConcepts(conceptExerciseId)`, `exercises.prerequisiteExerciseIds`. Note: an earlier attempt created a parallel `concepts` table — **REVERTED**, do not recreate. | ✅ shipped + pushed |
| 0.2 | **"Concepts" subtab** (4th tab) in Data Entry, alongside Exercises / Page Nos / Details. Per-book, per-unit drawer. Inline edits for concept name, page range, video URL, summary, and prerequisites. Prereq picker searches concept-type rows across ALL books with M·G·T context tags. Completion heuristic: unit is done when ≥1 concept exists AND every concept has `videoUrl` set. Mutations added: `renameConcept`, `setConceptPrerequisites`. | ✅ shipped + pushed |
| **0.3** | **Question cropping UI.** Lives inside the Data Entry → Details view's existing "Pages" drawer (the right-side drawer that renders unit pages). Add a "Crop questions" mode. User draws rectangles over a rendered page image; each rectangle becomes a `questionBank` row with normalized `cropBox` + `textbookPageId` + `linkedExerciseId` + `linkedQuestionKey`. Use normalized (0–1) coords so crops survive re-render at any size. Later (not 0.3 scope): auto-suggest boundaries via horizontal-whitespace detection. | 🔜 **NEXT** |
| 0.4 | Question tagging UI. After crop, pick the cropped question → assign `conceptExerciseIds` (multi-select; reuse the prereq picker pattern from 0.2), `difficulty` (1–5), `answerKey` (optional text), `linkedExerciseId` + `linkedQuestionKey` (prefill from crop context). `questionConcepts` rows inserted/deleted as user toggles. | — |
| 0.5 | `pastPapers` + `pastPaperPages` tables. Same cropping + tagging flow as textbook, with term/year/grade metadata and `useAsTrainingSignal` boolean. UI: new section or subtab near Data Entry for past-paper management. | — |
| 0.6 | Coverage dashboard. Per concept: count of questions at each difficulty level. Flag concepts with < 5 tagged questions. Per module/grade rollup. Shows gaps before Phase A starts. | — |

### Phase A — Mastery tracking + SR scheduling (4–6 weeks after Phase 0)

- `masteryByStudentConcept` table + update logic (BKT-lite or rolling average weighted by difficulty).
- SR scheduler: SM-2-ish with exam-date backstop.
- "Today's plan" view on Lead dashboard that auto-proposes: 1 review exercise + 1 new exercise per student — **using existing exercise-assignment flow**, no PDFs yet.
- **Validation target for Phase A**: re-assign a previously-done concept 2 weeks later, compare correct rate vs. baseline. Does retention improve? If yes, proceed to Phase B. If no, tune before moving on.

### Phase B — Sheets + interleaving (4–6 weeks)

- Sheet generator algorithm (3-strip daily template from Section 6).
- PDF export + printer path.
- Student-tablet home screen shows today's sheet (reuses Phase 4 of `new_change.md`'s student app work).
- Interleaving within main block.
- Per-student mastery visualization for parents.

### Phase C — Scale & polish (4–8 weeks)

- Per-concept calibration dashboard (predicted vs. actual, term-over-term).
- Difficulty auto-calibration from response distributions (Elo-ish).
- Mastery-based leaderboard (alongside existing daily-points leaderboard, not replacing).
- Franchise SOP docs.
- Switch off parallel scoring A if B wins the term.

### Target launch cadence

User confirmed: start build backward from **next Term 1 start date** on Sri Lankan academic calendar. Term 1 is a clean baseline, Term 2 first calibration, Term 3 retention test. Mid-year starts are messy — avoid.

---

## 11. Exact current codebase state (post push `3bdbbde`)

### Tech stack (unchanged)

- Next.js 16 App Router · TypeScript (strict, bundler) · Convex 1.33 · Clerk 7 (username+password, no Gmail)
- shadcn/ui · Tailwind v4 · dark navy + teal · mobile-first
- Clerk instance: `topical-chicken-36.clerk.accounts.dev`

### Key files (what is what)

**Backend (`convex/`)**
- `schema.ts` — all tables incl. Phase 0.1 additions
- `exercises.ts` — CRUD + `addConcept`, `setConceptVideo`, `renameConcept`, `setConceptPrerequisites`
- `doubts.ts`, `currentAssignments.ts`, `lead.ts`, `timeline.ts`, `entries.ts`, `teachers.ts`, `students.ts`, `attendance.ts`, etc.
- `textbookPages.ts` — has `getPagesInRange` + storage URL resolver; page-image infrastructure ready for cropping
- `_generated/api.d.ts` — regenerates on `npx convex dev`

**Frontend (`src/app/` + `src/components/`)**
- `src/app/settings/page.tsx` — tabs: General, Centers, Schedule, Teachers, Content, Curriculum, Data Entry
- `src/components/settings/data-entry-tab.tsx` — 4 subtabs now (Exercises, Page Nos, Details, **Concepts**). Layer type is `'exercises' | 'pages' | 'details' | 'concepts'`.
- `src/components/settings/concepts-unit-drawer.tsx` (NEW this session) — the Concepts subtab drawer. Has prereq picker with cross-book search.
- `src/lib/curriculum-data.ts` — `findUnit(unitId)` returns `{ module, grade, term, unit }` (used by prereq picker)
- `src/lib/types.ts` — `MODULE_COLORS` and `getTodayDateStr()`
- `src/app/lead/page.tsx` — Lead dashboard (Phase 3 of new_change.md — already shipped)

### What was intentionally NOT committed (user's working docs)

- `.claude/settings.local.json`, `app_prompt.md`, `new_change.md`, `business_strategy.txt`, `curriculum context.md`, `convesation_about_engine.md`

### Things to AVOID (lessons learned this session)

1. **Do not create a parallel `concepts` table.** Concept = existing `exercises.type === "concept"` row. The user called this out explicitly and we reverted. It's in memory (`project_learning_engine.md`) and in this plan — don't forget.
2. **Do not plan any OCR path.** Tamil encoding in the textbook makes OCR unusable. Cropped images only.
3. **Do not touch the daily-scoring formula (`N × 5`) yet.** The user chose difficulty-weighted (B) but wants to run both in parallel for one term before switching.
4. **Do not abandon the weekday module schedule.** Hybridize per Section 6, don't replace.
5. **Do not feed current term's exam paper into the algorithm.** Strict holdout. Old papers only for training.

---

## 12. How to continue — exact next action for a fresh session

1. Read this file fully.
2. Read `new_change.md` for operational-layer context (Lead dashboard, doubt queue, student app).
3. Skim `project_learning_engine.md` in user memory.
4. Do NOT re-read `curriculum context.md` unless you need to answer a specific unit-structure question.
5. Confirm git state:
   ```
   git log -3 --oneline   → should include "feat(data-entry): concepts subtab..."
   ```
6. Ensure `npx convex dev` has been run at least once so `_generated/api.d.ts` has the new Phase 0.1 tables. (If running the user's machine, you will not run this yourself — ask them to confirm.)
7. **Next sub-phase is 0.3 — question cropping UI.** See Section 10 for scope. Implementation plan:
   - Add a "Crop questions" mode toggle inside the existing Pages drawer in `data-entry-tab.tsx` (the drawer already shows page images with `p.NN` badges).
   - When mode is on: overlay a rectangle-drawing canvas on each page image. User drags to draw, releases to confirm, sees a small form inline to pick `linkedExerciseId` + `linkedQuestionKey` (the exercise + question this crop represents).
   - Save as a `questionBank` row with `source: "textbook"`, `textbookPageId`, normalized `cropBox`.
   - Each saved crop shows as a labeled outline on subsequent views (persistent).
   - Delete/re-crop support.
   - Backend: add `convex/questionBank.ts` with `create`, `listByPage`, `update`, `remove` mutations/queries. Auth via `ctx.auth.getUserIdentity()` (existing pattern — see `convex/doubts.ts` or `convex/exercises.ts`).
   - TypeScript must typecheck (`npx tsc --noEmit -p tsconfig.json`) before declaring done.
   - Tagging (concepts/difficulty/answerKey) stays separate — that's sub-phase 0.4, not 0.3.
8. **Ship phase by phase.** User's pattern: one small sub-phase per conversation chunk, typecheck clean, then push. Ask before moving to the next sub-phase.

---

## 13. Conversation style expectations

From observing this session's exchange:

- User is deeply engaged; wants concrete, honest pushback when they're wrong, not sycophancy.
- User will correct you when you drift — accept the correction cleanly, revert, don't defend the wrong path.
- User appreciates "here's what I'd do differently" framings over "whatever you want."
- Responses should be tight but thorough on strategic questions. On code execution, be brief — ship, verify, report.
- Never add emojis to files or code unless asked.
- Mobile-first UI always. Tamil unit names, everything else English.
- Module colors: M1 `#1B4F72`, M2 `#6C3483`, M3 `#1E8449`, M4 `#B9770E`, M5 `#C0392B`, M6 `#2E86C1`.

---

## 14. Open questions not yet resolved

1. **Question bank — primary storage format.** Crops store coordinates + reference to source `textbookPageId`. Rendering later = overlay crop on source image. Alternative: pre-render and store cropped JPGs in Convex storage. Decision deferred — coords-only is simpler, rendering works fine at modest scale.
2. **Prerequisite cycle detection.** Current implementation doesn't block cycles (concept A → B → A). Add when it becomes a real problem.
3. **Mid-year joiner UI policy selector.** Needs a field on `students` or `currentAssignments` — add when Phase A lands.
4. **Sheet print layout.** Single column vs. two column? Header with name + date + today's concept mix? Design when Phase B starts.
5. **Exam calendar** — where is it stored? Needs a `examCalendar` table (grade, term, year, examDate) for the SR exam-date backstop. Add in Phase A.
6. **Student-tablet integration** from `new_change.md` — Phase 4 there maps to Phase B here. Coordinate so the student home screen pulls from `generatedSheets`, not legacy `currentAssignments`.
7. **Scoring — when to switch from A flat to B difficulty-weighted.** After one term of parallel running, decide based on engagement metrics.

These are genuinely open. Surface them to the user when the relevant phase arrives; do not invent answers.

---

## 15. Summary for the impatient

- Pivoting from tracker → learning engine. SR + AR + interleaving. Validated against Sri Lankan cumulative term exams (T1 → T1; T2 → T1+T2; T3 → full year).
- Concept = existing `exercises.type === "concept"` row. Questions tagged to concepts via join table. Prereqs on `exercises.prerequisiteExerciseIds`.
- Personalized per-student sheets (printed/PDF) replace "next exercise" pointing. 3-strip daily template.
- Holdout validation: current term's paper never fed in. After exam, calibrate per-concept, tune, repeat. Each term = one experiment.
- Phase 0 foundation in progress. 0.1 + 0.2 shipped and pushed. **Next is 0.3 — question cropping UI.**
- Don't make a parallel concepts table. Don't plan OCR. Don't break weekday modules. Don't corrupt the exam holdout.
