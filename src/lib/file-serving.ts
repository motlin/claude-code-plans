import type {Stats} from "node:fs";
import {readFile, realpath, stat} from "node:fs/promises";
import {isAbsolute, join, relative, resolve, sep} from "node:path";
import type {FileRefStatus} from "./api/file-refs";
import {resolveConfiguredFileRoots} from "./config";
import {FILE_CONTENT_SIZE_CAP_BYTES} from "./db/indexer";
import {fileTypeLabel} from "./file-preview";
import {isLossyDecode, realpathOfExistingPrefix} from "./session-file-write";

const BINARY_SAMPLE_SIZE_BYTES = 512;

/** Why a readable file has no text preview, with what the viewer shows instead. */
export interface PreviewUnavailable
{
	kind: "binary" | "too-large";
	size: number;
	type: string;
}

export class FileServingError extends Error
{
	constructor(
		message: string,
		readonly status: number,
		readonly preview?: PreviewUnavailable,
	)
	{
		super(message);
		this.name = "FileServingError";
	}
}

export interface ServedFile
{
	content: string;
	/** Decoding replaced invalid UTF-8 with U+FFFD, so writing the content back would lose bytes. */
	lossy: boolean;
	/** The stat mtime, which the save APIs' `mtimeEtag` is derived from. */
	modifiedAt: Date;
	modifiedAtMilliseconds: number;
	path: string;
	sizeBytes: number;
}

function isContainedPath(path: string, root: string): boolean
{
	const relativePath = relative(root, path);
	return (
		relativePath === "" ||
		(relativePath !== ".." && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath))
	);
}

export interface ReadTextOptions
{
	/** Skip the binary sniff, for the viewer's "View as text anyway". */
	forceText?: boolean;
}

/** Read one allow-listed regular text file after resolving every filesystem boundary. */
export async function readAllowedFile(
	requestedPath: string,
	configPath?: string,
	defaultRoots: readonly string[] = [],
	options: ReadTextOptions = {},
): Promise<ServedFile>
{
	return readResolvedTextFile(await resolveAllowedPath(requestedPath, configPath, defaultRoots), options);
}

export interface AllowedFileStat
{
	modifiedAtMilliseconds: number;
	path: string;
	sizeBytes: number;
}

/** Resolve and stat one allow-listed regular file without reading it, for streaming. */
export async function statAllowedFile(
	requestedPath: string,
	configPath?: string,
	defaultRoots: readonly string[] = [],
): Promise<AllowedFileStat>
{
	const resolvedPath = await resolveAllowedPath(requestedPath, configPath, defaultRoots);
	const fileStat = await statRegularFile(resolvedPath);
	return {
		modifiedAtMilliseconds: fileStat.mtimeMs,
		path: resolvedPath,
		sizeBytes: fileStat.size,
	};
}

/**
 * Resolve one existing allow-listed path, file or directory, symlinks
 * included, for Show in Finder, which upstream allows on folders too.
 * `appRoots` (folders the app writes itself) are allowed on top of the file roots.
 */
export async function resolveAllowedEntry(
	requestedPath: string,
	configPath?: string,
	defaultRoots: readonly string[] = [],
	appRoots: readonly string[] = [],
): Promise<string>
{
	const resolvedAppRoots = await Promise.all(appRoots.map(async (root) => realpath(root).catch(() => null)));
	return resolveUnderRoots(requestedPath, [
		...(await resolveConfiguredFileRoots(configPath, defaultRoots)),
		...resolvedAppRoots.filter((root) => root !== null),
	]);
}

/**
 * For each path, whether it names a regular file inside the allowed roots
 * (`exists`), names nothing readable there (`missing`), or resolves outside
 * every root, symlinks included (`outside`). The roots are resolved once for
 * the whole batch.
 */
export async function fileRefStatuses(
	requestedPaths: readonly string[],
	configPath?: string,
	defaultRoots: readonly string[] = [],
): Promise<FileRefStatus[]>
{
	const roots = await resolveConfiguredFileRoots(configPath, defaultRoots);
	return Promise.all(
		requestedPaths.map(async (requestedPath): Promise<FileRefStatus> =>
		{
			if (!isAbsolute(requestedPath)) return "outside";
			const resolvedPath = await realpathOfExistingPrefix(resolve(requestedPath));
			if (!roots.some((root) => isContainedPath(resolvedPath, root))) return "outside";
			try
			{
				return (await stat(resolvedPath)).isFile() ? "exists" : "missing";
			}
			catch
			{
				return "missing";
			}
		}),
	);
}

