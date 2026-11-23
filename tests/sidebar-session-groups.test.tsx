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
import {SettingsProvider} from "../src/components/settings-provider";
import {ToastProvider} from "../src/components/toast";
import {useState, type ReactNode} from "react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {SessionGroups} from "../src/components/sidebar/session-groups";
import {ProjectListResponse, projectsQueryOptions} from "../src/lib/api/projects";
import {RecentSessionsResponse, recentSessionsInfiniteQueryOptions} from "../src/lib/api/sessions";
import {takePendingHomeLaunchFolder} from "../src/lib/home-composer-focus";
import {FizzyLakeContext, FIZZY_LAKE_PARTS, type FizzyLakePart} from "../src/lib/fizzy-lake";
import {DEFAULT_SESSION_LIST_PREFS, type SessionListPrefs} from "../src/lib/session-groups";
import type {SessionBucket} from "../src/lib/session-state";
import {readSidebarState} from "../src/lib/sidebar-store";
import {clearJumpHints, setJumpHintsForTest} from "../src/lib/sidebar-jump-hints";
import {holdAnswered, noteAnsweredSummary, releaseAnswered} from "../src/lib/answered-sessions";
import {__unreadStoreTesting, syncUnseenFromSummaries} from "../src/lib/unread-store";
import {__awaitingAckTesting, ack} from "../src/lib/awaiting-ack-store";
import {__liveApprovalTesting, registerLiveApproval} from "../src/lib/live-approval-sessions";
import {installLocalStorage} from "./fake-storage";
import
{
	__pendingLaunchTesting,
	addPendingLaunch,
	readPendingLaunches,
	markPendingLaunchStarted,
	settlePendingLaunch,
} from "../src/lib/pending-launch-store";
import {PIN_STORAGE_KEY} from "../src/lib/pin-store";
import {readProjectOrder} from "../src/lib/project-order-store";
import {readFileSync} from "node:fs";
import {rowTitle} from "./sidebar-row-title";

const MINUTE = 60 * 1000;
// Pin mid-day: fixtures are minutes or days old under TZ=UTC, and on wall time the minutes-old ones fall into Yesterday just after midnight.
const NOW = Date.parse("2026-06-15T12:00:00Z");
vi.setSystemTime(NOW);

function session(id: string, title: string, bucket: SessionBucket, minutesAgo: number)
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

/** Focuses a button as a mouse press would: jsdom matches :focus-visible on any focus, so mask it. */
function pointerFocus(button: HTMLElement): void
{
	const matches = button.matches.bind(button);
	vi.spyOn(button, "matches").mockImplementation(
		(selector: string) => selector !== ":focus-visible" && matches(selector),
	);
	act(() =>
	{
		button.focus();
	});
}

/** `count` Idle sessions d0…, newest first. */
function doneSessions(count: number)
{
	return Array.from(
		{
			length: count,
		},
		(_, index) => session(`d${index}`, `Done ${index}`, "done", index + 1),
	);
}

/** Stubs the next feed page, held until `respond()`; `requests` records each fetched URL. */
function stubNextPage(sessions: unknown[], nextCursor: string | null)
{
	const requests: string[] = [];
	let release: () => void = () =>
	{
	};
	const held = new Promise<void>((resolve) =>
	{
		release = resolve;
	});
	vi.stubGlobal("fetch", async (input: RequestInfo | URL) =>
	{
		requests.push(String(input));
		await held;
		return new Response(
			JSON.stringify(
				{
					sessions,
					nextCursor,
				},
			),
			{
				status: 200,
				headers:
				{
					"Content-Type": "application/json",
				},
			},
		);
	});
	return {
		requests,
		respond: () =>
		{
			act(() =>
			{
				release();
			});
		},
	};
}

function seedQueryClient(sessions: unknown[], nextCursor: string | null = null): QueryClient
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
	for (const status of ["active", "all"] as const)
	{
		queryClient.setQueryData(
			recentSessionsInfiniteQueryOptions(undefined, status).queryKey,
			{
				pages: [
					RecentSessionsResponse.parse(
						{
							sessions,
							nextCursor,
						},
					),
				],
				pageParams: [null],
			},
		);
	}
	return queryClient;
}

async function renderGroups(
	sessions: unknown[],
	options:
	{
		nextCursor?: string | null;
		filterSlot?: ReactNode;
		unseeded?: boolean;
		activeItemId?: string;
		prefs?: SessionListPrefs;
		projects?: unknown[];
		initialPath?: string;
		/** Return while the list still loads instead of waiting for a group or alert. */
		loading?: boolean;
		/** The fizzy-lake parts in effect; defaults to the app's (panels on). */
		fizzyLake?: readonly FizzyLakePart[];
	} = {},
)
{
	const queryClient =
		options.unseeded === true
			? new QueryClient(
					{
						defaultOptions:
						{
							queries:
							{
								retry: false,
							},
						},
					},
				)
			: seedQueryClient(sessions, options.nextCursor ?? null);
	if (options.projects !== undefined)
	{
		queryClient.setQueryData(projectsQueryOptions().queryKey, ProjectListResponse.parse(options.projects));
	}
	const activeItem =
	{
		set: (_id: string | null) =>
		{
		},
		setPrefs: (_prefs: SessionListPrefs) =>
		{
		},
	};
	function Root()
	{
		const [activeItemId, setActiveItemId] = useState<string | null>(options.activeItemId ?? null);
		// Most cases exercise Status grouping, so render it unless a case picks other prefs.
		const [prefs, setPrefs] = useState<SessionListPrefs>(
			options.prefs ??
			{
				...DEFAULT_SESSION_LIST_PREFS,
				groupBy: "state",
			},
		);
		activeItem.set = setActiveItemId;
		activeItem.setPrefs = setPrefs;
		return (
			<FizzyLakeContext.Provider value={options.fizzyLake ?? FIZZY_LAKE_PARTS}>
				<SettingsProvider>
					<QueryClientProvider client={queryClient}>
						<ToastProvider>
							<SessionGroups activeItemId={activeItemId} filterSlot={options.filterSlot} prefs={prefs} />
							<Outlet />
						</ToastProvider>
					</QueryClientProvider>
				</SettingsProvider>
			</FizzyLakeContext.Provider>
		);
	}
	const rootRoute = createRootRoute(
		{
			component: Root,
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
					initialEntries: [options.initialPath ?? "/"],
				},
			),
		},
	);
	await router.load();
	const result = render(<RouterProvider router={router} />);
	/** Opens another session, as navigating the app would. */
	const setActiveItemId = (id: string | null) =>
	{
		act(() =>
		{
			activeItem.set(id);
		});
	};
	/** Changes the list's prefs, as the Group and sort menu would. */
	const setPrefs = (prefs: SessionListPrefs) =>
	{
		act(() =>
		{
			activeItem.setPrefs(prefs);
		});
	};
	if (options.loading === true)
		return {
			...result,
			queryClient,
			router,
			setActiveItemId,
			setPrefs,
		};
	await waitFor(() =>
	{
		expect(result.container.querySelector("[data-group-toggle], [role=alert]")).toBeTruthy();
	});
	return {
		...result,
		queryClient,
		router,
		setActiveItemId,
		setPrefs,
	};
}

/** A session row's title markup: upstream's two title spans and any ShimmerText inside them (upstream draws none). */
function describeRowTitle(link: HTMLElement)
{
	const outer = link.querySelector("[data-row-label] .dframe-fade-label")?.firstElementChild;
	const inner = outer?.firstElementChild;
	const shimmer = inner?.querySelector(":scope > [data-cds=ShimmerText]");
	return {
		outer: outer?.getAttribute("class") ?? null,
		outerChildren: outer?.children.length ?? 0,
		inner: inner?.getAttribute("class") ?? null,
		attention: inner?.getAttribute("data-attention") ?? null,
		shimmer:
			shimmer === null || shimmer === undefined
				? null
				:
					{
						variant: shimmer.getAttribute("data-variant"),
						shimmering: shimmer.getAttribute("data-shimmering"),
						className: shimmer.getAttribute("class"),
						text: shimmer.textContent,
					},
	};
}

/** The row link whose title is `title` (an archived row's ends in its sr-only " Archived"). */
function rowLink(container: HTMLElement, title: string): HTMLElement
{
	const link = [...container.querySelectorAll<HTMLElement>("a[data-row-main-button]")].find((node) =>
		[title, `${title} Archived`].includes(rowTitle(node)),
	);
	if (link === undefined) throw new Error(`no row ${title}`);
	return link;
}

function groupNames(container: HTMLElement): string[]
{
	return [...container.querySelectorAll('[data-testid="sidebar-recents"] [data-group-name]')].map(
		(node) => node.textContent,
	);
}

function toggleOf(container: HTMLElement, key: string): HTMLElement
{
	const toggle = container.querySelector(`[data-group-key="${key}"] [data-group-toggle]`);
	if (!(toggle instanceof HTMLElement)) throw new Error(`no ${key} toggle`);
	return toggle;
}

/** The section's shown rows; a collapsed section keeps its other rows mounted in a hidden wrapper. */
function rowTitlesIn(container: HTMLElement, groupKey: string): string[]
{
	const section = container.querySelector(`[data-group-key="${groupKey}"]`);
	if (!(section instanceof HTMLElement)) return [];
	return [...section.querySelectorAll("a[data-row-main-button]")]
		.filter((link) => link.closest("[hidden]") === null)
		.map((link) => rowTitle(link));
}

afterEach(() =>
{
	cleanup();
	vi.unstubAllGlobals();
});

beforeEach(() =>
{
	vi.setSystemTime(NOW);
	installLocalStorage();
	__awaitingAckTesting.reset();
	__liveApprovalTesting.reset();
});

