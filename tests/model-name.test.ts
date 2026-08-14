import { describe, expect, it } from "vite-plus/test";
import { formatModelName } from "../src/lib/model-name";

describe("formatModelName", () => {
  it("shortens the dated, undated, and bare forms Claude Code writes on disk", () => {
    expect({
      dated: formatModelName("claude-haiku-4-5-20251001"),
      undated: formatModelName("claude-opus-4-8"),
      twoPart: formatModelName("claude-sonnet-4-6"),
      singleVersion: formatModelName("claude-opus-5"),
      bare: formatModelName("sonnet"),
    }).toStrictEqual({
      dated: "Haiku 4.5",
      undated: "Opus 4.8",
      twoPart: "Sonnet 4.6",
      singleVersion: "Opus 5",
      bare: "Sonnet",
    });
  });

  it("drops the [1m] context-window suffix, which names a window and not a model", () => {
    expect({
      qualifiedId: formatModelName("claude-opus-4-8[1m]"),
      qualifiedAlias: formatModelName("claude-fable-5[1m]"),
      qualifiedBare: formatModelName("opus[1m]"),
    }).toStrictEqual({
      qualifiedId: "Opus 4.8",
      qualifiedAlias: "Fable 5",
      qualifiedBare: "Opus",
    });
  });

  it("names no model for the <synthetic> sentinel or for absent input", () => {
    expect({
      synthetic: formatModelName("<synthetic>"),
      empty: formatModelName(""),
      blank: formatModelName("   "),
      missing: formatModelName(undefined),
      nulled: formatModelName(null),
      vendorOnly: formatModelName("claude-"),
    }).toStrictEqual({
      synthetic: null,
      empty: null,
      blank: null,
      missing: null,
      nulled: null,
      vendorOnly: null,
    });
  });

  it("shortens an unrecognized family rather than dropping it", () => {
    expect(formatModelName("claude-quartz-6-1")).toStrictEqual("Quartz 6.1");
  });
});
