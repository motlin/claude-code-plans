import {z} from "zod";
import {parseTaskNotification} from "./background-tasks";
import {isRecord} from "./narrow";

/**
 * Upstream tracks a subagent's foreground command as a background task once it
 * has run about four seconds, and that task's start and finish events stop the
 * next hand-back from folding into a tool group. Record timestamps trail the
 * live run by a few hundred milliseconds: commands upstream tracked show
 * 3.98s and up here, untracked ones 3.49s and under, so the cut sits between.
 */
const SLOW_COMMAND_MS = 3750;

/**
 * A slow foreground command a subagent ran, which upstream tracks as a task of
 * its own, or a background command whose task notification reached it.
 */
export const SlowCommandSchema = z.strictObject({
	finishedAt: z.string(),
	/** The Bash call's description, or its command when it has none. */
	description: z.string(),
	/** "failed" for an errored result, else the notification's terminal status. */
	status: z.enum(["completed", "failed", "stopped"]),
});
export type SlowCommand = z.infer<typeof SlowCommandSchema>;

interface StartedCommand {
	messageId: string | null;
	at: number;
	description: string;
}

/**
 * Every slow foreground Bash call and every background-command task
 * notification, fed one transcript record at a time. A command the 2-minute
 * timeout moved to the background counts twice, as upstream does: once when
 * its foreground call ends and again when its notification arrives.
 */
export class SlowCommandCollector {
	private readonly started = new Map<string, StartedCommand>();
	/** Every Bash call's description, background ones included, for its notification. */
	private readonly descriptions = new Map<string, string>();
	/** The latest record of each assistant message: its tools run only once the whole message has streamed. */
	private readonly messageEnds = new Map<string, number>();
	private readonly finished: SlowCommand[] = [];

	add(transcriptRecord: unknown): void {
		if (!isRecord(transcriptRecord)) return;
		const {type: recordType, timestamp, message, attachment} = transcriptRecord;
		if (recordType === "attachment" && isRecord(attachment) && typeof timestamp === "string") {
			this.addNotification(attachment, timestamp);
			return;
		}
		const content = isRecord(message) ? message["content"] : undefined;
		if (typeof timestamp !== "string" || !Array.isArray(content)) return;
		const at = Date.parse(timestamp);
		const messageId = isRecord(message) && typeof message["id"] === "string" ? message["id"] : null;
		if (recordType === "assistant" && messageId !== null) this.messageEnds.set(messageId, at);
		for (const block of content) {
			if (!isRecord(block)) continue;
			const {type, id, name, input, tool_use_id: resultFor} = block;
			if (recordType === "assistant" && type === "tool_use" && name === "Bash" && typeof id === "string") {
				const description = commandDescription(input);
				this.descriptions.set(id, description);
				if (isRecord(input) && input["run_in_background"] === true) continue;
				this.started.set(id, {messageId, at, description});
			} else if (recordType === "user" && type === "tool_result" && typeof resultFor === "string") {
				const command = this.started.get(resultFor);
				if (command === undefined) continue;
				const start = Math.max(
					command.at,
					command.messageId === null ? command.at : (this.messageEnds.get(command.messageId) ?? command.at),
				);
				if (at - start >= SLOW_COMMAND_MS) {
					this.finished.push({
						finishedAt: timestamp,
						description: command.description,
						status: block["is_error"] === true ? "failed" : "completed",
					});
				}
			}
		}
	}

	/** A queued background-command `<task-notification>`, which upstream counts as that task finishing. */
	private addNotification(attachment: Readonly<Record<string, unknown>>, timestamp: string): void {
		const {type, prompt} = attachment;
		if (type !== "queued_command" || typeof prompt !== "string") return;
		const notification = parseTaskNotification(prompt);
		if (notification?.command !== true) return;
		const description =
			(notification.toolUseId === null ? undefined : this.descriptions.get(notification.toolUseId)) ??
			notification.description;
		this.finished.push({finishedAt: timestamp, description, status: notification.status});
	}

	commands(): SlowCommand[] {
		return this.finished;
	}
}

function commandDescription(input: unknown): string {
	if (!isRecord(input)) return "";
	const {description, command} = input;
	if (typeof description === "string" && description !== "") return description;
	return typeof command === "string" ? command : "";
}
