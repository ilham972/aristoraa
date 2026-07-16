// Phase E.1 + E.2 — Sheet PDF renderer.
//
// Runs in Convex's V8 runtime (NO "use node" directive). The original spec
// called for sharp + pdf-lib but Convex's deploy validator could not load
// sharp's native binary in their cloud env (and the per-platform binary
// dance to make it work was fragile). We pivoted to a pure-JS approach:
// pdf-lib alone, using PDF native clipping operators to show only the
// cropBox region of each embedded page image. Trade-off: PDFs carry the
// full page image rather than a tight crop. pdf-lib dedupes shared pages
// inside a single document, so an 8-Q sheet drawing from 4-6 pages is
// reasonable in size (~800KB-1MB vs ~200KB with sharp crops). This is
// fine for our scale (30 students × 8 Qs in a ZIP).
//
// Pipeline:
//   1. Public action `renderSheetPDF(sheetId)` checks auth.
//   2. Calls internal query getSheetForRender → joined sheet/student/Qs/pages.
//   3. For each Q: fetch image bytes (2× retry on failure), sniff PNG vs
//      JPEG by first-byte magic, embed once per unique page.
//   4. pdf-lib composes A4 portrait page(s):
//        - Header: Aristora | Student | Date | Module | Sheet #
//        - Three section banners: WARM-UP / MAIN BLOCK / EXAM-PREP
//        - Per Q: number, image rendered through a clipping rectangle so
//          only the cropBox region appears, four ruled working lines,
//          muted Tamil-aware concept-name footnote.
//        - Page break with header repeat when content overflows.
//   5. Stores the PDF blob; internal mutation patches generatedSheets.pdfStorageId.
//
// Status convention: presence of `pdfStorageId` IS the "PDF rendered" signal.
// We do NOT introduce a "printed-ready" status — the existing
// draft/printed/completed enum + pdfStorageId is cleaner. Lead still calls
// markPrinted explicitly when the physical paper is in hand.

import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
} from "../_generated/server";
import { internal } from "../_generated/api";
import { ConvexError, v } from "convex/values";
import {
  PDFDocument,
  StandardFonts,
  pushGraphicsState,
  popGraphicsState,
  moveTo,
  lineTo,
  closePath,
  clip,
  endPath,
  rgb,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from "pdf-lib";
// @pdf-lib/fontkit ships as CommonJS. Convex bundles it under strict
// esModuleInterop=off, so `import fontkit from "@pdf-lib/fontkit"` becomes
// undefined at runtime. The namespace shape we receive is either the
// fontkit object itself or `{ default: fontkit }` depending on the bundler.
// Resolve both at runtime.
import * as fontkitNs from "@pdf-lib/fontkit";
const fontkit: { create: (b: Uint8Array) => unknown } =
  (fontkitNs as unknown as { default?: { create: (b: Uint8Array) => unknown } })
    .default ??
  (fontkitNs as unknown as { create: (b: Uint8Array) => unknown });
import type { Id } from "../_generated/dataModel";
import type { QuestionForRender, RenderSheetData } from "./pdfHelpers";
import { NOTO_SANS_TAMIL_BASE64 } from "../_assets/notoSansTamil";

// ── A4 layout constants (all in PDF points; 1pt = 1/72 inch ≈ 0.3528mm) ──
const MM = 2.83465; // points per mm
const A4_WIDTH = 210 * MM;
const A4_HEIGHT = 297 * MM;
const MARGIN = 8 * MM; // 8mm — slightly looser than spec's 4mm to leave room for ruled lines
const CONTENT_WIDTH = A4_WIDTH - 2 * MARGIN;
const HEADER_HEIGHT = 14 * MM;
const SECTION_BANNER_HEIGHT = 6 * MM;
const QUESTION_GAP = 3 * MM;
// Natural-size rendering: a crop prints at the size it occupies on the real
// textbook/paper page (cropBox is normalized to the page, source pages are
// A4-class), so text size is CONSISTENT across every question on the sheet —
// the thing that makes it read like a real exam paper. The old behavior
// (stretch every crop to a fixed 80mm width) blew tiny questions up and
// shrank big ones down, giving each question a different font size.
const SOURCE_PAGE_WIDTH = 210 * MM; // physical width the cropBox fractions refer to
const SOURCE_PAGE_HEIGHT = 297 * MM;
const QUESTION_PRINT_SCALE = 1.0; // global zoom knob (e.g. 1.1 = 10% larger than the book)
const IMAGE_MIN_WIDTH = 15 * MM; // guard against degenerate sliver crops
const IMAGE_MAX_HEIGHT = 85 * MM; // page-layout safety cap; rarely hit
const RULED_LINE_COUNT = 4;
const RULED_LINE_GAP = 7 * MM;
const RULED_LINES_TOTAL = RULED_LINE_COUNT * RULED_LINE_GAP;
const FOOTNOTE_HEIGHT = 4 * MM;
// Stems are usually a short instruction line ("Solve the expression:") —
// keep the slot smaller than the main question image so the actual problem
// gets visual priority. Aspect ratio is preserved by fitStemSlot below.
const STEM_IMAGE_MAX_HEIGHT = 25 * MM;
const STEM_GAP = 1.5 * MM;

const COLOR_TEXT = rgb(0.11, 0.13, 0.16); // near-black
const COLOR_MUTED = rgb(0.45, 0.49, 0.55);
const COLOR_RULE = rgb(0.78, 0.81, 0.86);
const COLOR_SECTION_BG = rgb(0.94, 0.96, 0.98);
const COLOR_HAIRLINE = rgb(0.85, 0.87, 0.91);

type ImageFormat = "png" | "jpeg" | "unknown";

async function fetchWithRetry(url: string, attempts = 3): Promise<Uint8Array> {
  let lastErr: unknown = null;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const arr = await res.arrayBuffer();
      return new Uint8Array(arr);
    } catch (e) {
      lastErr = e;
      if (i < attempts - 1) {
        await new Promise((r) => setTimeout(r, 300 * (i + 1)));
      }
    }
  }
  throw new Error(
    `Image fetch failed after ${attempts} attempts: ${String(lastErr)}`,
  );
}

