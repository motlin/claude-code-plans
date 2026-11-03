import {parseTaskNotification, type TaskNotification} from "./background-tasks";
import {asRecord} from "./narrow";
import type {MessageSessionLine, SessionLine} from "./transcript";

/** A user line's text blocks, joined and trimmed. */
export function userText(line: MessageSessionLine): string {
	const content = line.message?.content;
	if (content === undefined) return "";
	if (typeof content === "string") return content;
	return content
		.flatMap((block) => (block.type === "text" ? [block.text] : []))
		.join("\n")
		.trim();
}

function queuedPrompt(attachmentJson: string): string | null {
	try {
		const record = asRecord(JSON.parse(attachmentJson));
		const prompt = record?.["prompt"];
		return record?.["type"] === "queued_command" && typeof prompt === "string" ? prompt : null;
	} catch {
		return null;
	}
}

/**
 * The finished background task a line announces, or null for any other line.
 * A notification queued while the turn ran arrives as a queued_command
 * attachment instead of a user line.
 */
export function taskNotificationOf(line: SessionLine): TaskNotification | null {
	if (line.type === "attachment") {
		const prompt = queuedPrompt(line.attachmentJson);
		return prompt === null ? null : parseTaskNotification(prompt);
	}
	if (line.type !== "user") return null;
	return parseTaskNotification(userText(line));
}

/**
 * The completed background Agent a user record's notification reports, which
 * upstream draws as "<done description> · took Ns" with no bubble.
 */
export function agentCompletionOf(line: SessionLine): TaskNotification | null {
	if (line.type !== "user") return null;
	const notification = taskNotificationOf(line);
	return notification?.status === "completed" && notification.agent ? notification : null;
}

/**
 * The task notification that folds into the tool run beside it as a notice
 * (upstream `gN` taskEvents), or null. An agent completion draws its own row
 * instead, so it never folds.
 */
export function foldedTaskNotificationOf(line: SessionLine): TaskNotification | null {
	const notification = taskNotificationOf(line);
	return notification !== null && agentCompletionOf(line) === null ? notification : null;
}
