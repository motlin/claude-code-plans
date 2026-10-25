import {describe, expect, it} from "vite-plus/test";
import {paletteEmptyMessage} from "../src/lib/palette-empty";

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
