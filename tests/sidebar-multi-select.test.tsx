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
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {SessionGroups} from "../src/components/sidebar/session-groups";
import {isPeekMenuOpen} from "../src/components/sidebar/peek-menu-open";
import {ToastProvider} from "../src/components/toast";
import {RecentSessionsResponse, recentSessionsInfiniteQueryOptions} from "../src/lib/api/sessions";
import {PIN_STORAGE_KEY, readPinState} from "../src/lib/pin-store";
import {readSidebarState, setSidebarGroupsCollapsed} from "../src/lib/sidebar-store";
import {SESSION_GROUP_STORAGE_KEY, readSessionGroupState} from "../src/lib/session-group-store";
import {DEFAULT_SESSION_LIST_PREFS, PINNED_GROUP_KEY} from "../src/lib/session-groups";
import {__unreadStoreTesting, hasUnseenWork, isExplicitUnread} from "../src/lib/unread-store";
import {installLocalStorage} from "./fake-storage";
import {rowTitle} from "./sidebar-row-title";

const MINUTE = 60 * 1000;

function session(id: string, title: string, minutesAgo: number)
{
	const mtime = new Date(Date.now() - minutesAgo * MINUTE).toISOString();
	return {
		id,
		title,
		mtime,
		created: mtime,
		project: `-projects-${id}`,
		projectName: `project-${id}`,
		messageCount: 4,
		archived: false,
		state: "idle",
		bucket: "done",
		liveAgentCount: 0,
		unseen: false,
		blockedSince: null,
	};
}

const FIXTURE = [
	session("a1", "Alpha one", 1),
	session("b1", "Beta one", 3),
	session("u1", "Loose one", 4),
	session("u2", "Loose two", 5),
	session("u3", "Loose three", 6),
];

const ALPHA =
{
	id: "cg-a",
	name: "Alpha",
};
const BETA =
{
	id: "cg-b",
	name: "Beta",
};
const SEEDED_ASSIGNMENTS =
{
	a1: "cg-a",
	b1: "cg-b",
};

const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>();

function archiveCalls(): Array<
{
	url: string;
	method: string | undefined;
}>
{
	return fetchMock.mock.calls
		.map(([input, init]) => (
		{
			url: input,
			method: init?.method,
		}))
		.filter((call) => call.url.endsWith("/archived"));
}

async function renderGroups({
	groupBy = "none",
	sessions = FIXTURE,
	path = "/",
	activeItemId = null,
}:
{
	groupBy?: "none" | "state";
	sessions?: typeof FIXTURE;
	path?: string;
	activeItemId?: string | null;
} = {})
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
				<QueryClientProvider client={queryClient}>
					<ToastProvider>
						<SessionGroups
							activeItemId={activeItemId}
							prefs={
							{
								...DEFAULT_SESSION_LIST_PREFS,
								groupBy,
							}}
						/>
						<main data-testid="outside">
							<button type="button">x</button>
						</main>
						<Outlet />
					</ToastProvider>
				</QueryClientProvider>
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
					initialEntries: [path],
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
	return {
		...result,
		router,
		queryClient,
	};
}

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

function rowLink(title: string): HTMLElement
{
	const link = screen.getByText(title).closest("a[data-row-main-button]");
	if (!(link instanceof HTMLElement)) throw new Error(`no row ${title}`);
	return link;
}

/** Titles of the rows marked multi-selected, in display order. */
function selectedTitles(container: HTMLElement): string[]
{
	return [...container.querySelectorAll("a[data-row-main-button][data-multi-selected]")].map((link) =>
		rowTitle(link),
	);
}

function cmdClick(title: string): void
{
	fireEvent.click(
		rowLink(title),
		{
			metaKey: true,
		},
	);
}

function shiftClick(title: string): void
{
	fireEvent.click(
		rowLink(title),
		{
			shiftKey: true,
		},
	);
}

async function openRowMenu(title: string): Promise<HTMLElement>
{
	fireEvent.contextMenu(
		rowLink(title),
		{
			clientX: 40,
			clientY: 50,
		},
	);
	await flush();
	return await waitFor(() => screen.getByRole("menu"));
}

function menuOutline(menu: HTMLElement): string[]
{
	return [...menu.querySelectorAll('[role="menuitem"], [role="menuitemradio"], [role="separator"]')].map((node) =>
		node.getAttribute("role") === "separator" ? "---" : node.textContent,
	);
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
	expect(menus).toHaveLength(2);
	return menus[1]!;
}

