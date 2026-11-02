/**
 * Port of upstream's cds drop collector (claude.ai `cb4e4d5b7` `ie`/`oe`/`ce`/`le`) and the composer's items splitter
 * (`shared-l-p-m-w-2` `zt`). Decoded in .llm/upstream-sync/features/drop-folder-flatten.md.
 */

export type FolderHandling = "flatten" | "keep" | "reject";

/** The parts of a `FileSystemEntry` the walk reads; a directory adds `createReader`, a file adds `file`. */
export interface DroppedEntry
{
	readonly isFile: boolean;
	readonly isDirectory: boolean;
	readonly name: string;
	readonly fullPath: string;
	file?: (success: (file: File) => void, error?: (err: unknown) => void) => void;
	createReader?: () =>
	{
		readEntries: (success: (entries: DroppedEntry[]) => void, error?: (err: unknown) => void) => void;
	};
}

export interface DropEntry
{
	readonly file: File | null;
	readonly entry: DroppedEntry | null;
}

export interface DropItem<Entry = DroppedEntry>
{
	readonly kind: string;
	getAsFile: () => File | null;
	webkitGetAsEntry?: (() => Entry | null) | undefined;
}

export interface DropRejection
{
	readonly file: File;
	readonly code: "too-many-files" | "file-too-large";
	readonly message: string;
}

export type DropNotice =
	|
	  {
			readonly code: "folder-not-allowed" | "folder-too-large" | "folder-read-error" | "folder-empty";
			readonly message: string;
	  }
	|
	  {
			readonly code: "file-read-error";
			readonly count: number;
			readonly message: string;
	  };

export interface DroppedFolder
{
	readonly name: string;
	readonly file: File | null;
	readonly handling: FolderHandling;
}

export interface DropResult
{
	readonly accepted: File[];
	readonly rejections: DropRejection[];
	readonly notices: DropNotice[];
	readonly folders: DroppedFolder[];
}

export interface CollectOptions
{
	readonly multiple: boolean;
	readonly folders?: FolderHandling;
	readonly maxFiles?: number;
	readonly maxBytes?: number;
	readonly entryCap?: number;
	/** True for `<input type=file>` picks: their files aren't marked `entryless`. */
	readonly picked?: boolean;
}

const JUNK = new Set([".DS_Store", "Thumbs.db", "desktop.ini"]);
const isJunk = (name: string) => JUNK.has(name) || name.startsWith("._");
const ENTRY_CAP = 10_000;

function defineHidden(file: File, key: string, value: unknown)
{
	if (Reflect.get(file, key) !== value)
	{
		Object.defineProperty(
			file,
			key,
			{
				value,
				writable: false,
				configurable: true,
				enumerable: false,
			},
		);
	}
}

function withRelativePath(file: File, path: string): File
{
	defineHidden(file, "relativePath", path);
	return file;
}

/** Upstream's `ie`: one entry per file item, or every `files` member when there are no items. */
export function entriesFromDataTransfer(dt: {
	readonly items?: ArrayLike<DropItem> | null | undefined;
	readonly files?: ArrayLike<File> | null | undefined;
}): DropEntry[]
{
	const items = dt.items;
	if (items == null || items.length === 0)
		return Array.from(dt.files ?? [], (file) => (
		{
			file,
			entry: null,
		}));
	const entries: DropEntry[] = [];
	for (const item of Array.from(items))
	{
		if (item.kind !== "file") continue;
		const entry = typeof item.webkitGetAsEntry === "function" ? item.webkitGetAsEntry() : null;
		entries.push(
			{
				file: item.getAsFile(),
				entry,
			},
		);
	}
	return entries;
}

/** Upstream's `zt`: file items whose entry is a directory are folders; files without items pass through. */
export function splitDroppedItems(
	items:
		| ArrayLike<
				DropItem<
				{
					readonly isDirectory: boolean;
				}>
		  >
		| null
		| undefined,
	files: ArrayLike<File> | null | undefined,
):
{
	folders: File[];
	files: File[];
}
{
	const folders: File[] = [];
	const loose: File[] = [];
	if (items == null)
		return {
			folders,
			files: Array.from(files ?? []),
		};
	for (const item of Array.from(items))
	{
		if (item.kind !== "file") continue;
		const file = item.getAsFile();
		if (file === null) continue;
		(item.webkitGetAsEntry?.()?.isDirectory === true ? folders : loose).push(file);
	}
	return {
		folders,
		files: loose,
	};
}

