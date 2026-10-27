// @vitest-environment jsdom

import {act, cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {useFocusRegionShortcuts} from "../src/hooks/use-focus-regions";
import {FOCUS_REGION_ENTRY_ATTR, FOCUS_REGION_ATTR, focusRegionByName} from "../src/lib/focus-regions";

const MAC_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";

function region(name: string) {
	return {[FOCUS_REGION_ATTR]: name};
}

const entry = {[FOCUS_REGION_ENTRY_ATTR]: ""};

function Harness({hideSecondPane = false}: {hideSecondPane?: boolean}) {
	useFocusRegionShortcuts();
	return (
		<>
			<nav aria-label="Sidebar" {...region("navigation")}>
				<a href="/">Home</a>
			</nav>
			<main aria-label="Main" {...region("main")} style={{position: "relative"}}>
				<button type="button">Transcript action</button>
				<div aria-label="Composer" {...region("composer")}>
					<div data-composer-card="" data-testid="card" style={{position: "relative"}}>
						<textarea aria-label="Prompt" {...entry} />
					</div>
				</div>
				<section aria-label="Files" {...region("pane")}>
					<button type="button">Files action</button>
				</section>
				<section aria-label="Terminal" {...region("pane")} inert={hideSecondPane}>
					<button type="button">Terminal action</button>
				</section>
			</main>
		</>
	);
}

function pressF6(shiftKey = false): KeyboardEvent {
	const event = new KeyboardEvent("keydown", {
		key: "F6",
		code: "F6",
		shiftKey,
		bubbles: true,
		cancelable: true,
	});
	act(() => {
		(document.activeElement ?? document.body).dispatchEvent(event);
	});
	return event;
}

function focusedName(): string | null {
	const active = document.activeElement;
	if (active === null || active === document.body) return null;
	return active.getAttribute("aria-label");
}

describe("F6 focus regions", () => {
	beforeEach(() => {
		vi.spyOn(navigator, "userAgent", "get").mockReturnValue(MAC_UA);
	});

	afterEach(() => {
		cleanup();
		vi.restoreAllMocks();
	});

	it("F6 cycles sidebar → main → composer → panes and wraps", () => {
		render(<Harness />);

		const visited: (string | null)[] = [];
		const prevented: boolean[] = [];
		for (let i = 0; i < 6; i++) {
			prevented.push(pressF6().defaultPrevented);
			visited.push(focusedName());
		}

		expect({visited, prevented}).toStrictEqual({
			visited: ["Sidebar", "Main", "Prompt", "Files", "Terminal", "Sidebar"],
			prevented: [true, true, true, true, true, true],
		});
	});

	it("⇧F6 cycles in reverse and wraps", () => {
		render(<Harness />);

		const visited: (string | null)[] = [];
		for (let i = 0; i < 6; i++) {
			pressF6(true);
			visited.push(focusedName());
		}

		expect(visited).toStrictEqual(["Terminal", "Files", "Prompt", "Main", "Sidebar", "Terminal"]);
	});

	it("moves from focus nested inside a region to the next region", () => {
		render(<Harness />);
		screen.getByRole("button", {name: "Transcript action"}).focus();

		pressF6();
		const afterForward = focusedName();
		screen.getByRole("button", {name: "Files action"}).focus();
		pressF6(true);

		expect({afterForward, afterBackward: focusedName()}).toStrictEqual({
			afterForward: "Prompt",
			afterBackward: "Prompt",
		});
	});

	it("skips inert regions", () => {
		render(<Harness hideSecondPane />);
		screen.getByRole("button", {name: "Files action"}).focus();

		pressF6();

		expect(focusedName()).toBe("Sidebar");
	});

	it("makes non-focusable regions programmatically focusable only", () => {
		render(<Harness />);

		pressF6();

		const sidebar = screen.getByRole("navigation", {name: "Sidebar"});
		expect(sidebar.getAttribute("tabindex")).toBe("-1");
	});
});

describe("focusRegionByName", () => {
	afterEach(() => {
		cleanup();
	});

	it("focuses the named region, or the composer's entry, and reports whether it landed", () => {
		render(<Harness />);
		const landed = (["navigation", "main", "composer"] as const).map((name) => [
			focusRegionByName(document, name),
			focusedName(),
		]);

		expect(landed).toStrictEqual([
			[true, "Sidebar"],
			[true, "Main"],
			[true, "Prompt"],
		]);
	});

	it("returns false when the region is missing or hidden", () => {
		render(
			<>
				<nav aria-label="Sidebar" {...region("navigation")} hidden />
				<button type="button">Elsewhere</button>
			</>,
		);
		screen.getByRole("button", {name: "Elsewhere"}).focus();

		expect({
			navigation: focusRegionByName(document, "navigation"),
			composer: focusRegionByName(document, "composer"),
			focused: document.activeElement?.textContent,
		}).toStrictEqual({navigation: false, composer: false, focused: "Elsewhere"});
	});
});

const LANDING_ATTRS = ["data-focus-region-landing", "data-focus-region-around", "data-focus-region-inside", "tabindex"];

function landingAttrs(element: Element): Record<string, string | null> {
	return Object.fromEntries(LANDING_ATTRS.map((name) => [name, element.getAttribute(name)]));
}

describe("F6 landing ring", () => {
	beforeEach(() => {
		vi.spyOn(navigator, "userAgent", "get").mockReturnValue(MAC_UA);
	});

	afterEach(() => {
		cleanup();
		vi.restoreAllMocks();
	});

	it("marks a static region with a plain ring and a positioned region with the overlay ring", () => {
		render(<Harness />);
		const sidebar = screen.getByRole("navigation", {name: "Sidebar"});
		const main = screen.getByRole("main", {name: "Main"});

		pressF6();
		const onSidebar = {sidebar: landingAttrs(sidebar), main: landingAttrs(main)};
		pressF6();
		const onMain = {sidebar: landingAttrs(sidebar), main: landingAttrs(main)};

		expect({onSidebar, onMain}).toStrictEqual({
			onSidebar: {
				sidebar: {
					"data-focus-region-landing": "",
					"data-focus-region-around": null,
					"data-focus-region-inside": null,
					tabindex: "-1",
				},
				main: {
					"data-focus-region-landing": null,
					"data-focus-region-around": null,
					"data-focus-region-inside": null,
					tabindex: null,
				},
			},
			onMain: {
				sidebar: {
					"data-focus-region-landing": null,
					"data-focus-region-around": null,
					"data-focus-region-inside": null,
					tabindex: null,
				},
				main: {
					"data-focus-region-landing": "overlay",
					"data-focus-region-around": null,
					"data-focus-region-inside": null,
					tabindex: "-1",
				},
			},
		});
	});

	it("rings the composer card around the prompt and clears on the next key", () => {
		render(<Harness />);
		const card = screen.getByTestId("card");
		const prompt = screen.getByRole("textbox", {name: "Prompt"});

		pressF6();
		pressF6();
		pressF6();
		const landed = {card: landingAttrs(card), prompt: landingAttrs(prompt), focused: focusedName()};
		fireEvent.keyDown(prompt, {key: "Shift"});
		const afterModifier = card.getAttribute("data-focus-region-landing");
		fireEvent.keyDown(prompt, {key: "a"});

		expect({
			landed,
			afterModifier,
			afterKey: {card: landingAttrs(card), prompt: landingAttrs(prompt)},
		}).toStrictEqual({
			landed: {
				card: {
					"data-focus-region-landing": "overlay",
					"data-focus-region-around": "",
					"data-focus-region-inside": null,
					tabindex: null,
				},
				prompt: {
					"data-focus-region-landing": null,
					"data-focus-region-around": null,
					"data-focus-region-inside": "",
					tabindex: null,
				},
				focused: "Prompt",
			},
			afterModifier: "overlay",
			afterKey: {
				card: {
					"data-focus-region-landing": null,
					"data-focus-region-around": null,
					"data-focus-region-inside": null,
					tabindex: null,
				},
				prompt: {
					"data-focus-region-landing": null,
					"data-focus-region-around": null,
					"data-focus-region-inside": null,
					tabindex: null,
				},
			},
		});
	});

	it("keeps a region ring through keys, and clears it on pointerdown on the ring", () => {
		render(<Harness />);
		const main = screen.getByRole("main", {name: "Main"});

		pressF6();
		pressF6();
		fireEvent.keyDown(main, {key: "a"});
		const afterKey = main.getAttribute("data-focus-region-landing");
		fireEvent.pointerDown(main);

		expect({afterKey, afterPointer: landingAttrs(main)}).toStrictEqual({
			afterKey: "overlay",
			afterPointer: {
				"data-focus-region-landing": null,
				"data-focus-region-around": null,
				"data-focus-region-inside": null,
				tabindex: null,
			},
		});
	});

	it("clears when focus moves elsewhere, but not into an unrelated dialog", () => {
		render(
			<>
				<Harness />
				<div role="dialog" aria-label="Dialog">
					<button type="button">Dialog action</button>
				</div>
			</>,
		);
		const main = screen.getByRole("main", {name: "Main"});

		pressF6();
		pressF6();
		act(() => {
			screen.getByRole("button", {name: "Dialog action"}).focus();
		});
		const afterDialog = main.getAttribute("data-focus-region-landing");
		act(() => {
			screen.getByRole("button", {name: "Transcript action"}).focus();
		});

		expect({afterDialog, afterFocus: landingAttrs(main)}).toStrictEqual({
			afterDialog: "overlay",
			afterFocus: {
				"data-focus-region-landing": null,
				"data-focus-region-around": null,
				"data-focus-region-inside": null,
				tabindex: null,
			},
		});
	});
});
