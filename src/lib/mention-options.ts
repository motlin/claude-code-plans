/**
 * Upstream's `@` mention providers (c61cfcb43 / c1958b152), reduced to the three a local session has:
 * Agents (home draft only), Sessions and Files. Each provider answers a query with options; the composer
 * merges them in upstream's fixed order and the one menu renders them with no category headers.
 */
import type {SessionFilesEntry} from "./api/session-files";
import type {AcceptedMention} from "./composer-mentions";

export type MentionProviderId = "ccp-agents" | "ccp-sessions" | "ccp-files";
export type MentionKind = "agent" | "session" | "file" | "directory";

export interface MentionOption
{
	id: string;
	providerId: MentionProviderId;
	label: string;
	/** The caption after the label; any row with one widens the menu to 560. */
	description?: string;
	/** The row's hover tooltip; omitted rows show none. */
	tooltip?: string;
	/** What the accepted token reads after its `@`. */
	renderedText: string;
	category: string;
	kind: MentionKind;
	/** File and directory rows: the path the token inserts (cwd-relative, absolute or `~/`). */
	relPath?: string;
}

/** A provider whose lookup is still running asks for skeleton rows where its options will land (upstream `pending`). */
export interface MentionPending
{
	rows: number;
	category?: string;
	/** Hide the block once any other provider has options. */
	onlyWhenEmpty?: boolean;
}

/** One pending provider's skeleton block, spliced before the first option at index `before` (upstream `ae`). */
export interface MentionPendingBlock extends MentionPending
{
	providerId: string;
	before: number;
}

/**
 * A non-file `@` source. `fetchOptions` answers synchronously when it can and with a promise otherwise;
 * `pending` and `emptyHint` are upstream's optional hooks for slow or empty lookups.
 */
export interface MentionProvider
{
	id: string;
	fetchOptions: (query: string) => readonly MentionOption[] | Promise<readonly MentionOption[]>;
	pending?: (query: string) => MentionPending | undefined;
	emptyHint?: (query: string) => string | undefined;
	/** Called when one of this provider's rows is accepted. */
	onSelect?: (option: MentionOption) => void;
	/** Called with the prompt as typed and its tracked chips when the composer sends it. */
	onSent?: (text: string, mentions: readonly AcceptedMention[]) => void;
}

/** Upstream's provider order is the order of `lists`: agents, sessions, then files. */
export function mergeProviderOptions(lists: readonly (readonly MentionOption[])[]): MentionOption[]
{
	return lists.flat();
}

/** Code's `pu` widths: 560 when any row has a description, else 420 (pending- and hint-only popups included). */
export function mentionMenuWidth(options: readonly Pick<MentionOption, "description">[]): number
{
	return options.some((option) => option.description !== undefined) ? 560 : 420;
}

/** Upstream's file row tooltip: the full path (directories keep their trailing `/`) with a ZWSP after every `/`. */
function fileTooltip(entry: SessionFilesEntry): string
{
	return `${entry.relPath}${entry.isDirectory ? "/" : ""}`.replaceAll("/", "/​");
}

/** A files-provider row: basename label, dirname caption. */
export function fileMentionOption(entry: SessionFilesEntry): MentionOption
{
	const slash = entry.relPath.lastIndexOf("/");
	const dirname = slash === -1 ? "" : entry.relPath.slice(0, slash) || "/";
	return {
		id: entry.relPath,
		providerId: "ccp-files",
		label: entry.name,
		...(dirname === ""
			? {}
			:
				{
					description: dirname,
				}),
		tooltip: fileTooltip(entry),
		renderedText: entry.isDirectory ? `${entry.relPath}/` : entry.relPath,
		category: "Files",
		kind: entry.isDirectory ? "directory" : "file",
		relPath: entry.relPath,
	};
}
