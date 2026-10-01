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
import {cleanup} from "@testing-library/react";
import {copyFileSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {basename, join} from "node:path";
import {Profiler, useState} from "react";
import {afterAll, afterEach, beforeAll, describe, expect, it, vi} from "vite-plus/test";
import {AppFrame} from "../../src/components/app-frame";
import {ESTIMATED_TURN_HEIGHT_PIXELS} from "../../src/components/session-chat";
import {SettingsProvider, settingStorageKey} from "../../src/components/settings-provider";
import {ThemeProvider} from "../../src/components/theme-provider";
import {ToastProvider} from "../../src/components/toast";
import {ClaudeEventsProvider} from "../../src/hooks/use-claude-events";
import type {AppDb} from "../../src/lib/db/connection";
import {Route as RootRoute} from "../../src/routes/__root";
import {Route as HomeRoute} from "../../src/routes/index";
import {generateTranscript, PERF_SHAPES, seedFixtureDb} from "./fixtures/generate-transcript";
import {installFakeEventSource} from "./harness/fake-event-source";
import {installFixedResizeObserver} from "./harness/fixed-resize-observer";
import {measureInteraction} from "./harness/measure-interaction";
import {metricIds} from "./perf-ids";
import {ratchet} from "./ratchet";

/**
 * Client lab benchmark for the cold launch fan-out (measurement plan §2.4 L7/L9, journey J1). Nothing is mounted or
 * cached when the measurement starts; the interaction mounts the root layout's frame with the real root loader and the
 * real `/` route, against responses the real API handlers produced. It ratchets every fetch the launch makes, their
 * response bytes, and the React commits it takes before the sidebar recents and the home main region both show rows.
 * The `localSections` case turns on the home's local sections, whose per-project memory queries add to the fan-out.
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

const CASES = ["default", "localSections"] as const;

const PROJECT = "-repo";
const FIXED_NOW = Date.parse("2026-09-30T12:00:00.000Z");
const FIXTURE_MTIME = new Date(FIXED_NOW - 24 * 60 * 60 * 1000);
const PLAN_FILENAME = "speed-up-the-index-rebuild.md";
const MEMORY_FILENAME = "build-gotchas.md";

type ApiHandler = (context: {params: Record<string, string>; request: Request}) => Response | Promise<Response>;

/** Request paths a cold launch of `/` fetches, each answered by its real GET handler. */
const ENDPOINTS: Array<{path: string; module: string; params?: Record<string, string>}> = [
	{path: "/api/projects", module: "../../src/routes/api/projects"},
	{path: "/api/plans", module: "../../src/routes/api/plans"},
	{path: "/api/sessions/recent?limit=50", module: "../../src/routes/api/sessions.recent"},
	{path: "/api/sessions/recent?limit=25", module: "../../src/routes/api/sessions.recent"},
	{path: "/api/sessions/grouped?perProject=5", module: "../../src/routes/api/sessions.grouped"},
	{path: "/api/plugins", module: "../../src/routes/api/plugins"},
	{path: "/api/plugins/user-commands", module: "../../src/routes/api/plugins.user-commands"},
	{path: "/api/sessions/active?activeTimeoutMs=60000", module: "../../src/routes/api/sessions.active"},
	{path: "/api/sessions/active?activeTimeoutMs=300000", module: "../../src/routes/api/sessions.active"},
	{path: "/api/approvals", module: "../../src/routes/api/approvals"},
	{path: "/api/notifications", module: "../../src/routes/api/notifications"},
	{path: "/api/local-account", module: "../../src/routes/api/local-account"},
	{path: "/api/application-settings", module: "../../src/routes/api/application-settings"},
	{path: "/api/prompt-history", module: "../../src/routes/api/prompt-history"},
	{path: "/api/commands", module: "../../src/routes/api/commands"},
	{path: "/api/composer-defaults", module: "../../src/routes/api/composer-defaults"},
	{path: "/api/home/dismissals", module: "../../src/routes/api/home.dismissals"},
	{path: "/api/home-stats", module: "../../src/routes/api/home-stats"},
	{path: "/api/usage", module: "../../src/routes/api/usage"},
	{
		path: `/api/projects/${PROJECT}/memories`,
		module: "../../src/routes/api/projects.$id.memories",
		params: {id: PROJECT},
	},
];

/** herdr is a live process the lab never talks to; it answers as an installation with no panes. */
const STATIC_FIXTURES: Record<string, unknown> = {
	"/api/herdr-panes": {panes: [], writesEnabled: false},
};

let root: string;
let db: AppDb;
let fixtures: Record<string, unknown>;

async function handlerFor(module: string): Promise<ApiHandler> {
	const {Route} = (await import(module)) as {Route: {options: {server: {handlers: Record<string, ApiHandler>}}}};
	return Route.options.server.handlers["GET"]!;
}

beforeAll(async () => {
	vi.setSystemTime(FIXED_NOW);
	root = mkdtempSync(join(tmpdir(), "perf-client-cold-home-"));
	const home = join(root, "home");
	const projectDir = join(home, ".claude", "projects", PROJECT);
	const memoryDir = join(projectDir, "memory");
	const plansDir = join(home, ".claude", "plans");
	mkdirSync(memoryDir, {recursive: true});
	mkdirSync(plansDir, {recursive: true});
	vi.stubEnv("HOME", home);
	vi.stubEnv("XDG_CONFIG_HOME", join(root, "config"));
	vi.stubEnv("XDG_CACHE_HOME", join(root, "cache"));

	const {openTestDb} = await import("../../src/lib/db/connection");
	const {indexMemoryFile, indexPlanFile} = await import("../../src/lib/db/indexer");
	db = openTestDb();
	vi.doMock("../../src/lib/db", () => ({getDb: () => db}));

	const cached = await generateTranscript(PERF_SHAPES.small);
	const file = join(projectDir, basename(cached));
	copyFileSync(cached, file);
	utimesSync(file, FIXTURE_MTIME, FIXTURE_MTIME);
	await seedFixtureDb(db, [file]);

	const planFile = join(plansDir, PLAN_FILENAME);
	writeFileSync(planFile, "# Speed up the index rebuild\n\nBatch the inserts.\n");
	utimesSync(planFile, FIXTURE_MTIME, FIXTURE_MTIME);
	await indexPlanFile(db.index, plansDir, PLAN_FILENAME);
	const memoryFile = join(memoryDir, MEMORY_FILENAME);
	writeFileSync(memoryFile, "# Build gotchas\n\nRebuild better-sqlite3 after a Node upgrade.\n");
	utimesSync(memoryFile, FIXTURE_MTIME, FIXTURE_MTIME);
	await indexMemoryFile(db.index, memoryFile, PROJECT);

	fixtures = {...STATIC_FIXTURES};
	for (const {path, module, params = {}} of ENDPOINTS) {
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
	vi.useRealTimers();
	localStorage.clear();
});

function installBrowserStubs(): void {
	installFakeEventSource();
	installFixedResizeObserver({width: 800, height: ESTIMATED_TURN_HEIGHT_PIXELS});
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

/** The root layout's frame (providers, sidebar, main) with the real root loader and the real home route. */
function createAppRouter(queryClient: QueryClient) {
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
	const homeRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "/",
		component: HomeRoute.options.component!,
	});
	return createRouter({
		routeTree: rootRoute.addChildren([homeRoute]),
		history: createMemoryHistory({initialEntries: ["/"]}),
		context: {queryClient},
	});
}

function sidebarRecentsRows(): number {
	return document.querySelectorAll("[data-testid=sidebar-recents] a[data-row-main-button]").length;
}

/**
 * Rows in the home main region: the action center's session, pull request and local-section rows, or, once nothing
 * needs attention, the usage stats card's heatmap days in their place.
 */
function homeMainRows(): number {
	return document.querySelectorAll("[data-home-action-center] li, [data-home-action-center] [data-date]").length;
}

/**
 * Mounts nothing until launched, so the measured interaction is the whole cold mount. Every commit after the launch is
 * counted, and the first one whose DOM shows both the sidebar recents and home main rows is remembered.
 */
function createLauncher(queryClient: QueryClient) {
	const router = createAppRouter(queryClient);
	let launch: () => void = () => {
		throw new Error("launcher is not mounted");
	};
	let commits = 0;
	let commitsToRows: number | undefined;

	function Launcher() {
		const [launched, setLaunched] = useState(false);
		launch = () => setLaunched(true);
		return launched ? (
			<Profiler
				id="cold-launch"
				onRender={() => {
					commits++;
					if (commitsToRows === undefined && sidebarRecentsRows() > 0 && homeMainRows() > 0) {
						commitsToRows = commits;
					}
				}}
			>
				<RouterProvider router={router} />
			</Profiler>
		) : null;
	}

	return {Launcher, launch: () => launch(), commitsToRows: () => commitsToRows};
}

type ColdHomeMetric = "fetches" | "responseBytes" | "commitsToRows";

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

describe("client lab: cold launch of the home page", () => {
	for (const name of CASES) {
		it(name, async () => {
			installBrowserStubs();
			vi.useFakeTimers();
			vi.setSystemTime(FIXED_NOW);
			if (name === "localSections") {
				localStorage.setItem(settingStorageKey("homeShowLocalSections"), "true");
			}
			const queryClient = new QueryClient({defaultOptions: {queries: {refetchOnWindowFocus: false}}});
			const launcher = createLauncher(queryClient);
			const measurement = await measureInteraction(() => <launcher.Launcher />, launcher.launch, {
				fixtures,
				queryClient,
			});

			expect(sidebarRecentsRows()).toBeGreaterThan(0);
			expect(homeMainRows()).toBeGreaterThan(0);
			const commitsToRows = launcher.commitsToRows();
			if (commitsToRows === undefined) throw new Error("no commit showed both the sidebar recents and home rows");
			ratchetAll(
				metricIds<ColdHomeMetric>(`client.coldHome.${name}`, {
					fetches: measurement.fetches.count,
					responseBytes: measurement.fetches.bytes,
					commitsToRows,
				}),
			);
		});
	}
});
