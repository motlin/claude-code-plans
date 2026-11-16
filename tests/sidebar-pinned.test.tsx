// @vitest-environment jsdom

import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import
{
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	Outlet,
	RouterProvider,
} from "@tanstack/react-router";
import {act, cleanup, fireEvent, render, screen, waitFor} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it} from "vite-plus/test";

import {SessionGroups} from "../src/components/sidebar/session-groups";
import {SettingsProvider} from "../src/components/settings-provider";
import {ToastProvider} from "../src/components/toast";
import {RecentSessionsResponse, recentSessionsInfiniteQueryOptions} from "../src/lib/api/sessions";
import {PIN_STORAGE_KEY, readPinState} from "../src/lib/pin-store";
import {DEFAULT_SESSION_LIST_PREFS} from "../src/lib/session-groups";
import type {SessionBucket} from "../src/lib/session-state";
import {DEFAULT_SIDEBAR_STATE, readSidebarState, SIDEBAR_STORAGE_KEY} from "../src/lib/sidebar-store";
import {installLocalStorage} from "./fake-storage";
import {rowTitle} from "./sidebar-row-title";

const MINUTE = 60 * 1000;

function session(id: string, title: string, bucket: SessionBucket, minutesAgo: number, forkedFromSessionId?: string)
{
	const mtime = new Date(Date.now() - minutesAgo * MINUTE).toISOString();
	return {
		...(forkedFromSessionId === undefined
			? {}
			:
				{
					forkedFromSessionId,
				}),
		id,
		title,
		mtime,
		created: mtime,
		project: `-projects-${id}`,
		projectName: `project-${id}`,
		messageCount: 4,
		archived: false,
		state: bucket === "working" ? "working" : bucket === "blocked" ? "waiting" : "idle",
		bucket,
		liveAgentCount: 0,
		unseen: bucket === "review",
		blockedSince: null,
	};
}

const FIXTURE = [
	session("d1", "Completed newest", "done", 5),
	session("w1", "Working one", "working", 1),
	session("r1", "Review one", "review", 2),
	session("b1", "Blocked one", "blocked", 3),
	session("d2", "Completed older", "done", 30),
];

function seedPins(pinnedIds: string[], pinnedOrder: string[] = []): void
{
	localStorage.setItem(
		PIN_STORAGE_KEY,
		JSON.stringify(
			{
				pinnedIds,
				pinnedOrder,
			},
		),
	);
}

async function renderGroups(sessions: unknown[], activeItemId: string | null = null)
{
	const queryClient = new QueryClient(
		{
			defaultOptions:
			{
				queries:
				{
					retry: false,
					staleTime: Infinity,
					gcTime: Infinity,
					refetchOnMount: false,
				},
			},
		},
	);
	queryClient.setQueryData(
		recentSessionsInfiniteQueryOptions().queryKey,
		{
			pages: [
				RecentSessionsResponse.parse(
					{
						sessions,
						nextCursor: null,
					},
				),
			],
			pageParams: [null],
		},
	);
	const rootRoute = createRootRoute(
		{
			component: () => (
				<SettingsProvider>
					<QueryClientProvider client={queryClient}>
						<ToastProvider>
							<SessionGroups
								activeItemId={activeItemId}
								prefs={
								{
									...DEFAULT_SESSION_LIST_PREFS,
									groupBy: "state",
								}}
							/>
							<Outlet />
						</ToastProvider>
					</QueryClientProvider>
				</SettingsProvider>
			),
		},
	);
	const homeRoute = createRoute(
		{
			getParentRoute: () => rootRoute,
			path: "/",
			component: () => null,
		},
	);
	const sessionRoute = createRoute(
		{
			getParentRoute: () => rootRoute,
			path: "/session/$id",
			component: () => null,
		},
	);
	const router = createRouter(
		{
			routeTree: rootRoute.addChildren([homeRoute, sessionRoute]),
			history: createMemoryHistory(
				{
					initialEntries: ["/"],
				},
			),
		},
	);
	await router.load();
	const result = render(<RouterProvider router={router} />);
	await waitFor(() =>
	{
		expect(result.container.querySelector("[data-group-toggle]")).toBeTruthy();
	});
	return result;
}

function pinnedSessions(count: number)
{
	return Array.from(
		{
			length: count,
		},
		(_, index) => session(`p${index}`, `Pinned ${index}`, "done", index + 1),
	);
}

function pinnedSection(container: HTMLElement): HTMLElement
{
	const section = container.querySelector('[data-testid="sidebar-pinned"]');
	if (!(section instanceof HTMLElement)) throw new Error("no Pinned section");
	return section;
}

