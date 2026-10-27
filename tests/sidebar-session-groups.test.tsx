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
import {SettingsProvider} from "../src/components/settings-provider";
import {ToastProvider} from "../src/components/toast";
import type {ReactNode} from "react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {SessionGroups} from "../src/components/sidebar/session-groups";
import {ProjectListResponse, projectsQueryOptions} from "../src/lib/api/projects";
import {RecentSessionsResponse, recentSessionsInfiniteQueryOptions} from "../src/lib/api/sessions";
import {takePendingHomeLaunchFolder} from "../src/lib/home-composer-focus";
import {DEFAULT_SESSION_LIST_PREFS, type SessionListPrefs} from "../src/lib/session-groups";
import type {SessionBucket} from "../src/lib/session-state";
import {readSidebarState} from "../src/lib/sidebar-store";
import {__unreadStoreTesting, syncUnseenFromSummaries} from "../src/lib/unread-store";
import {installLocalStorage} from "./fake-storage";
import {PIN_STORAGE_KEY} from "../src/lib/pin-store";
import {readFileSync} from "node:fs";
import {rowTitle} from "./sidebar-row-title";

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
		projects?: unknown[];
		initialPath?: string;
	} = {},
) {
	const queryClient =
		options.unseeded === true
			? new QueryClient({defaultOptions: {queries: {retry: false}}})
			: seedQueryClient(sessions, options.nextCursor ?? null);
	if (options.projects !== undefined) {
		queryClient.setQueryData(projectsQueryOptions().queryKey, ProjectListResponse.parse(options.projects));
	}
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
		history: createMemoryHistory({initialEntries: [options.initialPath ?? "/"]}),
	});
	await router.load();
	const result = render(<RouterProvider router={router} />);
	await waitFor(() => {
		expect(result.container.querySelector("[data-group-toggle], [role=alert]")).toBeTruthy();
	});
	return {...result, queryClient, router};
}

function groupNames(container: HTMLElement): string[] {
	return [...container.querySelectorAll('[data-testid="sidebar-recents"] [data-group-name]')].map(
		(node) => node.textContent,
	);
}

function toggleOf(container: HTMLElement, key: string): HTMLElement {
	const toggle = container.querySelector(`[data-group-key="${key}"] [data-group-toggle]`);
	if (!(toggle instanceof HTMLElement)) throw new Error(`no ${key} toggle`);
	return toggle;
}

