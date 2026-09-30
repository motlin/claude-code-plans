/**
 * Central keyboard shortcut registry, copied from the claude.ai/code web
 * registry (see .llm/upstream-sync/features/shortcuts-dialog.md). Every entry
 * lists its mac and non-mac bindings explicitly. Entries stay `enabled: false`
 * until their owner feature wires a handler with `useShortcut`, so the
 * shortcuts dialog never advertises a dead key.
 */

export type ShortcutModifier = "cmd" | "ctrl" | "alt" | "shift";
/** "non-mac" covers both Windows and Linux; "windows" and "linux" narrow it. */
export type ShortcutPlatform = "mac" | "non-mac" | "windows" | "linux";
export type ShortcutGroup = "general" | "panes" | "composer";

export interface Binding {
	/** `KeyboardEvent.key`, lower-cased. */
	key: string;
	/** `KeyboardEvent.code`; when set, matching is layout-independent. */
	code?: string;
	modifiers: readonly ShortcutModifier[];
	/** Omitted means the binding applies on every platform. */
	platform?: ShortcutPlatform;
}

export interface ShortcutDefinition {
	description: string;
	group: ShortcutGroup;
	bindings: readonly Binding[];
	/** Feature slug in .llm/upstream-sync/features.md that owns the wiring. */
	ownerSlug: string;
	enabled: boolean;
	/** Keys string for display when the bindings are a range, e.g. "1…9". */
	displayKeys?: string;
	/** Registered and bound, but upstream's ⌘/ dialog has no row for it. */
	hiddenFromDialog?: true;
}

function macAndNonMac(
	key: string,
	macModifiers: readonly ShortcutModifier[],
	nonMacModifiers: readonly ShortcutModifier[],
	code?: string,
): Binding[] {
	const codePart = code === undefined ? {} : {code};
	return [
		{key, ...codePart, modifiers: macModifiers, platform: "mac"},
		{key, ...codePart, modifiers: nonMacModifiers, platform: "non-mac"},
	];
}

/** ⌘ on mac, Ctrl elsewhere, plus the shared extra modifiers. */
function cmdOrCtrl(key: string, extra: readonly ShortcutModifier[] = [], code?: string): Binding[] {
	return macAndNonMac(key, ["cmd", ...extra], ["ctrl", ...extra], code);
}

/** The same physical Ctrl chord on every platform. */
function ctrlEverywhere(key: string, extra: readonly ShortcutModifier[] = [], code?: string): Binding[] {
	const modifiers: ShortcutModifier[] = ["ctrl", ...extra];
	return macAndNonMac(key, modifiers, modifiers, code);
}

/** One binding shared by every platform. */
function everywhere(key: string, modifiers: readonly ShortcutModifier[], code?: string): Binding {
	return code === undefined ? {key, modifiers} : {key, code, modifiers};
}

function letterCode(letter: string): string {
	return `Key${letter.toUpperCase()}`;
}

const DIGITS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"] as const;

