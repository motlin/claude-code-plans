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

	describe("ghost look", () => {
		const BASE = ["relative", "outline-none", "focus-visible:shadow-focus", "disabled:opacity-40"];
		const GHOST_BUTTON = ["group/btn", "isolate", "inline-flex", "items-center", "rounded-r5"];
		const RING = [
			"shadow-[inset_0_0_0_1px_var(--split-ring,transparent)]",
			"transition-[box-shadow]",
			"duration-[60ms]",
			"ease-[cubic-bezier(.165,.84,.44,1)]",
			"[&:not([data-disabled])]:hover:[--split-ring:var(--color-border)]",
			"data-[popup-open]:[--split-ring:var(--color-border)]",
			"[&:not([data-disabled])]:has-[[aria-pressed=true]]:[--split-ring:var(--color-border)]",
		];
		const ROOT = ["relative", "inline-flex", "w-fit", "shrink-0", "items-stretch", "rounded-r5", "group/split"];
		const PAINT = [
			"absolute",
			"inset-0",
			"-z-[1]",
			"rounded-[inherit]",
			"p-[var(--split-inset)]",
			"bg-clip-content",
			"group-hover/btn:bg-fill-ghost-hover",
			"group-aria-expanded/btn:bg-fill-ghost-hover",
			"group-aria-pressed/btn:bg-accent-100/15",
			"transition-[background-color,box-shadow,color]",
			"duration-[60ms]",
			"ease-[cubic-bezier(.165,.84,.44,1)]",
		];
		const STYLE = {
			h: "24px",
			tuck: "calc((var(--split-h) - 20px) / 2)",
			inset: "min(calc(var(--split-tuck) / 2), 3px)",
		};

		function paintOf(button: HTMLElement) {
			const paint = button.querySelector("[data-part=paint]");
			return paint === null ? null : {hidden: paint.getAttribute("aria-hidden"), classes: [...paint.classList]};
		}

		function ghostLooks(root: HTMLElement, primaryButton: HTMLElement, caretButton: HTMLElement) {
			const seamElement = root.children[1];
			if (!(seamElement instanceof HTMLElement)) throw new Error("seam missing");
			return {
				root: [...root.classList],
				style: {
					h: root.style.getPropertyValue("--split-h"),
					tuck: root.style.getPropertyValue("--split-tuck"),
					inset: root.style.getPropertyValue("--split-inset"),
				},
				primary: [...primaryButton.classList],
				primaryPaint: paintOf(primaryButton),
				caret: [...caretButton.classList],
				caretPaint: paintOf(caretButton),
				seam: [...seamElement.classList],
				seamChildren: seamElement.children.length,
			};
		}

		it("renders the icon-only ghost with the ring, inset paint, caret tuck and widened caret hit area", () => {
			render(
				<SplitDropdownButton
					variant="ghost"
					icon={<svg data-testid="send-icon" />}
					aria-label="Send"
					menuLabel="More send options"
					items={[{label: "Send later", onSelect: () => {}}]}
					onPrimaryClick={() => {}}
				/>,
			);

			expect(
				ghostLooks(
					screen.getByRole("group", {name: "Send"}),
					screen.getByRole("button", {name: "Send"}),
					screen.getByRole("button", {name: "More send options"}),
				),
			).toStrictEqual({
				root: [...ROOT, ...RING],
				style: STYLE,
				primary: [
					...BASE,
					...GHOST_BUTTON,
					"justify-center",
					"aria-pressed:text-accent-100",
					"size-[var(--split-h)]",
					"group-data-[popup-open]/split:pointer-events-none",
				],
				primaryPaint: {hidden: "true", classes: PAINT},
				caret: [
					...BASE,
					...GHOST_BUTTON,
					"justify-center",
					"h-[var(--split-h)]",
					"w-auto",
					"px-1",
					"-ms-[var(--split-tuck)]",
					"pointer-events-none",
					"after:absolute",
					"after:inset-y-0",
					"after:content-['']",
					"after:pointer-events-auto",
					"after:start-[calc(var(--split-tuck)-1px)]",
					"after:-end-[calc(3px+var(--split-tuck))]",
				],
				caretPaint: {hidden: "true", classes: PAINT},
				seam: ["w-px", "shrink-0", "self-stretch"],
				seamChildren: 0,
			});
		});

		it("renders the labeled ghost with flush inner paints and a caret hit area past its end", () => {
			renderSplit({variant: "ghost"});

			expect(ghostLooks(group(), primary(), caret())).toStrictEqual({
				root: [
					...ROOT,
					...RING,
					"[&>[data-cds-segment]:first-child_[data-part=paint]]:pe-0",
					"[&>[data-cds-segment]:last-child_[data-part=paint]]:ps-0",
				],
				style: STYLE,
				primary: [
					...BASE,
					...GHOST_BUTTON,
					"aria-pressed:text-accent-100",
					"h-[var(--split-h)]",
					"min-w-0",
					"shrink",
					"text-[13px]/[19px]",
					"ps-2",
					"pe-[5px]",
				],
				primaryPaint: {hidden: "true", classes: PAINT},
				caret: [
					...BASE,
					...GHOST_BUTTON,
					"justify-center",
					"h-[var(--split-h)]",
					"w-auto",
					"ps-0",
					"pe-1",
					"after:absolute",
					"after:inset-y-0",
					"after:start-0",
					"after:-end-2",
					"after:content-['']",
				],
				caretPaint: {hidden: "true", classes: PAINT},
				seam: ["w-px", "shrink-0", "self-stretch"],
				seamChildren: 0,
			});
		});

		it("uses a 28px control height for the touch ghost", () => {
			renderSplit({variant: "ghost", size: "touch"});

			expect(group().style.getPropertyValue("--split-h")).toBe("28px");
		});

		it("marks the root data-popup-open while the ghost menu is open", async () => {
			renderSplit({variant: "ghost"});

			const before = group().hasAttribute("data-popup-open");
			await openByClick();

			expect({before, open: group().getAttribute("data-popup-open")}).toStrictEqual({before: false, open: ""});
		});

		it("sets aria-pressed on a pressed ghost primary", () => {
			renderSplit({variant: "ghost", pressed: true});

			expect(primary().getAttribute("aria-pressed")).toBe("true");
		});

		it("adds no paint layer to the joined variants", () => {
			renderSplit({variant: "primary"});

			expect(group().querySelectorAll("[data-part=paint]").length).toBe(0);
		});
	});

	describe("size scale", () => {
		function sizeLooks() {
			return {
				h: group().style.getPropertyValue("--split-h"),
				root: [...group().classList].filter((name) => name.startsWith("rounded")),
				primary: [...primary().classList].filter((name) => /^(h-|px-|text-\[|rounded-r)/.test(name)),
				caret: [...caret().classList].filter((name) => /^(h-|rounded-r)/.test(name)),
				caretIcon: [...(caret().querySelector("svg")?.classList ?? [])].filter((name) =>
					name.startsWith("size-"),
				),
			};
		}

		it("sizes the default split to 24px controls with 13/19 text and a 6px radius", () => {
			renderSplit({variant: "primary"});

			expect(sizeLooks()).toStrictEqual({
				h: "24px",
				root: ["rounded-r5"],
				primary: ["h-6", "px-2", "text-[13px]/[19px]", "rounded-r5"],
				caret: ["h-6", "rounded-r5"],
				caretIcon: ["size-4"],
			});
		});

		it("sizes the sm split to 20px controls with 12/17 text, a 5px radius and a 12px caret icon", () => {
			renderSplit({variant: "primary", size: "sm"});

			expect(sizeLooks()).toStrictEqual({
				h: "20px",
				root: ["rounded-r4"],
				primary: ["h-5", "px-1.5", "text-[12px]/[17px]", "rounded-r4"],
				caret: ["h-5", "rounded-r4"],
				caretIcon: ["size-3"],
			});
		});

		it("sizes the touch split to 28px controls with an 8px radius", () => {
			renderSplit({variant: "secondary", size: "touch"});

			expect(sizeLooks()).toStrictEqual({
				h: "28px",
				root: ["rounded-r6"],
				primary: ["h-7", "px-2", "text-[13px]/[19px]", "rounded-r6"],
				caret: ["h-7", "rounded-r6"],
				caretIcon: ["size-4"],
			});
		});

		it("gives the sm ghost its 5px radius and 12/17 label text", () => {
			renderSplit({variant: "ghost", size: "sm"});

			expect({
				h: group().style.getPropertyValue("--split-h"),
				root: [...group().classList].filter((name) => name.startsWith("rounded")),
				primary: [...primary().classList].filter((name) => /^(text-\[|rounded-r)/.test(name)),
				caret: [...caret().classList].filter((name) => name.startsWith("rounded-r")),
				caretIcon: [...(caret().querySelector("svg")?.classList ?? [])].filter((name) =>
					name.startsWith("size-"),
				),
			}).toStrictEqual({
				h: "20px",
				root: ["rounded-r4"],
				primary: ["rounded-r4", "text-[12px]/[17px]"],
				caret: ["rounded-r4"],
				caretIcon: ["size-3"],
			});
		});
	});

	describe("status slot", () => {
		function slot() {
			const next = primary().nextElementSibling;
			if (!(next instanceof HTMLElement)) throw new Error("no status slot");
			return next;
		}

		it("renders no slot without a status", () => {
			renderSplit();

			expect(primary().nextElementSibling).toBeNull();
		});

		it("renders the status after the primary in the variant fill", () => {
			renderSplit({variant: "secondary", status: "3"});

			expect({
				name: primary().getAttribute("aria-label") ?? primary().textContent,
				text: slot().textContent,
				tag: slot().tagName,
				sameParent: slot().parentElement === primary().parentElement,
				primary: [...primary().classList].filter((name) => /^(peer\/slot|ps-|pe-|px-|rounded-e)/.test(name)),
				slot: [...slot().classList],
			}).toStrictEqual({
				name: "Always allow",
				text: "3",
				tag: "SPAN",
				sameParent: true,
				primary: ["ps-2", "pe-1", "rounded-e-none", "peer/slot"],
				slot: [
					"flex",
					"shrink-0",
					"items-center",
					"self-stretch",
					"pe-3",
					"transition-colors",
					"duration-[60ms]",
					"ease-out",
					"peer-disabled/slot:opacity-40",
					"bg-fill-secondary",
					"peer-hover/slot:bg-fill-secondary-hover",
				],
			});
		});

		it("squares the ghost primary's end and rounds the slot's end", () => {
			renderSplit({variant: "ghost", status: "3"});

			expect({
				primary: [...primary().classList].filter((name) => /^(peer\/slot|ps-|pe-|rounded-e)/.test(name)),
				slot: [...slot().classList].filter((name) => /(bg-|rounded)/.test(name)),
			}).toStrictEqual({
				primary: ["ps-2", "pe-1", "peer/slot", "rounded-e-none"],
				slot: ["peer-hover/slot:bg-fill-ghost-hover", "rounded-e-r5"],
			});
		});
	});
});