describe("sidebar SessionGroups", () =>
{
	it("renders the state groups in upstream order with their rows", async () =>
	{
		const {container} = await renderGroups(FIXTURE);

		expect(groupNames(container)).toEqual(["Needs input", "Ready for review", "Working", "Idle"]);
		expect(
			{
				blocked: rowTitlesIn(container, "state-blocked"),
				review: rowTitlesIn(container, "state-review"),
				working: rowTitlesIn(container, "state-working"),
				done: rowTitlesIn(container, "state-done"),
			},
		).toEqual(
			{
				blocked: ["Blocked one"],
				review: ["Review one"],
				working: ["Working one"],
				done: ["Completed newest", "Completed older"],
			},
		);
	});

	// Upstream: name centre -> first row top 16px (no label gap), section bottom = last row bottom + 2px stack gap.
	it("bands each section as upstream's df-session-list: a fixed row-height label flush on its rows, a stack-gap bottom pad", async () =>
	{
		const {container} = await renderGroups(FIXTURE);
		const css = readFileSync("src/styles/globals.css", "utf8");

		expect(
			{
				token: /--sb-group-pb: ([^;]+);/.exec(css)?.[1],
				sections: [...container.querySelectorAll("[data-group-key^=state-]")].map(
					(section) =>
						section.classList.contains("pb-[var(--sb-group-pb)]") &&
						![...section.classList].some((name) => name.startsWith("gap-")),
				),
				labels: [...container.querySelectorAll("[data-group-key^=state-] > [data-sidebar-group-label]")].map(
					(label) => (
					{
						fixedBand: label.classList.contains("h-[var(--sb-group-band-h)]"),
						minHeight: [...label.classList].some((name) => name.startsWith("min-h-")),
					}),
				),
			},
		).toStrictEqual(
			{
				token: "var(--sb-row-stack-gap)",
				sections: [true, true, true, true],
				labels: Array.from(
					{
						length: 4,
					},
					() => (
					{
						fixedBand: true,
						minHeight: false,
					}),
				),
			},
		);
	});

	it("marks every session row wrapper as a jump-hint row and renders a row's keycap last while it has a digit", async () =>
	{
		const {container} = await renderGroups(FIXTURE);
		const wrappers = [...container.querySelectorAll("[data-group-key^=state-] [data-group-rows] > [data-row-key]")];

		act(() =>
		{
			setJumpHintsForTest(
				{
					w1: "1",
				},
			);
		});
		const shown = wrappers.map((wrapper) => wrapper.lastElementChild?.outerHTML ?? "");
		const keycapRow = wrappers
			.find((wrapper) => wrapper.lastElementChild?.tagName === "KBD")
			?.getAttribute("data-row-key");
		act(() =>
		{
			clearJumpHints();
		});

		expect(
			{
				marked: wrappers.map((wrapper) => wrapper.getAttribute("data-jump-hint-row")),
				keycaps: shown.filter((html) => html.startsWith("<kbd")),
				keycapRow,
				cleared: container.querySelectorAll("kbd").length,
			},
		).toStrictEqual(
			{
				marked: wrappers.map(() => ""),
				keycaps: [
					'<kbd aria-hidden="true" class="df-jump-hint pointer-events-none absolute top-[calc(var(--sb-row-h)/2)] -translate-y-1/2 start-[calc(var(--sb-row-px)+var(--sb-rail-shift,0px)+(var(--sb-leading-slot)-1rem*var(--cds-rem-scale,1))/2)] flex h-4 min-w-4 items-center justify-center rounded-r2 border-[0.5px] bg-surface-1 px-[3px] font-sans text-[length:calc(0.625rem*var(--cds-rem-scale,1))] font-medium leading-none text-primary">1</kbd>',
				],
				keycapRow: "w1",
				cleared: 0,
			},
		);
	});

	it("omits empty groups", async () =>
	{
		const {container} = await renderGroups([
			session("w1", "Working one", "working", 1),
			session("d1", "Completed one", "done", 5),
		]);

		expect(groupNames(container)).toEqual(["Working", "Idle"]);
	});

	it("shows each row's session title with its trailing state mark beside the link and its status text inside it", async () =>
	{
		await renderGroups(FIXTURE);

		const rowOf = (name: RegExp) =>
		{
			const row = screen
				.getByRole(
					"link",
					{
						name,
					},
				)
				.closest<HTMLElement>("[data-session-actions]");
			if (row === null) throw new Error(`no row ${String(name)}`);
			return row;
		};
		// The mark sits beside the link, as upstream's row decoration does; its sr text is inside the title.
		const blocked = screen.getByRole(
			"link",
			{
				name: /^Blocked one/,
			},
		);
		expect(
			{
				href: blocked.getAttribute("href"),
				blocked: blocked.querySelector("[data-session-status]")?.textContent,
				working: rowOf(/^Working one/).querySelector("[data-session-status]")?.textContent,
				settled:
				{
					mark: within(rowOf(/^Completed older/)).queryByRole("img"),
					env: rowOf(/^Completed older/)
						.querySelector("[data-env-glyph]")
						?.getAttribute("aria-hidden"),
				},
				project: screen.queryByText("project-b1"),
			},
		).toStrictEqual(
			{
				href: "/session/b1",
				blocked: " Awaiting input",
				working: " Running",
				settled:
				{
					mark: null,
					env: "true",
				},
				project: null,
			},
		);
	});

	it("describes a Needs input row with upstream's sr-only quick-reply hint, and no other row", async () =>
	{
		await renderGroups(FIXTURE);

		const hintOf = (name: RegExp) =>
		{
			const link = screen.getByRole(
				"link",
				{
					name,
				},
			);
			const id = link.getAttribute("aria-describedby");
			if (id === null) return null;
			const hint = document.getElementById(id);
			return {
				text: hint?.textContent,
				className: hint?.className,
				findOmitted: hint?.hasAttribute("data-find-omitted"),
			};
		};
		expect(
			{
				blocked: hintOf(/^Blocked one/),
				working: hintOf(/^Working one/),
			},
		).toStrictEqual(
			{
				blocked:
				{
					text: "Quick reply and approval controls available — press Tab until focus enters the card, Escape to return.",
					className: "sr-only select-none",
					findOmitted: true,
				},
				working: null,
			},
		);
	});

	it("shares one quick-reply hint per section, in a contents wrapper, across every Needs input row div and link", async () =>
	{
		const {container} = await renderGroups([
			session("b1", "Blocked one", "blocked", 1),
			session("b2", "Blocked two", "blocked", 2),
			session("b3", "Blocked three", "blocked", 3),
			session("w1", "Working one", "working", 4),
		]);

		const hints = [...container.querySelectorAll("span")].filter((span) =>
			span.textContent.startsWith("Quick reply and approval controls available"),
		);
		const describedBy = (title: string) =>
		{
			const link = screen.getByRole(
				"link",
				{
					name: new RegExp(`^${title}`),
				},
			);
			return {
				row: link.closest("[data-row-key]")?.getAttribute("aria-describedby") ?? null,
				link: link.getAttribute("aria-describedby"),
			};
		};
		const id = hints[0]?.id ?? "missing";
		expect(
			{
				hints: hints.map((hint) => (
				{
					className: hint.className,
					findOmitted: hint.hasAttribute("data-find-omitted"),
					wrapper: hint.parentElement?.className,
				})),
				rows: ["Blocked one", "Blocked two", "Blocked three", "Working one"].map(describedBy),
			},
		).toStrictEqual(
			{
				hints: [
					{
						className: "sr-only select-none",
						findOmitted: true,
						wrapper: "contents",
					},
				],
				rows: [
					{
						row: id,
						link: id,
					},
					{
						row: id,
						link: id,
					},
					{
						row: id,
						link: id,
					},
					{
						row: null,
						link: null,
					},
				],
			},
		);
	});

	it("styles the row kebab like upstream: radius 6 (r5), text-secondary until hovered or expanded, instant reveal", async () =>
	{
		await renderGroups(FIXTURE);

		const classes = screen
			.getByRole(
				"button",
				{
					name: "More options for Working one",
				},
			)
			.className.split(" ");
		expect(
			{
				radius: classes.filter((token) => token.startsWith("rounded")),
				ink: classes.filter((token) =>
					/^(hover:|aria-expanded:)?text-(primary|secondary|ink-muted|muted)$/.test(token),
				),
				hoverBg: classes.filter((token) => token.startsWith("hover:bg")),
				transition: classes.filter((token) => token.startsWith("transition")),
			},
		).toStrictEqual(
			{
				radius: ["rounded-r5"],
				ink: ["text-secondary", "hover:text-primary", "aria-expanded:text-primary"],
				hoverBg: [],
				transition: [],
			},
		);
	});

	it("collapses a group, persists it in the sidebar store, and restores it on remount", async () =>
	{
		const first = await renderGroups(FIXTURE);
		const toggle = screen.getByRole(
			"button",
			{
				name: "Working",
			},
		);
		expect(toggle.getAttribute("aria-expanded")).toBe("true");

		fireEvent.click(toggle);

		expect(toggle.getAttribute("aria-expanded")).toBe("false");
		expect(
			screen.queryByRole(
				"link",
				{
					name: /Working one/,
				},
			),
		).toBeNull();
		expect(readSidebarState().collapsedGroups).toEqual(["state-working"]);

		first.unmount();
		await renderGroups(FIXTURE);

		// The collapsed toggle carries the hidden Working row's badge, which joins its name.
		const remounted = screen.getByRole(
			"button",
			{
				name: /^Working/,
			},
		);
		expect(remounted.getAttribute("aria-expanded")).toBe("false");
		expect(
			screen.queryByRole(
				"link",
				{
					name: /Working one/,
				},
			),
		).toBeNull();

		fireEvent.click(remounted);

		expect(remounted.getAttribute("aria-expanded")).toBe("true");
		expect(
			screen.getByRole(
				"link",
				{
					name: /^Working one/,
				},
			),
		).toBeTruthy();
		expect(readSidebarState().collapsedGroups).toEqual([]);
	});

	// Upstream `SH`/`sP`: a collapsed header is `data-rowless` and carries `[data-group-badge]` with the most urgent hidden state.
	it("badges a collapsed header with its hidden rows' most urgent state and marks it rowless", async () =>
	{
		const rows = [
			session("d1", "Done read", "done", 5),
			{
				...session("d2", "Done unread", "done", 6),
				unseen: true,
			},
			session("d3", "Done read too", "done", 7),
			session("w1", "Working one", "working", 1),
		];
		__unreadStoreTesting.reset();
		syncUnseenFromSummaries(
			rows.map(({id, unseen}) => (
			{
				id,
				unseen,
			})),
		);
		const {container} = await renderGroups(rows);
		const header = (key: string) =>
		{
			const label = container.querySelector(`[data-group-key="${key}"] > [data-sidebar-group-label]`);
			if (!(label instanceof HTMLElement)) throw new Error(`no ${key} header`);
			return label;
		};
		const snapshot = (key: string) =>
		{
			const label = header(key);
			const badge = label.querySelector("[data-group-toggle] > [data-group-badge]");
			return {
				rowless: label.getAttribute("data-rowless"),
				// Upstream always keeps one stack gap under the label, rowless or not.
				rowlessGap: label.classList.contains("mb-[var(--sb-row-stack-gap)]"),
				badgeClass: badge?.getAttribute("class") ?? null,
				badge: [...(badge?.querySelectorAll("[role=img]") ?? [])].map((mark) =>
					mark.getAttribute("aria-label"),
				),
			};
		};

		expect(snapshot("state-done")).toEqual(
			{
				rowless: null,
				rowlessGap: true,
				badgeClass: null,
				badge: [],
			},
		);

		fireEvent.click(
			within(header("state-done")).getByRole(
				"button",
				{
					name: /^Idle/,
				},
			),
		);
		fireEvent.click(
			within(header("state-working")).getByRole(
				"button",
				{
					name: /^Working/,
				},
			),
		);

		expect(
			{
				done: snapshot("state-done"),
				working: snapshot("state-working"),
			},
		).toEqual(
			{
				done:
				{
					rowless: "",
					rowlessGap: true,
					badgeClass: "-my-1 ms-auto flex size-6 shrink-0 items-center justify-center",
					badge: ["Unread response"],
				},
				working:
				{
					rowless: "",
					rowlessGap: true,
					badgeClass: "-my-1 ms-auto flex size-6 shrink-0 items-center justify-center",
					badge: ["Running"],
				},
			},
		);
	});

	it("marks a section data-hover-within while any of its rows is hovered, one section at a time, even with fizzy-lake parts off", async () =>
	{
		const {container} = await renderGroups(
			FIXTURE,
			{
				fizzyLake: [],
			},
		);
		const hovered = () =>
			[...container.querySelectorAll("[data-group-key][data-hover-within]")].map((section) =>
				section.getAttribute("data-group-key"),
			);
		const workingRow = container.querySelector<HTMLElement>(
			'[data-group-key="state-working"] a[data-row-main-button]',
		);
		const doneRow = container.querySelector<HTMLElement>('[data-group-key="state-done"] a[data-row-main-button]');
		if (workingRow === null || doneRow === null) throw new Error("rows missing");

		fireEvent.mouseOver(workingRow);
		const afterWorking = hovered();
		fireEvent.mouseOver(doneRow);
		const afterDone = hovered();
		fireEvent.mouseOut(
			doneRow,
			{
				relatedTarget: document.body,
			},
		);

		expect(
			{
				afterWorking,
				afterDone,
				afterLeave: hovered(),
				caret: container
					.querySelector('[data-group-key="state-done"] [data-group-caret]')
					?.getAttribute("class")
					?.split(" ")
					.filter((name) => name.includes("opacity")),
			},
		).toStrictEqual(
			{
				afterWorking: ["state-working"],
				afterDone: ["state-done"],
				afterLeave: [],
				caret: [
					"group-data-[hover-within]/section:opacity-100",
					"group-focus-visible/label:opacity-100",
					"opacity-100",
				],
			},
		);
	});

	// Upstream `SH` (shared-18) and `Cs` (shared-21) graduated: the caret always stays (`data-group-caret="stays"`,
	// opacity 1) and Group and sort keeps its width in the hub sidebar, fading by opacity in the header CSS.
	it("keeps the expanded caret visible and Group and sort at full width whatever fizzy-lake parts are on", async () =>
	{
		const render = async (fizzyLake: readonly FizzyLakePart[]) =>
		{
			const {container, unmount} = await renderGroups(
				FIXTURE,
				{
					fizzyLake,
					filterSlot: <button type="button">Group and sort</button>,
				},
			);
			const header = container.querySelector('[data-group-key="state-done"] [data-sidebar-group-label]');
			const caret = header?.querySelector("[data-group-caret]");
			const result =
			{
				caret: caret?.getAttribute("data-group-caret"),
				caretOpacity: caret
					?.getAttribute("class")
					?.split(" ")
					.filter((name) => name.includes("opacity")),
				reveal: header
					?.querySelector("[data-header-reveal]")
					?.getAttribute("class")
					?.split(" ")
					.filter((name) => /(^|:)w-/.test(name)),
				controls: header?.querySelector(":scope > [data-header-controls]") !== null,
				toggleHoverInk: (
					header?.querySelector("[data-group-toggle]")?.getAttribute("class")?.split(" ") ?? []
				).filter((name) => name.startsWith("hover:text-")),
			};
			unmount();
			return result;
		};
		const expected =
		{
			caret: "stays",
			caretOpacity: [
				"group-data-[hover-within]/section:opacity-100",
				"group-focus-visible/label:opacity-100",
				"opacity-100",
			],
			reveal: [],
			controls: true,
			toggleHoverInk: [],
		};

		expect(
			{
				panels: await render(FIZZY_LAKE_PARTS),
				off: await render([]),
			},
		).toStrictEqual(
			{
				panels: expected,
				off: expected,
			},
		);
	});

	it("leaves a collapsed header unbadged when every hidden row is settled and read", async () =>
	{
		const rows = [session("d1", "Done read", "done", 5), session("d2", "Done read too", "done", 6)];
		__unreadStoreTesting.reset();
		syncUnseenFromSummaries(
			rows.map(({id, unseen}) => (
			{
				id,
				unseen,
			})),
		);
		const {container} = await renderGroups(rows);

		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Idle",
				},
			),
		);

		const label = container.querySelector('[data-group-key="state-done"] > [data-sidebar-group-label]');
		expect(
			{
				rowless: label?.getAttribute("data-rowless"),
				badges: label?.querySelectorAll("[data-group-badge]").length,
			},
		).toEqual(
			{
				rowless: "",
				badges: 0,
			},
		);
	});

	it("pages Idle 20 rows per Show more click, announcing each page, and folds back to 20 with Show less", async () =>
	{
		vi.useFakeTimers(
			{
				shouldAdvanceTime: true,
			},
		);
		try
		{
			const {container} = await renderGroups(doneSessions(47));
			const overflowRows = () =>
				[...container.querySelectorAll('[data-group-key="state-done"] button[data-row]')].map((button) => (
				{
					text: button.textContent,
					label: button.getAttribute("aria-label"),
					wrapper: `${button.parentElement?.getAttribute("data-row-key")} ${button.parentElement?.className}`,
				}));
			const status = () =>
				container.querySelector('[data-group-key="state-done"] [data-group-rows] > span[role="status"]');

			const showMore = screen.getByRole(
				"button",
				{
					name: "Show 20 more in Idle",
				},
			);
			expect(
				{
					shown: rowTitlesIn(container, "state-done").length,
					overflow: overflowRows(),
					roving: showMore.hasAttribute("data-roving-item"),
					labelClass: showMore.querySelector("span")?.className,
					leadingSlot: showMore.querySelector(".df-leading-slot"),
					status: status(),
				},
			).toStrictEqual(
				{
					shown: 20,
					overflow: [
						{
							text: "Show more",
							label: "Show 20 more in Idle",

							wrapper: "label:showmore:state-done df-drag-shiftable [overflow-anchor:none]",
						},
					],
					roving: true,
					labelClass: "ps-[var(--sb-iconless-pad)]",
					leadingSlot: null,
					status: null,
				},
			);

			fireEvent.click(showMore);
			expect(
				{
					shown: rowTitlesIn(container, "state-done").length,
					overflow: overflowRows(),
					status: status()?.textContent,
				},
			).toStrictEqual(
				{
					shown: 40,
					overflow: [
						{
							text: "Show more",
							label: "Show 7 more in Idle",

							wrapper: "label:showmore:state-done df-drag-shiftable [overflow-anchor:none]",
						},
					],
					status: "Showing 20 more in Idle\u200B",
				},
			);

			fireEvent.click(
				screen.getByRole(
					"button",
					{
						name: "Show 7 more in Idle",
					},
				),
				{
					detail: 2,
				},
			);
			expect(rowTitlesIn(container, "state-done")).toHaveLength(40);

			fireEvent.click(
				screen.getByRole(
					"button",
					{
						name: "Show 7 more in Idle",
					},
				),
			);
			expect(
				{
					shown: rowTitlesIn(container, "state-done"),
					overflow: overflowRows(),
					status: status()?.textContent,
				},
			).toStrictEqual(
				{
					shown: Array.from(
						{
							length: 47,
						},
						(_, index) => `Done ${index}`,
					),
					overflow: [
						{
							text: "Show less",
							label: "Show less in Idle",

							wrapper: "label:showmore:state-done df-drag-shiftable [overflow-anchor:none]",
						},
					],
					status: "Showing 7 more in Idle",
				},
			);

			fireEvent.click(
				screen.getByRole(
					"button",
					{
						name: "Show less in Idle",
					},
				),
			);

			expect(
				{
					shown: rowTitlesIn(container, "state-done").length,
					overflow: overflowRows(),
					status: status()?.textContent,
				},
			).toStrictEqual(
				{
					shown: 20,
					overflow: [
						{
							text: "Show more",
							label: "Show 20 more in Idle",

							wrapper: "label:showmore:state-done df-drag-shiftable [overflow-anchor:none]",
						},
					],
					status: "Showing less in Idle\u200B",
				},
			);

			act(() =>
			{
				vi.advanceTimersByTime(4000);
			});
			expect(status()).toBeNull();
		}
		finally
		{
			vi.useRealTimers();
		}
	});

	it("never hides one row: 21 rows show whole, and 41 rows offer Show 21 more, which reveals them all", async () =>
	{
		const {container, unmount} = await renderGroups(doneSessions(21));
		expect(
			{
				shown: rowTitlesIn(container, "state-done").length,
				overflow: container.querySelectorAll('[data-group-key="state-done"] button[data-row]').length,
			},
		).toStrictEqual(
			{
				shown: 21,
				overflow: 0,
			},
		);
		unmount();

		const second = await renderGroups(doneSessions(41));
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Show 21 more in Idle",
				},
			),
		);
		expect(
			{
				shown: rowTitlesIn(second.container, "state-done").length,
				status: second.container.querySelector(
					'[data-group-key="state-done"] [data-group-rows] > span[role="status"]',
				)?.textContent,
				showLess: screen.getAllByRole(
					"button",
					{
						name: "Show less in Idle",
					},
				).length,
			},
		).toStrictEqual(
			{
				shown: 41,
				status: "Showing 21 more in Idle\u200B",
				showLess: 1,
			},
		);
	});

	it("puts an awaiting dot at the end of Show more while a hidden row needs input", async () =>
	{
		const rows = Array.from(
			{
				length: 22,
			},
			(_, index) => session(`r${index}`, `Row ${index}`, index === 21 ? "blocked" : "done", index + 1),
		);
		const {container} = await renderGroups(
			rows,
			{
				prefs:
				{
					...DEFAULT_SESSION_LIST_PREFS,
					groupBy: "none",
				},
			},
		);

		const showMore = screen.getByRole(
			"button",
			{
				name: "Show 2 more in Recents",
			},
		);
		const trailing = showMore.querySelector("span.ms-auto");
		expect(
			{
				text: showMore.textContent,
				trailingClass: trailing?.className,
				dot: trailing?.querySelector('[role="img"]')?.getAttribute("aria-label"),
			},
		).toStrictEqual(
			{
				text: "Show more",
				trailingClass: "ms-auto flex size-[var(--sb-row-ctl)] shrink-0 items-center justify-center",
				dot: "Awaiting input",
			},
		);
		expect(container.querySelectorAll('[data-group-key="recents"] button[data-row] span.ms-auto')).toHaveLength(1);
	});

	it("holds a row whose menu is open when a re-sort pushes it past the cap, and Show more then reveals the unseen rows", async () =>
	{
		const sessions = doneSessions(23);
		const {container, queryClient} = await renderGroups(sessions);
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "More options for Done 19",
				},
			),
		);
		await waitFor(() => screen.getByRole("menu"));
		const resorted = sessions.map((row, index) => (index === 19 ? session("d19", "Done 19", "done", 100) : row));
		for (const status of ["active", "all"] as const)
		{
			act(() =>
			{
				queryClient.setQueryData(
					recentSessionsInfiniteQueryOptions(undefined, status).queryKey,
					{
						pages: [
							RecentSessionsResponse.parse(
								{
									sessions: resorted,
									nextCursor: null,
								},
							),
						],
						pageParams: [null],
					},
				);
			});
		}
		const shownTail = () => rowTitlesIn(container, "state-done").slice(18);
		await waitFor(() =>
		{
			expect(shownTail()).toContain("Done 20");
		});
		const held =
		{
			tail: shownTail(),
			menuOpen: screen.queryByRole("menu") !== null,
			showMore: screen
				.getByRole(
					"button",
					{
						name: /^Show \d+ more in Idle$/,
					},
				)
				.getAttribute("aria-label"),
		};
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: /^Show \d+ more in Idle$/,
				},
			),
		);
		expect(
			{
				held,
				revealedTail: shownTail(),
			},
		).toStrictEqual(
			{
				held:
				{
					tail: ["Done 18", "Done 20", "Done 19"],
					menuOpen: true,
					showMore: "Show 2 more in Idle",
				},
				revealedTail: ["Done 18", "Done 20", "Done 21", "Done 22", "Done 19"],
			},
		);
	});

	it("keeps a focused row adopted after focus leaves and later re-sorts land, as upstream's gy carries it", async () =>
	{
		const sessions = doneSessions(30);
		const {container, queryClient} = await renderGroups(sessions);
		const push = (rows: unknown[]) =>
		{
			act(() =>
			{
				for (const status of ["active", "all"] as const)
				{
					queryClient.setQueryData(
						recentSessionsInfiniteQueryOptions(undefined, status).queryKey,
						{
							pages: [
								RecentSessionsResponse.parse(
									{
										sessions: rows,
										nextCursor: null,
									},
								),
							],
							pageParams: [null],
						},
					);
				}
			});
		};
		const toTop = (rows: readonly ReturnType<typeof session>[], id: string, minutesAgo: number) =>
			rows.map((row) => (row.id === id ? session(id, row.title, "done", minutesAgo) : row));
		const link = container.querySelector<HTMLElement>(
			'[data-group-key="state-done"] [data-row-key="d19"] a[data-row-main-button]',
		);
		act(() =>
		{
			link?.focus();
		});
		const first = toTop(sessions, "d29", 0.5);
		push(first);
		await waitFor(() =>
		{
			expect(rowTitlesIn(container, "state-done")[0]).toBe("Done 29");
		});
		act(() =>
		{
			link?.blur();
		});
		const second = toTop(first, "d28", 0.25);
		push(second);
		await waitFor(() =>
		{
			expect(rowTitlesIn(container, "state-done")[0]).toBe("Done 28");
		});
		push(
			second.map((row) => (
			{
				...row,
			})),
		);
		expect(
			{
				tail: rowTitlesIn(container, "state-done").slice(19),
				showMore: screen
					.getByRole(
						"button",
						{
							name: /^Show \d+ more in Idle$/,
						},
					)
					.getAttribute("aria-label"),
			},
		).toStrictEqual(
			{
				tail: ["Done 17", "Done 18", "Done 19"],
				showMore: "Show 8 more in Idle",
			},
		);
	});

	it("reveals an open session hidden past the cap on first paint, and keeps it revealed after opening another", async () =>
	{
		const {container, setActiveItemId} = await renderGroups(
			doneSessions(47),
			{
				activeItemId: "d32",
			},
		);
		const state = () => (
		{
			shown: rowTitlesIn(container, "state-done").length,
			selected: container.querySelector('[data-group-key="state-done"] [data-row-key="d32"]') !== null,
			showMore: screen
				.queryByRole(
					"button",
					{
						name: /^Show \d+ more in Idle$/,
					},
				)
				?.getAttribute("aria-label"),
		});
		await waitFor(() =>
		{
			expect(state()).toStrictEqual(
				{
					shown: 33,
					selected: true,
					showMore: "Show 14 more in Idle",
				},
			);
		});

		setActiveItemId("d1");
		expect(state()).toStrictEqual(
			{
				shown: 33,
				selected: true,
				showMore: "Show 14 more in Idle",
			},
		);
	});

	it("reveals a hidden family head when its nested fork is the open session", async () =>
	{
		const rows = [
			...doneSessions(25),
			{
				...session("fork", "Fork of 24", "done", 0.5),
				forkedFromSessionId: "d24",
			},
		];
		const {container} = await renderGroups(
			rows,
			{
				activeItemId: "fork",
			},
		);
		await waitFor(() =>
		{
			expect(rowTitlesIn(container, "state-done")).toContain("Done 24");
		});
	});

	it("folds Show less back to the floor that keeps the open session, not to the first page", async () =>
	{
		const {container} = await renderGroups(
			doneSessions(47),
			{
				activeItemId: "d32",
			},
		);
		fireEvent.click(
			await screen.findByRole(
				"button",
				{
					name: "Show 14 more in Idle",
				},
			),
		);
		const showLess = screen.getByRole(
			"button",
			{
				name: "Show less in Idle",
			},
		);
		expect(showLess.getAttribute("aria-disabled")).toBeNull();

		fireEvent.click(showLess);
		expect(
			{
				shown: rowTitlesIn(container, "state-done").length,
				showMore: screen
					.getByRole(
						"button",
						{
							name: /^Show \d+ more in Idle$/,
						},
					)
					.getAttribute("aria-label"),
			},
		).toStrictEqual(
			{
				shown: 33,
				showMore: "Show 14 more in Idle",
			},
		);
	});

	it("holds Show less, described with upstream's tooltip and ignoring clicks, while the open session is near the end", async () =>
	{
		const {container} = await renderGroups(
			doneSessions(47),
			{
				activeItemId: "d46",
			},
		);
		const showLess = await screen.findByRole(
			"button",
			{
				name: "Show less in Idle",
			},
		);
		const describedBy = showLess.getAttribute("aria-describedby");
		const description = describedBy === null ? null : document.getElementById(describedBy);
		expect(
			{
				shown: rowTitlesIn(container, "state-done").length,
				disabled: showLess.getAttribute("aria-disabled"),
				held: showLess.getAttribute("data-held"),
				description:
				{
					hidden: description?.hidden,
					className: description?.className,
					text: description?.textContent,
				},
				heldClasses: [
					"aria-disabled:pointer-events-none",
					"aria-disabled:opacity-70",
					"aria-disabled:data-[held]:pointer-events-auto",
					"data-[held]:hover:bg-transparent",
					"data-[held]:hover:text-ink-muted",
				].filter((token) => !showLess.classList.contains(token)),
			},
		).toStrictEqual(
			{
				shown: 47,
				disabled: "true",
				held: "",
				description:
				{
					hidden: true,
					className: "",
					text: "Something open or selected is near the end of this list.",
				},
				heldClasses: [],
			},
		);

		fireEvent.click(showLess);
		expect(rowTitlesIn(container, "state-done")).toHaveLength(47);

		fireEvent.pointerEnter(showLess.parentElement ?? showLess);
		const tooltip = await screen.findByRole("tooltip");
		const tooltipClasses = tooltip.className.split(/\s+/);
		expect(
			{
				text: tooltip.textContent,
				present: ["py-1.5", "max-w-[240px]", "flex-col"].filter((token) => !tooltipClasses.includes(token)),
				absent: ["py-[3px]", "whitespace-pre-line"].filter((token) => tooltipClasses.includes(token)),
			},
		).toStrictEqual(
			{
				text: "Something open or selected is near the end of this list.",
				present: [],
				absent: [],
			},
		);
	});

	it("leaves Show less live when the open session stays inside the first 20 rows", async () =>
	{
		await renderGroups(
			doneSessions(47),
			{
				activeItemId: "d4",
			},
		);
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Show 20 more in Idle",
				},
			),
		);
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Show 7 more in Idle",
				},
			),
		);

		const showLess = screen.getByRole(
			"button",
			{
				name: "Show less in Idle",
			},
		);
		expect(
			{
				disabled: showLess.getAttribute("aria-disabled"),
				held: showLess.getAttribute("data-held"),
				describedBy: showLess.getAttribute("aria-describedby"),
			},
		).toStrictEqual(
			{
				disabled: null,
				held: null,
				describedBy: null,
			},
		);
	});

	it("hides a ⌘-selected row past the cap when Show less folds back, like upstream", async () =>
	{
		const {container} = await renderGroups(doneSessions(47));
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Show 20 more in Idle",
				},
			),
		);
		const link = container.querySelector<HTMLElement>('[data-row-key="d25"] a[data-row-main-button]');
		if (link === null) throw new Error("no d25 row");
		fireEvent.click(
			link,
			{
				metaKey: true,
			},
		);
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Show 7 more in Idle",
				},
			),
		);
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Show less in Idle",
				},
			),
		);
		expect(
			{
				shown: rowTitlesIn(container, "state-done").length,
				showMore: screen
					.getByRole(
						"button",
						{
							name: /^Show \d+ more in Idle$/,
						},
					)
					.getAttribute("aria-label"),
				selectedRowRendered: container.querySelector('[data-row-key="d25"]') !== null,
			},
		).toStrictEqual(
			{
				shown: 20,
				showMore: "Show 20 more in Idle",
				selectedRowRendered: false,
			},
		);
	});

	it("offers no Show less on a group that fits under the cap", async () =>
	{
		await renderGroups(FIXTURE);
		expect(
			screen.queryByRole(
				"button",
				{
					name: /^Show less/,
				},
			),
		).toBeNull();
	});

	it("puts the filter slot on every group header, as upstream puts Group and sort on each section", async () =>
	{
		const {container} = await renderGroups(
			[session("w1", "Working one", "working", 1), session("d1", "Completed one", "done", 5)],
			{
				filterSlot: <button type="button">Filter</button>,
			},
		);

		const headers = [...container.querySelectorAll('[data-testid="sidebar-recents"] [data-sidebar-group-label]')];
		expect(headers.map((header) => within(header as HTMLElement).queryAllByText("Filter").length)).toEqual([1, 1]);
		expect(
			within(headers[0] as HTMLElement).getByRole(
				"button",
				{
					name: "Working",
				},
			),
		).toBeTruthy();
	});

	it("draws each row's status in upstream's trailing slot, with no leading glyph, the env laptop on a settled row, and upstream's attention markup", async () =>
	{
		__unreadStoreTesting.reset();
		syncUnseenFromSummaries(
			FIXTURE.map(({id, unseen}) => (
			{
				id,
				unseen,
			})),
		);
		const {container} = await renderGroups(FIXTURE);
		const rowOf = (title: string) =>
		{
			const link = [...container.querySelectorAll<HTMLElement>("a[data-row-main-button]")].find((node) =>
				node.textContent.includes(title),
			);
			if (link === undefined) throw new Error(`no row ${title}`);
			return link;
		};
		const describeRow = (title: string) =>
		{
			const link = rowOf(title);
			const decoration = link.closest("[data-session-actions]")?.querySelector("[data-row-decoration]");
			const mark = decoration?.querySelector("[role=status], [role=img]");
			const wrappers: string[] = [];
			for (let node = mark?.parentElement; node && node !== decoration; node = node.parentElement)
			{
				wrappers.push(`${node.getAttribute("aria-hidden")} ${node.getAttribute("class")}`);
			}
			return {
				leading: link.querySelector(".df-leading-slot") !== null,
				title: describeRowTitle(link),
				wrappers,
				mark:
					mark === null || mark === undefined
						? null
						: [
								mark.getAttribute("role"),
								mark.getAttribute("aria-label"),
								mark.parentElement?.getAttribute("class") ?? null,
								mark.parentElement?.getAttribute("aria-hidden") ?? null,
							],
				env: decoration?.querySelector("[data-env-glyph]")?.getAttribute("data-env-glyph") ?? null,
				runningPulse: mark?.querySelector('[data-cds="Pulse"].df-tab-dot-running') != null,
				hidesOnHover: decoration?.className.split(" ").includes("group-hover/session-row:opacity-0") ?? false,
				flushRight: decoration?.className.split(" ").includes("right-[var(--sb-row-ctl-inset)]") ?? false,
			};
		};
		expect(
			{
				blocked: describeRow("Blocked one"),
				working: describeRow("Working one"),
				review: describeRow("Review one"),
				done: describeRow("Completed newest"),
			},
		).toStrictEqual(
			{
				blocked:
				{
					leading: false,
					title:
					{
						outer: "inline-block whitespace-nowrap align-top",
						outerChildren: 1,
						inner: "relative",
						attention: "waiting",
						shimmer: null,
					},
					wrappers: ["true flex items-center", "true flex items-center"],
					mark: ["img", "Awaiting input", "flex items-center", "true"],
					env: null,
					runningPulse: false,
					hidesOnHover: true,
					flushRight: true,
				},
				working:
				{
					leading: false,
					title:
					{
						outer: "inline-block whitespace-nowrap align-top",
						outerChildren: 1,
						inner: "relative",
						attention: null,
						shimmer: null,
					},
					wrappers: ["true flex items-center"],
					mark: ["img", "Running", "flex items-center", "true"],
					env: null,
					runningPulse: true,
					hidesOnHover: true,
					flushRight: true,
				},
				review:
				{
					leading: false,
					title:
					{
						outer: "inline-block whitespace-nowrap align-top",
						outerChildren: 1,
						inner: "relative",
						attention: "unread",
						shimmer: null,
					},
					wrappers: ["true flex items-center", "true flex items-center"],
					mark: ["img", "Unread response", "flex items-center", "true"],
					env: null,
					runningPulse: false,
					hidesOnHover: true,
					flushRight: true,
				},
				done:
				{
					leading: false,
					title:
					{
						outer: "inline-block whitespace-nowrap align-top",
						outerChildren: 1,
						inner: "relative",
						attention: null,
						shimmer: null,
					},
					wrappers: [],
					mark: null,
					env: "bridge",
					runningPulse: false,
					hidesOnHover: true,
					flushRight: true,
				},
			},
		);
	});

	it("gates the title's attention look as upstream: a working title has none, the open pane's own row is never unread, and archived rows carry none", async () =>
	{
		const look = async (
			sessions: unknown[],
			titles: readonly string[],
			options: Parameters<typeof renderGroups>[1] = {},
		) =>
		{
			__unreadStoreTesting.reset();
			syncUnseenFromSummaries(
				sessions.map((row) => (
				{
					id: (
						row as
						{
							id: string;
						}
					).id,
					unseen: (
						row as
						{
							unseen: boolean;
						}
					).unseen,
				})),
			);
			const {container} = await renderGroups(sessions, options);
			const result = Object.fromEntries(
				titles.map((title) =>
				{
					const link = rowLink(container, title);
					const {attention, shimmer} = describeRowTitle(link);
					const mark =
						link
							.closest("[data-session-actions]")
							?.querySelector("[data-row-decoration] [role=img]")
							?.getAttribute("aria-label") ?? null;
					return [
						title,
						{
							attention,
							shimmering: shimmer?.shimmering ?? null,
							clone: link.querySelector("[data-cds-shimmer-clone]") !== null,
							mark,
						},
					];
				}),
			);
			cleanup();
			return result;
		};
		const titles = ["Blocked one", "Working one", "Review one"];
		const allRows =
		{
			...DEFAULT_SESSION_LIST_PREFS,
			groupBy: "state" as const,
			statusFilter: "all" as const,
		};

		const workingOpen = await look(
			FIXTURE,
			titles,
			{
				activeItemId: "w1",
				initialPath: "/session/w1",
			},
		);
		const reviewOpen = await look(
			FIXTURE,
			titles,
			{
				activeItemId: "r1",
				initialPath: "/session/r1",
			},
		);
		const archived = await look(
			FIXTURE.map((row) => (
			{
				...row,
				archived: true,
			})),
			titles,
			{
				prefs: allRows,
			},
		);

		const blocked =
		{
			attention: "waiting",
			shimmering: null,
			clone: false,
			mark: "Awaiting input",
		};
		const unread =
		{
			attention: "unread",
			shimmering: null,
			clone: false,
			mark: "Unread response",
		};
		const working =
		{
			attention: null,
			shimmering: null,
			clone: false,
			mark: "Running",
		};
		expect(
			{
				workingOpen,
				reviewOpen,
				archived,
			},
		).toStrictEqual(
			{
				workingOpen:
				{
					"Blocked one": blocked,
					"Working one": working,
					"Review one": unread,
				},
				reviewOpen:
				{
					"Blocked one": blocked,
					"Working one": working,
					"Review one":
					{
						attention: null,
						shimmering: null,
						clone: false,
						mark: null,
					},
				},
				archived:
				{
					"Blocked one":
					{
						...blocked,
						attention: null,
					},
					"Working one": working,
					"Review one":
					{
						...unread,
						attention: null,
					},
				},
			},
		);
	});

	it("draws upstream's bridge env glyph on the icon, LaptopSlash when offline, a CPU on a headless session, and none on pinned rows or under project grouping", async () =>
	{
		const rows = [
			session("d1", "Live bridged", "done", 5),
			{
				...session("h1", "Headless run", "done", 4),
				terminalHost: "Headless",
			},
			{
				...session("d2", "Offline bridged", "done", 6),
				remoteControl: true,
				state: "ended",
			},
			{
				...session("d3", "Live remote", "done", 7),
				remoteControl: true,
			},
			session("p1", "Pinned one", "done", 8),
		];
		const describeEnv = (container: HTMLElement) =>
			Object.fromEntries(
				[...container.querySelectorAll<HTMLElement>("a[data-row-main-button]")].map((link) =>
				{
					const glyph = link
						.closest("[data-session-actions]")
						?.querySelector("[data-row-decoration] [data-env-glyph]");
					return [
						rowTitle(link),
						glyph === null || glyph === undefined
							? null
							:
								{
									tag: glyph.tagName.toLowerCase(),
									kind: glyph.getAttribute("data-env-glyph"),
									offline: glyph.hasAttribute("data-env-offline"),
									wrapper: glyph.parentElement?.getAttribute("class") ?? null,
									wrapperHidden: glyph.parentElement?.getAttribute("aria-hidden") ?? null,
									slash: glyph.querySelector('path[d="m2 2 20 20"]') !== null,
									ink: (glyph.getAttribute("class") ?? "")
										.split(" ")
										.filter((name) => name.startsWith("text-")),
								},
					];
				}),
			);
		const wrapper = "flex size-[var(--sb-row-ctl)] shrink-0 items-center justify-center";
		const live =
		{
			tag: "svg",
			kind: "bridge",
			offline: false,
			wrapper,
			wrapperHidden: "true",
			slash: false,
			ink: ["text-muted-as-secondary"],
		};

		localStorage.setItem(
			PIN_STORAGE_KEY,
			JSON.stringify(
				{
					pinnedIds: ["p1"],
					pinnedOrder: ["p1"],
				},
			),
		);
		const byProject = describeEnv(
			(
				await renderGroups(
					rows,
					{
						prefs:
						{
							...DEFAULT_SESSION_LIST_PREFS,
							groupBy: "project",
						},
					},
				)
			).container,
		);
		cleanup();
		const byState = describeEnv((await renderGroups(rows)).container);
		localStorage.removeItem(PIN_STORAGE_KEY);

		expect(
			{
				byState,
				byProject,
			},
		).toStrictEqual(
			{
				byState:
				{
					"Pinned one": null,
					"Live bridged": live,
					"Offline bridged":
					{
						...live,
						offline: true,
						slash: true,
					},
					"Live remote": live,
					"Headless run":
					{
						...live,
						kind: "headless",
					},
				},
				byProject:
				{
					"Pinned one": null,
					"Headless run": null,
					"Live bridged": null,
					"Offline bridged": null,
					"Live remote": null,
				},
			},
		);
	});

	it("moves an answered Needs input row to Working at once, keeps it there as the server confirms, and back on a new wait", async () =>
	{
		const {container, queryClient} = await renderGroups([session("b1", "Blocked one", "blocked", 3)]);
		const where = () => (
		{
			blocked: rowTitlesIn(container, "state-blocked"),
			working: rowTitlesIn(container, "state-working"),
			kinds: [...container.querySelectorAll(".status-dot")].map((dot) => dot.getAttribute("data-kind")),
		});
		const serverSays = (bucket: SessionBucket) =>
		{
			const next = session("b1", "Blocked one", bucket, 3);
			queryClient.setQueryData(
				recentSessionsInfiniteQueryOptions().queryKey,
				{
					pages: [
						RecentSessionsResponse.parse(
							{
								sessions: [next],
								nextCursor: null,
							},
						),
					],
					pageParams: [null],
				},
			);
			noteAnsweredSummary("b1", next.state === "waiting" ? "waiting" : "working");
		};
		const before = where();
		act(() =>
		{
			holdAnswered("b1", "toolu_1");
		});
		const answered = where();
		act(() =>
		{
			serverSays("working");
		});
		const confirmed = where();
		act(() =>
		{
			serverSays("blocked");
		});
		const rewaited = where();
		releaseAnswered("b1");

		expect(
			{
				before,
				answered,
				confirmed,
				rewaited,
			},
		).toStrictEqual(
			{
				before:
				{
					blocked: ["Blocked one"],
					working: [],
					kinds: ["awaiting"],
				},
				answered:
				{
					blocked: [],
					working: ["Blocked one"],
					kinds: ["running"],
				},
				confirmed:
				{
					blocked: [],
					working: ["Blocked one"],
					kinds: ["running"],
				},
				rewaited:
				{
					blocked: ["Blocked one"],
					working: [],
					kinds: ["awaiting"],
				},
			},
		);
	});

	it("moves a Needs input row to Idle at Mark as completed, offers Mark as unread, and brings it back on new activity", async () =>
	{
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Promise<Response>(() => {})),
		);
		const blocked = session("b1", "Blocked one", "blocked", 3);
		const done = session("d1", "Completed newest", "done", 5);
		const {container, queryClient} = await renderGroups([blocked, done]);
		const where = () =>
		{
			const link = [...container.querySelectorAll<HTMLElement>("a[data-row-main-button]")].find(
				(node) => rowTitle(node) === "Blocked one",
			);
			return {
				blocked: rowTitlesIn(container, "state-blocked"),
				idle: rowTitlesIn(container, "state-done"),
				attention: link?.querySelector("[data-row-label] .relative")?.getAttribute("data-attention") ?? null,
				kind:
					link?.closest("[data-session-actions]")?.querySelector(".status-dot")?.getAttribute("data-kind") ??
					null,
			};
		};
		const readStateItems = async () =>
		{
			fireEvent.contextMenu(
				screen.getByText("Blocked one"),
				{
					clientX: 40,
					clientY: 50,
				},
			);
			const menu = await waitFor(() => screen.getByRole("menu"));
			const items = [...menu.querySelectorAll('[role="menuitem"]')]
				.filter((node) => node.textContent.startsWith("Mark as"))
				.map((node) => [node.textContent, node.getAttribute("aria-keyshortcuts")]);
			return {
				menu,
				items,
			};
		};
		const before = where();
		const {menu, items: beforeItems} = await readStateItems();
		await act(async () =>
		{
			fireEvent.click(
				within(menu).getByRole(
					"menuitem",
					{
						name: /^Mark as completed/,
					},
				),
			);
			await Promise.resolve();
		});
		await waitFor(() =>
		{
			expect(screen.queryByRole("menu")).toBeNull();
		});
		const acked = where();
		const {menu: ackedMenu, items: ackedItems} = await readStateItems();
		fireEvent.keyDown(
			ackedMenu,
			{
				key: "Escape",
			},
		);
		await waitFor(() =>
		{
			expect(screen.queryByRole("menu")).toBeNull();
		});
		act(() =>
		{
			const next =
			{
				...blocked,
				mtime: new Date(Date.parse(blocked.mtime) + 1000).toISOString(),
			};
			queryClient.setQueryData(
				recentSessionsInfiniteQueryOptions(undefined, "active").queryKey,
				{
					pages: [
						RecentSessionsResponse.parse(
							{
								sessions: [next, done],
								nextCursor: null,
							},
						),
					],
					pageParams: [null],
				},
			);
		});
		await waitFor(() =>
		{
			expect(rowTitlesIn(container, "state-blocked")).toStrictEqual(["Blocked one"]);
		});
		const renewed = where();

		expect(
			{
				before,
				beforeItems,
				acked,
				ackedItems,
				renewed,
			},
		).toStrictEqual(
			{
				before:
				{
					blocked: ["Blocked one"],
					idle: ["Completed newest"],
					attention: "waiting",
					kind: "awaiting",
				},
				beforeItems: [
					["Mark as unread", null],
					["Mark as completedU", "u"],
				],
				acked:
				{
					blocked: [],
					idle: ["Blocked one", "Completed newest"],
					attention: null,
					kind: null,
				},
				ackedItems: [["Mark as unreadU", "u"]],
				renewed:
				{
					blocked: ["Blocked one"],
					idle: ["Completed newest"],
					attention: "waiting",
					kind: "awaiting",
				},
			},
		);
	});

	it("keeps an acked row in Needs input while this tab holds its approval card live, still after the card unmounts, until the session stops waiting", async () =>
	{
		const blocked = session("b1", "Blocked one", "blocked", 3);
		const done = session("d1", "Completed newest", "done", 5);
		ack("b1", Date.parse(blocked.mtime));
		let dispose = () =>
		{
		};
		act(() =>
		{
			dispose = registerLiveApproval("b1");
		});
		const {container, queryClient} = await renderGroups([blocked, done]);
		const where = () =>
		{
			const link = [...container.querySelectorAll<HTMLElement>("a[data-row-main-button]")].find(
				(node) => rowTitle(node) === "Blocked one",
			);
			return {
				blocked: rowTitlesIn(container, "state-blocked"),
				idle: rowTitlesIn(container, "state-done"),
				attention: link?.querySelector("[data-row-label] .relative")?.getAttribute("data-attention") ?? null,
			};
		};
		const push = async (bucket: "blocked" | "done") =>
		{
			await act(async () =>
			{
				queryClient.setQueryData(
					recentSessionsInfiniteQueryOptions(undefined, "active").queryKey,
					{
						pages: [
							RecentSessionsResponse.parse(
								{
									sessions: [
										{
											...blocked,
											bucket,
											state: bucket === "blocked" ? "waiting" : "idle",
										},
										done,
									],
									nextCursor: null,
								},
							),
						],
						pageParams: [null],
					},
				);
				// The query cache notifies its observers on a timeout.
				await new Promise((resolve) =>
				{
					setTimeout(resolve, 0);
				});
			});
		};
		const live = where();
		act(() =>
		{
			dispose();
		});
		const unmounted = where();
		fireEvent.contextMenu(
			screen.getByText("Blocked one"),
			{
				clientX: 40,
				clientY: 50,
			},
		);
		const menu = await waitFor(() => screen.getByRole("menu"));
		const unmountedItems = [...menu.querySelectorAll('[role="menuitem"]')]
			.map((node) => node.textContent)
			.filter((text) => text.startsWith("Mark as"));
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
		await push("done");
		await push("blocked");
		const released = where();

		expect(
			{
				live,
				unmounted,
				unmountedItems,
				released,
			},
		).toStrictEqual(
			{
				live:
				{
					blocked: ["Blocked one"],
					idle: ["Completed newest"],
					attention: "waiting",
				},
				unmounted:
				{
					blocked: ["Blocked one"],
					idle: ["Completed newest"],
					attention: "waiting",
				},
				unmountedItems: ["Mark as unreadU"],
				released:
				{
					blocked: [],
					idle: ["Blocked one", "Completed newest"],
					attention: null,
				},
			},
		);
	});

	it("keeps a read failed row whose CLI exited in Needs input with the error mark until it is acked, and re-arms on a newer failure", async () =>
	{
		const failed = session("f1", "Failed one", "done", 3);
		const failedRow =
		{
			...failed,
			state: "ended",
			failedAt: new Date(Date.parse(failed.mtime) - MINUTE).toISOString(),
		};
		const done = session("d1", "Completed newest", "done", 5);
		const {container, queryClient} = await renderGroups([failedRow, done]);
		const header = () =>
		{
			const label = container.querySelector('[data-group-key="state-blocked"] > [data-sidebar-group-label]');
			if (!(label instanceof HTMLElement)) throw new Error("no Needs input header");
			return label;
		};
		const where = () =>
		{
			const link = [...container.querySelectorAll<HTMLElement>("a[data-row-main-button]")].find(
				(node) => rowTitle(node) === "Failed one",
			);
			const decoration = link?.closest("[data-session-actions]")?.querySelector("[data-row-decoration]");
			return {
				blocked: rowTitlesIn(container, "state-blocked"),
				idle: rowTitlesIn(container, "state-done"),
				mark: decoration?.querySelector("[role=img]")?.getAttribute("aria-label") ?? null,
				attention: link?.querySelector("[data-row-label] .relative")?.getAttribute("data-attention") ?? null,
			};
		};
		const toggleNeedsInput = () =>
			fireEvent.click(
				within(header()).getByRole(
					"button",
					{
						name: /^Needs input/,
					},
				),
			);
		const push = (row: typeof failedRow) =>
		{
			act(() =>
			{
				queryClient.setQueryData(
					recentSessionsInfiniteQueryOptions(undefined, "active").queryKey,
					{
						pages: [
							RecentSessionsResponse.parse(
								{
									sessions: [row, done],
									nextCursor: null,
								},
							),
						],
						pageParams: [null],
					},
				);
			});
		};
		const later = (ms: number) => new Date(Date.parse(failed.mtime) + ms).toISOString();

		const before = where();
		toggleNeedsInput();
		const badge = [...header().querySelectorAll("[data-group-toggle] > [data-group-badge] [role=img]")].map(
			(mark) => mark.getAttribute("aria-label"),
		);
		toggleNeedsInput();
		act(() =>
		{
			ack("f1", Date.parse(failed.mtime));
		});
		const acked = where();
		push(
			{
				...failedRow,
				mtime: later(MINUTE),
			},
		);
		const bumped = where();
		push(
			{
				...failedRow,
				mtime: later(2 * MINUTE),
				failedAt: later(2 * MINUTE),
			},
		);
		await waitFor(() =>
		{
			expect(rowTitlesIn(container, "state-blocked")).toStrictEqual(["Failed one"]);
		});
		const refailed = where();

		expect(
			{
				before,
				badge,
				acked,
				bumped,
				refailed,
			},
		).toStrictEqual(
			{
				before:
				{
					blocked: ["Failed one"],
					idle: ["Completed newest"],
					mark: "Error",
					attention: null,
				},
				badge: ["Error"],
				acked:
				{
					blocked: [],
					idle: ["Completed newest", "Failed one"],
					mark: null,
					attention: null,
				},
				bumped:
				{
					blocked: [],
					idle: ["Completed newest", "Failed one"],
					mark: null,
					attention: null,
				},
				refailed:
				{
					blocked: ["Failed one"],
					idle: ["Completed newest"],
					mark: "Error",
					attention: null,
				},
			},
		);
	});

	it("badges a collapsed Needs input holding a failed row and an awaiting row as awaiting, as upstream's sU priorities rank awaiting above error", async () =>
	{
		const failed = session("f1", "Failed one", "done", 3);
		const {container} = await renderGroups([
			{
				...failed,
				state: "ended",
				failedAt: new Date(Date.parse(failed.mtime) - MINUTE).toISOString(),
			},
			session("b1", "Blocked one", "blocked", 1),
		]);
		const label = container.querySelector('[data-group-key="state-blocked"] > [data-sidebar-group-label]');
		if (!(label instanceof HTMLElement)) throw new Error("no Needs input header");
		fireEvent.click(
			within(label).getByRole(
				"button",
				{
					name: /^Needs input/,
				},
			),
		);

		expect(
			[...label.querySelectorAll("[data-group-toggle] > [data-group-badge] [role=img]")].map((mark) =>
				mark.getAttribute("aria-label"),
			),
		).toStrictEqual(["Awaiting input"]);
	});

	it("draws an unseen error as upstream's warning TriangleAlert in the trailing slot instead of the awaiting dot", async () =>
	{
		const rows = [
			{
				...session("e1", "Errored one", "blocked", 1),
				state: "idle",
				unseen: true,
				unseenError: true,
			},
			session("b1", "Blocked one", "blocked", 3),
		];
		__unreadStoreTesting.reset();
		syncUnseenFromSummaries(
			rows.map(({id, unseen}) => (
			{
				id,
				unseen,
			})),
		);
		const {container} = await renderGroups(rows);
		const marks = Object.fromEntries(
			[...container.querySelectorAll<HTMLElement>("a[data-row-main-button]")].map((link) =>
			{
				const decoration = link.closest("[data-session-actions]")?.querySelector("[data-row-decoration]");
				const mark = decoration?.querySelector("[role=img]");
				return [
					rowTitle(link),
					{
						label: mark?.getAttribute("aria-label") ?? null,
						triangle: decoration?.querySelector("svg.lucide-triangle-alert") !== null,
						dot: decoration?.querySelector(".status-dot")?.getAttribute("data-kind") ?? null,
						srStatus: link.querySelector("[data-session-status]")?.textContent ?? null,
					},
				];
			}),
		);
		expect(marks).toStrictEqual(
			{
				"Errored one":
				{
					label: "Error",
					triangle: true,
					dot: null,
					srStatus: " Error",
				},
				"Blocked one":
				{
					label: "Awaiting input",
					triangle: false,
					dot: "awaiting",
					srStatus: " Awaiting input",
				},
			},
		);
	});

	it("draws a PR as upstream's title tail inside the link, beside the env glyph or status mark, only while Show PR status is on", async () =>
	{
		const withPr = [
			{
				...session("d1", "Completed newest", "done", 5),
				prStatus:
				{
					number: 8,
					state: "open",
				},
			},
			{
				...session("u1", "Unread with PR", "done", 6),
				unseen: true,
				prStatus:
				{
					number: 9,
					state: "merged",
				},
			},
			session("d2", "Completed older", "done", 30),
		];
		const describeRows = (container: HTMLElement) =>
			[...container.querySelectorAll<HTMLElement>("a[data-row-main-button]")].map((link) =>
			{
				const decoration = link.closest("[data-session-actions]")?.querySelector("[data-row-decoration]");
				const tail = link.lastElementChild;
				return {
					title: rowTitle(link),
					tail: link.querySelector("[data-pr-glyph]")?.getAttribute("data-pr-glyph") ?? null,
					tailSlot: tail?.getAttribute("class") ?? null,
					tailInSlot: tail?.querySelector("[data-pr-glyph]") !== null,
					label: link.querySelector("[data-row-label]")?.getAttribute("class") ?? null,
					mark: decoration?.querySelector("[role=img]")?.getAttribute("aria-label") ?? null,
					env: decoration?.querySelector("[data-env-glyph]") !== null,
					liveRegions: decoration?.querySelectorAll("[role=status]").length ?? null,
				};
			});
		const slot =
			"shrink-0 flex items-center gap-1.5 text-xs text-muted-as-secondary me-[calc(var(--sb-row-ctl-inset)+var(--sb-row-ctl)-var(--sb-row-px))]";
		const label = "min-w-0 flex-1 ps-2";

		__unreadStoreTesting.reset();
		syncUnseenFromSummaries(
			withPr.map(({id, unseen}) => (
			{
				id,
				unseen,
			})),
		);
		localStorage.setItem(
			"ccp-session-list-prefs",
			JSON.stringify(
				{
					...DEFAULT_SESSION_LIST_PREFS,
					showPrStatus: true,
				},
			),
		);
		const shown = describeRows((await renderGroups(withPr)).container);
		cleanup();
		localStorage.removeItem("ccp-session-list-prefs");
		const hidden = describeRows((await renderGroups(withPr)).container).map(({tail}) => tail);

		expect(
			{
				shown,
				hidden,
			},
		).toStrictEqual(
			{
				shown: [
					{
						title: "Completed newest",
						tail: "opened",
						tailSlot: slot,
						tailInSlot: true,
						label,
						mark: null,
						env: true,
						liveRegions: 0,
					},
					{
						title: "Unread with PR",
						tail: "merged",
						tailSlot: slot,
						tailInSlot: true,
						label,
						mark: "Unread response",
						env: false,
						liveRegions: 0,
					},
					{
						title: "Completed older",
						tail: null,
						tailSlot: slot,
						tailInSlot: false,
						label,
						mark: null,
						env: true,
						liveRegions: 0,
					},
				],
				hidden: [null, null, null],
			},
		);
	});

	it("keeps the touch kebab only on the current session's row and the status mark on every other row, as upstream's data-touch-menu", async () =>
	{
		const {container} = await renderGroups(
			FIXTURE,
			{
				activeItemId: "w1",
			},
		);
		const rows = [...container.querySelectorAll<HTMLElement>("[data-session-actions]")];
		const decoration = rows[0]?.querySelector("[data-row-decoration]");

		expect(
			{
				touchMenu: rows
					.filter((row) => row.hasAttribute("data-touch-menu"))
					.map((row) => rowTitle(row.querySelector("a[data-row-main-button]"))),
				decorationHiddenOnTouch: decoration?.className.split(" ").includes("pointer-coarse:opacity-0"),
				kebabShownOnTouch: rows[0]
					?.querySelector("[data-row-action]")
					?.className.split(" ")
					.includes("pointer-coarse:opacity-100"),
			},
		).toStrictEqual(
			{
				touchMenu: ["Working one"],
				decorationHiddenOnTouch: false,
				kebabShownOnTouch: false,
			},
		);
	});

	it("announces each row's status and environment in upstream's two sr-only spans inside the title", async () =>
	{
		const srOnlyOf = (title: string) =>
		{
			const link = screen.getAllByRole("link").find((node) => rowTitle(node) === title);
			if (link === undefined) throw new Error(`no row ${title}`);
			return [...link.querySelectorAll("[data-row-label] .relative > .sr-only[data-find-omitted]")].map(
				(node) => [node.getAttribute("role"), node.getAttribute("data-session-status"), node.textContent],
			);
		};
		const environments = () =>
			Object.fromEntries(FIXTURE.map((row) => [row.id, srOnlyOf(row.title).at(-1)?.[2] ?? null]));
		const titleSpanOf = (title: string) =>
		{
			const first = screen
				.getAllByRole("link")
				.find((node) => rowTitle(node) === title)
				?.querySelector("[data-row-label] .relative")?.firstChild;
			return first instanceof HTMLElement
				? [first.tagName, first.attributes.length, first.childElementCount, first.textContent]
				: null;
		};
		const terminalHosts: Record<string, string> =
		{
			b1: "herdr",
			w1: "herdr · later",
			r1: "tmux · work",
		};
		await renderGroups(
			FIXTURE.map((row) => (
			{
				...row,
				...(row.id in terminalHosts
					?
						{
							terminalHost: terminalHosts[row.id],
						}
					: {}),
				// Remote Control on or off no longer shows: upstream's bridge text is only Connected/Offline.
				...(row.id === "b1"
					?
						{
							remoteControlState: "on" as const,
						}
					: {}),
				...(row.id === "r1"
					?
						{
							remoteControlState: "off" as const,
						}
					: {}),
				// Its process ended, so its bridge is Offline.
				...(row.id === "d1"
					?
						{
							remoteControl: true,
							state: "ended",
						}
					: {}),
				// No machine or repo name falls back to upstream's "Remote Control".
				...(row.id === "d2"
					?
						{
							projectName: "",
						}
					: {}),
			})),
		);

		expect(
			{
				href: screen
					.getByRole(
						"link",
						{
							name: /^Blocked one\s*Awaiting input\s*herdr · Connected$/,
						},
					)
					.getAttribute("href"),
				awaiting: srOnlyOf("Blocked one"),
				idle: srOnlyOf("Completed older"),
				titleSpan: titleSpanOf("Blocked one"),
				env: environments(),
			},
		).toStrictEqual(
			{
				href: "/session/b1",
				awaiting: [
					[null, "", " Awaiting input"],
					[null, null, " herdr · Connected"],
				],
				// Upstream unmounts the status span once the row has no status.
				idle: [[null, null, " Remote Control · Connected"]],
				titleSpan: ["SPAN", 0, 0, "Blocked one"],
				env:
				{
					d1: " project-d1 · Offline",
					w1: " herdr · later · Connected",
					r1: " tmux · work · Connected",
					b1: " herdr · Connected",
					d2: " Remote Control · Connected",
				},
			},
		);
	});

	it("names a row's PR in its sr environment text only while Show PR status is on and the row isn't archived", async () =>
	{
		const rows = [
			{
				...session("d1", "Draft PR", "done", 5),
				prStatus:
				{
					number: 8,
					state: "draft",
				},
			},
			{
				...session("a1", "Archived PR", "done", 6),
				archived: true,
				prStatus:
				{
					number: 9,
					state: "draft",
				},
			},
		];
		const environments = () =>
			Object.fromEntries(
				screen
					.getAllByRole("link")
					.filter((link) => link.hasAttribute("data-row-main-button"))
					.map((link) => [
						rowTitle(link),
						[...link.querySelectorAll("[data-row-label] .relative > .sr-only[data-find-omitted]")].at(-1)
							?.textContent ?? null,
					]),
			);
		const render = async (showPrStatus: boolean) =>
		{
			localStorage.setItem(
				"ccp-session-list-prefs",
				JSON.stringify(
					{
						...DEFAULT_SESSION_LIST_PREFS,
						showPrStatus,
					},
				),
			);
			await renderGroups(
				rows,
				{
					prefs:
					{
						...DEFAULT_SESSION_LIST_PREFS,
						groupBy: "state",
						statusFilter: "all",
					},
				},
			);
			const result = environments();
			cleanup();
			localStorage.removeItem("ccp-session-list-prefs");
			return result;
		};

		expect(
			{
				off: await render(false),
				on: await render(true),
			},
		).toStrictEqual(
			{
				off:
				{
					"Draft PR": " project-d1 · Connected",
					"Archived PR Archived": " project-a1 · Connected",
				},
				on:
				{
					"Draft PR": " project-d1 · Connected · Draft",
					"Archived PR Archived": " project-a1 · Connected",
				},
			},
		);
	});

	it("shows upstream's Couldn’t load your sessions alert with Try again when the list fails to load", async () =>
	{
		const fetchMock = vi.fn<typeof fetch>(async () => Promise.reject(new Error("offline")));
		vi.stubGlobal("fetch", fetchMock);
		await renderGroups(
			[],
			{
				unseeded: true,
			},
		);
		const message = await screen.findByText("Couldn’t load your sessions");
		const alert = message.closest<HTMLElement>("[role=alert]");
		if (alert === null) throw new Error("Expected the load failure to be an alert");
		const callsBefore = fetchMock.mock.calls.length;
		fireEvent.click(
			within(alert).getByRole(
				"button",
				{
					name: "Try again",
				},
			),
		);
		await waitFor(() =>
		{
			expect(fetchMock.mock.calls.length).toBeGreaterThan(callsBefore);
		});
		vi.unstubAllGlobals();
	});

	it("ends a Status list with upstream's list-level Load more sessions row while the feed has another page", async () =>
	{
		const {container} = await renderGroups(
			FIXTURE,
			{
				nextCursor: "cursor-2",
			},
		);
		const button = screen.getByRole(
			"button",
			{
				name: "Load more sessions",
			},
		);
		const wrapper = button.parentElement;
		const recents = container.querySelector('[data-testid="sidebar-recents"]');
		expect(
			{
				key: wrapper?.getAttribute("data-row-key"),
				wrapperClass: wrapper?.className,
				text: button.textContent,
				children: [...button.childNodes].map((node) => node.nodeType),
				inSection: button.closest("[data-group-section], [data-group-key]"),
				lastRowKey: [...(recents?.querySelectorAll("[data-row-key]") ?? [])]
					.at(-1)
					?.getAttribute("data-row-key"),
				recentsList: recents?.hasAttribute("data-recents-list"),
				roving: button.hasAttribute("data-roving-item"),
				classes: [
					"mt-[var(--sb-group-pt-token)]",
					"ps-[calc(var(--sb-row-px)+var(--sb-iconless-pad))]",
					"hit-row",
					"[--cds-hit-gap-y:7px]",
					"hit-row-main",
					"focus-visible:shadow-[inset_0_0_0_1px_var(--upstream-fill-accent),0_0_6px_0_color-mix(in_srgb,var(--upstream-fill-accent)_20%,transparent)]",
				].filter((token) => !button.classList.contains(token)),
				status: wrapper?.querySelector('span.sr-only[role="status"]')?.textContent,
				hiddenSpan: wrapper?.querySelector("span[hidden]") !== null,
			},
		).toStrictEqual(
			{
				key: "label:fetchmore:recents",
				wrapperClass: "df-drag-shiftable [overflow-anchor:none]",
				text: "Load more sessions",
				children: [Node.TEXT_NODE],
				inSection: null,
				lastRowKey: "label:fetchmore:recents",
				recentsList: true,
				roving: true,
				classes: [],
				status: "",
				hiddenSpan: true,
			},
		);
	});

	it("loads the next page from Load more sessions once, showing Loading… with aria-disabled, then reveals and announces the landed rows", async () =>
	{
		const page = stubNextPage(
			[
				session("d-new-1", "Next 1", "done", 60),
				session("d-new-2", "Next 2", "done", 61),
				session("d-new-3", "Next 3", "done", 62),
			],
			"cursor-3",
		);
		const {container} = await renderGroups(
			doneSessions(20),
			{
				nextCursor: "cursor-2",
			},
		);
		const button = screen.getByRole(
			"button",
			{
				name: "Load more sessions",
			},
		);
		fireEvent.click(
			button,
			{
				detail: 1,
			},
		);
		await waitFor(() =>
		{
			expect(button.textContent).toBe("Loading…");
		});
		expect(button.getAttribute("aria-disabled")).toBe("true");
		fireEvent.click(button);
		fireEvent.click(
			button,
			{
				detail: 2,
			},
		);
		page.respond();
		await waitFor(() =>
		{
			expect(rowTitlesIn(container, "state-done")).toHaveLength(23);
		});
		expect(
			{
				requests: page.requests,
				last: rowTitlesIn(container, "state-done").slice(-3),
				status: button.parentElement?.querySelector('[role="status"]')?.textContent,
				text: button.textContent,
			},
		).toStrictEqual(
			{
				requests: ["/api/sessions/recent?limit=50&cursor=cursor-2&live=1"],
				last: ["Next 1", "Next 2", "Next 3"],
				status: "Loaded 3 more sessions",
				text: "Load more sessions",
			},
		);
	});

	it("moves focus to the first loaded row after a keyboard Load more sessions", async () =>
	{
		const page = stubNextPage([session("d-new", "Next row", "done", 60)], "cursor-3");
		const {container} = await renderGroups(
			FIXTURE,
			{
				nextCursor: "cursor-2",
			},
		);
		const button = screen.getByRole(
			"button",
			{
				name: "Load more sessions",
			},
		);
		act(() =>
		{
			button.focus();
		});
		fireEvent.click(
			button,
			{
				detail: 0,
			},
		);
		await waitFor(() =>
		{
			expect(page.requests).toHaveLength(1);
		});
		page.respond();
		await waitFor(() =>
		{
			expect(document.activeElement).toBe(
				container.querySelector('[data-row-key="d-new"] a[data-row-main-button]'),
			);
		});
	});

	it("rescues focus to the first loaded row when a mouse Load more empties the feed and the row unmounts", async () =>
	{
		const page = stubNextPage([session("d-new", "Next row", "done", 60)], null);
		const {container} = await renderGroups(
			FIXTURE,
			{
				nextCursor: "cursor-2",
			},
		);
		const button = screen.getByRole(
			"button",
			{
				name: "Load more sessions",
			},
		);
		pointerFocus(button);
		fireEvent.click(
			button,
			{
				detail: 1,
			},
		);
		await waitFor(() =>
		{
			expect(page.requests).toHaveLength(1);
		});
		page.respond();
		await waitFor(() =>
		{
			expect(
				screen.queryByRole(
					"button",
					{
						name: "Load more sessions",
					},
				),
			).toBeNull();
		});
		await waitFor(() =>
		{
			expect(document.activeElement).toBe(
				container.querySelector('[data-row-key="d-new"] a[data-row-main-button]'),
			);
		});
	});

	it("cancels the focus rescue when the pointer goes down elsewhere while the page loads", async () =>
	{
		const page = stubNextPage([session("d-new", "Next row", "done", 60)], null);
		const {container} = await renderGroups(
			FIXTURE,
			{
				nextCursor: "cursor-2",
			},
		);
		const button = screen.getByRole(
			"button",
			{
				name: "Load more sessions",
			},
		);
		pointerFocus(button);
		fireEvent.click(
			button,
			{
				detail: 1,
			},
		);
		await waitFor(() =>
		{
			expect(page.requests).toHaveLength(1);
		});
		fireEvent.pointerDown(document.body);
		page.respond();
		await waitFor(() =>
		{
			expect(container.querySelector('[data-row-key="d-new"]')).not.toBeNull();
		});
		expect(document.activeElement).toBe(document.body);
	});

	it("has no Load more sessions row without a next page or once the oldest loaded row is past Last activity", async () =>
	{
		const {unmount} = await renderGroups(FIXTURE);
		expect(
			screen.queryByRole(
				"button",
				{
					name: "Load more sessions",
				},
			),
		).toBeNull();
		unmount();

		await renderGroups(
			[...FIXTURE, session("d-stale", "Stale", "done", 8 * 24 * 60)],
			{
				nextCursor: "cursor-2",
			},
		);
		expect(
			screen.queryByRole(
				"button",
				{
					name: "Load more sessions",
				},
			),
		).toBeNull();
	});

	it("draws the Load more sessions row before the empty body when every loaded row is filtered out", async () =>
	{
		const {container} = await renderGroups(
			FIXTURE.map((row) => (
			{
				...row,
				archived: true,
			})),
			{
				nextCursor: "cursor-2",
			},
		);
		const wrapper = container.querySelector('[data-row-key="label:fetchmore:recents"]');
		expect(
			{
				row: wrapper !== null,
				followedBy: wrapper?.nextElementSibling?.hasAttribute("data-group-key") ?? false,
			},
		).toStrictEqual(
			{
				row: true,
				followedBy: true,
			},
		);
	});

	it("does not fetch when the list end scrolls into view", async () =>
	{
		const observed: Element[] = [];
		vi.stubGlobal(
			"IntersectionObserver",
			class
			{
				observe(target: Element)
				{
					observed.push(target);
				}
				disconnect()
				{
				}
				unobserve()
				{
				}
				takeRecords(): IntersectionObserverEntry[]
				{
					return [];
				}
			},
		);
		const page = stubNextPage([], null);
		const {container} = await renderGroups(
			FIXTURE,
			{
				nextCursor: "cursor-2",
			},
		);
		await act(async () =>
		{
			await Promise.resolve();
		});
		expect(
			{
				requests: page.requests,
				listEnd: container.querySelector("[data-sidebar-list-end]"),
			},
		).toStrictEqual(
			{
				requests: [],
				listEnd: null,
			},
		);
	});

	it("reveals hidden Idle rows from Show more without fetching under Status grouping", async () =>
	{
		const page = stubNextPage([], null);
		const {container} = await renderGroups(
			doneSessions(23),
			{
				nextCursor: "cursor-2",
			},
		);
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Show 3 more in Idle",
				},
			),
		);
		expect(
			{
				shown: rowTitlesIn(container, "state-done").length,
				requests: page.requests,
			},
		).toStrictEqual(
			{
				shown: 23,
				requests: [],
			},
		);
	});

	it("fetches from the last Date section's count-0 Show more, and from a list-level row once it collapses", async () =>
	{
		const page = stubNextPage([session("d-old", "Done older page", "done", 60 * 24 * 3)], null);
		const datePrefs =
		{
			...DEFAULT_SESSION_LIST_PREFS,
			groupBy: "date",
		} as const;
		const {container} = await renderGroups(
			doneSessions(3),
			{
				nextCursor: "cursor-2",
				prefs: datePrefs,
			},
		);
		expect(
			screen.queryByRole(
				"button",
				{
					name: "Load more sessions",
				},
			),
		).toBeNull();

		const showMore = screen.getByRole(
			"button",
			{
				name: "Show more sessions",
			},
		);
		expect(
			{
				text: showMore.textContent,
				wrapperKey: showMore.parentElement?.getAttribute("data-row-key"),
			},
		).toStrictEqual(
			{
				text: "Show more",
				wrapperKey: "label:showmore:date-today",
			},
		);
		fireEvent.click(showMore);
		const loading = await screen.findByRole(
			"button",
			{
				name: "Show more sessions",
			},
		);
		await waitFor(() =>
		{
			expect(loading.textContent).toBe("Loading…");
		});
		expect(loading.getAttribute("aria-disabled")).toBe("true");
		page.respond();
		await waitFor(() =>
		{
			expect(container.textContent).toContain("Done older page");
		});
		expect(page.requests).toStrictEqual(["/api/sessions/recent?limit=50&cursor=cursor-2&live=1"]);
	});

	it("draws a label:fetchmore:date Load more row when the last Date section is collapsed", async () =>
	{
		const {container} = await renderGroups(
			doneSessions(3),
			{
				nextCursor: "cursor-2",
				prefs:
				{
					...DEFAULT_SESSION_LIST_PREFS,
					groupBy: "date",
				},
			},
		);
		fireEvent.click(toggleOf(container, "date-today"));
		expect(
			screen
				.getByRole(
					"button",
					{
						name: "Load more sessions",
					},
				)
				.parentElement?.getAttribute("data-row-key"),
		).toBe("label:fetchmore:date");
	});

	describe("Older bucket bulk menu", () =>
	{
		const DAY_MINUTES = 60 * 24;
		const older = (index: number) => session(`o${index}`, `Old ${index}`, "done", (10 + index) * DAY_MINUTES);
		const datePrefs: SessionListPrefs =
		{
			...DEFAULT_SESSION_LIST_PREFS,
			groupBy: "date",
			activityDays: "all",
		};

		it("draws no upstream AG trigger on the Date Older header, leaving Archive all (N) to its right-click menu", async () =>
		{
			localStorage.setItem(
				PIN_STORAGE_KEY,
				JSON.stringify(
					{
						pinnedIds: ["o1"],
						pinnedOrder: ["o1"],
					},
				),
			);
			const {container} = await renderGroups(
				[
					session("t1", "Today one", "done", 5),
					...Array.from(
						{
							length: 8,
						},
						(_, index) => older(index),
					),
				],
				{
					prefs: datePrefs,
					activeItemId: "o2",
					filterSlot: <button type="button">Group and sort</button>,
				},
			);
			const header = container.querySelector('[data-group-key="date-older"] [data-header-controls]');
			// Read before the menu opens: an open menu hides the rest of the page from role queries.
			const atRest =
			{
				bulkButtons: screen.queryAllByRole(
					"button",
					{
						name: "Bulk actions for older sessions",
					},
				).length,
				controls: [...(header?.querySelectorAll(":scope > button") ?? [])].map((child) =>
					child.getAttribute("aria-label"),
				),
			};
			fireEvent.contextMenu(
				toggleOf(container, "date-older"),
				{
					clientX: 40,
					clientY: 50,
				},
			);
			const menu = await waitFor(() => screen.getByRole("menu"));

			expect(
				{
					...atRest,
					archiveAll: [...menu.querySelectorAll("[role=menuitem]")]
						.map((item) => item.textContent)
						.filter((label) => label.startsWith("Archive all")),
				},
			).toStrictEqual(
				{
					bulkButtons: 0,
					controls: [],
					archiveAll: ["Archive all (6)"],
				},
			);
		});
	});

	it("keeps the row background on upstream's wrapper while the kebab or context menu is open, hiding the mark only for the kebab", async () =>
	{
		const {container} = await renderGroups(
			FIXTURE,
			{
				activeItemId: "w1",
			},
		);
		const wrapperOf = (title: string) =>
		{
			const link = [...container.querySelectorAll<HTMLElement>("a[data-row-main-button]")].find(
				(node) => rowTitle(node) === title,
			);
			const wrapper = link?.closest<HTMLElement>("[data-session-actions]");
			if (link === undefined || wrapper === null || wrapper === undefined) throw new Error(`no row ${title}`);
			return {
				link,
				wrapper,
			};
		};
		const describeRow = (title: string) =>
		{
			const {link, wrapper} = wrapperOf(title);
			const decoration = wrapper.querySelector("[data-row-decoration]");
			return {
				menuOpen: wrapper.getAttribute("data-menu-open"),
				contextMenuOpen: wrapper.getAttribute("data-context-menu-open"),
				decorationHidden: decoration?.className
					.split(" ")
					.includes("group-data-[menu-open=true]/session-row:opacity-0"),
				decorationHiddenByAnyPopup: decoration?.className.includes("data-popup-open") ?? false,
				linkHasBackground: link.className.split(" ").some((name) => name.includes("bg-[var(--sb-hover)]")),
				// Each menu mounts its Base UI root on first open: the kebab then carries Base UI's trigger id,
				// and the right-click menu its hidden trigger.
				kebabRoot: wrapper.querySelector("[data-row-action]")?.id.startsWith("base-ui-") ?? false,
				contextRoot: wrapper.querySelector("[data-row-context-trigger]") !== null,
			};
		};
		const {wrapper} = wrapperOf("Completed newest");
		const wrapperClasses = wrapper.className.split(" ");
		const backgrounds = [
			"rounded-[var(--sb-radius)]",
			"hover:bg-[var(--sb-hover)]",
			"has-[:focus-visible]:bg-[var(--sb-hover)]",
			"data-[menu-open=true]:bg-[var(--sb-hover)]",
			"data-[context-menu-open=true]:bg-[var(--sb-hover)]",
			"has-[[data-row-main-button][data-selected=focused]]:bg-[var(--sb-session-selected)]",
		];
		const rest =
		{
			wrapperBackgrounds: backgrounds.filter((name) => wrapperClasses.includes(name)),
			selected: wrapperOf("Working one").link.getAttribute("data-selected"),
			row: describeRow("Completed newest"),
		};

		fireEvent.contextMenu(
			screen.getByText("Completed newest"),
			{
				clientX: 40,
				clientY: 50,
			},
		);
		await waitFor(() => screen.getByRole("menu"));
		const contextOpen = describeRow("Completed newest");
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

		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "More options for Completed newest",
				},
			),
		);
		await waitFor(() => screen.getByRole("menu"));
		const kebabOpen = describeRow("Completed newest");

		const closed =
		{
			menuOpen: null,
			contextMenuOpen: null,
			decorationHidden: true,
			decorationHiddenByAnyPopup: false,
			linkHasBackground: false,
			kebabRoot: false,
			contextRoot: false,
		};
		expect(
			{
				rest,
				contextOpen,
				kebabOpen,
			},
		).toStrictEqual(
			{
				rest:
				{
					wrapperBackgrounds: backgrounds,
					selected: "focused",
					row: closed,
				},
				contextOpen:
				{
					...closed,
					contextMenuOpen: "true",
					contextRoot: true,
				},
				kebabOpen:
				{
					...closed,
					menuOpen: "true",
					kebabRoot: true,
					contextRoot: true,
				},
			},
		);
	});
});