class FolderReadError extends Error
{
	constructor(readonly path: string)
	{
		super(`Could not read the folder "${path}".`);
	}
}

/** Upstream's `I`: read a directory's batches until an empty one, keeping at most `limit + 1` entries. */
async function readDirectory(
	directory: DroppedEntry,
	limit: number,
	onError: (error: FolderReadError) => void,
): Promise<DroppedEntry[]>
{
	const reader = directory.createReader?.();
	if (reader === undefined) return [];
	return new Promise((resolve) =>
	{
		const read: DroppedEntry[] = [];
		const next = () =>
		{
			reader.readEntries(
				(batch) =>
				{
					for (const item of batch)
					{
						if (read.length > limit) break;
						read.push(item);
					}
					if (batch.length === 0 || read.length > limit)
					{
						resolve(read);
						return;
					}
					next();
				},
				() =>
				{
					onError(new FolderReadError(directory.fullPath));
					resolve(read);
				},
			);
		};
		next();
	});
}

/** Upstream's `ae`. */
async function readFile(entry: DroppedEntry): Promise<File>
{
	return new Promise((resolve, reject) =>
	{
		if (entry.file === undefined)
		{
			reject(new FolderReadError(entry.fullPath));
			return;
		}
		entry.file(resolve, () =>
		{
			reject(new FolderReadError(entry.fullPath));
		});
	});
}

interface WalkOutcome
{
	foundFiles: boolean;
	truncated: boolean;
	readFailure: FolderReadError | null;
}

