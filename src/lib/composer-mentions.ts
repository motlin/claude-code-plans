/**
 * An accepted `@` file mention in the composer textarea: the `[start, end)` range
 * of its `@relPath` token (trailing space excluded). Upstream renders these as
 * atom chips; the textarea port tracks the ranges in memory instead.
 */
export type AcceptedMention = {start: number; end: number; relPath: string; isDirectory: boolean};

/**
 * Carry mention ranges across one textarea edit. The edit is taken as the single
 * span between the common prefix and suffix of `prev` and `next`. Ranges after
 * the span shift by the length change; ranges before it stay; a range the span
 * touches inside (or covers) is dropped. Insertion exactly at a range's end keeps
 * it (upstream: typing after the chip leaves it intact), and at its start shifts it.
 */
export function remapMentions(prev: string, next: string, mentions: readonly AcceptedMention[]): AcceptedMention[] {
	if (prev === next) return [...mentions];

	const maxPrefix = Math.min(prev.length, next.length);
	let prefix = 0;
	while (prefix < maxPrefix && prev[prefix] === next[prefix]) prefix++;

	const maxSuffix = maxPrefix - prefix;
	let suffix = 0;
	while (suffix < maxSuffix && prev[prev.length - 1 - suffix] === next[next.length - 1 - suffix]) suffix++;

	const spanStart = prefix;
	const spanEnd = prev.length - suffix;
	const delta = next.length - prev.length;

	const remapped: AcceptedMention[] = [];
	for (const mention of mentions) {
		if (spanStart >= mention.end) {
			remapped.push(mention);
		} else if (spanEnd <= mention.start) {
			remapped.push({...mention, start: mention.start + delta, end: mention.end + delta});
		}
	}
	return remapped;
}

/** The mention whose token strictly contains `caret` (the caret would be inside the chip). */
export function mentionAt(mentions: readonly AcceptedMention[], caret: number): AcceptedMention | undefined {
	return mentions.find((mention) => mention.start < caret && caret < mention.end);
}

/** The mention that ends exactly at `caret` (Backspace / ArrowLeft target). */
export function mentionEndingAt(mentions: readonly AcceptedMention[], caret: number): AcceptedMention | undefined {
	return mentions.find((mention) => mention.end === caret);
}

/** The mention that starts exactly at `caret` (Delete / ArrowRight target). */
export function mentionStartingAt(mentions: readonly AcceptedMention[], caret: number): AcceptedMention | undefined {
	return mentions.find((mention) => mention.start === caret);
}
