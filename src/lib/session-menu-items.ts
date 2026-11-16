import {z} from "zod";

import {isKeyOf} from "./narrow";
import {sessionMenuItemLabels, transcriptModeLabels} from "./schema-choices";
import type {SessionBucket} from "./session-state";
import {TRANSCRIPT_MODES, type TranscriptMode} from "./transcript-mode";

/**
 * The claude.ai/code session actions menu as data. The sidebar row menu, the
 * session header menu and the ⌘K contextual commands all render from this one
 * model; an action appears only when its capability is wired, like upstream's
 * "render the item only if its handler prop exists". Share (cloud-only) and
 * Delete (the app never deletes transcripts) are never offered.
 */
export const SessionMenuItemIdSchema = z.enum([
	"open-in",
	"open-live-terminal",
	"open-terminal",
	"open-vscode",
	"open-finder",
	"open-claude-ai",
	"open-pr",
	"move-up",
	"move-down",
	"pin",
	"unpin",
	"mark-read",
	"mark-unread",
	"mark-completed",
	"rename",
	"copy-link",
	"fork",
	"toggle-nested-sessions",
	"move-to-group",
	"move-to-custom-group",
	"ungroup",
	"new-group",
	"transcript-view",
	"transcript-mode",
	"make-default-transcript-mode",
	"archive",
	"unarchive",
]);

export type SessionMenuItemId = z.infer<typeof SessionMenuItemIdSchema>;

export type SessionMenuCapability =
	| "openLiveTerminal"
	| "openTerminal"
	| "openVsCode"
	| "openFinder"
	| "openClaudeAi"
	| "openPr"
	| "pin"
	| "readState"
	| "ackAwaiting"
	| "rename"
	| "copyLink"
	| "fork"
	| "customGroups"
	| "archive";

/** "palette-card" is the ⌘K → row-actions card, which numbers its items 1…N itself. */
export type SessionMenuSurface = "row" | "header" | "palette" | "palette-card";

/**
 * Working and waiting rows are in progress: their read toggle stays but is disabled, and waiting rows
 * also get "Mark as completed".
 */
export type SessionMenuReadState = "working" | "awaiting" | "unread" | "read";

/** Upstream's disabledReason on the read toggle of an in-progress row. */
const READ_TOGGLE_IN_PROGRESS_REASON = "This session is still working or needs your input.";

/**
 * Blocked rows are awaiting input; finished rows are read or unread by the unseen flag. A row blocked on a
 * failed turn is not in progress (upstream `Ct` excludes `St`), so it keeps the read toggle, and neither is
 * an archived row (upstream's `!archived` gate).
 */
export function sessionMenuReadState(
	bucket: SessionBucket | undefined,
	unseen: boolean,
	{
		unseenError = false,
		archived = false,
	}:
	{
		unseenError?: boolean;
		archived?: boolean;
	} = {},
): SessionMenuReadState
{
	if (!archived)
	{
		if (bucket === "working") return "working";
		if (bucket === "blocked" && !unseenError) return "awaiting";
	}
	return unseen ? "unread" : "read";
}

export interface SessionMenuSession
{
	title: string;
	pinned: boolean;
	readState: SessionMenuReadState;
	/** Unseen work; labels an in-progress row's disabled read toggle, since `readState` drops it there. */
	unread?: boolean;
	archived: boolean;
	prUrl: string | null;
	/** A pane of the session's that the live terminal tab can stream. */
	hasLiveTerminal: boolean;
	forkDisabledReason: string | null;
	/** Directory the session runs in; Terminal, VS Code and Finder need it. */
	cwd: string | null;
	/** claude.ai/code session the transcript's `bridge-session` record points at. */
	bridgeSessionId: string | null;
	/** Where a pinned row sits in the sidebar Pinned section; enables Move up / Move down. */
	pinPosition?:
	{
		index: number;
		count: number;
	};
	/** This browser's custom groups and the row's current one; enables Move to group. */
	customGroup?:
	{
		groups: readonly
		{
			id: string;
			name: string;
		}[];
		current: string | null;
	};
	/** The session's transcript view; enables the header's Transcript view submenu. */
	transcriptView?: TranscriptViewState;
	/** The last turn failed and Mark as completed hasn't acked it (upstream `St`); offers it after the read toggle. */
	failed?: boolean;
	/** This tab draws the session's approval card live (upstream `hasPendingApproval`); hides Mark as completed. */
	liveApproval?: boolean;
	/** Family head: the fold state of its nested sessions; enables Hide/Show nested sessions. */
	nestedSessions?:
	{
		hidden: boolean;
	};
}

