// Crop-integrity analyzer — Phase E patch (post-D.6).
//
// Each questionBank crop is one image of either:
//   - a whole question        e.g. key "3" when Q3 has no sub-parts
//   - a stem ("preamble")     e.g. key "1" when Q1 has sub-parts {a, b, c}
//   - a sub-question          e.g. key "1.a"
//
// The student's atomic answerable unit is a whole-question or a single
// sub-question. A bare stem is useless without its sub-parts; a bare
// sub-question is useless without its stem (the instruction text).
//
// This module classifies one picked crop's role and surfaces the action a
// human must take when the cropping is incomplete. The PDF renderer reads
// these classifications:
//   - non-blocking attachments (stem ids to glue above a sub-question) are
//     embedded into the rendered Q.
//   - blocking issues throw a structured error so the Lead can open Edit
//     and fix the underlying crop set.
//
// Scope: textbook crops only. Past-paper crops use questionNumberInPaper
// instead of linkedQuestionKey and have their own structure tables —
// stem/sub-question gluing for past papers is out of scope for this patch
// (covered in a follow-up). Past-paper crops always classify as `ok-pass-through`.

import type { GenericQueryCtx } from "convex/server";
import type { DataModel, Id } from "../_generated/dataModel";

type QueryCtx = GenericQueryCtx<DataModel>;

// Mirrors src/lib/sub-questions.ts. Backend cannot import from src/lib so
// the tiny label helper is duplicated here. Keep in sync.
const SUB_LETTERS = "abcdefghijklmnopqrst".split("");
const SUB_ROMAN = [
  "i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x",
  "xi", "xii", "xiii", "xiv", "xv", "xvi", "xvii", "xviii", "xix", "xx",
];
function subLabel(index: number, type: "letter" | "roman"): string {
  if (type === "roman") return SUB_ROMAN[index] ?? String(index + 1);
  return SUB_LETTERS[index] ?? String(index + 1);
}

type SubQuestionDef = { count: number; type: "letter" | "roman" };

export type CropIntegrity =
  // No textbook structure to check (past-paper, teacher-authored, or
  // textbook crop with no linkedQuestionKey / linkedExerciseId).
  | { kind: "ok-pass-through" }
  // Whole question (mainQ has no sub-parts per metadata). Render alone.
  | { kind: "ok-whole" }
  // Sub-question with at least one stem sibling cropped. Render the stem
  // (or stems, when multiple figures share the stem key) above this crop.
  | {
      kind: "ok-sub-with-stem";
      mainQ: number;
      stemQuestionIds: Id<"questionBank">[];
    }
  // Stem cropped but sub-parts not cropped yet → user must crop the
  // remaining sub-parts before rendering.
  | {
      kind: "block-stem-missing-subparts";
      mainQ: number;
      missingSubLabels: string[];
    }
  // Planner picked the stem when sub-part crops exist on this exercise —
  // the Lead should swap the picked Q to one of the sub-parts.
  | {
      kind: "block-stem-when-subparts-exist";
      mainQ: number;
      availableSubLabels: string[];
    }
  // Sub-question with no stem cropped on its own mainQ. Edge-case fix will
  // lift this to "inherit from preceding mainQ's stem"; for now we BLOCK so
  // no sub-question is ever printed without instruction text.
  | {
      kind: "block-sub-without-stem";
      mainQ: number;
      subKey: string;
    };

export type CropIntegrityWithMessage = CropIntegrity & {
  // Pre-rendered human message — keeps server and UI in sync without each
  // having to re-translate the discriminator.
  message: string;
  blocking: boolean;
};

function decorate(c: CropIntegrity): CropIntegrityWithMessage {
  switch (c.kind) {
    case "ok-pass-through":
    case "ok-whole":
    case "ok-sub-with-stem":
      return { ...c, message: "", blocking: false };
    case "block-stem-missing-subparts":
      return {
        ...c,
        blocking: true,
        message: `Q${c.mainQ}: stem cropped but sub-parts (${c.missingSubLabels.join(", ")}) not cropped. Open the cropping page and add them.`,
      };
    case "block-stem-when-subparts-exist":
      return {
        ...c,
        blocking: true,
        message: `Q${c.mainQ}: this is the stem only. Swap to one of the sub-parts (${c.availableSubLabels.join(", ")}).`,
      };
    case "block-sub-without-stem":
      return {
        ...c,
        blocking: true,
        message: `Q${c.subKey}: sub-question has no stem cropped on Q${c.mainQ}. Crop the stem first.`,
      };
  }
}

