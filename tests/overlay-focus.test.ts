// @vitest-environment jsdom

import {afterEach, describe, expect, it} from "vite-plus/test";

import {
	EDITABLE_SELECTOR,
	isModalDialog,
	MAX_CHAIN,
	nextOpenOverlayAfter,
	openModalAncestor,
	overlayHoldingFocus,
	registerDialogPopup,
	registerOpenerReturn,
	safeFocusTarget,
	walkOpenerChain,
} from "../src/lib/overlay-focus";

function el<K extends keyof HTMLElementTagNameMap>(
	tag: K,
	parent: Element = document.body,
	attrs: Record<string, string> = {},
): HTMLElementTagNameMap[K] {
	const element = document.createElement(tag);
	for (const [name, value] of Object.entries(attrs)) element.setAttribute(name, value);
	parent.append(element);
	return element;
}

afterEach(() => {
	document.body.replaceChildren();
});

describe("overlay-focus constants", () => {
	it("match upstream's Ms and FB", () => {
		expect({MAX_CHAIN, EDITABLE_SELECTOR}).toStrictEqual({
			MAX_CHAIN: 8,
			EDITABLE_SELECTOR:
				"input:not([type='hidden']):not([disabled]),[contenteditable]:not([contenteditable='false']),textarea:not([disabled])",
		});
	});
});

describe("registerDialogPopup / isModalDialog (upstream FV, Kb, Ha)", () => {
	it("tells modal from non-modal and ignores unregistered elements and null", () => {
		const modal = el("div");
		const plain = el("div");
		const other = el("div");
		registerDialogPopup(modal, true);
		registerDialogPopup(plain, false);
		registerDialogPopup(null, true);
		expect([isModalDialog(modal), isModalDialog(plain), isModalDialog(other)]).toStrictEqual([true, false, false]);
	});
});

describe("walkOpenerChain (upstream Wm)", () => {
	it("walks through a registered menu's getter into the registered dialog holding the trigger", () => {
		const dialog = el("div");
		registerDialogPopup(dialog, true);
		const trigger = el("button", dialog);
		const menu = el("div");
		registerOpenerReturn(menu, () => trigger);
		const item = el("div", el("div", menu));
		expect(walkOpenerChain(item)).toStrictEqual({targets: [trigger], dialog});
	});

	it("stops on a non-modal dialog too, and returns no dialog when none is reached", () => {
		const plain = el("div");
		registerDialogPopup(plain, false);
		const inner = el("button", plain);
		const loose = el("button");
		expect([walkOpenerChain(inner), walkOpenerChain(loose), walkOpenerChain(null)]).toStrictEqual([
			{targets: [], dialog: plain},
			{targets: [], dialog: null},
			{targets: [], dialog: null},
		]);
	});

	it("stops after 8 hops, on a null getter, on a self-cycle and on a repeat", () => {
		const menus = Array.from({length: 10}, () => el("div"));
		menus.forEach((menu, index) => {
			const next = menus[index + 1];
			registerOpenerReturn(menu, () => next ?? null);
		});
		const nullMenu = el("div");
		registerOpenerReturn(nullMenu, () => null);
		const selfMenu = el("div");
		registerOpenerReturn(selfMenu, () => selfMenu);
		const a = el("div");
		const b = el("div");
		registerOpenerReturn(a, () => b);
		registerOpenerReturn(b, () => a);
		expect([
			walkOpenerChain(menus[0] ?? null).targets,
			walkOpenerChain(nullMenu),
			walkOpenerChain(selfMenu),
			walkOpenerChain(a),
		]).toStrictEqual([
			menus.slice(1, 9),
			{targets: [], dialog: null},
			{targets: [], dialog: null},
			{targets: [b, a], dialog: null},
		]);
	});
});

