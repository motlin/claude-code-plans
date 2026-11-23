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
	useRouterState,
} from "@tanstack/react-router";
import {act, cleanup, fireEvent, render, renderHook, screen, waitFor} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {SessionGroups} from "../src/components/sidebar/session-groups";
import {DEFAULT_SESSION_LIST_PREFS} from "../src/lib/session-groups";
import {ToastProvider} from "../src/components/toast";
import {RecentSessionsResponse, recentSessionsInfiniteQueryOptions} from "../src/lib/api/sessions";
import type {SessionBucket} from "../src/lib/session-state";
import {resetClickGuards} from "../src/lib/sidebar-click-guard";
import {resetFamilyHeadsStore, useFamilyHeads} from "../src/lib/sidebar-family-heads-store";
import {readSidebarState, toggleFamilyCollapsed} from "../src/lib/sidebar-store";
import {installLocalStorage} from "./fake-storage";
import {rowTitle} from "./sidebar-row-title";

const MINUTE = 60 * 1000;

function session(
	id: string,
	title: string,
	bucket: SessionBucket,
	minutesAgo: number,
	extra:
	{
		forkedFromSessionId?: string;
		unseen?: boolean;
		unseenError?: true;
	} = {},
)
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
		state: bucket === "working" ? "working" : bucket === "blocked" ? "waiting" : "idle",
		bucket,
		liveAgentCount: 0,
		unseen: extra.unseen ?? false,
		blockedSince: null,
		...(extra.unseenError === undefined
			? {}
			:
				{
					unseenError: extra.unseenError,
					erroredAt: mtime,
				}),
		...(extra.forkedFromSessionId === undefined
			? {}
			:
				{
					forkedFromSessionId: extra.forkedFromSessionId,
				}),
	};
}

// Head h1 is done, but its family takes the most urgent member bucket (Working).
const FAMILY = [
	session("h1", "Head one", "done", 10),
	session(
		"c1",
		"Child one",
		"working",
		1,
		{
			forkedFromSessionId: "h1",
		},
	),
	session(
		"g1",
		"Grandchild one",
		"review",
		2,
		{
			forkedFromSessionId: "c1",
			unseen: true,
		},
	),
	session("s1", "Solo one", "working", 3),
];

const TWO_FAMILIES = [
	...FAMILY,
	session("h2", "Head two", "working", 4),
	session(
		"c2",
		"Child two",
		"working",
		5,
		{
			forkedFromSessionId: "h2",
		},
	),
];

function RoutedSessionGroups()
{
	const pathname = useRouterState(
		{
			select: (state) => state.location.pathname,
		},
	);
	const activeItemId = /^\/session\/(.+)$/.exec(pathname)?.[1] ?? null;
	return (
		<SessionGroups
			activeItemId={activeItemId}
			prefs={
			{
				...DEFAULT_SESSION_LIST_PREFS,
				groupBy: "state",
			}}
		/>
	);
}

async function renderGroups(
	sessions: unknown[],
	{
		path = "/",
	}:
	{
		path?: string;
	} = {},
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
						<RoutedSessionGroups />
						<Outlet />
					</ToastProvider>
				</QueryClientProvider>
			),
		},
	);
	const sessionRoute = createRoute(
		{
			getParentRoute: () => rootRoute,
			path: "/session/$id",
			component: () => null,
		},
	);
	const homeRoute = createRoute(
		{
			getParentRoute: () => rootRoute,
			path: "/",
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
	};
}

function family(container: HTMLElement, headId: string): HTMLElement
{
	const element = container.querySelector(`.df-family[data-family-head="${headId}"]`);
	if (!(element instanceof HTMLElement)) throw new Error(`no family for ${headId}`);
	return element;
}

function foldedStub(container: HTMLElement, headId: string): HTMLElement
{
	const element = family(container, headId).querySelector("button.df-family-stub");
	if (!(element instanceof HTMLElement)) throw new Error(`no stub for ${headId}`);
	return element;
}

