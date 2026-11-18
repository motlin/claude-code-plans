import {describe, expect, it} from "vite-plus/test";

import {folderRowNames, inferHome} from "../src/lib/folder-row-names";

const HOME = "/Users/me";

describe("folderRowNames", () =>
{
	it("gives unique basenames no parent", () =>
	{
		expect(folderRowNames(["/Users/me/projects/a", "/Users/me/projects/b"], HOME)).toStrictEqual([
			{
				name: "a",
				parent: undefined,
			},
			{
				name: "b",
				parent: undefined,
			},
		]);
	});

	it("gives each colliding basename its full shortened parent folder", () =>
	{
		expect(
			folderRowNames(
				[
					"/Users/me/projects/Factorio-FBSR",
					"/Users/me/projects/FactorioBlueprints/BlueprintBot/Factorio-FBSR",
				],
				HOME,
			),
		).toStrictEqual([
			{
				name: "Factorio-FBSR",
				parent: "~/projects",
			},
			{
				name: "Factorio-FBSR",
				parent: "~/projects/FactorioBlueprints/BlueprintBot",
			},
		]);
	});

	it("shortens a folder directly under home to ~", () =>
	{
		expect(folderRowNames(["/Users/me/x", "/Users/me/projects/x"], HOME)).toStrictEqual([
			{
				name: "x",
				parent: "~",
			},
			{
				name: "x",
				parent: "~/projects",
			},
		]);
	});

	it("uses the absolute parent for home itself and for paths outside home", () =>
	{
		expect(folderRowNames(["/Users/me", "/tmp/me"], HOME)).toStrictEqual([
			{
				name: "me",
				parent: "/Users",
			},
			{
				name: "me",
				parent: "/tmp",
			},
		]);
	});

	it("gives a top-level folder the root parent and the root no folder", () =>
	{
		expect(folderRowNames(["/x", "/Users/me/x"], HOME)).toStrictEqual([
			{
				name: "x",
				parent: "/",
			},
			{
				name: "x",
				parent: "~",
			},
		]);
		expect(folderRowNames(["/"], HOME)).toStrictEqual([
			{
				name: "/",
				parent: undefined,
			},
		]);
	});

	it("matches basenames case-sensitively", () =>
	{
		expect(folderRowNames(["/Users/me/X", "/Users/me/y/x"], HOME)).toStrictEqual([
			{
				name: "X",
				parent: undefined,
			},
			{
				name: "x",
				parent: undefined,
			},
		]);
	});

	it("names nested worktrees by their basename", () =>
	{
		expect(
			folderRowNames(
				["/Users/me/projects/repo/.claude/worktrees/feat", "/Users/me/projects/other/.claude/worktrees/feat"],
				HOME,
			),
		).toStrictEqual([
			{
				name: "feat",
				parent: "~/projects/repo/.claude/worktrees",
			},
			{
				name: "feat",
				parent: "~/projects/other/.claude/worktrees",
			},
		]);
	});
});

describe("inferHome", () =>
{
	it("takes the first macOS or Linux home prefix, else none", () =>
	{
		expect([
			inferHome(["/tmp/x", "/Users/me/projects/a"]),
			inferHome(["/home/dev"]),
			inferHome(["/tmp/x"]),
		]).toStrictEqual(["/Users/me", "/home/dev", undefined]);
	});
});
