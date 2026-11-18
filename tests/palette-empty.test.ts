import {describe, expect, it} from "vite-plus/test";
import {paletteEmptyKind, paletteEmptyMessage, paletteLiveCountMessage} from "../src/lib/palette-empty";

describe("paletteEmptyMessage", () =>
{
	it("ports upstream's zg copy, dropping queries longer than 50 characters", () =>
	{
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

describe("paletteEmptyKind", () =>
{
	it("ports upstream's Sm: no kind while searching or with rows, then silent, stalled, failed, filtered, nothing", () =>
	{
		const base =
		{
			query: "zzqxvq",
			searching: false,
			rowCount: 0,
			filtered: false,
			failed: false,
			stalled: false,
		};
		const cases = [
			base,
			{
				...base,
				searching: true,
			},
			{
				...base,
				rowCount: 2,
			},
			{
				...base,
				query: "x",
			},
			{
				...base,
				query: " x ",
			},
			{
				...base,
				query: "x",
				failed: true,
				filtered: true,
			},
			{
				...base,
				query: "x",
				searching: true,
			},
			{
				...base,
				failed: true,
			},
			{
				...base,
				failed: true,
				filtered: true,
			},
			{
				...base,
				failed: true,
				rowCount: 1,
			},
			{
				...base,
				filtered: true,
			},
			{
				...base,
				query: "",
			},
			{
				...base,
				query: "",
				filtered: true,
			},
			{
				...base,
				filtered: true,
				stalled: true,
			},
			{
				...base,
				filtered: true,
				failed: true,
				stalled: true,
			},
			{
				...base,
				query: "x",
				filtered: true,
				stalled: true,
			},
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
			"stalled",
			"stalled",
			"silent",
		]);
	});
});

describe("paletteLiveCountMessage", () =>
{
	it("ports upstream's count branch: silent for an empty raw query, over 50 characters, blocked or with no rows", () =>
	{
		const cases: [string, number, boolean][] = [
			["", 25, false],
			["   ", 7, false],
			[" ", 1, false],
			[" ".repeat(51), 7, false],
			["auth", 3, true],
			["auth", 0, false],
		];

		expect(
			cases.map(([rawQuery, count, blocked]) =>
				paletteLiveCountMessage(
					{
						rawQuery,
						count,
						blocked,
					},
				),
			),
		).toStrictEqual([null, "7 results available", "1 result available", null, null, null]);
	});
});
