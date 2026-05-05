# Phase 0.6 — Concept-tagging enforcement + coverage dashboard — Build Plan

> **For a fresh Sonnet 4.6 session: read this file top-to-bottom before touching any code.** It captures every user decision made during the brainstorm, the strategic role of this phase in the overall learning engine, the exact codebase state assumptions, and the file-by-file plan. When you finish reading, you should be able to execute the build without asking the user to re-explain context.
>
> **Required reading order before this file:**
> 1. `learning_engine_plan.md` — strategic pivot, phase plan, current state. The "what" and "why" of the whole engine.
> 2. `algorithm_plan.md` — algorithm spec for phases 0.5 → H. Note: that file's §Phase 0.6 is the THIN earlier version; this document supersedes and expands it. Do **NOT** modify `algorithm_plan.md`.
> 5. User memory at `C:\Users\Ilham\.claude\projects\C--Users-Ilham-aaa-projects-math-tracker\memory\` — `MEMORY.md` index + `feedback_theme_preference.md` + `feedback_ux_navigation.md`.
>
> **Format per sub-phase, in this order, no prose preamble:**
> 1. **Why** — strategic reasoning Sonnet must internalize before coding.
> 2. **Schema diff** — exact field/index additions (most sub-phases here are zero-schema).
> 3. **Algorithm** — pseudocode / TypeScript with named constants, not English.
> 4. **UI changes** — files to modify, new components, where they live.
> 5. **Edge cases** — bullet list, each paired with handling.
> 6. **Verification** — what query / UI / manual step proves it works.
>
> If a sub-phase is missing one of these blocks, it is not specified enough to ship — escalate to the user, do not guess.

---

## 0. Why this phase exists (read before writing any code)

Phases 0.3, 0.4, 0.5 cropped questions and tagged them with `linkedExerciseId` (textbook side) or `topicTagId` + `paperStructureSlot` (past-paper side). But the algorithm needs **per-concept** tags — fine-grained `questionConcepts` join rows pointing at concept-type `exercises` rows — to compute mastery (Phase A) and importance (Phase B). Today almost no crop has that:

- **Textbook crops:** carry `linkedExerciseId` to their parent exercise row. The exercise row has no concept link in the schema. Path crop → concept is **broken**.
- **Past-paper crops:** carry `topicTagId` (broad topic — `examTopicTags`). Concept tagging via `questionConcepts` is currently optional and almost never set. Path crop → concept is **broken**.
- **Net result:** if `algorithm_plan.md`'s original §Phase 0.6 dashboard shipped today, every concept would be red, because zero crops are reachable from a concept ID.

Phase 0.6 fixes both sides at the source, then surfaces the gaps. Three independently shippable sub-phases:

| Sub-phase | What ships | Outcome |
|---|---|---|
| **0.6a** | Auto-derive textbook concept tags from Details-page row ordering. Zero new schema. Zero data-entry work for the user. | Textbook side of coverage suddenly works. |
| **0.6b** | Mandatory concept tagging on past-paper crops (topic tag without concept tag = forbidden). Difficulty (1..5) input added to both crop UIs. Red overlay on incomplete crops. | Past-paper side of coverage works. New crops can never become "ghost" untagged crops. Difficulty data starts accumulating. |
| **0.6c** | Coverage dashboard at `src/app/algorithm/coverage/page.tsx`. Cumulative term scope (T2 view = T1+T2 concepts). Loud red banner when blocked. Threshold `MIN_QUESTIONS_PER_CONCEPT = 5`. | One page that tells the user exactly what's missing per (grade, term). |

**Ship order:** 0.6a → user confirms → 0.6b → user confirms → 0.6c. Each sub-phase is typecheck-clean (`npx tsc --noEmit -p tsconfig.json` exit 0) before pushing. **Do not bundle.** The user's pattern is one small sub-phase per conversation chunk.

---

## 1. Decisions already made by the user (authoritative)

These came from explicit user answers during planning. If a future session sees a conflict between this plan and anything else, these answers win.

| # | Question | Answer |
|---|---|---|
| 1 | Strict concept tagging or dual-axis topic+concept? | **Strict concept-level only.** Topic-only crops are forbidden after 0.6b. User will manually delete existing topic-only data before 0.6c ships. |
| 2 | Add difficulty (1..5) input to crop UI? | **Yes**, add now in 0.6b. Required at save. |
| 3 | Where does the coverage page live? | `src/app/algorithm/coverage/page.tsx`. Reachable from lead/admin nav. **Not** inside Settings → Data Entry. |
| 4 | Cumulative term scope on coverage view? | **Yes**: T2 view = T1+T2 concepts; T3 view = T1+T2+T3. Matches what the actual Sri Lankan term exam tests. |
| 5 | Loud or quiet hard gate? | **Loud.** Top-of-page red banner when any in-scope concept is gated. |
| 6 | Existing topic-only crops — keep or purge? | User will manually delete topic-only data before 0.6c ships. No backfill mutation needed for those. |
| 7 | Threshold value? | **`MIN_QUESTIONS_PER_CONCEPT = 5`** strict from the start. Don't make it tunable in 0.6 — Phase G's tuning lab is the right place for that. |
| 8 | Exercise → concept linkage stored or derived? | **Auto-derived** from Details-page row ordering (`exercises.order` per `unitId`). No new schema field. No manual tagging step for the user. |
| 9 | Trailing concepts (after the last exercise in a unit)? | **Unlinked.** Surfaced in 0.6c dashboard as orphan warnings, not silently linked to the previous exercise. |
| 10 | Where does the exercise→concept derivation surface in UI? | Read-only display inside the existing Concepts subtab drawer (`concepts-unit-drawer.tsx`). Not editable. |

---

## 2. The auto-derive rule (load-bearing for 0.6a)

The user's textbook ordering convention on the Details page already encodes which concepts belong to which exercise. From the user's own words:

> "If the exercise numbers are 2.1 and 2.2, in-between concepts are related to exercise 2.2. If the unit starts from exercise 2.0 (review exercise), concepts before this exercise are for exercise 2.0. Some units start from 2.1, so concepts before this are related to 2.1. In-between concepts are related to the exercise after them."

Formal rule:

- Within a `unitId`, sort `exercises` rows by `order` ascending. Both `type === "concept"` and `type === "exercise"` rows live in the same `exercises` table and share the `order` field per unit.
- Walk the sorted list once. Maintain a `pendingConcepts` accumulator.
- On a `type === "concept"` row → push to `pendingConcepts`.
- On a `type === "exercise"` row → assign `pendingConcepts` to that exercise's concept set; reset `pendingConcepts = []`.
- After the walk: anything still in `pendingConcepts` = **trailing concepts** = **orphan**. Do not link them anywhere.

Concrete examples (the ones the user gave):

- Unit `[Ex 2.1, Concept-A, Concept-B, Ex 2.2]` → `2.1: []`, `2.2: [A, B]`.
- Unit `[Concept-A, Ex 2.0, Concept-B, Ex 2.1]` (review exercise at start) → `2.0: [A]`, `2.1: [B]`.
- Unit `[Concept-A, Ex 2.1, Concept-B, Ex 2.2]` (no review exercise) → `2.1: [A]`, `2.2: [B]`.
- Unit `[Ex 2.1, Concept-A]` (concept after last exercise) → `2.1: []`, orphan = `[A]`.

The mapping is **never stored**. It is derived at every read. If the user reorders rows on the Details page, the next coverage read recomputes automatically — no migration, no stale state, no explicit invalidation.

---

# Phase 0.6a — Auto-derive textbook concept tags from Details-page order

### Why
After this sub-phase, every textbook crop is reachable from ≥1 concept ID via inheritance through its `linkedExerciseId`. Zero data-entry work for the user — their existing ordering on the Details page IS the mapping. The user does not have to manually tag thousands of exercises.

This is a pure backend addition + a small read-only UI display. No mutations. No schema.

### Schema diff
**None.** Critically: do **NOT** add `exercises.conceptExerciseIds[]` or any other field. The mapping is a derived view of `exercises.order`. Storing it would invite drift between the stored mapping and the current ordering.

### Algorithm

New file: `convex/learningEngine/derivedConcepts.ts`

```ts
// Pure derivation helpers. Called by Phase 0.6c coverage queries and (later)
// the Phase A mastery resolver and Phase D sheet planner. No mutations here.

