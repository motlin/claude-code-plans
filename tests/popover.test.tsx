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

describe("PopoverContent under a coarse pointer", () => {
	function stubCoarseAtWidth(width: number) {
		vi.stubGlobal(
			"matchMedia",
			vi.fn((query: string) => ({
				matches:
					query === "(pointer: coarse)" ||
					(query === "(pointer: coarse) and (max-width: 639.98px)" && width < 640),
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

	function renderUsage() {
		render(
			<Popover.Root>
				<Popover.Trigger>Usage</Popover.Trigger>
				<PopoverContent side="top" align="end" className="w-[360px] max-w-[90vw] rounded-r7 p-3">
					<p>Body</p>
				</PopoverContent>
			</Popover.Root>,
		);
		fireEvent.click(screen.getByRole("button", {name: "Usage"}));
		return screen.getByRole("dialog");
	}

	function classes(element: Element | null | undefined): string[] {
		return (element?.getAttribute("class") ?? "").split(" ");
	}

	it("presents a bottom sheet at 420px, as upstream's PopoverSheetContent", () => {
		stubCoarseAtWidth(420);
		const popup = renderUsage();
		const [handle, wrapper] = Array.from(popup.children);
		const scrim = document.querySelector("[data-sheet-scrim]");
		const positioner = popup.parentElement;
		const body = wrapper?.firstElementChild;
		expect({
			attributes: {
				cds: popup.getAttribute("data-cds"),
				size: popup.getAttribute("data-size"),
				presentation: popup.getAttribute("data-presentation"),
				depth: popup.getAttribute("data-cds-sheet-depth"),
				detent: popup.getAttribute("data-cds-sheet-detent"),
				treeMatchesScrim: popup.getAttribute("data-sheet-tree") === scrim?.getAttribute("data-sheet-scrim"),
			},
			scrim: {
				presentation: scrim?.getAttribute("data-presentation"),
				class: scrim?.className,
			},
			positioner: {
				class: positioner?.className,
				position: positioner?.style.position,
				inset: positioner?.style.inset,
				transform: positioner?.style.transform,
			},
			popupClass: {
				roundedTop: classes(popup).includes("rounded-t-[14px]"),
				consumerWidth: classes(popup).includes("w-[360px]"),
				consumerPadding: classes(popup).includes("p-3"),
			},
			popupStyle: {
				maxHeight: popup.style.maxHeight,
				availableHeight: popup.style.getPropertyValue("--available-height"),
			},
			handle: {
				marker: handle?.hasAttribute("data-cds-sheet-handle"),
				ariaHidden: handle?.getAttribute("aria-hidden"),
				class: handle?.className,
				pill: handle?.firstElementChild?.className,
			},
			wrapperClass: wrapper?.className,
			body: {
				tabIndex: body?.getAttribute("tabindex"),
				popoverBody: body?.hasAttribute("data-cds-popover-body"),
				scroll: body?.hasAttribute("data-cds-sheet-scroll"),
				class: body?.className,
				text: body?.textContent,
			},
		}).toStrictEqual({
			attributes: {
				cds: "Popover",
				size: "lg",
				presentation: "sheet",
				depth: "0",
				detent: "default",
				treeMatchesScrim: true,
			},
			scrim: {
				presentation: "sheet",
				class: "draggable-none fixed inset-0 bg-backdrop transition-opacity duration-[300ms] ease-[cubic-bezier(0.165,0.84,0.44,1)] motion-reduce:transition-none data-[starting-style]:opacity-0 data-[ending-style]:opacity-0",
			},
			positioner: {
				class: "z-[130] after:pointer-events-none after:absolute after:inset-x-0 after:top-full after:h-[100dvh] after:bg-[var(--menu-bg)]",
				position: "fixed",
				inset: "auto 0 0",
				transform: "none",
			},
			popupClass: {roundedTop: true, consumerWidth: false, consumerPadding: false},
			popupStyle: {
				maxHeight: "calc(0.95 * (100dvh - env(safe-area-inset-top, 0px)))",
				availableHeight: "calc((100dvh - env(safe-area-inset-top,0px)) * .9)",
			},
			handle: {
				marker: true,
				ariaHidden: "true",
				class: "flex min-h-8 shrink-0 touch-none items-center justify-center select-none",
				pill: "h-1 w-9 rounded-full bg-border",
			},
			wrapperClass:
				"flex min-h-0 flex-auto flex-col p-3 h-auto max-h-none min-h-0 w-full min-w-0 max-w-none flex-auto",
			body: {
				tabIndex: "-1",
				popoverBody: true,
				scroll: true,
				class: "min-h-0 min-w-0 flex-auto overflow-y-auto outline-none",
				text: "Body",
			},
		});
	});

	it("stays anchored at 900px", () => {
		stubCoarseAtWidth(900);
		const popup = renderUsage();
		expect({
			popupClass: popup.className,
			presentation: document.querySelector("[data-presentation]"),
			scrim: document.querySelector("[data-sheet-scrim]"),
		}).toStrictEqual({popupClass: "w-[360px] max-w-[90vw] rounded-r7 p-3", presentation: null, scrim: null});
	});

	it("stays anchored at 420px when the consumer controls open without onOpenChange", () => {
		stubCoarseAtWidth(420);
		render(
			<Popover.Root open>
				<Popover.Trigger>Usage</Popover.Trigger>
				<PopoverContent className="w-80">
					<p>Body</p>
				</PopoverContent>
			</Popover.Root>,
		);
		expect({
			popupClass: screen.getByRole("dialog").className,
			presentation: document.querySelector("[data-presentation]"),
		}).toStrictEqual({popupClass: "w-80", presentation: null});
	});

	it("presents a sheet at 420px when the consumer controls open with onOpenChange", () => {
		stubCoarseAtWidth(420);
		render(
			<Popover.Root open onOpenChange={() => undefined}>
				<Popover.Trigger>Usage</Popover.Trigger>
				<PopoverContent className="w-80">
					<p>Body</p>
				</PopoverContent>
			</Popover.Root>,
		);
		expect(screen.getByRole("dialog").getAttribute("data-presentation")).toBe("sheet");
	});

	it("stays anchored at 420px when structurallyAnchored", () => {
		stubCoarseAtWidth(420);
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
