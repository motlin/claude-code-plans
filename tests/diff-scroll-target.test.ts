import {afterEach, describe, expect, it} from "vite-plus/test";
import {
	clearDiffScrollTarget,
	diffScrollTarget,
	resolveFuzzyDiffPath,
	scrollToDiffLine,
} from "../src/lib/diff-scroll-target";

afterEach(() => {
	clearDiffScrollTarget("s1");
	clearDiffScrollTarget("s2");
});

describe("diff scroll target store (upstream cc8941b7b scrollToAnnotation)", () => {
	it("bumps the nonce per request, omits unset options, and keeps sessions apart", () => {
		scrollToDiffLine("s1", "a.ts");
		const first = diffScrollTarget("s1");
		scrollToDiffLine("s1", "a.ts", {fuzzy: false});
		const second = diffScrollTarget("s1");
		scrollToDiffLine("s1", "b.ts", {fuzzy: true, anchor: {side: "deletions", line: 4}});
		const third = diffScrollTarget("s1");
		expect({first, second, third, other: diffScrollTarget("s2")}).toStrictEqual({
			first: {filePath: "a.ts", nonce: 1},
			second: {filePath: "a.ts", nonce: 2},
			third: {filePath: "b.ts", nonce: 3, fuzzy: true, anchor: {side: "deletions", line: 4}},
			other: undefined,
		});
	});

	it("clears a session's target", () => {
		scrollToDiffLine("s1", "a.ts");
		clearDiffScrollTarget("s1");
		expect(diffScrollTarget("s1")).toBeUndefined();
	});
});

describe("resolveFuzzyDiffPath (upstream yi + cd14a8022 P)", () => {
	it("takes the exact path, else the one diff path ending in /target (slashes normalised)", () => {
		expect([
			resolveFuzzyDiffPath("src/a.ts", ["pkg/src/a.ts", "b.ts"]),
			resolveFuzzyDiffPath("src/a.ts", ["x/src/a.ts", "y/src/a.ts"]),
			resolveFuzzyDiffPath("src/a.ts", ["src/a.ts", "x/src/a.ts"]),
			resolveFuzzyDiffPath("/repo/src/a.ts", ["src/a.ts"]),
			resolveFuzzyDiffPath("src\\a.ts", ["pkg\\src\\a.ts"]),
			resolveFuzzyDiffPath("a.ts", ["ba.ts"]),
			resolveFuzzyDiffPath("c.ts", ["a.ts"]),
		]).toStrictEqual(["pkg/src/a.ts", null, "src/a.ts", null, "pkg\\src\\a.ts", null, null]);
	});
});
