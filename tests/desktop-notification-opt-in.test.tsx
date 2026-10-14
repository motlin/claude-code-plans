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
import {optInSessionNotifications} from "../src/lib/notify-sessions";
import {installLocalStorage} from "./fake-storage";

const ALICE = "session-alice";
const BOB = "session-bob";
const VIEWED = "session-viewed";
type Observation = {sessionId: string; label: string; state: "working" | "waiting"; archived: boolean};

const harness = vi.hoisted(() => {
	const listeners = new Set<(session: Observation) => void>();
	const subscribe = vi.fn<(listener: (session: Observation) => void) => () => void>((listener) => {
		listeners.add(listener);
		return () => listeners.delete(listener);
	});
	return {listeners, subscribe};
});

vi.mock("../src/hooks/use-claude-events", () => ({useSubscribeSessionStates: () => harness.subscribe}));
vi.mock("../src/components/settings-context", async (importOriginal) => {
	const original = await importOriginal<typeof import("../src/components/settings-context")>();
	const settings = {...original.DEFAULTS, notifyCompletions: false, notifyPermissionRequests: false};
	return {...original, useSettings: () => ({settings})};
});

let client: QueryClient;
let notifications: Array<{title: string; tag: string | undefined}>;

beforeEach(() => {
	installLocalStorage();
	client = new QueryClient({defaultOptions: {queries: {retry: false}}});
	notifications = [];
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
});

async function start() {
	const root = createRootRoute({
		component: () => (
			<QueryClientProvider client={client}>
				<DesktopNotificationBridge />
				<Outlet />
			</QueryClientProvider>
		),
	});
	const session = createRoute({getParentRoute: () => root, path: "/session/$id", component: () => null});
	const router = createRouter({
		routeTree: root.addChildren([session]),
		history: createMemoryHistory({initialEntries: [`/session/${VIEWED}`]}),
	});
	await router.load();
	act(() => {
		render(<RouterProvider router={router} />);
	});
}

function publish(sessionId: string, state: Observation["state"] = "waiting") {
	act(() => {
		for (const listener of harness.listeners) listener({sessionId, label: sessionId, state, archived: false});
	});
}

describe("per-session Notify me", () => {
	it("notifies only opted-in sessions while both global switches are off", async () => {
		await start();
		publish(ALICE);
		publish(BOB);
		const beforeOptIn = [...notifications];
		optInSessionNotifications(ALICE);
		publish(ALICE, "working");
		publish(BOB, "working");
		publish(ALICE);
		publish(BOB);

		expect({beforeOptIn, afterOptIn: notifications}).toStrictEqual({
			beforeOptIn: [],
			afterOptIn: [{tag: ALICE, title: "session-alice is waiting on you"}],
		});
	});

	it("does not notify for the opted-in session currently on screen", async () => {
		optInSessionNotifications(VIEWED);
		await start();
		publish(VIEWED, "working");
		publish(VIEWED);

		expect(notifications).toStrictEqual([]);
	});
});
