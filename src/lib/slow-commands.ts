import {isRecord} from "./narrow";

/**
 * Upstream tracks a subagent's foreground command as a background task once it
 * has run about four seconds, and that task's start and finish events stop the
 * next hand-back from folding into a tool group. Record timestamps trail the
 * live run by a few hundred milliseconds: commands upstream tracked show
 * 3.98s and up here, untracked ones 3.49s and under, so the cut sits between.
 */
const SLOW_COMMAND_MS = 3750;

/** The finish time of every slow foreground Bash call, fed one transcript record at a time. */
export class SlowCommandCollector {
	private readonly started = new Map<string, number>();
	private readonly finished: string[] = [];

	add(transcriptRecord: unknown): void {
		if (!isRecord(transcriptRecord)) return;
		const {type: recordType, timestamp, message} = transcriptRecord;
		const content = isRecord(message) ? message["content"] : undefined;
		if (typeof timestamp !== "string" || !Array.isArray(content)) return;
		const at = Date.parse(timestamp);
		for (const block of content) {
			if (!isRecord(block)) continue;
			const {type, id, name, input, tool_use_id: resultFor} = block;
			if (recordType === "assistant" && type === "tool_use" && name === "Bash" && typeof id === "string") {
				const background = isRecord(input) && input["run_in_background"] === true;
				if (!background) this.started.set(id, at);
			} else if (recordType === "user" && type === "tool_result" && typeof resultFor === "string") {
				const start = this.started.get(resultFor);
				if (start !== undefined && at - start >= SLOW_COMMAND_MS) this.finished.push(timestamp);
			}
		}
	}

	ends(): string[] {
		return this.finished;
	}
}
