import {asRecord} from "./narrow";
import {buildFileHunks, type PatchHunk} from "./diff-utils";
import {FILE_CHANGE_PREVIEW_MAX_CHARS} from "./permission-card";

/**
 * What a Write/Edit would do to the file on disk (upstream's desktop `zu`): the notes it earns and, when
 * the file may be shown, the change as hunks at the file's real line numbers.
 */
export interface FileChangeAnalysis {
	matches?: number;
	/** The note holds whether or not a diff is drawn: no disk patch shows the replaced lines. */
	replacesFile?: true;
	/** Upstream's `diffShowsReplaced`: a Write's disk patch shows the replaced lines, so the note goes once it is drawn. */
	diffShowsReplaced?: true;
	lineEndingsChange?: true;
	alreadySo?: true;
	patch?: {hunks: PatchHunk[]; context: number};
}

/** Upstream's `ju`: one line of context around each change. */
const DISK_CONTEXT_LINES = 1;
/** Upstream's `Mu`: a file with a line this long gets no context. */
const LONG_LINE = /[^\n]{200}/;
/** Upstream's `Nu`: credential files whose contents the preview never draws. */
const SECRET_BASENAMES = new Set([".netrc", "_netrc", ".pgpass", ".htpasswd", ".npmrc", ".git-credentials", ".my.cnf"]);

function basename(path: string): string {
	return path.replace(/^.*[\\/]/, "");
}

/** Upstream's `Pu`, without its secret-redaction comparison (local has no redactor yet). */
function isSecretFile(path: string): boolean {
	const name = basename(path);
	return /^\.env|\.env(\.|$)/i.test(name) || SECRET_BASENAMES.has(name.toLowerCase());
}

function count(text: string, part: string): number {
	return text.split(part).length - 1;
}

/** Upstream's `Fu`: the file's line-ending style. */
function lineEndings(text: string): "lf" | "crlf" | "mixed" {
	const crlf = count(text, "\r\n");
	return crlf === 0 ? "lf" : crlf === count(text, "\n") ? "crlf" : "mixed";
}

/** Upstream's `Iu`: deleting a whole line (no trailing newline in old) takes its newline with it. */
function deletedLineMatch(text: string, oldString: string, newString: string): string {
	if (newString !== "" || oldString.endsWith("\n")) return oldString;
	return [`${oldString}\n`, `${oldString}\r\n`].find((candidate) => text.includes(candidate)) ?? oldString;
}

function newlines(text: string): string[] {
	return text.match(/\r?\n/g) ?? [];
}

/** Upstream's `Ru`: whether the change alters any newline outside the lines it rewrites. */
function changesLineEndings(before: string, after: string, hunks: readonly PatchHunk[]): boolean {
	if (lineEndings(before) !== lineEndings(after)) return true;
	const oldEnds = newlines(before);
	const newEnds = newlines(after);
	let oldIndex = 0;
	let newIndex = 0;
	const skipEqual = (length: number) => {
		for (const end = oldIndex + length; oldIndex < end; oldIndex += 1, newIndex += 1) {
			if (oldEnds[oldIndex] !== newEnds[newIndex]) return true;
		}
		return false;
	};
	for (const hunk of hunks) {
		if (skipEqual(hunk.oldStart - 1 - oldIndex)) return true;
		let removed: (string | undefined)[] = [];
		for (const line of hunk.lines) {
			if (line.startsWith("-")) {
				removed.push(oldEnds[oldIndex]);
				oldIndex += 1;
			} else if (line.startsWith("+")) {
				const was = removed.shift();
				const now = newEnds[newIndex];
				if (was !== undefined && now !== undefined && was !== now) return true;
				newIndex += 1;
			} else if (line.startsWith(" ")) {
				removed = [];
				if (skipEqual(1)) return true;
			}
		}
	}
	return skipEqual(Math.min(oldEnds.length - oldIndex, newEnds.length - newIndex));
}

function stringField(input: Record<string, unknown>, key: string): string | undefined {
	const value = input[key];
	return typeof value === "string" ? value : undefined;
}

function compact(analysis: {
	matches: number | undefined;
	replacesFile?: boolean;
	diffShowsReplaced?: boolean;
	lineEndingsChange?: boolean;
	alreadySo?: boolean;
	patch?: FileChangeAnalysis["patch"];
}): FileChangeAnalysis {
	return {
		...(analysis.matches === undefined ? {} : {matches: analysis.matches}),
		...(analysis.replacesFile === true ? {replacesFile: true as const} : {}),
		...(analysis.diffShowsReplaced === true ? {diffShowsReplaced: true as const} : {}),
		...(analysis.lineEndingsChange === true ? {lineEndingsChange: true as const} : {}),
		...(analysis.alreadySo === true ? {alreadySo: true as const} : {}),
		...(analysis.patch === undefined ? {} : {patch: analysis.patch}),
	};
}