function clampUnit(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function sniffImageFormat(bytes: Uint8Array): ImageFormat {
  if (bytes.length < 4) return "unknown";
  // PNG: 89 50 4E 47
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return "png";
  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "jpeg";
  return "unknown";
}

// Embed a page image into the doc, caching by URL so a page referenced by
// multiple questions is embedded only once. pdf-lib then references the
// same XObject from multiple draw calls — keeps PDF size bounded.
async function embedPageImage(
  pdfDoc: PDFDocument,
  cache: Map<string, PDFImage>,
  pageImageUrl: string,
): Promise<PDFImage | null> {
  const cached = cache.get(pageImageUrl);
  if (cached) return cached;
  let bytes: Uint8Array;
  try {
    bytes = await fetchWithRetry(pageImageUrl);
  } catch {
    return null;
  }
  const fmt = sniffImageFormat(bytes);
  try {
    let img: PDFImage;
    if (fmt === "png") img = await pdfDoc.embedPng(bytes);
    else if (fmt === "jpeg") img = await pdfDoc.embedJpg(bytes);
    else {
      // Try JPEG first, fall back to PNG. pdf-lib throws on mismatch.
      try {
        img = await pdfDoc.embedJpg(bytes);
      } catch {
        img = await pdfDoc.embedPng(bytes);
      }
    }
    cache.set(pageImageUrl, img);
    return img;
  } catch {
    return null;
  }
}

// Given a slot rectangle (in PDF points, origin = bottom-left of slot) and
// a normalized cropBox (origin = top-left of source image), compute the
// draw rectangle for the FULL source image such that the cropBox region
// of the image lands exactly inside the slot. A clip rectangle restricted
// to the slot then hides everything outside the crop.
//
// Math:
//   drawWidth  = slotWidth  / cropBox.w
//   drawHeight = slotHeight / cropBox.h
//   drawX = slotX - cropBox.x * drawWidth
//   drawY = slotY - (1 - cropBox.y - cropBox.h) * drawHeight
//                  ^^^^^^^^^^^^^^^^^^^^^^^^^^^ cropBox.y is top-down in image
//                                              coords; pdf-lib is bottom-up.
function computeClippedDrawRect(
  slot: { x: number; y: number; w: number; h: number },
  cropBox: { x: number; y: number; w: number; h: number },
): { x: number; y: number; w: number; h: number } {
  const cx = clampUnit(cropBox.x);
  const cy = clampUnit(cropBox.y);
  const cw = Math.max(0.001, clampUnit(cropBox.w));
  const ch = Math.max(0.001, clampUnit(cropBox.h));
  const drawW = slot.w / cw;
  const drawH = slot.h / ch;
  const drawX = slot.x - cx * drawW;
  const drawY = slot.y - (1 - cy - ch) * drawH;
  return { x: drawX, y: drawY, w: drawW, h: drawH };
}

// Decide the slot dimensions for a question's image — NATURAL size.
// Width comes from the crop's fraction of the source page (cropBox.w ×
// physical page width × global scale). The aspect ratio comes from the
// embedded PDFImage pixel dimensions (cropBox alone is normalized to the
// page, not the crop). Clamped to layout bounds; the clamps fire only on
// degenerate or unusually large crops.
function fitCropSlot(
  img: PDFImage | null,
  cropBox: { w: number; h: number },
): { width: number; height: number } {
  const naturalW = clampUnit(cropBox.w) * SOURCE_PAGE_WIDTH * QUESTION_PRINT_SCALE;
  if (!img) {
    // No pixel data to derive aspect from — use the page-normalized height.
    const naturalH = clampUnit(cropBox.h) * SOURCE_PAGE_HEIGHT * QUESTION_PRINT_SCALE;
    return {
      width: Math.min(Math.max(naturalW, IMAGE_MIN_WIDTH), CONTENT_WIDTH),
      height: Math.min(naturalH, IMAGE_MAX_HEIGHT),
    };
  }
  const cropPxW = Math.max(1, img.width * clampUnit(cropBox.w));
  const cropPxH = Math.max(1, img.height * clampUnit(cropBox.h));
  const aspect = cropPxW / cropPxH;
  let w = Math.min(Math.max(naturalW, IMAGE_MIN_WIDTH), CONTENT_WIDTH);
  let h = w / aspect;
  if (h > IMAGE_MAX_HEIGHT) {
    h = IMAGE_MAX_HEIGHT;
    w = h * aspect;
  }
  return { width: w, height: h };
}

// Typed-override slot: the snapshot already knows its physical print size
// (the browser typeset it at a fixed 11pt-equivalent), so we draw at exactly
// that size, shrinking only if it would overflow the layout bounds.
function fitOverrideSlot(
  override: { widthMm: number; heightMm: number },
  maxHeight: number,
): { width: number; height: number } {
  let w = override.widthMm * MM;
  let h = override.heightMm * MM;
  if (w > CONTENT_WIDTH) {
    h = h * (CONTENT_WIDTH / w);
    w = CONTENT_WIDTH;
  }
  if (h > maxHeight) {
    w = w * (maxHeight / h);
    h = maxHeight;
  }
  return { width: w, height: h };
}

// Full-image "crop" so typed overrides can reuse drawClippedImage: clipping
// to the whole image is a no-op draw of the slot itself.
const FULL_IMAGE_BOX = { x: 0, y: 0, w: 1, h: 1 };

// Stem slots use the same natural sizing (an instruction line prints at the
// size it has in the book) with the tighter stem height cap.
function fitStemSlot(
  img: PDFImage | null,
  cropBox: { w: number; h: number },
): { width: number; height: number } {
  const naturalW = clampUnit(cropBox.w) * SOURCE_PAGE_WIDTH * QUESTION_PRINT_SCALE;
  if (!img) {
    return {
      width: Math.min(Math.max(naturalW, IMAGE_MIN_WIDTH), CONTENT_WIDTH),
      height: STEM_IMAGE_MAX_HEIGHT,
    };
  }
  const cropPxW = Math.max(1, img.width * clampUnit(cropBox.w));
  const cropPxH = Math.max(1, img.height * clampUnit(cropBox.h));
  const aspect = cropPxW / cropPxH;
  let w = Math.min(Math.max(naturalW, IMAGE_MIN_WIDTH), CONTENT_WIDTH);
  let h = w / aspect;
  if (h > STEM_IMAGE_MAX_HEIGHT) {
    h = STEM_IMAGE_MAX_HEIGHT;
    w = h * aspect;
  }
  return { width: w, height: h };
}

type PagedRenderer = {
  pdfDoc: PDFDocument;
  helv: PDFFont;
  helvBold: PDFFont;
  // Noto Sans Tamil. Contains BOTH Tamil glyphs and Basic Latin, so it can
  // safely render mixed-language strings without the missing-glyph boxes
  // Helvetica would produce. Used for any text that may be Tamil: student
  // name (header) and concept-name footnote (under each question).
  tamil: PDFFont;
  current: PDFPage;
  yCursor: number;
  pageIndex: number;
  drawHeader: (page: PDFPage) => void;
};

// Heuristic: contains any character outside Basic Latin (0x00–0x7F).
// Used to pick between Helvetica (faster, smaller) and the Tamil-aware
// font for a given string.
function hasNonLatin(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) > 0x7e) return true;
  }
  return false;
}

