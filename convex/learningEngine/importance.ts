// Phase B.2 — Concept importance (exam blueprint).
//
// Recomputes the conceptImportance table for a (grade, term) scope from past-
// paper crops the user has cropped + tagged at the concept level. Importance
// is a normalized [0, 1] weight; Σ importance = 1.0 within (grade, term) so
// downstream consumers (Phase C profile, Phase D planner) can treat it as a
// proportion of "what examiners weight in this exam."
//
// Aggregation rules (locked in with the user before build):
//   1. Source of truth = questionConcepts rows only. Crops tagged only with a
//      topicTagId (no per-concept join) DO NOT contribute. This forces the
//      coverage workflow to deepen concept-level tagging where it matters.
//   2. Cumulative term keying: a Term 2 past paper testing a Term 1 concept
//      pushes that concept's row under (grade, term=2). Recomputing (G, T=2)
//      pulls from Term 2 papers only; the Term 1 paper run lives separately
//      under (G, T=1). The planner picks the row matching the upcoming exam's
//      term.
//   3. Every paper slot contributes its full marksAvailable regardless of
//      paperStructureParts.requiredCount. requiredCount-aware "exam choice"
//      prediction belongs to the Phase G predictor, not this layer.
//   4. Marks on a multi-concept-tagged question split EQUALLY across its
//      tagged concepts (m / tags.length per concept).
//   5. Prior fallback (source = "prior") triggers only when no training paper
//      contributed any rawMarks: each concept inherits a weight proportional
//      to the total exercise count in its unit. Within a unit this means
//      every concept gets the same prior — equivalent to "no data, treat the
//      unit's exam weight as proportional to its syllabus volume."
//   6. After normalization, every concept in scope gets at least
//      MIN_IMPORTANCE_FLOOR. The result is then re-normalized so Σ = 1.0.
//
// Holdout enforcement: papers where isHoldout === true are filtered out
// unconditionally. The exam-blueprint dashboard (B.3) surfaces this.

import { mutation, query } from "../_generated/server";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { MIN_IMPORTANCE_FLOOR } from "./config";

// ─── recompute ────────────────────────────────────────────────────────────

export const recomputeForGradeTerm = mutation({
  args: {
    grade: v.number(),
    term: v.number(), // 1 | 2 | 3 — the term whose papers + cumulative scope we recompute
    // Cumulative unit list resolved client-side from src/lib/curriculum-data.ts.
    // For (G, T=1) → T1 units only. For (G, T=2) → T1+T2. For (G, T=3) → T1+T2+T3.
    // This is the scope of concepts that can appear in the conceptImportance
    // table for this run, regardless of which paper-term contributed marks.
    unitIds: v.array(v.string()),
  },
  handler: async (ctx, { grade, term, unitIds }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");

    // 1. Collect every concept-type exercise in scope.
    const concepts: Array<{ _id: Id<"exercises">; unitId: string }> = [];
    for (const uId of unitIds) {
      const rows = await ctx.db
        .query("exercises")
        .withIndex("by_unit", (q) => q.eq("unitId", uId))
        .collect();
      for (const r of rows) {
        if (r.type === "concept") {
          concepts.push({ _id: r._id, unitId: r.unitId });
        }
      }
    }

    // Initialize raw-marks accumulator for every concept in scope.
    const rawMarks = new Map<string, number>();
    for (const c of concepts) rawMarks.set(c._id as unknown as string, 0);

    // 2. Find training papers for THIS term: useAsTrainingSignal=true, isHoldout=false.
    const allGradeTermPapers = await ctx.db
      .query("pastPapers")
      .withIndex("by_grade_term_year", (q) =>
        q.eq("grade", grade).eq("term", term),
      )
      .collect();
    const trainingPapers = allGradeTermPapers.filter(
      (p) => p.useAsTrainingSignal && !p.isHoldout,
    );

    // 3. Aggregate marks per concept from this term's training papers.
    let contributingPaperCount = 0;
    let totalDataMarks = 0;
    for (const paper of trainingPapers) {
      const crops = await ctx.db
        .query("questionBank")
        .withIndex("by_past_paper", (q) => q.eq("pastPaperId", paper._id))
        .collect();
      let paperContributedAny = false;
      for (const q of crops) {
        const tags = await ctx.db
          .query("questionConcepts")
          .withIndex("by_question", (qj) => qj.eq("questionId", q._id))
          .collect();
        if (tags.length === 0) continue; // questionConcepts-only per user choice
        const marks = q.marksAvailable ?? 1;
        const perTag = marks / tags.length;
        for (const tag of tags) {
          const key = tag.conceptExerciseId as unknown as string;
          // Only count concepts in scope. Cumulative scope means all T<=term
          // concepts are in `concepts`. A tag pointing outside scope (e.g. a
          // T3 concept tagged on a T2 paper question due to user error) is
          // ignored — it would otherwise inflate this run's normalization
          // base with a concept that has no row to upsert into.
          if (!rawMarks.has(key)) continue;
          rawMarks.set(key, rawMarks.get(key)! + perTag);
          totalDataMarks += perTag;
          paperContributedAny = true;
        }
      }
      if (paperContributedAny) contributingPaperCount += 1;
    }

    // 4. Prior fallback when no marks landed anywhere. Each concept inherits
    // its unit's exercise-count as raw weight.
    const usingPrior = totalDataMarks === 0;
    if (usingPrior) {
      // Cache unit exercise counts so we don't re-query per concept.
      const unitExerciseCount = new Map<string, number>();
      for (const uId of unitIds) {
        const rows = await ctx.db
          .query("exercises")
          .withIndex("by_unit", (q) => q.eq("unitId", uId))
          .collect();
        let cnt = 0;
        for (const r of rows) if (r.type !== "concept") cnt += 1;
        unitExerciseCount.set(uId, cnt);
      }
      for (const c of concepts) {
        const cnt = unitExerciseCount.get(c.unitId) ?? 0;
        // If a unit has zero exercises (concepts only), still seed a 1 so the
        // floor can lift it later; otherwise every concept in that unit would
        // get 0 raw and only the floor would distinguish them.
        rawMarks.set(c._id as unknown as string, cnt > 0 ? cnt : 1);
      }
    }

    // 5. Normalize to Σ = 1.0.
    const total = Array.from(rawMarks.values()).reduce((a, b) => a + b, 0);
    const normalized = new Map<string, number>();
    if (total > 0) {
      rawMarks.forEach((v, k) => normalized.set(k, v / total));
    } else {
      // Edge case: no concepts in scope at all. Nothing to do.
      const wiped = await ctx.db
        .query("conceptImportance")
        .withIndex("by_grade_term", (q) => q.eq("grade", grade).eq("term", term))
        .collect();
      for (const r of wiped) await ctx.db.delete(r._id);
      return { computed: 0, source: usingPrior ? "prior" : "data", paperCount: contributingPaperCount };
    }

    // 6. Apply floor + re-normalize.
    normalized.forEach((v, k) => {
      if (v < MIN_IMPORTANCE_FLOOR) normalized.set(k, MIN_IMPORTANCE_FLOOR);
    });
    const flooredTotal = Array.from(normalized.values()).reduce(
      (a, b) => a + b,
      0,
    );
    normalized.forEach((v, k) => normalized.set(k, v / flooredTotal));

    // 7. Replace-all upsert for this (grade, term) scope. Simpler than diffing
    // and the only writer is this mutation.
    const existing = await ctx.db
      .query("conceptImportance")
      .withIndex("by_grade_term", (q) => q.eq("grade", grade).eq("term", term))
      .collect();
    for (const r of existing) await ctx.db.delete(r._id);

    const now = Date.now();
    const source = usingPrior ? "prior" : "data";
    let inserted = 0;
    for (const c of concepts) {
      const key = c._id as unknown as string;
      const raw = rawMarks.get(key) ?? 0;
      const imp = normalized.get(key) ?? 0;
      await ctx.db.insert("conceptImportance", {
        grade,
        term,
        conceptExerciseId: c._id,
        importance: imp,
        rawMarks: raw,
        paperCount: contributingPaperCount,
        source,
        computedAt: now,
      });
      inserted += 1;
    }

    return {
      computed: inserted,
      source,
      paperCount: contributingPaperCount,
      totalDataMarks,
    };
  },
});

