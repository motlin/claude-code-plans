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
import {act, cleanup, render} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {AttentionBadgeBridge} from "../src/components/attention-badge-bridge";
import {ApiResponseError} from "../src/lib/api/client";
import {getCachedSessionIdentity} from "../src/lib/api/session-identity";
import {sessionQueryKeys} from "../src/lib/api/sessions";

const ALIAS = "session_alice_100";
const ALICE = "session-alice";
const BOB = "session-bob";
type Observation = {sessionId: string; label: string; state: "working" | "waiting"; archived: boolean};

const harness = vi.hoisted(() => {
	const listeners = new Set<(session: Observation) => void>();
	const subscribe = vi.fn((listener: (session: Observation) => void) => {
		listeners.add(listener);
		return () => listeners.delete(listener);
	});
	return {listeners, subscribe};
});

vi.mock("../src/hooks/use-claude-events", () => ({useSubscribeSessionStates: () => harness.subscribe}));
vi.mock("../src/components/settings-provider", async (importOriginal) => {
	const original = await importOriginal<typeof import("../src/components/settings-provider")>();
	const settings = {...original.DEFAULTS, notifyPermissionRequests: true};
	return {...original, useSettings: () => ({settings})};
});

let client: QueryClient;
let badge: number;
const fetch = vi.fn();

beforeEach(() => {
	client = new QueryClient({defaultOptions: {queries: {retry: false}}});
	badge = 0;
	fetch.mockReset();
	harness.subscribe.mockClear();
	vi.stubGlobal("fetch", fetch);
	vi.spyOn(document, "hidden", "get").mockReturnValue(false);
	vi.spyOn(window, "scrollTo").mockImplementation(() => {});
	Object.defineProperty(navigator, "setAppBadge", {
		configurable: true,
		value: vi.fn(async (count: number) => {
			badge = count;
		}),
	});
	Object.defineProperty(navigator, "clearAppBadge", {
		configurable: true,
		value: vi.fn(async () => {
			badge = 0;
		}),
	});
});

afterEach(() => {
	cleanup();
	client.clear();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	Reflect.deleteProperty(navigator, "setAppBadge");
	Reflect.deleteProperty(navigator, "clearAppBadge");
	document.title = "";
});

async function start(routeId: string) {
	const root = createRootRoute({
		component: () => (
			<QueryClientProvider client={client}>
				<AttentionBadgeBridge />
				<Outlet />
			</QueryClientProvider>
		),
	});
	const session = createRoute({
		getParentRoute: () => root,
		path: "/session/$id",
		head: () => ({meta: [{title: "Example session"}]}),
		component: () => null,
	});
	const router = createRouter({
		routeTree: root.addChildren([session]),
		history: createMemoryHistory({initialEntries: [`/session/${routeId}`]}),
	});
	await router.load();
	await act(async () => {
		render(<RouterProvider router={router} />);
	});
	return router;
}

function publish(sessionId: string, state: Observation["state"] = "waiting") {
	act(() => {
		for (const listener of harness.listeners)
			listener({sessionId, label: "Example session", state, archived: false});
	});
}

function snapshot() {
	return {badge, title: document.title, subscriptions: harness.subscribe.mock.calls.length};
}

describe("attention badges for session aliases", () => {
	it("updates when a pending alias resolves without losing other sessions or starting a request", async () => {
		client.getQueryCache().build(client, {queryKey: sessionQueryKeys.identity(ALIAS)});
		await start(ALIAS);
		publish(ALICE);
		publish(BOB);
		const pending = snapshot();
		act(() => client.setQueryData(sessionQueryKeys.identity(ALIAS), {sessionId: ALICE}));
		const resolved = snapshot();
		act(() => client.removeQueries({queryKey: sessionQueryKeys.identity(ALIAS), exact: true}));
		expect({pending, resolved, removed: snapshot(), requests: fetch.mock.calls}).toStrictEqual({
			pending: {badge: 2, title: "(2) Example session", subscriptions: 1},
			resolved: {badge: 1, title: "(1) Example session", subscriptions: 1},
			removed: {badge: 2, title: "(2) Example session", subscriptions: 1},
			requests: [],
		});
	});

	it("clears a formerly viewed UUID after ambiguity even while the cache retains its old data", async () => {
		client.setQueryData(sessionQueryKeys.identity(ALIAS), {sessionId: ALICE});
		await start(ALIAS);
		publish(ALICE);
		publish(BOB);
		const before = snapshot();
		const error = new ApiResponseError(
			"/api/sessions/session_alice_100/identity",
			Response.json({}, {status: 409}),
		);
		await act(async () => {
			await expect(
				client.fetchQuery({queryKey: sessionQueryKeys.identity(ALIAS), queryFn: () => Promise.reject(error)}),
			).rejects.toThrow(error);
		});
		expect({
			before,
			after: snapshot(),
			cached: client.getQueryData(sessionQueryKeys.identity(ALIAS)),
			resolved: getCachedSessionIdentity(client, ALIAS),
			requests: fetch.mock.calls,
		}).toStrictEqual({
			before: {badge: 1, title: "(1) Example session", subscriptions: 1},
			after: {badge: 2, title: "(2) Example session", subscriptions: 1},
			cached: {sessionId: ALICE},
			resolved: null,
			requests: [],
		});
	});

	it("keeps hidden-tab alerts and reads the current UUID synchronously after navigation", async () => {
		client.setQueryData(sessionQueryKeys.identity(ALIAS), {sessionId: ALICE});
		const router = await start(ALIAS);
		publish(ALICE);
		const visible = snapshot();
		vi.spyOn(document, "hidden", "get").mockReturnValue(true);
		act(() => document.dispatchEvent(new Event("visibilitychange")));
		const hidden = snapshot();
		vi.spyOn(document, "hidden", "get").mockReturnValue(false);
		await act(() => router.navigate({to: "/session/$id", params: {id: BOB}}));
		const differentSession = snapshot();
		publish(BOB);
		expect({
			visible,
			hidden,
			differentSession,
			afterBobWaits: snapshot(),
			requests: fetch.mock.calls,
		}).toStrictEqual({
			visible: {badge: 0, title: "Example session", subscriptions: 1},
			hidden: {badge: 1, title: "(1) Example session", subscriptions: 1},
			differentSession: {badge: 1, title: "(1) Example session", subscriptions: 1},
			afterBobWaits: {badge: 1, title: "(1) Example session", subscriptions: 1},
			requests: [],
		});
	});

	it("does not create a query or request for an ordinary UUID route", async () => {
		await start(ALICE);
		publish(ALICE);
		expect({
			state: snapshot(),
			requests: fetch.mock.calls,
			queries: client.getQueryCache().getAll(),
			resolved: getCachedSessionIdentity(client, ALICE),
		}).toStrictEqual({
			state: {badge: 0, title: "Example session", subscriptions: 1},
			requests: [],
			queries: [],
			resolved: ALICE,
		});
	});
});