afterEach(() =>
{
	cleanup();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

beforeEach(() =>
{
	installLocalStorage();
	localStorage.setItem(
		SESSION_GROUP_STORAGE_KEY,
		JSON.stringify(
			{
				groups: [ALPHA, BETA],
				assignments: SEEDED_ASSIGNMENTS,
				order: {},
			},
		),
	);
	fetchMock.mockReset();
	fetchMock.mockImplementation(async (_input, init) =>
		Promise.resolve(
			Response.json(
				{
					archived: init?.method === "PUT",
				},
			),
		),
	);
	vi.stubGlobal("fetch", fetchMock);
	__unreadStoreTesting.reset();
	__unreadStoreTesting.setPersist(async () => Promise.resolve());
});

describe("sidebar multi-select", () =>
{
	it("⌘-click toggles rows into the selection without navigating", async () =>
	{
		const {container, router} = await renderGroups();

		cmdClick("Loose one");
		cmdClick("Alpha one");
		const both = selectedTitles(container);
		cmdClick("Loose one");

		expect(
			{
				both,
				after: selectedTitles(container),
				path: router.state.location.pathname,
			},
		).toStrictEqual(
			{
				both: ["Alpha one", "Loose one"],
				after: ["Alpha one"],
				path: "/",
			},
		);
	});

	it("⇧-click selects the displayed range from the anchor", async () =>
	{
		const {container} = await renderGroups();

		cmdClick("Beta one");
		shiftClick("Loose two");

		expect(selectedTitles(container)).toStrictEqual(["Beta one", "Loose one", "Loose two"]);
	});

	it("a plain click clears the selection and opens the session", async () =>
	{
		const {container, router} = await renderGroups();
		cmdClick("Loose one");
		cmdClick("Loose two");

		fireEvent.click(rowLink("Loose three"));

		await waitFor(() =>
		{
			expect(router.state.location.pathname).toBe("/session/u3");
		});
		expect(selectedTitles(container)).toStrictEqual([]);
	});

	it("Escape clears the selection", async () =>
	{
		const {container} = await renderGroups();
		cmdClick("Loose one");
		cmdClick("Loose two");

		fireEvent.keyDown(
			window,
			{
				key: "Escape",
			},
		);

		expect(selectedTitles(container)).toStrictEqual([]);
	});

	it("a plain, ⌥ or touch primary press outside the list clears the selection", async () =>
	{
		const {container} = await renderGroups();
		const outside = screen.getByTestId("outside");
		const after: string[][] = [];
		for (const init of [
			{
				button: 0,
			},
			{
				button: 0,
				altKey: true,
			},
			{
				button: 0,
				pointerType: "touch",
			},
		])
		{
			cmdClick("Loose one");
			cmdClick("Loose two");
			fireEvent.pointerDown(outside, init);
			after.push(selectedTitles(container));
		}

		expect(after).toStrictEqual([[], [], []]);
	});

	it("a modifier or non-primary press outside, or a press inside the list, a menu or a toast keeps the selection", async () =>
	{
		const {container} = await renderGroups();
		cmdClick("Loose one");
		cmdClick("Loose two");
		const outside = screen.getByTestId("outside");
		for (const init of [
			{
				button: 0,
				shiftKey: true,
			},
			{
				button: 0,
				metaKey: true,
			},
			{
				button: 0,
				ctrlKey: true,
			},
			{
				button: 2,
			},
			{
				button: 1,
			},
		])
			fireEvent.pointerDown(outside, init);
		fireEvent.pointerDown(
			container.querySelector("[data-group-toggle]")!,
			{
				button: 0,
			},
		);
		fireEvent.pointerDown(
			recentsList(container),
			{
				button: 0,
			},
		);
		const kept = selectedTitles(container);
		const menu = await openRowMenu("Loose one");
		fireEvent.pointerDown(
			within(menu).getAllByRole("menuitem")[0]!,
			{
				button: 0,
			},
		);
		const keptInMenu = selectedTitles(container);
		fireEvent.keyDown(
			menu,
			{
				key: "a",
			},
		);
		const toastText = await waitFor(() => screen.getByText("Archived 2 sessions"));
		cmdClick("Loose three");
		cmdClick("Beta one");
		fireEvent.pointerDown(
			toastText,
			{
				button: 0,
			},
		);

		expect(
			{
				kept,
				keptInMenu,
				keptOnToast: selectedTitles(container),
				toast: screen.queryByText("Archived 2 sessions") !== null,
			},
		).toStrictEqual(
			{
				kept: ["Loose one", "Loose two"],
				keptInMenu: ["Loose one", "Loose two"],
				keptOnToast: ["Beta one", "Loose three"],
				toast: true,
			},
		);
	});

	it("listens for outside presses in the document capture phase only while rows are selected", async () =>
	{
		const add = vi.spyOn(document, "addEventListener");
		const remove = vi.spyOn(document, "removeEventListener");
		const {container} = await renderGroups();
		const pointerCalls = (spy: typeof add) => spy.mock.calls.filter(([type]) => type === "pointerdown");
		const idle = pointerCalls(add).length;
		cmdClick("Loose one");
		const added = pointerCalls(add);
		fireEvent.pointerDown(
			screen.getByTestId("outside"),
			{
				button: 0,
			},
		);
		const removed = pointerCalls(remove);

		expect(
			{
				idle,
				added: added.map(([type, , options]) => [type, options]),
				removed: removed.map(([type, listener, options]) => [type, listener === added[0]?.[1], options]),
				selected: selectedTitles(container),
			},
		).toStrictEqual(
			{
				idle: 0,
				added: [["pointerdown", true]],
				removed: [["pointerdown", true, true]],
				selected: [],
			},
		);
	});
});

async function openIdleHeaderMenu(): Promise<HTMLElement>
{
	const header = screen.getByText("Idle").closest("[data-group-toggle]");
	if (!(header instanceof HTMLElement)) throw new Error("no Idle header");
	fireEvent.contextMenu(
		header,
		{
			clientX: 40,
			clientY: 50,
		},
	);
	await flush();
	return await waitFor(() => screen.getByRole("menu"));
}

/** Each header menu item with its disabled reason, or null while it is enabled. */
function headerMenuItems(menu: HTMLElement): Array<
{
	label: string | null;
	disabledReason: string | null;
}>
{
	return [...menu.querySelectorAll('[role="menuitem"], [role="separator"]')].map((node) =>
	{
		if (node.getAttribute("role") === "separator")
			return {
				label: "---",
				disabledReason: null,
			};
		const describedBy = node.getAttribute("aria-describedby");
		return {
			label: node.textContent,
			disabledReason:
				node.getAttribute("aria-disabled") === "true"
					? (document.getElementById(describedBy ?? "")?.textContent ?? "")
					: null,
		};
	});
}

describe("sidebar group header context menu", () =>
{
	it("offers New session, Select all, Collapse all / Expand all and Archive all (N) like upstream", async () =>
	{
		await renderGroups(
			{
				groupBy: "state",
			},
		);

		expect(headerMenuItems(await openIdleHeaderMenu())).toStrictEqual([
			{
				label: "New session",
				disabledReason: null,
			},
			{
				label: "---",
				disabledReason: null,
			},
			{
				label: "Select all",
				disabledReason: null,
			},
			{
				label: "---",
				disabledReason: null,
			},
			{
				label: "Collapse all",
				disabledReason: null,
			},
			{
				label: "Expand all",
				disabledReason: "Everything is already expanded.",
			},
			{
				label: "---",
				disabledReason: null,
			},
			{
				label: "Archive all (3)",
				disabledReason: null,
			},
		]);
	});

	it("selects every row in a state group from the header's context menu", async () =>
	{
		const {container} = await renderGroups(
			{
				groupBy: "state",
			},
		);

		await openIdleHeaderMenu();
		fireEvent.click(
			screen.getByRole(
				"menuitem",
				{
					name: "Select all",
				},
			),
		);
		await flush();

		expect(selectedTitles(container)).toStrictEqual(["Loose one", "Loose two", "Loose three"]);
	});

	it("disables Select all under two visible sessions and Archive all with nothing to archive", async () =>
	{
		await renderGroups(
			{
				groupBy: "state",
				sessions: [session("u1", "Loose one", 1)],
				activeItemId: "u1",
			},
		);

		expect(headerMenuItems(await openIdleHeaderMenu())).toStrictEqual([
			{
				label: "New session",
				disabledReason: null,
			},
			{
				label: "---",
				disabledReason: null,
			},
			{
				label: "Select all",
				disabledReason: "Select all needs at least two visible sessions in this group.",
			},
			{
				label: "---",
				disabledReason: null,
			},
			{
				label: "Collapse all",
				disabledReason: null,
			},
			{
				label: "Expand all",
				disabledReason: "Everything is already expanded.",
			},
			{
				label: "---",
				disabledReason: null,
			},
			{
				label: "Archive all (0)",
				disabledReason:
					"Every item here is pinned, open in a pane or window, already archived, or can\u2019t be archived from here.",
			},
		]);
	});

	it("Collapse all collapses every shown group, then Expand all expands them again", async () =>
	{
		await renderGroups(
			{
				groupBy: "state",
			},
		);

		fireEvent.click(menuItemByLabel(await openIdleHeaderMenu(), "Collapse all"));
		await flush();
		const collapsed = readSidebarState().collapsedGroups;
		const collapsedMenu = headerMenuItems(await openIdleHeaderMenu()).slice(4, 6);
		fireEvent.click(
			screen.getByRole(
				"menuitem",
				{
					name: "Expand all",
				},
			),
		);
		await flush();

		expect(
			{
				collapsed,
				collapsedMenu,
				expanded: readSidebarState().collapsedGroups,
			},
		).toStrictEqual(
			{
				collapsed: ["custom-cg-a", "custom-cg-b", "state-done"],
				collapsedMenu: [
					{
						label: "Collapse all",
						disabledReason: "Everything shown is already collapsed.",
					},
					{
						label: "Expand all",
						disabledReason: null,
					},
				],
				expanded: [],
			},
		);
	});

	it("Archive all asks to confirm, then archives every unpinned row that is not open", async () =>
	{
		await renderGroups(
			{
				groupBy: "state",
				activeItemId: "u3",
			},
		);

		fireEvent.click(menuItemByLabel(await openIdleHeaderMenu(), "Archive all (2)"));
		await flush();
		const dialog = await waitFor(() => screen.getByRole("alertdialog"));
		const title = dialog.querySelector("h2")?.textContent;
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Archive all",
				},
			),
		);

		await waitFor(() =>
		{
			expect(archiveCalls()).toHaveLength(2);
		});
		expect(
			{
				title,
				calls: archiveCalls(),
			},
		).toStrictEqual(
			{
				title: "Archive all sessions in \u201cIdle\u201d?",
				calls: [
					{
						url: "/api/sessions/u1/archived",
						method: "PUT",
					},
					{
						url: "/api/sessions/u2/archived",
						method: "PUT",
					},
				],
			},
		);
	});

	it("New session goes home", async () =>
	{
		const {router} = await renderGroups(
			{
				groupBy: "state",
				path: "/session/a1",
			},
		);

		fireEvent.click(menuItemByLabel(await openIdleHeaderMenu(), "New session"));

		await waitFor(() =>
		{
			expect(router.state.location.pathname).toBe("/");
		});
	});
});

