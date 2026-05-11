// Phase 0.6c — Coverage dashboard backend.
// Pure read-only aggregation over concept-type exercises in the (grade, term)
// scope. Cumulative term scope is handled by the caller — the page resolves
// unitIds client-side from src/lib/curriculum-data.ts for ALL terms in scope.

import { query } from "../_generated/server";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import {
  deriveConceptsForUnit,
  questionsTaggedToConcept,
} from "./derivedConcepts";
import { MIN_QUESTIONS_PER_CONCEPT } from "./config";

export const coverageByGradeTerm = query({
  args: {
    grade: v.number(),
    term: v.number(), // 1 | 2 | 3
    // Cumulative unit list resolved client-side: T2 view = T1+T2; T3 = T1+T2+T3.
    unitIds: v.array(v.string()),
  },
  handler: async (ctx, { grade, term, unitIds }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;

    type ConceptRow = {
      _id: Id<"exercises">;
      name: string;
      unitId: string;
      order: number;
    };
    const concepts: ConceptRow[] = [];
    for (const uId of unitIds) {
      const rows = await ctx.db
        .query("exercises")
        .withIndex("by_unit", (q) => q.eq("unitId", uId))
        .collect();
      for (const r of rows) {
        if (r.type === "concept") {
          concepts.push({ _id: r._id, name: r.name, unitId: r.unitId, order: r.order });
        }
      }
    }

    type CoverageRow = {
      conceptId: Id<"exercises">;
      conceptName: string;
      unitId: string;
      order: number;
      total: number;
      byDifficulty: { 1: number; 2: number; 3: number; 4: number; 5: number; unset: number };
      bySource: { textbook: number; past_paper: number; teacher_authored: number };
      isGated: boolean;
      hasNoHardQuestions: boolean;
    };
    const rows: CoverageRow[] = [];

    for (const c of concepts) {
      const qIds = await questionsTaggedToConcept(ctx, c._id);
      const byDifficulty = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, unset: 0 };
      const bySource = { textbook: 0, past_paper: 0, teacher_authored: 0 };
      for (const qId of qIds) {
        const q = await ctx.db.get(qId);
        if (!q) continue;
        const d = q.difficulty;
        if (d === 1 || d === 2 || d === 3 || d === 4 || d === 5) {
          byDifficulty[d as 1 | 2 | 3 | 4 | 5] += 1;
        } else {
          byDifficulty.unset += 1;
        }
        if (q.source === "textbook") bySource.textbook += 1;
        else if (q.source === "past-paper") bySource.past_paper += 1;
        else if (q.source === "teacher-authored") bySource.teacher_authored += 1;
      }
      const total = qIds.length;
      rows.push({
        conceptId: c._id,
        conceptName: c.name,
        unitId: c.unitId,
        order: c.order,
        total,
        byDifficulty,
        bySource,
        isGated: total < MIN_QUESTIONS_PER_CONCEPT,
        hasNoHardQuestions:
          total >= MIN_QUESTIONS_PER_CONCEPT &&
          byDifficulty[4] + byDifficulty[5] === 0,
      });
    }

    // Detect orphan trailing concepts and duplicate-order warnings per unit.
    const orphanConceptIds: Id<"exercises">[] = [];
    const duplicateOrderWarnings: Array<{
      unitId: string;
      orderValue: number;
      ids: Id<"exercises">[];
    }> = [];
    for (const uId of unitIds) {
      const m = await deriveConceptsForUnit(ctx, uId);
      orphanConceptIds.push(...m.orphanConceptIds);
      for (const w of m.duplicateOrderWarnings) {
        duplicateOrderWarnings.push({ unitId: uId, ...w });
      }
    }

    const gatedCount = rows.filter((r) => r.isGated).length;
    const orphanCount = orphanConceptIds.length;
    const noHardCount = rows.filter((r) => r.hasNoHardQuestions).length;

    return {
      grade,
      term,
      threshold: MIN_QUESTIONS_PER_CONCEPT,
      rows,
      orphanConceptIds,
      duplicateOrderWarnings,
      gatedCount,
      orphanCount,
      noHardCount,
      // Phase D will gate sheet generation on this flag. 0.6c only visualizes
      // — it must NOT introduce a code-level block on any other phase.
      isPhaseDBlocked: gatedCount > 0 || orphanCount > 0,
    };
  },
});

// Resolve orphan concept rows (id + name + unitId) for the orphan list UI.
// Keeps the main coverageByGradeTerm payload small while letting the page
// render full concept identities under the orphan section.
export const resolveOrphanConcepts = query({
  args: { conceptIds: v.array(v.id("exercises")) },
  handler: async (ctx, { conceptIds }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const out: Array<{
      _id: Id<"exercises">;
      name: string;
      unitId: string;
    }> = [];
    for (const id of conceptIds) {
      const c = await ctx.db.get(id);
      if (c && c.type === "concept") {
        out.push({ _id: c._id, name: c.name, unitId: c.unitId });
      }
    }
    return out;
  },
});
