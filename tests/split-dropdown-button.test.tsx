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
	describe("joined looks", () => {
		const TRANSITION = [
			"transition-[background-color,box-shadow,color]",
			"duration-[60ms]",
			"ease-[cubic-bezier(.165,.84,.44,1)]",
		];
		const BASE = ["relative", "outline-none", "focus-visible:shadow-focus", "disabled:opacity-40"];
		const PRIMARY_SEGMENT = [
			"inline-flex",
			"items-center",
			"h-6",
			"px-2",
			"text-[13px]/[19px]",
			"rounded-r5",
			"rounded-e-none",
			"min-w-0",
			"shrink",
		];
		const CARET_SEGMENT = [
			"inline-flex",
			"items-center",
			"justify-center",
			"h-6",
			"w-auto",
			"px-1",
			"rounded-r5",
			"rounded-s-none",
		];
		const SEAM_FADE = [
			"[[data-cds-segment]:hover+&>[data-seam-line]]:opacity-0",
			"[&:has(+[data-cds-segment]:hover)>[data-seam-line]]:opacity-0",
			"[[data-cds-segment]:has([aria-expanded=true])+&>[data-seam-line]]:opacity-0",
			"[&:has(+[data-cds-segment]_[aria-expanded=true])>[data-seam-line]]:opacity-0",
		];
		const SOLID_SEAM_DISABLED =
			"[[data-cds-segment]:has(:disabled)+&:has(+[data-cds-segment]_:disabled)]:opacity-40";
		const ROOT = ["relative", "inline-flex", "w-fit", "shrink-0", "items-stretch", "rounded-r5", "group/split"];

		function seam() {
			const element = group().children[1];
			if (!(element instanceof HTMLElement)) throw new Error("seam missing");
			return element;
		}

		function looks() {
			const line = seam().querySelector("[data-seam-line]");
			return {
				root: [...group().classList],
				primary: [...primary().classList],
				caret: [...caret().classList],
				caretIcon: [...(caret().querySelector("svg")?.classList ?? [])],
				seamHidden: seam().getAttribute("aria-hidden"),
				seam: [...seam().classList],
				line: line === null ? null : [...line.classList],
			};
		}

		it("renders the primary variant as a solid joined pair with a faint on-primary seam line", () => {
			renderSplit({variant: "primary"});

			const fill = [
				"bg-fill-primary",
				"text-on-primary",
				"font-medium",
				"hover:bg-fill-primary-hover",
				"aria-expanded:bg-fill-primary-hover",
			];
			expect(looks()).toStrictEqual({
				root: ROOT,
				primary: [...BASE, ...PRIMARY_SEGMENT, ...fill, ...TRANSITION],
				caret: [...BASE, ...CARET_SEGMENT, ...fill, ...TRANSITION],
				caretIcon: ["lucide", "lucide-chevron-down", "size-4"],
				seamHidden: "true",
				seam: [
					"relative",
					"w-px",
					"shrink-0",
					"self-stretch",
					"bg-fill-primary",
					...SEAM_FADE,
					SOLID_SEAM_DISABLED,
				],
				line: ["absolute", "inset-x-0", "inset-y-1/4", "bg-on-primary", "opacity-25"],
			});
		});

		it("renders the secondary variant with the field-drop shadow, inset ring and a border seam line", () => {
			renderSplit({variant: "secondary"});

			const fill = [
				"bg-fill-secondary",
				"text-primary",
				"hover:bg-fill-secondary-hover",
				"aria-expanded:bg-fill-secondary-hover",
			];
			expect(looks()).toStrictEqual({
				root: [
					...ROOT,
					"shadow-field-drop",
					"after:pointer-events-none",
					"after:absolute",
					"after:inset-0",
					"after:rounded-[inherit]",
					"after:shadow-[inset_0_0_0_1px_var(--color-fill-secondary-ring)]",
				],
				primary: [...BASE, ...PRIMARY_SEGMENT, ...fill, ...TRANSITION],
				caret: [...BASE, ...CARET_SEGMENT, ...fill, ...TRANSITION],
				caretIcon: ["lucide", "lucide-chevron-down", "size-4", "text-ink-muted"],
				seamHidden: "true",
				seam: ["relative", "w-px", "shrink-0", "self-stretch", "bg-fill-secondary", ...SEAM_FADE],
				line: ["absolute", "inset-x-0", "inset-y-1/4", "bg-border"],
			});
		});

		it("defaults to the secondary look and drops the muted caret icon when disabled", () => {
			renderSplit({disabled: true});

			expect({
				shadow: group().classList.contains("shadow-field-drop"),
				caretIcon: [...(caret().querySelector("svg")?.classList ?? [])],
			}).toStrictEqual({shadow: true, caretIcon: ["lucide", "lucide-chevron-down", "size-4"]});
		});

		it("renders the danger variant with the danger fill and an on-danger seam line", () => {
			renderSplit({variant: "danger"});

			const fill = [
				"bg-fill-danger",
				"text-on-danger",
				"font-medium",
				"hover:bg-fill-danger-hover",
				"aria-expanded:bg-fill-danger-hover",
			];
			expect(looks()).toStrictEqual({
				root: ROOT,
				primary: [...BASE, ...PRIMARY_SEGMENT, ...fill, ...TRANSITION],
				caret: [...BASE, ...CARET_SEGMENT, ...fill, ...TRANSITION],
				caretIcon: ["lucide", "lucide-chevron-down", "size-4"],
				seamHidden: "true",
				seam: [
					"relative",
					"w-px",
					"shrink-0",
					"self-stretch",
					"bg-fill-danger",
					...SEAM_FADE,
					SOLID_SEAM_DISABLED,
				],
				line: ["absolute", "inset-x-0", "inset-y-1/4", "bg-on-danger", "opacity-25"],
			});
		});
	});
});
