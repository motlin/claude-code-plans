import {describe, expect, it} from "vite-plus/test";
import
{
	collectDroppedFiles,
	type DropEntry,
	type DroppedEntry,
	entriesFromDataTransfer,
	splitDroppedItems,
} from "../src/lib/drop-collect";

const text = (name: string) =>
	new File(
		["x"],
		name,
		{
			type: "text/plain",
		},
	);

interface FakeDirectory
{
	readonly dir: string;
	readonly children: readonly (FakeDirectory | string)[];
	readonly failRead?: boolean;
}

const dir = (name: string, children: readonly (FakeDirectory | string)[], failRead = false): FakeDirectory => (
{
	dir: name,
	children,
	failRead,
});

/** A FileSystemEntry tree like Chrome's webkitGetAsEntry: readEntries hands out batches of two, then []. */
function entry(node: FakeDirectory | string, parent: string): DroppedEntry
{
	if (typeof node === "string")
	{
		return {
			isFile: true,
			isDirectory: false,
			name: node,
			fullPath: `${parent}/${node}`,
			file: (success: (file: File) => void) =>
			{
				success(text(node));
			},
		};
	}
	const fullPath = `${parent}/${node.dir}`;
	return {
		isFile: false,
		isDirectory: true,
		name: node.dir,
		fullPath,
		createReader: () =>
		{
			let offset = 0;
			return {
				readEntries: (success: (entries: DroppedEntry[]) => void, error?: (err: unknown) => void) =>
				{
					if (node.failRead === true)
					{
						error?.(new Error("denied"));
						return;
					}
					const batch = node.children.slice(offset, offset + 2).map((child) => entry(child, fullPath));
					offset += 2;
					success(batch);
				},
			};
		},
	};
}

const folder = (node: FakeDirectory): DropEntry => (
{
	file: text(node.dir),
	entry: entry(node, ""),
});
const loose = (name: string): DropEntry => (
{
	file: text(name),
	entry: entry(name, ""),
});

function accepted(files: readonly File[])
{
	return files.map((file) => (
	{
		name: file.name,
		relativePath: Reflect.get(file, "relativePath") as unknown,
	}));
}

