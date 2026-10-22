// @vitest-environment jsdom

import {cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";

import {Popover, PopoverContent} from "../src/components/ui/popover";

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

describe("Popover sheet chunk", () => {
	it("loads the lazy sheet presentation on a cold open and renders the sheet once it arrives", async () => {
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
		render(
			<Popover.Root>
				<Popover.Trigger>Usage</Popover.Trigger>
				<PopoverContent>
					<p>Body</p>
				</PopoverContent>
			</Popover.Root>,
		);
		fireEvent.click(screen.getByRole("button", {name: "Usage"}));
		const popup = await screen.findByRole("dialog");
		expect({
			presentation: popup.getAttribute("data-presentation"),
			scrim: document.querySelector("[data-sheet-scrim]") !== null,
			body: popup.querySelector("[data-cds-popover-body]")?.textContent,
		}).toStrictEqual({presentation: "sheet", scrim: true, body: "Body"});
	});
});
