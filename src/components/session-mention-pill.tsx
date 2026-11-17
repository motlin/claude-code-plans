import {Link} from "@tanstack/react-router";
import {createContext, type ReactNode, useContext, useMemo} from "react";

import type {ResolvedSessionMention} from "../lib/mention-sessions";
import {CHIP_INTERACTIVE, CHIP_LABEL, CHIP_STATIC} from "./session-link-chip-classes";

/** A sent prompt's `@[Title]` session mention (upstream `/@\[([^\][\n]{1,120})\]/g`). */
export const SESSION_MENTION_PATTERN = /@\[([^\][\n]{1,120})\]/g;

type MentionsByTitle = ReadonlyMap<string, ResolvedSessionMention>;

const SessionMentionsContext = createContext<MentionsByTitle>(new Map());

/** The open session's recorded session mentions, by title, for its transcript's `@[Title]` chips. */
export function SessionMentionsProvider({
	mentions,
	children,
}: {
	mentions: readonly ResolvedSessionMention[] | undefined;
	children: ReactNode;
})
{
	const byTitle = useMemo(
		() => new Map((mentions ?? []).map((mention) => [mention.title, mention] as const)),
		[mentions],
	);
	return <SessionMentionsContext value={byTitle}>{children}</SessionMentionsContext>;
}

/**
 * A sent `@[Title]`: a recorded live session's link chip, an archived one's words-only chip with no link, and
 * anything else the text as typed (upstream only pills the message's stored session mentions).
 */
export function SessionMentionPill({title, raw}: {title: string; raw: string})
{
	const mention = useContext(SessionMentionsContext).get(title);
	if (mention === undefined) return <>{raw}</>;
	// Upstream's `surface:"session_mention"` chip (`kn`, labelSource "children"): an LTR-isolated title. The shared
	// classes stand in for `SessionLinkChip`, whose title markdown would pull markdown-it into every transcript.
	const label = (
		<span className={CHIP_LABEL}>
			<span>
				<bdi dir="ltr">{title}</bdi>
			</span>
		</span>
	);
	if (mention.archived) return <span className={CHIP_STATIC}>{label}</span>;
	return (
		<Link
			to="/session/$id"
			params={
			{
				id: mention.sessionId,
			}}
			className={CHIP_INTERACTIVE}
		>
			{label}
		</Link>
	);
}
