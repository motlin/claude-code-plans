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

const URL_PATTERN = /https?:\/\/\S+/g;

const TRAILING_PUNCTUATION = /[.,;:!?)\]}'"]+$/;

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
		const url = match[0].replace(TRAILING_PUNCTUATION, "");
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
