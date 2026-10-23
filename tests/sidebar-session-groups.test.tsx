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
import {SettingsProvider} from "../src/components/settings-provider";
import {ToastProvider} from "../src/components/toast";
import type {ReactNode} from "react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {SessionGroups} from "../src/components/sidebar/session-groups";
import {RecentSessionsResponse, recentSessionsInfiniteQueryOptions} from "../src/lib/api/sessions";
import {DEFAULT_SESSION_LIST_PREFS, type SessionListPrefs} from "../src/lib/session-groups";
import type {SessionBucket} from "../src/lib/session-state";
import {readSidebarState} from "../src/lib/sidebar-store";
import {__unreadStoreTesting, syncUnseenFromSummaries} from "../src/lib/unread-store";
import {installLocalStorage} from "./fake-storage";
import {PIN_STORAGE_KEY} from "../src/lib/pin-store";
import {readFileSync} from "node:fs";

const MINUTE = 60 * 1000;

function session(id: string, title: string, bucket: SessionBucket, minutesAgo: number) {
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

function seedQueryClient(sessions: unknown[], nextCursor: string | null = null): QueryClient {
	const queryClient = new QueryClient({
		defaultOptions: {
			queries: {retry: false, staleTime: Infinity, gcTime: Infinity, refetchOnMount: false},
		},
	});
	queryClient.setQueryData(recentSessionsInfiniteQueryOptions().queryKey, {
		pages: [RecentSessionsResponse.parse({sessions, nextCursor})],
		pageParams: [null],
	});
	return queryClient;
}

async function renderGroups(
	sessions: unknown[],
	options: {
		nextCursor?: string | null;
		filterSlot?: ReactNode;
		unseeded?: boolean;
		activeItemId?: string;
		prefs?: SessionListPrefs;
	} = {},
) {
	const queryClient =
		options.unseeded === true
			? new QueryClient({defaultOptions: {queries: {retry: false}}})
			: seedQueryClient(sessions, options.nextCursor ?? null);
	const rootRoute = createRootRoute({
		component: () => (
			<SettingsProvider>
				<QueryClientProvider client={queryClient}>
					<ToastProvider>
						<SessionGroups
							activeItemId={options.activeItemId ?? null}
							filterSlot={options.filterSlot}
							{...(options.prefs === undefined ? {} : {prefs: options.prefs})}
						/>
						<Outlet />
					</ToastProvider>
				</QueryClientProvider>
			</SettingsProvider>
		),
	});
	const homeRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "/",
		component: () => null,
	});
	const sessionRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "/session/$id",
		component: () => null,
	});
	const router = createRouter({
		routeTree: rootRoute.addChildren([homeRoute, sessionRoute]),
		history: createMemoryHistory({initialEntries: ["/"]}),
	});
	await router.load();
	const result = render(<RouterProvider router={router} />);
	await waitFor(() => {
		expect(result.container.querySelector("[data-group-toggle], [role=alert]")).toBeTruthy();
	});
	return result;
}

function groupNames(container: HTMLElement): string[] {
	return [...container.querySelectorAll('[data-testid="sidebar-recents"] [data-group-name]')].map(
		(node) => node.textContent,
	);
}

function rowTitlesIn(container: HTMLElement, groupKey: string): string[] {
	const section = container.querySelector(`[data-group-key="${groupKey}"]`);
	if (!(section instanceof HTMLElement)) return [];
	return [...section.querySelectorAll("a[data-row-main-button]")].map((link) => link.textContent);
}

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

beforeEach(() => {
	installLocalStorage();
});

