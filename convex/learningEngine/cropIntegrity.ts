// Crop-integrity analyzer — Phase E patch (post-D.6).
//
// Each questionBank crop is one image of either:
//   - a whole question        e.g. key "3" when Q3 has no sub-parts
//   - a stem ("preamble")     e.g. key "1" when Q1 has sub-parts {a, b, c}
//   - a sub-question          e.g. key "1.a"
//   - a sub-stem              e.g. key "5.a" when 5.a itself has sub-sub
//                             parts {i, ii, iii} (level-3 mode)
//   - a level-3 leaf          e.g. key "5.a.i"
//
// The student's atomic answerable unit is a whole-question, a single
// sub-question (level-2 leaf), or a level-3 leaf. A bare stem is useless
// without its sub-parts; a bare sub-question / sub-stem is useless without
// its stem (the instruction text). A level-3 leaf needs BOTH parent stems
// (the main-Q stem and the sub-stem) to make sense on the printed sheet.
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

type SubSubDef = {
  count: number;
  type: "letter" | "roman";
  // When true, the owning sub-part has no instruction of its own; its level-3
  // leaves borrow the nearest real ancestor stem (the main-Q stem). Mirrors
  // src/lib/sub-questions.ts SubSubDef.noStem.
  noStem?: boolean;
};
type SubQuestionDef = {
  count: number;
  type: "letter" | "roman";
  subSub?: Record<string, SubSubDef>;
};

