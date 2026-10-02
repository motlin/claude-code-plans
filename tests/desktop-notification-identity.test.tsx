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
import {DesktopNotificationBridge} from "../src/components/desktop-notification-bridge";
import {ApiResponseError} from "../src/lib/api/client";
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
let notifications: Array<{title: string; tag: string | undefined}>;
const fetch = vi.fn();

beforeEach(() => {
	client = new QueryClient({defaultOptions: {queries: {retry: false}}});
	notifications = [];
	fetch.mockReset();
	harness.subscribe.mockClear();
	vi.stubGlobal("fetch", fetch);
	vi.spyOn(document, "hidden", "get").mockReturnValue(false);
	vi.spyOn(window, "scrollTo").mockImplementation(() => {});
	vi.stubGlobal(
		"Notification",
		class {
			static permission = "granted";
			onclick: (() => void) | null = null;
			constructor(title: string, options: NotificationOptions) {
				notifications.push({title, tag: options.tag});
			}
			close() {}
		},
	);
});

afterEach(() => {
	cleanup();
	client.clear();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	document.title = "";
});

async function start(routeId: string) {
	const root = createRootRoute({
		component: () => (
			<QueryClientProvider client={client}>
				<DesktopNotificationBridge />
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

describe("desktop notifications for session aliases", () => {
	it("suppresses a resolved visible alias and retains hidden-tab alerts", async () => {
		client.setQueryData(sessionQueryKeys.identity(ALIAS), {sessionId: ALICE});
		await start(ALIAS);
		publish(ALICE);
		const visible = [...notifications];
		publish(ALICE, "working");
		vi.spyOn(document, "hidden", "get").mockReturnValue(true);
		publish(ALICE);
		publish(ALICE);
		expect({visible, hidden: notifications, requests: fetch.mock.calls}).toStrictEqual({
			visible: [],
			hidden: [{tag: ALICE, title: "Example session is waiting on you"}],
			requests: [],
		});
	});

	it("does not suppress pending aliases or emit notifications when the identity resolves", async () => {
		client.getQueryCache().build(client, {queryKey: sessionQueryKeys.identity(ALIAS)});
		const router = await start(ALIAS);
		publish(ALICE);
		const pending = [...notifications];
		notifications = [];
		act(() => client.setQueryData(sessionQueryKeys.identity(ALIAS), {sessionId: ALICE}));
		const resolved = [...notifications];
		publish(ALICE, "working");
		publish(ALICE);
		const viewed = [...notifications];
		await act(() => router.navigate({to: "/session/$id", params: {id: BOB}}));
		publish(ALICE, "working");
		publish(ALICE);
		publish(BOB);
		expect({
			pending,
			resolved,
			viewed,
			afterNavigation: notifications,
			subscriptions: harness.subscribe.mock.calls.length,
			requests: fetch.mock.calls,
		}).toStrictEqual({
			pending: [{tag: ALICE, title: "Example session is waiting on you"}],
			resolved: [],
			viewed: [],
			afterNavigation: [{tag: ALICE, title: "Example session is waiting on you"}],
			subscriptions: 1,
			requests: [],
		});
	});

	it("does not suppress the former owner after a 409 while old cache data remains", async () => {
		client.setQueryData(sessionQueryKeys.identity(ALIAS), {sessionId: ALICE});
		await start(ALIAS);
		publish(ALICE);
		const error = new ApiResponseError(
			"/api/sessions/session_alice_100/identity",
			Response.json({}, {status: 409}),
		);
		await act(async () => {
			await expect(
				client.fetchQuery({queryKey: sessionQueryKeys.identity(ALIAS), queryFn: () => Promise.reject(error)}),
			).rejects.toThrow(error);
		});
		const afterCacheError = [...notifications];
		publish(ALICE, "working");
		publish(ALICE);
		expect({
			afterCacheError,
			notifications,
			cached: client.getQueryData(sessionQueryKeys.identity(ALIAS)),
			requests: fetch.mock.calls,
		}).toStrictEqual({
			afterCacheError: [],
			notifications: [{tag: ALICE, title: "Example session is waiting on you"}],
			cached: {sessionId: ALICE},
			requests: [],
		});
	});

	it("suppresses ordinary UUID routes without queries or HTTP requests", async () => {
		await start(ALICE);
		publish(ALICE);
		publish(BOB);
		expect({notifications, requests: fetch.mock.calls, queries: client.getQueryCache().getAll()}).toStrictEqual({
			notifications: [{tag: BOB, title: "Example session is waiting on you"}],
			requests: [],
			queries: [],
		});
	});
});
