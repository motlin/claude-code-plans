import {describe, expect, test} from "vite-plus/test";

import {findPinConflicts, formatConflicts} from "./check-action-pins.mjs";

const SHA_A = "3d3c42e5aac5ba805825da76410c181273ba90b1";
const SHA_B = "2d8d4cafcbd33be2ea37d2b6f5ad595363d1f1ca";

describe("findPinConflicts", () => {
	test("all pins equal passes", () => {
		const files = [
			{path: ".github/workflows/a.yml", content: `steps:\n  - uses: actions/checkout@${SHA_A} # v7.0.1\n`},
			{path: ".github/workflows/b.yml", content: `steps:\n  - uses: actions/checkout@${SHA_A} # v7.0.1\n`},
		];
		expect(findPinConflicts(files)).toStrictEqual([]);
	});

	test("two SHAs for the same action fails and reports both locations", () => {
		const files = [
			{
				path: ".github/workflows/a.yml",
				content: `jobs:\n  x:\n    steps:\n      - uses: jdx/mise-action@${SHA_A} # v5.0.1\n`,
			},
			{path: ".github/workflows/b.yml", content: `steps:\n  - uses: jdx/mise-action@${SHA_B} # v5.1.1\n`},
		];
		const conflicts = findPinConflicts(files);
		expect(conflicts).toStrictEqual([
			{
				action: "jdx/mise-action",
				occurrences: [
					{file: ".github/workflows/a.yml", line: 4, ref: SHA_A, comment: "v5.0.1"},
					{file: ".github/workflows/b.yml", line: 2, ref: SHA_B, comment: "v5.1.1"},
				],
			},
		]);
		expect(formatConflicts(conflicts)).toBe(
			[
				"jdx/mise-action is pinned to 2 different refs:",
				`  .github/workflows/a.yml:4 ${SHA_A} # v5.0.1`,
				`  .github/workflows/b.yml:2 ${SHA_B} # v5.1.1`,
			].join("\n"),
		);
	});

	test("subpath actions group with owner/repo", () => {
		const files = [
			{
				path: ".github/workflows/a.yml",
				content: `steps:\n  - uses: github/codeql-action/init@${SHA_A} # v3\n  - name: x\n    uses: github/codeql-action/analyze@${SHA_B}\n`,
			},
		];
		expect(findPinConflicts(files)).toStrictEqual([
			{
				action: "github/codeql-action",
				occurrences: [
					{file: ".github/workflows/a.yml", line: 2, ref: SHA_A, comment: "v3"},
					{file: ".github/workflows/a.yml", line: 4, ref: SHA_B, comment: undefined},
				],
			},
		]);
	});

	test("local and docker refs are ignored", () => {
		const files = [
			{
				path: ".github/actions/setup/action.yml",
				content: [
					"runs:",
					"  steps:",
					"    - uses: ./.github/actions/other",
					"    - uses: docker://alpine:3.20",
					"    - uses: docker://alpine:3.21",
					`    - uses: actions/checkout@${SHA_A}`,
					"",
				].join("\n"),
			},
		];
		expect(findPinConflicts(files)).toStrictEqual([]);
	});
});
