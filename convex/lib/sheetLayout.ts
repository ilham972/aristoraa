// Pure A4 pagination ESTIMATOR (sessions redesign, 2026-07-18).
//
// Mirrors the layout math of convex/learningEngine/pdf.ts (buildPDF /
// drawQuestion / ensureSpace) closely enough to predict which questions land
// on which printed A4 page WITHOUT rendering: same constants, same block
// budget, same page-break rule. Two deliberate approximations:
//   1. Crop aspect comes from the page-normalized cropBox (the renderer's
//      own no-image fallback) instead of embedded pixel dimensions — source
//      scans are A4-class, so the two agree to within a couple of mm.
//   2. Stems are not included (their integrity resolution needs the DB).
// The EXACT mapping is captured by the real render (pdfPageAssignments on
// groupSheets) and wins whenever present; this estimator is the fallback so
// the planner can show pages before any preview has been rendered.
//
// CONSTANTS MUST MATCH pdf.ts — change them together.

const MM = 2.83465; // points per mm
const A4_HEIGHT = 297 * MM;
const A4_WIDTH = 210 * MM;
const MARGIN = 8 * MM;
const CONTENT_WIDTH = A4_WIDTH - 2 * MARGIN;
const HEADER_HEIGHT = 14 * MM;
const SECTION_BANNER_HEIGHT = 6 * MM;
const QUESTION_GAP = 3 * MM;
const SOURCE_PAGE_WIDTH = 210 * MM;
const SOURCE_PAGE_HEIGHT = 297 * MM;
const QUESTION_PRINT_SCALE = 1.0;
const IMAGE_MIN_WIDTH = 15 * MM;
const IMAGE_MAX_HEIGHT = 85 * MM;
const RULED_LINES_TOTAL = 4 * 7 * MM;
const FOOTNOTE_HEIGHT = 4 * MM;
const NUMBER_LABEL_HEIGHT = 5 * MM;

export type LayoutQuestion = {
  cropBox: { w: number; h: number } | null;
  // Typed-override snapshot print size (exact — no approximation needed).
  overrideSize: { widthMm: number; heightMm: number } | null;
};

function clampUnit(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

// Mirror of fitCropSlot's height result, aspect derived from the cropBox.
function slotHeight(q: LayoutQuestion): number {
  if (q.overrideSize) {
    let w = q.overrideSize.widthMm * MM;
    let h = q.overrideSize.heightMm * MM;
    if (w > CONTENT_WIDTH) {
      h = h * (CONTENT_WIDTH / w);
      w = CONTENT_WIDTH;
    }
    if (h > IMAGE_MAX_HEIGHT) h = IMAGE_MAX_HEIGHT;
    return h;
  }
  if (!q.cropBox) return IMAGE_MAX_HEIGHT; // unknown — budget the max
  const cw = Math.max(0.001, clampUnit(q.cropBox.w));
  const ch = Math.max(0.001, clampUnit(q.cropBox.h));
  const naturalW = cw * SOURCE_PAGE_WIDTH * QUESTION_PRINT_SCALE;
  const naturalH = ch * SOURCE_PAGE_HEIGHT * QUESTION_PRINT_SCALE;
  const w = Math.min(Math.max(naturalW, IMAGE_MIN_WIDTH), CONTENT_WIDTH);
  let h = naturalH * (w / naturalW);
  if (h > IMAGE_MAX_HEIGHT) h = IMAGE_MAX_HEIGHT;
  return h;
}

// 1-based page index per question, print order. One section banner is
// budgeted at the top (group sheets render a single MAIN banner).
export function estimatePageBreaks(questions: LayoutQuestion[]): number[] {
  const usableTop = A4_HEIGHT - MARGIN - HEADER_HEIGHT;
  let page = 1;
  let yCursor = usableTop;
  const ensureSpace = (needed: number) => {
    if (yCursor - needed < MARGIN) {
      page += 1;
      yCursor = usableTop;
    }
  };
  ensureSpace(SECTION_BANNER_HEIGHT + QUESTION_GAP);
  yCursor -= SECTION_BANNER_HEIGHT + QUESTION_GAP;

  const out: number[] = [];
  for (const q of questions) {
    const blockHeight =
      NUMBER_LABEL_HEIGHT +
      slotHeight(q) +
      RULED_LINES_TOTAL +
      FOOTNOTE_HEIGHT +
      QUESTION_GAP;
    ensureSpace(blockHeight);
    out.push(page);
    yCursor -= blockHeight;
  }
  return out;
}
