import {type SessionRename, useSessionRename} from "../hooks/use-session-rename";
import {ArchivedBadge} from "./archived-badge";
import {InlineRenameInput} from "./inline-rename-input";
import {Tooltip} from "./ui/tooltip";
import {useSessionTitleShortcuts} from "./use-session-title-shortcuts";

/**
 * claude.ai/code's rename button: clicking it swaps the title for an inline input.
 * Upstream's styled "Rename" tooltip sits below it; a session summary rides along as the button's description.
 */
export function SessionTitleButton({
	rename,
	className,
	summary = null,
}: {
	rename: SessionRename;
	className: string;
	summary?: string | null;
}) {
	const hasSummary = summary !== null && summary !== "";
	if (rename.editing) {
		return <InlineRenameInput value={rename.title} onCommit={rename.commit} onCancel={rename.cancel} />;
	}
	return (
		<Tooltip content="Rename" side="bottom" className="min-w-0">
			<button
				type="button"
				aria-label={`${rename.title}, rename session`}
				{...(hasSummary ? {"aria-description": summary} : {})}
				onClick={rename.startEditing}
				data-titlebar-title=""
				data-focus-region="header"
				className={className}
			>
				{rename.title}
			</button>
		</Tooltip>
	);
}

/** A standalone heading form of the session title with its shortcuts. */
export function SessionTitleHeading({
	sessionId,
	title,
	archived,
	prUrl,
	cwd = null,
}: {
	sessionId: string;
	title: string;
	archived: boolean;
	prUrl?: string | undefined;
	/** The session's directory; forking needs it. */
	cwd?: string | null;
}) {
	const rename = useSessionRename(sessionId, title);
	useSessionTitleShortcuts({sessionId, archived, prUrl, cwd, startEditing: rename.startEditing});

	return (
		<h1 className="flex min-w-0 items-center gap-2 text-lg font-semibold">
			<SessionTitleButton
				rename={rename}
				className="min-w-0 cursor-text truncate rounded-r6 text-left hover:bg-fill-ghost-hover hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-focus"
			/>
			{archived && <ArchivedBadge />}
		</h1>
	);
}
