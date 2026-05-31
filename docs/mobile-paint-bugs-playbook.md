# Mobile Paint Bugs Playbook (Android Chrome / WebView)

A field guide for the two GPU-compositing bugs that keep showing up in this app
on mobile (especially Huawei / SLTMobitel test device). Both are **rendering**
bugs, not data or logic bugs — the layout is always correct, the browser just
fails to *paint* it.

> **How to recognise this whole family of bugs:** the content is the right size
> and in the right place (you can see card outlines / it flashes correctly for a
> split second), but the **contents are blank, ghosted, or smeared**. It only
> happens on mobile, looks "random", and you can't reproduce it on desktop.
> That combination = GPU compositing bug. Stop looking at the component's data.

---

## Bug A — Blank / unpainted regions ("part of the screen not painted")

### Symptom
- Open a tall page (e.g. Analytics → Finance, or Operations → Capacity).
- It flashes fully for a moment, then the **top ~25%** (or some cards) go blank.
- The cards are *there* — correct size, correct position — but empty shells.
  Some cards paint, neighbours next to them don't.

### Root cause
Android Chrome rasterizes the page in **tiles**. When content sits in a separate
compositing layer that's taller than the viewport, the GPU sometimes fails to
rasterize some tiles and leaves them blank. Two things make it worse:

1. A **nested scroll container** (`overflow-y-auto` inside a fixed-height box)
   creates a separate scroll/compositing layer that's prone to this.
2. **Viewport-unit fixed heights** (`h-[calc(100svh-5rem)]` + `overflow-hidden`)
   on mobile, where the URL bar resizes the viewport, compound it.

### The fix (in order of preference)

**1. Don't create a nested scroll layer. Scroll the document.**
This was the primary fix for `/analytics`. The page used:
```tsx
// ❌ BAD — fixed-height shell with an inner scroll layer
<div className="h-[calc(100svh-5rem)] flex flex-col overflow-hidden ...">
  <div className="shrink-0 ...">{tabs}</div>
  <div className="flex-1 min-h-0 overflow-y-auto ...">{content}</div>
</div>
```
Changed to a plain block that scrolls with the document, like every other page:
```tsx
// ✅ GOOD — natural document scroll, no nested layer, no svh height
<div className="max-w-3xl mx-auto px-3 pt-3 pb-6">
  <div className="mb-3">{tabs}</div>
  <div>{content}</div>
</div>
```
Rule of thumb: **only one scroll container per page** (the document). Avoid
`overflow-y-auto` on a tall inner div unless you truly need an independent
scroll region (like a chat pane).

**2. If specific cards STILL come up blank, force each onto its own GPU layer.**
Add `translateZ(0)` to the card primitive. This tells Chrome to rasterize the
element as its own unit instead of relying on the shared failing tile.
```tsx
// In the reusable Card / Kpi component className:
'rounded-xl bg-card border border-border/60 p-3 [transform:translateZ(0)]'
```
Applied to the analytics + revenue card/KPI primitives:
- `src/components/analytics/ui.tsx` → `Kpi`, `Card`
- `src/components/groups/revenue-tab.tsx` → `Kpi`, `Card`, `BreakdownCard`

Equivalent alternatives if `translateZ(0)` isn't enough:
- `will-change: transform` (`className="will-change-transform"`)
- `content-visibility: auto` on tall lists (also a perf win)

> ⚠️ Don't sprinkle `translateZ(0)` on *everything* — too many layers costs
> memory and can hurt scroll perf. Apply it to the repeating card primitive
> that's coming up blank, not every div.

---

## Bug B — Flickering / smearing / ghosting while scrolling

### Symptom
- Scroll a page and text/cards **smear**: the same label ("Nothing slipped",
  "Rs 0 last 7d", "AVG / SESSION") appears stamped 2–3× down the screen, cards
  ghost into a stack. Like an "old movie" / VHS trail. Stops when you stop
  scrolling, but it's there every scroll.

### Root cause
**`backdrop-filter` / `backdrop-blur` on a `position: fixed` element.**
A fixed element with a backdrop blur forces the browser to **re-sample
everything behind it on every single scroll frame**. On some mobile GPUs
(Huawei here) that per-frame re-sampling corrupts the pixels → the smear/trail.

The offenders were the always-on-screen fixed overlays:
- `src/components/navigation.tsx` — bottom nav: `bg-card/90 backdrop-blur-xl`
- `src/components/messaging/NotificationBell.tsx` — floating bell: `bg-card/80 backdrop-blur-md`

### The fix
Use a **solid background** instead of a translucent one + blur. Visually almost
identical, but no per-frame backdrop re-sampling.
```tsx
// ❌ BAD — fixed element that blurs whatever scrolls behind it
className="fixed bottom-0 ... bg-card/90 backdrop-blur-xl"

// ✅ GOOD — solid bg, no backdrop work during scroll
className="fixed bottom-0 ... bg-card"
```

### Rule of thumb
- **Never put `backdrop-blur` on a `fixed` or `sticky` element that stays on
  screen while the page scrolls.** That's the dangerous combination.
- `backdrop-blur` on a **modal/overlay that covers the whole screen** (dialogs,
  drawers, sheets) is fine — the page behind it isn't scrolling, so there's no
  per-frame re-sampling. Those usages in `ui/dialog.tsx`, `ui/sheet.tsx`,
  settings drawers, etc. were left as-is on purpose.

---

## Quick triage checklist (next time it happens)

1. **Is the layout correct but contents blank/smeared?** → it's a paint bug, not
   data. Don't debug the query/component logic.
2. **Does it happen on scroll (smear/ghost trail)?** → Bug B. Hunt for
   `backdrop-blur` on any `fixed`/`sticky` element → make it solid `bg-*`.
3. **Is a region/card blank on load (no scrolling needed)?** → Bug A.
   - First: is the page using a nested `overflow-y-auto` + `h-[...svh]` shell?
     → flatten it to natural document scroll.
   - Still blank cards? → add `[transform:translateZ(0)]` to the card primitive.
4. **Hard-refresh on the device** after deploying — mobile Chrome caches the old
   page aggressively, so an un-refreshed page can look "not fixed".
5. Typecheck (`npx tsc --noEmit`) — these are className/JSX edits, easy to break
   a tag. (Reminder: root `tsc` skips `convex/`; use `npx convex codegen` for
   backend.)

---

## Files touched for the original fix (2026-05, Analytics Finance/Capacity)

| File | Change | Bug |
|------|--------|-----|
| `src/app/analytics/page.tsx` | Removed `100svh` shell + inner `overflow-y-auto`; natural document scroll; non-sticky tabs | A |
| `src/components/navigation.tsx` | `bg-card/90 backdrop-blur-xl` → `bg-card` | B |
| `src/components/messaging/NotificationBell.tsx` | `bg-card/80 backdrop-blur-md` → `bg-card` | B |
| `src/components/analytics/ui.tsx` | `translateZ(0)` on `Kpi`, `Card` | A |
| `src/components/groups/revenue-tab.tsx` | `translateZ(0)` on `Kpi`, `Card`, `BreakdownCard` | A |
