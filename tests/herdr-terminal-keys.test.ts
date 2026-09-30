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
		expect(terminalHandlesKey(keyEvent(init))).toBe(handled);
	});
});
