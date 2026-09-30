import type {Chapter} from "./chapter-store";
import {markdownToPlainText} from "./markdown-plain-text";
import {stripCommandTags} from "./session-utils";
import type {MessageSessionLine, SessionLine} from "./transcript";

/** Upstream-length chapter chip labels; longer first lines are clipped with an ellipsis. */
const CHAPTER_LABEL_LIMIT = 60;

/** A message's text blocks as written, joined by blank lines; empty for tool-only turns. */
export function messageText(line: MessageSessionLine): string {
	const content = line.message?.content;
	if (!content) return "";
	if (typeof content === "string") return stripCommandTags(content);
	return content
		.flatMap((block) => (block.type === "text" && typeof block.text === "string" ? [block.text] : []))
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

function clip(text: string): string {
	if (text.length <= CHAPTER_LABEL_LIMIT) return text;
	return `${text.slice(0, CHAPTER_LABEL_LIMIT - 1).trimEnd()}…`;
}

/** The chapter a "Pin as chapter" on this message would add, or null when the page does not hold it. */
export function chapterFor(lines: readonly SessionLine[], uuid: string): Chapter | null {
	const line = findMessage(lines, uuid);
	if (line === undefined) return null;
	const text = line.type === "assistant" ? markdownToPlainText(messageText(line)) : messageText(line);
	const firstLine = text
		.split("\n")
		.map((part) => part.trim())
		.find((part) => part !== "");
	return {uuid, label: firstLine === undefined ? "Tool calls" : clip(firstLine), recordIndex: line.lineIndex};
}
