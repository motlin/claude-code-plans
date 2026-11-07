// @vitest-environment jsdom

import {readFileSync} from "node:fs";
import {act, cleanup, render} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it} from "vite-plus/test";
import {useRowCut} from "../src/lib/use-row-cut";

class StubObserver {
	static instances: StubObserver[] = [];
	observed: Element[] = [];
	unobserved: Element[] = [];
	constructor(private readonly callback: ResizeObserverCallback) {
		StubObserver.instances.push(this);
	}
	observe(target: Element) {
		this.observed.push(target);
	}
	unobserve(target: Element) {
		this.unobserved.push(target);
	}
	disconnect() {}
	fire(targets: Element[]) {
		this.callback(
			targets.map((target) => ({target}) as ResizeObserverEntry),
			this,
		);
	}
}

function setWidths(element: Element, scrollWidth: number, clientWidth: number) {
	Object.defineProperty(element, "scrollWidth", {configurable: true, value: scrollWidth});
	Object.defineProperty(element, "clientWidth", {configurable: true, value: clientWidth});
}

function Label({enabled, dep, testId = "label"}: {enabled: boolean; dep: string; testId?: string}) {
	const ref = useRowCut(enabled, dep);
	return (
		<span ref={ref} data-testid={testId} data-has-ref={ref === undefined ? "no" : "yes"}>
			{dep}
		</span>
	);
}

describe("useRowCut (upstream shared-frame n_ row-cut observer)", () => {
	const original = globalThis.ResizeObserver;

	beforeEach(() => {
		StubObserver.instances = [];
		// A fresh constructor per test, so the hook's per-window observer is rebuilt from it.
		globalThis.ResizeObserver = class extends StubObserver {};
	});

	afterEach(() => {
		cleanup();
		globalThis.ResizeObserver = original;
	});

	it("returns no ref and observes nothing when disabled", () => {
		const {getByTestId} = render(<Label enabled={false} dep="a" />);
		expect({
			ref: getByTestId("label").dataset["hasRef"],
			observers: StubObserver.instances.length,
		}).toStrictEqual({ref: "no", observers: 0});
	});

	it("toggles data-cds-row-cut while the element overflows", () => {
		const {getByTestId} = render(<Label enabled dep="a" />);
		const label = getByTestId("label");
		const observer = StubObserver.instances[0]!;
		setWidths(label, 300, 200);
		act(() => {
			observer.fire([label]);
		});
		const cut = label.getAttribute("data-cds-row-cut");
		setWidths(label, 150, 200);
		act(() => {
			observer.fire([label]);
		});
		expect({cut, after: label.hasAttribute("data-cds-row-cut")}).toStrictEqual({cut: "", after: false});
	});

	it("shares one observer between hooks", () => {
		render(
			<>
				<Label enabled dep="a" testId="one" />
				<Label enabled dep="b" testId="two" />
			</>,
		);
		expect(StubObserver.instances.length).toBe(1);
	});

	it("re-observes the node when the text dependency changes", () => {
		const {getByTestId, rerender} = render(<Label enabled dep="a" />);
		const label = getByTestId("label");
		const observer = StubObserver.instances[0]!;
		const before = observer.observed.filter((node) => node === label).length;
		rerender(<Label enabled dep="b" />);
		const after = observer.observed.filter((node) => node === label).length;
		expect(after).toBeGreaterThan(before);
	});

	it("unobserves a disconnected node on the next callback", () => {
		const {getByTestId, unmount} = render(<Label enabled dep="a" />);
		const label = getByTestId("label");
		const observer = StubObserver.instances[0]!;
		unmount();
		observer.fire([label]);
		expect(observer.unobserved).toStrictEqual([label]);
	});
});

describe("row-cut fade CSS (upstream c6a992d55)", () => {
	const styles = readFileSync("src/styles/globals.css", "utf8")
		.replaceAll(/\s+/g, " ")
		.replaceAll("( ", "(")
		.replaceAll(" )", ")");

	it("swaps the ellipsis for a 24px end fade on cut rows, mirrored in RTL, lifted inside a cds row", () => {
		const rules = [
			"[data-cds-row-cut] { text-overflow: clip; mask-image: linear-gradient(90deg, #000 calc(100% - 24px), #0000); mask-clip: no-clip; }",
			"[data-cds-row-cut]:dir(rtl) { mask-image: linear-gradient(270deg, #000 calc(100% - 24px), #0000); }",
			"[data-cds-row] [data-cds-row-cut] { z-index: 1; pointer-events: none; position: relative; }",
			':where([data-cds-row] [data-cds-row-cut]) :where(a, button, input, select, textarea, label, summary, iframe, [role="button"], [contenteditable]:not([contenteditable="false"]), [tabindex]:not([tabindex^="-"])) { pointer-events: auto; }',
		];
		expect(rules.filter((rule) => !styles.includes(rule))).toStrictEqual([]);
	});
});
