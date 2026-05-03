import { internalMutation } from "../_generated/server";

// Module color palette mirrors src/lib/types.ts MODULE_COLORS.
const MODULE_COLORS: Record<string, string> = {
  M1: "#1B4F72",
  M2: "#6C3483",
  M3: "#1E8449",
  M4: "#B9770E",
  M5: "#C0392B",
  M6: "#2E86C1",
};

type Link = { unitId: string; grade: number; term: number; moduleId: string };

type TagSpec = {
  name: string;
  moduleId: string; // for default color + grouping
  units: Link[];
};

// Helper to keep TAG_SEED readable. The full unitId is built from the same
// format that src/lib/curriculum-data.ts buildUnits() uses:
//   `${moduleId}-G${grade}-T${term}-${index}`
// where index is the 0-based position of the unit in its term's array.
function u(moduleId: string, grade: number, term: number, idx: number): Link {
  return {
    unitId: `${moduleId}-G${grade}-T${term}-${idx}`,
    grade,
    term,
    moduleId,
  };
}

const TAG_SEED: TagSpec[] = [
  // ─── Module 1 — Numbers & Arithmetic ─────────────────────────────────
  { name: "Place Value", moduleId: "M1", units: [u("M1", 6, 1, 0)] },
  {
    name: "Whole Number Operations",
    moduleId: "M1",
    units: [u("M1", 6, 1, 1), u("M1", 7, 1, 0)],
  },
  {
    name: "Estimation & Rounding",
    moduleId: "M1",
    units: [u("M1", 6, 1, 2), u("M1", 9, 2, 3)],
  },
  {
    name: "Factors & Multiples",
    moduleId: "M1",
    units: [u("M1", 6, 2, 1), u("M1", 7, 1, 1), u("M1", 8, 1, 2)],
  },
  {
    name: "Indices & Logarithms",
    moduleId: "M1",
    units: [
      u("M1", 6, 3, 1),
      u("M1", 7, 1, 2),
      u("M1", 8, 1, 4),
      u("M1", 9, 2, 2),
      u("M1", 10, 2, 1),
      u("M1", 10, 2, 2),
      u("M1", 11, 1, 1),
      u("M1", 11, 1, 2),
    ],
  },
  {
    name: "Square Roots",
    moduleId: "M1",
    units: [u("M1", 8, 1, 3), u("M1", 10, 1, 0)],
  },
  {
    name: "Fractions",
    moduleId: "M1",
    units: [
      u("M1", 6, 2, 0),
      u("M1", 7, 2, 0),
      u("M1", 8, 2, 0),
      u("M1", 8, 2, 1),
      u("M1", 9, 1, 2),
      u("M1", 10, 1, 1),
    ],
  },
  {
    name: "Decimals",
    moduleId: "M1",
    units: [u("M1", 6, 2, 2), u("M1", 7, 2, 1), u("M1", 8, 2, 2)],
  },
  {
    name: "Ratios & Proportions",
    moduleId: "M1",
    units: [
      u("M1", 6, 3, 0),
      u("M1", 7, 3, 0),
      u("M1", 8, 2, 3),
      u("M1", 9, 2, 0),
      u("M1", 10, 1, 2),
      u("M1", 10, 2, 3),
    ],
  },
  {
    name: "Percentages",
    moduleId: "M1",
    units: [
      u("M1", 7, 3, 1),
      u("M1", 8, 2, 4),
      u("M1", 9, 1, 3),
      u("M1", 10, 2, 0),
      u("M1", 11, 2, 0),
    ],
  },
  {
    name: "Directed Numbers",
    moduleId: "M1",
    units: [u("M1", 7, 1, 3), u("M1", 8, 1, 1)],
  },
  {
    name: "Number Patterns",
    moduleId: "M1",
    units: [u("M1", 6, 2, 3), u("M1", 8, 1, 0), u("M1", 9, 1, 0)],
  },
  { name: "Real Numbers", moduleId: "M1", units: [u("M1", 11, 1, 0)] },
  { name: "Binary Numbers", moduleId: "M1", units: [u("M1", 9, 1, 1)] },
  { name: "Calculator Use", moduleId: "M1", units: [u("M1", 9, 2, 1)] },
  { name: "Shares & Stocks", moduleId: "M1", units: [u("M1", 11, 2, 1)] },

  // ─── Module 2 — Algebra, Graphs & Matrices ───────────────────────────
  {
    name: "Number Line",
    moduleId: "M2",
    units: [u("M2", 6, 1, 0), u("M2", 8, 3, 0)],
  },
  {
    name: "Algebraic Symbols",
    moduleId: "M2",
    units: [u("M2", 6, 3, 0), u("M2", 6, 3, 1)],
  },
  {
    name: "Algebraic Expressions",
    moduleId: "M2",
    units: [
      u("M2", 7, 2, 0),
      u("M2", 8, 1, 0),
      u("M2", 9, 1, 0),
      u("M2", 9, 1, 1),
    ],
  },
  {
    name: "Algebraic Fractions",
    moduleId: "M2",
    units: [u("M2", 9, 3, 1), u("M2", 10, 2, 0), u("M2", 11, 1, 1)],
  },
  {
    name: "Equations",
    moduleId: "M2",
    units: [
      u("M2", 7, 2, 1), // also Formulas (combined unit)
      u("M2", 8, 2, 0),
      u("M2", 9, 2, 0),
      u("M2", 10, 2, 1),
      u("M2", 11, 2, 1),
    ],
  },
  {
    name: "Formulas",
    moduleId: "M2",
    units: [
      u("M2", 7, 2, 1), // shared with Equations
      u("M2", 9, 2, 1),
      u("M2", 10, 2, 3),
    ],
  },
  {
    name: "Graphs",
    moduleId: "M2",
    units: [
      u("M2", 7, 3, 0),
      u("M2", 9, 2, 2),
      u("M2", 10, 2, 2),
      u("M2", 11, 2, 0),
    ],
  },
  {
    name: "Inequalities",
    moduleId: "M2",
    units: [
      u("M2", 8, 3, 1),
      u("M2", 9, 3, 0),
      u("M2", 10, 3, 1),
      u("M2", 11, 3, 1),
    ],
  },
  {
    name: "Binomial Expressions",
    moduleId: "M2",
    units: [u("M2", 10, 1, 0), u("M2", 10, 1, 1), u("M2", 11, 1, 0)],
  },
  { name: "LCM (Algebraic)", moduleId: "M2", units: [u("M2", 10, 1, 2)] },
  { name: "Arithmetic Progression", moduleId: "M2", units: [u("M2", 10, 3, 0)] },
  { name: "Geometric Progression", moduleId: "M2", units: [u("M2", 11, 2, 2)] },
  { name: "Matrices", moduleId: "M2", units: [u("M2", 11, 3, 0)] },

  // ─── Module 3 — Geometry & Constructions ─────────────────────────────
  {
    name: "Circles",
    moduleId: "M3",
    units: [
      u("M3", 6, 1, 0),
      u("M3", 7, 2, 1),
      u("M3", 8, 3, 0),
      u("M3", 9, 2, 2),
      u("M3", 10, 3, 0),
      u("M3", 10, 3, 2),
    ],
  },
  {
    name: "Angles",
    moduleId: "M3",
    units: [
      u("M3", 6, 1, 1),
      u("M3", 7, 1, 2),
      u("M3", 8, 1, 0),
      u("M3", 9, 1, 1),
      u("M3", 9, 2, 1),
      u("M3", 9, 3, 0),
    ],
  },
  {
    name: "Directions",
    moduleId: "M3",
    units: [u("M3", 6, 1, 2), u("M3", 8, 3, 1)],
  },
  {
    name: "Symmetry",
    moduleId: "M3",
    units: [u("M3", 7, 1, 0), u("M3", 8, 2, 0)],
  },
  { name: "Parallel Lines", moduleId: "M3", units: [u("M3", 7, 1, 1)] },
  {
    name: "Plane Figures",
    moduleId: "M3",
    units: [u("M3", 6, 2, 1), u("M3", 7, 2, 0)],
  },
  {
    name: "Solids / 3D",
    moduleId: "M3",
    units: [u("M3", 6, 2, 2), u("M3", 7, 3, 1), u("M3", 8, 1, 1)],
  },
  {
    name: "Constructions",
    moduleId: "M3",
    units: [
      u("M3", 7, 3, 0),
      u("M3", 8, 3, 2), // shared with Loci (combined unit)
      u("M3", 9, 2, 0), // shared with Loci (combined unit)
      u("M3", 10, 3, 1),
      u("M3", 11, 3, 4),
    ],
  },
  {
    name: "Scale Drawings",
    moduleId: "M3",
    units: [
      u("M3", 7, 3, 2),
      u("M3", 8, 3, 3),
      u("M3", 9, 3, 1),
      u("M3", 10, 3, 3),
    ],
  },
  { name: "Tessellations", moduleId: "M3", units: [u("M3", 7, 3, 3)] },
  {
    name: "Triangles",
    moduleId: "M3",
    units: [
      u("M3", 8, 2, 1),
      u("M3", 10, 1, 0),
      u("M3", 10, 1, 1),
      u("M3", 10, 1, 2),
    ],
  },
  {
    name: "Pythagoras",
    moduleId: "M3",
    units: [u("M3", 9, 2, 3), u("M3", 11, 3, 0)],
  },
  {
    name: "Quadrilaterals",
    moduleId: "M3",
    units: [u("M3", 10, 2, 0), u("M3", 10, 2, 1), u("M3", 11, 3, 2)],
  },
  {
    name: "Loci",
    moduleId: "M3",
    units: [u("M3", 8, 3, 2), u("M3", 9, 2, 0)],
  },
  { name: "Midpoint Theorem", moduleId: "M3", units: [u("M3", 11, 2, 0)] },
  { name: "Similar Triangles", moduleId: "M3", units: [u("M3", 11, 2, 1)] },
  { name: "Trigonometry", moduleId: "M3", units: [u("M3", 11, 3, 1)] },
  { name: "Tangents", moduleId: "M3", units: [u("M3", 11, 3, 3)] },
  { name: "Axiomatic Geometry", moduleId: "M3", units: [u("M3", 9, 1, 0)] },

  // ─── Module 4 — Measurements ─────────────────────────────────────────
  {
    name: "Time",
    moduleId: "M4",
    units: [u("M4", 6, 1, 0), u("M4", 7, 1, 0), u("M4", 8, 2, 1)],
  },
  {
    name: "Length & Perimeter",
    moduleId: "M4",
    units: [
      u("M4", 6, 2, 0),
      u("M4", 7, 2, 1),
      u("M4", 8, 1, 0),
      u("M4", 10, 1, 0),
    ],
  },
  {
    name: "Liquid Measure",
    moduleId: "M4",
    units: [u("M4", 6, 2, 1), u("M4", 7, 2, 4), u("M4", 9, 1, 0)],
  },
  {
    name: "Mass",
    moduleId: "M4",
    units: [u("M4", 6, 3, 0), u("M4", 7, 2, 0), u("M4", 8, 1, 1)],
  },
  {
    name: "Area",
    moduleId: "M4",
    units: [
      u("M4", 6, 3, 1),
      u("M4", 7, 2, 2),
      u("M4", 8, 2, 0),
      u("M4", 9, 3, 0),
      u("M4", 10, 1, 1),
      u("M4", 11, 1, 2),
    ],
  },
  {
    name: "Volume & Capacity",
    moduleId: "M4",
    units: [u("M4", 7, 2, 3), u("M4", 8, 3, 0), u("M4", 11, 1, 1)],
  },
  {
    name: "Surface Area",
    moduleId: "M4",
    units: [u("M4", 10, 3, 0), u("M4", 11, 1, 0)],
  },

  // ─── Module 5 — Statistics ──────────────────────────────────────────
  {
    name: "Statistics",
    moduleId: "M5",
    units: [
      u("M5", 6, 3, 0),
      u("M5", 6, 3, 1),
      u("M5", 7, 3, 0),
      u("M5", 8, 3, 0),
      u("M5", 9, 3, 0),
      u("M5", 10, 1, 0),
      u("M5", 10, 3, 0),
      u("M5", 11, 2, 0),
    ],
  },

  // ─── Module 6 — Sets & Probability ──────────────────────────────────
  {
    name: "Sets",
    moduleId: "M6",
    units: [
      u("M6", 7, 1, 0),
      u("M6", 8, 2, 0),
      u("M6", 9, 3, 0),
      u("M6", 10, 2, 0),
      u("M6", 11, 3, 0),
    ],
  },
  {
    name: "Probability",
    moduleId: "M6",
    units: [
      u("M6", 7, 3, 0),
      u("M6", 8, 3, 0),
      u("M6", 9, 3, 1),
      u("M6", 10, 3, 0),
      u("M6", 11, 3, 1),
    ],
  },
];

