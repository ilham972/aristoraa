# Phase 0.4 — Topic Tags + Paper Structure + Tagged Past-Paper Crops — Build Plan

> **For a fresh Sonnet 4.6 session: read this file top-to-bottom before touching any code.** It captures every user decision made during the brainstorm, the strategic role of this phase in the overall learning engine, the exact codebase state, and the file-by-file plan. When you finish reading, you should be able to execute the build without asking the user to re-explain context.
>
> **Required reading order before this file:**
> 1. `learning_engine_plan.md` — strategic pivot, Holdout validation, role of past papers as Importance signal (Phase B)
> 2. `phase_0_5_plan.md` — what Phase 0.5 shipped (past-paper page ingest + free-text question-number cropping)
> 3. `algorithm_plan.md` — full tactical spec (skim §"Phase 0.4 — Concept tagging" + §"Phase B — Importance / Sheet generator")
> 4. `curriculum context.md` — raw Tamil unit list per grade per term (used by the seed)
> 5. **This file**
>
> **References to existing code patterns being reused:**
> - `src/components/settings/concepts-unit-drawer.tsx` — prereq picker pattern (cross-book search with M·G·T context tags) — model for the tag-link picker
> - `src/components/settings/crop-pill-header.tsx` — slot-tap header pattern (main-Q grid + sub-letter pills) — model for `PastPaperStructuredHeader`
> - `convex/questionBank.ts:upsertForExerciseKey` + `rekeyToExerciseKey` — model for the slot-keyed past-paper variants
> - `convex/exercises.ts:setConceptPrerequisites` — model for tag-unit-link mutation

---

## 1. Goal

Build the **strategic intelligence layer** that turns past-paper crops from raw images into measurable signal for the Phase B Importance Engine.

Three deliverables:

1. **Topic Tag taxonomy** — a flexible, user-editable broad-topic taxonomy ("Fractions", "Ratios & Proportions", …) that links each tag to the curriculum's existing units across all grades. *Concepts are derived: every concept-type exercise inside a linked unit is automatically reachable from the tag.* This taxonomy is the bridge between past-paper crops and the importance algorithm — without it, papers are just images, with it the system can answer "Fractions appeared 32 times across 10 papers, weighted by marks = X importance."

