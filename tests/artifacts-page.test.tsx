// @vitest-environment jsdom

import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {eq, ne} from "drizzle-orm";
import
{
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	Outlet,
	RouterProvider,
} from "@tanstack/react-router";
import {act, cleanup, fireEvent, render, screen, waitFor, within} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, onTestFinished, vi} from "vite-plus/test";

import {artifactsQueryOptions, ArtifactListResponse, type ArtifactSummary} from "../src/lib/api/artifacts";
import
{
	ARTIFACTS_LAYOUT_STORAGE_KEY,
	ARTIFACTS_SORT_STORAGE_KEY,
	activeFilterCount,
	readArtifactsSort,
	writeArtifactsSort,
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
import {TEXT_INPUT_CLEAR_CLASS} from "../src/components/ui/text-input";
import {ARTIFACT_PIN_STORAGE_KEY} from "../src/lib/artifact-pins";
import {installLocalStorage} from "./fake-storage";

const NOW = new Date(2026, 8, 29, 12, 0, 0);

function localMs(year: number, monthIndex: number, day: number, hour = 10): number
{
	return new Date(year, monthIndex, day, hour, 0, 0).getTime();
}

describe("artifactDateGroupLabel", () =>
{
	it("uses upstream's buckets: Today, Yesterday, days within a week, then months this year, then month and year", () =>
	{
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

	it("buckets like upstream: days then months descending, each sorted newest first, untimed items last as Older", () =>
	{
		const items = [
			{
				id: "a",
				lastPublishedAt: localMs(2026, 8, 26, 9),
				firstSeenAt: localMs(2026, 0, 1),
			},
			{
				id: "c",
				lastPublishedAt: null,
				firstSeenAt: localMs(2026, 8, 10),
			},
			{
				id: "e",
				lastPublishedAt: localMs(2025, 10, 3),
				firstSeenAt: localMs(2025, 10, 3),
			},
			{
				id: "u",
				lastPublishedAt: null,
				firstSeenAt: Number.NaN,
			},
			{
				id: "b",
				lastPublishedAt: localMs(2026, 8, 26, 15),
				firstSeenAt: localMs(2026, 0, 1),
			},
			{
				id: "t",
				lastPublishedAt: localMs(2026, 8, 29, 8),
				firstSeenAt: localMs(2026, 0, 1),
			},
			{
				id: "d",
				lastPublishedAt: localMs(2026, 8, 12),
				firstSeenAt: localMs(2026, 8, 1),
			},
			{
				id: "y",
				lastPublishedAt: localMs(2026, 8, 28, 23),
				firstSeenAt: localMs(2026, 0, 1),
			},
			{
				id: "j",
				lastPublishedAt: localMs(2026, 5, 10),
				firstSeenAt: localMs(2026, 5, 10),
			},
		];

		expect(
			groupArtifactsByDate(items, NOW).map((group) => (
			{
				label: group.label,
				ids: group.items.map((item) => item.id),
			})),
		).toStrictEqual([
			{
				label: "Today",
				ids: ["t"],
			},
			{
				label: "Yesterday",
				ids: ["y"],
			},
			{
				label: "Sep 26",
				ids: ["b", "a"],
			},
			{
				label: "September",
				ids: ["d", "c"],
			},
			{
				label: "June",
				ids: ["j"],
			},
			{
				label: "November 2025",
				ids: ["e"],
			},
			{
				label: "Older",
				ids: ["u"],
			},
		]);
	});
});

describe("sortArtifacts", () =>
{
	const items = [
		{
			id: "opened-late",
			lastOpenedAt: localMs(2026, 8, 29, 9),
			lastPublishedAt: localMs(2026, 8, 1),
			firstSeenAt: 0,
		},
		{
			id: "edited-late",
			lastOpenedAt: null,
			lastPublishedAt: localMs(2026, 8, 28),
			firstSeenAt: 0,
		},
		{
			id: "seen-only",
			lastOpenedAt: null,
			lastPublishedAt: null,
			firstSeenAt: localMs(2026, 8, 20),
		},
		{
			id: "opened-early",
			lastOpenedAt: localMs(2026, 8, 10),
			lastPublishedAt: localMs(2026, 8, 25),
			firstSeenAt: 0,
		},
	];

	it("orders by Last opened (open, else publish, else first seen) or by Last edited (publish, else first seen)", () =>
	{
		expect(
			{
				opened: sortArtifacts(items, "opened").map((item) => item.id),
				edited: sortArtifacts(items, "edited").map((item) => item.id),
			},
		).toStrictEqual(
			{
				opened: ["opened-late", "edited-late", "seen-only", "opened-early"],
				edited: ["edited-late", "opened-early", "seen-only", "opened-late"],
			},
		);
	});
});

describe("stored artifacts sort", () =>
{
	function readWith(raw: string | null)
	{
		if (raw === null) storage.removeItem(ARTIFACTS_SORT_STORAGE_KEY);
		else storage.setItem(ARTIFACTS_SORT_STORAGE_KEY, raw);
		return readArtifactsSort();
	}

	it("reads upstream's bare value or its {value,tabId,timestamp} envelope, ignores garbage, and stores Last opened instead of removing it", () =>
	{
		const reads =
		{
			absent: readWith(null),
			bare: readWith("edited"),
			envelope: readWith(
				JSON.stringify(
					{
						value: "edited",
						tabId: "",
						timestamp: 1,
					},
				),
			),
			openedEnvelope: readWith('{"value":"opened"}'),
			unknown: readWith("foo"),
			badEnvelope: readWith('{"value":"foo"}'),
			garbage: readWith("{not json"),
		};
		writeArtifactsSort("edited");
		const afterEdited = storage.getItem(ARTIFACTS_SORT_STORAGE_KEY);
		writeArtifactsSort("opened");
		const afterOpened = storage.getItem(ARTIFACTS_SORT_STORAGE_KEY);
		vi.spyOn(storage, "getItem").mockImplementation(() =>
		{
			throw new Error("denied");
		});

		expect(
			{
				reads,
				afterEdited,
				afterOpened,
				throwing: readArtifactsSort(),
			},
		).toStrictEqual(
			{
				reads:
				{
					absent: undefined,
					bare: "edited",
					envelope: "edited",
					openedEnvelope: "opened",
					unknown: undefined,
					badEnvelope: undefined,
					garbage: undefined,
				},
				afterEdited: "edited",
				afterOpened: "opened",
				throwing: undefined,
			},
		);
	});
});

describe("applyArtifactFilters", () =>
{
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
			{
				...NO_ARTIFACT_FILTERS,
				...filters,
			},
			{
				now: NOW,
				isPinned: (item) => item.pinned,
			},
		).map((item) => item.id);

	it("narrows by type, owner, date opened, sharing and pinned, and counts each active pick", () =>
	{
		expect(
			{
				none: run({}),
				docs: run(
					{
						types: ["docs"],
					},
				),
				other: run(
					{
						types: ["other"],
					},
				),
				slides: run(
					{
						types: ["slides"],
					},
				),
				mine: run(
					{
						owners: ["me"],
					},
				),
				others: run(
					{
						owners: ["others"],
					},
				),
				both: run(
					{
						owners: ["me", "others"],
					},
				),
				today: run(
					{
						opened: "today",
					},
				),
				yesterday: run(
					{
						opened: "yesterday",
					},
				),
				week: run(
					{
						opened: "week",
					},
				),
				month: run(
					{
						opened: "month",
					},
				),
				private: run(
					{
						sharing: "private",
					},
				),
				shared: run(
					{
						sharing: "shared",
					},
				),
				pinned: run(
					{
						pinned: true,
					},
				),
				counts: [
					activeFilterCount(NO_ARTIFACT_FILTERS),
					activeFilterCount(
						{
							...NO_ARTIFACT_FILTERS,
							types: ["docs", "other"],
							opened: "week",
							pinned: true,
						},
					),
					activeFilterCount(
						{
							...NO_ARTIFACT_FILTERS,
							owners: ["me"],
							sharing: "shared",
						},
					),
				],
			},
		).toStrictEqual(
			{
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
			},
		);
	});
});

describe("formatArtifactRelative", () =>
{
	it("uses upstream's narrow RelativeTime within 48h and the absolute date after", () =>
	{
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

	it("titles the time with the absolute date, time and zone, as upstream's RelativeTime tooltip", () =>
	{
		const tz = process.env["TZ"];
		process.env["TZ"] = "America/New_York";
		try
		{
			expect(formatArtifactTooltip(Date.UTC(2026, 9, 3, 0, 19))).toBe("Oct 2, 2026, 8:19 PM EDT");
		}
		finally
		{
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

function ladderMtime(path: string): number | null
{
	return path === LADDER_SOURCE ? LADDER_MTIME : null;
}

function seedArtifacts(db: AppDb): void
{
	const base =
	{
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
/** seedArtifacts with Quarterly plan opened just now, so Last opened and Last edited order the cards differently. */
function seedDocsOpenedRecently(db: AppDb): void
{
	seedArtifacts(db);
	db.index
		.update(schema.artifacts)
		.set(
			{
				lastOpenedAt: Date.now() - 1000,
			},
		)
		.where(eq(schema.artifacts.url, DOCS_URL))
		.run();
}

/** The grid's card titles in order. */
function cards(): Array<string | null>
{
	return [...document.querySelectorAll("[data-gallery-card] a[data-primary]")].map((link) =>
		link.getAttribute("aria-label"),
	);
}

function seedMixedGallery(db: AppDb): void
{
	db.index
		.insert(schema.artifacts)
		.values(
			Array.from(
				{
					length: 16,
				},
				(_, index) =>
				{
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
				},
			),
		)
		.run();
}

describe("getArtifacts", () =>
{
	it("lists artifacts newest first with a title fallback and whether the source still exists", () =>
	{
		const db = openTestDb();
		seedArtifacts(db);

		// The chart's source is gone but its thumbnail outlived it; Docs never get one yet.
		const artifacts = getArtifacts(
			db.index,
			{},
			ladderMtime,
			new Map([
				[
					"17b8a2c1-4c41-46bf-b064-a272240be709",
					{
						version: 1_780_000_000_000,
						capture: 1,
					},
				],
				[
					"7Hq2vXbN4pLmKcR9sTwYzA",
					{
						version: 1_780_000_000_000,
						capture: 2,
					},
				],
			]),
		);

		expect(
			artifacts.map(({id, title, kind, sourceExists, sourceModifiedAt, thumbnailUrl, sessionId}) => (
			{
				id,
				title,
				kind,
				sourceExists,
				sourceModifiedAt,
				thumbnailUrl,
				sessionId,
			})),
		).toStrictEqual([
			{
				id: "546d3910-4e9a-4730-9e91-62742a47c7c6",
				title: "Asap Ladder Queue",
				kind: "html",
				sourceExists: true,
				sourceModifiedAt: LADDER_MTIME,
				thumbnailUrl: `/api/artifacts/546d3910-4e9a-4730-9e91-62742a47c7c6/thumbnail?v=${LADDER_MTIME}&c=2`,
				sessionId: "session-ladder",
			},
			{
				id: "17b8a2c1-4c41-46bf-b064-a272240be709",
				title: "household-cash.html",
				kind: "html",
				sourceExists: false,
				sourceModifiedAt: null,
				thumbnailUrl: "/api/artifacts/17b8a2c1-4c41-46bf-b064-a272240be709/thumbnail?v=1780000000000&c=1",
				sessionId: "session-chart",
			},
			{
				id: "7Hq2vXbN4pLmKcR9sTwYzA",
				title: "Quarterly plan",
				kind: "docs",
				sourceExists: false,
				sourceModifiedAt: null,
				thumbnailUrl: null,
				sessionId: "session-docs",
			},
		]);

		expect(
			getArtifacts(db.index, {}, () => null, new Map()).map((artifact) => artifact.thumbnailUrl),
		).toStrictEqual([null, null, null]);
	});

	it("titles an artifact with neither a title nor a source path \u201cUntitled artifact\u201d, as upstream", () =>
	{
		const db = openTestDb();
		db.index
			.insert(schema.artifacts)
			.values(
				{
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
				},
			)
			.run();

		expect(getArtifacts(db.index, {}, () => null).map((artifact) => artifact.title)).toStrictEqual([
			"Untitled artifact",
		]);
	});

	it("filters by title, ignoring case", () =>
	{
		const db = openTestDb();
		seedArtifacts(db);

		expect(
			getArtifacts(
				db.index,
				{
					q: "LADDER",
				},
				() => null,
			).map((a) => a.id),
		).toStrictEqual(["546d3910-4e9a-4730-9e91-62742a47c7c6"]);
	});

	it("filters by type on the client", () =>
	{
		const db = openTestDb();
		seedArtifacts(db);
		const artifacts = getArtifacts(db.index, {}, () => null);

		expect(
			{
				docs: applyArtifactFilters(
					artifacts,
					{
						...NO_ARTIFACT_FILTERS,
						types: ["docs"],
					},
					{
						now: NOW,
						isPinned: () => false,
					},
				).map((a) => a.id),
				html: applyArtifactFilters(
					artifacts.filter((a) => artifactMatchesSearch(a.title, "cash")),
					{
						...NO_ARTIFACT_FILTERS,
						types: ["other"],
					},
					{
						now: NOW,
						isPinned: () => false,
					},
				).map((a) => a.id),
			},
		).toStrictEqual(
			{
				docs: ["7Hq2vXbN4pLmKcR9sTwYzA"],
				html: ["17b8a2c1-4c41-46bf-b064-a272240be709"],
			},
		);
	});
});

let storage: ReturnType<typeof installLocalStorage>;

beforeEach(() =>
{
	storage = installLocalStorage();
});

afterEach(() =>
{
	cleanup();
	vi.restoreAllMocks();
});

const MAC_USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";

/** Covers draw blanks unless a test names thumbnails: jsdom never loads them, and most tests read the blank. */
async function renderArtifactsPage(
	initialEntry: string,
	seed: boolean | ((db: AppDb) => void),
	thumbnailFor: (artifact: ArtifactSummary) => string | null = () => null,
)
{
	const db = openTestDb();
	if (seed === true) seedArtifacts(db);
	else if (typeof seed === "function") seed(db);
	const data = ArtifactListResponse.parse(
		JSON.parse(JSON.stringify(getArtifacts(db.index, {}, ladderMtime, new Map()))),
	).map((artifact) => (
	{
		...artifact,
		thumbnailUrl: thumbnailFor(artifact),
	}));

	const queryClient = new QueryClient(
		{
			defaultOptions:
			{
				queries:
				{
					retry: false,
					staleTime: Infinity,
				},
			},
		},
	);
	queryClient.setQueryData(artifactsQueryOptions.queryKey, data);

	const rootRoute = createRootRoute(
		{
			component: () => (
				<QueryClientProvider client={queryClient}>
					<ToastProvider>
						<Outlet />
					</ToastProvider>
				</QueryClientProvider>
			),
		},
	);
	const {validateSearch, component} = ArtifactsRoute.options;
	const artifactsRoute = createRoute(
		{
			getParentRoute: () => rootRoute,
			path: "/artifacts",
			...(validateSearch
				?
					{
						validateSearch,
					}
				: {}),
			...(component
				?
					{
						component,
					}
				: {}),
		},
	);
	const router = createRouter(
		{
			routeTree: rootRoute.addChildren([artifactsRoute]),
			history: createMemoryHistory(
				{
					initialEntries: [initialEntry],
				},
			),
		},
	);
	await router.load();
	render(<RouterProvider router={router} />);
	await screen.findByRole(
		"heading",
		{
			level: 1,
			name: "Artifacts",
		},
	);
	return router;
}

/** The gallery's own lists and rows, without the Make something new strip's tiles. */
function outsideStrip(elements: HTMLElement[]): HTMLElement[]
{
	return elements.filter((element) => element.closest("[data-make-something-new]") === null);
}

const GALLERY_SECTION = "section:not([data-make-something-new])";

function galleryLists(): HTMLElement[]
{
	return outsideStrip(screen.getAllByRole("list"));
}

function galleryRows(): HTMLElement[]
{
	return outsideStrip(screen.getAllByRole("listitem"));
}

/** The page's own live statuses, without the toast region. */
function pageStatuses()
{
	return screen
		.getAllByRole("status")
		.filter((status) => !status.hasAttribute("aria-live"))
		.map((status) => status.textContent);
}

function rowSummary(row: HTMLElement)
{
	const primary = row.querySelector("a[data-primary]");
	return {
		title: primary?.getAttribute("aria-label"),
		href: primary?.getAttribute("href"),
		target: primary?.getAttribute("target"),
		rel: primary?.getAttribute("rel"),
		chips: within(row)
			.queryAllByRole("link")
			.filter((link) => !link.hasAttribute("data-primary"))
			.map((link) => (
			{
				name: link.textContent,
				href: link.getAttribute("href"),
			})),
		private:
			within(row).queryByRole(
				"img",
				{
					name: "Private",
				},
			) !== null,
		meta: row.querySelector("[data-artifact-meta]")?.textContent,
	};
}

describe("artifacts route", () =>
{
	beforeEach(() =>
	{
		// These tests read the date-grouped list; the default layout is upstream's grid.
		storage.setItem(ARTIFACTS_LAYOUT_STORAGE_KEY, "list");
	});

	it("defaults to upstream's grid of cards when no layout was ever chosen", async () =>
	{
		storage.removeItem(ARTIFACTS_LAYOUT_STORAGE_KEY);
		await renderArtifactsPage("/artifacts", true);

		expect(
			{
				toggle: screen.getByRole(
					"button",
					{
						name: "List view",
					},
				).tagName,
				cards: document.querySelectorAll("[data-gallery-card]").length,
			},
		).toStrictEqual(
			{
				toggle: "BUTTON",
				cards: 3,
			},
		);
	});

	it("sizes the content as upstream's `mx-auto w-full px-md md:px-8 max-w-5xl` box inside a gutter-less route, so the grid is 960px at desktop", async () =>
	{
		await renderArtifactsPage("/artifacts", true);
		const page = document.body.firstElementChild?.firstElementChild;
		const band = page?.querySelector(":scope > .sticky");

		expect(
			{
				gutter: ArtifactsRoute.options.staticData?.pageGutter,
				page: page?.className,
				cds: [page?.getAttribute("data-cds"), page?.getAttribute("data-width")],
				grounds: page?.querySelectorAll(':scope > .sticky > [data-cds-part="page-header-ground"]').length,
				parts: [...(page?.children ?? [])].map((child) => child.className),
				headerBox: band?.firstElementChild?.className,
			},
		).toStrictEqual(
			{
				gutter: "none",
				page: "flex w-full flex-col",
				// Upstream cds Page's marker, which scopes the page-header-ground CSS.
				cds: ["Page", "content"],
				grounds: 1,
				// px-md is 8px (README pad-md); local spacing has no md token, so px-2.
				parts: [
					"h-0 -mt-9 max-sm:-mt-12",
					"pointer-events-none shrink-0",
					"pointer-events-none max-w-full shrink-0",
					"sticky top-0",
					"mx-auto w-full px-md md:px-8 max-w-5xl flex flex-col pb-12 pt-1",
				],
				headerBox: "mx-auto w-full px-md md:px-8 max-w-5xl pt-9 max-sm:pt-12 md:pt-0 pb-6 md:pb-2",
			},
		);
	});

	it("pads the header pb-2 from md and swaps the content's pt-1 for upstream's contentGap lg pt-5 once the title travels away on desktop", async () =>
	{
		vi.stubGlobal(
			"ResizeObserver",
			class
			{
				observe(): void
				{
				}
				disconnect(): void
				{
				}
			},
		);
		vi.stubGlobal("matchMedia", (query: string) => (
		{
			matches: query === "(min-width: 48rem)",
			addEventListener: () =>
			{
			},
			removeEventListener: () =>
			{
			},
		}));
		const rects = vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element)
		{
			const top = ["tabs-row", "controls"].includes(this.getAttribute("data-cds-part") ?? "") ? 88 : 0;
			return {
				top,
				left: 60,
				width: 300,
				height: 32,
				right: 360,
				bottom: top + 32,
				x: 60,
				y: top,
			} as DOMRect;
		});
		try
		{
			await renderArtifactsPage("/artifacts", true);
			const page = document.body.firstElementChild?.firstElementChild;
			const band = page?.querySelector<HTMLElement>(":scope > .sticky");
			expect(
				{
					top: band?.style.top,
					headerBox: band?.firstElementChild?.className,
					content: page?.lastElementChild?.className,
				},
			).toStrictEqual(
				{
					top: "-80px",
					headerBox: "mx-auto w-full px-md md:px-8 max-w-5xl pt-9 max-sm:pt-12 md:pt-0 pb-6 md:pb-2",
					content: "mx-auto w-full px-md md:px-8 max-w-5xl flex flex-col pb-12 pt-5",
				},
			);
		}
		finally
		{
			vi.unstubAllGlobals();
			rects.mockRestore();
		}
	});

	it("lays the grid out with upstream's @container auto-fill template", async () =>
	{
		storage.removeItem(ARTIFACTS_LAYOUT_STORAGE_KEY);
		await renderArtifactsPage("/artifacts", true);

		expect(document.querySelector("[data-gallery-card]")?.closest("ul")?.className).toBe(
			"grid @container gap-6 grid-cols-[repeat(auto-fill,minmax(min(100%,max(15rem,30%)),1fr))]",
		);
	});

	it("grows the whole card to 103% on hover and while its menu is open, on an r16 pressable whose frame keeps its fill", async () =>
	{
		storage.removeItem(ARTIFACTS_LAYOUT_STORAGE_KEY);
		await renderArtifactsPage("/artifacts", true);
		const item = screen
			.getByRole(
				"link",
				{
					name: "Quarterly plan",
				},
			)
			.closest<HTMLElement>("li");
		if (item === null) throw new Error("no card");
		const missing = (element: Element | null | undefined, names: string[]) =>
			names.filter((name) => element?.classList.contains(name) !== true);
		const grows = item.querySelector("[data-card-grows]");
		const pressable = item.querySelector("[data-gallery-card]");
		const frame = item.querySelector("[data-card-frame]");

		expect(
			{
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
				link: missing(
					screen.getByRole(
						"link",
						{
							name: "Quarterly plan",
						},
					),
					["rounded-2xl", "focus-visible:shadow-focus"],
				),
				frame: missing(frame, ["rounded-2xl", "bg-surface-2", "overflow-hidden", "after:shadow-card-ring"]),
				frameStray: ["group-hover:bg-surface-1", "after:border", "rounded-r7"].filter((name) =>
					frame?.classList.contains(name),
				),
			},
		).toStrictEqual(
			{
				grows: [],
				growsHoldsPressable: true,
				pressable: [],
				link: [],
				frame: [],
				frameStray: [],
			},
		);
	});

	it("rings grid cards instead of bordering them and lets them size to their content, as upstream", async () =>
	{
		storage.removeItem(ARTIFACTS_LAYOUT_STORAGE_KEY);
		await renderArtifactsPage("/artifacts", true);
		const frame = document.querySelector<HTMLElement>("[data-gallery-card] [data-card-frame]");
		if (frame === null) throw new Error("no card frame");
		const names = frame.className.split(" ");

		expect(
			{
				minHeight: names.some((name) => name.startsWith("min-h-")),
				border: names.includes("border"),
			},
		).toStrictEqual(
			{
				minHeight: false,
				border: false,
			},
		);
	});

	it("seats More then Pin together top-right as upstream's blurred on-content buttons, revealed on hover, focus, open menu and touch", async () =>
	{
		storage.removeItem(ARTIFACTS_LAYOUT_STORAGE_KEY);
		await renderArtifactsPage("/artifacts", true);
		const card = screen
			.getByRole(
				"link",
				{
					name: "Quarterly plan",
				},
			)
			.closest<HTMLElement>("li");
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

		expect(
			{
				actions: missing(actions, ["absolute", "z-10", "end-4", "top-4", "flex", "items-center", "gap-1"]),
				order: seats.map((seat) => seat.querySelector("button")?.getAttribute("aria-label")),
				seats: seats.map((seat) => missing(seat, reveal)),
				backings: seats.map((seat) => seat.querySelector(":scope > span[aria-hidden=true]")?.className ?? null),
				buttons: seats.map((seat) => missing(seat.querySelector("button"), paint)),
				pinAtRest: seats[1]?.getAttribute("data-pin-at-rest"),
				metaButtons: card.querySelectorAll("[data-card-meta] button").length,
			},
		).toStrictEqual(
			{
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
			},
		);
	});

	it("draws upstream's tinted cover with a floating front sheet and a blank skeleton drawing per kind", async () =>
	{
		storage.removeItem(ARTIFACTS_LAYOUT_STORAGE_KEY);
		await renderArtifactsPage("/artifacts", true);
		const cardFor = (name: string) =>
		{
			const card = screen
				.getByRole(
					"link",
					{
						name,
					},
				)
				.closest<HTMLElement>("li");
			if (card === null) throw new Error(`no card for ${name}`);
			return card;
		};
		const describeCard = (card: HTMLElement) =>
		{
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

		expect(
			{
				html: describeCard(cardFor("Asap Ladder Queue")),
				docs: describeCard(cardFor("Quarterly plan")),
			},
		).toStrictEqual(
			{
				html:
				{
					preview: "relative select-none overflow-hidden aspect-[2/1]",
					cover: "file",
					hue: ["bg-cds-gray-100", "text-cds-gray-600", "dark:bg-cds-gray-700", "dark:text-cds-gray-200"],
					front: [
						"border-[color:var(--color-border-line)]",
						"top-[20%]",
						"h-full",
						"w-[76%]",
						"z-2",
						"rounded-lg",
					],
					blank: "other",
					viewBox: "0 0 202 130",
					rects: 6,
				},
				docs:
				{
					preview: "relative select-none overflow-hidden aspect-[2/1]",
					cover: "document",
					hue: ["bg-cds-blue-100", "text-cds-blue-600", "dark:bg-cds-blue-700", "dark:text-cds-blue-200"],
					front: [
						"border-[color:var(--color-border-line)]",
						"top-[20%]",
						"h-full",
						"w-[76%]",
						"z-2",
						"rounded-lg",
					],
					blank: "document",
					viewBox: "0 0 180 130",
					rects: 6,
				},
			},
		);
	});

	it("leans upstream's Docs back sheet behind the front with no crayon doodle; file covers get no back sheet", async () =>
	{
		storage.removeItem(ARTIFACTS_LAYOUT_STORAGE_KEY);
		await renderArtifactsPage("/artifacts", true);
		const coverFor = (name: string) =>
		{
			const cover = screen
				.getByRole(
					"link",
					{
						name,
					},
				)
				.closest("li")
				?.querySelector<HTMLElement>("[data-artifact-cover]");
			if (cover === null || cover === undefined) throw new Error(`no cover for ${name}`);
			return cover;
		};
		const describeCover = (cover: HTMLElement) =>
		{
			const back = cover.querySelector(":scope > [data-cover-back]");
			const doodle = cover.querySelector(":scope > span");
			return {
				layers: [...cover.children].map((child) =>
					child.hasAttribute("data-cover-back")
						? "back"
						: child.hasAttribute("data-cover-front")
							? "front"
							: child.tagName === "SPAN"
								? "doodle"
								: child.classList.contains("h-px")
									? "hairline"
									: child.hasAttribute("data-cover-veil")
										? "veil"
										: child.classList.contains("dark:hidden")
											? "ground"
											: "wash",
				),
				back: back && [back.getAttribute("dir"), back.getAttribute("class"), back.childElementCount],
				doodle: doodle && [doodle.getAttribute("class"), doodle.querySelectorAll("g > path").length],
			};
		};

		expect(
			{
				docs: describeCover(coverFor("Quarterly plan")),
				html: describeCover(coverFor("Asap Ladder Queue")),
			},
		).toStrictEqual(
			{
				docs:
				{
					layers: ["wash", "ground", "veil", "back", "front", "hairline"],
					back: [
						"ltr",
						"absolute overflow-hidden border border-[color:var(--color-border-line)] bg-white text-primary dark:bg-surface-1 dark:bg-clip-padding after:pointer-events-none after:absolute after:inset-0 after:content-[''] start-[14.15%] top-[11.76%] h-full w-[76.34%] origin-top-left rotate-[2.2deg] rounded-r6 after:bg-gray-900/5 z-2 bg-clip-padding",
						0,
					],
					doodle: null,
				},
				html:
				{
					layers: ["wash", "ground", "veil", "front", "hairline"],
					back: null,
					doodle: null,
				},
			},
		);
	});

	it("draws upstream's blank skeletons overflowing the sheet, with a fading sheen copy and pill text lines, over upstream's bottom hairline", async () =>
	{
		storage.removeItem(ARTIFACTS_LAYOUT_STORAGE_KEY);
		await renderArtifactsPage("/artifacts", true);
		const coverFor = (name: string) =>
		{
			const cover = screen
				.getByRole(
					"link",
					{
						name,
					},
				)
				.closest("li")
				?.querySelector<HTMLElement>("[data-artifact-cover]");
			if (cover === null || cover === undefined) throw new Error(`no cover for ${name}`);
			return cover;
		};
		const describeBlank = (cover: HTMLElement) =>
		{
			const blank = cover.querySelector("svg[data-artifact-cover-blank]");
			const gradient = blank?.querySelector("linearGradient");
			const groups = [...(blank?.querySelectorAll(":scope > g") ?? [])];
			return {
				className: blank?.getAttribute("class"),
				size: [blank?.getAttribute("width"), blank?.getAttribute("height")],
				defs: [...(blank?.querySelector("defs")?.children ?? [])].map((child) => [
					child.tagName,
					/(sheen|wash|soft)$/.exec(child.id)?.[1],
				]),
				wash: [...(blank?.querySelectorAll("radialGradient stop") ?? [])].map((stop) => [
					stop.getAttribute("offset"),
					stop.getAttribute("stop-opacity"),
				]),
				washShape: ["cx", "cy", "r"].map((name) => blank?.querySelector("radialGradient")?.getAttribute(name)),
				blur: blank?.querySelector("filter > feGaussianBlur")?.getAttribute("stdDeviation"),
				gradient:
				{
					units: gradient?.getAttribute("gradientUnits"),
					x2: gradient?.getAttribute("x2"),
					stops: [...(gradient?.querySelectorAll("stop") ?? [])].map((stop) => [
						stop.getAttribute("offset"),
						stop.getAttribute("class"),
						stop.getAttribute("stop-opacity"),
					]),
				},
				groups: groups.map((group) => (
				{
					fill: group.getAttribute("fill") === `url(#${gradient?.id})` ? "sheen" : group.getAttribute("fill"),
					rx: [...group.querySelectorAll("rect")].map((rect) => rect.getAttribute("rx")),
				})),
			};
		};
		const describeEnd = (cover: HTMLElement) => (
		{
			hairline: cover.lastElementChild?.getAttribute("class"),
			masked: [...cover.querySelectorAll<HTMLElement>("*")].filter((element) => element.style.maskImage !== "")
				.length,
		});

		const other = describeBlank(coverFor("Asap Ladder Queue"));
		const doc = describeBlank(coverFor("Quarterly plan"));
		const blankClass =
			"pointer-events-none absolute top-0 overflow-visible fill-current start-1/2 -translate-x-1/2 rtl:translate-x-1/2 text-[color:var(--skeleton-base)]";
		const defs =
		{
			defs: [
				["linearGradient", "sheen"],
				["radialGradient", "wash"],
				["filter", "soft"],
			],
			wash: [
				["0", "0.4"],
				["0.65", "0.75"],
				["1", null],
			],
			washShape: ["0.5", "0.5", "0.62"],
			blur: "0.3",
		};
		const sheen =
		{
			units: "userSpaceOnUse",
			stops: [
				["0", "[stop-color:currentColor]", null],
				["1", "[stop-color:currentColor]", "0"],
			],
		};
		expect(
			{
				other,
				doc,
				end: describeEnd(coverFor("Asap Ladder Queue")),
			},
		).toStrictEqual(
			{
				other:
				{
					className: blankClass,
					size: ["202", "130"],
					...defs,
					gradient:
					{
						...sheen,
						x2: "202",
					},
					groups: [
						{
							fill: null,
							rx: ["6", "6", "6", "6", "6", "6"],
						},
						{
							fill: "sheen",
							rx: ["6", "6", "6", "6", "6", "6"],
						},
					],
				},
				doc:
				{
					className: blankClass,
					size: ["180", "130"],
					...defs,
					gradient:
					{
						...sheen,
						x2: "180",
					},
					groups: [
						{
							fill: null,
							rx: ["5", "3", "2.5", "2.5", "2.5", "6"],
						},
						{
							fill: "sheen",
							rx: ["5", "3", "2.5", "2.5", "2.5", "6"],
						},
					],
				},
				end:
				{
					hairline: "absolute inset-x-0 bottom-0 z-3 h-px bg-alpha-2",
					masked: 0,
				},
			},
		);
	});

	// Upstream ignores an untyped publish's icon for the blank (c33ae67d6 `z()`): live `file|other|Chart`.
	it("draws the other blank on a file cover for an untyped publish whose icon is chart", async () =>
	{
		storage.removeItem(ARTIFACTS_LAYOUT_STORAGE_KEY);
		await renderArtifactsPage("/artifacts", true);
		const cover = screen
			.getByRole(
				"link",
				{
					name: "household-cash.html",
				},
			)
			.closest("li")
			?.querySelector<HTMLElement>("[data-artifact-cover]");
		expect(
			{
				cover: cover?.dataset["artifactCover"],
				blank: cover
					?.querySelector("svg[data-artifact-cover-blank]")
					?.getAttribute("data-artifact-cover-blank"),
			},
		).toStrictEqual(
			{
				cover: "file",
				blank: "other",
			},
		);
	});

	it("draws upstream's markless 72px card body: no ArtifactMark, just a one-line title and the Opened meta with sr-only Private", async () =>
	{
		storage.removeItem(ARTIFACTS_LAYOUT_STORAGE_KEY);
		await renderArtifactsPage("/artifacts", (db) =>
		{
			seedArtifacts(db);
			db.index
				.update(schema.artifacts)
				.set(
					{
						lastOpenedAt: Date.now() - 2 * 60 * 60 * 1000 - 60_000,
					},
				)
				.where(eq(schema.artifacts.url, LADDER_URL))
				.run();
		});
		const cardFor = (name: string) =>
		{
			const card = screen
				.getByRole(
					"link",
					{
						name,
					},
				)
				.closest<HTMLElement>("li");
			if (card === null) throw new Error(`no card for ${name}`);
			return card;
		};
		const describeCard = (card: HTMLElement) =>
		{
			const mark = card.querySelector<HTMLElement>("[data-card-body] [data-artifact-mark]");
			return {
				body: card.querySelector("[data-card-body]")?.className,
				mark: mark?.getAttribute("data-artifact-mark"),
				markClass: mark?.className,
				markSize: mark?.getAttribute("data-artifact-mark-size"),
				glyph: mark?.querySelector("svg")?.style.fontSize,
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

		expect(
			{
				opened: describeCard(cardFor("Asap Ladder Queue")),
				edited: describeCard(cardFor("Quarterly plan")),
				chart: describeCard(cardFor("household-cash.html")).meta,
			},
		).toStrictEqual(
			{
				opened:
				{
					body,
					mark: undefined,
					markClass: undefined,
					markSize: undefined,
					glyph: undefined,
					words,
					title,
					meta: "Opened 2h agoPrivate",
					lock: false,
					badge: false,
				},
				edited:
				{
					body,
					mark: undefined,
					markClass: undefined,
					markSize: undefined,
					glyph: undefined,
					words,
					title,
					meta: expect.stringMatching(/^Edited Nov 3, 2025Private$/),
					lock: false,
					badge: false,
				},
				chart: expect.stringMatching(/^Edited Jun 10(, 2026)?$/),
			},
		);
	});

	it("gives every artifact focusable upstream's [scroll-margin-top:var(--list-header-scroll-offset)] inside a content box that maps it from the Page offset (cd75b47e6, c33ae67d6 J, c69e9937a, c8a1f083a)", async () =>
	{
		const margin = "[scroll-margin-top:var(--list-header-scroll-offset)]";
		const focusables = () =>
		{
			const gallery = document.querySelector<HTMLElement>("[data-scrolls-under-page-header]");
			const lacking = (selector: string) =>
				[...(gallery?.querySelectorAll(selector) ?? [])]
					.filter((element) => element.closest("[data-make-something-new]") === null)
					.map((element) => element.classList.contains(margin));
			return {
				primary: lacking("a[data-primary]"),
				more: lacking('[aria-label^="More options for"]'),
				pin: lacking('button[aria-label="Pin"], button[aria-label="Unpin"]'),
			};
		};
		storage.setItem(ARTIFACT_PIN_STORAGE_KEY, JSON.stringify([DOCS_URL]));
		storage.removeItem(ARTIFACTS_LAYOUT_STORAGE_KEY);
		await renderArtifactsPage("/artifacts", true);
		const content = document.querySelector<HTMLElement>("[data-scrolls-under-page-header]");
		const grid =
		{
			content:
			{
				attribute: content?.getAttribute("data-scrolls-under-page-header"),
				offset: content?.style.getPropertyValue("--list-header-scroll-offset"),
			},
			...focusables(),
		};
		cleanup();
		storage.setItem(ARTIFACTS_LAYOUT_STORAGE_KEY, "list");
		await renderArtifactsPage("/artifacts", true);
		const list =
		{
			...focusables(),
			headings: outsideStrip(
				screen.getAllByRole(
					"heading",
					{
						level: 2,
					},
				),
			).map((heading) => heading.classList.contains(margin)),
		};

		expect(
			{
				grid,
				list,
			},
		).toStrictEqual(
			{
				grid:
				{
					content:
					{
						attribute: "",
						offset: "var(--cds-page-header-scroll-offset)",
					},
					primary: [true, true, true],
					more: [true, true, true],
					pin: [true, true, true],
				},
				list:
				{
					primary: [true, true, true],
					more: [true, true, true],
					pin: [true, true, true],
					headings: [true, true, true],
				},
			},
		);
	});

	it("lists artifacts by date group linking out to claude.ai", async () =>
	{
		await renderArtifactsPage("/artifacts", true);

		const groups = galleryLists().map((list) => (
		{
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
							{
								name: "Session",
								href: "/session/session-ladder",
							},
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
						chips: [
							{
								name: "Session",
								href: "/session/session-chart",
							},
						],
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
						chips: [
							{
								name: "Session",
								href: "/session/session-docs",
							},
						],
						private: true,
						meta: expect.stringMatching(/^Edited /),
					},
				],
			},
		]);
	});

	it("leads each list row with upstream's 28px row ArtifactMark: a tint-blue Docs tile labelled Docs, a neutral file tile otherwise", async () =>
	{
		await renderArtifactsPage("/artifacts", true);
		const markFor = (name: string) =>
		{
			const mark = screen
				.getByRole(
					"link",
					{
						name,
					},
				)
				.closest("li")
				?.querySelector<HTMLElement>('[data-artifact-mark-size="row"]');
			const svg = mark?.querySelector("svg");
			return {
				kind: mark?.dataset["artifactMark"],
				className: mark?.className,
				glyph: svg?.style.fontSize,
				label: svg?.getAttribute("aria-label") ?? null,
			};
		};
		const row = "flex items-center justify-center size-7 shrink-0 overflow-hidden rounded-[25%]";
		const glyph = "calc(1rem * var(--cds-rem-scale, 1))";
		expect(
			{
				docs: markFor("Quarterly plan"),
				html: markFor("Asap Ladder Queue"),
				typeTiles: document.querySelectorAll("[data-type-tile]").length,
			},
		).toStrictEqual(
			{
				docs:
				{
					kind: "document",
					className: `${row} bg-tint-blue text-tint-blue`,
					glyph,
					label: "Docs",
				},
				html:
				{
					kind: "file",
					className: `${row} bg-fill-secondary text-secondary`,
					glyph,
					label: null,
				},
				typeTiles: 0,
			},
		);
	});

	it("shows the upstream empty state when nothing has been published", async () =>
	{
		await renderArtifactsPage("/artifacts", false);

		expect(
			{
				heading: screen.getByRole(
					"heading",
					{
						level: 3,
					},
				).textContent,
				body: screen.getByText("Artifacts that Claude publishes in your sessions appear here.").tagName,
			},
		).toStrictEqual(
			{
				heading: "No artifacts yet",
				body: "P",
			},
		);
	});

	function emptyStateSummary()
	{
		const heading = screen.getByRole(
			"heading",
			{
				level: 3,
			},
		);
		const body = heading.nextElementSibling;
		return {
			container: heading.parentElement?.className,
			heading:
			{
				text: heading.textContent,
				className: heading.className,
			},
			body:
			{
				tag: body?.tagName,
				text: body?.textContent,
				className: body?.className,
			},
		};
	}

	it("shows upstream's left-aligned shared-tab EmptyState when nothing is shared with you", async () =>
	{
		await renderArtifactsPage("/artifacts?tab=shared", (db) =>
		{
			seedMixedGallery(db);
			db.index.delete(schema.artifacts).where(ne(schema.artifacts.audience, "owner")).run();
		});

		expect(emptyStateSummary()).toStrictEqual(
			{
				container: "flex flex-col items-start gap-3 pb-12 text-start text-body",
				heading:
				{
					text: "No shared artifacts yet",
					className: "max-w-xs font-medium text-secondary",
				},
				body:
				{
					tag: "P",
					text: "When someone shares an artifact with you, it appears here.",
					className: "max-w-xs text-footnote text-secondary",
				},
			},
		);
	});

	it("shows upstream's Yours-tab EmptyState (no CTA locally) when you have published nothing", async () =>
	{
		await renderArtifactsPage("/artifacts?tab=mine", (db) =>
		{
			seedMixedGallery(db);
			db.index.delete(schema.artifacts).where(eq(schema.artifacts.audience, "owner")).run();
		});

		expect(
			{
				...emptyStateSummary(),
				buttons: screen.queryAllByRole(
					"button",
					{
						name: "New artifact",
					},
				),
			},
		).toStrictEqual(
			{
				container: "flex flex-col items-start gap-3 pb-12 text-start text-body",
				heading:
				{
					text: "Create your first artifact",
					className: "max-w-xs font-medium text-secondary",
				},
				body:
				{
					tag: "P",
					text: "Artifacts you build with Claude appear here.",
					className: "max-w-xs text-footnote text-secondary",
				},
				buttons: [],
			},
		);
	});

	it("opens search from ?search= and announces the match count", async () =>
	{
		await renderArtifactsPage("/artifacts?search=ladder", true);

		expect(
			{
				input: screen.getByRole<HTMLInputElement>(
					"searchbox",
					{
						name: "Search your artifacts",
					},
				).value,
				placeholder: screen.getByRole("searchbox").getAttribute("placeholder"),
				status: pageStatuses()[0],
				rows: galleryRows().map((row) => rowSummary(row).title),
			},
		).toStrictEqual(
			{
				input: "ladder",
				placeholder: "Search artifacts...",
				status: "1 artifact matching “ladder”",
				rows: ["Asap Ladder Queue"],
			},
		);
	});

	it("writes the search into the URL and shows the no-match message", async () =>
	{
		const router = await renderArtifactsPage("/artifacts", true);

		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Search your artifacts",
				},
			),
		);
		fireEvent.change(
			screen.getByRole(
				"searchbox",
				{
					name: "Search your artifacts",
				},
			),
			{
				target:
				{
					value: "zzqx",
				},
			},
		);

		await waitFor(() =>
		{
			expect(
				{
					...router.state.location.search,
				},
			).toStrictEqual(
				{
					search: "zzqx",
				},
			);
		});
		expect(pageStatuses()).toStrictEqual(["No artifacts match “zzqx”", "No artifacts matching “zzqx”"]);
	});

	it("persists the grid/list toggle in localStorage", async () =>
	{
		await renderArtifactsPage("/artifacts", true);

		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Grid view",
				},
			),
		);

		expect(
			{
				stored: storage.getItem(ARTIFACTS_LAYOUT_STORAGE_KEY),
				toggle: screen.getByRole(
					"button",
					{
						name: "List view",
					},
				).tagName,
				headings: outsideStrip(
					screen.queryAllByRole(
						"heading",
						{
							level: 2,
						},
					),
				).length,
				cards: document.querySelectorAll("[data-gallery-card]").length,
			},
		).toStrictEqual(
			{
				stored: "grid",
				toggle: "BUTTON",
				headings: 0,
				cards: 3,
			},
		);

		cleanup();
		await renderArtifactsPage("/artifacts", true);

		expect(
			screen.getByRole(
				"button",
				{
					name: "List view",
				},
			).tagName,
		).toBe("BUTTON");
	});

	it("shows the toolbar tooltips with ⌘F on search and the Private lock", async () =>
	{
		vi.spyOn(navigator, "userAgent", "get").mockReturnValue(MAC_USER_AGENT);
		await renderArtifactsPage("/artifacts", true);

		async function tooltipFor(element: HTMLElement)
		{
			fireEvent.pointerEnter(element);
			const tooltip = await screen.findByRole("tooltip");
			const summary =
			{
				text: tooltip.firstChild?.textContent,
				keys: tooltip.querySelector("[data-cds='Shortcut']")?.textContent ?? null,
			};
			fireEvent.pointerLeave(element);
			return summary;
		}

		expect([
			await tooltipFor(
				screen.getByRole(
					"button",
					{
						name: "Search your artifacts",
					},
				),
			),
			await tooltipFor(
				screen.getByRole(
					"button",
					{
						name: "Grid view",
					},
				),
			),
			await tooltipFor(
				screen.getByRole(
					"button",
					{
						name: "Filter and sort",
					},
				),
			),
			await tooltipFor(
				screen.getAllByRole(
					"img",
					{
						name: "Private",
					},
				)[0]!,
			),
		]).toStrictEqual([
			{
				text: "Search your artifacts",
				keys: "⌘CommandF",
			},
			{
				text: "Grid view",
				keys: null,
			},
			{
				text: "Filter and sort",
				keys: null,
			},
			{
				text: "Private",
				keys: null,
			},
		]);
	});

	it("shows the card's edited time as upstream's RelativeTime with the absolute time in a tooltip", async () =>
	{
		storage.removeItem(ARTIFACTS_LAYOUT_STORAGE_KEY);
		await renderArtifactsPage("/artifacts", true);
		const card = screen
			.getByRole(
				"link",
				{
					name: "Asap Ladder Queue",
				},
			)
			.closest<HTMLElement>("li");
		const time = card?.querySelector<HTMLElement>("[data-artifact-meta] time");
		if (time === null || time === undefined) throw new Error("no time");

		fireEvent.pointerEnter(time);
		const tooltip = await screen.findByRole("tooltip");

		expect(
			{
				cds: time.dataset["cds"],
				tooltip: tooltip.textContent,
			},
		).toStrictEqual(
			{
				cds: "RelativeTime",
				tooltip: formatArtifactTooltip(localMs(2026, 8, 26, 15)),
			},
		);
	});

	it("expands and focuses the search on ⌘F", async () =>
	{
		vi.spyOn(navigator, "userAgent", "get").mockReturnValue(MAC_USER_AGENT);
		await renderArtifactsPage("/artifacts", true);

		fireEvent.keyDown(
			document.body,
			{
				key: "f",
				code: "KeyF",
				metaKey: true,
			},
		);

		await waitFor(() =>
		{
			expect(document.activeElement).toBe(
				screen.getByRole(
					"searchbox",
					{
						name: "Search your artifacts",
					},
				),
			);
		});
	});

	it("grows the toolbar buttons to upstream's fizzy-lake panels 28px r8 controls on a fine pointer; the field follows h-control", async () =>
	{
		storage.removeItem(ARTIFACTS_LAYOUT_STORAGE_KEY);
		await renderArtifactsPage("/artifacts", true);
		const panelsFine = (element: Element | null | undefined) =>
			(element?.className ?? "").split(" ").filter((name) => name.startsWith("panels-fine:"));
		const buttons = ["Search your artifacts", "Filter and sort", "List view"].map((name) =>
			panelsFine(
				screen.getByRole(
					"button",
					{
						name,
					},
				),
			),
		);
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Search your artifacts",
				},
			),
		);

		expect(
			{
				buttons,
				field: panelsFine(screen.getByRole("search").querySelector("[data-cds=TextInput]")),
			},
		).toStrictEqual(
			{
				buttons: Array.from(
					{
						length: 3,
					},
					() => ["panels-fine:size-7", "panels-fine:rounded-r6"],
				),
				field: [],
			},
		);
	});

	it("opens search as upstream's cds TextInput and marks the toolbar data-search-open", async () =>
	{
		await renderArtifactsPage("/artifacts", true);
		const controls = document.querySelector("[data-cds-part=controls]");

		const closedOpenAttr = controls?.hasAttribute("data-search-open");
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Search your artifacts",
				},
			),
		);
		const search = screen.getByRole("search");
		const field = search.querySelector("[data-cds=TextInput]");

		expect(
			{
				closedOpenAttr,
				openAttr: controls?.hasAttribute("data-search-open"),
				search: search.className,
				box: field?.parentElement?.className,
				field: field?.className,
				clear: within(search).getByRole(
					"button",
					{
						name: "Clear search",
					},
				).className,
				clearTabIndex: within(search).getByRole(
					"button",
					{
						name: "Clear search",
					},
				).tabIndex,
			},
		).toStrictEqual(
			{
				closedOpenAttr: false,
				openAttr: true,
				search: "flex max-w-full min-w-40 grow items-center gap-3 @min-[640px]:justify-end basis-40",
				box: "w-0 min-w-40 flex-1 @min-[640px]:max-w-sm",
				// Upstream's TextInput with clearable "always": Clear always shows, so the end inset is the nested one.
				field: "h-control ps-md rounded bg-fill-field shadow-field-ring field-fill data-[invalid]:shadow-field-invalid forced-colors:[&:not(:focus-visible)]:[outline:1px_solid_CanvasText] forced-colors:[&:not(:focus-visible)]:[outline-offset:-1px] forced-colors:data-[invalid]:[&:not(:focus-visible)]:[outline-width:2px] forced-colors:data-[invalid]:[&:not(:focus-visible)]:[outline-offset:-2px] font-sans text-body font-normal text-primary transition duration-fast pe-[calc((var(--cds-h-control)-var(--cds-h-control-nested))/2)] inline-flex w-full min-w-0 cursor-text items-center gap-[var(--cds-pad-sm,6px)] has-[:focus-visible]:shadow-focus data-[invalid]:has-[:focus-visible]:shadow-focus-danger has-[input:disabled]:opacity-disabled [&:hover:not(:focus-visible):not(:has(:focus-visible)):not([data-invalid]):not([data-disabled])]:shadow-field-hover field-fill-hover",
				clear: TEXT_INPUT_CLEAR_CLASS,
				clearTabIndex: 0,
			},
		);
	});

	it("collapses the search on blur only while the draft is empty", async () =>
	{
		await renderArtifactsPage("/artifacts", true);

		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Search your artifacts",
				},
			),
		);
		fireEvent.change(
			screen.getByRole("searchbox"),
			{
				target:
				{
					value: "x",
				},
			},
		);
		fireEvent.blur(screen.getByRole("searchbox"));
		const keptWithDraft = screen.queryByRole("searchbox") !== null;

		fireEvent.change(
			screen.getByRole("searchbox"),
			{
				target:
				{
					value: "",
				},
			},
		);
		fireEvent.blur(screen.getByRole("searchbox"));

		expect(
			{
				keptWithDraft,
				collapsed: screen.queryByRole("searchbox"),
				button: screen.getByRole(
					"button",
					{
						name: "Search your artifacts",
					},
				).tagName,
				openAttr: document.querySelector("[data-cds-part=controls]")?.hasAttribute("data-search-open"),
			},
		).toStrictEqual(
			{
				keptWithDraft: true,
				collapsed: null,
				button: "BUTTON",
				openAttr: false,
			},
		);
	});

	it("expands the search on Ctrl+F off the Mac", async () =>
	{
		vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (X11; Linux x86_64)");
		await renderArtifactsPage("/artifacts", true);

		fireEvent.keyDown(
			document.body,
			{
				key: "f",
				code: "KeyF",
				ctrlKey: true,
			},
		);

		await waitFor(() =>
		{
			expect(document.activeElement).toBe(
				screen.getByRole(
					"searchbox",
					{
						name: "Search your artifacts",
					},
				),
			);
		});
	});

	it("shows upstream's All / Yours / Shared with you tabs and keeps the choice in ?tab=", async () =>
	{
		const router = await renderArtifactsPage("/artifacts", seedMixedGallery);

		function titles()
		{
			return galleryRows()
				.map((row) => rowSummary(row).title ?? "")
				.toSorted();
		}
		const tabs = within(
			screen.getByRole(
				"tablist",
				{
					name: "Artifacts",
				},
			),
		).getAllByRole("tab");
		const initial =
		{
			tabs: tabs.map((tab) => [tab.textContent, tab.getAttribute("aria-selected")]),
			rows: titles().length,
		};

		fireEvent.click(
			screen.getByRole(
				"tab",
				{
					name: "Shared with you",
				},
			),
		);
		await waitFor(() =>
		{
			expect(
				{
					...router.state.location.search,
				},
			).toStrictEqual(
				{
					tab: "shared",
				},
			);
		});
		const shared = titles();

		fireEvent.click(
			screen.getByRole(
				"tab",
				{
					name: "Yours",
				},
			),
		);
		await waitFor(() =>
		{
			expect(
				{
					...router.state.location.search,
				},
			).toStrictEqual(
				{
					tab: "mine",
				},
			);
		});

		expect(
			{
				initial,
				shared,
				yours: titles(),
			},
		).toStrictEqual(
			{
				initial:
				{
					tabs: [
						["All", "true"],
						["Yours", "false"],
						["Shared with you", "false"],
					],
					rows: 16,
				},
				shared: [1, 3, 5, 7, 9, 11, 13, 15].map((n) => `Shared mixed-${String(n).padStart(2, "0")}`),
				yours: [0, 2, 4, 6, 8, 10, 12, 14].map((n) => `Mine mixed-${String(n).padStart(2, "0")}`),
			},
		);
	});

	// Upstream's Artifacts view tabs are cds Tabs: abutting 28px tabs with a `::before` pill (r8, inset-x 1px).
	it("renders the view tabs as upstream's cds Tabs with the shared tab recipe", async () =>
	{
		await renderArtifactsPage("/artifacts", seedMixedGallery);
		const tablist = screen.getByRole(
			"tablist",
			{
				name: "Artifacts",
			},
		);
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

		expect(
			{
				root: tablist.closest('[data-cds="Tabs"]') !== null,
				list: ["gap-1", "font-sans"].filter((token) => tablist.classList.contains(token)),
				tabs: within(tablist)
					.getAllByRole("tab")
					.map((tab) => (
					{
						active: tab.hasAttribute("data-active"),
						recipe: recipe.filter((token) => !tab.classList.contains(token)),
						dropped: dropped.filter((token) => tab.classList.contains(token)),
					})),
			},
		).toStrictEqual(
			{
				root: true,
				list: ["font-sans"],
				tabs: [
					{
						active: true,
						recipe: [],
						dropped: [],
					},
					{
						active: false,
						recipe: [],
						dropped: [],
					},
					{
						active: false,
						recipe: [],
						dropped: [],
					},
				],
			},
		);
	});

	it("opens on the tab named by ?tab=", async () =>
	{
		await renderArtifactsPage("/artifacts?tab=shared", seedMixedGallery);

		expect(
			{
				selected: screen.getByRole(
					"tab",
					{
						selected: true,
					},
				).textContent,
				rows: galleryRows().length,
			},
		).toStrictEqual(
			{
				selected: "Shared with you",
				rows: 8,
			},
		);
	});

	it("still opens the tab named by the legacy ?view= param", async () =>
	{
		await renderArtifactsPage("/artifacts?view=yours", seedMixedGallery);

		expect(
			{
				selected: screen.getByRole(
					"tab",
					{
						selected: true,
					},
				).textContent,
				rows: galleryRows().length,
			},
		).toStrictEqual(
			{
				selected: "Yours",
				rows: 8,
			},
		);
	});

	it("drops ?tab= when going back to All", async () =>
	{
		const router = await renderArtifactsPage("/artifacts?tab=mine", seedMixedGallery);

		fireEvent.click(
			screen.getByRole(
				"tab",
				{
					name: "All",
				},
			),
		);

		await waitFor(() =>
		{
			expect(
				{
					...router.state.location.search,
				},
			).toStrictEqual({});
		});
	});

	it("roves focus across the tabs with manual activation, like upstream's activateOnFocus:false", async () =>
	{
		await renderArtifactsPage("/artifacts?tab=mine", seedMixedGallery);

		const tabs = within(
			screen.getByRole(
				"tablist",
				{
					name: "Artifacts",
				},
			),
		).getAllByRole("tab");
		const tabIndexes = tabs.map((tab) => tab.getAttribute("tabindex"));

		act(() =>
		{
			screen
				.getByRole(
					"tab",
					{
						name: "Yours",
					},
				)
				.focus();
		});
		fireEvent.keyDown(
			screen.getByRole(
				"tab",
				{
					name: "Yours",
				},
			),
			{
				key: "ArrowRight",
			},
		);

		await waitFor(() =>
		{
			expect(document.activeElement?.textContent).toBe("Shared with you");
		});
		expect(
			{
				tabIndexes,
				selected: tabs.map((tab) => tab.getAttribute("aria-selected")),
			},
		).toStrictEqual(
			{
				tabIndexes: ["-1", "0", "-1"],
				selected: ["false", "true", "false"],
			},
		);
	});

	it("orders the toolbar Search · Filter and sort · List view and names the trigger by its active filter count", async () =>
	{
		storage.removeItem(ARTIFACTS_LAYOUT_STORAGE_KEY);
		const labels = () =>
			[...document.querySelectorAll("[data-cds-part=controls] button[aria-label]")].map((button) =>
				button.getAttribute("aria-label"),
			);
		await renderArtifactsPage("/artifacts", true);
		const resting =
		{
			labels: labels(),
			pressed: screen.getByRole(
				"button",
				{
					name: "Filter and sort",
				},
			).ariaPressed,
		};
		cleanup();
		await renderArtifactsPage("/artifacts?type=docs", true);
		const one = screen
			.getByRole(
				"button",
				{
					name: "1 filter on",
				},
			)
			.getAttribute("aria-pressed");
		cleanup();
		await renderArtifactsPage("/artifacts?type=docs,other&pinned=1", true);

		expect(
			{
				resting,
				one,
				three: screen
					.getByRole(
						"button",
						{
							name: "3 filters on",
						},
					)
					.getAttribute("aria-pressed"),
			},
		).toStrictEqual(
			{
				resting:
				{
					labels: ["Search your artifacts", "Filter and sort", "List view"],
					pressed: "false",
				},
				one: "true",
				three: "true",
			},
		);
	});

	function menuRows(menu: HTMLElement)
	{
		return [
			...menu.querySelectorAll(
				"[role=menuitem], [role=menuitemcheckbox], [role=menuitemradio], [role=separator]",
			),
		]
			.filter((element) => element.closest("[role=menu]") === menu)
			.map((element) =>
			{
				const role = element.getAttribute("role");
				if (role === "separator") return "──";
				const label = element.querySelector("[data-menu-sub-label]")?.textContent ?? element.textContent;
				const value = element.querySelector("[data-menu-value]")?.textContent;
				return value === undefined ? `${role}:${label}` : `${role}:${label}=${value}`;
			});
	}

	async function openSubmenu(menu: HTMLElement, label: string): Promise<HTMLElement>
	{
		const trigger = [...menu.querySelectorAll<HTMLElement>("[role=menuitem]")].find(
			(item) => item.querySelector("[data-menu-sub-label]")?.textContent === label,
		);
		if (trigger === undefined) throw new Error(`no ${label} submenu`);
		act(() =>
		{
			trigger.focus();
		});
		fireEvent.keyDown(
			trigger,
			{
				key: "ArrowRight",
			},
		);
		await waitFor(() =>
		{
			expect(screen.getAllByRole("menu")).toHaveLength(2);
		});
		const submenu = screen.getAllByRole("menu").find((candidate) => candidate !== menu);
		if (submenu === undefined) throw new Error(`no ${label} submenu`);
		return submenu;
	}

	it("opens upstream's Filter and sort menu: Sort by · Owner · Type · Date opened · Sharing · Pinned", async () =>
	{
		await renderArtifactsPage("/artifacts", seedMixedGallery);

		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Filter and sort",
				},
			),
		);
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

	it("multi-picks types from checkbox rows with no chips and no 0 hint, keeping them in ?type=", async () =>
	{
		const router = await renderArtifactsPage("/artifacts", seedMixedGallery);

		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Filter and sort",
				},
			),
		);
		const menu = await screen.findByRole("menu");
		const submenu = await openSubmenu(menu, "Type");
		const items = within(submenu).getAllByRole("menuitemcheckbox");
		const resting =
		{
			names: items.map((item) => item.textContent),
			hints: items.map((item) => item.querySelector("[data-menu-hint]")?.className ?? null),
			chips: submenu.querySelectorAll("[data-type-chip]").length,
			boxes: items.map((item) => item.querySelector("[data-cds-checkbox]") !== null),
		};

		fireEvent.click(
			within(submenu).getByRole(
				"menuitemcheckbox",
				{
					name: "Docs2",
				},
			),
		);
		await waitFor(() =>
		{
			expect(
				{
					...router.state.location.search,
				},
			).toStrictEqual(
				{
					type: "docs",
				},
			);
		});
		fireEvent.click(
			within(submenu).getByRole(
				"menuitemcheckbox",
				{
					name: "Slides",
				},
			),
		);
		await waitFor(() =>
		{
			expect(
				{
					...router.state.location.search,
				},
			).toStrictEqual(
				{
					type: "docs,slides",
				},
			);
		});
		const hint = "ms-3 max-w-[160px] shrink-0 truncate text-footnote tabular-nums text-ink-muted";

		expect(
			{
				resting,
				typeValue: menuRows(menu).find((row) => row.startsWith("menuitem:Type=")),
				checked: within(submenu)
					.getAllByRole("menuitemcheckbox")
					.map((item) => item.getAttribute("aria-checked")),
			},
		).toStrictEqual(
			{
				resting:
				{
					names: ["Dashboard", "Design", "Design System", "Docs2", "Slides", "Other14"],
					hints: [null, null, null, hint, null, hint],
					chips: 0,
					boxes: [true, true, true, true, true, true],
				},
				typeValue: "menuitem:Type=2 picked",
				checked: ["false", "false", "false", "true", "true", "false"],
			},
		);
	});

	it("notes on the Yours tab that Owner lists only your own artifacts", async () =>
	{
		await renderArtifactsPage("/artifacts?tab=mine", seedMixedGallery);

		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Filter and sort",
				},
			),
		);
		const submenu = await openSubmenu(await screen.findByRole("menu"), "Owner");

		expect(
			{
				text: submenu.textContent,
				checkboxes: within(submenu).queryAllByRole("menuitemcheckbox").length,
			},
		).toStrictEqual(
			{
				text: "This tab lists only your own artifacts.",
				checkboxes: 0,
			},
		);
	});

	it("filters by Date opened: Today hides a card last opened yesterday", async () =>
	{
		const now = new Date();
		const yesterdayNoon = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 12).getTime();
		const seed = (db: AppDb) =>
		{
			seedArtifacts(db);
			db.index
				.update(schema.artifacts)
				.set(
					{
						lastOpenedAt: Date.now() - 1000,
					},
				)
				.where(eq(schema.artifacts.url, LADDER_URL))
				.run();
			db.index
				.update(schema.artifacts)
				.set(
					{
						lastOpenedAt: yesterdayNoon,
					},
				)
				.where(eq(schema.artifacts.url, DOCS_URL))
				.run();
		};
		const router = await renderArtifactsPage("/artifacts", seed);

		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Filter and sort",
				},
			),
		);
		const submenu = await openSubmenu(await screen.findByRole("menu"), "Date opened");
		const options = within(submenu)
			.getAllByRole("menuitemradio")
			.map((item) => item.textContent);
		fireEvent.click(
			within(submenu).getByRole(
				"menuitemradio",
				{
					name: "Today",
				},
			),
		);
		await waitFor(() =>
		{
			expect(
				{
					...router.state.location.search,
				},
			).toStrictEqual(
				{
					opened: "today",
				},
			);
		});

		expect(
			{
				options,
				rows: galleryRows().map((row) => rowSummary(row).title),
			},
		).toStrictEqual(
			{
				options: ["Any time", "Today", "Yesterday", "Past 7 days", "Past 30 days"],
				rows: ["Asap Ladder Queue"],
			},
		);
	});

	it("sorts by Last opened by default and by Last edited from ?sort=edited or the Sort by radios, announcing the sort", async () =>
	{
		storage.removeItem(ARTIFACTS_LAYOUT_STORAGE_KEY);
		const seed = seedDocsOpenedRecently;
		await renderArtifactsPage("/artifacts?sort=edited", seed);
		const edited = cards();
		cleanup();
		const router = await renderArtifactsPage("/artifacts", seed);
		const opened = cards();

		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Filter and sort",
				},
			),
		);
		const submenu = await openSubmenu(await screen.findByRole("menu"), "Sort by");
		fireEvent.click(
			within(submenu).getByRole(
				"menuitemradio",
				{
					name: "Last edited",
				},
			),
		);
		await waitFor(() =>
		{
			expect(
				{
					...router.state.location.search,
				},
			).toStrictEqual(
				{
					sort: "edited",
				},
			);
		});

		expect(
			{
				edited,
				opened,
				picked: cards(),
				statuses: pageStatuses(),
			},
		).toStrictEqual(
			{
				edited: ["Asap Ladder Queue", "household-cash.html", "Quarterly plan"],
				opened: ["Quarterly plan", "Asap Ladder Queue", "household-cash.html"],
				picked: ["Asap Ladder Queue", "household-cash.html", "Quarterly plan"],
				statuses: ["Sorted by Last edited"],
			},
		);
	});

	it("remembers the Sort by pick per browser: the stored sort applies to a bare URL, the URL's own sort wins, filter picks keep the URL's sort", async () =>
	{
		storage.removeItem(ARTIFACTS_LAYOUT_STORAGE_KEY);
		storage.setItem(ARTIFACTS_SORT_STORAGE_KEY, "edited");
		const router = await renderArtifactsPage("/artifacts", seedDocsOpenedRecently);
		const remembered =
		{
			cards: cards(),
			search:
			{
				...router.state.location.search,
			},
		};

		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Filter and sort",
				},
			),
		);
		const menu = await screen.findByRole("menu");
		fireEvent.click(
			within(menu).getByRole(
				"menuitemcheckbox",
				{
					name: "Pinned",
				},
			),
		);
		await waitFor(() =>
		{
			expect(
				{
					...router.state.location.search,
				},
			).toStrictEqual(
				{
					pinned: 1,
				},
			);
		});
		const afterFilter = menuRows(menu)[0];

		const submenu = await openSubmenu(menu, "Sort by");
		fireEvent.click(
			within(submenu).getByRole(
				"menuitemradio",
				{
					name: "Last opened",
				},
			),
		);
		await waitFor(() =>
		{
			expect(menuRows(menu)[0]).toBe("menuitem:Sort by=Last opened");
		});
		const pickedOpened =
		{
			stored: storage.getItem(ARTIFACTS_SORT_STORAGE_KEY),
			search:
			{
				...router.state.location.search,
			},
		};
		fireEvent.click(
			within(submenu).getByRole(
				"menuitemradio",
				{
					name: "Last edited",
				},
			),
		);
		await waitFor(() =>
		{
			expect(
				{
					...router.state.location.search,
				},
			).toStrictEqual(
				{
					pinned: 1,
					sort: "edited",
				},
			);
		});

		expect(
			{
				remembered,
				afterFilter,
				pickedOpened,
				pickedEdited: storage.getItem(ARTIFACTS_SORT_STORAGE_KEY),
			},
		).toStrictEqual(
			{
				remembered:
				{
					cards: ["Asap Ladder Queue", "household-cash.html", "Quarterly plan"],
					search: {},
				},
				afterFilter: "menuitem:Sort by=Last edited",
				pickedOpened:
				{
					stored: "opened",
					search:
					{
						pinned: 1,
					},
				},
				pickedEdited: "edited",
			},
		);
	});

	it("lets an explicit ?sort=opened beat the stored Last edited pick and keeps it through filter picks until the Sort by radio drops it", async () =>
	{
		storage.removeItem(ARTIFACTS_LAYOUT_STORAGE_KEY);
		storage.setItem(ARTIFACTS_SORT_STORAGE_KEY, "edited");
		const router = await renderArtifactsPage("/artifacts?sort=opened", seedDocsOpenedRecently);
		const initialCards = cards();

		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Filter and sort",
				},
			),
		);
		const menu = await screen.findByRole("menu");
		const initialRow = menuRows(menu)[0];
		fireEvent.click(
			within(menu).getByRole(
				"menuitemcheckbox",
				{
					name: "Pinned",
				},
			),
		);
		await waitFor(() =>
		{
			expect(
				{
					...router.state.location.search,
				},
			).toStrictEqual(
				{
					sort: "opened",
					pinned: 1,
				},
			);
		});

		storage.removeItem(ARTIFACTS_SORT_STORAGE_KEY);
		const submenu = await openSubmenu(menu, "Sort by");
		fireEvent.click(
			within(submenu).getByRole(
				"menuitemradio",
				{
					name: "Last opened",
				},
			),
		);
		await waitFor(() =>
		{
			expect(
				{
					...router.state.location.search,
				},
			).toStrictEqual(
				{
					pinned: 1,
				},
			);
		});

		expect(
			{
				initialCards,
				initialRow,
				stored: storage.getItem(ARTIFACTS_SORT_STORAGE_KEY),
			},
		).toStrictEqual(
			{
				initialCards: ["Quarterly plan", "Asap Ladder Queue", "household-cash.html"],
				initialRow: "menuitem:Sort by=Last opened",
				stored: "opened",
			},
		);
	});

	it("follows a Sort by pick made in another tab while the URL has no sort", async () =>
	{
		storage.removeItem(ARTIFACTS_LAYOUT_STORAGE_KEY);
		await renderArtifactsPage("/artifacts", seedDocsOpenedRecently);
		const before = cards();

		act(() =>
		{
			storage.setItem(ARTIFACTS_SORT_STORAGE_KEY, "edited");
			window.dispatchEvent(
				new StorageEvent(
					"storage",
					{
						key: ARTIFACTS_SORT_STORAGE_KEY,
						newValue: "edited",
					},
				),
			);
		});

		expect(
			{
				before,
				after: cards(),
			},
		).toStrictEqual(
			{
				before: ["Quarterly plan", "Asap Ladder Queue", "household-cash.html"],
				after: ["Asap Ladder Queue", "household-cash.html", "Quarterly plan"],
			},
		);
	});

	it("puts upstream's list-top anchor before Make something new and wraps the listing in the scroll-margin box, in grid and list layout", async () =>
	{
		const layouts: Array<
		{
			anchor: string | undefined;
			next: string | null | undefined;
			wrapper: string | undefined;
			listing: string | undefined;
		}> = [];
		for (const layout of ["grid", "list"])
		{
			storage.setItem(ARTIFACTS_LAYOUT_STORAGE_KEY, layout);
			await renderArtifactsPage("/artifacts", true);
			const anchor = document.querySelector("[data-scrolls-under-page-header]")?.firstElementChild;
			const wrapper = document.querySelector("[data-make-something-new]")?.nextElementSibling;
			layouts.push(
				{
					anchor: anchor?.outerHTML,
					next: anchor?.nextElementSibling?.getAttribute("data-make-something-new"),
					wrapper: wrapper?.className,
					listing: wrapper?.firstElementChild?.tagName,
				},
			);
			cleanup();
		}

		expect(layouts).toStrictEqual([
			{
				anchor: '<div class="[scroll-margin-top:var(--list-header-scroll-offset)]"></div>',
				next: "true",
				wrapper: "flex flex-col [scroll-margin-top:var(--list-header-scroll-offset)]",
				listing: "UL",
			},
			{
				anchor: '<div class="[scroll-margin-top:var(--list-header-scroll-offset)]"></div>',
				next: "true",
				wrapper: "flex flex-col [scroll-margin-top:var(--list-header-scroll-offset)]",
				listing: "DIV",
			},
		]);
	});

	it("scrolls the list top back by the depth it sits under the pinned header on any sort, filter or search change, never down, leaving focus on the radio", async () =>
	{
		storage.removeItem(ARTIFACTS_LAYOUT_STORAGE_KEY);
		const scrollIntoView = vi.fn<(arg?: boolean | ScrollIntoViewOptions) => void>();
		const original = HTMLElement.prototype.scrollIntoView;
		HTMLElement.prototype.scrollIntoView = scrollIntoView;
		onTestFinished(() =>
		{
			HTMLElement.prototype.scrollIntoView = original;
		});
		const router = await renderArtifactsPage("/artifacts", true);
		const listing = document.querySelector("[data-make-something-new]")?.nextElementSibling;
		if (!(listing instanceof HTMLElement)) throw new Error("no listing wrapper");
		const scroller = document.body.firstElementChild;
		if (!(scroller instanceof HTMLElement)) throw new Error("no scroller");
		scroller.style.overflowY = "auto";
		scroller.scrollTop = 290;
		listing.style.scrollMarginTop = "60px";
		const rectAt = (y: number) =>
			DOMRect.fromRect(
				{
					x: 0,
					y,
					width: 960,
					height: 0,
				},
			);
		let top = 30;
		vi.spyOn(scroller, "getBoundingClientRect").mockImplementation(() => rectAt(0));
		vi.spyOn(listing, "getBoundingClientRect").mockImplementation(() => rectAt(top));

		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Filter and sort",
				},
			),
		);
		const submenu = await openSubmenu(await screen.findByRole("menu"), "Sort by");
		const radio = (name: string) =>
			within(submenu).getByRole(
				"menuitemradio",
				{
					name,
				},
			);
		fireEvent.click(radio("Last opened"));
		const repick = scroller.scrollTop;
		fireEvent.click(radio("Last edited"));
		await waitFor(() =>
		{
			expect(
				{
					...router.state.location.search,
				},
			).toStrictEqual(
				{
					sort: "edited",
				},
			);
		});
		await waitFor(() =>
		{
			expect(scroller.scrollTop).toBe(260);
		});
		const scrolled =
		{
			scrollTop: scroller.scrollTop,
			focus: document.activeElement?.textContent,
		};
		top = 100;
		fireEvent.click(radio("Last opened"));
		await waitFor(() =>
		{
			expect(
				{
					...router.state.location.search,
				},
			).toStrictEqual({});
		});
		const belowHeader = scroller.scrollTop;

		// Upstream cce84abcc's listing key: any filter or search change scrolls the list top back too.
		const afterChange = async (change: () => Promise<void> | void, search: Record<string, string>) =>
		{
			scroller.scrollTop = 290;
			top = 30;
			await change();
			await waitFor(() =>
			{
				expect(
					{
						...router.state.location.search,
					},
				).toStrictEqual(search);
			});
			await waitFor(() =>
			{
				expect(scroller.scrollTop).toBe(260);
			});
			return scroller.scrollTop;
		};
		// The Filter and sort menu stays open across picks; open each submenu from its root.
		const filterMenu = async (label: string) =>
		{
			const menu = screen.getAllByRole("menu")[0];
			if (menu === undefined) throw new Error("no menu");
			return openSubmenu(menu, label);
		};
		const opened = await afterChange(
			async () =>
			{
				fireEvent.click(
					within(await filterMenu("Date opened")).getByRole(
						"menuitemradio",
						{
							name: "Past 30 days",
						},
					),
				);
			},
			{
				opened: "month",
			},
		);
		scroller.scrollTop = 290;
		top = 30;
		fireEvent.click(
			screen.getByRole(
				"menuitemradio",
				{
					name: "Past 30 days",
				},
			),
		);
		const openedRepick = scroller.scrollTop;
		const typed = await afterChange(
			async () =>
			{
				const types = await filterMenu("Type");
				const first = within(types).getAllByRole("menuitemcheckbox")[0];
				if (first === undefined) throw new Error("no type");
				fireEvent.click(first);
			},
			expect.objectContaining(
				{
					opened: "month",
					type: expect.any(String),
				},
			) as Record<string, string>,
		);
		const searched = await afterChange(
			() =>
			{
				fireEvent.click(
					screen.getByRole(
						"button",
						{
							name: "Search your artifacts",
						},
					),
				);
				fireEvent.change(
					screen.getByRole(
						"searchbox",
						{
							name: "Search your artifacts",
						},
					),
					{
						target:
						{
							value: "a",
						},
					},
				);
			},
			expect.objectContaining(
				{
					search: "a",
				},
			) as Record<string, string>,
		);

		expect(
			{
				repick,
				scrolled,
				belowHeader,
				opened,
				openedRepick,
				typed,
				searched,
				listingScrollIntoViewCalls: scrollIntoView.mock.contexts.filter((context) => context === listing)
					.length,
			},
		).toStrictEqual(
			{
				repick: 290,
				scrolled:
				{
					scrollTop: 260,
					focus: "Last edited",
				},
				belowHeader: 260,
				opened: 260,
				openedRepick: 290,
				typed: 260,
				searched: 260,
				listingScrollIntoViewCalls: 0,
			},
		);
	});

	it("writes Filter and sort picks without resetting scroll, as upstream's router.replace(…, {scroll:false})", async () =>
	{
		const router = await renderArtifactsPage("/artifacts", seedMixedGallery);
		const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);

		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Filter and sort",
				},
			),
		);
		fireEvent.click(
			within(await screen.findByRole("menu")).getByRole(
				"menuitemcheckbox",
				{
					name: "Pinned",
				},
			),
		);
		await waitFor(() =>
		{
			expect(
				{
					...router.state.location.search,
				},
			).toStrictEqual(
				{
					pinned: 1,
				},
			);
		});

		expect(scrollTo.mock.calls).toStrictEqual([]);
	});

	it("reads ?type= and ?owner= items trimmed and lowercased but Date opened exactly, leaving the URL as typed, as upstream's codec", async () =>
	{
		const router = await renderArtifactsPage(
			"/artifacts?type=Docs,%20SLIDES&owner=%20ME%20&opened=Today",
			seedMixedGallery,
		);

		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "3 filters on",
				},
			),
		);
		const menu = await screen.findByRole("menu");

		// Upstream derives the state without a URL replace: the address bar stays exactly as typed.
		expect(
			{
				href: router.history.location.href,
				rows: menuRows(menu).slice(2, 5),
			},
		).toStrictEqual(
			{
				href: "/artifacts?type=Docs,%20SLIDES&owner=%20ME%20&opened=Today",
				rows: ["menuitem:Owner=You", "menuitem:Type=2 picked", "menuitem:Date opened=Any time"],
			},
		);
	});

	it("reads legacy ?tab=pinned as the Pinned filter without rewriting the URL, then writes pinned=1 on the next pick", async () =>
	{
		const router = await renderArtifactsPage("/artifacts?tab=pinned", seedMixedGallery);
		const loadedHref = router.state.location.href;
		const tab = screen.getByRole(
			"tab",
			{
				selected: true,
			},
		).textContent;
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "1 filter on",
				},
			),
		);
		const menu = await screen.findByRole("menu");
		const pinned = within(menu)
			.getByRole(
				"menuitemcheckbox",
				{
					name: "Pinned",
				},
			)
			.getAttribute("aria-checked");
		const submenu = await openSubmenu(menu, "Sharing");
		fireEvent.click(
			within(submenu).getByRole(
				"menuitemradio",
				{
					name: "Shared",
				},
			),
		);
		await waitFor(() =>
		{
			expect(
				{
					...router.state.location.search,
				},
			).toStrictEqual(
				{
					sharing: "shared",
					pinned: 1,
				},
			);
		});

		expect(
			{
				loadedHref,
				tab,
				pinned,
			},
		).toStrictEqual(
			{
				loadedHref: "/artifacts?tab=pinned",
				tab: "All",
				pinned: "true",
			},
		);
	});

	it("offers Clear filters only while a filter is on, in the menu and under the filter-empty text, and it resets the URL", async () =>
	{
		await renderArtifactsPage("/artifacts", seedMixedGallery);
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Filter and sort",
				},
			),
		);
		const resting = menuRows(await screen.findByRole("menu")).includes("menuitem:Clear filters");
		cleanup();

		const router = await renderArtifactsPage("/artifacts?tab=mine&type=slides&opened=week", seedMixedGallery);
		const emptyClear = screen.getByRole(
			"button",
			{
				name: "Clear filters",
			},
		).tagName;
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "2 filters on",
				},
			),
		);
		const menu = await screen.findByRole("menu");
		const filtered = menuRows(menu).slice(-2);
		fireEvent.click(
			within(menu).getByRole(
				"menuitem",
				{
					name: "Clear filters",
				},
			),
		);

		await waitFor(() =>
		{
			expect(
				{
					...router.state.location.search,
				},
			).toStrictEqual(
				{
					tab: "mine",
				},
			);
		});
		expect(
			{
				resting,
				emptyClear,
				filtered,
			},
		).toStrictEqual(
			{
				resting: false,
				emptyClear: "BUTTON",
				filtered: ["──", "menuitem:Clear filters"],
			},
		);
	});

	it("still reads a single legacy ?type= and drops it on Clear filters under the empty text", async () =>
	{
		const router = await renderArtifactsPage("/artifacts?type=other", seedMixedGallery);
		const rows = galleryRows().length;

		cleanup();
		const emptyRouter = await renderArtifactsPage("/artifacts?type=slides", seedMixedGallery);
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Clear filters",
				},
			),
		);

		await waitFor(() =>
		{
			expect(
				{
					...emptyRouter.state.location.search,
				},
			).toStrictEqual({});
		});
		expect(
			{
				rows,
				search:
				{
					...router.state.location.search,
				},
			},
		).toStrictEqual(
			{
				rows: 14,
				search:
				{
					type: "other",
				},
			},
		);
	});

	it("draws upstream's filter-empty block: muted status copy over a secondary Clear filters button", async () =>
	{
		await renderArtifactsPage("/artifacts?type=slides", seedMixedGallery);
		const status = screen.getByText("Nothing matches. Try clearing a filter.");
		const clear = screen.getByRole(
			"button",
			{
				name: "Clear filters",
			},
		);
		expect(
			{
				status: [status.tagName, status.getAttribute("role"), status.className],
				block: status.parentElement?.className,
				clear: [clear.parentElement === status.parentElement, clear.className],
			},
		).toStrictEqual(
			{
				status: ["SPAN", "status", ""],
				block: "mt-10 flex flex-col items-center gap-3 text-body text-muted-as-secondary",
				clear: [
					true,
					"inline-flex h-7 shrink-0 items-center justify-center rounded-r6 px-[9px] text-body text-primary bg-fill-secondary shadow-[inset_0_0_0_1px_var(--color-border),0_1px_2px_rgb(0_0_0/0.05)] transition-shadow hover:bg-fill-secondary-hover hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-focus",
				],
			},
		);
	});

	it("shows upstream's empty text for a type with no artifacts and paints the pressed trigger", async () =>
	{
		await renderArtifactsPage("/artifacts?type=slides", seedMixedGallery);

		const trigger = screen.getByRole(
			"button",
			{
				name: "1 filter on",
			},
		);
		expect(
			{
				pressed: trigger.getAttribute("aria-pressed"),
				paint: ["aria-pressed:bg-upstream-accent-pressed", "aria-pressed:text-upstream-accent"].filter(
					(name) => !trigger.classList.contains(name),
				),
				icon: trigger.querySelector("svg")?.classList.contains("lucide-sliders-vertical"),
				statuses: pageStatuses(),
			},
		).toStrictEqual(
			{
				pressed: "true",
				paint: [],
				icon: true,
				statuses: ["", "Nothing matches. Try clearing a filter."],
			},
		);
	});

	function groupedTitles()
	{
		return galleryLists().map((list) => (
		{
			heading: document.getElementById(list.getAttribute("aria-labelledby") ?? "")?.textContent,
			rows: within(list)
				.getAllByRole("listitem")
				.map((row) => rowSummary(row).title),
		}));
	}

	it("offers Pin and Copy link from the row's More options menu and its context menu", async () =>
	{
		await renderArtifactsPage("/artifacts", true);

		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "More options for Quarterly plan",
				},
			),
		);
		const menu = (await screen.findAllByRole("menuitem")).map((item) => item.textContent);
		fireEvent.keyDown(
			screen.getByRole("menu"),
			{
				key: "Escape",
			},
		);
		await waitFor(() =>
		{
			expect(screen.queryByRole("menu")).toBeNull();
		});

		fireEvent.contextMenu(
			screen.getByRole(
				"link",
				{
					name: "Quarterly plan",
				},
			),
			{
				clientX: 40,
				clientY: 50,
			},
		);
		const contextMenu = (await screen.findAllByRole("menuitem")).map((item) => item.textContent);

		expect(
			{
				menu,
				contextMenu,
			},
		).toStrictEqual(
			{
				menu: ["PinP", "Copy linkC"],
				contextMenu: ["PinP", "Copy linkC"],
			},
		);
	});

	it("leaves a grid card's right-click to the browser's link menu, as upstream does, and keeps its More options menu", async () =>
	{
		storage.setItem(ARTIFACTS_LAYOUT_STORAGE_KEY, "grid");
		await renderArtifactsPage("/artifacts", true);
		const prevented = !fireEvent.contextMenu(
			screen.getByRole(
				"link",
				{
					name: "Quarterly plan",
				},
			),
			{
				clientX: 40,
				clientY: 50,
			},
		);
		await act(async () =>
		{
			await Promise.resolve();
		});
		const contextMenu = screen.queryByRole("menu");
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "More options for Quarterly plan",
				},
			),
		);
		const menu = (await screen.findAllByRole("menuitem")).map((item) => item.textContent);

		expect(
			{
				prevented,
				contextMenu,
				menu,
			},
		).toStrictEqual(
			{
				prevented: false,
				contextMenu: null,
				menu: ["PinP", "Copy linkC"],
			},
		);
	});

	it("gives the card menu upstream's P / C keycaps, row hooks and 6px offset, and fires a row by its letter", async () =>
	{
		const writeText = vi.fn<(text: string) => Promise<void>>(async (_text: string) => {});
		Object.defineProperty(
			navigator,
			"clipboard",
			{
				configurable: true,
				value:
				{
					writeText,
				},
			},
		);
		await renderArtifactsPage("/artifacts", true);

		const card = screen
			.getByRole(
				"link",
				{
					name: "Asap Ladder Queue",
				},
			)
			.closest<HTMLElement>("li")!;
		fireEvent.click(
			within(card).getByRole(
				"button",
				{
					name: "More options for Asap Ladder Queue",
				},
			),
		);
		const menu = await screen.findByRole("menu");
		const rows = screen.getAllByRole("menuitem").map((item) => (
		{
			row: item.getAttribute("data-artifact-row"),
			keys: item.getAttribute("aria-keyshortcuts"),
			cap: item.querySelector("kbd")?.textContent,
			capHidden: item.querySelector("kbd")?.closest(".pointer-coarse\\:hidden") !== null,
		}));
		const offset = menu.closest("[data-side-offset]")?.getAttribute("data-side-offset");
		fireEvent.keyDown(
			menu,
			{
				key: "c",
			},
		);

		expect(
			{
				rows,
				offset,
				toast: (await screen.findByText("Link copied to clipboard.")).textContent,
				copied: writeText.mock.calls,
			},
		).toStrictEqual(
			{
				rows: [
					{
						row: "pin",
						keys: "p",
						cap: "P",
						capHidden: true,
					},
					{
						row: "copy_link",
						keys: "c",
						cap: "C",
						capHidden: true,
					},
				],
				offset: "6",
				toast: "Link copied to clipboard.",
				copied: [[LADDER_URL]],
			},
		);
	});

	it("moves a pinned row under Pinned, stores it per browser and unpins from the hover button", async () =>
	{
		await renderArtifactsPage("/artifacts", true);

		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "More options for Quarterly plan",
				},
			),
		);
		fireEvent.click(
			await screen.findByRole(
				"menuitem",
				{
					name: "Pin",
				},
			),
		);

		await waitFor(() =>
		{
			expect(galleryLists()).toHaveLength(3);
		});
		const pinned =
		{
			groups: groupedTitles(),
			stored: JSON.parse(storage.getItem(ARTIFACT_PIN_STORAGE_KEY) ?? "null"),
		};

		const unpin = within(
			screen
				.getByRole(
					"link",
					{
						name: "Quarterly plan",
					},
				)
				.closest<HTMLElement>("li")!,
		).getByRole(
			"button",
			{
				name: "Unpin",
			},
		);
		const unpinIcon =
		{
			pin: unpin.querySelector("svg")?.classList.contains("lucide-pin"),
			fill: unpin.querySelector("svg")?.getAttribute("fill"),
		};
		fireEvent.click(unpin);

		expect(
			{
				pinned,
				unpinIcon,
				unpinned: groupedTitles(),
			},
		).toStrictEqual(
			{
				unpinIcon:
				{
					pin: true,
					fill: "currentColor",
				},
				pinned:
				{
					groups: [
						{
							heading: "Pinned",
							rows: ["Quarterly plan"],
						},
						{
							heading: artifactDateGroupLabel(localMs(2026, 8, 26, 15), new Date()),
							rows: ["Asap Ladder Queue"],
						},
						{
							heading: artifactDateGroupLabel(localMs(2026, 5, 10), new Date()),
							rows: ["household-cash.html"],
						},
					],
					stored: [DOCS_URL],
				},
				unpinned: [
					{
						heading: artifactDateGroupLabel(localMs(2026, 8, 26, 15), new Date()),
						rows: ["Asap Ladder Queue"],
					},
					{
						heading: artifactDateGroupLabel(localMs(2026, 5, 10), new Date()),
						rows: ["household-cash.html"],
					},
					{
						heading: artifactDateGroupLabel(localMs(2025, 10, 3), new Date()),
						rows: ["Quarterly plan"],
					},
				],
			},
		);
	});

	it("splits the grid into upstream's Pinned / Other artifacts sections only while something is pinned", async () =>
	{
		storage.setItem(ARTIFACTS_LAYOUT_STORAGE_KEY, "grid");
		const gridSections = () => (
		{
			wrapper: document.querySelector(GALLERY_SECTION)?.parentElement?.className ?? null,
			sections: Array.from(document.querySelectorAll(GALLERY_SECTION)).map((section) => (
			{
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
		const unpinned =
		{
			sections: gridSections(),
			headings: outsideStrip(
				screen.queryAllByRole(
					"heading",
					{
						level: 2,
					},
				),
			).length,
		};
		cleanup();

		storage.setItem(ARTIFACT_PIN_STORAGE_KEY, JSON.stringify([DOCS_URL]));
		await renderArtifactsPage("/artifacts", true);

		const headingClass = "px-0 py-1 text-caption font-medium text-ink-muted";
		expect(
			{
				unpinned,
				pinned: gridSections(),
			},
		).toStrictEqual(
			{
				unpinned:
				{
					sections:
					{
						wrapper: null,
						sections: [],
					},
					headings: 0,
				},
				pinned:
				{
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
			},
		);
	});

	it("copies the claude.ai artifact URL and toasts", async () =>
	{
		const writeText = vi.fn<(text: string) => Promise<void>>(async (_text: string) => {});
		Object.defineProperty(
			navigator,
			"clipboard",
			{
				configurable: true,
				value:
				{
					writeText,
				},
			},
		);
		await renderArtifactsPage("/artifacts", true);

		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "More options for Asap Ladder Queue",
				},
			),
		);
		fireEvent.click(
			await screen.findByRole(
				"menuitem",
				{
					name: "Copy link",
				},
			),
		);

		expect(
			{
				toast: (await screen.findByText("Link copied to clipboard.")).textContent,
				copied: writeText.mock.calls,
			},
		).toStrictEqual(
			{
				toast: "Link copied to clipboard.",
				copied: [[LADDER_URL]],
			},
		);
	});
});

describe("artifact cover thumbnails", () =>
{
	const thumbFor = (artifact: ArtifactSummary) => `/api/artifacts/${artifact.id}/thumbnail?v=1`;

	function coverFor(name: string): HTMLElement
	{
		const cover = screen
			.getByRole(
				"link",
				{
					name,
				},
			)
			.closest("li")
			?.querySelector<HTMLElement>("[data-artifact-cover]");
		if (cover === null || cover === undefined) throw new Error(`no cover for ${name}`);
		return cover;
	}

	function describeWashes(cover: HTMLElement)
	{
		return [...cover.querySelectorAll<HTMLElement>("[data-cover-wash]")].map((wash) => (
		{
			src: wash.dataset["coverWash"],
			opacity: [...wash.classList].filter((name) => name.startsWith("opacity-")),
			img: wash.querySelector("img")?.getAttribute("class") ?? null,
			imgSrc: wash.querySelector("img")?.getAttribute("src") ?? null,
		}));
	}

	beforeEach(() =>
	{
		storage.removeItem(ARTIFACTS_LAYOUT_STORAGE_KEY);
	});

	it("puts a file thumbnail in upstream's light wrapper on a cropped front sheet with the dark veil", async () =>
	{
		await renderArtifactsPage("/artifacts", true, (artifact) =>
			artifact.kind === "html" ? thumbFor(artifact) : null,
		);
		const cover = coverFor("Asap Ladder Queue");
		const front = cover.querySelector("[data-cover-front]");
		const light = front?.firstElementChild;
		const img = light?.firstElementChild;

		expect(
			{
				front: front?.getAttribute("class"),
				light: [light?.getAttribute("data-cover-light"), light?.getAttribute("class")],
				img: [img?.tagName, img?.getAttribute("class"), img?.getAttribute("src")],
				blank: front?.querySelector("svg[data-artifact-cover-blank]") ?? null,
				hairline: cover.lastElementChild?.getAttribute("class"),
			},
		).toStrictEqual(
			{
				front: "absolute overflow-hidden border border-[color:var(--color-border-line)] bg-white text-primary dark:bg-surface-1 dark:bg-clip-padding after:pointer-events-none after:absolute after:inset-0 after:content-[''] isolate inset-x-0 mx-auto top-[20%] h-full w-[76%] z-2 bg-clip-padding [&>img]:aspect-[1200/630] [&>[data-cover-light]>img]:aspect-[1200/630] rounded-lg dark:group-has-[[data-cover-light]>img]/cover:bg-white dark:group-has-[[data-cover-light]>img]/cover:after:bg-gray-900/20",
				light: ["", "h-full"],
				img: [
					"IMG",
					"block w-full object-cover object-left-top",
					thumbFor(
						{
							id: "546d3910-4e9a-4730-9e91-62742a47c7c6",
						} as ArtifactSummary,
					),
				],
				blank: null,
				hairline: "absolute inset-x-0 bottom-0 z-3 h-px bg-alpha-2",
			},
		);
	});

	it("inverts a Docs thumbnail in dark mode and ends the cover with the hairline, as upstream", async () =>
	{
		await renderArtifactsPage("/artifacts", true, thumbFor);
		const cover = coverFor("Quarterly plan");
		const front = cover.querySelector("[data-cover-front]");
		const light = front?.firstElementChild;

		expect(
			{
				front: front?.getAttribute("class"),
				light: [light?.getAttribute("data-cover-light"), light?.getAttribute("class")],
				img: light?.querySelector("img")?.getAttribute("class"),
				hairline: cover.lastElementChild?.getAttribute("class"),
			},
		).toStrictEqual(
			{
				front: "absolute overflow-hidden border border-[color:var(--color-border-line)] bg-white text-primary dark:bg-surface-1 dark:bg-clip-padding after:pointer-events-none after:absolute after:inset-0 after:content-[''] isolate inset-x-0 mx-auto top-[20%] h-full w-[76%] z-2 bg-clip-padding [&>img]:aspect-[1005/630] [&>[data-cover-light]>img]:aspect-[1005/630] rounded-lg [&>img]:mix-blend-lighten",
				light: [
					"inverted",
					"h-full dark:has-[>img]:mix-blend-screen dark:has-[>img]:hue-rotate-180 dark:has-[>img]:invert",
				],
				img: "block w-full object-cover object-top",
				hairline: "absolute inset-x-0 bottom-0 z-3 h-px bg-alpha-2",
			},
		);
	});

	it("keeps a Docs thumbnail's back sheet over the washes with no doodle, with upstream's same percentage geometry", async () =>
	{
		await renderArtifactsPage("/artifacts", true, thumbFor);
		const cover = coverFor("Quarterly plan");
		const back = cover.querySelector(":scope > [data-cover-back]");

		expect(
			{
				layers: [...cover.children].map((child) =>
					child.hasAttribute("data-cover-back")
						? "back"
						: child.hasAttribute("data-cover-front")
							? "front"
							: child.classList.contains("dark:contents")
								? "dark cover wash"
								: child.classList.contains("dark:hidden")
									? "light ground"
									: child.hasAttribute("data-cover-veil")
										? "veil"
										: child.tagName === "svg"
											? "wash filter"
											: child.tagName === "SPAN"
												? "doodle"
												: child.classList.contains("h-px")
													? "hairline"
													: "surface wash",
				),
				back: [back?.getAttribute("dir"), back?.getAttribute("class")],
				hasImg: cover.matches(":has(img)"),
			},
		).toStrictEqual(
			{
				layers: [
					"surface wash",
					"wash filter",
					"dark cover wash",
					"light ground",
					"veil",
					"back",
					"front",
					"hairline",
				],
				back: [
					"ltr",
					"absolute overflow-hidden border border-[color:var(--color-border-line)] bg-white text-primary dark:bg-surface-1 dark:bg-clip-padding after:pointer-events-none after:absolute after:inset-0 after:content-[''] start-[14.15%] top-[11.76%] h-full w-[76.34%] origin-top-left rotate-[2.2deg] rounded-r6 after:bg-gray-900/5 z-2 bg-clip-padding",
				],
				hasImg: true,
			},
		);
	});

	it("fades the hue and ground washes in under the sheet once the thumbnail loads, and out again on error", async () =>
	{
		await renderArtifactsPage("/artifacts", true, thumbFor);
		const cover = coverFor("Asap Ladder Queue");
		// The wash copies the loaded img's resolved src, as upstream reads `img.src`.
		const src = new URL(cover.querySelector("[data-cover-light] > img")?.getAttribute("src") ?? "", location.href)
			.href;
		const filter = cover.querySelector(":scope > svg > filter");
		const describeVeil = () =>
		{
			const veil = cover.querySelector<HTMLElement>(":scope > [data-cover-veil]");
			return [veil?.dataset["coverWaiting"] ?? null, veil?.getAttribute("class")];
		};
		const veilClass = (opacity: string) =>
			`pointer-events-none absolute inset-0 bg-gray-100 transition-opacity duration-base motion-reduce:transition-none dark:bg-gray-700 ${opacity} z-1`;
		const washClass = cover.querySelector("[data-cover-wash]")?.getAttribute("class");
		const before = describeWashes(cover);
		const veilBefore = describeVeil();
		fireEvent.load(cover.querySelector("[data-cover-light] > img")!);
		const loaded = describeWashes(cover);
		const veilLoaded = describeVeil();
		fireEvent.error(cover.querySelector("[data-cover-light] > img")!);

		const resting =
		{
			src: "",
			opacity: ["opacity-0"],
			img: null,
			imgSrc: null,
		};
		const shown =
		{
			src,
			opacity: ["opacity-100"],
			img: "absolute start-0 top-0 size-[4px]",
			imgSrc: src,
		};
		expect(
			{
				svg: cover.querySelector(":scope > svg")?.getAttribute("class"),
				filter: [
					filter?.getAttribute("color-interpolation-filters"),
					[...cover.querySelectorAll<HTMLElement>("[data-cover-wash]")].map(
						(wash) => wash.style.filter === `url("#${filter?.id}")`,
					),
					[...(filter?.children ?? [])].map(
						(child) => child.getAttribute("result") ?? child.getAttribute("operator"),
					),
				],
				washClass,
				placement: [
					cover.querySelector(":scope > .dark\\:contents > [data-cover-wash]") !== null,
					[...cover.querySelectorAll<HTMLElement>("*")].filter((element) => element.style.maskImage !== "")
						.length,
				],
				before,
				loaded,
				veil: [veilBefore, veilLoaded, describeVeil()],
				errored:
				{
					washes: describeWashes(cover),
					blank: cover
						.querySelector("[data-cover-front] svg[data-artifact-cover-blank]")
						?.getAttribute("data-artifact-cover-blank"),
				},
			},
		).toStrictEqual(
			{
				svg: "absolute size-0",
				filter: [
					"sRGB",
					[true, false, false],
					["one", "tiles", "mean", "above", "below", "spread", "strength", "in"],
				],
				washClass: "pointer-events-none absolute -inset-[8px] z-1 mix-blend-hue opacity-0",
				placement: [true, 0],
				before: [resting, resting, resting],
				loaded: [shown, shown, shown],
				veil: [
					["", veilClass("opacity-100")],
					[null, veilClass("opacity-0")],
					[null, veilClass("opacity-0")],
				],
				errored:
				{
					washes: [resting, resting, resting],
					blank: "other",
				},
			},
		);
	});

	it("hides the hue wash in light mode behind upstream's light-only card ground layer", async () =>
	{
		await renderArtifactsPage("/artifacts", true, thumbFor);
		const hover =
			"group-hover:[--card-colour:var(--card-colour-hover)] group-hover:[--card-grey:var(--card-grey-hover)] group-has-[:focus-visible]:[--card-colour:var(--card-colour-hover)] group-has-[:focus-visible]:[--card-grey:var(--card-grey-hover)] group-has-[[aria-expanded=true]]:[--card-colour:var(--card-colour-hover)] group-has-[[aria-expanded=true]]:[--card-grey:var(--card-grey-hover)]";
		const describeGround = (name: string) =>
		{
			const cover = coverFor(name);
			fireEvent.load(cover.querySelector("[data-cover-light] > img")!);
			const ground = cover.querySelector<HTMLElement>(":scope > .dark\\:hidden");
			const firstWash = cover.querySelector("[data-cover-wash]");
			return {
				hueWrapper: firstWash?.parentElement?.getAttribute("class"),
				ground: [
					ground?.getAttribute("class"),
					ground?.style.backgroundColor,
					ground?.style.getPropertyValue("--card-colour-rest"),
					ground?.style.getPropertyValue("--card-colour-hover"),
					ground?.style.getPropertyValue("--card-grey-rest"),
					ground?.style.getPropertyValue("--card-grey-hover"),
				],
				layers: [...(ground?.children ?? [])].map((child) =>
					child.tagName === "svg"
						? `filter ${child.querySelector("filter")?.childElementCount}`
						: child.hasAttribute("data-cover-wash")
							? `wash ${child.getAttribute("class")}`
							: `hover ${child.getAttribute("class")} ${(child as HTMLElement).style.backgroundColor}`,
				),
			};
		};
		const wash = "pointer-events-none absolute -inset-[8px] z-1";
		const groundClass = `absolute inset-0 isolate overflow-hidden dark:hidden [--card-colour:var(--card-colour-rest)] [--card-grey:var(--card-grey-rest)] ${hover}`;
		const hoverLayer =
			"hover absolute inset-0 opacity-0 group-hover:opacity-100 group-has-[:focus-visible]:opacity-100 group-has-[[aria-expanded=true]]:opacity-100";

		expect(
			{
				file: describeGround("Asap Ladder Queue"),
				docs: describeGround("Quarterly plan"),
			},
		).toStrictEqual(
			{
				file:
				{
					hueWrapper: "hidden dark:contents",
					ground: [groundClass, "rgb(241, 241, 241)", "#fadac2", "#f8cbaa", "#f1f1f1", "#e6e6e6"],
					layers: [
						`${hoverLayer} rgb(230, 230, 230)`,
						"filter 11",
						`wash ${wash} opacity-100`,
						"filter 8",
						`wash ${wash} mix-blend-hue opacity-100`,
					],
				},
				docs:
				{
					hueWrapper: "hidden dark:contents",
					ground: [groundClass, "rgb(223, 236, 253)", "#fadac2", "#f8cbaa", "#f1f1f1", "#e6e6e6"],
					layers: [`${hoverLayer} rgb(205, 225, 251)`, "filter 8", `wash ${wash} mix-blend-hue opacity-100`],
				},
			},
		);
	});

	it("draws no hue wash or img for an artifact without a thumbnail, only the light ground's empty washes", async () =>
	{
		await renderArtifactsPage("/artifacts", true);
		const cover = coverFor("Asap Ladder Queue");

		expect(
			{
				washes: describeWashes(cover),
				groundWashes: cover.querySelectorAll(":scope > .dark\\:hidden > [data-cover-wash]").length,
				filters: cover.querySelectorAll(":scope > svg").length,
				imgs: cover.querySelectorAll("img").length,
				light: cover.querySelectorAll("[data-cover-light]").length,
				veil: [...cover.querySelectorAll<HTMLElement>(":scope > [data-cover-veil]")].map((veil) => [
					veil.dataset["coverWaiting"] ?? null,
					veil.getAttribute("class"),
				]),
			},
		).toStrictEqual(
			{
				washes: [0, 1].map(() => (
				{
					src: "",
					opacity: ["opacity-0"],
					img: null,
					imgSrc: null,
				})),
				groundWashes: 2,
				filters: 0,
				imgs: 0,
				light: 0,
				veil: [
					[
						null,
						"pointer-events-none absolute inset-0 bg-gray-100 transition-opacity duration-base motion-reduce:transition-none dark:bg-gray-700 opacity-0 z-1",
					],
				],
			},
		);
	});

	it("loads the first 6 thumbnails eagerly at high priority when nothing is pinned, and every one lazily after a pinned section", async () =>
	{
		const describeLoading = () =>
			[...document.querySelectorAll("[data-cover-light] > img")].map((img) =>
				[img.getAttribute("loading"), img.getAttribute("fetchpriority")].join(" "),
			);
		await renderArtifactsPage("/artifacts", seedMixedGallery, thumbFor);
		const unpinned = describeLoading();
		cleanup();
		storage.setItem(ARTIFACT_PIN_STORAGE_KEY, JSON.stringify(["https://claude.ai/code/artifact/mixed-03"]));
		await renderArtifactsPage("/artifacts", seedMixedGallery, thumbFor);

		expect(
			{
				unpinned,
				pinned: [...new Set(describeLoading())],
			},
		).toStrictEqual(
			{
				unpinned: [
					...Array.from(
						{
							length: 6,
						},
						() => "eager high",
					),
					...Array.from(
						{
							length: 10,
						},
						() => "lazy ",
					),
				],
				pinned: ["lazy "],
			},
		);
	});
});

describe("Make something new strip", () =>
{
	beforeEach(() =>
	{
		storage.removeItem(ARTIFACTS_LAYOUT_STORAGE_KEY);
	});

	it("shows upstream's four template tiles above the grid, each linking home with ?create=<slug>", async () =>
	{
		await renderArtifactsPage("/artifacts", true);
		const strip = screen.getByRole(
			"region",
			{
				name: "Make something new",
			},
		);
		const links = within(strip).getAllByRole("link");

		expect(
			{
				heading: within(strip).getByRole(
					"heading",
					{
						level: 2,
					},
				).className,
				links: links.map((link) => (
				{
					name: link.getAttribute("aria-label"),
					href: link.getAttribute("href"),
					label: link.textContent,
				})),
				descriptions: links.map(
					(link) => document.getElementById(link.getAttribute("aria-describedby") ?? "")?.className,
				),
				beforeGrid:
					strip.compareDocumentPosition(document.querySelector("[data-gallery-card]") ?? strip) &
					Node.DOCUMENT_POSITION_FOLLOWING,
			},
		).toStrictEqual(
			{
				heading: "text-caption font-medium text-ink-muted",
				links: [
					{
						name: "Docs",
						href: "/?create=pages",
						label: "DocsBy Anthropic. A document your team reads, comments on and edits in place while Claude keeps it current.",
					},
					{
						name: "Slides",
						href: "/?create=slides",
						label: "SlidesBy Anthropic. A deck you can present, restyle with a design system and export to PowerPoint.",
					},
					{
						name: "Design",
						href: "/?create=design",
						label: "DesignBy Anthropic. Screens, flows and graphics laid out as artboards on one canvas you can edit by hand.",
					},
					{
						name: "Data, Beta",
						href: "/?create=dashboard",
						label: "DataBetaBy Anthropic. Charts, numbers and tables from your data, each marked with its source.",
					},
				],
				descriptions: [
					"sr-only select-none",
					"sr-only select-none",
					"sr-only select-none",
					"sr-only select-none",
				],
				beforeGrid: Node.DOCUMENT_POSITION_FOLLOWING,
			},
		);
	});

	it("draws upstream's solid hue tiles with a 12% grain, a 56px glyph and a 103% hover grow, and stays while searching", async () =>
	{
		await renderArtifactsPage("/artifacts?search=zzz-no-match", true);
		const strip = screen.getByRole(
			"region",
			{
				name: "Make something new",
			},
		);
		const tiles = [...strip.querySelectorAll<HTMLElement>("[data-template-tile]")];
		const docs = tiles[0];

		expect(
			{
				tile: docs?.className,
				hues: tiles.map((tile) => [...tile.classList].filter((name) => name.includes("cds-")).join(" ")),
				grain: docs?.querySelector("svg feTurbulence")?.closest("span")?.className,
				turbulence: ["type", "baseFrequency", "numOctaves", "seed"].map((name) =>
					docs?.querySelector("feTurbulence")?.getAttribute(name),
				),
				displacement: docs?.querySelector("feDisplacementMap")?.getAttribute("scale"),
				glyph: docs?.querySelector(":scope > span.relative > svg")?.getAttribute("class")?.includes("size-14"),
				link: strip.querySelector("a")?.classList.contains("duration-150"),
			},
		).toStrictEqual(
			{
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
			},
		);
	});
});
