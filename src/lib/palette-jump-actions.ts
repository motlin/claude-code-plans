/**
 * ⌘K jump actions: upstream registry entries (shared-1) that have no key binding, only a palette
 * row reachable by its label, its `searchHints` and its `bang`. They live apart from the keyboard
 * shortcut registry, whose every entry carries bindings.
 */

export interface PaletteJumpAction {
	label: string;
	bang: string;
	searchHints: readonly string[];
}

export const PALETTE_JUMP_ACTIONS = {
	jump_to_navigation: {
		label: "Jump to navigation",
		bang: "!jn",
		searchHints: ["sidebar"],
	},
	jump_to_main_content: {
		label: "Jump to main content",
		bang: "!jm",
		searchHints: ["page", "conversation", "title", "header"],
	},
	jump_to_question: {
		label: "Jump to question",
		bang: "!jq",
		searchHints: ["approval", "Enter your verification code"],
	},
	jump_to_input: {
		label: "Jump to input",
		bang: "!ji",
		searchHints: ["composer", "prompt"],
	},
} as const satisfies Record<string, PaletteJumpAction>;

export type PaletteJumpActionId = keyof typeof PALETTE_JUMP_ACTIONS;

/** Upstream's `Vs`: an action's fuzzy keywords are its search hints followed by its bang. */
export function jumpActionKeywords(id: PaletteJumpActionId): string[] {
	const action: PaletteJumpAction = PALETTE_JUMP_ACTIONS[id];
	return [...action.searchHints, action.bang];
}