describe("SessionGroups hover cards", () =>
{
	async function hoverRow(container: HTMLElement, title: string)
	{
		const link = [...container.querySelectorAll("a[data-row-main-button]")].find(
			(node) => rowTitle(node) === title,
		);
		const trigger = link?.closest("[data-hover-card-trigger]");
		if (!(trigger instanceof HTMLElement)) throw new Error(`no row ${title}`);
		fireEvent.pointerEnter(
			trigger,
			{
				pointerType: "mouse",
			},
		);
		fireEvent.mouseEnter(trigger);
		fireEvent.mouseMove(trigger);
		return waitFor(() =>
		{
			const card = document.querySelector("[data-session-hover-card]");
			if (!(card instanceof HTMLElement)) throw new Error("no card");
			return card;
		});
	}

	it("previews a completed row's title and summary", async () =>
	{
		const {container} = await renderGroups([
			{
				...session("d1", "Completed newest", "done", 5),
				summary: "Shipped the parser.",
			},
		]);
		const card = await hoverRow(container, "Completed newest");
		expect(
			{
				kind: card.getAttribute("data-kind"),
				title: card.querySelector("[data-card-title]")?.textContent,
				summary: card.querySelector("[data-card-summary]")?.textContent,
			},
		).toStrictEqual(
			{
				kind: "other",
				title: "Completed newest",
				summary: "Shipped the parser.",
			},
		);
	});

	// Upstream `a_`: the title tooltip trigger is disabled while the row's hover card is live (`ls`), else marked live.
	it("marks each title as upstream's tooltip trigger, disabled on rows whose hover card is live", async () =>
	{
		const {container} = await renderGroups([
			session("b1", "Blocked one", "blocked", 3),
			{
				...session("d1", "Completed summarised", "done", 5),
				summary: "Shipped the parser.",
			},
			session("d2", "Completed plain", "done", 6),
		]);
		const marks = (label: Element | null | undefined) => (
		{
			disabled: label?.getAttribute("data-trigger-disabled") ?? null,
			trigger: label?.getAttribute("data-base-ui-tooltip-trigger") ?? null,
		});
		const rowLabel = (title: string) =>
			[...container.querySelectorAll("a[data-row-main-button]")]
				.find((node) => rowTitle(node) === title)
				?.querySelector(".dframe-fade-label");
		expect(
			{
				blocked: marks(rowLabel("Blocked one")),
				summarised: marks(rowLabel("Completed summarised")),
				plain: marks(rowLabel("Completed plain")),
				groups: [...container.querySelectorAll("[data-group-name] .dframe-fade-label")].map(marks),
			},
		).toStrictEqual(
			{
				blocked:
				{
					disabled: "",
					trigger: null,
				},
				summarised:
				{
					disabled: "",
					trigger: null,
				},
				plain:
				{
					disabled: null,
					trigger: "",
				},
				groups: [
					{
						disabled: null,
						trigger: "",
					},
					{
						disabled: null,
						trigger: "",
					},
					{
						disabled: null,
						trigger: "",
					},
				],
			},
		);
	});

	it("opens the blocked card on a Needs input row", async () =>
	{
		const {container} = await renderGroups([session("b1", "Blocked one", "blocked", 3)]);
		const card = await hoverRow(container, "Blocked one");
		expect(card.getAttribute("data-kind")).toBe("blocked");
	});
});

