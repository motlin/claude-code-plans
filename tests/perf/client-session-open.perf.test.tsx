// @vitest-environment jsdom

import {QueryClient} from "@tanstack/react-query";
import {
	createMemoryHistory,
	createRootRouteWithContext,
	createRoute,
	createRouter,
	Outlet,
	RouterProvider,
} from "@tanstack/react-router";
import {cleanup, fireEvent} from "@testing-library/react";
import {copyFileSync, mkdirSync, mkdtempSync, rmSync, utimesSync} from "node:fs";
import {tmpdir} from "node:os";
import {basename, join} from "node:path";
import {afterAll, afterEach, beforeAll, describe, expect, it, vi} from "vite-plus/test";
import {AppFrame} from "../../src/components/app-frame";
import {
	ESTIMATED_TURN_HEIGHT_PIXELS,
	INITIAL_MOUNTED_TURN_COUNT,
	TRANSCRIPT_OVERSCAN_PIXELS,
} from "../../src/components/session-chat";
import {SettingsProvider} from "../../src/components/settings-provider";
import {ThemeProvider} from "../../src/components/theme-provider";
import {ToastProvider} from "../../src/components/toast";
import type {AppDb} from "../../src/lib/db/connection";
import {ClaudeEventsProvider} from "../../src/hooks/use-claude-events";
import {Route as RootRoute} from "../../src/routes/__root";
import {Route as SessionRoute} from "../../src/routes/session.$id";
import {generateTranscript, PERF_SHAPES, seedFixtureDb, type PerfShapeName} from "./fixtures/generate-transcript";
import {installFakeEventSource} from "./harness/fake-event-source";
import {installFixedResizeObserver} from "./harness/fixed-resize-observer";
import {type InteractionMeasurement, measureInteraction} from "./harness/measure-interaction";
import {metricIds} from "./perf-ids";
import {ratchet} from "./ratchet";

/**
 * Client lab benchmark for opening a session and switching to another from the sidebar (measurement plan §2.4
 * L7/L8/L9/L12). The app frame and the real `/session/$id` route render against responses the real API handlers
 * produced for the generated small and typical transcripts, and every count is ratcheted.
 */

vi.mock(import("../../src/lib/hmr-persist"), async (importOriginal) => {
	const cache = new Map<string, unknown>();
	return {
		...(await importOriginal()),
		hmrPersist: <T,>(key: string, initialize: () => T): T => {
			if (!cache.has(key)) cache.set(key, initialize());
			return cache.get(key) as T;
		},
	};
});

vi.mock(import("../../src/components/session-page"), async (importOriginal) => {
	const actual = await importOriginal();
	const {PerfSubtree} = await import("./harness/measure-interaction");
	return {
		...actual,
		SessionPage: (props: Parameters<typeof actual.SessionPage>[0]) => (
			<PerfSubtree id="SessionPage">
				<actual.SessionPage {...props} />
			</PerfSubtree>
		),
	};
});

vi.mock(import("../../src/components/session-chat"), async (importOriginal) => {
	const actual = await importOriginal();
	const {memo} = await import("react");
	const {PerfSubtree} = await import("./harness/measure-interaction");
	return {
		...actual,
		// Memoized like the real SessionChat, so the wrapper never adds a render the real component would skip.
		SessionChat: memo((props: Parameters<typeof actual.SessionChat>[0]) => (
			<PerfSubtree id="SessionChat">
				<actual.SessionChat {...props} />
			</PerfSubtree>
		)),
	};
});

const SHAPES = ["small", "typical"] as const satisfies readonly PerfShapeName[];
type Shape = (typeof SHAPES)[number];

/** The other shape is the session a switch starts from. */
const SWITCH_FROM: Record<Shape, Shape> = {small: "typical", typical: "small"};

const PROJECT = "-repo";
const FIXED_NOW = Date.parse("2026-09-30T12:00:00.000Z");
const FIXTURE_MTIME = new Date(FIXED_NOW - 24 * 60 * 60 * 1000);
const ROW_HEIGHT = ESTIMATED_TURN_HEIGHT_PIXELS;

