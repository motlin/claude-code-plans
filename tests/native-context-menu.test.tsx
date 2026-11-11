// @vitest-environment jsdom

import {cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, describe, expect, it} from "vite-plus/test";

import {
	NATIVE_MENU_TARGETS,
	preventNativeContextMenu,
	preventNativeMenuOutsideText,
	suppressesNativeMenu,
} from "../src/lib/native-context-menu";

afterEach(() => {
	cleanup();
	document.body.replaceChildren();
	document.getSelection()?.removeAllRanges();
});

/* A popup root holding plain text, an input, a link and an image, as upstream's `ik` sees them. */
function buildRoot(): {
	root: HTMLDivElement;
	span: HTMLSpanElement;
	input: HTMLInputElement;
	link: HTMLAnchorElement;
	img: HTMLImageElement;
} {
	const root = document.createElement("div");
	const span = document.createElement("span");
	span.textContent = "Plain words";
	const input = document.createElement("input");
	const link = document.createElement("a");
	link.href = "https://example.invalid/";
	link.textContent = "A link";
	const img = document.createElement("img");
	root.append(span, input, link, img);
	document.body.append(root);
	return {root, span, input, link, img};
}

/** Dispatches a real `contextmenu` on `target` and asks `suppressesNativeMenu` from a listener on `listenOn`. */
function verdict(target: Element, root: Element, {listenOn = root, prevented = false} = {}): boolean {
	let result: boolean | undefined;
	listenOn.addEventListener(
		"contextmenu",
		(nativeEvent) => {
			result = suppressesNativeMenu(
				{defaultPrevented: prevented || nativeEvent.defaultPrevented, nativeEvent},
				root,
			);
		},
		{once: true},
	);
	target.dispatchEvent(new MouseEvent("contextmenu", {bubbles: true, cancelable: true, composed: true}));
	if (result === undefined) throw new Error("listener did not run");
	return result;
}

describe("suppressesNativeMenu (upstream ik)", () => {
	it("keeps upstream's native-menu target selector verbatim", () => {
		expect(NATIVE_MENU_TARGETS).toBe(
			'input, textarea, select, [contenteditable]:not([contenteditable="false"]), a[href], img, video, audio, [role="menu"]',
		);
	});

	it("suppresses on plain text but keeps the browser menu on inputs, links and images", () => {
		const {root, span, input, link, img} = buildRoot();

		expect([span, input, link, img].map((target) => verdict(target, root))).toStrictEqual([
			true,
			false,
			false,
			false,
		]);
	});

	it("keeps the browser menu when a non-blank selection touches the root", () => {
		const {root, span} = buildRoot();
		const range = document.createRange();
		range.selectNodeContents(span);
		document.getSelection()?.addRange(range);

		expect(verdict(span, root)).toBe(false);
	});

	it("ignores a blank selection", () => {
		const {root, span} = buildRoot();
		const blank = document.createElement("span");
		blank.textContent = "   ";
		root.append(blank);
		const range = document.createRange();
		range.selectNodeContents(blank);
		document.getSelection()?.addRange(range);

		expect(verdict(span, root)).toBe(true);
	});

	it("keeps the browser menu when the event is already prevented", () => {
		const {root, span} = buildRoot();

		expect(verdict(span, root, {prevented: true})).toBe(false);
	});

	it("keeps the browser menu when the root is not on the event's path (a portaled event)", () => {
		const {root} = buildRoot();
		const outside = document.createElement("div");
		document.body.append(outside);

		expect(verdict(outside, root, {listenOn: document.body})).toBe(false);
	});
});

describe("popup onContextMenu handlers", () => {
	it("preventNativeContextMenu (upstream qw) prevents every right-click in the popup, links included", () => {
		render(
			<div role="menu" tabIndex={-1} onContextMenu={preventNativeContextMenu}>
				<span>Copy message</span>
				<a href="https://example.invalid/">A link</a>
			</div>,
		);

		expect([
			!fireEvent.contextMenu(screen.getByText("Copy message")),
			!fireEvent.contextMenu(screen.getByText("A link")),
		]).toStrictEqual([true, true]);
	});

	it("preventNativeMenuOutsideText (upstream I0) prevents on plain popover text but keeps the browser menu on a link", () => {
		render(
			<div onContextMenu={preventNativeMenuOutsideText}>
				<span>Outputs</span>
				<a href="https://example.invalid/">A link</a>
			</div>,
		);

		expect([
			!fireEvent.contextMenu(screen.getByText("Outputs")),
			!fireEvent.contextMenu(screen.getByText("A link")),
		]).toStrictEqual([true, false]);
	});
});