function newPage(r: PagedRenderer): void {
  r.current = r.pdfDoc.addPage([A4_WIDTH, A4_HEIGHT]);
  r.pageIndex += 1;
  r.drawHeader(r.current);
  r.yCursor = A4_HEIGHT - MARGIN - HEADER_HEIGHT;
}

function ensureSpace(r: PagedRenderer, needed: number): void {
  if (r.yCursor - needed < MARGIN) {
    newPage(r);
  }
}

function drawSectionBanner(r: PagedRenderer, label: string): void {
  ensureSpace(r, SECTION_BANNER_HEIGHT + QUESTION_GAP);
  const top = r.yCursor;
  r.current.drawRectangle({
    x: MARGIN,
    y: top - SECTION_BANNER_HEIGHT,
    width: CONTENT_WIDTH,
    height: SECTION_BANNER_HEIGHT,
    color: COLOR_SECTION_BG,
  });
  // Banner labels are ASCII except the Main block's, which embeds the topic
  // (concept name, often Tamil). Pick the Tamil-aware font when needed.
  r.current.drawText(label, {
    x: MARGIN + 3 * MM,
    y: top - SECTION_BANNER_HEIGHT + 1.6 * MM,
    size: 10,
    font: hasNonLatin(label) ? r.tamil : r.helvBold,
    color: COLOR_TEXT,
  });
  r.yCursor = top - SECTION_BANNER_HEIGHT - QUESTION_GAP;
}

// Draw one image cropped into a slot at (x, slotY) with the given dimensions,
// clipped to the slot rect. Shared by main-Q and stem rendering — both use
// the same source-image-scaled-then-clipped trick.
function drawClippedImage(
  r: PagedRenderer,
  args: {
    img: PDFImage;
    cropBox: { x: number; y: number; w: number; h: number };
    slotX: number;
    slotY: number;
    slotW: number;
    slotH: number;
    border: boolean;
  },
): void {
  const draw = computeClippedDrawRect(
    { x: args.slotX, y: args.slotY, w: args.slotW, h: args.slotH },
    args.cropBox,
  );
  r.current.pushOperators(
    pushGraphicsState(),
    moveTo(args.slotX, args.slotY),
    lineTo(args.slotX + args.slotW, args.slotY),
    lineTo(args.slotX + args.slotW, args.slotY + args.slotH),
    lineTo(args.slotX, args.slotY + args.slotH),
    closePath(),
    clip(),
    endPath(),
  );
  r.current.drawImage(args.img, {
    x: draw.x,
    y: draw.y,
    width: draw.w,
    height: draw.h,
  });
  r.current.pushOperators(popGraphicsState());
  if (args.border) {
    r.current.drawRectangle({
      x: args.slotX,
      y: args.slotY,
      width: args.slotW,
      height: args.slotH,
      borderColor: COLOR_HAIRLINE,
      borderWidth: 0.3,
    });
  }
}

// One resolved stem image ready to draw. Either a page crop (cropBox set,
// override null) or a typed-override snapshot (override set, drawn full).
type ResolvedStem = {
  img: PDFImage;
  cropBox: { x: number; y: number; w: number; h: number } | null;
  override: { widthMm: number; heightMm: number } | null;
};

function drawQuestion(
  r: PagedRenderer,
  q: QuestionForRender,
  questionNumber: number,
  embeddedImage: PDFImage,
  stems: ResolvedStem[],
): void {
  // Caller guarantees the main embedded image is present — missing-image
  // cases are handled before rendering (see buildPDF + the onMissingImage
  // policy in renderSheetPDF). Without a typed override, cropBox is also
  // guaranteed at this point.
  if (!q.override && !q.cropBox)
    throw new Error("drawQuestion called without cropBox or override");
  const slot = q.override
    ? fitOverrideSlot(q.override, IMAGE_MAX_HEIGHT)
    : fitCropSlot(embeddedImage, q.cropBox!);
  const numberLabelHeight = 5 * MM;

  // Pre-compute every stem slot so the block-height budget can account for
  // them before we ensureSpace + page-break. Each stem adds STEM_GAP +
  // stem.height.
  const stemSlots = stems.map((s) =>
    s.override
      ? fitOverrideSlot(s.override, STEM_IMAGE_MAX_HEIGHT)
      : fitStemSlot(s.img, s.cropBox!),
  );
  const stemsTotalHeight = stemSlots.reduce(
    (sum, s) => sum + s.height + STEM_GAP,
    0,
  );

  const blockHeight =
    numberLabelHeight +
    stemsTotalHeight +
    slot.height +
    RULED_LINES_TOTAL +
    FOOTNOTE_HEIGHT +
    QUESTION_GAP;
  ensureSpace(r, blockHeight);

  const top = r.yCursor;

  // Question number + (optional) past-paper "Q1.a — 3 marks" tag
  const labelParts = [`Q${questionNumber}.`];
  if (q.questionNumberInPaper) {
    labelParts.push(`(paper ${q.questionNumberInPaper})`);
  }
  if (q.marksAvailable != null) {
    labelParts.push(`[${q.marksAvailable} marks]`);
  }
  r.current.drawText(labelParts.join("  "), {
    x: MARGIN,
    y: top - 3.5 * MM,
    size: 10,
    font: r.helvBold,
    color: COLOR_TEXT,
  });

  // Stem strip(s): rendered above the main question image, full content
  // width, no border. The visual hierarchy ("instruction" then "problem")
  // is conveyed by stem-narrower-than-main + no border + sitting flush
  // above the question slot.
  let stemCursor = top - numberLabelHeight;
  for (let i = 0; i < stems.length; i++) {
    const s = stems[i];
    const stemSlot = stemSlots[i];
    const stemY = stemCursor - stemSlot.height;
    drawClippedImage(r, {
      img: s.img,
      cropBox: s.override ? FULL_IMAGE_BOX : s.cropBox!,
      slotX: MARGIN,
      slotY: stemY,
      slotW: stemSlot.width,
      slotH: stemSlot.height,
      border: false,
    });
    stemCursor = stemY - STEM_GAP;
  }

  const slotX = MARGIN;
  const slotY = stemCursor - slot.height;
  drawClippedImage(r, {
    img: embeddedImage,
    cropBox: q.override ? FULL_IMAGE_BOX : q.cropBox!,
    slotX,
    slotY,
    slotW: slot.width,
    slotH: slot.height,
    // Typed overrides read like real exam text — a hairline box around them
    // would mark them as "an image", so the border stays crop-only.
    border: !q.override,
  });

  // Ruled working lines
  const linesTop = slotY;
  for (let i = 1; i <= RULED_LINE_COUNT; i++) {
    const y = linesTop - i * RULED_LINE_GAP;
    r.current.drawLine({
      start: { x: MARGIN, y },
      end: { x: MARGIN + CONTENT_WIDTH, y },
      thickness: 0.4,
      color: COLOR_RULE,
    });
  }

  // Concept-name footnote (muted, small). Concept names are Tamil in this
  // curriculum, so we always render through the Tamil-aware font; it also
  // contains Basic Latin glyphs for the " · " separator and any
  // English-named concepts that happen to mix in.
  if (q.conceptNames.length > 0) {
    const footnote = q.conceptNames.join(" · ");
    r.current.drawText(footnote, {
      x: MARGIN,
      y: linesTop - RULED_LINES_TOTAL - 3 * MM,
      size: 7.5,
      font: r.tamil,
      color: COLOR_MUTED,
    });
  }

  r.yCursor = top - blockHeight;
}


