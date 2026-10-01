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
import {act, cleanup, fireEvent, render, screen, waitFor} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it} from "vite-plus/test";

import {SessionGroups} from "../src/components/sidebar/session-groups";
import {ToastProvider} from "../src/components/toast";
import {RecentSessionsResponse, recentSessionsInfiniteQueryOptions} from "../src/lib/api/sessions";
import {PIN_STORAGE_KEY, readPinState} from "../src/lib/pin-store";
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

function seedPins(pinnedIds: string[], pinnedOrder: string[] = []): void {
	localStorage.setItem(PIN_STORAGE_KEY, JSON.stringify({pinnedIds, pinnedOrder}));
}

async function renderGroups(sessions: unknown[]) {
	const queryClient = new QueryClient({
		defaultOptions: {
			queries: {retry: false, staleTime: Infinity, gcTime: Infinity, refetchOnMount: false},
		},
	});
	queryClient.setQueryData(recentSessionsInfiniteQueryOptions().queryKey, {
		pages: [RecentSessionsResponse.parse({sessions, nextCursor: null})],
		pageParams: [null],
	});
	const rootRoute = createRootRoute({
		component: () => (
			<QueryClientProvider client={queryClient}>
				<ToastProvider>
					<SessionGroups activeItemId={null} />
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

function pinnedSection(container: HTMLElement): HTMLElement {
	const section = container.querySelector('[data-testid="sidebar-pinned"]');
	if (!(section instanceof HTMLElement)) throw new Error("no Pinned section");
	return section;
}

function rowTitles(element: Element | null): string[] {
	if (element === null) return [];
	return [...element.querySelectorAll("a[data-row-main-button]")].map((link) => link.textContent ?? "");
}

function visibleGroupNames(container: HTMLElement): string[] {
	return [...container.querySelectorAll('[data-testid="sidebar-recents"] [data-group-name]')].map(
		(node) => node.textContent ?? "",
	);
}

async function openRowMenu(title: string): Promise<HTMLElement> {
	fireEvent.contextMenu(screen.getByText(title), {clientX: 40, clientY: 50});
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 0));
	});
	return screen.getByRole("menu");
}

function menuItemNames(menu: HTMLElement): string[] {
	return [...menu.querySelectorAll('[role="menuitem"]')].map((item) => (item.firstChild?.textContent ?? "").trim());
}

afterEach(cleanup);

beforeEach(() => {
	installLocalStorage();
});

