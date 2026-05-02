# Phase 0.5 — Past Papers (Cropping + Tagging) — Build Plan

> **Scope.** Extend the question-bank ingestion pipeline (Phase 0.3 textbook cropping is shipped) to support past exam papers as a second source. Past-paper questions feed the same `questionBank` + `questionConcepts` tables, so all downstream phases (mastery, importance, planner) are source-agnostic from day one.
>
> **References.**
> - Strategy: `learning_engine_plan.md`
> - Tactical spec: `algorithm_plan.md` § "Phase 0.5 — Past papers"
> - Existing patterns being reused: `convex/textbookPages.ts`, `convex/questionBank.ts`, `src/components/settings/content-tab.tsx`, `src/app/settings/crop/[unitId]/page.tsx`

---

## 1. Goal

Add past-paper page-image ingestion + per-question cropping + concept tagging, with the same UX patterns the user already knows from textbooks. Output is rows in `questionBank` where `source === "past-paper"`, with paper provenance (`pastPaperId`, `pastPaperPageId`, `marksAvailable`, `questionNumberInPaper`) and concept tags in `questionConcepts`. Holdout papers (current term's own paper) never feed the algorithm.

**Why this matters.** Past papers are the primary signal for the exam-blueprint importance model in Phase B and the calibration loop in Phase F. Without this layer, the planner has no notion of "what the exam will actually ask" and Phase 0.6's coverage dashboard has only textbook crops to count.

---

## 2. Architectural decisions

### 2.1 UI placement: split between Content tab and Data Entry tab (mirror the existing textbook split)

The settings page already has a clean two-tab split for textbook ingestion:

| Tab            | Responsibility                                              |
| -------------- | ----------------------------------------------------------- |
| **Content**    | Page-image ingestion (Grade → Book → Page grid, PDF upload) |
| **Data Entry** | Crop + tag questions on those pages                         |

Past papers reuse this split exactly:

| Tab            | New section                                                                              |
| -------------- | ---------------------------------------------------------------------------------------- |
| **Content**    | Top-of-tab toggle: **Textbooks \| Past Papers**. Past Papers side: Grade → Paper → Pages |
| **Data Entry** | New 5th subtab **Past Papers** (lists papers; tap to open crop route)                    |

**Rejected alternatives:**
- *Top-level Settings tab "Past Papers"* — duplicates the page-ingest vs. crop-tag separation that already exists; user has to learn two different interaction patterns.
- *Single "Page Nos" subtab merging both sources* — past papers and textbook units have different parent identities (paper has grade/term/year/school; unit has unitId/exercises). Forcing them into one list creates a confusing mixed-mode UI.

### 2.2 Crop route: new parallel route, not a generalization

New file: `src/app/settings/past-paper-crop/[paperId]/page.tsx` — parallel to the existing `src/app/settings/crop/[unitId]/page.tsx`.

**Why parallel, not generalize:**
- The textbook crop page is tightly coupled to `findUnit(unitId)` from `curriculum-data`, the per-exercise pill header, and the `upsertForExerciseKey` 1:1 invariant. None of these concepts apply to past papers (no unit, no pre-declared exercise/questionKey).
- Generalizing in-flight means rewriting a working, recently-stabilized flow (`fix(crop): enforce strict 1:1 between (exercise, key) and crop`).
- The expensive sub-components are already extracted: `PageCropOverlay`, `ZoomedPageView`, `CropToolToolbar`, `CropPillHeader`. The duplication is page-level orchestration (~200 lines), not the 700-line UI layer.
- If duplication hurts later (e.g. when teacher-authored questions arrive in Phase 0.7), refactor with both flows stable as reference.

### 2.3 Question identity: `(pastPaperId, questionNumberInPaper)` as the 1:1 key

Textbook crops use `(linkedExerciseId, linkedQuestionKey)` as the strict 1:1 key (enforced by `upsertForExerciseKey`). Past papers don't have pre-declared exercise structure, so the analogous key is:

```
unique(pastPaperId, questionNumberInPaper)
```

`questionNumberInPaper` is free-text user input ("1.a", "5.iii", "Section B Q3") entered after drawing each crop. New mutation `upsertForPaperQuestion` mirrors `upsertForExerciseKey`: insert if no match on (paperId, questionNumber), patch+dedupe if a row already exists.

Crops drawn but not yet labelled remain valid rows (with `questionNumberInPaper` undefined) — the labelling UI promotes them to "claimed" once the user types a number. This matches the textbook flow where a crop without a question key is still a row in `questionBank`.

### 2.4 Concept tagging: same `questionConcepts` join table — no schema fork

`questionConcepts` is source-agnostic by design (it points at `questionBank._id`, not at a textbook page or paper). Past-paper crops feed the same join table. Coverage queries in Phase 0.6 union both sources transparently.

The Phase 0.4 concept-tagging UI (still pending) will accept either source. We stub the entry-point now so 0.4 can be built once and serve both.

### 2.5 Holdout / training-signal logic at upload

Per algorithm_plan.md edge cases:

| Field                  | Storage                       | UI behaviour                                                                                                                                                      |
| ---------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `isHoldout`            | User-set boolean              | Default false. When true: red badge "Holdout — never feeds algorithm"                                                                                             |
| `useAsTrainingSignal`  | User-set boolean              | Default `(year ≤ currentYear − 3) \|\| (schoolName !== null)`. When `isHoldout === true`, this is **forced false and the toggle is disabled** with explanatory red text |
| `isEffectivelyOld(p)`  | Derived in code, not stored   | `today.year - p.year ≥ 3` — a query helper for any future "auto-promote old papers" use case                                                                     |

The form-level invariant `isHoldout ⇒ !useAsTrainingSignal` is enforced both in the React form (toggle disabled) and in the Convex mutation (rejects the create/update if both true).

### 2.6 Scope split: 0.5a (this session) + 0.5b (next session)

The full Phase 0.5 is too much to land in one session safely. Split:

**0.5a — Foundation + Upload**
1. Schema: `pastPapers` + `pastPaperPages`, `questionBank` extensions, `questionConcepts.weight`
2. Backend: `convex/pastPapers.ts` (paper CRUD), `convex/pastPaperPages.ts` (page ingestion mirror of `textbookPages.ts`)
3. UI: Content tab — Past Papers toggle, Grade list, Paper list, Add/Edit Paper dialog, Page grid with PDF + per-page upload
4. Verification: `npx tsc --noEmit` clean, Convex dashboard shows rows, manual upload of one paper works end-to-end
5. Commit, push gate.

**0.5b — Crop + Tag**
1. Backend: `upsertForPaperQuestion`, `rekeyToPaperQuestion`, `listByPaper`, `listByPaperPages` in `convex/questionBank.ts`
2. UI: Data Entry tab — new "Past Papers" subtab; `/settings/past-paper-crop/[paperId]/page.tsx` route; adapted pill-header/toolbar/overlay flow
3. Concept-tagging entry point on past-paper crops (drawer/dialog reusing whatever 0.4 provides; if 0.4 is not built yet, stub a simple multi-select)
4. Verification: per algorithm_plan.md — upload + 5 crops + concept tags → dashboard rows match; holdout toggle disables training-signal; `tsc` clean.
5. Commit.

This document covers both phases; build code lands in two sessions.

---

## 3. Schema diff (`convex/schema.ts`)

### 3.1 New tables

```ts
pastPapers: defineTable({
  grade: v.number(),                              // 6..11
  term: v.number(),                               // 1 | 2 | 3
  year: v.number(),                               // e.g. 2018
  schoolName: v.optional(v.string()),             // undefined = own / centre paper
  totalPages: v.number(),
  useAsTrainingSignal: v.boolean(),               // user-set; defaults derived (see § 2.5)
  isHoldout: v.boolean(),                         // user-set; current term's own paper
  totalMarks: v.optional(v.number()),
  uploadedAt: v.number(),                         // ms epoch
})
  .index("by_grade_term_year", ["grade", "term", "year"])
  .index("by_training_signal", ["useAsTrainingSignal"])
  .index("by_grade", ["grade"]),

pastPaperPages: defineTable({
  pastPaperId: v.id("pastPapers"),
  pageNumber: v.number(),
  storageId: v.id("_storage"),
})
  .index("by_paper", ["pastPaperId"])
  .index("by_paper_page", ["pastPaperId", "pageNumber"]),
```

> Note: composite uniqueness `(grade, term, year, schoolName)` is **not** a DB constraint — Convex doesn't enforce uniqueness across nullable fields. The mutation guards against it by querying `by_grade_term_year` and filtering on `schoolName` before insert.

### 3.2 Extend `questionBank`

Add four optional fields and two indexes:

```ts
questionBank: defineTable({
  // ...existing fields...
  pastPaperId: v.optional(v.id("pastPapers")),
  pastPaperPageId: v.optional(v.id("pastPaperPages")),
  marksAvailable: v.optional(v.number()),
  questionNumberInPaper: v.optional(v.string()),  // "1.a", "5.iii"
  // ...
})
  // ...existing indexes...
  .index("by_past_paper", ["pastPaperId"])
  .index("by_past_paper_page", ["pastPaperPageId"])
```

### 3.3 Extend `questionConcepts`

Add one optional field, schema-only — UI ignores it in 0.5/0.6, Phase G reads it:

```ts
questionConcepts: defineTable({
  // ...existing fields...
  weight: v.optional(v.number()),                 // (0, 1], default 1.0; reserved for Phase G
})
  // existing indexes unchanged
```

---

## 4. Backend diff

### 4.1 New file: `convex/pastPapers.ts`

CRUD for the `pastPapers` table. Mirrors `convex/textbooks.ts` patterns (auth check, identity-gated reads).

| Export                        | Type     | Args                                                                                                                          | Returns                  |
| ----------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| `list`                        | query    | none                                                                                                                          | `PastPaper[]`            |
| `listByGrade`                 | query    | `{ grade: number }`                                                                                                           | `PastPaper[]`            |
| `getById`                     | query    | `{ id: Id<"pastPapers"> }`                                                                                                    | `PastPaper \| null`      |
| `create`                      | mutation | `{ grade, term, year, schoolName?, totalPages, useAsTrainingSignal, isHoldout, totalMarks? }`                                 | `Id<"pastPapers">`       |
| `update`                      | mutation | `{ id, totalPages?, schoolName?, useAsTrainingSignal?, isHoldout?, totalMarks? }`                                             | `void`                   |
| `remove`                      | mutation | `{ id }`                                                                                                                      | `void` (cascade — see §4.4) |

Validation in `create` and `update`:
- `isHoldout === true && useAsTrainingSignal === true` → throw `"Holdout papers cannot be training signals"`
- `term ∉ {1, 2, 3}` → throw
- `grade < 6 || grade > 11` → throw
- Duplicate-paper guard: `create` queries `by_grade_term_year` and rejects if a row exists with the same `schoolName` (treating null/undefined as the own-paper key).

### 4.2 New file: `convex/pastPaperPages.ts`

Direct mirror of `convex/textbookPages.ts` — every export has the same shape but operates on `pastPaperPages` and is keyed by `pastPaperId` instead of `textbookId`.

| Export                  | Args                                                                  | Notes                                                  |
| ----------------------- | --------------------------------------------------------------------- | ------------------------------------------------------ |
| `generateUploadUrl`     | none                                                                  | Auth-gated wrapper around `ctx.storage.generateUploadUrl()` |
| `savePage`              | `{ pastPaperId, pageNumber, storageId }`                              | Upsert; deletes prior storage on replace               |
| `getByPaper`            | `{ pastPaperId }`                                                     | All page rows                                          |
| `getCapturedPageNumbers`| `{ pastPaperId }`                                                     | `number[]` for the page-grid UI                        |
| `getPageImage`          | `{ pastPaperId, pageNumber }`                                         | Returns signed URL or null                             |
| `getPagesInRange`       | `{ pastPaperId, startPage, endPage }`                                 | `{ pageNumber, url, pageId }[]`                        |
| `removePage`            | `{ pastPaperId, pageNumber }`                                         | Cascade — see §4.4                                     |

### 4.3 Extend `convex/questionBank.ts` (most lands in 0.5b)

| Export                       | Args                                                                                                                          | Notes                                                                                                                                          |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `listByPaper` *(0.5b)*       | `{ pastPaperId }`                                                                                                             | Uses `by_past_paper`                                                                                                                            |
| `listByPaperPages` *(0.5b)*  | `{ pastPaperPageIds: Id<"pastPaperPages">[] }`                                                                                | Drawer overlay query                                                                                                                            |
| `upsertForPaperQuestion` *(0.5b)* | `{ pastPaperId, questionNumberInPaper, pastPaperPageId, cropBox, marksAvailable? }`                                       | 1:1 invariant on `(pastPaperId, questionNumberInPaper)`. Behaviour mirrors `upsertForExerciseKey`: insert if absent, patch + delete dupes if present |
| `rekeyToPaperQuestion` *(0.5b)* | `{ id, pastPaperId, questionNumberInPaper }`                                                                               | Mirrors `rekeyToExerciseKey`                                                                                                                    |
| `create` *(extend)*          | Add optional `pastPaperId`, `pastPaperPageId`, `marksAvailable`, `questionNumberInPaper` to args                              | Must be done in 0.5a so the schema validator accepts them                                                                                       |
| `update` *(extend)*          | Same four optional fields                                                                                                     | 0.5a                                                                                                                                            |

`remove` already cascades to `questionConcepts` — no change needed.

### 4.4 Cascade behaviour

| Trigger                    | Cascade                                                                                              |
| -------------------------- | ---------------------------------------------------------------------------------------------------- |
| `pastPapers.remove(id)`    | Delete all `pastPaperPages.by_paper(id)` (each calls `ctx.storage.delete(storageId)`); delete all `questionBank.by_past_paper(id)` (each cascades to `questionConcepts.by_question`); delete the paper row |
| `pastPaperPages.removePage` | Delete the storage blob; delete all `questionBank.by_past_paper_page(pageId)` (each cascades to `questionConcepts.by_question`); delete the page row |

Cascades execute in a single mutation handler. No partial state.

---

## 5. UI changes

### 5.1 Content tab — Past Papers section (0.5a)

File: `src/components/settings/content-tab.tsx` — add a top-of-tab segmented toggle. Existing textbook drill-down stays untouched; new state machine handles the past-paper side.

#### View state

```ts
type ContentSource = 'textbooks' | 'past-papers';
type PaperViewLevel = 'grades' | 'papers' | 'pages';
```

#### Past-paper drill-down

| Level     | UI                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `grades`  | One card per grade 6–11 showing paper count + "Add paper" affordance reachable after grade selection.                                                                                                                                                                                                                                                                                                                                                            |
| `papers`  | List of papers for the chosen grade, sorted by `(year desc, term asc, schoolName)`. Each row: `2024 · T2 · Western Province` + holdout/training badges + page-capture progress (`x/y pages`) + edit/delete buttons. "Add Paper" button at bottom opens dialog.                                                                                                                                                                                                  |
| `pages`   | Page grid identical to textbook flow (camera tap-to-capture, PDF upload, preview/recapture/delete dialog).                                                                                                                                                                                                                                                                                                                                                       |

#### Add/Edit Paper dialog fields

| Field                  | Control                                  | Validation                                                                                                                                                            |
| ---------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Term                   | 3-segment toggle T1 / T2 / T3            | Required                                                                                                                                                              |
| Year                   | Number input                             | Required, between 2010 and currentYear+1                                                                                                                              |
| School                 | Text input + "Own paper" toggle          | If "Own paper" toggled on, `schoolName = undefined`; otherwise required string                                                                                        |
| Total pages            | Number input                             | Required, ≥ 1                                                                                                                                                         |
| Total marks            | Number input (optional)                  | If provided, ≥ 1                                                                                                                                                      |
| Use as training signal | Toggle                                   | Default per § 2.5; **disabled** when `isHoldout === true`                                                                                                              |
| Holdout                | Toggle                                   | Default false. Tooltip: "Current term's own paper — must never feed the algorithm". When toggled on, training-signal toggle becomes disabled and snaps to false.      |

Edit dialog: same fields, except `grade`, `term`, `year` are read-only after creation (changing those would require re-tagging every crop). Allow editing `schoolName`, `totalPages`, flags, `totalMarks`.

### 5.2 Data Entry tab — Past Papers subtab (0.5b)

File: `src/components/settings/data-entry-tab.tsx` — add 5th subtab next to existing Exercises / Page Nos / Details / Concepts.

| Section          | UI                                                                                                                                                                          |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Filter row       | Grade toggle (6–11), term toggle, search by school                                                                                                                          |
| Paper cards      | One card per paper. Shows badges (holdout, training-signal, "old"), crop count from `questionBank.by_past_paper`, total pages, total marks. Tap → push to crop route.        |
| Empty state      | "No past papers uploaded yet — go to Content → Past Papers"                                                                                                                  |

### 5.3 Past-paper crop route (0.5b)

New file: `src/app/settings/past-paper-crop/[paperId]/page.tsx`.

Reuses (without modification) these components from the existing crop route:
- `ZoomedPageView`
- `PageCropOverlay`
- `CropToolToolbar`
- `CropPillHeader` — but with a different data model (see below)

Differences from `/settings/crop/[unitId]`:

| Concern                  | Textbook flow                                                                  | Past-paper flow                                                                                            |
| ------------------------ | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| Source identity          | `findUnit(unitId)` returns textbook + page range + exercises                   | `pastPapers.getById(paperId)` returns paper meta; `pastPaperPages.getByPaper` returns ordered page list    |
| Pill-header content      | Pre-declared exercise + sub-question keys ("1", "2.a", "5.iii")                | Free-text input "Question number" + list of already-cropped numbers in this paper as chips                 |
| 1:1 invariant            | `(linkedExerciseId, linkedQuestionKey)`                                        | `(pastPaperId, questionNumberInPaper)`                                                                     |
| Mutation on draw         | `upsertForExerciseKey`                                                         | `upsertForPaperQuestion`                                                                                   |
| Re-key                   | `rekeyToExerciseKey`                                                           | `rekeyToPaperQuestion`                                                                                     |
| Marks input              | n/a                                                                            | Optional number field next to the question-number input                                                    |
| Concept-tag entry point  | Phase 0.4 will add a "Tag concepts" button on each crop                        | Same 0.4 component, source-agnostic                                                                        |

Routing entry point from the Data Entry past-paper card:

```ts
router.push(`/settings/past-paper-crop/${paperId}`);
```

Back-navigation returns to the Data Entry tab with the Past Papers subtab persisted (uses the existing `sessionStorage` mechanism in `src/app/settings/page.tsx`).

---

## 6. Edge cases (lifted from algorithm_plan.md + plan-time additions)

| #  | Case                                                                                                              | Handling                                                                                                                                            |
| -- | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1  | Tamil-only OCR is unusable                                                                                        | All capture is coordinate crops on rendered page images — no OCR pipeline                                                                            |
| 2  | Multi-paper same year/grade/term (Western Province + Central Province for 2022 G7 T2)                             | Composite key `(grade, term, year, schoolName)`. `schoolName === undefined` reserved for own/centre paper                                            |
| 3  | Paper that becomes "old" (3+ years past term)                                                                     | `useAsTrainingSignal` is user-set at upload only. A derived helper `isEffectivelyOld(paper, today)` lives in `convex/learningEngine/papers.ts` (added in Phase 0.6 / B; not in 0.5)                                              |
| 4  | Holdout paper accidentally tagged with `useAsTrainingSignal=true`                                                 | UI disables the toggle when `isHoldout=true` and snaps it to false. Mutation rejects the combination as a defence-in-depth check                     |
| 5  | Marks per question missing                                                                                        | `marksAvailable` left null. Importance computation in Phase B falls back to count-based weight                                                       |
| 6  | User uploads same `(grade, term, year, schoolName)` twice                                                         | `create` mutation rejects duplicate. Error toast "A paper for that grade/term/year/school already exists"                                            |
| 7  | User deletes a paper that has crops + concept tags                                                                | Cascade in `pastPapers.remove` (see §4.4) deletes pages → questionBank rows → questionConcepts joins. Confirm dialog warns user before triggering    |
| 8  | User deletes a single page that has crops on it                                                                   | Cascade in `pastPaperPages.removePage` deletes that page's questionBank rows + concept joins. Confirm dialog warns "X crops on this page will be removed" |
| 9  | User crops a question, types `1.a`, then later realises it should be `1.b` — re-keys the crop                     | `rekeyToPaperQuestion` deletes any existing crop already at `(paperId, "1.b")` (preserving 1:1) and patches the rekeyed crop                         |
| 10 | User draws two crops without typing question numbers                                                              | Both rows persist with `questionNumberInPaper` undefined. They are listed as "Untagged crops" in the pill header and don't break the 1:1 invariant   |
| 11 | User uploads a 50-page PDF                                                                                        | Reuse the existing `pdfjs-dist` chunked render loop from `content-tab.tsx`. Progress toast updates per page                                          |
| 12 | User edits paper's `totalPages` to a number lower than highest captured page                                      | Allowed (matches textbook flow). Pages above the new total stay in storage but are no longer addressable via the page grid; cleanup is manual        |
| 13 | TS strict-mode failures from new optional fields                                                                  | Run `npx tsc --noEmit -p tsconfig.json` before commit. Both 0.5a and 0.5b must exit 0                                                                |
| 14 | `questionConcepts.weight` exists but no UI sets it                                                                | Documented as Phase G reserved. Default treatment in any current consumer = 1.0                                                                      |

---

## 7. Verification checklist

### 7.1 0.5a — after schema + backend + Content-tab upload UI

- [ ] `npx convex dev` deploys without schema errors
- [ ] `npx tsc --noEmit -p tsconfig.json` exits 0
- [ ] Content tab shows "Textbooks | Past Papers" toggle; existing textbook flow unaffected
- [ ] Create paper: G7 T1 2018, Western Province, 3 pages, default flags → Convex dashboard shows one row in `pastPapers` with `useAsTrainingSignal=true, isHoldout=false`
- [ ] Toggle `isHoldout=true` on edit → training-signal toggle disables and snaps to false; row updates correctly
- [ ] Upload 3 pages via PDF → `pastPaperPages` has 3 rows; previewing each renders the image
- [ ] Delete a single page → storage blob deleted; row gone
- [ ] Delete the paper → both pages and the paper row gone; storage blobs deleted
- [ ] Try to create G7 T1 2018 Western Province a second time → error toast
- [ ] Create G7 T1 2024 own paper, mark holdout → row has `isHoldout=true, useAsTrainingSignal=false`

### 7.2 0.5b — after Data Entry subtab + crop route

- [ ] Data Entry tab shows new "Past Papers" subtab; previous subtabs unaffected
- [ ] Subtab lists papers with correct badges + crop counts
- [ ] Tap paper card → crop route opens at correct paper, first page
- [ ] Draw crop, type "1.a", marks 4 → `questionBank` has one row with `source="past-paper"`, correct `pastPaperId`, `pastPaperPageId`, `cropBox`, `marksAvailable=4`, `questionNumberInPaper="1.a"`
- [ ] Draw second crop on same page, type "1.a" again → first crop is overwritten in place (1:1 enforced); only one row at that key
- [ ] Re-key existing crop from "1.a" to "1.b" → row's `questionNumberInPaper` updates; if `1.b` already had a crop, the old `1.b` row is deleted
- [ ] Tag a crop with one or more concept-type exercises → `questionConcepts` row(s) created
- [ ] Delete a crop → `questionConcepts` rows for it are also deleted
- [ ] `npx tsc --noEmit -p tsconfig.json` exits 0
- [ ] Full plan-spec verification pass: 1 paper × 3 pages × 5 crops × ≥1 concept tag each → exact row counts in dashboard

---

## 8. File-by-file change list

### 8.1 0.5a

| File                                                        | Change                                                                                                                            |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `convex/schema.ts`                                          | Add `pastPapers`, `pastPaperPages`. Extend `questionBank` (4 fields, 2 indexes). Extend `questionConcepts` (1 field).             |
| `convex/pastPapers.ts`                                      | **NEW.** CRUD per §4.1                                                                                                            |
| `convex/pastPaperPages.ts`                                  | **NEW.** Page ingestion per §4.2                                                                                                  |
| `convex/questionBank.ts`                                    | Extend `create` and `update` arg validators with the four new optional fields. (Other handlers in 0.5b.)                          |
| `src/components/settings/content-tab.tsx`                   | Add top-of-tab Textbooks/Past Papers toggle and the past-paper drill-down (grades → papers → pages) reusing existing dialogs.     |

### 8.2 0.5b

| File                                                          | Change                                                                                                              |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `convex/questionBank.ts`                                      | Add `listByPaper`, `listByPaperPages`, `upsertForPaperQuestion`, `rekeyToPaperQuestion`                              |
| `src/components/settings/data-entry-tab.tsx`                  | Add "Past Papers" subtab + paper-card list                                                                          |
| `src/app/settings/past-paper-crop/[paperId]/page.tsx`         | **NEW.** Parallel crop route per §5.3                                                                                |
| `src/components/settings/past-paper-pill-header.tsx`          | **NEW.** Pill header variant for past papers (free-text question-number input + list of cropped numbers as chips)   |
| (concept-tag entry point)                                     | Reuse Phase 0.4 component if present; else stub a simple multi-select dialog (will be replaced by 0.4)              |

---

## 9. Out of scope for Phase 0.5

- Phase 0.4 concept-tagging UI proper — only a placeholder hook in 0.5b
- Phase 0.6 coverage dashboard — uses 0.5 data but is a separate phase
- Phase A memory/mastery model — no `memoryState` or `attemptLog` work here
- Auto-promotion of `useAsTrainingSignal` based on age — derived helper added in Phase 0.6 / B
- Teacher-authored question source (`source === "teacher-authored"`) — Phase 0.7
- `questionConcepts.weight` UI — Phase G
- OCR or any text extraction — never (Tamil OCR is unusable)

---

## 10. Open items to confirm before 0.5a build starts

None — the user has signed off on the plan in conversation. If any of the decisions in §2 should change, edit this document, mark the change in §2, and re-confirm before code lands.
