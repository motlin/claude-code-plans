/**
 * Claude Code writes some user-facing prose as a `thinking` block. Its
 * signature is a base64 protobuf whose field 2 → field 1 → field 8 names the
 * block kind: "narration" for prose meant for the user, "thinking" for real
 * reasoning. Upstream claude.ai/code draws narration as ordinary assistant
 * text, whatever the thinking toggle says.
 */

interface MaybeThinkingBlock {
	type: string;
	thinking?: unknown;
	signature?: unknown;
}

const NARRATION_KIND = "narration";
const KIND_FIELD_PATH = [2, 1, 8] as const;

const WIRE_VARINT = 0;
const WIRE_FIXED64 = 1;
const WIRE_LENGTH_DELIMITED = 2;
const WIRE_FIXED32 = 5;

const narrationByBlock = new WeakMap<object, boolean>();

function decodeBase64(text: string): Uint8Array | null {
	try {
		const binary = atob(text);
		const bytes = new Uint8Array(binary.length);
		for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
		return bytes;
	} catch {
		return null;
	}
}

/** A varint's value and the offset after it, or null when it runs off the end. */
function readVarint(bytes: Uint8Array, offset: number): [value: number, next: number] | null {
	let value = 0;
	let scale = 1;
	for (let index = offset; index < bytes.length && index < offset + 10; index++) {
		const byte = bytes[index]!;
		value += (byte & 0x7f) * scale;
		if ((byte & 0x80) === 0) return [value, index + 1];
		scale *= 128;
	}
	return null;
}

/** The first length-delimited value of `field` in a protobuf message, or null. */
function lengthDelimitedField(bytes: Uint8Array, field: number): Uint8Array | null {
	let offset = 0;
	while (offset < bytes.length) {
		const tag = readVarint(bytes, offset);
		if (tag === null) return null;
		offset = tag[1];
		const wireType = tag[0] % 8;
		const fieldNumber = Math.floor(tag[0] / 8);
		if (wireType === WIRE_VARINT) {
			const value = readVarint(bytes, offset);
			if (value === null) return null;
			offset = value[1];
		} else if (wireType === WIRE_FIXED64) {
			offset += 8;
		} else if (wireType === WIRE_FIXED32) {
			offset += 4;
		} else if (wireType === WIRE_LENGTH_DELIMITED) {
			const length = readVarint(bytes, offset);
			if (length === null) return null;
			const start = length[1];
			const end = start + length[0];
			if (end > bytes.length) return null;
			if (fieldNumber === field) return bytes.subarray(start, end);
			offset = end;
		} else {
			return null;
		}
	}
	return null;
}

function signatureKind(signature: string): string | null {
	let message = decodeBase64(signature);
	for (const field of KIND_FIELD_PATH) {
		if (message === null) return null;
		message = lengthDelimitedField(message, field);
	}
	return message === null ? null : new TextDecoder().decode(message);
}

/** Whether a thinking block's signature marks it as narration, user-facing prose. */
export function isNarrationThinking(block: MaybeThinkingBlock): boolean {
	if (block.type !== "thinking" || typeof block.signature !== "string" || block.signature === "") return false;
	const cached = narrationByBlock.get(block);
	if (cached !== undefined) return cached;
	const narration = signatureKind(block.signature) === NARRATION_KIND;
	narrationByBlock.set(block, narration);
	return narration;
}

/** The prose of a narration block with visible text, or null for empty narration and real thinking. */
export function narrationProse(block: MaybeThinkingBlock): string | null {
	if (typeof block.thinking !== "string" || block.thinking.trim() === "") return null;
	return isNarrationThinking(block) ? block.thinking : null;
}
