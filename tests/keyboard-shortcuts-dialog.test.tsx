// @vitest-environment jsdom

import {Dialog} from "@base-ui/react/dialog";
import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {createMemoryHistory, createRootRoute, createRouter, RouterProvider} from "@tanstack/react-router";
import {act, cleanup, fireEvent, render, screen, waitFor, within} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {CommandPalette} from "../src/components/command-palette";
import {ToastProvider} from "../src/components/toast";
import {KeyboardShortcutsDialog, ShortcutRow} from "../src/components/keyboard-shortcuts-dialog";
import {setKeyboardShortcutsOpen} from "../src/components/keyboard-shortcuts-open";
import {DialogPopup} from "../src/components/ui/dialog-popup";
import {shortcutSections} from "../src/components/keyboard-shortcut-sections";
import {SHORTCUT_IDS, SHORTCUTS} from "../src/lib/shortcuts/registry";
import {PanelsOff} from "./fizzy-lake-off";
import {mockTallWindow} from "./tall-window";

const MAC_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";

function renderWithComposer() {
	render(
		<>
			<textarea aria-label="Composer" />
			<KeyboardShortcutsDialog />
		</>,
	);
	const composer = screen.getByRole("textbox", {name: "Composer"});
	composer.focus();
	return composer;
}

function pressShortcutsKey(target: Element, init: KeyboardEventInit = {metaKey: true}) {
	fireEvent.keyDown(target, {key: "/", code: "Slash", ...init});
}

function sectionHeadings(region: HTMLElement): string[] {
	return [...region.querySelectorAll(":scope > div > h3:first-child")].map((heading) => heading.textContent);
}

function rowLabels(region: HTMLElement): string[] {
	return [...region.querySelectorAll(":scope > div > h3 + ul[role=list] > li > span:first-child")].map(
		(label) => label.textContent,
	);
}

function sectionRowLabels(region: HTMLElement, heading: string): string[] {
	const section = [...region.querySelectorAll(":scope > div")].find(
		(candidate) => candidate.querySelector(":scope > h3:first-child")?.textContent === heading,
	);
	return [...(section?.querySelectorAll(":scope > ul > li > span:first-child") ?? [])].map(
		(label) => label.textContent,
	);
}

/** Visible row labels: rows in sections without `hidden`. */
function visibleRowLabels(region: HTMLElement): string[] {
	return [...region.querySelectorAll(":scope > div:not([hidden]) > ul > li > span:first-child")].map(
		(label) => label.textContent,
	);
}

async function openDialog() {
	const composer = renderWithComposer();
	pressShortcutsKey(composer);
	const dialog = await screen.findByRole("dialog", {name: "Keyboard shortcuts"});
	const input = within(dialog).getByRole("searchbox", {name: "Search shortcuts"});
	const region = within(dialog).getByRole("region", {name: "Shortcuts"});
	return {composer, dialog, input: input as HTMLInputElement, region};
}

function typeQuery(input: HTMLInputElement, value: string) {
	fireEvent.change(input, {target: {value, selectionStart: value.length}});
}

