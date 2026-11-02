import {describe, expect, it} from "vite-plus/test";

import {clampRows, inputRows, rowsFitBudget, type PermissionRow} from "../src/lib/permission-rows";

describe("inputRows", () =>
{
	it("puts top-level keys in words with upstream's acronyms and value kinds", () =>
	{
		expect(
			inputRows(
				{
					subagent_type: "general-purpose",
					run_in_background: true,
					taskIds: ["a", "b"],
					url: "x",
				},
			),
		).toStrictEqual([
			{
				label: "Subagent type",
				value: "general-purpose",
			},
			{
				label: "Run in background",
				value: "true",
				code: true,
			},
			{
				label: "Task IDs",
				value: "• a\n• b",
				code: true,
			},
			{
				label: "URL",
				value: "x",
			},
		]);
	});

	it("keeps a key it cannot put in words as a code label", () =>
	{
		expect(
			inputRows(
				{
					"-i": true,
				},
			),
		).toStrictEqual([
			{
				label: "-i",
				labelCode: true,
				value: "true",
				code: true,
			},
		]);
	});

	it("draws a nested object as a group of raw code labels", () =>
	{
		expect(
			inputRows(
				{
					opts:
					{
						depth: 2,
					},
				},
			),
		).toStrictEqual([
			{
				label: "Opts",
				rows: [
					{
						label: "depth",
						labelCode: true,
						value: "2",
						code: true,
					},
				],
			},
		]);
	});

	it("keeps both keys raw when their words collide", () =>
	{
		expect(
			inputRows(
				{
					fooBar: 1,
					foo_bar: 2,
				},
			),
		).toStrictEqual([
			{
				label: "fooBar",
				labelCode: true,
				value: "1",
				code: true,
			},
			{
				label: "foo_bar",
				labelCode: true,
				value: "2",
				code: true,
			},
		]);
	});

	it("draws an empty string as JSON code", () =>
	{
		expect(
			inputRows(
				{
					a: "",
				},
			),
		).toStrictEqual([
			{
				label: "A",
				value: '""',
				code: true,
			},
		]);
	});

	it("keys an array of objects 1, 2, …", () =>
	{
		expect(
			inputRows(
				{
					edits: [
						{
							a: 1,
						},
						{
							a: 2,
						},
					],
				},
			),
		).toStrictEqual([
			{
				label: "Edits",
				rows: [
					{
						label: "1",
						labelCode: true,
						rows: [
							{
								label: "a",
								labelCode: true,
								value: "1",
								code: true,
							},
						],
					},
					{
						label: "2",
						labelCode: true,
						rows: [
							{
								label: "a",
								labelCode: true,
								value: "2",
								code: true,
							},
						],
					},
				],
			},
		]);
	});

	it("flattens past depth 3 with › labels", () =>
	{
		expect(
			inputRows(
				{
					a:
					{
						b:
						{
							c:
							{
								d: 1,
							},
						},
					},
				},
			),
		).toStrictEqual([
			{
				label: "A",
				rows: [
					{
						label: "b",
						labelCode: true,
						rows: [
							{
								label: "c",
								labelCode: true,
								rows: [
									{
										label: "d",
										labelCode: true,
										value: "1",
										code: true,
									},
								],
							},
						],
					},
				],
			},
		]);
		expect(
			inputRows(
				{
					a:
					{
						b:
						{
							c:
							{
								d:
								{
									e: 1,
								},
							},
						},
					},
				},
			),
		).toStrictEqual([
			{
				label: "A",
				rows: [
					{
						label: "b",
						labelCode: true,
						rows: [
							{
								label: "c",
								labelCode: true,
								rows: [
									{
										label: "d › e",
										labelCode: true,
										value: "1",
										code: true,
									},
								],
							},
						],
					},
				],
			},
		]);
	});

	it("draws JSON compact up to 60 chars and pretty beyond", () =>
	{
		expect(
			inputRows(
				{
					v: [1, 2],
				},
			),
		).toStrictEqual([
			{
				label: "V",
				value: "[ 1, 2 ]",
				code: true,
			},
		]);
		const long =
		{
			alpha: "a".repeat(30),
			beta: "b".repeat(30),
		};
		expect(
			inputRows(
				{
					v: [long, 1],
				},
			),
		).toStrictEqual([
			{
				label: "V",
				value: JSON.stringify([long, 1], null, 2),
				code: true,
			},
		]);
	});

	it("keeps a multi-line string as plain text", () =>
	{
		expect(
			inputRows(
				{
					prompt: "one\ntwo",
				},
			),
		).toStrictEqual([
			{
				label: "Prompt",
				value: "one\ntwo",
			},
		]);
	});

	it("truncates a long label to 32 chars with an ellipsis", () =>
	{
		expect(
			inputRows(
				{
					["a_".repeat(20) + "z"]: "x",
				},
			),
		).toStrictEqual([
			{
				label: "A a a a a a a a a a a a a a a a ".slice(0, 31) + "…",
				value: "x",
			},
		]);
	});
});

describe("clampRows", () =>
{
	it("clamps every leaf to 6 lines, nested ones too", () =>
	{
		const rows: PermissionRow[] = [
			{
				label: "A",
				value: "x",
			},
			{
				label: "B",
				rows: [
					{
						label: "c",
						labelCode: true,
						value: "1",
						code: true,
					},
				],
			},
		];
		expect(clampRows(rows)).toStrictEqual([
			{
				label: "A",
				value: "x",
				clampLines: 6,
			},
			{
				label: "B",
				rows: [
					{
						label: "c",
						labelCode: true,
						value: "1",
						code: true,
						clampLines: 6,
					},
				],
			},
		]);
	});
});

describe("rowsFitBudget", () =>
{
	const leaf = (value: string): PermissionRow => (
	{
		label: "A",
		value,
	});

	it("fits 12 short leaves", () =>
	{
		expect(
			rowsFitBudget(
				Array.from(
					{
						length: 12,
					},
					() => leaf("x"),
				),
			),
		).toBe(true);
	});

	it("rejects 13 leaves", () =>
	{
		expect(
			rowsFitBudget(
				Array.from(
					{
						length: 13,
					},
					() => leaf("x"),
				),
			),
		).toBe(false);
	});

	it("rejects one unclamped 201-char value, but not a clamped one", () =>
	{
		expect(rowsFitBudget([leaf("x".repeat(201))])).toBe(false);
		expect(rowsFitBudget(clampRows([leaf("x".repeat(201))]))).toBe(true);
	});

	it("rejects an unclamped value with a newline", () =>
	{
		expect(rowsFitBudget([leaf("a\nb")])).toBe(false);
	});
});
