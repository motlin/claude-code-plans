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
import {TOOLBAR_SEARCH_CLEAR_CLASS, TOOLBAR_SEARCH_FIELD_CLASS} from "../src/components/toolbar-search";
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
const DOCS_TYPE_URL = "https://claude.ai/artifact/Rp9naXUCj2xozpUkyQy19W";
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
				typeUrl: DOCS_TYPE_URL,
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
					typeUrl: docs ? DOCS_TYPE_URL : null,
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
	beforeEach(() => {
		// These tests read the date-grouped list; the default layout is upstream's grid.
		storage.setItem(ARTIFACTS_LAYOUT_STORAGE_KEY, "list");
	});

	it("defaults to upstream's grid of cards when no layout was ever chosen", async () => {
		storage.removeItem(ARTIFACTS_LAYOUT_STORAGE_KEY);
		await renderArtifactsPage("/artifacts", true);

		expect({
			toggle: screen.getByRole("button", {name: "List view"}).tagName,
			cards: document.querySelectorAll("[data-gallery-card]").length,
		}).toStrictEqual({toggle: "BUTTON", cards: 3});
	});

	it("sizes the content as upstream's `mx-auto w-full px-md md:px-8 max-w-5xl` box inside a gutter-less route, so the grid is 960px at desktop", async () => {
		await renderArtifactsPage("/artifacts", true);
		const page = document.body.firstElementChild?.firstElementChild;
		const band = page?.querySelector(":scope > .sticky");

		expect({
			gutter: ArtifactsRoute.options.staticData?.pageGutter,
			page: page?.className,
			parts: [...(page?.children ?? [])].map((child) => child.className),
			headerBox: band?.firstElementChild?.className,
		}).toStrictEqual({
			gutter: "none",
			page: "flex w-full flex-col",
			// px-md is 8px (README pad-md); local spacing has no md token, so px-2.
			parts: [
				"h-0 -mt-9 max-sm:-mt-12",
				"sticky top-0 bg-page",
				"mx-auto w-full max-w-5xl px-2 md:px-8 flex flex-col pb-12 pt-1",
			],
			headerBox: "mx-auto w-full max-w-5xl px-2 md:px-8 pt-9 max-sm:pt-12 pb-6",
		});
	});

	it("draws grid cards as upstream: r10, a 160px preview, a 28px type tile straddling the divider, 14px body, 13/20 title, 11/17 meta, no pills", async () => {
		storage.removeItem(ARTIFACTS_LAYOUT_STORAGE_KEY);
		await renderArtifactsPage("/artifacts", true);
		const card = document.querySelector<HTMLElement>("[data-gallery-card]");
		if (card === null) throw new Error("no card");
		const classes = (selector: string) => card.querySelector(selector)?.className.split(" ") ?? [];
		const has = (selector: string, names: string[]) => names.filter((name) => !classes(selector).includes(name));
		expect({
			frame: has("[data-card-frame]", [
				"rounded-r7",
				"h-full",
				"after:absolute",
				"after:inset-0",
				"after:border",
			]),
			preview: has("[data-card-preview]", ["h-[160px]"]),
			badge: has("[data-card-badge]", [
				"absolute",
				"start-3",
				"top-0",
				"-translate-y-2/3",
				"size-7",
				"rounded-r6",
				"p-0.5",
			]),
			body: has("[data-card-body]", ["p-3.5"]),
			title: has("[data-card-title]", ["text-[13px]/[20px]", "font-medium"]),
			meta: has("[data-card-meta]", ["text-[11px]/[17px]", "mt-auto"]),
			pills: within(card).queryAllByRole("link", {name: /^(Session|Preview)$/}).length,
		}).toStrictEqual({frame: [], preview: [], badge: [], body: [], title: [], meta: [], pills: 0});
	});

	it("rings grid cards instead of bordering them and lets them size to their content, as upstream", async () => {
		storage.removeItem(ARTIFACTS_LAYOUT_STORAGE_KEY);
		await renderArtifactsPage("/artifacts", true);
		const frame = document.querySelector<HTMLElement>("[data-gallery-card] [data-card-frame]");
		if (frame === null) throw new Error("no card frame");
		const names = frame.className.split(" ");

		expect({
			minHeight: names.some((name) => name.startsWith("min-h-")),
			border: names.includes("border"),
		}).toStrictEqual({minHeight: false, border: false});
	});

	it("puts the card's Pin after the time in the meta row and its More options top-right over the preview, as upstream", async () => {
		storage.removeItem(ARTIFACTS_LAYOUT_STORAGE_KEY);
		await renderArtifactsPage("/artifacts", true);
		const card = screen.getByRole("link", {name: "Quarterly plan"}).closest<HTMLElement>("[data-gallery-card]");
		if (card === null) throw new Error("no card");
		const meta = card.querySelector("[data-card-meta]");
		const pin = within(card).getByRole("button", {name: "Pin Quarterly plan"});
		const more = within(card).getByRole("button", {name: "More options for Quarterly plan"});
		const moreWrapper = more.closest<HTMLElement>("[data-card-more]");

		expect({
			metaChildren: [...(meta?.children ?? [])]
				.slice(-2)
				.map((child) =>
					child.contains(pin) ? "pin" : child.hasAttribute("data-artifact-meta") ? "time" : "other",
				),
			pinInMeta: meta?.contains(pin),
			pinClasses: ["size-6", "p-1", "-my-1"].filter((name) => !pin.classList.contains(name)),
			moreInMeta: meta?.contains(more),
			moreWrapper: ["absolute", "z-10", "end-3", "top-3"].filter(
				(name) => !moreWrapper?.classList.contains(name),
			),
			moreBg: more.classList.contains("bg-page"),
		}).toStrictEqual({
			metaChildren: ["time", "pin"],
			pinInMeta: true,
			pinClasses: [],
			moreInMeta: false,
			moreWrapper: [],
			moreBg: true,
		});
	});

	it("keeps every card's straddling type tile neutral and draws the card's private lock at 16px, as upstream", async () => {
		storage.removeItem(ARTIFACTS_LAYOUT_STORAGE_KEY);
		await renderArtifactsPage("/artifacts", true);
		const tiles = [...document.querySelectorAll("[data-card-badge] [data-type-tile]")];
		const locks = [...document.querySelectorAll("[data-card-meta] svg")];

		expect({
			kinds: [...new Set(tiles.map((tile) => tile.getAttribute("data-type-tile")))].toSorted((a, b) =>
				(a ?? "").localeCompare(b ?? ""),
			),
			neutral: tiles.every(
				(tile) => tile.classList.contains("bg-alpha-1") && tile.classList.contains("text-secondary"),
			),
			locks: locks.length > 0 && locks.every((lock) => lock.classList.contains("size-4")),
		}).toStrictEqual({kinds: ["docs", "html"], neutral: true, locks: true});
	});

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
			input: screen.getByRole<HTMLInputElement>("searchbox", {name: "Search your artifacts"}).value,
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
		expect(pageStatuses()).toStrictEqual(["No artifacts match “zzqx”", "No artifacts matching “zzqx”"]);
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
			await tooltipFor(screen.getAllByRole("img", {name: "Private"})[0]!),
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

	it("opens search as upstream's cds TextInput and marks the toolbar data-search-open", async () => {
		await renderArtifactsPage("/artifacts", true);
		const controls = document.querySelector("[data-cds-part=controls]");

		const closedOpenAttr = controls?.hasAttribute("data-search-open");
		fireEvent.click(screen.getByRole("button", {name: "Search your artifacts"}));
		const search = screen.getByRole("search");
		const field = search.querySelector("[data-cds=TextInput]");

		expect({
			closedOpenAttr,
			openAttr: controls?.hasAttribute("data-search-open"),
			search: search.className,
			box: field?.parentElement?.className,
			field: field?.className,
			clear: within(search).getByRole("button", {name: "Clear search"}).className,
		}).toStrictEqual({
			closedOpenAttr: false,
			openAttr: true,
			search: "flex max-w-full min-w-40 grow items-center gap-3 @min-[640px]:justify-end basis-40",
			box: "w-0 min-w-40 flex-1 @min-[640px]:max-w-sm",
			field: TOOLBAR_SEARCH_FIELD_CLASS,
			clear: TOOLBAR_SEARCH_CLEAR_CLASS,
		});
	});

	it("collapses the search on blur only while the draft is empty", async () => {
		await renderArtifactsPage("/artifacts", true);

		fireEvent.click(screen.getByRole("button", {name: "Search your artifacts"}));
		fireEvent.change(screen.getByRole("searchbox"), {target: {value: "x"}});
		fireEvent.blur(screen.getByRole("searchbox"));
		const keptWithDraft = screen.queryByRole("searchbox") !== null;

		fireEvent.change(screen.getByRole("searchbox"), {target: {value: ""}});
		fireEvent.blur(screen.getByRole("searchbox"));

		expect({
			keptWithDraft,
			collapsed: screen.queryByRole("searchbox"),
			button: screen.getByRole("button", {name: "Search your artifacts"}).tagName,
			openAttr: document.querySelector("[data-cds-part=controls]")?.hasAttribute("data-search-open"),
		}).toStrictEqual({keptWithDraft: true, collapsed: null, button: "BUTTON", openAttr: false});
	});

	it("expands the search on Ctrl+F off the Mac", async () => {
		vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (X11; Linux x86_64)");
		await renderArtifactsPage("/artifacts", true);

		fireEvent.keyDown(document.body, {key: "f", code: "KeyF", ctrlKey: true});

		await waitFor(() => {
			expect(document.activeElement).toBe(screen.getByRole("searchbox", {name: "Search your artifacts"}));
		});
	});

	it("shows upstream's All / Yours / Shared with you tabs and keeps the choice in ?tab=", async () => {
		const router = await renderArtifactsPage("/artifacts", seedMixedGallery);

		function titles() {
			return screen
				.getAllByRole("listitem")
				.map((row) => rowSummary(row).title ?? "")
				.toSorted();
		}
		const tabs = within(screen.getByRole("tablist", {name: "Artifacts"})).getAllByRole("tab");
		const initial = {
			tabs: tabs.map((tab) => [tab.textContent, tab.getAttribute("aria-selected")]),
			rows: titles().length,
		};

		fireEvent.click(screen.getByRole("tab", {name: "Shared with you"}));
		await waitFor(() => {
			expect({...router.state.location.search}).toStrictEqual({tab: "shared"});
		});
		const shared = titles();

		fireEvent.click(screen.getByRole("tab", {name: "Yours"}));
		await waitFor(() => {
			expect({...router.state.location.search}).toStrictEqual({tab: "mine"});
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

	it("opens on the tab named by ?tab=", async () => {
		await renderArtifactsPage("/artifacts?tab=shared", seedMixedGallery);

		expect({
			selected: screen.getByRole("tab", {selected: true}).textContent,
			rows: screen.getAllByRole("listitem").length,
		}).toStrictEqual({selected: "Shared with you", rows: 8});
	});

	it("still opens the tab named by the legacy ?view= param", async () => {
		await renderArtifactsPage("/artifacts?view=yours", seedMixedGallery);

		expect({
			selected: screen.getByRole("tab", {selected: true}).textContent,
			rows: screen.getAllByRole("listitem").length,
		}).toStrictEqual({selected: "Yours", rows: 8});
	});

	it("drops ?tab= when going back to All", async () => {
		const router = await renderArtifactsPage("/artifacts?tab=mine", seedMixedGallery);

		fireEvent.click(screen.getByRole("tab", {name: "All"}));

		await waitFor(() => {
			expect({...router.state.location.search}).toStrictEqual({});
		});
	});

	it("roves focus across the tabs with manual activation, like upstream's activateOnFocus:false", async () => {
		await renderArtifactsPage("/artifacts?tab=mine", seedMixedGallery);

		const tabs = within(screen.getByRole("tablist", {name: "Artifacts"})).getAllByRole("tab");
		const tabIndexes = tabs.map((tab) => tab.getAttribute("tabindex"));

		act(() => {
			screen.getByRole("tab", {name: "Yours"}).focus();
		});
		fireEvent.keyDown(screen.getByRole("tab", {name: "Yours"}), {key: "ArrowRight"});

		await waitFor(() => {
			expect(document.activeElement?.textContent).toBe("Shared with you");
		});
		expect({
			tabIndexes,
			selected: tabs.map((tab) => tab.getAttribute("aria-selected")),
		}).toStrictEqual({
			tabIndexes: ["-1", "0", "-1"],
			selected: ["false", "true", "false"],
		});
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
		const writeText = vi.fn<(text: string) => Promise<void>>(async (_text: string) => {});
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
