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

import {artifactsQueryOptions, ArtifactListResponse} from "../src/lib/api/artifacts";
import {
	ARTIFACTS_LAYOUT_STORAGE_KEY,
	artifactDateGroupLabel,
	filterArtifacts,
	groupArtifactsByDate,
} from "../src/lib/artifact-gallery";
import {getArtifacts} from "../src/lib/db/artifact-queries";
import {openTestDb, type AppDb} from "../src/lib/db/connection";
import * as schema from "../src/lib/db/schema";
import {Route as ArtifactsRoute} from "../src/routes/artifacts";
import {artifactPreviewPath} from "../src/lib/artifact-source-paths";
import {ToastProvider} from "../src/components/toast";
import {ARTIFACT_PIN_STORAGE_KEY} from "../src/lib/artifact-pins";
import {installLocalStorage} from "./fake-storage";

const NOW = new Date(2026, 8, 29, 12, 0, 0);

function localMs(year: number, monthIndex: number, day: number, hour = 10): number {
	return new Date(year, monthIndex, day, hour, 0, 0).getTime();
}

describe("artifactDateGroupLabel", () => {
	it("uses upstream's buckets: days within a week, then months this year, then month and year", () => {
		expect([
			artifactDateGroupLabel(localMs(2026, 8, 29), NOW),
			artifactDateGroupLabel(localMs(2026, 8, 26), NOW),
			artifactDateGroupLabel(localMs(2026, 8, 23), NOW),
			artifactDateGroupLabel(localMs(2026, 8, 22), NOW),
			artifactDateGroupLabel(localMs(2026, 5, 10), NOW),
			artifactDateGroupLabel(localMs(2026, 0, 1, 0), NOW),
			artifactDateGroupLabel(localMs(2025, 10, 3), NOW),
		]).toStrictEqual(["Sep 29", "Sep 26", "Sep 23", "September", "June", "January", "November 2025"]);
	});

	it("groups consecutive items that share a bucket, keyed by the last publish", () => {
		const items = [
			{id: "a", lastPublishedAt: localMs(2026, 8, 26, 15), firstSeenAt: localMs(2026, 0, 1)},
			{id: "b", lastPublishedAt: localMs(2026, 8, 26, 9), firstSeenAt: localMs(2026, 0, 1)},
			{id: "c", lastPublishedAt: null, firstSeenAt: localMs(2026, 8, 10)},
			{id: "d", lastPublishedAt: localMs(2026, 8, 2), firstSeenAt: localMs(2026, 8, 1)},
			{id: "e", lastPublishedAt: localMs(2025, 10, 3), firstSeenAt: localMs(2025, 10, 3)},
		];

		expect(
			groupArtifactsByDate(items, NOW).map((group) => ({
				label: group.label,
				ids: group.items.map((item) => item.id),
			})),
		).toStrictEqual([
			{label: "Sep 26", ids: ["a", "b"]},
			{label: "September", ids: ["c", "d"]},
			{label: "November 2025", ids: ["e"]},
		]);
	});
});

const LADDER_URL = "https://claude.ai/code/artifact/546d3910-4e9a-4730-9e91-62742a47c7c6";
const CHART_URL = "https://claude.ai/code/artifact/17b8a2c1-4c41-46bf-b064-a272240be709";
const DOCS_URL = "https://claude.ai/artifact/7Hq2vXbN4pLmKcR9sTwYzA";
const LADDER_SOURCE = "/Users/alice/projects/ladder/.llm/mockups/ladder.html";
const LADDER_MTIME = 1_790_000_000_000;

function ladderMtime(path: string): number | null {
	return path === LADDER_SOURCE ? LADDER_MTIME : null;
}

