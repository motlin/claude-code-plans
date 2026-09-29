import { describe, expect, it } from "vite-plus/test";

import {
  GO_TO_FILE_LIMIT,
  fuzzyMatchPath,
  goToFileFooter,
  searchPaths,
} from "../src/lib/fuzzy-path";

describe("fuzzyMatchPath", () => {
  it("matches a subsequence across directory and basename with exact ranges", () => {
    expect(fuzzyMatchPath("wfmrg", ".github/workflows/merge-group.yml")?.ranges).toEqual([
      [8, 9],
      [12, 13],
      [18, 19],
      [20, 22],
    ]);
  });

  it("is case-insensitive", () => {
    expect(fuzzyMatchPath("README", "docs/readme.md")?.ranges).toEqual([[5, 11]]);
  });

  it("returns null when the query is not a subsequence", () => {
    expect(fuzzyMatchPath("zzz", "src/app.ts")).toBeNull();
  });

  it("matches everything with no ranges for an empty query", () => {
    expect(fuzzyMatchPath("", "src/app.ts")).toEqual({ score: 0, ranges: [] });
  });

  it("prefers a basename match over the same letters in a directory", () => {
    const inDir = fuzzyMatchPath("merge", "src/merge/index.ts");
    const inBase = fuzzyMatchPath("merge", "src/utils/merge.ts");
    expect(inBase!.score).toBeGreaterThan(inDir!.score);
  });

  it("prefers contiguous matches over scattered ones", () => {
    const contiguous = fuzzyMatchPath("app", "src/app.ts");
    const scattered = fuzzyMatchPath("app", "src/a-p-p.ts");
    expect(contiguous!.score).toBeGreaterThan(scattered!.score);
  });

  it("picks the contiguous basename occurrence when letters also appear earlier", () => {
    expect(fuzzyMatchPath("index", "src/i/n/d/e/x/index.ts")?.ranges).toEqual([[14, 19]]);
  });
});

describe("searchPaths", () => {
  it("ranks basename matches above directory matches", () => {
    const paths = ["src/merge/index.ts", "src/utils/merge.ts", "README.md"];
    expect(searchPaths("merge", paths).results.map((result) => result.path)).toEqual([
      "src/utils/merge.ts",
      "src/merge/index.ts",
    ]);
  });

  it("lists paths in their original order for an empty query, capped", () => {
    const paths = Array.from({ length: GO_TO_FILE_LIMIT + 200 }, (_, index) => `f${index}.ts`);
    const { results, more } = searchPaths("", paths);
    expect({
      count: results.length,
      first: results[0]?.path,
      last: results.at(-1)?.path,
      more,
      footer: goToFileFooter(more),
    }).toEqual({
      count: 100,
      first: "f0.ts",
      last: "f99.ts",
      more: 200,
      footer: "200 more files. Keep typing to narrow.",
    });
  });

  it("has no footer when nothing is hidden and a singular one for one file", () => {
    expect([goToFileFooter(0), goToFileFooter(1)]).toEqual([
      null,
      "1 more file. Keep typing to narrow.",
    ]);
  });
});
