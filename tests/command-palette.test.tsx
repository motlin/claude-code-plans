// @vitest-environment jsdom

import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	Outlet,
	RouterProvider,
} from "@tanstack/react-router";
import {act, cleanup, fireEvent, render, screen, waitFor, within} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {CommandPalette, PALETTE_RECENT_LIMIT} from "../src/components/command-palette";
import {ToastProvider} from "../src/components/toast";
import {useCommandPalette} from "../src/hooks/use-command-palette";
import {artifactsQueryOptions, type ArtifactSummary} from "../src/lib/api/artifacts";
import type {z} from "zod";
import {MemoryListResponse, projectMemoriesQueryOptions} from "../src/lib/api/memories";
import {plansQueryOptions} from "../src/lib/api/plans";
import {projectsQueryOptions} from "../src/lib/api/projects";
import {routinesQueryOptions, type Routine} from "../src/lib/api/routines";
import {recentSessionsQueryOptions, sessionQueryKeys} from "../src/lib/api/sessions";
import {saveRecents, type RecentEntry} from "../src/lib/recents-history";

const MAC_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";

type Bucket = "blocked" | "review" | "working" | "done";

function recentSession(
	id: string,
	title: string,
	bucket: Bucket = "done",
	overrides: Partial<{
		unseen: boolean;
		mtime: string;
		pr: {number: number; url: string; repository: string};
		archived: boolean;
		unseenError: true;
	}> = {},
) {
	return {
		id,
		title,
		summary: undefined,
		mtime: new Date(0).toISOString(),
		created: new Date(0).toISOString(),
		project: "/users/dev/project-a",
		projectName: "project-a",
		messageCount: 1,
		gitBranch: undefined,
		archived: false,
		state: "unknown" as const,
		bucket,
		liveAgentCount: 0,
		unseen: false,
		blockedSince: null,
		...overrides,
	};
}

function Harness() {
	const palette = useCommandPalette();
	return (
		<>
			<textarea aria-label="Composer" />
			<CommandPalette {...palette} />
		</>
	);
}

let currentRouter: {state: {location: {pathname: string; hash: string}}} | null = null;

async function renderPalette(
	sessions = [recentSession("sess-1", "Refactor auth module")],
	initialPath = "/",
	seed: (queryClient: QueryClient) => void = () => {},
) {
	const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}});
	queryClient.setQueryData(recentSessionsQueryOptions(PALETTE_RECENT_LIMIT).queryKey, {
		sessions,
		nextCursor: null,
	});
	seed(queryClient);
	const rootRoute = createRootRoute({
		component: () => (
			<QueryClientProvider client={queryClient}>
				<ToastProvider>
					<Harness />
					<Outlet />
				</ToastProvider>
			</QueryClientProvider>
		),
	});
	const sessionRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "session/$id",
		component: () => null,
	});
	const artifactRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "artifact/$id",
		component: () => null,
	});
	const routinesRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "routines",
		component: () => null,
	});
	const router = createRouter({
		routeTree: rootRoute.addChildren([sessionRoute, artifactRoute, routinesRoute]),
		history: createMemoryHistory({initialEntries: [initialPath]}),
	});
	await router.load();
	currentRouter = router;
	render(<RouterProvider router={router} />);
	const composer = await screen.findByRole("textbox", {name: "Composer"});
	composer.focus();
	return composer;
}

function pressK(target: Element, init: KeyboardEventInit) {
	fireEvent.keyDown(target, {key: "k", code: "KeyK", ...init});
}

const PR_863 = {number: 863, url: "https://github.com/acme/app/pull/863", repository: "acme/app"};

async function openPalette(...args: Parameters<typeof renderPalette>) {
	const composer = await renderPalette(...args);
	pressK(composer, {metaKey: true});
	return screen.findByRole("dialog", {name: "Search"});
}

/** Each group heading mapped to its option labels, in DOM order. */
function groupLabels(dialog: HTMLElement): Array<[string, string[]]> {
	return [...dialog.querySelectorAll("[cmdk-group]")]
		.filter((group) => !group.hasAttribute("hidden"))
		.map((group) => [
			group.querySelector("[cmdk-group-heading]")?.textContent ?? "",
			[...group.querySelectorAll("[cmdk-item]")].map(
				(item) => item.querySelector("[data-palette-label]")?.textContent ?? "",
			),
		]);
}

function footer(dialog: HTMLElement): Element | null {
	return dialog.querySelector("[data-palette-footer]");
}