// ─── queries ──────────────────────────────────────────────────────────────

// All importance rows for a (grade, term) scope, joined with concept name +
// unitId so the dashboard can render without a second query. Used by B.3.
export const getForGradeTerm = query({
  args: { grade: v.number(), term: v.number() },
  handler: async (ctx, { grade, term }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const rows = await ctx.db
      .query("conceptImportance")
      .withIndex("by_grade_term", (q) => q.eq("grade", grade).eq("term", term))
      .collect();
    if (rows.length === 0) {
      return {
        rows: [] as Array<{
          _id: Id<"conceptImportance">;
          conceptExerciseId: Id<"exercises">;
          conceptName: string;
          unitId: string;
          importance: number;
          rawMarks: number;
        }>,
        computedAt: null,
        source: null,
        paperCount: 0,
      };
    }
    const out: Array<{
      _id: Id<"conceptImportance">;
      conceptExerciseId: Id<"exercises">;
      conceptName: string;
      unitId: string;
      importance: number;
      rawMarks: number;
    }> = [];
    for (const r of rows) {
      const c = await ctx.db.get(r.conceptExerciseId);
      out.push({
        _id: r._id,
        conceptExerciseId: r.conceptExerciseId,
        conceptName: c?.name ?? "(deleted concept)",
        unitId: c?.unitId ?? "",
        importance: r.importance,
        rawMarks: r.rawMarks,
      });
    }
    return {
      rows: out,
      computedAt: rows[0].computedAt,
      source: rows[0].source,
      paperCount: rows[0].paperCount,
    };
  },
});

// Single concept's importance under a (grade, term) — used by Phase C
// profile aggregator and Phase D planner scoring.
export const getForConcept = query({
  args: {
    grade: v.number(),
    term: v.number(),
    conceptExerciseId: v.id("exercises"),
  },
  handler: async (ctx, { grade, term, conceptExerciseId }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    return await ctx.db
      .query("conceptImportance")
      .withIndex("by_grade_term_concept", (q) =>
        q.eq("grade", grade).eq("term", term).eq("conceptExerciseId", conceptExerciseId),
      )
      .first();
  },
});

// List the training papers contributing to a (grade, term) run. Drives the
// "papers contributing" side panel on B.3. Returns the same papers the
// recompute would consume — useful both for transparency and for the user to
// audit which uploads they still need to mark as holdout/training.
export const trainingPapersForGradeTerm = query({
  args: { grade: v.number(), term: v.number() },
  handler: async (ctx, { grade, term }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const allRows = await ctx.db
      .query("pastPapers")
      .withIndex("by_grade_term_year", (q) =>
        q.eq("grade", grade).eq("term", term),
      )
      .collect();
    return allRows
      .map((p) => ({
        _id: p._id,
        grade: p.grade,
        term: p.term,
        year: p.year,
        schoolName: p.schoolName,
        useAsTrainingSignal: p.useAsTrainingSignal,
        isHoldout: p.isHoldout,
        totalMarks: p.totalMarks,
        uploadedAt: p.uploadedAt,
      }))
      .sort((a, b) => {
        if (a.year !== b.year) return b.year - a.year;
        return b.uploadedAt - a.uploadedAt;
      });
  },
});