export async function analyzeCropIntegrity(
  ctx: QueryCtx,
  questionBankId: Id<"questionBank">,
): Promise<CropIntegrityWithMessage> {
  const q = await ctx.db.get(questionBankId);
  // Deleted crop, past-paper, teacher-authored, or textbook crop without
  // a key/exercise link → out of scope for this analyzer. The renderer's
  // existing "missing crop" handling covers deleted ids.
  if (!q || q.source !== "textbook" || !q.linkedExerciseId || !q.linkedQuestionKey) {
    return decorate({ kind: "ok-pass-through" });
  }

  const key = q.linkedQuestionKey;
  const dot = key.indexOf(".");
  const mainQStr = dot < 0 ? key : key.slice(0, dot);
  const subLabelStr = dot < 0 ? null : key.slice(dot + 1);
  const mainQ = parseInt(mainQStr, 10);
  if (!Number.isFinite(mainQ) || mainQ <= 0) {
    return decorate({ kind: "ok-pass-through" });
  }

  const exercise = await ctx.db.get(q.linkedExerciseId);
  if (!exercise) return decorate({ kind: "ok-pass-through" });

  const subDef = (exercise.subQuestions as
    | Record<string, SubQuestionDef>
    | undefined)?.[String(mainQ)];
  const hasSubparts = !!subDef && subDef.count > 1;

  // Single sibling read covers stem-lookup AND sub-part presence in O(1)
  // index scans. Filter in memory by key.
  const siblings = await ctx.db
    .query("questionBank")
    .withIndex("by_linked_exercise", (qq) =>
      qq.eq("linkedExerciseId", q.linkedExerciseId!),
    )
    .collect();

  // Sibling sub-questions of the SAME mainQ (any sub-letter).
  const siblingSubKeys = new Set<string>();
  // Sibling stem crops keyed exactly "<mainQ>". Multiple are allowed —
  // a stem can have several figures sharing the key.
  const stemQuestionIds: Id<"questionBank">[] = [];
  for (const s of siblings) {
    const sk = s.linkedQuestionKey;
    if (!sk) continue;
    if (sk === String(mainQ)) {
      // Don't count the row we're analyzing as its own stem.
      if (s._id !== q._id) stemQuestionIds.push(s._id);
      continue;
    }
    const sdot = sk.indexOf(".");
    if (sdot < 0) continue;
    if (sk.slice(0, sdot) === String(mainQ)) {
      siblingSubKeys.add(sk.slice(sdot + 1));
    }
  }

  // ── No dot in key ⇒ the crop is keyed at the mainQ (stem OR whole).
  if (subLabelStr === null) {
    if (!hasSubparts) return decorate({ kind: "ok-whole" });

    // Stem of a sub-divided question.
    if (siblingSubKeys.size > 0) {
      // Sub-parts exist → planner shouldn't have picked the stem.
      const availableSubLabels = Array.from(siblingSubKeys).sort();
      return decorate({
        kind: "block-stem-when-subparts-exist",
        mainQ,
        availableSubLabels,
      });
    }

    // Sub-parts not yet cropped.
    const expected: string[] = [];
    for (let i = 0; i < subDef!.count; i++) {
      expected.push(subLabel(i, subDef!.type));
    }
    return decorate({
      kind: "block-stem-missing-subparts",
      mainQ,
      missingSubLabels: expected,
    });
  }

  // ── Dot in key ⇒ sub-question crop.
  if (stemQuestionIds.length === 0) {
    return decorate({
      kind: "block-sub-without-stem",
      mainQ,
      subKey: key,
    });
  }
  return decorate({
    kind: "ok-sub-with-stem",
    mainQ,
    stemQuestionIds,
  });
}

// Bulk helper for the renderer / Edit drawer. Returns one entry per input
// id (preserves order), plus a fast count of blocking issues.
export async function analyzeManyCropIntegrity(
  ctx: QueryCtx,
  questionBankIds: Id<"questionBank">[],
): Promise<{
  byQuestion: Array<{
    questionId: Id<"questionBank">;
    integrity: CropIntegrityWithMessage;
  }>;
  blockingCount: number;
}> {
  const byQuestion: Array<{
    questionId: Id<"questionBank">;
    integrity: CropIntegrityWithMessage;
  }> = [];
  let blockingCount = 0;
  for (const qid of questionBankIds) {
    const integrity = await analyzeCropIntegrity(ctx, qid);
    if (integrity.blocking) blockingCount += 1;
    byQuestion.push({ questionId: qid, integrity });
  }
  return { byQuestion, blockingCount };
}
