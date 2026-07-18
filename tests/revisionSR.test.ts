// lib/revisionSR.ts — the shared SR brain for routed ("yellow") questions:
// real revision queues AND the Lesson Builder Timeline prediction use these
// exact functions, so these tests pin the behavior both surfaces share.

import { describe, it, expect } from 'vitest';
import {
  orderRoutedForRevision,
  predictRevisionDates,
  type ConceptMemorySummary,
  type RoutedCandidate,
} from '../convex/lib/revisionSR';

const DAY = 86_400_000;
const NOW = Date.parse('2026-07-19T12:00:00Z');

const mem = (daysAgo: number, r: number): ConceptMemorySummary => ({
  lastReviewAt: NOW - daysAgo * DAY,
  r,
});

const cand = (
  qid: string,
  difficulty: number,
  bookIdx: number,
  conceptIds: string[],
): RoutedCandidate => ({ qid, difficulty, bookIdx, conceptIds });

describe('orderRoutedForRevision', () => {
  it('serves due questions weakest memory first, easy→hard tie-break', () => {
    const memory = new Map([
      ['weak', mem(10, 0.2)],
      ['strong', mem(10, 0.9)],
    ]);
    const out = orderRoutedForRevision(
      [
        cand('strongQ', 1, 0, ['strong']),
        cand('weakHard', 4, 1, ['weak']),
        cand('weakEasy', 2, 2, ['weak']),
      ],
      memory,
      NOW,
      3,
    );
    expect(out).toEqual(['weakEasy', 'weakHard', 'strongQ']);
  });

  it('holds back never-introduced concepts entirely', () => {
    const memory = new Map([['taught', mem(5, 0.5)]]);
    const out = orderRoutedForRevision(
      [cand('ok', 1, 0, ['taught']), cand('early', 1, 1, ['never'])],
      memory,
      NOW,
      3,
    );
    expect(out).toEqual(['ok']);
  });

  it('inside-the-gap questions only top up AFTER every due one', () => {
    const memory = new Map([
      ['fresh', mem(1, 0.9)], // reviewed yesterday: gap < 3d
      ['due', mem(9, 0.95)], // stronger memory but properly spaced
    ]);
    const out = orderRoutedForRevision(
      [cand('freshQ', 1, 0, ['fresh']), cand('dueQ', 5, 1, ['due'])],
      memory,
      NOW,
      3,
    );
    expect(out).toEqual(['dueQ', 'freshQ']);
  });

  it('a multi-concept question needs EVERY concept introduced; weakest drives', () => {
    const memory = new Map([
      ['a', mem(9, 0.8)],
      ['b', mem(9, 0.1)],
    ]);
    const out = orderRoutedForRevision(
      [
        cand('both', 3, 0, ['a', 'b']), // weakest link r=0.1
        cand('onlyA', 3, 1, ['a']),
        cand('halfTaught', 1, 2, ['a', 'never']),
      ],
      memory,
      NOW,
      3,
    );
    expect(out).toEqual(['both', 'onlyA']);
  });

  it('untagged legacy questions keep the old always-served behavior', () => {
    const out = orderRoutedForRevision(
      [cand('legacy', 3, 0, [])],
      new Map(),
      NOW,
      3,
    );
    expect(out).toEqual(['legacy']);
  });
});

describe('predictRevisionDates', () => {
  const yellow = (
    qid: string,
    difficulty: number,
    bookIdx: number,
    introDate: string | null,
  ) => ({ qid, difficulty, bookIdx, introDate });

  it('lands a question on the first revision day after intro + gap', () => {
    const out = predictRevisionDates(
      [yellow('q1', 2, 0, '2026-07-20')],
      ['2026-07-21', '2026-07-24'],
      3,
      10,
    );
    // Due 2026-07-23 → the 21st is too soon, the 24th serves it.
    expect(out.get('q1')).toBe('2026-07-24');
  });

  it('respects the per-day cap and spills the rest to the next day', () => {
    const out = predictRevisionDates(
      [
        yellow('a', 1, 0, '2026-07-10'),
        yellow('b', 2, 1, '2026-07-10'),
        yellow('c', 3, 2, '2026-07-10'),
      ],
      ['2026-07-20', '2026-07-27'],
      3,
      2,
    );
    expect(out.get('a')).toBe('2026-07-20');
    expect(out.get('b')).toBe('2026-07-20');
    expect(out.get('c')).toBe('2026-07-27');
  });

  it('no intro scheduled → the question stays waiting (absent from the map)', () => {
    const out = predictRevisionDates(
      [yellow('q1', 1, 0, null)],
      ['2026-07-20'],
      3,
      10,
    );
    expect(out.has('q1')).toBe(false);
  });

  it('runs out of revision days → later questions stay waiting', () => {
    const out = predictRevisionDates(
      [yellow('a', 1, 0, '2026-07-10'), yellow('b', 2, 1, '2026-07-10')],
      ['2026-07-20'],
      3,
      1,
    );
    expect(out.get('a')).toBe('2026-07-20');
    expect(out.has('b')).toBe(false);
  });
});
