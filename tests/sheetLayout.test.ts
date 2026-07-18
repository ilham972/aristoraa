// Pure pagination estimator (sessions redesign 2026-07-18): predicts which
// A4 page each question of a group sheet prints on, mirroring pdf.ts layout
// math. The exact mapping from a real render always wins — this covers the
// estimate used before any print preview exists.

import { describe, it, expect } from 'vitest';
import { estimatePageBreaks } from '../convex/lib/sheetLayout';

const crop = (w: number, h: number) => ({
  cropBox: { w, h },
  overrideSize: null,
});

describe('estimatePageBreaks', () => {
  it('returns empty for an empty sheet', () => {
    expect(estimatePageBreaks([])).toEqual([]);
  });

  it('packs small questions onto page 1 and breaks to page 2 when full', () => {
    // h=0.1 of an A4 page ⇒ ~29.7mm slot; block ≈ 69.7mm; usable ≈ 258mm
    // after the section banner ⇒ 3 blocks per page.
    const qs = Array.from({ length: 6 }, () => crop(0.6, 0.1));
    expect(estimatePageBreaks(qs)).toEqual([1, 1, 1, 2, 2, 2]);
  });

  it('a question never splits across pages (whole block moves)', () => {
    // Two big crops (capped at 85mm slot ⇒ 125mm block): both fit page 1
    // (258mm), a third breaks.
    const qs = [crop(0.8, 0.5), crop(0.8, 0.5), crop(0.8, 0.5)];
    expect(estimatePageBreaks(qs)).toEqual([1, 1, 2]);
  });

  it('typed overrides use their exact stored print size', () => {
    // 20mm high override ⇒ 60mm block ⇒ 4 per page.
    const qs = Array.from({ length: 5 }, () => ({
      cropBox: null,
      overrideSize: { widthMm: 100, heightMm: 20 },
    }));
    expect(estimatePageBreaks(qs)).toEqual([1, 1, 1, 1, 2]);
  });

  it('missing crop data budgets the max slot height (pessimistic)', () => {
    const qs = [
      { cropBox: null, overrideSize: null },
      { cropBox: null, overrideSize: null },
      { cropBox: null, overrideSize: null },
    ];
    // 85mm slot ⇒ 125mm block ⇒ 2 per page.
    expect(estimatePageBreaks(qs)).toEqual([1, 1, 2]);
  });
});
