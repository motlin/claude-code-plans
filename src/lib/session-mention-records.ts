/**
 * The session mentions each local session's sent prompts carried, kept beside the index in the cache
 * (`session-mentions/<id>.json`): the CLI transcript keeps only the `@[Title]` text, so this is what lets
 * the transcript turn a sent `@[Title]` into a session link chip, as upstream's stored `sessionMentions` do.
 */
import {mkdir, readFile, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {z} from "zod";

import {type ResolvedSessionMention, SessionMentionRefSchema, type SessionMentionRef} from "./mention-sessions";

const RecordFileSchema = z.object(
	{
		mentions: z.array(SessionMentionRefSchema),
	},
);

function recordPath(cacheDir: string, sessionId: string): string
{
	return join(cacheDir, "session-mentions", `${encodeURIComponent(sessionId)}.json`);
}

export async function readSessionMentionRecords(cacheDir: string, sessionId: string): Promise<SessionMentionRef[]>
{
	let raw: string;
	try
	{
		raw = await readFile(recordPath(cacheDir, sessionId), "utf-8");
	}
	catch
	{
		return [];
	}
	const parsed = RecordFileSchema.safeParse(JSON.parse(raw));
	return parsed.success ? parsed.data.mentions : [];
}

/** Adds `refs` to the session's record; a title sent again points at its newest session. */
export async function recordSessionMentions(
	cacheDir: string,
	sessionId: string,
	refs: readonly SessionMentionRef[],
): Promise<void>
{
	if (refs.length === 0) return;
	const titles = new Set(refs.map((ref) => ref.title));
	const kept = (await readSessionMentionRecords(cacheDir, sessionId)).filter((ref) => !titles.has(ref.title));
	const path = recordPath(cacheDir, sessionId);
	await mkdir(
		join(cacheDir, "session-mentions"),
		{
			recursive: true,
		},
	);
	await writeFile(
		path,
		JSON.stringify(
			{
				mentions: [...kept, ...refs],
			},
		),
	);
}

/** Recorded mentions whose session the index still knows; unknown sessions stay plain text. */
export function resolveSessionMentions(
	refs: readonly SessionMentionRef[],
	known: ReadonlySet<string>,
	archived: ReadonlySet<string>,
): ResolvedSessionMention[]
{
	return refs
		.filter((ref) => known.has(ref.sessionId))
		.map((ref) => (
		{
			...ref,
			archived: archived.has(ref.sessionId),
		}));
}
