// @vitest-environment jsdom

import {cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {Popover, PopoverContent} from "../src/components/ui/popover";

beforeEach(() => {
	vi.stubGlobal(
		"matchMedia",
		vi.fn((query: string) => ({
			matches: false,
			media: query,
			onchange: null,
			addEventListener: () => undefined,
			removeEventListener: () => undefined,
			addListener: () => undefined,
			removeListener: () => undefined,
			dispatchEvent: () => false,
		})),
	);
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

describe("PopoverContent under a fine pointer", () => {
	it("renders the anchored Portal → Positioner → Popup with the consumer className and no sheet chrome", () => {
		render(
			<Popover.Root>
				<Popover.Trigger>Usage</Popover.Trigger>
				<PopoverContent side="top" align="end" sideOffset={6} className="w-[360px] rounded-r7 p-3">
					<p>Body</p>
				</PopoverContent>
			</Popover.Root>,
		);
		fireEvent.click(screen.getByRole("button", {name: "Usage"}));
		const popup = screen.getByRole("dialog");
		const positioner = popup.parentElement;
		expect({
			popupClass: popup.className,
			body: popup.textContent,
			positionerClass: positioner?.className,
			side: positioner?.getAttribute("data-side"),
			align: positioner?.getAttribute("data-align"),
			presentation: document.querySelector("[data-presentation]"),
			scrim: document.querySelector("[data-sheet-scrim]"),
			handle: document.querySelector("[data-cds-sheet-handle]"),
		}).toStrictEqual({
			popupClass: "w-[360px] rounded-r7 p-3",
			body: "Body",
			positionerClass: "z-[130]",
			side: "top",
			align: "end",
			presentation: null,
			scrim: null,
			handle: null,
		});
	});

	it("stays anchored when structurallyAnchored", () => {
		render(
			<Popover.Root defaultOpen>
				<Popover.Trigger>Search</Popover.Trigger>
				<PopoverContent structurallyAnchored className="w-80">
					<p>Results</p>
				</PopoverContent>
			</Popover.Root>,
		);
		expect({
			popupClass: screen.getByRole("dialog").className,
			presentation: document.querySelector("[data-presentation]"),
		}).toStrictEqual({popupClass: "w-80", presentation: null});
	});
});
