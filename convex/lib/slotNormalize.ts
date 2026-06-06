// Pure range arithmetic for the weekly time grid. NO Convex imports — this
// module is shared by the toggleSession mutation, the fuse migration, and
// vitest. Times are zero-padded 24h "HH:MM" strings, so lexicographic
// comparison is chronological.

export type SlotRange = { id: string; startTime: string; endTime: string };

// sourceId === the existing slot whose id + per-(slot,date) data the caller
// should reuse for this resulting range. null = a brand-new range.
export type ResolvedSlot = { startTime: string; endTime: string; sourceId: string | null };

// Toggle one 1-hour band against a group's slots for a single (day, room).
// Returns the desired resulting ranges plus whether the action added or
// removed coverage. Removal splits the covering slot; the EARLIER piece keeps
// the original id (its data stays put), the later piece is new.
export function toggleBand(
  existing: SlotRange[],
  band: { start: string; end: string },
): { result: ResolvedSlot[]; toggled: 'added' | 'removed' } {
  const covering = existing.find(
    (s) => s.startTime <= band.start && s.endTime >= band.end,
  );

  if (covering) {
    const result: ResolvedSlot[] = [];
    for (const s of existing) {
      if (s.id !== covering.id) {
        result.push({ startTime: s.startTime, endTime: s.endTime, sourceId: s.id });
        continue;
      }
      const leftStart = s.startTime;
      const leftEnd = band.start;
      const rightStart = band.end;
      const rightEnd = s.endTime;
      if (leftStart < leftEnd) {
        result.push({ startTime: leftStart, endTime: leftEnd, sourceId: s.id });
        if (rightStart < rightEnd) {
          result.push({ startTime: rightStart, endTime: rightEnd, sourceId: null });
        }
      } else if (rightStart < rightEnd) {
        // band was the start edge — keep id on the remaining piece.
        result.push({ startTime: rightStart, endTime: rightEnd, sourceId: s.id });
      }
      // else band === whole slot → drop it entirely.
    }
    return { result, toggled: 'removed' };
  }

  // Addition — insert the band, then merge contiguous/overlapping ranges.
  const pieces = [
    ...existing.map((s) => ({ start: s.startTime, end: s.endTime, id: s.id as string | null })),
    { start: band.start, end: band.end, id: null as string | null },
  ].sort((a, b) => a.start.localeCompare(b.start));

  const merged: ResolvedSlot[] = [];
  for (const p of pieces) {
    const last = merged[merged.length - 1];
    if (last && p.start <= last.endTime) {
      if (p.end > last.endTime) last.endTime = p.end;
      // Keep the earliest existing id for the run; a later id (if any) marks a
      // slot the caller must absorb + delete.
      if (last.sourceId == null && p.id != null) last.sourceId = p.id;
    } else {
      merged.push({ startTime: p.start, endTime: p.end, sourceId: p.id });
    }
  }
  return { result: merged, toggled: 'added' };
}

export type RoomedSlot = SlotRange & { roomId: string };

// Group already-same-(group,day) slots into runs of contiguous same-room
// slots. Each run is the ordered list of slot ids that must fuse into one.
export function findContiguousRuns(slots: RoomedSlot[]): string[][] {
  const sorted = [...slots].sort((a, b) => a.startTime.localeCompare(b.startTime));
  const runs: string[][] = [];
  let cur: RoomedSlot[] = [];
  for (const s of sorted) {
    const prev = cur[cur.length - 1];
    if (prev && prev.endTime === s.startTime && prev.roomId === s.roomId) {
      cur.push(s);
    } else {
      if (cur.length) runs.push(cur.map((x) => x.id));
      cur = [s];
    }
  }
  if (cur.length) runs.push(cur.map((x) => x.id));
  return runs;
}

// Approved conflict rule: present wins over absent; absent over unmarked.
// (Only 'present'/'absent' rows are ever stored.)
export function mergeAttendanceStatus(statuses: string[]): 'present' | 'absent' | null {
  if (statuses.includes('present')) return 'present';
  if (statuses.includes('absent')) return 'absent';
  return null;
}

// Approved conflict rule: held wins over cancelled wins over none.
export function mergeLogStatus(statuses: string[]): 'held' | 'cancelled_by_tutor' | null {
  if (statuses.includes('held')) return 'held';
  if (statuses.includes('cancelled_by_tutor')) return 'cancelled_by_tutor';
  return null;
}
