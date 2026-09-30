import {z} from "zod";

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

/** Waiting rows get "Mark as completed"; working rows get no read-state item. */
export type SessionMenuReadState = "working" | "awaiting" | "unread" | "read";

/** Blocked rows are awaiting input; finished rows are read or unread by the unseen flag. */
export function sessionMenuReadState(bucket: SessionBucket | undefined, unseen: boolean): SessionMenuReadState {
	if (bucket === "working") return "working";
	if (bucket === "blocked") return "awaiting";
	return unseen ? "unread" : "read";
}

export interface SessionMenuSession {
	title: string;
	pinned: boolean;
	readState: SessionMenuReadState;
	archived: boolean;
	prUrl: string | null;
	hasLivePane: boolean;
	forkDisabledReason: string | null;
	/** Directory the session runs in; Terminal, VS Code and Finder need it. */
	cwd: string | null;
	/** claude.ai/code session the transcript's `bridge-session` record points at. */
	bridgeSessionId: string | null;
	/** Where a pinned row sits in the sidebar Pinned section; enables Move up / Move down. */
	pinPosition?: {index: number; count: number};
	/** This browser's custom groups and the row's current one; enables Move to group. */
	customGroup?: {groups: readonly {id: string; name: string}[]; current: string | null};
	/** The session's transcript view; enables the header's Transcript view submenu. */
	transcriptView?: TranscriptViewState;
}

export interface TranscriptViewState {
	mode: TranscriptMode;
	defaultMode: TranscriptMode;
	hasThinking: boolean;
}

