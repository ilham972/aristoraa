# Session, sheets & scoring — /session/[slotId]/[date]

## The workspace
`src/app/session/[slotId]/[date]/page.tsx` hosts
`src/components/session/session-workspace.tsx` — 3 tabs, shared with the
embedded Session view on /groups (so tab sets never drift):
- **Sheets** (tab id `score` for URL back-compat; old `?tab=sheets` links are
  normalized) — the MERGED sheet-management + scoring surface. One tab does
  what used to be two (Score + Sheets were merged 2026-06-07; sheet-only
  scoring — never re-add a separate per-exercise score tab, see decisions.md).
- **Lead** — live dashboard for the session roster
  (`lead-tab.tsx`, 1487 lines — biggest component in the app).
- **Attendance** — default tab on first visit: attendance toggles,
  cancel-session, payment entries (`attendance-tab.tsx`).

A session stepper (header) walks prev/next sessions of the SAME group across
its slots; `?origin=` lets Reset jump back to the entry session.

## Sheets tab flow (the core teaching loop)
`score-sheet-tab.tsx` (list + per-student sheet actions: generate, view,
print, score) → `sheet-scoring-grid.tsx` (section tabs + inline sheet view +
mark grid). Backend calls, in lifecycle order:
1. `api.learningEngine.planner.saveSheetForStudent` — generate (planner picks
   LEAF questions only; stems glued at render — stem/leaf model, domain.md).
2. `api.learningEngine.sheets.listSheetsForSlotDate / getSheetWithCrops` — list/view.
3. `api.learningEngine.pdf.renderSheetPDF` + `sheets.zipSheetPDFs` — pure-JS
   pdf-lib rendering of cropped question images (sharp was abandoned).
4. `api.learningEngine.planner.markPrinted` — print tracking.
5. `api.learningEngine.scoring.getSheetForScoring / setSheetMark /
   finalizeSheetScoring` — a mark per question is good / again / skipped
   (FSRS-style, no partial credit); finalize converts marks into memory-state
   updates + points + repeatCount in one transaction.
Doubts can be flagged per question (`api.doubts.*`). Sheet sections: Main
(driven by TRACK since exam-mode change, not teachingPath), plus Revision and
Mistakes sections per the path-driven redesign.

## PDF/crop pipeline (upstream of sheets)
Textbook + past-paper pages are cropped per question in
`/settings/crop/[unitId]` and `/settings/past-paper-crop/[paperId]`;
stored via `convex/textbookPages.ts`, `convex/pastPaperPages.ts`,
`convex/paperStructures.ts`. Sheets embed those crops.

## Dead weight found here (knip-confirmed, see legacy-map.md)
The OLD standalone Sheets UI survives unwired: `src/components/sheets/`
inspector-drawer, inspector-body (826 lines), student-row, bulk-actions,
summary-strip + FiltersBar export. Only `shared.ts` (partially) and
`scope.ts` stay referenced. `sessionSubmissions` convex module: zero callers.

## Invariants
- Scoring happens ONLY through sheets (no sheet → no score entry).
- Finalize is the single point where marks become memory/points effects.
- Session identity = slot + date string (YYYY-MM-DD), never a session id.
