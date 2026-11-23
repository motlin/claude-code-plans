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
import {act, cleanup, fireEvent, render, screen, waitFor, within} from "@testing-library/react";
import {ToastProvider} from "../src/components/toast";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {SettingsProvider} from "../src/components/settings-provider";
import {freezeAnchor, type FrozenAnchor} from "../src/components/sidebar/frozen-anchor";
import {SidebarSessionGroups} from "../src/components/sidebar/session-filter-menu";
import {SidebarHiddenContext} from "../src/components/sidebar/sidebar-hidden";
import {RecentSessionsResponse, recentSessionsInfiniteQueryOptions} from "../src/lib/api/sessions";
import {DEFAULT_SESSION_LIST_PREFS, type SessionListPrefs} from "../src/lib/session-groups";
import type {SessionBucket} from "../src/lib/session-state";
import {FizzyLakeContext, FIZZY_LAKE_PARTS, type FizzyLakePart} from "../src/lib/fizzy-lake";
import {findTruncatingLabel, shiftLabelForActiveMatch} from "../src/lib/find-in-page/label-shift";
import {installLocalStorage} from "./fake-storage";
import {readFileSync} from "node:fs";
import {useState} from "react";

const MINUTE = 60 * 1000;
const routerRef:
{
	current:
	{
		state:
		{
			location:
			{
				pathname: string;
			};
		};
	} | null;
} =
{
	current: null,
};
const PREFS_KEY = "ccp-session-list-prefs";
const setSidebarHiddenRef:
{
	current: ((hidden: boolean) => void) | null;
} =
{
	current: null,
};

/** Stands in for the collapsed peek or phone sheet hiding the sidebar around the list. */
function SidebarHiddenHarness({children}: {children: React.ReactNode})
{
	const [hidden, setHidden] = useState(false);
	setSidebarHiddenRef.current = setHidden;
	return <SidebarHiddenContext value={hidden}>{children}</SidebarHiddenContext>;
}

function session(id: string, title: string, bucket: SessionBucket, projectName: string)
{
	const mtime = new Date(Date.now() - MINUTE).toISOString();
	return {
		id,
		title,
		mtime,
		created: mtime,
		project: `-projects-${projectName}`,
		projectName,
		messageCount: 4,
		archived: false,
		state: bucket === "working" ? "working" : bucket === "blocked" ? "waiting" : "idle",
		bucket,
		liveAgentCount: 0,
		unseen: bucket === "review",
		blockedSince: null,
	};
}

const FIXTURE = [session("w1", "Working one", "working", "beta"), session("d1", "Completed one", "done", "alpha")];

async function flush()
{
	await act(async () =>
	{
		await new Promise((resolve) =>
		{
			setTimeout(resolve, 0);
		});
	});
}

function storePrefs(prefs: Partial<SessionListPrefs>)
{
	localStorage.setItem(
		PREFS_KEY,
		JSON.stringify(
			{
				...DEFAULT_SESSION_LIST_PREFS,
				...prefs,
			},
		),
	);
}

function storedPrefs(): unknown
{
	const raw = localStorage.getItem(PREFS_KEY);
	return raw === null ? null : JSON.parse(raw);
}

