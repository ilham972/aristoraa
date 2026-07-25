# Details Studio — one-screen data-entry + crop tab

Date: 2026-07-25 · Status: approved by founder (build separately, don't touch existing tabs)

## Problem

The Data Entry → Details layer is the hub for per-exercise data (question count,
page range, sub-question Parts, theory/concept names) and for launching the
crop tool. The workflow is hub-and-spoke: the book is hidden behind a drawer,
counts/parts are typed blind, and every exercise costs 2–3 route-hops into
`/settings/crop/[unitId]?exerciseId=…` and back. The Book tab proved the fix:
keep the book on screen, tap instead of type, one flow with auto-advance.

## Decision

Build a NEW top-level Settings tab ("Details", key `details-studio`) as a
one-screen studio. The existing Data Entry tab and crop route stay untouched
and remain the stable fallback until the founder retires them. Only additive
change outside new files: registering the tab in `src/app/settings/page.tsx`.

## Layout (mobile-first, max-w-lg, fullscreen focus mode like Book tab)

1. **Header**: book badges (shared sessionStorage key `dataEntry.selectedBookId`)
   + fullscreen toggle (NavVisibility, same as Book tab).
2. **Unit pill strip**: unit number + progress dot — green when every exercise
   has a count and all crop keys captured, amber when partial, plain otherwise.
3. **Exercise strip** (selected unit): one pill per exercise (`3.1`, `3.2`, …)
   showing captured/total keys; concept rows render as slim theory pills
   in order between exercise pills (tap → rename/pages/delete dialog).
4. **Viewer** — two internal modes, one screen:
   - **Browse** (default): scrollable stack of the unit's pages
     (`listSmallPages` filtered to unit range), pinch-zoom, current-page badge
     via the 38%-line heuristic (same as BookEntryView). One-finger scroll.
   - **Crop**: single page at a time with `PageCropOverlay` fast-mode
     (full-res `getPagesInRange` over the exercise's page range, falling back
     to the unit range), page pills, zoom button → `ZoomedPageView`.
     One-finger draw, two-finger pan/zoom — identical to the crop route.
5. **Sticky bottom bar** (context = selected exercise, thumb reach):
   - Row A: exercise name + captured n/m + Browse/Crop toggle
     (+ `CropToolToolbar` compact + Q# badge toggle while cropping).
   - Browse rows: page from–to inputs with **Mark** buttons (grab current
     page), **Qs** button (tap-grid drawer), **Parts** button (drawer hosting
     `SubQuestionInline`), **+ Theory** (dialog; page prefilled from current
     page, inserted after the selected exercise's order).
   - Crop rows: `CropPillHeader` (main-Q / sub / sub-sub key pills incl.
     no-sub-stem toggle), saves via `questionBank.upsertForExerciseKey`.
6. **Auto-advance**: draw → `nextCropKey`; last key done → toast + advance to
   the next not-fully-cropped exercise, select its first missing key, retarget
   the viewer. Initial selection = first incomplete exercise of the first
   incomplete unit.

## Reused as-is (no modifications)

`PageCropOverlay`, `CropPillHeader`, `CropToolToolbar`, `ZoomedPageView`,
`SubQuestionInline`, `lib/crop-keys`, `lib/sub-questions`,
`lib/curriculum-data`. Existing Convex functions only — no backend changes:
`exercises.{list,updateQuestionCount,updatePageNumber,setSubQuestions,
addConcept,renameConcept,remove}`, `questionBank.{listByLinkedExercises,
listByPages,upsertForExerciseKey,update,remove}`,
`textbookPages.{listSmallPages,getPagesInRange}`, `unitMetadata.list`,
`textbooks.list`, completeness query for red incomplete rects.

## New files

- `src/components/settings/details-studio-tab.tsx` — tab shell: book/unit/
  exercise selection, browse viewer, state persistence (sessionStorage keys
  `detailsStudio.*`), fullscreen.
- `src/components/settings/studio-crop-view.tsx` — crop-mode viewer + key
  state + save/auto-advance (mirrors the crop route's fast mode).
- `src/components/settings/studio-entry-bar.tsx` — sticky bar + drawers
  (Qs grid, Parts, theory dialog).

## Out of scope (v1)

Exercise delete and the capture-status dot grid stay in the old Details layer
(still available). Past Papers and Difficulty layers are untouched. No changes
to sheet generation, planner, or learning engine.

## Error handling

- No count yet → Crop toggle disabled with hint "Set Qs first".
- No page range on exercise → crop falls back to unit range (crop route rule).
- No pages uploaded → viewer empty-state pointing to Content tab; typing still
  works.
- All mutations wrapped in try/catch + toast, matching existing patterns.

## Testing

UI-only feature over existing tested mutations; verify with root tsc/build and
manual phone test by founder. `lib/crop-keys` logic already covered.