describe("sidebar Pinned section", () => {
	it("marks the Pinned and recents lists with the upstream data-perf-region anchors", async () => {
		const {container} = await renderGroups(FIXTURE);

		expect({
			pinned: pinnedSection(container).getAttribute("data-perf-region"),
			recents: container.querySelector('[data-testid="sidebar-recents"]')?.getAttribute("data-perf-region"),
		}).toStrictEqual({pinned: "sidebar_pinned", recents: "sidebar_recents"});
	});

	it("is a hidden, inert stub above the groups when nothing is pinned", async () => {
		const {container} = await renderGroups(FIXTURE);

		const section = pinnedSection(container);
		expect({
			stub: section.hasAttribute("data-stub"),
			inert: section.hasAttribute("inert"),
			reveal: section.classList.contains("df-pin-section-reveal"),
			rows: rowTitles(section),
			beforeRecents:
				section.compareDocumentPosition(container.querySelector('[data-testid="sidebar-recents"]') as Node) ===
				Node.DOCUMENT_POSITION_FOLLOWING,
		}).toEqual({stub: true, inert: true, reveal: true, rows: [], beforeRecents: true});
	});

	it("lists user-ordered pins first, then the rest by Sort by", async () => {
		seedPins(["r1", "w1", "d2"], ["d2", "w1"]);
		const {container} = await renderGroups(FIXTURE);

		const section = pinnedSection(container);
		expect({
			stub: section.hasAttribute("data-stub"),
			inert: section.hasAttribute("inert"),
			reveal: section.classList.contains("df-pin-section-reveal"),
			label: section.querySelector("[data-group-name]")?.textContent,
			rows: rowTitles(section),
		}).toEqual({
			stub: false,
			inert: false,
			reveal: false,
			label: "Pinned",
			rows: ["Completed older", "Working one", "Review one"],
		});
	});

	it("moves pinned sessions out of their groups", async () => {
		seedPins(["r1", "d2"]);
		const {container} = await renderGroups(FIXTURE);

		expect({
			groups: visibleGroupNames(container),
			recents: rowTitles(container.querySelector('[data-testid="sidebar-recents"]')),
		}).toEqual({
			groups: ["Needs input", "Working", "Completed"],
			recents: ["Blocked one", "Working one", "Completed newest"],
		});
	});

	it("persists collapsing the Pinned header in collapsedGroups", async () => {
		seedPins(["w1"]);
		const {container} = await renderGroups(FIXTURE);

		const section = pinnedSection(container);
		const toggle = section.querySelector("[data-group-toggle]");
		if (!(toggle instanceof HTMLElement)) throw new Error("no Pinned toggle");
		fireEvent.click(toggle);

		await waitFor(() => expect(rowTitles(section)).toEqual([]));
		expect(readSidebarState().collapsedGroups).toEqual(["pinned"]);
		expect(toggle.getAttribute("aria-expanded")).toBe("false");
	});

	it("caps Pinned at 20 rows with Show N more", async () => {
		const sessions = Array.from({length: 23}, (_, index) =>
			session(`p${index}`, `Pinned ${index}`, "done", index + 1),
		);
		seedPins(sessions.map((pinned) => pinned.id));
		const {container} = await renderGroups(sessions);

		expect(rowTitles(pinnedSection(container))).toHaveLength(20);
		fireEvent.click(screen.getByRole("button", {name: "Show 3 more in Pinned"}));
		await waitFor(() => expect(rowTitles(pinnedSection(container))).toHaveLength(23));
		fireEvent.click(screen.getByRole("button", {name: "Show less in Pinned"}));
		await waitFor(() => expect(rowTitles(pinnedSection(container))).toHaveLength(20));
		expect(screen.getByRole("button", {name: "Show 3 more in Pinned"})).toBeTruthy();
	});

	it("offers Move up and Move down on pinned rows, omitted at the ends", async () => {
		seedPins(["r1", "w1", "d2"], ["r1", "w1", "d2"]);
		await renderGroups(FIXTURE);

		const top = menuItemNames(await openRowMenu("Review one"));
		fireEvent.keyDown(screen.getByRole("menu"), {key: "Escape"});
		await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
		const middle = menuItemNames(await openRowMenu("Working one"));
		fireEvent.keyDown(screen.getByRole("menu"), {key: "Escape"});
		await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
		const bottom = menuItemNames(await openRowMenu("Completed older"));

		expect({
			top: top.slice(0, 2),
			middle: middle.slice(0, 3),
			bottom: bottom.slice(0, 2),
		}).toEqual({
			top: ["Move down", "Unpin"],
			middle: ["Move up", "Move down", "Unpin"],
			bottom: ["Move up", "Unpin"],
		});
	});

	it("moves a pinned row up, writes the pin order and refocuses the row", async () => {
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
			expect(rowTitles(pinnedSection(container))).toEqual(["Working one", "Completed older", "Review one"]),
		);
		await waitFor(() => expect(document.activeElement?.textContent).toBe("Completed older"));
		expect({
			pins: readPinState(),
			focusedRow: document.activeElement?.hasAttribute("data-row-main-button"),
		}).toStrictEqual({
			pins: {pinnedIds: ["r1", "w1", "d2"], pinnedOrder: ["w1", "d2", "r1"]},
			focusedRow: true,
		});
	});
});
