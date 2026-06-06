import { describe, it, expect } from 'vitest';
import {
  toggleBand,
  findContiguousRuns,
  mergeAttendanceStatus,
  mergeLogStatus,
  type SlotRange,
} from '../convex/lib/slotNormalize';

const b = (start: string, end: string) => ({ start, end });

describe('toggleBand — add', () => {
  it('adds an hour to an empty day', () => {
    const { result, toggled } = toggleBand([], b('15:00', '16:00'));
    expect(toggled).toBe('added');
    expect(result).toEqual([{ startTime: '15:00', endTime: '16:00', sourceId: null }]);
  });

  it('fuses with an adjacent slot, keeping the existing id', () => {
    const existing: SlotRange[] = [{ id: 'A', startTime: '15:00', endTime: '16:00' }];
    const { result, toggled } = toggleBand(existing, b('16:00', '17:00'));
    expect(toggled).toBe('added');
    expect(result).toEqual([{ startTime: '15:00', endTime: '17:00', sourceId: 'A' }]);
  });

  it('fuses across a filled gap, keeping the earliest id', () => {
    const existing: SlotRange[] = [
      { id: 'A', startTime: '15:00', endTime: '16:00' },
      { id: 'B', startTime: '17:00', endTime: '18:00' },
    ];
    const { result } = toggleBand(existing, b('16:00', '17:00'));
    expect(result).toEqual([{ startTime: '15:00', endTime: '18:00', sourceId: 'A' }]);
  });

  it('does not fuse across a gap', () => {
    const existing: SlotRange[] = [{ id: 'A', startTime: '15:00', endTime: '16:00' }];
    const { result } = toggleBand(existing, b('17:00', '18:00'));
    expect(result).toEqual([
      { startTime: '15:00', endTime: '16:00', sourceId: 'A' },
      { startTime: '17:00', endTime: '18:00', sourceId: null },
    ]);
  });
});

describe('toggleBand — remove', () => {
  it('removes a whole 1-hour slot', () => {
    const existing: SlotRange[] = [{ id: 'A', startTime: '15:00', endTime: '16:00' }];
    const { result, toggled } = toggleBand(existing, b('15:00', '16:00'));
    expect(toggled).toBe('removed');
    expect(result).toEqual([]);
  });

  it('shrinks at the end edge, keeping the id', () => {
    const existing: SlotRange[] = [{ id: 'A', startTime: '15:00', endTime: '17:00' }];
    const { result } = toggleBand(existing, b('16:00', '17:00'));
    expect(result).toEqual([{ startTime: '15:00', endTime: '16:00', sourceId: 'A' }]);
  });

  it('shrinks at the start edge, keeping the id', () => {
    const existing: SlotRange[] = [{ id: 'A', startTime: '15:00', endTime: '17:00' }];
    const { result } = toggleBand(existing, b('15:00', '16:00'));
    expect(result).toEqual([{ startTime: '16:00', endTime: '17:00', sourceId: 'A' }]);
  });

  it('splits an interior hour: earlier piece keeps the id, later is new', () => {
    const existing: SlotRange[] = [{ id: 'A', startTime: '15:00', endTime: '18:00' }];
    const { result } = toggleBand(existing, b('16:00', '17:00'));
    expect(result).toEqual([
      { startTime: '15:00', endTime: '16:00', sourceId: 'A' },
      { startTime: '17:00', endTime: '18:00', sourceId: null },
    ]);
  });

  it('leaves other slots untouched when removing', () => {
    const existing: SlotRange[] = [
      { id: 'A', startTime: '15:00', endTime: '16:00' },
      { id: 'B', startTime: '18:00', endTime: '19:00' },
    ];
    const { result } = toggleBand(existing, b('15:00', '16:00'));
    expect(result).toEqual([{ startTime: '18:00', endTime: '19:00', sourceId: 'B' }]);
  });
});

describe('findContiguousRuns', () => {
  it('returns runs of contiguous same-room slots, sorted', () => {
    const slots = [
      { id: 'B', startTime: '16:00', endTime: '17:00', roomId: 'r1' },
      { id: 'A', startTime: '15:00', endTime: '16:00', roomId: 'r1' },
      { id: 'C', startTime: '18:00', endTime: '19:00', roomId: 'r1' },
    ];
    expect(findContiguousRuns(slots)).toEqual([['A', 'B'], ['C']]);
  });

  it('does not fuse across a different room', () => {
    const slots = [
      { id: 'A', startTime: '15:00', endTime: '16:00', roomId: 'r1' },
      { id: 'B', startTime: '16:00', endTime: '17:00', roomId: 'r2' },
    ];
    expect(findContiguousRuns(slots)).toEqual([['A'], ['B']]);
  });

  it('treats a single slot as a run of one', () => {
    const slots = [{ id: 'A', startTime: '15:00', endTime: '17:00', roomId: 'r1' }];
    expect(findContiguousRuns(slots)).toEqual([['A']]);
  });
});

describe('mergeAttendanceStatus — present wins, then absent', () => {
  it('present wins over absent', () => {
    expect(mergeAttendanceStatus(['absent', 'present'])).toBe('present');
  });
  it('absent when no present', () => {
    expect(mergeAttendanceStatus(['absent', 'absent'])).toBe('absent');
  });
  it('null when empty', () => {
    expect(mergeAttendanceStatus([])).toBe(null);
  });
});

describe('mergeLogStatus — held > cancelled > none', () => {
  it('held wins', () => {
    expect(mergeLogStatus(['cancelled_by_tutor', 'held'])).toBe('held');
  });
  it('cancelled when no held', () => {
    expect(mergeLogStatus(['cancelled_by_tutor'])).toBe('cancelled_by_tutor');
  });
  it('null when empty', () => {
    expect(mergeLogStatus([])).toBe(null);
  });
});

describe('invariant: no two contiguous results after a toggle', () => {
  it('adding the middle hour of three never yields adjacent ranges', () => {
    const existing: SlotRange[] = [
      { id: 'A', startTime: '15:00', endTime: '16:00' },
      { id: 'B', startTime: '17:00', endTime: '18:00' },
    ];
    const { result } = toggleBand(existing, { start: '16:00', end: '17:00' });
    for (let i = 1; i < result.length; i++) {
      expect(result[i].startTime > result[i - 1].endTime).toBe(true);
    }
    expect(result).toHaveLength(1);
  });
});