async function renderSidebarGroups(
	fixture: readonly object[] = FIXTURE,
	fixtureByStatus: Partial<Record<SessionListPrefs["statusFilter"], readonly object[]>> = {},
	fizzyLake: readonly FizzyLakePart[] = FIZZY_LAKE_PARTS,
)
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
	// Each Status value is its own server query (archived sessions are filtered server-side).
	for (const status of ["active", "archived", "all"] as const)
	{
		queryClient.setQueryData(
			recentSessionsInfiniteQueryOptions(undefined, status).queryKey,
			{
				pages: [
					RecentSessionsResponse.parse(
						{
							sessions: fixtureByStatus[status] ?? fixture,
							nextCursor: null,
						},
					),
				],
				pageParams: [null],
			},
		);
	}
	const rootRoute = createRootRoute(
		{
			component: () => (
				<FizzyLakeContext.Provider value={fizzyLake}>
					<SettingsProvider>
						<QueryClientProvider client={queryClient}>
							<ToastProvider>
								<SidebarHiddenHarness>
									<SidebarSessionGroups activeItemId={null} />
								</SidebarHiddenHarness>
								<Outlet />
							</ToastProvider>
						</QueryClientProvider>
					</SettingsProvider>
				</FizzyLakeContext.Provider>
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
	const sessionsRoute = createRoute(
		{
			getParentRoute: () => rootRoute,
			path: "/sessions",
			component: () => <p>All sessions page</p>,
		},
	);
	const router = createRouter(
		{
			routeTree: rootRoute.addChildren([homeRoute, sessionRoute, sessionsRoute]),
			history: createMemoryHistory(
				{
					initialEntries: ["/"],
				},
			),
		},
	);
	await router.load();
	const result = render(<RouterProvider router={router} />);
	routerRef.current = router;
	await waitFor(() =>
	{
		expect(result.container.querySelector("[data-sidebar-group-label]")).toBeTruthy();
	});
	await flush();
	return {
		...result,
		queryClient,
	};
}

function groupNames(container: HTMLElement): string[]
{
	return [...container.querySelectorAll('[data-testid="sidebar-recents"] [data-group-name]')].map(
		(node) => node.textContent,
	);
}

function filterButton(): HTMLElement
{
	const [first] = screen.getAllByRole(
		"button",
		{
			name: "Group and sort",
		},
	);
	if (first === undefined) throw new Error("Expected a Group and sort button");
	return first;
}

async function openFilterMenu(): Promise<HTMLElement>
{
	fireEvent.click(filterButton());
	await flush();
	return screen.getByRole("menu");
}

function menuOutline(menu: HTMLElement): string[]
{
	return [
		...menu.querySelectorAll(
			':scope [role="menuitem"], :scope [role="menuitemcheckbox"], :scope [role="menuitemradio"], :scope [role="separator"], :scope [data-menu-label]',
		),
	].map((node) => (node.getAttribute("role") === "separator" ? "---" : node.textContent.trim()));
}

async function openSubmenu(name: RegExp): Promise<HTMLElement>
{
	const trigger = screen.getByRole(
		"menuitem",
		{
			name,
		},
	);
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
	await flush();
	const menus = screen.getAllByRole("menu");
	const submenu = menus.at(-1);
	if (submenu === undefined) throw new Error("Expected a submenu");
	return submenu;
}

afterEach(cleanup);

beforeEach(() =>
{
	installLocalStorage();
});

describe("sidebar Group and sort menu", () =>
{
	it("puts Group and sort on every section header at full width even with panels off, and no New session + on any (the New nav row has it)", async () =>
	{
		storePrefs(
			{
				groupBy: "state",
			},
		);
		const {container} = await renderSidebarGroups(FIXTURE, {}, []);

		const headers = [...container.querySelectorAll('[data-testid="sidebar-recents"] [data-sidebar-group-label]')];
		expect(
			{
				groupAndSort: headers.map(
					(header) => header.querySelectorAll('button[aria-label="Group and sort"]').length,
				),
				newSession: headers.map((header) => header.querySelectorAll('button[aria-label="New session"]').length),
				revealed: filterButton()
					.closest("[data-header-reveal]")
					?.className.split(" ")
					.filter((name) => name === "w-0" || name === "group-hover/labelrow:w-auto"),
			},
		).toStrictEqual(
			{
				groupAndSort: [1, 1],
				newSession: [0, 0],
				revealed: [],
			},
		);
	});

	// Upstream exempts header glyphs from --df-chrome-icon-size: a 20px glyph in the 24px button, with data-row-glyph.
	it("draws the Group and sort glyph at 20px and marks the trigger data-row-glyph", async () =>
	{
		await renderSidebarGroups();

		expect(
			{
				rowGlyph: filterButton().getAttribute("data-row-glyph"),
				glyph: filterButton().querySelector("svg")?.getAttribute("class")?.split(" ").includes("size-5"),
			},
		).toStrictEqual(
			{
				rowGlyph: "",
				glyph: true,
			},
		);
	});

	// Upstream paints the hovered/open chrome button with fill-button-ghost-hover (10% ink), a darker chip
	// on the 5% header pill; --sb-hover would match the pill and hide the chip.
	it("styles the trigger like upstream: radius 6 (r5), 10% ghost-hover chip when hovered or open", async () =>
	{
		await renderSidebarGroups();

		const classes = filterButton().className.split(" ");
		expect(
			{
				radius: classes.filter((token) => token.startsWith("rounded")),
				background: classes.filter((token) => token.includes("bg-")),
			},
		).toStrictEqual(
			{
				radius: ["rounded-r5"],
				background: ["hover:bg-fill-button-ghost-hover", "data-[popup-open]:bg-fill-button-ghost-hover"],
			},
		);
	});

	// Upstream: the whole header rests in --df-heading-ink (muted), turns secondary on header hover, and a
	// chrome button goes primary on its own hover or while its menu is open.
	it("inks the header like upstream: muted at rest, secondary on header hover, primary on a hovered or open button", async () =>
	{
		const {container} = await renderSidebarGroups();
		const inkTokens = (element: Element | null | undefined) =>
			(element?.className ?? "")
				.split(" ")
				.filter(
					(token) =>
						/(^|:)(text-|\[--sb-heading-ink)/.test(token) &&
						token !== "text-left" &&
						!token.startsWith("text-[length"),
				);
		const label = container.querySelector('[data-testid="sidebar-recents"] [data-sidebar-group-label]');
		const buttonInk = [
			"text-[color:var(--sb-heading-ink,var(--color-secondary))]",
			"hover:text-primary",
			"data-[popup-open]:text-primary",
			"aria-expanded:text-primary",
		];

		expect(
			{
				label: inkTokens(label),
				toggle: inkTokens(label?.querySelector("[data-group-toggle]")),
				groupAndSort: inkTokens(label?.querySelector('button[aria-label="Group and sort"]')),
			},
		).toStrictEqual(
			{
				label: [
					"[--sb-heading-ink:var(--color-ink-muted)]",
					"hover:[--sb-heading-ink:var(--color-secondary)]",
					"text-[color:var(--sb-heading-ink)]",
				],
				toggle: [],
				groupAndSort: buttonInk,
			},
		);
	});

	it("lists upstream's top level: Group by, Sort by, Show, New section, Reset to defaults and View all", async () =>
	{
		await renderSidebarGroups();
		const menu = await openFilterMenu();

		expect(menuOutline(menu)).toEqual([
			"Group byNone",
			"Sort byLast updated",
			"Show",
			"---",
			"New section",
			"---",
			"Reset to defaults",
			"View all",
		]);
	});

	it("draws the menu at upstream's comfortable density: 32px rows of 14/20 type in a 200px menu", async () =>
	{
		await renderSidebarGroups();
		const menu = await openFilterMenu();
		const item = within(menu)
			.getByRole(
				"menuitem",
				{
					name: "New section",
				},
			)
			.className.split(" ");
		expect(
			{
				row: item.filter((name) => ["h-8", "text-[14px]/[20px]"].includes(name)),
				width: menu.className.split(" ").includes("!min-w-[200px]"),
			},
		).toStrictEqual(
			{
				row: ["h-8", "text-[14px]/[20px]"],
				width: true,
			},
		);
	});

	it("offers upstream's Group by order: Date, Status, Folder (for Environment), then None after a separator", async () =>
	{
		await renderSidebarGroups();
		await openFilterMenu();
		const submenu = await openSubmenu(/^Group by/);

		expect(
			{
				outline: menuOutline(submenu),
				checked: screen
					.getAllByRole("menuitemradio")
					.map((node) => [node.textContent, node.getAttribute("aria-checked")]),
			},
		).toStrictEqual(
			{
				outline: ["Date", "Status", "Folder", "---", "None"],
				checked: [
					["Date", "false"],
					["Status", "false"],
					["Folder", "false"],
					["None", "true"],
				],
			},
		);
	});

	it("sorts by Last updated or Date created, keeping the local Name sort, then Descending or Ascending", async () =>
	{
		await renderSidebarGroups();
		await openFilterMenu();
		await openSubmenu(/^Sort by/);

		expect(
			screen.getAllByRole("menuitemradio").map((node) => [node.textContent, node.getAttribute("aria-checked")]),
		).toEqual([
			["Last updated", "true"],
			["Date created", "false"],
			["Name", "false"],
			["Descending", "true"],
			["Ascending", "false"],
		]);

		fireEvent.click(
			screen.getByRole(
				"menuitemradio",
				{
					name: "Ascending",
				},
			),
		);
		await flush();
		expect(storedPrefs()).toEqual(
			{
				...DEFAULT_SESSION_LIST_PREFS,
				sortDirection: "asc",
			},
		);
	});

	it("keeps the local Status and Last activity filters and the empty-group and PR toggles under Show", async () =>
	{
		const withPr = [
			...FIXTURE,
			{
				...session("p1", "PR one", "review", "alpha"),
				prStatus:
				{
					number: 6,
					state: "draft",
				},
			},
		];
		await renderSidebarGroups(withPr);
		await openFilterMenu();
		const show = await openSubmenu(/^Show/);

		expect(menuOutline(show)).toEqual([
			"Metadata",
			"---",
			"Empty groups",
			"PR status",
			"---",
			"Status",
			"Active",
			"Archived",
			"All",
			"---",
			"Last activity",
			"1d",
			"3d",
			"7d",
			"30d",
			"All",
		]);
	});

	it("leads Show with upstream's Metadata checkbox, off by default, and keeps the menu open when it persists turning it on", async () =>
	{
		await renderSidebarGroups();
		await openFilterMenu();
		const show = await openSubmenu(/^Show/);
		const [first] = within(show).getAllByRole("menuitemcheckbox");
		if (first === undefined) throw new Error("Expected a Show checkbox");
		const before =
		{
			name: first.textContent,
			checked: first.getAttribute("aria-checked"),
		};
		fireEvent.click(first);
		await flush();

		expect(
			{
				before,
				after: screen
					.getByRole(
						"menuitemcheckbox",
						{
							name: "Metadata",
						},
					)
					.getAttribute("aria-checked"),
				stored: storedPrefs(),
			},
		).toStrictEqual(
			{
				before:
				{
					name: "Metadata",
					checked: "false",
				},
				after: "true",
				stored:
				{
					...DEFAULT_SESSION_LIST_PREFS,
					showMetadata: true,
				},
			},
		);
	});

	it("marks non-default trailing values in accent", async () =>
	{
		storePrefs(
			{
				groupBy: "project",
			},
		);
		await renderSidebarGroups();
		await openFilterMenu();

		const accentOf = (name: RegExp) =>
			screen
				.getByRole(
					"menuitem",
					{
						name,
					},
				)
				.querySelector("[data-menu-value]")
				?.className.includes("text-accent-100");
		expect([accentOf(/^Sort by/), accentOf(/^Group by/)]).toEqual([false, true]);
	});

	// Upstream's fresh default (and the user's account) leaves Recents ungrouped under one header.
	it("renders a fresh browser's list ungrouped under one Recents header, as upstream", async () =>
	{
		const {container} = await renderSidebarGroups();
		expect(
			{
				groups: groupNames(container),
				stored: storedPrefs(),
			},
		).toStrictEqual(
			{
				groups: ["Recents"],
				stored: null,
			},
		);
	});

	it("keeps a grouping this browser already saved instead of the ungrouped default", async () =>
	{
		storePrefs(
			{
				groupBy: "state",
			},
		);
		const {container} = await renderSidebarGroups();
		expect(
			{
				groups: groupNames(container),
				stored: storedPrefs(),
			},
		).toStrictEqual(
			{
				groups: ["Working", "Idle"],
				stored:
				{
					...DEFAULT_SESSION_LIST_PREFS,
					groupBy: "state",
				},
			},
		);
	});

	it("regroups the list and persists when a Group by option is chosen", async () =>
	{
		storePrefs(
			{
				groupBy: "state",
			},
		);
		const {container} = await renderSidebarGroups();
		expect(groupNames(container)).toEqual(["Working", "Idle"]);

		await openFilterMenu();
		await openSubmenu(/^Group by/);
		fireEvent.click(
			screen.getByRole(
				"menuitemradio",
				{
					name: "Folder",
				},
			),
		);
		await flush();

		expect(groupNames(container)).toEqual(["alpha", "beta"]);
		expect(storedPrefs()).toEqual(
			{
				...DEFAULT_SESSION_LIST_PREFS,
				groupBy: "project",
			},
		);
	});

	it("filters by Status from Show and persists it", async () =>
	{
		await renderSidebarGroups();
		await openFilterMenu();
		await openSubmenu(/^Show/);
		const [statusAll] = screen.getAllByRole(
			"menuitemradio",
			{
				name: "All",
			},
		);
		if (statusAll === undefined) throw new Error("Expected Status ▸ All");
		fireEvent.click(statusAll);
		await flush();

		expect(storedPrefs()).toEqual(
			{
				...DEFAULT_SESSION_LIST_PREFS,
				statusFilter: "all",
			},
		);
	});

	it("shows no PR glyph by default, as upstream, and persists turning PR status on from Show", async () =>
	{
		const withPr = [
			...FIXTURE,
			{
				...session("p1", "PR one", "review", "alpha"),
				prStatus:
				{
					number: 6,
					state: "draft",
				},
			},
		];
		const {container} = await renderSidebarGroups(withPr);
		const glyph = () => container.querySelector('a[data-row-main-button] [data-pr-glyph="draft"]') !== null;
		expect(glyph()).toBe(false);
		await openFilterMenu();
		await openSubmenu(/^Show/);
		fireEvent.click(
			screen.getByRole(
				"menuitemcheckbox",
				{
					name: "PR status",
				},
			),
		);
		await flush();

		expect(
			{
				glyph: glyph(),
				stored: storedPrefs(),
			},
		).toStrictEqual(
			{
				glyph: true,
				stored:
				{
					...DEFAULT_SESSION_LIST_PREFS,
					showPrStatus: true,
				},
			},
		);
	});
	it("resets the grouping and sort with Reset to defaults, keeping the local Show filters", async () =>
	{
		storePrefs(
			{
				statusFilter: "all",
				activityDays: "1d",
				sortBy: "name",
				sortDirection: "asc",
				groupBy: "date",
			},
		);
		await renderSidebarGroups();

		await openFilterMenu();
		fireEvent.click(
			screen.getByRole(
				"menuitem",
				{
					name: "Reset to defaults",
				},
			),
		);
		await flush();

		expect(storedPrefs()).toEqual(
			{
				...DEFAULT_SESSION_LIST_PREFS,
				statusFilter: "all",
				activityDays: "1d",
			},
		);
	});

	it("disables Reset to defaults with upstream's reason while the grouping and sort are at their defaults", async () =>
	{
		storePrefs(
			{
				statusFilter: "all",
			},
		);
		await renderSidebarGroups();

		const menu = await openFilterMenu();
		const reset = within(menu).getByRole(
			"menuitem",
			{
				name: "Reset to defaults",
			},
		);
		const reason = document.getElementById(reset.getAttribute("aria-describedby") ?? "");
		expect(
			{
				disabled: reset.getAttribute("aria-disabled"),
				reason: reason?.textContent,
			},
		).toStrictEqual(
			{
				disabled: "true",
				reason: "Grouping and sorting are already at their defaults.",
			},
		);
	});

	it("disables View all with upstream's reason while there are no sessions to view", async () =>
	{
		await renderSidebarGroups([]);

		const menu = await openFilterMenu();
		const viewAll = within(menu).getByRole(
			"menuitem",
			{
				name: "View all",
			},
		);
		const reason = document.getElementById(viewAll.getAttribute("aria-describedby") ?? "");
		expect(
			{
				disabled: viewAll.getAttribute("aria-disabled"),
				reason: reason?.textContent,
			},
		).toStrictEqual(
			{
				disabled: "true",
				reason: "There are no other sessions to view.",
			},
		);
	});

	it("opens the all-sessions page with View all", async () =>
	{
		await renderSidebarGroups();
		await openFilterMenu();
		fireEvent.click(
			screen.getByRole(
				"menuitem",
				{
					name: "View all",
				},
			),
		);
		await flush();

		expect(routerRef.current?.state.location.pathname).toBe("/sessions");
	});

	it("starts a section above Recents from New section, leaving the grouping alone", async () =>
	{
		storePrefs(
			{
				groupBy: "state",
			},
		);
		const {container} = await renderSidebarGroups();
		await openFilterMenu();
		fireEvent.click(
			screen.getByRole(
				"menuitem",
				{
					name: "New section",
				},
			),
		);
		await flush();

		const title = screen.getByRole("dialog").querySelector("h2")?.textContent;
		fireEvent.change(
			screen.getByRole(
				"textbox",
				{
					name: "Section name",
				},
			),
			{
				target:
				{
					value: "Reading",
				},
			},
		);
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Create section",
				},
			),
		);
		await flush();

		const stored = JSON.parse(localStorage.getItem("ccp-session-groups") ?? "{}") as
		{
			groups?: Array<
			{
				name: string;
			}>;
		};
		expect(
			{
				title,
				groupBy: (storedPrefs() as SessionListPrefs).groupBy,
				sections: stored.groups?.map((group) => group.name),
				manual: [...container.querySelectorAll(".df-sortable-section [data-group-name]")].map(
					(node) => node.textContent,
				),
				recents: groupNames(container),
			},
		).toStrictEqual(
			{
				title: "New section",
				groupBy: "state",
				sections: ["Reading"],
				manual: ["Reading"],
				recents: ["Working", "Idle"],
			},
		);
	});

	it("keeps the trigger on an empty-list header, whose Show all sessions brings the rows back", async () =>
	{
		storePrefs(
			{
				statusFilter: "archived",
			},
		);
		const {container} = await renderSidebarGroups(
			FIXTURE,
			{
				archived: [],
			},
		);

		const recents = container.querySelector<HTMLElement>('[data-testid="sidebar-recents"]');
		expect(
			{
				labels: [...(recents?.querySelectorAll("[data-sidebar-group-label]") ?? [])].map((node) =>
					node.textContent.trim(),
				),
				empty: recents?.querySelector("[data-sidebar-empty]")?.textContent,
				trigger: recents?.querySelectorAll('button[aria-label="Group and sort"]').length,
			},
		).toStrictEqual(
			{
				labels: ["Recents"],
				empty: "No sessions match the current filtersShow all sessions",
				trigger: 1,
			},
		);

		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Show all sessions",
				},
			),
		);
		await flush();

		expect(
			{
				groups: groupNames(container),
				empty: container.querySelector("[data-sidebar-empty]"),
			},
		).toStrictEqual(
			{
				groups: ["Recents"],
				empty: null,
			},
		);
	});

	it("marks an archived row with sr-only Archived right after its title, not a visible pill, as upstream does", async () =>
	{
		storePrefs(
			{
				statusFilter: "archived",
			},
		);
		const archived =
		{
			...session("a1", "Archived one", "done", "alpha"),
			archived: true,
		};
		const {container} = await renderSidebarGroups(
			FIXTURE,
			{
				archived: [archived],
			},
		);

		const link = container.querySelector<HTMLElement>('a[href="/session/a1"]');
		const titleSpan = link?.querySelector(".relative");
		expect(
			{
				badge: link?.querySelector("[data-archived-badge]") ?? null,
				titleChildren: [...(titleSpan?.childNodes ?? [])].map((node) =>
					node instanceof HTMLElement
						?
							{
								className: node.className,
								text: node.textContent,
							}
						: node.textContent,
				),
			},
		).toStrictEqual(
			{
				badge: null,
				titleChildren: [
					{
						className: "",
						text: "Archived one",
					},
					{
						className: "sr-only",
						text: " Archived",
					},
					{
						className: "sr-only [[role=tooltip]_&]:hidden",
						text: " alpha · Connected",
					},
				],
			},
		);
	});

	it("lets the fade label pick its direction from the title, so a Hebrew title fades at its start like upstream", async () =>
	{
		const hebrew = session("h1", "שלום עולם", "done", "alpha");
		const {container} = await renderSidebarGroups([hebrew]);

		const label = container.querySelector<HTMLElement>('a[href="/session/h1"] .dframe-fade-label');
		expect(
			{
				dir: label?.getAttribute("dir"),
				text: label?.textContent,
			},
		).toStrictEqual(
			{
				dir: "auto",
				text: "שלום עולם alpha · Connected",
			},
		);
	});

	// Upstream: the caret rotates in 60ms (duration-fast); the hub sidebar's reveal span is plain `flex` (shared-21 `Cs`).
	it("rotates the header caret in 60ms and leaves the reveal span free of touch-only width classes, like upstream", async () =>
	{
		const {container} = await renderSidebarGroups(FIXTURE, {}, []);
		const header = container.querySelector('[data-testid="sidebar-recents"] [data-sidebar-group-label]');
		const classes = (selector: string) => header?.querySelector(selector)?.getAttribute("class")?.split(" ") ?? [];

		expect(
			{
				caret: classes("[data-group-caret]").filter((name) => name.startsWith("duration-")),
				reveal: classes("[data-header-reveal]").filter((name) => /^(touch|pointer-coarse):/.test(name)),
			},
		).toStrictEqual(
			{
				caret: ["duration-[60ms]"],
				reveal: [],
			},
		);
	});

	it("fades a long group name instead of ending it in an ellipsis, like upstream", async () =>
	{
		const longName = "x".repeat(200);
		storePrefs(
			{
				groupBy: "project",
			},
		);
		const scrollWidth = vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(2000);
		const clientWidth = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(200);
		try
		{
			const {container} = await renderSidebarGroups([session("l1", "Long one", "done", longName)]);
			const name = container.querySelector('[data-testid="sidebar-recents"] [data-group-name]');
			const label = name?.querySelector<HTMLElement>(".dframe-fade-label");

			expect(
				{
					truncate: name?.classList.contains("truncate"),
					overflowing: label?.hasAttribute("data-overflowing"),
					dir: label?.getAttribute("dir"),
					text: name?.textContent,
				},
			).toStrictEqual(
				{
					truncate: false,
					overflowing: true,
					dir: "auto",
					text: longName,
				},
			);
		}
		finally
		{
			scrollWidth.mockRestore();
			clientWidth.mockRestore();
		}
	});

	it("registers each fade label with find, so an active match near a long title's end slides the text into view", async () =>
	{
		const scrollWidth = vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(2000);
		const clientWidth = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(200);
		try
		{
			const {container, unmount} = await renderSidebarGroups([
				session("l1", "A long title ending in needle", "done", "alpha"),
			]);
			const box = container.querySelector<HTMLElement>('a[href="/session/l1"] .dframe-fade-label');
			const text = box?.querySelector<HTMLElement>(":scope > span.inline-block");
			// The title text sits in its own span inside upstream's span.relative[data-attention].
			const title = text?.querySelector(":scope > span.relative > span")?.firstChild;
			if (!box || !text || !title) throw new Error("no fade label");
			box.getBoundingClientRect = () => new DOMRect(0, 0, 200, 20);
			const range = document.createRange();
			range.setStart(title, 0);
			range.setEnd(title, 6);
			range.getBoundingClientRect = () => new DOMRect(190, 0, 20, 20);
			const registered = findTruncatingLabel(title)?.box === box;
			shiftLabelForActiveMatch(range);
			const transform = text.style.transform;
			shiftLabelForActiveMatch(null);
			unmount();
			expect(
				{
					registered,
					transform,
					afterUnmount: findTruncatingLabel(title),
				},
			).toStrictEqual(
				{
					registered: true,
					transform: "translateX(-162px)",
					afterUnmount: undefined,
				},
			);
		}
		finally
		{
			scrollWidth.mockRestore();
			clientWidth.mockRestore();
		}
	});

	it("angles the overflow fade by direction with upstream's --df-label-fade-angle", () =>
	{
		const css = readFileSync("src/styles/globals.css", "utf8");
		const rule = (selector: string) =>
			css
				.match(new RegExp(`\\n${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`))?.[1]
				?.trim();
		expect(
			{
				textAlign: rule(".dframe-fade-label")?.match(/text-align:[^;]+;/g),
				overflowing: rule(".dframe-fade-label[data-overflowing]"),
				rtl: rule(".dframe-fade-label:dir(rtl)"),
			},
		).toStrictEqual(
			{
				textAlign: ["text-align: -webkit-match-parent;", "text-align: match-parent;"],
				overflowing:
					"mask-image: linear-gradient(var(--df-label-fade-angle, 90deg), black calc(100% - 24px), transparent 100%);",
				rtl: "--df-label-fade-angle: 270deg;",
			},
		);
	});

	it("offers Show all sessions when the filters empty the list, as upstream does", async () =>
	{
		storePrefs(
			{
				statusFilter: "archived",
				activityDays: "1d",
			},
		);
		const {container} = await renderSidebarGroups(
			FIXTURE,
			{
				archived: [],
				all: FIXTURE,
			},
		);
		const empty = container.querySelector<HTMLElement>("[data-sidebar-empty]");
		expect(
			{
				text: empty?.querySelector("p")?.textContent,
				classes: empty?.className
					.split(" ")
					.filter((name) => ["items-center", "text-center", "py-6"].includes(name)),
			},
		).toStrictEqual(
			{
				text: "No sessions match the current filters",
				classes: ["items-center", "py-6", "text-center"],
			},
		);

		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Show all sessions",
				},
			),
		);
		await flush();

		expect(storedPrefs()).toEqual(
			{
				...DEFAULT_SESSION_LIST_PREFS,
				statusFilter: "all",
				activityDays: "all",
			},
		);
	});

	it("says Sessions you start will show up here when there are no sessions at all", async () =>
	{
		const {container} = await renderSidebarGroups([]);
		expect(
			{
				text: container.querySelector("[data-sidebar-empty]")?.textContent,
				showAll: screen.queryByRole(
					"button",
					{
						name: "Show all sessions",
					},
				),
			},
		).toStrictEqual(
			{
				text: "Sessions you start will show up here",
				showAll: null,
			},
		);
	});

	it("lists this browser's custom groups as their own sections above Recents, which keeps its grouping", async () =>
	{
		localStorage.setItem(
			"ccp-session-groups",
			JSON.stringify(
				{
					groups: [
						{
							id: "cg-blog",
							name: "Blog",
						},
						{
							id: "cg-empty",
							name: "Someday",
						},
					],
					assignments:
					{
						d1: "cg-blog",
					},
					order: {},
				},
			),
		);
		storePrefs(
			{
				groupBy: "state",
			},
		);
		const {container} = await renderSidebarGroups();

		expect(
			{
				order: [...container.querySelectorAll("[data-sidebar-group-label] [data-group-name]")].map(
					(node) => node.textContent,
				),
				manual: [...container.querySelectorAll(".df-sortable-section [data-group-name]")].map(
					(node) => node.textContent,
				),
				recents: groupNames(container),
			},
		).toStrictEqual(
			{
				order: ["Pinned", "Blog", "Someday", "Working"],
				manual: ["Blog", "Someday"],
				recents: ["Working"],
			},
		);
	});
});

