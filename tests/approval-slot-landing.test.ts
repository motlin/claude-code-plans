// @vitest-environment jsdom

import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {
	clearLanding,
	installLandingKeys,
	landedOnCard,
	landingAllowsPick,
	landingSeams,
	recordLanding,
	resetLandingWindow,
	swallowEnterAfterFocusLoss,
	trackWindowFocus,
} from "../src/lib/approval-slot-landing";

let now = 0;

beforeEach(() => {
	now = 1000;
	vi.spyOn(performance, "now").mockImplementation(() => now);
	vi.spyOn(landingSeams, "isTrusted").mockReturnValue(true);
	installLandingKeys(window);
});

afterEach(() => {
	endEnterSwallows();
	clearLanding(window);
	vi.restoreAllMocks();
	document.body.replaceChildren();
});

function key(target: Element, init: KeyboardEventInit): KeyboardEvent {
	const event = new KeyboardEvent("keydown", {bubbles: true, cancelable: true, ...init});
	target.dispatchEvent(event);
	return event;
}

/** A focused card root and a composer, landed on the card at `now`. */
function landOnCard({chordActsAnywhere = false}: {chordActsAnywhere?: boolean} = {}) {
	const slot = document.createElement("div");
	const card = document.createElement("div");
	card.tabIndex = -1;
	slot.append(card);
	const composer = document.createElement("textarea");
	document.body.append(slot, composer);
	card.focus();
	const toComposer = vi.fn<(from: Element) => void>(() => {
		composer.focus();
	});
	recordLanding(window, {at: card, onCard: true, from: slot, drawn: () => ({chordActsAnywhere, toComposer})});
	return {slot, card, composer, toComposer};
}

describe("the landing registry's window keys", () => {
	it("swallows Enter on a landed card until a fresh pick at least 400ms after the landing", () => {
		const {card} = landOnCard();
		now += 100;
		const early = key(card, {key: "Enter"}).defaultPrevented;
		now += 350;
		const unpicked = key(card, {key: "Enter"}).defaultPrevented;
		const arrow = new KeyboardEvent("keydown", {key: "ArrowDown"});
		Object.defineProperty(arrow, "target", {value: card});
		const allows = landingAllowsPick(arrow, true);
		now += 50;
		const picked = key(card, {key: "Enter"}).defaultPrevented;
		const repeat = key(card, {key: "Enter", repeat: true}).defaultPrevented;
		expect({early, unpicked, allows, picked, repeat}).toStrictEqual({
			early: true,
			unpicked: true,
			allows: true,
			picked: false,
			repeat: true,
		});
	});

	it("refuses a pick under 400ms, and allows any pick when nothing landed", () => {
		const {card} = landOnCard();
		now += 100;
		const arrow = new KeyboardEvent("keydown", {key: "ArrowDown"});
		Object.defineProperty(arrow, "target", {value: card});
		const early = landingAllowsPick(arrow, true);
		clearLanding(window);
		const unlanded = landingAllowsPick(arrow, true);
		expect({early, unlanded}).toStrictEqual({early: false, unlanded: true});
	});

	it("forgets the window's focus history on reset, as a fresh page starts", () => {
		trackWindowFocus(window);
		now = 50_000;
		window.dispatchEvent(new Event("focus"));
		window.dispatchEvent(new Event("blur"));
		now = 1000;
		const arrowOn = (card: Element) => {
			const arrow = new KeyboardEvent("keydown", {key: "ArrowDown"});
			Object.defineProperty(arrow, "target", {value: card});
			return arrow;
		};
		const before = landOnCard();
		now += 400;
		const stale = landingAllowsPick(arrowOn(before.card), false);
		resetLandingWindow(window);
		const after = landOnCard();
		now += 400;
		const fresh = landingAllowsPick(arrowOn(after.card), false);
		expect({stale, fresh}).toStrictEqual({stale: false, fresh: true});
	});

	it("swallows ⇧⌘⏎ unless the card's chord acts anywhere, and passes ⌘⏎", () => {
		const question = landOnCard();
		now += 600;
		const shifted = key(question.card, {key: "Enter", metaKey: true, shiftKey: true}).defaultPrevented;
		const chord = key(question.card, {key: "Enter", metaKey: true}).defaultPrevented;
		clearLanding(window);
		const plan = landOnCard({chordActsAnywhere: true});
		const planShifted = key(plan.card, {key: "Enter", metaKey: true, shiftKey: true}).defaultPrevented;
		expect({shifted, chord, planShifted}).toStrictEqual({shifted: true, chord: false, planShifted: false});
	});

	it("types a letter through to the composer, but keeps digits and space on the card", () => {
		const {card, slot, composer, toComposer} = landOnCard();
		key(card, {key: "3"});
		key(card, {key: " "});
		const afterDigits = {calls: toComposer.mock.calls.length, active: document.activeElement === card};
		key(card, {key: "a"});
		expect({afterDigits, calls: toComposer.mock.calls, active: document.activeElement === composer}).toStrictEqual({
			afterDigits: {calls: 0, active: true},
			calls: [[slot]],
			active: true,
		});
	});

	it("clears the landing on a pointerdown inside the card", () => {
		const {card} = landOnCard();
		card.dispatchEvent(new MouseEvent("pointerdown", {bubbles: true}));
		expect(landedOnCard(card)).toBe(false);
	});

	it("clears the landing when focus leaves the card", () => {
		const {card} = landOnCard();
		const before = landedOnCard(card);
		card.blur();
		expect({before, after: landedOnCard(card)}).toStrictEqual({before: true, after: false});
	});

	it("clears a composer landing on the first non-repeat key", () => {
		const slot = document.createElement("div");
		const composer = document.createElement("textarea");
		document.body.append(slot, composer);
		composer.focus();
		const toComposer = vi.fn<() => void>();
		recordLanding(window, {
			at: composer,
			onCard: false,
			from: slot,
			drawn: () => ({chordActsAnywhere: false, toComposer}),
		});
		// While the entry stands, ⇧⌘⏎ is still swallowed; a repeat key keeps it, a fresh key clears it.
		key(composer, {key: "x", repeat: true});
		const held = key(composer, {key: "Enter", metaKey: true, shiftKey: true}).defaultPrevented;
		key(composer, {key: "x"});
		const cleared = key(composer, {key: "Enter", metaKey: true, shiftKey: true}).defaultPrevented;
		expect({held, cleared, toComposer: toComposer.mock.calls}).toStrictEqual({
			held: true,
			cleared: false,
			toComposer: [],
		});
	});
});