function seedArtifacts(db: AppDb): void {
	const base = {
		favicon: null,
		description: null,
		version: "1",
		projectId: "-Users-alice-projects-ladder",
	};
	db.index
		.insert(schema.artifacts)
		.values([
			{
				...base,
				url: LADDER_URL,
				id: "546d3910-4e9a-4730-9e91-62742a47c7c6",
				urlKind: "uuid",
				title: "Asap Ladder Queue",
				sourcePath: LADDER_SOURCE,
				audience: "owner",
				firstSeenAt: localMs(2026, 8, 20),
				lastPublishedAt: localMs(2026, 8, 26, 15),
				publishCount: 3,
				lastSessionId: "session-ladder",
			},
			{
				...base,
				url: CHART_URL,
				id: "17b8a2c1-4c41-46bf-b064-a272240be709",
				urlKind: "uuid",
				title: null,
				sourcePath: "/private/tmp/scratchpad/household-cash.html",
				audience: null,
				firstSeenAt: localMs(2026, 5, 1),
				lastPublishedAt: localMs(2026, 5, 10),
				publishCount: 1,
				lastSessionId: "session-chart",
			},
			{
				...base,
				url: DOCS_URL,
				id: "7Hq2vXbN4pLmKcR9sTwYzA",
				urlKind: "slug",
				title: "Quarterly plan",
				sourcePath: null,
				audience: "owner",
				firstSeenAt: localMs(2025, 10, 3),
				lastPublishedAt: localMs(2025, 10, 3),
				publishCount: 1,
				lastSessionId: "session-docs",
			},
		])
		.run();
}

/** A gallery of 14 HTML pages and 2 Docs, alternating between yours and shared with you. */
function seedMixedGallery(db: AppDb): void {
	db.index
		.insert(schema.artifacts)
		.values(
			Array.from({length: 16}, (_, index) => {
				const docs = index >= 14;
				const id = `mixed-${String(index).padStart(2, "0")}`;
				return {
					url: docs ? `https://claude.ai/artifact/${id}` : `https://claude.ai/code/artifact/${id}`,
					id,
					urlKind: docs ? ("slug" as const) : ("uuid" as const),
					title: `${index % 2 === 0 ? "Mine" : "Shared"} ${id}`,
					favicon: null,
					description: null,
					version: "1",
					projectId: "-Users-alice-projects-ladder",
					sourcePath: null,
					audience: index % 2 === 0 ? "owner" : "org",
					firstSeenAt: localMs(2026, 8, 1),
					lastPublishedAt: localMs(2026, 8, 1) + index * 60_000,
					publishCount: 1,
					lastSessionId: `session-${id}`,
				};
			}),
		)
		.run();
}

describe("getArtifacts", () => {
	it("lists artifacts newest first with a title fallback and whether the source still exists", () => {
		const db = openTestDb();
		seedArtifacts(db);

		const artifacts = getArtifacts(db.index, {}, ladderMtime);

		expect(
			artifacts.map(({id, title, kind, sourceExists, sourceModifiedAt, sessionId}) => ({
				id,
				title,
				kind,
				sourceExists,
				sourceModifiedAt,
				sessionId,
			})),
		).toStrictEqual([
			{
				id: "546d3910-4e9a-4730-9e91-62742a47c7c6",
				title: "Asap Ladder Queue",
				kind: "html",
				sourceExists: true,
				sourceModifiedAt: LADDER_MTIME,
				sessionId: "session-ladder",
			},
			{
				id: "17b8a2c1-4c41-46bf-b064-a272240be709",
				title: "household-cash.html",
				kind: "html",
				sourceExists: false,
				sourceModifiedAt: null,
				sessionId: "session-chart",
			},
			{
				id: "7Hq2vXbN4pLmKcR9sTwYzA",
				title: "Quarterly plan",
				kind: "docs",
				sourceExists: false,
				sourceModifiedAt: null,
				sessionId: "session-docs",
			},
		]);
	});

	it("filters by title, ignoring case", () => {
		const db = openTestDb();
		seedArtifacts(db);

		expect(getArtifacts(db.index, {q: "LADDER"}, () => null).map((a) => a.id)).toStrictEqual([
			"546d3910-4e9a-4730-9e91-62742a47c7c6",
		]);
	});

	it("filters by type on the client", () => {
		const db = openTestDb();
		seedArtifacts(db);
		const artifacts = getArtifacts(db.index, {}, () => null);

		expect({
			docs: filterArtifacts(artifacts, {search: "", type: "docs"}).map((a) => a.id),
			html: filterArtifacts(artifacts, {search: "cash", type: "html"}).map((a) => a.id),
		}).toStrictEqual({
			docs: ["7Hq2vXbN4pLmKcR9sTwYzA"],
			html: ["17b8a2c1-4c41-46bf-b064-a272240be709"],
		});
	});
});

