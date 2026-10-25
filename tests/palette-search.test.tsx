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
import {cleanup, fireEvent, render, screen, waitFor, within} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {CommandPalette, PALETTE_RECENT_LIMIT} from "../src/components/command-palette";
import {ToastProvider} from "../src/components/toast";
import {useCommandPalette} from "../src/hooks/use-command-palette";
import type {UnifiedSearchItem} from "../src/lib/api/search";
import {recentSessionsQueryOptions} from "../src/lib/api/sessions";

const MAC_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";
const YEAR_MS = 365 * 24 * 60 * 60_000;

function recentSession(id: string, title: string, bucket: "blocked" | "working" | "done" = "done") {
	return {
		id,
		title,
		summary: undefined,
		mtime: new Date().toISOString(),
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

function serverSession(id: string, title: string, overrides: Partial<UnifiedSearchItem> = {}): UnifiedSearchItem {
	return {
		kind: "session",
		id,
		title,
		titleMatches: [],
		projectId: "-users-dev-project-a",
		projectName: "project-a",
		mtime: new Date().toISOString(),
		...overrides,
	};
}

interface PendingSearch {
	url: string;
	resolve: (items: UnifiedSearchItem[]) => void;
	reject: () => void;
}

let pending: PendingSearch[] = [];

async function fetchMock(url: string): Promise<unknown> {
	return new Promise((resolveFetch, rejectFetch) => {
		pending.push({
			url,
			resolve: (items) => {
				resolveFetch({ok: true, status: 200, json: async () => Promise.resolve({items})});
			},
			reject: () => {
				rejectFetch(new TypeError("Failed to fetch"));
			},
		});
	});
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

async function openPalette(sessions = [recentSession("sess-1", "Refactor auth module")]) {
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
	const indexRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "/",
		component: () => null,
	});
	const searchRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "search",
		validateSearch: (search: Record<string, unknown>) => search,
		component: () => null,
	});
	const sessionRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "session/$id",
		component: () => null,
	});
	const router = createRouter({
		routeTree: rootRoute.addChildren([indexRoute, searchRoute, sessionRoute]),
		history: createMemoryHistory({initialEntries: ["/"]}),
	});
	await router.load();
	render(<RouterProvider router={router} />);
	const composer = await screen.findByRole("textbox", {name: "Composer"});
	composer.focus();
	fireEvent.keyDown(composer, {key: "k", code: "KeyK", metaKey: true});
	const dialog = await screen.findByRole("dialog", {name: "Search"});
	return {dialog, router};
}

function type(dialog: HTMLElement, value: string) {
	fireEvent.change(within(dialog).getByRole("combobox"), {target: {value}});
}

function resultsGroup(dialog: HTMLElement): HTMLElement {
	return within(dialog).getByRole("group", {name: "Search results"});
}

function optionLabels(dialog: HTMLElement): string[] {
	return [...resultsGroup(dialog).querySelectorAll("[cmdk-item]")].map(
		(item) => item.querySelector("[data-palette-label]")?.textContent ?? "",
	);
}

function option(dialog: HTMLElement, label: string): HTMLElement {
	const match = [...resultsGroup(dialog).querySelectorAll<HTMLElement>("[cmdk-item]")].find(
		(item) => item.querySelector("[data-palette-label]")?.textContent === label,
	);
	if (match === undefined) throw new Error(`No option labelled ${label}`);
	return match;
}

function boldRuns(element: Element): string[] {
	return [...element.querySelectorAll(".font-semibold.text-primary")].map((run) => run.textContent);
}

async function awaitRequest(): Promise<PendingSearch> {
	await waitFor(() => {
		expect(pending.length).toBe(1);
	});
	const [request] = pending;
	if (request === undefined) throw new Error("no request");
	return request;
}

