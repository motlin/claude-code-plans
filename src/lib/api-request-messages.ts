import {z} from "zod";

/*
 * The messages one API request (CLI 2.1.300+) appended after the prefix it
 * kept from its `base` request: its `tail` hashes, resolved to the
 * content-addressed `api-request-blob` records and summarized for display.
 * Fetched only when a Request disclosure's Messages section opens, so the
 * bulky blobs stay out of the cached request log.
 */

const ImageSchema = z.object({mediaType: z.string(), data: z.string()}).strict();

const ApiRequestMessageBlockSchema = z.discriminatedUnion("type", [
	z.object({type: z.literal("text"), text: z.string()}).strict(),
	z.object({type: z.literal("thinking"), text: z.string()}).strict(),
	z
		.object({
			type: z.literal("tool_use"),
			id: z.string(),
			name: z.string(),
			/** The input as pretty-printed JSON. */
			input: z.string(),
		})
		.strict(),
	z
		.object({
			type: z.literal("tool_result"),
			toolUseId: z.string(),
			isError: z.boolean(),
			/** Its text parts, joined by newlines. */
			text: z.string(),
			images: z.array(ImageSchema),
		})
		.strict(),
	z
		.object({
			type: z.literal("tool_addition"),
			name: z.string(),
			/** Whether the full definition was sent, rather than a reference to one sent earlier. */
			definition: z.boolean(),
		})
		.strict(),
	z.object({type: z.literal("image"), mediaType: z.string(), data: z.string()}).strict(),
]);

const ApiRequestMessageSchema = z
	.object({
		hash: z.string(),
		role: z.string(),
		blocks: z.array(ApiRequestMessageBlockSchema),
	})
	.strict();

export const ApiRequestMessagesSchema = z
	.object({
		/** Whether the session logged the request at all. */
		found: z.boolean(),
		/** The tail's messages, in tail order. */
		messages: z.array(ApiRequestMessageSchema),
		/** Tail hashes with no parseable blob in the transcript. */
		missing: z.array(z.string()),
	})
	.strict();

export type ApiRequestMessageBlock = z.infer<typeof ApiRequestMessageBlockSchema>;
export type ApiRequestMessage = z.infer<typeof ApiRequestMessageSchema>;
export type ApiRequestMessages = z.infer<typeof ApiRequestMessagesSchema>;