async function resolveAllowedPath(
	requestedPath: string,
	configPath: string | undefined,
	defaultRoots: readonly string[],
): Promise<string>
{
	return resolveUnderRoots(requestedPath, await resolveConfiguredFileRoots(configPath, defaultRoots));
}

async function resolveUnderRoots(requestedPath: string, roots: readonly string[]): Promise<string>
{
	if (!isAbsolute(requestedPath))
	{
		throw new FileServingError("An absolute file path is required", 400);
	}

	let resolvedPath: string;
	try
	{
		resolvedPath = await realpath(requestedPath);
	}
	catch
	{
		throw new FileServingError("File not found", 404);
	}

	if (!roots.some((root) => isContainedPath(resolvedPath, root)))
	{
		throw new FileServingError("File path is not allowed", 403);
	}
	return resolvedPath;
}

/**
 * Read one regular text file named by a path relative to `root`. Absolute
 * paths and `..` segments are refused outright, and the fully resolved path
 * (after symlinks) must still sit inside the resolved root.
 */
export async function readFileUnderRoot(root: string, relativePath: string): Promise<ServedFile>
{
	const segments = relativePath.split(/[/\\]/);
	if (
		relativePath === "" ||
		isAbsolute(relativePath) ||
		relativePath.includes("\0") ||
		segments.some((segment) => segment === "..")
	)
	{
		throw new FileServingError("A relative path inside the root is required", 400);
	}

	let resolvedRoot: string;
	let resolvedPath: string;
	try
	{
		resolvedRoot = await realpath(root);
		resolvedPath = await realpath(join(resolvedRoot, relativePath));
	}
	catch
	{
		throw new FileServingError("File not found", 404);
	}
	if (!isContainedPath(resolvedPath, resolvedRoot))
	{
		throw new FileServingError("File path is not allowed", 403);
	}

	return readResolvedTextFile(resolvedPath);
}

async function statRegularFile(resolvedPath: string): Promise<Stats>
{
	let fileStat: Stats;
	try
	{
		fileStat = await stat(resolvedPath);
	}
	catch
	{
		throw new FileServingError("File not found", 404);
	}
	if (!fileStat.isFile())
	{
		throw new FileServingError("File path is not a regular file", 403);
	}
	return fileStat;
}

function tooLarge(resolvedPath: string, size: number): FileServingError
{
	return new FileServingError(
		"File exceeds the 5 MiB size limit",
		413,
		{
			kind: "too-large",
			size,
			type: fileTypeLabel(resolvedPath),
		},
	);
}

async function readResolvedTextFile(resolvedPath: string, options: ReadTextOptions = {}): Promise<ServedFile>
{
	const fileStat = await statRegularFile(resolvedPath);
	if (fileStat.size > FILE_CONTENT_SIZE_CAP_BYTES) throw tooLarge(resolvedPath, fileStat.size);

	let contents: Buffer;
	try
	{
		contents = await readFile(resolvedPath);
	}
	catch
	{
		throw new FileServingError("File not found", 404);
	}
	if (contents.byteLength > FILE_CONTENT_SIZE_CAP_BYTES)
	{
		throw tooLarge(resolvedPath, contents.byteLength);
	}
	if (!options.forceText && contents.subarray(0, BINARY_SAMPLE_SIZE_BYTES).includes(0))
	{
		throw new FileServingError(
			"Binary files are not supported",
			415,
			{
				kind: "binary",
				size: contents.byteLength,
				type: fileTypeLabel(resolvedPath),
			},
		);
	}

	const content = contents.toString("utf8");
	return {
		content,
		lossy: isLossyDecode(contents, content),
		modifiedAt: fileStat.mtime,
		modifiedAtMilliseconds: fileStat.mtimeMs,
		path: resolvedPath,
		sizeBytes: fileStat.size,
	};
}