function buildHeaderDrawer(
  helv: PDFFont,
  helvBold: PDFFont,
  tamil: PDFFont,
  data: RenderSheetData,
  sheetIdShort: string,
): (page: PDFPage) => void {
  return (page: PDFPage) => {
    const top = A4_HEIGHT - MARGIN;
    // Brand mark (text-only per founder decision)
    page.drawText("Aristora", {
      x: MARGIN,
      y: top - 4 * MM,
      size: 14,
      font: helvBold,
      color: COLOR_TEXT,
    });

    // Right-aligned metadata strip. Student name may be Tamil; the rest
    // (date / module / sheet id) is ASCII. Render the strip in TWO pieces
    // using two fonts so Helvetica covers the metadata while Noto Sans
    // Tamil handles the name. Width-measure each piece in its own font.
    const nameFont = hasNonLatin(data.student.name) ? tamil : helv;
    // Topic label (Main-block concept names) may be Tamil. Noto Sans Tamil
    // also carries Basic Latin, so render the whole tail with it when the
    // topic is non-Latin; otherwise Helvetica.
    const tail = `  ·  ${data.sheet.date}  ·  ${
      data.topicLabel ?? "—"
    }  ·  #${sheetIdShort}`;
    const tailFont = hasNonLatin(tail) ? tamil : helv;
    const nameWidth = nameFont.widthOfTextAtSize(data.student.name, 9);
    const tailWidth = tailFont.widthOfTextAtSize(tail, 9);
    const stripRight = A4_WIDTH - MARGIN;
    const stripY = top - 4 * MM;
    page.drawText(data.student.name, {
      x: stripRight - nameWidth - tailWidth,
      y: stripY,
      size: 9,
      font: nameFont,
      color: COLOR_TEXT,
    });
    page.drawText(tail, {
      x: stripRight - tailWidth,
      y: stripY,
      size: 9,
      font: tailFont,
      color: COLOR_TEXT,
    });

    // Subhead row: school grade (always ASCII)
    const sub = `Grade ${data.student.schoolGrade}  ·  Daily practice sheet`;
    page.drawText(sub, {
      x: MARGIN,
      y: top - 9 * MM,
      size: 8.5,
      font: helv,
      color: COLOR_MUTED,
    });

    // Hairline divider
    page.drawLine({
      start: { x: MARGIN, y: top - HEADER_HEIGHT + 2 * MM },
      end: { x: A4_WIDTH - MARGIN, y: top - HEADER_HEIGHT + 2 * MM },
      thickness: 0.4,
      color: COLOR_HAIRLINE,
    });
  };
}