// Upstream `A_.pending` / `RM` / `UT(pending, 1500)` + `CR`: the tab that launched a session shows a skeleton row until
// the session's real row arrives, and only that row's first title reveals.
describe("SessionGroups pending launch row", () =>
{
	const LAUNCH =
	{
		projectId: "-projects-new",
		projectName: "project-new",
		cwd: "/projects/new",
		opens: true,
	};

	function setSessions(queryClient: QueryClient, sessions: unknown[])
	{
		act(() =>
		{
			for (const status of ["active", "all"] as const)
			{
				queryClient.setQueryData(
					recentSessionsInfiniteQueryOptions(undefined, status).queryKey,
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
			}
		});
	}

	function workingRows(container: HTMLElement): HTMLElement[]
	{
		return [
			...container.querySelectorAll<HTMLElement>(
				'[data-group-key="state-working"] [data-group-rows] > [data-row-key]',
			),
		];
	}

	afterEach(() =>
	{
		__pendingLaunchTesting.reset();
	});

	it("leads Working with a selected skeleton row reading Running, then swaps it for the launched session's row with no duplicate", async () =>
	{
		const key = addPendingLaunch(
			{
				...LAUNCH,
				since: Date.now(),
			},
		);
		const {container, queryClient} = await renderGroups(FIXTURE);
		const [first] = workingRows(container);
		const main = first!.querySelector("[data-row-main-button]")!;
		const pending =
		{
			rowKeys: workingRows(container).map((row) => row.getAttribute("data-row-key")),
			tag: main.tagName,
			selected: main.getAttribute("data-selected"),
			skeletons: main.querySelectorAll("[data-row-label] [data-cds=Skeleton][aria-hidden=true]").length,
			statuses: [...first!.querySelectorAll("[role=status], [data-session-status]")].map(
				(status) => status.textContent,
			),
			mark: first!.querySelector("[data-row-decoration] [role=img]")?.getAttribute("aria-label"),
			menus: first!.querySelectorAll("[data-session-actions] button[aria-haspopup]").length,
		};

		setSessions(queryClient, [...FIXTURE, session("new", "Fix the flaky test", "working", 0)]);

		await waitFor(() =>
		{
			expect(readPendingLaunches()).toStrictEqual([]);
		});
		expect(
			{
				pending,
				after: workingRows(container).map((row) => row.getAttribute("data-row-key")),
				links: [...container.querySelectorAll('[data-group-key="state-working"] a[data-row-main-button]')].map(
					(link) => link.getAttribute("href"),
				),
				skeletons: container.querySelectorAll("[data-row-label] [data-cds=Skeleton]").length,
			},
		).toStrictEqual(
			{
				pending:
				{
					rowKeys: [key, "w1"],
					tag: "SPAN",
					selected: "focused",
					skeletons: 1,
					statuses: ["Loading", " Running"],
					mark: "Running",
					menus: 0,
				},
				after: ["new", "w1"],
				links: ["/session/new", "/session/w1"],
				skeletons: 0,
			},
		);
	});

	it("links the skeleton row to the session once herdr names it, and drops it if that session never arrives", async () =>
	{
		vi.useFakeTimers(
			{
				shouldAdvanceTime: true,
			},
		);
		try
		{
			const key = addPendingLaunch(
				{
					...LAUNCH,
					since: Date.now(),
					opens: false,
				},
			);
			const {container} = await renderGroups(FIXTURE);
			act(() =>
			{
				markPendingLaunchStarted(key, "s-herdr");
			});
			const main = workingRows(container)[0]!.querySelector("[data-row-main-button]")!;
			const named =
			{
				tag: main.tagName,
				href: main.getAttribute("href"),
				selected: main.getAttribute("data-selected"),
			};

			act(() =>
			{
				vi.advanceTimersByTime(15_000);
			});

			expect(
				{
					named,
					after: workingRows(container).map((row) => row.getAttribute("data-row-key")),
				},
			).toStrictEqual(
				{
					named:
					{
						tag: "A",
						href: "/session/s-herdr",
						selected: null,
					},
					after: ["w1"],
				},
			);
		}
		finally
		{
			vi.useRealTimers();
		}
	});

	it("reveals only the launched row's first title, for 1500 ms after its launch settled", async () =>
	{
		vi.useFakeTimers(
			{
				shouldAdvanceTime: true,
			},
		);
		try
		{
			const key = addPendingLaunch(
				{
					...LAUNCH,
					since: Date.now(),
				},
			);
			settlePendingLaunch(key, "new");
			const {container, queryClient} = await renderGroups([
				...FIXTURE,
				session("new", "Fix the flaky test", "done", 0),
			]);
			const label = () => container.querySelector('[data-row-key="new"] [data-row-label] .relative')!;
			const revealing =
			{
				revealing: label().querySelectorAll("[data-revealing]").length,
				srCopy: label().querySelector(":scope > .sr-only")?.textContent,
			};
			setSessions(queryClient, [
				...FIXTURE.map((row) =>
					row.id === "w1"
						?
							{
								...row,
								title: "Working renamed",
							}
						: row,
				),
				session("new", "Fix the flaky test", "done", 0),
			]);
			const renamed = container.querySelector('[data-row-key="w1"] [data-row-label]')!;
			const otherRow = renamed.querySelectorAll("[data-revealing], [aria-hidden=true] > span").length;

			act(() =>
			{
				vi.advanceTimersByTime(1500);
			});

			expect(
				{
					revealing,
					otherRow,
					after:
					{
						revealing: label().querySelectorAll("[data-revealing]").length,
						graphemes: label().querySelectorAll("[aria-hidden=true] > span").length,
						title: label().firstElementChild?.outerHTML,
					},
				},
			).toStrictEqual(
				{
					revealing:
					{
						revealing: 1,
						srCopy: "Fix the flaky test",
					},
					otherRow: 0,
					after:
					{
						revealing: 0,
						graphemes: 0,
						title: "<span>Fix the flaky test</span>",
					},
				},
			);
		}
		finally
		{
			vi.useRealTimers();
		}
	});
});

// Upstream `sP` (`Me`), `$y` and `gb`: the open session stays visible under a collapsed header, a collapsed
// group expands when the open session moves into it, and focus in an unmounting section lands on a toggle.
describe("SessionGroups open row and focus rescue", () =>
{
	function setSessions(queryClient: QueryClient, sessions: unknown[])
	{
		act(() =>
		{
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
		});
	}

	it("keeps the open session's row under its collapsed header and badges only the hidden rows", async () =>
	{
		const rows = [
			{
				...session("od1", "Open done", "done", 5),
				unseen: true,
			},
			session("od2", "Other done", "done", 6),
		];
		__unreadStoreTesting.reset();
		syncUnseenFromSummaries(
			rows.map(({id, unseen}) => (
			{
				id,
				unseen,
			})),
		);
		const {container} = await renderGroups(
			rows,
			{
				activeItemId: "od1",
			},
		);

		fireEvent.click(toggleOf(container, "state-done"));

		const label = container.querySelector('[data-group-key="state-done"] > [data-sidebar-group-label]');
		expect(
			{
				expanded: toggleOf(container, "state-done").getAttribute("aria-expanded"),
				rows: rowTitlesIn(container, "state-done"),
				selected: container
					.querySelector(
						'[data-group-key="state-done"] [data-group-rows]:not([hidden]) a[data-row-main-button]',
					)
					?.getAttribute("data-selected"),
				rowless: label?.getAttribute("data-rowless") ?? null,
				badges: label?.querySelectorAll("[data-group-badge]").length,
			},
		).toStrictEqual(
			{
				expanded: "false",
				rows: ["Open done"],
				selected: "focused",
				rowless: null,
				badges: 0,
			},
		);
	});

	it("expands a collapsed group when the open session moves into it and keeps focus on its row", async () =>
	{
		const rows = [session("mw1", "Moving one", "working", 1), session("md1", "Done one", "done", 5)];
		const {container, queryClient} = await renderGroups(
			rows,
			{
				activeItemId: "mw1",
			},
		);
		fireEvent.click(toggleOf(container, "state-done"));
		expect(toggleOf(container, "state-done").getAttribute("aria-expanded")).toBe("false");
		const link = container.querySelector<HTMLElement>('[data-group-key="state-working"] a[data-row-main-button]');
		link?.focus();

		setSessions(queryClient, [session("mw1", "Moving one", "done", 1), session("md1", "Done one", "done", 5)]);

		await waitFor(() =>
		{
			expect(
				{
					expanded: toggleOf(container, "state-done").getAttribute("aria-expanded"),
					rows: rowTitlesIn(container, "state-done"),
					collapsed: readSidebarState().collapsedGroups,
					focused: document.activeElement?.closest("[data-row-key]")?.getAttribute("data-row-key") ?? null,
				},
			).toStrictEqual(
				{
					expanded: "true",
					rows: ["Moving one", "Done one"],
					collapsed: [],
					focused: "mw1",
				},
			);
		});
	});

	it("moves focus from an unmounting section to the next group's toggle, else the previous one", async () =>
	{
		const rows = [
			session("fb1", "Blocked one", "blocked", 3),
			session("fw1", "Working one", "working", 1),
			session("fd1", "Done one", "done", 5),
		];
		const {container, queryClient} = await renderGroups(rows);
		container.querySelector<HTMLElement>('[data-group-key="state-working"] a[data-row-main-button]')?.focus();

		setSessions(queryClient, [rows[0], rows[2]]);
		await waitFor(() =>
		{
			expect(document.activeElement).toBe(toggleOf(container, "state-done"));
		});

		container.querySelector<HTMLElement>('[data-group-key="state-done"] a[data-row-main-button]')?.focus();
		setSessions(queryClient, [rows[0]]);
		await waitFor(() =>
		{
			expect(document.activeElement).toBe(toggleOf(container, "state-blocked"));
		});
	});
});

describe("SessionGroups per-project New session +", () =>
{
	const byProject =
	{
		...DEFAULT_SESSION_LIST_PREFS,
		groupBy: "project",
	} as const;
	const ROWS = [session("a1", "Alpha one", "done", 5), session("b1", "Beta one", "done", 6)];

	function project(id: string, name: string, projectPath: string | null)
	{
		return {
			id,
			name,
			projectPath,
			sessionCount: 1,
			memoryCount: 0,
			planCount: 0,
			taskCount: 0,
			activeCount: 0,
			lastActivity: "2026-10-01T00:00:00Z",
		};
	}

	const PROJECTS = [project("-projects-a1", "project-a1", "/p/a1"), project("-projects-b1", "project-b1", "/p/b1")];

	function newSessionButtons(container: HTMLElement): Record<string, string[]>
	{
		return Object.fromEntries(
			[...container.querySelectorAll<HTMLElement>('[data-testid="sidebar-recents"] [data-group-key]')].map(
				(section) => [
					section.getAttribute("data-group-key"),
					[...section.querySelectorAll("[data-sidebar-group-label] button[aria-label^='New session']")].map(
						(button) => button.getAttribute("aria-label") ?? "",
					),
				],
			),
		);
	}

	afterEach(() =>
	{
		takePendingHomeLaunchFolder();
	});

	it("gives every project header its own New session in {group} + and drops the generic first-header +", async () =>
	{
		const {container} = await renderGroups(
			ROWS,
			{
				prefs: byProject,
				projects: PROJECTS,
			},
		);

		expect(newSessionButtons(container)).toStrictEqual(
			{
				"project-project-a1": ["New session in project-a1"],
				"project-project-b1": ["New session in project-b1"],
			},
		);
	});

	// Upstream's hub-rail sidebar passes the status list no onNewSession: the New nav row is the entry point.
	it("puts no New session + on any header under status grouping", async () =>
	{
		const {container} = await renderGroups(
			ROWS,
			{
				projects: PROJECTS,
			},
		);

		expect(newSessionButtons(container)).toStrictEqual(
			{
				"state-done": [],
			},
		);
	});

	it("shows no + for a project whose folder is gone or unknown", async () =>
	{
		const {container} = await renderGroups(
			ROWS,
			{
				prefs: byProject,
				projects: [project("-projects-a1", "project-a1", null)],
			},
		);

		expect(newSessionButtons(container)).toStrictEqual(
			{
				"project-project-a1": [],
				"project-project-b1": [],
			},
		);
	});

	it("goes home with that project as the launch folder, leaving the section expanded", async () =>
	{
		const {container, router} = await renderGroups(
			ROWS,
			{
				prefs: byProject,
				projects: PROJECTS,
				initialPath: "/session/a1",
			},
		);

		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "New session in project-b1",
				},
			),
		);

		await waitFor(() =>
		{
			expect(router.state.location.pathname).toBe("/");
		});
		expect(
			{
				launchFolder: takePendingHomeLaunchFolder(),
				expanded: toggleOf(container, "project-project-b1").getAttribute("aria-expanded"),
				collapsedGroups: readSidebarState().collapsedGroups,
			},
		).toStrictEqual(
			{
				launchFolder: "-projects-b1",
				expanded: "true",
				collapsedGroups: [],
			},
		);
	});

	it("keeps the + on a collapsed project section", async () =>
	{
		const {container} = await renderGroups(
			ROWS,
			{
				prefs: byProject,
				projects: PROJECTS,
			},
		);

		fireEvent.click(toggleOf(container, "project-project-a1"));

		expect(
			{
				expanded: toggleOf(container, "project-project-a1").getAttribute("aria-expanded"),
				buttons: newSessionButtons(container)["project-project-a1"],
			},
		).toStrictEqual(
			{
				expanded: "false",
				buttons: ["New session in project-a1"],
			},
		);
	});

	const PLACE_UNKNOWN = "Where these sessions run isn’t known, so there’s nowhere to start a new one.";

	async function openHeaderMenu(container: HTMLElement, key: string): Promise<HTMLElement>
	{
		fireEvent.contextMenu(
			toggleOf(container, key),
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
		return await waitFor(() => screen.getByRole("menu"));
	}

	/** The header menu's first item with its disabled reason, or null while it is enabled. */
	function firstMenuItem(menu: HTMLElement):
	{
		label: string | null;
		disabledReason: string | null;
	}
	{
		const item = menu.querySelector('[role="menuitem"]');
		if (item === null) throw new Error("no menu item");
		return {
			label: item.textContent,
			disabledReason:
				item.getAttribute("aria-disabled") === "true"
					? (document.getElementById(item.getAttribute("aria-describedby") ?? "")?.textContent ?? "")
					: null,
		};
	}

	it("leads a project header menu with an enabled New session that goes home with that project", async () =>
	{
		const {container, router} = await renderGroups(
			ROWS,
			{
				prefs: byProject,
				projects: PROJECTS,
				initialPath: "/session/a1",
			},
		);

		const menu = await openHeaderMenu(container, "project-project-b1");
		expect(firstMenuItem(menu)).toStrictEqual(
			{
				label: "New session",
				disabledReason: null,
			},
		);

		fireEvent.click(
			within(menu).getByRole(
				"menuitem",
				{
					name: "New session",
				},
			),
		);

		await waitFor(() =>
		{
			expect(router.state.location.pathname).toBe("/");
		});
		expect(takePendingHomeLaunchFolder()).toBe("-projects-b1");
	});

	it("disables New session with the place-unknown reason for a project whose folder is gone", async () =>
	{
		const {container} = await renderGroups(
			ROWS,
			{
				prefs: byProject,
				projects: [project("-projects-a1", "project-a1", null), PROJECTS[1]],
			},
		);

		expect(firstMenuItem(await openHeaderMenu(container, "project-project-a1"))).toStrictEqual(
			{
				label: "New session",
				disabledReason: PLACE_UNKNOWN,
			},
		);
	});
});

