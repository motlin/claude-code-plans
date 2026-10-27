import {z} from "zod";

/**
 * Recursive schema for any valid JSON value. Used in place of `z.unknown()` for
 * externally-owned API objects (Anthropic `usage`, `container`, etc.) so we
 * assert "valid JSON" (rejecting undefined/functions/symbols) without breaking
 * when the upstream shape gains new fields.
 */
export const JsonValueSchema: z.ZodType = z.lazy(() =>
	z.union([
		z.string(),
		z.number(),
		z.boolean(),
		z.null(),
		z.array(JsonValueSchema),
		z.record(z.string(), JsonValueSchema),
	]),
);
