/**
 * Upstream tracks a subagent's foreground command as a background task once it
 * has run about four seconds, and that task's start and finish events stop the
 * next hand-back from folding into a tool group. Record timestamps trail the
 * live run by a few hundred milliseconds: commands upstream tracked show
 * 3.98s and up here, untracked ones 3.49s and under, so the cut sits between.
 */
const SLOW_COMMAND_MS = 3750;

interface CommandRecord {
	type?: unknown;
	timestamp?: unknown;
	message?: {content?: unknown} | undefined;
}

/** The finish time of every slow foreground Bash call, fed one transcript record at a time. */
export class SlowCommandCollector {
	private readonly started = new Map<string, number>();
	private readonly finished: string[] = [];

	add(transcriptRecord: unknown): void {
		if (typeof transcriptRecord !== "object" || transcriptRecord === null) return;
		const record = transcriptRecord as CommandRecord;
		const content = record.message?.content;
		if (typeof record.timestamp !== "string" || !Array.isArray(content)) return;
		const at = Date.parse(record.timestamp);
		for (const block of content as unknown[]) {
			if (typeof block !== "object" || block === null) continue;
			const {type, id, name, input, tool_use_id: resultFor} = block as Record<string, unknown>;
			if (record.type === "assistant" && type === "tool_use" && name === "Bash" && typeof id === "string") {
				const background = (input as {run_in_background?: unknown} | undefined)?.run_in_background === true;
				if (!background) this.started.set(id, at);
			} else if (record.type === "user" && type === "tool_result" && typeof resultFor === "string") {
				const start = this.started.get(resultFor);
				if (start !== undefined && at - start >= SLOW_COMMAND_MS) this.finished.push(record.timestamp);
			}
		}
	}

	ends(): string[] {
		return this.finished;
	}
}