function menuItemByLabel(menu: HTMLElement, label: string): HTMLElement
{
	const item = [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
		(node) => node.textContent === label,
	);
	if (item === undefined) throw new Error(`No menu item ${label}`);
	return item;
}

describe("sidebar bulk menu", () =>
{
	it("offers only the bulk actions on a selected row, with no Delete", async () =>
	{
		await renderGroups();
		cmdClick("Loose one");
		cmdClick("Loose two");

		const menu = await openRowMenu("Loose two");

		expect(menuOutline(menu)).toStrictEqual(["Mark as unreadU", "---", "Move 2 to section", "---", "ArchiveA"]);
	});

	it("keeps the single-row menu on a row outside the selection", async () =>
	{
		await renderGroups();
		cmdClick("Loose one");
		cmdClick("Loose two");

		const menu = await openRowMenu("Loose three");

		expect(menuOutline(menu)).toContain("RenameR");
	});

	it("moves every selected row into the picked group and clears the selection", async () =>
	{
		const {container} = await renderGroups();
		cmdClick("Loose one");
		cmdClick("Loose three");
		await openRowMenu("Loose one");

		const submenu = await openSubmenu(/^Move 2 to section/);
		expect(menuOutline(submenu)).toStrictEqual(["Alpha1", "Beta2", "---", "New section3"]);
		fireEvent.keyDown(
			submenu,
			{
				key: "2",
			},
		);
		await flush();

		expect(
			{
				assignments: readSessionGroupState().assignments,
				selected: selectedTitles(container),
			},
		).toStrictEqual(
			{
				assignments:
				{
					...SEEDED_ASSIGNMENTS,
					u1: "cg-b",
					u3: "cg-b",
				},
				selected: [],
			},
		);
	});

	it("New group… creates a group holding every selected row", async () =>
	{
		await renderGroups();
		cmdClick("Loose one");
		cmdClick("Loose two");
		await openRowMenu("Loose two");
		const submenu = await openSubmenu(/^Move 2 to section/);

		fireEvent.keyDown(
			submenu,
			{
				key: "3",
			},
		);
		await flush();
		const dialog = await waitFor(() => screen.getByRole("dialog"));
		fireEvent.change(
			screen.getByPlaceholderText("Section name"),
			{
				target:
				{
					value: "Gamma",
				},
			},
		);
		fireEvent.submit(dialog.querySelector("form")!);
		await flush();

		const {groups, assignments} = readSessionGroupState();
		const gamma = groups.find((group) => group.name === "Gamma");
		expect(
			{
				groupNames: groups.map((group) => group.name),
				assignments,
			},
		).toStrictEqual(
			{
				groupNames: ["Alpha", "Beta", "Gamma"],
				assignments:
				{
					...SEEDED_ASSIGNMENTS,
					u1: gamma?.id,
					u2: gamma?.id,
				},
			},
		);
	});

	it("marks every selected row unread", async () =>
	{
		await renderGroups();
		cmdClick("Loose one");
		cmdClick("Beta one");
		const menu = await openRowMenu("Beta one");

		fireEvent.keyDown(
			menu,
			{
				key: "u",
			},
		);
		await flush();

		expect(["b1", "u1", "u2"].map((id) => [hasUnseenWork(id), isExplicitUnread(id)])).toStrictEqual([
			[true, true],
			[true, true],
			[false, false],
		]);
	});

	it("archives every selected row with one Undo toast", async () =>
	{
		await renderGroups();
		cmdClick("Loose one");
		cmdClick("Loose two");
		const menu = await openRowMenu("Loose one");

		fireEvent.keyDown(
			menu,
			{
				key: "a",
			},
		);

		await waitFor(() =>
		{
			expect(screen.getByText("Archived 2 sessions")).toBeTruthy();
		});
		expect(archiveCalls()).toStrictEqual([
			{
				url: "/api/sessions/u1/archived",
				method: "PUT",
			},
			{
				url: "/api/sessions/u2/archived",
				method: "PUT",
			},
		]);
	});
});

