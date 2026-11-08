// @vitest-environment jsdom

import {act, cleanup, fireEvent, render, screen, waitFor} from "@testing-library/react";
import {afterEach, beforeAll, describe, expect, it, vi} from "vite-plus/test";

import {ConfirmDialog} from "../src/components/confirm-dialog";
import {KeyboardShortcutsDialog} from "../src/components/keyboard-shortcuts-dialog";
import {setKeyboardShortcutsOpen} from "../src/components/keyboard-shortcuts-open";
import {NewGroupDialog} from "../src/components/new-group-dialog";
import {Menu, MenuContent, MenuItem, MenuTrigger} from "../src/components/ui/menu";
import {preloadMenuSheet} from "../src/components/ui/menu-sheet-loader";
import {PopoverContent, PopoverRoot, PopoverTrigger} from "../src/components/ui/popover";
import {preloadPopoverSheet} from "../src/components/ui/popover-sheet-loader";
import {Select} from "../src/components/ui/select";
import {Tooltip} from "../src/components/ui/tooltip";
import {isAnotherOverlayOpen, OPEN_OVERLAY_SELECTOR} from "../src/lib/overlay";

beforeAll(async () => {
	await Promise.all([preloadMenuSheet(), preloadPopoverSheet()]);
});

afterEach(() => {
	act(() => {
		setKeyboardShortcutsOpen(false);
	});
	cleanup();
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

/** A fine pointer (`coarse=false`) or a phone-width coarse pointer, which opens bottom sheets. */
function stubPointer(coarse: boolean) {
	vi.stubGlobal(
		"matchMedia",
		vi.fn((query: string) => ({
			matches:
				coarse && (query === "(pointer: coarse)" || query === "(pointer: coarse) and (max-width: 639.98px)"),
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

function marker(popup: Element) {
	return {
		cds: popup.getAttribute("data-cds"),
		presentation: popup.getAttribute("data-presentation"),
		overlay: popup.getAttribute("data-cds-overlay"),
		open: popup.matches(OPEN_OVERLAY_SELECTOR),
	};
}

function renderMenu() {
	render(
		<Menu>
			<MenuTrigger aria-label="More options">...</MenuTrigger>
			<MenuContent>
				<MenuItem>Rename</MenuItem>
			</MenuContent>
		</Menu>,
	);
	fireEvent.click(screen.getByRole("button", {name: "More options"}));
}

function renderPopover() {
	render(
		<PopoverRoot>
			<PopoverTrigger>Usage</PopoverTrigger>
			<PopoverContent>
				<p>Body</p>
			</PopoverContent>
		</PopoverRoot>,
	);
	fireEvent.click(screen.getByRole("button", {name: "Usage"}));
}

describe("data-cds-overlay on cds overlay popups", () => {
	it("marks an open anchored Menu popup", async () => {
		stubPointer(false);
		renderMenu();
		expect(marker(await screen.findByRole("menu"))).toStrictEqual({
			cds: "Menu",
			presentation: null,
			overlay: "",
			open: true,
		});
	});

	it("marks an open Menu sheet popup", async () => {
		stubPointer(true);
		renderMenu();
		expect(marker(await screen.findByRole("menu"))).toStrictEqual({
			cds: "Menu",
			presentation: "sheet",
			overlay: "",
			open: true,
		});
	});

	it("marks an open anchored Popover popup and gives it upstream's data-cds", async () => {
		stubPointer(false);
		renderPopover();
		expect(marker(await screen.findByRole("dialog"))).toStrictEqual({
			cds: "Popover",
			presentation: null,
			overlay: "",
			open: true,
		});
	});

	it("marks an open Popover sheet popup", async () => {
		stubPointer(true);
		renderPopover();
		expect(marker(await screen.findByRole("dialog"))).toStrictEqual({
			cds: "Popover",
			presentation: "sheet",
			overlay: "",
			open: true,
		});
	});

	it("marks the ConfirmDialog AlertDialog popup", async () => {
		render(
			<ConfirmDialog
				open
				onOpenChange={() => {}}
				title="Delete session?"
				body="This can't be undone."
				confirmLabel="Delete"
				onConfirm={() => {}}
			/>,
		);
		expect(marker(await screen.findByRole("alertdialog"))).toStrictEqual({
			cds: "ConfirmationDialog",
			presentation: null,
			overlay: "",
			open: true,
		});
	});

	it("marks the DialogPopup wrapper's popup (New section)", async () => {
		render(<NewGroupDialog open onOpenChange={() => {}} onCreate={() => {}} />);
		const popup = await screen.findByRole("dialog", {name: "New section"});
		expect([popup.getAttribute("data-cds-overlay"), popup.matches(OPEN_OVERLAY_SELECTOR)]).toStrictEqual([
			"",
			true,
		]);
	});

	it("marks the keyboard shortcuts dialog popup", async () => {
		render(<KeyboardShortcutsDialog />);
		act(() => {
			setKeyboardShortcutsOpen(true);
		});
		const popup = await screen.findByRole("dialog", {name: "Keyboard shortcuts"});
		expect([popup.getAttribute("data-cds-overlay"), popup.matches(OPEN_OVERLAY_SELECTOR)]).toStrictEqual([
			"",
			true,
		]);
	});

	it("leaves an open Select listbox unmarked, as upstream's Combobox", async () => {
		render(<Select label="Letter" items={[{value: "a", label: "Alpha"}]} value="a" onChange={() => {}} />);
		await act(async () => {
			fireEvent.click(screen.getByRole("combobox"));
			await Promise.resolve();
		});
		const listbox = await screen.findByRole("listbox", {hidden: true});
		expect([listbox.getAttribute("data-cds-overlay"), document.querySelector("[data-cds-overlay]")]).toStrictEqual([
			null,
			null,
		]);
	});

	it("leaves an open Tooltip unmarked", () => {
		vi.useFakeTimers();
		render(
			<Tooltip content="Expand chat">
				<button type="button">Expand</button>
			</Tooltip>,
		);
		fireEvent.pointerEnter(screen.getByRole("button", {name: "Expand"}));
		act(() => {
			vi.advanceTimersByTime(300);
		});
		const tooltip = screen.getByRole("tooltip");
		expect([tooltip.getAttribute("data-cds-overlay"), document.querySelector("[data-cds-overlay]")]).toStrictEqual([
			null,
			null,
		]);
	});

	it("reports no open overlay once a closed menu drops data-open", async () => {
		stubPointer(false);
		renderMenu();
		const popup = await screen.findByRole("menu");
		const whileOpen = isAnotherOverlayOpen(document);
		fireEvent.keyDown(popup, {key: "Escape"});
		await waitFor(() => {
			expect(popup.hasAttribute("data-open")).toBe(false);
		});
		expect({whileOpen, afterClose: isAnotherOverlayOpen(document)}).toStrictEqual({
			whileOpen: true,
			afterClose: false,
		});
	});
});