// Lazy-decode the Tamil font once per Node process. Decoding 450KB of base64
// is cheap (~5ms) but no point doing it per render call.
//
// We use atob() rather than Node's Buffer because pdf.ts runs in Convex's V8
// runtime (NO "use node"); Buffer is undefined there. The byte-by-byte
// charCodeAt loop is the standard browser idiom for "base64 string → Uint8Array".
let tamilFontBytesCache: Uint8Array | null = null;
function getTamilFontBytes(): Uint8Array {
  if (tamilFontBytesCache) return tamilFontBytesCache;
  const bin = atob(NOTO_SANS_TAMIL_BASE64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  tamilFontBytesCache = bytes;
  return tamilFontBytesCache;
}

// What to do when an image can't be fetched / embedded for a question.
//   "fail"  → throw a ConvexError listing the missing Qs (default). Lead can
//             then go diagnose data (broken storage id, deleted page, etc.)
//             BEFORE printing.
//   "skip"  → silently drop the broken question(s) and renumber the rest.
//             Manual escape hatch when the Lead has triaged the issue and
//             explicitly wants to print what's available.
// There is intentionally no placeholder mode — a "[image unavailable]" stub
// is too easy to miss on a printed sheet.
export type MissingImagePolicy = "fail" | "skip";

export type MissingImageItem = {
  questionId: Id<"questionBank">;
  section: "warmup" | "main" | "revision" | "examPrep";
  reason: "no-page-link" | "fetch-failed" | "no-crop-box" | "question-deleted";
};

async function buildPDF(
  data: RenderSheetData,
  policy: MissingImagePolicy,
): Promise<{
  bytes: Uint8Array;
  pageCount: number;
  missing: MissingImageItem[];
  rendered: { warmup: number; main: number; revision: number; examPrep: number };
}> {
  // Crop-integrity gate: refuse to render when any picked Q has a blocking
  // issue (stem-only with no sub-parts cropped, sub-question with no stem,
  // etc — see cropIntegrity.ts). "Force render" doesn't bypass this — the
  // skip policy is for IMAGE-fetch failures only, not for structural
  // cropping incompleteness. Lead must open Edit, fix the crop set (or
  // swap the offending Q), then retry render.
  if (data.integrity.blockingCount > 0) {
    const blocking = data.integrity.perQuestion
      .filter((p) => p.integrity.blocking)
      .map((p) => ({
        questionId: p.questionId,
        slot: p.slot,
        kind: p.integrity.kind,
        message: p.integrity.message,
      }));
    throw new ConvexError({
      kind: "IncompleteCropping",
      message:
        `Render aborted — ${blocking.length} question(s) have incomplete cropping. ` +
        `Open Edit on the sheet to see which ones, then crop the missing pieces or swap the questions.`,
      blocking,
    });
  }

  const pdfDoc = await PDFDocument.create();
  // fontkit must be registered before embedding any non-standard font.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pdfDoc.registerFontkit(fontkit as any);
  pdfDoc.setTitle(`Aristora sheet — ${data.student.name} — ${data.sheet.date}`);
  pdfDoc.setProducer("Aristora");
  pdfDoc.setCreator("Aristora Learning Engine");

  const helv = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const helvBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  // Subset: pdf-lib only embeds glyphs we actually use, so the file size
  // hit is small even though the source TTF is 340KB.
  const tamil = await pdfDoc.embedFont(getTamilFontBytes(), { subset: true });

  const sheetIdShort = data.sheet._id.slice(-6);
  const drawHeader = buildHeaderDrawer(helv, helvBold, tamil, data, sheetIdShort);

  // Embed each unique source page image exactly once. Multiple questions
  // can reference the same textbook page; embedPageImage caches by URL so
  // the PDF carries one copy regardless of how many crops cut from it.
  const pageImageCache = new Map<string, PDFImage>();
  const missing: MissingImageItem[] = [];

  type SectionName = "warmup" | "main" | "revision" | "examPrep";
  // Resolve stem attachments for a question: embed each stem's source page
  // (cached) and pair it with the stem's cropBox. Stems missing a cropBox
  // or page link are silently dropped — the integrity gate above already
  // refuses to render structurally-blocked sheets, so the only way a stem
  // is unresolvable here is a transient storage failure or a deleted page
  // row, which falls under the same "skip"/"fail" missing-image policy.
  const resolveStems = async (
    q: QuestionForRender,
    section: SectionName,
  ): Promise<ResolvedStem[]> => {
    if (q.stemAttachments.length === 0) return [];
    const out: ResolvedStem[] = [];
    for (const s of q.stemAttachments) {
      // Typed override wins over the page crop.
      if (s.override) {
        const img = await embedPageImage(pdfDoc, pageImageCache, s.override.url);
        if (!img) {
          missing.push({
            questionId: s.questionId,
            section,
            reason: "fetch-failed",
          });
          continue;
        }
        out.push({
          img,
          cropBox: null,
          override: { widthMm: s.override.widthMm, heightMm: s.override.heightMm },
        });
        continue;
      }
      if (!s.cropBox || !s.pageImageUrl) {
        missing.push({
          questionId: s.questionId,
          section,
          reason: !s.cropBox ? "no-crop-box" : "no-page-link",
        });
        continue;
      }
      const img = await embedPageImage(
        pdfDoc,
        pageImageCache,
        s.pageImageUrl,
      );
      if (!img) {
        missing.push({
          questionId: s.questionId,
          section,
          reason: "fetch-failed",
        });
        continue;
      }
      out.push({ img, cropBox: s.cropBox, override: null });
    }
    return out;
  };

  const resolveSection = async (
    section: SectionName,
    qs: QuestionForRender[],
  ): Promise<{ q: QuestionForRender; img: PDFImage; stems: ResolvedStem[] }[]> => {
    const out: { q: QuestionForRender; img: PDFImage; stems: ResolvedStem[] }[] = [];
    for (const q of qs) {
      if (q.source === "missing") {
        missing.push({
          questionId: q.questionId,
          section,
          reason: "question-deleted",
        });
        continue;
      }
      // Typed override: the snapshot PNG replaces the page crop entirely,
      // so no cropBox / page link is required.
      if (q.override) {
        const img = await embedPageImage(pdfDoc, pageImageCache, q.override.url);
        if (!img) {
          missing.push({
            questionId: q.questionId,
            section,
            reason: "fetch-failed",
          });
          continue;
        }
        const stems = await resolveStems(q, section);
        out.push({ q, img, stems });
        continue;
      }
      if (!q.cropBox) {
        missing.push({
          questionId: q.questionId,
          section,
          reason: "no-crop-box",
        });
        continue;
      }
      if (!q.pageImageUrl) {
        missing.push({
          questionId: q.questionId,
          section,
          reason: "no-page-link",
        });
        continue;
      }
      const img = await embedPageImage(pdfDoc, pageImageCache, q.pageImageUrl);
      if (!img) {
        missing.push({
          questionId: q.questionId,
          section,
          reason: "fetch-failed",
        });
        continue;
      }
      const stems = await resolveStems(q, section);
      out.push({ q, img, stems });
    }
    return out;
  };

  const warm = await resolveSection("warmup", data.warmup);
  const main = await resolveSection("main", data.main);
  const revision = await resolveSection("revision", data.revision);
  const exam = await resolveSection("examPrep", data.examPrep);

  // Fail-fast: don't render a half-broken PDF. The Lead can fix data (re-link
  // the source page, restore a deleted Q, re-crop) then re-run, OR use the
  // explicit "skip" policy to force render the parts that work.
  if (policy === "fail" && missing.length > 0) {
    throw new ConvexError({
      kind: "MissingImages",
      message:
        `Render aborted — ${missing.length} question(s) have unrenderable images. ` +
        `Diagnose and retry, or use "Force render" to skip them.`,
      missing,
    });
  }

  // Start the first page.
  const firstPage = pdfDoc.addPage([A4_WIDTH, A4_HEIGHT]);
  drawHeader(firstPage);
  const renderer: PagedRenderer = {
    pdfDoc,
    helv,
    helvBold,
    tamil,
    current: firstPage,
    yCursor: A4_HEIGHT - MARGIN - HEADER_HEIGHT,
    pageIndex: 1,
    drawHeader,
  };

  // Continuous numbering across rendered (post-filter) sections. Skipped
  // questions don't take a number — the Lead sees a clean 1..N sheet.
  let n = 0;
  if (warm.length > 0) {
    drawSectionBanner(renderer, "WARM-UP  ·  Fix & recall");
    for (const { q, img, stems } of warm) {
      n += 1;
      drawQuestion(renderer, q, n, img, stems);
    }
  }
  if (main.length > 0) {
    drawSectionBanner(
      renderer,
      `MAIN BLOCK  ·  ${data.topicLabel ?? "Today's lesson"}`,
    );
    for (const { q, img, stems } of main) {
      n += 1;
      drawQuestion(renderer, q, n, img, stems);
    }
  }
  if (revision.length > 0) {
    drawSectionBanner(renderer, "REVISION  ·  Spaced repetition");
    for (const { q, img, stems } of revision) {
      n += 1;
      drawQuestion(renderer, q, n, img, stems);
    }
  }
  if (exam.length > 0) {
    drawSectionBanner(renderer, "EXAM-PREP  ·  Past-paper mixed");
    for (const { q, img, stems } of exam) {
      n += 1;
      drawQuestion(renderer, q, n, img, stems);
    }
  }

  const bytes = await pdfDoc.save();
  return {
    bytes,
    pageCount: pdfDoc.getPageCount(),
    missing,
    rendered: {
      warmup: warm.length,
      main: main.length,
      revision: revision.length,
      examPrep: exam.length,
    },
  };
}

// ──────────────────────────────────────────────────────────────────────
// Smoke-test helpers (no Clerk auth). Used via `npx convex run` to
// validate E.1/E.2 end-to-end from CLI without spinning up the browser.
// SAFE TO DELETE once E.4 ships — these are introspection-only.

// Inventory: which questions in the bank are renderable (have cropBox + a
// source-page storage reference). The smoke test seeds a fake sheet from
// these.
export const _smokeFindRenderableQs = internalQuery({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const lim = args.limit ?? 8;
    const out: Array<{
      questionId: Id<"questionBank">;
      source: string;
      hasCropBox: boolean;
      hasPage: boolean;
    }> = [];
    let scanned = 0;
    let withCrop = 0;
    let withPage = 0;
    // Linear scan — fine for inventory; we cap at 500 to stay snappy.
    for await (const q of ctx.db.query("questionBank")) {
      scanned += 1;
      const hasCropBox = !!q.cropBox;
      const hasPage = !!(q.textbookPageId || q.pastPaperPageId);
      if (hasCropBox) withCrop += 1;
      if (hasPage) withPage += 1;
      if (hasCropBox && hasPage && out.length < lim) {
        out.push({
          questionId: q._id,
          source: q.source,
          hasCropBox,
          hasPage,
        });
      }
      if (scanned >= 500) break;
    }
    const anyStudent = await ctx.db.query("students").first();
    return {
      scanned,
      withCropBox: withCrop,
      withPage,
      renderable: out,
      anyStudentId: anyStudent?._id ?? null,
      anyStudentName: anyStudent?.name ?? null,
    };
  },
});