import { Id, Doc } from "../_generated/dataModel";
import { QueryCtx } from "../_generated/server";

export interface UnitConceptMapping {
  // exerciseId → ordered list of conceptExerciseIds it inherits.
  exerciseToConcepts: Map<Id<"exercises">, Id<"exercises">[]>;
  // conceptExerciseId → the exerciseId that "owns" it, or null if trailing.
  conceptToExercise: Map<Id<"exercises">, Id<"exercises"> | null>;
  // Concepts that appear after the last exercise in the unit. No exercise
  // covers these. 0.6c surfaces them as data-entry warnings.
  orphanConceptIds: Id<"exercises">[];
  // Two rows with identical `order` is a data-entry mistake. Tiebreak applied
  // (creationTime asc) but logged so 0.6c can warn the user.
  duplicateOrderWarnings: Array<{ orderValue: number; ids: Id<"exercises">[] }>;
}

export async function deriveConceptsForUnit(
  ctx: QueryCtx,
  unitId: string,
): Promise<UnitConceptMapping> {
  const rows = await ctx.db
    .query("exercises")
    .withIndex("by_unit", (q) => q.eq("unitId", unitId))
    .collect();

  // Treat undefined `type` as "exercise" for back-compat with pre-0.1 rows
  // that predate the introduction of concept rows.
  const classified = rows
    .map((r) => ({ row: r, t: r.type === "concept" ? "concept" : "exercise" }))
    .sort((a, b) => {
      if (a.row.order !== b.row.order) return a.row.order - b.row.order;
      return a.row._creationTime - b.row._creationTime; // deterministic tiebreak
    });

  // Detect duplicate `order` values (data-entry mistake).
  const orderBuckets = new Map<number, Id<"exercises">[]>();
  for (const c of classified) {
    if (!orderBuckets.has(c.row.order)) orderBuckets.set(c.row.order, []);
    orderBuckets.get(c.row.order)!.push(c.row._id);
  }
  const duplicateOrderWarnings = Array.from(orderBuckets.entries())
    .filter(([, ids]) => ids.length > 1)
    .map(([orderValue, ids]) => ({ orderValue, ids }));

  const exerciseToConcepts = new Map<Id<"exercises">, Id<"exercises">[]>();
  const conceptToExercise = new Map<Id<"exercises">, Id<"exercises"> | null>();
  let pendingConcepts: Id<"exercises">[] = [];

  for (const c of classified) {
    if (c.t === "concept") {
      pendingConcepts.push(c.row._id);
    } else {
      // exercise row — claim all pending concepts.
      exerciseToConcepts.set(c.row._id, [...pendingConcepts]);
      for (const cid of pendingConcepts) conceptToExercise.set(cid, c.row._id);
      pendingConcepts = [];
    }
  }

  // Anything left = trailing concepts = orphan.
  const orphanConceptIds = pendingConcepts;
  for (const cid of orphanConceptIds) conceptToExercise.set(cid, null);

  return { exerciseToConcepts, conceptToExercise, orphanConceptIds, duplicateOrderWarnings };
}

// Inverse helper: given a concept-type exerciseId, return the exercise that
// "owns" it. Returns null for trailing concepts.
export async function exerciseForConcept(
  ctx: QueryCtx,
  conceptExerciseId: Id<"exercises">,
): Promise<Id<"exercises"> | null> {
  const c = await ctx.db.get(conceptExerciseId);
  if (!c || c.type !== "concept") return null;
  const mapping = await deriveConceptsForUnit(ctx, c.unitId);
  return mapping.conceptToExercise.get(conceptExerciseId) ?? null;
}