describe("collectDroppedFiles (upstream cds le)", () =>
{
	it("flattens a folder depth-first, skips junk names, and sets a hidden relativePath", async () =>
	{
		const result = await collectDroppedFiles(
			[folder(dir("proj", ["a.ts", ".DS_Store", dir("sub", ["b.ts", "._b.ts"]), "Thumbs.db", "desktop.ini"]))],
			{
				multiple: true,
			},
		);

		expect(
			{
				accepted: accepted(result.accepted),
				enumerable: Object.keys(result.accepted[0] ?? {}),
				rejections: result.rejections,
				notices: result.notices,
				folders: result.folders.map(({name, handling}) => (
				{
					name,
					handling,
				})),
			},
		).toStrictEqual(
			{
				accepted: [
					{
						name: "a.ts",
						relativePath: "proj/a.ts",
					},
					{
						name: "b.ts",
						relativePath: "proj/sub/b.ts",
					},
				],
				enumerable: [],
				rejections: [],
				notices: [],
				folders: [
					{
						name: "proj",
						handling: "flatten",
					},
				],
			},
		);
	});

	it("notices an empty folder, and one holding only junk", async () =>
	{
		const result = await collectDroppedFiles(
			[folder(dir("empty", [])), folder(dir("junk", [".DS_Store"]))],
			{
				multiple: true,
			},
		);

		expect(
			{
				accepted: result.accepted,
				notices: result.notices,
			},
		).toStrictEqual(
			{
				accepted: [],
				notices: [
					{
						code: "folder-empty",
						message: "The folder “empty” is empty.",
					},
					{
						code: "folder-empty",
						message: "The folder “junk” is empty.",
					},
				],
			},
		);
	});

	it("stops past the entry cap, counting sub-folders, with one counter shared across the drop", async () =>
	{
		const result = await collectDroppedFiles(
			[folder(dir("big", ["1", dir("sub", ["2"]), "3", "4", "5"])), folder(dir("next", ["6"]))],
			{
				multiple: true,
				entryCap: 3,
			},
		);

		expect(
			{
				accepted: accepted(result.accepted),
				notices: result.notices,
			},
		).toStrictEqual(
			{
				accepted: [
					{
						name: "1",
						relativePath: "big/1",
					},
					{
						name: "2",
						relativePath: "big/sub/2",
					},
				],
				notices: [
					{
						code: "folder-too-large",
						message: "The folder “big” has too many items.",
					},
					{
						code: "folder-too-large",
						message: "The folder “next” has too many items.",
					},
				],
			},
		);
	});

	it("keeps collecting past an unreadable sub-folder and notices the read error", async () =>
	{
		const result = await collectDroppedFiles(
			[folder(dir("proj", ["a.ts", dir("locked", ["x"], true), "b.ts"]))],
			{
				multiple: true,
			},
		);

		expect(
			{
				accepted: accepted(result.accepted),
				notices: result.notices,
			},
		).toStrictEqual(
			{
				accepted: [
					{
						name: "a.ts",
						relativePath: "proj/a.ts",
					},
					{
						name: "b.ts",
						relativePath: "proj/b.ts",
					},
				],
				notices: [
					{
						code: "folder-read-error",
						message: "There was a problem reading the folder “proj”.",
					},
				],
			},
		);
	});

	it("stops the walk at maxFiles and skips later folders, rejecting the overflowing files", async () =>
	{
		const result = await collectDroppedFiles(
			[folder(dir("proj", ["a", "b", "c", "d"])), folder(dir("later", ["e"])), loose("f")],
			{
				multiple: true,
				maxFiles: 2,
			},
		);

		expect(
			{
				accepted: accepted(result.accepted),
				rejections: result.rejections.map(({file, code, message}) => (
				{
					name: file.name,
					code,
					message,
				})),
				notices: result.notices,
				folders: result.folders.map(({name, handling}) => (
				{
					name,
					handling,
				})),
			},
		).toStrictEqual(
			{
				accepted: [
					{
						name: "a",
						relativePath: "proj/a",
					},
					{
						name: "b",
						relativePath: "proj/b",
					},
				],
				rejections: [
					{
						name: "c",
						code: "too-many-files",
						message: "Only 2 files can be added here.",
					},
					{
						name: "f",
						code: "too-many-files",
						message: "Only 2 files can be added here.",
					},
				],
				notices: [],
				folders: [
					{
						name: "proj",
						handling: "flatten",
					},
					{
						name: "later",
						handling: "flatten",
					},
				],
			},
		);
	});

	it("words the maxFiles rejection for zero and one file", async () =>
	{
		const none = await collectDroppedFiles(
			[loose("a")],
			{
				multiple: true,
				maxFiles: 0,
			},
		);
		const one = await collectDroppedFiles(
			[loose("a"), loose("b")],
			{
				multiple: false,
			},
		);

		expect([none.rejections.map((r) => r.message), one.rejections.map((r) => r.message)]).toStrictEqual([
			["No more files can be added here."],
			["Only one file can be added here."],
		]);
	});

	it("rejects folders with a notice when asked, and always in a single-file zone", async () =>
	{
		const reject = await collectDroppedFiles(
			[folder(dir("proj", ["a"]))],
			{
				multiple: true,
				folders: "reject",
			},
		);
		const single = await collectDroppedFiles(
			[folder(dir("proj", ["a"]))],
			{
				multiple: false,
				folders: "flatten",
			},
		);

		expect(
			[reject, single].map(({accepted: files, notices, folders}) => (
			{
				files,
				notices,
				folders: folders.map((f) => f.handling),
			})),
		).toStrictEqual([
			{
				files: [],
				notices: [
					{
						code: "folder-not-allowed",
						message: "Folders aren’t supported here.",
					},
				],
				folders: ["reject"],
			},
			{
				files: [],
				notices: [
					{
						code: "folder-not-allowed",
						message: "Folders aren’t supported here.",
					},
				],
				folders: ["reject"],
			},
		]);
	});

	it("hands kept folders back without walking them", async () =>
	{
		const proj = folder(dir("proj", ["a"]));
		const result = await collectDroppedFiles(
			[proj],
			{
				multiple: true,
				folders: "keep",
			},
		);

		expect(result).toStrictEqual(
			{
				accepted: [],
				rejections: [],
				notices: [],
				folders: [
					{
						name: "proj",
						file: proj.file,
						handling: "keep",
					},
				],
			},
		);
	});

	it("counts unreadable items into one notice", async () =>
	{
		const one = await collectDroppedFiles(
			[
				{
					file: null,
					entry: null,
				},
			],
			{
				multiple: true,
			},
		);
		const two = await collectDroppedFiles(
			[
				{
					file: null,
					entry: null,
				},
				{
					file: null,
					entry: null,
				},
			],
			{
				multiple: true,
			},
		);

		expect([one.notices, two.notices]).toStrictEqual([
			[
				{
					code: "file-read-error",
					count: 1,
					message: "This item couldn’t be read.",
				},
			],
			[
				{
					code: "file-read-error",
					count: 2,
					message: "2 items couldn’t be read.",
				},
			],
		]);
	});

	it("rejects a loose file over maxBytes but never type-checks", async () =>
	{
		const big = new File(["12345"], "big.bin");
		const result = await collectDroppedFiles(
			[
				{
					file: big,
					entry: null,
				},
				loose("ok"),
			],
			{
				multiple: true,
				maxBytes: 4,
			},
		);

		expect(
			{
				accepted: accepted(result.accepted),
				rejections: result.rejections.map(({file, code, message}) => (
				{
					name: file.name,
					code,
					message,
				})),
			},
		).toStrictEqual(
			{
				accepted: [
					{
						name: "ok",
						relativePath: "",
					},
				],
				rejections: [
					{
						name: "big.bin",
						code: "file-too-large",
						message: "“big.bin” is too large.",
					},
				],
			},
		);
	});
});

