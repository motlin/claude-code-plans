// @vitest-environment jsdom

import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	HeadContent,
	notFound,
	Outlet,
	RouterProvider,
} from "@tanstack/react-router";
import {act, cleanup, render} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {loadRecents, saveRecents, type RecentEntry} from "../src/lib/recents-history";
import {sessionQueryKeys} from "../src/lib/api/sessions";
import {ApiResponseError} from "../src/lib/api/client";

const harness = vi.hoisted(() => ({
	sessionReady: null as Promise<void> | null,
	removeSession: null as ((sessionId: string) => void) | null,
}));

vi.mock("../src/hooks/use-claude-events", () => ({
	useSubscribeSessionRemovals: () => (listener: (sessionId: string) => void) => {
		harness.removeSession = listener;
		return () => {
			harness.removeSession = null;
		};
	},
}));

const {useRecentsRecorder} = await import("../src/hooks/use-recents-recorder");

const ALIAS = "session_alpha_100";
let queryClient: QueryClient;
const fetch = vi.fn();

const SESSION_TITLES: Record<string, string | null> = {
	"session-alpha": "Alpha session",
	[ALIAS]: "Alpha session",
	"session-beta": "Beta session",
	"session-missing": null,
};

function Recorder(): null {
	useRecentsRecorder();
	return null;
}

function renderRoutedApp(initialPath: string) {
	const rootRoute = createRootRoute({
		head: () => ({meta: [{charSet: "utf-8"}]}),
		component: () => (
			<QueryClientProvider client={queryClient}>
				<HeadContent />
				<Recorder />
				<Outlet />
			</QueryClientProvider>
		),
		notFoundComponent: () => <div>404</div>,
	});
	const sessionRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "/session/$id",
		loader: async ({params}) => {
			if (params.id === "session-beta") await harness.sessionReady;
			return SESSION_TITLES[params.id] ?? null;
		},
		head: ({loaderData}) => ({
			meta: [{title: loaderData ?? "Session Not Found"}],
		}),
		component: () => <div>session</div>,
	});
	const subagentsRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "/session/$id/subagents",
		head: () => ({meta: [{title: "Example subagents"}]}),
		component: () => <div>subagents</div>,
	});
	const planRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "/plan/$filename",
		loader: () => {
			throw notFound();
		},
		head: ({params}) => ({meta: [{title: params.filename}]}),
		component: () => <div>plan</div>,
	});
	const settingsRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "/settings",
		head: () => ({meta: [{title: "Settings"}]}),
		component: () => <div>settings</div>,
	});
	const router = createRouter({
		routeTree: rootRoute.addChildren([sessionRoute, subagentsRoute, planRoute, settingsRoute]),
		history: createMemoryHistory({initialEntries: [initialPath]}),
	});
	render(<RouterProvider router={router as never} />);
	return router;
}

async function start(initialPath: string) {
	const router = renderRoutedApp(initialPath);
	await act(async () => {
		await router.load();
	});
	return router;
}

async function go(router: ReturnType<typeof renderRoutedApp>, to: string) {
	await act(async () => {
		await router.navigate({to} as never);
	});
}

const ALPHA = {
	key: "session:session-alpha",
	kind: "session",
	href: "/session/session-alpha",
	title: "Alpha session",
} satisfies RecentEntry;
const BETA = {
	key: "session:session-beta",
	kind: "session",
	href: "/session/session-beta",
	title: "Beta session",
} satisfies RecentEntry;

beforeEach(() => {
	queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}});
	fetch.mockReset();
	vi.stubGlobal("fetch", fetch);
	vi.spyOn(window, "scrollTo").mockImplementation(() => {});
	sessionStorage.clear();
});

afterEach(() => {
	cleanup();
	queryClient.clear();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	harness.sessionReady = null;
	harness.removeSession = null;
	SESSION_TITLES[ALIAS] = "Alpha session";
	document.title = "";
	sessionStorage.clear();
});

describe("useRecentsRecorder", () => {
	it("records A then B then A as exactly [A, B] with titles", async () => {
		const router = await start("/session/session-alpha");
		await go(router, "/session/session-beta");
		await go(router, "/session/session-alpha");

		expect(loadRecents()).toStrictEqual([ALPHA, BETA]);
	});

	it("does not record a session that resolves to Session Not Found", async () => {
		const router = await start("/session/session-alpha");
		await go(router, "/session/session-missing");

		expect(loadRecents()).toStrictEqual([ALPHA]);
	});

	it("does not record a route whose loader throws notFound", async () => {
		const router = await start("/session/session-alpha");
		await go(router, "/plan/gone-plan");

		expect(loadRecents()).toStrictEqual([ALPHA]);
	});

	it("prunes a previously recorded entry once it resolves to not-found", async () => {
		SESSION_TITLES["session-flaky"] = "Flaky session";
		const router = await start("/session/session-flaky");
		await go(router, "/session/session-alpha");
		SESSION_TITLES["session-flaky"] = null;
		await go(router, "/session/session-flaky");

		expect(loadRecents()).toStrictEqual([ALPHA]);
		delete SESSION_TITLES["session-flaky"];
	});

	it("ignores routes that are not recordable", async () => {
		const router = await start("/settings");
		await go(router, "/session/session-beta");
		await go(router, "/settings");

		expect(loadRecents()).toStrictEqual([BETA]);
	});

	it("retitles the page being left from document.title", async () => {
		const router = await start("/session/session-alpha");
		document.title = "(2) Alpha renamed";
		await go(router, "/session/session-beta");

		expect(loadRecents()).toStrictEqual([BETA, {...ALPHA, title: "Alpha renamed"}]);
	});

	it("removes a session entry when the SSE stream reports it removed", async () => {
		const router = await start("/session/session-alpha");
		await go(router, "/session/session-beta");

		act(() => {
			harness.removeSession?.("session-alpha");
		});

		expect(loadRecents()).toStrictEqual([BETA]);
	});
});

