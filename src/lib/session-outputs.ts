import {fuzzyMatchPath} from "./fuzzy-path";
import {asRecord} from "./narrow";

/** A file the session produced for the user, for the rail's Outputs card. */
export interface OutputFile
{
	/** Absolute path. */
	path: string;
	/** When the producing tool call was written, in ms. */
	at: number;
}

/** Upstream's deliverable extensions: a Write of one counts as an output wherever it lands. */
const DELIVERABLE_EXTENSIONS = new Set([
	"md",
	"markdown",
	"txt",
	"rtf",
	"pdf",
	"doc",
	"docx",
	"xls",
	"xlsx",
	"ppt",
	"pptx",
	"csv",
	"tsv",
	"html",
	"htm",
	"png",
	"jpg",
	"jpeg",
	"gif",
	"webp",
	"mp4",
	"mov",
	"webm",
	"mp3",
	"wav",
	"zip",
]);

const MAX_OUTPUT_FILES = 50;

function isDeliverable(path: string): boolean
{
	const name = path.slice(path.lastIndexOf("/") + 1);
	const dot = name.lastIndexOf(".");
	return dot > 0 && DELIVERABLE_EXTENSIONS.has(name.slice(dot + 1).toLowerCase());
}

function isOutside(path: string, cwd: string | null): boolean
{
	return cwd !== null && path !== cwd && !path.startsWith(`${cwd}/`);
}

function absolute(path: string, cwd: string | null): string | null
{
	if (path.startsWith("/")) return path;
	return cwd === null ? null : `${cwd}/${path.replace(/^\.\//, "")}`;
}

/** The paths a tool call produces as outputs: deliverable or out-of-tree Writes, and every sent file. */
function producedPaths(name: unknown, input: Record<string, unknown>, cwd: string | null): string[]
{
	if (name === "Write")
	{
		const raw = input["file_path"] ?? input["path"];
		const path = typeof raw === "string" ? absolute(raw, cwd) : null;
		return path !== null && (isDeliverable(path) || isOutside(path, cwd)) ? [path] : [];
	}
	if (name === "SendUserFile" && Array.isArray(input["files"]))
	{
		return input["files"]
			.map((file) => (typeof file === "string" ? absolute(file, cwd) : null))
			.filter((path) => path !== null);
	}
	return [];
}

/**
 * Upstream's Outputs files from the transcript: completed Writes of a
 * deliverable or outside the session cwd, plus SendUserFile paths. Newest
 * first, one entry per path at its newest write, at most 50.
 */
export function extractOutputFiles(
	records: readonly Readonly<Record<string, unknown>>[],
	cwd: string | null,
): OutputFile[]
{
	const pending = new Map<
		string,
		{
			paths: string[];
			at: number;
		}
	>();
	const newest = new Map<string, number>();
	for (const record of records)
	{
		const content = asRecord(record["message"])?.["content"];
		if (!Array.isArray(content)) continue;
		const timestamp = record["timestamp"];
		const at = typeof timestamp === "string" ? Date.parse(timestamp) : Number.NaN;
		for (const raw of content)
		{
			const block = asRecord(raw);
			const id = block?.["type"] === "tool_use" ? block["id"] : undefined;
			if (block !== undefined && typeof id === "string")
			{
				const paths = producedPaths(block["name"], asRecord(block["input"]) ?? {}, cwd);
				if (paths.length > 0 && !Number.isNaN(at))
					pending.set(
						id,
						{
							paths,
							at,
						},
					);
				continue;
			}
			const toolUseId = block?.["type"] === "tool_result" ? block["tool_use_id"] : undefined;
			if (typeof toolUseId !== "string") continue;
			const call = pending.get(toolUseId);
			pending.delete(toolUseId);
			if (call === undefined || block?.["is_error"] === true) continue;
			for (const path of call.paths)
			{
				newest.delete(path);
				newest.set(path, call.at);
			}
		}
	}
	return [...newest]
		.map(([path, at]) => (
		{
			path,
			at,
		}))
		.toReversed()
		.toSorted((left, right) => right.at - left.at)
		.slice(0, MAX_OUTPUT_FILES);
}

/** A file the `@` menu offers beside the workspace search: its absolute path and how the row shows it. */
export interface MentionOutputFile
{
	path: string;
	/** Relative to the cwd inside it, else `~/…` under the home directory, else absolute. */
	shownPath: string;
}

/** Upstream `TS`: longer assistant text blocks aren't scanned for paths. */
const MAX_SCANNED_TEXT = 50_000;
/** An absolute path with a dotted basename in assistant prose (upstream `Jr` + `Hn`). */
const TEXT_PATH = /(?<![\w/.~-])\/(?:[\w.@+~-]+\/)*[\w@+~-][\w.@+~-]*\.[A-Za-z0-9]+(?![\w/])/g;
/** Upstream `PS`: a path inside one of Claude's own worktrees. */
const WORKTREE_PATH = /\/\.claude\/worktrees\/[^/]+\//;

function baseName(path: string): string
{
	return path.slice(path.lastIndexOf("/") + 1);
}

function isInside(path: string, dir: string): boolean
{
	return path.startsWith(dir.endsWith("/") ? dir : `${dir}/`);
}

