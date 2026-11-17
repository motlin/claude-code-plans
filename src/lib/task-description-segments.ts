import {normalizeArtifactUrl} from "./artifact-output";

/** The word "artifact" or "artifacts" a task description links to an artifact URL. */
export interface ArtifactWordLink
{
	word: string;
	href: string;
}

export type TaskDescriptionSegment = string | ArtifactWordLink;

/** Upstream's `sj`: the description text before a URL ends in the word "artifact(s)". */
const ARTIFACT_WORD_BEFORE = /\b(artifacts?)\s+$/i;

/** Upstream's `Cu`: a URL runs until whitespace, `<`, `>` or `"`. */
const URL_PATTERN = /https?:\/\/[^\s<>"]+/g;

/** Upstream's `ht` (`KG`): invisible, control, bidi-override and placeholder characters. */
const INVISIBLE_CHARS = /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}\u2800\uFFFC]/u;

function count(text: string, char: string): number
{
	return text.split(char).length - 1;
}

/** Upstream's `Du`: drop one trailing `[.,;:!?]`, then each trailing `)` with no matching `(`. */
function trimUrl(match: string): string
{
	let url = /[.,;:!?]$/.test(match) ? match.slice(0, -1) : match;
	while (url.endsWith(")") && count(url, ")") > count(url, "(")) url = url.slice(0, -1);
	return url;
}

/** Upstream's `uj`: task types whose descriptions never get artifact links. */
const PLAIN_TASK_TYPES = new Set(["local_bash"]);

/**
 * Upstream's `dj`: a task description split into text and `{word, href}` links, where the word
 * "artifact" (or "artifacts") right before an artifact URL becomes the link and the URL is dropped.
 * Undefined for `local_bash` tasks and for descriptions where no link was made.
 */
export function taskDescriptionSegments(
	description: string,
	taskType: string | null,
): TaskDescriptionSegment[] | undefined
{
	if ((taskType !== null && PLAIN_TASK_TYPES.has(taskType)) || !description.includes("://")) return undefined;
	let segments: TaskDescriptionSegment[] | undefined;
	let pending = "";
	let cursor = 0;
	for (const match of description.matchAll(URL_PATTERN))
	{
		const url = trimUrl(match[0]);
		const artifact = normalizeArtifactUrl(url);
		if (artifact === undefined) continue;
		pending += description.slice(cursor, match.index);
		cursor = match.index + url.length;
		const word = ARTIFACT_WORD_BEFORE.exec(pending);
		if (word === null)
		{
			pending += url;
			continue;
		}
		segments ??= [];
		const before = pending.slice(0, word.index);
		if (before !== "") segments.push(before);
		segments.push(
			{
				word: word[1] ?? "",
				href: url,
			},
		);
		pending = "";
	}
	if (segments === undefined) return undefined;
	pending += description.slice(cursor);
	if (pending !== "") segments.push(pending);
	return segments;
}

/** Upstream's `NA`: the segments' plain text, with link words kept and URLs dropped. */
export function plainSegmentsText(segments: readonly TaskDescriptionSegment[]): string
{
	return segments.map((segment) => (typeof segment === "string" ? segment : segment.word)).join("");
}

/** Whether text holds a character upstream's `ht` refuses in a step label. */
function hasInvisibleChars(text: string): boolean
{
	return INVISIBLE_CHARS.test(text);
}

/**
 * Upstream's `Pme` guard on a lone in-group task step: the description's link segments, or
 * undefined when the description holds an invisible character. Every text segment and href is
 * a slice of the description, so checking it covers upstream's per-segment checks.
 */
export function stepDescriptionSegments(
	description: string,
	taskType: string | null,
): TaskDescriptionSegment[] | undefined
{
	return hasInvisibleChars(description) ? undefined : taskDescriptionSegments(description, taskType);
}