describe("sidebar Group and sort shared menu (held re-anchor)", () =>
{
	const triggerSelector = 'button[aria-label="Group and sort"]';

	/** jsdom lays nothing out: give each Group and sort trigger a 24px rect 40px below the previous one. */
	function stubTriggerRects(height = 24)
	{
		const original = HTMLElement.prototype.getBoundingClientRect;
		return vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement)
		{
			if (!this.matches(triggerSelector)) return original.call(this);
			const index = [...document.querySelectorAll(triggerSelector)].indexOf(this);
			return DOMRect.fromRect(
				{
					x: 200,
					y: 40 * index,
					width: 24,
					height,
				},
			);
		});
	}

	async function flushFrame()
	{
		await act(async () =>
		{
			await new Promise((resolve) =>
			{
				requestAnimationFrame(resolve);
			});
		});
	}

	function openTriggers(): Element[]
	{
		return [...document.querySelectorAll(`${triggerSelector}[aria-expanded="true"]`)];
	}

	async function pickFolder()
	{
		await openSubmenu(/^Group by/);
		const folder = screen.getByRole(
			"menuitemradio",
			{
				name: "Folder",
			},
		);
		act(() =>
		{
			folder.focus();
		});
		fireEvent.click(folder);
		await flush();
	}

	const originalScrollIntoView = Element.prototype.scrollIntoView;

	/** Every element counts as :focus-visible, and scrollIntoView is recorded rather than run. */
	function stubFocusVisibleScroll()
	{
		const scrollIntoView = vi.fn<Element["scrollIntoView"]>();
		Element.prototype.scrollIntoView = scrollIntoView;
		const matches = Element.prototype.matches;
		vi.spyOn(Element.prototype, "matches").mockImplementation(function (this: Element, selector: string)
		{
			return selector === ":focus-visible" ? true : matches.call(this, selector);
		});
		// Base UI also scrolls highlighted menu items into view; only scrolls of a trigger slot count here.
		return () =>
			scrollIntoView.mock.calls.flatMap((args, index) =>
			{
				const target = scrollIntoView.mock.contexts[index];
				return target instanceof Element && target.matches("[data-group-sort-trigger]")
					? [
							{
								target,
								args,
							},
						]
					: [];
			});
	}
	afterEach(() =>
	{
		vi.restoreAllMocks();
		Element.prototype.scrollIntoView = originalScrollIntoView;
	});

	it("wraps each header's trigger in a data-group-sort-trigger span naming its id, and opens one menu for the whole list", async () =>
	{
		storePrefs(
			{
				groupBy: "state",
			},
		);
		const {container} = await renderSidebarGroups();
		const spans = [...container.querySelectorAll<HTMLElement>("[data-group-sort-trigger]")];
		const second = spans[1]?.querySelector(triggerSelector);
		if (!(second instanceof HTMLElement)) throw new Error("Expected a second Group and sort trigger");
		fireEvent.click(second);
		await flush();

		expect(
			{
				spans: spans.map((span) => (
				{
					idMatches: span.querySelector(triggerSelector)?.id === span.dataset["groupSortTrigger"],
					scrollMarginBlock: span.style.scrollMarginBlock,
					className: span.className,
				})),
				menus: document.querySelectorAll('[role="menu"]').length,
				open: openTriggers(),
				touchNone: second.className.split(" ").includes("aria-expanded:touch-none"),
			},
		).toStrictEqual(
			{
				spans: [
					{
						idMatches: true,
						scrollMarginBlock: "8px",
						className: "flex",
					},
					{
						idMatches: true,
						scrollMarginBlock: "8px",
						className: "flex",
					},
				],
				menus: 1,
				open: [second],
				touchNone: true,
			},
		);
		expect(menuOutline(screen.getByRole("menu"))).toEqual([
			"Group byStatus",
			"Sort byLast updated",
			"Show",
			"---",
			"New section",
			"---",
			"Reset to defaults",
			"View all",
		]);
		// Upstream `h$`: the popup opens beside the sidebar (inline-end, start, 4px), shifting rather than flipping.
		const positioner = screen.getByRole("menu").closest("[data-side-offset]");
		expect(
			{
				side: positioner?.getAttribute("data-side"),
				align: positioner?.getAttribute("data-align"),
				sideOffset: positioner?.getAttribute("data-side-offset"),
				collisionFallback: positioner?.getAttribute("data-collision-fallback"),
			},
		).toStrictEqual(
			{
				side: "right",
				align: "start",
				sideOffset: "4",
				collisionFallback: "none",
			},
		);
	});

	it("freezes the trigger rect stretched to the sidebar body's inline-end edge, like upstream's LZ", () =>
	{
		function element(rect: DOMRect): HTMLElement
		{
			const node = document.createElement("div");
			node.getBoundingClientRect = () => rect;
			return node;
		}
		const body = element(new DOMRect(0, 41, 287, 700));
		body.setAttribute("data-sidebar-body", "");
		const inside = element(new DOMRect(248, 275, 24, 24));
		body.append(inside);
		const outside = element(new DOMRect(248, 275, 24, 24));
		const rectOf = (anchor: FrozenAnchor) =>
		{
			const {x, y, width, height} = anchor.getBoundingClientRect();
			return {
				x,
				y,
				width,
				height,
			};
		};

		expect(
			{
				inside: rectOf(freezeAnchor(inside)),
				outside: rectOf(freezeAnchor(outside)),
			},
		).toStrictEqual(
			{
				inside:
				{
					x: 248,
					y: 275,
					width: 39,
					height: 24,
				},
				outside:
				{
					x: 248,
					y: 275,
					width: 24,
					height: 24,
				},
			},
		);
	});

	it("keeps the menu open on a regroup, holding it on the nearest surviving trigger and refocusing the picked item", async () =>
	{
		storePrefs(
			{
				groupBy: "state",
			},
		);
		stubTriggerRects();
		const {container} = await renderSidebarGroups();
		await openFilterMenu();
		await pickFolder();
		await flushFrame();

		const alphaTrigger = [...container.querySelectorAll("[data-sidebar-group-label]")]
			.find((label) => label.querySelector("[data-group-name]")?.textContent === "alpha")
			?.querySelector(triggerSelector);
		expect(
			{
				menu: screen.queryAllByRole("menu").length > 0,
				groups: groupNames(container),
				open: openTriggers(),
				held: alphaTrigger?.getAttribute("data-held"),
				focusInMenu: document.activeElement?.closest('[role="menu"]') !== null,
			},
		).toStrictEqual(
			{
				menu: true,
				groups: ["alpha", "beta"],
				open: [alphaTrigger],
				held: "",
				focusInMenu: true,
			},
		);
	});

	it("closes and moves lost focus to the list's first group toggle when no laid-out trigger survives", async () =>
	{
		storePrefs(
			{
				groupBy: "state",
			},
		);
		stubTriggerRects(0);
		const {container} = await renderSidebarGroups();
		await openFilterMenu();
		await pickFolder();
		await flushFrame();

		expect(
			{
				menu: screen.queryByRole("menu"),
				open: openTriggers(),
				focused: document.activeElement,
			},
		).toStrictEqual(
			{
				menu: null,
				open: [],
				focused: container.querySelector('[data-testid="sidebar-recents"] [data-group-toggle]'),
			},
		);
	});

	it("does not reopen when the open header vanishes after the menu was closed", async () =>
	{
		storePrefs(
			{
				groupBy: "state",
			},
		);
		stubTriggerRects();
		const {container, queryClient} = await renderSidebarGroups();
		const menu = await openFilterMenu();
		fireEvent.keyDown(
			menu,
			{
				key: "Escape",
			},
		);
		await flush();
		act(() =>
		{
			queryClient.setQueryData(
				recentSessionsInfiniteQueryOptions(undefined, "active").queryKey,
				{
					pages: [
						RecentSessionsResponse.parse(
							{
								sessions: [session("d1", "Completed one", "done", "alpha")],
								nextCursor: null,
							},
						),
					],
					pageParams: [null],
				},
			);
		});
		await flush();

		expect(
			{
				groups: groupNames(container),
				menu: screen.queryByRole("menu"),
				open: openTriggers(),
			},
		).toStrictEqual(
			{
				groups: ["Idle"],
				menu: null,
				open: [],
			},
		);
	});

	it("scrolls the held trigger into view when an Escape returns focus to it", async () =>
	{
		storePrefs(
			{
				groupBy: "state",
			},
		);
		stubTriggerRects();
		const slotScrolls = stubFocusVisibleScroll();
		const {container} = await renderSidebarGroups();
		await openFilterMenu();
		await pickFolder();
		await flushFrame();
		const held = container.querySelector(`${triggerSelector}[data-held]`);
		// The first Escape closes the Group by submenu; the second closes the menu from its top level.
		fireEvent.keyDown(
			document.activeElement ?? document.body,
			{
				key: "Escape",
			},
		);
		await flush();
		fireEvent.keyDown(
			document.activeElement ?? document.body,
			{
				key: "Escape",
			},
		);
		await flush();
		await flushFrame();

		expect(
			{
				focused: document.activeElement === held,
				scrolls: slotScrolls(),
			},
		).toStrictEqual(
			{
				focused: true,
				scrolls: [
					{
						target: held?.closest("[data-group-sort-trigger]"),
						args: [
							{
								block: "nearest",
							},
						],
					},
				],
			},
		);
	});

	it("does not scroll on an Escape that closes an unheld menu", async () =>
	{
		const slotScrolls = stubFocusVisibleScroll();
		await renderSidebarGroups();
		const menu = await openFilterMenu();
		fireEvent.keyDown(
			menu,
			{
				key: "Escape",
			},
		);
		await flush();

		expect(slotScrolls()).toStrictEqual([]);
	});

	it("blocks wheel scrolling outside the menu while it is open, except a pinch zoom", async () =>
	{
		const {container} = await renderSidebarGroups();
		const row = container.querySelector('[data-testid="sidebar-recents"] a');
		if (row === null) throw new Error("Expected a session row");
		const wheel = (target: Element, ctrlKey = false) =>
		{
			const event = new WheelEvent(
				"wheel",
				{
					cancelable: true,
					bubbles: true,
					ctrlKey,
				},
			);
			target.dispatchEvent(event);
			return event.defaultPrevented;
		};
		const before = wheel(row);
		const menu = await openFilterMenu();
		const whileOpen =
		{
			row: wheel(row),
			pinch: wheel(row, true),
			menu: wheel(menu),
		};
		fireEvent.keyDown(
			menu,
			{
				key: "Escape",
			},
		);
		await flush();

		expect(
			{
				before,
				whileOpen,
				after: wheel(row),
			},
		).toStrictEqual(
			{
				before: false,
				whileOpen:
				{
					row: true,
					pinch: false,
					menu: false,
				},
				after: false,
			},
		);
	});

	it("closes when the sidebar hides around it, but not when opened while already hidden", async () =>
	{
		await renderSidebarGroups();
		await openFilterMenu();
		act(() =>
		{
			setSidebarHiddenRef.current?.(true);
		});
		await flush();
		const closedOnHide = screen.queryByRole("menu");
		await openFilterMenu();

		expect(
			{
				closedOnHide,
				reopenedWhileHidden: screen.queryAllByRole("menu").length,
			},
		).toStrictEqual(
			{
				closedOnHide: null,
				reopenedWhileHidden: 1,
			},
		);
	});
});