describe("SessionGroups described rows (Show ▸ Metadata)", () =>
{
	const described = [
		{
			...session("d1", "Idle on main", "done", 5),
			gitBranch: "main",
			projectName: "claude-code-plans",
			recap: "Fixed the login bug.",
			lastUserMessage: "Fix it",
		},
		{
			...session("b1", "Blocked asking", "blocked", 3),
			gitBranch: "main",
			lastUserMessage: "Run the tests",
		},
		{
			...session("b2", "Permission ask", "blocked", 4),
			awaitingPermission: true,
		},
		{
			...session("p1", "Pinned on main", "done", 8),
			gitBranch: "main",
			projectName: "claude-code-plans",
		},
		session("n1", "No branch", "done", 9),
	];
	const describeRows = (container: HTMLElement) =>
		Object.fromEntries(
			[...container.querySelectorAll<HTMLElement>("a[data-row-main-button]")].map((link) =>
			{
				const line = link.querySelector(".df-row-description .df-meta-slots");
				return [
					rowTitle(link.querySelector("[data-row-label]")),
					{
						described: link.classList.contains("df-described-row"),
						oneLine: link.classList.contains("h-[var(--sb-row-h)]"),
						titleWrap: link.querySelector(":scope > .df-described-title > [data-row-label]") !== null,
						// Re-centres the decoration and kebab on the title line (upstream's described `top`)
						titleCentred: link.closest("[data-session-actions]")?.hasAttribute("data-described") === true,
						line:
							line === null
								? null
								:
									{
										text: line.textContent,
										title: line.getAttribute("title"),
									},
					},
				];
			}),
		);
	const oneLine =
	{
		described: false,
		oneLine: true,
		titleWrap: false,
		titleCentred: false,
		line: null,
	};

	afterEach(() =>
	{
		localStorage.removeItem("ccp-session-list-prefs");
		localStorage.removeItem(PIN_STORAGE_KEY);
	});

	it("renders upstream's two-line described skeleton rows while the list loads with Metadata on", async () =>
	{
		vi.stubGlobal(
			"fetch",
			vi.fn<typeof fetch>(async () => new Promise<Response>(() => {})),
		);
		localStorage.setItem(
			"ccp-session-list-prefs",
			JSON.stringify(
				{
					...DEFAULT_SESSION_LIST_PREFS,
					showMetadata: true,
				},
			),
		);
		const {container} = await renderGroups(
			[],
			{
				unseeded: true,
				loading: true,
			},
		);
		const rows = [...container.querySelectorAll<HTMLElement>("[data-row]")].map((row) => (
		{
			described: row.hasAttribute("data-described"),
			className: row.className,
			bars: [...row.children].map((line) =>
			{
				const bar = line.firstElementChild;
				if (!(bar instanceof HTMLElement)) throw new Error("Expected a skeleton bar");
				return {
					line: line.className,
					width: bar.style.width,
					height: bar.style.height,
				};
			}),
		}));
		const rowClass = "df-described-row flex flex-col items-stretch justify-center px-[var(--sb-row-px)]";
		const bars = (title: string, description: string) => [
			{
				line: "df-described-title flex min-w-0 items-center",
				width: title,
				height: "var(--sb-row-font)",
			},
			{
				line: "df-row-description flex min-w-0 items-center",
				width: description,
				height: "var(--sb-group-font)",
			},
		];
		expect(rows).toStrictEqual([
			{
				described: true,
				className: rowClass,
				bars: bars("68%", "54%"),
			},
			{
				described: true,
				className: rowClass,
				bars: bars("54%", "44%"),
			},
			{
				described: true,
				className: rowClass,
				bars: bars("44%", "68%"),
			},
		]);
	});

	it("gives unpinned rows upstream's described shell and meta line only with Metadata on", async () =>
	{
		localStorage.setItem(
			PIN_STORAGE_KEY,
			JSON.stringify(
				{
					pinnedIds: ["p1"],
					pinnedOrder: ["p1"],
				},
			),
		);
		const off = describeRows((await renderGroups(described)).container);
		cleanup();
		localStorage.setItem(
			"ccp-session-list-prefs",
			JSON.stringify(
				{
					...DEFAULT_SESSION_LIST_PREFS,
					showMetadata: true,
				},
			),
		);
		const byStateContainer = (await renderGroups(described)).container;
		const byState = describeRows(byStateContainer);
		// Upstream's tooltip mode: an overflowing idle row's slots open the list as a tooltip instead of a title.
		const idleSlots = [...byStateContainer.querySelectorAll<HTMLElement>(".df-meta-slots")].find(
			(slots) => slots.textContent === "Fixed the login bug.claude-code-plans",
		);
		Object.defineProperty(
			idleSlots,
			"scrollWidth",
			{
				configurable: true,
				value: 200,
			},
		);
		Object.defineProperty(
			idleSlots,
			"clientWidth",
			{
				configurable: true,
				value: 100,
			},
		);
		fireEvent.pointerEnter(idleSlots?.parentElement ?? byStateContainer);
		const idleTooltip = (await screen.findByRole("tooltip")).innerHTML;
		cleanup();
		const byProject = describeRows(
			(
				await renderGroups(
					described,
					{
						prefs:
						{
							...DEFAULT_SESSION_LIST_PREFS,
							groupBy: "project",
							showMetadata: true,
						},
					},
				)
			).container,
		);

		const line = (text: string, title: string | null) => (
		{
			described: true,
			oneLine: false,
			titleWrap: true,
			titleCentred: true,
			line:
			{
				text,
				title,
			},
		});
		expect(
			{
				off,
				byState,
				byProject,
				idleTooltip,
			},
		).toStrictEqual(
			{
				off:
				{
					"Pinned on main": oneLine,
					"Blocked asking": oneLine,
					"Permission ask": oneLine,
					"Idle on main": oneLine,
					"No branch": oneLine,
				},
				byState:
				{
					"Pinned on main": oneLine,
					"Blocked asking": line("Run the testsproject-b1", "Run the tests, project-b1"),
					"Permission ask": line("Needs permissionproject-b2", "Needs permission, project-b2"),
					"Idle on main": line("Fixed the login bug.claude-code-plans", null),
					"No branch": line("project-n1", null),
				},
				byProject:
				{
					"Pinned on main": oneLine,
					"Blocked asking": line("WaitingRun the tests", "Waiting, Run the tests"),
					"Permission ask": line("WaitingNeeds permission", "Waiting, Needs permission"),
					"Idle on main": line("Fixed the login bug.", null),
					"No branch": line("Idle", null),
				},
				idleTooltip:
					'<span class="min-w-0 break-words"><span dir="auto" class="block">Fixed the login bug., claude-code-plans</span></span>',
			},
		);
	});

	it("keeps the PR glyph in the title tail and draws no branch glyph on the meta line", async () =>
	{
		localStorage.setItem(
			"ccp-session-list-prefs",
			JSON.stringify(
				{
					...DEFAULT_SESSION_LIST_PREFS,
					showMetadata: true,
					showPrStatus: true,
				},
			),
		);
		const {container} = await renderGroups([
			{
				...session("d1", "Open PR on main", "done", 5),
				gitBranch: "main",
				prStatus:
				{
					number: 8,
					state: "open",
				},
			},
		]);

		const link = container.querySelector("a[data-row-main-button]");
		expect(
			{
				glyphs: [...(link?.querySelectorAll("[data-pr-glyph]") ?? [])].map((glyph) => (
				{
					state: glyph.getAttribute("data-pr-glyph"),
					onLine: glyph.closest(".df-row-description") !== null,
				})),
				branchGlyphs: link?.querySelectorAll("[data-branch-glyph]").length,
			},
		).toStrictEqual(
			{
				glyphs: [
					{
						state: "opened",
						onLine: false,
					},
				],
				branchGlyphs: 0,
			},
		);
	});

	it("labels a described row by its title and description ids", async () =>
	{
		localStorage.setItem(
			"ccp-session-list-prefs",
			JSON.stringify(
				{
					...DEFAULT_SESSION_LIST_PREFS,
					showMetadata: true,
				},
			),
		);
		const {container} = await renderGroups([
			{
				...session("d1", "Tidy up", "done", 5),
				summary: "Fixed it",
			},
		]);

		const link = container.querySelector("a[data-row-main-button]");
		const ids = link?.getAttribute("aria-labelledby")?.split(" ") ?? [];
		expect(
			ids.map((id) =>
			{
				const element = document.getElementById(id);
				return {
					suffix: id.slice(ids[0]?.length),
					label: element?.hasAttribute("data-row-label") === true,
					description: element?.classList.contains("df-row-description") === true,
				};
			}),
		).toStrictEqual([
			{
				suffix: "",
				label: true,
				description: false,
			},
			{
				suffix: "-description",
				label: false,
				description: true,
			},
		]);
	});
});

