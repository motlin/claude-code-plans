// @vitest-environment jsdom

import {act, cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";

import {SplitDropdownButton, type SplitItem} from "../src/components/ui/split-dropdown-button";

afterEach(() => {
	cleanup();
});

async function flush() {
	await act(async () => {
		await new Promise((resolve) => {
			setTimeout(resolve, 0);
		});
	});
}

function group() {
	return screen.getByRole("group", {name: "Always allow"});
}

function primary() {
	return screen.getByRole("button", {name: "Always allow"});
}

function caret() {
	return screen.getByRole("button", {name: "More allow options"});
}

function renderSplit(
	props: Partial<Parameters<typeof SplitDropdownButton>[0]> = {},
	items: SplitItem[] = [{label: "Allow once", onSelect: () => {}}],
) {
	const onPrimaryClick = vi.fn<() => void>();
	const view = render(
		<SplitDropdownButton
			label="Always allow"
			menuLabel="More allow options"
			items={items}
			onPrimaryClick={onPrimaryClick}
			{...props}
		/>,
	);
	return {onPrimaryClick, ...view};
}

async function openByClick() {
	fireEvent.click(caret());
	await flush();
	return screen.getByRole("menu");
}

describe("SplitDropdownButton", () => {
	it("renders a named group with the primary and the menu caret", () => {
		renderSplit();

		expect({
			cds: group().getAttribute("data-cds"),
			popupOpen: group().hasAttribute("data-popup-open"),
			buttons: screen
				.getAllByRole("button")
				.map((button) => button.getAttribute("aria-label") ?? button.textContent),
			haspopup: caret().getAttribute("aria-haspopup"),
			expanded: caret().getAttribute("aria-expanded"),
			primaryType: primary().getAttribute("type"),
			caretType: caret().getAttribute("type"),
			caretIconOnly: caret().hasAttribute("data-cds-icon-only"),
		}).toStrictEqual({
			cds: "SplitDropdownButton",
			popupOpen: false,
			buttons: ["Always allow", "More allow options"],
			haspopup: "menu",
			expanded: "false",
			primaryType: "button",
			caretType: "button",
			caretIconOnly: true,
		});
	});

	it("names the group from aria-label for an icon-only primary", () => {
		render(
			<SplitDropdownButton
				icon={<span>↵</span>}
				aria-label="Send"
				menuLabel="More send options"
				items={[]}
				onPrimaryClick={() => {}}
			/>,
		);

		expect(screen.getByRole("group").getAttribute("aria-label")).toBe("Send");
		expect(screen.getAllByRole("button").map((button) => button.getAttribute("aria-label"))).toStrictEqual([
			"Send",
			"More send options",
		]);
	});

	it("opens the menu from the caret with items in order and a separator before separatorBefore", async () => {
		renderSplit({}, [
			{label: "Allow once", onSelect: () => {}},
			"separator",
			{label: "Deny", onSelect: () => {}, separatorBefore: true},
		]);

		await openByClick();

		expect({
			popupOpen: group().getAttribute("data-popup-open"),
			expanded: caret().getAttribute("aria-expanded"),
			items: screen.getAllByRole("menuitem").map((item) => item.textContent),
			separators: screen.getAllByRole("separator").length,
		}).toStrictEqual({popupOpen: "", expanded: "true", items: ["Allow once", "Deny"], separators: 2});
	});

	it("calls an item's onSelect once and closes the menu", async () => {
		const onSelect = vi.fn<() => void>();
		renderSplit({}, [{label: "Allow once", onSelect}]);
		await openByClick();

		fireEvent.click(screen.getByRole("menuitem", {name: "Allow once"}));
		await flush();

		expect({
			calls: onSelect.mock.calls.length,
			menu: screen.queryByRole("menu"),
			popupOpen: group().hasAttribute("data-popup-open"),
		}).toStrictEqual({calls: 1, menu: null, popupOpen: false});
	});

	it("closes the menu without firing the primary when the primary is clicked while open", async () => {
		const {onPrimaryClick} = renderSplit();
		await openByClick();

		fireEvent.pointerDown(primary());
		fireEvent.click(primary());
		await flush();

		expect({calls: onPrimaryClick.mock.calls.length, menu: screen.queryByRole("menu")}).toStrictEqual({
			calls: 0,
			menu: null,
		});

		fireEvent.click(primary());
		expect(onPrimaryClick.mock.calls.length).toBe(1);
	});

	it("opens with the first item highlighted on Enter and returns focus to the caret on Escape", async () => {
		renderSplit({}, [
			{label: "Allow once", onSelect: () => {}},
			{label: "Deny", onSelect: () => {}},
		]);
		caret().focus();

		/* jsdom does not synthesize the click a real Enter on a button fires, so send both. */
		fireEvent.keyDown(caret(), {key: "Enter"});
		fireEvent.click(caret(), {detail: 0});
		fireEvent.keyUp(caret(), {key: "Enter"});
		await flush();
		const first = screen.getByRole("menuitem", {name: "Allow once"});

		expect(first.getAttribute("data-highlighted")).toBe("");

		fireEvent.keyDown(document.activeElement as HTMLElement, {key: "Escape"});
		await flush();

		expect({menu: screen.queryByRole("menu"), focusedCaret: document.activeElement === caret()}).toStrictEqual({
			menu: null,
			focusedCaret: true,
		});
	});

	it("marks a busy primary aria-busy and aria-disabled and ignores its click", () => {
		const {onPrimaryClick} = renderSplit({busy: true});

		fireEvent.click(primary());

		expect({
			busy: primary().getAttribute("aria-busy"),
			ariaDisabled: primary().getAttribute("aria-disabled"),
			calls: onPrimaryClick.mock.calls.length,
			caretDisabled: (caret() as HTMLButtonElement).disabled,
		}).toStrictEqual({busy: "true", ariaDisabled: "true", calls: 0, caretDisabled: false});
	});

	it("passes aria-disabled through and still fires the primary click", () => {
		const {onPrimaryClick} = renderSplit({"aria-disabled": true});

		fireEvent.click(primary());

		expect({
			ariaDisabled: primary().getAttribute("aria-disabled"),
			calls: onPrimaryClick.mock.calls.length,
		}).toStrictEqual({ariaDisabled: "true", calls: 1});
	});

	it("disables both segments and marks the group data-disabled", () => {
		renderSplit({disabled: true});

		expect({
			dataDisabled: group().getAttribute("data-disabled"),
			primaryDisabled: (primary() as HTMLButtonElement).disabled,
			caretDisabled: (caret() as HTMLButtonElement).disabled,
		}).toStrictEqual({dataDisabled: "", primaryDisabled: true, caretDisabled: true});
	});

	it("renders shortcut keycaps after the label and sets aria-keyshortcuts", () => {
		renderSplit({shortcut: "cmd+enter", "aria-keyshortcuts": "Meta+Enter"});

		expect(primary().getAttribute("aria-keyshortcuts")).toBe("Meta+Enter");
		expect(primary().querySelector("kbd")).not.toBeNull();
	});

	it("shows the menu when controlled open and reports close on item choice", async () => {
		const onOpenChange = vi.fn<(open: boolean) => void>();
		renderSplit({open: true, onOpenChange});
		await flush();

		expect(screen.getByRole("menu")).not.toBeNull();

		fireEvent.click(screen.getByRole("menuitem", {name: "Allow once"}));
		await flush();

		expect(onOpenChange.mock.calls.map((call) => call[0])).toStrictEqual([false]);
	});

	it("leaves no menu behind when unmounted while open", async () => {
		const {unmount} = renderSplit();
		await openByClick();

		unmount();
		await flush();

		expect(screen.queryByRole("menu")).toBeNull();
	});
});