describe("recorder session identities", () => {
	it("records a pending alias only after resolution and deduplicates a later UUID visit without HTTP", async () => {
		queryClient.getQueryCache().build(queryClient, {queryKey: sessionQueryKeys.identity(ALIAS)});
		const router = await start(`/session/${ALIAS}`);
		const pending = loadRecents();
		act(() => queryClient.setQueryData(sessionQueryKeys.identity(ALIAS), {sessionId: "session-alpha"}));
		const resolved = loadRecents();
		await go(router, "/session/session-alpha");
		expect({
			pending,
			resolved,
			revisited: loadRecents(),
			requests: fetch.mock.calls,
			queryKeys: queryClient
				.getQueryCache()
				.getAll()
				.map((query) => query.queryKey),
		}).toStrictEqual({
			pending: [],
			resolved: [{...ALPHA, href: `/session/${ALIAS}`}],
			revisited: [ALPHA],
			requests: [],
			queryKeys: [["sessions", "identity", ALIAS]],
		});
	});

	it("normalizes old aliases in place without promoting a visit after leaving it", async () => {
		saveRecents([BETA, {...ALPHA, key: `session:${ALIAS}`, href: `/session/${ALIAS}`}]);
		const router = await start(`/session/${ALIAS}`);
		await go(router, "/settings");
		act(() => queryClient.setQueryData(sessionQueryKeys.identity(ALIAS), {sessionId: "session-alpha"}));
		const resolved = loadRecents();
		act(() => queryClient.removeQueries({queryKey: sessionQueryKeys.identity(ALIAS), exact: true}));
		expect({resolved, removed: loadRecents(), requests: fetch.mock.calls}).toStrictEqual({
			resolved: [BETA, {...ALPHA, href: `/session/${ALIAS}`}],
			removed: [BETA, ALPHA],
			requests: [],
		});
	});

	it("does not record a late alias while a different navigation is still loading", async () => {
		const router = await start(`/session/${ALIAS}`);
		let release!: () => void;
		harness.sessionReady = new Promise<void>((resolve) => {
			release = resolve;
		});
		let navigation!: Promise<void>;
		act(() => {
			navigation = router.navigate({to: "/session/$id", params: {id: "session-beta"}});
		});
		await vi.waitFor(() => expect(router.state.status).toBe("pending"));
		act(() => queryClient.setQueryData(sessionQueryKeys.identity(ALIAS), {sessionId: "session-alpha"}));
		const duringNavigation = loadRecents();
		await act(async () => {
			release();
			await navigation;
		});
		expect({duringNavigation, afterNavigation: loadRecents(), requests: fetch.mock.calls}).toStrictEqual({
			duringNavigation: [],
			afterNavigation: [BETA],
			requests: [],
		});
	});

	it("keeps the first owner through ambiguity and reassignment, then accepts a fresh alias visit", async () => {
		queryClient.setQueryData(sessionQueryKeys.identity(ALIAS), {sessionId: "session-alpha"});
		const router = await start(`/session/${ALIAS}`);
		const error = new ApiResponseError(`/api/sessions/${ALIAS}/identity`, Response.json({}, {status: 409}));
		await act(async () => {
			await expect(
				queryClient.fetchQuery({
					queryKey: sessionQueryKeys.identity(ALIAS),
					queryFn: () => Promise.reject(error),
				}),
			).rejects.toThrow(error);
		});
		const ambiguous = loadRecents();
		act(() => queryClient.setQueryData(sessionQueryKeys.identity(ALIAS), {sessionId: "session-beta"}));
		SESSION_TITLES[ALIAS] = "Alpha updated";
		await act(() => router.invalidate());
		const reassigned = loadRecents();
		document.title = "(2) Alpha renamed";
		await go(router, "/settings");
		const left = loadRecents();
		SESSION_TITLES[ALIAS] = "Beta session";
		await go(router, `/session/${ALIAS}`);
		expect({ambiguous, reassigned, left, freshVisit: loadRecents(), requests: fetch.mock.calls}).toStrictEqual({
			ambiguous: [ALPHA],
			reassigned: [{...ALPHA, title: "Alpha updated"}],
			left: [{...ALPHA, title: "Alpha renamed"}],
			freshVisit: [
				{...BETA, href: `/session/${ALIAS}`},
				{...ALPHA, title: "Alpha renamed"},
			],
			requests: [],
		});
	});

	it("prunes resolved session and subagent aliases by the removed UUID", async () => {
		queryClient.setQueryData(sessionQueryKeys.identity(ALIAS), {sessionId: "session-alpha"});
		const router = await start(`/session/${ALIAS}`);
		await go(router, `/session/${ALIAS}/subagents`);
		await go(router, "/session/session-beta");
		const beforeRemoval = loadRecents();
		act(() => harness.removeSession?.("session-alpha"));
		expect({beforeRemoval, afterRemoval: loadRecents(), requests: fetch.mock.calls}).toStrictEqual({
			beforeRemoval: [
				BETA,
				{
					key: "subagents:session-alpha",
					kind: "subagents",
					href: `/session/${ALIAS}/subagents`,
					title: "Example subagents",
				},
				{...ALPHA, href: `/session/${ALIAS}`},
			],
			afterRemoval: [BETA],
			requests: [],
		});
	});

	it("records ordinary UUIDs without creating identity queries or requests", async () => {
		await start("/session/session-alpha");
		expect({
			entries: loadRecents(),
			requests: fetch.mock.calls,
			queries: queryClient.getQueryCache().getAll(),
		}).toStrictEqual({entries: [ALPHA], requests: [], queries: []});
	});
});
