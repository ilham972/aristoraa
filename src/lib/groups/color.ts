// Phase F: deterministic group colors.
//
// The user can't pick colors — every group gets one assigned automatically
// and consistently from its id. Requirements they gave:
//   • subtle, from the same color family (no rainbow / no neon)
//   • same group → same color everywhere it appears
//   • visually scannable: "how many slots does this group own?"
//
// We pick from a fixed palette of muted hues that all sit at the same
// saturation/lightness band so the weekly grid reads as a cohesive set
// rather than a clown car. Each entry ships a solid (cell fill), a soft
// (chip/badge bg), border, and text token tuned for the dark-navy surface.
//
// Hashing: FNV-1a over the id string → palette index. Stable across reloads
// and machines (no Math.random, no Date).

export type GroupColor = {
  /** Saturated cell fill for the weekly grid (text should be `onSolid`). */
  solid: string;
  onSolid: string;
  /** Translucent fill for chips / cards on dark surfaces. */
  soft: string;
  /** Border that pairs with `soft`. */
  border: string;
  /** Readable text color on `soft` / transparent surfaces. */
  text: string;
};

// 8 hues spanning a muted blue → violet → magenta → amber → teal arc. All
// share L≈58 / S≈55 on the solid so they feel like one family. Values are
// hand-tuned hex rather than runtime hsl() so they render identically in
// canvas/PDF contexts later if needed.
const PALETTE: GroupColor[] = [
  // indigo
  { solid: "#5B6FD6", onSolid: "#FFFFFF", soft: "rgba(91,111,214,0.16)", border: "rgba(91,111,214,0.40)", text: "#A9B6F0" },
  // blue
  { solid: "#4A8FD4", onSolid: "#FFFFFF", soft: "rgba(74,143,212,0.16)", border: "rgba(74,143,212,0.40)", text: "#9CC4ED" },
  // violet
  { solid: "#8A6FD0", onSolid: "#FFFFFF", soft: "rgba(138,111,208,0.16)", border: "rgba(138,111,208,0.40)", text: "#C0AEEC" },
  // magenta
  { solid: "#C56BB0", onSolid: "#FFFFFF", soft: "rgba(197,107,176,0.16)", border: "rgba(197,107,176,0.40)", text: "#E3ABD5" },
  // rose
  { solid: "#D06A78", onSolid: "#FFFFFF", soft: "rgba(208,106,120,0.16)", border: "rgba(208,106,120,0.40)", text: "#ECABB4" },
  // amber
  { solid: "#C68A45", onSolid: "#FFFFFF", soft: "rgba(198,138,69,0.16)", border: "rgba(198,138,69,0.40)", text: "#E6C089" },
  // teal
  { solid: "#3FA89A", onSolid: "#FFFFFF", soft: "rgba(63,168,154,0.16)", border: "rgba(63,168,154,0.40)", text: "#8FD6CB" },
  // sea-green
  { solid: "#5BA86F", onSolid: "#FFFFFF", soft: "rgba(91,168,111,0.16)", border: "rgba(91,168,111,0.40)", text: "#A6D6B2" },
];

function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Stable color for a group id (or any string seed). */
export function groupColor(seed: string): GroupColor {
  return PALETTE[fnv1a(seed) % PALETTE.length];
}

export const GROUP_PALETTE_SIZE = PALETTE.length;