// The unified read used by Phase 0.6c coverage and (later) by Phase A.
// Returns the full set of questionBank IDs counted as coverage for a concept:
//   - Direct: questionConcepts join rows (past-paper crops, post-0.6b).
//   - Inherited: textbook crops on the parent exercise (auto-derived in 0.6a).
// Deduped by questionBank._id. Past-paper crops with no parent exercise are
// not double-counted because their linkedExerciseId is undefined.
export async function questionsTaggedToConcept(
  ctx: QueryCtx,
  conceptExerciseId: Id<"exercises">,
): Promise<Id<"questionBank">[]> {
  // Path 1: direct join.
  const directJoins = await ctx.db
    .query("questionConcepts")
    .withIndex("by_concept_exercise", (q) =>
      q.eq("conceptExerciseId", conceptExerciseId),
    )
    .collect();
  const directIds = directJoins.map((j) => j.questionId);

  // Path 2: inheritance via the parent exercise of this concept.
  const parentExId = await exerciseForConcept(ctx, conceptExerciseId);
  let inheritedIds: Id<"questionBank">[] = [];
  if (parentExId) {
    const inherited = await ctx.db
      .query("questionBank")
      .withIndex("by_linked_exercise", (q) =>
        q.eq("linkedExerciseId", parentExId),
      )
      .collect();
    // Only textbook crops inherit. Past-paper crops never have linkedExerciseId
    // set, but guard anyway.
    inheritedIds = inherited
      .filter((q) => q.source === "textbook")
      .map((q) => q._id);
  }

  // Dedupe.
  const seen = new Set<string>();
  const all: Id<"questionBank">[] = [];
  for (const id of [...directIds, ...inheritedIds]) {
    const key = id as unknown as string;
    if (!seen.has(key)) {
      seen.add(key);
      all.push(id);
    }
  }
  return all;
}
```

Expose one query from the same file for the UI:

```ts
import { query } from "../_generated/server";
import { v } from "convex/values";

export const getUnitMapping = query({
  args: { unitId: v.string() },
  handler: async (ctx, { unitId }) => {
    const m = await deriveConceptsForUnit(ctx, unitId);
    // Convex queries can't return Maps directly. Serialize to plain arrays.
    return {
      exerciseToConcepts: Array.from(m.exerciseToConcepts.entries()).map(
        ([exerciseId, conceptIds]) => ({ exerciseId, conceptIds }),
      ),
      orphanConceptIds: m.orphanConceptIds,
      duplicateOrderWarnings: m.duplicateOrderWarnings,
    };
  },
});
```

### UI changes
- **`src/components/settings/concepts-unit-drawer.tsx`** (existing, from Phase 0.2): under each exercise row in the unit's drawer, render a read-only chip list "Tests concepts: C1, C2" sourced from `getUnitMapping(unitId).exerciseToConcepts`. Under the orphan section, list any trailing concepts with a small amber pill: "Not covered by any exercise — move above an exercise on the Details page." Editing prereqs stays as-is; this addition is purely informational.
- **No changes to Data Entry tab structure**, no new subtab, no new top-level page in 0.6a.

### Edge cases
- **Unit has only concept rows, no exercises.** All concepts are orphan. UI surfaces all of them under the orphan list. Acceptable; user fixes by adding an exercise row on the Details page.
- **Unit has only exercise rows, no concepts.** Mapping populated with empty arrays. Crops linked to those exercises contribute nothing to concept coverage. Not an error.
- **Unit has exercise rows with no preceding concepts.** Mapping has `exId: []` for that exercise. Crops on it inherit nothing. 0.6c will flag this (red overlay on those crops) so the user can fix the unit's row order.
- **Two rows with identical `order`.** Tiebreak by `_creationTime` ascending (deterministic). Logged in `duplicateOrderWarnings` so 0.6c can show "data-entry warning: rows X and Y share order=N in unit U." Do not crash.
- **`type` field undefined on a row** (legacy data pre-Phase 0.1). Treat as `"exercise"` — that's the historical default before concept rows existed.
- **Reordering on Details page.** The existing Details-page reorder mutates `exercises.order`. The next read of `getUnitMapping` re-derives. No invalidation work needed.
- **Concept appears in multiple units via prereq pointers** (`exercises.prerequisiteExerciseIds`). Irrelevant to derivation — derivation is per-unit only. A concept is "owned" only by its home `unitId`'s next-exercise.
- **Past-paper crops** (`source === "past-paper"`) reaching a concept via this derivation. Cannot happen — past-paper crops have `linkedExerciseId` undefined. They only count via direct `questionConcepts`. The guard in `questionsTaggedToConcept` filters by `source === "textbook"` on the inheritance path defensively.
- **Cross-grade prereq pointer** (concept C in G7 lists C' from G6 as a prereq). Derivation sees C and C' in their own units only. Prereqs are a Phase D concern.

### Verification
- Pick a unit with timeline `[Concept-A, Concept-B, Ex 2.1, Concept-C, Ex 2.2]` on the Details page. Call `getUnitMapping(unitId)`:
  - `exerciseToConcepts` for `Ex 2.1` = `[A, B]`; for `Ex 2.2` = `[C]`. `orphanConceptIds` = `[]`. `duplicateOrderWarnings` = `[]`.
- Pick a unit ending `[..., Ex 2.2, Concept-D]`:
  - `Ex 2.2: [...]`, `orphanConceptIds: [D]`.
- Add a textbook crop linked to `Ex 2.1` (no `questionConcepts` row). Call `questionsTaggedToConcept(A)` → returns the crop. Call `questionsTaggedToConcept(D)` → empty.
- Open the Concepts subtab drawer for the unit. Under `Ex 2.1` see "Tests concepts: A, B" pill. Under `Ex 2.2` see "Tests concepts: C" pill. The orphan section lists `D` with the data-entry warning.
- Reorder rows on the Details page so `D` is now between `Ex 2.1` and `Ex 2.2`. Reload drawer → orphan list empty, `Ex 2.2` now shows `[C, D]`.
- `npx tsc --noEmit -p tsconfig.json` → exit 0.

---

# Phase 0.6b — Mandatory concept tagging on past-paper crops + difficulty input

### Why
Past-paper crops have no parent exercise to inherit from, so they need direct concept tags via `questionConcepts`. Today the past-paper crop UI sets `topicTagId` (broad) but not concepts. Strict policy from the user: every past-paper crop must reach ≥1 concept, full stop. Topic tag without concept tag = forbidden.

Difficulty input is added to **both** crop UIs (textbook and past-paper) at the same time because:
- Phase 0.6c's coverage histogram needs it.
- Phase A's mastery formula weights attempts by difficulty (`weight = 0.6 + 0.2 * difficulty`); silently defaulting unset to 3 would bias the model.
- Adding it once now in one shared component is cheaper than retrofitting later.

### Schema diff
**None.** All required fields already exist:
- `questionBank.difficulty?: number` (already optional in schema; this phase makes it required at save time via UI enforcement)
- `questionBank.topicTagId?: Id<"examTopicTags">` (already exists)
- `questionConcepts.{questionId, conceptExerciseId}` (already exists)

### Algorithm

**Concept-candidate resolver** — given a `topicTagId`, return the multi-select options the past-paper crop UI should show. New file `convex/learningEngine/topicConceptOptions.ts`:

```ts
import { query } from "../_generated/server";
import { v } from "convex/values";

