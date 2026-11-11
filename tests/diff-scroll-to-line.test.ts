// @vitest-environment jsdom

import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {
	DIFF_SCROLL_CANCEL_EVENTS,
	DIFF_SCROLL_HOLD_MS,
	DIFF_SCROLL_MAX_MS,
	DIFF_SCROLL_MAX_TRIES,
	DIFF_SCROLL_RECENTRE_PX,
	findAnchorRow,
	firstRenderedRow,
	initialScrollState,
	scrollParentOf,
	startScrollToLine,
	stepScrollToLine,
} from "../src/lib/diff-scroll-to-line";

function rect(top: number, height: number): DOMRect {
	return {top, bottom: top + height, height, left: 0, right: 100, width: 100, x: 0, y: top, toJSON: () => ({})};
}

function setBox(element: Element, box: () => DOMRect): void {
	Object.defineProperty(element, "getBoundingClientRect", {configurable: true, value: box});
}

/** A scroller (overflow auto) > file element > diffs-container whose open shadow root holds `rows`. */
function buildDiff(rows: string[]) {
	const scroller = document.createElement("div");
	scroller.style.overflowY = "auto";
	let scrollTop = 0;
	Object.defineProperty(scroller, "scrollTop", {
		configurable: true,
		get: () => scrollTop,
		set: (value: number) => {
			scrollTop = value;
		},
	});
	Object.defineProperty(scroller, "clientHeight", {configurable: true, value: 400});
	Object.defineProperty(scroller, "scrollHeight", {configurable: true, value: 20000});
	setBox(scroller, () => rect(0, 400));
	const file = document.createElement("div");
	setBox(file, () => rect(100 - scroller.scrollTop, 10000));
	const host = document.createElement("diffs-container");
	// @pierre/diffs' element attaches its own shadow root once another shared-dom file has registered it.
	const shadow = host.shadowRoot ?? host.attachShadow({mode: "open"});
	const code = document.createElement("div");
	code.innerHTML = rows.join("");
	shadow.append(code);
	file.append(host);
	scroller.append(file);
	document.body.append(scroller);
	return {scroller, file, shadow};
}

const scrolls: {target: Element; options: unknown}[] = [];

beforeEach(() => {
	scrolls.length = 0;
	Element.prototype.scrollIntoView = function scrollIntoView(this: Element, options?: unknown) {
		scrolls.push({target: this, options});
	};
});

afterEach(() => {
	document.body.replaceChildren();
	vi.restoreAllMocks();
});

describe("diff scroll-to-line constants (upstream c44d00c7f dc..hc)", () => {
	it("copies upstream's values", () => {
		expect({
			tries: DIFF_SCROLL_MAX_TRIES,
			hold: DIFF_SCROLL_HOLD_MS,
			max: DIFF_SCROLL_MAX_MS,
			recentre: DIFF_SCROLL_RECENTRE_PX,
			cancel: DIFF_SCROLL_CANCEL_EVENTS,
		}).toStrictEqual({
			tries: 60,
			hold: 500,
			max: 3000,
			recentre: 2,
			cancel: ["wheel", "touchstart", "pointerdown", "keydown"],
		});
	});
});

describe("row lookup (upstream vc, xc, Sc, Cc)", () => {
	it("finds the scrolling ancestor, the side's row, the other side's alt-line row, and the first rendered row", () => {
		const {scroller, file, shadow} = buildDiff([
			'<div data-line="5" data-line-type="change-deletion">old</div>',
			'<div data-line="5" data-line-type="change-addition">new</div>',
			'<div data-line="7" data-alt-line="6" data-line-type="context">ctx</div>',
		]);
		const rows = [...shadow.querySelectorAll("[data-line]")];

		expect({
			parent: scrollParentOf(file) === scroller,
			addition: findAnchorRow(shadow, {side: "additions", line: 5}) === rows[1],
			deletion: findAnchorRow(shadow, {side: "deletions", line: 5}) === rows[0],
			altLine: findAnchorRow(shadow, {side: "deletions", line: 6}) === rows[2],
			missing: findAnchorRow(shadow, {side: "additions", line: 99}),
			firstAddition: firstRenderedRow(shadow, "additions") === rows[1],
			firstDeletion: firstRenderedRow(shadow, "deletions") === rows[0],
		}).toStrictEqual({
			parent: true,
			addition: true,
			deletion: true,
			altLine: true,
			missing: null,
			firstAddition: true,
			firstDeletion: true,
		});
	});

	it("has no scroll parent when nothing scrolls", () => {
		const element = document.createElement("div");
		document.body.append(element);
		expect(scrollParentOf(element)).toBeNull();
	});
});

