// @vitest-environment jsdom

import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {eq, ne} from "drizzle-orm";
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
	activeFilterCount,
	applyArtifactFilters,
	artifactDateGroupLabel,
	artifactMatchesSearch,
	NO_ARTIFACT_FILTERS,
	sortArtifacts,
	formatArtifactRelative,
	formatArtifactTooltip,
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
	it("uses upstream's buckets: Today, Yesterday, days within a week, then months this year, then month and year", () => {
		const ago = (hours: number) => artifactDateGroupLabel(NOW.getTime() - hours * 60 * 60 * 1000, NOW);
		expect([
			ago(2),
			ago(26),
			ago(72),
			artifactDateGroupLabel(localMs(2026, 8, 29), NOW),
			artifactDateGroupLabel(localMs(2026, 8, 28, 0), NOW),
			artifactDateGroupLabel(localMs(2026, 8, 26), NOW),
			artifactDateGroupLabel(localMs(2026, 8, 23), NOW),
			artifactDateGroupLabel(localMs(2026, 8, 22), NOW),
			artifactDateGroupLabel(localMs(2026, 5, 10), NOW),
			artifactDateGroupLabel(localMs(2026, 0, 1, 0), NOW),
			artifactDateGroupLabel(localMs(2025, 10, 3), NOW),
			artifactDateGroupLabel(localMs(2026, 9, 1), NOW),
		]).toStrictEqual([
			"Today",
			"Yesterday",
			"Sep 26",
			"Today",
			"Yesterday",
			"Sep 26",
			"Sep 23",
			"September",
			"June",
			"January",
			"November 2025",
			"Today",
		]);
	});

	it("buckets like upstream: days then months descending, each sorted newest first, untimed items last as Older", () => {
		const items = [
			{id: "a", lastPublishedAt: localMs(2026, 8, 26, 9), firstSeenAt: localMs(2026, 0, 1)},
			{id: "c", lastPublishedAt: null, firstSeenAt: localMs(2026, 8, 10)},
			{id: "e", lastPublishedAt: localMs(2025, 10, 3), firstSeenAt: localMs(2025, 10, 3)},
			{id: "u", lastPublishedAt: null, firstSeenAt: Number.NaN},
			{id: "b", lastPublishedAt: localMs(2026, 8, 26, 15), firstSeenAt: localMs(2026, 0, 1)},
			{id: "t", lastPublishedAt: localMs(2026, 8, 29, 8), firstSeenAt: localMs(2026, 0, 1)},
			{id: "d", lastPublishedAt: localMs(2026, 8, 12), firstSeenAt: localMs(2026, 8, 1)},
			{id: "y", lastPublishedAt: localMs(2026, 8, 28, 23), firstSeenAt: localMs(2026, 0, 1)},
			{id: "j", lastPublishedAt: localMs(2026, 5, 10), firstSeenAt: localMs(2026, 5, 10)},
		];

		expect(
			groupArtifactsByDate(items, NOW).map((group) => ({
				label: group.label,
				ids: group.items.map((item) => item.id),
			})),
		).toStrictEqual([
			{label: "Today", ids: ["t"]},
			{label: "Yesterday", ids: ["y"]},
			{label: "Sep 26", ids: ["b", "a"]},
			{label: "September", ids: ["d", "c"]},
			{label: "June", ids: ["j"]},
			{label: "November 2025", ids: ["e"]},
			{label: "Older", ids: ["u"]},
		]);
	});
});

describe("sortArtifacts", () => {
	const items = [
		{
			id: "opened-late",
			lastOpenedAt: localMs(2026, 8, 29, 9),
			lastPublishedAt: localMs(2026, 8, 1),
			firstSeenAt: 0,
		},
		{id: "edited-late", lastOpenedAt: null, lastPublishedAt: localMs(2026, 8, 28), firstSeenAt: 0},
		{id: "seen-only", lastOpenedAt: null, lastPublishedAt: null, firstSeenAt: localMs(2026, 8, 20)},
		{id: "opened-early", lastOpenedAt: localMs(2026, 8, 10), lastPublishedAt: localMs(2026, 8, 25), firstSeenAt: 0},
	];

	it("orders by Last opened (open, else publish, else first seen) or by Last edited (publish, else first seen)", () => {
		expect({
			opened: sortArtifacts(items, "opened").map((item) => item.id),
			edited: sortArtifacts(items, "edited").map((item) => item.id),
		}).toStrictEqual({
			opened: ["opened-late", "edited-late", "seen-only", "opened-early"],
			edited: ["edited-late", "opened-early", "seen-only", "opened-late"],
		});
	});
});

describe("applyArtifactFilters", () => {
	const items = [
		{
			id: "docs-mine-today",
			kind: "docs" as const,
			audience: "owner",
			lastOpenedAt: localMs(2026, 8, 29, 8),
			lastPublishedAt: null,
			firstSeenAt: 0,
			pinned: true,
		},
		{
			id: "html-shared-yesterday",
			kind: "html" as const,
			audience: "org",
			lastOpenedAt: localMs(2026, 8, 28, 8),
			lastPublishedAt: null,
			firstSeenAt: 0,
			pinned: false,
		},
		{
			id: "html-mine-week",
			kind: "html" as const,
			audience: "owner",
			lastOpenedAt: null,
			lastPublishedAt: localMs(2026, 8, 24),
			firstSeenAt: 0,
			pinned: false,
		},
		{
			id: "docs-shared-month",
			kind: "docs" as const,
			audience: null,
			lastOpenedAt: null,
			lastPublishedAt: null,
			firstSeenAt: localMs(2026, 8, 5),
			pinned: false,
		},
		{
			id: "html-old",
			kind: "html" as const,
			audience: "owner",
			lastOpenedAt: localMs(2026, 5, 1),
			lastPublishedAt: null,
			firstSeenAt: 0,
			pinned: false,
		},
	];
	const run = (filters: Partial<typeof NO_ARTIFACT_FILTERS>) =>
		applyArtifactFilters(
			items,
			{...NO_ARTIFACT_FILTERS, ...filters},
			{now: NOW, isPinned: (item) => item.pinned},
		).map((item) => item.id);

	it("narrows by type, owner, date opened, sharing and pinned, and counts each active pick", () => {
		expect({
			none: run({}),
			docs: run({types: ["docs"]}),
			other: run({types: ["other"]}),
			slides: run({types: ["slides"]}),
			mine: run({owners: ["me"]}),
			others: run({owners: ["others"]}),
			both: run({owners: ["me", "others"]}),
			today: run({opened: "today"}),
			yesterday: run({opened: "yesterday"}),
			week: run({opened: "week"}),
			month: run({opened: "month"}),
			private: run({sharing: "private"}),
			shared: run({sharing: "shared"}),
			pinned: run({pinned: true}),
			counts: [
				activeFilterCount(NO_ARTIFACT_FILTERS),
				activeFilterCount({...NO_ARTIFACT_FILTERS, types: ["docs", "other"], opened: "week", pinned: true}),
				activeFilterCount({...NO_ARTIFACT_FILTERS, owners: ["me"], sharing: "shared"}),
			],
		}).toStrictEqual({
			none: ["docs-mine-today", "html-shared-yesterday", "html-mine-week", "docs-shared-month", "html-old"],
			docs: ["docs-mine-today", "docs-shared-month"],
			other: ["html-shared-yesterday", "html-mine-week", "html-old"],
			slides: [],
			mine: ["docs-mine-today", "html-mine-week", "html-old"],
			others: ["html-shared-yesterday", "docs-shared-month"],
			both: ["docs-mine-today", "html-shared-yesterday", "html-mine-week", "docs-shared-month", "html-old"],
			today: ["docs-mine-today"],
			yesterday: ["html-shared-yesterday"],
			week: ["docs-mine-today", "html-shared-yesterday", "html-mine-week"],
			month: ["docs-mine-today", "html-shared-yesterday", "html-mine-week", "docs-shared-month"],
			private: ["docs-mine-today", "html-mine-week", "html-old"],
			shared: ["html-shared-yesterday", "docs-shared-month"],
			pinned: ["docs-mine-today"],
			counts: [0, 4, 2],
		});
	});
});