export const conceptOptionsForTopic = query({
  args: { topicTagId: v.id("examTopicTags") },
  handler: async (ctx, { topicTagId }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];

    const links = await ctx.db
      .query("examTopicTagLinks")
      .withIndex("by_tag", (q) => q.eq("tagId", topicTagId))
      .collect();
    const unitIds = links.map((l) => l.unitId);

    // Pull all concept-type exercise rows in those units. Past papers can
    // legitimately test concepts from any grade ≤ paper.grade (downgraded
    // students re-cover earlier grades), so we don't filter by grade here —
    // the picker shows all concepts under all linked units, sorted for stable
    // UI display.
    const all: Array<{ _id: any; name: string; unitId: string; order: number }> = [];
    for (const uId of unitIds) {
      const rows = await ctx.db
        .query("exercises")
        .withIndex("by_unit", (q) => q.eq("unitId", uId))
        .collect();
      for (const r of rows) {
        if (r.type === "concept") {
          all.push({ _id: r._id, name: r.name, unitId: r.unitId, order: r.order });
        }
      }
    }
    // Stable sort: by unitId then order.
    all.sort((a, b) =>
      a.unitId === b.unitId ? a.order - b.order : a.unitId < b.unitId ? -1 : 1,
    );
    return all.map((c) => ({
      conceptId: c._id,
      name: c.name,
      unitId: c.unitId,
      order: c.order,
    }));
  },
});
```

**Crop completeness predicate.** Used by the page-overlay rendering. Implementation: extend the existing list queries in `convex/questionBank.ts` (or add siblings) to additionally return, per crop, a `completeness: { hasConcept, hasDifficulty }` field computed in the query. Avoids N+1 calls from the client.

```ts
// convex/questionBank.ts — sibling query
import { deriveConceptsForUnit } from "./learningEngine/derivedConcepts";

export const listByPaperWithCompleteness = query({
  args: { pastPaperId: v.id("pastPapers") },
  handler: async (ctx, { pastPaperId }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const crops = await ctx.db
      .query("questionBank")
      .withIndex("by_past_paper", (q) => q.eq("pastPaperId", pastPaperId))
      .collect();
    return await Promise.all(
      crops.map(async (c) => {
        const joins = await ctx.db
          .query("questionConcepts")
          .withIndex("by_question", (q) => q.eq("questionId", c._id))
          .collect();
        return {
          ...c,
          completeness: {
            hasConcept: joins.length > 0,
            hasDifficulty: c.difficulty !== undefined,
          },
        };
      }),
    );
  },
});

