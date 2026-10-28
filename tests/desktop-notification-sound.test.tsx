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

const ALICE = "session-alice";
type Observation = {sessionId: string; label: string; state: "working" | "waiting"; archived: boolean};

const harness = vi.hoisted(() => {
	const listeners = new Set<(session: Observation) => void>();
	const subscribe = vi.fn<(listener: (session: Observation) => void) => () => void>((listener) => {
		listeners.add(listener);
		return () => listeners.delete(listener);
	});
	return {listeners, subscribe, sound: "system"};
});

vi.mock("../src/hooks/use-claude-events", () => ({useSubscribeSessionStates: () => harness.subscribe}));
vi.mock("../src/components/settings-context", async (importOriginal) => {
	const original = await importOriginal<typeof import("../src/components/settings-context")>();
	return {
		...original,
		useSettings: () => ({
			settings: {...original.DEFAULTS, notifyPermissionRequests: true, notificationSound: harness.sound},
		}),
	};
});

let client: QueryClient;
let notifications: Array<{title: string; options: NotificationOptions}>;

beforeEach(() => {
	client = new QueryClient({defaultOptions: {queries: {retry: false}}});
	notifications = [];
	vi.spyOn(document, "hidden", "get").mockReturnValue(true);
	vi.spyOn(window, "scrollTo").mockImplementation(() => {});
	vi.stubGlobal(
		"Notification",
		class {
			static permission = "granted";
			onclick: (() => void) | null = null;
			constructor(title: string, options: NotificationOptions) {
				notifications.push({title, options});
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
	const other = createRoute({getParentRoute: () => root, path: "/", component: () => null});
	const router = createRouter({
		routeTree: root.addChildren([other]),
		history: createMemoryHistory({initialEntries: ["/"]}),
	});
	await router.load();
	act(() => {
		render(<RouterProvider router={router} />);
	});
}

function publish(state: Observation["state"]) {
	act(() => {
		for (const listener of harness.listeners)
			listener({sessionId: ALICE, label: "Example session", state, archived: false});
	});
}

describe("desktop notification sound", () => {
	it.each([
		["system", false],
		["none", true],
	] as const)("with %j constructs the notification with silent %j", async (sound, silent) => {
		harness.sound = sound;
		await start();
		publish("working");
		publish("waiting");
		expect(notifications).toStrictEqual([
			{title: "Example session is waiting on you", options: {tag: ALICE, silent}},
		]);
	});
});