let storage: ReturnType<typeof installLocalStorage>;

beforeEach(() => {
	storage = installLocalStorage();
});

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

const MAC_USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";

async function renderArtifactsPage(initialEntry: string, seed: boolean | ((db: AppDb) => void)) {
	const db = openTestDb();
	if (seed === true) seedArtifacts(db);
	else if (typeof seed === "function") seed(db);
	const data = ArtifactListResponse.parse(JSON.parse(JSON.stringify(getArtifacts(db.index, {}, ladderMtime))));

	const queryClient = new QueryClient({
		defaultOptions: {queries: {retry: false, staleTime: Infinity}},
	});
	queryClient.setQueryData(artifactsQueryOptions.queryKey, data);

	const rootRoute = createRootRoute({
		component: () => (
			<QueryClientProvider client={queryClient}>
				<ToastProvider>
					<Outlet />
				</ToastProvider>
			</QueryClientProvider>
		),
	});
	const {validateSearch, component} = ArtifactsRoute.options;
	const artifactsRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "/artifacts",
		...(validateSearch ? {validateSearch} : {}),
		...(component ? {component} : {}),
	});
	const router = createRouter({
		routeTree: rootRoute.addChildren([artifactsRoute]),
		history: createMemoryHistory({initialEntries: [initialEntry]}),
	});
	await router.load();
	render(<RouterProvider router={router} />);
	await screen.findByRole("heading", {level: 1, name: "Artifacts"});
	return router;
}

/** The page's own live statuses, without the toast region. */
function pageStatuses() {
	return screen
		.getAllByRole("status")
		.filter((status) => !status.hasAttribute("aria-live"))
		.map((status) => status.textContent);
}

function rowSummary(row: HTMLElement) {
	const primary = row.querySelector("a[data-primary]");
	return {
		title: primary?.getAttribute("aria-label"),
		href: primary?.getAttribute("href"),
		target: primary?.getAttribute("target"),
		rel: primary?.getAttribute("rel"),
		chips: within(row)
			.queryAllByRole("link")
			.filter((link) => !link.hasAttribute("data-primary"))
			.map((link) => ({name: link.textContent, href: link.getAttribute("href")})),
		private: within(row).queryByRole("img", {name: "Private"}) !== null,
		meta: row.querySelector("[data-artifact-meta]")?.textContent,
	};
}

