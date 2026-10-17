import {z} from "zod";
import {isRecord} from "./narrow";

/**
 * Upstream tracks a subagent's foreground command as a background task once it
 * has run about four seconds, and that task's start and finish events stop the
 * next hand-back from folding into a tool group. Record timestamps trail the
 * live run by a few hundred milliseconds: commands upstream tracked show
 * 3.98s and up here, untracked ones 3.49s and under, so the cut sits between.
 */
const SLOW_COMMAND_MS = 3750;

/** A slow foreground command a subagent ran, which upstream tracks as a task of its own. */
export const SlowCommandSchema = z.strictObject({
	finishedAt: z.string(),
	/** The Bash call's description, or its command when it has none. */
	description: z.string(),
});
export type SlowCommand = z.infer<typeof SlowCommandSchema>;

interface StartedCommand {
	messageId: string | null;
	at: number;
	description: string;
}

/** Every slow foreground Bash call, fed one transcript record at a time. */
export class SlowCommandCollector {
	private readonly started = new Map<string, StartedCommand>();
	/** The latest record of each assistant message: its tools run only once the whole message has streamed. */
	private readonly messageEnds = new Map<string, number>();
	private readonly finished: SlowCommand[] = [];

	add(transcriptRecord: unknown): void {
		if (!isRecord(transcriptRecord)) return;
		const {type: recordType, timestamp, message} = transcriptRecord;
		const content = isRecord(message) ? message["content"] : undefined;
		if (typeof timestamp !== "string" || !Array.isArray(content)) return;
		const at = Date.parse(timestamp);
		const messageId = isRecord(message) && typeof message["id"] === "string" ? message["id"] : null;
		if (recordType === "assistant" && messageId !== null) this.messageEnds.set(messageId, at);
		for (const block of content) {
			if (!isRecord(block)) continue;
			const {type, id, name, input, tool_use_id: resultFor} = block;
			if (recordType === "assistant" && type === "tool_use" && name === "Bash" && typeof id === "string") {
				if (isRecord(input) && input["run_in_background"] === true) continue;
				this.started.set(id, {messageId, at, description: commandDescription(input)});
			} else if (recordType === "user" && type === "tool_result" && typeof resultFor === "string") {
				const command = this.started.get(resultFor);
				if (command === undefined) continue;
				const start = Math.max(
					command.at,
					command.messageId === null ? command.at : (this.messageEnds.get(command.messageId) ?? command.at),
				);
				if (at - start >= SLOW_COMMAND_MS) {
					this.finished.push({finishedAt: timestamp, description: command.description});
				}
			}
		}
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
