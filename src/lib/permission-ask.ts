import {z} from "zod";
import {JsonValueSchema} from "./json-value-schema";

/** One open `PermissionRequest`: the hook names the tool and its input, never the tool_use id. */
export interface PermissionAskEntry
{
	toolName: string;
	toolInput: unknown;
	/** The subagent that asked, or null for the main thread. */
	agentId: string | null;
	receivedAt: number;
}

/** The session summary's copy of an open ask; kept apart from the queue logic so session lists don't load it. */
export const PermissionAskEntrySchema = z.strictObject(
	{
		toolName: z.string(),
		toolInput: JsonValueSchema,
		agentId: z.string().nullable(),
		receivedAt: z.number(),
	},
);