const ROW_STEP = 33;
const RECENTS_TOP = 300;
const UNIT_SELECTOR = "[data-sidebar-group-label], [data-drag-id], [data-ungroup-drop-row]";

function rect(top: number, height: number): DOMRect
{
	return {
		top,
		bottom: top + height,
		height,
		left: 0,
		right: 240,
		width: 240,
		x: 0,
		y: top,
		toJSON: () => ({}),
	};
}

/** Pinned spans 0-250; below it every header and row takes a 33px step from 300. */
function layout(element: Element): DOMRect
{
	if (element.matches('[data-testid="sidebar-pinned"]')) return rect(0, 250);
	if (element.matches("[data-pin-drop-row]")) return rect(200, 32);
	const list = element.closest('[data-testid="sidebar-sections"], [data-testid="sidebar-recents"]');
	if (list === null) return rect(0, 0);
	const units = [
		...document.querySelectorAll(
			`[data-testid="sidebar-sections"] :is(${UNIT_SELECTOR}), [data-testid="sidebar-recents"] :is(${UNIT_SELECTOR})`,
		),
	];
	const top = (unit: Element) => RECENTS_TOP + ROW_STEP * units.indexOf(unit);
	if (element.matches(UNIT_SELECTOR)) return rect(top(element), 32);
	const inside = units.filter((unit) => element.contains(unit));
	const first = inside[0];
	const last = inside.at(-1);
	if (first === undefined || last === undefined) return rect(0, 0);
	return rect(top(first), top(last) + 32 - top(first));
}