export interface SessionMenuItem {
	kind: "item";
	id: SessionMenuItemId;
	label: string;
	/** Single key that fires the item while the menu is open. */
	accelerator?: string;
	/** The accelerator works but no keycap hint is drawn, like upstream's `g` for Open PR. */
	hiddenAccelerator?: true;
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

export interface SessionMenuSeparator {
	kind: "separator";
}

/** A key that fires an action while the menu is open, with no visible item. */
export interface SessionMenuHotkey {
	kind: "hotkey";
	id: SessionMenuItemId;
	accelerator: string;
}

export type SessionMenuEntry = SessionMenuItem | SessionMenuSeparator | SessionMenuHotkey;

const ACCELERATORS = {
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
const PALETTE_LABELS = {
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

function numbered(entries: SessionMenuEntry[]): SessionMenuEntry[] {
	let digit = 0;
	return entries.map((entry) => {
		if (entry.kind !== "item") return entry;
		digit += 1;
		return digit > MAX_DIGIT ? entry : {...entry, accelerator: String(digit)};
	});
}

/**
 * Upstream's "Move to group ▸": the groups as radios, a separator, Ungrouped
 * (only when the row is grouped) and New group…, numbered 1…9 in that order.
 */
function moveToGroupItem(
	{groups, current, grouped = current !== null}: NonNullable<SessionMenuSession["customGroup"]> & {grouped?: boolean},
	label: string = sessionMenuItemLabels["move-to-group"],
): SessionMenuItem {
	const entries: SessionMenuEntry[] = groups.map((group) => ({
		kind: "item",
		id: "move-to-custom-group",
		label: group.name,
		groupId: group.id,
		checked: group.id === current,
	}));
	if (entries.length > 0) entries.push({kind: "separator"});
	if (grouped) {
		entries.push({
			kind: "item",
			id: "ungroup",
			label: sessionMenuItemLabels.ungroup,
			checked: false,
		});
	}
	entries.push({kind: "item", id: "new-group", label: sessionMenuItemLabels["new-group"]});
	return {kind: "item", id: "move-to-group", label, submenu: numbered(entries)};
}

export interface BulkSessionMenuSelection {
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
	customGroup?: {
		groups: readonly {id: string; name: string}[];
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
}: BulkSessionMenuSelection): SessionMenuEntry[] {
	const readId = allUnread ? "mark-read" : "mark-unread";
	const sections: SessionMenuItem[][] = [
		[{kind: "item", id: readId, label: sessionMenuItemLabels[readId], accelerator: "u"}],
	];
	if (customGroup !== undefined) {
		sections.push([
			moveToGroupItem(
				{
					groups: customGroup.groups,
					current: customGroup.current,
					grouped: customGroup.anyGrouped,
				},
				`Move ${count} to group`,
			),
		]);
	}
	if (anyUnarchived) {
		sections.push([{kind: "item", id: "archive", label: sessionMenuItemLabels.archive, accelerator: "a"}]);
	}
	return sections.flatMap((section, index): SessionMenuEntry[] =>
		index === 0 ? section : [{kind: "separator"}, ...section],
	);
}

/**
 * Upstream's "Transcript view ▸": Normal · Thinking (only when the session has some) ·
 * Verbose as radios, then "Make {Mode} the default" when the session differs from it.
 */
export function transcriptViewMenuItem({mode, defaultMode, hasThinking}: TranscriptViewState): SessionMenuItem {
	const entries: SessionMenuEntry[] = TRANSCRIPT_MODES.filter((option) => hasThinking || option !== "thinking").map(
		(option) => ({
			kind: "item",
			id: "transcript-mode",
			label: transcriptModeLabels[option],
			transcriptMode: option,
			checked: option === mode,
		}),
	);
	if (mode !== defaultMode) {
		entries.push(
			{kind: "separator"},
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

function paletteName(title: string): string {
	return title.length > PALETTE_TITLE_LENGTH ? `${title.slice(0, PALETTE_TITLE_LENGTH)}…` : title;
}

export function getSessionMenuItems(
	session: SessionMenuSession,
	capabilities: ReadonlySet<SessionMenuCapability>,
	{surface}: {surface: SessionMenuSurface},
): SessionMenuEntry[] {
	const has = (capability: SessionMenuCapability) => capabilities.has(capability);
	const item = (id: AcceleratedId): SessionMenuItem => ({
		kind: "item",
		id,
		label: sessionMenuItemLabels[id],
		accelerator: ACCELERATORS[id],
	});

	const openInTargets: Array<[SessionMenuItemId, boolean]> = [
		["open-live-terminal", session.hasLivePane && has("openLiveTerminal")],
		["open-terminal", session.cwd !== null && has("openTerminal")],
		["open-vscode", session.cwd !== null && has("openVsCode")],
		["open-finder", session.cwd !== null && has("openFinder")],
		["open-claude-ai", session.bridgeSessionId !== null && has("openClaudeAi")],
	];
	const openIn = openInTargets.flatMap(([id, offered]): SessionMenuItem[] =>
		offered ? [{kind: "item", id, label: sessionMenuItemLabels[id]}] : [],
	);

	const navigation: SessionMenuItem[] = [];
	const hotkeys: SessionMenuHotkey[] = [];
	const offersPr = session.prUrl !== null && has("openPr");
	if (openIn.length > 0) {
		navigation.push({
			kind: "item",
			id: "open-in",
			label: sessionMenuItemLabels["open-in"],
			submenu: numbered(openIn),
		});
		// Upstream keeps `g` live even when Open in takes the Open PR slot.
		if (offersPr) hotkeys.push({kind: "hotkey", id: "open-pr", accelerator: ACCELERATORS["open-pr"]});
	} else if (offersPr) {
		navigation.push({...item("open-pr"), hiddenAccelerator: true});
	}

	// Upstream's `pinReorder` block: omitted at the ends, so a single pin gets neither.
	const pinReorder: SessionMenuItem[] = [];
	const position = session.pinPosition;
	if (surface === "row" && session.pinned && position !== undefined) {
		const reorder = (id: "move-up" | "move-down"): SessionMenuItem => ({
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
	if (surface === "row" || surface === "palette-card") {
		if (session.readState === "awaiting") {
			if (has("ackAwaiting")) readState.push(item("mark-completed"));
		} else if (session.readState !== "working" && has("readState")) {
			readState.push(item(session.readState === "unread" ? "mark-read" : "mark-unread"));
		}
	}
	if (surface === "row") actions.push(...readState);
	if (has("rename")) actions.push(item("rename"));
	if (has("copyLink")) actions.push(item("copy-link"));
	if (has("fork")) {
		actions.push(
			session.forkDisabledReason === null
				? item("fork")
				: {...item("fork"), disabled: true, disabledReason: session.forkDisabledReason},
		);
	}

	const grouping: SessionMenuItem[] = [];
	if (surface === "row" && has("customGroups") && session.customGroup !== undefined) {
		grouping.push(moveToGroupItem(session.customGroup));
	}

	const settingsBlock: SessionMenuItem[] = [];
	if (surface === "header" && session.transcriptView !== undefined) {
		settingsBlock.push(transcriptViewMenuItem(session.transcriptView));
	}

	const lifecycle: SessionMenuItem[] = [];
	if (has("archive")) lifecycle.push(item(session.archived ? "unarchive" : "archive"));

	if (surface === "palette-card") {
		const pick = (...ids: SessionMenuItemId[]) =>
			[...actions, ...lifecycle].filter((entry) => ids.includes(entry.id));
		return [
			...pick("copy-link"),
			...pick("pin", "unpin"),
			...pick("rename"),
			...pick("archive", "unarchive"),
			...readState,
		].map(({kind, id, label}) => ({kind, id, label}));
	}

	if (surface === "palette") {
		const name = paletteName(session.title);
		return [...actions, ...lifecycle].flatMap((entry) => {
			if (!(entry.id in PALETTE_LABELS)) return [];
			const label = PALETTE_LABELS[entry.id as keyof typeof PALETTE_LABELS](name);
			const command: SessionMenuItem = {kind: "item", id: entry.id, label};
			if (entry.disabledReason !== undefined) {
				command.disabled = true;
				command.disabledReason = entry.disabledReason;
			}
			return [command];
		});
	}

	const sections = [navigation, pinReorder, actions, grouping, settingsBlock, lifecycle].filter(
		(section) => section.length > 0,
	);
	return [
		...sections.flatMap((section, index): SessionMenuEntry[] =>
			index === 0 ? section : [{kind: "separator"}, ...section],
		),
		...hotkeys,
	];
}
