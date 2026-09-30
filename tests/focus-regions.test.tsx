// @vitest-environment jsdom

import {act, cleanup, render, screen} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {useFocusRegionShortcuts} from "../src/hooks/use-focus-regions";
import {FOCUS_REGION_ENTRY_ATTR, FOCUS_REGION_ATTR} from "../src/lib/focus-regions";

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
			<main aria-label="Main" {...region("main")}>
				<button type="button">Transcript action</button>
				<div aria-label="Composer" {...region("composer")}>
					<textarea aria-label="Prompt" {...entry} />
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