export const listByPageWithCompleteness = query({
  args: { textbookPageId: v.id("textbookPages") },
  handler: async (ctx, { textbookPageId }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const crops = await ctx.db
      .query("questionBank")
      .withIndex("by_textbook_page", (q) => q.eq("textbookPageId", textbookPageId))
      .collect();
    // For textbook crops, "hasConcept" means the parent exercise has at least
    // one inherited concept via the 0.6a derivation. Cache per-unit mapping
    // so we don't re-derive for every crop on the page.
    const unitCache = new Map<string, Awaited<ReturnType<typeof deriveConceptsForUnit>>>();
    return await Promise.all(
      crops.map(async (c) => {
        let hasConcept = false;
        if (c.linkedExerciseId) {
          const ex = await ctx.db.get(c.linkedExerciseId);
          if (ex) {
            let mapping = unitCache.get(ex.unitId);
            if (!mapping) {
              mapping = await deriveConceptsForUnit(ctx, ex.unitId);
              unitCache.set(ex.unitId, mapping);
            }
            hasConcept = (mapping.exerciseToConcepts.get(ex._id)?.length ?? 0) > 0;
          }
        }
        return {
          ...c,
          completeness: {
            hasConcept,
            hasDifficulty: c.difficulty !== undefined,
          },
        };
      }),
    );
  },
});
```

**Backend difficulty validation.** Add a clamp check anywhere `difficulty` is accepted (`create`, `update`, `upsertForExerciseKey`, `upsertForPaperSlot`, `upsertForPaperQuestion`):

```ts
if (
  args.difficulty !== undefined &&
  (args.difficulty < 1 || args.difficulty > 5 || !Number.isInteger(args.difficulty))
) {
  throw new Error("difficulty must be an integer 1..5");
}
```

If `upsertForPaperSlot` and `upsertForExerciseKey` don't already accept `difficulty` in their args, extend them to accept and persist it.

### UI changes

**Shared difficulty picker** — new file `src/components/settings/difficulty-picker.tsx`:
- Five-pill segmented control: 1 / 2 / 3 / 4 / 5.
- Color ramp from green (1) → red (5) using existing theme palette.
- `value: number | undefined` and `onChange: (n: number) => void` props.
- Required at save — parent component disables save when `value === undefined`.
- Reused by both textbook and past-paper crop tools to avoid drift.

**Past-paper tag picker** — extend `src/components/settings/past-paper-tag-picker.tsx`:
- After topic tag is picked, render a concept multi-select inline. Source: `conceptOptionsForTopic(topicTagId)`.
- Multi-select grouped by `unitId`, with module color stripe per group (use `MODULE_COLORS` from `src/lib/types.ts`; module ID is `unitId.split("-")[0]`).
- Save button disabled until ≥1 concept is picked AND difficulty is picked.
- On save, call:
  - `questionBank.upsertForPaperSlot({...})` (existing) with `difficulty` parameter newly added.
  - `questionBank.setConcepts({ id, conceptExerciseIds })` (existing).
- On topic-tag change with already-selected concepts: re-fetch `conceptOptionsForTopic` for the new tag and pre-check only those that survive in the new option set; user must re-confirm.

**Past-paper page overlay** — `src/components/settings/page-crop-overlay.tsx` (or its past-paper counterpart, if separate):
- Switch to `listByPaperWithCompleteness`.
- For each crop: if `!completeness.hasConcept || !completeness.hasDifficulty`, render the rectangle with a solid red border + red translucent fill (instead of the topic tag's color). Tooltip: "Incomplete: needs concept tag and/or difficulty."
- Tap an incomplete crop → opens the past-paper tag picker pre-loaded with the crop's current state.

**Textbook crop tool** — `src/components/settings/crop-tool-toolbar.tsx`:
- Add the shared `<DifficultyPicker>` into the toolbar.
- On save: include `difficulty` in `upsertForExerciseKey` payload.

**Textbook page overlay** — same red-overlay logic as past-paper, using `listByPageWithCompleteness`. A textbook crop's completeness check is `hasDifficulty AND hasConcept` (where `hasConcept` is derived from the 0.6a inheritance path). If the parent exercise has no inherited concepts, the crop renders red with the tooltip: "Parent exercise has no concepts inherited from unit ordering — fix unit row order on the Details page."

### Edge cases
- **Topic tag has zero `examTopicTagLinks` rows.** `conceptOptionsForTopic` returns `[]`. Concept picker is empty → user cannot satisfy ≥1 concept → block save with explicit message: "This topic tag has no curriculum units linked. Open the Tags tab to fix." Do not silently allow save.
- **Topic tag links to units with no concept-type rows.** Same — empty picker, block save. Message: "Linked units have no concepts defined yet. Open the Concepts subtab in Data Entry."
- **User wants to tag a concept outside the topic's unit list.** Not allowed — picker is constrained to topic's linked units. User must edit the topic's link list first (Tags tab). Why: keeps the topic taxonomy honest; otherwise topic tags become decorative.
- **Existing past-paper crops created before 0.6b** (have `topicTagId`, no concept tags, no difficulty). Render red. User must open each and complete it. **No automatic backfill mutation.** The user explicitly said they will manually clean up topic-only data; the red overlay IS the migration prompt.
- **Existing past-paper crops with no `topicTagId` at all.** Also render red. Click → topic tag picker first, then concept picker, then difficulty.
- **Existing textbook crops with no difficulty.** Red overlay. Click → difficulty picker only (concepts inherited automatically once parent exercise is in the unit's order chain).
- **Existing textbook crops linked to an exercise whose unit has no concepts upstream of it** (orphan exercise). Red overlay regardless of difficulty. User fixes by editing the unit's row order on the Details page so a concept appears before this exercise.
- **Sub-question crops** (`linkedQuestionKey === "1.a"`, `"3.iii"`). Each is its own `questionBank` row, each carries its own difficulty and (for past-paper) concepts. No special handling.
- **Concept multi-select submits zero items.** UI prevents — save button disabled.
- **Removing `topicTagId` from a past-paper crop that still has concept tags.** Allowed; concept tags survive (they're the more specific anchor). Crop stays non-red.
- **Removing all concept tags from a past-paper crop.** Crop becomes red immediately. The picker won't allow you to land here from the save flow (≥1 required), but `setConcepts({ id, conceptExerciseIds: [] })` would. The red overlay catches it.
- **Difficulty value out of range** (e.g., 0 or 6 from a stale client). Backend validates and throws. UI never produces out-of-range values.
- **Past-paper crop tagged to a concept whose unit was deleted later.** The `questionConcepts` row dangles; `questionsTaggedToConcept` handles missing concepts gracefully because Convex's `db.get` returns `null` (not thrown). Concept-deletion cascade is out of 0.6 scope.

### Verification
- Open a past-paper crop UI for a paper that has existing topic-only crops. Page overlay: every crop is red. Click one → past-paper tag picker opens, concept multi-select visible, difficulty picker visible. Save disabled until both are set. Set both → save → overlay turns to topic tag color.
- Try to save a brand-new past-paper crop with topic but no concept → save disabled with reason text.
- Try to save a past-paper crop with concept but no difficulty → save disabled.
- Pick a topic tag whose linked units have no concept rows → empty picker with explanatory message; save blocked.
- Open textbook crop UI on a unit whose Details-page order has been set up. Existing crops with no difficulty → red. Set difficulty → green/default color. Inherited concepts shown read-only as chips.
- Open textbook crop UI on a unit where the user has placed an exercise row before any concept rows. That exercise's crops render red with the "Parent exercise has no concepts inherited" message even after difficulty is set.
- Database check: `questionBank.difficulty` for newly saved crops is in `{1, 2, 3, 4, 5}`. `questionConcepts` rows exist for every saved past-paper crop.
- `npx tsc --noEmit -p tsconfig.json` → exit 0.

---

# Phase 0.6c — Coverage dashboard (the visible gate)

### Why
After 0.6a + 0.6b, every newly-saved crop is reachable from a concept ID and difficulty is captured. Now we visualize coverage so the user can see at a glance: for each (grade, term), which concepts are below threshold, by how much, and how the available crops break down by source and difficulty.

The dashboard is **read-only** — no delete or edit actions on this page. The user fixes gaps by going back to the cropping/tagging UIs; deep links from each red concept point them at the right place.

The page is the **visible gate** for Phase D. Phase D's actual code-level gate (refusing to generate sheets when `gatedCount > 0`) is implemented inside Phase D itself. **0.6c only visualizes — it must NOT introduce a code-level block on any other phase.**

### Schema diff
**None.**

Add a constants file if it doesn't exist:

```ts
// convex/learningEngine/config.ts
export const MIN_QUESTIONS_PER_CONCEPT = 5;
```

(This file will accumulate more constants in Phase A. For 0.6c, this single constant is enough.)

### Algorithm

**Cumulative term scope.** "G7 T2" view = T1+T2 concepts; "G7 T3" = T1+T2+T3; "G7 T1" = T1 only. The user confirmed this matches what each Sri Lankan term exam actually tests.

**Curriculum unit resolver.** The coverage query needs the list of `unitId`s for a given (grade, term). Backend cannot import from `src/lib/curriculum-data.ts`. Two options:
- **(a)** Caller passes `unitIds: string[]` resolved client-side from `curriculum-data.ts`. Query stays pure and decoupled.
- **(b)** Mirror the curriculum unit metadata into a Convex table at seed time and query that.

**Choose (a)** for 0.6c. The page is the only caller; option (b) would add a seed/migration step that's out of scope.

**Main query** — new file `convex/learningEngine/coverage.ts`:

```ts
import { query } from "../_generated/server";
import { v } from "convex/values";
import { Id } from "../_generated/dataModel";
import {
  deriveConceptsForUnit,
  questionsTaggedToConcept,
} from "./derivedConcepts";
import { MIN_QUESTIONS_PER_CONCEPT } from "./config";

