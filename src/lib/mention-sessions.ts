/**
 * Upstream's Sessions `@` provider (c61cfcb43 `Ft`): other sessions to mention as `@[Title]`, their pick
 * rules, and which mentions a sent prompt carries (tracked chips plus `vouch`ed hand-typed ones).
 */
import {z} from "zod";

import type {AcceptedMention} from "./composer-mentions";
import type {MentionOption} from "./mention-options";
import {asRecord} from "./narrow";

/** Upstream `Xl`/`Yl`: rows for an empty query, and with one. */
const EMPTY_QUERY_LIMIT = 3;
const QUERY_LIMIT = 8;
/** Upstream's per-message cap on carried session mentions. */
const MAX_SENT_MENTIONS = 16;
const TITLE_MAX = 120;
const BRANCH_MAX = 80;

const MentionSessionSchema = z
	.object(
		{
			sessionId: z.string(),
			title: z.string(),
			cwd: z.string().nullable(),
			gitBranch: z.string().nullable(),
			lastActivityAt: z.number(),
		},
	)
	.strict();
export type MentionSession = z.infer<typeof MentionSessionSchema>;

export const MentionSessionsResponseSchema = z
	.object(
		{
			sessions: z.array(MentionSessionSchema),
		},
	)
	.strict();

export const SessionMentionRefSchema = z
	.object(
		{
			sessionId: z.string(),
			title: z.string(),
		},
	)
	.strict();
export type SessionMentionRef = z.infer<typeof SessionMentionRefSchema>;

/** A sent mention resolved against the index: a live session links, an archived one shows its words only. */
const ResolvedSessionMentionSchema = z
	.object(
		{
			sessionId: z.string(),
			title: z.string(),
			archived: z.boolean(),
		},
	)
	.strict();
export type ResolvedSessionMention = z.infer<typeof ResolvedSessionMentionSchema>;

export const ResolvedSessionMentionsResponseSchema = z
	.object(
		{
			mentions: z.array(ResolvedSessionMentionSchema),
		},
	)
	.strict();

export const SentSessionMentionsBodySchema = z
	.object(
		{
			text: z.string(),
			mentions: z.array(SessionMentionRefSchema),
		},
	)
	.strict();

/** Upstream `ii`: at most 120 characters, no `@ [ ] \n \r`, whitespace collapsed and trimmed. */
export function sanitizeMentionTitle(title: string): string
{
	return title
		.slice(0, TITLE_MAX)
		.replaceAll(/[@[\]\n\r]/g, "")
		.replaceAll(/\s+/g, " ")
		.trim();
}

export interface MentionRosterRow
{
	sessionId: string;
	title: string;
	cwd: string | null;
	gitBranch: string | null;
	lastActivityAt: number;
	archived: boolean;
}

/** The mentionable roster: not archived, not the composing session, a non-empty sanitized title; newest first. */
export function mentionSessionRoster(rows: readonly MentionRosterRow[], currentSessionId: string): MentionSession[]
{
	return rows
		.filter((row) => !row.archived && row.sessionId !== currentSessionId)
		.map((row) => (
		{
			sessionId: row.sessionId,
			title: sanitizeMentionTitle(row.title),
			cwd: row.cwd,
			gitBranch: row.gitBranch,
			lastActivityAt: row.lastActivityAt,
		}))
		.filter((session) => session.title !== "")
		.toSorted((a, b) => b.lastActivityAt - a.lastActivityAt);
}

function basename(path: string): string
{
	const trimmed = path.replace(/\/+$/, "");
	return trimmed.slice(trimmed.lastIndexOf("/") + 1);
}

function branchLabel(branch: string | null): string
{
	return (branch ?? "").slice(0, BRANCH_MAX);
}

function sessionOption(session: MentionSession): MentionOption
{
	const description = [session.cwd === null ? "" : basename(session.cwd), branchLabel(session.gitBranch)]
		.filter(Boolean)
		.join(" · ");
	return {
		id: session.sessionId,
		providerId: "ccp-sessions",
		label: session.title,
		...(description === ""
			? {}
			:
				{
					description,
				}),
		tooltip: session.title,
		renderedText: `[${session.title}]`,
		category: "Sessions",
		kind: "session",
	};
}

/**
 * Upstream's lookup: the first 3 sessions for an empty query; otherwise the first 8 whose title, title without
 * whitespace, or branch (first 80 characters) holds the trimmed, lowercased query.
 */
export function mentionSessionOptions(roster: readonly MentionSession[], query: string): MentionOption[]
{
	const needle = query.trim().toLowerCase();
	if (needle === "") return roster.slice(0, EMPTY_QUERY_LIMIT).map(sessionOption);
	return roster
		.filter((session) =>
		{
			const title = session.title.toLowerCase();
			return (
				title.includes(needle) ||
				title.replaceAll(/\s+/g, "").includes(needle) ||
				branchLabel(session.gitBranch).toLowerCase().includes(needle)
			);
		})
		.slice(0, QUERY_LIMIT)
		.map(sessionOption);
}

const SENT_MENTION_PATTERN = /@\[([^\][\n]{1,120})\]/g;

/**
 * The session mentions a sent prompt carries, at most 16: each tracked chip whose `@[Title]` is still in the
 * text, then each other `@[Title]` that uniquely names a roster session (upstream `vouch`), once per session.
 */
export function collectSessionMentions(
	text: string,
	tracked: readonly SessionMentionRef[],
	roster: readonly Pick<MentionSession, "sessionId" | "title">[],
): SessionMentionRef[]
{
	const titles = new Set([...text.matchAll(SENT_MENTION_PATTERN)].map((match) => match[1] ?? ""));
	const out: SessionMentionRef[] = [];
	const seen = new Set<string>();
	const add = (ref: SessionMentionRef) =>
	{
		if (seen.has(ref.sessionId) || out.length >= MAX_SENT_MENTIONS) return;
		seen.add(ref.sessionId);
		out.push(ref);
	};
	const trustedTitles = new Set<string>();
	for (const ref of tracked)
	{
		if (!titles.has(ref.title)) continue;
		trustedTitles.add(ref.title);
		add(ref);
	}
	for (const title of titles)
	{
		if (trustedTitles.has(title)) continue;
		const named = roster.filter((session) => session.title === title);
		const [only] = named;
		if (named.length === 1 && only !== undefined)
			add(
				{
					sessionId: only.sessionId,
					title,
				},
			);
	}
	return out;
}

/** The composer's tracked session chips, as the refs a send carries. */
export function trackedSessionMentions(mentions: readonly AcceptedMention[]): SessionMentionRef[]
{
	return mentions.flatMap((mention) =>
		mention.kind === "session"
			? [
					{
						sessionId: mention.sessionId,
						title: mention.title,
					},
				]
			: [],
	);
}

/** Whether a transcript record is a user prompt whose text holds an `@[` session mention token. */
export function userTextHasSessionMention(record: Readonly<Record<string, unknown>>): boolean
{
	if (record["type"] !== "user") return false;
	const content = asRecord(record["message"])?.["content"];
	if (typeof content === "string") return content.includes("@[");
	if (!Array.isArray(content)) return false;
	return content.some((block) =>
	{
		const text = asRecord(block)?.["text"];
		return typeof text === "string" && text.includes("@[");
	});
}
