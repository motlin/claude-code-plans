import {markdownToPlainText} from "./markdown-plain-text";
import {stripCommandTags} from "./session-utils";
import {narrationProse} from "./thinking-narration";
import type {MessageSessionLine, SessionLine} from "./transcript";

/** Upstream's pin title length (`tk`). */
const CHAPTER_TITLE_LIMIT = 40;

/** What a "Pin as chapter" adds: the pinned message, the chapter's title and the message's record index. */
export interface ChapterPin {
	afterId: string;
	title: string;
	recordIndex: number;
}

/** The existing transcript heading excerpt, shared with its action trigger. */
export function messageHeading(speaker: "user" | "assistant", text: string): string {
	const prefix = speaker === "user" ? "You said" : "Claude responded";
	const preview = text.replace(/\s+/g, " ").trim().slice(0, 80);
	return preview === "" ? prefix : `${prefix}: ${preview}`;
}

/** A message's text and narration blocks as written, joined by blank lines; empty for tool-only turns. */
export function messageText(line: MessageSessionLine): string {
	const content = line.message?.content;
	if (!content) return "";
	if (typeof content === "string") return stripCommandTags(content);
	return content
		.flatMap((block) => {
			if (block.type === "text" && typeof block.text === "string") return [block.text];
			const narration = narrationProse(block);
			return narration === null ? [] : [narration];
		})
		.join("\n\n");
}

function findMessage(lines: readonly SessionLine[], uuid: string): MessageSessionLine | undefined {
	return lines.find(
		(line): line is MessageSessionLine => (line.type === "user" || line.type === "assistant") && line.uuid === uuid,
	);
}

/**
 * The message a "Fork from here" resumes at. An assistant turn keeps itself;
 * a prompt forks from the turn before it, so the fork waits at the prompt
 * instead of replaying it unanswered. A message the page has not loaded, or
 * the session's first prompt, forks at its own uuid.
 */
export function forkPointFor(lines: readonly SessionLine[], uuid: string): string {
	const line = findMessage(lines, uuid);
	if (line?.type === "user" && line.parentUuid !== undefined) return line.parentUuid;
	return uuid;
}

/** Upstream's pin title (`ik`): the first non-empty line, trimmed and cut at 40 characters, with an ellipsis when it was longer. */
export function chapterTitle(text: string): string {
	const line = (text.split("\n").find((part) => part.trim().length > 0) ?? text).trim();
	const title = line.slice(0, CHAPTER_TITLE_LIMIT);
	return line.length > CHAPTER_TITLE_LIMIT ? `${title}…` : title;
}

/** The chapter a "Pin as chapter" on this message would add, or null when the page does not hold it. */
export function chapterFor(lines: readonly SessionLine[], uuid: string): ChapterPin | null {
	const line = findMessage(lines, uuid);
	if (line === undefined) return null;
	const text = line.type === "assistant" ? markdownToPlainText(messageText(line)) : messageText(line);
	const title = chapterTitle(text);
	return {afterId: uuid, title: title === "" ? "Tool calls" : title, recordIndex: line.lineIndex};
}