describe("SessionGroups sections layout", () =>
{
	function seedSections(assignments: Record<string, string>): void
	{
		localStorage.setItem(
			"ccp-session-groups",
			JSON.stringify(
				{
					groups: [
						{
							id: "cg-a",
							name: "A",
							icon: "star",
							color: "red",
						},
					],
					assignments,
					order: {},
				},
			),
		);
	}

	function menuOutline(menu: HTMLElement): string[]
	{
		return [
			...menu.querySelectorAll(
				':scope [role="menuitem"], :scope [role="menuitemcheckbox"], :scope [role="menuitemradio"], :scope [role="separator"]',
			),
		].map((node) => (node.getAttribute("role") === "separator" ? "---" : node.textContent.trim()));
	}

	async function openSectionMenu(container: HTMLElement): Promise<HTMLElement>
	{
		const trigger = container.querySelector<HTMLElement>(
			'.df-sortable-section [data-group-key="custom-cg-a"] button[aria-label="Group and sort"]',
		);
		if (trigger === null) throw new Error("no section Group and sort");
		fireEvent.click(trigger);
		return await waitFor(() => screen.getByRole("menu"));
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
		const submenu = await waitFor(() =>
		{
			const menus = screen.getAllByRole("menu");
			if (menus.length < 2) throw new Error("no submenu");
			return menus.at(-1);
		});
		if (submenu === undefined) throw new Error("Expected a submenu");
		return submenu;
	}

	it("lists a manual section above Recents in a df-sortable-section, its sessions left out of Recents", async () =>
	{
		seedSections(
			{
				b1: "cg-a",
			},
		);
		const {container} = await renderGroups(FIXTURE);

		expect(
			{
				order: [...container.querySelectorAll("[data-sidebar-group-label] [data-group-name]")].map(
					(node) => node.textContent,
				),
				sortable: [...container.querySelectorAll(".df-sortable-section [data-group-name]")].map(
					(node) => node.textContent,
				),
				inSection: rowTitlesIn(container, "custom-cg-a"),
				recents: groupNames(container),
			},
		).toStrictEqual(
			{
				order: ["Pinned", "A", "Ready for review", "Working", "Idle"],
				sortable: ["A"],
				inSection: ["Blocked one"],
				recents: ["Ready for review", "Working", "Idle"],
			},
		);
	});

	it("wraps each manual section in its own df-sortable-section, like upstream's `sx`", async () =>
	{
		localStorage.setItem(
			"ccp-session-groups",
			JSON.stringify(
				{
					groups: [
						{
							id: "cg-a",
							name: "A",
						},
						{
							id: "cg-b",
							name: "B",
						},
					],
					assignments:
					{
						b1: "cg-a",
					},
					order: {},
				},
			),
		);
		const {container} = await renderGroups(FIXTURE);

		expect(
			[...container.querySelectorAll(".df-sortable-section")].map((wrapper) => (
			{
				classes: [...wrapper.classList],
				gapAfter: wrapper.getAttribute("data-gap-after"),
				labels: [...wrapper.querySelectorAll("[data-sidebar-group-label] [data-group-name]")].map(
					(node) => node.textContent,
				),
			})),
		).toStrictEqual(
			["A", "B"].map((label) => (
			{
				classes: ["df-sortable-section", "not-empty:[&+[data-gap-after]]:mt-2"],
				gapAfter: "",
				labels: [label],
			})),
		);
	});

	it("wraps each header toggle in an h3, with a 5px gap, no hover ink of its own and the mark after the name", async () =>
	{
		seedSections(
			{
				b1: "cg-a",
			},
		);
		const {container} = await renderGroups(FIXTURE);
		const toggle = toggleOf(container, "custom-cg-a");

		expect(
			{
				heading: screen
					.getByRole(
						"heading",
						{
							level: 3,
							name: "A",
						},
					)
					.contains(toggle),
				classes: toggle.className
					.split(" ")
					.filter((name) => name === "gap-1.25" || name === "hover:text-secondary"),
				children: [...toggle.children].map((child) =>
					["data-group-name", "data-group-mark", "data-group-caret"].find((name) => child.hasAttribute(name)),
				),
			},
		).toStrictEqual(
			{
				heading: true,
				classes: ["gap-1.25"],
				children: ["data-group-name", "data-group-mark", "data-group-caret"],
			},
		);
	});

	it("inks the group mark span with upstream's muted-as-secondary class (fizzy-sidebar-color-inks T4)", async () =>
	{
		localStorage.setItem(
			"ccp-session-groups",
			JSON.stringify(
				{
					groups: [
						{
							id: "cg-a",
							name: "A",
							icon: "star",
						},
					],
					assignments:
					{
						b1: "cg-a",
					},
					order: {},
				},
			),
		);
		const {container} = await renderGroups(FIXTURE);

		expect(container.querySelector('[data-group-key="custom-cg-a"] span[data-group-mark]')?.className).toBe(
			"flex shrink-0 text-[color:var(--muted-as-secondary,var(--color-ink-muted))]",
		);
	});

	it("draws upstream's filled 14px caret, nudged half a pixel down", async () =>
	{
		const {container} = await renderGroups(FIXTURE);
		const caret = container.querySelector('[data-group-key="state-done"] [data-group-caret]');

		expect(
			{
				tag: caret?.tagName.toLowerCase(),
				size: caret?.getAttribute("class")?.split(" ").includes("size-3.5"),
				translate: caret instanceof SVGElement ? caret.style.translate : null,
				lucide: caret?.getAttribute("class")?.includes("lucide") ?? false,
			},
		).toStrictEqual(
			{
				tag: "svg",
				size: true,
				translate: "0px 0.5px",
				lucide: false,
			},
		);
	});

	it("keeps a collapsed section's rows mounted in a hidden wrapper", async () =>
	{
		const {container} = await renderGroups(FIXTURE);

		fireEvent.click(toggleOf(container, "state-done"));

		const wrapper = container.querySelector('[data-group-key="state-done"] [data-group-rows]');
		expect(
			{
				hidden: wrapper?.hasAttribute("hidden"),
				hiddenClass: wrapper?.classList.contains("hidden"),
				rows: [...(wrapper?.querySelectorAll("a[data-row-main-button]") ?? [])].map((link) => rowTitle(link)),
			},
		).toStrictEqual(
			{
				hidden: true,
				hiddenClass: true,
				rows: ["Completed newest", "Completed older"],
			},
		);
	});

	it("gives a manual section upstream's own Group and sort: Date, Status, None, Sort by, Show ▸ Metadata and the footer", async () =>
	{
		seedSections(
			{
				b1: "cg-a",
			},
		);
		const {container} = await renderGroups(FIXTURE);

		const menu = await openSectionMenu(container);
		const top = menuOutline(menu);
		const reset = within(menu).getByRole(
			"menuitem",
			{
				name: "Reset to defaults",
			},
		);
		const resetReason = document.getElementById(reset.getAttribute("aria-describedby") ?? "")?.textContent;
		const groupBy = menuOutline(await openSubmenu(/^Group by/));

		expect(
			{
				top,
				resetDisabled: reset.getAttribute("aria-disabled"),
				resetReason,
				groupBy,
			},
		).toStrictEqual(
			{
				top: [
					"Group byNone",
					"Sort byLast updated",
					"Show",
					"---",
					"New section",
					"---",
					"Reset to defaults",
					"View all",
				],
				resetDisabled: "true",
				resetReason: "Grouping and sorting are already at their defaults.",
				groupBy: ["Date", "Status", "---", "None"],
			},
		);
	});

	it("caps a manual section at 20 rows with a working Show more and Show less", async () =>
	{
		const rows = doneSessions(22);
		seedSections(Object.fromEntries(rows.map((row) => [row.id, "cg-a"])));
		const {container} = await renderGroups(rows);
		expect(rowTitlesIn(container, "custom-cg-a")).toHaveLength(20);

		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Show 2 more in A",
				},
			),
		);
		expect(
			{
				shown: rowTitlesIn(container, "custom-cg-a").length,
				showLess: screen.getAllByRole(
					"button",
					{
						name: "Show less in A",
					},
				).length,
			},
		).toStrictEqual(
			{
				shown: 22,
				showLess: 1,
			},
		);
	});

	it("splits a manual section under its own Date headings, leaving Recents' grouping alone", async () =>
	{
		seedSections(
			{
				d1: "cg-a",
				d2: "cg-a",
				w1: "cg-a",
			},
		);
		const rows = [...FIXTURE.filter((row) => row.id !== "d2"), session("d2", "Completed older", "done", 24 * 60)];
		const {container} = await renderGroups(rows);

		await openSectionMenu(container);
		await openSubmenu(/^Group by/);
		fireEvent.click(
			screen.getByRole(
				"menuitemradio",
				{
					name: "Date",
				},
			),
		);

		await waitFor(() =>
		{
			expect(
				{
					headings: [
						...container.querySelectorAll(
							'[data-group-key="custom-cg-a"] [data-group-key] [data-group-name]',
						),
					].map((node) => node.textContent),
					recents: groupNames(container),
				},
			).toStrictEqual(
				{
					headings: ["Today", "Yesterday"],
					recents: ["Needs input", "Ready for review"],
				},
			);
		});
	});
});