describe("formatArtifactRelative", () => {
	it("uses upstream's narrow RelativeTime within 48h and the absolute date after", () => {
		const now = new Date(2026, 9, 4, 10, 30, 0);
		const ago = (ms: number) => formatArtifactRelative(now.getTime() - ms, now);

		expect([
			ago(20 * 1000),
			ago(5 * 60 * 1000),
			ago(14 * 60 * 60 * 1000),
			ago(47 * 60 * 60 * 1000),
			ago(49 * 60 * 60 * 1000),
		]).toStrictEqual(["now", "5m ago", "14h ago", "47h ago", "Oct 2"]);
	});

	it("titles the time with the absolute date, time and zone, as upstream's RelativeTime tooltip", () => {
		const tz = process.env["TZ"];
		process.env["TZ"] = "America/New_York";
		try {
			expect(formatArtifactTooltip(Date.UTC(2026, 9, 3, 0, 19))).toBe("Oct 2, 2026, 8:19 PM EDT");
		} finally {
			process.env["TZ"] = tz;
		}
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
				icon: "chart",
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

	it("titles an artifact with neither a title nor a source path \u201cUntitled artifact\u201d, as upstream", () => {
		const db = openTestDb();
		db.index
			.insert(schema.artifacts)
			.values({
				url: "https://claude.ai/artifact/X57Wrq94uRBcVC499vkvKY",
				id: "X57Wrq94uRBcVC499vkvKY",
				urlKind: "slug",
				title: null,
				favicon: null,
				description: null,
				version: "1",
				projectId: "-Users-alice-projects-ladder",
				sourcePath: null,
				audience: "owner",
				firstSeenAt: localMs(2026, 8, 1),
				lastPublishedAt: null,
				publishCount: 0,
				lastSessionId: "session-untitled",
			})
			.run();

		expect(getArtifacts(db.index, {}, () => null).map((artifact) => artifact.title)).toStrictEqual([
			"Untitled artifact",
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
			docs: applyArtifactFilters(
				artifacts,
				{...NO_ARTIFACT_FILTERS, types: ["docs"]},
				{now: NOW, isPinned: () => false},
			).map((a) => a.id),
			html: applyArtifactFilters(
				artifacts.filter((a) => artifactMatchesSearch(a.title, "cash")),
				{...NO_ARTIFACT_FILTERS, types: ["other"]},
				{now: NOW, isPinned: () => false},
			).map((a) => a.id),
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

/** The gallery's own lists and rows, without the Make something new strip's tiles. */
function outsideStrip(elements: HTMLElement[]): HTMLElement[] {
	return elements.filter((element) => element.closest("[data-make-something-new]") === null);
}

const GALLERY_SECTION = "section:not([data-make-something-new])";

function galleryLists(): HTMLElement[] {
	return outsideStrip(screen.getAllByRole("list"));
}

function galleryRows(): HTMLElement[] {
	return outsideStrip(screen.getAllByRole("listitem"));
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

	it("lays the grid out with upstream's @container auto-fill template", async () => {
		storage.removeItem(ARTIFACTS_LAYOUT_STORAGE_KEY);
		await renderArtifactsPage("/artifacts", true);

		expect(document.querySelector("[data-gallery-card]")?.closest("ul")?.className).toBe(
			"grid @container gap-6 grid-cols-[repeat(auto-fill,minmax(min(100%,max(15rem,30%)),1fr))]",
		);
	});

	it("grows the whole card to 103% on hover and while its menu is open, on an r16 pressable whose frame keeps its fill", async () => {
		storage.removeItem(ARTIFACTS_LAYOUT_STORAGE_KEY);
		await renderArtifactsPage("/artifacts", true);
		const item = screen.getByRole("link", {name: "Quarterly plan"}).closest<HTMLElement>("li");
		if (item === null) throw new Error("no card");
		const missing = (element: Element | null | undefined, names: string[]) =>
			names.filter((name) => element?.classList.contains(name) !== true);
		const grows = item.querySelector("[data-card-grows]");
		const pressable = item.querySelector("[data-gallery-card]");
		const frame = item.querySelector("[data-card-frame]");

		expect({
			grows: missing(grows, [
				"group",
				"relative",
				"h-full",
				"transition-transform",
				"duration-200",
				"ease-[cubic-bezier(0.165,0.84,0.44,1)]",
				"motion-safe:hover:scale-[1.03]",
				"motion-safe:has-[[aria-expanded=true]]:scale-[1.03]",
			]),
			growsHoldsPressable: grows?.contains(pressable ?? null),
			pressable: missing(pressable, [
				"relative",
				"block",
				"w-full",
				"group/card",
				"transition-transform",
				"duration-[120ms]",
				"active:scale-[0.98]",
				"rounded-2xl",
				"h-full",
			]),
			link: missing(screen.getByRole("link", {name: "Quarterly plan"}), [
				"rounded-2xl",
				"focus-visible:shadow-focus",
			]),
			frame: missing(frame, ["rounded-2xl", "bg-surface-2", "overflow-hidden", "after:shadow-card-ring"]),
			frameStray: ["group-hover:bg-surface-1", "after:border", "rounded-r7"].filter((name) =>
				frame?.classList.contains(name),
			),
		}).toStrictEqual({
			grows: [],
			growsHoldsPressable: true,
			pressable: [],
			link: [],
			frame: [],
			frameStray: [],
		});
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

	it("seats More then Pin together top-right as upstream's blurred on-content buttons, revealed on hover, focus, open menu and touch", async () => {
		storage.removeItem(ARTIFACTS_LAYOUT_STORAGE_KEY);
		await renderArtifactsPage("/artifacts", true);
		const card = screen.getByRole("link", {name: "Quarterly plan"}).closest<HTMLElement>("li");
		if (card === null) throw new Error("no card");
		const actions = card.querySelector<HTMLElement>("[data-card-actions]");
		const missing = (element: Element | null | undefined, names: string[]) =>
			names.filter((name) => element?.classList.contains(name) !== true);
		const seats = [...(actions?.children ?? [])];
		const reveal = [
			"relative",
			"flex",
			"shrink-0",
			"opacity-0",
			"group-hover:opacity-100",
			"group-has-[:focus-visible]:opacity-100",
			"group-has-[[aria-expanded=true]]:opacity-100",
			"touch:opacity-100",
		];
		const paint = [
			"size-6",
			"backdrop-blur-md",
			"bg-button-on-content",
			"hover:bg-button-on-content-hover",
			"shadow-[inset_0_0_0_1px_var(--color-button-on-content-ring)]",
		];

		expect({
			actions: missing(actions, ["absolute", "z-10", "end-4", "top-4", "flex", "items-center", "gap-1"]),
			order: seats.map((seat) => seat.querySelector("button")?.getAttribute("aria-label")),
			seats: seats.map((seat) => missing(seat, reveal)),
			backings: seats.map((seat) => seat.querySelector(":scope > span[aria-hidden=true]")?.className ?? null),
			buttons: seats.map((seat) => missing(seat.querySelector("button"), paint)),
			pinAtRest: seats[1]?.getAttribute("data-pin-at-rest"),
			metaButtons: card.querySelectorAll("[data-card-meta] button").length,
		}).toStrictEqual({
			actions: [],
			order: ["More options for Quarterly plan", "Pin"],
			seats: [[], []],
			backings: [
				"absolute inset-0 rounded-[inherit] bg-surface-1 opacity-75",
				"absolute inset-0 rounded-[inherit] bg-surface-1 opacity-75",
			],
			buttons: [[], []],
			pinAtRest: "hidden",
			metaButtons: 0,
		});
	});

	it("draws upstream's tinted cover with a floating front sheet and a blank skeleton drawing per kind", async () => {
		storage.removeItem(ARTIFACTS_LAYOUT_STORAGE_KEY);
		await renderArtifactsPage("/artifacts", true);
		const cardFor = (name: string) => {
			const card = screen.getByRole("link", {name}).closest<HTMLElement>("li");
			if (card === null) throw new Error(`no card for ${name}`);
			return card;
		};
		const describeCard = (card: HTMLElement) => {
			const cover = card.querySelector<HTMLElement>("[data-card-preview] > [data-artifact-cover]");
			const front = cover?.querySelector("[data-cover-front]");
			const blank = front?.querySelector("svg[data-artifact-cover-blank]");
			return {
				preview: card.querySelector("[data-card-preview]")?.className,
				cover: cover?.getAttribute("data-artifact-cover"),
				hue: [...(cover?.classList ?? [])].filter((name) => /cds-(gray|blue)-/.test(name)),
				front: [...(front?.classList ?? [])].filter((name) => /^(h|w|top|rounded|shadow|z|border)-/.test(name)),
				blank: blank?.getAttribute("data-artifact-cover-blank"),
				viewBox: blank?.getAttribute("viewBox"),
				rects: blank?.querySelector("g")?.querySelectorAll("rect").length,
			};
		};

		expect({
			html: describeCard(cardFor("Asap Ladder Queue")),
			docs: describeCard(cardFor("Quarterly plan")),
		}).toStrictEqual({
			html: {
				preview: "relative h-[152px] shrink-0 select-none overflow-hidden",
				cover: "file",
				hue: ["bg-cds-gray-100", "text-cds-gray-600", "dark:bg-cds-gray-700", "dark:text-cds-gray-200"],
				front: [
					"border-[color:var(--color-border-line)]",
					"shadow-lg",
					"top-[30px]",
					"z-2",
					"rounded-xl",
					"h-[190px]",
					"w-[min(232px,100%-24px)]",
				],
				blank: "other",
				viewBox: "0 0 202 130",
				rects: 6,
			},
			docs: {
				preview: "relative h-[152px] shrink-0 select-none overflow-hidden",
				cover: "document",
				hue: ["bg-cds-blue-100", "text-cds-blue-600", "dark:bg-cds-blue-700", "dark:text-cds-blue-200"],
				front: [
					"border-[color:var(--color-border-line)]",
					"shadow-lg",
					"top-[30px]",
					"z-2",
					"rounded-xl",
					"h-[200px]",
					"w-[182px]",
				],
				blank: "document",
				viewBox: "0 0 180 130",
				rects: 6,
			},
		});
	});

	it("draws upstream's blank skeletons overflowing the sheet, with a fading sheen copy and pill text lines, under an eased bottom fade", async () => {
		storage.removeItem(ARTIFACTS_LAYOUT_STORAGE_KEY);
		await renderArtifactsPage("/artifacts", true);
		const coverFor = (name: string) => {
			const cover = screen
				.getByRole("link", {name})
				.closest("li")
				?.querySelector<HTMLElement>("[data-artifact-cover]");
			if (cover === null || cover === undefined) throw new Error(`no cover for ${name}`);
			return cover;
		};
		const describeBlank = (cover: HTMLElement) => {
			const blank = cover.querySelector("svg[data-artifact-cover-blank]");
			const gradient = blank?.querySelector("linearGradient");
			const groups = [...(blank?.querySelectorAll(":scope > g") ?? [])];
			return {
				className: blank?.getAttribute("class"),
				size: [blank?.getAttribute("width"), blank?.getAttribute("height")],
				gradient: {
					units: gradient?.getAttribute("gradientUnits"),
					x2: gradient?.getAttribute("x2"),
					stops: [...(gradient?.querySelectorAll("stop") ?? [])].map((stop) => [
						stop.getAttribute("offset"),
						stop.getAttribute("class"),
						stop.getAttribute("stop-opacity"),
					]),
				},
				groups: groups.map((group) => ({
					fill: group.getAttribute("fill") === `url(#${gradient?.id})` ? "sheen" : group.getAttribute("fill"),
					rx: [...group.querySelectorAll("rect")].map((rect) => rect.getAttribute("rx")),
				})),
			};
		};
		const describeFade = (cover: HTMLElement) => {
			const fade = cover.lastElementChild as HTMLElement | null;
			return {
				mask: fade?.style.maskImage,
				composite: fade?.style.maskComposite,
				children: [...(fade?.children ?? [])].map((child) => child.className),
			};
		};

		const other = describeBlank(coverFor("Asap Ladder Queue"));
		const doc = describeBlank(coverFor("Quarterly plan"));
		const ramp = [
			0, 0.013, 0.049, 0.104, 0.175, 0.259, 0.352, 0.45, 0.55, 0.648, 0.741, 0.825, 0.896, 0.951, 0.987, 1,
		]
			.map((step, index) => `rgb(0 0 0 / ${(step * 0.3).toFixed(3)}) ${(67 + index * 2.2).toFixed(1)}%`)
			.join(", ");
		const blankClass =
			"pointer-events-none absolute top-0 overflow-visible fill-current start-1/2 -translate-x-1/2 rtl:translate-x-1/2 text-[color:var(--skeleton-base)]";
		const sheen = {
			units: "userSpaceOnUse",
			stops: [
				["0", "[stop-color:currentColor]", null],
				["1", "[stop-color:currentColor]", "0"],
			],
		};
		expect({other, doc, fade: describeFade(coverFor("Asap Ladder Queue"))}).toStrictEqual({
			other: {
				className: blankClass,
				size: ["202", "130"],
				gradient: {...sheen, x2: "202"},
				groups: [
					{fill: null, rx: ["6", "6", "6", "6", "6", "6"]},
					{fill: "sheen", rx: ["6", "6", "6", "6", "6", "6"]},
				],
			},
			doc: {
				className: blankClass,
				size: ["180", "130"],
				gradient: {...sheen, x2: "180"},
				groups: [
					{fill: null, rx: ["5", "3", "2.5", "2.5", "2.5", "6"]},
					{fill: "sheen", rx: ["5", "3", "2.5", "2.5", "2.5", "6"]},
				],
			},
			fade: {
				mask: `linear-gradient(to bottom, transparent, ${ramp}), linear-gradient(to right, transparent, #000 12px, #000 calc(100% - 12px), transparent)`,
				composite: "intersect",
				children: ["absolute inset-0 bg-surface-2 opacity-40 dark:opacity-35"],
			},
		});
	});

	it("draws upstream's 72px mark row: a 40px ArtifactMark, a one-line title and the Opened meta with sr-only Private", async () => {
		storage.removeItem(ARTIFACTS_LAYOUT_STORAGE_KEY);
		await renderArtifactsPage("/artifacts", (db) => {
			seedArtifacts(db);
			db.index
				.update(schema.artifacts)
				.set({lastOpenedAt: Date.now() - 2 * 60 * 60 * 1000 - 60_000})
				.where(eq(schema.artifacts.url, LADDER_URL))
				.run();
		});
		const cardFor = (name: string) => {
			const card = screen.getByRole("link", {name}).closest<HTMLElement>("li");
			if (card === null) throw new Error(`no card for ${name}`);
			return card;
		};
		const describeCard = (card: HTMLElement) => {
			const mark = card.querySelector<HTMLElement>("[data-card-body] [data-artifact-mark]");
			return {
				body: card.querySelector("[data-card-body]")?.className,
				mark: mark?.getAttribute("data-artifact-mark"),
				markClass: mark?.className,
				markSize: mark?.getAttribute("data-artifact-mark-size"),
				glyph: mark?.querySelector("svg")?.getAttribute("class")?.includes("size-5"),
				words: card.querySelector("[data-artifact-mark-words]")?.className,
				title: card.querySelector("[data-card-title]")?.className,
				meta: card.querySelector("[data-card-meta]")?.textContent,
				lock: card.querySelector("[data-card-meta] svg") !== null,
				badge: card.querySelector("[data-card-badge]") !== null,
			};
		};
		const words = "flex min-w-0 flex-1 flex-col gap-0.5";
		const title = "min-w-0 truncate text-start text-body font-control leading-5 text-primary";
		const body = "relative flex min-h-18 flex-1 items-center gap-3 p-4";

		expect({
			opened: describeCard(cardFor("Asap Ladder Queue")),
			edited: describeCard(cardFor("Quarterly plan")),
			chart: describeCard(cardFor("household-cash.html")).meta,
		}).toStrictEqual({
			opened: {
				body,
				mark: "file",
				markClass:
					"flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-fill-secondary text-secondary",
				markSize: "card",
				glyph: true,
				words,
				title,
				meta: "Opened 2h agoPrivate",
				lock: false,
				badge: false,
			},
			edited: {
				body,
				mark: "document",
				markClass:
					"flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-upstream-tint-blue text-tint-blue-ink",
				markSize: "card",
				glyph: true,
				words,
				title,
				meta: expect.stringMatching(/^Edited Nov 3, 2025Private$/),
				lock: false,
				badge: false,
			},
			chart: expect.stringMatching(/^Edited Jun 10(, 2026)?$/),
		});
	});

	it("lists artifacts by date group linking out to claude.ai", async () => {
		await renderArtifactsPage("/artifacts", true);

		const groups = galleryLists().map((list) => ({
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

	function emptyStateSummary() {
		const heading = screen.getByRole("heading", {level: 3});
		const body = heading.nextElementSibling;
		return {
			container: heading.parentElement?.className,
			heading: {text: heading.textContent, className: heading.className},
			body: {tag: body?.tagName, text: body?.textContent, className: body?.className},
		};
	}

	it("shows upstream's left-aligned shared-tab EmptyState when nothing is shared with you", async () => {
		await renderArtifactsPage("/artifacts?tab=shared", (db) => {
			seedMixedGallery(db);
			db.index.delete(schema.artifacts).where(ne(schema.artifacts.audience, "owner")).run();
		});

		expect(emptyStateSummary()).toStrictEqual({
			container: "flex flex-col items-start gap-3 pb-12 text-start text-body",
			heading: {text: "No shared artifacts yet", className: "max-w-xs font-medium text-secondary"},
			body: {
				tag: "P",
				text: "When someone shares an artifact with you, it appears here.",
				className: "max-w-xs text-footnote text-secondary",
			},
		});
	});

	it("shows upstream's Yours-tab EmptyState (no CTA locally) when you have published nothing", async () => {
		await renderArtifactsPage("/artifacts?tab=mine", (db) => {
			seedMixedGallery(db);
			db.index.delete(schema.artifacts).where(eq(schema.artifacts.audience, "owner")).run();
		});

		expect({
			...emptyStateSummary(),
			buttons: screen.queryAllByRole("button", {name: "New artifact"}),
		}).toStrictEqual({
			container: "flex flex-col items-start gap-3 pb-12 text-start text-body",
			heading: {text: "Create your first artifact", className: "max-w-xs font-medium text-secondary"},
			body: {
				tag: "P",
				text: "Artifacts you build with Claude appear here.",
				className: "max-w-xs text-footnote text-secondary",
			},
			buttons: [],
		});
	});

	it("opens search from ?search= and announces the match count", async () => {
		await renderArtifactsPage("/artifacts?search=ladder", true);

		expect({
			input: screen.getByRole<HTMLInputElement>("searchbox", {name: "Search your artifacts"}).value,
			placeholder: screen.getByRole("searchbox").getAttribute("placeholder"),
			status: pageStatuses()[0],
			rows: galleryRows().map((row) => rowSummary(row).title),
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
			headings: outsideStrip(screen.queryAllByRole("heading", {level: 2})).length,
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
			await tooltipFor(screen.getByRole("button", {name: "Filter and sort"})),
			await tooltipFor(screen.getAllByRole("img", {name: "Private"})[0]!),
		]).toStrictEqual([
			{text: "Search your artifacts", keys: "⌘CommandF"},
			{text: "Grid view", keys: null},
			{text: "Filter and sort", keys: null},
			{text: "Private", keys: null},
		]);
	});

	it("shows the card's edited time as upstream's RelativeTime with the absolute time in a tooltip", async () => {
		storage.removeItem(ARTIFACTS_LAYOUT_STORAGE_KEY);
		await renderArtifactsPage("/artifacts", true);
		const card = screen.getByRole("link", {name: "Asap Ladder Queue"}).closest<HTMLElement>("li");
		const time = card?.querySelector<HTMLElement>("[data-artifact-meta] time");
		if (time === null || time === undefined) throw new Error("no time");

		fireEvent.pointerEnter(time);
		const tooltip = await screen.findByRole("tooltip");

		expect({cds: time.dataset["cds"], tooltip: tooltip.textContent}).toStrictEqual({
			cds: "RelativeTime",
			tooltip: formatArtifactTooltip(localMs(2026, 8, 26, 15)),
		});
	});

	it("expands and focuses the search on ⌘F", async () => {
		vi.spyOn(navigator, "userAgent", "get").mockReturnValue(MAC_USER_AGENT);
		await renderArtifactsPage("/artifacts", true);

		fireEvent.keyDown(document.body, {key: "f", code: "KeyF", metaKey: true});

		await waitFor(() => {
			expect(document.activeElement).toBe(screen.getByRole("searchbox", {name: "Search your artifacts"}));
		});
	});

	it("grows the toolbar to upstream's fizzy-lake panels 28px r8 controls on a fine pointer", async () => {
		storage.removeItem(ARTIFACTS_LAYOUT_STORAGE_KEY);
		await renderArtifactsPage("/artifacts", true);
		const panelsFine = (element: Element | null | undefined) =>
			(element?.className ?? "").split(" ").filter((name) => name.startsWith("panels-fine:"));
		const buttons = ["Search your artifacts", "Filter and sort", "List view"].map((name) =>
			panelsFine(screen.getByRole("button", {name})),
		);
		fireEvent.click(screen.getByRole("button", {name: "Search your artifacts"}));

		expect({
			buttons,
			field: panelsFine(screen.getByRole("search").querySelector("[data-cds=TextInput]")),
		}).toStrictEqual({
			buttons: Array.from({length: 3}, () => ["panels-fine:size-7", "panels-fine:rounded-r6"]),
			field: ["panels-fine:h-7", "panels-fine:rounded-r6"],
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
			return galleryRows()
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

	// Upstream's Artifacts view tabs are cds Tabs: abutting 28px tabs with a `::before` pill (r8, inset-x 1px).
	it("renders the view tabs as upstream's cds Tabs with the shared tab recipe", async () => {
		await renderArtifactsPage("/artifacts", seedMixedGallery);
		const tablist = screen.getByRole("tablist", {name: "Artifacts"});
		const recipe = [
			"h-7",
			"px-3",
			"text-body",
			"font-control",
			"text-ink-muted",
			"before:absolute",
			"before:rounded-r6",
			"data-[active]:text-primary",
			"data-[active]:before:bg-fill-ghost-hover",
			"focus-visible:before:shadow-focus",
		];
		const dropped = ["h-6", "text-[13px]", "rounded-md", "aria-selected:bg-fill-ghost-hover"];

		expect({
			root: tablist.closest('[data-cds="Tabs"]') !== null,
			list: ["gap-1", "font-sans"].filter((token) => tablist.classList.contains(token)),
			tabs: within(tablist)
				.getAllByRole("tab")
				.map((tab) => ({
					active: tab.hasAttribute("data-active"),
					recipe: recipe.filter((token) => !tab.classList.contains(token)),
					dropped: dropped.filter((token) => tab.classList.contains(token)),
				})),
		}).toStrictEqual({
			root: true,
			list: ["font-sans"],
			tabs: [
				{active: true, recipe: [], dropped: []},
				{active: false, recipe: [], dropped: []},
				{active: false, recipe: [], dropped: []},
			],
		});
	});

	it("opens on the tab named by ?tab=", async () => {
		await renderArtifactsPage("/artifacts?tab=shared", seedMixedGallery);

		expect({
			selected: screen.getByRole("tab", {selected: true}).textContent,
			rows: galleryRows().length,
		}).toStrictEqual({selected: "Shared with you", rows: 8});
	});

	it("still opens the tab named by the legacy ?view= param", async () => {
		await renderArtifactsPage("/artifacts?view=yours", seedMixedGallery);

		expect({
			selected: screen.getByRole("tab", {selected: true}).textContent,
			rows: galleryRows().length,
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

	it("orders the toolbar Search · Filter and sort · List view and names the trigger by its active filter count", async () => {
		storage.removeItem(ARTIFACTS_LAYOUT_STORAGE_KEY);
		const labels = () =>
			[...document.querySelectorAll("[data-cds-part=controls] button[aria-label]")].map((button) =>
				button.getAttribute("aria-label"),
			);
		await renderArtifactsPage("/artifacts", true);
		const resting = {labels: labels(), pressed: screen.getByRole("button", {name: "Filter and sort"}).ariaPressed};
		cleanup();
		await renderArtifactsPage("/artifacts?type=docs", true);
		const one = screen.getByRole("button", {name: "1 filter on"}).getAttribute("aria-pressed");
		cleanup();
		await renderArtifactsPage("/artifacts?type=docs,other&pinned=1", true);

		expect({
			resting,
			one,
			three: screen.getByRole("button", {name: "3 filters on"}).getAttribute("aria-pressed"),
		}).toStrictEqual({
			resting: {labels: ["Search your artifacts", "Filter and sort", "List view"], pressed: "false"},
			one: "true",
			three: "true",
		});
	});

	function menuRows(menu: HTMLElement) {
		return [
			...menu.querySelectorAll(
				"[role=menuitem], [role=menuitemcheckbox], [role=menuitemradio], [role=separator]",
			),
		]
			.filter((element) => element.closest("[role=menu]") === menu)
			.map((element) => {
				const role = element.getAttribute("role");
				if (role === "separator") return "──";
				const label = element.querySelector("[data-menu-sub-label]")?.textContent ?? element.textContent;
				const value = element.querySelector("[data-menu-value]")?.textContent;
				return value === undefined ? `${role}:${label}` : `${role}:${label}=${value}`;
			});
	}

	async function openSubmenu(menu: HTMLElement, label: string): Promise<HTMLElement> {
		const trigger = [...menu.querySelectorAll<HTMLElement>("[role=menuitem]")].find(
			(item) => item.querySelector("[data-menu-sub-label]")?.textContent === label,
		);
		if (trigger === undefined) throw new Error(`no ${label} submenu`);
		act(() => {
			trigger.focus();
		});
		fireEvent.keyDown(trigger, {key: "ArrowRight"});
		await waitFor(() => {
			expect(screen.getAllByRole("menu")).toHaveLength(2);
		});
		const submenu = screen.getAllByRole("menu").find((candidate) => candidate !== menu);
		if (submenu === undefined) throw new Error(`no ${label} submenu`);
		return submenu;
	}

	it("opens upstream's Filter and sort menu: Sort by · Owner · Type · Date opened · Sharing · Pinned", async () => {
		await renderArtifactsPage("/artifacts", seedMixedGallery);

		fireEvent.click(screen.getByRole("button", {name: "Filter and sort"}));
		const menu = await screen.findByRole("menu");

		expect(menuRows(menu)).toStrictEqual([
			"menuitem:Sort by=Last opened",
			"──",
			"menuitem:Owner=Anyone",
			"menuitem:Type=Any",
			"menuitem:Date opened=Any time",
			"menuitem:Sharing=Any",
			"──",
			"menuitemcheckbox:Pinned",
		]);
	});

	it("multi-picks types from checkbox rows with no chips and no 0 hint, keeping them in ?type=", async () => {
		const router = await renderArtifactsPage("/artifacts", seedMixedGallery);

		fireEvent.click(screen.getByRole("button", {name: "Filter and sort"}));
		const menu = await screen.findByRole("menu");
		const submenu = await openSubmenu(menu, "Type");
		const items = within(submenu).getAllByRole("menuitemcheckbox");
		const resting = {
			names: items.map((item) => item.textContent),
			hints: items.map((item) => item.querySelector("[data-menu-hint]")?.className ?? null),
			chips: submenu.querySelectorAll("[data-type-chip]").length,
			boxes: items.map((item) => item.querySelector("[data-cds-checkbox]") !== null),
		};

		fireEvent.click(within(submenu).getByRole("menuitemcheckbox", {name: "Docs2"}));
		await waitFor(() => {
			expect({...router.state.location.search}).toStrictEqual({type: "docs"});
		});
		fireEvent.click(within(submenu).getByRole("menuitemcheckbox", {name: "Slides"}));
		await waitFor(() => {
			expect({...router.state.location.search}).toStrictEqual({type: "docs,slides"});
		});
		const hint = "ms-3 max-w-[160px] shrink-0 truncate text-footnote tabular-nums text-ink-muted";

		expect({
			resting,
			typeValue: menuRows(menu).find((row) => row.startsWith("menuitem:Type=")),
			checked: within(submenu)
				.getAllByRole("menuitemcheckbox")
				.map((item) => item.getAttribute("aria-checked")),
		}).toStrictEqual({
			resting: {
				names: ["Dashboard", "Design", "Design System", "Docs2", "Slides", "Other14"],
				hints: [null, null, null, hint, null, hint],
				chips: 0,
				boxes: [true, true, true, true, true, true],
			},
			typeValue: "menuitem:Type=2 picked",
			checked: ["false", "false", "false", "true", "true", "false"],
		});
	});

	it("notes on the Yours tab that Owner lists only your own artifacts", async () => {
		await renderArtifactsPage("/artifacts?tab=mine", seedMixedGallery);

		fireEvent.click(screen.getByRole("button", {name: "Filter and sort"}));
		const submenu = await openSubmenu(await screen.findByRole("menu"), "Owner");

		expect({
			text: submenu.textContent,
			checkboxes: within(submenu).queryAllByRole("menuitemcheckbox").length,
		}).toStrictEqual({text: "This tab lists only your own artifacts.", checkboxes: 0});
	});

	it("filters by Date opened: Today hides a card last opened yesterday", async () => {
		const now = new Date();
		const yesterdayNoon = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 12).getTime();
		const seed = (db: AppDb) => {
			seedArtifacts(db);
			db.index
				.update(schema.artifacts)
				.set({lastOpenedAt: Date.now() - 1000})
				.where(eq(schema.artifacts.url, LADDER_URL))
				.run();
			db.index
				.update(schema.artifacts)
				.set({lastOpenedAt: yesterdayNoon})
				.where(eq(schema.artifacts.url, DOCS_URL))
				.run();
		};
		const router = await renderArtifactsPage("/artifacts", seed);

		fireEvent.click(screen.getByRole("button", {name: "Filter and sort"}));
		const submenu = await openSubmenu(await screen.findByRole("menu"), "Date opened");
		const options = within(submenu)
			.getAllByRole("menuitemradio")
			.map((item) => item.textContent);
		fireEvent.click(within(submenu).getByRole("menuitemradio", {name: "Today"}));
		await waitFor(() => {
			expect({...router.state.location.search}).toStrictEqual({opened: "today"});
		});

		expect({options, rows: galleryRows().map((row) => rowSummary(row).title)}).toStrictEqual({
			options: ["Any time", "Today", "Yesterday", "Past 7 days", "Past 30 days"],
			rows: ["Asap Ladder Queue"],
		});
	});

	it("sorts by Last opened by default and by Last edited from ?sort=edited or the Sort by radios, announcing the sort", async () => {
		storage.removeItem(ARTIFACTS_LAYOUT_STORAGE_KEY);
		const seed = (db: AppDb) => {
			seedArtifacts(db);
			db.index
				.update(schema.artifacts)
				.set({lastOpenedAt: Date.now() - 1000})
				.where(eq(schema.artifacts.url, DOCS_URL))
				.run();
		};
		const cards = () =>
			[...document.querySelectorAll("[data-gallery-card] a[data-primary]")].map((link) =>
				link.getAttribute("aria-label"),
			);
		await renderArtifactsPage("/artifacts?sort=edited", seed);
		const edited = cards();
		cleanup();
		const router = await renderArtifactsPage("/artifacts", seed);
		const opened = cards();

		fireEvent.click(screen.getByRole("button", {name: "Filter and sort"}));
		const submenu = await openSubmenu(await screen.findByRole("menu"), "Sort by");
		fireEvent.click(within(submenu).getByRole("menuitemradio", {name: "Last edited"}));
		await waitFor(() => {
			expect({...router.state.location.search}).toStrictEqual({sort: "edited"});
		});

		expect({edited, opened, picked: cards(), statuses: pageStatuses()}).toStrictEqual({
			edited: ["Asap Ladder Queue", "household-cash.html", "Quarterly plan"],
			opened: ["Quarterly plan", "Asap Ladder Queue", "household-cash.html"],
			picked: ["Asap Ladder Queue", "household-cash.html", "Quarterly plan"],
			statuses: ["Sorted by Last edited"],
		});
	});

	it("offers Clear filters only while a filter is on, in the menu and under the filter-empty text, and it resets the URL", async () => {
		await renderArtifactsPage("/artifacts", seedMixedGallery);
		fireEvent.click(screen.getByRole("button", {name: "Filter and sort"}));
		const resting = menuRows(await screen.findByRole("menu")).includes("menuitem:Clear filters");
		cleanup();

		const router = await renderArtifactsPage("/artifacts?tab=mine&type=slides&opened=week", seedMixedGallery);
		const emptyClear = screen.getByRole("button", {name: "Clear filters"}).tagName;
		fireEvent.click(screen.getByRole("button", {name: "2 filters on"}));
		const menu = await screen.findByRole("menu");
		const filtered = menuRows(menu).slice(-2);
		fireEvent.click(within(menu).getByRole("menuitem", {name: "Clear filters"}));

		await waitFor(() => {
			expect({...router.state.location.search}).toStrictEqual({tab: "mine"});
		});
		expect({resting, emptyClear, filtered}).toStrictEqual({
			resting: false,
			emptyClear: "BUTTON",
			filtered: ["──", "menuitem:Clear filters"],
		});
	});

	it("still reads a single legacy ?type= and drops it on Clear filters under the empty text", async () => {
		const router = await renderArtifactsPage("/artifacts?type=other", seedMixedGallery);
		const rows = galleryRows().length;

		cleanup();
		const emptyRouter = await renderArtifactsPage("/artifacts?type=slides", seedMixedGallery);
		fireEvent.click(screen.getByRole("button", {name: "Clear filters"}));

		await waitFor(() => {
			expect({...emptyRouter.state.location.search}).toStrictEqual({});
		});
		expect({rows, search: {...router.state.location.search}}).toStrictEqual({rows: 14, search: {type: "other"}});
	});

	it("draws upstream's filter-empty block: muted status copy over a secondary Clear filters button", async () => {
		await renderArtifactsPage("/artifacts?type=slides", seedMixedGallery);
		const status = screen.getByText("Nothing matches. Try clearing a filter.");
		const clear = screen.getByRole("button", {name: "Clear filters"});
		expect({
			status: [status.tagName, status.getAttribute("role"), status.className],
			block: status.parentElement?.className,
			clear: [clear.parentElement === status.parentElement, clear.className],
		}).toStrictEqual({
			status: ["SPAN", "status", ""],
			block: "mt-10 flex flex-col items-center gap-3 text-body text-muted-as-secondary",
			clear: [
				true,
				"inline-flex h-7 shrink-0 items-center justify-center rounded-r6 px-[9px] text-body text-primary bg-fill-secondary shadow-[inset_0_0_0_1px_var(--color-border),0_1px_2px_rgb(0_0_0/0.05)] transition-shadow hover:bg-fill-secondary-hover hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-focus",
			],
		});
	});

	it("shows upstream's empty text for a type with no artifacts and paints the pressed trigger", async () => {
		await renderArtifactsPage("/artifacts?type=slides", seedMixedGallery);

		const trigger = screen.getByRole("button", {name: "1 filter on"});
		expect({
			pressed: trigger.getAttribute("aria-pressed"),
			paint: ["aria-pressed:bg-upstream-accent-pressed", "aria-pressed:text-upstream-accent"].filter(
				(name) => !trigger.classList.contains(name),
			),
			icon: trigger.querySelector("svg")?.classList.contains("lucide-sliders-vertical"),
			statuses: pageStatuses(),
		}).toStrictEqual({
			pressed: "true",
			paint: [],
			icon: true,
			statuses: ["", "Nothing matches. Try clearing a filter."],
		});
	});

	function groupedTitles() {
		return galleryLists().map((list) => ({
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

		expect({menu, contextMenu}).toStrictEqual({menu: ["PinP", "Copy linkC"], contextMenu: ["PinP", "Copy linkC"]});
	});

	it("gives the card menu upstream's P / C keycaps, row hooks and 6px offset, and fires a row by its letter", async () => {
		const writeText = vi.fn<(text: string) => Promise<void>>(async (_text: string) => {});
		Object.defineProperty(navigator, "clipboard", {configurable: true, value: {writeText}});
		await renderArtifactsPage("/artifacts", true);

		const card = screen.getByRole("link", {name: "Asap Ladder Queue"}).closest<HTMLElement>("li")!;
		fireEvent.click(within(card).getByRole("button", {name: "More options for Asap Ladder Queue"}));
		const menu = await screen.findByRole("menu");
		const rows = screen.getAllByRole("menuitem").map((item) => ({
			row: item.getAttribute("data-artifact-row"),
			keys: item.getAttribute("aria-keyshortcuts"),
			cap: item.querySelector("kbd")?.textContent,
			capHidden: item.querySelector("kbd")?.closest(".pointer-coarse\\:hidden") !== null,
		}));
		const offset = menu.closest("[data-side-offset]")?.getAttribute("data-side-offset");
		fireEvent.keyDown(menu, {key: "c"});

		expect({
			rows,
			offset,
			toast: (await screen.findByText("Link copied to clipboard.")).textContent,
			copied: writeText.mock.calls,
		}).toStrictEqual({
			rows: [
				{row: "pin", keys: "p", cap: "P", capHidden: true},
				{row: "copy_link", keys: "c", cap: "C", capHidden: true},
			],
			offset: "6",
			toast: "Link copied to clipboard.",
			copied: [[LADDER_URL]],
		});
	});

	it("moves a pinned row under Pinned, stores it per browser and unpins from the hover button", async () => {
		await renderArtifactsPage("/artifacts", true);

		fireEvent.click(screen.getByRole("button", {name: "More options for Quarterly plan"}));
		fireEvent.click(await screen.findByRole("menuitem", {name: "Pin"}));

		await waitFor(() => {
			expect(galleryLists()).toHaveLength(3);
		});
		const pinned = {
			groups: groupedTitles(),
			stored: JSON.parse(storage.getItem(ARTIFACT_PIN_STORAGE_KEY) ?? "null"),
		};

		const unpin = within(screen.getByRole("link", {name: "Quarterly plan"}).closest<HTMLElement>("li")!).getByRole(
			"button",
			{name: "Unpin"},
		);
		const unpinIcon = {
			pin: unpin.querySelector("svg")?.classList.contains("lucide-pin"),
			fill: unpin.querySelector("svg")?.getAttribute("fill"),
		};
		fireEvent.click(unpin);

		expect({pinned, unpinIcon, unpinned: groupedTitles()}).toStrictEqual({
			unpinIcon: {pin: true, fill: "currentColor"},
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

	it("splits the grid into upstream's Pinned / Other artifacts sections only while something is pinned", async () => {
		storage.setItem(ARTIFACTS_LAYOUT_STORAGE_KEY, "grid");
		const gridSections = () => ({
			wrapper: document.querySelector(GALLERY_SECTION)?.parentElement?.className ?? null,
			sections: Array.from(document.querySelectorAll(GALLERY_SECTION)).map((section) => ({
				className: section.className,
				heading: section.querySelector("h2")?.className,
				label: section.querySelector("h2")?.textContent,
				cards: Array.from(section.querySelectorAll("[data-gallery-card]")).map((card) =>
					within(card as HTMLElement)
						.getAllByRole("link")[0]
						?.getAttribute("aria-label"),
				),
			})),
		});

		await renderArtifactsPage("/artifacts", true);
		const unpinned = {
			sections: gridSections(),
			headings: outsideStrip(screen.queryAllByRole("heading", {level: 2})).length,
		};
		cleanup();

		storage.setItem(ARTIFACT_PIN_STORAGE_KEY, JSON.stringify([DOCS_URL]));
		await renderArtifactsPage("/artifacts", true);

		const headingClass = "px-0 py-1 text-caption font-medium text-ink-muted";
		expect({unpinned, pinned: gridSections()}).toStrictEqual({
			unpinned: {sections: {wrapper: null, sections: []}, headings: 0},
			pinned: {
				wrapper: "flex flex-col gap-9",
				sections: [
					{
						className: "flex flex-col gap-2",
						heading: headingClass,
						label: "Pinned",
						cards: ["Quarterly plan"],
					},
					{
						className: "flex flex-col gap-2",
						heading: headingClass,
						label: "Other artifacts",
						cards: ["Asap Ladder Queue", "household-cash.html"],
					},
				],
			},
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

describe("Make something new strip", () => {
	beforeEach(() => {
		storage.removeItem(ARTIFACTS_LAYOUT_STORAGE_KEY);
	});

	it("shows upstream's four template tiles above the grid, each linking home with ?create=<slug>", async () => {
		await renderArtifactsPage("/artifacts", true);
		const strip = screen.getByRole("region", {name: "Make something new"});
		const links = within(strip).getAllByRole("link");

		expect({
			heading: within(strip).getByRole("heading", {level: 2}).className,
			links: links.map((link) => ({
				name: link.getAttribute("aria-label"),
				href: link.getAttribute("href"),
				label: link.textContent,
			})),
			description:
				screen.getByText(/^By Anthropic\. A document/).id === links[0]?.getAttribute("aria-describedby"),
			beforeGrid:
				strip.compareDocumentPosition(document.querySelector("[data-gallery-card]") ?? strip) &
				Node.DOCUMENT_POSITION_FOLLOWING,
		}).toStrictEqual({
			heading: "text-caption font-medium text-ink-muted",
			links: [
				{
					name: "Docs, New",
					href: "/?create=pages",
					label: "DocsNewBy Anthropic. A document your team reads, comments on and edits in place while Claude keeps it current.",
				},
				{name: "Slides, New", href: "/?create=slides", label: "SlidesNew"},
				{name: "Design, New", href: "/?create=design", label: "DesignNew"},
				{name: "Dashboard, Beta", href: "/?create=dashboard", label: "DashboardBeta"},
			],
			description: true,
			beforeGrid: Node.DOCUMENT_POSITION_FOLLOWING,
		});
	});

	it("draws upstream's solid hue tiles with a 12% grain, a 56px glyph and a 103% hover grow, and stays while searching", async () => {
		await renderArtifactsPage("/artifacts?search=zzz-no-match", true);
		const strip = screen.getByRole("region", {name: "Make something new"});
		const tiles = [...strip.querySelectorAll<HTMLElement>("[data-template-tile]")];
		const docs = tiles[0];

		expect({
			tile: docs?.className,
			hues: tiles.map((tile) => [...tile.classList].filter((name) => name.includes("cds-")).join(" ")),
			grain: docs?.querySelector("svg feTurbulence")?.closest("span")?.className,
			turbulence: ["type", "baseFrequency", "numOctaves", "seed"].map((name) =>
				docs?.querySelector("feTurbulence")?.getAttribute(name),
			),
			displacement: docs?.querySelector("feDisplacementMap")?.getAttribute("scale"),
			glyph: docs?.querySelector(":scope > span.relative > svg")?.getAttribute("class")?.includes("size-14"),
			link: strip.querySelector("a")?.classList.contains("duration-150"),
		}).toStrictEqual({
			tile: "relative flex h-24 w-34 items-center justify-center overflow-hidden rounded-composer transition-transform duration-200 ease-out motion-safe:group-hover:scale-[1.03] bg-cds-blue-100 text-cds-blue-600 dark:bg-cds-blue-700 dark:text-cds-blue-200",
			hues: [
				"bg-cds-blue-100 text-cds-blue-600 dark:bg-cds-blue-700 dark:text-cds-blue-200",
				"bg-cds-orange-100 text-cds-orange-600 dark:bg-cds-orange-700 dark:text-cds-orange-200",
				"bg-cds-violet-100 text-cds-violet-600 dark:bg-cds-violet-700 dark:text-cds-violet-200",
				"bg-cds-red-100 text-cds-red-600 dark:bg-cds-red-700 dark:text-cds-red-200",
			],
			grain: "pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit] opacity-[0.12]",
			turbulence: ["fractalNoise", "0.9", "2", "3"],
			displacement: "1.6",
			glyph: true,
			link: true,
		});
	});
});