function rowTitles(element: Element): string[]
{
	return [...element.querySelectorAll("a[data-row-main-button] [data-row-label]")].map((label) => rowTitle(label));
}

function headLink(container: HTMLElement, headId: string): HTMLElement
{
	const element = container.querySelector(`[data-row-key="${headId}"] a[data-row-main-button]`);
	if (!(element instanceof HTMLElement)) throw new Error(`no head row for ${headId}`);
	return element;
}

function rowWrapper(container: HTMLElement, id: string): HTMLElement
{
	const element = container.querySelector(`[data-row-key="${id}"]`);
	if (!(element instanceof HTMLElement)) throw new Error(`no row ${id}`);
	return element;
}

function caret(container: HTMLElement, headId: string): HTMLElement
{
	const element = headLink(container, headId).querySelector('[role="button"][data-container-icon]');
	if (!(element instanceof HTMLElement)) throw new Error(`no caret for ${headId}`);
	return element;
}

function attributes(element: Element, names: readonly string[]): Record<string, string | null>
{
	return Object.fromEntries(names.map((name) => [name, element.getAttribute(name)]));
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

async function rightClickRow(container: HTMLElement, id: string): Promise<HTMLElement>
{
	fireEvent.contextMenu(headLink(container, id));
	await flush();
	return screen.getByRole("menu");
}

/** The open menu's items and separators, separators as "---". */
function menuOutline(menu: HTMLElement): string[]
{
	return [...menu.querySelectorAll('[role="menuitem"], [role="separator"]')].map((node) =>
		node.getAttribute("role") === "separator" ? "---" : (node.getAttribute("aria-label") ?? node.textContent),
	);
}

const CARET_ATTRIBUTES = ["role", "aria-expanded", "aria-label", "data-row-action", "tabindex"] as const;

afterEach(cleanup);

beforeEach(() =>
{
	installLocalStorage();
	resetClickGuards();
});

describe("sidebar session families", () =>
{
	// Upstream `g0`/`sS`: the mounted code list exposes its non-archived family heads to ⌘K.
	it("publishes its family heads to the palette while mounted", async () =>
	{
		resetFamilyHeadsStore();
		const heads = renderHook(() => useFamilyHeads());
		const {unmount} = await renderGroups(TWO_FAMILIES);
		// In display order: h2's family sorts above h1's in Working.
		expect(heads.result.current).toStrictEqual(["h2", "h1"]);
		unmount();
		expect(heads.result.current).toBeNull();
	});

	it("publishes no archived family head", async () =>
	{
		resetFamilyHeadsStore();
		const heads = renderHook(() => useFamilyHeads());
		await renderGroups(
			TWO_FAMILIES.map((row) =>
				row.id === "h2"
					?
						{
							...row,
							archived: true,
						}
					: row,
			),
		);
		expect(heads.result.current).toStrictEqual(["h1"]);
	});

	it("nests forks under their top ancestor in the family's most urgent group, indented 20px", async () =>
	{
		const {container} = await renderGroups(FAMILY);

		const working = container.querySelector('[data-group-key="state-working"]');
		if (!(working instanceof HTMLElement)) throw new Error("no Working group");
		expect(rowTitles(working)).toStrictEqual(["Solo one", "Head one", "Child one", "Grandchild one"]);
		expect(container.querySelector('[data-group-key="state-done"]')).toBeNull();
		expect(container.querySelector('[data-group-key="state-review"]')).toBeNull();

		const nested = family(container, "h1");
		expect(rowTitles(nested)).toStrictEqual(["Child one", "Grandchild one"]);
		const childWrappers = [...nested.querySelectorAll(":scope > [data-family-child]")];
		expect(childWrappers.map((wrapper) => wrapper.classList.contains("pl-5"))).toStrictEqual([true, true]);
		expect(childWrappers.map((wrapper) => wrapper.getAttribute("data-jump-hint-row"))).toStrictEqual(["", ""]);
		// Upstream stacks nested rows 2px apart (code-list row margin), a 34px pitch like their head.
		expect(
			{
				px: nested.classList.contains("gap-px"),
				stack: nested.classList.contains("gap-[var(--sb-row-stack-gap)]"),
			},
		).toStrictEqual(
			{
				px: false,
				stack: true,
			},
		);
		const headWrapper = nested.previousElementSibling;
		expect(headWrapper?.hasAttribute("data-family-child")).toBe(false);
		expect(headWrapper?.classList.contains("pl-5")).toBe(false);
		expect(rowTitles(headWrapper ?? nested)).toStrictEqual(["Head one"]);
		expect([...nested.querySelectorAll("[data-family-lineage]")].map((label) => label.textContent)).toStrictEqual([
			"Forked from Head one",
			"Forked from Child one",
		]);
	});

	it("collapses a family to a stub row from its head row's caret and persists collapsedFamilies", async () =>
	{
		const first = await renderGroups(FAMILY);
		const toggle = caret(first.container, "h1");
		expect(toggle.getAttribute("aria-expanded")).toBe("true");
		expect(toggle.getAttribute("aria-label")).toBe("Hide nested sessions");
		expect(toggle.tabIndex).toBe(-1);

		fireEvent.click(toggle);

		expect(readSidebarState().collapsedFamilies).toStrictEqual(["code:h1"]);
		expect(toggle.getAttribute("aria-expanded")).toBe("false");
		expect(toggle.getAttribute("aria-label")).toBe("Show nested sessions");
		expect(rowTitles(family(first.container, "h1"))).toStrictEqual([]);
		const stub = family(first.container, "h1").querySelector("button.df-family-stub");
		if (!(stub instanceof HTMLElement)) throw new Error("no stub");
		const segments = [...stub.querySelectorAll(".df-fade-truncate > span.flex.shrink-0.items-center")];
		expect(
			{
				aria: stub.getAttribute("aria-label"),
				text: stub.textContent,
				label: stub.querySelector(
					":scope > span.df-fade-truncate.flex.items-center.whitespace-nowrap > span[data-row-label].min-w-0 .dframe-fade-label",
				)?.textContent,
				segments: segments.map((segment) => segment.textContent),
				separators: segments.map((segment) =>
					segment.firstElementChild?.matches('span[aria-hidden="true"].px-1\\.5.text-ink-muted'),
				),
				unreadInk: segments[0]?.querySelector(":scope > span.flex.items-center.gap-1\\.5.text-upstream-accent")
					?.textContent,
				dot: stub.querySelector(".rounded-full"),
				decoration: stub.querySelector("[data-row-decoration]"),
			},
		).toStrictEqual(
			{
				aria: "Show 2 nested sessions, 1 unread, 1 working",
				text: "2 nested sessions·1 unread·1 working",
				label: "2 nested sessions",
				segments: ["·1 unread", "·1 working"],
				separators: [true, true],
				unreadInk: "1 unread",
				dot: null,
				decoration: null,
			},
		);

		first.unmount();
		const second = await renderGroups(FAMILY);
		expect(rowTitles(family(second.container, "h1"))).toStrictEqual([]);

		fireEvent.click(caret(second.container, "h1"));

		expect(readSidebarState().collapsedFamilies).toStrictEqual([]);
		expect(rowTitles(family(second.container, "h1"))).toStrictEqual(["Child one", "Grandchild one"]);
	});

	it("singularizes the stub and counts a failed child once, with a trailing error decoration", async () =>
	{
		const {container} = await renderGroups([
			session("h1", "Head one", "done", 10),
			session(
				"c1",
				"Child one",
				"blocked",
				1,
				{
					forkedFromSessionId: "h1",
					unseen: true,
					unseenError: true,
				},
			),
		]);

		fireEvent.click(caret(container, "h1"));

		const stub = family(container, "h1").querySelector("button.df-family-stub");
		if (!(stub instanceof HTMLElement)) throw new Error("no stub");
		expect(
			{
				titles: rowTitles(family(container, "h1")),
				aria: stub.getAttribute("aria-label"),
				segments: [...stub.querySelectorAll(".df-fade-truncate > span.flex.shrink-0.items-center")].map(
					(segment) => segment.textContent,
				),
				decoration: stub
					.querySelector(
						':scope > span[aria-hidden="true"][data-row-decoration].ms-auto.flex.size-\\[var\\(--sb-row-ctl\\)\\].shrink-0.items-center.justify-center [role="img"]',
					)
					?.getAttribute("aria-label"),
			},
		).toStrictEqual(
			{
				titles: [],
				aria: "Show 1 nested session, 1 failed",
				segments: ["·1 failed"],
				decoration: "Something went wrong",
			},
		);
	});

	it("keeps awaiting children listed above the stub when the family is folded", async () =>
	{
		const awaitingFamily = [
			session("h1", "Head one", "done", 10),
			session(
				"c1",
				"Child one",
				"blocked",
				1,
				{
					forkedFromSessionId: "h1",
				},
			),
			session(
				"c2",
				"Child two",
				"done",
				2,
				{
					forkedFromSessionId: "h1",
				},
			),
		];
		const folded = await renderGroups(awaitingFamily);
		fireEvent.click(caret(folded.container, "h1"));
		const nested = family(folded.container, "h1");
		const stub = nested.lastElementChild?.querySelector("button.df-family-stub");
		const kept = nested.querySelector("[data-family-child]");
		expect(
			{
				titles: rowTitles(nested),
				stub: stub?.getAttribute("aria-label"),
				label: stub?.querySelector("[data-row-label]")?.textContent,
				keptBeforeStub:
					kept !== null &&
					stub !== undefined &&
					stub !== null &&
					(kept.compareDocumentPosition(stub) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
				keptWrapper: kept?.matches('div[data-family-child][data-row-key="c1"].df-drag-shiftable.relative.pl-5'),
			},
		).toStrictEqual(
			{
				titles: ["Child one"],
				stub: "Show 1 more nested session",
				label: "1 more nested session",
				keptBeforeStub: true,
				keptWrapper: true,
			},
		);
		folded.unmount();

		const allKept = await renderGroups(awaitingFamily.slice(0, 2));
		expect(
			{
				titles: rowTitles(family(allKept.container, "h1")),
				stub: family(allKept.container, "h1").querySelector("button.df-family-stub"),
				caret: caret(allKept.container, "h1").getAttribute("aria-label"),
			},
		).toStrictEqual(
			{
				titles: ["Child one"],
				stub: null,
				caret: "Show nested sessions",
			},
		);
	});

	it("keeps the open child listed and selected, latched until the fold state changes", async () =>
	{
		const {container, router} = await renderGroups(
			TWO_FAMILIES,
			{
				path: "/session/c1",
			},
		);
		fireEvent.click(caret(container, "h1"));
		const c1Selected = () =>
			container.querySelector('[data-row-key="c1"] a[data-row-main-button][data-selected="focused"]') !== null;
		const listed = () => rowTitles(family(container, "h1"));
		const open =
		{
			listed: listed(),
			selected: c1Selected(),
		};

		await router.navigate(
			{
				to: "/session/$id",
				params:
				{
					id: "s1",
				},
			},
		);
		await waitFor(() =>
		{
			expect(c1Selected()).toBe(false);
		});
		const afterNavigate = listed();

		fireEvent.click(caret(container, "h2"));

		expect(
			{
				open,
				afterNavigate,
				afterFoldChange: listed(),
			},
		).toStrictEqual(
			{
				open:
				{
					listed: ["Child one"],
					selected: true,
				},
				afterNavigate: ["Child one"],
				afterFoldChange: [],
			},
		);
	});

	it("keeps a failed child hidden in the stub", async () =>
	{
		const {container} = await renderGroups([
			session("h1", "Head one", "done", 10),
			session(
				"c1",
				"Child one",
				"blocked",
				1,
				{
					forkedFromSessionId: "h1",
					unseenError: true,
				},
			),
		]);
		fireEvent.click(caret(container, "h1"));
		expect([
			rowTitles(family(container, "h1")),
			family(container, "h1").querySelector("button.df-family-stub") !== null,
		]).toStrictEqual([[], true]);
	});

	it("folds a family from a caret after the head row's title", async () =>
	{
		const {container, router} = await renderGroups(FAMILY);
		const toggle = caret(container, "h1");
		const svg = toggle.querySelector("svg");
		if (!(svg instanceof SVGElement)) throw new Error("no caret glyph");
		const [id, titleId] = (toggle.getAttribute("aria-labelledby") ?? "").split(" ");
		const hiddenTitle = document.getElementById(titleId ?? "");
		expect(
			{
				attributes: attributes(toggle, CARET_ATTRIBUTES),
				labelledBy: [id === toggle.id, titleId === `${toggle.id}-title`],
				hiddenTitle: [hiddenTitle?.hidden, hiddenTitle?.textContent],
				wrapper: toggle.parentElement?.className,
				suffix: toggle.closest("[data-row-label] > span.ps-1")?.className,
				rowName: headLink(container, "h1").getAttribute("aria-labelledby")?.split(" ")[0],
				glyph:
				{
					open: svg.getAttribute("data-open"),
					translate: svg.style.translate,
					pointerEvents: svg.style.pointerEvents,
					contain: svg.style.contain,
					width: svg.getAttribute("width"),
					rotated: svg.classList.contains("-rotate-90"),
				},
				carets: container.querySelectorAll("[data-container-icon]").length,
				handles: container.querySelectorAll(".df-family-handle").length,
			},
		).toStrictEqual(
			{
				attributes:
				{
					role: "button",
					"aria-expanded": "true",
					"aria-label": "Hide nested sessions",
					"data-row-action": "",
					tabindex: "-1",
				},
				labelledBy: [true, true],
				hiddenTitle: [true, "Head one"],
				wrapper: "flex ms-0.25",
				suffix: "flex shrink-0 items-center ps-1",
				rowName: headLink(container, "h1").querySelector("[data-row-label] > span.min-w-0")?.id,
				glyph:
				{
					open: "",
					translate: "0px 0.5px",
					pointerEvents: "none",
					contain: "layout paint",
					width: "1em",
					rotated: false,
				},
				carets: 1,
				handles: 0,
			},
		);

		fireEvent.click(
			toggle,
			{
				detail: 1,
			},
		);

		expect(
			{
				collapsed: readSidebarState().collapsedFamilies,
				attributes: attributes(toggle, ["aria-expanded", "aria-label"]),
				open: svg.getAttribute("data-open"),
				rotated: ["-rotate-90", "rtl:rotate-90"].map((name) => svg.classList.contains(name)),
				path: router.state.location.pathname,
			},
		).toStrictEqual(
			{
				collapsed: ["code:h1"],
				attributes:
				{
					"aria-expanded": "false",
					"aria-label": "Show nested sessions",
				},
				open: null,
				rotated: [true, true],
				path: "/",
			},
		);
	});

	it("hides and shows a family from the head row's menu, right after Fork", async () =>
	{
		const {container} = await renderGroups(FAMILY);

		const contextMenu = await rightClickRow(container, "h1");
		const outline = menuOutline(contextMenu);
		const forkAt = outline.findIndex((label) => label.startsWith("Fork"));
		expect(outline.slice(forkAt, forkAt + 3)).toStrictEqual(["ForkF", "Hide nested sessions", "---"]);

		fireEvent.click(
			screen.getByRole(
				"menuitem",
				{
					name: "Hide nested sessions",
				},
			),
		);
		await waitFor(() =>
		{
			expect(screen.queryByRole("menu")).toBeNull();
		});
		expect(
			{
				collapsed: readSidebarState().collapsedFamilies,
				titles: rowTitles(family(container, "h1")),
				stub: foldedStub(container, "h1").textContent,
			},
		).toStrictEqual(
			{
				collapsed: ["code:h1"],
				titles: [],
				stub: "2 nested sessions·1 unread·1 working",
			},
		);

		const kebab = screen.getByRole(
			"button",
			{
				name: "More options for Head one",
			},
		);
		fireEvent.click(kebab);
		await flush();
		fireEvent.click(
			screen.getByRole(
				"menuitem",
				{
					name: "Show nested sessions",
				},
			),
		);
		await waitFor(() =>
		{
			expect(screen.queryByRole("menu")).toBeNull();
		});
		expect(
			{
				collapsed: readSidebarState().collapsedFamilies,
				titles: rowTitles(family(container, "h1")),
			},
		).toStrictEqual(
			{
				collapsed: [],
				titles: ["Child one", "Grandchild one"],
			},
		);
		// The head row stays put, so focus returns to the kebab rather than moving to the first child. The kebab
		// is re-queried: its first open swaps the placeholder for the menu's real trigger.
		await waitFor(() =>
		{
			expect(document.activeElement).toBe(
				screen.getByRole(
					"button",
					{
						name: "More options for Head one",
					},
				),
			);
		});
	});

	it("offers no nested toggle on nested or flat rows", async () =>
	{
		const {container} = await renderGroups(FAMILY);

		const labels: Record<string, string[]> = {};
		for (const id of ["c1", "s1"])
		{
			const menu = await rightClickRow(container, id);
			labels[id] = menuOutline(menu).filter((label) => label.includes("nested sessions"));
			fireEvent.keyDown(
				menu,
				{
					key: "Escape",
				},
			);
			await waitFor(() =>
			{
				expect(screen.queryByRole("menu")).toBeNull();
			});
		}
		expect(labels).toStrictEqual(
			{
				c1: [],
				s1: [],
			},
		);
	});

	it("updates the open menu's label when the family folds elsewhere", async () =>
	{
		const {container} = await renderGroups(FAMILY);
		await rightClickRow(container, "h1");

		act(() =>
		{
			toggleFamilyCollapsed("h1");
		});

		expect(
			screen
				.getAllByRole("menuitem")
				.map((item) => item.textContent)
				.filter((label) => label.includes("nested sessions")),
		).toStrictEqual(["Show nested sessions"]);
	});

	it("folds only its own family on Alt-click of the caret", async () =>
	{
		const {container} = await renderGroups(TWO_FAMILIES);

		fireEvent.click(
			caret(container, "h2"),
			{
				altKey: true,
			},
		);

		expect(readSidebarState().collapsedFamilies).toStrictEqual(["code:h2"]);
	});

	it("toggles from Enter and Space on the caret without following the row link", async () =>
	{
		const {container} = await renderGroups(FAMILY);
		const toggle = caret(container, "h1");

		const enterNotPrevented = fireEvent.keyDown(
			toggle,
			{
				key: "Enter",
			},
		);
		const afterEnter = readSidebarState().collapsedFamilies;
		const spaceNotPrevented = fireEvent.keyDown(
			toggle,
			{
				key: " ",
			},
		);

		expect([enterNotPrevented, afterEnter, spaceNotPrevented, readSidebarState().collapsedFamilies]).toStrictEqual([
			false,
			["code:h1"],
			false,
			[],
		]);
	});

	it("swallows a double-click's second click across the list for 500ms after a caret click", async () =>
	{
		vi.useFakeTimers(
			{
				toFake: ["performance"],
			},
		);
		try
		{
			const {container} = await renderGroups(TWO_FAMILIES);
			fireEvent.click(
				caret(container, "h1"),
				{
					detail: 1,
				},
			);
			const second = (detail: number) =>
				fireEvent.click(
					rowWrapper(container, "s1"),
					{
						detail,
					},
				);
			const within = [second(2), second(1)];
			vi.advanceTimersByTime(501);
			const after = second(2);
			// A keyboard toggle (detail 0) arms no guard.
			fireEvent.keyDown(
				caret(container, "h2"),
				{
					key: "Enter",
				},
			);
			const afterKeyboard = second(2);

			expect(
				{
					within,
					after,
					afterKeyboard,
				},
			).toStrictEqual(
				{
					within: [false, true],
					after: true,
					afterKeyboard: true,
				},
			);
		}
		finally
		{
			vi.useRealTimers();
		}
	});

	it("expands from the stub and focuses the first child", async () =>
	{
		const {container} = await renderGroups(FAMILY);
		fireEvent.click(caret(container, "h1"));

		const stub = family(container, "h1").querySelector("button.df-family-stub");
		if (!(stub instanceof HTMLElement)) throw new Error("no stub");
		fireEvent.click(stub);

		expect(readSidebarState().collapsedFamilies).toStrictEqual([]);
		const firstChild = screen.getByRole(
			"link",
			{
				name: /^Child one.*Forked from Head one$/,
			},
		);
		await waitFor(() =>
		{
			expect(document.activeElement).toBe(firstChild);
		});
	});

	it("unfolds from the stub and focuses the first previously hidden child, not a kept one", async () =>
	{
		const {container} = await renderGroups([
			session("h1", "Head one", "done", 10),
			session(
				"c1",
				"Child one",
				"blocked",
				1,
				{
					forkedFromSessionId: "h1",
				},
			),
			session(
				"c2",
				"Child two",
				"done",
				2,
				{
					forkedFromSessionId: "h1",
				},
			),
		]);
		fireEvent.click(caret(container, "h1"));

		const stub = family(container, "h1").querySelector("button.df-family-stub");
		if (!(stub instanceof HTMLElement)) throw new Error("no stub");
		fireEvent.click(stub);

		const hiddenChild = container.querySelector('[data-row-key="c2"] a[data-row-main-button]');
		await waitFor(() =>
		{
			expect(document.activeElement).toBe(hiddenChild);
		});
	});
	it("styles the family stub like upstream's df-family-stub", async () =>
	{
		const {container} = await renderGroups(FAMILY);
		fireEvent.click(caret(container, "h1"));

		const stub = foldedStub(container, "h1");
		const classes = stub.className.split(/\s+/);
		expect(
			{
				classes,
				painted: classes.filter((name) => name.startsWith("hover:bg-") || name.startsWith("focus-visible:bg-")),
			},
		).toStrictEqual(
			{
				classes: [
					"df-family-stub",
					"hit-row",
					"[--cds-hit-gap-y:7px]",
					"hit-row-main",
					"flex",
					"h-[var(--sb-row-h)]",
					"w-full",
					"min-w-0",
					"items-center",
					"rounded-[var(--sb-radius)]",
					"pe-[var(--sb-row-px)]",
					"ps-[calc(var(--sb-row-px)+var(--sb-row-indent,0px)+var(--sb-iconless-pad,calc((var(--sb-leading-slot)-var(--sb-icon))/2)))]",
					"text-start",
					"text-[length:var(--sb-group-font)]",
					"text-primary",
					"hover:bg-[var(--sb-hover)]",
					"hide-focus-ring",
					"focus-visible:outline-hidden",
					"focus-visible:shadow-[inset_0_0_0_1px_var(--color-accent-100),0_0_6px_0_color-mix(in_srgb,var(--color-accent-100)_20%,transparent)]",
				],
				painted: ["hover:bg-[var(--sb-hover)]"],
			},
		);
	});

	it("wraps the stub in upstream's drag-shift row with no indent wrapper or leading slot", async () =>
	{
		const {container} = await renderGroups(FAMILY);
		fireEvent.click(caret(container, "h1"));

		const stub = foldedStub(container, "h1");
		const nested = family(container, "h1");
		expect(
			{
				wrapper: stub.parentElement?.matches('div[data-row-key="family-stub:h1"].df-drag-shiftable.relative'),
				indent: nested.classList.contains("[--sb-row-indent:calc(var(--sb-icon)+var(--sb-row-gap))]"),
				leadingSlot: stub.querySelector(".df-leading-slot"),
				padded: nested.querySelector(".pl-5 > .df-family-stub"),
				// The elbow's ::after ends at the last child's centre, so the stub row must stay last.
				stubLast: nested.lastElementChild === stub.parentElement,
				childAfterStub: nested.querySelector("[data-row-key^='family-stub:'] ~ [data-family-child]"),
			},
		).toStrictEqual(
			{
				wrapper: true,
				indent: true,
				leadingSlot: null,
				padded: null,
				stubLast: true,
				childAfterStub: null,
			},
		);
	});

	it("ignores a multi-click on the stub", async () =>
	{
		const {container} = await renderGroups(FAMILY);
		fireEvent.click(caret(container, "h1"));
		vi.useFakeTimers(
			{
				toFake: ["performance"],
			},
		);
		try
		{
			fireEvent.click(
				foldedStub(container, "h1"),
				{
					detail: 2,
				},
			);
			expect(readSidebarState().collapsedFamilies).toStrictEqual(["code:h1"]);
		}
		finally
		{
			vi.useRealTimers();
		}
	});

	it("swallows every mouse click on the list for 500ms after a stub click", async () =>
	{
		const {container} = await renderGroups(FAMILY);
		fireEvent.click(caret(container, "h1"));
		vi.useFakeTimers(
			{
				toFake: ["performance"],
			},
		);
		try
		{
			fireEvent.click(
				foldedStub(container, "h1"),
				{
					detail: 1,
				},
			);
			const child = () => headLink(container, "c1");
			const within = [
				fireEvent.click(
					child(),
					{
						detail: 1,
					},
				),
				fireEvent.click(
					child(),
					{
						detail: 2,
					},
				),
				fireEvent.mouseDown(child()),
			];
			vi.advanceTimersByTime(501);
			const after = fireEvent.mouseDown(child());
			expect(
				{
					collapsed: readSidebarState().collapsedFamilies,
					within,
					after,
				},
			).toStrictEqual(
				{
					collapsed: [],
					within: [false, false, false],
					after: true,
				},
			);
		}
		finally
		{
			vi.useRealTimers();
		}
	});

	it("focuses the first child after a mouse click only when the stub held focus", async () =>
	{
		const {container} = await renderGroups(FAMILY);
		fireEvent.click(caret(container, "h1"));
		vi.useFakeTimers(
			{
				toFake: ["performance"],
			},
		);
		try
		{
			document.body.focus();
			fireEvent.click(
				foldedStub(container, "h1"),
				{
					detail: 1,
				},
			);
			await waitFor(() =>
			{
				expect(readSidebarState().collapsedFamilies).toStrictEqual([]);
			});
			const unfocused = document.activeElement;

			// The stub's click guard covers the list for 500ms, so wait it out before refolding.
			vi.advanceTimersByTime(501);
			fireEvent.click(caret(container, "h1"));
			const stub = foldedStub(container, "h1");
			stub.focus();
			fireEvent.click(
				stub,
				{
					detail: 1,
				},
			);
			await waitFor(() =>
			{
				expect(document.activeElement).toBe(headLink(container, "c1"));
			});
			expect(unfocused).toBe(document.body);
		}
		finally
		{
			vi.useRealTimers();
		}
	});

	it("keeps a press on the stub from reaching the list's pointerdown handlers", async () =>
	{
		const {container} = await renderGroups(FAMILY);
		fireEvent.click(caret(container, "h1"));
		const presses: EventTarget[] = [];
		const listener = (event: Event) =>
		{
			if (event.target !== null) presses.push(event.target);
		};
		document.addEventListener("pointerdown", listener);
		fireEvent.pointerDown(foldedStub(container, "h1"));
		fireEvent.pointerDown(headLink(container, "h1"));
		document.removeEventListener("pointerdown", listener);
		expect(presses).toStrictEqual([headLink(container, "h1")]);
	});
});