// Seed a one-off generatedSheets row pointing at the given question IDs so
// the renderer has something to chew on. Returns the new sheet id.
export const _smokeSeedSheet = internalMutation({
  args: {
    studentId: v.id("students"),
    questionIds: v.array(v.id("questionBank")),
    dateStr: v.string(),
  },
  handler: async (ctx, args): Promise<Id<"generatedSheets">> => {
    // Split the questions across the three sections so we exercise all
    // banners. At least one Q goes in main; warmup/exam get the rest.
    const qs = args.questionIds;
    const warmup = qs.slice(0, Math.min(2, qs.length));
    const main = qs.slice(2, Math.max(2, qs.length - 1));
    const exam = qs.slice(Math.max(2, qs.length - 1));
    const id = await ctx.db.insert("generatedSheets", {
      studentId: args.studentId,
      date: args.dateStr,
      generatedAt: Date.now(),
      warmupQuestionIds: warmup,
      mainQuestionIds: main.length > 0 ? main : [qs[0]],
      examPrepQuestionIds: exam,
      status: "draft",
    });
    return id;
  },
});

// Remove a fake sheet seeded by _smokeSeedSheet + its rendered PDF blob.
// Safe to call on any sheet — it's a hard delete.
// Diagnostic: returns cropBox + the page image's actual pixel dimensions
// (by fetching the bytes and sniffing the PNG/JPEG header). Lets us
// compare what the cropping UI saved vs what fitCropSlot sees at render
// time — the two need to agree on dimensions, else crops misalign.
export const _smokeInspectCrops = internalAction({
  args: { questionIds: v.array(v.id("questionBank")) },
  handler: async (ctx, args) => {
    const out: Array<{
      questionId: Id<"questionBank">;
      cropBox: { x: number; y: number; w: number; h: number } | null;
      pageImageUrl: string | null;
      imageNaturalWidth: number | null;
      imageNaturalHeight: number | null;
      imageMime: string | null;
      imageBytes: number | null;
    }> = [];

    for (const qid of args.questionIds) {
      const data: RenderSheetData | null = await ctx.runQuery(
        internal.learningEngine.pdfHelpers.getSheetForRender,
        // Wrap: getSheetForRender takes a sheetId — we don't have one.
        // Use a per-question lookup instead.
        { sheetId: qid as unknown as Id<"generatedSheets"> },
      ).catch(() => null);
      if (data) {
        // unused path — keeps the type-check happy
      }
    }
    // Direct DB walk (simpler than going through getSheetForRender):
    for (const qid of args.questionIds) {
      const inspect = await ctx.runQuery(
        internal.learningEngine.pdf._smokeInspectCropDb,
        { questionId: qid },
      );
      const pageImageUrl = inspect.pageImageUrl;
      let imageNaturalWidth: number | null = null;
      let imageNaturalHeight: number | null = null;
      let imageMime: string | null = null;
      let imageBytes: number | null = null;
      if (pageImageUrl) {
        try {
          const res = await fetch(pageImageUrl);
          if (res.ok) {
            const buf = new Uint8Array(await res.arrayBuffer());
            imageBytes = buf.byteLength;
            if (buf[0] === 0x89 && buf[1] === 0x50) {
              imageMime = "image/png";
              // PNG IHDR: width at bytes 16–19, height 20–23 (big-endian)
              imageNaturalWidth =
                (buf[16] << 24) | (buf[17] << 16) | (buf[18] << 8) | buf[19];
              imageNaturalHeight =
                (buf[20] << 24) | (buf[21] << 16) | (buf[22] << 8) | buf[23];
            } else if (buf[0] === 0xff && buf[1] === 0xd8) {
              imageMime = "image/jpeg";
              // Scan JPEG segments for SOF (start-of-frame) marker. Minimal.
              let i = 2;
              while (i < buf.byteLength - 9) {
                if (buf[i] !== 0xff) {
                  i += 1;
                  continue;
                }
                const marker = buf[i + 1];
                if (
                  marker === 0xc0 ||
                  marker === 0xc1 ||
                  marker === 0xc2
                ) {
                  imageNaturalHeight = (buf[i + 5] << 8) | buf[i + 6];
                  imageNaturalWidth = (buf[i + 7] << 8) | buf[i + 8];
                  break;
                }
                const segLen = (buf[i + 2] << 8) | buf[i + 3];
                i += 2 + segLen;
              }
            }
          }
        } catch {
          // ignore — image unreachable
        }
      }
      out.push({
        questionId: qid,
        cropBox: inspect.cropBox,
        pageImageUrl,
        imageNaturalWidth,
        imageNaturalHeight,
        imageMime,
        imageBytes,
      });
    }
    return out;
  },
});