describe("sidebar SessionGroups", () => {
	it("renders the state groups in upstream order with their rows", async () => {
		const {container} = await renderGroups(FIXTURE);

		expect(groupNames(container)).toEqual(["Needs input", "Ready for review", "Working", "Completed"]);
		expect({
			blocked: rowTitlesIn(container, "state-blocked"),
			review: rowTitlesIn(container, "state-review"),
			working: rowTitlesIn(container, "state-working"),
			done: rowTitlesIn(container, "state-done"),
		}).toEqual({
			blocked: ["Blocked one"],
			review: ["Review one"],
			working: ["Working one"],
			done: ["Completed newest", "Completed older"],
		});
	});

	it("ends each group with the upstream 10px gap before the next header (wrapper pb 4px plus label centering)", async () => {
		const {container} = await renderGroups(FIXTURE);
		const css = readFileSync("src/styles/globals.css", "utf8");

		expect({
			token: /--sb-group-pb: (\d+px);/.exec(css)?.[1],
			sections: [...container.querySelectorAll("[data-group-key^=state-]")].map((section) =>
				section.classList.contains("pb-[var(--sb-group-pb)]"),
			),
		}).toStrictEqual({token: "10px", sections: [true, true, true, true]});
	});

	it("omits empty groups", async () => {
		const {container} = await renderGroups([
			session("w1", "Working one", "working", 1),
			session("d1", "Completed one", "done", 5),
		]);

		expect(groupNames(container)).toEqual(["Working", "Completed"]);
	});

	it("shows each row's session title with its trailing state mark beside the link", async () => {
		await renderGroups(FIXTURE);

		const rowOf = (name: RegExp) => {
			const row = screen.getByRole("link", {name}).closest<HTMLElement>("[data-session-actions]");
			if (row === null) throw new Error(`no row ${String(name)}`);
			return row;
		};
		// The mark sits beside the link, as upstream's row decoration does, so the link reads as the title.
		const blocked = screen.getByRole("link", {name: "Blocked one"});
		expect({
			href: blocked.getAttribute("href"),
			blocked: within(rowOf(/^Blocked one$/)).getByRole("status").textContent,
			working: within(rowOf(/^Working one$/)).getByRole("status").textContent,
			settled: {
				mark: within(rowOf(/^Completed older$/)).queryByRole("img"),
				env: rowOf(/^Completed older$/)
					.querySelector("[data-env-glyph]")
					?.getAttribute("aria-hidden"),
			},
			project: screen.queryByText("project-b1"),
		}).toStrictEqual({
			href: "/session/b1",
			blocked: "Awaiting input",
			working: "Running",
			settled: {mark: null, env: "true"},
			project: null,
		});
	});

	it("styles the row kebab like upstream: radius 6 (r5), ink, no hover background of its own", async () => {
		await renderGroups(FIXTURE);

		const classes = screen.getByRole("button", {name: "More options for Working one"}).className.split(" ");
		expect({
			radius: classes.filter((token) => token.startsWith("rounded")),
			ink: classes.filter((token) => /^text-(primary|secondary|ink-muted|muted)$/.test(token)),
			hoverBg: classes.filter((token) => token.startsWith("hover:bg")),
		}).toStrictEqual({radius: ["rounded-r5"], ink: ["text-primary"], hoverBg: []});
	});

	it("collapses a group, persists it in the sidebar store, and restores it on remount", async () => {
		const first = await renderGroups(FIXTURE);
		const toggle = screen.getByRole("button", {name: "Working"});
		expect(toggle.getAttribute("aria-expanded")).toBe("true");

		fireEvent.click(toggle);

		expect(toggle.getAttribute("aria-expanded")).toBe("false");
		expect(screen.queryByRole("link", {name: /Working one/})).toBeNull();
		expect(readSidebarState().collapsedGroups).toEqual(["state-working"]);

		first.unmount();
		await renderGroups(FIXTURE);

		const remounted = screen.getByRole("button", {name: "Working"});
		expect(remounted.getAttribute("aria-expanded")).toBe("false");
		expect(screen.queryByRole("link", {name: /Working one/})).toBeNull();

		fireEvent.click(remounted);

		expect(remounted.getAttribute("aria-expanded")).toBe("true");
		expect(screen.getByRole("link", {name: /Working one$/})).toBeTruthy();
		expect(readSidebarState().collapsedGroups).toEqual([]);
	});

	it("caps Completed at 20 rows, expands the rest from Show N more, and folds them back with Show less", async () => {
		const done = Array.from({length: 23}, (_, index) => session(`d${index}`, `Done ${index}`, "done", index + 1));
		const {container} = await renderGroups(done);

		expect(rowTitlesIn(container, "state-done")).toHaveLength(20);
		const showMore = screen.getByRole("button", {name: "Show 3 more in Completed"});
		expect(showMore.textContent).toBe("Show 3 more");

		fireEvent.click(showMore);

		expect(rowTitlesIn(container, "state-done")).toEqual(Array.from({length: 23}, (_, index) => `Done ${index}`));
		expect(screen.queryByRole("button", {name: /^Show \d+ more/})).toBeNull();
		const showLess = screen.getByRole("button", {name: "Show less in Completed"});
		expect({text: showLess.textContent, roving: showLess.hasAttribute("data-roving-item")}).toStrictEqual({
			text: "Show less",
			roving: true,
		});

		fireEvent.click(showLess);

		expect(rowTitlesIn(container, "state-done")).toHaveLength(20);
		expect(screen.getByRole("button", {name: "Show 3 more in Completed"})).toBeTruthy();
		expect(screen.queryByRole("button", {name: /^Show less/})).toBeNull();
	});

	it("offers no Show less on a group that fits under the cap", async () => {
		await renderGroups(FIXTURE);
		expect(screen.queryByRole("button", {name: /^Show less/})).toBeNull();
	});

	it("puts the filter slot on every group header, as upstream puts Group and sort on each section", async () => {
		const {container} = await renderGroups(
			[session("w1", "Working one", "working", 1), session("d1", "Completed one", "done", 5)],
			{filterSlot: <button type="button">Filter</button>},
		);

		const headers = [...container.querySelectorAll('[data-testid="sidebar-recents"] [data-sidebar-group-label]')];
		expect(headers.map((header) => within(header as HTMLElement).queryAllByText("Filter").length)).toEqual([1, 1]);
		expect(within(headers[0] as HTMLElement).getByRole("button", {name: "Working"})).toBeTruthy();
	});

	it("draws each row's status in upstream's trailing slot, with no leading glyph, the env laptop on a settled row", async () => {
		__unreadStoreTesting.reset();
		syncUnseenFromSummaries(FIXTURE.map(({id, unseen}) => ({id, unseen})));
		const {container} = await renderGroups(FIXTURE);
		const rowOf = (title: string) => {
			const link = [...container.querySelectorAll<HTMLElement>("a[data-row-main-button]")].find((node) =>
				node.textContent.includes(title),
			);
			if (link === undefined) throw new Error(`no row ${title}`);
			return link;
		};
		const describeRow = (title: string) => {
			const link = rowOf(title);
			const decoration = link.closest("[data-session-actions]")?.querySelector("[data-row-decoration]");
			const mark = decoration?.querySelector("[role=status], [role=img]");
			return {
				leading: link.querySelector(".df-leading-slot") !== null,
				mark:
					mark === null || mark === undefined
						? null
						: [mark.getAttribute("role"), mark.getAttribute("aria-label")],
				env: decoration?.querySelector("[data-env-glyph]")?.getAttribute("data-env-glyph") ?? null,
				hidesOnHover: decoration?.className.split(" ").includes("group-hover/session-row:opacity-0") ?? false,
				flushRight: decoration?.className.split(" ").includes("right-[var(--sb-row-ctl-inset)]") ?? false,
			};
		};
		expect({
			blocked: describeRow("Blocked one"),
			working: describeRow("Working one"),
			review: describeRow("Review one"),
			done: describeRow("Completed newest"),
		}).toStrictEqual({
			blocked: {
				leading: false,
				mark: ["status", "Awaiting input"],
				env: null,
				hidesOnHover: true,
				flushRight: true,
			},
			working: {leading: false, mark: ["status", "Running"], env: null, hidesOnHover: true, flushRight: true},
			review: {
				leading: false,
				mark: ["status", "Unread response"],
				env: null,
				hidesOnHover: true,
				flushRight: true,
			},
			done: {leading: false, mark: null, env: "bridge", hidesOnHover: true, flushRight: true},
		});
	});

	it("draws upstream's bridge env glyph on the icon, LaptopSlash when offline, and none on pinned rows or under project grouping", async () => {
		const rows = [
			session("d1", "Live bridged", "done", 5),
			{...session("d2", "Offline bridged", "done", 6), remoteControl: true, state: "ended"},
			{...session("d3", "Live remote", "done", 7), remoteControl: true},
			session("p1", "Pinned one", "done", 8),
		];
		const describeEnv = (container: HTMLElement) =>
			Object.fromEntries(
				[...container.querySelectorAll<HTMLElement>("a[data-row-main-button]")].map((link) => {
					const glyph = link
						.closest("[data-session-actions]")
						?.querySelector("[data-row-decoration] [data-env-glyph]");
					return [
						link.textContent,
						glyph === null || glyph === undefined
							? null
							: {
									tag: glyph.tagName.toLowerCase(),
									kind: glyph.getAttribute("data-env-glyph"),
									offline: glyph.hasAttribute("data-env-offline"),
									wrapper: glyph.parentElement?.getAttribute("class") ?? null,
									wrapperHidden: glyph.parentElement?.getAttribute("aria-hidden") ?? null,
									slash: glyph.querySelector('path[d="m2 2 20 20"]') !== null,
								},
					];
				}),
			);
		const wrapper = "flex size-[var(--sb-row-ctl)] shrink-0 items-center justify-center";
		const live = {tag: "svg", kind: "bridge", offline: false, wrapper, wrapperHidden: "true", slash: false};

		localStorage.setItem(PIN_STORAGE_KEY, JSON.stringify({pinnedIds: ["p1"], pinnedOrder: ["p1"]}));
		const byProject = describeEnv(
			(await renderGroups(rows, {prefs: {...DEFAULT_SESSION_LIST_PREFS, groupBy: "project"}})).container,
		);
		cleanup();
		const byState = describeEnv((await renderGroups(rows)).container);
		localStorage.removeItem(PIN_STORAGE_KEY);

		expect({byState, byProject}).toStrictEqual({
			byState: {
				"Pinned one": null,
				"Live bridged": live,
				"Offline bridged": {...live, offline: true, slash: true},
				"Live remote": live,
			},
			byProject: {
				"Pinned one": null,
				"Live bridged": null,
				"Offline bridged": null,
				"Live remote": null,
			},
		});
	});

	it("draws a PR as upstream's title tail inside the link, beside the env glyph or status mark, only while Show PR status is on", async () => {
		const withPr = [
			{...session("d1", "Completed newest", "done", 5), prStatus: {number: 8, state: "open"}},
			{...session("u1", "Unread with PR", "done", 6), unseen: true, prStatus: {number: 9, state: "merged"}},
			session("d2", "Completed older", "done", 30),
		];
		const describeRows = (container: HTMLElement) =>
			[...container.querySelectorAll<HTMLElement>("a[data-row-main-button]")].map((link) => {
				const decoration = link.closest("[data-session-actions]")?.querySelector("[data-row-decoration]");
				const tail = link.lastElementChild;
				return {
					title: link.textContent,
					tail: link.querySelector("[data-pr-glyph]")?.getAttribute("data-pr-glyph") ?? null,
					tailSlot: tail?.getAttribute("class") ?? null,
					tailInSlot: tail?.querySelector("[data-pr-glyph]") !== null,
					label: link.querySelector("[data-row-label]")?.getAttribute("class") ?? null,
					mark: decoration?.querySelector("[role=status]")?.getAttribute("aria-label") ?? null,
					env: decoration?.querySelector("[data-env-glyph]") !== null,
				};
			});
		const slot =
			"shrink-0 flex items-center gap-1.5 text-xs text-ink-muted me-[calc(var(--sb-row-ctl-inset)+var(--sb-row-ctl)-var(--sb-row-px))]";
		const label = "min-w-0 flex-1 ps-2";

		__unreadStoreTesting.reset();
		syncUnseenFromSummaries(withPr.map(({id, unseen}) => ({id, unseen})));
		localStorage.setItem(
			"ccp-session-list-prefs",
			JSON.stringify({...DEFAULT_SESSION_LIST_PREFS, showPrStatus: true}),
		);
		const shown = describeRows((await renderGroups(withPr)).container);
		cleanup();
		localStorage.removeItem("ccp-session-list-prefs");
		const hidden = describeRows((await renderGroups(withPr)).container).map(({tail}) => tail);

		expect({shown, hidden}).toStrictEqual({
			shown: [
				{
					title: "Completed newest",
					tail: "opened",
					tailSlot: slot,
					tailInSlot: true,
					label,
					mark: null,
					env: true,
				},
				{
					title: "Unread with PR",
					tail: "merged",
					tailSlot: slot,
					tailInSlot: true,
					label,
					mark: "Unread response",
					env: false,
				},
				{title: "Completed older", tail: null, tailSlot: slot, tailInSlot: false, label, mark: null, env: true},
			],
			hidden: [null, null, null],
		});
	});

	it("keeps the touch kebab only on the current session's row and the status mark on every other row, as upstream's data-touch-menu", async () => {
		const {container} = await renderGroups(FIXTURE, {activeItemId: "w1"});
		const rows = [...container.querySelectorAll<HTMLElement>("[data-session-actions]")];
		const decoration = rows[0]?.querySelector("[data-row-decoration]");

		expect({
			touchMenu: rows
				.filter((row) => row.hasAttribute("data-touch-menu"))
				.map((row) => row.querySelector("a[data-row-main-button]")?.textContent),
			decorationHiddenOnTouch: decoration?.className.split(" ").includes("pointer-coarse:opacity-0"),
			kebabShownOnTouch: rows[0]
				?.querySelector("[data-row-action]")
				?.className.split(" ")
				.includes("pointer-coarse:opacity-100"),
		}).toStrictEqual({touchMenu: ["Working one"], decorationHiddenOnTouch: false, kebabShownOnTouch: false});
	});

	it("announces each row's status and environment in upstream's two sr-only siblings", async () => {
		const srOnlyOf = (name: RegExp) => {
			const row = screen.getByRole("link", {name}).closest<HTMLElement>("[data-session-actions]");
			if (row === null) throw new Error(`no row ${String(name)}`);
			return [...row.querySelectorAll(".sr-only:not([data-row-main-button] *)")].map((node) => [
				node.getAttribute("role"),
				node.textContent,
			]);
		};
		const environments = () =>
			Object.fromEntries(FIXTURE.map((row) => [row.id, srOnlyOf(new RegExp(`^${row.title}$`))[1]?.[1] ?? null]));
		const terminalHosts: Record<string, string> = {b1: "herdr", w1: "herdr · later", r1: "tmux · work"};
		const withHost = (row: (typeof FIXTURE)[number]) =>
			row.id in terminalHosts ? {...row, terminalHost: terminalHosts[row.id]} : row;
		const bridged = new Set(["b1", "r1", "d1"]);
		await renderGroups(
			FIXTURE.map((row) => ({
				...withHost(row),
				...(bridged.has(row.id) ? {remoteControl: true} : {}),
				...(row.id === "d1" ? {state: "ended"} : {}),
			})),
		);
		const first = {awaiting: srOnlyOf(/^Blocked one$/), idle: srOnlyOf(/^Completed older$/), env: environments()};
		cleanup();
		await renderGroups(
			FIXTURE.map((row) => (row.id === "w1" ? {...withHost(row), remoteControl: true} : withHost(row))),
		);

		expect({first, second: environments()}).toStrictEqual({
			first: {
				awaiting: [
					["status", "Awaiting input"],
					[null, " herdr · Remote Control · Connected"],
				],
				idle: [
					["status", ""],
					[null, " Local"],
				],
				env: {
					d1: " Local · Remote Control · Offline",
					w1: " herdr · later",
					r1: " tmux · work · Remote Control · Connected",
					b1: " herdr · Remote Control · Connected",
					d2: " Local",
				},
			},
			second: {
				d1: " Local",
				w1: " herdr · later · Remote Control · Connected",
				r1: " tmux · work",
				b1: " herdr",
				d2: " Local",
			},
		});
	});

	it("shows upstream's Couldn’t load your sessions alert with Try again when the list fails to load", async () => {
		const fetchMock = vi.fn<typeof fetch>(async () => Promise.reject(new Error("offline")));
		vi.stubGlobal("fetch", fetchMock);
		await renderGroups([], {unseeded: true});
		const message = await screen.findByText("Couldn’t load your sessions");
		const alert = message.closest<HTMLElement>("[role=alert]");
		if (alert === null) throw new Error("Expected the load failure to be an alert");
		const callsBefore = fetchMock.mock.calls.length;
		fireEvent.click(within(alert).getByRole("button", {name: "Try again"}));
		await waitFor(() => {
			expect(fetchMock.mock.calls.length).toBeGreaterThan(callsBefore);
		});
		vi.unstubAllGlobals();
	});

	it("has no Load more sessions row, even while the feed has another page", async () => {
		await renderGroups(FIXTURE, {nextCursor: "cursor-2"});
		expect(screen.queryByRole("button", {name: "Load more sessions"})).toBeNull();
	});

	it("fetches the next page when the list end scrolls into view and no group is capped", async () => {
		class VisibleIntersectionObserver {
			constructor(private readonly callback: IntersectionObserverCallback) {}
			observe(target: Element) {
				this.callback(
					[{isIntersecting: true, target} as IntersectionObserverEntry],
					this as unknown as IntersectionObserver,
				);
			}
			disconnect() {}
			unobserve() {}
			takeRecords(): IntersectionObserverEntry[] {
				return [];
			}
		}
		vi.stubGlobal("IntersectionObserver", VisibleIntersectionObserver);
		const requests: string[] = [];
		vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
			requests.push(String(input));
			return Promise.resolve(
				new Response(
					JSON.stringify({sessions: [session("d-old", "Completed next page", "done", 60)], nextCursor: null}),
					{status: 200, headers: {"Content-Type": "application/json"}},
				),
			);
		});
		const {container} = await renderGroups(FIXTURE, {nextCursor: "cursor-2"});

		await waitFor(() => {
			expect(rowTitlesIn(container, "state-done")).toStrictEqual([
				"Completed newest",
				"Completed older",
				"Completed next page",
			]);
		});
		expect(requests).toStrictEqual(["/api/sessions/recent?limit=50&cursor=cursor-2&live=1"]);
	});

	it("fetches the next page when Show N more expands the last capped group", async () => {
		const done = Array.from({length: 23}, (_, index) => session(`d${index}`, `Done ${index}`, "done", index + 1));
		const older = session("d-old", "Done older page", "done", 60);
		const requests: string[] = [];
		vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
			requests.push(String(input));
			return Promise.resolve(
				new Response(JSON.stringify({sessions: [older], nextCursor: null}), {
					status: 200,
					headers: {"Content-Type": "application/json"},
				}),
			);
		});
		const {container} = await renderGroups(done, {nextCursor: "cursor-2"});

		fireEvent.click(screen.getByRole("button", {name: "Show 3 more in Completed"}));

		await waitFor(() => {
			expect(rowTitlesIn(container, "state-done")).toHaveLength(24);
		});
		expect(rowTitlesIn(container, "state-done").at(-1)).toBe("Done older page");
		expect(requests).toStrictEqual(["/api/sessions/recent?limit=50&cursor=cursor-2&live=1"]);
		expect(screen.getByRole("button", {name: "Show less in Completed"})).toBeTruthy();
	});
});

