import {describe, expect, it} from "vite-plus/test";

import {parseGoToLine} from "../src/lib/go-to-line";

describe("parseGoToLine", () =>
{
	it("parses line and line:column, clamps the line into the file, and rejects the rest", () =>
	{
		const inputs = ["5", "5:3", " 7 ", "30", "0", "99", "x", "5:", "5:0", "-1", "2.5", ""];
		expect(inputs.map((input) => [input, parseGoToLine(input, 30)])).toStrictEqual([
			[
				"5",
				{
					line: 5,
				},
			],
			[
				"5:3",
				{
					line: 5,
					column: 3,
				},
			],
			[
				" 7 ",
				{
					line: 7,
				},
			],
			[
				"30",
				{
					line: 30,
				},
			],
			[
				"0",
				{
					line: 1,
				},
			],
			[
				"99",
				{
					line: 30,
				},
			],
			["x", null],
			["5:", null],
			["5:0", null],
			["-1", null],
			["2.5", null],
			["", null],
		]);
	});
});