function rowTitlesIn(container: HTMLElement, groupKey: string): string[] {
	const section = container.querySelector(`[data-group-key="${groupKey}"]`);
	if (!(section instanceof HTMLElement)) return [];
	return [...section.querySelectorAll("a[data-row-main-button]")].map((link) => rowTitle(link));
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

	// Upstream: name centre -> first row top 16px (no label gap), section bottom = last row bottom + 2px stack gap.
	it("bands each section as upstream's df-session-list: a fixed row-height label flush on its rows, a stack-gap bottom pad", async () => {
		const {container} = await renderGroups(FIXTURE);
		const css = readFileSync("src/styles/globals.css", "utf8");

		expect({
			token: /--sb-group-pb: ([^;]+);/.exec(css)?.[1],
			sections: [...container.querySelectorAll("[data-group-key^=state-]")].map(
				(section) =>
					section.classList.contains("pb-[var(--sb-group-pb)]") &&
					![...section.classList].some((name) => name.startsWith("gap-")),
			),
			labels: [...container.querySelectorAll("[data-group-key^=state-] > [data-sidebar-group-label]")].map(
				(label) => ({
					fixedBand: label.classList.contains("h-[var(--sb-group-band-h)]"),
					minHeight: [...label.classList].some((name) => name.startsWith("min-h-")),
				}),
			),
		}).toStrictEqual({
			token: "var(--sb-row-stack-gap)",
			sections: [true, true, true, true],
			labels: Array.from({length: 4}, () => ({fixedBand: true, minHeight: false})),
		});
	});

	it("omits empty groups", async () => {
		const {container} = await renderGroups([
			session("w1", "Working one", "working", 1),
			session("d1", "Completed one", "done", 5),
		]);

		expect(groupNames(container)).toEqual(["Working", "Completed"]);
	});

	it("shows each row's session title with its trailing state mark beside the link and its status text inside it", async () => {
		await renderGroups(FIXTURE);

		const rowOf = (name: RegExp) => {
			const row = screen.getByRole("link", {name}).closest<HTMLElement>("[data-session-actions]");
			if (row === null) throw new Error(`no row ${String(name)}`);
			return row;
		};
		// The mark sits beside the link, as upstream's row decoration does; its sr text is inside the title.
		const blocked = screen.getByRole("link", {name: /^Blocked one/});
		expect({
			href: blocked.getAttribute("href"),
			blocked: within(blocked).getByRole("status").textContent,
			working: within(rowOf(/^Working one/)).getByRole("status").textContent,
			settled: {
				mark: within(rowOf(/^Completed older/)).queryByRole("img"),
				env: rowOf(/^Completed older/)
					.querySelector("[data-env-glyph]")
					?.getAttribute("aria-hidden"),
			},
			project: screen.queryByText("project-b1"),
		}).toStrictEqual({
			href: "/session/b1",
			blocked: " Awaiting input",
			working: " Running",
			settled: {mark: null, env: "true"},
			project: null,
		});
	});

	it("describes a Needs input row with upstream's sr-only quick-reply hint, and no other row", async () => {
		await renderGroups(FIXTURE);

		const hintOf = (name: RegExp) => {
			const link = screen.getByRole("link", {name});
			const id = link.getAttribute("aria-describedby");
			if (id === null) return null;
			const hint = document.getElementById(id);
			return {
				text: hint?.textContent,
				className: hint?.className,
				findOmitted: hint?.hasAttribute("data-find-omitted"),
			};
		};
		expect({blocked: hintOf(/^Blocked one/), working: hintOf(/^Working one/)}).toStrictEqual({
			blocked: {
				text: "Quick reply and approval controls available — press Tab until focus enters the card, Escape to return.",
				className: "sr-only select-none",
				findOmitted: true,
			},
			working: null,
		});
	});

	it("styles the row kebab like upstream: radius 6 (r5), text-secondary until hovered or expanded, instant reveal", async () => {
		await renderGroups(FIXTURE);

		const classes = screen.getByRole("button", {name: "More options for Working one"}).className.split(" ");
		expect({
			radius: classes.filter((token) => token.startsWith("rounded")),
			ink: classes.filter((token) =>
				/^(hover:|aria-expanded:)?text-(primary|secondary|ink-muted|muted)$/.test(token),
			),
			hoverBg: classes.filter((token) => token.startsWith("hover:bg")),
			transition: classes.filter((token) => token.startsWith("transition")),
		}).toStrictEqual({
			radius: ["rounded-r5"],
			ink: ["text-secondary", "hover:text-primary", "aria-expanded:text-primary"],
			hoverBg: [],
			transition: [],
		});
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

		// The collapsed toggle carries the hidden Working row's badge, which joins its name.
		const remounted = screen.getByRole("button", {name: /^Working/});
		expect(remounted.getAttribute("aria-expanded")).toBe("false");
		expect(screen.queryByRole("link", {name: /Working one/})).toBeNull();

		fireEvent.click(remounted);

		expect(remounted.getAttribute("aria-expanded")).toBe("true");
		expect(screen.getByRole("link", {name: /^Working one/})).toBeTruthy();
		expect(readSidebarState().collapsedGroups).toEqual([]);
	});

	// Upstream `SH`/`sP`: a collapsed header is `data-rowless` and carries `[data-group-badge]` with the most urgent hidden state.
	it("badges a collapsed header with its hidden rows' most urgent state and marks it rowless", async () => {
		const rows = [
			session("d1", "Done read", "done", 5),
			{...session("d2", "Done unread", "done", 6), unseen: true},
			session("d3", "Done read too", "done", 7),
			session("w1", "Working one", "working", 1),
		];
		__unreadStoreTesting.reset();
		syncUnseenFromSummaries(rows.map(({id, unseen}) => ({id, unseen})));
		const {container} = await renderGroups(rows);
		const header = (key: string) => {
			const label = container.querySelector(`[data-group-key="${key}"] > [data-sidebar-group-label]`);
			if (!(label instanceof HTMLElement)) throw new Error(`no ${key} header`);
			return label;
		};
		const snapshot = (key: string) => {
			const label = header(key);
			const badge = label.querySelector("[data-group-toggle] > [data-group-badge]");
			return {
				rowless: label.getAttribute("data-rowless"),
				rowlessGap: label.classList.contains("data-[rowless]:mb-[var(--sb-row-stack-gap)]"),
				badgeClass: badge?.getAttribute("class") ?? null,
				badge: [...(badge?.querySelectorAll("[role=img]") ?? [])].map((mark) =>
					mark.getAttribute("aria-label"),
				),
			};
		};

		expect(snapshot("state-done")).toEqual({rowless: null, rowlessGap: true, badgeClass: null, badge: []});

		fireEvent.click(within(header("state-done")).getByRole("button", {name: /^Completed/}));
		fireEvent.click(within(header("state-working")).getByRole("button", {name: /^Working/}));

		expect({done: snapshot("state-done"), working: snapshot("state-working")}).toEqual({
			done: {
				rowless: "",
				rowlessGap: true,
				badgeClass: "-my-1 ms-auto flex size-6 shrink-0 items-center justify-center",
				badge: ["Unread response"],
			},
			working: {
				rowless: "",
				rowlessGap: true,
				badgeClass: "-my-1 ms-auto flex size-6 shrink-0 items-center justify-center",
				badge: ["Running"],
			},
		});
	});

	it("leaves a collapsed header unbadged when every hidden row is settled and read", async () => {
		const rows = [session("d1", "Done read", "done", 5), session("d2", "Done read too", "done", 6)];
		__unreadStoreTesting.reset();
		syncUnseenFromSummaries(rows.map(({id, unseen}) => ({id, unseen})));
		const {container} = await renderGroups(rows);

		fireEvent.click(screen.getByRole("button", {name: "Completed"}));

		const label = container.querySelector('[data-group-key="state-done"] > [data-sidebar-group-label]');
		expect({
			rowless: label?.getAttribute("data-rowless"),
			badges: label?.querySelectorAll("[data-group-badge]").length,
		}).toEqual({rowless: "", badges: 0});
	});

	it("pages Completed 5 rows per Show more click, announcing each page, and folds back to 5 with Show less", async () => {
		const done = Array.from({length: 45}, (_, index) => session(`d${index}`, `Done ${index}`, "done", index + 1));
		const {container} = await renderGroups(done);
		const overflowRows = () =>
			[...container.querySelectorAll('[data-group-key="state-done"] button[data-row]')].map((button) => ({
				text: button.textContent,
				label: button.getAttribute("aria-label"),
			}));
		const status = () =>
			container.querySelector('[data-group-key="state-done"] [data-group-rows] > span[role="status"]');

		const showMore = screen.getByRole("button", {name: "Show 5 more in Completed"});
		expect({
			shown: rowTitlesIn(container, "state-done").length,
			overflow: overflowRows(),
			roving: showMore.hasAttribute("data-roving-item"),
			labelClass: showMore.querySelector("span")?.className,
			leadingSlot: showMore.querySelector(".df-leading-slot"),
			status: {className: status()?.className, text: status()?.textContent},
		}).toStrictEqual({
			shown: 5,
			overflow: [{text: "Show more", label: "Show 5 more in Completed"}],
			roving: true,
			labelClass: "ps-[var(--sb-iconless-pad)]",
			leadingSlot: null,
			status: {className: "sr-only", text: ""},
		});

		fireEvent.click(showMore);
		expect({shown: rowTitlesIn(container, "state-done").length, status: status()?.textContent}).toStrictEqual({
			shown: 10,
			status: "Showing 5 more in Completed",
		});

		fireEvent.click(screen.getByRole("button", {name: "Show 5 more in Completed"}), {detail: 2});
		expect(rowTitlesIn(container, "state-done")).toHaveLength(10);

		for (let click = 0; click < 7; click++) {
			fireEvent.click(screen.getByRole("button", {name: "Show 5 more in Completed"}));
		}
		expect({shown: rowTitlesIn(container, "state-done"), overflow: overflowRows()}).toStrictEqual({
			shown: Array.from({length: 45}, (_, index) => `Done ${index}`),
			overflow: [{text: "Show less", label: "Show less in Completed"}],
		});

		fireEvent.click(screen.getByRole("button", {name: "Show less in Completed"}));

		expect({
			shown: rowTitlesIn(container, "state-done").length,
			overflow: overflowRows(),
			status: status()?.textContent,
		}).toStrictEqual({
			shown: 5,
			overflow: [{text: "Show more", label: "Show 5 more in Completed"}],
			status: "Showing less in Completed",
		});
	});

	it("puts an awaiting dot at the end of Show more while a hidden row needs input", async () => {
		const rows = Array.from({length: 7}, (_, index) =>
			session(`r${index}`, `Row ${index}`, index === 6 ? "blocked" : "done", index + 1),
		);
		const {container} = await renderGroups(rows, {prefs: {...DEFAULT_SESSION_LIST_PREFS, groupBy: "none"}});

		const showMore = screen.getByRole("button", {name: "Show 2 more in Recents"});
		const trailing = showMore.querySelector("span.ms-auto");
		expect({
			text: showMore.textContent,
			trailingClass: trailing?.className,
			dot: trailing?.querySelector('[role="img"]')?.getAttribute("aria-label"),
		}).toStrictEqual({
			text: "Show more",
			trailingClass: "ms-auto flex size-[var(--sb-row-ctl)] shrink-0 items-center justify-center",
			dot: "Awaiting input",
		});
		expect(container.querySelectorAll('[data-group-key="recents"] button[data-row] span.ms-auto')).toHaveLength(1);
	});

	it("holds Show less, described and ignoring clicks, while folding back would hide the open session", async () => {
		const done = Array.from({length: 12}, (_, index) => session(`d${index}`, `Done ${index}`, "done", index + 1));
		const {container} = await renderGroups(done, {activeItemId: "d10"});
		fireEvent.click(screen.getByRole("button", {name: "Show 5 more in Completed"}));
		fireEvent.click(screen.getByRole("button", {name: "Show 2 more in Completed"}));

		const showLess = screen.getByRole("button", {name: "Show less in Completed"});
		const describedBy = showLess.getAttribute("aria-describedby");
		const description = describedBy === null ? null : document.getElementById(describedBy);
		expect({
			disabled: showLess.getAttribute("aria-disabled"),
			held: showLess.getAttribute("data-held"),
			description: {className: description?.className, text: description?.textContent},
		}).toStrictEqual({
			disabled: "true",
			held: "",
			description: {className: "sr-only", text: "You have something open near the end of this list."},
		});

		fireEvent.click(showLess);
		expect(rowTitlesIn(container, "state-done")).toHaveLength(12);
	});

	it("leaves Show less live when the open session stays inside the first 5 rows", async () => {
		const done = Array.from({length: 12}, (_, index) => session(`d${index}`, `Done ${index}`, "done", index + 1));
		await renderGroups(done, {activeItemId: "d4"});
		fireEvent.click(screen.getByRole("button", {name: "Show 5 more in Completed"}));
		fireEvent.click(screen.getByRole("button", {name: "Show 2 more in Completed"}));

		const showLess = screen.getByRole("button", {name: "Show less in Completed"});
		expect({
			disabled: showLess.getAttribute("aria-disabled"),
			held: showLess.getAttribute("data-held"),
			describedBy: showLess.getAttribute("aria-describedby"),
		}).toStrictEqual({disabled: null, held: null, describedBy: null});
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
						: [
								mark.getAttribute("role"),
								mark.getAttribute("aria-label"),
								mark.parentElement?.getAttribute("class") ?? null,
								mark.parentElement?.getAttribute("aria-hidden") ?? null,
							],
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
				mark: ["img", "Awaiting input", "flex items-center", "true"],
				env: null,
				hidesOnHover: true,
				flushRight: true,
			},
			working: {
				leading: false,
				mark: ["img", "Running", "flex items-center", "true"],
				env: null,
				hidesOnHover: true,
				flushRight: true,
			},
			review: {
				leading: false,
				mark: ["img", "Unread response", "flex items-center", "true"],
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
						rowTitle(link),
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

	it("draws an unseen error as upstream's warning TriangleAlert in the trailing slot instead of the awaiting dot", async () => {
		const rows = [
			{...session("e1", "Errored one", "blocked", 1), state: "idle", unseen: true, unseenError: true},
			session("b1", "Blocked one", "blocked", 3),
		];
		__unreadStoreTesting.reset();
		syncUnseenFromSummaries(rows.map(({id, unseen}) => ({id, unseen})));
		const {container} = await renderGroups(rows);
		const marks = Object.fromEntries(
			[...container.querySelectorAll<HTMLElement>("a[data-row-main-button]")].map((link) => {
				const decoration = link.closest("[data-session-actions]")?.querySelector("[data-row-decoration]");
				const mark = decoration?.querySelector("[role=img]");
				return [
					rowTitle(link),
					{
						label: mark?.getAttribute("aria-label") ?? null,
						triangle: decoration?.querySelector("svg.lucide-triangle-alert") !== null,
						dot: decoration?.querySelector(".status-dot")?.getAttribute("data-kind") ?? null,
						srStatus: link.querySelector("[role=status]")?.textContent ?? null,
					},
				];
			}),
		);
		expect(marks).toStrictEqual({
			"Errored one": {label: "Error", triangle: true, dot: null, srStatus: " Error"},
			"Blocked one": {label: "Awaiting input", triangle: false, dot: "awaiting", srStatus: " Awaiting input"},
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
		});
	});

	it("keeps the touch kebab only on the current session's row and the status mark on every other row, as upstream's data-touch-menu", async () => {
		const {container} = await renderGroups(FIXTURE, {activeItemId: "w1"});
		const rows = [...container.querySelectorAll<HTMLElement>("[data-session-actions]")];
		const decoration = rows[0]?.querySelector("[data-row-decoration]");

		expect({
			touchMenu: rows
				.filter((row) => row.hasAttribute("data-touch-menu"))
				.map((row) => rowTitle(row.querySelector("a[data-row-main-button]"))),
			decorationHiddenOnTouch: decoration?.className.split(" ").includes("pointer-coarse:opacity-0"),
			kebabShownOnTouch: rows[0]
				?.querySelector("[data-row-action]")
				?.className.split(" ")
				.includes("pointer-coarse:opacity-100"),
		}).toStrictEqual({touchMenu: ["Working one"], decorationHiddenOnTouch: false, kebabShownOnTouch: false});
	});

	it("announces each row's status and environment in upstream's two sr-only spans inside the title", async () => {
		const srOnlyOf = (title: string) => {
			const link = screen.getAllByRole("link").find((node) => rowTitle(node) === title);
			if (link === undefined) throw new Error(`no row ${title}`);
			return [...link.querySelectorAll("[data-row-label] .relative > .sr-only[data-find-omitted]")].map(
				(node) => [node.getAttribute("role"), node.textContent],
			);
		};
		const environments = () =>
			Object.fromEntries(FIXTURE.map((row) => [row.id, srOnlyOf(row.title)[1]?.[1] ?? null]));
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
		const first = {
			href: screen
				.getByRole("link", {name: /^Blocked one\s*Awaiting input\s*herdr · Remote Control · Connected$/})
				.getAttribute("href"),
			awaiting: srOnlyOf("Blocked one"),
			idle: srOnlyOf("Completed older"),
			env: environments(),
		};
		cleanup();
		await renderGroups(
			FIXTURE.map((row) => (row.id === "w1" ? {...withHost(row), remoteControl: true} : withHost(row))),
		);

		expect({first, second: environments()}).toStrictEqual({
			first: {
				href: "/session/b1",
				awaiting: [
					["status", " Awaiting input"],
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

	it("fetches the next page, showing Loading…, when Show more reveals the last rows of the last capped group", async () => {
		const done = Array.from({length: 23}, (_, index) => session(`d${index}`, `Done ${index}`, "done", index + 1));
		const older = session("d-old", "Done older page", "done", 60);
		const requests: string[] = [];
		let respond: () => void = () => {};
		vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
			requests.push(String(input));
			await new Promise<void>((resolve) => {
				respond = resolve;
			});
			return new Response(JSON.stringify({sessions: [older], nextCursor: null}), {
				status: 200,
				headers: {"Content-Type": "application/json"},
			});
		});
		const {container} = await renderGroups(done, {nextCursor: "cursor-2"});

		for (let click = 0; click < 3; click++) {
			fireEvent.click(screen.getByRole("button", {name: "Show 5 more in Completed"}));
		}
		expect(requests).toStrictEqual([]);
		fireEvent.click(screen.getByRole("button", {name: "Show 3 more in Completed"}));

		const loading = await screen.findByRole("button", {name: "Loading…"});
		expect({
			text: loading.textContent,
			disabled: loading.getAttribute("aria-disabled"),
			showLess: screen.queryByRole("button", {name: "Show less in Completed"}),
		}).toStrictEqual({text: "Loading…", disabled: "true", showLess: null});
		fireEvent.click(loading);

		act(() => {
			respond();
		});
		await waitFor(() => {
			expect(rowTitlesIn(container, "state-done")).toHaveLength(24);
		});
		expect(rowTitlesIn(container, "state-done").at(-1)).toBe("Done older page");
		expect(requests).toStrictEqual(["/api/sessions/recent?limit=50&cursor=cursor-2&live=1"]);
		expect(screen.getByRole("button", {name: "Show less in Completed"})).toBeTruthy();
	});
	it("keeps the row background on upstream's wrapper while the kebab or context menu is open, hiding the mark only for the kebab", async () => {
		const {container} = await renderGroups(FIXTURE, {activeItemId: "w1"});
		const wrapperOf = (title: string) => {
			const link = [...container.querySelectorAll<HTMLElement>("a[data-row-main-button]")].find(
				(node) => rowTitle(node) === title,
			);
			const wrapper = link?.closest<HTMLElement>("[data-session-actions]");
			if (link === undefined || wrapper === null || wrapper === undefined) throw new Error(`no row ${title}`);
			return {link, wrapper};
		};
		const describeRow = (title: string) => {
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
		const rest = {
			wrapperBackgrounds: backgrounds.filter((name) => wrapperClasses.includes(name)),
			selected: wrapperOf("Working one").link.getAttribute("data-selected"),
			row: describeRow("Completed newest"),
		};

		fireEvent.contextMenu(screen.getByText("Completed newest"), {clientX: 40, clientY: 50});
		await waitFor(() => screen.getByRole("menu"));
		const contextOpen = describeRow("Completed newest");
		fireEvent.keyDown(screen.getByRole("menu"), {key: "Escape"});
		await waitFor(() => {
			expect(screen.queryByRole("menu")).toBeNull();
		});

		fireEvent.click(screen.getByRole("button", {name: "More options for Completed newest"}));
		await waitFor(() => screen.getByRole("menu"));
		const kebabOpen = describeRow("Completed newest");

		const closed = {
			menuOpen: null,
			contextMenuOpen: null,
			decorationHidden: true,
			decorationHiddenByAnyPopup: false,
			linkHasBackground: false,
		};
		expect({rest, contextOpen, kebabOpen}).toStrictEqual({
			rest: {wrapperBackgrounds: backgrounds, selected: "focused", row: closed},
			contextOpen: {...closed, contextMenuOpen: "true"},
			kebabOpen: {...closed, menuOpen: "true"},
		});
	});
});

describe("SessionGroups hover cards", () => {
	async function hoverRow(container: HTMLElement, title: string) {
		const link = [...container.querySelectorAll("a[data-row-main-button]")].find(
			(node) => rowTitle(node) === title,
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

// Upstream `sP` (`Me`), `$y` and `gb`: the open session stays visible under a collapsed header, a collapsed
// group expands when the open session moves into it, and focus in an unmounting section lands on a toggle.
describe("SessionGroups open row and focus rescue", () => {
	function setSessions(queryClient: QueryClient, sessions: unknown[]) {
		act(() => {
			queryClient.setQueryData(recentSessionsInfiniteQueryOptions().queryKey, {
				pages: [RecentSessionsResponse.parse({sessions, nextCursor: null})],
				pageParams: [null],
			});
		});
	}

	it("keeps the open session's row under its collapsed header and badges only the hidden rows", async () => {
		const rows = [
			{...session("od1", "Open done", "done", 5), unseen: true},
			session("od2", "Other done", "done", 6),
		];
		__unreadStoreTesting.reset();
		syncUnseenFromSummaries(rows.map(({id, unseen}) => ({id, unseen})));
		const {container} = await renderGroups(rows, {activeItemId: "od1"});

		fireEvent.click(toggleOf(container, "state-done"));

		const label = container.querySelector('[data-group-key="state-done"] > [data-sidebar-group-label]');
		expect({
			expanded: toggleOf(container, "state-done").getAttribute("aria-expanded"),
			rows: rowTitlesIn(container, "state-done"),
			selected: container
				.querySelector('[data-group-key="state-done"] a[data-row-main-button]')
				?.getAttribute("data-selected"),
			rowless: label?.getAttribute("data-rowless") ?? null,
			badges: label?.querySelectorAll("[data-group-badge]").length,
		}).toStrictEqual({expanded: "false", rows: ["Open done"], selected: "focused", rowless: null, badges: 0});
	});

	it("expands a collapsed group when the open session moves into it and keeps focus on its row", async () => {
		const rows = [session("mw1", "Moving one", "working", 1), session("md1", "Done one", "done", 5)];
		const {container, queryClient} = await renderGroups(rows, {activeItemId: "mw1"});
		fireEvent.click(toggleOf(container, "state-done"));
		expect(toggleOf(container, "state-done").getAttribute("aria-expanded")).toBe("false");
		const link = container.querySelector<HTMLElement>('[data-group-key="state-working"] a[data-row-main-button]');
		link?.focus();

		setSessions(queryClient, [session("mw1", "Moving one", "done", 1), session("md1", "Done one", "done", 5)]);

		await waitFor(() => {
			expect({
				expanded: toggleOf(container, "state-done").getAttribute("aria-expanded"),
				rows: rowTitlesIn(container, "state-done"),
				collapsed: readSidebarState().collapsedGroups,
				focused: document.activeElement?.closest("[data-row-key]")?.getAttribute("data-row-key") ?? null,
			}).toStrictEqual({
				expanded: "true",
				rows: ["Moving one", "Done one"],
				collapsed: [],
				focused: "mw1",
			});
		});
	});

	it("moves focus from an unmounting section to the next group's toggle, else the previous one", async () => {
		const rows = [
			session("fb1", "Blocked one", "blocked", 3),
			session("fw1", "Working one", "working", 1),
			session("fd1", "Done one", "done", 5),
		];
		const {container, queryClient} = await renderGroups(rows);
		container.querySelector<HTMLElement>('[data-group-key="state-working"] a[data-row-main-button]')?.focus();

		setSessions(queryClient, [rows[0], rows[2]]);
		await waitFor(() => {
			expect(document.activeElement).toBe(toggleOf(container, "state-done"));
		});

		container.querySelector<HTMLElement>('[data-group-key="state-done"] a[data-row-main-button]')?.focus();
		setSessions(queryClient, [rows[0]]);
		await waitFor(() => {
			expect(document.activeElement).toBe(toggleOf(container, "state-blocked"));
		});
	});
});

describe("SessionGroups per-project New session +", () => {
	const byProject = {...DEFAULT_SESSION_LIST_PREFS, groupBy: "project"} as const;
	const ROWS = [session("a1", "Alpha one", "done", 5), session("b1", "Beta one", "done", 6)];

	function project(id: string, name: string, projectPath: string | null) {
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

	function newSessionButtons(container: HTMLElement): Record<string, string[]> {
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

	afterEach(() => {
		takePendingHomeLaunchFolder();
	});

	it("gives every project header its own New session in {group} + and drops the generic first-header +", async () => {
		const {container} = await renderGroups(ROWS, {prefs: byProject, projects: PROJECTS});

		expect(newSessionButtons(container)).toStrictEqual({
			"project-project-a1": ["New session in project-a1"],
			"project-project-b1": ["New session in project-b1"],
		});
	});

	it("keeps the generic New session + on the first header under status grouping", async () => {
		const {container} = await renderGroups(ROWS, {projects: PROJECTS});

		expect(newSessionButtons(container)).toStrictEqual({"state-done": ["New session"]});
	});

	it("shows no + for a project whose folder is gone or unknown", async () => {
		const {container} = await renderGroups(ROWS, {
			prefs: byProject,
			projects: [project("-projects-a1", "project-a1", null)],
		});

		expect(newSessionButtons(container)).toStrictEqual({
			"project-project-a1": [],
			"project-project-b1": [],
		});
	});

	it("goes home with that project as the launch folder, leaving the section expanded", async () => {
		const {container, router} = await renderGroups(ROWS, {
			prefs: byProject,
			projects: PROJECTS,
			initialPath: "/session/a1",
		});

		fireEvent.click(screen.getByRole("button", {name: "New session in project-b1"}));

		await waitFor(() => {
			expect(router.state.location.pathname).toBe("/");
		});
		expect({
			launchFolder: takePendingHomeLaunchFolder(),
			expanded: toggleOf(container, "project-project-b1").getAttribute("aria-expanded"),
			collapsedGroups: readSidebarState().collapsedGroups,
		}).toStrictEqual({launchFolder: "-projects-b1", expanded: "true", collapsedGroups: []});
	});

	it("keeps the + on a collapsed project section", async () => {
		const {container} = await renderGroups(ROWS, {prefs: byProject, projects: PROJECTS});

		fireEvent.click(toggleOf(container, "project-project-a1"));

		expect({
			expanded: toggleOf(container, "project-project-a1").getAttribute("aria-expanded"),
			buttons: newSessionButtons(container)["project-project-a1"],
		}).toStrictEqual({expanded: "false", buttons: ["New session in project-a1"]});
	});

	const PLACE_UNKNOWN = "Where these sessions run isn’t known, so there’s nowhere to start a new one.";

	async function openHeaderMenu(container: HTMLElement, key: string): Promise<HTMLElement> {
		fireEvent.contextMenu(toggleOf(container, key), {clientX: 40, clientY: 50});
		await act(async () => {
			await new Promise((resolve) => {
				setTimeout(resolve, 0);
			});
		});
		return await waitFor(() => screen.getByRole("menu"));
	}

	/** The header menu's first item with its disabled reason, or null while it is enabled. */
	function firstMenuItem(menu: HTMLElement): {label: string | null; disabledReason: string | null} {
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

	it("leads a project header menu with an enabled New session that goes home with that project", async () => {
		const {container, router} = await renderGroups(ROWS, {
			prefs: byProject,
			projects: PROJECTS,
			initialPath: "/session/a1",
		});

		const menu = await openHeaderMenu(container, "project-project-b1");
		expect(firstMenuItem(menu)).toStrictEqual({label: "New session", disabledReason: null});

		fireEvent.click(within(menu).getByRole("menuitem", {name: "New session"}));

		await waitFor(() => {
			expect(router.state.location.pathname).toBe("/");
		});
		expect(takePendingHomeLaunchFolder()).toBe("-projects-b1");
	});

	it("disables New session with the place-unknown reason for a project whose folder is gone", async () => {
		const {container} = await renderGroups(ROWS, {
			prefs: byProject,
			projects: [project("-projects-a1", "project-a1", null), PROJECTS[1]],
		});

		expect(firstMenuItem(await openHeaderMenu(container, "project-project-a1"))).toStrictEqual({
			label: "New session",
			disabledReason: PLACE_UNKNOWN,
		});
	});
});

describe("SessionGroups described rows (Show ▸ Metadata)", () => {
	const described = [
		{...session("d1", "Idle on main", "done", 5), gitBranch: "main", projectName: "claude-code-plans"},
		{...session("b1", "Blocked asking", "blocked", 3), gitBranch: "main"},
		{...session("p1", "Pinned on main", "done", 8), gitBranch: "main", projectName: "claude-code-plans"},
		session("n1", "No branch", "done", 9),
	];
	const describeRows = (container: HTMLElement) =>
		Object.fromEntries(
			[...container.querySelectorAll<HTMLElement>("a[data-row-main-button]")].map((link) => {
				const line = link.querySelector(".df-row-description .df-meta-line");
				return [
					rowTitle(link.querySelector("[data-row-label]")),
					{
						described: link.classList.contains("df-described-row"),
						oneLine: link.classList.contains("h-[var(--sb-row-h)]"),
						titleWrap: link.querySelector(":scope > .df-described-title > [data-row-label]") !== null,
						// Re-centres the decoration and kebab on the title line (upstream's described `top`)
						titleCentred: link.closest("[data-session-actions]")?.hasAttribute("data-described") === true,
						line: line === null ? null : {text: line.textContent, title: line.getAttribute("title")},
					},
				];
			}),
		);
	const oneLine = {described: false, oneLine: true, titleWrap: false, titleCentred: false, line: null};

	afterEach(() => {
		localStorage.removeItem("ccp-session-list-prefs");
		localStorage.removeItem(PIN_STORAGE_KEY);
	});

	it("gives unpinned rows upstream's described shell and meta line only with Metadata on", async () => {
		localStorage.setItem(PIN_STORAGE_KEY, JSON.stringify({pinnedIds: ["p1"], pinnedOrder: ["p1"]}));
		const off = describeRows((await renderGroups(described)).container);
		cleanup();
		localStorage.setItem(
			"ccp-session-list-prefs",
			JSON.stringify({...DEFAULT_SESSION_LIST_PREFS, showMetadata: true}),
		);
		const byState = describeRows((await renderGroups(described)).container);
		cleanup();
		const byProject = describeRows(
			(
				await renderGroups(described, {
					prefs: {...DEFAULT_SESSION_LIST_PREFS, groupBy: "project", showMetadata: true},
				})
			).container,
		);

		const line = (text: string, title: string) => ({
			described: true,
			oneLine: false,
			titleWrap: true,
			titleCentred: true,
			line: {text, title},
		});
		expect({off, byState, byProject}).toStrictEqual({
			off: {
				"Pinned on main": oneLine,
				"Blocked asking": oneLine,
				"Idle on main": oneLine,
				"No branch": oneLine,
			},
			byState: {
				"Pinned on main": oneLine,
				"Blocked asking": line("Asked a question", "Asked a question"),
				"Idle on main": line("mainclaude-code-plans", "main, claude-code-plans"),
				"No branch": line("project-n1", "project-n1"),
			},
			byProject: {
				"Pinned on main": oneLine,
				"Blocked asking": line("BlockedAsked a question", "Blocked, Asked a question"),
				"Idle on main": line("main", "main"),
				"No branch": oneLine,
			},
		});
	});
});
