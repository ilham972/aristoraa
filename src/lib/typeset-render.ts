// Browser-side typesetter for typed question overrides.
//
// Takes the override source (Tamil/English text + $TeX$ math, see
// typeset-parse.ts), typesets it onto a canvas and returns a PNG blob plus
// its physical print size in mm. The PDF renderer then draws that PNG at
// exactly this size, so the live preview in the editor IS what prints.
//
// How: text runs are drawn with canvas fillText (the browser does Tamil
// shaping natively); math runs go through MathJax's TeX→SVG converter
// (glyphs as <path> data — no font dependencies) and are rasterized onto
// the same canvas, baseline-aligned via the vertical-align MathJax reports.
//
// Why client-side at save time (not server-side at render time): MathJax +
// canvas need a browser; the Convex runtime has neither. Rendering once at
// save also means zero per-PDF cost.
//
// MUST stay browser-only (canvas, Image, document.fonts). MathJax is
// dynamically imported on first use so it never lands in the main bundle.

import { parseTypesetSource } from "./typeset-parse";

// ── Physical constants ──────────────────────────────────────────────────
// 12 px/mm ≈ 305 DPI — comfortably print-crisp. 11pt body text matches the
// feel of an exam paper and sits close to typical textbook body size.
const PX_PER_MM = 12;
const FONT_PT = 11;
const FONT_MM = (FONT_PT * 25.4) / 72; // ≈ 3.88mm
const FONT_PX = FONT_MM * PX_PER_MM; // ≈ 46.6px
// Max line width on the printed sheet (A4 content width minus margins,
// minus a little safety).
const MAX_WIDTH_MM = 180;
const MAX_WIDTH_PX = MAX_WIDTH_MM * PX_PER_MM;
// MathJax sizes its SVG in `ex` units of the surrounding font. The MathJax
// TeX font's x-height is 0.442em — the constant MathJax itself uses.
const EX_TO_PX = FONT_PX * 0.442;
const LINE_GAP_PX = FONT_PX * 0.4;
const PADDING_PX = Math.round(PX_PER_MM * 0.8); // ~0.8mm breathing room
// Tamil-capable stack. The PDF embeds Noto Sans Tamil; if the browser has
// it (or any Tamil-shaping fallback) the preview matches the print closely.
const FONT_FAMILY =
  '"Noto Sans Tamil", "Nirmala UI", "Latha", "Inter", system-ui, sans-serif';

export type TypesetResult = {
  blob: Blob;
  dataUrl: string; // preview <img> source
  widthMm: number;
  heightMm: number;
};

// ── MathJax (lazy singleton) ────────────────────────────────────────────

type TexToSvg = (tex: string) => {
  svg: string;
  widthEx: number;
  heightEx: number;
  valignEx: number; // negative = descends below the text baseline
};

let texToSvgPromise: Promise<TexToSvg> | null = null;

function getTexToSvg(): Promise<TexToSvg> {
  if (texToSvgPromise) return texToSvgPromise;
  texToSvgPromise = (async () => {
    const [{ mathjax }, { TeX }, { SVG }, { liteAdaptor }, { RegisterHTMLHandler }, { AllPackages }] =
      await Promise.all([
        import("mathjax-full/js/mathjax.js"),
        import("mathjax-full/js/input/tex.js"),
        import("mathjax-full/js/output/svg.js"),
        import("mathjax-full/js/adaptors/liteAdaptor.js"),
        import("mathjax-full/js/handlers/html.js"),
        import("mathjax-full/js/input/tex/AllPackages.js"),
      ]);
    const adaptor = liteAdaptor();
    RegisterHTMLHandler(adaptor);
    const tex = new TeX({ packages: AllPackages });
    // fontCache "local": every glyph path is inlined into each SVG, so the
    // rasterized <img> needs no external resources.
    const svg = new SVG({ fontCache: "local" });
    const doc = mathjax.document("", { InputJax: tex, OutputJax: svg });

    return (texSrc: string) => {
      const node = doc.convert(texSrc, { display: false });
      const html = adaptor.outerHTML(node);
      if (html.includes("data-mjx-error")) {
        const m = html.match(/data-mjx-error="([^"]*)"/);
        throw new Error(`Math error: ${m ? m[1] : "invalid expression"}`);
      }
      // Pull the bare <svg>…</svg> out of the <mjx-container> wrapper.
      const svgStart = html.indexOf("<svg");
      const svgEnd = html.lastIndexOf("</svg>");
      if (svgStart === -1 || svgEnd === -1) throw new Error("Math render failed");
      const svgMarkup = html.slice(svgStart, svgEnd + 6);
      const widthEx = parseFloat(svgMarkup.match(/width="([\d.]+)ex"/)?.[1] ?? "1");
      const heightEx = parseFloat(svgMarkup.match(/height="([\d.]+)ex"/)?.[1] ?? "1");
      const valignEx = parseFloat(
        svgMarkup.match(/vertical-align:\s*(-?[\d.]+)ex/)?.[1] ?? "0",
      );
      return { svg: svgMarkup, widthEx, heightEx, valignEx };
    };
  })();
  return texToSvgPromise;
}

