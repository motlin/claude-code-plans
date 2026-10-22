// @vitest-environment jsdom

import {cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";

import {Menu, MenuContent, MenuItem, MenuTrigger} from "../src/components/ui/menu";

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

function stubCoarseNarrow() {
	vi.stubGlobal(
		"matchMedia",
		vi.fn((query: string) => ({
			matches: query === "(pointer: coarse)" || query === "(pointer: coarse) and (max-width: 639.98px)",
			media: query,
			onchange: null,
			addEventListener: () => undefined,
			removeEventListener: () => undefined,
			addListener: () => undefined,
			removeListener: () => undefined,
			dispatchEvent: () => false,
		})),
	);
}

describe("Menu sheet chunk", () => {
	it("loads the lazy sheet presentation on a cold open and renders the sheet once it arrives", async () => {
		stubCoarseNarrow();
		render(
			<Menu>
				<MenuTrigger aria-label="More options">...</MenuTrigger>
				<MenuContent>
					<MenuItem>Copy link</MenuItem>
				</MenuContent>
			</Menu>,
		);
		fireEvent.click(screen.getByRole("button", {name: "More options"}));
		const menu = await screen.findByRole("menu");
		expect({
			presentation: menu.getAttribute("data-presentation"),
			scrim: document.querySelector("[data-sheet-scrim]") !== null,
			items: screen.getAllByRole("menuitem").map((item) => item.getAttribute("aria-label") ?? item.textContent),
		}).toStrictEqual({presentation: "sheet", scrim: true, items: ["Copy link", "Close"]});
	});
});