describe("entriesFromDataTransfer (upstream cds ie)", () =>
{
	it("reads file items with their entries, and falls back to files without items", () =>
	{
		const a = text("a");
		const proj = entry(dir("proj", []), "");
		const items = [
			{
				kind: "string",
				getAsFile: () => null,
				webkitGetAsEntry: () => null,
			},
			{
				kind: "file",
				getAsFile: () => a,
				webkitGetAsEntry: () => proj,
			},
			{
				kind: "file",
				getAsFile: () => null,
			},
		];
		const b = text("b");

		expect([
			entriesFromDataTransfer(
				{
					items,
					files: [],
				},
			),
			entriesFromDataTransfer(
				{
					files: [b],
				},
			),
			entriesFromDataTransfer(
				{
					items: [],
					files: [b],
				},
			),
		]).toStrictEqual([
			[
				{
					file: a,
					entry: proj,
				},
				{
					file: null,
					entry: null,
				},
			],
			[
				{
					file: b,
					entry: null,
				},
			],
			[
				{
					file: b,
					entry: null,
				},
			],
		]);
	});
});

describe("splitDroppedItems (upstream zt)", () =>
{
	it("sorts directory items into folders and keeps the rest as files", () =>
	{
		const projFile = text("proj");
		const a = text("a.png");
		const items = [
			{
				kind: "file",
				getAsFile: () => projFile,
				webkitGetAsEntry: () => (
				{
					isDirectory: true,
				}),
			},
			{
				kind: "string",
				getAsFile: () => null,
			},
			{
				kind: "file",
				getAsFile: () => a,
				webkitGetAsEntry: () => (
				{
					isDirectory: false,
				}),
			},
			{
				kind: "file",
				getAsFile: () => null,
			},
		];
		const legacy = text("legacy");

		expect([splitDroppedItems(items, []), splitDroppedItems(undefined, [legacy])]).toStrictEqual([
			{
				folders: [projFile],
				files: [a],
			},
			{
				folders: [],
				files: [legacy],
			},
		]);
	});
});
