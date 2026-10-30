import type {z} from "zod";
import type {ApiRequestMessage, ApiRequestMessageBlock, ApiRequestMessages} from "./api-request-messages";
import {assertNever} from "./assert-never";
import {ApiRequestBlobRecordSchema, ApiRequestRecordSchema} from "./runtime-schemas";
import {parseTranscriptLine} from "./structured-transcript";

// Server-side: resolves one request's tail to its blobs. Kept apart from `api-request-messages.ts` so the client,
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

/**
 * The messages the request appended after its kept prefix, from a transcript's lines. Only blob lines naming one of
 * the tail's hashes are parsed, and the scan stops once every hash is found.
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
	const messages = tail.flatMap((hash) => byHash.get(hash) ?? []);
	return {found: true, messages, missing: tail.filter((hash) => !byHash.has(hash))};
}