describe("SessionGroups folder order", () =>
{
	const byProject =
	{
		...DEFAULT_SESSION_LIST_PREFS,
		groupBy: "project",
	} as const;

	function inProject(id: string, projectName: string, minutesAgo: number)
	{
		return {
			...session(id, `${projectName} ${id}`, "done", minutesAgo),
			project: `-projects-${projectName}`,
			projectName,
		};
	}

	const THREE = [
		inProject("z1", "zeta", 1),
		inProject("z2", "zeta", 2),
		inProject("b1", "beta", 3),
		inProject("b2", "beta", 4),
		inProject("a1", "alpha", 5),
		inProject("a2", "alpha", 6),
	];

	/** Opens a folder header's menu and returns its edit group: New group… up to the next separator. */
	async function editGroup(label: string): Promise<string[]>
	{
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: `More options for ${label}`,
				},
			),
		);
		const menu = await waitFor(() => screen.getByRole("menu"));
		const outline = [...menu.querySelectorAll('[role="menuitem"], [role="separator"]')].map((node) =>
			node.getAttribute("role") === "separator"
				? "---"
				: `${node.textContent}${node.getAttribute("aria-disabled") === "true" ? " (disabled)" : ""}`,
		);
		const start = outline.indexOf("New group…");
		return outline.slice(start, outline.indexOf("---", start));
	}

	async function choose(name: string): Promise<void>
	{
		fireEvent.click(
			screen.getByRole(
				"menuitem",
				{
					name,
				},
			),
		);
		await waitFor(() =>
		{
			expect(screen.queryByRole("menu")).toBeNull();
		});
	}

	it("moves folders from their header menus into a stored order, and Sort A to Z forgets it", async () =>
	{
		const {container} = await renderGroups(
			THREE,
			{
				prefs: byProject,
			},
		);
		const initial = groupNames(container);
		const betaMenu = await editGroup("beta");
		await choose("Move up");
		const afterMove =
		{
			labels: groupNames(container),
			stored: readProjectOrder(),
		};
		const alphaMenu = await editGroup("alpha");
		await choose("Move down");
		const afterSecondMove = readProjectOrder();
		const zetaMenu = await editGroup("zeta");
		await choose("Sort A to Z");

		expect(
			{
				initial,
				betaMenu,
				afterMove,
				alphaMenu,
				afterSecondMove,
				zetaMenu,
				afterReset:
				{
					labels: groupNames(container),
					raw: localStorage.getItem("ccp-projects-order"),
				},
			},
		).toStrictEqual(
			{
				initial: ["alpha", "beta", "zeta"],
				betaMenu: ["New group…", "Rename (disabled)", "Move up", "Move down"],
				afterMove:
				{
					labels: ["beta", "alpha", "zeta"],
					stored: ["beta", "alpha", "zeta"],
				},
				alphaMenu: ["New group…", "Rename (disabled)", "Move up", "Move down", "Sort A to Z"],
				afterSecondMove: ["beta", "zeta", "alpha"],
				zetaMenu: ["New group…", "Rename (disabled)", "Move up", "Move down", "Sort A to Z"],
				afterReset:
				{
					labels: ["alpha", "beta", "zeta"],
					raw: null,
				},
			},
		);
	});

	it("offers the first folder only Move down, the last only Move up, and a lone folder neither", async () =>
	{
		await renderGroups(
			THREE,
			{
				prefs: byProject,
			},
		);
		const first = await editGroup("alpha");
		cleanup();
		await renderGroups(
			THREE,
			{
				prefs: byProject,
			},
		);
		const last = await editGroup("zeta");
		cleanup();
		await renderGroups(
			[inProject("a1", "alpha", 5)],
			{
				prefs: byProject,
			},
		);

		expect(
			{
				first,
				last,
				lone: await editGroup("alpha"),
			},
		).toStrictEqual(
			{
				first: ["New group…", "Rename (disabled)", "Move down"],
				last: ["New group…", "Rename (disabled)", "Move up"],
				lone: ["New group…", "Rename (disabled)"],
			},
		);
	});
});

