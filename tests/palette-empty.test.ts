import {describe, expect, it} from "vite-plus/test";
import {paletteEmptyKind, paletteEmptyMessage} from "../src/lib/palette-empty";

describe("paletteEmptyMessage", () => {
	it("ports upstream's zg copy, dropping queries longer than 50 characters", () => {
		const long = "x".repeat(51);
		const fifty = "y".repeat(50);
		const cases: [string, string | null][] = [
			["", null],
			["", "Code"],
			["zzqxvq", null],
			["zzqxvq", "Code"],
			["  padded  ", null],
			["   ", "Plans"],
			[fifty, null],
			[long, null],
			[long, "Code"],
		];

		expect(cases.map(([query, scope]) => paletteEmptyMessage(query, scope))).toStrictEqual([
			"No results found",
			"No results in Code",
			"No results for “zzqxvq”",
			"No results for “zzqxvq” in Code",
			"No results for “padded”",
			"No results in Plans",
			`No results for “${fifty}”`,
			"No results found",
			"No results in Code",
		]);
	});
});

describe("paletteEmptyKind", () => {
	it("ports upstream's Sm: no kind while searching or with rows, then silent, failed, filtered, nothing", () => {
		const base = {query: "zzqxvq", searching: false, rowCount: 0, filtered: false, failed: false};
		const cases = [
			base,
			{...base, searching: true},
			{...base, rowCount: 2},
			{...base, query: "x"},
			{...base, query: " x "},
			{...base, query: "x", failed: true, filtered: true},
			{...base, query: "x", searching: true},
			{...base, failed: true},
			{...base, failed: true, filtered: true},
			{...base, failed: true, rowCount: 1},
			{...base, filtered: true},
			{...base, query: ""},
			{...base, query: "", filtered: true},
		];

		expect(cases.map((input) => paletteEmptyKind(input))).toStrictEqual([
			"nothing",
			null,
			null,
			"silent",
			"silent",
			"silent",
			null,
			"failed",
			"failed",
			null,
			"filtered",
			"nothing",
			"filtered",
		]);
	});
});
