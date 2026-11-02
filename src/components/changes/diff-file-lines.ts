import type {FileDiffLoadedFiles, FileDiffMetadata} from "@pierre/diffs";
import type {WholeFileState} from "./diff-file-menu";

/*
 * The Changes pane's lazy full-file loader, ported from claude.ai/code's c44d00c7f: line counting `pa`, side
 * validation `ma`, the retry loop `bd`, the comment rule `Id`/`Nd` and the whole-file menu state.
 */

/** Both sides of a diff file as the server read them; a side is null when it couldn't be read. */
export interface FileSides
{
	oldText: string | null;
	newText: string | null;
}

/** Upstream `pa`: `""` has no lines, and a trailing newline ends the last line rather than starting another. */
export function countFileLines(text: string): number
{
	if (text === "") return 0;
	let newlines = 0;
	for (let index = text.indexOf("\n"); index !== -1; index = text.indexOf("\n", index + 1)) newlines++;
	return text.endsWith("\n") ? newlines : newlines + 1;
}

/** Pierre's `getHunkSideEndBoundary` (upstream `Li`): the last file line a hunk side consumes. */
function hunkSideEnd(start: number, count: number): number
{
	return start - (count === 0 ? 0 : 1) + count;
}

/**
 * Upstream `ma`: the loaded sides as pierre's `loadDiffFiles` result, `"unavailable"` when a needed side is missing,
 * or `"drifted"` when the files changed since the patch (the lines after the last hunk differ in number).
 */
export function toLoadedFiles(
	fileDiff: FileDiffMetadata,
	file:
	{
		path: string;
		oldPath?: string | undefined;
	},
	sides: FileSides,
): FileDiffLoadedFiles | "unavailable" | "drifted"
{
	const {newText, oldText} = sides;
	if (newText === null) return "unavailable";
	const newFile =
	{
		name: file.path,
		contents: newText,
	};
	if (fileDiff.type === "rename-pure")
		return {
			oldFile: null,
			newFile,
		};
	if (oldText === null) return "unavailable";
	const last = fileDiff.hunks.at(-1);
	if (last !== undefined)
	{
		const newTail = countFileLines(newText) - hunkSideEnd(last.additionStart, last.additionCount);
		const oldTail = countFileLines(oldText) - hunkSideEnd(last.deletionStart, last.deletionCount);
		if (newTail < 0 || oldTail < 0 || newTail !== oldTail) return "drifted";
	}
	return {
		oldFile:
		{
			name: file.oldPath ?? file.path,
			contents: oldText,
		},
		newFile,
	};
}

/** Upstream `yd`: how long `bd` waits before each retry of an unreadable file. */
export const RETRY_DELAYS: readonly number[] = [2000, 4000, 30_000, 30_000, 60_000];

/** One load attempt: the files, or why not (`again` = rerun now, `retry` = back off, `park` = stop). */
export type LoadAttemptResult = FileDiffLoadedFiles | "unavailable" | "drifted" | "again" | "retry" | "park";

/**
 * Upstream `bd`: runs `attempt` until it yields files, passing `fresh` on every retry. `again` reruns at once,
 * `unavailable`/`retry` (or a throw) back off through {@link RETRY_DELAYS}, and `drifted`/`park` or running out of
 * delays calls `onGiveUp` and returns a promise that never settles, so pierre neither hydrates nor logs an error.
 */
export async function loadWithRetry(
	attempt: (fresh: boolean) => Promise<LoadAttemptResult>,
	onGiveUp: () => void,
): Promise<FileDiffLoadedFiles>
{
	let retries = 0;
	for (;;)
	{
		const result = await attempt(retries > 0).catch((): LoadAttemptResult => "retry");
		if (result === "again") continue;
		if (typeof result !== "string") return result;
		const parked = result === "drifted" || result === "park";
		const delay = parked ? undefined : RETRY_DELAYS[retries++];
		if (delay === undefined)
		{
			onGiveUp();
			return new Promise<never>(() =>
			{
				// Never settles: pierre keeps the diff partial and logs nothing.
			});
		}
		await new Promise((resolve) =>
		{
			setTimeout(resolve, delay);
		});
	}
}

/** A comment's place in the diff: its side and the line its card sits under. */
export interface CommentLine
{
	side: "additions" | "deletions";
	line: number;
}

/** Upstream `Nd`: whether a hunk of the diff shows this line on this side. */
export function lineInHunks(fileDiff: FileDiffMetadata, side: CommentLine["side"], line: number): boolean
{
	return fileDiff.hunks.some((hunk) =>
	{
		const start = side === "additions" ? hunk.additionStart : hunk.deletionStart;
		const count = side === "additions" ? hunk.additionCount : hunk.deletionCount;
		return line >= start && line < start + count;
	});
}

/**
 * Upstream `Id`: a saved or draft comment sits on a line outside every hunk, so the whole file must show for it to
 * render on its own line. Local comments outside the hunks are the ones `commentAnnotations` displaces, so this one
 * test covers upstream's displaced branch (`Fd`) too; local comments carry no persisted outdated flag to exclude.
 */
export function commentsNeedWholeFile(fileDiff: FileDiffMetadata, comments: readonly CommentLine[]): boolean
{
	return comments.some((comment) => !lineInHunks(fileDiff, comment.side, comment.line));
}

/** Upstream `Fo`'s `wholeFile` for one file: undefined when the toggle isn't offered (`rf`). */
export function wholeFileState({
	offered,
	hasHunks,
	status,
	loaderGaveUp,
	shown,
	locked,
}: {
	offered: boolean;
	hasHunks: boolean;
	status: "added" | "deleted" | "modified" | "renamed";
	loaderGaveUp: boolean;
	shown: boolean;
	locked: boolean;
}): WholeFileState | undefined
{
	if (!offered || !hasHunks || status === "added" || status === "deleted") return undefined;
	if (loaderGaveUp) return "unread";
	if (shown) return locked ? "locked" : "shown";
	return "folded";
}
