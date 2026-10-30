import type {z} from "zod";
import type {ApiRequestMessage, ApiRequestMessageBlock, ApiRequestMessages} from "./api-request-messages";
import {TranscriptMessageHasher, type TranscriptMessage} from "./api-request-hash";
import {assertNever} from "./assert-never";
import {ApiRequestBlobRecordSchema, ApiRequestRecordSchema} from "./runtime-schemas";
import {parseTranscriptLine} from "./structured-transcript";

// Server-side: resolves one request's tail to its blobs, or to the transcript records a blob-less hash names. Kept apart from `api-request-messages.ts` so the client,
// which only parses the summary, doesn't download the transcript schemas.

type BlobMessage = z.infer<typeof ApiRequestBlobRecordSchema>["message"];
type Image = {mediaType: string; data: string};

const NOT_FOUND: ApiRequestMessages = {found: false, messages: [], missing: []};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A JSON content part's image, when it is a well-formed `{type: "image", source}` block. */
function imageOf(part: Record<string, unknown>): Image | null {
	const {source} = part;
	if (part["type"] !== "image" || !isRecord(source)) return null;
	const mediaType = source["media_type"];
	const data = source["data"];
	return typeof mediaType === "string" && typeof data === "string" ? {mediaType, data} : null;
}

function summarizeToolResultContent(content: string | readonly unknown[] | undefined) {
	if (content === undefined) return {text: "", images: []};
	if (typeof content === "string") return {text: content, images: []};
	const texts: string[] = [];
	const images: Image[] = [];
	for (const part of content) {
		if (!isRecord(part)) continue;
		if (part["type"] === "text" && typeof part["text"] === "string") texts.push(part["text"]);
		const image = imageOf(part);
		if (image !== null) images.push(image);
	}
	return {text: texts.join("\n"), images};
}

function summarizeBlocks(content: BlobMessage["content"]): ApiRequestMessageBlock[] {
	if (typeof content === "string") return [{type: "text", text: content}];
	return content.map((block): ApiRequestMessageBlock => {
		switch (block.type) {
			case "text":
				return {type: "text", text: block.text};
			case "thinking":
				return {type: "thinking", text: block.thinking};
			case "tool_use":
				return {type: "tool_use", id: block.id, name: block.name, input: JSON.stringify(block.input, null, 2)};
			case "tool_result":
				return {
					type: "tool_result",
					toolUseId: block.tool_use_id,
					isError: block.is_error === true,
					...summarizeToolResultContent(block.content),
				};
			case "tool_addition":
				return block.tool.type === "tool_definition"
					? {type: "tool_addition", name: block.tool.definition.name, definition: true}
					: {type: "tool_addition", name: block.tool.name, definition: false};
			case "tool_removal":
				return {type: "tool_removal", name: block.tool.name};
			case "image":
				return {type: "image", mediaType: block.source.media_type, data: block.source.data};
			default:
				return assertNever(block);
		}
	});
}

/** The tail of the request whose `id` is `requestId`, or null when no line logs it. */
function findTail(lines: readonly string[], requestId: string): readonly string[] | null {
	const idNeedle = `"id":${JSON.stringify(requestId)}`;
	for (const line of lines) {
		if (!line.includes('"type":"api-request"') || !line.includes(idNeedle)) continue;
		const parsed = ApiRequestRecordSchema.safeParse(parseTranscriptLine(line));
		if (parsed.success && parsed.data.id === requestId) return parsed.data.tail;
	}
	return null;
}

/** A transcript message's blocks, through the blob schema so they summarize alike; unrecognized blocks are left out. */
function summarizeTranscriptMessage(hash: string, {role, blocks}: TranscriptMessage): ApiRequestMessage {
	const parsed = blocks.flatMap((block) => {
		const result = ApiRequestBlobRecordSchema.safeParse({
			type: "api-request-blob",
			sessionId: "",
			hash,
			message: {role, content: [block]},
		});
		return result.success && typeof result.data.message.content !== "string" ? result.data.message.content : [];
	});
	return {hash, role, blocks: summarizeBlocks(parsed)};
}

/** Resolves pending hashes to the user/assistant records the CLI hashed instead of writing them as blobs. */
function collectTranscriptMessages(
	lines: readonly string[],
	pending: Set<string>,
	byHash: Map<string, ApiRequestMessage>,
): void {
	const hasher = new TranscriptMessageHasher();
	for (const line of lines) {
		if (pending.size === 0) break;
		if (
			!line.includes('"type":"user"') &&
			!line.includes('"type":"assistant"') &&
			!line.includes("compact_boundary")
		) {
			continue;
		}
		const record = parseTranscriptLine(line);
		const hash = record === undefined ? null : hasher.note(record);
		if (hash === null || !pending.has(hash)) continue;
		const message = hasher.currentMessage();
		if (message === null) continue;
		pending.delete(hash);
		byHash.set(hash, summarizeTranscriptMessage(hash, message));
	}
}

/**
 * The messages the request appended after its kept prefix, from a transcript's lines. Only blob lines naming one of
 * the tail's hashes are parsed, and the scan stops once every hash is found. The CLI writes a blob only for a message
 * its transcript doesn't already hold, so hashes left over are resolved by hashing the transcript's own messages.
 */
export function collectApiRequestMessages(lines: readonly string[], requestId: string): ApiRequestMessages {
	const tail = findTail(lines, requestId);
	if (tail === null) return NOT_FOUND;
	const pending = new Set(tail);
	const byHash = new Map<string, ApiRequestMessage>();
	for (const line of lines) {
		if (pending.size === 0) break;
		if (!line.includes('"type":"api-request-blob"')) continue;
		if (![...pending].some((hash) => line.includes(`"hash":${JSON.stringify(hash)}`))) continue;
		const parsed = ApiRequestBlobRecordSchema.safeParse(parseTranscriptLine(line));
		if (!parsed.success || !pending.has(parsed.data.hash)) continue;
		const {hash, message} = parsed.data;
		pending.delete(hash);
		byHash.set(hash, {hash, role: message.role, blocks: summarizeBlocks(message.content)});
	}
	if (pending.size > 0) collectTranscriptMessages(lines, pending, byHash);
	const messages = tail.flatMap((hash) => byHash.get(hash) ?? []);
	return {found: true, messages, missing: tail.filter((hash) => !byHash.has(hash))};
}