describe("⌘K palette live search", () => {
	beforeEach(() => {
		pending = [];
		vi.spyOn(navigator, "userAgent", "get").mockReturnValue(MAC_UA);
		vi.stubGlobal("fetch", fetchMock);
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
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	it("keeps instant title matches in place when server rows arrive", async () => {
		const {dialog} = await openPalette();

		type(dialog, "auth");

		// Settling keeps the instant match and appends the skeleton; See all waits for the server.
		expect(optionLabels(dialog)).toStrictEqual(["Refactor auth module"]);

		const request = await awaitRequest();
		expect(request.url).toBe("/api/search?query=auth");
		request.resolve([
			serverSession("sess-2", "Auth token refresh", {titleMatches: [{start: 0, end: 4}]}),
			serverSession("sess-1", "Refactor auth module"),
			{
				...serverSession("auth-plan.md", "auth-plan.md"),
				kind: "plan",
				href: "/plan/auth-plan",
			},
		]);

		await waitFor(() => {
			expect(optionLabels(dialog)).toStrictEqual([
				"Refactor auth module",
				"Auth token refresh",
				"auth-plan.md",
				"See all results for “auth”",
			]);
		});
		expect(
			[...resultsGroup(dialog).querySelectorAll("[cmdk-item]")].map((item) =>
				item.getAttribute("data-item-type"),
			),
		).toStrictEqual(["code_session", "code_session", "plan", null]);
		const group = resultsGroup(dialog);
		expect({
			// Upstream's rows are contiguous at a 36px pitch, and code sessions carry the </> Code glyph.
			gap: group.className.split(" ").filter((name) => name.startsWith("gap-")),
			glyph: group
				.querySelector("[data-item-type=code_session] svg")
				?.getAttribute("class")
				?.split(" ")
				.find((name) => name.startsWith("lucide-")),
		}).toStrictEqual({gap: [], glyph: "lucide-code-xml"});
	});

	it("renders matched runs in bold for instant and server rows", async () => {
		const {dialog} = await openPalette();

		type(dialog, "auth");
		(await awaitRequest()).resolve([
			serverSession("sess-2", "Auth token refresh", {titleMatches: [{start: 0, end: 4}]}),
		]);

		await waitFor(() => {
			expect(optionLabels(dialog)).toContain("Auth token refresh");
		});
		expect({
			instant: boldRuns(option(dialog, "Refactor auth module")),
			server: boldRuns(option(dialog, "Auth token refresh")),
		}).toStrictEqual({instant: ["auth"], server: ["Auth"]});
	});

	it("quotes content snippets beside the title", async () => {
		const {dialog} = await openPalette([]);

		type(dialog, "hashing");
		(await awaitRequest()).resolve([
			serverSession("sess-3", "Cache layer", {
				snippet: {text: "the HashingStrategy exists", matches: [{start: 4, end: 11}]},
			}),
		]);

		await waitFor(() => {
			expect(optionLabels(dialog)).toContain("Cache layer");
		});
		const snippet = option(dialog, "Cache layer").querySelector("[data-palette-snippet]");
		expect({
			text: snippet?.textContent,
			className: snippet?.className,
			bold: snippet === null ? [] : boldRuns(snippet),
		}).toStrictEqual({
			text: "“the HashingStrategy exists”",
			className: "text-xs text-ink-muted max-w-[60%] shrink-0 overflow-hidden whitespace-nowrap",
			bold: ["Hashing"],
		});
	});

	it("shows a relative bucket meta and leaves it empty beyond a year", async () => {
		const {dialog} = await openPalette([]);

		type(dialog, "cache");
		(await awaitRequest()).resolve([
			serverSession("sess-4", "Cache now"),
			serverSession("sess-5", "Cache old", {
				mtime: new Date(Date.now() - 2 * YEAR_MS).toISOString(),
			}),
		]);

		await waitFor(() => {
			expect(optionLabels(dialog)).toContain("Cache old");
		});
		expect({
			now: option(dialog, "Cache now").querySelector("[data-palette-meta]")?.textContent,
			old: option(dialog, "Cache old").querySelector("[data-palette-meta]")?.textContent,
		}).toStrictEqual({now: "Just now", old: ""});
	});

	it("marks typed instant session results and keeps their time meta", async () => {
		const {dialog} = await openPalette([
			recentSession("s-wait", "Waiting 0", "blocked"),
			recentSession("s-run", "Waiting run", "working"),
		]);

		type(dialog, "Waiting");
		const marks = (label: string) => {
			const row = option(dialog, label);
			return {
				sr: row.querySelector(".sr-only")?.textContent,
				dot: row.querySelector("[data-palette-mark-dot]")?.className.split(" "),
				meta: row.querySelector("[data-palette-meta]")?.textContent,
			};
		};
		expect({awaiting: marks("Waiting 0"), running: marks("Waiting run")}).toStrictEqual({
			awaiting: {
				sr: " Awaiting input",
				dot: ["absolute", "-top-px", "-end-px", "size-1.5", "rounded-full", "bg-fill-accent"],
				meta: "Just now",
			},
			running: {
				sr: " Running",
				dot: ["absolute", "-top-px", "-end-px", "size-1.5", "rounded-full", "bg-fill-brand"],
				meta: "Just now",
			},
		});
	});

	it("marks sessions awaiting input with a pulse dot", async () => {
		const {dialog} = await openPalette([]);

		type(dialog, "deploy");
		(await awaitRequest()).resolve([
			serverSession("sess-6", "Deploy waiting", {state: "waiting"}),
			serverSession("sess-7", "Deploy idle", {state: "idle"}),
		]);

		await waitFor(() => {
			expect(optionLabels(dialog)).toContain("Deploy idle");
		});
		expect({
			waiting: option(dialog, "Deploy waiting").querySelector("[data-palette-mark-dot]")?.tagName,
			waitingSr: option(dialog, "Deploy waiting").querySelector(".sr-only")?.textContent,
			idle: option(dialog, "Deploy idle").querySelector("[data-palette-mark-dot]"),
		}).toStrictEqual({waiting: "SPAN", waitingSr: " Awaiting input", idle: null});
	});

	it("shows the deeper-search spinner and skeletons only while fetching", async () => {
		const {dialog} = await openPalette();

		const slot = () => dialog.querySelector("[data-palette-spinner-slot]");
		const idleSlot = slot()?.className;

		type(dialog, "auth");
		const request = await awaitRequest();

		expect({
			idleSlot,
			skeletons: dialog.querySelectorAll("[data-palette-skeleton]").length > 0,
			busy: resultsGroup(dialog).getAttribute("aria-busy"),
		}).toStrictEqual({
			idleSlot: "flex size-4 shrink-0 items-center justify-center",
			skeletons: true,
			busy: "true",
		});
		await waitFor(() => {
			expect(within(slot() as HTMLElement).getByRole("status").textContent).toBe("Searching deeper...");
		});

		request.resolve([serverSession("sess-2", "Auth token refresh")]);

		await waitFor(() => {
			expect(slot()?.childElementCount).toBe(0);
		});
		expect({
			skeletons: dialog.querySelectorAll("[data-palette-skeleton]").length,
			busy: resultsGroup(dialog).getAttribute("aria-busy"),
		}).toStrictEqual({skeletons: 0, busy: "false"});
	});

	it("fills the list with upstream's wave SkeletonGroup while settling, with no option rows above it", async () => {
		const {dialog} = await openPalette();

		type(dialog, "zqxvjkw");
		const request = await awaitRequest();

		const group = dialog.querySelector("[data-palette-skeleton]");
		const rows = Array.from(group?.children ?? []);
		const bars = (row: Element | undefined) =>
			Array.from(row?.querySelectorAll<HTMLElement>("[data-skeleton]") ?? []).map((bar) => ({
				width: bar.style.width,
				height: bar.style.height,
				index: bar.style.getPropertyValue("--skel-i"),
			}));
		expect({
			group: {
				className: group?.className,
				hidden: group?.getAttribute("aria-hidden"),
				motion: group?.getAttribute("data-motion"),
			},
			rows: rows.length,
			rowClass: rows[0]?.className,
			barClass: rows[0]?.querySelector("[data-skeleton]")?.className,
			first: bars(rows[0]),
			titleWidths: rows.map((row) => bars(row)[1]?.width),
			lastIndices: bars(rows[12]).map((bar) => bar.index),
			options: optionLabels(dialog),
		}).toStrictEqual({
			group: {
				className: "flex min-h-0 grow basis-0 flex-col flex-wrap content-start overflow-hidden",
				hidden: "true",
				motion: "wave",
			},
			rows: 13,
			rowClass: "flex shrink-0 items-center gap-2 px-3 py-2 box-border h-9 w-full",
			barClass: "max-w-full rounded bg-[var(--skeleton-base)]",
			first: [
				{width: "20px", height: "20px", index: "0"},
				{width: "224px", height: "14px", index: "1"},
			],
			titleWidths: [
				"224px",
				"176px",
				"256px",
				"200px",
				"160px",
				"240px",
				"192px",
				"224px",
				"176px",
				"256px",
				"200px",
				"160px",
				"240px",
			],
			// Upstream's --cds-skel-i counts 0..21 and restarts, so row 12 (bars 24, 25) breathes with row 1.
			lastIndices: ["2", "3"],
			options: [],
		});

		request.resolve([serverSession("sess-2", "Zqxvjkw notes")]);
		await waitFor(() => {
			expect(dialog.querySelector("[data-palette-skeleton]")).toBeNull();
		});
		expect(optionLabels(dialog)).toContain("See all results for “zqxvjkw”");
	});

	it("announces the result count politely once the search settles", async () => {
		const {dialog} = await openPalette();

		type(dialog, "auth");
		(await awaitRequest()).resolve([
			serverSession("sess-2", "Auth token refresh"),
			serverSession("sess-8", "Auth docs"),
		]);

		await waitFor(() => {
			expect(dialog.querySelector("[aria-live=polite]")?.textContent).toBe("3 results available");
		});
		expect(dialog.querySelector("[aria-live=polite]")?.getAttribute("aria-atomic")).toBe("true");
	});

	it("keeps the live region mounted but empty while the search is in flight", async () => {
		const {dialog} = await openPalette();

		type(dialog, "auth");
		const request = await awaitRequest();

		const live = dialog.querySelector("[aria-live=polite]");
		expect({
			atomic: live?.getAttribute("aria-atomic"),
			className: live?.className,
			text: live?.textContent,
		}).toStrictEqual({atomic: "true", className: "sr-only", text: ""});
		request.resolve([]);
	});

	it("announces a single result in the singular", async () => {
		const {dialog} = await openPalette([]);

		type(dialog, "zzqxvq");
		(await awaitRequest()).resolve([serverSession("sess-2", "Zzqxvq notes")]);

		await waitFor(() => {
			expect(dialog.querySelector("[aria-live=polite]")?.textContent).toBe("1 result available");
		});
	});

	it("navigates to the search page with the query and type from the last row", async () => {
		const {dialog, router} = await openPalette();

		type(dialog, "auth");
		(await awaitRequest()).resolve([]);
		fireEvent.click(await waitFor(() => option(dialog, "See all results for “auth”")));

		await waitFor(() => {
			expect(screen.queryByRole("dialog")).toBeNull();
		});
		expect({
			pathname: router.state.location.pathname,
			q: router.state.location.search["q" as never],
			type: router.state.location.search["type" as never],
		}).toStrictEqual({pathname: "/search", q: "auth", type: "all"});
	});
});

describe("⌘K palette list height", () => {
	const reportedHeight = 200;
	const scrollerClass =
		"flex flex-col min-h-0 overflow-y-auto p-2.5 transition-[height,max-height] duration-150 ease-out motion-reduce:transition-none";

	beforeEach(() => {
		pending = [];
		vi.spyOn(navigator, "userAgent", "get").mockReturnValue(MAC_UA);
		vi.stubGlobal("fetch", fetchMock);
		// Every observed element reports a 200px-tall content box, as the measured sizer would.
		vi.stubGlobal(
			"ResizeObserver",
			class {
				readonly #callback: ResizeObserverCallback;
				constructor(callback: ResizeObserverCallback) {
					this.#callback = callback;
				}
				observe(target: Element) {
					this.#callback(
						[{target, contentRect: {height: reportedHeight}} as unknown as ResizeObserverEntry],
						this,
					);
				}
				unobserve() {}
				disconnect() {}
			},
		);
		Element.prototype.scrollIntoView = () => {};
	});

	afterEach(() => {
		cleanup();
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	function list(dialog: HTMLElement) {
		const element = dialog.querySelector<HTMLElement>("[cmdk-list]");
		return {
			classes: element?.className.split(" ").filter((name) => !name.startsWith("[&")),
			height: element?.style.height,
			maxHeight: element?.style.maxHeight,
			sizerFills: element?.className.split(" ").includes("[&>[cmdk-list-sizer]]:min-h-full"),
		};
	}

	const maxHeight = "calc(440px + var(--cp-footer-collapsed, 0) * 41px)";

	it("fits settled results to their measured content plus the 20px padding", async () => {
		const {dialog} = await openPalette();

		type(dialog, "auth");
		(await awaitRequest()).resolve([
			serverSession("sess-2", "Auth token refresh"),
			serverSession("sess-3", "Auth docs"),
			serverSession("sess-4", "Auth flows"),
		]);

		await waitFor(() => {
			expect(dialog.querySelector("[aria-live=polite]")?.textContent).toBe("4 results available");
		});
		expect(list(dialog)).toStrictEqual({
			classes: scrollerClass.split(" "),
			height: "220px",
			maxHeight,
			sizerFills: false,
		});
	});

	it("holds the list at its cap, grown by the collapsed footer's 41px, while settling and when empty", async () => {
		const {dialog} = await openPalette([]);

		type(dialog, "zzqxvq");
		const request = await awaitRequest();
		const capped = {
			classes: scrollerClass.split(" "),
			height: "481px",
			maxHeight,
			sizerFills: true,
		};
		expect(list(dialog)).toStrictEqual(capped);

		request.resolve([]);
		await within(dialog).findByText("No results for “zzqxvq”", {selector: "p"});
		expect(list(dialog)).toStrictEqual(capped);
	});

	it("fits the Filter by hints to their content", async () => {
		const {dialog} = await openPalette();

		type(dialog, "/");

		expect(list(dialog)).toStrictEqual({
			classes: scrollerClass.split(" "),
			height: "220px",
			maxHeight,
			sizerFills: false,
		});
	});

	it("keeps the empty-query view at its 440px cap", async () => {
		const {dialog} = await openPalette();

		expect(list(dialog)).toStrictEqual({
			classes: scrollerClass.split(" "),
			height: "440px",
			maxHeight,
			sizerFills: true,
		});
	});
});

describe("⌘K palette filters", () => {
	beforeEach(() => {
		pending = [];
		vi.spyOn(navigator, "userAgent", "get").mockReturnValue(MAC_UA);
		vi.stubGlobal("fetch", fetchMock);
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
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
		// The Tab hint switches to Compose, which the palette persists.
		localStorage.clear();
	});

	function tabs(dialog: HTMLElement) {
		return within(within(dialog).getByRole("tablist", {name: "Type"}))
			.getAllByRole("tab")
			.map((tab) => ({name: tab.textContent, selected: tab.getAttribute("aria-selected")}));
	}

	function filterHints(dialog: HTMLElement): HTMLElement[] {
		return [...dialog.querySelectorAll<HTMLElement>('[cmdk-list] [cmdk-item][data-value^="filter:"]')];
	}

	/** Each hint's "Filter by " label followed by its badge text. */
	function filterLabels(dialog: HTMLElement): string[] {
		return filterHints(dialog).map((item) => {
			const label = item.querySelector("[data-palette-label]");
			return `${label?.textContent ?? ""}${label?.nextElementSibling?.textContent ?? ""}`;
		});
	}

	it("renders local type tabs with All selected", async () => {
		const {dialog} = await openPalette();

		expect(tabs(dialog)).toStrictEqual([
			{name: "All", selected: "true"},
			{name: "Artifacts", selected: "false"},
			{name: "Code", selected: "false"},
			{name: "Projects", selected: "false"},
			{name: "Scheduled", selected: "false"},
			{name: "Plans", selected: "false"},
			{name: "Memories", selected: "false"},
			{name: "Files", selected: "false"},
		]);
	});

	it("lists the Filter by hints when / is the whole query", async () => {
		const {dialog} = await openPalette();

		type(dialog, "/");

		expect(filterLabels(dialog)).toStrictEqual([
			"Filter by Date",
			"Filter by Repo",
			"Filter by Project",
			"Filter by Type",
			"Filter by Archived",
			"Filter by Actions",
		]);
		expect(pending).toStrictEqual([]);
	});

	it("narrows the hints as you type", async () => {
		const {dialog} = await openPalette();

		type(dialog, "/re");

		expect(filterLabels(dialog)).toStrictEqual(["Filter by Date", "Filter by Repo"]);
	});

	it("inserts the filter token when a hint is chosen", async () => {
		const {dialog} = await openPalette();

		type(dialog, "/re");
		const repo = filterHints(dialog).find((item) => item.textContent.includes("Repo"));
		if (repo === undefined) throw new Error("no Repo hint");
		fireEvent.click(repo);

		expect(within(dialog).getByRole("combobox")).toHaveProperty("value", "repo:");
	});

	it("lists recents with bucket meta on the Code tab with an empty query", async () => {
		const {dialog} = await openPalette([
			recentSession("sess-1", "Refactor auth module"),
			recentSession("sess-2", "Fix login"),
		]);

		fireEvent.click(within(dialog).getByRole("tab", {name: "Code"}));

		expect({
			labels: optionLabels(dialog),
			meta: [...resultsGroup(dialog).querySelectorAll("[data-palette-meta]")].map((meta) => meta.textContent),
			headings: [...dialog.querySelectorAll("[cmdk-group-heading]")].map((heading) => heading.textContent),
		}).toStrictEqual({
			labels: ["Refactor auth module", "Fix login"],
			meta: ["Just now", "Just now"],
			headings: [],
		});
	});

	it("maps type:code onto upstream's Code tab, the local sessions type", async () => {
		const {dialog} = await openPalette([]);

		type(dialog, "type:code auth");

		expect((await awaitRequest()).url).toBe("/api/search?query=auth&type=sessions");
	});

	it("maps tokens onto the search request", async () => {
		const {dialog} = await openPalette([]);

		type(dialog, "date:week type:plans auth");

		expect((await awaitRequest()).url).toBe("/api/search?query=auth&type=plans&date=week");
	});

	it("centers upstream's No results for the query and announces it when the All search finds nothing", async () => {
		const {dialog} = await openPalette([]);

		type(dialog, "zzqxvq");
		(await awaitRequest()).resolve([]);

		const empty = await within(dialog).findByText("No results for “zzqxvq”", {selector: "p"});
		expect({
			tag: empty.tagName,
			block: empty.parentElement?.className
				.split(" ")
				.filter((name) => ["flex-1", "items-center", "justify-center", "text-center"].includes(name)),
			// Upstream's block is a sibling after the results listbox, so flex-1 grows it through the capped list.
			blockParent: empty.parentElement?.parentElement?.hasAttribute("cmdk-list-sizer"),
			afterResults: empty.parentElement?.previousElementSibling === resultsGroup(dialog),
			clear: within(dialog).queryByRole("button", {name: "Clear filters"}),
			live: dialog.querySelector("[aria-live=polite]")?.textContent,
			// Upstream's empty view has no option rows: the local See all row waits for results.
			options: optionLabels(dialog),
		}).toStrictEqual({
			tag: "P",
			block: ["flex-1", "items-center", "justify-center", "text-center"],
			blockParent: true,
			afterResults: true,
			clear: null,
			live: "No results for “zzqxvq”",
			options: [],
		});
	});

	it("shows and announces upstream's Something went wrong when the server search fails", async () => {
		const {dialog} = await openPalette([]);

		type(dialog, "zzqxvq");
		(await awaitRequest()).reject();

		const failed = await within(dialog).findByText("Something went wrong", {selector: "p"});
		expect({
			block: failed.parentElement?.hasAttribute("data-palette-empty"),
			live: dialog.querySelector("[aria-live=polite]")?.textContent,
		}).toStrictEqual({block: true, live: "Something went wrong"});
	});

	it("keeps a 1-character no-match silent, announcing No results found only to the live region", async () => {
		const {dialog} = await openPalette([]);

		type(dialog, "ǂ");
		(await awaitRequest()).resolve([]);

		await waitFor(() => {
			expect(dialog.querySelector("[aria-live=polite]")?.textContent).toBe("No results found");
		});
		expect({
			empty: dialog.querySelector("[data-palette-empty]"),
			text: [...resultsGroup(dialog).querySelectorAll("p")].map((node) => node.textContent),
			options: optionLabels(dialog),
		}).toStrictEqual({empty: null, text: [], options: []});
	});

	it("offers upstream's Search all when filters emptied the list, clearing chips and type but keeping text and focus", async () => {
		const {dialog} = await openPalette([]);

		type(dialog, "date:week zzqxvq");
		(await awaitRequest()).resolve([]);

		const searchAll = await within(dialog).findByRole("button", {name: "Search all"});
		const combobox = within(dialog).getByRole("combobox");
		combobox.focus();
		const mouseDown = fireEvent.mouseDown(searchAll);
		fireEvent.click(searchAll);

		expect({
			defaultPrevented: !mouseDown,
			value: (combobox as HTMLTextAreaElement).value,
			tab: tabs(dialog)[0],
			focused: document.activeElement === combobox,
			clear: within(dialog).queryByRole("button", {name: "Clear filters"}),
		}).toStrictEqual({
			defaultPrevented: true,
			value: "zzqxvq",
			tab: {name: "All", selected: "true"},
			focused: true,
			clear: null,
		});
	});

	it("hints upstream's Tab to compose on an unfiltered empty search, and its keycap switches to Compose", async () => {
		const {dialog} = await openPalette([]);

		type(dialog, "zzqxvq");
		(await awaitRequest()).resolve([]);

		const hint = await within(dialog).findByText("to compose", {exact: false, selector: "p"});
		const keycap = hint.querySelector("kbd");
		const button = keycap?.closest("button");
		expect({
			hint: hint.textContent,
			hidden: hint.getAttribute("aria-hidden"),
			keycap: keycap?.textContent,
			tabIndex: button?.tabIndex,
		}).toStrictEqual({hint: "Tab to compose", hidden: "true", keycap: "Tab", tabIndex: -1});

		fireEvent.click(button as HTMLElement);

		expect(await screen.findByRole("combobox", {name: "Write a message…"})).toBeDefined();
	});

	it("shows the filtered no-results copy on the Code tab and Search all resets the tab", async () => {
		const {dialog} = await openPalette([]);

		fireEvent.click(within(dialog).getByRole("tab", {name: "Code"}));
		type(dialog, "zzqxvq");
		const request = await awaitRequest();
		expect(request.url).toBe("/api/search?query=zzqxvq&type=sessions");
		request.resolve([]);

		await within(dialog).findByText("No results for “zzqxvq” in Code", {selector: "p"});
		fireEvent.click(within(dialog).getByRole("button", {name: "Search all"}));

		expect(tabs(dialog)[0]).toStrictEqual({name: "All", selected: "true"});
		await waitFor(() => {
			expect(pending.map((search) => search.url)).toContain("/api/search?query=zzqxvq");
		});
	});
});
