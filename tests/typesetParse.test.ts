import { describe, expect, it } from "vitest";
import {
  parseTypesetSource,
  typesetSourceHasContent,
} from "../src/lib/typeset-parse";

describe("parseTypesetSource", () => {
  it("plain text becomes a single text segment", () => {
    expect(parseTypesetSource("Solve this equation")).toEqual([
      { type: "text", value: "Solve this equation" },
    ]);
  });

  it("Tamil text passes through untouched", () => {
    expect(parseTypesetSource("இதைத் தீர்க்கவும்")).toEqual([
      { type: "text", value: "இதைத் தீர்க்கவும்" },
    ]);
  });

  it("splits inline math out of surrounding text", () => {
    expect(parseTypesetSource("Solve $x^2 = 4$ for x")).toEqual([
      { type: "text", value: "Solve " },
      { type: "math", value: "x^2 = 4" },
      { type: "text", value: " for x" },
    ]);
  });

  it("handles multiple math runs on one line", () => {
    expect(parseTypesetSource("$\\frac{1}{2}$ + $\\frac{1}{4}$")).toEqual([
      { type: "math", value: "\\frac{1}{2}" },
      { type: "text", value: " + " },
      { type: "math", value: "\\frac{1}{4}" },
    ]);
  });

  it("emits newline segments between lines", () => {
    expect(parseTypesetSource("line one\nline two")).toEqual([
      { type: "text", value: "line one" },
      { type: "newline" },
      { type: "text", value: "line two" },
    ]);
  });

  it("treats an unpaired $ as literal text (mid-typing safety)", () => {
    expect(parseTypesetSource("costs $5 only")).toEqual([
      { type: "text", value: "costs $5 only" },
    ]);
  });

  it("drops empty math runs", () => {
    expect(parseTypesetSource("a $$ b")).toEqual([
      { type: "text", value: "a " },
      { type: "text", value: " b" },
    ]);
  });

  it("math never spans a newline (each line parses independently)", () => {
    expect(parseTypesetSource("open $x\nstill text")).toEqual([
      { type: "text", value: "open $x" },
      { type: "newline" },
      { type: "text", value: "still text" },
    ]);
  });

  it("empty string parses to nothing", () => {
    expect(parseTypesetSource("")).toEqual([]);
  });
});

describe("typesetSourceHasContent", () => {
  it("rejects whitespace-only sources", () => {
    expect(typesetSourceHasContent("  \n  ")).toBe(false);
    expect(typesetSourceHasContent("x")).toBe(true);
  });
});
