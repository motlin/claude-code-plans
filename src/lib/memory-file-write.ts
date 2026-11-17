import {createReadStream} from "node:fs";
import {createInterface} from "node:readline";

import {readContextMirror} from "./context-breakdown-reader";
import {latestBreakdown} from "./context-breakdown";
import {resolveSessionFilePath} from "./sessions";

/**
 * Which of a session's memory files the Memory dialog may read and write: the CLI's own CLAUDE files that its
 * context breakdown lists (Q4: the app writes the CLI's files exactly as the CLI's `/memory` would).
 */

export interface ListedMemoryFile
{
	path: string;
	type: string;
}

/** The types the dialog edits: Managed is the organization's, and auto-memory has `/api/projects/$id/memories`. */
const WRITABLE_TYPES: ReadonlySet<string> = new Set(["User", "Project", "Local"]);

function isAbsoluteClean(path: string): boolean
{
	return path.startsWith("/") && !path.includes("\0") && !path.split("/").includes("..");
}

/** True when `path` is an absolute, `..`-free `.md` the breakdown lists as any type. */
export function listedMemoryFile(path: string, memoryFiles: readonly ListedMemoryFile[]): ListedMemoryFile | undefined
{
	if (!isAbsoluteClean(path)) return undefined;
	return memoryFiles.find((file) => file.path === path);
}

/** True iff `path` is absolute, has no `..` segment, ends in `.md`, and is listed as a User, Project or Local file. */
export function writableMemoryFile(path: string, memoryFiles: readonly ListedMemoryFile[]): boolean
{
	const file = listedMemoryFile(path, memoryFiles);
	return file !== undefined && path.endsWith(".md") && WRITABLE_TYPES.has(file.type);
}

/** Every memory file a `/context` twin in the session's transcript lists. */
async function transcriptMemoryFiles(projectsDir: string, sessionId: string): Promise<ListedMemoryFile[]>
{
	const resolved = await resolveSessionFilePath(projectsDir, sessionId);
	if (resolved === null) return [];
	const files: ListedMemoryFile[] = [];
	const lines = createInterface(
		{
			input: createReadStream(resolved.filePath, "utf-8"),
			crlfDelay: Infinity,
		},
	);
	for await (const line of lines)
	{
		if (!line.includes('"contextUsage"')) continue;
		let record: unknown;
		try
		{
			record = JSON.parse(line);
		}
		catch
		{
			continue;
		}
		const breakdown = latestBreakdown([record]);
		if (breakdown !== null) files.push(...breakdown.memoryFiles);
	}
	return files;
}

/** The session's memory files from the context mirror, falling back to its transcript's `/context` twins. */
export async function sessionMemoryFiles(
	sessionId: string,
	projectsDir: string,
	path: string,
): Promise<ListedMemoryFile[]>
{
	const mirrored = (await readContextMirror(sessionId))?.memoryFiles ?? [];
	if (mirrored.some((file) => file.path === path)) return mirrored;
	return [...mirrored, ...(await transcriptMemoryFiles(projectsDir, sessionId))];
}