export const _smokeInspectCropDb = internalQuery({
  args: { questionId: v.id("questionBank") },
  handler: async (ctx, args) => {
    const q = await ctx.db.get(args.questionId);
    if (!q) return { cropBox: null, pageImageUrl: null };
    let pageImageUrl: string | null = null;
    if (q.textbookPageId) {
      const p = await ctx.db.get(q.textbookPageId);
      if (p) pageImageUrl = await ctx.storage.getUrl(p.storageId);
    } else if (q.pastPaperPageId) {
      const p = await ctx.db.get(q.pastPaperPageId);
      if (p) pageImageUrl = await ctx.storage.getUrl(p.storageId);
    }
    return { cropBox: q.cropBox ?? null, pageImageUrl };
  },
});

export const _smokeCleanupSheet = internalMutation({
  args: { sheetId: v.id("generatedSheets") },
  handler: async (ctx, args): Promise<{ deleted: boolean }> => {
    const s = await ctx.db.get(args.sheetId);
    if (!s) return { deleted: false };
    if (s.pdfStorageId) {
      try {
        await ctx.storage.delete(s.pdfStorageId);
      } catch {
        // ignore — already gone
      }
    }
    await ctx.db.delete(args.sheetId);
    return { deleted: true };
  },
});

export const _smokePickAnySheet = internalQuery({
  args: {},
  handler: async (
    ctx,
  ): Promise<{
    totalSheets: number;
    populatedSheets: number;
    sample: Array<{
      sheetId: Id<"generatedSheets">;
      date: string;
      counts: { warmup: number; main: number; revision: number; examPrep: number };
      hasPdf: boolean;
    }>;
    pick: {
      sheetId: Id<"generatedSheets">;
      studentId: Id<"students">;
      date: string;
      questionCount: number;
    } | null;
  }> => {
    // Diagnostic mode: summarise the sheet table so the smoke test can see
    // whether any rows exist at all, before deciding what to render.
    const all = await ctx.db.query("generatedSheets").order("desc").take(100);
    const populated = all.filter(
      (s) =>
        s.warmupQuestionIds.length +
          s.mainQuestionIds.length +
          (s.revisionQuestionIds ?? []).length +
          s.examPrepQuestionIds.length >
        0,
    );
    const sample = all.slice(0, 5).map((s) => ({
      sheetId: s._id,
      date: s.date,
      counts: {
        warmup: s.warmupQuestionIds.length,
        main: s.mainQuestionIds.length,
        revision: (s.revisionQuestionIds ?? []).length,
        examPrep: s.examPrepQuestionIds.length,
      },
      hasPdf: !!s.pdfStorageId,
    }));
    const pickRow = populated[0];
    return {
      totalSheets: all.length,
      populatedSheets: populated.length,
      sample,
      pick: pickRow
        ? {
            sheetId: pickRow._id,
            studentId: pickRow.studentId,
            date: pickRow.date,
            questionCount:
              pickRow.warmupQuestionIds.length +
              pickRow.mainQuestionIds.length +
              (pickRow.revisionQuestionIds ?? []).length +
              pickRow.examPrepQuestionIds.length,
          }
        : null,
    };
  },
});

// Dry-run: compute the slot & draw rectangles for every Q in a sheet
// WITHOUT actually producing a PDF. Lets us inspect whether fitCropSlot +
// computeClippedDrawRect agree with the cropping UI's reference frame.
export const _smokeDryRunGeometry = internalAction({
  args: { sheetId: v.id("generatedSheets") },
  handler: async (ctx, args) => {
    const data: RenderSheetData | null = await ctx.runQuery(
      internal.learningEngine.pdfHelpers.getSheetForRender,
      { sheetId: args.sheetId },
    );
    if (!data) throw new Error("Sheet not found");

    type GeoRow = {
      qid: Id<"questionBank">;
      cropBox: { x: number; y: number; w: number; h: number } | null;
      imgWidth: number | null;
      imgHeight: number | null;
      slot: { widthMm: number; heightMm: number } | null;
      draw: {
        offsetXMm: number;
        offsetYMm: number;
        widthMm: number;
        heightMm: number;
      } | null;
    };
    const rows: GeoRow[] = [];

    // We need image dimensions — sniff JPEG/PNG headers via fetch.
    const all = [...data.warmup, ...data.main, ...data.revision, ...data.examPrep];
    for (const q of all) {
      const row: GeoRow = {
        qid: q.questionId,
        cropBox: q.cropBox,
        imgWidth: null,
        imgHeight: null,
        slot: null,
        draw: null,
      };
      if (q.pageImageUrl && q.cropBox) {
        try {
          const res = await fetch(q.pageImageUrl);
          if (res.ok) {
            const buf = new Uint8Array(await res.arrayBuffer());
            if (buf[0] === 0x89 && buf[1] === 0x50) {
              row.imgWidth =
                (buf[16] << 24) | (buf[17] << 16) | (buf[18] << 8) | buf[19];
              row.imgHeight =
                (buf[20] << 24) | (buf[21] << 16) | (buf[22] << 8) | buf[23];
            } else if (buf[0] === 0xff && buf[1] === 0xd8) {
              let i = 2;
              while (i < buf.byteLength - 9) {
                if (buf[i] !== 0xff) {
                  i += 1;
                  continue;
                }
                const m = buf[i + 1];
                if (m === 0xc0 || m === 0xc1 || m === 0xc2) {
                  row.imgHeight = (buf[i + 5] << 8) | buf[i + 6];
                  row.imgWidth = (buf[i + 7] << 8) | buf[i + 8];
                  break;
                }
                const segLen = (buf[i + 2] << 8) | buf[i + 3];
                i += 2 + segLen;
              }
            }
          }
        } catch {
          // ignore
        }
        if (row.imgWidth && row.imgHeight) {
          // Reproduce fitCropSlot + computeClippedDrawRect in mm.
          const cw = Math.max(0.001, Math.min(1, q.cropBox.w));
          const ch = Math.max(0.001, Math.min(1, q.cropBox.h));
          const cx = Math.max(0, Math.min(1, q.cropBox.x));
          const cy = Math.max(0, Math.min(1, q.cropBox.y));
          const cropPxW = row.imgWidth * cw;
          const cropPxH = row.imgHeight * ch;
          const aspect = cropPxW / cropPxH;
          let sw = 80; // mm
          let sh = sw / aspect;
          if (sh > 60) {
            sh = 60;
            sw = sh * aspect;
          }
          const drawWmm = sw / cw;
          const drawHmm = sh / ch;
          const offsetXmm = -cx * drawWmm;
          const offsetYmm = -(1 - cy - ch) * drawHmm;
          row.slot = { widthMm: sw, heightMm: sh };
          row.draw = {
            offsetXMm: offsetXmm,
            offsetYMm: offsetYmm,
            widthMm: drawWmm,
            heightMm: drawHmm,
          };
        }
      }
      rows.push(row);
    }
    return rows;
  },
});

