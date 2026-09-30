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
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import type {UnifiedSearchItem} from "../src/lib/api/search";
import {SearchView, validateSearchParameters} from "../src/routes/search";

function item(id: string, title: string, overrides: Partial<UnifiedSearchItem> = {}) {
	return {
		kind: "session",
		id,
		title,
		titleMatches: [{start: 0, end: 4}],
		projectId: "-users-dev-alpha",
		projectName: "alpha",
		mtime: new Date().toISOString(),
		...overrides,
	} satisfies UnifiedSearchItem;
}

const ITEMS: UnifiedSearchItem[] = [
	item("sess-1", "auth one"),
	item("sess-2", "auth two", {
		snippet: {text: "the auth token", matches: [{start: 4, end: 8}]},
	}),
	item("plan-1", "auth plan", {kind: "plan", href: "/plans/auth-plan"}),
];

let requests: string[] = [];

function fetchMock(url: string): Promise<unknown> {
	requests.push(url);
	return Promise.resolve({ok: true, status: 200, json: async () => ({items: ITEMS})});
}

async function renderPage(initialEntry: string) {
	const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}});
	const rootRoute = createRootRoute({
		component: () => (
			<QueryClientProvider client={queryClient}>
				<Outlet />
			</QueryClientProvider>
		),
	});
	const searchRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "search",
		validateSearch: validateSearchParameters,
		component: function SearchRouteComponent() {
			const {q, type} = searchRoute.useSearch();
			return <SearchView q={q} type={type} />;
		},
	});
	const sessionRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "session/$id",
		component: () => <div>session page</div>,
	});
	const plansRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "plans/$slug",
		component: () => <div>plan page</div>,
	});
	const router = createRouter({
		routeTree: rootRoute.addChildren([searchRoute, sessionRoute, plansRoute]),
		history: createMemoryHistory({initialEntries: [initialEntry]}),
	});
	await router.load();
	render(<RouterProvider router={router} />);
	return router;
}

function listbox(): HTMLElement {
	return screen.getByRole("listbox", {name: "Search results"});
}

function optionTitles(): string[] {
	return within(listbox())
		.getAllByRole("option")
		.map((option) => option.querySelector("[data-search-label]")?.textContent ?? "");
}

function selectedTitle(): string | null {
	const selected = within(listbox())
		.getAllByRole("option")
		.find((option) => option.getAttribute("aria-selected") === "true");
	return selected?.querySelector("[data-search-label]")?.textContent ?? null;
}

describe("/search page", () => {
	beforeEach(() => {
		requests = [];
		vi.stubGlobal("fetch", fetchMock);
		Element.prototype.scrollIntoView = () => {};
	});

	afterEach(() => {
		cleanup();
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	it("renders unified search rows as highlight runs, not <mark>", async () => {
		await renderPage("/search?q=auth");

		await waitFor(() => expect(optionTitles()).toStrictEqual(["auth one", "auth two", "auth plan"]));
		expect({
			requests,
			marks: document.querySelectorAll("mark").length,
			runs: [...listbox().querySelectorAll(".font-semibold.text-primary")].map((run) => run.textContent),
		}).toStrictEqual({
			requests: ["/api/search?query=auth&limit=100"],
			marks: 0,
			runs: ["auth", "auth", "auth", "auth"],
		});
	});

	it("moves the selection with ↑/↓ and opens the selected row on Enter", async () => {
		const router = await renderPage("/search?q=auth");
		await waitFor(() => expect(optionTitles()).toHaveLength(3));
		const input = screen.getByRole("combobox", {name: "Search"});

		const trail = [selectedTitle()];
		fireEvent.keyDown(input, {key: "ArrowDown"});
		trail.push(selectedTitle());
		fireEvent.keyDown(input, {key: "ArrowDown"});
		trail.push(selectedTitle());
		fireEvent.keyDown(input, {key: "ArrowDown"});
		trail.push(selectedTitle());
		fireEvent.keyDown(input, {key: "ArrowUp"});
		trail.push(selectedTitle());
		fireEvent.keyDown(input, {key: "Enter"});

		await screen.findByText("session page");
		expect({trail, pathname: router.state.location.pathname}).toStrictEqual({
			trail: ["auth one", "auth two", "auth plan", "auth plan", "auth two"],
			pathname: "/session/sess-2",
		});
	});

	it("opens plans and memories by their href", async () => {
		const router = await renderPage("/search?q=auth");
		await waitFor(() => expect(optionTitles()).toHaveLength(3));
		const input = screen.getByRole("combobox", {name: "Search"});

		fireEvent.keyDown(input, {key: "ArrowDown"});
		fireEvent.keyDown(input, {key: "ArrowDown"});
		fireEvent.keyDown(input, {key: "Enter"});

		await screen.findByText("plan page");
		expect(router.state.location.pathname).toBe("/plans/auth-plan");
	});

	it("writes the typed query and the chosen type tab back to the URL", async () => {
		const router = await renderPage("/search?q=auth");
		await waitFor(() => expect(optionTitles()).toHaveLength(3));

		fireEvent.change(screen.getByRole("combobox", {name: "Search"}), {
			target: {value: "token"},
		});
		await waitFor(() => expect({...router.state.location.search}).toStrictEqual({q: "token", type: "all"}));

		fireEvent.click(screen.getByRole("tab", {name: "Plans"}));
		await waitFor(() => expect({...router.state.location.search}).toStrictEqual({q: "token", type: "plans"}));
		await waitFor(() => expect(requests.at(-1)).toBe("/api/search?query=token&type=plans&limit=100"));
		expect(screen.getByRole("tab", {name: "Plans"}).getAttribute("aria-selected")).toBe("true");
	});
});

describe("validateSearchParameters", () => {
	it("round-trips q and type, defaults the type, and maps the legacy files mode", () => {
		expect({
			roundTrip: validateSearchParameters(validateSearchParameters({q: "auth", type: "plans"})),
			defaults: validateSearchParameters({}),
			nonStringQuery: validateSearchParameters({q: 100}),
			legacyFiles: validateSearchParameters({q: "needle", mode: "files"}),
			legacyTitles: validateSearchParameters({q: "auth", mode: "titles"}),
			legacyConversations: validateSearchParameters({q: "auth", mode: "conversations"}),
		}).toStrictEqual({
			roundTrip: {q: "auth", type: "plans"},
			defaults: {q: "", type: "all"},
			nonStringQuery: {q: "", type: "all"},
			legacyFiles: {q: "needle", type: "files"},
			legacyTitles: {q: "auth", type: "all"},
			legacyConversations: {q: "auth", type: "all"},
		});
	});

	it("rejects an unknown type", () => {
		expect(() => validateSearchParameters({type: "bogus"})).toThrow(
			'Unknown search type "bogus": expected all, sessions, plans, memories, files',
		);
	});
});
