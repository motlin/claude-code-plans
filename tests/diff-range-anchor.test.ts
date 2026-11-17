import {getSingularPatch} from "@pierre/diffs";
import {describe, expect, it} from "vite-plus/test";

import
{
	anchorSpan,
	isMultiLine,
	oldToNewLine,
	selectionTarget,
	shouldSwallowGutterAdd,
} from "../src/lib/diff-range-anchor";

/** Same fixture as tests/diff-file.test.tsx: old 1-3 → new 1-5; pierre parses new line 2 as an insert, then old 2 → new 3. */
const PATCH = `diff --git a/src/greet.ts b/src/greet.ts
index 1111111..2222222 100644
--- a/src/greet.ts
+++ b/src/greet.ts
@@ -1,3 +1,5 @@
 export function greet(name: string) {
-  return "hi " + name;
+  const greeting = "hello";
+  return greeting + " " + name;
 }
+export const loud = (name: string) => greet(name).toUpperCase();
`;

/** Old 1-4 → new 1-1: lines 2-4 deleted outright. */
const DELETION_PATCH = `--- a/src/a.ts
+++ b/src/a.ts
@@ -1,4 +1,1 @@
 keep
-gone 1
-gone 2
-gone 3
`;

const META = getSingularPatch(PATCH);

describe("isMultiLine (upstream ld)", () =>
{
	it("is false for one line on one side, true for two lines or two sides", () =>
	{
		expect([
			isMultiLine(
				{
					start: 2,
					end: 2,
					side: "additions",
				},
			),
			isMultiLine(
				{
					start: 2,
					end: 4,
				},
			),
			isMultiLine(
				{
					start: 2,
					end: 2,
					side: "deletions",
					endSide: "additions",
				},
			),
		]).toStrictEqual([false, true, true]);
	});
});

describe("anchorSpan (upstream pd anchorSpan + ud)", () =>
{
	it("orders a same-side range and keeps an additions range where it is", () =>
	{
		expect(anchorSpan(META, 5, 3, "additions")).toStrictEqual(
			{
				side: "additions",
				line: 3,
				endLine: 5,
			},
		);
	});

	it("moves a deletions range lying wholly in context to the additions side", () =>
	{
		expect(anchorSpan(META, 1, 1, "deletions")).toStrictEqual(
			{
				side: "additions",
				line: 1,
				endLine: 1,
			},
		);
		expect(anchorSpan(META, 3, 3, "deletions")).toStrictEqual(
			{
				side: "additions",
				line: 4,
				endLine: 4,
			},
		);
	});

	it("leaves a deletions range touching a removed line on the deletions side", () =>
	{
		expect(anchorSpan(META, 2, 2, "deletions")).toStrictEqual(
			{
				side: "deletions",
				line: 2,
				endLine: 2,
			},
		);
		expect(anchorSpan(META, 1, 2, "deletions")).toStrictEqual(
			{
				side: "deletions",
				line: 1,
				endLine: 2,
			},
		);
	});
});

describe("selectionTarget (upstream pd selectionEnd)", () =>
{
	it("gives no target for a single-line press", () =>
	{
		expect(
			selectionTarget(
				META,
				{
					start: 3,
					end: 3,
					side: "additions",
					endSide: "additions",
				},
				false,
			),
		).toBeNull();
	});

	it("orders a same-side drag dragged upward", () =>
	{
		expect(
			selectionTarget(
				META,
				{
					start: 5,
					end: 3,
					side: "additions",
					endSide: "additions",
				},
				false,
			),
		).toStrictEqual(
			{
				side: "additions",
				line: 3,
				endLine: 5,
			},
		);
	});

	it("maps a split drag from the deletions column into the additions column onto the end side", () =>
	{
		expect(
			selectionTarget(
				META,
				{
					start: 2,
					side: "deletions",
					end: 4,
					endSide: "additions",
				},
				true,
			),
		).toStrictEqual(
			{
				side: "additions",
				line: 3,
				endLine: 4,
			},
		);
	});

	it("maps a split drag from the additions column into the deletions column onto the deletions side", () =>
	{
		expect(
			selectionTarget(
				META,
				{
					start: 3,
					side: "additions",
					end: 1,
					endSide: "deletions",
				},
				true,
			),
		).toStrictEqual(
			{
				side: "deletions",
				line: 1,
				endLine: 2,
			},
		);
	});

	it("moves a deletions drag lying wholly in context to the additions side", () =>
	{
		expect(
			selectionTarget(
				getSingularPatch(`--- a/b.ts
+++ b/b.ts
@@ -1,4 +1,4 @@
 one
 two
-three
+THREE
 four
`),
				{
					start: 1,
					side: "deletions",
					end: 2,
					endSide: "deletions",
				},
				true,
			),
		).toStrictEqual(
			{
				side: "additions",
				line: 1,
				endLine: 2,
			},
		);
	});
});

describe("oldToNewLine (upstream Hu)", () =>
{
	it("maps an old context line to its new number", () =>
	{
		expect([oldToNewLine(META, 1), oldToNewLine(META, 3)]).toStrictEqual([1, 4]);
	});

	it("maps a removed line to the first new line of its change block, and an outright deletion to the line before it", () =>
	{
		// pierre pairs old line 2 with new line 3, so its block starts there; new line 2 is an insert before it.
		expect([oldToNewLine(META, 2), oldToNewLine(getSingularPatch(DELETION_PATCH), 3)]).toStrictEqual([3, 1]);
	});
});

describe("shouldSwallowGutterAdd (upstream pd hoverAdd guard)", () =>
{
	it("swallows the + on the line a drag ended on once, and leaves other lines alone", () =>
	{
		const guard =
		{
			current:
			{
				side: "additions" as const,
				line: 4,
			},
		};
		expect([
			shouldSwallowGutterAdd(
				guard,
				{
					side: "additions",
					line: 5,
				},
			),
			shouldSwallowGutterAdd(
				guard,
				{
					side: "deletions",
					line: 4,
				},
			),
			shouldSwallowGutterAdd(
				guard,
				{
					side: "additions",
					line: 4,
				},
			),
			shouldSwallowGutterAdd(
				guard,
				{
					side: "additions",
					line: 4,
				},
			),
		]).toStrictEqual([false, false, true, false]);
		expect(guard.current).toBeNull();
	});
});