describe("KeyboardShortcutsDialog", () => {
	beforeEach(() => {
		vi.spyOn(navigator, "userAgent", "get").mockReturnValue(MAC_UA);
	});

	afterEach(() => {
		act(() => {
			setKeyboardShortcutsOpen(false);
		});
		cleanup();
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	it("fades the outer scroller and the list region like upstream, the region dropping its fades while focused", async () => {
		const {region} = await openDialog();
		const has = (element: Element | null, names: string[]) =>
			names.filter((name) => element?.classList.contains(name));
		expect({
			scroller: has(region.parentElement, ["scroll-fade-y"]),
			region: has(region, [
				"scroll-fade-y",
				"focus-visible:scroll-fade-hide-top",
				"focus-visible:scroll-fade-hide-bottom",
			]),
		}).toStrictEqual({
			scroller: ["scroll-fade-y"],
			region: ["scroll-fade-y", "focus-visible:scroll-fade-hide-top", "focus-visible:scroll-fade-hide-bottom"],
		});
	});

	it("opens on ⌘/ from a focused textarea", async () => {
		const composer = renderWithComposer();

		pressShortcutsKey(composer);

		const dialog = await screen.findByRole("dialog", {name: "Keyboard shortcuts"});
		expect({
			heading: within(dialog).getByRole("heading", {level: 2}).textContent,
			region: within(dialog).getByRole("region", {name: "Shortcuts"}).tabIndex,
			close: within(dialog).getByRole("button", {name: "Close"}).tagName,
		}).toStrictEqual({heading: "Keyboard shortcuts", region: 0, close: "BUTTON"});
	});

	it("matches the physical Slash key so non-US layouts work", async () => {
		const composer = renderWithComposer();

		pressShortcutsKey(composer, {metaKey: true, key: "-"});

		await screen.findByRole("dialog", {name: "Keyboard shortcuts"});
	});

	it("does not open on ⇧⌘/", () => {
		const composer = renderWithComposer();

		pressShortcutsKey(composer, {metaKey: true, shiftKey: true, key: "?"});

		expect(screen.queryByRole("dialog")).toBeNull();
	});

	it("opens on Ctrl+/ off mac", async () => {
		vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (X11; Linux x86_64)");
		const composer = renderWithComposer();

		pressShortcutsKey(composer, {ctrlKey: true});

		await screen.findByRole("dialog", {name: "Keyboard shortcuts"});
	});

	it("stops other listeners from seeing the ⌘/ event", async () => {
		const composer = renderWithComposer();
		const later = vi.fn<(event: KeyboardEvent) => void>();
		document.addEventListener("keydown", later);

		pressShortcutsKey(composer);

		await screen.findByRole("dialog", {name: "Keyboard shortcuts"});
		document.removeEventListener("keydown", later);
		expect(later).not.toHaveBeenCalled();
	});

	it("lists only enabled registry entries, grouped in upstream order", async () => {
		const composer = renderWithComposer();
		pressShortcutsKey(composer);

		const dialog = await screen.findByRole("dialog", {name: "Keyboard shortcuts"});
		const region = within(dialog).getByRole("region", {name: "Shortcuts"});
		expect({sections: sectionHeadings(region), rows: rowLabels(region)}).toStrictEqual({
			sections: ["General", "Panes", "Composer", "Terminals"],
			rows: [
				"Search or start a session",
				"Search",
				"Switch between recents",
				"Toggle sidebar",
				"Keyboard shortcuts",
				"Settings",
				"Focus next page area",
				"Focus previous page area",
				"New session",
				"Select environment",
				"New environment",
				"Rename session",
				"Archive session",
				"Mark session as read/unread",
				"Copy session link",
				"Open session PR",
				"Fork session",
				"Jump to previous prompt",
				"Jump to next prompt",
				"Transcript view",
				"Stop Claude’s response",
				"Rewind the session to an earlier message",
				"Toggle changes",
				"Toggle file list in changes or files",
				"Go to file in changes or files",
				"Toggle Files",
				"Attach selection as context",
				"Toggle terminal",
				"Close pane",
				"Expand or collapse pane",
				"Toggle side chat",
				"Open mode menu",
				"Open model menu",
				"Open effort selector",
				"Select menu item",
				"Add files or photos",
				"Queue for later (while Claude is working)",
				"Send and stay on the new session page",
				"Fork with this prompt",
				"Split terminal right",
				"Split terminal down",
				"Close terminal pane",
				"Rename terminal tab",
				"Next pane in terminal tab",
				"Previous pane in terminal tab",
			],
		});
	});

	it("uses the upstream wording for the go-to-file and stop-response rows", async () => {
		const composer = renderWithComposer();
		pressShortcutsKey(composer);

		const dialog = await screen.findByRole("dialog", {name: "Keyboard shortcuts"});
		const region = within(dialog).getByRole("region", {name: "Shortcuts"});
		expect({
			panes: sectionRowLabels(region, "Panes").includes("Go to file in changes or files"),
			general: sectionRowLabels(region, "General").includes("Stop Claude’s response"),
		}).toStrictEqual({panes: true, general: true});
	});

	it("renders each row's keys as keycaps for the current platform", async () => {
		const composer = renderWithComposer();
		pressShortcutsKey(composer);

		const dialog = await screen.findByRole("dialog", {name: "Keyboard shortcuts"});
		const row = within(dialog).getByText("Settings").parentElement;
		expect([...(row?.querySelectorAll("kbd") ?? [])].map((kbd) => kbd.textContent)).toStrictEqual([
			"⇧Shift",
			"⌘Command",
			",",
		]);
	});

	it("lists Select environment as ⌥⌘1…9 and New environment as ⌥⌘0", async () => {
		const composer = renderWithComposer();
		pressShortcutsKey(composer);

		const dialog = await screen.findByRole("dialog", {name: "Keyboard shortcuts"});
		const keycaps = (label: string) =>
			[...(within(dialog).getByText(label).parentElement?.querySelectorAll("kbd") ?? [])].map(
				(kbd) => kbd.textContent,
			);
		expect({select: keycaps("Select environment"), create: keycaps("New environment")}).toStrictEqual({
			select: ["⌥Option", "⌘Command", "1…9"],
			create: ["⌥Option", "⌘Command", "0"],
		});
	});

	it("lists Send and stay on the new session page with ⌘⏎ keycaps", async () => {
		const composer = renderWithComposer();
		pressShortcutsKey(composer);

		const dialog = await screen.findByRole("dialog", {name: "Keyboard shortcuts"});
		const row = within(dialog).getByText("Send and stay on the new session page").parentElement;
		expect([...(row?.querySelectorAll("kbd") ?? [])].map((kbd) => kbd.textContent)).toStrictEqual([
			"⌘Command",
			"⏎Enter",
		]);
	});

	it("sizes the dialog as upstream: 520px wide, a 15/20 w520 title and rows without a min height", async () => {
		const composer = renderWithComposer();
		pressShortcutsKey(composer);

		const dialog = await screen.findByRole("dialog", {name: "Keyboard shortcuts"});
		const classes = (element: Element | null | undefined) => element?.className.split(" ") ?? [];
		const row = within(dialog).getByText("Settings").parentElement;
		expect({
			width: classes(dialog).includes("max-w-[520px]"),
			title: ["min-w-0", "flex-1", "text-[15px]/[20px]", "font-[520]"].filter((name) =>
				classes(within(dialog).getByRole("heading", {name: "Keyboard shortcuts"})).includes(name),
			),
			rowMinHeight: classes(row).filter((name) => name.startsWith("min-h-")),
		}).toStrictEqual({
			width: true,
			title: ["min-w-0", "flex-1", "text-[15px]/[20px]", "font-[520]"],
			rowMinHeight: [],
		});
	});

	it("uses the 2026-11 upstream chrome: a sticky 44px band, 16px padding, no blur, full height", async () => {
		const media = mockTallWindow(true);
		try {
			const {dialog} = await openDialog();
			const classes = (element: Element | null | undefined) => element?.className.split(" ") ?? [];
			const band = within(dialog).getByRole("heading", {name: "Keyboard shortcuts"}).parentElement;
			const close = within(dialog).getByRole("button", {name: "Close"});
			const region = within(dialog).getByRole("region", {name: "Shortcuts"});
			const pick = (element: Element | null | undefined, names: string[]) =>
				names.filter((name) => classes(element).includes(name));
			const tall = [dialog.hasAttribute("data-cds-tall-window")];
			act(() => {
				media.setMatches(false);
			});
			tall.push(dialog.hasAttribute("data-cds-tall-window"));
			expect({
				bandPart: band?.dataset["cdsPart"],
				band: pick(band, [
					"sticky",
					"-top-4",
					"[:where([data-cds-tall-window])_&]:-top-4",
					"z-[1000]",
					"-mx-4",
					"first:-mt-4",
					"mb-1",
					"flex",
					"min-h-11",
					"min-h-12",
					"panels-fine:min-h-11",
					"shrink-0",
					"items-center",
					"gap-1",
					"ps-4",
					"pe-2",
					"py-2",
					"bg-page",
					"after:opacity-0",
					"supports-[animation-timeline:scroll()]:after:opacity-0",
					"after:border-b",
					"[:where([data-cds-tall-window])_&]:after:border-b",
				]),
				close: pick(close, [
					"size-7",
					"size-8",
					"panels-fine:size-7",
					"self-start",
					"-me-2",
					"-mt-2",
					"h-8",
					"w-8",
				]),
				scroller: pick(band?.parentElement, [
					"p-4",
					"scroll-pt-[52px]",
					"[:where([data-cds-tall-window])_&]:scroll-pt-[56px]",
					"panels-fine:[:where([data-cds-tall-window])_&]:scroll-pt-[52px]",
					"p-6",
				]),
				region: pick(region, ["-mx-4", "-mb-4", "px-4", "pb-4"]),
				transition: classes(dialog).includes("transition-[opacity,scale,filter]"),
				blurred: [...document.querySelectorAll("div")].filter((element) =>
					classes(element).some((name) => name.startsWith("backdrop-blur")),
				).length,
				fullHeight: classes(dialog).includes("h-dvh"),
				cds: dialog.dataset["cds"],
				fizzy: dialog.dataset["cdsFizzy"],
				tall,
				perfOverlay: dialog.dataset["perfOverlay"],
			}).toStrictEqual({
				bandPart: "band",
				band: [
					"sticky",
					"[:where([data-cds-tall-window])_&]:-top-4",
					"z-[1000]",
					"-mx-4",
					"first:-mt-4",
					"mb-1",
					"flex",
					"min-h-12",
					"panels-fine:min-h-11",
					"shrink-0",
					"items-center",
					"gap-1",
					"ps-4",
					"pe-2",
					"py-2",
					"bg-page",
					"supports-[animation-timeline:scroll()]:after:opacity-0",
					"[:where([data-cds-tall-window])_&]:after:border-b",
				],
				close: ["size-8", "panels-fine:size-7", "self-start"],
				scroller: [
					"p-4",
					"[:where([data-cds-tall-window])_&]:scroll-pt-[56px]",
					"panels-fine:[:where([data-cds-tall-window])_&]:scroll-pt-[52px]",
				],
				region: ["-mx-4", "-mb-4", "px-4", "pb-4"],
				transition: true,
				blurred: 0,
				fullHeight: true,
				cds: "Dialog",
				fizzy: "",
				tall: [true, false],
				perfOverlay: "keyboard_shortcuts_dialog",
			});
		} finally {
			media.restore();
		}
	});

	it("keeps the band with panels off, as upstream forces comfortable on this dialog", async () => {
		render(
			<PanelsOff>
				<KeyboardShortcutsDialog />
			</PanelsOff>,
		);
		act(() => {
			setKeyboardShortcutsOpen(true);
		});
		const dialog = await screen.findByRole("dialog", {name: "Keyboard shortcuts"});
		expect({
			band: within(dialog).getByRole("heading", {name: "Keyboard shortcuts"}).parentElement?.dataset["cdsPart"],
			fizzy: dialog.getAttribute("data-cds-fizzy"),
		}).toStrictEqual({band: "band", fizzy: null});
	});

	it("renders sections as h3 + ul[role=list] and rows as li with an sr-only nbsp", async () => {
		const {region} = await openDialog();
		const section = region.querySelector(":scope > div:not([role])");
		const heading = section?.firstElementChild;
		const row = section?.querySelector(":scope > ul > li");
		expect({
			heading: {tag: heading?.tagName, className: heading?.className},
			list: section?.children[1]?.getAttribute("role"),
			row: {
				className: row?.className,
				children: [...(row?.children ?? [])].map((child) => ({
					className: child.className,
					text: child.textContent,
				})),
			},
		}).toStrictEqual({
			heading: {tag: "H3", className: "text-body-regular mt-5 py-2"},
			list: "list",
			row: {
				className:
					"relative flex items-center justify-between border-b-[0.5px] border-border py-2 last:border-0",
				children: [
					{className: "flex items-center gap-2 text-sm text-secondary", text: "Search or start a session"},
					{className: "sr-only select-none", text: "\u00a0"},
					{className: "flex items-center gap-2", text: "⌘CommandK"},
				],
			},
		});
	});

	it("lists Focus next/previous page area as F6 and ⇧F6 after Settings", async () => {
		const {dialog} = await openDialog();
		const keycaps = (label: string) =>
			[...(within(dialog).getByText(label).parentElement?.querySelectorAll("kbd") ?? [])].map(
				(kbd) => kbd.textContent,
			);
		expect({next: keycaps("Focus next page area"), previous: keycaps("Focus previous page area")}).toStrictEqual({
			next: ["F6"],
			previous: ["⇧Shift", "F6"],
		});
	});

	it("lists Search with ⇧⌘K keycaps", async () => {
		const composer = renderWithComposer();
		pressShortcutsKey(composer);

		const dialog = await screen.findByRole("dialog", {name: "Keyboard shortcuts"});
		const row = within(dialog).getByText("Search").parentElement;
		expect([...(row?.querySelectorAll("kbd") ?? [])].map((kbd) => kbd.textContent)).toStrictEqual([
			"⇧Shift",
			"⌘Command",
			"K",
		]);
	});

	it("closes on Escape and returns focus to the composer", async () => {
		const composer = renderWithComposer();
		pressShortcutsKey(composer);
		const dialog = await screen.findByRole("dialog", {name: "Keyboard shortcuts"});

		fireEvent.keyDown(dialog, {key: "Escape", code: "Escape"});

		await waitFor(() => {
			expect(screen.queryByRole("dialog")).toBeNull();
		});
		await waitFor(() => {
			expect(document.activeElement).toBe(composer);
		});
	});

	it("returns focus to the Settings-like dialog button it was opened from", async () => {
		render(
			<>
				<Dialog.Root open>
					<Dialog.Portal>
						<DialogPopup aria-label="Settings">
							<button
								type="button"
								onClick={() => {
									setKeyboardShortcutsOpen(true);
								}}
							>
								Shortcuts
							</button>
						</DialogPopup>
					</Dialog.Portal>
				</Dialog.Root>
				<KeyboardShortcutsDialog />
			</>,
		);
		const button = await screen.findByRole("button", {name: "Shortcuts"});
		await waitFor(() => {
			expect(document.activeElement).toBe(button);
		});
		fireEvent.click(button);
		const dialog = await screen.findByRole("dialog", {name: "Keyboard shortcuts"});
		await waitFor(() => {
			expect(dialog.contains(document.activeElement)).toBe(true);
		});

		fireEvent.keyDown(dialog, {key: "Escape", code: "Escape"});

		await waitFor(() => {
			expect(screen.queryByRole("dialog", {name: "Keyboard shortcuts"})).toBeNull();
		});
		await waitFor(() => {
			expect(document.activeElement).toBe(button);
		});
	});

	it("closes on the Close button", async () => {
		const composer = renderWithComposer();
		pressShortcutsKey(composer);
		const dialog = await screen.findByRole("dialog", {name: "Keyboard shortcuts"});

		fireEvent.click(within(dialog).getByRole("button", {name: "Close"}));

		await waitFor(() => {
			expect(screen.queryByRole("dialog")).toBeNull();
		});
	});
});

describe("KeyboardShortcutsDialog search", () => {
	beforeEach(() => {
		vi.spyOn(navigator, "userAgent", "get").mockReturnValue(MAC_UA);
	});

	afterEach(() => {
		act(() => {
			setKeyboardShortcutsOpen(false);
		});
		cleanup();
		vi.restoreAllMocks();
	});

	it("focuses the Search shortcuts field in a Search toolbar on open", async () => {
		const {dialog, input} = await openDialog();
		const toolbar = within(dialog).getByRole("toolbar", {name: "Search"});
		await waitFor(() => {
			expect(document.activeElement).toBe(input);
		});
		expect({
			type: input.type,
			placeholder: input.placeholder,
			toolbar: {
				cds: toolbar.dataset["cds"],
				flush: toolbar.hasAttribute("data-flush"),
				className: toolbar.className,
			},
			inToolbar: toolbar.contains(input),
			field: ["h-control", "rounded", "ps-md", "pe-md", "bg-fill-field", "shadow-field-ring"].filter((name) =>
				input.closest("[data-cds=TextInput]")?.className.split(" ").includes(name),
			),
			input: input.className.split(" ").includes("cds-input"),
			status: dialog.querySelector("[role=region] > [role=status]:first-child")?.innerHTML,
		}).toStrictEqual({
			type: "search",
			placeholder: "Search shortcuts",
			toolbar: {cds: "Toolbar", flush: true, className: "flex shrink-0 items-center gap-1 py-2"},
			inToolbar: true,
			field: ["h-control", "rounded", "ps-md", "pe-md", "bg-fill-field", "shadow-field-ring"],
			input: true,
			status: "",
		});
	});

	it("filters rows by label, hides empty sections and announces the count", async () => {
		const {input, region} = await openDialog();

		typeQuery(input, "terminal");

		expect({
			rows: visibleRowLabels(region),
			hidden: [...region.querySelectorAll(":scope > div[hidden] > h3")].map((heading) => heading.textContent),
			status: region.querySelector(":scope > [role=status]")?.innerHTML,
			tabIndex: region.getAttribute("tabindex"),
		}).toStrictEqual({
			rows: [
				"Toggle terminal",
				"Split terminal right",
				"Split terminal down",
				"Close terminal pane",
				"Rename terminal tab",
				"Next pane in terminal tab",
				"Previous pane in terminal tab",
			],
			hidden: ["General", "Composer"],
			status: '<p class="sr-only">7 shortcuts found</p>',
			tabIndex: "0",
		});
	});

	it("filters by key names", async () => {
		const {input, region} = await openDialog();

		typeQuery(input, "ctrl shift");

		expect({
			rows: visibleRowLabels(region),
			status: region.querySelector(":scope > [role=status]")?.textContent,
		}).toStrictEqual({
			rows: ["Toggle changes", "Toggle file list in changes or files"],
			status: "2 shortcuts found",
		});
	});

	it('shows "No matching shortcuts" and drops the region tabindex', async () => {
		const {input, region} = await openDialog();

		typeQuery(input, "zzqx");

		expect({
			rows: visibleRowLabels(region),
			status: region.querySelector(":scope > [role=status]")?.innerHTML,
			tabIndex: region.getAttribute("tabindex"),
		}).toStrictEqual({
			rows: [],
			status: '<p class="pt-7 pb-2 text-body text-muted-as-secondary">No matching shortcuts</p>',
			tabIndex: null,
		});
	});

	it("shows a Clear button only with text, and it empties the field", async () => {
		const {dialog, input, region} = await openDialog();
		const before = within(dialog).queryByRole("button", {name: "Clear"});

		typeQuery(input, "terminal");
		const clear = within(dialog).getByRole("button", {name: "Clear"});
		const nested = {tabIndex: clear.tabIndex, endSlot: clear.parentElement?.hasAttribute("data-cds-end-slot")};
		fireEvent.click(clear);

		expect({before, nested, value: input.value, rows: visibleRowLabels(region).length}).toStrictEqual({
			before: null,
			nested: {tabIndex: -1, endSlot: true},
			value: "",
			rows: rowLabels(region).length,
		});
	});

	it("clears the query on the first Escape and closes on the second", async () => {
		const {input} = await openDialog();
		typeQuery(input, "terminal");

		fireEvent.keyDown(input, {key: "Escape", code: "Escape"});
		const afterFirst = {value: input.value, open: screen.queryByRole("dialog") !== null};
		fireEvent.keyDown(input, {key: "Escape", code: "Escape"});

		expect(afterFirst).toStrictEqual({value: "", open: true});
		await waitFor(() => {
			expect(screen.queryByRole("dialog")).toBeNull();
		});
	});

	it("records a pressed chord without letting it reach other listeners", async () => {
		const {dialog, input, region} = await openDialog();
		const toggle = within(dialog).getByRole("button", {name: "Record keys"});
		const pressedBefore = toggle.getAttribute("aria-pressed");
		const later = vi.fn<(event: KeyboardEvent) => void>();
		document.addEventListener("keydown", later);
		typeQuery(input, "terminal");
		input.focus();

		const mouseDown = fireEvent.mouseDown(toggle);
		fireEvent.click(toggle);
		const recording = {
			pressed: toggle.getAttribute("aria-pressed"),
			value: input.value,
			placeholder: input.placeholder,
			hint: document.getElementById(input.getAttribute("aria-describedby") ?? "")?.outerHTML,
			focused: document.activeElement === input,
			mouseDownAllowed: mouseDown,
		};
		const keyAllowed = fireEvent.keyDown(input, {key: "k", code: "KeyK", metaKey: true});
		document.removeEventListener("keydown", later);

		expect({
			pressedBefore,
			recording,
			keyAllowed,
			laterCalls: later.mock.calls.length,
			value: input.value,
			rows: visibleRowLabels(region),
			status: [...(region.querySelector(":scope > [role=status]")?.children ?? [])].map((child) => ({
				className: child.className,
				text: child.textContent,
			})),
		}).toStrictEqual({
			pressedBefore: "false",
			recording: {
				pressed: "true",
				value: "",
				placeholder: "Press a shortcut",
				hint: expect.stringContaining("to stop"),
				focused: true,
				mouseDownAllowed: false,
			},
			keyAllowed: false,
			laterCalls: 0,
			value: "⌘K",
			rows: ["Search or start a session"],
			status: [
				{className: "sr-only", text: "⌘CommandK"},
				{className: "sr-only", text: "1 shortcut found"},
			],
		});
	});

	it("renders the recording hint as an Esc keycap and 'to stop'", async () => {
		const {dialog, input} = await openDialog();
		fireEvent.click(within(dialog).getByRole("button", {name: "Record keys"}));
		const hint = document.getElementById(input.getAttribute("aria-describedby") ?? "");

		expect({
			className: hint?.className,
			kbd: hint?.querySelector("kbd")?.textContent,
			text: hint?.textContent,
		}).toStrictEqual({className: "flex items-center gap-2 text-caption", kbd: "Esc", text: "Esc to stop"});
	});

	it("stops recording on plain Escape and keeps the chord; typing then becomes a text query", async () => {
		const {dialog, input, region} = await openDialog();
		const toggle = within(dialog).getByRole("button", {name: "Record keys"});
		fireEvent.click(toggle);
		fireEvent.keyDown(input, {key: "k", code: "KeyK", metaKey: true});

		fireEvent.keyDown(input, {key: "Escape", code: "Escape"});
		const stopped = {
			pressed: toggle.getAttribute("aria-pressed"),
			value: input.value,
			open: screen.queryByRole("dialog") !== null,
			placeholder: input.placeholder,
		};
		typeQuery(input, "⌘Kx");

		expect({stopped, value: input.value, rows: visibleRowLabels(region)}).toStrictEqual({
			stopped: {pressed: "false", value: "⌘K", open: true, placeholder: "Search shortcuts"},
			value: "x",
			rows: [
				"Focus next page area",
				"Jump to next prompt",
				"Attach selection as context",
				"Expand or collapse pane",
				"Next pane in terminal tab",
			],
		});
	});

	it("stops recording on blur and lets plain Tab through", async () => {
		const {dialog, input} = await openDialog();
		const toggle = within(dialog).getByRole("button", {name: "Record keys"});
		fireEvent.click(toggle);

		const tabAllowed = fireEvent.keyDown(input, {key: "Tab", code: "Tab"});
		fireEvent.blur(input);

		expect({tabAllowed, pressed: toggle.getAttribute("aria-pressed")}).toStrictEqual({
			tabAllowed: true,
			pressed: "false",
		});
	});
});

describe("shortcutSections", () => {
	it("groups General, Panes, Composer, Terminals and drops empty groups", () => {
		const allEnabled = shortcutSections(SHORTCUT_IDS, () => true);
		const noneInComposer = shortcutSections(SHORTCUT_IDS, (id) => SHORTCUTS[id].group !== "composer");

		expect({
			all: allEnabled.map((section) => section.title),
			firstComposer: allEnabled[2]?.ids[0],
			lastComposer: allEnabled[2]?.ids.at(-1),
			noComposer: noneInComposer.map((section) => section.title),
		}).toStrictEqual({
			all: ["General", "Panes", "Composer", "Terminals"],
			firstComposer: "open_mode_menu",
			lastComposer: "fork_with_prompt",
			noComposer: ["General", "Panes", "Terminals"],
		});
	});
});

describe("Command palette Keyboard shortcuts item", () => {
	beforeEach(() => {
		vi.stubGlobal("fetch", async () => new Promise(() => {}));
		vi.stubGlobal(
			"ResizeObserver",
			class {
				observe() {}
				unobserve() {}
				disconnect() {}
			},
		);
		Element.prototype.scrollIntoView = () => {};
	});

	afterEach(() => {
		act(() => {
			setKeyboardShortcutsOpen(false);
		});
		cleanup();
		vi.unstubAllGlobals();
	});

	it("opens the shortcuts dialog", async () => {
		const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}});
		const rootRoute = createRootRoute({
			component: () => (
				<QueryClientProvider client={queryClient}>
					<ToastProvider>
						<CommandPalette open onOpenChange={() => {}} />
						<KeyboardShortcutsDialog />
					</ToastProvider>
				</QueryClientProvider>
			),
		});
		const router = createRouter({
			routeTree: rootRoute,
			history: createMemoryHistory({initialEntries: ["/"]}),
		});
		await router.load();
		render(<RouterProvider router={router} />);
		// The palette's empty state lists only New session; the action answers a typed query.
		fireEvent.change(await screen.findByRole("combobox"), {target: {value: "keyboard"}});

		fireEvent.click(await screen.findByRole("option", {name: /^Keyboard shortcuts/}));

		await screen.findByRole("dialog", {name: "Keyboard shortcuts"});
	});
});