/**
 * Upstream's `@` outputs (c73f45bc3 `RS`/`LS` + cc43287c9 `rme`), from assistant records only: completed Writes,
 * SendUserFile paths and absolute paths named in assistant text up to 50 000 characters. A written path is dropped
 * when its basename is hidden, it lies in a `.claude/worktrees/<x>/` checkout, or it is inside the cwd without a
 * deliverable extension (normal file search finds those). Most recent first, once each, at most 50. On macOS
 * `/private/tmp` and `/private/var` read as `/tmp` and `/var`.
 */
export function mentionOutputFiles(
	records: readonly Readonly<Record<string, unknown>>[],
	cwd: string | null,
	home: string | null,
	darwin: boolean,
): MentionOutputFile[]
{
	const normalize = (path: string) => (darwin ? path.replace(/^\/private(?=\/(?:tmp|var)(?:\/|$))/, "") : path);
	const order = new Set<string>();
	const add = (raw: string, written: boolean) =>
	{
		const path = normalize(raw);
		const name = baseName(path);
		if (name === "" || name.startsWith(".")) return;
		if (
			written &&
			(WORKTREE_PATH.test(path) || (cwd !== null && isInside(path, normalize(cwd)) && !isDeliverable(path)))
		)
			return;
		order.delete(path);
		order.add(path);
	};
	const pending = new Map<string, string[]>();
	for (const record of records)
	{
		const content = asRecord(record["message"])?.["content"];
		if (!Array.isArray(content)) continue;
		const assistant = record["type"] === "assistant";
		for (const raw of content)
		{
			const block = asRecord(raw);
			if (block === undefined) continue;
			if (assistant && block["type"] === "text" && typeof block["text"] === "string")
			{
				if (block["text"].length <= MAX_SCANNED_TEXT)
					for (const match of block["text"].matchAll(TEXT_PATH)) add(match[0], false);
				continue;
			}
			if (assistant && block["type"] === "tool_use" && typeof block["id"] === "string")
			{
				const input = asRecord(block["input"]) ?? {};
				if (block["name"] === "Write")
				{
					const file = input["file_path"] ?? input["path"];
					const path = typeof file === "string" ? absolute(file, cwd) : null;
					if (path !== null) pending.set(block["id"], [`w:${path}`]);
				}
				else if (block["name"] === "SendUserFile")
				{
					pending.set(
						block["id"],
						producedPaths("SendUserFile", input, cwd).map((path) => `s:${path}`),
					);
				}
				continue;
			}
			const toolUseId = block["type"] === "tool_result" ? block["tool_use_id"] : undefined;
			if (typeof toolUseId !== "string") continue;
			const tagged = pending.get(toolUseId);
			pending.delete(toolUseId);
			if (tagged === undefined || block["is_error"] === true) continue;
			for (const entry of tagged) add(entry.slice(2), entry.startsWith("w:"));
		}
	}
	const shownCwd = cwd === null ? null : normalize(cwd);
	return [...order]
		.toReversed()
		.slice(0, MAX_OUTPUT_FILES)
		.map((path) => (
		{
			path,
			shownPath:
				shownCwd !== null && isInside(path, shownCwd)
					? path.slice(shownCwd.replace(/\/+$/, "").length + 1)
					: home !== null && isInside(path, home)
						? `~/${path.slice(home.replace(/\/+$/, "").length + 1)}`
						: path,
		}));
}

/**
 * Upstream `ys`: for a non-empty query, outputs whose basename fuzzy-matches and that the search didn't already
 * return join the results, and the union is re-ranked by full-path match and capped. When none ranks in, the search
 * results stand as they were.
 */
export function mergeMentionOutputs<
	E extends
	{
		name: string;
		relPath: string;
		isDirectory: boolean;
	},
>(
	query: string,
	results: readonly E[],
	outputs: readonly MentionOutputFile[],
	cap: number,
): (
	| E
	|
	  {
			name: string;
			relPath: string;
			isDirectory: false;
	  }
)[]
{
	if (query === "" || outputs.length === 0) return [...results];
	const known = new Set(results.map((entry) => entry.relPath));
	const extra = outputs
		.filter((output) => !known.has(output.shownPath) && fuzzyMatchPath(query, baseName(output.shownPath)) !== null)
		.map((output) => (
		{
			name: baseName(output.shownPath),
			relPath: output.shownPath,
			isDirectory: false as const,
		}));
	if (extra.length === 0) return [...results];
	const ranked = [...results, ...extra]
		.map((entry) => (
		{
			entry,
			score: fuzzyMatchPath(query, entry.relPath)?.score,
		}))
		.filter(
			(
				scored,
			): scored is
			{
				entry: E | (typeof extra)[number];
				score: number;
			} => scored.score !== undefined,
		)
		.toSorted((a, b) => b.score - a.score)
		.slice(0, cap)
		.map((scored) => scored.entry);
	const extras = new Set<unknown>(extra);
	return ranked.some((entry) => extras.has(entry)) ? ranked : [...results];
}

/** The home directory a local path lives under (`/Users/me` or `/home/me`), for `~/` shown paths. */
export function homeOf(path: string | null): string | null
{
	return /^\/(?:Users|home)\/[^/]+(?=\/|$)/.exec(path ?? "")?.[0] ?? null;
}