describe("CommandPalette shell", () => {
	beforeEach(() => {
		vi.spyOn(navigator, "userAgent", "get").mockReturnValue(MAC_UA);
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
		cleanup();
		localStorage.clear();
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	it("shows the Close tooltip when hovering the Close button", async () => {
		const dialog = await openPalette();

		fireEvent.pointerEnter(within(dialog).getByRole("button", {name: "Close"}));

		expect((await within(dialog).findByRole("tooltip")).textContent).toBe("Close");
	});

	it("opens on ⌘K with a focused Search combobox textarea", async () => {
		const dialog = await openPalette();

		const input = within(dialog).getByRole("combobox", {name: "Search"});
		await waitFor(() => {
			expect(document.activeElement).toBe(input);
		});
		expect({
			tag: input.tagName,
			placeholder: input.getAttribute("placeholder"),
			rows: input.getAttribute("rows"),
			close: within(dialog).getByRole("button", {name: "Close"}).tagName,
			modes: within(dialog)
				.getAllByRole("radio")
				.map((radio) => [radio.textContent, radio.getAttribute("aria-checked")]),
		}).toStrictEqual({
			tag: "TEXTAREA",
			placeholder: "Search",
			rows: "1",
			close: "BUTTON",
			modes: [
				["Search", "true"],
				["Compose", "false"],
			],
		});
	});

	it("marks the open palette with the data-perf-overlay anchor", async () => {
		const dialog = await openPalette();

		expect(dialog.getAttribute("data-perf-overlay")).toBe("command_palette");
	});

	it("renders sentence-case group headings in upstream order", async () => {
		const dialog = await openPalette();

		await within(dialog).findByRole("option", {name: /Refactor auth module/});
		expect(
			[...dialog.querySelectorAll("[cmdk-group-heading]")].map((heading) => heading.textContent),
		).toStrictEqual(["Recents", "Actions"]);
	});

	it("shows the footer only while the query is empty", async () => {
		const dialog = await openPalette();

		expect(
			[...(footer(dialog)?.children[0]?.children[0]?.children ?? [])].map((hint) => [
				hint.firstElementChild?.textContent,
				[...hint.querySelectorAll("kbd")].map((kbd) => kbd.textContent),
			]),
		).toStrictEqual([
			["Close", ["Esc"]],
			["Change type", ["←Left", "→Right"]],
			["Filters", ["/"]],
			["Actions", ["⌥Option", "⏎Enter"]],
		]);

		fireEvent.change(within(dialog).getByRole("combobox"), {target: {value: "auth"}});

		await waitFor(() => {
			expect(footer(dialog)?.parentElement?.parentElement?.getAttribute("aria-hidden")).toBe("true");
		});
	});

	it("collapses the footer with upstream's grid-rows transition instead of unmounting it", async () => {
		const dialog = await openPalette();
		const input = within(dialog).getByRole("combobox");
		const state = () => {
			const wrapper = footer(dialog)?.parentElement?.parentElement;
			const card = dialog.querySelector("[cmdk-root]")?.parentElement;
			return {
				wrapperClass: wrapper?.className,
				innerClass: footer(dialog)?.parentElement?.className,
				ariaHidden: wrapper?.getAttribute("aria-hidden"),
				inert: wrapper?.hasAttribute("inert"),
				cardCollapsed: card?.className.includes(
					"[--cp-footer-collapsed:1] pointer-coarse:[--cp-footer-collapsed:0]",
				),
				listMaxHeight: dialog.querySelector<HTMLElement>("[cmdk-list]")?.style.maxHeight,
			};
		};
		const base =
			"flex-shrink-0 grid transition-[grid-template-rows,opacity] duration-150 ease-out motion-reduce:transition-none mt-auto";
		const listMaxHeight = "calc(440px + var(--cp-footer-collapsed, 0) * 41px)";
		const open = {
			wrapperClass: `${base} grid-rows-[1fr] opacity-100`,
			innerClass: "min-h-0 overflow-hidden",
			ariaHidden: "false",
			inert: false,
			cardCollapsed: false,
			listMaxHeight,
		};

		expect(state()).toStrictEqual(open);

		fireEvent.change(input, {target: {value: "do"}});
		await waitFor(() => {
			expect(state()).toStrictEqual({
				wrapperClass: `${base} grid-rows-[0fr] opacity-0`,
				innerClass: "min-h-0 overflow-hidden",
				ariaHidden: "true",
				inert: true,
				cardCollapsed: true,
				listMaxHeight,
			});
		});

		fireEvent.change(input, {target: {value: ""}});
		await waitFor(() => {
			expect(state()).toStrictEqual(open);
		});
	});

	it("keeps the footer open for a whitespace query but drops Change type, like upstream's trimmed check", async () => {
		const dialog = await openPalette();

		fireEvent.change(within(dialog).getByRole("combobox"), {target: {value: "  "}});

		await waitFor(() => {
			expect({
				ariaHidden: footer(dialog)?.parentElement?.parentElement?.getAttribute("aria-hidden"),
				hints: [...(footer(dialog)?.children[0]?.children[0]?.children ?? [])].map(
					(hint) => hint.firstElementChild?.textContent,
				),
			}).toStrictEqual({ariaHidden: "false", hints: ["Close", "Filters", "Actions"]});
		});
	});

	it("hides Change type below sm and Filters below md, like upstream's phone footer", async () => {
		const dialog = await openPalette();
		const row = footer(dialog)?.children[0];

		expect({
			rowClass: row?.className,
			hints: [...(row?.children[0]?.children ?? [])].map((hint) => [
				hint.tagName,
				hint.className,
				hint.firstElementChild?.textContent,
			]),
		}).toStrictEqual({
			rowClass: "flex min-h-5 items-center justify-between text-caption text-ink-muted",
			hints: [
				["DIV", "flex items-center gap-2", "Close"],
				["DIV", "hidden sm:flex items-center gap-2", "Change type"],
				["DIV", "hidden md:flex items-center gap-2", "Filters"],
				["DIV", "flex items-center gap-2", "Actions"],
			],
		});
	});

	it("← and → step through the type tabs and wrap when the query is empty", async () => {
		const dialog = await openPalette();
		await within(dialog).findByRole("option", {name: /Refactor auth module/});
		const input = within(dialog).getByRole("combobox");
		const selectedTab = () => within(dialog).getByRole("tab", {selected: true}).textContent;

		fireEvent.keyDown(input, {key: "ArrowRight", code: "ArrowRight"});
		const afterRight = selectedTab();
		fireEvent.keyDown(input, {key: "ArrowLeft", code: "ArrowLeft"});
		fireEvent.keyDown(input, {key: "ArrowLeft", code: "ArrowLeft"});

		expect({
			afterRight,
			afterWrap: selectedTab(),
			card: within(dialog).queryByRole("menu", {name: "Actions"}),
		}).toStrictEqual({afterRight: "Artifacts", afterWrap: "Files", card: null});
	});

	it("a held → stops at the last tab instead of wrapping", async () => {
		const dialog = await openPalette();
		await within(dialog).findByRole("option", {name: /Refactor auth module/});
		const input = within(dialog).getByRole("combobox");
		const selectedTab = () => within(dialog).getByRole("tab", {selected: true}).textContent;
		for (let index = 0; index < 4; index++) fireEvent.keyDown(input, {key: "ArrowRight", code: "ArrowRight"});
		const start = selectedTab();

		for (let index = 0; index < 5; index++) {
			fireEvent.keyDown(input, {key: "ArrowRight", code: "ArrowRight", repeat: true});
		}
		const afterFive = selectedTab();
		for (let index = 0; index < 10; index++) {
			fireEvent.keyDown(input, {key: "ArrowRight", code: "ArrowRight", repeat: true});
		}

		expect({start, afterFive, afterFifteen: selectedTab()}).toStrictEqual({
			start: "Scheduled",
			afterFive: "Files",
			afterFifteen: "Files",
		});
	});

	it("a held arrow with text, or an arrow during IME composition, never steps", async () => {
		const dialog = await openPalette();
		await within(dialog).findByRole("option", {name: /Refactor auth module/});
		const input = within(dialog).getByRole<HTMLTextAreaElement>("combobox");
		const selectedTab = () => within(dialog).getByRole("tab", {selected: true}).textContent;

		fireEvent.keyDown(input, {key: "ArrowRight", code: "ArrowRight", keyCode: 229});
		const afterComposing = selectedTab();
		fireEvent.change(input, {target: {value: "do"}});
		input.setSelectionRange(2, 2);
		fireEvent.keyDown(input, {key: "ArrowRight", code: "ArrowRight", repeat: true});

		expect({afterComposing, afterRepeat: selectedTab()}).toStrictEqual({
			afterComposing: "All",
			afterRepeat: "All",
		});
	});

	it("Backspace or Delete in an empty query returns a non-All tab to All", async () => {
		const dialog = await openPalette();
		await within(dialog).findByRole("option", {name: /Refactor auth module/});
		const input = within(dialog).getByRole("combobox");
		const selectedTab = () => within(dialog).getByRole("tab", {selected: true}).textContent;

		fireEvent.keyDown(input, {key: "ArrowRight", code: "ArrowRight"});
		const backspaceNotPrevented = fireEvent.keyDown(input, {key: "Backspace", code: "Backspace"});
		const afterBackspace = selectedTab();
		fireEvent.keyDown(input, {key: "ArrowRight", code: "ArrowRight"});
		const deleteNotPrevented = fireEvent.keyDown(input, {key: "Delete", code: "Delete"});

		expect({backspaceNotPrevented, afterBackspace, deleteNotPrevented, afterDelete: selectedTab()}).toStrictEqual({
			backspaceNotPrevented: false,
			afterBackspace: "All",
			deleteNotPrevented: false,
			afterDelete: "All",
		});
	});

	it("Backspace keeps the tab when held, when the query has text, during IME composition, or in Compose", async () => {
		const dialog = await openPalette();
		await within(dialog).findByRole("option", {name: /Refactor auth module/});
		const input = within(dialog).getByRole<HTMLTextAreaElement>("combobox");
		const selectedTab = () => within(dialog).getByRole("tab", {selected: true}).textContent;
		fireEvent.keyDown(input, {key: "ArrowRight", code: "ArrowRight"});

		const repeatNotPrevented = fireEvent.keyDown(input, {key: "Backspace", code: "Backspace", repeat: true});
		const afterRepeat = selectedTab();
		fireEvent.keyDown(input, {key: "Backspace", code: "Backspace", keyCode: 229});
		const afterComposing = selectedTab();
		fireEvent.change(input, {target: {value: "a"}});
		const textNotPrevented = fireEvent.keyDown(input, {key: "Backspace", code: "Backspace"});
		const afterText = selectedTab();
		fireEvent.change(input, {target: {value: ""}});
		fireEvent.keyDown(input, {key: "Tab", code: "Tab"});
		const composer = await within(dialog).findByRole("combobox", {name: "Write a message…"});
		fireEvent.keyDown(composer, {key: "Backspace", code: "Backspace"});
		fireEvent.keyDown(composer, {key: "Tab", code: "Tab"});
		await within(dialog).findByRole("tab", {name: "Artifacts"});

		expect({
			repeatNotPrevented,
			afterRepeat,
			afterComposing,
			textNotPrevented,
			afterText,
			afterCompose: selectedTab(),
		}).toStrictEqual({
			repeatNotPrevented: true,
			afterRepeat: "Artifacts",
			afterComposing: "Artifacts",
			textNotPrevented: true,
			afterText: "Artifacts",
			afterCompose: "Artifacts",
		});
	});

	it("draws upstream's ghost pill on the active and hovered tabs and roves tabindex to the active one", async () => {
		const dialog = await openPalette();
		const tabs = within(dialog).getAllByRole("tab");
		const pillClasses = [
			"relative",
			"isolate",
			"cursor-pointer",
			"before:absolute",
			"before:inset-y-0",
			"before:inset-x-px",
			"before:rounded-control-sm",
			"before:-z-[1]",
			"before:transition-shadow",
			"before:duration-[60ms]",
			"data-[active]:text-primary",
			"data-[active]:before:bg-fill-ghost-hover",
			"[&:not([data-active])]:hover:text-secondary",
			"[&:not([data-active])]:hover:before:bg-fill-ghost-hover",
			"focus-visible:before:shadow-focus",
		];
		const tablist = within(dialog).getByRole("tablist", {name: "Type"}).className.split(" ");

		expect({
			roving: tabs.map((tab) => [tab.textContent, tab.getAttribute("data-active"), tab.tabIndex]),
			missingPill: tabs.flatMap((tab) => pillClasses.filter((name) => !tab.className.split(" ").includes(name))),
			hoverPrimary: tabs.filter((tab) => tab.className.split(" ").includes("hover:text-primary")).length,
			edgePills: [
				tablist.includes("[&>[role=tab]:first-child]:before:start-0"),
				tablist.includes("[&>[role=tab]:last-child]:before:end-0"),
			],
		}).toStrictEqual({
			roving: [
				["All", "", 0],
				["Artifacts", null, -1],
				["Code", null, -1],
				["Projects", null, -1],
				["Scheduled", null, -1],
				["Plans", null, -1],
				["Memories", null, -1],
				["Files", null, -1],
			],
			missingPill: [],
			hoverPrimary: 0,
			edgePills: [true, true],
		});
	});

	it("wraps the tablist in upstream's Filters group and hidden-scrollbar scroller", async () => {
		const dialog = await openPalette();
		const tablist = within(dialog).getByRole("tablist", {name: "Type"});
		const scroller = tablist.parentElement;
		const group = scroller?.parentElement;
		const sorted = (element: Element | null | undefined) => element?.className.split(" ").toSorted() ?? [];

		expect({
			scroller: [scroller?.getAttribute("role"), sorted(scroller)],
			group: [
				group?.getAttribute("role"),
				group?.getAttribute("aria-label"),
				group?.getAttribute("data-palette-own-keys"),
				sorted(group),
			],
			tablist: sorted(tablist).filter((name) => /^(-?m[tbxy]?|p[xytb]?)-|overflow/.test(name)),
		}).toStrictEqual({
			scroller: [
				"presentation",
				[
					"-mx-6",
					"-my-2",
					"min-w-0",
					"overflow-x-auto",
					"overscroll-x-contain",
					"px-6",
					"py-2",
					"scroll-px-6",
					"[scrollbar-width:none]",
				].toSorted(),
			],
			group: ["group", "Filters", "", ["flow-root", "pb-[0.9rem]", "relative", "-mt-1.5", "px-6"].toSorted()],
			tablist: [],
		});
	});

	it("scrolls the selected tab into the strip, keeping the scroller's padding as a margin", async () => {
		const dialog = await openPalette();
		const input = within(dialog).getByRole("combobox");
		const scroller = within(dialog).getByRole("tablist", {name: "Type"}).parentElement!;
		const files = within(dialog).getByRole("tab", {name: "Files"});
		let scrollLeft = 0;
		Object.defineProperty(scroller, "scrollLeft", {
			configurable: true,
			get: () => scrollLeft,
			set: (next: number) => {
				scrollLeft = next;
			},
		});
		scroller.style.paddingLeft = "24px";
		scroller.getBoundingClientRect = () => DOMRect.fromRect({x: 0, y: 0, width: 390, height: 44});
		files.getBoundingClientRect = () => DOMRect.fromRect({x: 600, y: 8, width: 50, height: 28});

		fireEvent.keyDown(input, {key: "ArrowLeft", code: "ArrowLeft"});

		expect({selected: within(dialog).getByRole("tab", {selected: true}).textContent, scrollLeft}).toStrictEqual({
			selected: "Files",
			scrollLeft: 650 - (390 - 24),
		});
	});

	it("maps a vertical wheel to horizontal strip scrolling, mirrored in RTL, and cancels mousedown on the strip", async () => {
		const dialog = await openPalette();
		const scroller = within(dialog).getByRole("tablist", {name: "Type"}).parentElement!;
		let scrollLeft = 100;
		Object.defineProperty(scroller, "scrollLeft", {
			configurable: true,
			get: () => scrollLeft,
			set: (next: number) => {
				scrollLeft = next;
			},
		});

		fireEvent.wheel(scroller, {deltaX: 0, deltaY: 40});
		const ltr = scrollLeft;
		fireEvent.wheel(scroller, {deltaX: 5, deltaY: 40});
		const horizontal = scrollLeft;
		scroller.style.direction = "rtl";
		fireEvent.wheel(scroller, {deltaX: 0, deltaY: 40});
		const rtl = scrollLeft;

		expect({ltr, horizontal, rtl, mouseDownAllowed: fireEvent.mouseDown(scroller)}).toStrictEqual({
			ltr: 140,
			horizontal: 140,
			rtl: 100,
			mouseDownAllowed: false,
		});
	});

	it("leaves ← and → to the caret when it is inside the query", async () => {
		const dialog = await openPalette();
		const input = within(dialog).getByRole<HTMLTextAreaElement>("combobox");
		fireEvent.change(input, {target: {value: "auth"}});
		input.setSelectionRange(2, 2);

		fireEvent.keyDown(input, {key: "ArrowRight", code: "ArrowRight"});
		fireEvent.keyDown(input, {key: "ArrowLeft", code: "ArrowLeft"});

		expect(within(dialog).getByRole("tab", {selected: true}).textContent).toBe("All");
	});

	it("⌥⏎ opens the selected session row's actions card focused on Open", async () => {
		const dialog = await openPalette();
		const row = await within(dialog).findByRole("option", {name: /Refactor auth module/});

		fireEvent.keyDown(within(dialog).getByRole("combobox"), {key: "Enter", code: "Enter", altKey: true});

		const card = await within(dialog).findByRole("menu", {name: "Actions"});
		await waitFor(() => {
			expect(document.activeElement).toBe(within(card).getByRole("menuitem", {name: /^Open1/}));
		});
		expect({
			keyShortcuts: row.getAttribute("aria-keyshortcuts"),
			dialogOpen: screen.queryByRole("dialog", {name: "Search"}) === dialog,
		}).toStrictEqual({keyShortcuts: "Alt+Enter", dialogOpen: true});
	});

	it("shows the empty view's New session row without keycaps, as upstream does", async () => {
		const dialog = await openPalette();
		const row = await within(dialog).findByRole("option", {name: /^New session/});

		expect({
			keyShortcuts: row.getAttribute("aria-keyshortcuts"),
			kbd: row.querySelectorAll("kbd").length,
			text: row.textContent,
		}).toStrictEqual({keyShortcuts: null, kbd: 0, text: "New session"});
	});

	it("closes on Escape", async () => {
		const dialog = await openPalette();

		fireEvent.keyDown(within(dialog).getByRole("combobox"), {key: "Escape", code: "Escape"});

		await waitFor(() => {
			expect(screen.queryByRole("dialog")).toBeNull();
		});
	});

	it("closes on the Close button", async () => {
		const dialog = await openPalette();

		fireEvent.click(within(dialog).getByRole("button", {name: "Close"}));

		await waitFor(() => {
			expect(screen.queryByRole("dialog")).toBeNull();
		});
	});

	it("toggles closed on a second ⌘K", async () => {
		const dialog = await openPalette();

		pressK(within(dialog).getByRole("combobox"), {metaKey: true});

		await waitFor(() => {
			expect(screen.queryByRole("dialog")).toBeNull();
		});
	});

	it("does not open on Ctrl+K on mac", async () => {
		const composer = await renderPalette();

		pressK(composer, {ctrlKey: true});

		await act(async () => {});
		expect(screen.queryByRole("dialog")).toBeNull();
	});

	it("describes the Search combobox with upstream's hidden keys hint, dropped in Compose", async () => {
		const dialog = await openPalette();
		const input = within(dialog).getByRole("combobox", {name: "Search"});
		const hint = document.getElementById("command-palette-keys-hint");

		expect({
			describedBy: input.getAttribute("aria-describedby"),
			hidden: hint?.hidden,
			text: hint?.textContent,
		}).toStrictEqual({
			describedBy: "command-palette-keys-hint",
			hidden: true,
			text: "Left and Right arrows change the type of result. Option+Enter opens actions for the highlighted result.",
		});

		fireEvent.keyDown(input, {key: "Tab", code: "Tab"});
		const composer = await within(dialog).findByRole("combobox", {name: "Write a message…"});

		expect({
			describedBy: composer.getAttribute("aria-describedby"),
			hint: document.getElementById("command-palette-keys-hint"),
		}).toStrictEqual({describedBy: null, hint: null});
	});

	it("switches to Compose on Tab and keeps the text", async () => {
		const dialog = await openPalette();
		const input = within(dialog).getByRole("combobox");
		fireEvent.change(input, {target: {value: "fix the parser"}});

		fireEvent.keyDown(input, {key: "Tab", code: "Tab"});

		const composer = await within(dialog).findByRole("combobox", {name: "Write a message…"});
		expect({
			value: (composer as HTMLTextAreaElement).value,
			placeholder: composer.getAttribute("placeholder"),
			rows: composer.getAttribute("rows"),
			compose: within(dialog)
				.getByRole("radio", {name: /Compose/})
				.getAttribute("aria-checked"),
		}).toStrictEqual({
			value: "fix the parser",
			placeholder: "Write a message…",
			rows: "2",
			compose: "true",
		});

		fireEvent.keyDown(composer, {key: "Tab", code: "Tab"});

		await within(dialog).findByRole("combobox", {name: "Search"});
	});

	it("toggles Compose on Shift+Tab like Tab, keeping the type and focus in the field", async () => {
		const dialog = await openPalette();
		const input = within(dialog).getByRole("combobox");

		const notCancelled = fireEvent.keyDown(input, {key: "Tab", code: "Tab", shiftKey: true});
		const composer = await within(dialog).findByRole("combobox", {name: "Write a message…"});
		// The field takes focus in an effect after it mounts.
		await waitFor(() => {
			expect(document.activeElement).toBe(composer);
		});

		expect({notCancelled, focused: document.activeElement === composer}).toStrictEqual({
			notCancelled: false,
			focused: true,
		});

		fireEvent.keyDown(composer, {key: "Tab", code: "Tab", shiftKey: true});

		await within(dialog).findByRole("combobox", {name: "Search"});
	});

	it("ignores a repeated Tab but still cancels it", async () => {
		const dialog = await openPalette();
		const input = within(dialog).getByRole("combobox");

		const tab = fireEvent.keyDown(input, {key: "Tab", code: "Tab", repeat: true});
		const shiftTab = fireEvent.keyDown(input, {key: "Tab", code: "Tab", shiftKey: true, repeat: true});

		expect({
			tab,
			shiftTab,
			search: within(dialog).queryByRole("combobox", {name: "Search"}) !== null,
		}).toStrictEqual({tab: false, shiftTab: false, search: true});
	});

	it("leaves Alt+Tab and Alt+Shift+Tab alone", async () => {
		const dialog = await openPalette();
		const input = within(dialog).getByRole("combobox");

		const altTab = fireEvent.keyDown(input, {key: "Tab", code: "Tab", altKey: true});
		const altShiftTab = fireEvent.keyDown(input, {key: "Tab", code: "Tab", altKey: true, shiftKey: true});

		expect({
			altTab,
			altShiftTab,
			search: within(dialog).queryByRole("combobox", {name: "Search"}) !== null,
		}).toStrictEqual({altTab: true, altShiftTab: true, search: true});
	});

	it("paints the Compose field with the upstream fill-field and cds shadow-panel-sm", async () => {
		const dialog = await openPalette();
		fireEvent.keyDown(within(dialog).getByRole("combobox"), {key: "Tab", code: "Tab"});
		const composer = await within(dialog).findByRole("combobox", {name: "Write a message…"});
		const field = composer.parentElement?.querySelector(":scope > [aria-hidden='true'].absolute");

		expect(field?.className).toBe(
			"pointer-events-none absolute inset-1.5 rounded-composer bg-fill-field shadow-panel-sm-cds",
		);
	});

	it("forces Search mode on ⇧⌘K", async () => {
		const dialog = await openPalette();
		fireEvent.keyDown(within(dialog).getByRole("combobox"), {key: "Tab", code: "Tab"});
		const composer = await within(dialog).findByRole("combobox", {name: "Write a message…"});

		pressK(composer, {metaKey: true, shiftKey: true, key: "K"});

		await within(dialog).findByRole("combobox", {name: "Search"});
	});

	it("opens in Search mode on ⇧⌘K", async () => {
		const composer = await renderPalette();

		pressK(composer, {metaKey: true, shiftKey: true, key: "K"});

		const dialog = await screen.findByRole("dialog", {name: "Search"});
		within(dialog).getByRole("combobox", {name: "Search"});
	});

	it("keeps the palette open on a second ⇧⌘K", async () => {
		const composer = await renderPalette();
		pressK(composer, {metaKey: true, shiftKey: true, key: "K"});
		const dialog = await screen.findByRole("dialog", {name: "Search"});

		pressK(within(dialog).getByRole("combobox"), {metaKey: true, shiftKey: true, key: "K"});

		await act(async () => {});
		expect(screen.getByRole("dialog", {name: "Search"})).toBe(dialog);
	});

	it("does not run the ⌘K toggle on ⇧⌘K", async () => {
		const dialog = await openPalette();

		pressK(within(dialog).getByRole("combobox"), {metaKey: true, shiftKey: true, key: "K"});

		await act(async () => {});
		expect(screen.getByRole("dialog", {name: "Search"})).toBe(dialog);
	});

	it("does not open on Ctrl+Shift+K on mac", async () => {
		const composer = await renderPalette();

		pressK(composer, {ctrlKey: true, shiftKey: true, key: "K"});

		await act(async () => {});
		expect(screen.queryByRole("dialog")).toBeNull();
	});

	it("forces Search on ⇧⌘K without overwriting the remembered Compose tab", async () => {
		const dialog = await openPalette();
		fireEvent.keyDown(within(dialog).getByRole("combobox"), {key: "Tab", code: "Tab"});
		const composer = await within(dialog).findByRole("combobox", {name: "Write a message…"});
		fireEvent.keyDown(composer, {key: "Escape", code: "Escape"});
		await waitFor(() => {
			expect(screen.queryByRole("dialog")).toBeNull();
		});
		const outside = screen.getByRole("textbox", {name: "Composer"});

		pressK(outside, {metaKey: true, shiftKey: true, key: "K"});
		const searchDialog = await screen.findByRole("dialog", {name: "Search"});
		const searchInput = await within(searchDialog).findByRole("combobox", {name: "Search"});
		fireEvent.keyDown(searchInput, {key: "Escape", code: "Escape"});
		await waitFor(() => {
			expect(screen.queryByRole("dialog")).toBeNull();
		});

		pressK(outside, {metaKey: true});
		const reopened = await screen.findByRole("dialog", {name: "Search"});
		await within(reopened).findByRole("combobox", {name: "Write a message…"});
	});

	it("remembers the tab in localStorage cmdk-mode and ⇧⌘K leaves it alone", async () => {
		const dialog = await openPalette();
		fireEvent.keyDown(within(dialog).getByRole("combobox"), {key: "Tab", code: "Tab"});
		const composer = await within(dialog).findByRole("combobox", {name: "Write a message…"});
		const afterTab = localStorage.getItem("cmdk-mode");

		pressK(composer, {metaKey: true, shiftKey: true, key: "K"});
		await within(dialog).findByRole("combobox", {name: "Search"});

		expect({afterTab, afterSearch: localStorage.getItem("cmdk-mode")}).toStrictEqual({
			afterTab: "compose",
			afterSearch: "compose",
		});
	});

	it("opens in the stored Compose tab on a fresh load", async () => {
		localStorage.setItem("cmdk-mode", "compose");

		const dialog = await openPalette();

		await within(dialog).findByRole("combobox", {name: "Write a message…"});
	});

	it("ignores an unknown stored cmdk-mode", async () => {
		localStorage.setItem("cmdk-mode", "bogus");

		const dialog = await openPalette();

		await within(dialog).findByRole("combobox", {name: "Search"});
	});

	it("shows only the start rows and a Send footer in Compose", async () => {
		const dialog = await openPalette([
			recentSession("s-1", "Settings page refactor"),
			recentSession("s-2", "Blocked one", "blocked"),
		]);
		const input = within(dialog).getByRole("combobox");
		fireEvent.keyDown(input, {key: "Tab", code: "Tab"});
		const composer = await within(dialog).findByRole("combobox", {name: "Write a message…"});

		fireEvent.change(composer, {target: {value: "Settings"}});

		await waitFor(() => {
			expect({
				groups: groupLabels(dialog),
				results: within(dialog).queryByRole("group", {name: "Search results"}),
				tabs: within(dialog).queryByRole("tablist", {name: "Type"}),
				footer: footer(dialog)?.textContent,
			}).toStrictEqual({
				groups: [["Quick actions", ["New session"]]],
				results: null,
				tabs: null,
				footer: "Send⏎Enter",
			});
		});
	});

	it("gives Compose a paperclip and Send button and no Close", async () => {
		const dialog = await openPalette();
		fireEvent.keyDown(within(dialog).getByRole("combobox"), {key: "Tab", code: "Tab"});
		await within(dialog).findByRole("combobox", {name: "Write a message…"});

		expect({
			buttons: within(dialog)
				.getAllByRole("button")
				.map((button) => button.getAttribute("aria-label")),
			fileInput: dialog.querySelector('input[type="file"]')?.getAttribute("aria-label"),
			send: within(dialog).getByRole<HTMLButtonElement>("button", {name: "Send"}).disabled,
		}).toStrictEqual({
			buttons: ["Add files or photos", "Send"],
			fileInput: "Add files or photos",
			send: true,
		});
	});

	it("shows the Compose button tooltips", async () => {
		const dialog = await openPalette();
		fireEvent.keyDown(within(dialog).getByRole("combobox"), {key: "Tab", code: "Tab"});
		await within(dialog).findByRole("combobox", {name: "Write a message…"});

		fireEvent.pointerEnter(within(dialog).getByRole("button", {name: "Add files or photos"}));
		expect((await within(dialog).findByRole("tooltip")).textContent).toBe("Add files or photos");
	});

	it("opens the start-session picker when Send is clicked with text", async () => {
		const dialog = await openPalette();
		fireEvent.keyDown(within(dialog).getByRole("combobox"), {key: "Tab", code: "Tab"});
		const composer = await within(dialog).findByRole("combobox", {name: "Write a message…"});
		fireEvent.change(composer, {target: {value: "fix the parser"}});
		const send = within(dialog).getByRole<HTMLButtonElement>("button", {name: "Send"});
		expect(send.disabled).toBe(false);

		fireEvent.click(send);

		await waitFor(() => {
			expect(groupLabels(dialog).map(([heading]) => heading)).toStrictEqual(["Choose a project"]);
		});
	});

	it("shows Needs attention, Recents and Actions in the empty state", async () => {
		const dialog = await openPalette(
			[
				recentSession("s-1", "Recent one"),
				recentSession("s-blocked", "Blocked one", "blocked"),
				recentSession("s-current", "Current page", "done"),
				recentSession("s-2", "Recent two", "working"),
				recentSession("s-review", "Review one", "review"),
				recentSession("s-3", "Recent three"),
				recentSession("s-4", "Recent four"),
				recentSession("s-5", "Recent five"),
				recentSession("s-6", "Recent six"),
				recentSession("s-7", "Recent seven"),
			],
			"/session/s-current",
		);

		await within(dialog).findByRole("option", {name: /Blocked one/});
		expect(groupLabels(dialog)).toStrictEqual([
			["Needs attention", ["Blocked one Awaiting input"]],
			// An old running session and an open PR with nothing unseen do not lead, so they stay in Recents;
			// the running one keeps its mark there.
			[
				"Recents",
				["Recent one", "Recent two Running", "Review one", "Recent three", "Recent four", "Recent five"],
			],
			["Actions", ["New session"]],
		]);
		const newSession = within(dialog).getByRole("option", {name: /^New session/});
		expect(
			newSession
				.querySelector("svg")
				?.getAttribute("class")
				?.split(" ")
				.find((name) => name.startsWith("lucide-")),
		).toBe("lucide-circle-plus");
		expect(dialog.querySelectorAll("[data-palette-mark-dot]").length).toBe(2);
		// Upstream's group headers are 12/17 muted, and their rows sit flush at a 36px pitch.
		const group = dialog.querySelector("[cmdk-group]");
		expect({
			heading: group?.className.split(" ").includes("[&_[cmdk-group-heading]]:text-[12px]/[17px]"),
			rowGap: group?.className.split(" ").some((name) => name.startsWith("[&_[cmdk-group-items]]:gap-")),
		}).toStrictEqual({heading: true, rowGap: false});
	});

	it("sizes the header, list and group gaps as upstream: 64px input row, tabs overlapping it by 6px, a list held at its 440px cap with 4px between groups", async () => {
		const dialog = await openPalette([recentSession("s-1", "Recent one")]);
		const input = within(dialog).getByRole("combobox");
		const classes = (element: Element | null | undefined) => element?.className.split(" ") ?? [];
		const inputRow = classes(input.closest("div.relative.flex"));
		const tabs = classes(within(dialog).getByRole("group", {name: "Filters"}));
		const listElement = dialog.querySelector<HTMLElement>("[cmdk-list]");
		const list = classes(listElement);

		expect({
			inputRow: inputRow.filter((name) => /^(pt|pb)-/.test(name)),
			tabs: tabs.filter((name) => /^(-?mt|pb)-/.test(name)).toSorted(),
			list: list.filter((name) => /^(h|max-h)-|cmdk-group\]\+/.test(name)),
			listHeight: listElement?.style.height,
		}).toStrictEqual({
			inputRow: ["pt-[1.1rem]", "pb-[0.9rem]"],
			tabs: ["-mt-1.5", "pb-[0.9rem]"],
			list: ["[&_[cmdk-group]+[cmdk-group]]:mt-1"],
			listHeight: "440px",
		});
	});

	it("keeps the other actions reachable by typing, as upstream's empty state lists only New session", async () => {
		const dialog = await openPalette([recentSession("s-1", "Recent one")]);
		fireEvent.change(within(dialog).getByRole("combobox"), {target: {value: "keyboard"}});
		expect(await within(dialog).findByRole("option", {name: /^Keyboard shortcuts/})).toBeTruthy();
	});

	it("caps Needs attention at 5 leads, leaving the next ones in Recents", async () => {
		const dialog = await openPalette(
			Array.from({length: 9}, (_, index) => recentSession(`s-${index}`, `Waiting ${index}`, "blocked")),
		);

		await within(dialog).findByRole("option", {name: /Waiting 0/});
		expect(groupLabels(dialog)).toStrictEqual([
			[
				"Needs attention",
				["Waiting 0", "Waiting 1", "Waiting 2", "Waiting 3", "Waiting 4"].map(
					(title) => `${title} Awaiting input`,
				),
			],
			["Recents", ["Waiting 5 Awaiting input", "Waiting 6 Awaiting input"]],
			["Actions", ["New session"]],
		]);
	});

	it("rank-sorts recent leads and splits running ones into an Active group after Needs attention", async () => {
		const recent = new Date(Date.now() - 60_000).toISOString();
		const dialog = await openPalette([
			recentSession("s-running", "Running one", "working", {mtime: recent}),
			recentSession("s-unread", "Unread one", "done", {unseen: true, mtime: recent}),
			recentSession("s-plain", "Plain one"),
			recentSession("s-blocked", "Blocked one", "blocked"),
		]);

		await within(dialog).findByRole("option", {name: /Running one/});
		expect({
			groups: groupLabels(dialog),
			active: within(dialog).queryByRole("group", {name: "Active"}) !== null,
		}).toStrictEqual({
			groups: [
				["Needs attention", ["Blocked one Awaiting input", "Unread one Unread"]],
				["Active", ["Running one Running"]],
				["Recents", ["Plain one"]],
				["Actions", ["New session"]],
			],
			active: true,
		});
	});

	it("labels a session blocked on an unseen error as Error and ranks it after awaiting rows", async () => {
		const recent = new Date(Date.now() - 60_000).toISOString();
		const dialog = await openPalette([
			recentSession("s-errored", "Errored one", "blocked", {unseen: true, unseenError: true, mtime: recent}),
			recentSession("s-plain", "Plain one"),
			recentSession("s-blocked", "Blocked one", "blocked"),
		]);

		await within(dialog).findByRole("option", {name: /Errored one/});
		expect(groupLabels(dialog)).toStrictEqual([
			["Needs attention", ["Blocked one Awaiting input", "Errored one Error"]],
			["Recents", ["Plain one"]],
			["Actions", ["New session"]],
		]);
	});

	it("marks lead icons with upstream's shared notched icon: a static accent dot for awaiting, brand for running", async () => {
		const recent = new Date(Date.now() - 60_000).toISOString();
		const dialog = await openPalette([
			recentSession("s-running", "Running one", "working", {mtime: recent}),
			recentSession("s-blocked", "Blocked one", "blocked"),
			recentSession("s-plain", "Plain one"),
		]);

		await within(dialog).findByRole("option", {name: /Running one/});
		const dotClasses = (name: RegExp) =>
			within(dialog).getByRole("option", {name}).querySelector("[data-palette-mark-dot]")?.className.split(" ");
		const maskClasses = (name: RegExp) =>
			within(dialog)
				.getByRole("option", {name})
				.querySelector("[data-palette-mark-dot]")
				?.previousElementSibling?.className.split(" ");
		const plain = within(dialog).getByRole("option", {name: /Plain one/});
		expect({
			running: dotClasses(/Running one/),
			awaiting: dotClasses(/Blocked one/),
			wrapper: within(dialog)
				.getByRole("option", {name: /Running one/})
				.querySelector("[data-palette-mark-dot]")
				?.parentElement?.className.split(" "),
			mask: maskClasses(/Running one/),
			plain: {
				dot: plain.querySelector("[data-palette-mark-dot]"),
				mask: plain.querySelector("[class*='mask-image']"),
			},
		}).toStrictEqual({
			running: ["absolute", "-top-px", "-end-px", "size-1.5", "rounded-full", "bg-fill-brand"],
			awaiting: ["absolute", "-top-px", "-end-px", "size-1.5", "rounded-full", "bg-fill-accent"],
			wrapper: ["relative", "shrink-0"],
			mask: [
				"block",
				"[--dot-r:0.1875rem]",
				"[mask-image:radial-gradient(circle_at_calc(100%_-_var(--dot-r)_+_1px)_calc(var(--dot-r)_-_1px),transparent_calc(var(--dot-r)_+_2px),black_calc(var(--dot-r)_+_2.5px))]",
				"rtl:[mask-image:radial-gradient(circle_at_calc(var(--dot-r)_-_1px)_calc(var(--dot-r)_-_1px),transparent_calc(var(--dot-r)_+_2px),black_calc(var(--dot-r)_+_2.5px))]",
				"forced-colors:[mask-image:none]",
			],
			plain: {dot: null, mask: null},
		});
	});

	it("keeps the mark on a Recents session that does not lead, as upstream's Recents row", async () => {
		const dialog = await openPalette([
			recentSession("s-old-run", "Old run", "working"),
			recentSession("s-plain", "Plain one"),
		]);

		const row = await within(dialog).findByRole("option", {name: /Old run/});
		expect({
			groups: groupLabels(dialog),
			dot: row.querySelector("[data-palette-mark-dot]")?.className.split(" "),
		}).toStrictEqual({
			groups: [
				["Recents", ["Old run Running", "Plain one"]],
				["Actions", ["New session"]],
			],
			dot: ["absolute", "-top-px", "-end-px", "size-1.5", "rounded-full", "bg-fill-brand"],
		});
	});

	it("draws an unmarked Recents session with upstream's bare code icon, not a chat bubble", async () => {
		const dialog = await openPalette([recentSession("s-plain", "Plain one")]);

		const row = await within(dialog).findByRole("option", {name: "Plain one"});
		const svg = row.querySelector("svg");
		expect({
			wrapper: svg?.parentElement?.className.split(" "),
			icon: svg
				?.getAttribute("class")
				?.split(" ")
				.find((name) => name.startsWith("lucide-")),
			dot: row.querySelector("[data-palette-mark-dot]"),
			mask: row.querySelector("[class*='mask-image']"),
		}).toStrictEqual({
			wrapper: ["relative", "shrink-0"],
			icon: "lucide-code-xml",
			dot: null,
			mask: null,
		});
	});

	describe("freezes groups and marks while open, as upstream's settle snapshot", () => {
		const recentKey = recentSessionsQueryOptions(PALETTE_RECENT_LIMIT).queryKey;

		async function openFrozen() {
			let client: QueryClient | null = null;
			const dialog = await openPalette(
				[
					recentSession("s-a", "Alpha task", "blocked"),
					recentSession("s-b", "Beta task", "working"),
					recentSession("s-plain", "Plain one"),
				],
				"/",
				(queryClient) => {
					client = queryClient;
				},
			);
			await within(dialog).findByRole("option", {name: /Alpha task/});
			const changed = async () => {
				await act(async () => {
					client?.setQueryData(recentKey, {
						sessions: [
							recentSession("s-c", "Gamma task", "blocked"),
							recentSession("s-a", "Alpha task", "done"),
							recentSession("s-b", "Beta task", "done"),
							recentSession("s-plain", "Plain one"),
						],
						nextCursor: null,
					});
					await new Promise((resolve) => {
						setTimeout(resolve, 0);
					});
				});
			};
			return {dialog, changed};
		}

		const OPENING_VIEW = [
			["Needs attention", ["Alpha task Awaiting input"]],
			["Recents", ["Beta task Running", "Plain one"]],
			["Actions", ["New session"]],
		];

		it("keeps the opening groups and marks when the sessions change, and takes a fresh snapshot on reopen", async () => {
			const {dialog, changed} = await openFrozen();
			expect(groupLabels(dialog)).toStrictEqual(OPENING_VIEW);

			await changed();
			const frozen = groupLabels(dialog);
			const input = within(dialog).getByRole("combobox");
			fireEvent.change(input, {target: {value: "task"}});
			const typedLabels = () =>
				[...dialog.querySelectorAll("[cmdk-item]")]
					.map(
						(item) =>
							`${item.querySelector("[data-palette-label]")?.textContent ?? ""}${item.querySelector(".sr-only")?.textContent ?? ""}`,
					)
					.filter((label) => label.includes("task"));
			await waitFor(() => {
				expect(typedLabels().length).toBeGreaterThan(0);
			});
			const typed = typedLabels();
			fireEvent.change(input, {target: {value: ""}});
			await within(dialog).findByRole("option", {name: /Alpha task/});
			const cleared = groupLabels(dialog);

			fireEvent.keyDown(input, {key: "Escape", code: "Escape"});
			await waitFor(() => {
				expect(screen.queryByRole("dialog")).toBeNull();
			});
			pressK(document.body, {metaKey: true});
			const reopened = await screen.findByRole("dialog", {name: "Search"});
			await within(reopened).findByRole("option", {name: /Gamma task/});

			expect({frozen, typed, cleared, reopened: groupLabels(reopened)}).toStrictEqual({
				frozen: OPENING_VIEW,
				// Typed rows list live sessions but read the frozen marks; one new since opening stays unmarked.
				typed: ["Gamma task", "Alpha task Awaiting input", "Beta task Running"],
				cleared: OPENING_VIEW,
				reopened: [
					["Needs attention", ["Gamma task Awaiting input"]],
					["Recents", ["Alpha task", "Beta task", "Plain one"]],
					["Actions", ["New session"]],
				],
			});
		});

		it("lets a row the user opened row actions on read its live mark", async () => {
			const {dialog, changed} = await openFrozen();
			const input = within(dialog).getByRole("combobox");

			fireEvent.keyDown(input, {key: "Enter", code: "Enter", altKey: true});
			const card = await within(dialog).findByRole("menu", {name: "Actions"});
			fireEvent.keyDown(within(card).getByRole("menuitem", {name: /^Open1/}), {
				key: "Escape",
				code: "Escape",
			});
			await waitFor(() => {
				expect(within(dialog).queryByRole("menu", {name: "Actions"})).toBeNull();
			});
			await changed();

			// The acted-on lead lost its live mark, so it drops back into the frozen Recents pool.
			expect(groupLabels(dialog)).toStrictEqual([
				["Recents", ["Alpha task", "Beta task Running", "Plain one"]],
				["Actions", ["New session"]],
			]);
		});
	});

	it("shows upstream's trailing PR #N secondary on an empty-view session, without the time", async () => {
		const dialog = await openPalette([
			recentSession("s-pr", "With PR", "done", {pr: PR_863}),
			recentSession("s-plain", "Plain one"),
		]);

		const prRow = await within(dialog).findByRole("option", {name: /With PR/});
		const plainRow = within(dialog).getByRole("option", {name: /Plain one/});
		const meta = prRow.querySelector("[data-palette-meta]");
		expect({
			text: meta?.textContent,
			classes: meta?.className.split(" "),
			plain: plainRow.querySelector("[data-palette-meta]"),
		}).toStrictEqual({
			text: "PR #863",
			classes: [
				"shrink-0",
				"text-xs",
				"text-ink-muted",
				"group-data-[selected=true]:hidden",
				"pointer-coarse:!inline",
			],
			plain: null,
		});
	});

	it("marks an unseen finished session Unread on the Code tab", async () => {
		const dialog = await openPalette([
			recentSession("s-unseen", "Unseen done", "done", {unseen: true}),
			recentSession("s-seen", "Seen done"),
		]);

		await within(dialog).findByRole("option", {name: /Unseen done/});
		fireEvent.click(within(dialog).getByRole("tab", {name: "Code"}));
		await waitFor(() => {
			expect(within(dialog).getByRole("tab", {name: "Code"}).getAttribute("aria-selected")).toBe("true");
		});
		const unseen = within(dialog).getByRole("option", {name: /Unseen done/});
		expect({
			sr: unseen.querySelector(".sr-only")?.textContent,
			dot: unseen.querySelector("[data-palette-mark-dot]")?.className.split(" "),
			seen: within(dialog).getByRole("option", {name: "Seen done"}).querySelector("[data-palette-mark-dot]"),
		}).toStrictEqual({
			sr: " Unread",
			dot: ["absolute", "-top-px", "-end-px", "size-1.5", "rounded-full", "bg-fill-accent"],
			seen: null,
		});
	});

	it("fits 5 leads and 2 Recents into the 440px list, as upstream's 5 + 2", async () => {
		const dialog = await openPalette([
			...Array.from({length: 9}, (_, index) => recentSession(`s-${index}`, `Waiting ${index}`, "blocked")),
			...Array.from({length: 5}, (_, index) => recentSession(`r-${index}`, `Recent ${index}`)),
		]);

		await within(dialog).findByRole("option", {name: /Waiting 0/});
		expect({
			groups: groupLabels(dialog).map(([heading, labels]) => [heading, labels.length]),
			named: ["Needs attention", "Recents", "Actions"].map(
				(name) => within(dialog).queryByRole("group", {name}) !== null,
			),
		}).toStrictEqual({
			groups: [
				["Needs attention", 5],
				["Recents", 2],
				["Actions", 1],
			],
			named: [true, true, true],
		});
	});

	it("hides navigation commands until typed", async () => {
		const dialog = await openPalette();

		await within(dialog).findByRole("option", {name: /Refactor auth module/});
		expect(within(dialog).queryByRole("option", {name: "Plans"})).toBeNull();

		fireEvent.change(within(dialog).getByRole("combobox"), {target: {value: "plan"}});
		await within(dialog).findByRole("option", {name: "Plans"});

		fireEvent.change(within(dialog).getByRole("combobox"), {target: {value: "markdown"}});
		await within(dialog).findByRole("option", {name: "Plans"});
	});

	it("names the pinned sessions page Pinned, still found by star", async () => {
		const dialog = await openPalette();

		fireEvent.change(within(dialog).getByRole("combobox"), {target: {value: "star"}});
		const pinned = await within(dialog).findByRole("option", {name: "Pinned"});

		expect({
			starred: within(dialog).queryByRole("option", {name: "Starred"}),
			pinned: pinned.textContent,
		}).toStrictEqual({starred: null, pinned: "Pinned"});
	});

	it("opens General settings over the current page and offers no settings pages", async () => {
		const dialog = await openPalette([], "/session/s-current");

		fireEvent.change(within(dialog).getByRole("combobox"), {target: {value: "setup"}});
		await waitFor(() => {
			expect(within(dialog).queryByRole("option", {name: "Setup"})).toBeNull();
		});
		fireEvent.change(within(dialog).getByRole("combobox"), {target: {value: "config"}});
		await waitFor(() => {
			expect(within(dialog).queryByRole("option", {name: "Claude Config"})).toBeNull();
		});
		fireEvent.change(within(dialog).getByRole("combobox"), {target: {value: "settings"}});
		fireEvent.click(await within(dialog).findByRole("option", {name: /^Settings/}));

		await waitFor(() => {
			expect({
				pathname: currentRouter?.state.location.pathname,
				hash: currentRouter?.state.location.hash,
			}).toStrictEqual({pathname: "/session/s-current", hash: "settings/general"});
		});
	});
});

describe("CommandPalette Recents from the per-tab visit MRU", () => {
	beforeEach(() => {
		vi.spyOn(navigator, "userAgent", "get").mockReturnValue(MAC_UA);
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
		window.sessionStorage.clear();
	});

	afterEach(() => {
		cleanup();
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
		window.sessionStorage.clear();
	});

	function entry(kind: RecentEntry["kind"], id: string, href: string, title?: string): RecentEntry {
		return title === undefined ? {key: `${kind}:${id}`, kind, href} : {key: `${kind}:${id}`, kind, href, title};
	}

	function recentsGroup(dialog: HTMLElement): Array<{value: string; label: string}> {
		const group = [...dialog.querySelectorAll("[cmdk-group]")].find(
			(candidate) => candidate.querySelector("[cmdk-group-heading]")?.textContent === "Recents",
		);
		return [...(group?.querySelectorAll<HTMLElement>("[cmdk-item]") ?? [])].map((item) => ({
			value: item.dataset["value"] ?? "",
			label: item.querySelector("[data-palette-label]")?.textContent ?? "",
		}));
	}

	it("resolves delayed historical aliases without rereading the opening's visit order", async () => {
		let resolveIdentity!: (response: Response) => void;
		const pending = new Promise<Response>((resolve) => {
			resolveIdentity = resolve;
		});
		const fetch = vi.fn<(url: string) => Promise<Response>>(async (_url: string) => pending);
		vi.stubGlobal("fetch", fetch);
		saveRecents([
			entry("session", "session_alice_100", "/session/session_alice_100", "Recent Alice"),
			entry("plan", "alice-plan", "/plan/alice-plan", "Alice plan"),
			entry("session", "local-alice", "/session/local-alice", "Earlier Alice"),
		]);
		const dialog = await openPalette([]);
		expect(recentsGroup(dialog)).toStrictEqual([
			{value: "recent:plan:alice-plan", label: "Alice plan"},
			{value: "session:local-alice", label: "Earlier Alice"},
		]);
		saveRecents([entry("plan", "new-plan", "/plan/new-plan", "New visit while open")]);
		act(() => {
			resolveIdentity(Response.json({sessionId: "local-alice"}));
		});
		await waitFor(() => {
			expect(recentsGroup(dialog)).toStrictEqual([
				{value: "session:local-alice", label: "Recent Alice"},
				{value: "recent:plan:alice-plan", label: "Alice plan"},
			]);
		});
		expect(fetch.mock.calls.map((call) => call[0])).toStrictEqual(["/api/sessions/session_alice_100/identity"]);
		fireEvent.click(within(dialog).getByRole("option", {name: "Recent Alice"}));
		await waitFor(() => {
			expect(currentRouter?.state.location.pathname).toBe("/session/local-alice");
		});
	});

	it.each([404, 409])("omits historical aliases from actionable session rows after %s", async (status) => {
		const fetch = vi
			.fn<(url: string) => Promise<Response>>()
			.mockResolvedValue(Response.json({error: "Fabricated alias failure"}, {status}));
		vi.stubGlobal("fetch", fetch);
		saveRecents([
			entry("session", "session_alice_100", "/session/session_alice_100", "Unresolved Alice"),
			entry("plan", "alice-plan", "/plan/alice-plan", "Alice plan"),
		]);
		let client!: QueryClient;
		const dialog = await openPalette([], "/", (queryClient) => {
			client = queryClient;
		});
		await waitFor(() => {
			expect(client.getQueryState(sessionQueryKeys.identity("session_alice_100"))?.status).toBe("error");
		});
		expect(recentsGroup(dialog)).toStrictEqual([{value: "recent:plan:alice-plan", label: "Alice plan"}]);
		expect(fetch.mock.calls.map(([url]) => url)).toStrictEqual(["/api/sessions/session_alice_100/identity"]);
	});

	it("excludes the current resolved session even when history used its UUID", async () => {
		saveRecents([
			entry("session", "local-alice", "/session/local-alice", "Current Alice"),
			entry("plan", "alice-plan", "/plan/alice-plan", "Alice plan"),
		]);
		const dialog = await openPalette([], "/session/session_alice_100", (client) => {
			client.setQueryData(sessionQueryKeys.identity("session_alice_100"), {sessionId: "local-alice"});
		});
		expect(recentsGroup(dialog)).toStrictEqual([{value: "recent:plan:alice-plan", label: "Alice plan"}]);
	});

	it("lists visited pages of every kind in MRU order, skipping the current page and subagents", async () => {
		saveRecents([
			entry("session", "s-current", "/session/s-current", "Current page"),
			entry("plan", "big-plan", "/plan/big-plan", "Big plan"),
			entry("subagents", "s-current", "/session/s-current/subagents", "Subagents"),
			entry("memory", "proj/notes", "/memory/proj/notes", "Notes"),
			entry("project", "proj", "/project/proj", "proj"),
			entry("command", "user/deploy", "/command/user/deploy", "deploy"),
			entry("session", "s-2", "/session/s-2", "Visited session"),
		]);
		const dialog = await openPalette(
			[recentSession("s-9", "Newest by mtime"), recentSession("s-2", "Renamed session")],
			"/session/s-current",
		);

		await within(dialog).findByRole("option", {name: /Big plan/});
		expect(recentsGroup(dialog)).toStrictEqual([
			{value: "recent:plan:big-plan", label: "Big plan"},
			{value: "recent:memory:proj/notes", label: "Notes"},
			{value: "recent:project:proj", label: "proj"},
			{value: "recent:command:user/deploy", label: "deploy"},
			{value: "session:s-2", label: "Renamed session"},
		]);
	});

	it("fits Needs attention plus visited Recents into 440px, without repeating attention sessions", async () => {
		saveRecents([
			entry("session", "s-blocked", "/session/s-blocked", "Blocked one"),
			...Array.from({length: 8}, (_, index) =>
				entry("plan", `plan-${index}`, `/plan/plan-${index}`, `Plan ${index}`),
			),
		]);
		const dialog = await openPalette([
			recentSession("s-blocked", "Blocked one", "blocked"),
			recentSession("s-review", "Review one", "review"),
		]);

		await within(dialog).findByRole("option", {name: /Plan 0/});
		expect(groupLabels(dialog).slice(0, 2)).toStrictEqual([
			["Needs attention", ["Blocked one Awaiting input"]],
			["Recents", ["Plan 0", "Plan 1", "Plan 2", "Plan 3", "Plan 4", "Plan 5"]],
		]);
	});

	it("labels an untitled visit Untitled", async () => {
		saveRecents([entry("plan", "no-title", "/plan/no-title")]);
		const dialog = await openPalette();

		await within(dialog).findByRole("option", {name: /Untitled/});
		expect(recentsGroup(dialog)).toStrictEqual([{value: "recent:plan:no-title", label: "Untitled"}]);
	});

	it("falls back to mtime-ordered sessions when the MRU is empty", async () => {
		const dialog = await openPalette([recentSession("s-1", "Newest"), recentSession("s-2", "Older")]);

		await within(dialog).findByRole("option", {name: /Newest/});
		expect(recentsGroup(dialog)).toStrictEqual([
			{value: "session:s-1", label: "Newest"},
			{value: "session:s-2", label: "Older"},
		]);
	});

	it("falls back to mtime-ordered sessions when the MRU holds only the current page", async () => {
		saveRecents([entry("session", "s-current", "/session/s-current", "Current page")]);
		const dialog = await openPalette(
			[recentSession("s-current", "Current page"), recentSession("s-1", "Newest")],
			"/session/s-current",
		);

		await within(dialog).findByRole("option", {name: /Newest/});
		expect(recentsGroup(dialog)).toStrictEqual([{value: "session:s-1", label: "Newest"}]);
	});

	it("navigates to a recent page on select", async () => {
		saveRecents([entry("plan", "big-plan", "/plan/big-plan", "Big plan")]);
		const dialog = await openPalette();

		fireEvent.click(await within(dialog).findByRole("option", {name: /Big plan/}));

		await waitFor(() => {
			expect(currentRouter?.state.location.pathname).toBe("/plan/big-plan");
		});
	});
});

const HOUR_MS = 60 * 60_000;

function artifact(id: string, title: string, publishedAgoMs: number): ArtifactSummary {
	return {
		url: `https://claude.ai/code/artifact/${id}`,
		id,
		kind: "html",
		title,
		description: null,
		sourcePath: null,
		sourceExists: false,
		sourceModifiedAt: null,
		audience: null,
		firstSeenAt: Date.now() - publishedAgoMs,
		lastPublishedAt: Date.now() - publishedAgoMs,
		publishCount: 1,
		sessionId: "sess-1",
		projectId: "-users-dev-project-a",
	};
}

function routine(toolUseId: string, overrides: Partial<Routine>): Routine {
	return {
		toolUseId,
		recordUuid: null,
		kind: "cron",
		routineId: null,
		name: null,
		schedule: "0 9 * * *",
		humanSchedule: "Every day at 9:00 AM",
		delaySeconds: null,
		runOnceAt: null,
		recurring: true,
		durable: true,
		prompt: "Check the build",
		createdAt: 0,
		deletedAt: null,
		sessionId: "sess-1",
		projectId: "-users-dev-project-a",
		sessionTitle: null,
		status: "active",
		nextRunAt: null,
		...overrides,
	};
}

describe("CommandPalette Artifacts and Scheduled tabs", () => {
	beforeEach(() => {
		vi.spyOn(navigator, "userAgent", "get").mockReturnValue(MAC_UA);
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
		cleanup();
		localStorage.clear();
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	function seedLocal(queryClient: QueryClient) {
		queryClient.setQueryData(artifactsQueryOptions.queryKey, [
			artifact("art-old", "Old dashboard", 240 * HOUR_MS),
			artifact("art-new", "New report", 0),
			artifact("art-mid", "Mid deck", HOUR_MS / 2),
		]);
		queryClient.setQueryData(routinesQueryOptions.queryKey, [
			routine("r-sched", {name: "Nightly digest"}),
			routine("r-done", {prompt: "Finished job", status: "completed"}),
		]);
	}

	function resultRows(dialog: HTMLElement) {
		return [...within(dialog).getByRole("group", {name: "Search results"}).querySelectorAll("[cmdk-item]")].map(
			(item) => ({
				label: item.querySelector("[data-palette-label]")?.textContent ?? "",
				meta: item.querySelector("[data-palette-meta]")?.textContent ?? "",
			}),
		);
	}

	it("opens the sidebar Search entry without the floating pill, with upstream's right-aligned Compose ⇥ footer hint", async () => {
		const composer = await renderPalette();
		pressK(composer, {metaKey: true, shiftKey: true});
		const dialog = await screen.findByRole("dialog", {name: "Search"});
		const hint = within(footer(dialog) as HTMLElement).getByRole("button", {name: /^Compose/});
		expect({
			pill: within(dialog).queryByRole("radiogroup", {name: "Search or compose"}),
			keys: hint.getAttribute("aria-keyshortcuts"),
			kbd: hint.querySelector("kbd")?.textContent,
		}).toStrictEqual({pill: null, keys: "Tab", kbd: "⇥"});

		fireEvent.click(hint);

		expect(await within(dialog).findByText("Send")).toBeTruthy();
	});

	it("centres the card on upstream's fixed 583.9px settled height, capped at 15vh on medium and 25vh on wide screens", async () => {
		const dialog = await openPalette();
		const classes = dialog.className.split(" ");
		expect({
			tops: classes.filter((name) => /^(sm:|lg:)?top-/.test(name)),
			inline: dialog.style.top,
		}).toStrictEqual({
			tops: [
				"top-4",
				"sm:top-[max(0px,min(15vh,max(2rem,calc((100vh-583.9px)/2))))]",
				"lg:top-[max(0px,min(25vh,max(2rem,calc((100vh-583.9px)/2))))]",
			],
			inline: "",
		});
	});

	it("names the Compose radio without a Tab keycap", async () => {
		const dialog = await openPalette();

		expect(within(dialog).getByRole("radio", {name: "Compose"}).textContent).toBe("Compose");
	});

	it("styles every type tab muted with no own background; the active ink and pill come from data-active", async () => {
		const dialog = await openPalette();

		expect(
			within(dialog)
				.getAllByRole("tab")
				.map((tab) => [
					tab.textContent,
					tab.className.split(/\s+/).some((name) => name.startsWith("bg-")),
					tab.classList.contains("font-medium"),
					tab.classList.contains("text-ink-muted"),
				]),
		).toStrictEqual(
			["All", "Artifacts", "Code", "Projects", "Scheduled", "Plans", "Memories", "Files"].map((label) => [
				label,
				false,
				true,
				true,
			]),
		);
	});

	it("rounds every option to upstream's 8px with rounded-r6", async () => {
		const dialog = await openPalette();
		await within(dialog).findByRole("option", {name: /Refactor auth module/});

		const options = within(dialog).getAllByRole("option");
		expect(
			options.filter((option) => !option.classList.contains("rounded-r6")).map((o) => o.textContent),
		).toStrictEqual([]);
		expect(options.some((option) => option.classList.contains("rounded-lg"))).toBe(false);
	});

	it("renders the type tabs in upstream order with the local ones last", async () => {
		const dialog = await openPalette();

		expect(
			within(within(dialog).getByRole("tablist", {name: "Type"}))
				.getAllByRole("tab")
				.map((tab) => tab.textContent),
		).toStrictEqual(["All", "Artifacts", "Code", "Projects", "Scheduled", "Plans", "Memories", "Files"]);
	});

	it("lists the artifacts newest first with a relative time on the Artifacts tab", async () => {
		const dialog = await openPalette(undefined, "/", seedLocal);

		fireEvent.click(within(dialog).getByRole("tab", {name: "Artifacts"}));

		expect(resultRows(dialog)).toStrictEqual([
			{label: "New report", meta: "Just now"},
			{label: "Mid deck", meta: "Past hour"},
			{label: "Old dashboard", meta: "Past month"},
		]);
	});

	it("filters artifacts by the query text and opens the artifact page", async () => {
		const dialog = await openPalette(undefined, "/", seedLocal);
		fireEvent.click(within(dialog).getByRole("tab", {name: "Artifacts"}));

		fireEvent.change(within(dialog).getByRole("combobox"), {target: {value: "deck"}});
		const rows = resultRows(dialog);
		const row = dialog.querySelector('[cmdk-item][data-item-type="artifact"]');
		if (row === null) throw new Error("no artifact row");
		fireEvent.click(row);

		expect(rows).toStrictEqual([{label: "Mid deck", meta: "Past hour"}]);
		await waitFor(() => {
			expect(currentRouter?.state.location.pathname).toBe("/artifact/art-mid");
		});
	});

	it("lists active routines with their schedule on the Scheduled tab and opens /routines", async () => {
		const dialog = await openPalette(undefined, "/", seedLocal);

		fireEvent.click(within(dialog).getByRole("tab", {name: "Scheduled"}));
		const rows = resultRows(dialog);
		fireEvent.click(within(dialog).getByRole("option", {name: /Nightly digest/}));

		expect(rows).toStrictEqual([{label: "Nightly digest", meta: "Every day at 9:00 AM"}]);
		await waitFor(() => {
			expect(currentRouter?.state.location.pathname).toBe("/routines");
		});
	});
});

describe("CommandPalette Plans, Memories and Files tabs with an empty query", () => {
	beforeEach(() => {
		vi.spyOn(navigator, "userAgent", "get").mockReturnValue(MAC_UA);
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
		cleanup();
		localStorage.clear();
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

	function memoryList(
		project: string,
		filename: string,
		title: string,
		agoMs: number,
	): z.infer<typeof MemoryListResponse> {
		return {
			project: {id: project, name: project, projectPath: null},
			memories: [{filename, title, mtime: ago(agoMs), project}],
		};
	}

	function seedDocs(queryClient: QueryClient) {
		queryClient.setQueryData(plansQueryOptions().queryKey, [
			{filename: "old-plan.md", title: "Old plan", mtime: ago(240 * HOUR_MS), projects: []},
			{filename: "new-plan.md", title: "New plan", mtime: ago(0), projects: []},
			{filename: "mid-plan.md", title: "Mid plan", mtime: ago(HOUR_MS / 2), projects: []},
		]);
		const project = (id: string, memoryCount: number) => ({
			id,
			name: id,
			projectPath: null,
			sessionCount: 1,
			memoryCount,
			planCount: 0,
			taskCount: 0,
			activeCount: 0,
			lastActivity: ago(0),
		});
		queryClient.setQueryData(projectsQueryOptions().queryKey, [
			project("proj-a", 1),
			project("proj-b", 1),
			project("proj-none", 0),
		]);
		queryClient.setQueryData(
			projectMemoriesQueryOptions("proj-a").queryKey,
			memoryList("proj-a", "old.md", "Old memory", 240 * HOUR_MS),
		);
		queryClient.setQueryData(
			projectMemoriesQueryOptions("proj-b").queryKey,
			memoryList("proj-b", "new.md", "New memory", 0),
		);
	}

	function resultRows(dialog: HTMLElement) {
		return [...within(dialog).getByRole("group", {name: "Search results"}).querySelectorAll("[cmdk-item]")].map(
			(item) => ({
				label: item.querySelector("[data-palette-label]")?.textContent ?? "",
				meta: item.querySelector("[data-palette-meta]")?.textContent ?? "",
			}),
		);
	}

	it("lists the recent plans newest first on the Plans tab", async () => {
		const dialog = await openPalette(undefined, "/", seedDocs);

		fireEvent.click(within(dialog).getByRole("tab", {name: "Plans"}));

		expect(resultRows(dialog)).toStrictEqual([
			{label: "New plan", meta: "Just now"},
			{label: "Mid plan", meta: "Past hour"},
			{label: "Old plan", meta: "Past month"},
		]);
	});

	it("lists the recent memories across projects newest first on the Memories tab", async () => {
		const dialog = await openPalette(undefined, "/", seedDocs);

		fireEvent.click(within(dialog).getByRole("tab", {name: "Memories"}));

		expect(resultRows(dialog)).toStrictEqual([
			{label: "New memory", meta: "Just now"},
			{label: "Old memory", meta: "Past month"},
		]);
	});

	it("caps the Projects tab at PALETTE_RECENT_LIMIT rows, like every upstream tab", async () => {
		const projects = Array.from({length: 30}, (_, index) => ({
			id: `proj-${index}`,
			name: `proj-${index}`,
			projectPath: null,
			sessionCount: 1,
			memoryCount: 0,
			planCount: 0,
			taskCount: 0,
			activeCount: 0,
			lastActivity: ago(0),
		}));
		const dialog = await openPalette(undefined, "/", (queryClient) => {
			queryClient.setQueryData(projectsQueryOptions().queryKey, projects);
		});

		fireEvent.click(within(dialog).getByRole("tab", {name: "Projects"}));

		expect(resultRows(dialog).map((row) => row.label)).toStrictEqual(
			projects.slice(0, PALETTE_RECENT_LIMIT).map((project) => project.name),
		);
	});

	function selection(dialog: HTMLElement) {
		const first = within(dialog).getByRole("group", {name: "Search results"}).querySelector("[cmdk-item]");
		return {
			label: first?.querySelector("[data-palette-label]")?.textContent,
			dataSelected: first?.getAttribute("data-selected"),
			ariaSelected: first?.getAttribute("aria-selected"),
			activedescendant: within(dialog).getByRole("combobox").getAttribute("aria-activedescendant") === first?.id,
		};
	}

	it("selects row 0 on every tab change, as upstream's pg={index:0}", async () => {
		const dialog = await openPalette([recentSession("sess-1", "Refactor auth module")], "/", (queryClient) => {
			seedDocs(queryClient);
			queryClient.setQueryData(artifactsQueryOptions.queryKey, [
				artifact("art-new", "New report", 0),
				artifact("art-old", "Old dashboard", HOUR_MS),
			]);
		});
		const input = within(dialog).getByRole("combobox");

		fireEvent.keyDown(input, {key: "ArrowRight", code: "ArrowRight"});
		const artifacts = selection(dialog);
		fireEvent.click(within(dialog).getByRole("tab", {name: "Projects"}));
		const projectsTab = selection(dialog);
		fireEvent.click(within(dialog).getByRole("tab", {name: "Plans"}));
		const plansTab = selection(dialog);

		expect({artifacts, projectsTab, plansTab}).toStrictEqual({
			artifacts: {label: "New report", dataSelected: "true", ariaSelected: "true", activedescendant: true},
			projectsTab: {label: "proj-a", dataSelected: "true", ariaSelected: "true", activedescendant: true},
			plansTab: {label: "New plan", dataSelected: "true", ariaSelected: "true", activedescendant: true},
		});
	});

	it("keeps New session selected over row 0 when a tab change keeps Quick actions on top", async () => {
		const dialog = await openPalette([recentSession("sess-1", "Refactor auth module")], "/", (queryClient) => {
			queryClient.setQueryData(artifactsQueryOptions.queryKey, [artifact("art-new", "New report", 0)]);
		});
		const input = within(dialog).getByRole("combobox");
		fireEvent.change(input, {target: {value: "re"}});

		fireEvent.click(within(dialog).getByRole("tab", {name: "Artifacts"}));
		const selected = dialog.querySelector('[cmdk-item][data-selected="true"]');

		expect({
			value: selected?.getAttribute("data-value"),
			activedescendant: input.getAttribute("aria-activedescendant") === selected?.id,
		}).toStrictEqual({value: "start:new-session", activedescendant: true});
	});

	it("shows upstream's empty state with Search all on the Files tab", async () => {
		const dialog = await openPalette(undefined, "/", seedDocs);

		fireEvent.click(within(dialog).getByRole("tab", {name: "Files"}));

		expect({
			rows: resultRows(dialog),
			empty: within(dialog).getByText("No results in Files", {selector: "p"}).className,
			button: within(dialog).getByRole("button", {name: "Search all"}).textContent,
		}).toStrictEqual({
			rows: [],
			empty: "m-0 max-w-full break-words text-secondary",
			button: "Search all",
		});
	});
});

describe("CommandPalette filter values", () => {
	beforeEach(() => {
		vi.spyOn(navigator, "userAgent", "get").mockReturnValue(MAC_UA);
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
		cleanup();
		localStorage.clear();
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	function typeQuery(dialog: HTMLElement, value: string) {
		fireEvent.change(within(dialog).getByRole("combobox"), {target: {value}});
	}

	function resultLabels(dialog: HTMLElement): string[] {
		return [...within(dialog).getByRole("group", {name: "Search results"}).querySelectorAll("[cmdk-item]")].map(
			(item) => item.querySelector("[data-palette-label]")?.textContent ?? "",
		);
	}

	function sessionLabels(dialog: HTMLElement): string[] {
		return [...dialog.querySelectorAll('[cmdk-item][data-item-type="code_session"]')].map(
			(item) => item.querySelector("[data-palette-label]")?.textContent ?? "",
		);
	}

	it("lists the Date values under a Date heading after date:", async () => {
		const dialog = await openPalette();

		typeQuery(dialog, "date:");

		expect({
			groups: groupLabels(dialog),
			empty: within(dialog).queryByText(/No results/u),
			results: within(dialog).queryByRole("group", {name: "Search results"}),
		}).toStrictEqual({
			groups: [["Date", ["Today", "Past week", "Past month"]]],
			empty: null,
			results: null,
		});
	});

	it("completes the token when a value is chosen", async () => {
		const dialog = await openPalette();
		typeQuery(dialog, "fix date:");

		fireEvent.click(within(dialog).getByRole("option", {name: /Past week/u}));

		expect({
			value: within(dialog).getByRole<HTMLTextAreaElement>("combobox").value,
			chips: [...dialog.querySelectorAll("[data-filter]")].map((chip) => chip.getAttribute("aria-label")),
		}).toStrictEqual({value: "fix ", chips: ["Date Past week"]});
	});

	it("lists the recent repos under Repo after repo:", async () => {
		const dialog = await openPalette([
			{...recentSession("sess-1", "One"), project: "/users/dev/ccp", projectName: "claude-code-plans"},
			{...recentSession("sess-2", "Two"), project: "/users/dev/avalon", projectName: "avalon"},
			{...recentSession("sess-3", "Three"), project: "/users/dev/ccp", projectName: "claude-code-plans"},
		]);

		typeQuery(dialog, "repo:");

		expect(groupLabels(dialog)).toStrictEqual([["Repo", ["ccp", "avalon"]]]);
	});

	it("offers one Archived row and one Actions row", async () => {
		const dialog = await openPalette();

		typeQuery(dialog, "archived:");
		const archived = groupLabels(dialog);
		typeQuery(dialog, "actions:");

		expect({archived, actions: groupLabels(dialog)}).toStrictEqual({
			archived: [["Archived", ["Archived"]]],
			actions: [["Actions", ["Actions"]]],
		});
	});

	it("searches archived sessions with archived:", async () => {
		const archivedSession = {...recentSession("sess-old", "Old archived refactor"), archived: true};
		const dialog = await openPalette([recentSession("sess-1", "Refactor auth module")], "/", (queryClient) => {
			queryClient.setQueryData(recentSessionsQueryOptions(PALETTE_RECENT_LIMIT, "all").queryKey, {
				sessions: [recentSession("sess-1", "Refactor auth module"), archivedSession],
				nextCursor: null,
			});
		});

		typeQuery(dialog, "refactor");
		const withoutToken = sessionLabels(dialog);
		typeQuery(dialog, "archived:true refactor");

		expect({withoutToken, withToken: sessionLabels(dialog)}).toStrictEqual({
			withoutToken: ["Refactor auth module"],
			withToken: ["Refactor auth module", "Old archived refactor"],
		});
	});

	it("marks archived search rows with the palette Archived badge and muted text", async () => {
		const archivedSession = {...recentSession("sess-old", "Old archived refactor"), archived: true};
		const dialog = await openPalette([recentSession("sess-1", "Refactor auth module")], "/", (queryClient) => {
			queryClient.setQueryData(recentSessionsQueryOptions(PALETTE_RECENT_LIMIT, "all").queryKey, {
				sessions: [recentSession("sess-1", "Refactor auth module"), archivedSession],
				nextCursor: null,
			});
		});

		typeQuery(dialog, "archived:true refactor");

		expect(
			[...dialog.querySelectorAll('[cmdk-item][data-item-type="code_session"]')].map((item) => ({
				label: item.querySelector("[data-palette-label]")?.textContent ?? "",
				badge: item.querySelector("[data-archived-badge]")?.textContent ?? null,
				muted: item.hasAttribute("data-archived"),
			})),
		).toStrictEqual([
			{label: "Refactor auth module", badge: null, muted: false},
			{label: "Old archived refactor", badge: "Archived", muted: true},
		]);
	});

	it("joins upstream's PR #N and the time into a typed session row's secondary", async () => {
		const mtime = new Date(Date.now() - 10 * 60_000).toISOString();
		const dialog = await openPalette([
			recentSession("s-pr", "Refactor with PR", "done", {pr: PR_863, mtime}),
			recentSession("s-plain", "Refactor plain", "done", {mtime}),
		]);

		typeQuery(dialog, "refactor");

		expect(
			[...dialog.querySelectorAll('[cmdk-item][data-item-type="code_session"]')].map((item) => ({
				label: item.querySelector("[data-palette-label]")?.textContent ?? "",
				meta: item.querySelector("[data-palette-meta]")?.textContent ?? "",
			})),
		).toStrictEqual([
			{label: "Refactor with PR", meta: "PR #863 · Past hour"},
			{label: "Refactor plain", meta: "Past hour"},
		]);
	});

	it("puts an archived row's PR #N and Archived badge in upstream's inline-flex secondary", async () => {
		const mtime = new Date(Date.now() - 10 * 60_000).toISOString();
		const archivedSession = recentSession("sess-old", "Old archived refactor", "done", {
			pr: PR_863,
			mtime,
			archived: true,
		});
		const dialog = await openPalette([recentSession("sess-1", "Refactor auth module")], "/", (queryClient) => {
			queryClient.setQueryData(recentSessionsQueryOptions(PALETTE_RECENT_LIMIT, "all").queryKey, {
				sessions: [archivedSession],
				nextCursor: null,
			});
		});

		typeQuery(dialog, "archived:true old");

		const meta = dialog.querySelector('[cmdk-item][data-item-type="code_session"] [data-palette-meta]');
		const wrapper = meta?.firstElementChild;
		expect({
			wrapper: wrapper?.className.split(" "),
			parts: [...(wrapper?.childNodes ?? [])].map((node) =>
				node instanceof Element && node.hasAttribute("data-archived-badge") ? "badge" : node.textContent,
			),
		}).toStrictEqual({
			wrapper: ["inline-flex", "items-center", "gap-1.5"],
			parts: ["PR #863 · Past hour", "badge"],
		});
	});

	it("restricts the list to Actions with actions:", async () => {
		const dialog = await openPalette([recentSession("sess-1", "Settings refactor")]);

		typeQuery(dialog, "actions:true sett");
		const narrowed = resultLabels(dialog);
		typeQuery(dialog, "actions:true");

		expect({narrowed, all: resultLabels(dialog)}).toStrictEqual({
			narrowed: ["Settings"],
			all: ["Search sessions", "Keyboard shortcuts", "Toggle sidebar", "Settings", "Mark all sessions seen"],
		});
	});

	it("draws upstream's per-filter hint icons and neutral badge beside the Filter by label", async () => {
		const dialog = await openPalette();

		typeQuery(dialog, "/");

		const rows = [...dialog.querySelectorAll('[cmdk-item][data-value^="filter:"]')];
		expect({
			rows: rows.map((row) => {
				const label = row.querySelector("[data-palette-label]");
				const badge = label?.nextElementSibling;
				return {
					icon: [...(row.querySelector("svg")?.classList ?? [])].filter((name) => name !== "lucide"),
					label: label?.textContent,
					badge: badge?.className.split(" ").toSorted(),
					badgeText: badge?.textContent,
				};
			}),
			wrapper: rows[0]?.parentElement?.getAttribute("role") ?? null,
		}).toStrictEqual({
			rows: [
				["lucide-clock", "Date"],
				["lucide-git-branch", "Repo"],
				["lucide-folder-open", "Project"],
				["lucide-shapes", "Type"],
				["lucide-archive", "Archived"],
				["lucide-keyboard", "Actions"],
			].map(([icon, text]) => ({
				icon: [icon],
				label: "Filter by ",
				badge: "inline-flex items-center gap-1 h-[22px] rounded-[5.5px] px-2 text-xs leading-[15px] font-medium bg-fill-ghost-hover text-secondary shrink-0 -my-px relative top-px"
					.split(" ")
					.toSorted(),
				badgeText: text,
			})),
			wrapper: null,
		});
	});
});

describe("CommandPalette committed filter chips", () => {
	beforeEach(() => {
		vi.spyOn(navigator, "userAgent", "get").mockReturnValue(MAC_UA);
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
		cleanup();
		localStorage.clear();
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	const CHIP_CLASSES =
		"inline-flex items-center gap-1 h-[22px] whitespace-nowrap rounded-[5.5px] px-2 text-xs leading-[15px] font-medium min-w-0 max-w-[10rem] shrink-0 bg-upstream-tint-blue text-upstream-accent";

	function typeQuery(dialog: HTMLElement, value: string) {
		fireEvent.change(within(dialog).getByRole("combobox"), {target: {value}});
	}

	function chips(dialog: HTMLElement) {
		return [...dialog.querySelectorAll("[role=group][data-filter]")].map((chip) => ({
			filter: chip.getAttribute("data-filter"),
			label: chip.getAttribute("aria-label"),
			title: chip.getAttribute("title"),
			text: chip.textContent,
			classes: chip.className.split(" ").toSorted(),
			clear: chip.querySelector('button[aria-label="Clear filter"]')?.getAttribute("type") ?? null,
		}));
	}

	it("commits key:value words into a chip strip before the textarea", async () => {
		const dialog = await openPalette();
		const input = within(dialog).getByRole<HTMLTextAreaElement>("combobox");

		typeQuery(dialog, "date:today archived: ");

		const strip = dialog.querySelector("[role=presentation][data-palette-own-keys]");
		expect({
			value: input.value,
			placeholder: input.getAttribute("placeholder"),
			stripBeforeInput: strip?.nextElementSibling === input,
			strip: strip?.className.split(" ").toSorted(),
			chips: chips(dialog),
		}).toStrictEqual({
			value: "",
			placeholder: "Search",
			stripBeforeInput: true,
			strip: "-mx-1 flex h-8 min-w-0 shrink items-center gap-2 self-start overflow-x-auto overscroll-x-contain scroll-px-1 px-1 [scrollbar-width:none]"
				.split(" ")
				.toSorted(),
			chips: [
				{
					filter: "date",
					label: "Date Today",
					title: "Today",
					text: "Today",
					classes: CHIP_CLASSES.split(" ").toSorted(),
					clear: "button",
				},
				{
					filter: "archived",
					label: "Archived",
					title: "Archived",
					text: "Archived",
					classes: CHIP_CLASSES.split(" ").toSorted(),
					clear: "button",
				},
			],
		});
	});

	it("switches the tab for type:code without leaving a chip", async () => {
		const dialog = await openPalette();

		typeQuery(dialog, "fix type:code ");

		expect({
			value: within(dialog).getByRole<HTMLTextAreaElement>("combobox").value,
			tab: within(dialog).getByRole("tab", {selected: true}).textContent,
			chips: chips(dialog),
		}).toStrictEqual({value: "fix ", tab: "Code", chips: []});
	});

	it("clears one chip with its X while focus stays in the textarea", async () => {
		const dialog = await openPalette();
		const input = within(dialog).getByRole("combobox");
		typeQuery(dialog, "date:today archived: ");
		input.focus();

		const clear = dialog.querySelector('[data-filter="date"] button[aria-label="Clear filter"]');
		if (clear === null) throw new Error("missing Date clear button");
		const mouseDownNotPrevented = fireEvent.mouseDown(clear);
		fireEvent.click(clear);

		expect({
			mouseDownNotPrevented,
			focused: document.activeElement === input,
			chips: chips(dialog).map((chip) => chip.label),
		}).toStrictEqual({mouseDownNotPrevented: false, focused: true, chips: ["Archived"]});
	});

	it("pops Archived, then Date, then nothing on Backspace in an empty query", async () => {
		const dialog = await openPalette();
		const input = within(dialog).getByRole("combobox");
		typeQuery(dialog, "date:today archived: ");

		const steps = [1, 2, 3].map(() => {
			const notPrevented = fireEvent.keyDown(input, {key: "Backspace", code: "Backspace"});
			return {notPrevented, chips: chips(dialog).map((chip) => chip.label)};
		});

		expect({steps, tab: within(dialog).getByRole("tab", {selected: true}).textContent}).toStrictEqual({
			steps: [
				{notPrevented: false, chips: ["Date Today"]},
				{notPrevented: false, chips: []},
				{notPrevented: true, chips: []},
			],
			tab: "All",
		});
	});

	it("announces the tab and chips in the live region", async () => {
		const dialog = await openPalette();

		typeQuery(dialog, "date:today archived: ");

		expect(dialog.querySelector("[aria-live=polite] [data-palette-showing]")?.textContent).toBe(
			"Showing All, Date Today, Archived",
		);
	});
});

describe("CommandPalette pinned Jump to question row", () => {
	beforeEach(() => {
		vi.spyOn(navigator, "userAgent", "get").mockReturnValue(MAC_UA);
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
		cleanup();
		document.querySelectorAll("[data-test-waiting-card]").forEach((card) => {
			card.remove();
		});
		localStorage.clear();
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	function addWaitingCard(): HTMLElement {
		const card = document.createElement("div");
		card.setAttribute("data-approval-card-root", "");
		card.setAttribute("data-test-waiting-card", "");
		card.setAttribute("role", "group");
		card.setAttribute("aria-label", "Pick one");
		card.tabIndex = -1;
		document.body.append(card);
		return card;
	}

	function firstListChild(dialog: HTMLElement): Element | null {
		return dialog.querySelector("[cmdk-list-sizer]")?.firstElementChild ?? null;
	}

	it("pins a selected, headingless Jump to question row above Needs attention when a waiting card is on the page", async () => {
		addWaitingCard();
		const dialog = await openPalette([
			recentSession("sess-1", "Refactor auth module", "blocked"),
			recentSession("sess-2", "Fix the flaky test"),
		]);
		await within(dialog).findByRole("option", {name: /Refactor auth module/});
		const pinned = firstListChild(dialog);
		const row = pinned?.querySelector("[cmdk-item]");

		expect({
			pinnedIsGroup: pinned?.hasAttribute("cmdk-group"),
			heading: pinned?.querySelector("[cmdk-group-heading]") ?? null,
			rows: [...(pinned?.querySelectorAll("[cmdk-item]") ?? [])].map((item) => item.textContent),
			value: row?.getAttribute("data-value"),
			selected: row?.getAttribute("data-selected"),
			icon: row?.querySelector("svg")?.getAttribute("class"),
			nextGroup: pinned?.nextElementSibling?.querySelector("[cmdk-group-heading]")?.textContent,
		}).toStrictEqual({
			pinnedIsGroup: false,
			heading: null,
			rows: ["Jump to question"],
			value: "action:jump_to_question",
			selected: "true",
			icon: "lucide lucide-circle-question-mark",
			nextGroup: "Needs attention",
		});
	});

	it("gives up a Recents row to fit the jump row beside 5 leads, as upstream's 1 + 5 + 1 + 1", async () => {
		addWaitingCard();
		const dialog = await openPalette([
			...Array.from({length: 9}, (_, index) => recentSession(`s-${index}`, `Waiting ${index}`, "blocked")),
			...Array.from({length: 5}, (_, index) => recentSession(`r-${index}`, `Recent ${index}`)),
		]);
		await within(dialog).findByRole("option", {name: /Waiting 0/});

		expect({
			first: firstListChild(dialog)?.textContent,
			groups: groupLabels(dialog).map(([heading, labels]) => [heading, labels.length]),
		}).toStrictEqual({
			first: "Jump to question",
			groups: [
				["Needs attention", 5],
				["Recents", 1],
				["Actions", 1],
			],
		});
	});

	it("offers no jump row without a waiting card", async () => {
		const dialog = await openPalette();
		await within(dialog).findByRole("option", {name: /Refactor auth module/});

		expect(within(dialog).queryByRole("option", {name: "Jump to question"})).toBeNull();
	});

	it("Enter closes the palette and lands on the waiting card instead of returning focus to the opener", async () => {
		const card = addWaitingCard();
		const dialog = await openPalette();
		await within(dialog).findByRole("option", {name: "Jump to question"});
		fireEvent.keyDown(within(dialog).getByRole("combobox"), {key: "Enter", code: "Enter"});

		await waitFor(() => {
			expect(screen.queryByRole("dialog", {name: "Search"})).toBeNull();
		});
		await waitFor(() => {
			expect({
				focused: document.activeElement === card,
				landing: card.getAttribute("data-focus-region-landing"),
			}).toStrictEqual({focused: true, landing: "overlay"});
		});
	});

	it("ignores ⌘Enter and Ctrl+Enter while the jump is offered, as upstream's modifiedEnterPicksNothing", async () => {
		const card = addWaitingCard();
		const dialog = await openPalette();
		await within(dialog).findByRole("option", {name: "Jump to question"});
		const input = within(dialog).getByRole("combobox");
		const meta = fireEvent.keyDown(input, {key: "Enter", code: "Enter", metaKey: true});
		const ctrl = fireEvent.keyDown(input, {key: "Enter", code: "Enter", ctrlKey: true});

		expect({
			meta,
			ctrl,
			open: screen.queryByRole("dialog", {name: "Search"}) !== null,
			focused: document.activeElement === input,
			landing: card.getAttribute("data-focus-region-landing"),
			selected: within(dialog).getByRole("option", {name: "Jump to question"}).getAttribute("data-selected"),
		}).toStrictEqual({meta: false, ctrl: false, open: true, focused: true, landing: null, selected: "true"});
	});

	it("hides the pinned row once a query is typed, and in Compose", async () => {
		addWaitingCard();
		const dialog = await openPalette();
		await within(dialog).findByRole("option", {name: "Jump to question"});
		const input = within(dialog).getByRole("combobox");
		fireEvent.change(input, {target: {value: "x"}});
		const typed = within(dialog).queryByRole("option", {name: "Jump to question"});
		fireEvent.change(input, {target: {value: ""}});
		await within(dialog).findByRole("option", {name: "Jump to question"});
		fireEvent.keyDown(input, {key: "Tab", code: "Tab"});
		await within(dialog).findByRole("combobox", {name: "Write a message…"});

		expect({
			typed,
			compose: within(dialog).queryByRole("option", {name: "Jump to question"}),
		}).toStrictEqual({typed: null, compose: null});
	});

	it("decides the row once per open: a card removed while open keeps it, and Enter then just closes", async () => {
		const card = addWaitingCard();
		const composer = await renderPalette();
		pressK(composer, {metaKey: true});
		const dialog = await screen.findByRole("dialog", {name: "Search"});
		await within(dialog).findByRole("option", {name: "Jump to question"});
		card.remove();
		fireEvent.change(within(dialog).getByRole("combobox"), {target: {value: "x"}});
		fireEvent.change(within(dialog).getByRole("combobox"), {target: {value: ""}});
		await within(dialog).findByRole("option", {name: "Jump to question"});
		fireEvent.keyDown(within(dialog).getByRole("combobox"), {key: "Enter", code: "Enter"});

		await waitFor(() => {
			expect(screen.queryByRole("dialog", {name: "Search"})).toBeNull();
		});
		expect(card.hasAttribute("data-focus-region-landing")).toBe(false);
	});

	it("shows no row for a card that arrives while open, until the palette is reopened", async () => {
		const composer = await renderPalette();
		pressK(composer, {metaKey: true});
		const dialog = await screen.findByRole("dialog", {name: "Search"});
		await within(dialog).findByRole("option", {name: /Refactor auth module/});
		addWaitingCard();
		fireEvent.change(within(dialog).getByRole("combobox"), {target: {value: "x"}});
		fireEvent.change(within(dialog).getByRole("combobox"), {target: {value: ""}});
		await within(dialog).findByRole("option", {name: /Refactor auth module/});
		const whileOpen = within(dialog).queryByRole("option", {name: "Jump to question"});
		fireEvent.keyDown(within(dialog).getByRole("combobox"), {key: "Escape", code: "Escape"});
		await waitFor(() => {
			expect(screen.queryByRole("dialog", {name: "Search"})).toBeNull();
		});
		pressK(composer, {metaKey: true});
		const reopened = await screen.findByRole("dialog", {name: "Search"});

		expect({
			whileOpen,
			reopened: (await within(reopened).findByRole("option", {name: "Jump to question"})).textContent,
		}).toStrictEqual({whileOpen: null, reopened: "Jump to question"});
	});

	function searchResultLabels(dialog: HTMLElement): string[] {
		const results = within(dialog).queryByRole("group", {name: "Search results"});
		return [...(results?.querySelectorAll("[cmdk-item]") ?? [])].map(
			(item) => item.querySelector("[data-palette-label]")?.textContent ?? "",
		);
	}

	function typeQuery(dialog: HTMLElement, value: string) {
		fireEvent.change(within(dialog).getByRole("combobox"), {target: {value}});
	}

	it("lists a typed Jump to question action for its label, search hints and !jq bang while a waiting card is on the page", async () => {
		addWaitingCard();
		const dialog = await openPalette([recentSession("sess-1", "Settings refactor")]);
		await within(dialog).findByRole("option", {name: "Jump to question"});
		const matches: Record<string, string[]> = {};
		for (const query of ["question", "approval", "verification code", "!jq", "actions:true"]) {
			typeQuery(dialog, query);
			matches[query] = searchResultLabels(dialog).filter((label) => label === "Jump to question");
		}

		expect(matches).toStrictEqual({
			question: ["Jump to question"],
			approval: ["Jump to question"],
			"verification code": ["Jump to question"],
			"!jq": ["Jump to question"],
			"actions:true": ["Jump to question"],
		});
	});

	it("lists no typed jump action without a waiting card", async () => {
		const dialog = await openPalette([recentSession("sess-1", "Settings refactor")]);
		await within(dialog).findByRole("option", {name: /Settings refactor/});
		typeQuery(dialog, "!jq");
		const bang = searchResultLabels(dialog);
		typeQuery(dialog, "actions:true");

		expect({bang, actions: searchResultLabels(dialog)}).toStrictEqual({
			bang: [],
			actions: ["Search sessions", "Keyboard shortcuts", "Toggle sidebar", "Settings", "Mark all sessions seen"],
		});
	});

	it("choosing the typed jump action closes the palette and lands on the waiting card", async () => {
		const card = addWaitingCard();
		const dialog = await openPalette([recentSession("sess-1", "Settings refactor")]);
		await within(dialog).findByRole("option", {name: "Jump to question"});
		typeQuery(dialog, "!jq");
		const results = within(dialog).getByRole("group", {name: "Search results"});
		fireEvent.click(within(results).getByRole("option", {name: "Jump to question"}));

		await waitFor(() => {
			expect(screen.queryByRole("dialog", {name: "Search"})).toBeNull();
		});
		await waitFor(() => {
			expect({
				focused: document.activeElement === card,
				landing: card.getAttribute("data-focus-region-landing"),
			}).toStrictEqual({focused: true, landing: "overlay"});
		});
	});
});