2. **Paper Structure builder** — a per-grade definition of the exam paper shape (parts, question counts, marks per question, required count, optional permanent / suggested tags per slot). Grade 10/11 share one fixed national structure; Grade 6–9 share a default + per-paper override for variable Part 2 essay configurations. The structure becomes the source of truth for slot identity in the crop UI: instead of typing free-text question numbers, the user taps a slot in a structured pill header (mirroring the textbook crop flow's exercise + question grid).

3. **Crop UI integration** — the past-paper crop route swaps `PastPaperPillHeader` (free-text input) for `PastPaperStructuredHeader` (Part-tab + slot-pill grid driven by the paper's structure). After drawing a crop with a slot active, the system saves with structured `(partId, slotNumber)` identity, auto-applies any permanent topic tag for that slot, and offers a concept picker filtered to the tag's linked units.

**Why this matters in the bigger picture:**

- **Phase B Importance Engine** needs a way to count "how often does each concept appear, weighted by marks." Without topic tags, the engine has no signal — past-paper crops are just bytes. With topic tags + slot-level structure, the engine has a frequency-by-marks distribution per concept.
- **Holdout validation** (per `learning_engine_plan.md` §5) requires comparing predicted-vs-actual mastery per concept on the held-out current-term paper. Without concept-level tagging on every past-paper question, the calibration plot has no x-axis.
- **Phase 0.4 closes the open stub** in Phase 0.5: the past-paper crop route currently labels crops with free-text question numbers — useful for human reference, useless for algorithmic signal. This phase replaces that with structured identity.

---

## 2. Architectural decisions

### 2.1 Two parallel taxonomies, not one — `examTopicTags` (broad) + `questionConcepts` (existing, fine-grained)

The existing `questionConcepts` join table (Phase 0.1) ties a `questionBank` row to one or more concept-type exercises. That stays. We add a **new, higher-level** taxonomy on top: `examTopicTags`. Each topic tag is broad ("Fractions") and links to the curriculum's *units*, not to individual concepts.

**Why two layers:**

| Layer                    | Granularity                             | Source                                                                                          | Used by                                                                |
| ------------------------ | --------------------------------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `examTopicTags`          | Broad topic, ~30–40 tags                | User-defined (with curriculum-derived seed)                                                     | Importance Engine (frequency-by-marks rollup), tag overview pages, structure-builder slot tagging |
| `questionConcepts`       | Specific concept (one per exercise row) | Existing concept-type exercises in `exercises` table                                            | Mastery model (Phase A), per-concept calibration (Holdout validation)  |

A single past-paper crop may carry **one** topic tag and **one or more** specific concepts. Concepts are *derived* from the topic tag's linked units (the picker filters to concepts within those units), but the link in `questionConcepts` is still explicit per crop because two crops sharing a topic tag may test different specific concepts.

> The user explicitly described this: *"first i select tag and then i can select sub tag that is already existing concepts."* Topic tag is the broad bucket; concept is the specific identity.

**Rejected alternatives:**

- *Use only topic tags, drop `questionConcepts`*: would lose concept-level mastery + calibration granularity. Phase A's mastery model is per-concept. Phase B's calibration plot is per-concept. Topic tags are too coarse for either.
- *Use only `questionConcepts`, no topic tags*: the user wants to see "how does Fractions evolve from G6 to G11" — that's a unit-rollup view, not a concept-rollup view. Without a tag→unit link table, every concept page would be siloed by grade. Topic tags are the explicit cross-grade aggregation.
- *Auto-derive topic tags from concepts via heuristics*: brittle (Tamil unit names + transliteration). User wants explicit, editable links. Seed once, edit forever.

### 2.2 Tag → unit link, not tag → concept link

`examTopicTagLinks` rows store `(tagId, unitId, grade, term)`. The tag's "linked concepts" are derived: query `exercises` filtered by `unitId in tag.linkedUnitIds AND type === 'concept'`.

> User said: *"when connect one unit that tag automatically identified which module then that never change."* Linking units is enough; concepts come along for free.

`unitId` is a string from the static `curriculum-data.ts` (e.g. `M1-G6-T2-0`). It's stable across deploys (built deterministically by `buildUnits()`). Storing the string is cheaper than maintaining a separate `units` table.

### 2.3 Paper structure as a Convex table, slot identity replaces free-text question number

Phase 0.5 keyed past-paper crops by `(pastPaperId, questionNumberInPaper)` where `questionNumberInPaper` is free text. Phase 0.4 replaces that key with **structured slot identity**:

```
unique(pastPaperId, paperStructurePartId, paperStructureSlotNumber)
```

`questionNumberInPaper` becomes a *display label* derived from `${partCode}.${slotNumber}` ("1A.1", "2.5"). It stays in the schema as a denormalized cache so list views don't need to join through structure tables.

**Why this trade is worth it:**

- The user wants Option A: **the crop UI shows slots from the structure, the user taps a slot, no typing.** This requires structured identity.
- Slot identity is the natural key for permanent tag assignment ("Grade 10 Part 1A Q1 is always Fractions"). Free-text identity can't carry that.
- Frequency analysis becomes a clean group-by: count rows per `(grade, partCode, slotNumber, topicTagId)`.

### 2.4 Grade-level structure with paper-level overrides for G6–G9

Per user spec:

| Grades | Structure                                                                                                                                                                                                                                                                                          | Variability |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| 10, 11 | Part 1A: 25 MCQ × 2 marks (50 marks). Part 1B: 5 structured × 10 marks (50 marks). Part 2A: 7 essay × 10 marks, answer 5 (50 marks). Part 2B: 7 essay × 10 marks, answer 5 (50 marks). Total raw 200, scaled ÷ 2 = 100 marks. *National structure — never changes.* | Fixed       |
| 6–9    | Part 1: 20 MCQ × 2 marks (40 marks). Part 2: 7 essay × 12 marks, answer 5 (60 marks). Total 100 marks. *Default; some papers use 8 essay × 10 marks variant — overridable per paper.*                                                              | Variable Part 2 |

**Encoding choice**: one `paperStructures` row per grade (the default). Per-paper overrides live in a new optional field on `pastPapers`:

```ts
pastPapers.partOverrides?: Array<{
  partCode: string;          // matches paperStructureParts.partCode
  questionCount?: number;
  marksPerQuestion?: number;
  requiredCount?: number;
}>
```

When rendering slots for a specific paper: for each part in the structure, override-merge the part's config with any matching entry in `partOverrides`. Slot tag assignments live on the *default structure*; if an override grows the slot count, the extra slots have no permanent tag (fall back to learned-options + free pick).

> User said: *"just defining 7 essays 12 marks as default and allow to override."* Per-paper override is the cheapest implementation.

### 2.5 Permanent tag vs. suggested options vs. learned options

Per user spec, slot tagging in the structure builder has three modes:

| Mode                  | Storage                                                                                              | Crop UI behaviour                                                                                                       |
| --------------------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| **Permanent**         | One `paperStructureSlotTags` row with `mode: "permanent"` and `tagId`                                | Topic tag is auto-applied on save. Tag picker collapsed to read-only chip. User can override by tapping the chip.       |
| **Suggested options** | N rows with `mode: "option"` and one `tagId` each; same `partId + slotNumber`                        | Tag picker pre-populated with these options at top, full tag list below. User picks one.                                |
| **Learned**           | No rows                                                                                              | Tag picker reads `questionBank` history: across all papers of this grade, what tags appeared at this slot? Sort by count, top-5 surfaced as suggestions. Full list below as fallback. |

This means a single table `paperStructureSlotTags` covers permanent + suggested via a `mode` enum. Learned mode is the absence of any row at that slot.

### 2.6 Two-screen Settings IA, mirroring the existing Content / Data Entry split

The user said the structure builder and the tag manager should be **separate screens** (per their answer to question 3). Recommended IA:

| Settings tab        | New screen                                                                                                                          |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **(new)** Tags      | Top-level: list of all topic tags + create. Per-tag detail: edit name/color, manage unit links, view derived concepts grouped by grade. |
| **(new)** Exam Structure | Top-level: grade 6–11 selector. Per-grade: edit parts (count, marks, required). Per-part: tag-config grid (one row per slot, configure permanent / suggested / learned). |

**Rejected alternative**: nesting Tags + Structure under Data Entry. The user already has a 5-subtab Data Entry tab (Exercises / Pages / Details / Concepts / Past Papers) — adding two more makes it unwieldy. Top-level Settings tabs are cheaper and match the existing Content / Curriculum / Data Entry pattern.

### 2.7 Crop-route pill header swap, not new route

The Phase 0.5 route `src/app/settings/past-paper-crop/[paperId]/page.tsx` keeps its identity — only the pill header swaps from `PastPaperPillHeader` (free text) to `PastPaperStructuredHeader` (slot grid).

The structured header's API mirrors `CropPillHeader`:

```ts
interface Props {
  parts: Part[];                                  // structure parts merged with paper overrides
  selectedPart: PartCode | null;                  // active tab
  selectedSlot: number | null;                    // active slot within selected part
  selectedCropId: Id<'questionBank'> | null;      // for re-key flow
  existingSlots: Set<string>;                     // "1A:1", "2A:5" — already cropped
  onPickPart: (code: PartCode) => void;
  onPickSlot: (partCode: PartCode, slotNumber: number) => void;
  onCancelSelection: () => void;
}
```

Below the slot grid: a topic-tag chip showing the resolved tag for the active slot (permanent / option-selected / blank) + a tap-to-change affordance. Below that: the concept picker (multi-select, filtered to the tag's linked units' concepts).

### 2.8 Migration: existing past-paper crops with free-text `questionNumberInPaper`

Phase 0.5 was just shipped today (May 2 2026); the user has not bulk-cropped past papers yet, so we expect very few legacy rows. Strategy:

1. **Schema-additive**: keep `questionNumberInPaper` field. Add new optional `paperStructurePartId` + `paperStructureSlotNumber`. Do not break legacy rows.
2. **Display-fallback**: list-view labels prefer `${partCode}.${slotNumber}` when slot is set, else fall back to `questionNumberInPaper`.
3. **No automatic migration mutation** — the user can re-cut legacy crops manually. If there's a non-trivial number, write a one-shot `internalMutation` in `convex/seeds/migrateLegacyPaperCrops.ts` that parses common formats ("1.a", "Q3", "Section B Q5") into slot identity. **Out of scope for this plan unless count > 50 — confirm with user before writing.**
4. **1:1 invariant updates**: `upsertForPaperQuestion` keys by `(paperId, partId, slotNumber)` for new crops. Legacy rows are not deduped against new ones (different keys).

### 2.9 Scope split: 0.4a (this session) + 0.4b (next session)

Following Phase 0.5's pattern. Split:

**0.4a — Topic tags + seed**

1. Schema: `examTopicTags`, `examTopicTagLinks`, `paperStructures`, `paperStructureParts`, `paperStructureSlotTags`, `pastPapers.partOverrides`, `questionBank.topicTagId/paperStructurePartId/paperStructureSlotNumber`.
2. Backend: `convex/topicTags.ts` (CRUD + link mgmt + derived concepts query); `convex/paperStructures.ts` (CRUD for structure + parts + slot-tag rows); `convex/seeds/topicTags.ts` (one-shot idempotent seed).
3. UI: Settings → new **Tags** tab (list + create + tag detail with unit-link picker + derived-concepts view).
4. Run seed: `npx convex run seeds/topicTags:seedAll`. Verify rows + idempotency.
5. Verification: `tsc` clean, seed produces ~35 tags + ~140 unit links.
6. Commit + push gate.

**0.4b — Paper Structure + crop integration**

1. Backend: `convex/paperStructures.ts:seedDefaults` — seed the G10/G11 fixed structure + G6–G9 default structure (no slot tags pre-set). Slot-tag CRUD + learned-options query.
2. Backend: `convex/questionBank.ts` — add `upsertForPaperSlot` + `rekeyToPaperSlot`; deprecate (keep but don't surface) `upsertForPaperQuestion` + `rekeyToPaperQuestion`.
3. UI: Settings → new **Exam Structure** tab (grade selector + part editor + per-part slot grid for tag config).
4. UI: `src/components/settings/past-paper-structured-header.tsx` (NEW) — replaces `PastPaperPillHeader` in `src/app/settings/past-paper-crop/[paperId]/page.tsx`.
5. UI: per-paper override editor — small dialog when uploading/editing a G6–G9 paper to set `partOverrides`.
6. Verification: full pass per §7.2.
7. Commit.

This document covers both halves; build code lands in two sessions.

---

## 3. Schema diff (`convex/schema.ts`)

### 3.1 New tables — `examTopicTags` (0.4a)

```ts
examTopicTags: defineTable({
  name: v.string(),                              // "Fractions" — user-facing label
  description: v.optional(v.string()),           // optional teacher note
  color: v.optional(v.string()),                 // CSS hex, defaults derived from module
  moduleId: v.optional(v.string()),              // "M1".."M6" — for default color + grouping
  createdAt: v.number(),
})
  .index("by_module", ["moduleId"])
  .index("by_name", ["name"]),                   // soft-uniqueness — checked in mutation
```

Tag names should be unique (case-insensitive). Mutation rejects duplicates explicitly — Convex doesn't enforce uniqueness on a single index.

### 3.2 New table — `examTopicTagLinks` (0.4a)

```ts
examTopicTagLinks: defineTable({
  tagId: v.id("examTopicTags"),
  unitId: v.string(),                            // matches curriculum-data.ts unit id ("M1-G6-T2-0")
  grade: v.number(),                             // denormalized for filtering
  term: v.number(),                              // denormalized for display
  moduleId: v.string(),                          // "M1".."M6", denormalized
  createdAt: v.number(),
})
  .index("by_tag", ["tagId"])
  .index("by_unit", ["unitId"])
  .index("by_tag_unit", ["tagId", "unitId"])    // for upsert/de-dup
  .index("by_grade", ["grade"]),
```

> The `unitId` foreign key is to the **static** curriculum-data, not a Convex table. The mutation that creates a link verifies the `unitId` exists by calling `findUnit(unitId)` from `src/lib/curriculum-data.ts` — but Convex backend can't import from `src/lib/`. So the backend either:
> (a) accepts any string and the frontend validates before mutation (lighter), or
> (b) we duplicate the curriculum index map into `convex/lib/curriculumIndex.ts`.
>
> **Decision: option (a)** — cheaper, and the frontend already has all unit data. The structure-builder UI provides typed pickers so no untrusted strings reach the mutation.

### 3.3 New tables — paper structure (0.4a schema, 0.4b populates + uses)

```ts
paperStructures: defineTable({
  grade: v.number(),                             // 6..11
  divisionFactor: v.number(),                    // 1 for G6-9, 2 for G10-11
  totalRawMarks: v.number(),                     // sum of (questionCount × marksPerQuestion) across required-only
  scaledTotal: v.number(),                       // totalRawMarks / divisionFactor
  notes: v.optional(v.string()),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_grade", ["grade"]),                 // expect one row per grade

paperStructureParts: defineTable({
  structureId: v.id("paperStructures"),
  partCode: v.string(),                          // "1A" | "1B" | "2A" | "2B" | "1" | "2"
  partLabel: v.string(),                         // "Part I Section A — MCQ"
  questionCount: v.number(),                     // total slots (e.g. 25)
  marksPerQuestion: v.number(),                  // e.g. 2
  requiredCount: v.number(),                     // students must answer N — 0..questionCount; defaults to questionCount when no choice
  order: v.number(),                             // display order
  notes: v.optional(v.string()),
})
  .index("by_structure", ["structureId"])
  .index("by_structure_order", ["structureId", "order"]),

paperStructureSlotTags: defineTable({
  partId: v.id("paperStructureParts"),
  slotNumber: v.number(),                        // 1..questionCount
  tagId: v.id("examTopicTags"),
  mode: v.string(),                              // "permanent" | "option"
  createdAt: v.number(),
})
  .index("by_part_slot", ["partId", "slotNumber"])
  .index("by_part", ["partId"])
  .index("by_tag", ["tagId"]),                   // for "where is this tag used" reverse lookup
```

**Validation invariants** (enforced in mutations):
- Per `(partId, slotNumber)`: at most one `mode === "permanent"` row.
- Per `(partId, slotNumber)`: any number of `mode === "option"` rows; permanent and options can co-exist (permanent wins on apply, options shown when user taps to override).
- `slotNumber ≥ 1 && slotNumber ≤ questionCount` of the parent part.

### 3.4 Extend `pastPapers` (0.4a schema)

Add one optional field for per-paper structure overrides:

```ts
pastPapers: defineTable({
  // ...existing fields...
  partOverrides: v.optional(v.array(v.object({
    partCode: v.string(),
    questionCount: v.optional(v.number()),
    marksPerQuestion: v.optional(v.number()),
    requiredCount: v.optional(v.number()),
  }))),
})
```

No new indexes — overrides are read with the parent paper row.

### 3.5 Extend `questionBank` (0.4a schema)

Add three optional fields and one index:

```ts
questionBank: defineTable({
  // ...existing fields...
  topicTagId: v.optional(v.id("examTopicTags")),
  paperStructurePartId: v.optional(v.id("paperStructureParts")),
  paperStructureSlotNumber: v.optional(v.number()),
})
  // ...existing indexes...
  .index("by_topic_tag", ["topicTagId"])
  .index("by_paper_slot", ["pastPaperId", "paperStructurePartId", "paperStructureSlotNumber"]),
```

The `by_paper_slot` index supports the new 1:1 invariant.

### 3.6 No changes to `questionConcepts`

`questionConcepts` already supports both textbook and past-paper crops via the source-agnostic `questionId: Id<"questionBank">` field. Phase 0.4 reuses it as-is.

---

## 4. Backend diff

### 4.1 New file: `convex/topicTags.ts` (0.4a)

| Export                          | Type     | Args                                                               | Behaviour                                                                                                                           |
| ------------------------------- | -------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `list`                          | query    | none                                                               | All tags, sorted by `moduleId asc, name asc`                                                                                        |
| `getById`                       | query    | `{ id: Id<"examTopicTags"> }`                                      | Tag row + linked units (`examTopicTagLinks`) joined                                                                                  |
| `getLinkedConcepts`             | query    | `{ tagId: Id<"examTopicTags"> }`                                   | All concept-type exercises whose `unitId` is in the tag's link list. Returns grouped by `{ grade, term, unitId, unitName, concepts: Exercise[] }` |
| `create`                        | mutation | `{ name, description?, color?, moduleId? }`                        | Reject duplicate name (case-insensitive)                                                                                            |
| `update`                        | mutation | `{ id, name?, description?, color?, moduleId? }`                   | Reject duplicate name on rename                                                                                                     |
| `remove`                        | mutation | `{ id }`                                                           | Cascade — delete all `examTopicTagLinks.by_tag(id)` and all `paperStructureSlotTags.by_tag(id)`. Sets `questionBank.topicTagId = undefined` for all rows referring to it (via patch loop) |
| `addUnitLink`                   | mutation | `{ tagId, unitId, grade, term, moduleId }`                         | Idempotent — checks `by_tag_unit` index, no-op if already linked                                                                    |
| `removeUnitLink`                | mutation | `{ tagId, unitId }`                                                | Removes one link row                                                                                                                |
| `setUnitLinks`                  | mutation | `{ tagId, units: Array<{ unitId, grade, term, moduleId }> }`       | Replace-all: deletes existing links not in `units`, inserts missing ones. Used by the unit-link drawer's "save" action              |

### 4.2 New file: `convex/paperStructures.ts` (0.4a schema, 0.4b populated)

| Export                          | Type     | Args                                                                           | Behaviour                                                                                                              |
| ------------------------------- | -------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `getByGrade`                    | query    | `{ grade: number }`                                                            | Returns `{ structure, parts: Part[], slotTags: SlotTag[] } \| null`                                                     |
| `getResolvedForPaper`           | query    | `{ paperId: Id<"pastPapers"> }`                                                | Returns the structure with `partOverrides` applied (effective `questionCount` / `marksPerQuestion` per part)            |
| `createStructure`               | mutation | `{ grade, divisionFactor, parts: PartInput[] }`                                | Atomically creates structure + parts. Computes `totalRawMarks` + `scaledTotal` from parts                              |
| `updateStructure`               | mutation | `{ id, divisionFactor?, notes? }`                                              |                                                                                                                        |
| `addPart`                       | mutation | `{ structureId, partCode, partLabel, questionCount, marksPerQuestion, requiredCount, order, notes? }` | Reject duplicate `(structureId, partCode)`                                                                              |
| `updatePart`                    | mutation | `{ id, partLabel?, questionCount?, marksPerQuestion?, requiredCount?, notes? }` | Reject `requiredCount > questionCount`. If `questionCount` shrinks, cascade delete slot-tag rows above the new max     |
| `removePart`                    | mutation | `{ id }`                                                                       | Cascade: delete all `paperStructureSlotTags.by_part(id)`                                                                |
| `setSlotTag`                    | mutation | `{ partId, slotNumber, mode: "permanent" \| "option", tagId }`                 | If `mode === "permanent"`: replace any existing permanent row at this slot. If `mode === "option"`: insert if absent (dedupe by `(partId, slotNumber, tagId)`) |
| `removeSlotTag`                 | mutation | `{ partId, slotNumber, tagId, mode }`                                          | Delete the matching row                                                                                                |
| `clearSlotPermanent`            | mutation | `{ partId, slotNumber }`                                                       | Delete the slot's permanent row (options remain)                                                                       |
| `getLearnedOptionsForSlot`      | query    | `{ grade, partCode, slotNumber }`                                              | Reads `questionBank.by_paper_slot` history: count `topicTagId` distribution at this `(grade, partCode, slotNumber)` across all papers. Returns top-5 sorted by count |
| `setPaperOverrides`             | mutation | `{ paperId, partOverrides }`                                                   | Patch `pastPapers.partOverrides`                                                                                        |

### 4.3 Extend `convex/questionBank.ts` (0.4b)

Add slot-keyed variants alongside the existing free-text variants. Existing `upsertForPaperQuestion` + `rekeyToPaperQuestion` stay (legacy compatibility) but the crop UI no longer calls them.

| Export                          | Args                                                                                                                                                       | Notes                                                                                                                                                                       |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `upsertForPaperSlot`            | `{ pastPaperId, paperStructurePartId, paperStructureSlotNumber, pastPaperPageId, cropBox, marksAvailable?, topicTagId?, conceptExerciseIds?: Id<"exercises">[] }` | 1:1 invariant on `by_paper_slot`. On insert: creates `questionBank` row + `questionConcepts` rows. On update: patches box + page + marks + tag, replaces concept join rows. Also computes + writes denormalized `questionNumberInPaper` ("1A.1") for list-view convenience. |
| `rekeyToPaperSlot`              | `{ id, pastPaperId, paperStructurePartId, paperStructureSlotNumber }`                                                                                       | Mirrors `rekeyToExerciseKey`. Deletes any pre-existing crop at the target slot, patches the rekeyed crop's slot fields + recomputes denormalized number string                |
| `setTopicTag`                   | `{ id, topicTagId? }`                                                                                                                                      | Patches `topicTagId`; passing `undefined` clears                                                                                                                              |
| `setConcepts`                   | `{ id, conceptExerciseIds: Id<"exercises">[] }`                                                                                                              | Replace all `questionConcepts.by_question(id)` rows with the new set. Used by the concept multi-select in the crop UI                                                          |
| `listByTopicTag`                | `{ topicTagId }`                                                                                                                                            | For tag-detail-page "questions tagged with this" panel                                                                                                                        |
| `listByGradeSlot` *(0.4b)*      | `{ grade, partCode, slotNumber }`                                                                                                                           | Fed by `getLearnedOptionsForSlot` — pulls all crops across all papers at that slot for frequency analysis                                                                     |

### 4.4 New file: `convex/seeds/topicTags.ts` (0.4a)

One-shot idempotent seed. Designed to be run via `npx convex run seeds/topicTags:seedAll`. **No UI button.**

```ts
import { internalMutation } from "../_generated/server";
import { v } from "convex/values";

export const seedAll = internalMutation({
  handler: async (ctx) => {
    // Skip if any tag already exists — the user may have customized
    const existing = await ctx.db.query("examTopicTags").take(1);
    if (existing.length > 0) {
      console.log("[seedTopicTags] tags already exist, skipping");
      return { skipped: true };
    }

    let tagsCreated = 0;
    let linksCreated = 0;

    for (const tagSpec of TAG_SEED) {
      const tagId = await ctx.db.insert("examTopicTags", {
        name: tagSpec.name,
        moduleId: tagSpec.moduleId,
        color: MODULE_COLORS[tagSpec.moduleId],
        createdAt: Date.now(),
      });
      tagsCreated += 1;
      for (const link of tagSpec.units) {
        await ctx.db.insert("examTopicTagLinks", {
          tagId,
          unitId: link.unitId,
          grade: link.grade,
          term: link.term,
          moduleId: tagSpec.moduleId,
          createdAt: Date.now(),
        });
        linksCreated += 1;
      }
    }

    console.log(`[seedTopicTags] created ${tagsCreated} tags + ${linksCreated} unit links`);
    return { tagsCreated, linksCreated };
  },
});
```

The `TAG_SEED` constant is the curriculum-derived taxonomy (see §6 below). The seed mutation reads `unitId`s **as literal strings** that match `curriculum-data.ts` `buildUnits()` output (`${moduleId}-G${grade}-T${term}-${i}`). The seed file duplicates these strings — verify them with the runtime curriculum data once seeded.

`MODULE_COLORS` in the seed file: `{ M1: '#1B4F72', M2: '#6C3483', M3: '#1E8449', M4: '#B9770E', M5: '#C0392B', M6: '#2E86C1' }` (matches `src/lib/types.ts`).

### 4.5 New file: `convex/seeds/paperStructures.ts` (0.4b)

```ts
export const seedDefaults = internalMutation({
  handler: async (ctx) => {
    // Idempotent — skip if any structure exists
    const existing = await ctx.db.query("paperStructures").take(1);
    if (existing.length > 0) return { skipped: true };

    // G10 + G11: identical national structure
    for (const grade of [10, 11]) {
      const structureId = await ctx.db.insert("paperStructures", {
        grade,
        divisionFactor: 2,
        totalRawMarks: 200,
        scaledTotal: 100,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      await insertPart(ctx, structureId, "1A", "Part I Section A — MCQ", 25, 2, 25, 1);
      await insertPart(ctx, structureId, "1B", "Part I Section B — Structured", 5, 10, 5, 2);
      await insertPart(ctx, structureId, "2A", "Part II Section A — Essays", 7, 10, 5, 3);
      await insertPart(ctx, structureId, "2B", "Part II Section B — Essays", 7, 10, 5, 4);
    }

    // G6–G9: default — 20 MCQ + 7 essays choose 5 × 12 marks
    for (const grade of [6, 7, 8, 9]) {
      const structureId = await ctx.db.insert("paperStructures", {
        grade,
        divisionFactor: 1,
        totalRawMarks: 100,
        scaledTotal: 100,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      await insertPart(ctx, structureId, "1", "Part I — MCQ", 20, 2, 20, 1);
      await insertPart(ctx, structureId, "2", "Part II — Essays", 7, 12, 5, 2);
    }

    return { ok: true };
  },
});
```

No slot-tag seeds in 0.4b — user fills those manually as papers are tagged. (Optionally we can pre-seed Grade 10 Part 1A slot 1 = Fractions, etc., but the user did not specify which slots are permanent. They will add via UI.)

---

## 5. UI changes

### 5.1 Settings → Tags tab (0.4a)

New file: `src/components/settings/tags-tab.tsx`. Wired into `src/app/settings/page.tsx` as a new top-level tab between Curriculum and Data Entry.

**List view:**

```
┌── Tags ─────────────────────── [+ New tag] ──┐
│ Module: [All] [M1] [M2] [M3] [M4] [M5] [M6]  │
│                                              │
│ ▌ Fractions                          12 units│
│ ▌ Decimals                            6 units│
│ ▌ Ratios & Proportions                7 units│
│ ▌ Percentages                         5 units│
│ ...                                          │
└──────────────────────────────────────────────┘
```

Vertical color stripe on each row uses `tag.color` (defaults to module color). Tap → tag detail page.

**Tag detail page** (route: `/settings/tags/[tagId]/page.tsx`):

Header: tag name + color + edit + delete.

Two sections:

1. **Linked units** — drawer with cross-grade unit picker (same UX as the prereq picker from `concepts-unit-drawer.tsx` — copy that pattern). Shows all units across all 6 modules × 6 grades × 3 terms; user toggles which units link to this tag. Each unit row shows M·G·T context + Tamil unit name. Save → `setUnitLinks` mutation.

2. **Concepts overview** — read-only view, grouped by grade. Pulls `getLinkedConcepts(tagId)` and renders:

    ```
    Grade 6
    ├─ Term 2 · M1 · 9. பின்னங்கள்
    │    ├─ [concept name] · ▶ video · 3 questions
    │    └─ [concept name] · ▶ video · 1 question
    Grade 7
    ├─ Term 2 · M1 · 10. பின்னங்கள்
    │    └─ ...
    ```

    Each concept row shows its `name`, `videoUrl` indicator, and a derived count of `questionBank` rows linked via `questionConcepts`. Tapping a concept opens the existing concept drawer (re-use `concepts-unit-drawer.tsx`'s drawer if extractable; else just navigate to Data Entry → Concepts → that unit).

3. **Question count badge** — small chip showing how many `questionBank` rows are tagged with this topic (across all sources, all papers).

### 5.2 Settings → Exam Structure tab (0.4b)

New file: `src/components/settings/exam-structure-tab.tsx`. Wired into `src/app/settings/page.tsx` as a new top-level tab.

**Grade selector** — segmented buttons 6 / 7 / 8 / 9 / 10 / 11.

**Per-grade view:**

Top: scaled-total / division-factor summary.

Parts list (one card per part):

```
┌── Part I Section A — MCQ ────────[edit] ─┐
│ Code: 1A · Order: 1                       │
│ Questions: 25                             │
│ Marks each: 2                             │
│ Required: 25 / 25                         │
│                                           │
│ Slot configuration ▼                      │
│ ┌─Q1─┬─Q2─┬─Q3─┬─...─┬─Q25─┐             │
│ │perm│opt │ —  │     │perm │             │
│ │frac│ratp│    │     │algeb│             │
│ │    │geom│    │     │     │             │
│ └────┴────┴────┴─────┴────┘              │
└──────────────────────────────────────────┘
```

Slot grid: clicking a slot opens a popover:

```
┌─ Slot 1A.3 ─────────────────────┐
│ ○ Learned (no fixed tag)         │
│ ○ Suggested options              │
│ ● Permanent: [Fractions    ▼]    │
│                                  │
│ Suggested options:               │
│ [+ add another tag]              │
│                                  │
│           [Cancel]    [Save]     │
└──────────────────────────────────┘
```

`[Fractions ▼]` is a typeahead picker over all topic tags.

**+ New part** at bottom; **delete part** in the per-part edit popover.

### 5.3 Past-paper crop route — pill header swap (0.4b)

File: `src/app/settings/past-paper-crop/[paperId]/page.tsx` — modified.

New file: `src/components/settings/past-paper-structured-header.tsx` — replaces `PastPaperPillHeader`.

**Visual layout:**

```
┌─────────────────────────────────────────────┐
│ [‹] Term 2 2024 · Western Province (G7)     │
│       8 pages · 100 marks                    │
│ ─────────────────────────────────────────── │
│ [✏️ Crop] [✋ Resize] [🗑 Delete]              │
│ ─────────────────────────────────────────── │
│ Tabs: [1] [2]                                │
│ ┌── 1 ──────────────────────────────────┐   │
│ │ ●Q1 ●Q2 ○Q3 ○Q4 ●Q5 ...               │   │
│ └────────────────────────────────────────┘   │
│ Selected: Q3 · learned · pick a tag below    │
│ Topic tag: [+ pick tag]    Marks: [2]        │
└─────────────────────────────────────────────┘
```

Filled circle (●) = slot already cropped. Open circle (○) = empty slot. Selected slot highlighted with primary-color border.

After draw with slot Q3 active:
1. `upsertForPaperSlot` mutation called with `paperStructurePartId`, `paperStructureSlotNumber: 3`, plus `topicTagId` (resolved per §2.5).
2. Toast: "Saved Q1.3" (or "Saved 1A.1" for G10).
3. Slot circle fills.
4. Auto-advance to next empty slot in part (mirrors `nextCropKey` logic).

Below the header, a small **concept multi-select** appears once a slot is selected with a topic tag set. Pulls concepts from `getLinkedConcepts(topicTagId)`. Multi-select dropdown grouped by grade. Save → `setConcepts(cropId, conceptExerciseIds)` (the crop's id from `lastTouchedCropIdRef`).

### 5.4 Per-paper override editor (0.4b)

New small dialog inside the Add/Edit Paper dialog (`content-tab.tsx`). When grade ∈ {6,7,8,9}, show a "Customize structure for this paper" expand-toggle. Inside:

```
Part I — MCQ
  Question count: [20]   (default 20)
  Marks each:    [2]    (default 2)
  Required:      [20]   (default 20)

Part II — Essays
  Question count: [7]   (default 7)
  Marks each:    [12]   (default 12)
  Required:      [5]    (default 5)

[Reset to defaults]
```

Save → calls `setPaperOverrides(paperId, partOverrides)`. Only fields that diverge from defaults get sent (others left undefined → they fall through to structure default).

For G10 / G11: this expand-toggle is hidden (national structure never overridden).

---

## 6. Tag taxonomy seed (TAG_SEED)

The seed creates ~38 tags + ~145 unit links derived from `curriculum context.md`. Each tag has a `moduleId` for default color + grouping. Below, `units` lists `(grade, term, unitIndex)` triples — Sonnet must convert these to `unitId` strings via the deterministic format `M{moduleId#}-G{grade}-T{term}-{unitIndex}` where `unitIndex` is the **0-based position** of that unit in `buildUnits()` from `src/lib/curriculum-data.ts`.

> **Important for Sonnet executing the seed**: open `src/lib/curriculum-data.ts` and verify each unit's index against the actual `buildUnits([...])` array order. The taxonomy below was derived from `curriculum context.md` listing order, which matches `curriculum-data.ts` array order, but verify before committing the seed.

### Module 1 — Numbers & Arithmetic

| Tag                     | Linked units (G–T–unitIndex)                                                                                        |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Place Value             | 6-1-0 (இடப் பெறுமானம்)                                                                                              |
| Whole Number Operations | 6-1-1 (முழு எண்களில்), 7-1-0 (முழு எண்களில்)                                                                       |
| Estimation & Rounding   | 6-1-2 (மதிப்பிடலும் மட்டந்தட்டலும்), 9-2-3 (மட்டந்தட்டலும் விஞ்ஞானமுறை)                                            |
| Factors & Multiples     | 6-2-1 (காரணிகளும் மடங்குகளும்), 7-1-1 (காரணிகளும் மடங்குகளும்), 8-1-2 (காரணிகள்)                                  |
| Indices & Logarithms    | 6-3-1 (சுட்டிகள்), 7-1-2 (சுட்டிகள்), 8-1-4 (சுட்டிகள்), 9-2-2 (சுட்டிகள்), 10-2-1 (மடக்கை I), 10-2-2 (மடக்கை II), 11-1-1 (சுட்டிகளும் மடக்கைகளும் I), 11-1-2 (சுட்டிகளும் மடக்கைகளும் II) |
| Square Roots            | 8-1-3 (வர்க்கமூலம்), 10-1-0 (வர்க்கமூலம்)                                                                          |
| Fractions               | 6-2-0 (பின்னங்கள்), 7-2-0 (பின்னங்கள்), 8-2-0 (பின்னங்கள்), 8-2-1 (பின்னங்கள்), 9-1-2 (பின்னங்கள்), 10-1-1 (பின்னங்கள்) |
| Decimals                | 6-2-2 (தசமங்கள்), 7-2-1 (தசமங்கள்), 8-2-2 (தசமஎண்)                                                                |
| Ratios & Proportions    | 6-3-0 (விகிதம்), 7-3-0 (விகிதம்), 8-2-3 (விகிதம்), 9-2-0 (நேர் விகிதசமன்), 10-1-2 (நேர்மாறு விகிதசமன்), 10-2-3 (வீதம்) |
| Percentages             | 7-3-1 (சதவீதம்), 8-2-4 (சதவீதம்), 9-1-3 (சதவீதம்), 10-2-0 (சதவீதம்), 11-2-0 (சதவீதம்)                              |
| Directed Numbers        | 7-1-3 (திசைகொண்ட எண்கள்), 8-1-1 (திசைகொண்ட எண்கள்)                                                                |
| Number Patterns         | 6-2-3 (எண் வகைகளும் எண் கோலங்களும்), 8-1-0 (எண் கோலங்கள்), 9-1-0 (எண் கோலங்கள்)                                  |
| Real Numbers            | 11-1-0 (மெய்யெண்கள்)                                                                                                |
| Binary Numbers          | 9-1-1 (துவித எண்கள்)                                                                                                |
| Calculator Use          | 9-2-1 (கணி கருவி)                                                                                                   |
| Shares & Stocks         | 11-2-1 (பங்குகள்)                                                                                                    |

### Module 2 — Algebra, Graphs & Matrices

| Tag                       | Linked units                                                                                                              |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Number Line               | 6-1-0 (எண் கோடு), 8-3-0 (எண்கோடு, தெக்காட்டின் தளம்)                                                                    |
| Algebraic Symbols         | 6-3-0 (அட்சரகணிதக் குறியீடுகள்), 6-3-1 (அட்சரகணிதக் கோவைகள் உருவாக்கலும்)                                                |
| Algebraic Expressions     | 7-2-0 (அட்சரகணிதக் கோவைகள்), 8-1-0 (அட்சரகணிதக் கோவைகள்), 9-1-0 (அட்சரகணிதக் கோவைகள்), 9-1-1 (காரணிகள்)                  |
| Algebraic Fractions       | 9-3-1 (அட்சரகணிதப் பின்னங்கள்), 10-2-0 (அட்சரகணிதப் பின்னங்கள்), 11-1-1 (அட்சரகணிதப் பின்னங்கள்)                          |
| Equations                 | 7-2-1 (சமன்பாடுகளும் சூத்திரங்களும்), 8-2-0 (சமன்பாடுகள்), 9-2-0 (சமன்பாடுகள்), 10-2-1 (சமன்பாடுகள்), 11-2-1 (சமன்பாடுகள்) |
| Formulas                  | 9-2-1 (சூத்திரங்கள்), 10-2-3 (சூத்திரங்கள்)                                                                                |
| Graphs                    | 7-3-0 (தெக்காட்டின் தளம்), 9-2-2 (வரைபுகள்), 10-2-2 (வரைபுகள்), 11-2-0 (வரைபுகள்)                                       |
| Inequalities              | 8-3-1 (சமனிலிகள்), 9-3-0 (சமனிலிகள்), 10-3-1 (அட்சரகணிதச் சமனிலிகள்), 11-3-1 (சமனிலிகள்)                                  |
| Binomial Expressions      | 10-1-0 (ஈருறுப்புக் கோவைகள்), 10-1-1 (இருபடிக் கோவைகளின் காரணிகள்), 11-1-0 (ஈருறுப்புக் கோவைகள்)                          |
| LCM (Algebraic)           | 10-1-2 (பொது மடங்குகளுட் சிறியது)                                                                                          |
| Arithmetic Progression    | 10-3-0 (கூட்டல் விருத்தி)                                                                                                  |
| Geometric Progression     | 11-2-2 (பெருக்கல் விருத்தி)                                                                                                |
| Matrices                  | 11-3-0 (தாயங்கள்)                                                                                                          |

### Module 3 — Geometry & Constructions

| Tag                         | Linked units                                                                                                              |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Circles                     | 6-1-0 (வட்டங்கள்), 7-2-1 (வட்டங்கள்), 8-3-0 (வட்டம்), 9-2-2 (வட்டமொன்றின் பரிதி), 10-3-0 (வட்டத்தின் நாண்கள்), 10-3-2 (வட்டத்தின் கோணங்கள்) |
| Angles                      | 6-1-1 (கோணங்கள்), 7-1-2 (கோணங்கள்), 8-1-0 (கோணம்), 9-1-1 (நேர்கோடுகள், சமாந்தரக்கோடுகள்), 9-2-1 (முக்கோணியொன்றின் கோணங்கள்), 9-3-0 (பல்கோணிகளின் கோணங்கள்) |
| Directions                  | 6-1-2 (திசைகள்), 8-3-1 (திசைகோள்)                                                                                          |
| Symmetry                    | 7-1-0 (இருபக்கச் சமச்சீர்), 8-2-0 (சமச்சீர்)                                                                                |
| Parallel Lines              | 7-1-1 (சமாந்தர நேர்கோடுகள்)                                                                                                 |
| Plane Figures               | 6-2-1 (நேர்கோட்டுத் தளவுருவங்கள்), 7-2-0 (நேர்கோட்டுத் தளவுருவங்கள்)                                                       |
| Solids / 3D                 | 6-2-2 (திண்மங்கள்), 7-3-1 (திண்மங்கள்), 8-1-1 (திண்மங்கள்)                                                                  |
| Constructions               | 7-3-0 (தளவுருவங்களை அமைத்தல்), 8-3-2 (ஒழுக்குகளும் அமைப்புகளும்), 9-2-0 (ஒழுக்குகளும் அமைப்புகளும்), 10-3-1 (அமைப்புகள்), 11-3-3 (அமைப்புகள்) |
| Scale Drawings              | 7-3-2 (அளவிடைப் படங்கள்), 8-3-3 (அளவிடைப்படம்), 9-3-1 (அளவிடைப் படங்கள்), 10-3-3 (அளவிடைப் படம்)                          |
| Tessellations               | 7-3-3 (தெசலாக்கம்)                                                                                                          |
| Triangles                   | 8-2-1 (முக்கோணிகள்), 10-1-0 (முக்கோணிகளின் ஒருங்கிசைவு), 10-1-1 (முக்கோணிகள் I), 10-1-2 (முக்கோணிகள் II)                  |
| Pythagoras                  | 9-2-3 (பைதகரசின் தொடர்பு), 11-3-0 (பைதகரஸ் தேற்றம்)                                                                          |
| Quadrilaterals              | 10-2-0 (இணைகரங்கள் I), 10-2-1 (இணைகரங்கள் II), 11-3-2 (வட்ட நாற்பக்கல்)                                                    |
| Loci                        | 8-3-2 (ஒழுக்குகளும் அமைப்புகளும்), 9-2-0 (ஒழுக்குகளும் அமைப்புகளும்)                                                       |
| Midpoint Theorem            | 11-2-0 (நடுப்புள்ளித் தேற்றம்)                                                                                              |
| Similar Triangles           | 11-2-1 (சமகோண முக்கோணிகள்)                                                                                                  |
| Trigonometry                | 11-3-1 (திரிகோணகணிதம்)                                                                                                      |
| Tangents                    | 11-3-3 (தொடலிகள்) — *verify index*                                                                                          |
| Axiomatic Geometry          | 9-1-0 (வெளிப்படையுண்மைகள்)                                                                                                  |

### Module 4 — Measurements

| Tag                     | Linked units                                                                                                |
| ----------------------- | ----------------------------------------------------------------------------------------------------------- |
| Time                    | 6-1-0 (காலம்), 7-1-0 (காலம்), 8-2-1 (காலம்)                                                                  |
| Length & Perimeter      | 6-2-0 (நீளம்), 7-2-1 (நீளம்), 8-1-0 (சுற்றளவு), 10-1-0 (சுற்றளவு)                                            |
| Liquid Measure          | 6-2-1 (திரவ அளவீடு), 7-2-3 (திரவ அளவீடு), 9-1-0 (திரவ அளவீடு)                                                |
| Mass                    | 6-3-0 (திணிவு), 7-2-0 (திணிவு), 8-1-1 (திணிவு)                                                                |
| Area                    | 6-3-1 (பரப்பளவு), 7-2-2 (பரப்பளவு), 8-2-0 (பரப்பளவு), 9-3-0 (பரப்பளவு), 10-1-1 (பரப்பளவு), 11-1-2 (சமாந்தரக் கோடுகளுக்கிடையில்) |
| Volume & Capacity       | 7-2-3 (கனவளவு), 8-3-0 (கனவளவு, கொள்ளளவு), 11-1-1 (திண்மங்களின் கனவளவு)                                       |
| Surface Area            | 10-3-0 (மேற்பரப்பளவும் கனவளவும்), 11-1-0 (திண்மங்களின் மேற்பரப்பின் பரப்பளவு)                                |

### Module 5 — Statistics

| Tag         | Linked units                                                                                                       |
| ----------- | ------------------------------------------------------------------------------------------------------------------ |
| Statistics  | 6-3-0 (சேகரித்தலும் வகைப்படுத்தலும்), 6-3-1 (விளக்கம் கூறல்), 7-3-0 (வகைப்படுத்தலும் விளக்கம்), 8-3-0 (மைய நாட்ட), 9-3-0 (வகைப்படுத்தலும்), 10-1-0 (வகைப்படுத்தல்), 10-3-0 (எண் பரம்பல்), 11-2-0 (வகைப்படுத்தலும்) |

### Module 6 — Sets & Probability

| Tag         | Linked units                                                                                            |
| ----------- | ------------------------------------------------------------------------------------------------------- |
| Sets        | 7-1-0 (தொடைகள்), 8-2-0 (தொடைகள்), 9-3-0 (தொடைகள்), 10-2-0 (தொடைகள்), 11-3-0 (தொடைகள்)                  |
| Probability | 7-3-0 (நிகழ்வொன்றின் தகுதகவு), 8-3-0 (நிகழ்தகவு), 9-3-1 (நிகழ்தகவு), 10-3-0 (நிகழ்தகவு), 11-3-1 (நிகழ்தகவு) |

### Seed warnings for Sonnet

1. **Verify each `(grade, term, unitIndex)` against `curriculum-data.ts`.** The Tamil names listed above are pasted verbatim from `curriculum context.md` for sanity-check purposes — Sonnet should grep the live file and confirm the index of each unit before inserting. If a unit's position changes, the unitId string changes.
2. **Tags marked `verify index`** above had ambiguous order in the source — re-check the live curriculum data.
3. **Some grades have units that span multiple tags** (e.g. G7 T2 unit 12 "சமன்பாடுகளும் சூத்திரங்களும்" combines Equations + Formulas). Link the unit to **both** tags. The seed handles this by allowing duplicate links across tags (one per (tag,unit) pair).
4. **Grade 8 Term 2 has two consecutive "பின்னங்கள்" units (indices 0 and 1)**: link both to Fractions.
5. **The seed is idempotent**: running it twice is a no-op (returns `{ skipped: true }` on second run). If the user has manually edited tags, the seed will not overwrite — ever. To re-seed, the user would need to clear tags via UI first.

---

## 7. Edge cases

| #  | Case                                                                                                                | Handling                                                                                                                                                                            |
| -- | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1  | User deletes a tag that is linked to past-paper crops                                                               | `topicTags.remove` patches `questionBank.topicTagId = undefined` for every row referencing the tag, deletes `examTopicTagLinks` and `paperStructureSlotTags` rows. Confirm dialog pre-warns "X questions and Y slot configurations will be unlinked"  |
| 2  | User edits a structure part's `questionCount` from 25 down to 20                                                    | `updatePart` cascades: deletes any `paperStructureSlotTags.by_part(id)` with `slotNumber > 20`. `questionBank` rows with the removed slot fields stay (data preserved) but display as "(orphaned)" |
| 3  | User uploads a paper but the structure for that grade doesn't exist yet                                             | Upload allowed. Crop UI shows banner "Set up paper structure for Grade X first" with a CTA to Settings → Exam Structure                                                              |
| 4  | User crops a question, picks topic tag, then changes mind and re-picks a different tag                              | `setTopicTag` patches `topicTagId`. The concept multi-select clears (concepts are tag-scoped); user re-picks                                                                         |
| 5  | A `questionConcepts` row references a concept that's been deleted from `exercises`                                  | Existing `exercises.delete` (Phase 0.2) cascades to `questionConcepts.by_concept_exercise` already. Verified — no change                                                              |
| 6  | Tag name uniqueness check race                                                                                      | `create` and `update` use `withIndex("by_name", q => q.eq("name", normalized))` to find duplicates. Convex mutations are serializable so no TOCTOU window                            |
| 7  | Slot grid renders 25 slots — performance                                                                            | Each slot is a 32px button. 25 fits in a 5-col grid without scrolling on mobile. For G11 Part 1A (25 slots), use 5×5 grid                                                            |
| 8  | Per-paper override sets `questionCount: 8` for G7 Part 2 (alternate variant)                                        | Resolved structure adds 1 extra slot (8 vs default 7). Slot 8 has no permanent / option tags (default structure only had 7); falls back to learned options                          |
| 9  | Concept multi-select shows hundreds of concepts (e.g. Fractions tag links 6 units × ~5 concepts each)               | Group by `(grade, unitId)`, render as collapsible accordion. Mobile-first: default collapsed                                                                                          |
| 10 | Migration of legacy crops (Phase 0.5 era) with free-text `questionNumberInPaper`                                    | Schema-additive — no migration on first deploy. If user has many legacy crops, write `convex/seeds/migrateLegacyPaperCrops.ts` later                                                  |
| 11 | TS strict-mode failures from new optional fields on questionBank                                                    | Ensure both `upsertForPaperSlot` and the existing `upsertForPaperQuestion` set the legacy `questionNumberInPaper` field for backward compat with current list views                  |
| 12 | Seed runs against a populated database                                                                              | Idempotency guard: `query("examTopicTags").take(1)` — skip if any rows exist. Logs `[seedTopicTags] tags already exist, skipping`                                                    |
| 13 | A tag's linked unit is removed from the curriculum (file edit)                                                      | `examTopicTagLinks` row points at a now-stale `unitId` string. Tag detail page shows "(unknown unit)" placeholder. User can manually remove via the picker. No automatic cleanup     |
| 14 | Permanent tag conflicts with concept multi-select                                                                   | The picker still lets the user multi-select concepts within the tag's linked units. Permanent tag does NOT auto-select concepts — concept tagging is always per-question explicit  |
| 15 | Slot tag picker for "options" mode — user adds 5+ options                                                           | UI allows N options. Crop-side picker shows them top-N first; learned ones below. Fine                                                                                                |
| 16 | User wants to change `divisionFactor` for G10 (e.g. mid-year syllabus update)                                       | `updateStructure` recomputes `scaledTotal`. Existing crops unaffected (only display changes)                                                                                          |
| 17 | Deletion of a paper that has crops with `topicTagId` set                                                            | Existing `pastPapers.remove` cascade deletes `questionBank` rows + `questionConcepts`. The `topicTagId` link is implicit (the row goes), no extra cleanup needed                      |
| 18 | The structure builder lets user delete the only part of a structure                                                 | Allow it — the structure can exist with zero parts (placeholder for future setup). Crop UI shows banner if structure has no parts                                                    |

---

## 8. Verification checklist

### 8.1 0.4a — schema + backend + Tags screen + seed

- [ ] `npx convex dev` deploys schema cleanly
- [ ] `npx tsc --noEmit -p tsconfig.json` exits 0
- [ ] `npx convex run seeds/topicTags:seedAll` creates tags + links
- [ ] Convex dashboard shows: ~38 rows in `examTopicTags`, ~145 rows in `examTopicTagLinks`
- [ ] Re-running the seed prints `[seedTopicTags] tags already exist, skipping`
- [ ] Settings → Tags tab loads with the seeded list, grouped/colored by module
- [ ] Tap "Fractions" tag → detail page shows 6 linked units across G6 / G7 / G8 / G9 / G10
- [ ] Tag detail page shows derived concepts grouped by grade (assuming concept-type exercises exist in those units; if none, shows "no concepts seeded yet" — fine for clean DBs)
- [ ] Edit tag name to "Fractions and Decimals" → updates and persists
- [ ] Try to create another tag named "Fractions and Decimals" → toast "Tag name already exists"
- [ ] Add a unit link via the picker → `examTopicTagLinks` row created
- [ ] Remove a unit link → row gone
- [ ] Delete a tag with links → cascade clears `examTopicTagLinks` and any `paperStructureSlotTags` referencing it; questions previously tagged with it have `topicTagId = undefined`

### 8.2 0.4b — Paper Structure + crop integration

- [ ] `npx convex run seeds/paperStructures:seedDefaults` creates 6 structures (one per grade)
- [ ] Settings → Exam Structure tab loads. Pick Grade 10 → 4 parts (1A, 1B, 2A, 2B) with correct counts/marks/required
- [ ] Pick Grade 7 → 2 parts (1, 2) with default G6–G9 config
- [ ] Edit Grade 10 Part 1A Q1 → set permanent tag = Fractions → save → row in `paperStructureSlotTags` with `mode: permanent`
- [ ] Edit same slot → add option = Decimals → row added with `mode: option`
- [ ] Slot grid shows Q1 with permanent indicator + 1 option chip
- [ ] Open a Grade 10 paper → past-paper crop route → structured header shows tabs [1A][1B][2A][2B]; tap [1A] → 25 slot pills
- [ ] Tap Q1 slot → topic tag chip below auto-fills "Fractions" (permanent applied)
- [ ] Draw a crop → `questionBank` row created with `topicTagId`, `paperStructurePartId`, `paperStructureSlotNumber: 1`, denormalized `questionNumberInPaper: "1A.1"`
- [ ] Crop visible on the page with the right label
- [ ] Tap Q3 slot (no permanent, no options) → topic tag chip shows "+ pick tag" → tap → full tag list
- [ ] Pick "Fractions" → after a few cropped Q3s across multiple papers, learned-options query surfaces "Fractions" as suggestion #1
- [ ] After tagging crop with topic, concept multi-select appears below → pick 1 concept → `questionConcepts` row created
- [ ] Re-keying: select an existing crop → tap a different slot → row updates with new slot identity, denormalized number recomputed
- [ ] Per-paper override editor: edit a Grade 7 paper, set Part 2 questionCount = 8, marks = 10 → save → `pastPapers.partOverrides` has the entry → crop UI for that paper shows 8 slots in Part 2
- [ ] G10 paper edit dialog hides the override editor (national structure)
- [ ] `tsc --noEmit` clean
- [ ] Full end-to-end: upload G10 paper → crop 5 questions across slots 1A.1, 1A.5, 1B.2, 2A.3, 2B.1 with topic tags + concepts → dashboard shows correct row counts in `questionBank`, `questionConcepts`, `paperStructureSlotTags`

---

## 9. File-by-file change list

### 9.1 0.4a

| File                                                  | Change                                                                                                                                |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `convex/schema.ts`                                    | Add `examTopicTags`, `examTopicTagLinks`, `paperStructures`, `paperStructureParts`, `paperStructureSlotTags`. Extend `pastPapers` (add `partOverrides`). Extend `questionBank` (add `topicTagId`, `paperStructurePartId`, `paperStructureSlotNumber` + 2 indexes). |
| `convex/topicTags.ts`                                 | **NEW.** CRUD per §4.1 + `getLinkedConcepts` query                                                                                    |
| `convex/paperStructures.ts`                           | **NEW.** CRUD scaffolding per §4.2 (mutations land here in 0.4a, but the screen UI consuming them lands in 0.4b)                      |
| `convex/seeds/topicTags.ts`                           | **NEW.** Idempotent seed function per §4.4                                                                                            |
| `src/components/settings/tags-tab.tsx`                | **NEW.** Tags list + create dialog                                                                                                    |
| `src/components/settings/tag-detail-drawer.tsx`       | **NEW.** Tag detail page (drawer or full route — pick whichever fits Settings IA cleaner; recommend drawer per existing concept drawer pattern) |
| `src/components/settings/tag-unit-picker.tsx`         | **NEW.** Reuse the prereq-picker pattern from `concepts-unit-drawer.tsx` — search across all M·G·T units, multi-select, save → `setUnitLinks`  |
| `src/app/settings/page.tsx`                           | Add new top-level "Tags" tab to the segmented switcher                                                                                |
| `src/lib/types.ts`                                    | Add `TopicTagDoc`, `TopicTagLinkDoc`, `PaperStructureDoc`, `PaperStructurePartDoc`, `PaperStructureSlotTagDoc` type aliases (mirror existing pattern for textbook/paper docs) |

### 9.2 0.4b

| File                                                  | Change                                                                                                              |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `convex/seeds/paperStructures.ts`                     | **NEW.** Seed default G6–G11 structures per §4.5                                                                     |
| `convex/questionBank.ts`                              | Add `upsertForPaperSlot`, `rekeyToPaperSlot`, `setTopicTag`, `setConcepts`, `listByTopicTag`, `listByGradeSlot`      |
| `convex/paperStructures.ts`                           | Add `getLearnedOptionsForSlot`, `getResolvedForPaper`, `setPaperOverrides`                                          |
| `src/components/settings/exam-structure-tab.tsx`      | **NEW.** Grade selector + part editor + slot grid + per-slot config popover                                          |
| `src/components/settings/paper-slot-config-popover.tsx` | **NEW.** The popover for configuring a single slot (permanent / options / learned)                                  |
| `src/components/settings/past-paper-structured-header.tsx` | **NEW.** Replaces `PastPaperPillHeader`. API per §2.7                                                              |
| `src/components/settings/past-paper-tag-picker.tsx`   | **NEW.** Inline tag chip + concept multi-select that appears below the structured header when a slot is active      |
| `src/app/settings/past-paper-crop/[paperId]/page.tsx` | Modified: replace `PastPaperPillHeader` with `PastPaperStructuredHeader`. Wire `upsertForPaperSlot` on draw + `rekeyToPaperSlot` on slot re-pick |
| `src/components/settings/content-tab.tsx`             | Add per-paper override editor inside Add/Edit Paper dialog (visible only for grades 6–9)                            |
| `src/app/settings/page.tsx`                           | Add new top-level "Exam Structure" tab                                                                              |

---

## 10. Out of scope for Phase 0.4

- **Phase B Importance Engine** — the queries that turn this data into per-concept importance scores. Phase B has its own plan.
- **Auto-population of slot tags from past-paper history** ("system suggests 'Fractions' is permanent for Q1 because every Grade 10 paper had Fractions there") — out of scope; user fills slot tags manually. We expose a `getLearnedOptionsForSlot` query that the structure builder *could* surface as a suggestion in a future iteration.
- **Concept-level prerequisite chain across topic tags** — Phase 0.2 already covers prerequisites at concept-exercise level. Tag → tag prereqs (if ever needed) are out of scope.
- **Tag merge / split UI** — if user creates duplicate tags they merge manually by re-linking. Bulk-merge tooling not built.
- **Bulk-tag past-paper crops by parsing existing free-text question numbers** — the migration tool. Only build if legacy crop count > 50.
- **Paper structure variants** (e.g. multiple structures per grade for different exam boards) — current scope is one structure per grade + per-paper overrides. Province / board-specific variants deferred.
- **Tag detail page analytics** ("this tag appears in 32 past-paper questions worth 280 marks") — basic count badge only in 0.4. Importance-score breakdown is Phase B.
- **Tags assigned to textbook crops** — schema supports it (`questionBank.topicTagId` is source-agnostic) but the textbook crop UI is not modified in this phase. Optional follow-up: add the same tag picker to the textbook crop route.

---

## 11. Open items to confirm before 0.4a build starts

1. **Is the strategic interpretation correct?** Phase 0.4 was originally scoped as "concept tagging UI." User has expanded scope to include topic-tag taxonomy + paper structure builder + slot-driven crop UI. Confirmed in conversation 2026-05-02 — this plan reflects the expanded scope.

2. **Tag taxonomy granularity** — the seed proposes ~38 tags. User can prune via UI after seed runs. If seed feels too coarse or too fine, edit `TAG_SEED` before running. Either way the seed is idempotent and skips if any tag exists.

3. **Grade-6–9 structure variant** — current plan: one default structure + per-paper overrides. Alternative: store variants as additional `paperStructures` rows. Confirmed simpler-is-better for now; revisit if "alternate" papers become common.

4. **Migration of legacy free-text crops** — assumed minimal (Phase 0.5 just shipped). If user has 50+ legacy past-paper crops with `questionNumberInPaper` set, write the migration mutation in 0.4b before swapping the crop UI. Confirm count.

5. **Concept picker filtering scope** — when picker is shown for a crop with a topic tag, options are filtered to concepts in the tag's linked units. If user later wants to tag with a concept *outside* the tag's linked units, they'd need to broaden the tag's links first. This is intentional per user spec but verify with user if friction emerges.

6. **Exam Structure tab IA placement** — proposed top-level Settings tab. Alternative: nest under Curriculum. Confirm with user during 0.4a checkpoint before building 0.4b's screen.

If any of these need to change, edit this document, mark the change in the relevant § with a note, and re-confirm before code lands.

---

## 12. Quick reference for fresh Sonnet sessions

You're being asked to execute Phase 0.4 of the Aristora learning engine. Here's the crash course:

- **Aristora** = math tuition app for Grade 6–11 Sri Lankan Tamil-medium students
- **Phase 0** = data foundation; **Phase A** = mastery model; **Phase B** = sheet generator + Importance Engine; **Phase C** = scale + polish
- **Phase 0.5 just shipped** — past papers can be uploaded + cropped with free-text question numbers
- **Phase 0.4 (this phase)** = adds the strategic intelligence layer: topic tags + paper structure + structured crop identity
- **Why now**: without this, past-paper crops are just images. With it, they become measurable signal for the importance algorithm in Phase B.
- **Architecture**: two parallel taxonomies — `examTopicTags` (broad, ~38 tags, links to *units*) + `questionConcepts` (existing, fine-grained, links to *concept-type exercises*). Both are needed for different downstream uses.
- **Stack**: Next.js 16 App Router · TypeScript strict · Convex 1.33 · Clerk 7 · shadcn/ui · Tailwind v4 · dark navy + teal · mobile-first
- **Module colors**: M1 `#1B4F72`, M2 `#6C3483`, M3 `#1E8449`, M4 `#B9770E`, M5 `#C0392B`, M6 `#2E86C1`
- **Tamil**: unit names are in Tamil; everything else is English. Don't translate unit names — render verbatim
- **Things to avoid** (lessons from previous sessions):
  - Never create a parallel `concepts` table — concept = `exercises.type === 'concept'` row
  - No OCR — Tamil encoding unusable
  - Don't break the holdout — current term papers MUST never feed any algorithm
  - Don't change `divisionFactor` semantics without thinking — G10/11 = 2, G6-9 = 1, baked into national exam structure
  - Don't add a UI button for the seed — run via `npx convex run`
  - Don't bulk-merge tags automatically — user has manual control
- **Build order**: 0.4a (schema + backend + Tags screen + seed) → verify → push → 0.4b (Exam Structure screen + crop integration) → verify → push
- **Verification gate before each push**: `npx tsc --noEmit -p tsconfig.json` exits 0, `npx convex dev` deploys cleanly, manual click-through per §8 checklist

Don't ask the user to re-explain context. Everything you need is in this document + the four required-reading files at the top. Build. Ship. Verify. Push.
