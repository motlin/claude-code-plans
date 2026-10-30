import {createHash, type Hash} from "node:crypto";

/*
 * The content hashes the CLI (2.1.300+) names messages by in an `api-request`
 * record's `tail`. It writes an `api-request-blob` only for a message whose
 * hash its transcript doesn't already cover, so a tail hash with no blob is
 * one of the transcript's user/assistant messages, hashed the same way here.
 */

/**
 * The CLI's canonical JSON: object keys sorted, undefined values and
 * `cache_control` keys dropped, everything else as `JSON.stringify` writes it.
 */
function canonicalJson(value: unknown): string {
	if (value === undefined) return "null";
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
	if (!isRecord(value)) return JSON.stringify(value);
	const fields = Object.keys(value)
		.toSorted()
		.flatMap((key) => {
			const field = value[key];
			return field === undefined || key === "cache_control"
				? []
				: [`${JSON.stringify(key)}:${canonicalJson(field)}`];
		});
	return `{${fields.join(",")}}`;
}

export type TranscriptMessage = {role: string; blocks: readonly unknown[]};

type Run = {role: string; messageId: string | undefined; hash: Hash; blocks: unknown[]};

function continuesRun(run: Run, role: string, messageId: string | undefined): boolean {
	return run.role === role && (role === "user" || (messageId !== undefined && run.messageId === messageId));
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Hashes transcript records the way the CLI's transcript tracker does: consecutive user records, or consecutive
 * assistant records sharing a message id, are one API message, and each record names the message its run holds so
 * far, `{"content":[...blocks],"role":...}` in canonical JSON. A compact boundary ends the run.
 */
export class TranscriptMessageHasher {
	private run: Run | undefined;

	/** The hash of the message the record's run holds so far, or null when it isn't a user/assistant message. */
	note(record: Record<string, unknown>): string | null {
		if (record["type"] === "system" && record["subtype"] === "compact_boundary") {
			this.run = undefined;
			return null;
		}
		if (record["type"] !== "user" && record["type"] !== "assistant") return null;
		const {message} = record;
		if (!isRecord(message) || typeof message["role"] !== "string" || message["content"] === undefined) {
			this.run = undefined;
			return null;
		}
		const role = message["role"];
		const messageId = typeof message["id"] === "string" ? message["id"] : undefined;
		const content = message["content"];
		const blocks =
			typeof content === "string"
				? [{type: "text", text: content}]
				: Array.isArray(content)
					? content
					: [content];
		if (this.run === undefined || !continuesRun(this.run, role, messageId)) {
			this.run = {role, messageId, hash: createHash("sha256").update('{"content":['), blocks: []};
		}
		const run = this.run;
		for (const block of blocks) {
			if (run.blocks.length > 0) run.hash.update(",");
			run.hash.update(canonicalJson(block));
			run.blocks.push(block);
		}
		return run.hash
			.copy()
			.update(`],"role":${JSON.stringify(role)}}`)
			.digest("hex");
	}

	/** The message the last noted record's run holds so far. */
	currentMessage(): TranscriptMessage | null {
		return this.run === undefined ? null : {role: this.run.role, blocks: [...this.run.blocks]};
	}
}
