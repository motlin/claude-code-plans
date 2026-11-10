// @vitest-environment jsdom

import {readFileSync} from "node:fs";

import {act, cleanup, render} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {ChapterTitleReveal, RevealText} from "../src/components/reveal-text";
import styles from "../src/components/reveal-text.module.css";

beforeEach(() => {
	vi.useFakeTimers();
});
afterEach(() => {
	cleanup();
	vi.useRealTimers();
});

/** The reveal's markup, attributes the tests compare spelled out. */
function snapshot(container: HTMLElement) {
	const srOnly = container.querySelector(".sr-only");
	const visual = container.querySelector<HTMLElement>("[aria-hidden='true']");
	return {
		text: container.textContent,
		srOnly: srOnly?.textContent ?? null,
		visual:
			visual === null
				? null
				: {
						revealing: visual.getAttribute("data-revealing"),
						className: visual.getAttribute("class"),
						style: visual.getAttribute("style"),
						graphemes: [...visual.children].map((grapheme) => ({
							text: grapheme.textContent,
							className: grapheme.className,
							style: grapheme.getAttribute("style"),
						})),
					},
	};
}

function graphemes(text: string, slots: readonly number[]) {
	return text.split("").map((char, index) => ({
		text: char === " " ? " " : char,
		className: styles["grapheme"],
		style: `--i: ${slots[index]};`,
	}));
}

function advance(ms: number) {
	act(() => {
		vi.advanceTimersByTime(ms);
	});
}

describe("RevealText (upstream shared-20 CR)", () => {
	it("reveals each grapheme in turn on first paint and settles after (graphemes + 4) * 30ms", () => {
		const {container} = render(<RevealText text="Go on" />);
		const revealing = snapshot(container);
		advance(269);
		const almost = snapshot(container).visual?.revealing;
		advance(1);

		expect({revealing, almost, settled: snapshot(container).visual?.revealing}).toStrictEqual({
			revealing: {
				text: "Go onGo on",
				srOnly: "Go on",
				visual: {
					revealing: "",
					className: "inline-flex",
					style: null,
					graphemes: graphemes("Go on", [0, 1, 2, 3, 4]),
				},
			},
			almost: "",
			settled: null,
		});
	});

	it("draws plain text on first paint with skipInitialReveal", () => {
		const {container} = render(<RevealText text="Plan" skipInitialReveal />);
		expect({html: container.innerHTML, text: container.textContent}).toStrictEqual({html: "Plan", text: "Plan"});
	});

	it("fades the old text out over 200ms, then reveals the new text grapheme by grapheme", () => {
		const view = render(<RevealText text="Plan" skipInitialReveal />);
		view.rerender(<RevealText text="Ship" skipInitialReveal />);
		const out = snapshot(view.container);
		advance(199);
		const stillOut = snapshot(view.container).visual?.graphemes.map((grapheme) => grapheme.text);
		advance(1);
		const revealing = snapshot(view.container);
		advance(240);

		expect({out, stillOut, revealing, settled: snapshot(view.container).visual?.revealing}).toStrictEqual({
			out: {
				text: "ShipPlan",
				srOnly: "Ship",
				visual: {
					revealing: "",
					className: "inline-flex",
					style: "opacity: 0; filter: blur(6px); transition: opacity 200ms ease-out, filter 200ms ease-out;",
					graphemes: graphemes("Plan", [0, 1, 2, 3]),
				},
			},
			stillOut: ["P", "l", "a", "n"],
			revealing: {
				text: "ShipShip",
				srOnly: "Ship",
				visual: {
					revealing: "",
					className: "inline-flex",
					style: null,
					graphemes: graphemes("Ship", [0, 1, 2, 3]),
				},
			},
			settled: null,
		});
	});

	it("recovers the old text in place when the text changes back while fading out", () => {
		const view = render(<RevealText text="Plan" skipInitialReveal />);
		advance(240);
		view.rerender(<RevealText text="Ship" skipInitialReveal />);
		view.rerender(<RevealText text="Plan" skipInitialReveal />);
		advance(200);

		expect(snapshot(view.container)).toStrictEqual({
			text: "PlanPlan",
			srOnly: "Plan",
			visual: {
				revealing: null,
				className: "inline-flex",
				style: "transition: opacity 200ms ease-out, filter 200ms ease-out;",
				graphemes: graphemes("Plan", [0, 1, 2, 3]),
			},
		});
	});

	it("keeps right-to-left text in word and space runs, not separate inline-flex graphemes", () => {
		const {container} = render(<RevealText text="שלום עולם" />);
		expect(snapshot(container).visual).toStrictEqual({
			revealing: "",
			className: null,
			style: null,
			graphemes: [
				{text: "שלום", className: styles["grapheme"], style: "--i: 0;"},
				{text: " ", className: styles["grapheme"], style: "--i: 4;"},
				{text: "עולם", className: styles["grapheme"], style: "--i: 5;"},
			],
		});
	});

	it("ships upstream's grapheme keyframes: 90ms each, 30ms apart, off under reduced motion", () => {
		const css = readFileSync("src/components/reveal-text.module.css", "utf8").replaceAll(/\s+/g, " ");
		expect(
			[
				"[data-revealing] > .grapheme { animation: 90ms cubic-bezier(0.215, 0.61, 0.355, 1) both grapheme-reveal; animation-delay: calc(var(--i, 0) * 30ms); }",
				"@media (prefers-reduced-motion: reduce) { [data-revealing] > .grapheme { animation: none; } }",
				"@keyframes grapheme-reveal { 0% { opacity: 0; filter: blur(6px); } }",
			].map((rule) => css.includes(rule)),
		).toStrictEqual([true, true, true]);
	});
});

describe("ChapterTitleReveal (upstream NA)", () => {
	it("reveals a renamed title, then settles back to plain text 1.5s after the change", () => {
		const view = render(<ChapterTitleReveal text="Plan" />);
		const initial = view.container.innerHTML;
		view.rerender(<ChapterTitleReveal text="Ship" />);
		advance(200);
		const revealing = snapshot(view.container).visual?.revealing;
		advance(1299);
		const beforeRekey = view.container.innerHTML === "Ship";
		advance(1);

		expect({initial, revealing, beforeRekey, after: view.container.innerHTML}).toStrictEqual({
			initial: "Plan",
			revealing: "",
			beforeRekey: false,
			after: "Ship",
		});
	});
});