export interface TranscriptViewState
{
	mode: TranscriptMode;
	defaultMode: TranscriptMode;
	hasThinking: boolean;
}

export interface SessionMenuItem
{
	kind: "item";
	id: SessionMenuItemId;
	label: string;
	/** Single key that fires the item while the menu is open. */
	accelerator?: string;
	disabled?: true;
	disabledReason?: string;
	/** Present on radio items; true for the current choice. */
	checked?: boolean;
	/** The custom group a Move to group radio targets. */
	groupId?: string;
	/** The mode a Transcript view radio selects. */
	transcriptMode?: TranscriptMode;
	submenu?: SessionMenuEntry[];
}

export interface SessionMenuSeparator
{
	kind: "separator";
}

export type SessionMenuEntry = SessionMenuItem | SessionMenuSeparator;

const ACCELERATORS =
{
	"open-pr": "g",
	pin: "p",
	unpin: "p",
	"mark-read": "u",
	"mark-unread": "u",
	"mark-completed": "u",
	rename: "r",
	"copy-link": "c",
	fork: "f",
	archive: "a",
	unarchive: "a",
} as const satisfies Partial<Record<SessionMenuItemId, string>>;

type AcceleratedId = keyof typeof ACCELERATORS;

/** Upstream ⌘K contextual command wording; `{name}` is the truncated title. */
const PALETTE_LABELS =
{
	pin: (name) => `Pin “${name}”`,
	unpin: (name) => `Unpin “${name}”`,
	rename: (name) => `Rename “${name}”`,
	"copy-link": (name) => `Copy link to “${name}”`,
	fork: (name) => `Fork “${name}”`,
	archive: (name) => `Archive “${name}”`,
	unarchive: (name) => `Unarchive “${name}”`,
} as const satisfies Partial<Record<SessionMenuItemId, (name: string) => string>>;

const PALETTE_TITLE_LENGTH = 39;

/** Maximum accelerator digit in a numbered submenu (Open in, Move to group). */
const MAX_DIGIT = 9;

function numbered(entries: SessionMenuEntry[]): SessionMenuEntry[]
{
	let digit = 0;
	return entries.map((entry) =>
	{
		if (entry.kind !== "item") return entry;
		digit += 1;
		return digit > MAX_DIGIT
			? entry
			:
				{
					...entry,
					accelerator: String(digit),
				};
	});
}

/**
 * Upstream's "Move to section ▸": the manual sections as radios, a separator, Remove from {section}
 * (only when the row is in one) and New section, numbered 1…9 in that order.
 */
function moveToGroupItem(
	{
		groups,
		current,
		grouped = current !== null,
	}: NonNullable<SessionMenuSession["customGroup"]> &
	{
		grouped?: boolean;
	},
	label: string = sessionMenuItemLabels["move-to-group"],
): SessionMenuItem
{
	const entries: SessionMenuEntry[] = groups.map((group) => (
	{
		kind: "item",
		id: "move-to-custom-group",
		label: group.name,
		groupId: group.id,
		checked: group.id === current,
	}));
	if (entries.length > 0)
		entries.push(
			{
				kind: "separator",
			},
		);
	if (grouped)
	{
		// Upstream `Cg`: "Remove from {groupName}", or "Remove from sections" across several.
		const currentName = groups.find((group) => group.id === current)?.name;
		entries.push(
			{
				kind: "item",
				id: "ungroup",
				label: currentName === undefined ? sessionMenuItemLabels.ungroup : `Remove from ${currentName}`,
				checked: false,
			},
		);
	}
	entries.push(
		{
			kind: "item",
			id: "new-group",
			label: sessionMenuItemLabels["new-group"],
		},
	);
	return {
		kind: "item",
		id: "move-to-group",
		label,
		submenu: numbered(entries),
	};
}

export interface BulkSessionMenuSelection
{
	/** How many sessions are selected (two or more). */
	count: number;
	/** Every selected session is unread, so the read-state item marks them read. */
	allUnread: boolean;
	/** Some selected session is not archived yet, so Archive has work to do. */
	anyUnarchived: boolean;
	/**
	 * This browser's custom groups; `current` is the group every selected session
	 * shares (or null), and `anyGrouped` offers Ungrouped.
	 */
	customGroup?:
	{
		groups: readonly
		{
			id: string;
			name: string;
		}[];
		current: string | null;
		anyGrouped: boolean;
	};
}

/**
 * claude.ai/code's multi-select row menu, limited to the actions the app has:
 * Mark as unread (or read), Move {count} to group ▸ (with New group…) and Archive.
 * Delete is never offered, and neither are per-session items like Rename or Pin.
 */