/** Upstream's `oe`: depth-first walk sharing `counter.visited` (files and folders) across the whole drop. */
async function walkFolder(
	root: DroppedEntry,
	counter:
	{
		visited: number;
	},
	accept: (file: File) => boolean,
	cap: number,
): Promise<WalkOutcome>
{
	let foundFiles = false;
	let truncated = false;
	let stopped = false;
	const failures: FolderReadError[] = [];
	const walk = async (directory: DroppedEntry): Promise<void> =>
	{
		const remaining = cap - counter.visited;
		if (remaining < 0)
		{
			truncated = true;
			return;
		}
		const entries = await readDirectory(directory, remaining, (error) => failures.push(error));
		for (const entry of entries)
		{
			if (stopped) return;
			counter.visited += 1;
			if (counter.visited > cap)
			{
				truncated = true;
				return;
			}
			try
			{
				if (entry.isDirectory)
				{
					await walk(entry);
				}
				else if (entry.isFile)
				{
					if (isJunk(entry.name)) continue;
					foundFiles = true;
					stopped = !accept(withRelativePath(await readFile(entry), entry.fullPath.replace(/^\//, "")));
				}
			}
			catch (error)
			{
				if (!(error instanceof FolderReadError)) throw error;
				failures.push(error);
			}
		}
	};
	await walk(root);
	return {
		foundFiles,
		truncated,
		readFailure: failures[0] ?? null,
	};
}

const LABELS =
{
	foldersNotSupported: "Folders aren’t supported here.",
	folderTooLarge: "The folder “{name}” has too many items.",
	folderReadError: "There was a problem reading the folder “{name}”.",
	folderEmpty: "The folder “{name}” is empty.",
	itemUnreadable: "This item couldn’t be read.",
	itemsUnreadable: "{count} items couldn’t be read.",
	fileTooLarge: "“{name}” is too large.",
	noMoreFiles: "No more files can be added here.",
	onlyOneFile: "Only one file can be added here.",
	onlyNFiles: "Only {count} files can be added here.",
} as const;

function label(key: keyof typeof LABELS, values: Record<string, string | number> = {}): string
{
	return LABELS[key].replace(/\{(\w+)\}/g, (match, name: string) => String(values[name] ?? match));
}

/** Upstream's `ce`. */
function folderNotices(notices: DropNotice[], name: string, {foundFiles, truncated, readFailure}: WalkOutcome)
{
	if (truncated)
		notices.push(
			{
				code: "folder-too-large",
				message: label(
					"folderTooLarge",
					{
						name,
					},
				),
			},
		);
	if (readFailure !== null)
		notices.push(
			{
				code: "folder-read-error",
				message: label(
					"folderReadError",
					{
						name,
					},
				),
			},
		);
	if (!foundFiles && !truncated && readFailure === null)
	{
		notices.push(
			{
				code: "folder-empty",
				message: label(
					"folderEmpty",
					{
						name,
					},
				),
			},
		);
	}
}

function fileLimit(max: number | undefined): number | undefined
{
	return max === undefined || Number.isNaN(max) ? undefined : Math.max(0, Math.floor(max));
}

function tooManyMessage(limit: number): string
{
	if (limit === 0) return label("noMoreFiles");
	if (limit === 1) return label("onlyOneFile");
	return label(
		"onlyNFiles",
		{
			count: limit,
		},
	);
}

/**
 * Upstream's `le`: folders flatten (the default for a multi-file zone), are kept for the caller, or are rejected
 * (always, in a single-file zone). Files inside a folder skip the type check; locally no zone type-checks at all.
 */
export async function collectDroppedFiles(entries: readonly DropEntry[], options: CollectOptions): Promise<DropResult>
{
	const handling: FolderHandling = options.multiple ? (options.folders ?? "flatten") : "reject";
	const limit = fileLimit(options.multiple ? options.maxFiles : 1);
	const tooMany = limit === undefined ? "" : tooManyMessage(limit);
	const result: DropResult =
	{
		accepted: [],
		rejections: [],
		notices: [],
		folders: [],
	};
	const {accepted, rejections, notices} = result;
	const counter =
	{
		visited: 0,
	};
	// An object so the walk's accept callback can flip it without TypeScript narrowing the loop's read to `false`.
	const walkState =
	{
		full: false,
	};
	let pickedFolder: string | null = null;
	let pickedCount = 0;
	let unreadable = 0;

	const take = (file: File): boolean =>
	{
		if (options.maxBytes !== undefined && file.size > options.maxBytes)
		{
			rejections.push(
				{
					file,
					code: "file-too-large",
					message: label(
						"fileTooLarge",
						{
							name: file.name,
						},
					),
				},
			);
			return true;
		}
		if (limit !== undefined && accepted.length >= limit)
		{
			rejections.push(
				{
					file,
					code: "too-many-files",
					message: tooMany,
				},
			);
			return false;
		}
		accepted.push(file);
		return true;
	};

	for (const {file, entry} of entries)
	{
		if (entry?.isDirectory === true)
		{
			result.folders.push(
				{
					name: entry.name,
					file,
					handling,
				},
			);
			if (handling === "reject")
			{
				notices.push(
					{
						code: "folder-not-allowed",
						message: label("foldersNotSupported"),
					},
				);
				continue;
			}
			if (handling === "keep" || walkState.full) continue;
			try
			{
				const outcome = await walkFolder(
					entry,
					counter,
					(found) =>
					{
						walkState.full = !take(found);
						return !walkState.full;
					},
					options.entryCap ?? ENTRY_CAP,
				);
				folderNotices(notices, entry.name, outcome);
			}
			catch
			{
				notices.push(
					{
						code: "folder-read-error",
						message: label(
							"folderReadError",
							{
								name: entry.name,
							},
						),
					},
				);
			}
			continue;
		}
		if (file === null)
		{
			unreadable += 1;
			continue;
		}
		// jsdom's File has no webkitRelativePath.
		const relative = (file.webkitRelativePath as string | undefined) ?? "";
		if (relative !== "")
		{
			pickedFolder ??= relative.split("/")[0] ?? "";
			if (isJunk(file.name)) continue;
			pickedCount += 1;
			if (pickedCount > ENTRY_CAP) continue;
		}
		const named = withRelativePath(file, relative);
		if (options.picked !== true && entry === null) defineHidden(named, "entryless", true);
		take(named);
	}

	if (pickedFolder !== null)
	{
		folderNotices(
			notices,
			pickedFolder,
			{
				foundFiles: pickedCount > 0,
				truncated: pickedCount > ENTRY_CAP,
				readFailure: null,
			},
		);
	}
	if (unreadable > 0)
	{
		notices.push(
			{
				code: "file-read-error",
				count: unreadable,
				message:
					unreadable === 1
						? label("itemUnreadable")
						: label(
								"itemsUnreadable",
								{
									count: unreadable,
								},
							),
			},
		);
	}
	return result;
}
