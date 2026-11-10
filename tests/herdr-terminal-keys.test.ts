import {describe, expect, it} from "vite-plus/test";
import {terminalHandlesKey} from "../src/lib/herdr/terminal-keys";

interface KeyInit {
	key: string;
	code: string;
	ctrlKey?: boolean;
	metaKey?: boolean;
	altKey?: boolean;
	shiftKey?: boolean;
}

function keyEvent(init: KeyInit) {
	return {
		ctrlKey: false,
		metaKey: false,
		altKey: false,
		shiftKey: false,
		getModifierState: () => false,
		...init,
	};
}

describe("terminal key passthrough", () => {
	it.each([
		["⌃`", {key: "`", code: "Backquote", ctrlKey: true}, false],
		["⌃Q", {key: "q", code: "KeyQ", ctrlKey: true}, false],
		["⌘K", {key: "k", code: "KeyK", metaKey: true}, false],
		["⌘/", {key: "/", code: "Slash", metaKey: true}, false],
		["plain q", {key: "q", code: "KeyQ"}, true],
		["⌃C", {key: "c", code: "KeyC", ctrlKey: true}, true],
		["⌃K", {key: "k", code: "KeyK", ctrlKey: true}, true],
		["⌃⇧Q", {key: "Q", code: "KeyQ", ctrlKey: true, shiftKey: true}, true],
		["⌘⇧K", {key: "K", code: "KeyK", metaKey: true, shiftKey: true}, true],
		["Enter", {key: "Enter", code: "Enter"}, true],
	] satisfies Array<[string, KeyInit, boolean]>)("%s → terminal handles: %s", (_, init, handled) => {
		expect(terminalHandlesKey(keyEvent(init), true)).toBe(handled);
	});

	it("leaves the herdr terminal keys to the app on each platform, and their other-platform chords to the TUI", () => {
		const chords: Array<[string, KeyInit]> = [
			["split right", {key: "d", code: "KeyD", altKey: true}],
			["split down", {key: "D", code: "KeyD", altKey: true, shiftKey: true}],
			["close pane", {key: "\\", code: "Backslash", altKey: true}],
			["rename tab", {key: "e", code: "KeyE", altKey: true}],
			["next pane", {key: "]", code: "BracketRight", altKey: true}],
			["previous pane", {key: "[", code: "BracketLeft", altKey: true}],
		];
		const handled = (isMac: boolean, modifier: "metaKey" | "ctrlKey") =>
			Object.fromEntries(
				chords.map(([name, init]) => [name, terminalHandlesKey(keyEvent({...init, [modifier]: true}), isMac)]),
			);
		expect({
			mac: handled(true, "metaKey"),
			nonMac: handled(false, "ctrlKey"),
			macCtrl: handled(true, "ctrlKey"),
		}).toStrictEqual({
			mac: Object.fromEntries(chords.map(([name]) => [name, false])),
			nonMac: Object.fromEntries(chords.map(([name]) => [name, false])),
			macCtrl: Object.fromEntries(chords.map(([name]) => [name, true])),
		});
	});
});
