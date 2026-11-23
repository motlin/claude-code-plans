import {readFile} from "node:fs/promises";
import {join} from "node:path";
import {z} from "zod";
import type {SessionStatusInfo} from "./api/sessions";
import {ClaudeSettingsSchema} from "./runtime-schemas";
import {type McpServerStatus, type McpStatusDelta, sessionMcpStatuses} from "./session-mcp-statuses";
import {forEachTranscriptLine} from "./transcript-stream";

type RecordLike = Readonly<Record<string, unknown>>;

function isRecord(value: unknown): value is RecordLike
{
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseRecord(line: string): RecordLike | null
{
	try
	{
		const value = JSON.parse(line) as unknown;
		return isRecord(value) ? value : null;
	}
	catch
	{
		return null;
	}
}

function stringField(record: RecordLike | null, key: string): string | null
{
	const value = record?.[key];
	return typeof value === "string" && value !== "" ? value : null;
}

interface TranscriptFacts
{
	cliVersion: string | null;
	createdAt: number | null;
	forked: boolean;
	cwd: string | null;
	mcpStatuses: Array<[string, McpServerStatus]> | null;
	dataFlowIncompleteCodes: number[] | null;
}

/** The fields of a deferred-tools delta the MCP status fold reads. Lenient: other keys are stripped. */
const McpStatusDeltaRecord = z.object(
	{
		type: z.literal("attachment"),
		attachment: z.object(
			{
				type: z.literal("deferred_tools_delta"),
				addedNames: z.array(z.string()).optional(),
				readdedNames: z.array(z.string()).optional(),
				removedNames: z.array(z.string()).optional(),
				failedMcpServers: z
					.array(
						z.object(
							{
								name: z.string(),
							},
						),
					)
					.optional(),
				pendingMcpServers: z.array(z.string()).optional(),
				needsAuthMcpServers: z.array(z.string()).optional(),
			},
		),
	},
);

/** A `data-flow-incomplete` marker; a record without codes reads as no codes. Lenient: other keys are stripped. */
const DataFlowIncompleteRecord = z.object(
	{
		type: z.literal("data-flow-incomplete"),
		codes: z.array(z.number()).optional(),
	},
);

function dataFlowIncompleteCodes(line: string): number[] | null
{
	const parsed = DataFlowIncompleteRecord.safeParse(parseRecord(line));
	return parsed.success ? (parsed.data.codes ?? []) : null;
}

function mcpStatusDelta(line: string): McpStatusDelta | null
{
	const parsed = McpStatusDeltaRecord.safeParse(parseRecord(line));
	return parsed.success ? parsed.data.attachment : null;
}

/**
 * One pass over the transcript, parsing only the lines that can matter: up to the first record
 * with a timestamp, any that mention `forkedFrom`, deferred-tools deltas, data-flow-incomplete
 * markers (the newest wins), and the last that mentions `version`.
 */
async function readTranscriptFacts(transcriptPath: string): Promise<TranscriptFacts>
{
	let first: RecordLike | null = null;
	let forked = false;
	const versionLines: string[] = [];
	const deltas: McpStatusDelta[] = [];
	let incompleteCodes: number[] | null = null;
	try
	{
		await forEachTranscriptLine(transcriptPath, (line) =>
		{
			if (first === null)
			{
				const record = parseRecord(line);
				if (stringField(record, "timestamp") !== null) first = record;
			}
			if (!forked && line.includes('"forkedFrom"'))
			{
				const forkedFrom = parseRecord(line)?.["forkedFrom"];
				forked = forkedFrom !== undefined && forkedFrom !== null;
			}
			if (line.includes('"deferred_tools_delta"'))
			{
				const delta = mcpStatusDelta(line);
				if (delta !== null) deltas.push(delta);
			}
			if (line.includes('"data-flow-incomplete"'))
			{
				incompleteCodes = dataFlowIncompleteCodes(line) ?? incompleteCodes;
			}
			if (line.includes('"version"')) versionLines.push(line);
			// Only the newest few candidates are ever parsed.
			if (versionLines.length > 8) versionLines.shift();
		});
	}
	catch
	{
		// An unreadable transcript reports nothing.
	}
	let cliVersion: string | null = null;
	for (let index = versionLines.length - 1; index >= 0 && cliVersion === null; index--)
	{
		cliVersion = stringField(parseRecord(versionLines[index] ?? ""), "version");
	}
	const timestamp = stringField(first, "timestamp");
	const createdAt = timestamp === null ? Number.NaN : Date.parse(timestamp);
	return {
		cliVersion,
		createdAt: Number.isNaN(createdAt) ? null : createdAt,
		forked,
		cwd: stringField(first, "cwd"),
		mcpStatuses: deltas.length > 0 ? sessionMcpStatuses(deltas) : null,
		dataFlowIncompleteCodes: incompleteCodes,
	};
}

async function readAdditionalDirectories(path: string): Promise<string[]>
{
	try
	{
		const parsed = ClaudeSettingsSchema.safeParse(JSON.parse(await readFile(path, "utf-8")) as unknown);
		if (!parsed.success) return [];
		return [
			...(parsed.data.permissions?.additionalDirectories ?? []),
			...(parsed.data.additionalDirectories ?? []),
		];
	}
	catch
	{
		// A missing or unreadable settings file adds no folders.
		return [];
	}
}

/**
 * The `/status` card's server-side inputs: the transcript's CLI version, start, fork, folder, MCP
 * server statuses and data-flow-incomplete codes, and the additional folders the user, project and local settings grant, de-duplicated in that order.
 */
export async function readSessionStatusInfo(
	transcriptPath: string,
	{
		home,
	}:
	{
		home: string;
	},
): Promise<SessionStatusInfo>
{
	const facts = await readTranscriptFacts(transcriptPath);
	const settingsFiles = [join(home, ".claude", "settings.json")];
	if (facts.cwd !== null)
		settingsFiles.push(
			join(facts.cwd, ".claude", "settings.json"),
			join(facts.cwd, ".claude", "settings.local.json"),
		);
	const directories = await Promise.all(settingsFiles.map(readAdditionalDirectories));
	return {
		...facts,
		homePath: home,
		additionalDirectories: [...new Set(directories.flat())],
	};
}