type ApiHandler = (context: {params: Record<string, string>; request: Request}) => Response | Promise<Response>;

/** Request paths the frame and session page fetch, each answered by its real GET handler. */
function sessionEndpoints(id: string): Array<{path: string; module: string; params: Record<string, string>}> {
	return [
		{path: `/api/sessions/${id}`, module: "../../src/routes/api/sessions.$id", params: {id}},
		{path: `/api/sessions/${id}/transcript`, module: "../../src/routes/api/sessions.$id.transcript", params: {id}},
		{path: `/api/sessions/${id}/subagents`, module: "../../src/routes/api/sessions.$id.subagents", params: {id}},
		{path: `/api/sessions/${id}/artifacts`, module: "../../src/routes/api/sessions.$id.artifacts", params: {id}},
		{path: `/api/sessions/${id}/statusline`, module: "../../src/routes/api/sessions.$id.statusline", params: {id}},
		{
			path: `/api/sessions/${id}/composer-state`,
			module: "../../src/routes/api/sessions.$id.composer-state",
			params: {id},
		},
	];
}

const FRAME_ENDPOINTS: Array<{path: string; module: string}> = [
	{path: "/api/projects", module: "../../src/routes/api/projects"},
	{path: "/api/plans", module: "../../src/routes/api/plans"},
	{path: "/api/sessions/recent?limit=50", module: "../../src/routes/api/sessions.recent"},
	{path: "/api/sessions/grouped?perProject=5", module: "../../src/routes/api/sessions.grouped"},
	{path: "/api/plugins", module: "../../src/routes/api/plugins"},
	{path: "/api/plugins/user-commands", module: "../../src/routes/api/plugins.user-commands"},
	{path: "/api/sessions/active?activeTimeoutMs=60000", module: "../../src/routes/api/sessions.active"},
	{path: "/api/sessions/active?activeTimeoutMs=300000", module: "../../src/routes/api/sessions.active"},
	{path: "/api/approvals", module: "../../src/routes/api/approvals"},
	{path: "/api/notifications", module: "../../src/routes/api/notifications"},
	{path: "/api/local-account", module: "../../src/routes/api/local-account"},
	{path: "/api/application-settings", module: "../../src/routes/api/application-settings"},
];

/** herdr is a live process the lab never talks to; it answers as an installation with no panes. */
const STATIC_FIXTURES: Record<string, unknown> = {
	"/api/herdr-panes": {panes: [], writesEnabled: false},
};

let root: string;
let db: AppDb;
let fixtures: Record<string, unknown>;
const sessionIds = {} as Record<Shape, string>;

async function handlerFor(module: string): Promise<ApiHandler> {
	const {Route} = (await import(module)) as {Route: {options: {server: {handlers: Record<string, ApiHandler>}}}};
	return Route.options.server.handlers["GET"]!;
}

beforeAll(async () => {
	vi.setSystemTime(FIXED_NOW);
	root = mkdtempSync(join(tmpdir(), "perf-client-session-open-"));
	const home = join(root, "home");
	const projectDir = join(home, ".claude", "projects", PROJECT);
	mkdirSync(projectDir, {recursive: true});
	vi.stubEnv("HOME", home);
	vi.stubEnv("XDG_CONFIG_HOME", join(root, "config"));
	vi.stubEnv("XDG_CACHE_HOME", join(root, "cache"));

	const {openTestDb} = await import("../../src/lib/db/connection");
	db = openTestDb();
	vi.doMock("../../src/lib/db", () => ({getDb: () => db}));

	const files: string[] = [];
	for (const shape of SHAPES) {
		const cached = await generateTranscript(PERF_SHAPES[shape]);
		const file = join(projectDir, basename(cached));
		copyFileSync(cached, file);
		utimesSync(file, FIXTURE_MTIME, FIXTURE_MTIME);
		files.push(file);
		sessionIds[shape] = basename(cached, ".jsonl");
	}
	await seedFixtureDb(db, files);

	const endpoints = [
		...FRAME_ENDPOINTS.map((endpoint) => ({...endpoint, params: {}})),
		...SHAPES.flatMap((shape) => sessionEndpoints(sessionIds[shape])),
	];
	fixtures = {...STATIC_FIXTURES};
	for (const {path, module, params} of endpoints) {
		const handler = await handlerFor(module);
		const response = await handler({params, request: new Request(`http://localhost${path}`)});
		// Responses carry the temp HOME; drop it so the served bytes are the same on every machine.
		fixtures[path] = JSON.parse((await response.text()).replaceAll(root, "/fixture"));
	}
}, 600_000);