/** Line endings normalised for the line diff, so an ending-only change has no hunks (upstream's `vn`). */
function diffText(text: string): string {
	return text.replaceAll("\r\n", "\n");
}

/** Upstream's `zu`: a Write or Edit measured against the file's text on disk. */
export function analyzeFileChange(name: string, input: Record<string, unknown>, fileText: string): FileChangeAnalysis {
	const isWrite = name === "Write";
	const oldString = stringField(input, "old_string");
	const newString = stringField(input, "new_string");
	const content = stringField(input, "content");
	const replaceAll = input["replace_all"] === true;
	const text = fileText.replace(/^﻿/u, "");
	const match =
		oldString !== undefined && newString !== undefined && oldString !== ""
			? deletedLineMatch(text, oldString, newString)
			: undefined;
	let next: string | undefined;
	if (isWrite && content !== undefined) next = content;
	else if (match !== undefined && text.includes(match)) {
		const replacement = String(newString);
		next = replaceAll ? text.split(match).join(replacement) : text.replace(match, () => replacement);
	}
	const found = replaceAll && match !== undefined ? count(text, match) : 0;
	const matches = found > 0 ? found : undefined;
	const base = {
		matches,
		replacesFile: isWrite,
		lineEndingsChange: isWrite && next !== undefined && changesLineEndings(text, next, []),
	};
	if (
		next === undefined ||
		text.length > FILE_CHANGE_PREVIEW_MAX_CHARS ||
		next.length > FILE_CHANGE_PREVIEW_MAX_CHARS ||
		isSecretFile(String(input["file_path"]))
	) {
		return compact(base);
	}
	const context = LONG_LINE.test(text) ? 0 : DISK_CONTEXT_LINES;
	const hunks = buildFileHunks(diffText(text), diffText(next), context);
	if (hunks.length === 0) {
		return text === next ? compact({matches, alreadySo: true}) : compact({...base, lineEndingsChange: true});
	}
	return compact({
		matches,
		diffShowsReplaced: isWrite,
		lineEndingsChange: isWrite
			? changesLineEndings(text, next, hunks)
			: oldString !== undefined && newString !== undefined && changesLineEndings(oldString, newString, []),
		patch: {hunks, context},
	});
}

/**
 * Upstream's `mw` (was `ux`): the disk note, or null when the file earns none. "Replaces the existing file." holds
 * for a Write with no disk patch, and for one with a patch only until its diff is drawn (`diffShown`).
 */
export function fileChangeNote(analysis: FileChangeAnalysis, diffShown: boolean): string | null {
	if (analysis.alreadySo === true) return "The file already holds this, so nothing would change.";
	const parts = [
		analysis.matches === undefined
			? null
			: analysis.matches === 1
				? "Replaces 1 match in the file."
				: `Replaces all ${analysis.matches} matches in the file.`,
		analysis.replacesFile === true || (analysis.diffShowsReplaced === true && !diffShown)
			? "Replaces the existing file."
			: null,
		analysis.lineEndingsChange === true ? "Also changes line endings." : null,
	].filter((part) => part !== null);
	return parts.length > 0 ? parts.join(" ") : null;
}

/** The file read behind a preview: not read (or nothing to compare), unreadable, or read and measured. */
export type FileChangeRead = {kind: "none"} | {kind: "unreadable"} | {kind: "read"; analysis: FileChangeAnalysis};

/** Upstream's `Tu`/`mh.unreadable` copy. */
const UNREADABLE_FILE_NOTE = "Couldn’t check this file, so this shows only what Claude sent.";

/** Upstream's `cx` note: unreadable says so (unless the copy has a note); else the disk note over the copy's. */
export function shownFileChangeNote(read: FileChangeRead, copyNote: string | null, diffShown: boolean): string | null {
	if (read.kind === "unreadable") return copyNote ?? UNREADABLE_FILE_NOTE;
	return (read.kind === "read" ? fileChangeNote(read.analysis, diffShown) : null) ?? copyNote;
}

export interface PlainFileChangePart {
	label?: string;
	text: string;
}

/**
 * Upstream's `dw`: a Write's content as one unlabelled part; an Edit's (or each MultiEdit edit's) old and new text
 * as "Removed text" then "Added text". Empty texts are dropped.
 */
export function plainFileChangeParts(name: string, input: Record<string, unknown>): PlainFileChangePart[] {
	if (name === "Write") return [{text: String(input["content"])}];
	const edits: unknown[] = name !== "Edit" && Array.isArray(input["edits"]) ? input["edits"] : [input];
	return edits
		.flatMap((edit) => {
			const record = asRecord(edit);
			return record === undefined
				? []
				: [
						{label: "Removed text", text: String(record["old_string"])},
						{label: "Added text", text: String(record["new_string"])},
					];
		})
		.filter(({text}) => text !== "");
}