export function getBulkSessionMenuItems({
	count,
	allUnread,
	anyUnarchived,
	customGroup,
}: BulkSessionMenuSelection): SessionMenuEntry[]
{
	const readId = allUnread ? "mark-read" : "mark-unread";
	const sections: SessionMenuItem[][] = [
		[
			{
				kind: "item",
				id: readId,
				label: sessionMenuItemLabels[readId],
				accelerator: "u",
			},
		],
	];
	if (customGroup !== undefined)
	{
		sections.push([
			moveToGroupItem(
				{
					groups: customGroup.groups,
					current: customGroup.current,
					grouped: customGroup.anyGrouped,
				},
				`Move ${count} to section`,
			),
		]);
	}
	if (anyUnarchived)
	{
		sections.push([
			{
				kind: "item",
				id: "archive",
				label: sessionMenuItemLabels.archive,
				accelerator: "a",
			},
		]);
	}
	return sections.flatMap((section, index): SessionMenuEntry[] =>
		index === 0
			? section
			: [
					{
						kind: "separator",
					},
					...section,
				],
	);
}

/**
 * Upstream's "Transcript view ▸": Normal · Thinking (only when the session has some) ·
 * Verbose as radios, then "Make {Mode} the default" when the session differs from it.
 */
export function transcriptViewMenuItem({mode, defaultMode, hasThinking}: TranscriptViewState): SessionMenuItem
{
	const entries: SessionMenuEntry[] = TRANSCRIPT_MODES.filter((option) => hasThinking || option !== "thinking").map(
		(option) => (
		{
			kind: "item",
			id: "transcript-mode",
			label: transcriptModeLabels[option],
			transcriptMode: option,
			checked: option === mode,
		}),
	);
	if (mode !== defaultMode)
	{
		entries.push(
			{
				kind: "separator",
			},
			{
				kind: "item",
				id: "make-default-transcript-mode",
				label: `Make ${transcriptModeLabels[mode]} the default`,
			},
		);
	}
	return {
		kind: "item",
		id: "transcript-view",
		label: sessionMenuItemLabels["transcript-view"],
		submenu: entries,
	};
}

function paletteName(title: string): string
{
	return title.length > PALETTE_TITLE_LENGTH ? `${title.slice(0, PALETTE_TITLE_LENGTH)}…` : title;
}