afterAll(() => {
	db.close();
	rmSync(root, {recursive: true, force: true});
	vi.doUnmock("../../src/lib/db");
	vi.unstubAllEnvs();
	vi.useRealTimers();
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

function installBrowserStubs(): void {
	installFakeEventSource();
	installFixedResizeObserver({width: 800, height: ROW_HEIGHT});
	vi.stubGlobal("matchMedia", (media: string) => ({
		matches: false,
		media,
		onchange: null,
		addEventListener: () => {},
		removeEventListener: () => {},
		addListener: () => {},
		removeListener: () => {},
		dispatchEvent: () => false,
	}));
	vi.stubGlobal("scrollTo", () => {});
	vi.stubGlobal("IntersectionObserver", InertIntersectionObserver);
	// jsdom has no layout, so scrolling an element into view is a no-op it does not implement.
	Element.prototype.scrollIntoView = () => {};
}

/** Nothing scrolls in jsdom, so no observed element ever intersects; the observer never calls back. */
class InertIntersectionObserver {
	readonly root = null;
	readonly rootMargin = "0px";
	readonly thresholds: ReadonlyArray<number> = [0];

	observe(): void {}

	unobserve(): void {}

	disconnect(): void {}

	takeRecords(): Array<IntersectionObserverEntry> {
		return [];
	}
}

const rootLoader = RootRoute.options.loader as (args: {context: {queryClient: QueryClient}}) => void;

/** The root layout's frame (providers, sidebar, main) with the real root loader and the real session route. */
function createAppRouter(queryClient: QueryClient, initialPath: string) {
	const rootRoute = createRootRouteWithContext<{queryClient: QueryClient}>()({
		loader: ({context}) => rootLoader({context}),
		component: () => (
			<ThemeProvider>
				<SettingsProvider>
					<ClaudeEventsProvider>
						<ToastProvider>
							<AppFrame collapsed={false}>
								<Outlet />
							</AppFrame>
						</ToastProvider>
					</ClaudeEventsProvider>
				</SettingsProvider>
			</ThemeProvider>
		),
	});
	const homeRoute = createRoute({getParentRoute: () => rootRoute, path: "/", component: () => null});
	const sessionRoute = SessionRoute.update({
		id: "/session/$id",
		path: "/session/$id",
		getParentRoute: () => rootRoute,
	} as never);
	return createRouter({
		routeTree: rootRoute.addChildren([homeRoute, sessionRoute as never]),
		history: createMemoryHistory({initialEntries: [initialPath]}),
		defaultPreload: "intent",
		defaultPreloadStaleTime: 0,
		context: {queryClient},
	});
}

function sidebarRow(sessionId: string): HTMLElement {
	const row = document.querySelector<HTMLElement>(`nav a[data-row-main-button][href="/session/${sessionId}"]`);
	if (row === null) throw new Error(`no sidebar row for ${sessionId}`);
	return row;
}

function mountedTranscriptRows(): number {
	return document.querySelectorAll("[data-transcript-entry-index]").length;
}

function fetchCalls(): number {
	return vi.mocked(fetch).mock.calls.length;
}

/** Waits out the router's hover-intent delay and lets every preload fetch land. */
async function waitForPreload(queryClient: QueryClient): Promise<void> {
	await new Promise<void>((resolve) => {
		setTimeout(resolve, 100);
	});
	for (let round = 0; round < 100 && queryClient.isFetching() > 0; round++) {
		await new Promise<void>((resolve) => {
			setTimeout(resolve, 0);
		});
	}
}

async function measureApp(
	initialPath: string,
	interact: (queryClient: QueryClient) => Promise<void>,
): Promise<InteractionMeasurement> {
	installBrowserStubs();
	const queryClient = new QueryClient({defaultOptions: {queries: {refetchOnWindowFocus: false}}});
	const router = createAppRouter(queryClient, initialPath);
	return measureInteraction(
		() => <RouterProvider router={router} />,
		async () => {
			await interact(queryClient);
		},
		{fixtures, queryClient},
	);
}

const COMMIT_SUBTREES = ["SessionPage", "SessionChat"] as const;

type SessionOpenMetric =
	| "commits"
	| `commits.${(typeof COMMIT_SUBTREES)[number]}`
	| "mutations"
	| "fetches"
	| "mountedRows";

function openMetrics(measurement: InteractionMeasurement, mountedRows: number): Record<SessionOpenMetric, number> {
	return {
		commits: measurement.commits,
		"commits.SessionPage": measurement.commitsBySubtree["SessionPage"] ?? 0,
		"commits.SessionChat": measurement.commitsBySubtree["SessionChat"] ?? 0,
		mutations: measurement.mutations,
		fetches: measurement.fetches.count,
		mountedRows,
	};
}

/** Checks every count before failing, so one run records all of them in results.json for `just perf-ceilings`. */
function ratchetAll(values: Record<string, number>): void {
	const failures: string[] = [];
	for (const [id, value] of Object.entries(values)) {
		try {
			ratchet(id, value);
		} catch (error) {
			failures.push((error as Error).message);
		}
	}
	if (failures.length > 0) throw new Error(failures.join("\n"));
}

/** The virtualizer mounts at most its initial window plus the overscan, in fixed-height rows, on each side (L12). */
const MAX_MOUNTED_ROWS = INITIAL_MOUNTED_TURN_COUNT + 2 * Math.ceil(TRANSCRIPT_OVERSCAN_PIXELS / ROW_HEIGHT);

describe("client lab: opening a session and switching from the sidebar", () => {
	for (const shape of SHAPES) {
		it(`${shape} open`, async () => {
			const measurement = await measureApp("/", async () => {
				fireEvent.click(sidebarRow(sessionIds[shape]));
			});
			const mountedRows = mountedTranscriptRows();

			expect(mountedRows).toBeGreaterThan(0);
			expect(mountedRows).toBeLessThanOrEqual(MAX_MOUNTED_ROWS);
			ratchetAll(metricIds(`client.sessionOpen.${shape}`, openMetrics(measurement, mountedRows)));
		});

		it(`${shape} switch`, async () => {
			let hoverPrefetchFetches = 0;
			const measurement = await measureApp(`/session/${sessionIds[SWITCH_FROM[shape]]}`, async (queryClient) => {
				const row = sidebarRow(sessionIds[shape]);
				const before = fetchCalls();
				fireEvent.mouseEnter(row);
				await waitForPreload(queryClient);
				hoverPrefetchFetches = fetchCalls() - before;
				fireEvent.click(row);
			});
			const mountedRows = mountedTranscriptRows();

			expect(mountedRows).toBeGreaterThan(0);
			expect(mountedRows).toBeLessThanOrEqual(MAX_MOUNTED_ROWS);
			ratchetAll(
				metricIds<SessionOpenMetric | "hoverPrefetch.fetches">(`client.sessionSwitch.${shape}`, {
					...openMetrics(measurement, mountedRows),
					"hoverPrefetch.fetches": hoverPrefetchFetches,
				}),
			);
		});
	}
});
