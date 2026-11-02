import {describe, expect, it} from "vite-plus/test";

import {chordFromEvent, chordLabel, shortcutMatcher, stripChordPrefix} from "../src/lib/shortcuts/search";

function textMatches(query: string, label: string, keys: string[], isMac = true): boolean
{
	const matcher = shortcutMatcher(
		{
			by: "text",
			text: query,
		},
		isMac,
	);
	return matcher === null ? true : matcher(label, keys, false);
}

function keyEvent(
	init: Partial<
		KeyboardEventInit &
		{
			keyCode: number;
		}
	>,
)
{
	return {
		key: "",
		code: "",
		metaKey: false,
		ctrlKey: false,
		altKey: false,
		shiftKey: false,
		keyCode: 0,
		...init,
	};
}

describe("shortcutMatcher (text)", () =>
{
	it("returns null for an empty or whitespace query", () =>
	{
		expect([
			shortcutMatcher(
				{
					by: "text",
					text: "",
				},
				true,
			),
			shortcutMatcher(
				{
					by: "text",
					text: "  ",
				},
				true,
			),
		]).toStrictEqual([null, null]);
	});

	it("matches when every term is a substring of the label", () =>
	{
		expect(
			{
				terminal: textMatches("terminal", "Toggle terminal", ["ctrl+`"]),
				twoTerms: textMatches("TOG term", "Toggle terminal", ["ctrl+`"]),
				missing: textMatches("toggle sidebar", "Toggle terminal", ["ctrl+`"]),
			},
		).toStrictEqual(
			{
				terminal: true,
				twoTerms: true,
				missing: false,
			},
		);
	});

	it("matches key names against distinct key parts of one binding", () =>
	{
		expect(
			{
				shiftCmdK: textMatches("cmd shift", "Search", ["shift+cmd+k"]),
				cmdK: textMatches("cmd shift", "Search or start a session", ["cmd+k"]),
				reused: textMatches("cmd cmd", "Search or start a session", ["cmd+k"]),
				plus: textMatches("command+k", "Search or start a session", ["cmd+k"]),
			},
		).toStrictEqual(
			{
				shiftCmdK: true,
				cmdK: false,
				reused: false,
				plus: true,
			},
		);
	});

	it("splits glyphs out of the query", () =>
	{
		expect(
			{
				glyph: textMatches("⌘k", "Search or start a session", ["cmd+k"]),
				wrong: textMatches("⌘j", "Search or start a session", ["cmd+k"]),
			},
		).toStrictEqual(
			{
				glyph: true,
				wrong: false,
			},
		);
	});

	it('reads "arrow up" and "up arrow" as the up key', () =>
	{
		expect(
			{
				arrowUp: textMatches("arrow up", "Jump to previous prompt", ["cmd+alt+arrowup"]),
				upArrow: textMatches("up arrow", "Jump to previous prompt", ["cmd+alt+arrowup"]),
				glyph: textMatches("↑", "Jump to previous prompt", ["cmd+alt+arrowup"]),
				down: textMatches("arrow up", "Jump to next prompt", ["cmd+alt+arrowdown"]),
			},
		).toStrictEqual(
			{
				arrowUp: true,
				upArrow: true,
				glyph: true,
				down: false,
			},
		);
	});

	it("expands digit ranges", () =>
	{
		expect(
			{
				five: textMatches("5", "Select menu item", ["1…9"]),
				zero: textMatches("0", "Select menu item", ["1…9"]),
			},
		).toStrictEqual(
			{
				five: true,
				zero: false,
			},
		);
	});

	it("reads cmd as ctrl off mac", () =>
	{
		expect(
			{
				ctrl: textMatches("ctrl k", "Search or start a session", ["ctrl+k"], false),
				cmd: textMatches("cmd k", "Search or start a session", ["ctrl+k"], false),
			},
		).toStrictEqual(
			{
				ctrl: true,
				cmd: true,
			},
		);
	});

	it("matches sequence steps", () =>
	{
		expect(textMatches("esc esc", "Rewind the session to an earlier message", ["esc esc"])).toBe(true);
	});

	it("matches nothing for gibberish", () =>
	{
		expect(textMatches("zzqx", "Toggle terminal", ["ctrl+`"])).toBe(false);
	});
});

