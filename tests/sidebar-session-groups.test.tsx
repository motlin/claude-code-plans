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
import {ToastProvider} from "../src/components/toast";
import type {ReactNode} from "react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {SessionGroups} from "../src/components/sidebar/session-groups";
import {RecentSessionsResponse, recentSessionsInfiniteQueryOptions} from "../src/lib/api/sessions";
import type {SessionBucket} from "../src/lib/session-state";
import {readSidebarState} from "../src/lib/sidebar-store";
import {installLocalStorage} from "./fake-storage";

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

async function renderGroups(sessions: unknown[], options: {nextCursor?: string | null; filterSlot?: ReactNode} = {}) {
	const queryClient = seedQueryClient(sessions, options.nextCursor ?? null);
	const rootRoute = createRootRoute({
		component: () => (
			<QueryClientProvider client={queryClient}>
				<ToastProvider>
					<SessionGroups activeItemId={null} filterSlot={options.filterSlot} />
					<Outlet />
				</ToastProvider>
			</QueryClientProvider>
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
	await waitFor(() => expect(result.container.querySelector("[data-group-toggle]")).toBeTruthy());
	return result;
}

function groupNames(container: HTMLElement): string[] {
	return [...container.querySelectorAll('[data-testid="sidebar-recents"] [data-group-name]')].map(
		(node) => node.textContent ?? "",
	);
}

function rowTitlesIn(container: HTMLElement, groupKey: string): string[] {
	const section = container.querySelector(`[data-group-key="${groupKey}"]`);
	if (!(section instanceof HTMLElement)) return [];
	return [...section.querySelectorAll("a[data-row-main-button]")].map((link) => link.textContent ?? "");
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

	it("omits empty groups", async () => {
		const {container} = await renderGroups([
			session("w1", "Working one", "working", 1),
			session("d1", "Completed one", "done", 5),
		]);

		expect(groupNames(container)).toEqual(["Working", "Completed"]);
	});

	it("shows each row's session title with its state icon", async () => {
		await renderGroups(FIXTURE);

		// The icon's aria-label joins the title in the accessible name, as upstream's markup does.
		const blocked = screen.getByRole("link", {name: /Blocked one$/});
		expect(blocked.getAttribute("href")).toBe("/session/b1");
		expect(within(blocked).getByRole("status").getAttribute("aria-label")).toBe("Awaiting input");
		expect(
			within(screen.getByRole("link", {name: /Working one$/}))
				.getByRole("status")
				.getAttribute("aria-label"),
		).toBe("Running");
		expect(
			within(screen.getByRole("link", {name: /Completed older$/}))
				.getByRole("img")
				.getAttribute("aria-label"),
		).toBe("Idle");
		expect(screen.queryByText("project-b1")).toBeNull();
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

	it("puts the filter slot on the first group header only", async () => {
		const {container} = await renderGroups(
			[session("w1", "Working one", "working", 1), session("d1", "Completed one", "done", 5)],
			{filterSlot: <button type="button">Filter</button>},
		);

		const headers = [...container.querySelectorAll('[data-testid="sidebar-recents"] [data-sidebar-group-label]')];
		expect(headers.map((header) => within(header as HTMLElement).queryAllByText("Filter").length)).toEqual([1, 0]);
		expect(within(headers[0] as HTMLElement).getByRole("button", {name: "Working"})).toBeTruthy();
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
			return new Response(
				JSON.stringify({sessions: [session("d-old", "Completed next page", "done", 60)], nextCursor: null}),
				{status: 200, headers: {"Content-Type": "application/json"}},
			);
		});
		const {container} = await renderGroups(FIXTURE, {nextCursor: "cursor-2"});

		await waitFor(() =>
			expect(rowTitlesIn(container, "state-done")).toStrictEqual([
				"Completed newest",
				"Completed older",
				"Completed next page",
			]),
		);
		expect(requests).toStrictEqual(["/api/sessions/recent?limit=50&cursor=cursor-2"]);
	});

	it("fetches the next page when Show N more expands the last capped group", async () => {
		const done = Array.from({length: 23}, (_, index) => session(`d${index}`, `Done ${index}`, "done", index + 1));
		const older = session("d-old", "Done older page", "done", 60);
		const requests: string[] = [];
		vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
			requests.push(String(input));
			return new Response(JSON.stringify({sessions: [older], nextCursor: null}), {
				status: 200,
				headers: {"Content-Type": "application/json"},
			});
		});
		const {container} = await renderGroups(done, {nextCursor: "cursor-2"});

		fireEvent.click(screen.getByRole("button", {name: "Show 3 more in Completed"}));

		await waitFor(() => expect(rowTitlesIn(container, "state-done")).toHaveLength(24));
		expect(rowTitlesIn(container, "state-done").at(-1)).toBe("Done older page");
		expect(requests).toStrictEqual(["/api/sessions/recent?limit=50&cursor=cursor-2"]);
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