describe("SessionGroups hover cards", () => {
	async function hoverRow(container: HTMLElement, title: string) {
		const link = [...container.querySelectorAll("a[data-row-main-button]")].find(
			(node) => node.textContent === title,
		);
		const trigger = link?.closest("[data-hover-card-trigger]");
		if (!(trigger instanceof HTMLElement)) throw new Error(`no row ${title}`);
		fireEvent.pointerEnter(trigger, {pointerType: "mouse"});
		fireEvent.mouseEnter(trigger);
		fireEvent.mouseMove(trigger);
		return waitFor(() => {
			const card = document.querySelector("[data-session-hover-card]");
			if (!(card instanceof HTMLElement)) throw new Error("no card");
			return card;
		});
	}

	it("previews a completed row's title and summary", async () => {
		const {container} = await renderGroups([
			{...session("d1", "Completed newest", "done", 5), summary: "Shipped the parser."},
		]);
		const card = await hoverRow(container, "Completed newest");
		expect({
			kind: card.getAttribute("data-kind"),
			title: card.querySelector("[data-card-title]")?.textContent,
			summary: card.querySelector("[data-card-summary]")?.textContent,
		}).toStrictEqual({
			kind: "other",
			title: "Completed newest",
			summary: "Shipped the parser.",
		});
	});

	it("opens the blocked card on a Needs input row", async () => {
		const {container} = await renderGroups([session("b1", "Blocked one", "blocked", 3)]);
		const card = await hoverRow(container, "Blocked one");
		expect(card.getAttribute("data-kind")).toBe("blocked");
	});
});