describe("swallowEnterAfterFocusLoss", () => {
	it("swallows a plain Enter for 500ms, and lets it through after", () => {
		const stop = swallowEnterAfterFocusLoss(document);
		now += 100;
		const early = key(document.body, {key: "Enter"}).defaultPrevented;
		now += 500;
		const late = key(document.body, {key: "Enter"}).defaultPrevented;
		stop();
		expect({early, late}).toStrictEqual({early: true, late: false});
	});

	it("re-arms on a repeat Enter, and always swallows the repeat", () => {
		const stop = swallowEnterAfterFocusLoss(document);
		now += 400;
		const repeat = key(document.body, {key: "Enter", repeat: true}).defaultPrevented;
		now += 400;
		const rearmed = key(document.body, {key: "Enter"}).defaultPrevented;
		stop();
		expect({repeat, rearmed}).toStrictEqual({repeat: true, rearmed: true});
	});

	it("ignores a bare modifier, and passes and ends on a modified Enter or any other key", () => {
		swallowEnterAfterFocusLoss(document);
		key(document.body, {key: "Shift"});
		const afterModifier = key(document.body, {key: "Enter"}).defaultPrevented;
		const shifted = key(document.body, {key: "Enter", shiftKey: true}).defaultPrevented;
		const afterShifted = key(document.body, {key: "Enter"}).defaultPrevented;
		swallowEnterAfterFocusLoss(document);
		key(document.body, {key: "x"});
		const afterLetter = key(document.body, {key: "Enter"}).defaultPrevented;
		expect({afterModifier, shifted, afterShifted, afterLetter}).toStrictEqual({
			afterModifier: true,
			shifted: false,
			afterShifted: false,
			afterLetter: false,
		});
	});

	it("re-arms 500ms on a focusin within 1s when focus was on the body", () => {
		const stop = swallowEnterAfterFocusLoss(document, true);
		const field = document.createElement("input");
		document.body.append(field);
		now += 800;
		field.focus();
		now += 400;
		const rearmed = key(field, {key: "Enter"}).defaultPrevented;
		stop();
		expect(rearmed).toBe(true);
	});
});

/** Ends any Enter swallow a landing left on the shared document (it ends on the next plain key). */
function endEnterSwallows() {
	document.dispatchEvent(new KeyboardEvent("keydown", {key: "Unidentified"}));
}