// Backend mirror of src/lib/sub-questions.ts isLeafKey (src/lib is not
// importable from convex). Returns true when a crop key is an answerable LEAF
// (whole-question / level-2 leaf / level-3 leaf) rather than a stem/sub-stem.
// The sheet planner uses this to keep stems OUT of the candidate pool.
export function isLeafCropKey(
  key: string,
  subQuestions: Record<string, SubQuestionDef> | undefined | null,
): boolean {
  const parts = key.split(".");
  const mainQ = parts[0];
  const subDef = subQuestions?.[mainQ];
  const hasSubs = !!subDef && subDef.count > 1;

  if (parts.length === 1) return !hasSubs;
  if (!hasSubs) return false;

  let subIndex = -1;
  for (let i = 0; i < subDef!.count; i++) {
    if (subLabel(i, subDef!.type) === parts[1]) {
      subIndex = i;
      break;
    }
  }
  if (subIndex < 0) return false;
  const ss = subDef!.subSub?.[String(subIndex)];
  const hasSubSub = !!ss && ss.count > 1;

  if (parts.length === 2) return !hasSubSub;
  return hasSubSub;
}

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
    }
  // Level-3 leaf (e.g. "5.a.i") with BOTH parent stems cropped.
  // `stemQuestionIds` shares its name + shape with `ok-sub-with-stem` so
  // the renderer can read either case the same way. Order is print
  // order: mainQ stem first (Q5's preamble), then sub-stem (Q5.a's
  // preamble), so they glue above the leaf in reading order.
  | {
      kind: "ok-leaf3-with-stems";
      mainQ: number;
      subLabel: string;
      stemQuestionIds: Id<"questionBank">[];
    }
  // Level-3 leaf cropped but one or both parent stems are missing.
  | {
      kind: "block-leaf3-missing-stems";
      mainQ: number;
      subLabel: string;
      missingMainStem: boolean;
      missingSubStem: boolean;
    }
  // Planner picked a sub-stem (e.g. "5.a") when sub-sub leaves exist —
  // analogous to block-stem-when-subparts-exist but one level deeper.
  | {
      kind: "block-sub-stem-when-leaves-exist";
      mainQ: number;
      subLabel: string;
      availableLeafLabels: string[];
    }
  // Sub-stem cropped but level-3 leaves not yet cropped.
  | {
      kind: "block-sub-stem-missing-leaves";
      mainQ: number;
      subLabel: string;
      missingLeafLabels: string[];
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
    case "ok-leaf3-with-stems":
      return { ...c, message: "", blocking: false };
    case "block-leaf3-missing-stems": {
      const parts: string[] = [];
      if (c.missingMainStem) parts.push(`main stem Q${c.mainQ}`);
      if (c.missingSubStem) parts.push(`sub-stem Q${c.mainQ}.${c.subLabel}`);
      return {
        ...c,
        blocking: true,
        message: `Q${c.mainQ}.${c.subLabel}: level-3 leaf needs ${parts.join(" and ")} cropped first.`,
      };
    }
    case "block-sub-stem-when-leaves-exist":
      return {
        ...c,
        blocking: true,
        message: `Q${c.mainQ}.${c.subLabel}: this is the sub-stem only. Swap to one of the leaves (${c.availableLeafLabels.join(", ")}).`,
      };
    case "block-sub-stem-missing-leaves":
      return {
        ...c,
        blocking: true,
        message: `Q${c.mainQ}.${c.subLabel}: sub-stem cropped but leaves (${c.missingLeafLabels.join(", ")}) not cropped. Open the cropping page and add them.`,
      };
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
  // Split into up to 3 parts: "5" / "5.a" / "5.a.i". Any deeper key is
  // currently outside the supported structure — treat as pass-through.
  const parts = key.split(".");
  const mainQ = parseInt(parts[0], 10);
  if (!Number.isFinite(mainQ) || mainQ <= 0) {
    return decorate({ kind: "ok-pass-through" });
  }
  const subLabelStr = parts.length >= 2 ? parts[1] : null;
  const subSubLabelStr = parts.length >= 3 ? parts.slice(2).join(".") : null;

  const exercise = await ctx.db.get(q.linkedExerciseId);
  if (!exercise) return decorate({ kind: "ok-pass-through" });

  const subQuestionsMap = exercise.subQuestions as
    | Record<string, SubQuestionDef>
    | undefined;
  const subDef = subQuestionsMap?.[String(mainQ)];
  const hasSubparts = !!subDef && subDef.count > 1;

  // Resolve sub-index (0-based) from the level-2 label, when we have one.
  const subIndex =
    subDef && subLabelStr
      ? (() => {
          for (let i = 0; i < subDef.count; i++) {
            if (subLabel(i, subDef.type) === subLabelStr) return i;
          }
          return -1;
        })()
      : -1;
  const subSubDef = subIndex >= 0 ? subDef?.subSub?.[String(subIndex)] : undefined;
  const hasSubSubLeaves = !!subSubDef && subSubDef.count > 1;

  // Single sibling read covers stem-lookup AND sub-part presence in O(1)
  // index scans. Filter in memory by key.
  const siblings = await ctx.db
    .query("questionBank")
    .withIndex("by_linked_exercise", (qq) =>
      qq.eq("linkedExerciseId", q.linkedExerciseId!),
    )
    .collect();

  // mainQ stem crops keyed exactly "<mainQ>". Multiple allowed (figures
  // share the key).
  const mainStemIds: Id<"questionBank">[] = [];
  // Sub-part keys for this mainQ at level-2 (the second segment only).
  // e.g. for sibling "5.a" or "5.a.i" → records "a".
  const siblingSubLabels = new Set<string>();
  // Sub-stem crops for the CURRENT sub-part keyed exactly "<mainQ>.<subLabel>".
  const subStemIds: Id<"questionBank">[] = [];
  // Leaf labels for the CURRENT sub-part — the level-3 third segment.
  // e.g. for sibling "5.a.i" when analyzing "5.a.*" → records "i".
  const siblingLeafLabels = new Set<string>();

  for (const s of siblings) {
    const sk = s.linkedQuestionKey;
    if (!sk) continue;
    const sp = sk.split(".");
    if (sp[0] !== String(mainQ)) continue;

    if (sp.length === 1) {
      // "<mainQ>" — main stem crop. Don't count the row being analyzed.
      if (s._id !== q._id) mainStemIds.push(s._id);
      continue;
    }
    // sp.length >= 2
    siblingSubLabels.add(sp[1]);

    // Only treat as sub-stem / leaf siblings if they share the current
    // sub-label being analyzed.
    if (subLabelStr && sp[1] === subLabelStr) {
      if (sp.length === 2) {
        if (s._id !== q._id) subStemIds.push(s._id);
      } else {
        // length >= 3 — leaf
        siblingLeafLabels.add(sp.slice(2).join("."));
      }
    }
  }

  // ── 1 part: the crop is keyed at the mainQ (stem OR whole). ───────
  if (subLabelStr === null) {
    if (!hasSubparts) return decorate({ kind: "ok-whole" });

    // Stem of a sub-divided question.
    if (siblingSubLabels.size > 0) {
      // Sub-parts exist → planner shouldn't have picked the stem.
      const availableSubLabels = Array.from(siblingSubLabels).sort();
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

  // ── 2 parts: the crop is keyed at a sub-part or sub-stem. ─────────
  if (subSubLabelStr === null) {
    // Missing main stem is always blocking — sub-questions cannot be
    // printed without their parent instruction text.
    if (mainStemIds.length === 0) {
      return decorate({
        kind: "block-sub-without-stem",
        mainQ,
        subKey: key,
      });
    }

    // If THIS sub-part has its own sub-sub leaves, this row is a
    // sub-stem. Planner should pick one of the leaves instead.
    if (hasSubSubLeaves && siblingLeafLabels.size > 0) {
      return decorate({
        kind: "block-sub-stem-when-leaves-exist",
        mainQ,
        subLabel: subLabelStr,
        availableLeafLabels: Array.from(siblingLeafLabels).sort(),
      });
    }
    if (hasSubSubLeaves) {
      // Sub-stem cropped but level-3 leaves missing.
      const expected: string[] = [];
      for (let i = 0; i < subSubDef!.count; i++) {
        expected.push(subLabel(i, subSubDef!.type));
      }
      return decorate({
        kind: "block-sub-stem-missing-leaves",
        mainQ,
        subLabel: subLabelStr,
        missingLeafLabels: expected,
      });
    }

    // Regular 2-level sub-part with parent stem present — happy path.
    return decorate({
      kind: "ok-sub-with-stem",
      mainQ,
      stemQuestionIds: mainStemIds,
    });
  }

  // ── 3 parts: the crop is a level-3 leaf. ──────────────────────────
  // Needs the main stem always. The sub-stem is needed UNLESS the user
  // marked this sub-part `noStem` — then the leaf borrows the nearest real
  // ancestor stem (the main-Q stem) and no sub-stem crop is expected.
  const subPartNoStem = !!subSubDef?.noStem;
  const missingMainStem = mainStemIds.length === 0;
  const missingSubStem = !subPartNoStem && subStemIds.length === 0;
  if (missingMainStem || missingSubStem) {
    return decorate({
      kind: "block-leaf3-missing-stems",
      mainQ,
      subLabel: subLabelStr,
      missingMainStem,
      missingSubStem,
    });
  }
  return decorate({
    kind: "ok-leaf3-with-stems",
    mainQ,
    subLabel: subLabelStr,
    // Print order: mainQ stem(s) first, then sub-stem(s). When the sub-part
    // is `noStem`, there is no sub-stem — the leaf climbs to the main-Q stem
    // only. Each list may contain >1 entry when figures share a stem key.
    stemQuestionIds: subPartNoStem
      ? [...mainStemIds]
      : [...mainStemIds, ...subStemIds],
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