// Idempotent — skips entirely if any examTopicTags row exists. The user can
// re-run after `clear` mutations or DB resets without risk of duplication.
// Run via: npx convex run seeds/topicTags:seedAll
export const seedAll = internalMutation({
  handler: async (ctx) => {
    const existing = await ctx.db.query("examTopicTags").take(1);
    if (existing.length > 0) {
      console.log("[seedTopicTags] tags already exist, skipping");
      return { skipped: true as const };
    }

    let tagsCreated = 0;
    let linksCreated = 0;
    const now = Date.now();

    for (const tag of TAG_SEED) {
      const tagId = await ctx.db.insert("examTopicTags", {
        name: tag.name,
        moduleId: tag.moduleId,
        color: MODULE_COLORS[tag.moduleId],
        createdAt: now,
      });
      tagsCreated += 1;
      for (const link of tag.units) {
        await ctx.db.insert("examTopicTagLinks", {
          tagId,
          unitId: link.unitId,
          grade: link.grade,
          term: link.term,
          moduleId: link.moduleId,
          createdAt: now,
        });
        linksCreated += 1;
      }
    }

    console.log(
      `[seedTopicTags] created ${tagsCreated} tags + ${linksCreated} unit links`,
    );
    return { skipped: false as const, tagsCreated, linksCreated };
  },
});
