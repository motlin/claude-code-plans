import {describe, expect, it} from "vite-plus/test";

import {bindingsFor} from "../src/lib/shortcuts/match";
import {
	SHORTCUT_IDS,
	SHORTCUTS,
	type Binding,
	bindingToKeys,
	getShortcut,
	type ShortcutId,
} from "../src/lib/shortcuts/registry";

const BROWSER_RESERVED = new Set(["l", "t", "w", "n"]);
const DIGIT_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];

function chord(binding: Binding): string {
	return bindingToKeys(binding);
}

describe("shortcut registry", () => {
	it("lists the 43 upstream web entries plus the page-scoped and Settings ⌘F searches and the desktop-only ⌥⌘F", () => {
		expect(SHORTCUT_IDS).toHaveLength(46);
	});

	it("binds upstream's Settings ⌘F search, sharing the page ⌘F and kept out of the ⌘/ dialog", () => {
		expect({
			definition: getShortcut("settings_search"),
			mac: bindingsFor("settings_search", true).map(bindingToKeys),
			windows: bindingsFor("settings_search", false, true).map(bindingToKeys),
		}).toStrictEqual({
			definition: {
				description: "Search settings",
				group: "general",
				bindings: [
					{key: "f", modifiers: ["cmd"], platform: "mac"},
					{key: "f", modifiers: ["ctrl"], platform: "non-mac"},
				],
				ownerSlug: "settings-search-popover",
				enabled: true,
				hiddenFromDialog: true,
				sharesBindingWith: "page_search",
			},
			mac: ["cmd+f"],
			windows: ["ctrl+f"],
		});
	});

	it("binds upstream's desktop-only ⌥⌘F Toggle fast mode, kept out of the web ⌘/ dialog", () => {
		expect({
			definition: getShortcut("toggle_fast_mode"),
			mac: bindingsFor("toggle_fast_mode", true).map(bindingToKeys),
			windows: bindingsFor("toggle_fast_mode", false, true).map(bindingToKeys),
		}).toStrictEqual({
			definition: {
				description: "Toggle fast mode",
				group: "composer",
				bindings: [
					{key: "f", code: "KeyF", modifiers: ["cmd", "alt"], platform: "mac"},
					{key: "f", code: "KeyF", modifiers: ["ctrl", "alt"], platform: "non-mac"},
				],
				ownerSlug: "fast-mode-toggle",
				enabled: true,
				hiddenFromDialog: true,
			},
			mac: ["cmd+alt+f"],
			windows: ["ctrl+alt+f"],
		});
	});

	it.each(SHORTCUT_IDS)("%s has mac and Windows bindings", (id) => {
		expect(bindingsFor(id, true).length).toBeGreaterThan(0);
		expect(bindingsFor(id, false, true).length).toBeGreaterThan(0);
	});

	it("binds every entry on Linux except the environment pickers, which upstream skips on Linux web", () => {
		expect(SHORTCUT_IDS.filter((id) => bindingsFor(id, false, false).length === 0)).toStrictEqual([
			"select_environment",
			"new_environment",
		]);
	});

	it("never binds browser-reserved ⌘L / ⌘T / ⌘W / ⌘N", () => {
		const offenders = SHORTCUT_IDS.flatMap((id) =>
			SHORTCUTS[id].bindings
				.filter(
					(b) =>
						BROWSER_RESERVED.has(b.key) &&
						b.modifiers.length === 1 &&
						(b.modifiers[0] === "cmd" || (b.modifiers[0] === "ctrl" && b.platform !== "mac")),
				)
				.map((b) => `${id}: ${chord(b)}`),
		);
		expect(offenders).toEqual([]);
	});

	it("never gives two enabled entries the same binding on a platform, unless they declare sharesBindingWith", () => {
		const sharesWith = (a: ShortcutId, b: ShortcutId) =>
			getShortcut(a).sharesBindingWith === b || getShortcut(b).sharesBindingWith === a;
		for (const isMac of [true, false]) {
			const seen = new Map<string, ShortcutId>();
			const duplicates: string[] = [];
			for (const id of SHORTCUT_IDS.filter((i) => SHORTCUTS[i].enabled)) {
				for (const b of bindingsFor(id, isMac)) {
					const key = chord(b);
					const prior = seen.get(key);
					if (prior !== undefined && !sharesWith(prior, id)) duplicates.push(`${prior} and ${id}: ${key}`);
					seen.set(key, id);
				}
			}
			expect(duplicates).toEqual([]);
		}
	});

	it("lets only Settings search share ⌘F with page search, Rewind share Esc with Stop, and Queue for later share ⌘⏎ with Send and stay", () => {
		expect(
			SHORTCUT_IDS.flatMap((id) => {
				const other = getShortcut(id).sharesBindingWith;
				return other === undefined ? [] : [[id, other]];
			}),
		).toStrictEqual([
			["settings_search", "page_search"],
			["rewind_session", "stop_response"],
			["send_and_stay", "queue_for_later"],
		]);
	});

	it("registers the 2026-10 upstream entries with upstream's bindings", () => {
		const mac = (id: ShortcutId) => bindingsFor(id, true).map(bindingToKeys);
		const windows = (id: ShortcutId) => bindingsFor(id, false, true).map(bindingToKeys);
		const linux = (id: ShortcutId) => bindingsFor(id, false, false).map(bindingToKeys);
		const ids = [
			"select_environment",
			"new_environment",
			"rewind_session",
			"next_change",
			"prev_change",
			"queue_for_later",
			"send_and_stay",
		] as const;
		expect(
			Object.fromEntries(
				ids.map((id) => [
					id,
					{
						description: SHORTCUTS[id].description,
						mac: mac(id),
						windows: windows(id),
						linux: linux(id),
						displayKeys: getShortcut(id).displayKeys,
					},
				]),
			),
		).toStrictEqual({
			select_environment: {
				description: "Select environment",
				mac: DIGIT_KEYS.map((d) => `cmd+alt+${d}`),
				windows: DIGIT_KEYS.map((d) => `alt+${d}`),
				linux: [],
				displayKeys: {mac: "cmd+alt+1…9", nonMac: "alt+1…9"},
			},
			new_environment: {
				description: "New environment",
				mac: ["cmd+alt+0"],
				windows: ["alt+0"],
				linux: [],
				displayKeys: undefined,
			},
			rewind_session: {
				description: "Rewind the session to an earlier message",
				mac: ["escape"],
				windows: ["escape"],
				linux: ["escape"],
				displayKeys: "esc esc",
			},
			next_change: {
				description: "Next change in changes",
				mac: ["alt+f5", "f7"],
				windows: ["alt+f5", "f7"],
				linux: ["f7"],
				displayKeys: undefined,
			},
			prev_change: {
				description: "Previous change in changes",
				mac: ["shift+alt+f5", "shift+f7"],
				windows: ["shift+alt+f5", "shift+f7"],
				linux: ["shift+f7"],
				displayKeys: undefined,
			},
			queue_for_later: {
				description: "Queue for later (while Claude is working)",
				mac: ["cmd+enter"],
				windows: ["ctrl+enter"],
				linux: ["ctrl+enter"],
				displayKeys: undefined,
			},
			send_and_stay: {
				description: "Send and stay on the new session page",
				mac: ["cmd+enter"],
				windows: ["ctrl+enter"],
				linux: ["ctrl+enter"],
				displayKeys: undefined,
			},
		});
	});

	it("only enables the shortcuts wired today", () => {
		expect(SHORTCUT_IDS.filter((id) => SHORTCUTS[id].enabled)).toEqual([
			"search_or_start",
			"search",
			"switch_recents",
			"toggle_sidebar",
			"shortcuts_modal",
			"settings",
			"new_session",
			"select_environment",
			"new_environment",
			"rename_session",
			"archive_session",
			"toggle_read_session",
			"copy_session_link",
			"open_session_pr",
			"fork_session",
			"jump_prev_prompt",
			"jump_next_prompt",
			"transcript_view",
			"focus_next_region",
			"focus_previous_region",
			"page_search",
			"settings_search",
			"stop_response",
			"rewind_session",
			"toggle_changes",
			"toggle_changes_file_list",
			"go_to_file_in_changes",
			"toggle_files",
			"attach_selection",
			"toggle_terminal",
			"close_pane",
			"expand_collapse_pane",
			"toggle_side_chat",
			"open_mode_menu",
			"open_model_menu",
			"open_effort_selector",
			"select_menu_item",
			"toggle_fast_mode",
			"add_files",
			"queue_for_later",
			"send_and_stay",
			"fork_with_prompt",
		]);
	});

	it("binds F6 (plus ⌘F6 / Ctrl+F6) forward and ⇧F6 backward", () => {
		expect({
			nextMac: bindingsFor("focus_next_region", true),
			nextNonMac: bindingsFor("focus_next_region", false),
			previous: bindingsFor("focus_previous_region", true),
		}).toStrictEqual({
			nextMac: [
				{key: "f6", code: "F6", modifiers: []},
				{key: "f6", code: "F6", modifiers: ["cmd"], platform: "mac"},
			],
			nextNonMac: [
				{key: "f6", code: "F6", modifiers: []},
				{key: "f6", code: "F6", modifiers: ["ctrl"], platform: "non-mac"},
			],
			previous: [{key: "f6", code: "F6", modifiers: ["shift"]}],
		});
	});

	it("binds ⌥⌘↑ / ⌥⌘↓ on mac and Alt+↑ / Alt+↓ elsewhere", () => {
		expect({
			prevMac: bindingsFor("jump_prev_prompt", true),
			prevNonMac: bindingsFor("jump_prev_prompt", false),
			nextMac: bindingsFor("jump_next_prompt", true),
			nextNonMac: bindingsFor("jump_next_prompt", false),
		}).toStrictEqual({
			prevMac: [{key: "arrowup", code: "ArrowUp", modifiers: ["cmd", "alt"], platform: "mac"}],
			prevNonMac: [{key: "arrowup", code: "ArrowUp", modifiers: ["alt"], platform: "non-mac"}],
			nextMac: [{key: "arrowdown", code: "ArrowDown", modifiers: ["cmd", "alt"], platform: "mac"}],
			nextNonMac: [{key: "arrowdown", code: "ArrowDown", modifiers: ["alt"], platform: "non-mac"}],
		});
	});

	it("binds ⌘K strictly on mac and Ctrl+K elsewhere", () => {
		expect(bindingsFor("search_or_start", true)).toEqual([{key: "k", modifiers: ["cmd"], platform: "mac"}]);
		expect(bindingsFor("search_or_start", false)).toEqual([{key: "k", modifiers: ["ctrl"], platform: "non-mac"}]);
	});
});