/** A `PlaceholderRows` block: its wrapper, label band, and each row's classes and Skeleton bar. */
function describePlaceholder(block: Element | null)
{
	if (block === null) return null;
	return {
		testId: block.getAttribute("data-testid"),
		className: block.getAttribute("class"),
		label: block.querySelector(":scope > [data-placeholder-label]")?.getAttribute("class") ?? null,
		rows: [...block.querySelectorAll<HTMLElement>(":scope > [data-row]")].map((row) =>
		{
			const span = row.firstElementChild;
			const bar = span?.firstElementChild;
			if (!(bar instanceof HTMLElement)) throw new Error("Expected a skeleton bar");
			return {
				className: row.className,
				span: span?.getAttribute("class") ?? null,
				role: bar.getAttribute("role"),
				width: bar.style.width,
				height: bar.style.height,
			};
		}),
	};
}

const PLACEHOLDER_ROW_CLASS =
	"flex h-[var(--sb-row-h)] items-center gap-[var(--sb-row-gap)] pe-[var(--sb-row-px)] ps-[var(--sb-row-px)]";
const PLACEHOLDER_SPAN_CLASS = "flex min-w-0 flex-1 items-center ps-[var(--sb-iconless-pad)]";
const PLACEHOLDER_LABEL_CLASS = "min-h-[calc(var(--sb-group-band-mt)+var(--sb-group-band-h))]";

function placeholderRows(widths: readonly string[])
{
	return widths.map((width) => (
	{
		className: PLACEHOLDER_ROW_CLASS,
		span: PLACEHOLDER_SPAN_CLASS,
		role: "status",
		width,
		height: "var(--sb-row-font)",
	}));
}

describe("sidebar Recents placeholder rows", () =>
{
	const holdFeed = () =>
	{
		vi.stubGlobal(
			"fetch",
			vi.fn<typeof fetch>(async () => new Promise<Response>(() => {})),
		);
	};
	const remember = (recentsRowCount: number) =>
	{
		localStorage.setItem(
			"ccb-sidebar",
			JSON.stringify(
				{
					collapsed: false,
					width: 288,
					collapsedGroups: [],
					collapsedFamilies: [],
					recentsRowCount,
				},
			),
		);
	};

	it("holds a grouped list's remembered Recents rows in upstream's sidebar-recents-placeholder section", async () =>
	{
		holdFeed();
		remember(4);
		const {container} = await renderGroups(
			[],
			{
				unseeded: true,
				loading: true,
			},
		);
		const section = container.querySelector(
			'[data-testid="sidebar-recents"] > [data-testid="sidebar-recents-placeholder"]',
		);
		expect(
			{
				section: section?.getAttribute("class") ?? null,
				block: describePlaceholder(section?.querySelector(":scope > .df-placeholder-rows") ?? null),
				column: container.querySelector('[data-testid="sidebar-column-placeholder"]'),
				pulse: container.querySelectorAll(".animate-pulse").length,
			},
		).toStrictEqual(
			{
				section: "group/section flex flex-col gap-px",
				block:
				{
					testId: "sidebar-rows-skeleton",
					className: "df-placeholder-rows flex flex-col gap-px",
					label: PLACEHOLDER_LABEL_CLASS,
					rows: placeholderRows(["68%", "54%", "44%", "68%"]),
				},
				column: null,
				pulse: 0,
			},
		);
	});

	it("clamps a remembered count to upstream's 21 rows", async () =>
	{
		holdFeed();
		remember(50);
		const {container} = await renderGroups(
			[],
			{
				unseeded: true,
				loading: true,
			},
		);
		expect(container.querySelectorAll('[data-testid="sidebar-rows-skeleton"] > [data-row]').length).toBe(21);
	});

	it("draws upstream's 3-row sidebar-column-placeholder when no Recents count is remembered", async () =>
	{
		holdFeed();
		const {container} = await renderGroups(
			[],
			{
				unseeded: true,
				loading: true,
			},
		);
		expect(
			{
				column: describePlaceholder(
					container.querySelector(
						'[data-testid="sidebar-recents"] > [data-testid="sidebar-column-placeholder"]',
					),
				),
				section: container.querySelector('[data-testid="sidebar-recents-placeholder"]'),
			},
		).toStrictEqual(
			{
				column:
				{
					testId: "sidebar-column-placeholder",
					className: "df-placeholder-rows flex flex-col gap-px group/section",
					label: PLACEHOLDER_LABEL_CLASS,
					rows: placeholderRows(["68%", "54%", "44%"]),
				},
				section: null,
			},
		);
	});

	it("keeps the flat list's Recents header over its placeholder rows, and only the header while Recents is collapsed", async () =>
	{
		holdFeed();
		remember(2);
		const flat = async () =>
		{
			const {container} = await renderGroups(
				[],
				{
					unseeded: true,
					loading: true,
					filterSlot: <button type="button">Group and sort</button>,
					prefs:
					{
						...DEFAULT_SESSION_LIST_PREFS,
						groupBy: "none",
					},
				},
			);
			const recents = container.querySelector('[data-testid="sidebar-recents"]');
			const result =
			{
				header: recents?.querySelector("[data-sidebar-group-label]")?.textContent ?? null,
				block: describePlaceholder(recents?.querySelector(".df-placeholder-rows") ?? null),
				testIds: [...(recents?.querySelectorAll("[data-testid]") ?? [])].map((node) =>
					node.getAttribute("data-testid"),
				),
			};
			cleanup();
			return result;
		};
		const expanded = await flat();
		localStorage.setItem(
			"ccb-sidebar",
			JSON.stringify(
				{
					collapsed: false,
					width: 288,
					collapsedGroups: ["recents"],
					collapsedFamilies: [],
					recentsRowCount: 2,
				},
			),
		);
		const collapsed = await flat();
		expect(
			{
				expanded,
				collapsed,
			},
		).toStrictEqual(
			{
				expanded:
				{
					header: "RecentsGroup and sort",
					block:
					{
						testId: "sidebar-rows-skeleton",
						className: "df-placeholder-rows flex flex-col gap-px",
						label: null,
						rows: placeholderRows(["68%", "54%"]),
					},
					testIds: ["sidebar-rows-skeleton"],
				},
				collapsed:
				{
					header: "RecentsGroup and sort",
					block: null,
					testIds: [],
				},
			},
		);
	});

	it("remembers how many Recents rows the settled list shows", async () =>
	{
		vi.useFakeTimers(
			{
				shouldAdvanceTime: true,
			},
		);
		try
		{
			await renderGroups(FIXTURE);
			act(() =>
			{
				vi.advanceTimersByTime(2000);
			});
			expect(readSidebarState().recentsRowCount).toBe(FIXTURE.length);
		}
		finally
		{
			vi.useRealTimers();
		}
	});

	it("shows upstream's 3-row sidebar-refetch-skeleton instead of the empty body while a new Status refetches a list showing no rows", async () =>
	{
		const prefs =
		{
			...DEFAULT_SESSION_LIST_PREFS,
			groupBy: "state" as const,
		};
		const {container, setPrefs, queryClient} = await renderGroups(
			[],
			{
				prefs,
				loading: true,
			},
		);
		queryClient.removeQueries(
			{
				queryKey: recentSessionsInfiniteQueryOptions(undefined, "all").queryKey,
			},
		);
		await waitFor(() =>
		{
			expect(container.querySelector('[data-group-key="empty"]')).not.toBeNull();
		});
		const feed = stubNextPage([session("a1", "Archived one", "done", 5)], null);
		setPrefs(
			{
				...prefs,
				statusFilter: "all",
			},
		);
		await waitFor(() =>
		{
			expect(feed.requests.length).toBe(1);
		});
		expect(
			{
				skeleton: describePlaceholder(
					container.querySelector(
						'[data-testid="sidebar-recents"] > [data-testid="sidebar-refetch-skeleton"]',
					),
				),
				empty: container.querySelector('[data-group-key="empty"]'),
			},
		).toStrictEqual(
			{
				skeleton:
				{
					testId: "sidebar-refetch-skeleton",
					className: "df-placeholder-rows flex flex-col gap-px",
					label: null,
					rows: placeholderRows(["68%", "54%", "44%"]),
				},
				empty: null,
			},
		);
		feed.respond();
		await screen.findByText("Archived one");
		expect(container.querySelector('[data-testid="sidebar-refetch-skeleton"]')).toBeNull();
	});

	it("keeps the old rows and draws no refetch skeleton while a new Status refetches a non-empty list", async () =>
	{
		const prefs =
		{
			...DEFAULT_SESSION_LIST_PREFS,
			groupBy: "state" as const,
		};
		const {container, setPrefs, queryClient} = await renderGroups(
			FIXTURE,
			{
				prefs,
			},
		);
		queryClient.removeQueries(
			{
				queryKey: recentSessionsInfiniteQueryOptions(undefined, "all").queryKey,
			},
		);
		const feed = stubNextPage([], null);
		setPrefs(
			{
				...prefs,
				statusFilter: "all",
			},
		);
		await waitFor(() =>
		{
			expect(feed.requests.length).toBe(1);
		});
		expect(
			{
				skeleton: container.querySelector('[data-testid="sidebar-refetch-skeleton"]'),
				kept: screen.queryByText("Working one") !== null,
			},
		).toStrictEqual(
			{
				skeleton: null,
				kept: true,
			},
		);
	});
});