export const SHORTCUTS = {
	// General
	search_or_start: {
		description: "Search or start a session",
		group: "general",
		bindings: cmdOrCtrl("k"),
		ownerSlug: "search-or-start",
		enabled: true,
	},
	search: {
		description: "Search",
		group: "general",
		bindings: cmdOrCtrl("k", ["shift"]),
		ownerSlug: "search",
		enabled: true,
	},
	switch_recents: {
		description: "Switch between recents",
		group: "general",
		bindings: [
			{key: "q", code: "KeyQ", modifiers: ["ctrl"], platform: "mac"},
			{key: "q", code: "KeyQ", modifiers: ["ctrl"], platform: "linux"},
			{key: "q", code: "KeyQ", modifiers: ["alt"], platform: "windows"},
		],
		ownerSlug: "switch-recents",
		enabled: true,
	},
	toggle_sidebar: {
		description: "Toggle sidebar",
		group: "general",
		bindings: cmdOrCtrl("b"),
		ownerSlug: "sidebar-shell",
		enabled: true,
	},
	shortcuts_modal: {
		description: "Keyboard shortcuts",
		group: "general",
		bindings: cmdOrCtrl("/", [], "Slash"),
		ownerSlug: "shortcuts-dialog",
		enabled: true,
	},
	settings: {
		description: "Settings",
		group: "general",
		bindings: cmdOrCtrl(",", ["shift"], "Comma"),
		ownerSlug: "account-menu",
		enabled: true,
	},
	new_session: {
		description: "New session",
		group: "general",
		bindings: cmdOrCtrl("o", ["shift"]),
		ownerSlug: "home-page",
		enabled: true,
	},
	rename_session: {
		description: "Rename session",
		group: "general",
		bindings: cmdOrCtrl("r", ["alt"], letterCode("r")),
		ownerSlug: "session-row-actions",
		enabled: true,
	},
	archive_session: {
		description: "Archive session",
		group: "general",
		bindings: cmdOrCtrl("a", ["alt"], letterCode("a")),
		ownerSlug: "session-row-actions",
		enabled: true,
	},
	toggle_read_session: {
		description: "Mark session as read/unread",
		group: "general",
		bindings: cmdOrCtrl("u", ["alt"], letterCode("u")),
		ownerSlug: "session-row-actions",
		enabled: true,
	},
	copy_session_link: {
		description: "Copy session link",
		group: "general",
		bindings: cmdOrCtrl("l", ["alt"], letterCode("l")),
		ownerSlug: "session-row-actions",
		enabled: true,
	},
	open_session_pr: {
		description: "Open session PR",
		group: "general",
		bindings: cmdOrCtrl("g", ["alt"], letterCode("g")),
		ownerSlug: "pr-status",
		enabled: true,
	},
	fork_session: {
		description: "Fork session",
		group: "general",
		bindings: cmdOrCtrl("o", ["alt"], letterCode("o")),
		ownerSlug: "session-row-actions",
		enabled: true,
	},
	transcript_view: {
		description: "Transcript view",
		group: "general",
		bindings: ctrlEverywhere("o", [], letterCode("o")),
		ownerSlug: "transcript-view",
		enabled: true,
	},
	jump_prev_prompt: {
		description: "Jump to previous prompt",
		group: "general",
		bindings: macAndNonMac("arrowup", ["cmd", "alt"], ["alt"], "ArrowUp"),
		ownerSlug: "prompt-jump",
		enabled: true,
	},
	jump_next_prompt: {
		description: "Jump to next prompt",
		group: "general",
		bindings: macAndNonMac("arrowdown", ["cmd", "alt"], ["alt"], "ArrowDown"),
		ownerSlug: "prompt-jump",
		enabled: true,
	},
	focus_next_region: {
		description: "Focus next region",
		group: "general",
		bindings: [everywhere("f6", [], "F6"), ...cmdOrCtrl("f6", [], "F6")],
		ownerSlug: "focus-regions",
		enabled: true,
		hiddenFromDialog: true,
	},
	focus_previous_region: {
		description: "Focus previous region",
		group: "general",
		bindings: [everywhere("f6", ["shift"], "F6")],
		ownerSlug: "focus-regions",
		enabled: true,
		hiddenFromDialog: true,
	},
	stop_response: {
		description: "Stop Claude's response",
		group: "general",
		bindings: macAndNonMac("escape", [], []),
		ownerSlug: "stop-response",
		enabled: true,
	},
	// Panes
	toggle_changes: {
		description: "Toggle changes",
		group: "panes",
		bindings: ctrlEverywhere("d", ["shift"]),
		ownerSlug: "panes-changes",
		enabled: true,
	},
	toggle_changes_file_list: {
		description: "Toggle file list in changes or files",
		group: "panes",
		bindings: ctrlEverywhere("y", ["shift"]),
		ownerSlug: "panes-changes",
		enabled: true,
	},
	go_to_file_in_changes: {
		description: "Go to file in changes",
		group: "panes",
		bindings: cmdOrCtrl("p"),
		ownerSlug: "panes-changes",
		enabled: true,
	},
	toggle_preview: {
		description: "Toggle preview",
		group: "panes",
		bindings: cmdOrCtrl("p", ["alt"], letterCode("p")),
		ownerSlug: "panes-preview",
		enabled: false,
	},
	select_element_in_preview: {
		description: "Select element in preview",
		group: "panes",
		bindings: cmdOrCtrl("s", ["shift"]),
		ownerSlug: "panes-preview",
		enabled: false,
	},
	toggle_files: {
		description: "Toggle Files",
		group: "panes",
		bindings: cmdOrCtrl("f", ["shift"]),
		ownerSlug: "panes-files",
		enabled: true,
	},
	attach_selection: {
		description: "Attach selection as context",
		group: "panes",
		bindings: cmdOrCtrl("l", ["shift"]),
		ownerSlug: "composer",
		enabled: true,
	},
	toggle_terminal: {
		description: "Toggle terminal",
		group: "panes",
		bindings: ctrlEverywhere("`", [], "Backquote"),
		ownerSlug: "panes-terminal",
		enabled: true,
	},
	close_pane: {
		description: "Close pane",
		group: "panes",
		bindings: cmdOrCtrl("\\", [], "Backslash"),
		ownerSlug: "panes-mgmt",
		enabled: true,
	},
	expand_collapse_pane: {
		description: "Expand or collapse pane",
		group: "panes",
		bindings: cmdOrCtrl("\\", ["shift"], "Backslash"),
		ownerSlug: "panes-mgmt",
		enabled: true,
	},
	toggle_side_chat: {
		description: "Toggle side chat",
		group: "panes",
		bindings: cmdOrCtrl(";", [], "Semicolon"),
		ownerSlug: "panes-side-chat",
		enabled: true,
	},
	// Composer
	open_mode_menu: {
		description: "Open mode menu",
		group: "composer",
		bindings: cmdOrCtrl("m", ["alt"], letterCode("m")),
		ownerSlug: "composer",
		enabled: true,
	},
	open_model_menu: {
		description: "Open model menu",
		group: "composer",
		bindings: cmdOrCtrl("i", ["shift"]),
		ownerSlug: "composer",
		enabled: true,
	},
	open_effort_selector: {
		description: "Open effort selector",
		group: "composer",
		bindings: cmdOrCtrl("e", ["shift"]),
		ownerSlug: "composer",
		enabled: true,
	},
	select_menu_item: {
		description: "Select menu item",
		group: "composer",
		bindings: DIGITS.map((digit): Binding => ({
			key: digit,
			code: `Digit${digit}`,
			modifiers: [],
		})),
		ownerSlug: "composer",
		enabled: true,
		displayKeys: "1…9",
	},
	add_files: {
		description: "Add files or photos",
		group: "composer",
		bindings: cmdOrCtrl("u"),
		ownerSlug: "composer",
		enabled: true,
	},
	fork_with_prompt: {
		description: "Fork with this prompt",
		group: "composer",
		bindings: cmdOrCtrl("enter", ["alt"], "Enter"),
		ownerSlug: "composer",
		enabled: true,
	},
} as const satisfies Record<string, ShortcutDefinition>;

export type ShortcutId = keyof typeof SHORTCUTS;

/** Registry ids in upstream dialog order. */
export const SHORTCUT_IDS = Object.keys(SHORTCUTS) as ShortcutId[];

export function getShortcut(id: ShortcutId): ShortcutDefinition {
	return SHORTCUTS[id];
}

/** "cmd+shift+k"-style keys string for one binding, in the order written. */
export function bindingToKeys(binding: Binding): string {
	return [...binding.modifiers, binding.key].join("+");
}