describe("shortcutMatcher (press)", () =>
{
	it("returns null until a chord is pressed", () =>
	{
		expect(
			shortcutMatcher(
				{
					by: "press",
					pressed: null,
				},
				true,
			),
		).toBeNull();
	});

	it("matches rows whose bindings contain the chord, in any modifier order", () =>
	{
		const matcher = shortcutMatcher(
			{
				by: "press",
				pressed:
				{
					all: ["shift+cmd+k"],
					typed: ["shift+cmd+k"],
				},
			},
			true,
		);
		expect([
			matcher?.("Search", ["cmd+shift+k"], false),
			matcher?.("Search or start", ["cmd+k"], false),
		]).toStrictEqual([true, false]);
	});

	it("uses only the typed chords for typed-only rows", () =>
	{
		const matcher = shortcutMatcher(
			{
				by: "press",
				pressed:
				{
					all: ["shift+cmd+/"],
					typed: ["shift+cmd+?"],
				},
			},
			true,
		);
		expect([matcher?.("x", ["shift+cmd+/"], false), matcher?.("x", ["shift+cmd+/"], true)]).toStrictEqual([
			true,
			false,
		]);
	});

	it("normalises key names like escape and arrowup", () =>
	{
		const matcher = shortcutMatcher(
			{
				by: "press",
				pressed:
				{
					all: ["esc"],
					typed: ["esc"],
				},
			},
			true,
		);
		expect([matcher?.("Stop", ["escape"], false), matcher?.("Rewind", ["esc esc"], false)]).toStrictEqual([
			true,
			true,
		]);
	});
});

describe("chordFromEvent", () =>
{
	it("builds ⌘K from code and key", () =>
	{
		expect(
			chordFromEvent(
				keyEvent(
					{
						key: "k",
						code: "KeyK",
						metaKey: true,
					},
				),
				true,
			),
		).toStrictEqual(
			{
				all: ["cmd+k"],
				typed: ["cmd+k"],
			},
		);
	});

	it("ignores modifier-only keys and meta off mac", () =>
	{
		expect([
			chordFromEvent(
				keyEvent(
					{
						key: "Shift",
						code: "ShiftLeft",
						shiftKey: true,
					},
				),
				true,
			),
			chordFromEvent(
				keyEvent(
					{
						key: "k",
						code: "KeyK",
						metaKey: true,
					},
				),
				false,
			),
		]).toStrictEqual([null, null]);
	});

	it("uses the physical key for dead keys", () =>
	{
		expect([
			chordFromEvent(
				keyEvent(
					{
						key: "Dead",
						code: "KeyE",
						altKey: true,
					},
				),
				true,
			),
			chordFromEvent(
				keyEvent(
					{
						key: "Dead",
						code: "IntlBackslash",
					},
				),
				true,
			),
		]).toStrictEqual([
			{
				all: ["alt+e"],
				typed: [],
			},
			null,
		]);
	});

	it("names multi-character keys", () =>
	{
		expect([
			chordFromEvent(
				keyEvent(
					{
						key: "Escape",
						code: "Escape",
					},
				),
				true,
			),
			chordFromEvent(
				keyEvent(
					{
						key: "ArrowUp",
						code: "ArrowUp",
						metaKey: true,
						altKey: true,
					},
				),
				true,
			),
			chordFromEvent(
				keyEvent(
					{
						key: "Delete",
						code: "Delete",
					},
				),
				true,
			),
		]).toStrictEqual([
			{
				all: ["esc"],
				typed: ["esc"],
			},
			{
				all: ["alt+cmd+up"],
				typed: ["alt+cmd+up"],
			},
			{
				all: ["del"],
				typed: ["del"],
			},
		]);
	});

	it("keeps the mac Option letter from keyCode", () =>
	{
		expect(
			chordFromEvent(
				keyEvent(
					{
						key: "®",
						code: "KeyR",
						altKey: true,
						metaKey: true,
						keyCode: 82,
					},
				),
				true,
			),
		).toStrictEqual(
			{
				all: ["alt+cmd+r", "alt+cmd+®"],
				typed: ["alt+cmd+®"],
			},
		);
	});

	it("adds the unshifted chord for shifted symbols", () =>
	{
		expect(
			chordFromEvent(
				keyEvent(
					{
						key: "?",
						code: "Slash",
						shiftKey: true,
						metaKey: true,
					},
				),
				true,
			),
		).toStrictEqual(
			{
				all: ["shift+cmd+/", "shift+cmd+?", "cmd+?"],
				typed: ["shift+cmd+?", "shift+cmd+/"],
			},
		);
	});

	it("reads = as plus too", () =>
	{
		expect(
			chordFromEvent(
				keyEvent(
					{
						key: "=",
						code: "Equal",
						metaKey: true,
					},
				),
				true,
			),
		).toStrictEqual(
			{
				all: ["cmd+=", "cmd+plus"],
				typed: ["cmd+=", "cmd+plus"],
			},
		);
	});
});

describe("chordLabel and stripChordPrefix", () =>
{
	it("renders the chord as glyphs on mac and Ctrl+K elsewhere", () =>
	{
		expect([chordLabel("cmd+k", true), chordLabel("shift+ctrl+k", false)]).toStrictEqual(["⌘K", "Ctrl+Shift+K"]);
	});

	it("strips the chord text typed before the caret", () =>
	{
		expect([
			stripChordPrefix("⌘Kx", "⌘K", 3),
			stripChordPrefix("x", "", 1),
			stripChordPrefix("⌘", "⌘K", 1),
		]).toStrictEqual(["x", "x", ""]);
	});
});
