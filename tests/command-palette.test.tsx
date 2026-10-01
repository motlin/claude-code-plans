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
import {recentSessionsQueryOptions} from "../src/lib/api/sessions";
import {saveRecents, type RecentEntry} from "../src/lib/recents-history";

const MAC_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";

type Bucket = "blocked" | "review" | "working" | "done";

function recentSession(id: string, title: string, bucket: Bucket = "done") {
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

async function renderPalette(sessions = [recentSession("sess-1", "Refactor auth module")], initialPath = "/") {
	const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}});
	queryClient.setQueryData(recentSessionsQueryOptions(PALETTE_RECENT_LIMIT).queryKey, {
		sessions,
		nextCursor: null,
	});
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
	const router = createRouter({
		routeTree: rootRoute.addChildren([sessionRoute]),
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
		vi.stubGlobal("fetch", () => new Promise(() => {}));
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

	it("opens on ⌘K with a focused Search combobox textarea", async () => {
		const dialog = await openPalette();

		const input = within(dialog).getByRole("combobox", {name: "Search"});
		await waitFor(() => expect(document.activeElement).toBe(input));
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
				["Compose⇥Tab", "false"],
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
			[...(footer(dialog)?.children[0]?.children ?? [])].map((hint) => [
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

		await waitFor(() => expect(footer(dialog)).toBeNull());
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
		}).toStrictEqual({afterRight: "Sessions", afterWrap: "Projects", card: null});
	});

	it("leaves ← and → to the caret when it is inside the query", async () => {
		const dialog = await openPalette();
		const input = within(dialog).getByRole("combobox") as HTMLTextAreaElement;
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
		await waitFor(() => expect(document.activeElement).toBe(within(card).getByRole("menuitem", {name: /^Open1/})));
		expect({
			keyShortcuts: row.getAttribute("aria-keyshortcuts"),
			dialogOpen: screen.queryByRole("dialog", {name: "Search"}) === dialog,
		}).toStrictEqual({keyShortcuts: "Alt+Enter", dialogOpen: true});
	});

	it("closes on Escape", async () => {
		const dialog = await openPalette();

		fireEvent.keyDown(within(dialog).getByRole("combobox"), {key: "Escape", code: "Escape"});

		await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
	});

	it("closes on the Close button", async () => {
		const dialog = await openPalette();

		fireEvent.click(within(dialog).getByRole("button", {name: "Close"}));

		await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
	});

	it("toggles closed on a second ⌘K", async () => {
		const dialog = await openPalette();

		pressK(within(dialog).getByRole("combobox"), {metaKey: true});

		await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
	});

	it("does not open on Ctrl+K on mac", async () => {
		const composer = await renderPalette();

		pressK(composer, {ctrlKey: true});

		await act(async () => {});
		expect(screen.queryByRole("dialog")).toBeNull();
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
		await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
		const outside = screen.getByRole("textbox", {name: "Composer"});

		pressK(outside, {metaKey: true, shiftKey: true, key: "K"});
		const searchDialog = await screen.findByRole("dialog", {name: "Search"});
		const searchInput = await within(searchDialog).findByRole("combobox", {name: "Search"});
		fireEvent.keyDown(searchInput, {key: "Escape", code: "Escape"});
		await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

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

		await waitFor(() =>
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
			}),
		);
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
			["Needs attention", ["Blocked one Awaiting input", "Review one Needs review"]],
			["Recents", ["Recent one", "Recent two", "Recent three", "Recent four", "Recent five"]],
			[
				"Actions",
				["Search sessions", "Keyboard shortcuts", "Toggle sidebar", "Settings", "Mark all sessions seen"],
			],
		]);
		expect(dialog.querySelectorAll("[data-palette-attention-dot]").length).toBe(2);
	});

	it("caps Needs attention at the organic total of 7", async () => {
		const dialog = await openPalette(
			Array.from({length: 9}, (_, index) => recentSession(`s-${index}`, `Waiting ${index}`, "blocked")),
		);

		await within(dialog).findByRole("option", {name: /Waiting 0/});
		expect(groupLabels(dialog).map(([heading, labels]) => [heading, labels.length])).toStrictEqual([
			["Needs attention", 7],
			["Actions", 5],
		]);
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
		await waitFor(() => expect(within(dialog).queryByRole("option", {name: "Setup"})).toBeNull());
		fireEvent.change(within(dialog).getByRole("combobox"), {target: {value: "config"}});
		await waitFor(() => expect(within(dialog).queryByRole("option", {name: "Claude Config"})).toBeNull());
		fireEvent.change(within(dialog).getByRole("combobox"), {target: {value: "settings"}});
		fireEvent.click(await within(dialog).findByRole("option", {name: /^Settings/}));

		await waitFor(() =>
			expect({
				pathname: currentRouter?.state.location.pathname,
				hash: currentRouter?.state.location.hash,
			}).toStrictEqual({pathname: "/session/s-current", hash: "settings/general"}),
		);
	});
});

describe("CommandPalette Recents from the per-tab visit MRU", () => {
	beforeEach(() => {
		vi.spyOn(navigator, "userAgent", "get").mockReturnValue(MAC_UA);
		vi.stubGlobal("fetch", () => new Promise(() => {}));
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

	it("caps Needs attention plus Recents at the organic total of 7, without repeating attention sessions", async () => {
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
			["Needs attention", ["Blocked one Awaiting input", "Review one Needs review"]],
			["Recents", ["Plan 0", "Plan 1", "Plan 2", "Plan 3", "Plan 4"]],
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

		await waitFor(() => expect(currentRouter?.state.location.pathname).toBe("/plan/big-plan"));
	});
});
