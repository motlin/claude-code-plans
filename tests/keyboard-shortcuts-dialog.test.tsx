// @vitest-environment jsdom

import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {createMemoryHistory, createRootRoute, createRouter, RouterProvider} from "@tanstack/react-router";
import {act, cleanup, fireEvent, render, screen, waitFor, within} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {CommandPalette} from "../src/components/command-palette";
import {ToastProvider} from "../src/components/toast";
import {KeyboardShortcutsDialog, ShortcutRow} from "../src/components/keyboard-shortcuts-dialog";
import {setKeyboardShortcutsOpen} from "../src/components/keyboard-shortcuts-open";
import {shortcutSections} from "../src/components/keyboard-shortcut-sections";
import {SHORTCUT_IDS, SHORTCUTS} from "../src/lib/shortcuts/registry";

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
	return [...region.querySelectorAll(":scope > div > div:first-child")].map((heading) => heading.textContent);
}

function rowLabels(region: HTMLElement): string[] {
	return [...region.querySelectorAll(":scope > div > div + div > span:first-child")].map(
		(label) => label.textContent,
	);
}

function sectionRowLabels(region: HTMLElement, heading: string): string[] {
	const section = [...region.querySelectorAll(":scope > div")].find(
		(candidate) => candidate.querySelector(":scope > div:first-child")?.textContent === heading,
	);
	return [...(section?.querySelectorAll(":scope > div + div > span:first-child") ?? [])].map(
		(label) => label.textContent,
	);
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

	it("opens on ⌘/ from a focused textarea", async () => {
		const composer = renderWithComposer();

		pressShortcutsKey(composer);

		const dialog = await screen.findByRole("dialog", {name: "Keyboard shortcuts"});
		expect({
			heading: within(dialog).getByRole("heading", {level: 2}).textContent,
			region: within(dialog).getByRole("region", {name: "Keyboard shortcuts"}).tabIndex,
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
		const region = within(dialog).getByRole("region", {name: "Keyboard shortcuts"});
		expect({sections: sectionHeadings(region), rows: rowLabels(region)}).toStrictEqual({
			sections: ["General", "Panes", "Composer"],
			rows: [
				"Search or start a session",
				"Search",
				"Switch between recents",
				"Toggle sidebar",
				"Keyboard shortcuts",
				"Settings",
				"New session",
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
			],
		});
	});

	it("uses the upstream wording for the go-to-file and stop-response rows", async () => {
		const composer = renderWithComposer();
		pressShortcutsKey(composer);

		const dialog = await screen.findByRole("dialog", {name: "Keyboard shortcuts"});
		const region = within(dialog).getByRole("region", {name: "Keyboard shortcuts"});
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

	it("sizes the dialog as upstream: 520px wide, a 22/28 title and rows without a min height", async () => {
		const composer = renderWithComposer();
		pressShortcutsKey(composer);

		const dialog = await screen.findByRole("dialog", {name: "Keyboard shortcuts"});
		const classes = (element: Element | null | undefined) => element?.className.split(" ") ?? [];
		const row = within(dialog).getByText("Settings").parentElement;
		expect({
			width: classes(dialog).includes("max-w-[520px]"),
			title: classes(within(dialog).getByRole("heading", {name: "Keyboard shortcuts"})).filter((name) =>
				["text-[22px]/[28px]", "font-[580]"].includes(name),
			),
			rowMinHeight: classes(row).filter((name) => name.startsWith("min-h-")),
		}).toStrictEqual({width: true, title: ["text-[22px]/[28px]", "font-[580]"], rowMinHeight: []});
	});

	it("uses the 2026-10 upstream chrome: no header strip, no blur, full height, focus on the popup", async () => {
		const composer = renderWithComposer();
		pressShortcutsKey(composer);

		const dialog = await screen.findByRole("dialog", {name: "Keyboard shortcuts"});
		const classes = (element: Element | null | undefined) => element?.className.split(" ") ?? [];
		const column = within(dialog).getByRole("heading", {name: "Keyboard shortcuts"}).parentElement;
		await waitFor(() => {
			expect(document.activeElement).toBe(dialog);
		});
		expect({
			column: classes(column),
			header: classes(column?.parentElement),
			close: classes(within(dialog).getByRole("button", {name: "Close"})).filter((name) =>
				["-me-2", "-mt-2", "h-8", "w-8", "rounded-r6"].includes(name),
			),
			blurred: [...document.querySelectorAll("div")].filter((element) =>
				classes(element).some((name) => name.startsWith("backdrop-blur")),
			).length,
			fullHeight: classes(dialog).includes("h-dvh"),
			cds: dialog.dataset["cds"],
			perfOverlay: dialog.dataset["perfOverlay"],
		}).toStrictEqual({
			column: ["-mt-1", "flex", "min-w-0", "flex-1", "flex-col", "gap-1"],
			header: ["mb-3", "flex", "items-start", "gap-2"],
			close: ["-me-2", "-mt-2", "h-8", "w-8", "rounded-r6"],
			blurred: 0,
			fullHeight: true,
			cds: "Dialog",
			perfOverlay: "keyboard_shortcuts_dialog",
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

describe("shortcutSections", () => {
	it("groups General, Panes, Composer and drops empty groups", () => {
		const allEnabled = shortcutSections(SHORTCUT_IDS, () => true);
		const noneInComposer = shortcutSections(SHORTCUT_IDS, (id) => SHORTCUTS[id].group !== "composer");

		expect({
			all: allEnabled.map((section) => section.title),
			firstComposer: allEnabled[2]?.ids[0],
			lastComposer: allEnabled[2]?.ids.at(-1),
			noComposer: noneInComposer.map((section) => section.title),
		}).toStrictEqual({
			all: ["General", "Panes", "Composer"],
			firstComposer: "open_mode_menu",
			lastComposer: "fork_with_prompt",
			noComposer: ["General", "Panes"],
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
		return container.querySelector(":scope > div > span:last-child");
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
			})),
		).toStrictEqual([
			{tag: "SPAN", cds: "Shortcut", ariaHidden: null, className: null, text: "⌥OptionF5"},
			{tag: "SPAN", cds: null, ariaHidden: "true", className: "text-xs text-muted-as-secondary", text: "or"},
			{tag: "SPAN", cds: "Shortcut", ariaHidden: null, className: null, text: "F7"},
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