describe("stepScrollToLine (upstream kc + Oc)", () => {
	it("lands once on the row, holds 500ms, then stops", () => {
		const {file, shadow} = buildDiff(['<div data-line="3" data-line-type="change-addition">x</div>']);
		const row = shadow.querySelector("[data-line]");
		if (row === null) throw new Error("no row");
		setBox(row, () => rect(190, 20));
		const state = initialScrollState();

		const steps = [
			stepScrollToLine(file, {side: "additions", line: 3}, state, 20, 1000),
			stepScrollToLine(file, {side: "additions", line: 3}, state, 20, 1499),
			stepScrollToLine(file, {side: "additions", line: 3}, state, 20, 1500),
		];

		expect({steps, scrolls, landedAt: state.landedAt}).toStrictEqual({
			steps: [false, false, true],
			scrolls: [{target: row, options: {behavior: "instant", block: "center"}}],
			landedAt: 1000,
		});
	});

	it("stops 3000ms after landing even while it keeps recentring", () => {
		const {scroller, file, shadow} = buildDiff(['<div data-line="3" data-line-type="change-addition">x</div>']);
		const row = shadow.querySelector("[data-line]");
		if (row === null) throw new Error("no row");
		let top = 300;
		setBox(row, () => rect(top, 20));
		Element.prototype.scrollIntoView = function scrollIntoView() {
			scroller.scrollTop += 10;
			top += 10;
		};
		const state = initialScrollState();
		const results: boolean[] = [];
		for (let now = 0; now <= 3000; now += 250) {
			results.push(stepScrollToLine(file, {side: "additions", line: 3}, state, 20, now));
		}
		expect(results).toStrictEqual([...Array.from({length: 12}, () => false), true]);
	});

	it("estimates from the file's top when no row is rendered", () => {
		const {scroller, file} = buildDiff([]);
		const state = initialScrollState();
		const done = stepScrollToLine(file, {side: "additions", line: 300}, state, 20, 0);
		expect({done, scrollTop: scroller.scrollTop, tries: state.tries}).toStrictEqual({
			done: false,
			scrollTop: 100 + 6000 - 200,
			tries: 1,
		});
	});

	it("steps from the first rendered row and halves the step on overshoot", () => {
		const {scroller, file, shadow} = buildDiff(['<div data-line="1" data-line-type="context">a</div>']);
		const state = initialScrollState();
		stepScrollToLine(file, {side: "additions", line: 300}, state, 20, 0);
		const afterFirst = scroller.scrollTop;
		const row = shadow.querySelector("[data-line]");
		row?.setAttribute("data-line", "400");
		stepScrollToLine(file, {side: "additions", line: 300}, state, 20, 16);
		expect({afterFirst, afterSecond: scroller.scrollTop, damp: state.damp}).toStrictEqual({
			afterFirst: 299 * 20,
			afterSecond: 299 * 20 + (300 - 400) * 20 * 0.5,
			damp: 0.5,
		});
	});

	it("floors the damping at 0.1", () => {
		const {scroller, file, shadow} = buildDiff(['<div data-line="1" data-line-type="context">a</div>']);
		scroller.scrollTop = 5000;
		const row = shadow.querySelector("[data-line]");
		const state = initialScrollState();
		for (let flip = 0; flip < 7; flip++) {
			row?.setAttribute("data-line", flip % 2 === 0 ? "100" : "200");
			stepScrollToLine(file, {side: "additions", line: 150}, state, 20, flip);
		}
		expect(state.damp).toBe(0.1);
	});

	it("gives up after 60 tries and scrolls the file's top into view", () => {
		const scroller = document.createElement("div");
		const file = document.createElement("div");
		scroller.append(file);
		document.body.append(scroller);
		const state = initialScrollState();
		const results: boolean[] = [];
		for (let step = 0; step <= DIFF_SCROLL_MAX_TRIES; step++) {
			results.push(stepScrollToLine(file, {side: "additions", line: 9}, state, 20, step));
		}
		expect({last: results.at(-1), earlier: results.slice(0, -1).includes(true), scrolls}).toStrictEqual({
			last: true,
			earlier: false,
			scrolls: [{target: file, options: {behavior: "instant", block: "start"}}],
		});
	});

	it("scrolls the file's top into view when the estimate can't move the scroller", () => {
		const {file} = buildDiff(['<div data-line="50" data-line-type="context">a</div>']);
		const state = initialScrollState();
		const done = stepScrollToLine(file, {side: "additions", line: 9}, state, 20, 0);
		expect({done, scrolls}).toStrictEqual({
			done: true,
			scrolls: [{target: file, options: {behavior: "instant", block: "start"}}],
		});
	});
});

describe("startScrollToLine (upstream Ac)", () => {
	it("runs a frame at a time, cancels on input inside the scroller only, and removes its listeners", () => {
		const frames: FrameRequestCallback[] = [];
		vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
			frames.push(callback);
			return frames.length;
		});
		vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
		const {file} = buildDiff([]);
		const outside = document.createElement("button");
		document.body.append(outside);
		const removed: unknown[] = [];
		const remove = document.removeEventListener.bind(document);
		vi.spyOn(document, "removeEventListener").mockImplementation((type, listener, options) => {
			removed.push([type, options]);
			remove(type, listener, options);
		});

		startScrollToLine(file, {side: "additions", line: 300}, 20);
		const scheduledAtStart = frames.length;
		outside.dispatchEvent(new Event("wheel", {bubbles: true}));
		frames.at(-1)?.(0);
		const afterOutside = frames.length;
		file.dispatchEvent(new Event("wheel", {bubbles: true}));
		frames.at(-1)?.(0);

		expect({scheduledAtStart, afterOutside, afterInside: frames.length, removed}).toStrictEqual({
			scheduledAtStart: 1,
			afterOutside: 2,
			afterInside: 2,
			removed: [
				["wheel", true],
				["touchstart", true],
				["pointerdown", true],
				["keydown", true],
				...["wheel", "touchstart", "pointerdown", "keydown"].map((type) => [type, true]),
			],
		});
	});
});