describe("overlayHoldingFocus (upstream bD)", () => {
	it("returns the open overlay holding focus, else null", () => {
		const popup = el("div", document.body, {"data-cds-overlay": "", "data-open": ""});
		const inside = el("button", popup);
		const closed = el("div", document.body, {"data-cds-overlay": ""});
		const inClosed = el("button", closed);
		const open = el("div", document.body, {"data-cds-overlay": "", "data-open": ""});
		const inOpen = el("button", el("div", open));
		const results: (Element | null)[] = [];
		(document.activeElement as HTMLElement | null)?.blur();
		results.push(overlayHoldingFocus(document, popup));
		inside.focus();
		results.push(overlayHoldingFocus(document, popup));
		inClosed.focus();
		results.push(overlayHoldingFocus(document, popup));
		inOpen.focus();
		results.push(overlayHoldingFocus(document, popup));
		expect(results).toStrictEqual([null, null, null, open]);
	});
});

describe("nextOpenOverlayAfter (upstream uY)", () => {
	it("returns the first open overlay after the element, skipping earlier, closed and inert/aria-hidden ones", () => {
		const earlier = el("div", document.body, {"data-cds-overlay": "", "data-open": ""});
		const parent = el("div", document.body, {"data-cds-overlay": "", "data-open": ""});
		el("div", document.body, {"data-cds-overlay": ""});
		el("div", el("div", document.body, {inert: ""}), {"data-cds-overlay": "", "data-open": ""});
		el("div", el("div", document.body, {"aria-hidden": "true"}), {"data-cds-overlay": "", "data-open": ""});
		expect(nextOpenOverlayAfter(document, parent)).toBe(null);
		const later = el("div", document.body, {"data-cds-overlay": "", "data-open": ""});
		expect([nextOpenOverlayAfter(document, parent), nextOpenOverlayAfter(document, earlier)]).toStrictEqual([
			later,
			parent,
		]);
	});
});

describe("openModalAncestor (upstream op)", () => {
	it("returns the nearest open registered modal dialog ancestor", () => {
		const outer = el("div", document.body, {"data-open": ""});
		registerDialogPopup(outer, true);
		const closedModal = el("div", outer);
		registerDialogPopup(closedModal, true);
		const plain = el("div", closedModal, {"data-open": ""});
		registerDialogPopup(plain, false);
		const leaf = el("span", plain);
		expect([openModalAncestor(leaf), openModalAncestor(el("span"))]).toStrictEqual([outer, null]);
	});
});

describe("safeFocusTarget (upstream TH)", () => {
	it("refuses a disconnected target", () => {
		expect(safeFocusTarget(document.createElement("button"), null)).toBe(false);
	});

	it("refuses while focus sits in an editable field outside the popup, but not inside it", () => {
		const popup = el("div");
		const target = el("button");
		const field = el("input");
		field.focus();
		const outside = safeFocusTarget(target, popup);
		const inField = el("textarea", popup);
		inField.focus();
		expect([outside, safeFocusTarget(target, popup)]).toStrictEqual([false, target]);
	});

	it("refuses while focus sits in another open modal dialog that does not hold the target", () => {
		const modal = el("div", document.body, {"data-open": ""});
		registerDialogPopup(modal, true);
		const inModal = el("button", modal);
		const target = el("button");
		const targetInModal = el("button", modal);
		inModal.focus();
		expect([safeFocusTarget(target, null), safeFocusTarget(targetInModal, null)]).toStrictEqual([
			false,
			targetInModal,
		]);
	});

	it("focuses a tabIndex<0 target itself and returns false", () => {
		const target = el("div");
		target.tabIndex = -1;
		const calls: unknown[] = [];
		const focus = target.focus.bind(target);
		target.focus = (options?: FocusOptions) => {
			calls.push(options);
			focus(options);
		};
		expect([safeFocusTarget(target, null), document.activeElement === target, calls]).toStrictEqual([
			false,
			true,
			[{preventScroll: true}],
		]);
	});

	it("returns a normal button", () => {
		const button = el("button");
		expect(safeFocusTarget(button, null)).toBe(button);
	});
});