describe("artifacts route", () => {
	it("lists artifacts by date group linking out to claude.ai", async () => {
		await renderArtifactsPage("/artifacts", true);

		const groups = screen.getAllByRole("list").map((list) => ({
			heading: list.getAttribute("aria-labelledby")
				? document.getElementById(list.getAttribute("aria-labelledby") ?? "")?.textContent
				: null,
			rows: within(list).getAllByRole("listitem").map(rowSummary),
		}));

		expect(groups).toStrictEqual([
			{
				heading: artifactDateGroupLabel(localMs(2026, 8, 26, 15), new Date()),
				rows: [
					{
						title: "Asap Ladder Queue",
						href: LADDER_URL,
						target: "_blank",
						rel: "noopener noreferrer",
						chips: [
							{name: "Session", href: "/session/session-ladder"},
							{
								name: "Preview",
								href: artifactPreviewPath("546d3910-4e9a-4730-9e91-62742a47c7c6"),
							},
						],
						private: true,
						meta: expect.stringMatching(/^Edited /),
					},
				],
			},
			{
				heading: artifactDateGroupLabel(localMs(2026, 5, 10), new Date()),
				rows: [
					{
						title: "household-cash.html",
						href: CHART_URL,
						target: "_blank",
						rel: "noopener noreferrer",
						chips: [{name: "Session", href: "/session/session-chart"}],
						private: false,
						meta: expect.stringMatching(/^Edited /),
					},
				],
			},
			{
				heading: artifactDateGroupLabel(localMs(2025, 10, 3), new Date()),
				rows: [
					{
						title: "Quarterly plan",
						href: DOCS_URL,
						target: "_blank",
						rel: "noopener noreferrer",
						chips: [{name: "Session", href: "/session/session-docs"}],
						private: true,
						meta: expect.stringMatching(/^Edited /),
					},
				],
			},
		]);
	});

	it("shows the upstream empty state when nothing has been published", async () => {
		await renderArtifactsPage("/artifacts", false);

		expect({
			heading: screen.getByRole("heading", {level: 3}).textContent,
			body: screen.getByText("Artifacts that Claude publishes in your sessions appear here.").tagName,
		}).toStrictEqual({heading: "No artifacts yet", body: "P"});
	});

	it("opens search from ?search= and announces the match count", async () => {
		await renderArtifactsPage("/artifacts?search=ladder", true);

		expect({
			input: (screen.getByRole("searchbox", {name: "Search your artifacts"}) as HTMLInputElement).value,
			placeholder: screen.getByRole("searchbox").getAttribute("placeholder"),
			status: pageStatuses()[0],
			rows: screen.getAllByRole("listitem").map((row) => rowSummary(row).title),
		}).toStrictEqual({
			input: "ladder",
			placeholder: "Search artifacts...",
			status: "1 artifact matching “ladder”",
			rows: ["Asap Ladder Queue"],
		});
	});

	it("writes the search into the URL and shows the no-match message", async () => {
		const router = await renderArtifactsPage("/artifacts", true);

		fireEvent.click(screen.getByRole("button", {name: "Search your artifacts"}));
		fireEvent.change(screen.getByRole("searchbox", {name: "Search your artifacts"}), {
			target: {value: "zzqx"},
		});

		await waitFor(() => {
			expect({...router.state.location.search}).toStrictEqual({search: "zzqx"});
		});
		expect(pageStatuses()).toStrictEqual(["0 artifacts matching “zzqx”", "No artifacts matching “zzqx”"]);
	});

	it("persists the grid/list toggle in localStorage", async () => {
		await renderArtifactsPage("/artifacts", true);

		fireEvent.click(screen.getByRole("button", {name: "Grid view"}));

		expect({
			stored: storage.getItem(ARTIFACTS_LAYOUT_STORAGE_KEY),
			toggle: screen.getByRole("button", {name: "List view"}).tagName,
			headings: screen.queryAllByRole("heading", {level: 2}).length,
			cards: document.querySelectorAll("[data-gallery-card]").length,
		}).toStrictEqual({stored: "grid", toggle: "BUTTON", headings: 0, cards: 3});

		cleanup();
		await renderArtifactsPage("/artifacts", true);

		expect(screen.getByRole("button", {name: "List view"}).tagName).toBe("BUTTON");
	});

	it("shows the toolbar tooltips with ⌘F on search and the Private lock", async () => {
		vi.spyOn(navigator, "userAgent", "get").mockReturnValue(MAC_USER_AGENT);
		await renderArtifactsPage("/artifacts", true);

		async function tooltipFor(element: HTMLElement) {
			fireEvent.pointerEnter(element);
			const tooltip = await screen.findByRole("tooltip");
			const summary = {
				text: tooltip.firstChild?.textContent,
				keys: tooltip.querySelector("[data-cds='Shortcut']")?.textContent ?? null,
			};
			fireEvent.pointerLeave(element);
			return summary;
		}

		expect([
			await tooltipFor(screen.getByRole("button", {name: "Search your artifacts"})),
			await tooltipFor(screen.getByRole("button", {name: "Grid view"})),
			await tooltipFor(screen.getByRole("button", {name: "Filter by type: All types"})),
			await tooltipFor(screen.getAllByRole("img", {name: "Private"})[0] as HTMLElement),
		]).toStrictEqual([
			{text: "Search your artifacts", keys: "⌘CommandF"},
			{text: "Grid view", keys: null},
			{text: "Filter by type: All types", keys: null},
			{text: "Private", keys: null},
		]);
	});

	it("expands and focuses the search on ⌘F", async () => {
		vi.spyOn(navigator, "userAgent", "get").mockReturnValue(MAC_USER_AGENT);
		await renderArtifactsPage("/artifacts", true);

		fireEvent.keyDown(document.body, {key: "f", code: "KeyF", metaKey: true});

		await waitFor(() => {
			expect(document.activeElement).toBe(screen.getByRole("searchbox", {name: "Search your artifacts"}));
		});
	});

	it("expands the search on Ctrl+F off the Mac", async () => {
		vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (X11; Linux x86_64)");
		await renderArtifactsPage("/artifacts", true);

		fireEvent.keyDown(document.body, {key: "f", code: "KeyF", ctrlKey: true});

		await waitFor(() => {
			expect(document.activeElement).toBe(screen.getByRole("searchbox", {name: "Search your artifacts"}));
		});
	});

	it("shows upstream's All / Yours / Shared with you tabs and keeps the choice in ?view=", async () => {
		const router = await renderArtifactsPage("/artifacts", seedMixedGallery);

		function titles() {
			return screen
				.getAllByRole("listitem")
				.map((row) => rowSummary(row).title ?? "")
				.sort();
		}
		const tabs = within(screen.getByRole("tablist", {name: "Artifacts"})).getAllByRole("tab");
		const initial = {
			tabs: tabs.map((tab) => [tab.textContent, tab.getAttribute("aria-selected")]),
			rows: titles().length,
		};

		fireEvent.click(screen.getByRole("tab", {name: "Shared with you"}));
		await waitFor(() => {
			expect({...router.state.location.search}).toStrictEqual({view: "shared"});
		});
		const shared = titles();

		fireEvent.click(screen.getByRole("tab", {name: "Yours"}));
		await waitFor(() => {
			expect({...router.state.location.search}).toStrictEqual({view: "yours"});
		});

		expect({initial, shared, yours: titles()}).toStrictEqual({
			initial: {
				tabs: [
					["All", "true"],
					["Yours", "false"],
					["Shared with you", "false"],
				],
				rows: 16,
			},
			shared: [1, 3, 5, 7, 9, 11, 13, 15].map((n) => `Shared mixed-${String(n).padStart(2, "0")}`),
			yours: [0, 2, 4, 6, 8, 10, 12, 14].map((n) => `Mine mixed-${String(n).padStart(2, "0")}`),
		});
	});

	it("opens on the tab named by ?view=", async () => {
		await renderArtifactsPage("/artifacts?view=shared", seedMixedGallery);

		expect({
			selected: screen.getByRole("tab", {selected: true}).textContent,
			rows: screen.getAllByRole("listitem").length,
		}).toStrictEqual({selected: "Shared with you", rows: 8});
	});

	it("names the type filter options with upstream's vocabulary, icons and counts", async () => {
		await renderArtifactsPage("/artifacts", seedMixedGallery);

		fireEvent.click(screen.getByRole("button", {name: "Filter by type: All types"}));
		const items = await screen.findAllByRole("menuitemradio");

		expect({
			names: items.map((item) => item.textContent),
			icons: items.map((item) => item.querySelector("[data-type-tile]")?.getAttribute("data-type-tile") ?? null),
		}).toStrictEqual({
			names: ["All types", "Docs 2", "Other 14"],
			icons: ["all", "docs", "html"],
		});

		fireEvent.click(screen.getByRole("menuitemradio", {name: "Other 14"}));

		await waitFor(() => {
			expect(screen.getByRole("button", {name: "Filter by type: Other"}).tagName).toBe("BUTTON");
		});
	});

	function groupedTitles() {
		return screen.getAllByRole("list").map((list) => ({
			heading: document.getElementById(list.getAttribute("aria-labelledby") ?? "")?.textContent,
			rows: within(list)
				.getAllByRole("listitem")
				.map((row) => rowSummary(row).title),
		}));
	}

	it("offers Pin and Copy link from the row's More options menu and its context menu", async () => {
		await renderArtifactsPage("/artifacts", true);

		fireEvent.click(screen.getByRole("button", {name: "More options for Quarterly plan"}));
		const menu = (await screen.findAllByRole("menuitem")).map((item) => item.textContent);
		fireEvent.keyDown(screen.getByRole("menu"), {key: "Escape"});
		await waitFor(() => {
			expect(screen.queryByRole("menu")).toBeNull();
		});

		fireEvent.contextMenu(screen.getByRole("link", {name: "Quarterly plan"}), {clientX: 40, clientY: 50});
		const contextMenu = (await screen.findAllByRole("menuitem")).map((item) => item.textContent);

		expect({menu, contextMenu}).toStrictEqual({menu: ["Pin", "Copy link"], contextMenu: ["Pin", "Copy link"]});
	});

	it("moves a pinned row under Pinned, stores it per browser and unpins from the hover button", async () => {
		await renderArtifactsPage("/artifacts", true);

		fireEvent.click(screen.getByRole("button", {name: "More options for Quarterly plan"}));
		fireEvent.click(await screen.findByRole("menuitem", {name: "Pin"}));

		await waitFor(() => {
			expect(screen.getAllByRole("list")).toHaveLength(3);
		});
		const pinned = {
			groups: groupedTitles(),
			stored: JSON.parse(storage.getItem(ARTIFACT_PIN_STORAGE_KEY) ?? "null"),
		};

		fireEvent.click(screen.getByRole("button", {name: "Unpin Quarterly plan"}));

		expect({pinned, unpinned: groupedTitles()}).toStrictEqual({
			pinned: {
				groups: [
					{heading: "Pinned", rows: ["Quarterly plan"]},
					{
						heading: artifactDateGroupLabel(localMs(2026, 8, 26, 15), new Date()),
						rows: ["Asap Ladder Queue"],
					},
					{heading: artifactDateGroupLabel(localMs(2026, 5, 10), new Date()), rows: ["household-cash.html"]},
				],
				stored: [DOCS_URL],
			},
			unpinned: [
				{heading: artifactDateGroupLabel(localMs(2026, 8, 26, 15), new Date()), rows: ["Asap Ladder Queue"]},
				{heading: artifactDateGroupLabel(localMs(2026, 5, 10), new Date()), rows: ["household-cash.html"]},
				{heading: artifactDateGroupLabel(localMs(2025, 10, 3), new Date()), rows: ["Quarterly plan"]},
			],
		});
	});

	it("copies the claude.ai artifact URL and toasts", async () => {
		const writeText = vi.fn(async (_text: string) => {});
		Object.defineProperty(navigator, "clipboard", {configurable: true, value: {writeText}});
		await renderArtifactsPage("/artifacts", true);

		fireEvent.click(screen.getByRole("button", {name: "More options for Asap Ladder Queue"}));
		fireEvent.click(await screen.findByRole("menuitem", {name: "Copy link"}));

		expect({
			toast: (await screen.findByText("Link copied to clipboard.")).textContent,
			copied: writeText.mock.calls,
		}).toStrictEqual({toast: "Link copied to clipboard.", copied: [[LADDER_URL]]});
	});
});
