// Pure parser for typed question overrides ("digitalize as you go").
//
// Source format: free text (Tamil/English) with inline math between single
// dollar signs — e.g. `தீர்க்கவும்: $\frac{3}{4} + \frac{1}{2}$`.
// Newlines are honored. An UNPAIRED `$` is treated as literal text so the
// live preview never explodes mid-typing.
//
// Kept DOM-free so vitest can cover it; the canvas/MathJax side lives in
// typeset-render.ts.

export type TypesetSegment =
  | { type: "text"; value: string }
  | { type: "math"; value: string }
  | { type: "newline" };

export function parseTypesetSource(src: string): TypesetSegment[] {
  const out: TypesetSegment[] = [];
  const lines = src.split("\n");
  for (let li = 0; li < lines.length; li++) {
    if (li > 0) out.push({ type: "newline" });
    const line = lines[li];
    let i = 0;
    let textStart = 0;
    while (i < line.length) {
      if (line[i] === "$") {
        const close = line.indexOf("$", i + 1);
        if (close === -1) {
          // Unpaired $ — literal text to end of line.
          break;
        }
        if (i > textStart) {
          out.push({ type: "text", value: line.slice(textStart, i) });
        }
        const tex = line.slice(i + 1, close).trim();
        if (tex.length > 0) out.push({ type: "math", value: tex });
        i = close + 1;
        textStart = i;
        continue;
      }
      i++;
    }
    if (textStart < line.length) {
      out.push({ type: "text", value: line.slice(textStart) });
    }
  }
  return out;
}

// True when the source contains at least one non-whitespace character
// outside/inside math — the "can this be saved" check.
export function typesetSourceHasContent(src: string): boolean {
  return src.trim().length > 0;
}
