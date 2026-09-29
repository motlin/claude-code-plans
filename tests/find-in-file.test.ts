import { describe, expect, it } from "vite-plus/test";

import {
  findCounterText,
  findMatches,
  firstMatchFromLine,
  lineOfMatch,
  lineMatchOffsets,
  stepMatch,
} from "../src/lib/find-in-file";

describe("findMatches", () => {
  it("returns no ranges for an empty query", () => {
    expect(findMatches("anything", "")).toStrictEqual([]);
  });

  it("returns the exact range of every non-overlapping match", () => {
    expect(findMatches("aaaa needle aaaa", "aa")).toStrictEqual([
      { start: 0, end: 2 },
      { start: 2, end: 4 },
      { start: 12, end: 14 },
      { start: 14, end: 16 },
    ]);
  });

  it("ignores case when the query is all lowercase", () => {
    expect(findMatches("Foo foo FOO", "foo")).toStrictEqual([
      { start: 0, end: 3 },
      { start: 4, end: 7 },
      { start: 8, end: 11 },
    ]);
  });

  it("matches case exactly once the query has an uppercase letter", () => {
    expect(findMatches("Foo foo FOO", "Foo")).toStrictEqual([{ start: 0, end: 3 }]);
  });

  it("treats regex metacharacters literally", () => {
    expect(findMatches("a.b axb (a.b)", "(a.b)")).toStrictEqual([{ start: 8, end: 13 }]);
  });

  it("returns no ranges when nothing matches", () => {
    expect(findMatches("haystack", "needle")).toStrictEqual([]);
  });
});

describe("lineMatchOffsets", () => {
  it("gives each line the global index of its first match", () => {
    expect(lineMatchOffsets("foo foo\nbar\nfoo", "foo")).toStrictEqual({
      offsets: [0, 2, 2],
      total: 3,
    });
  });
});

describe("findCounterText", () => {
  it.each([
    [0, 0, "No results"],
    [0, 3, "1 of 3"],
    [2, 3, "3 of 3"],
  ])("active %i of %i → %j", (active, total, expected) => {
    expect(findCounterText(active, total)).toBe(expected);
  });
});

describe("stepMatch", () => {
  it.each([
    [0, 3, 1, 1],
    [2, 3, 1, 0],
    [0, 3, -1, 2],
    [0, 0, 1, 0],
  ])("from %i of %i by %i → %i", (active, total, direction, expected) => {
    expect(stepMatch(active, total, direction as 1 | -1)).toBe(expected);
  });
});

describe("lineOfMatch", () => {
  it.each([
    [0, 1],
    [1, 1],
    [2, 3],
  ])("match %i sits on line %i", (index, expected) => {
    expect(lineOfMatch([0, 2, 2], index)).toBe(expected);
  });
});

describe("firstMatchFromLine", () => {
  it.each([
    [1, 0],
    [2, 2],
    [3, 2],
    [4, 0],
    [9, 0],
  ])("line %i → match %i", (line, expected) => {
    expect(firstMatchFromLine({ offsets: [0, 2, 2, 3], total: 3 }, line)).toBe(expected);
  });
});