function unitY(index: number): number
{
	return RECENTS_TOP + ROW_STEP * index + 16;
}

function pointer(type: "move" | "up", clientY: number): void
{
	act(() =>
	{
		const init =
		{
			pointerId: 1,
			clientX: 50,
			clientY,
		};
		if (type === "move") fireEvent.pointerMove(window, init);
		else fireEvent.pointerUp(window, init);
	});
}

// Units: 0 Alpha, 1 Alpha one, 2 Beta, 3 Beta one, 4 Recents, 5 Loose one, 6 Loose two, 7 Loose three.

describe("sidebar multi-row drag", () =>
{
	beforeEach(() =>
	{
		vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element)
		{
			return layout(this);
		});
	});

	it("drops every selected row onto a group header, keeping their order", async () =>
	{
		const {container} = await renderGroups();
		cmdClick("Loose one");
		cmdClick("Loose three");

		fireEvent.pointerDown(
			rowLink("Loose three"),
			{
				button: 0,
				pointerId: 1,
				clientX: 50,
				clientY: unitY(7),
			},
		);
		pointer("move", unitY(7) - 20);
		const pinDropRow = container.querySelector("[data-pin-drop-row]");
		pointer("move", unitY(0));
		pointer("up", unitY(0));

		await waitFor(() =>
		{
			expect(readSessionGroupState()).toStrictEqual(
				{
					groups: [ALPHA, BETA],
					assignments:
					{
						...SEEDED_ASSIGNMENTS,
						u1: "cg-a",
						u3: "cg-a",
					},
					order:
					{
						"cg-a": ["u1", "u3", "a1"],
					},
				},
			);
		});
		expect(
			{
				pinDropRow,
				selected: selectedTitles(container),
			},
		).toStrictEqual(
			{
				pinDropRow: null,
				selected: [],
			},
		);
	});

	it("cannot pin a multi-row drag", async () =>
	{
		localStorage.setItem(
			PIN_STORAGE_KEY,
			JSON.stringify(
				{
					pinnedIds: [],
					pinnedOrder: [],
				},
			),
		);
		await renderGroups();
		cmdClick("Loose one");
		cmdClick("Loose two");

		fireEvent.pointerDown(
			rowLink("Loose two"),
			{
				button: 0,
				pointerId: 1,
				clientX: 50,
				clientY: unitY(6),
			},
		);
		pointer("move", unitY(6) - 20);
		pointer("move", 216);
		pointer("up", 216);
		await flush();

		expect(
			{
				pins: readPinState(),
				assignments: readSessionGroupState().assignments,
			},
		).toStrictEqual(
			{
				pins:
				{
					pinnedIds: [],
					pinnedOrder: [],
				},
				assignments: SEEDED_ASSIGNMENTS,
			},
		);
	});
});

