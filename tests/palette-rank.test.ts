import {describe, expect, it} from "vite-plus/test";
import {capOrganic, interleaveByRank, paletteRank, paletteTokens} from "../src/lib/palette-rank";

describe("paletteTokens", () =>
{
	it.each([
		["Fix  Auth-bug", ["fix", "auth", "bug"]],
		["→", ["→"]],
		["   ", []],
		["", []],
	])("tokenizes %j", (query, expected) =>
	{
		expect(paletteTokens(query)).toStrictEqual(expected);
	});
});

describe("paletteRank", () =>
{
	it("ranks prefix 0, all-tokens-substring 1, anything else 2", () =>
	{
		expect([
			paletteRank("Settings → Usage", "usage", ["usage"]),
			paletteRank("Jump to input", "jump", ["jump"]),
			paletteRank("Recents", "usage", ["usage"]),
			paletteRank("Fix bug", "pr 863", ["pr", "863"], 863),
			paletteRank("Fix bug", "863", ["863"], 863),
			paletteRank("Fix bug", "pr 864", ["pr", "864"], 863),
			paletteRank("  Jump to input", " JUMP ", ["jump"]),
		]).toStrictEqual([1, 0, 2, 1, 1, 2, 0]);
	});
});

describe("interleaveByRank", () =>
{
	it("orders actions before rows within each rank, keeping incoming order", () =>
	{
		expect(
			interleaveByRank(
				[
					{
						id: "a2",
						rank: 2,
					},
					{
						id: "a0",
						rank: 0,
					},
					{
						id: "a1",
						rank: 1,
					},
					{
						id: "a0b",
						rank: 0,
					},
				],
				[
					{
						id: "r1",
						rank: 1,
					},
					{
						id: "r0",
						rank: 0,
					},
					{
						id: "r2",
						rank: 2,
					},
				],
			).map((item) => item.id),
		).toStrictEqual(["a0", "a0b", "r0", "a1", "r1", "a2", "r2"]);
	});
});

describe("capOrganic", () =>
{
	const never = () => false;

	it("lets fetched rows fill only the remainder", () =>
	{
		expect(capOrganic(["a1", "a2", "a3"], ["f1", "f2", "f3", "f4", "f5"], 7, never)).toStrictEqual(
			{
				kept: ["a1", "a2", "a3"],
				fetched: ["f1", "f2", "f3", "f4"],
			},
		);
	});

	it("stops the ordered walk at the cap and leaves no room for fetched rows", () =>
	{
		const ordered = ["r1", "r2", "r3", "r4", "r5", "r6", "r7", "r8", "r9"];
		expect(capOrganic(ordered, ["f1"], 7, never)).toStrictEqual(
			{
				kept: ["r1", "r2", "r3", "r4", "r5", "r6", "r7"],
				fetched: [],
			},
		);
	});

	it("keeps uncounted items past the cap", () =>
	{
		const ordered = ["r1", "r2", "r3", "r4", "r5", "r6", "r7", "q"];
		expect(capOrganic(ordered, [], 7, (item) => item === "q")).toStrictEqual(
			{
				kept: ordered,
				fetched: [],
			},
		);
	});
});
