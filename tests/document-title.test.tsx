// @vitest-environment jsdom

import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	HeadContent,
	Outlet,
	RouterProvider,
} from "@tanstack/react-router";
import {act, cleanup, render} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {DEFAULTS} from "../src/components/settings-context";
import type {ActivityState} from "../src/lib/session-state";

const harness = vi.hoisted(() => ({
	emit: null as ((session: {sessionId: string; state: ActivityState}) => void) | null,
	alerts: false,
}));

vi.mock("../src/hooks/use-claude-events", () => ({
	useSubscribeSessionStates: () => (listener: (session: never) => void) => {
		harness.emit = listener as never;
		return () => {
			harness.emit = null;
		};
	},
}));

vi.mock("../src/components/settings-context", async (importOriginal) => ({
	...(await importOriginal<typeof import("../src/components/settings-context")>()),
	useSettings: () => ({
		settings: {
			...DEFAULTS,
			notifyCompletions: harness.alerts,
			notifyPermissionRequests: harness.alerts,
		},
		loaded: true,
		setSetting: () => undefined,
		setVerbosity: () => undefined,
		resetAll: () => undefined,
	}),
}));

const {AttentionBadgeBridge} = await import("../src/components/attention-badge-bridge");

function renderRoutedApp(initialPath: string) {
	const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}});
	const rootRoute = createRootRoute({
		head: () => ({meta: [{charSet: "utf-8"}]}),
		component: () => (
			<QueryClientProvider client={queryClient}>
				<HeadContent />
				<AttentionBadgeBridge />
				<Outlet />
			</QueryClientProvider>
		),
	});
	const routes = [
		{path: "/alpha", title: "Alpha"},
		{path: "/beta", title: "Beta"},
	].map(({path, title}) =>
		createRoute({
			getParentRoute: () => rootRoute,
			path,
			head: () => ({meta: [{title}]}),
			component: () => <div>{title}</div>,
		}),
	);
	const router = createRouter({
		routeTree: rootRoute.addChildren(routes),
		history: createMemoryHistory({initialEntries: [initialPath]}),
	});
	render(<RouterProvider router={router as never} />);
	return router;
}

let badges: Array<number | "cleared">;

beforeEach(() => {
	badges = [];
	Object.assign(navigator, {
		setAppBadge: async (count: number) => {
			badges.push(count);
			return Promise.resolve();
		},
		clearAppBadge: async () => {
			badges.push("cleared");
			return Promise.resolve();
		},
	});
});

afterEach(() => {
	cleanup();
	harness.emit = null;
	harness.alerts = false;
	document.title = "";
	Reflect.deleteProperty(navigator, "setAppBadge");
	Reflect.deleteProperty(navigator, "clearAppBadge");
});

describe("AttentionBadgeBridge document title", () => {
	it("leaves the route's tab title alone across client-side navigation", async () => {
		const router = renderRoutedApp("/alpha");
		await act(async () => {
			await router.load();
		});
		const alpha = document.title;

		await act(async () => {
			await router.navigate({to: "/beta"} as never);
		});

		expect({alpha, beta: document.title}).toStrictEqual({alpha: "Alpha", beta: "Beta"});
	});

	it("never prefixes the attention count onto the tab title, as upstream; the app badge still counts", async () => {
		harness.alerts = true;
		const router = renderRoutedApp("/alpha");
		await act(async () => {
			await router.load();
		});
		await act(async () => {
			await router.navigate({to: "/beta"} as never);
		});

		act(() => {
			harness.emit?.({sessionId: "session-test-waiting", state: "waiting"});
		});
		act(() => {
			harness.emit?.({sessionId: "session-test-waiting-2", state: "waiting"});
		});

		expect({title: document.title, badges}).toStrictEqual({
			title: "Beta",
			badges: ["cleared", "cleared", "cleared", 1, 2],
		});
	});
});