describe("ShortcutRow", () => {
	const twoBindings = [
		{key: "f5", modifiers: ["alt"], platform: "mac"},
		{key: "f7", modifiers: [], platform: "mac"},
	] as const;

	beforeEach(() => {
		vi.spyOn(navigator, "userAgent", "get").mockReturnValue(MAC_UA);
	});

	afterEach(() => {
		cleanup();
		vi.restoreAllMocks();
	});

	function keysCell(container: HTMLElement): Element | null {
		return container.querySelector(":scope > li > span:last-child");
	}

	it('joins every binding with an upstream "or" separator when dialogShowsAllBindings is set', () => {
		const {container} = render(
			<ShortcutRow
				definition={{
					description: "Next change in changes",
					group: "panes",
					bindings: twoBindings,
					ownerSlug: "test",
					enabled: true,
					dialogShowsAllBindings: true,
				}}
				isMac
				isWindows={false}
			/>,
		);

		const cell = keysCell(container);
		expect(
			[...(cell?.children ?? [])].map((child) => ({
				tag: child.tagName,
				cds: child.getAttribute("data-cds"),
				ariaHidden: child.getAttribute("aria-hidden"),
				className: child.getAttribute("data-cds") === null ? child.className : null,
				text: child.textContent,
				parts:
					child.getAttribute("data-cds") === null
						? [...child.childNodes].map((node) =>
								node instanceof Element ? `${node.className}:${node.textContent}` : node.textContent,
							)
						: null,
			})),
		).toStrictEqual([
			{tag: "SPAN", cds: "Shortcut", ariaHidden: null, className: null, text: "⌥OptionF5", parts: null},
			{
				tag: "SPAN",
				cds: null,
				ariaHidden: null,
				className: "text-caption text-muted-as-secondary",
				text: "\u00a0or\u00a0",
				parts: ["sr-only select-none:\u00a0", "or", "sr-only select-none:\u00a0"],
			},
			{tag: "SPAN", cds: "Shortcut", ariaHidden: null, className: null, text: "F7", parts: null},
		]);
	});

	it("renders only the first binding without the flag, like upstream shortcutId rows", () => {
		const {container} = render(
			<ShortcutRow
				definition={{
					description: "Next change in changes",
					group: "panes",
					bindings: twoBindings,
					ownerSlug: "test",
					enabled: true,
				}}
				isMac
				isWindows={false}
			/>,
		);

		const cell = keysCell(container);
		expect([...(cell?.children ?? [])].map((child) => child.textContent)).toStrictEqual(["⌥OptionF5"]);
	});
});