function rowTitles(element: Element | null): string[]
{
	if (element === null) return [];
	return [...element.querySelectorAll("a[data-row-main-button]")]
		.filter((link) => link.closest("[hidden]") === null)
		.map((link) => rowTitle(link));
}

function visibleGroupNames(container: HTMLElement): string[]
{
	return [...container.querySelectorAll('[data-testid="sidebar-recents"] [data-group-name]')].map(
		(node) => node.textContent,
	);
}

async function openRowMenu(title: string): Promise<HTMLElement>
{
	fireEvent.contextMenu(
		screen.getByText(title),
		{
			clientX: 40,
			clientY: 50,
		},
	);
	await act(async () =>
	{
		await new Promise((resolve) =>
		{
			setTimeout(resolve, 0);
		});
	});
	return screen.getByRole("menu");
}

function menuItemNames(menu: HTMLElement): string[]
{
	return [...menu.querySelectorAll('[role="menuitem"]')].map((item) => (item.firstChild?.textContent ?? "").trim());
}

afterEach(cleanup);

beforeEach(() =>
{
	installLocalStorage();
});

describe("sidebar Pinned section", () =>
{
	it("marks the Pinned and recents lists with the upstream data-perf-region anchors", async () =>
	{
		const {container} = await renderGroups(FIXTURE);

		expect(
			{
				pinned: pinnedSection(container).getAttribute("data-perf-region"),
				recents: container.querySelector('[data-testid="sidebar-recents"]')?.getAttribute("data-perf-region"),
			},
		).toStrictEqual(
			{
				pinned: "sidebar_pinned",
				recents: "sidebar_recents",
			},
		);
	});

	it("is a hidden, inert stub above the groups when nothing is pinned", async () =>
	{
		const {container} = await renderGroups(FIXTURE);

		const section = pinnedSection(container);
		expect(
			{
				stub: section.hasAttribute("data-stub"),
				inert: section.hasAttribute("inert"),
				reveal: section.classList.contains("df-pin-section-reveal"),
				rows: rowTitles(section),
				beforeRecents:
					section.compareDocumentPosition(
						container.querySelector('[data-testid="sidebar-recents"]') as Node,
					) === Node.DOCUMENT_POSITION_FOLLOWING,
			},
		).toEqual(
			{
				stub: true,
				inert: true,
				reveal: true,
				rows: [],
				beforeRecents: true,
			},
		);
	});

	it("lists user-ordered pins first, then the rest by Sort by", async () =>
	{
		seedPins(["r1", "w1", "d2"], ["d2", "w1"]);
		const {container} = await renderGroups(FIXTURE);

		const section = pinnedSection(container);
		expect(
			{
				stub: section.hasAttribute("data-stub"),
				inert: section.hasAttribute("inert"),
				reveal: section.classList.contains("df-pin-section-reveal"),
				label: section.querySelector("[data-group-name]")?.textContent,
				rows: rowTitles(section),
				// Upstream's `group/section relative flex flex-col gap-px`, whose gap the code list zeroes.
				relative: section.classList.contains("relative"),
				gapPx: section.classList.contains("gap-px"),
				gap0: section.classList.contains("gap-0"),
			},
		).toEqual(
			{
				stub: false,
				inert: false,
				reveal: false,
				label: "Pinned",
				rows: ["Completed older", "Working one", "Review one"],
				relative: true,
				gapPx: false,
				gap0: true,
			},
		);
	});

	it("moves pinned sessions out of their groups", async () =>
	{
		seedPins(["r1", "d2"]);
		const {container} = await renderGroups(FIXTURE);

		expect(
			{
				groups: visibleGroupNames(container),
				recents: rowTitles(container.querySelector('[data-testid="sidebar-recents"]')),
			},
		).toEqual(
			{
				groups: ["Needs input", "Working", "Idle"],
				recents: ["Blocked one", "Working one", "Completed newest"],
			},
		);
	});

	it("draws no PR tail on a pinned row, as upstream, while its unpinned twin keeps one", async () =>
	{
		seedPins(["r1"]);
		localStorage.setItem(
			"ccp-session-list-prefs",
			JSON.stringify(
				{
					...DEFAULT_SESSION_LIST_PREFS,
					showPrStatus: true,
				},
			),
		);
		const pr =
		{
			prStatus:
			{
				number: 6,
				state: "open",
			},
		};
		const {container} = await renderGroups([
			{
				...session("r1", "Review one", "review", 2),
				...pr,
			},
			{
				...session("d1", "Completed newest", "done", 5),
				...pr,
			},
		]);
		const tails = (element: Element | null) =>
			[...(element?.querySelectorAll("a[data-row-main-button] [data-pr-glyph]") ?? [])].map((node) =>
				node.getAttribute("data-pr-glyph"),
			);

		expect(
			{
				pinned: tails(pinnedSection(container)),
				recents: tails(container.querySelector('[data-testid="sidebar-recents"]')),
			},
		).toStrictEqual(
			{
				pinned: [],
				recents: ["opened"],
			},
		);
	});

	it("persists collapsing the Pinned header in collapsedGroups", async () =>
	{
		seedPins(["w1"]);
		const {container} = await renderGroups(FIXTURE);

		const section = pinnedSection(container);
		const toggle = section.querySelector("[data-group-toggle]");
		if (!(toggle instanceof HTMLElement)) throw new Error("no Pinned toggle");
		fireEvent.click(toggle);

		await waitFor(() =>
		{
			expect(rowTitles(section)).toEqual([]);
		});
		expect(readSidebarState().collapsedGroups).toEqual(["pinned"]);
		expect(toggle.getAttribute("aria-expanded")).toBe("false");
	});

	it("caps Pinned at 20 rows and pages it 20 at a time with Show more", async () =>
	{
		const sessions = pinnedSessions(23);
		seedPins(sessions.map((pinned) => pinned.id));
		const {container} = await renderGroups(sessions);

		expect(rowTitles(pinnedSection(container))).toHaveLength(20);
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Show 3 more in Pinned",
				},
			),
		);
		await waitFor(() =>
		{
			expect(rowTitles(pinnedSection(container))).toHaveLength(23);
		});
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Show less in Pinned",
				},
			),
		);
		await waitFor(() =>
		{
			expect(rowTitles(pinnedSection(container))).toHaveLength(20);
		});
		expect(
			screen.getByRole(
				"button",
				{
					name: "Show 3 more in Pinned",
				},
			),
		).toBeTruthy();
	});

	it("shows up to 21 pins whole, with no Show more", async () =>
	{
		const sessions = pinnedSessions(21);
		seedPins(sessions.map((pinned) => pinned.id));
		const {container} = await renderGroups(sessions);
		expect(
			{
				shown: rowTitles(pinnedSection(container)).length,
				showMore: screen.queryByRole(
					"button",
					{
						name: /^Show \d+ more in Pinned$/,
					},
				),
			},
		).toStrictEqual(
			{
				shown: 21,
				showMore: null,
			},
		);
	});

	it("reveals the open session when it is pinned past slot 20", async () =>
	{
		const sessions = pinnedSessions(25);
		seedPins(sessions.map((pinned) => pinned.id));
		const {container} = await renderGroups(sessions, "p22");
		await waitFor(() =>
		{
			expect(rowTitles(pinnedSection(container))).toHaveLength(23);
		});
	});

	it("reveals and focuses a pinned row that Move down pushed past slot 20", async () =>
	{
		const sessions = pinnedSessions(23);
		const ids = sessions.map((pinned) => pinned.id);
		seedPins(ids, ids);
		const {container} = await renderGroups(sessions);
		expect(rowTitles(pinnedSection(container))).toHaveLength(20);

		const menu = await openRowMenu("Pinned 19");
		const moveDown = [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
			(item) => item.textContent === "Move down",
		);
		if (moveDown === undefined) throw new Error("no Move down");
		fireEvent.click(moveDown);

		await waitFor(() =>
		{
			expect(rowTitles(pinnedSection(container)).slice(18)).toStrictEqual([
				"Pinned 18",
				"Pinned 20",
				"Pinned 19",
			]);
		});
		await waitFor(() =>
		{
			expect(rowTitle(document.activeElement)).toBe("Pinned 19");
		});
	});

	it("offers Move up and Move down on pinned rows, omitted at the ends", async () =>
	{
		seedPins(["r1", "w1", "d2"], ["r1", "w1", "d2"]);
		await renderGroups(FIXTURE);

		const top = menuItemNames(await openRowMenu("Review one"));
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
		const middle = menuItemNames(await openRowMenu("Working one"));
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
		const bottom = menuItemNames(await openRowMenu("Completed older"));

		expect(
			{
				top: top.slice(0, 2),
				middle: middle.slice(0, 3),
				bottom: bottom.slice(0, 2),
			},
		).toEqual(
			{
				top: ["Move down", "Unpin"],
				middle: ["Move up", "Move down", "Unpin"],
				bottom: ["Move up", "Unpin"],
			},
		);
	});

	it("moves a pinned row up, writes the pin order and refocuses the row", async () =>
	{
		seedPins(["r1", "w1", "d2"]);
		const {container} = await renderGroups(FIXTURE);
		expect(rowTitles(pinnedSection(container))).toEqual(["Working one", "Review one", "Completed older"]);

		const menu = await openRowMenu("Completed older");
		const moveUp = [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
			(item) => item.textContent === "Move up",
		);
		if (moveUp === undefined) throw new Error("no Move up");
		fireEvent.click(moveUp);

		await waitFor(() =>
		{
			expect(rowTitles(pinnedSection(container))).toEqual(["Working one", "Completed older", "Review one"]);
		});
		await waitFor(() =>
		{
			expect(rowTitle(document.activeElement)).toBe("Completed older");
		});
		expect(
			{
				pins: readPinState(),
				focusedRow: document.activeElement?.hasAttribute("data-row-main-button"),
			},
		).toStrictEqual(
			{
				pins:
				{
					pinnedIds: ["r1", "w1", "d2"],
					pinnedOrder: ["w1", "d2", "r1"],
				},
				focusedRow: true,
			},
		);
	});
});

