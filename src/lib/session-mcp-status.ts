import {z} from "zod";
import type {SessionMcpStatus} from "./api/sessions";
import {asRecord} from "./narrow";

/**
 * A deferred-tools delta that carries `failedMcpServers`. The CLI writes the
 * field on every full delta (with `pendingMcpServers`) and omits it from the
 * partial ones, so the last delta that has it is the session's current
 * snapshot. Lenient: unknown keys are tolerated and stripped.
 */
const FailedMcpSnapshotSchema = z.object(
	{
		type: z.literal("attachment"),
		attachment: z.object(
			{
				type: z.literal("deferred_tools_delta"),
				failedMcpServers: z.array(
					z.object(
						{
							name: z.string(),
							errorCode: z.string().optional(),
							error: z.string().optional(),
							willRetry: z.string().optional(),
						},
					),
				),
			},
		),
	},
);

function failedServers(record: unknown): SessionMcpStatus["failed"] | undefined
{
	const parsed = FailedMcpSnapshotSchema.safeParse(record);
	if (!parsed.success) return undefined;
	return parsed.data.attachment.failedMcpServers.map(({name, errorCode, error, willRetry}) => (
	{
		name,
		...(errorCode === undefined
			? {}
			:
				{
					errorCode,
				}),
		...(error === undefined
			? {}
			:
				{
					error,
				}),
		...(willRetry === undefined
			? {}
			:
				{
					willRetry,
				}),
	}));
}

/**
 * Whether a transcript record is a full deferred-tools delta: a new
 * failed-server snapshot. A shape check only, cheap enough for every line the
 * live stream appends.
 */
export function isFailedMcpSnapshot(record: unknown): boolean
{
	const line = asRecord(record);
	if (line?.["type"] !== "attachment") return false;
	const attachment = asRecord(line["attachment"]);
	return attachment?.["type"] === "deferred_tools_delta" && Array.isArray(attachment["failedMcpServers"]);
}

/** The session's MCP status from its transcript records, oldest first: the last failed-server snapshot, or none. */
export function readSessionMcpStatus(records: readonly unknown[]): SessionMcpStatus
{
	for (let index = records.length - 1; index >= 0; index--)
	{
		const failed = failedServers(records[index]);
		if (failed !== undefined)
		{
			return {
				failed,
			};
		}
	}
	return {
		failed: [],
	};
}
