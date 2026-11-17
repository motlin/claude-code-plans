import {describe, expect, it} from "vite-plus/test";

import
{
	memoryDialogRows,
	memoryFileFacts,
	memoryLineCount,
	type MemoryRow,
	reduceDiscardGuard,
} from "../src/lib/memory-dialog";

const HOME = "/Users/alice";
const CWD = "/Users/alice/proj";

function rows(
	memoryFiles:
	{
		path: string;
		type: string;
	}[],
)
{
	return memoryDialogRows(
		{
			memoryFiles: memoryFiles.map((file) => (
			{
				...file,
				tokens: 10,
			})),
			cwd: CWD,
			home: HOME,
		},
	);
}

describe("memoryDialogRows", () =>
{
	it("keeps User/Project/Local files, drops auto-memory, and adds a not-created Project placeholder", () =>
	{
		expect(
			rows([
				{
					path: `${HOME}/.claude/CLAUDE.md`,
					type: "User",
				},
				{
					path: `${CWD}/CLAUDE.local.md`,
					type: "Local",
				},
				{
					path: `${HOME}/.claude/projects/-proj/memory/MEMORY.md`,
					type: "AutoMem",
				},
			]),
		).toStrictEqual([
			{
				path: `${HOME}/.claude/CLAUDE.md`,
				type: "User",
				kind: "user",
				label: "User instructions",
				displayPath: "~/.claude/CLAUDE.md",
				exists: true,
				readable: true,
				openable: true,
			},
			{
				path: `${CWD}/CLAUDE.md`,
				type: "Project",
				kind: "project",
				label: "Project instructions",
				displayPath: "CLAUDE.md",
				exists: false,
				readable: false,
				openable: true,
			},
			{
				path: `${CWD}/CLAUDE.local.md`,
				type: "Local",
				kind: "other",
				label: "CLAUDE.local.md",
				displayPath: "CLAUDE.local.md",
				exists: true,
				readable: true,
				openable: true,
			},
		]);
	});

	it("classes nested, rules, imported and managed files", () =>
	{
		expect(
			rows([
				{
					path: "/Library/Application Support/ClaudeCode/CLAUDE.md",
					type: "Managed",
				},
				{
					path: `${CWD}/CLAUDE.md`,
					type: "Project",
				},
				{
					path: `${CWD}/pkg/CLAUDE.md`,
					type: "Project",
				},
				{
					path: `${CWD}/.claude/rules/x.md`,
					type: "Project",
				},
				{
					path: `${CWD}/docs/AGENTS.md`,
					type: "Project",
				},
				{
					path: "relative/CLAUDE.md",
					type: "Project",
				},
			]).map(({kind, label, readable}) => [kind, label, readable]),
		).toStrictEqual([
			["managed", "/Library/Application Support/ClaudeCode/CLAUDE.md", true],
			["user", "User instructions", false],
			["project", "Project instructions", true],
			["nested", "pkg/CLAUDE.md", true],
			["other", ".claude/rules/x.md", true],
			["imported", "docs/AGENTS.md", true],
			["other", "relative/CLAUDE.md", false],
		]);
	});

	it("lists both placeholders with no memory files", () =>
	{
		expect(rows([]).map(({kind, exists, path}) => [kind, exists, path])).toStrictEqual([
			["user", false, `${HOME}/.claude/CLAUDE.md`],
			["project", false, `${CWD}/CLAUDE.md`],
		]);
	});
});

/** The rows at `indexes`, failing the test when any is missing. */
function pick<const N extends readonly number[]>(
	list: readonly MemoryRow[],
	...indexes: N
): {[K in keyof N]: MemoryRow}
{
	return indexes.map((index) =>
	{
		const row = list[index];
		if (row === undefined) throw new Error(`no row ${index}`);
		return row;
	}) as {[K in keyof N]: MemoryRow};
}

describe("memoryLineCount and memoryFileFacts", () =>
{
	it("counts lines as upstream does and joins the facts line", () =>
	{
		const [user, project, local] = pick(
			rows([
				{
					path: `${HOME}/.claude/CLAUDE.md`,
					type: "User",
				},
				{
					path: `${CWD}/CLAUDE.local.md`,
					type: "Local",
				},
			]),
			0,
			1,
			2,
		);
		const [nested, imported] = pick(
			rows([
				{
					path: `${CWD}/CLAUDE.md`,
					type: "Project",
				},
				{
					path: `${CWD}/a/CLAUDE.md`,
					type: "Project",
				},
				{
					path: `${CWD}/b/x.md`,
					type: "Project",
				},
			]),
			2,
			3,
		);
		expect(
			{
				lines: ["", "a", "a\n", "a\nb", "a\nb\n"].map((text) => memoryLineCount(text)),
				facts: [
					memoryFileFacts(
						user,
						{
							lines: 1,
							writable: true,
						},
					),
					memoryFileFacts(project, undefined),
					memoryFileFacts(
						local,
						{
							lines: 3,
							writable: false,
						},
					),
					memoryFileFacts(
						nested,
						{
							lines: 2,
							writable: true,
						},
					),
					memoryFileFacts(imported, undefined),
				],
			},
		).toStrictEqual(
			{
				lines: [0, 1, 1, 2, 2],
				facts: [
					"1 line · read at session start",
					"not created yet",
					"3 lines · read at session start · view only",
					"2 lines · read when Claude works in that folder",
					"@-imported",
				],
			},
		);
	});
});

describe("reduceDiscardGuard", () =>
{
	it("runs, holds, drops and releases guarded actions as upstream's guard does", () =>
	{
		const clean =
		{
			dirtyPath: undefined,
			pending: null,
		};
		const dirty =
		{
			dirtyPath: "/p/CLAUDE.md",
			pending: null,
		};
		const held =
		{
			dirtyPath: "/p/CLAUDE.md",
			pending: "close",
		};
		expect([
			reduceDiscardGuard<string>(
				clean,
				{
					type: "guard",
					action: "close",
				},
			),
			reduceDiscardGuard<string>(
				dirty,
				{
					type: "guard",
					action: "close",
				},
			),
			reduceDiscardGuard<string>(
				held,
				{
					type: "guard",
					action: "select",
				},
			),
			reduceDiscardGuard<string>(
				held,
				{
					type: "dirty",
					path: "/p/CLAUDE.md",
					dirty: false,
				},
			),
			reduceDiscardGuard<string>(
				clean,
				{
					type: "dirty",
					path: "/p/CLAUDE.md",
					dirty: true,
				},
			),
			reduceDiscardGuard<string>(
				held,
				{
					type: "discard",
				},
			),
			reduceDiscardGuard<string>(
				held,
				{
					type: "keep",
				},
			),
		]).toStrictEqual([
			{
				state: clean,
				run: "close",
			},
			{
				state: held,
				run: null,
			},
			{
				state: held,
				run: null,
			},
			{
				state: clean,
				run: "close",
			},
			{
				state: dirty,
				run: null,
			},
			{
				state: clean,
				run: "close",
			},
			{
				state: dirty,
				run: null,
			},
		]);
	});
});