export const coverageByGradeTerm = query({
  args: {
    grade: v.number(),
    term: v.number(),                  // 1 | 2 | 3
    unitIds: v.array(v.string()),      // resolved client-side from curriculum-data.ts
                                        // for ALL terms in scope (cumulative)
  },
  handler: async (ctx, { grade, term, unitIds }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;

    // 1) Pull all concept-type exercises in scope.
    type ConceptRow = {
      _id: Id<"exercises">;
      name: string;
      unitId: string;
      order: number;
    };
    const concepts: ConceptRow[] = [];
    for (const uId of unitIds) {
      const rows = await ctx.db
        .query("exercises")
        .withIndex("by_unit", (q) => q.eq("unitId", uId))
        .collect();
      for (const r of rows) {
        if (r.type === "concept") {
          concepts.push({ _id: r._id, name: r.name, unitId: r.unitId, order: r.order });
        }
      }
    }

    // 2) For each concept, compute coverage.
    type CoverageRow = {
      conceptId: Id<"exercises">;
      conceptName: string;
      unitId: string;
      total: number;
      byDifficulty: { 1: number; 2: number; 3: number; 4: number; 5: number; unset: number };
      bySource: { textbook: number; past_paper: number; teacher_authored: number };
      isGated: boolean;
      hasNoHardQuestions: boolean;
    };
    const rows: CoverageRow[] = [];

    for (const c of concepts) {
      const qIds = await questionsTaggedToConcept(ctx, c._id);
      const byDifficulty = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, unset: 0 };
      const bySource = { textbook: 0, past_paper: 0, teacher_authored: 0 };
      for (const qId of qIds) {
        const q = await ctx.db.get(qId);
        if (!q) continue;
        const d = q.difficulty;
        if (d === 1 || d === 2 || d === 3 || d === 4 || d === 5) byDifficulty[d] += 1;
        else byDifficulty.unset += 1;
        if (q.source === "textbook") bySource.textbook += 1;
        else if (q.source === "past-paper") bySource.past_paper += 1;
        else if (q.source === "teacher-authored") bySource.teacher_authored += 1;
      }
      const total = qIds.length;
      rows.push({
        conceptId: c._id,
        conceptName: c.name,
        unitId: c.unitId,
        total,
        byDifficulty,
        bySource,
        isGated: total < MIN_QUESTIONS_PER_CONCEPT,
        hasNoHardQuestions:
          total >= MIN_QUESTIONS_PER_CONCEPT &&
          byDifficulty[4] + byDifficulty[5] === 0,
      });
    }

    // 3) Detect orphans across all in-scope units (re-uses 0.6a derivation).
    const orphanConceptIds: Id<"exercises">[] = [];
    const duplicateOrderWarnings: Array<{
      unitId: string;
      orderValue: number;
      ids: Id<"exercises">[];
    }> = [];
    for (const uId of unitIds) {
      const m = await deriveConceptsForUnit(ctx, uId);
      orphanConceptIds.push(...m.orphanConceptIds);
      for (const w of m.duplicateOrderWarnings) {
        duplicateOrderWarnings.push({ unitId: uId, ...w });
      }
    }

    // 4) Aggregate.
    const gatedCount = rows.filter((r) => r.isGated).length;
    const orphanCount = orphanConceptIds.length;
    const noHardCount = rows.filter((r) => r.hasNoHardQuestions).length;

    return {
      grade,
      term,
      threshold: MIN_QUESTIONS_PER_CONCEPT,
      rows,
      orphanConceptIds,
      duplicateOrderWarnings,
      gatedCount,
      orphanCount,
      noHardCount,
      isPhaseDBlocked: gatedCount > 0 || orphanCount > 0,
    };
  },
});
```

### UI — `src/app/algorithm/coverage/page.tsx`

**Layout (mobile-first, dark navy + teal per `feedback_theme_preference.md`):**

- **Header strip:** grade selector (6..11) × term selector (1, 2, 3). Default: G7 T1 on first load. Selection persists in URL search params (`?g=7&t=1`).
- **Loud banner** — only when `isPhaseDBlocked === true`:
  > **Sheet generation is BLOCKED for G{grade} Term {term}**
  > {gatedCount} concept(s) under threshold (need ≥{threshold} questions each)
  > {orphanCount} orphan concept(s) — fix unit ordering on the Details page
  > {noHardCount} concept(s) have no difficulty 4–5 questions — exam-prep slot will be weak

  Red full-width banner. Top of page. Each line conditional on its count > 0. When `gatedCount === 0 && orphanCount === 0` but `noHardCount > 0`, render an amber advisory banner (not red) with only the noHard line.
- **Per-module sections (M1–M6):** group `rows` by their `unitId.split("-")[0]` module ID. Module color stripe (use `MODULE_COLORS` from `src/lib/types.ts`).
- **Per-unit cards inside each module section:** one card per unique `unitId`, in display order. Card title = unit name (resolve via `findUnit(unitId)` from `src/lib/curriculum-data.ts`). Card body = horizontal heat strip — one dot per concept row in that unit:
  - Red: `total < 5`
  - Amber: `5 ≤ total < 10`
  - Green: `10 ≤ total < 20`
  - Deep green: `total ≥ 20`
  - Grey: orphan (in `orphanConceptIds`)
- **Tap a dot** → side panel (mobile: bottom sheet) showing:
  - Concept name, unit, module
  - `total`, "Needs N more" if gated (where N = `threshold - total`)
  - Difficulty histogram: six bars (1, 2, 3, 4, 5, unset) with counts
  - Source breakdown: textbook / past-paper / teacher-authored
  - "No hard questions" warning if `hasNoHardQuestions`
  - **Two deep-link buttons:**
    - "Crop more from past papers" → routes to past-paper crop UI, filtered to papers tagged with topics linking to this concept's unit
    - "Crop more from textbook" → routes to textbook crop UI on the parent exercise (use `exerciseForConcept` to find it)
- **Orphan section** at the bottom of each affected unit's card: lists trailing concepts with a "Fix on Details page" hint that deep-links to the Details subtab for that unit.
- **Data-entry warnings section** at the very bottom, only if `duplicateOrderWarnings.length > 0`: lists units with duplicate `order` values.

**Component structure:**
- `src/app/algorithm/coverage/page.tsx` — top-level route, owns selectors and URL state.
- `src/components/coverage/coverage-banner.tsx` — the loud banner.
- `src/components/coverage/unit-coverage-card.tsx` — per-unit card with heat strip.
- `src/components/coverage/concept-detail-panel.tsx` — side panel / bottom sheet.
- `src/components/coverage/orphan-list.tsx` — orphan + duplicate-order warnings.

**Navigation:** add a single nav entry "Coverage" in the lead/admin sidebar pointing to `/algorithm/coverage`. Do **not** put it inside Settings.

### Edge cases
- **Selected (grade, term) has zero in-scope unit IDs** (curriculum incomplete or empty). Empty state: "No concepts defined for G{grade} Term {term}." Banner not shown (nothing to gate).
- **Concept appears across multiple in-scope units** (same `conceptExerciseId` returned twice). Should not happen because each `exercises` row has exactly one `unitId`. Defensive dedupe in the query is unnecessary but safe to add (`Map<conceptId, row>`).
- **Concept with 0 questions.** Red dot, counted in `gatedCount`, banner reflects.
- **Concept with 5+ questions all difficulty 1 or 2.** Total clears the gate (not red), but `hasNoHardQuestions` triggers — concept appears as a green dot with a warning badge in the side panel.
- **Past-paper crop tagged to a concept whose unit is OUTSIDE the (grade, term) scope** (e.g., a G6 paper question tagged to a G7 concept). Counts toward the G7 concept's total because we count by `conceptId`, not by source-paper grade. This is correct — the question still tests that concept.
- **Past-paper crop tagged to a concept whose unit is IN scope but the source-paper is from a different module.** Cross-module crops are valid and counted; past papers cross modules freely.
- **Orphan trailing concept.** Listed in the orphan section, dot grey on its unit card. Counts toward `orphanCount` for the banner. Does NOT additionally count toward `gatedCount` — orphans are a separate category of broken (data-entry, not coverage).
- **Unit metadata mismatch** (a `unitId` exists in `curriculum-data.ts` but no `exercises` rows). Card empty, no concepts; not flagged as broken (some units are legitimately empty in early data entry). The page shows "no concepts defined" inside the card.
- **Duplicate-order warnings** (from 0.6a). Surfaced in the data-entry warnings section. Doesn't block; informational.
- **Reactive recompute.** Convex queries are reactive; cropping more in another tab updates this page live. No manual refresh needed.
- **Performance.** Worst case ~80 concepts × ~50 crops average per (grade × term scope ≤ 3 terms) = ~12,000 row reads. At Convex's read budget this is fine. If a single page-load latency exceeds ~500ms, switch the inner `for` loop to use batched `Promise.all` over concepts. Do **not** materialize coverage into a separate table.
- **Banner shows zero gated, zero orphan, but `noHardCount > 0`.** Render amber advisory banner instead of red blocking banner. `isPhaseDBlocked` is false in this case — Phase D will run, but exam-prep slots are weak.

### Verification
- Empty database: open `/algorithm/coverage?g=7&t=1`. All concepts red, banner shows full count, banner is red.
- Crop 5 textbook questions on exercise `Ex 2.1` of unit `M1-G7-T1-3`, all difficulty 3, no past-paper crops. After 0.6a inheritance, concepts inheriting `Ex 2.1` turn amber/green. Banner gated count drops by that many concepts.
- Crop 5 past-paper questions tagged to one concept C, mix of difficulties 1..5. C turns deep-green, no `hasNoHardQuestions` warning.
- Add 5 crops at difficulty 1 only on a fresh concept → green for total but warning "no hard questions" shows in side panel; banner gains an amber line.
- Reorder Details page so a previously-trailing concept is now between two exercises → orphan list shrinks, that concept now inherits crops, color updates without page reload.
- Switch from G7 T1 to G7 T2 → concept list grows to include T1+T2 concepts. Switch to T3 → all three.
- Click a red dot → side panel shows correct counts. Click "Crop more from past papers" → routes to past-paper crop UI filtered appropriately.
- `npx tsc --noEmit -p tsconfig.json` → exit 0.

---

## How 0.6 unblocks Phase D (forward reference, NOT work to do here)

After all three sub-phases ship and the user has cropped enough to clear the gate per (grade, term):

- Phase D's `candidatePool` (algorithm_plan §D.1) calls `questionsTaggedToConcept(conceptId)` from `convex/learningEngine/derivedConcepts.ts` and gets a non-empty list per concept.
- Phase D's gate check calls `coverageByGradeTerm(grade, term, unitIds).isPhaseDBlocked` and refuses to generate sheets when `true`.
- Difficulty histograms feed Phase D's "fit" scoring (algorithm_plan §D — `W_FIT = 0.20` weight + `FIT_SIGMA = 1.5`).

These are **forward references for Phase D**, not work to be done in 0.6.

---

## Things explicitly NOT in 0.6 (do not let scope creep)

- **Storing the derived exercise→concept mapping.** Pure derivation only. If query performance becomes an issue later, materialize then; not now.
- **Manual override of the auto-derived mapping.** Phase G concern when tuning data exists. Until then, the Details-page row order is the single source of truth.
- **Editing concepts or topic tags from the coverage page.** Done in Concepts subtab (Phase 0.2) and Tags tab (Phase 0.4b), respectively. Coverage page is read-only.
- **Backfill of difficulty on existing crops.** No mutation. The user fills retroactively as they review coverage gaps. The red overlay IS the prompt.
- **Coverage at the topic-tag level.** Topic-only crops are forbidden after 0.6b; coverage is concept-level only. The user is manually purging topic-only crops from the database before 0.6c ships.
- **Cross-grade coverage view** ("all of G7 + G6 prerequisites for downgraded students"). Phase C concern (student profile).
- **A `learningConfig` table or tuning UI for `MIN_QUESTIONS_PER_CONCEPT`.** Constant in code for now. Phase G migrates constants to a table.
- **Cycle detection on `prerequisiteExerciseIds`.** Phase G concern.
- **A "Triage incomplete crops" walkthrough mode** that steps through every red crop. Stretch goal — implement only if 0.6b backlog volume requires it.
- **Modifying `algorithm_plan.md` or `learning_engine_plan.md`.** This document supersedes the thin §0.6 in `algorithm_plan.md`. Do not edit those files.

---

## File-by-file changes summary (what Sonnet writes)

### 0.6a
- **NEW** `convex/learningEngine/derivedConcepts.ts` — derivation helpers (`deriveConceptsForUnit`, `exerciseForConcept`, `questionsTaggedToConcept`) + `getUnitMapping` query.
- **MODIFY** `src/components/settings/concepts-unit-drawer.tsx` — add read-only "Tests concepts" pill list under each exercise row; add orphan section.

### 0.6b
- **NEW** `convex/learningEngine/topicConceptOptions.ts` — `conceptOptionsForTopic` query.
- **NEW** `src/components/settings/difficulty-picker.tsx` — shared 5-pill component.
- **MODIFY** `convex/questionBank.ts` — add `listByPaperWithCompleteness` and `listByPageWithCompleteness` queries; verify and (if needed) extend `upsertForPaperSlot` and `upsertForExerciseKey` to accept `difficulty`; add backend clamp validation on difficulty in every mutation that accepts it.
- **MODIFY** `src/components/settings/past-paper-tag-picker.tsx` — add concept multi-select; integrate `<DifficultyPicker>`; enforce required validation.
- **MODIFY** `src/components/settings/page-crop-overlay.tsx` (and any past-paper sibling overlay component) — switch to completeness-aware queries; render red overlay on incomplete crops.
- **MODIFY** `src/components/settings/crop-tool-toolbar.tsx` — add `<DifficultyPicker>` to textbook crop tool; integrate into save flow.

### 0.6c
- **NEW** `convex/learningEngine/config.ts` — exports `MIN_QUESTIONS_PER_CONCEPT = 5`.
- **NEW** `convex/learningEngine/coverage.ts` — `coverageByGradeTerm` query.
- **NEW** `src/app/algorithm/coverage/page.tsx` — coverage page route with grade/term selectors and URL state.
- **NEW** `src/components/coverage/coverage-banner.tsx`
- **NEW** `src/components/coverage/unit-coverage-card.tsx`
- **NEW** `src/components/coverage/concept-detail-panel.tsx`
- **NEW** `src/components/coverage/orphan-list.tsx`
- **MODIFY** lead/admin sidebar (locate by searching for the existing `/lead` route's nav component) — add "Coverage" link pointing to `/algorithm/coverage`.

---

## Conventions Sonnet must respect

- Mobile-first UI, dark navy + teal palette per `feedback_theme_preference.md`.
- Module colors from `src/lib/types.ts` (`MODULE_COLORS`): M1 `#1B4F72`, M2 `#6C3483`, M3 `#1E8449`, M4 `#B9770E`, M5 `#C0392B`, M6 `#2E86C1`.
- Tamil unit names preserved; everything else English.
- No emojis in code or UI unless the user asks.
- All Convex mutations and queries auth-gated via `ctx.auth.getUserIdentity()` — same pattern as `convex/doubts.ts` and `convex/questionBank.ts`. Queries return `[]` or `null` when unauthenticated; mutations throw.
- After every sub-phase: `npx tsc --noEmit -p tsconfig.json` → exit 0 before pushing.
- Ship sub-phases independently. Wait for explicit user confirmation between 0.6a → 0.6b → 0.6c. Do not bundle.
- Do **not** add a parallel `concepts` table.
- Do **not** add `exercises.conceptExerciseIds[]` or any field that stores the derived mapping.
- Do **not** plan any OCR path (Tamil encoding is unusable; coords-only crops).
- Do **not** modify `algorithm_plan.md`, `learning_engine_plan.md`, or `phase_0_4_plan.md` without explicit user request.

---

## Summary for the impatient

Phase 0.6 is in **three sub-phases**, shipped one at a time:

1. **0.6a** — pure derivation file `convex/learningEngine/derivedConcepts.ts`. Derives exercise→concept mapping from `exercises.order`. Read-only display in Concepts subtab drawer. No schema, no mutations, no data work for the user.
2. **0.6b** — past-paper crops require concept tag (multi-select from topic's linked units' concepts). Difficulty 1..5 required on both textbook and past-paper crops. Incomplete crops render red on page overlays. New shared `<DifficultyPicker>` component.
3. **0.6c** — `/algorithm/coverage` page. Cumulative term scope (T2 = T1+T2). Loud red banner when blocked at threshold 5. Per-module per-unit heat strips with concept-level drill-down. Read-only. Deep-links into cropping UIs.

Don't store the derived mapping. Don't allow topic-only crops. Don't put the dashboard in Settings. Don't backfill old crops automatically. Don't modify the algorithm_plan or learning_engine_plan files.
