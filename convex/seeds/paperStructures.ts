import { internalMutation } from "../_generated/server";
import type { Id } from "../_generated/dataModel";

// Sri Lankan national exam structure for grades 6 — 11.
//
// G10 / G11 share an identical structure with a divisionFactor of 2 (raw
// total 200, scaled to 100). G6 — G9 share a default with divisionFactor 1
// (raw total = scaled total = 100); per-paper variants live on
// pastPapers.partOverrides.
//
// Idempotent: re-running this seed is a no-op once any paperStructures row
// exists. To re-seed, the user must clear the table manually first.

type PartSpec = {
  partCode: string;
  partLabel: string;
  questionCount: number;
  marksPerQuestion: number;
  requiredCount: number;
  order: number;
};

const G10_G11_PARTS: PartSpec[] = [
  {
    partCode: "1A",
    partLabel: "Part I Section A — MCQ",
    questionCount: 25,
    marksPerQuestion: 2,
    requiredCount: 25,
    order: 1,
  },
  {
    partCode: "1B",
    partLabel: "Part I Section B — Structured",
    questionCount: 5,
    marksPerQuestion: 10,
    requiredCount: 5,
    order: 2,
  },
  {
    partCode: "2A",
    partLabel: "Part II Section A — Essays",
    questionCount: 7,
    marksPerQuestion: 10,
    requiredCount: 5,
    order: 3,
  },
  {
    partCode: "2B",
    partLabel: "Part II Section B — Essays",
    questionCount: 7,
    marksPerQuestion: 10,
    requiredCount: 5,
    order: 4,
  },
];

const G6_G9_PARTS: PartSpec[] = [
  {
    partCode: "1",
    partLabel: "Part I — MCQ",
    questionCount: 20,
    marksPerQuestion: 2,
    requiredCount: 20,
    order: 1,
  },
  {
    partCode: "2",
    partLabel: "Part II — Essays",
    questionCount: 7,
    marksPerQuestion: 12,
    requiredCount: 5,
    order: 2,
  },
];

function totalRawMarks(parts: PartSpec[]): number {
  return parts.reduce((sum, p) => sum + p.requiredCount * p.marksPerQuestion, 0);
}

export const seedDefaults = internalMutation({
  handler: async (ctx) => {
    const existing = await ctx.db.query("paperStructures").take(1);
    if (existing.length > 0) {
      console.log("[seedPaperStructures] structures already exist, skipping");
      return { skipped: true };
    }

    let structuresCreated = 0;
    let partsCreated = 0;
    const now = Date.now();

    const buildOne = async (
      grade: number,
      divisionFactor: number,
      parts: PartSpec[],
    ) => {
      const raw = totalRawMarks(parts);
      const structureId: Id<"paperStructures"> = await ctx.db.insert(
        "paperStructures",
        {
          grade,
          divisionFactor,
          totalRawMarks: raw,
          scaledTotal: raw / divisionFactor,
          createdAt: now,
          updatedAt: now,
        },
      );
      structuresCreated += 1;
      for (const p of parts) {
        await ctx.db.insert("paperStructureParts", {
          structureId,
          ...p,
        });
        partsCreated += 1;
      }
    };

    for (const grade of [10, 11]) {
      await buildOne(grade, 2, G10_G11_PARTS);
    }
    for (const grade of [6, 7, 8, 9]) {
      await buildOne(grade, 1, G6_G9_PARTS);
    }

    console.log(
      `[seedPaperStructures] created ${structuresCreated} structures + ${partsCreated} parts`,
    );
    return { structuresCreated, partsCreated };
  },
});