function svgToImage(svgMarkup: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const blob = new Blob([svgMarkup], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Math image rasterization failed"));
    };
    img.src = url;
  });
}

// ── Layout ──────────────────────────────────────────────────────────────

type Item =
  | { kind: "word"; str: string; w: number }
  | {
      kind: "math";
      img: HTMLImageElement;
      w: number;
      h: number;
      // Distance the math box extends below the text baseline, in px.
      depth: number;
    };

type Line = { items: Item[]; width: number; ascent: number; descent: number };

export async function renderTypeset(src: string): Promise<TypesetResult> {
  const segments = parseTypesetSource(src);
  if (segments.length === 0) throw new Error("Nothing to render");

  // Fonts must be loaded before measuring or widths drift between preview
  // renders.
  await document.fonts.ready;

  const measureCanvas = document.createElement("canvas");
  const mctx = measureCanvas.getContext("2d")!;
  mctx.font = `${FONT_PX}px ${FONT_FAMILY}`;
  const probe = mctx.measureText("Mgயீ");
  const textAscent = probe.fontBoundingBoxAscent ?? FONT_PX * 0.85;
  const textDescent = probe.fontBoundingBoxDescent ?? FONT_PX * 0.3;

  const texToSvg = await getTexToSvg();

  // Flatten segments into wrappable items.
  const items: (Item | { kind: "break" })[] = [];
  for (const seg of segments) {
    if (seg.type === "newline") {
      items.push({ kind: "break" });
      continue;
    }
    if (seg.type === "math") {
      const { svg, widthEx, heightEx, valignEx } = texToSvg(seg.value);
      const img = await svgToImage(svg);
      const w = widthEx * EX_TO_PX;
      const h = heightEx * EX_TO_PX;
      const depth = -valignEx * EX_TO_PX; // valign is negative below baseline
      items.push({ kind: "math", img, w, h, depth });
      continue;
    }
    // Text → words (spaces glued to the preceding word so wrapping eats
    // trailing whitespace naturally).
    for (const token of seg.value.split(/(\s+)/)) {
      if (token.length === 0) continue;
      items.push({ kind: "word", str: token, w: mctx.measureText(token).width });
    }
  }

  // Greedy wrap into lines.
  const lines: Line[] = [];
  let cur: Item[] = [];
  let curW = 0;
  const flush = () => {
    let ascent = textAscent;
    let descent = textDescent;
    for (const it of cur) {
      if (it.kind === "math") {
        ascent = Math.max(ascent, it.h - it.depth);
        descent = Math.max(descent, it.depth);
      }
    }
    lines.push({ items: cur, width: curW, ascent, descent });
    cur = [];
    curW = 0;
  };
  for (const it of items) {
    if (it.kind === "break") {
      flush();
      continue;
    }
    const isSpace = it.kind === "word" && /^\s+$/.test(it.str);
    if (curW + it.w > MAX_WIDTH_PX && cur.length > 0 && !isSpace) {
      flush();
    }
    if (cur.length === 0 && isSpace) continue; // no leading spaces
    cur.push(it);
    curW += it.w;
  }
  flush();

  // Canvas size from measured lines.
  let contentW = 0;
  let contentH = 0;
  for (let i = 0; i < lines.length; i++) {
    contentW = Math.max(contentW, lines[i].width);
    contentH += lines[i].ascent + lines[i].descent;
    if (i > 0) contentH += LINE_GAP_PX;
  }
  contentW = Math.min(Math.max(contentW, 1), MAX_WIDTH_PX);
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(contentW + PADDING_PX * 2);
  canvas.height = Math.ceil(contentH + PADDING_PX * 2);
  const ctx = canvas.getContext("2d")!;
  // Opaque white: matches paper, and keeps the snapshot legible in the
  // dark-themed app UI.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = `${FONT_PX}px ${FONT_FAMILY}`;
  ctx.fillStyle = "#16191e"; // near-black, matches the PDF text color
  ctx.textBaseline = "alphabetic";

  let y = PADDING_PX;
  for (const line of lines) {
    const baseline = y + line.ascent;
    let x = PADDING_PX;
    for (const it of line.items) {
      if (it.kind === "word") {
        ctx.fillText(it.str, x, baseline);
      } else {
        ctx.drawImage(it.img, x, baseline - (it.h - it.depth), it.w, it.h);
      }
      x += it.w;
    }
    y = baseline + line.descent + LINE_GAP_PX;
  }

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("PNG export failed"))),
      "image/png",
    );
  });

  return {
    blob,
    dataUrl: canvas.toDataURL("image/png"),
    widthMm: canvas.width / PX_PER_MM,
    heightMm: canvas.height / PX_PER_MM,
  };
}
