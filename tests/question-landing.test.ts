// @vitest-environment jsdom

import {afterEach, describe, expect, it} from "vite-plus/test";
import {findWaitingCard, landOnWaitingCard, WAITING_CARD_SELECTOR} from "../src/lib/question-landing";

afterEach(() => {
	document.body.innerHTML = "";
});

function mount(html: string): void {
	document.body.innerHTML = html;
}

function byId(id: string): HTMLElement {
	const element = document.getElementById(id);
	if (element === null) throw new Error(`No #${id}`);
	return element;
}

const LANDING = "data-focus-region-landing";

describe("findWaitingCard", () => {
	it("selects approval card roots", () => {
		expect(WAITING_CARD_SELECTOR).toBe("[data-approval-card-root]");
	});

	it("returns null with no cards", () => {
		mount(`<main><p>Nothing pending</p></main><div><div data-focus-region="composer"></div></div>`);
		expect(findWaitingCard(document)).toBeNull();
	});

	it("prefers the dock card beside the composer over an earlier transcript card", () => {
		mount(`
			<main><div id="transcript-card" data-approval-card-root tabindex="-1"></div></main>
			<footer>
				<div data-docked-plan data-approval-card-root id="dock-card"></div>
				<div data-focus-region="composer"></div>
			</footer>`);
		expect(findWaitingCard(document)?.id).toBe("dock-card");
	});

	it("falls back to transcript cards in document order", () => {
		mount(`
			<main>
				<div id="first" data-approval-card-root></div>
				<div id="second" data-approval-card-root></div>
			</main>
			<footer><div data-focus-region="composer"></div></footer>`);
		expect(findWaitingCard(document)?.id).toBe("first");
	});

	it("skips cards inside hidden, inert or aria-hidden subtrees", () => {
		mount(`
			<div hidden><div data-approval-card-root id="hidden"></div></div>
			<div inert><div data-approval-card-root id="inert"></div></div>
			<div aria-hidden="true"><div data-approval-card-root id="aria"></div></div>
			<div data-approval-card-root id="visible"></div>`);
		expect(findWaitingCard(document)?.id).toBe("visible");
	});
});

describe("landOnWaitingCard", () => {
	function landed(): HTMLElement {
		mount(
			`<div data-approval-card-root role="group" tabindex="-1" id="card"><button id="inner">Pick</button></div>`,
		);
		const card = byId("card");
		landOnWaitingCard(card);
		return card;
	}

	it("focuses the card and marks the overlay landing", () => {
		const card = landed();
		expect([document.activeElement === card, card.getAttribute(LANDING)]).toStrictEqual([true, "overlay"]);
	});

	it("keeps the ring through a modifier keydown and clears it on the next key", () => {
		const card = landed();
		card.dispatchEvent(new KeyboardEvent("keydown", {key: "Shift", bubbles: true}));
		const afterShift = card.getAttribute(LANDING);
		card.dispatchEvent(new KeyboardEvent("keydown", {key: "a", bubbles: true}));
		expect([afterShift, card.getAttribute(LANDING)]).toStrictEqual(["overlay", null]);
	});

	it("clears the ring on beforeinput", () => {
		const card = landed();
		card.dispatchEvent(new Event("beforeinput", {bubbles: true}));
		expect(card.getAttribute(LANDING)).toBeNull();
	});

	it("clears the ring on a pointerdown inside the card", () => {
		const card = landed();
		byId("inner").dispatchEvent(new Event("pointerdown", {bubbles: true}));
		expect(card.getAttribute(LANDING)).toBeNull();
	});

	it("clears the ring when focus leaves the card", () => {
		const card = landed();
		card.dispatchEvent(new FocusEvent("focusout", {bubbles: true, relatedTarget: document.body}));
		expect(card.getAttribute(LANDING)).toBeNull();
	});

	it("clears the ring on window blur", () => {
		const card = landed();
		window.dispatchEvent(new Event("blur"));
		expect(card.getAttribute(LANDING)).toBeNull();
	});

	it("stops listening once cleared, so a later landing is not cleared by stale listeners", () => {
		const card = landed();
		card.dispatchEvent(new KeyboardEvent("keydown", {key: "a", bubbles: true}));
		card.setAttribute(LANDING, "overlay");
		window.dispatchEvent(new Event("blur"));
		expect(card.getAttribute(LANDING)).toBe("overlay");
	});
});
