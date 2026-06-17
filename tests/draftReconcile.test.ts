import { describe, it, expect } from 'vitest';
import {
  mergePlan,
  pullPlan,
  type LiveRow,
  type DraftRow,
  type Baseline,
} from '../convex/lib/draftReconcile';

const live = (id: string, fp: string): LiveRow => ({ id, fp });
const draft = (id: string, sourceId: string | null, fp: string): DraftRow => ({
  id,
  sourceId,
  fp,
});

describe('mergePlan (draft → live)', () => {
  it('creates a draft row that has no source (brand-new in the draft)', () => {
    const plan = mergePlan([draft('d1', null, 'new')], [], {});
    expect(plan.creates.map((d) => d.id)).toEqual(['d1']);
    expect(plan.patches).toEqual([]);
    expect(plan.deletes).toEqual([]);
  });

  it('patches the live source in place when the draft edited it', () => {
    const baseline: Baseline = { L1: 'old' };
    const plan = mergePlan([draft('d1', 'L1', 'edited')], [live('L1', 'old')], baseline);
    expect(plan.patches).toEqual([{ liveId: 'L1', draft: draft('d1', 'L1', 'edited') }]);
    expect(plan.creates).toEqual([]);
    expect(plan.deletes).toEqual([]);
  });

  it('does NOT patch when the draft row is unchanged from its source', () => {
    const baseline: Baseline = { L1: 'same' };
    const plan = mergePlan([draft('d1', 'L1', 'same')], [live('L1', 'same')], baseline);
    expect(plan.patches).toEqual([]);
  });

  it('deletes a live row that was known at baseline but removed in the draft', () => {
    const baseline: Baseline = { L1: 'x' };
    const plan = mergePlan([], [live('L1', 'x')], baseline);
    expect(plan.deletes).toEqual(['L1']);
  });

  it('NEVER deletes a live row created after the last pull (not in baseline)', () => {
    const plan = mergePlan([], [live('LNEW', 'x')], {});
    expect(plan.deletes).toEqual([]);
  });

  it('flags a draft row whose source was deleted live as an orphan (not a create)', () => {
    const baseline: Baseline = { L1: 'x' };
    const plan = mergePlan([draft('d1', 'L1', 'edited')], [], baseline);
    expect(plan.orphans.map((d) => d.id)).toEqual(['d1']);
    expect(plan.creates).toEqual([]);
    expect(plan.patches).toEqual([]);
  });
});

describe('pullPlan (live → draft)', () => {
  it('adds a live row created since baseline that the draft never saw', () => {
    const plan = pullPlan([], [live('LNEW', 'x')], {});
    expect(plan.adds.map((l) => l.id)).toEqual(['LNEW']);
    expect(plan.refreshes).toEqual([]);
  });

  it('refreshes an unedited draft row when its live source changed', () => {
    const baseline: Baseline = { L1: 'old' };
    const plan = pullPlan([draft('d1', 'L1', 'old')], [live('L1', 'new')], baseline);
    expect(plan.refreshes).toEqual([{ draftId: 'd1', live: live('L1', 'new') }]);
    expect(plan.conflicts).toEqual([]);
  });

  it('keeps a draft-edited row and reports a conflict when live also changed', () => {
    const baseline: Baseline = { L1: 'old' };
    const plan = pullPlan([draft('d1', 'L1', 'draftedit')], [live('L1', 'liveedit')], baseline);
    expect(plan.keeps).toEqual(['d1']);
    expect(plan.conflicts).toEqual([{ draftId: 'd1', liveId: 'L1' }]);
    expect(plan.refreshes).toEqual([]);
  });

  it('keeps a draft-edited row with no conflict when live is unchanged', () => {
    const baseline: Baseline = { L1: 'old' };
    const plan = pullPlan([draft('d1', 'L1', 'draftedit')], [live('L1', 'old')], baseline);
    expect(plan.keeps).toEqual(['d1']);
    expect(plan.conflicts).toEqual([]);
    expect(plan.refreshes).toEqual([]);
  });

  it('respects a draft deletion: a still-live row removed in the draft is NOT re-added', () => {
    const baseline: Baseline = { L1: 'x' };
    const plan = pullPlan([], [live('L1', 'x')], baseline);
    expect(plan.adds).toEqual([]);
  });

  it('does nothing when live and draft are both unchanged', () => {
    const baseline: Baseline = { L1: 'x' };
    const plan = pullPlan([draft('d1', 'L1', 'x')], [live('L1', 'x')], baseline);
    expect(plan.adds).toEqual([]);
    expect(plan.refreshes).toEqual([]);
    expect(plan.conflicts).toEqual([]);
  });
});