async function openWhitespaceMenu(target: Element): Promise<HTMLElement>
{
	fireEvent.contextMenu(
		target,
		{
			clientX: 40,
			clientY: 300,
		},
	);
	await flush();
	return await waitFor(() => screen.getByRole("menu"));
}

function recentsList(container: HTMLElement): HTMLElement
{
	const recents = container.querySelector<HTMLElement>("[data-testid=sidebar-recents]");
	if (recents === null) throw new Error("no Recents list");
	return recents;
}

function pinnedList(container: HTMLElement): HTMLElement
{
	const pinned = container.querySelector<HTMLElement>("[data-pinned-list]");
	if (pinned === null) throw new Error("no Pinned list");
	return pinned;
}

function groupToggle(label: string): HTMLElement
{
	const toggle = screen.getByText(label).closest<HTMLElement>("[data-group-toggle]");
	if (toggle === null) throw new Error(`no ${label} toggle`);
	return toggle;
}

function pinRows(ids: string[]): void
{
	localStorage.setItem(
		PIN_STORAGE_KEY,
		JSON.stringify(
			{
				pinnedIds: ids,
				pinnedOrder: ids,
			},
		),
	);
}

async function closeMenu(): Promise<void>
{
	fireEvent.keyDown(
		screen.getByRole("menu"),
		{
			key: "Escape",
		},
	);
	await flush();
	await waitFor(() =>
	{
		expect(screen.queryByRole("menu")).toBeNull();
	});
}

