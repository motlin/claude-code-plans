// @vitest-environment jsdom

import {afterEach, describe, expect, it} from "vite-plus/test";

import {isAnotherOverlayOpen, OPEN_OVERLAY_SELECTOR, OVERLAY_ATTR, overlayAttrs} from "../src/lib/overlay";

function overlay(open: boolean, parent: Element = document.body): HTMLDivElement {
	const element = document.createElement("div");
	element.setAttribute("data-cds-overlay", "");
	if (open) element.setAttribute("data-open", "");
	parent.append(element);
	return element;
}

function child(parent: Element): HTMLSpanElement {
	const element = document.createElement("span");
	parent.append(element);
	return element;
}

afterEach(() => {
	document.body.replaceChildren();
});

describe("overlay marker constants", () => {
	it("match upstream's gT, T8 and fc", () => {
		expect({OVERLAY_ATTR, OPEN_OVERLAY_SELECTOR, overlayAttrs}).toStrictEqual({
			OVERLAY_ATTR: "data-cds-overlay",
			OPEN_OVERLAY_SELECTOR: "[data-cds-overlay][data-open]",
			overlayAttrs: {"data-cds-overlay": ""},
		});
	});
});

describe("isAnotherOverlayOpen (upstream zI)", () => {
	it("is false in an empty document", () => {
		expect([isAnotherOverlayOpen(), isAnotherOverlayOpen(document)]).toStrictEqual([false, false]);
	});

	it("is true for the document while a marked overlay is open", () => {
		overlay(true);
		expect([isAnotherOverlayOpen(document), isAnotherOverlayOpen()]).toStrictEqual([true, true]);
	});

	it("is false while the overlay is exiting or kept mounted closed", () => {
		overlay(false);
		expect(isAnotherOverlayOpen(document)).toBe(false);
	});

	it("is false for the only open overlay and anything inside it", () => {
		const only = overlay(true);
		const inner = child(only);
		expect([isAnotherOverlayOpen(only), isAnotherOverlayOpen(inner)]).toStrictEqual([false, false]);
	});

	it("is true for an overlay and its child when a second overlay is open elsewhere", () => {
		const first = overlay(true);
		const inner = child(first);
		overlay(true);
		expect([isAnotherOverlayOpen(first), isAnotherOverlayOpen(inner)]).toStrictEqual([true, true]);
	});

	it("is true for an outer overlay when an open overlay is nested inside it", () => {
		const outer = overlay(true);
		overlay(true, outer);
		expect(isAnotherOverlayOpen(outer)).toBe(true);
	});

	it("ignores an open element without the marker", () => {
		const element = document.createElement("div");
		element.setAttribute("data-open", "");
		document.body.append(element);
		expect(isAnotherOverlayOpen(document)).toBe(false);
	});

	it("checks a detached element against its owner document, as upstream does", () => {
		overlay(true);
		const detached = document.createElement("div");
		expect(isAnotherOverlayOpen(detached)).toBe(true);
	});
});
