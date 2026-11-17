import {readFile} from "node:fs/promises";
import {join} from "node:path";
import type {SessionStatusInfo} from "./api/sessions";
import {ClaudeSettingsSchema} from "./runtime-schemas";
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
}

/**
 * One pass over the transcript, parsing only the lines that can matter: up to the first record
 * with a timestamp, any that mention `forkedFrom`, and the last that mentions `version`.
 */
async function readTranscriptFacts(transcriptPath: string): Promise<TranscriptFacts>
{
	let first: RecordLike | null = null;
	let forked = false;
	const versionLines: string[] = [];
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
 * The `/status` card's server-side inputs: the transcript's CLI version, start, fork and folder, and
 * the additional folders the user, project and local settings grant, de-duplicated in that order.
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
