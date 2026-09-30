// @vitest-environment jsdom

import {act, cleanup, renderHook} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {useCommandPalette} from "../src/hooks/use-command-palette";
import {useShortcut} from "../src/hooks/use-shortcut";
import {isEditableTarget, isInModalLayer, matchBinding} from "../src/lib/shortcuts/match";

interface KeyInit {
	key: string;
	code?: string;
	metaKey?: boolean;
	ctrlKey?: boolean;
	altKey?: boolean;
	shiftKey?: boolean;
	repeat?: boolean;
}

function keyEvent(init: KeyInit): KeyboardEvent {
	return new KeyboardEvent("keydown", {bubbles: true, cancelable: true, ...init});
}

function press(init: KeyInit, target: EventTarget = document.body): KeyboardEvent {
	const event = keyEvent(init);
	act(() => {
		target.dispatchEvent(event);
	});
	return event;
}

function setMac(isMac: boolean) {
	vi.spyOn(navigator, "userAgent", "get").mockReturnValue(
		isMac
			? "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
			: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36",
	);
}

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	document.body.innerHTML = "";
});

describe("matchBinding", () => {
	it("requires strict modifier equality", () => {
		const binding = {key: "k", modifiers: ["cmd" as const]};
		expect(matchBinding(keyEvent({key: "k", metaKey: true}), binding)).toBe(true);
		expect(matchBinding(keyEvent({key: "K", metaKey: true, shiftKey: true}), binding)).toBe(false);
		expect(matchBinding(keyEvent({key: "k", ctrlKey: true}), binding)).toBe(false);
		expect(matchBinding(keyEvent({key: "k"}), binding)).toBe(false);
	});

	it("matches ⇧⌘K via the lower-cased key", () => {
		const binding = {key: "k", modifiers: ["cmd" as const, "shift" as const]};
		expect(matchBinding(keyEvent({key: "K", metaKey: true, shiftKey: true}), binding)).toBe(true);
	});

	it("matches on event.code when the binding has one", () => {
		const binding = {key: "r", code: "KeyR", modifiers: ["cmd" as const, "alt" as const]};
		expect(matchBinding(keyEvent({key: "®", code: "KeyR", metaKey: true, altKey: true}), binding)).toBe(true);
		expect(matchBinding(keyEvent({key: "r", code: "KeyT", metaKey: true, altKey: true}), binding)).toBe(false);
	});

	it("does not match a ctrl+alt binding while AltGraph is held", () => {
		const binding = {key: "p", code: "KeyP", modifiers: ["ctrl" as const, "alt" as const]};
		const event = keyEvent({key: "p", code: "KeyP", ctrlKey: true, altKey: true});
		expect(matchBinding(event, binding)).toBe(true);
		vi.spyOn(event, "getModifierState").mockImplementation((k) => k === "AltGraph");
		expect(matchBinding(event, binding)).toBe(false);
	});
});

describe("guards", () => {
	it("treats text inputs, textareas, selects and contenteditable as editable", () => {
		document.body.innerHTML = `
      <input id="text" /><input id="checkbox" type="checkbox" /><textarea id="area"></textarea>
      <select id="sel"></select><div contenteditable="true"><p id="rich">x</p></div><button id="btn"></button>`;
		const byId = (id: string) => document.getElementById(id);
		expect(isEditableTarget(byId("text"))).toBe(true);
		expect(isEditableTarget(byId("checkbox"))).toBe(false);
		expect(isEditableTarget(byId("area"))).toBe(true);
		expect(isEditableTarget(byId("sel"))).toBe(true);
		expect(isEditableTarget(byId("rich"))).toBe(true);
		expect(isEditableTarget(byId("btn"))).toBe(false);
		expect(isEditableTarget(null)).toBe(false);
	});

	it("detects modal layers", () => {
		document.body.innerHTML = `
      <div role="dialog"><button id="in-dialog"></button></div>
      <div role="dialog" aria-modal="false"><button id="non-modal"></button></div>
      <div role="menu"><button id="in-menu"></button></div>
      <div data-radix-popper-content-wrapper><button id="in-popper"></button></div>
      <button id="outside"></button>`;
		const byId = (id: string) => document.getElementById(id);
		expect(isInModalLayer(byId("in-dialog"))).toBe(true);
		expect(isInModalLayer(byId("non-modal"))).toBe(false);
		expect(isInModalLayer(byId("in-menu"))).toBe(true);
		expect(isInModalLayer(byId("in-popper"))).toBe(true);
		expect(isInModalLayer(byId("outside"))).toBe(false);
	});
});

