import {asRecord} from "./narrow";

/** A file the session produced for the user, for the rail's Outputs card. */
export interface OutputFile {
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

function isDeliverable(path: string): boolean {
	const name = path.slice(path.lastIndexOf("/") + 1);
	const dot = name.lastIndexOf(".");
	return dot > 0 && DELIVERABLE_EXTENSIONS.has(name.slice(dot + 1).toLowerCase());
}

function isOutside(path: string, cwd: string | null): boolean {
	return cwd !== null && path !== cwd && !path.startsWith(`${cwd}/`);
}

function absolute(path: string, cwd: string | null): string | null {
	if (path.startsWith("/")) return path;
	return cwd === null ? null : `${cwd}/${path.replace(/^\.\//, "")}`;
}

/** The paths a tool call produces as outputs: deliverable or out-of-tree Writes, and every sent file. */
function producedPaths(name: unknown, input: Record<string, unknown>, cwd: string | null): string[] {
	if (name === "Write") {
		const raw = input["file_path"] ?? input["path"];
		const path = typeof raw === "string" ? absolute(raw, cwd) : null;
		return path !== null && (isDeliverable(path) || isOutside(path, cwd)) ? [path] : [];
	}
	if (name === "SendUserFile" && Array.isArray(input["files"])) {
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
): OutputFile[] {
	const pending = new Map<string, {paths: string[]; at: number}>();
	const newest = new Map<string, number>();
	for (const record of records) {
		const content = asRecord(record["message"])?.["content"];
		if (!Array.isArray(content)) continue;
		const timestamp = record["timestamp"];
		const at = typeof timestamp === "string" ? Date.parse(timestamp) : Number.NaN;
		for (const raw of content) {
			const block = asRecord(raw);
			const id = block?.["type"] === "tool_use" ? block["id"] : undefined;
			if (block !== undefined && typeof id === "string") {
				const paths = producedPaths(block["name"], asRecord(block["input"]) ?? {}, cwd);
				if (paths.length > 0 && !Number.isNaN(at)) pending.set(id, {paths, at});
				continue;
			}
			const toolUseId = block?.["type"] === "tool_result" ? block["tool_use_id"] : undefined;
			if (typeof toolUseId !== "string") continue;
			const call = pending.get(toolUseId);
			pending.delete(toolUseId);
			if (call === undefined || block?.["is_error"] === true) continue;
			for (const path of call.paths) {
				newest.delete(path);
				newest.set(path, call.at);
			}
		}
	}
	return [...newest]
		.map(([path, at]) => ({path, at}))
		.toReversed()
		.toSorted((left, right) => right.at - left.at)
		.slice(0, MAX_OUTPUT_FILES);
}