export function getSessionMenuItems(
	session: SessionMenuSession,
	capabilities: ReadonlySet<SessionMenuCapability>,
	{
		surface,
	}:
	{
		surface: SessionMenuSurface;
	},
): SessionMenuEntry[]
{
	const has = (capability: SessionMenuCapability) => capabilities.has(capability);
	const item = (id: AcceleratedId): SessionMenuItem => (
	{
		kind: "item",
		id,
		label: sessionMenuItemLabels[id],
		accelerator: ACCELERATORS[id],
	});

	// Upstream's order: editors, Terminal, (local live terminal), Desktop app, then the file manager.
	const openInTargets: Array<[SessionMenuItemId, boolean]> = [
		["open-vscode", session.cwd !== null && has("openVsCode")],
		["open-terminal", session.cwd !== null && has("openTerminal")],
		["open-live-terminal", session.hasLiveTerminal && has("openLiveTerminal")],
		["open-claude-ai", session.bridgeSessionId !== null && has("openClaudeAi")],
		["open-finder", session.cwd !== null && has("openFinder")],
	];
	const openIn = openInTargets.flatMap(([id, offered]): SessionMenuItem[] =>
		offered
			? [
					{
						kind: "item",
						id,
						label: sessionMenuItemLabels[id],
					},
				]
			: [],
	);

	// Upstream's open group: Open PR with its visible `g` shortcut, then the Open in submenu.
	const navigation: SessionMenuItem[] = [];
	if (session.prUrl !== null && has("openPr")) navigation.push(item("open-pr"));
	if (openIn.length > 0)
	{
		navigation.push(
			{
				kind: "item",
				id: "open-in",
				label: sessionMenuItemLabels["open-in"],
				submenu: numbered(openIn),
			},
		);
	}

	// Upstream's `pinReorder` block: omitted at the ends, so a single pin gets neither.
	const pinReorder: SessionMenuItem[] = [];
	const position = session.pinPosition;
	if (surface === "row" && session.pinned && position !== undefined)
	{
		const reorder = (id: "move-up" | "move-down"): SessionMenuItem => (
		{
			kind: "item",
			id,
			label: sessionMenuItemLabels[id],
		});
		if (position.index > 0) pinReorder.push(reorder("move-up"));
		if (position.index < position.count - 1) pinReorder.push(reorder("move-down"));
	}

	const actions: SessionMenuItem[] = [];
	if (surface !== "header" && has("pin")) actions.push(item(session.pinned ? "unpin" : "pin"));
	const readState: SessionMenuItem[] = [];
	if (surface === "row" || surface === "palette-card")
	{
		// Upstream `Ct` / `wt`: an in-progress row keeps its toggle disabled, and `u` goes to whichever item is enabled.
		const inProgress = session.readState === "working" || session.readState === "awaiting";
		const offerCompleted =
			has("ackAwaiting") &&
			!session.archived &&
			session.liveApproval !== true &&
			(session.readState === "awaiting" || (session.failed === true && session.readState !== "working"));
		// Upstream's ⌘K card omits the toggle while in progress (`dt = ut && !lt`).
		const toggle = has("readState") && !(inProgress && surface === "palette-card");
		if (toggle)
		{
			const unread = inProgress ? session.unread === true : session.readState === "unread";
			const id = unread ? "mark-read" : "mark-unread";
			const entry: SessionMenuItem =
			{
				kind: "item",
				id,
				label: sessionMenuItemLabels[id],
			};
			if (!(inProgress && offerCompleted)) entry.accelerator = ACCELERATORS[id];
			if (inProgress)
			{
				entry.disabled = true;
				entry.disabledReason = READ_TOGGLE_IN_PROGRESS_REASON;
			}
			readState.push(entry);
		}
		if (offerCompleted)
		{
			readState.push(
				toggle && !inProgress
					?
						{
							kind: "item",
							id: "mark-completed",
							label: sessionMenuItemLabels["mark-completed"],
						}
					: item("mark-completed"),
			);
		}
	}
	if (surface === "row") actions.push(...readState);
	// Upstream puts Copy link in its own share group after Fork on rows and the title menu.
	const copyLinkBlock: SessionMenuItem[] = [];
	if (has("rename")) actions.push(item("rename"));
	if (has("copyLink")) (surface === "header" || surface === "row" ? copyLinkBlock : actions).push(item("copy-link"));
	if (has("fork"))
	{
		actions.push(
			session.forkDisabledReason === null
				? item("fork")
				:
					{
						...item("fork"),
						disabled: true,
						disabledReason: session.forkDisabledReason,
					},
		);
	}
	// Upstream's `kh` gate: only a family head's row menu ends its edit group with the fold toggle.
	if (surface === "row" && session.nestedSessions !== undefined)
	{
		actions.push(
			{
				kind: "item",
				id: "toggle-nested-sessions",
				label: session.nestedSessions.hidden ? "Show nested sessions" : "Hide nested sessions",
			},
		);
	}

	const grouping: SessionMenuItem[] = [];
	if (surface === "row" && has("customGroups") && session.customGroup !== undefined)
	{
		grouping.push(moveToGroupItem(session.customGroup));
	}

	const settingsBlock: SessionMenuItem[] = [];
	if (surface === "header" && session.transcriptView !== undefined)
	{
		settingsBlock.push(transcriptViewMenuItem(session.transcriptView));
	}

	// An archived session's header leaves Unarchive to the composer note, as upstream passes the header no onUnarchive.
	const lifecycle: SessionMenuItem[] = [];
	if (has("archive") && !(surface === "header" && session.archived))
	{
		lifecycle.push(item(session.archived ? "unarchive" : "archive"));
	}

	if (surface === "palette-card")
	{
		const pick = (...ids: SessionMenuItemId[]) =>
			[...actions, ...lifecycle].filter((entry) => ids.includes(entry.id));
		return [
			...pick("copy-link"),
			...pick("pin", "unpin"),
			...pick("rename"),
			...pick("archive", "unarchive"),
			...readState,
		].map(({kind, id, label}) => (
		{
			kind,
			id,
			label,
		}));
	}

	if (surface === "palette")
	{
		const name = paletteName(session.title);
		return [...actions, ...lifecycle].flatMap((entry) =>
		{
			if (!isKeyOf(PALETTE_LABELS, entry.id)) return [];
			const label = PALETTE_LABELS[entry.id](name);
			const command: SessionMenuItem =
			{
				kind: "item",
				id: entry.id,
				label,
			};
			if (entry.disabledReason !== undefined)
			{
				command.disabled = true;
				command.disabledReason = entry.disabledReason;
			}
			return [command];
		});
	}

	const sections = [navigation, pinReorder, actions, copyLinkBlock, grouping, settingsBlock, lifecycle].filter(
		(section) => section.length > 0,
	);
	return sections.flatMap((section, index): SessionMenuEntry[] =>
		index === 0
			? section
			: [
					{
						kind: "separator",
					},
					...section,
				],
	);
}