describe("sidebar whitespace context menu", () =>
{
	it("opens upstream's menu on the list's empty space, without New environment", async () =>
	{
		const {container} = await renderGroups();

		const menu = await openWhitespaceMenu(recentsList(container));

		expect(
			{
				items: headerMenuItems(menu),
				groups: menu.querySelectorAll('[role="group"]').length,
			},
		).toStrictEqual(
			{
				items: [
					{
						label: "New session",
						disabledReason: null,
					},
					{
						label: "---",
						disabledReason: null,
					},
					{
						label: "New section",
						disabledReason: null,
					},
					{
						label: "---",
						disabledReason: null,
					},
					{
						label: "Select all",
						disabledReason: null,
					},
					{
						label: "---",
						disabledReason: null,
					},
					{
						label: "Collapse all",
						disabledReason: null,
					},
					{
						label: "Expand all",
						disabledReason: "Everything is already expanded.",
					},
				],
				groups: 4,
			},
		);
	});

	it("leaves a row's right-click to the row menu and a header's to the header menu", async () =>
	{
		await renderGroups(
			{
				groupBy: "state",
			},
		);

		const rowMenu = menuOutline(await openRowMenu("Loose one"));
		await closeMenu();
		const headerMenu = menuOutline(await openIdleHeaderMenu());

		expect(
			{
				rowHasNewSection: rowMenu.includes("New section"),
				headerMenu,
			},
		).toStrictEqual(
			{
				rowHasNewSection: false,
				headerMenu: [
					"New session",
					"---",
					"Select all",
					"---",
					"Collapse all",
					"Expand all",
					"---",
					"Archive all (3)",
				],
			},
		);
	});

	it("New section opens upstream's New section dialog", async () =>
	{
		const {container} = await renderGroups();

		fireEvent.click(menuItemByLabel(await openWhitespaceMenu(recentsList(container)), "New section"));
		await flush();
		const dialog = await waitFor(() => screen.getByRole("dialog"));

		expect(
			{
				title: dialog.querySelector("h2")?.textContent,
				placeholder: dialog.querySelector("input")?.getAttribute("placeholder"),
				createDisabled: screen
					.getByRole(
						"button",
						{
							name: "Create section",
						},
					)
					.hasAttribute("disabled"),
			},
		).toStrictEqual(
			{
				title: "New section",
				placeholder: "Section name",
				createDisabled: true,
			},
		);
	});

	it("marks the list root as upstream's code session list and keeps a peek open while the menu is", async () =>
	{
		const {container} = await renderGroups();
		const root = recentsList(container).parentElement!;
		const peek = document.createElement("div");
		peek.append(container);
		document.body.append(peek);
		const closedPeek = isPeekMenuOpen(peek);

		await openWhitespaceMenu(recentsList(container));

		expect(
			{
				kind: root.getAttribute("data-kind"),
				listClass: root.classList.contains("df-session-list"),
				closedPeek,
				overflowMenuOpen: root.hasAttribute("data-overflow-menu-open"),
				openPeek: isPeekMenuOpen(peek),
			},
		).toStrictEqual(
			{
				kind: "code",
				listClass: true,
				closedPeek: false,
				overflowMenuOpen: true,
				openPeek: true,
			},
		);
	});

	it("disables Select all with fewer than two selectable sessions", async () =>
	{
		const {container} = await renderGroups(
			{
				sessions: [session("u1", "Loose one", 1)],
			},
		);

		expect(
			headerMenuItems(await openWhitespaceMenu(recentsList(container))).find(
				(item) => item.label === "Select all",
			),
		).toStrictEqual(
			{
				label: "Select all",
				disabledReason: "You need at least 2 sessions that can be selected.",
			},
		);
	});

	it("asks to expand a section when a collapsed one hides the sessions to select", async () =>
	{
		const {container} = await renderGroups(
			{
				sessions: [session("a1", "Alpha one", 1), session("u1", "Loose one", 2), session("u2", "Loose two", 3)],
			},
		);
		fireEvent.click(groupToggle("Recents"));
		await flush();

		expect(
			headerMenuItems(await openWhitespaceMenu(recentsList(container))).find(
				(item) => item.label === "Select all",
			),
		).toStrictEqual(
			{
				label: "Select all",
				disabledReason: "Expand a section to select its sessions.",
			},
		);
	});

	it("Select all replaces the selection with every shown session", async () =>
	{
		const {container} = await renderGroups();
		cmdClick("Loose two");

		fireEvent.click(menuItemByLabel(await openWhitespaceMenu(recentsList(container)), "Select all"));
		await flush();

		expect(selectedTitles(container)).toStrictEqual([
			"Alpha one",
			"Beta one",
			"Loose one",
			"Loose two",
			"Loose three",
		]);
	});

	it("Select all from Pinned's padding selects only the pinned sessions", async () =>
	{
		pinRows(["u1", "u2"]);
		const {container} = await renderGroups();
		cmdClick("Loose three");

		fireEvent.click(menuItemByLabel(await openWhitespaceMenu(pinnedList(container)), "Select all"));
		await flush();

		expect(selectedTitles(container)).toStrictEqual(["Loose one", "Loose two"]);
	});

	it("Select all from a folded Pinned unfolds it, then selects the pinned sessions", async () =>
	{
		pinRows(["u1", "u2"]);
		const {container} = await renderGroups();
		fireEvent.click(groupToggle("Pinned"));
		await flush();

		fireEvent.click(menuItemByLabel(await openWhitespaceMenu(pinnedList(container)), "Select all"));
		await flush();

		expect(
			{
				pinnedExpanded: groupToggle("Pinned").getAttribute("aria-expanded"),
				selected: selectedTitles(container),
			},
		).toStrictEqual(
			{
				pinnedExpanded: "true",
				selected: ["Loose one", "Loose two"],
			},
		);
	});

	it("Collapse all folds every section, Pinned included, then disables itself", async () =>
	{
		pinRows(["u1"]);
		const {container} = await renderGroups();

		fireEvent.click(menuItemByLabel(await openWhitespaceMenu(recentsList(container)), "Collapse all"));
		await flush();
		const toggles = [...container.querySelectorAll("[data-group-toggle]")].map((toggle) =>
			toggle.getAttribute("aria-expanded"),
		);
		const reopened = headerMenuItems(await openWhitespaceMenu(recentsList(container))).slice(6);

		expect(
			{
				toggles,
				reopened,
			},
		).toStrictEqual(
			{
				toggles: ["false", "false", "false", "false"],
				reopened: [
					{
						label: "Collapse all",
						disabledReason: "Everything shown is already collapsed.",
					},
					{
						label: "Expand all",
						disabledReason: null,
					},
				],
			},
		);
	});

	it("Expand all ignores the folded toggle of the inert Pinned stub", async () =>
	{
		const {container} = await renderGroups();
		act(() =>
		{
			setSidebarGroupsCollapsed([PINNED_GROUP_KEY], true);
		});
		await flush();

		expect(
			{
				stubToggle: container
					.querySelector("[data-pinned-list] [data-group-toggle]")
					?.getAttribute("aria-expanded"),
				items: headerMenuItems(await openWhitespaceMenu(recentsList(container))).slice(6),
			},
		).toStrictEqual(
			{
				stubToggle: "false",
				items: [
					{
						label: "Collapse all",
						disabledReason: null,
					},
					{
						label: "Expand all",
						disabledReason: "Everything is already expanded.",
					},
				],
			},
		);
	});

	it("Collapse all hands focus from a hidden row to its section's toggle", async () =>
	{
		const {container} = await renderGroups();
		act(() =>
		{
			rowLink("Loose two").focus();
		});

		fireEvent.click(menuItemByLabel(await openWhitespaceMenu(recentsList(container)), "Collapse all"));
		await flush();

		await waitFor(() =>
		{
			expect(document.activeElement).toBe(groupToggle("Recents"));
		});
	});

	it("keeps Select all's disabled state from when the menu opened", async () =>
	{
		const {container, queryClient} = await renderGroups(
			{
				sessions: [session("u1", "Loose one", 1)],
			},
		);
		await openWhitespaceMenu(recentsList(container));
		act(() =>
		{
			queryClient.setQueryData(
				recentSessionsInfiniteQueryOptions().queryKey,
				{
					pages: [
						RecentSessionsResponse.parse(
							{
								sessions: [
									session("u1", "Loose one", 1),
									session("u2", "Loose two", 2),
									session("u3", "Loose three", 3),
								],
								nextCursor: null,
							},
						),
					],
					pageParams: [null],
				},
			);
		});
		await flush();
		const whileOpen = menuItemByLabel(screen.getByRole("menu"), "Select all").getAttribute("aria-disabled");
		await closeMenu();
		const reopened = menuItemByLabel(await openWhitespaceMenu(recentsList(container)), "Select all").getAttribute(
			"aria-disabled",
		);

		expect(
			{
				whileOpen,
				reopened,
			},
		).toStrictEqual(
			{
				whileOpen: "true",
				reopened: null,
			},
		);
	});
});