describe("useShortcut", () => {
	beforeEach(() => setMac(true));

	it("calls the handler and prevents default on a match", () => {
		const handler = vi.fn();
		renderHook(() => useShortcut("search_or_start", handler));
		const event = press({key: "k", metaKey: true});
		expect(handler).toHaveBeenCalledTimes(1);
		expect(event.defaultPrevented).toBe(true);
	});

	it("swallows auto-repeat without calling the handler", () => {
		const handler = vi.fn();
		renderHook(() => useShortcut("search_or_start", handler));
		const event = press({key: "k", metaKey: true, repeat: true});
		expect(handler).not.toHaveBeenCalled();
		expect(event.defaultPrevented).toBe(true);
	});

	it("ignores non-matching keys", () => {
		const handler = vi.fn();
		renderHook(() => useShortcut("search_or_start", handler));
		const event = press({key: "K", metaKey: true, shiftKey: true});
		expect(handler).not.toHaveBeenCalled();
		expect(event.defaultPrevented).toBe(false);
	});

	it("fires in editable targets by default and skips them when allowInEditable is false", () => {
		document.body.innerHTML = `<textarea id="area"></textarea>`;
		const area = document.getElementById("area")!;
		const allowed = vi.fn();
		const {unmount} = renderHook(() => useShortcut("search_or_start", allowed));
		press({key: "k", metaKey: true}, area);
		expect(allowed).toHaveBeenCalledTimes(1);
		unmount();

		const skipped = vi.fn();
		renderHook(() => useShortcut("search_or_start", skipped, {allowInEditable: false}));
		const event = press({key: "k", metaKey: true}, area);
		expect(skipped).not.toHaveBeenCalled();
		expect(event.defaultPrevented).toBe(false);
	});

	it("is suppressed while focus is inside a dialog unless allowInModal", () => {
		document.body.innerHTML = `<div role="dialog"><button id="inside"></button></div>`;
		const inside = document.getElementById("inside")!;
		inside.focus();
		const blocked = vi.fn();
		const {unmount} = renderHook(() => useShortcut("search_or_start", blocked));
		press({key: "k", metaKey: true}, inside);
		expect(blocked).not.toHaveBeenCalled();
		unmount();

		const allowed = vi.fn();
		renderHook(() => useShortcut("search_or_start", allowed, {allowInModal: true}));
		press({key: "k", metaKey: true}, inside);
		expect(allowed).toHaveBeenCalledTimes(1);
	});

	it("does nothing when disabled", () => {
		const handler = vi.fn();
		renderHook(() => useShortcut("search_or_start", handler, {disabled: true}));
		press({key: "k", metaKey: true});
		expect(handler).not.toHaveBeenCalled();
	});

	it("lets the most recently registered handler at the highest priority claim the event", () => {
		const order: string[] = [];
		renderHook(() => useShortcut("search_or_start", () => void order.push("low")));
		renderHook(() => useShortcut("search_or_start", () => void order.push("high"), {priority: 10}));
		renderHook(() => useShortcut("search_or_start", () => void order.push("later")));
		press({key: "k", metaKey: true});
		expect(order).toEqual(["high"]);
	});

	it("falls through when a handler declines by returning false", () => {
		const order: string[] = [];
		renderHook(() => useShortcut("search_or_start", () => void order.push("first")));
		renderHook(() =>
			useShortcut("search_or_start", () => {
				order.push("declined");
				return false;
			}),
		);
		press({key: "k", metaKey: true});
		expect(order).toEqual(["declined", "first"]);
	});
});

describe("useCommandPalette", () => {
	it("toggles on ⌘K on mac", () => {
		setMac(true);
		const {result} = renderHook(() => useCommandPalette());
		press({key: "k", metaKey: true});
		expect(result.current.open).toBe(true);
		press({key: "k", metaKey: true});
		expect(result.current.open).toBe(false);
	});

	it("ignores Ctrl+K on mac", () => {
		setMac(true);
		const {result} = renderHook(() => useCommandPalette());
		const event = press({key: "k", ctrlKey: true});
		expect(result.current.open).toBe(false);
		expect(event.defaultPrevented).toBe(false);
	});

	it("toggles on Ctrl+K off mac and ignores Meta+K there", () => {
		setMac(false);
		const {result} = renderHook(() => useCommandPalette());
		press({key: "k", metaKey: true});
		expect(result.current.open).toBe(false);
		press({key: "k", ctrlKey: true});
		expect(result.current.open).toBe(true);
	});

	it("closes with ⌘K while focus is inside the open palette dialog", () => {
		setMac(true);
		document.body.innerHTML = `<div role="dialog"><input id="palette-input" /></div>`;
		const input = document.getElementById("palette-input")!;
		input.focus();
		const {result} = renderHook(() => useCommandPalette());
		act(() => result.current.onOpenChange(true));
		press({key: "k", metaKey: true}, input);
		expect(result.current.open).toBe(false);
	});
});