export const _smokeRender = internalAction({
  args: {
    sheetId: v.optional(v.id("generatedSheets")),
    onMissingImage: v.optional(
      v.union(v.literal("fail"), v.literal("skip")),
    ),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    sheetId: Id<"generatedSheets">;
    storageId: Id<"_storage">;
    downloadUrl: string | null;
    questionCount: number;
    renderedCount: number;
    pageCount: number;
    missingCount: number;
    missing: MissingImageItem[];
    pdfByteSize: number;
  }> => {
    let sheetId: Id<"generatedSheets"> | undefined = args.sheetId;
    if (!sheetId) {
      const diag = await ctx.runQuery(
        internal.learningEngine.pdf._smokePickAnySheet,
        {},
      );
      if (!diag.pick) {
        throw new Error(
          `No populated sheets to smoke-test (total=${diag.totalSheets}, populated=${diag.populatedSheets}).`,
        );
      }
      sheetId = diag.pick.sheetId;
    }
    const policy: MissingImagePolicy = args.onMissingImage ?? "skip";

    const data: RenderSheetData | null = await ctx.runQuery(
      internal.learningEngine.pdfHelpers.getSheetForRender,
      { sheetId },
    );
    if (!data) throw new Error("Sheet not found");

    const { bytes, pageCount, missing, rendered } = await buildPDF(
      data,
      policy,
    );
    const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
    const storageId = await ctx.storage.store(blob);
    await ctx.runMutation(internal.learningEngine.pdfHelpers.setPdfStorageId, {
      sheetId,
      storageId,
    });
    const downloadUrl = await ctx.storage.getUrl(storageId);

    return {
      sheetId,
      storageId,
      downloadUrl,
      questionCount:
        data.warmup.length +
        data.main.length +
        data.revision.length +
        data.examPrep.length,
      renderedCount:
        rendered.warmup + rendered.main + rendered.revision + rendered.examPrep,
      pageCount,
      missingCount: missing.length,
      missing,
      pdfByteSize: bytes.length,
    };
  },
});

export const renderSheetPDF = action({
  args: {
    sheetId: v.id("generatedSheets"),
    // Optional render policy. Defaults to "fail" so the Lead sees a clear
    // error (with the missing Q list) instead of a silently-broken PDF.
    // Pass "skip" from the [Force render] button after triaging the cause.
    onMissingImage: v.optional(
      v.union(v.literal("fail"), v.literal("skip")),
    ),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    sheetId: Id<"generatedSheets">;
    storageId: Id<"_storage">;
    questionCount: number;
    renderedCount: number;
    pageCount: number;
    missing: MissingImageItem[];
    policy: MissingImagePolicy;
  }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");

    const policy: MissingImagePolicy = args.onMissingImage ?? "fail";

    const data: RenderSheetData | null = await ctx.runQuery(
      internal.learningEngine.pdfHelpers.getSheetForRender,
      { sheetId: args.sheetId },
    );
    if (!data) throw new Error("Sheet not found");

    const { bytes, pageCount, missing, rendered } = await buildPDF(
      data,
      policy,
    );
    const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
    const storageId = await ctx.storage.store(blob);

    await ctx.runMutation(internal.learningEngine.pdfHelpers.setPdfStorageId, {
      sheetId: args.sheetId,
      storageId,
    });

    const questionCount =
      data.warmup.length +
      data.main.length +
      data.revision.length +
      data.examPrep.length;
    const renderedCount =
      rendered.warmup + rendered.main + rendered.revision + rendered.examPrep;

    return {
      sheetId: args.sheetId,
      storageId,
      questionCount,
      renderedCount,
      pageCount,
      missing,
      policy,
    };
  },
});

// Print-preview for a PLANNED group sheet (planner Sheets tab, 2026-07-17):
// renders the Main block ([new..., spiral...] — exactly the materialization
// order) through the same composer as the real per-student PDF, caches the
// blob on the row, and returns a URL the dialog can embed. Policy defaults
// to "skip" so a missing page image degrades to a placeholder instead of
// blocking the preview; incomplete CROPPING still throws (that must be
// fixed, not previewed around).
export const renderGroupSheetPDF = action({
  args: { groupSheetId: v.id("groupSheets") },
  handler: async (
    ctx,
    args,
  ): Promise<{ url: string; pageCount: number; questionCount: number }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");

    const data: RenderSheetData | null = await ctx.runQuery(
      internal.learningEngine.pdfHelpers.getGroupSheetForRender,
      { groupSheetId: args.groupSheetId },
    );
    if (!data) throw new Error("Group sheet not found");

    const { bytes, pageCount } = await buildPDF(data, "skip");
    const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
    const storageId = await ctx.storage.store(blob);
    await ctx.runMutation(
      internal.learningEngine.pdfHelpers.setGroupSheetPreviewPdf,
      { groupSheetId: args.groupSheetId, storageId },
    );
    const url = await ctx.storage.getUrl(storageId);
    if (!url) throw new Error("Preview stored but URL unavailable");
    return { url, pageCount, questionCount: data.main.length };
  },
});
