import {describe, expect, it} from "vite-plus/test";

import {
	buildChangedFileTree,
	type ChangedFileInput,
	classifyChangedFile,
} from "../src/components/changes/changes-file-tree";

function file(path: string, additions = 1, deletions = 0): ChangedFileInput {
	return {path, additions, deletions};
}

describe("classifyChangedFile", () => {
	it("classifies test, build, generated, and source paths", () => {
		const paths = [
			"src/lib/session-diff.ts",
			"tests/session-diff.test.ts",
			"test/fixtures/data.json",
			"src/__tests__/thing.ts",
			"spec/models/user_spec.rb",
			"src/components/button.test.tsx",
			"src/components/button.spec.ts",
			"pnpm-lock.yaml",
			"package-lock.json",
			"yarn.lock",
			"Cargo.lock",
			"packages/app/package.json",
			"vite.config.ts",
			"justfile",
			".github/workflows/push.yml",
			"Dockerfile",
			"pyproject.toml",
			"src/routeTree.gen.ts",
			"src/api/client.gen.js",
			"dist/index.js",
			".output/server/index.mjs",
			"tests/__snapshots__/view.test.tsx.snap",
			"README.md",
			"src/testing.ts",
			"contest/entry.ts",
		];

		expect(paths.map((path) => [path, classifyChangedFile(path)])).toEqual([
			["src/lib/session-diff.ts", "source"],
			["tests/session-diff.test.ts", "test"],
			["test/fixtures/data.json", "test"],
			["src/__tests__/thing.ts", "test"],
			["spec/models/user_spec.rb", "test"],
			["src/components/button.test.tsx", "test"],
			["src/components/button.spec.ts", "test"],
			["pnpm-lock.yaml", "build"],
			["package-lock.json", "build"],
			["yarn.lock", "build"],
			["Cargo.lock", "build"],
			["packages/app/package.json", "build"],
			["vite.config.ts", "build"],
			["justfile", "build"],
			[".github/workflows/push.yml", "build"],
			["Dockerfile", "build"],
			["pyproject.toml", "build"],
			["src/routeTree.gen.ts", "generated"],
			["src/api/client.gen.js", "generated"],
			["dist/index.js", "generated"],
			[".output/server/index.mjs", "generated"],
			["tests/__snapshots__/view.test.tsx.snap", "generated"],
			["README.md", "source"],
			["src/testing.ts", "source"],
			["contest/entry.ts", "source"],
		]);
	});
});

describe("buildChangedFileTree", () => {
	it("compacts single-child directory chains and puts directories before files", () => {
		const sections = buildChangedFileTree(
			[
				file(".github/workflows/just-format.yml", 0, 21),
				file(".github/workflows/push.yml", 3, 1),
				file("README.md", 2, 2),
				file("src/lib/deep/nested/a.ts", 5, 0),
				file("src/lib/b.ts", 1, 1),
			],
			{groupByFolder: true, groupByKind: false},
		);

		expect(sections).toEqual([
			{
				kind: null,
				nodes: [
					{
						type: "dir",
						path: ".github/workflows",
						name: ".github/workflows",
						depth: 0,
						children: [
							{
								type: "file",
								path: ".github/workflows/just-format.yml",
								name: "just-format.yml",
								dir: ".github/workflows",
								depth: 1,
								additions: 0,
								deletions: 21,
							},
							{
								type: "file",
								path: ".github/workflows/push.yml",
								name: "push.yml",
								dir: ".github/workflows",
								depth: 1,
								additions: 3,
								deletions: 1,
							},
						],
					},
					{
						type: "dir",
						path: "src/lib",
						name: "src/lib",
						depth: 0,
						children: [
							{
								type: "dir",
								path: "src/lib/deep/nested",
								name: "deep/nested",
								depth: 1,
								children: [
									{
										type: "file",
										path: "src/lib/deep/nested/a.ts",
										name: "a.ts",
										dir: "src/lib/deep/nested",
										depth: 2,
										additions: 5,
										deletions: 0,
									},
								],
							},
							{
								type: "file",
								path: "src/lib/b.ts",
								name: "b.ts",
								dir: "src/lib",
								depth: 1,
								additions: 1,
								deletions: 1,
							},
						],
					},
					{
						type: "file",
						path: "README.md",
						name: "README.md",
						dir: "",
						depth: 0,
						additions: 2,
						deletions: 2,
					},
				],
			},
		]);
	});

	it("lists files flat in diff order with their directory when not grouped by folder", () => {
		const sections = buildChangedFileTree(
			[file("src/b.ts", 1, 0), file("a.ts", 0, 1), file("src/lib/c.ts", 2, 2)],
			{groupByFolder: false, groupByKind: false},
		);

		expect(sections).toEqual([
			{
				kind: null,
				nodes: [
					{
						type: "file",
						path: "src/b.ts",
						name: "b.ts",
						dir: "src",
						depth: 0,
						additions: 1,
						deletions: 0,
					},
					{
						type: "file",
						path: "a.ts",
						name: "a.ts",
						dir: "",
						depth: 0,
						additions: 0,
						deletions: 1,
					},
					{
						type: "file",
						path: "src/lib/c.ts",
						name: "c.ts",
						dir: "src/lib",
						depth: 0,
						additions: 2,
						deletions: 2,
					},
				],
			},
		]);
	});

	it("separates test, build, and generated files into trailing sections in that order", () => {
		const sections = buildChangedFileTree(
			[file("src/routeTree.gen.ts"), file("package.json"), file("tests/a.test.ts"), file("src/a.ts")],
			{groupByFolder: false, groupByKind: true},
		);

		expect(sections.map((section) => [section.kind, section.nodes.map((node) => node.path)])).toEqual([
			["source", ["src/a.ts"]],
			["test", ["tests/a.test.ts"]],
			["build", ["package.json"]],
			["generated", ["src/routeTree.gen.ts"]],
		]);
	});

	it("omits empty kind sections and returns nothing for no files", () => {
		expect({
			testsOnly: buildChangedFileTree([file("tests/a.test.ts")], {
				groupByFolder: true,
				groupByKind: true,
			}).map((section) => section.kind),
			none: buildChangedFileTree([], {groupByFolder: true, groupByKind: true}),
			noneUngrouped: buildChangedFileTree([], {groupByFolder: true, groupByKind: false}),
		}).toEqual({testsOnly: ["test"], none: [], noneUngrouped: []});
	});
});