// h1 ← c1 ← g1, plus a solo d1.
const FAMILY = [
	session("h1", "Head one", "done", 10),
	session("c1", "Child one", "done", 4, "h1"),
	session("g1", "Grandchild one", "done", 6, "c1"),
	session("d1", "Solo one", "done", 8),
];

/** Visible row titles without a nested row's sr-only lineage note. */
function labelTitles(element: Element | null): string[]
{
	if (element === null) return [];
	return [...element.querySelectorAll("a[data-row-main-button] [data-row-label]")]
		.filter((label) => label.closest("[hidden]") === null)
		.map((label) => rowTitle(label));
}

function pinnedFamily(container: HTMLElement): HTMLElement | null
{
	return pinnedSection(container).querySelector<HTMLElement>("[data-pinned-family].df-drag-shiftable > .df-family");
}

/** The Pinned section's slot rows: direct `[data-row-key]` children of its rows container. */
function slotTitles(container: HTMLElement): string[]
{
	return [
		...pinnedSection(container).querySelectorAll("[data-group-rows] > [data-row-key] a[data-row-main-button]"),
	].map((link) => rowTitle(link));
}

describe("sidebar Pinned families", () =>
{
	it("nests a pinned head's forks under it in Pinned and takes them out of every section", async () =>
	{
		seedPins(["h1"]);
		const {container} = await renderGroups(FAMILY);

		const family = pinnedFamily(container);
		expect(
			{
				nested: labelTitles(family),
				slots: slotTitles(container),
				childIndent: [...(family?.querySelectorAll("[data-family-child]") ?? [])].map((child) =>
					[...child.classList].filter((name) => name.startsWith("pl-")),
				),
				recents: rowTitles(container.querySelector('[data-testid="sidebar-recents"]')),
			},
		).toStrictEqual(
			{
				nested: ["Child one", "Grandchild one"],
				slots: ["Head one"],
				childIndent: [["pl-[var(--sb-row-indent)]"], ["pl-[var(--sb-row-indent)]"]],
				recents: ["Solo one"],
			},
		);
	});

	it("nests a pinned fork of a pinned head instead of giving it its own slot", async () =>
	{
		seedPins(["h1", "c1"]);
		const {container} = await renderGroups(FAMILY);

		expect(
			{
				nested: labelTitles(pinnedFamily(container)),
				slots: slotTitles(container),
			},
		).toStrictEqual(
			{
				nested: ["Child one", "Grandchild one"],
				slots: ["Head one"],
			},
		);
	});

	it("draws nested pinned rows with the pinned look: no PR tail and no Move up or Move down", async () =>
	{
		seedPins(["h1", "d1"], ["h1", "d1"]);
		localStorage.setItem(
			"ccp-session-list-prefs",
			JSON.stringify(
				{
					...DEFAULT_SESSION_LIST_PREFS,
					showPrStatus: true,
				},
			),
		);
		const {container} = await renderGroups(
			FAMILY.map((entry) => (
			{
				...entry,
				prStatus:
				{
					number: 6,
					state: "open",
				},
			})),
		);

		const tails = [...(pinnedFamily(container)?.querySelectorAll("[data-pr-glyph]") ?? [])];
		const menu = menuItemNames(await openRowMenu("Child one"));
		expect(
			{
				tails: tails.length,
				move: menu.filter((name) => name === "Move up" || name === "Move down"),
			},
		).toStrictEqual(
			{
				tails: 0,
				move: [],
			},
		);
	});

	it("keeps a pinned member listed above the stub when its pinned family folds", async () =>
	{
		seedPins(["h1", "c1"]);
		const {container} = await renderGroups(FAMILY);

		const caret = pinnedSection(container).querySelector<HTMLElement>(
			'[role="button"][aria-label="Hide nested sessions"]',
		);
		if (caret === null) throw new Error("no family caret");
		fireEvent.click(caret);

		await waitFor(() =>
		{
			expect(pinnedSection(container).querySelector("[data-pinned-family] button.df-family-stub")).not.toBeNull();
		});
		expect(
			{
				collapsed: readSidebarState().collapsedFamilies,
				kept: labelTitles(pinnedFamily(container)),
			},
		).toStrictEqual(
			{
				collapsed: ["code:h1"],
				kept: ["Child one"],
			},
		);
	});

	it("keeps an open nested row with its head under a collapsed Pinned header, with no stub or caret", async () =>
	{
		seedPins(["h1"]);
		const {container} = await renderGroups(FAMILY, "c1");
		const section = pinnedSection(container);
		const toggle = section.querySelector("[data-group-toggle]");
		if (!(toggle instanceof HTMLElement)) throw new Error("no Pinned toggle");
		fireEvent.click(toggle);

		await waitFor(() =>
		{
			expect(toggle.getAttribute("aria-expanded")).toBe("false");
		});
		expect(
			{
				rows: labelTitles(section),
				familyRows: labelTitles(
					[...section.querySelectorAll(".df-family")].find((family) => family.closest("[hidden]") === null) ??
						null,
				),
				stubs: section.querySelectorAll("button.df-family-stub").length,
				carets: [...section.querySelectorAll('[aria-label="Hide nested sessions"]')].filter(
					(caret) => caret.closest("[hidden]") === null,
				).length,
			},
		).toStrictEqual(
			{
				rows: ["Head one", "Child one"],
				familyRows: ["Child one"],
				stubs: 0,
				carets: 0,
			},
		);
	});

	it("runs a ⇧-click range through a pinned family's listed rows in display order", async () =>
	{
		const selectRange = async (collapsedFamilies: string[]) =>
		{
			seedPins(["h1"]);
			localStorage.setItem(
				SIDEBAR_STORAGE_KEY,
				JSON.stringify(
					{
						...DEFAULT_SIDEBAR_STATE,
						collapsedFamilies,
					},
				),
			);
			const {container, unmount} = await renderGroups(FAMILY);
			const link = (id: string) =>
			{
				const element = container.querySelector(`[data-row-key="${id}"] a[data-row-main-button]`);
				if (element === null) throw new Error(`no row ${id}`);
				return element;
			};
			fireEvent.click(
				link("h1"),
				{
					metaKey: true,
				},
			);
			fireEvent.click(
				link("d1"),
				{
					shiftKey: true,
				},
			);
			const selected = [
				...container.querySelectorAll("a[data-row-main-button][data-multi-selected] [data-row-label]"),
			].map((label) => rowTitle(label));
			unmount();
			return selected;
		};

		expect(
			{
				expanded: await selectRange([]),
				folded: await selectRange(["code:h1"]),
			},
		).toStrictEqual(
			{
				expanded: ["Head one", "Child one", "Grandchild one", "Solo one"],
				folded: ["Head one", "Solo one"],
			},
		);
	});

	it("holds a pinned head past slot 20 while its nested fork is open, counting only other slots as hidden", async () =>
	{
		const flat = pinnedSessions(23).filter((_, index) => index !== 20);
		const head = session("p20", "Pinned 20", "done", 21);
		const fork = session("f20", "Fork 20", "done", 30, "p20");
		const sessions = [...flat.slice(0, 20), head, fork, ...flat.slice(20)];
		seedPins([...sessions.map((entry) => entry.id)]);
		const {container} = await renderGroups(sessions, "f20");

		await waitFor(() =>
		{
			expect(slotTitles(container).slice(19)).toStrictEqual(["Pinned 19", "Pinned 20"]);
		});
		expect(
			{
				nested: labelTitles(pinnedFamily(container)),
				more: screen
					.queryByRole(
						"button",
						{
							name: /^Show \d+ more in Pinned$/,
						},
					)
					?.getAttribute("aria-label"),
			},
		).toStrictEqual(
			{
				nested: ["Fork 20"],
				more: "Show 2 more in Pinned",
			},
		);
	});
});
