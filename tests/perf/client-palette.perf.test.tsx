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
import {cleanup, fireEvent, screen, within} from "@testing-library/react";
import {eq} from "drizzle-orm";
import {copyFileSync, mkdirSync, mkdtempSync, rmSync, utimesSync} from "node:fs";
import {tmpdir} from "node:os";
import {basename, join} from "node:path";
import {Profiler, type ReactNode} from "react";
import {afterAll, afterEach, beforeAll, describe, expect, it, vi} from "vite-plus/test";
import {AppFrame} from "../../src/components/app-frame";
import {CommandPalette, PALETTE_SEARCH_DEBOUNCE_MS} from "../../src/components/command-palette";
import {ESTIMATED_TURN_HEIGHT_PIXELS} from "../../src/components/session-chat";
import {SettingsProvider} from "../../src/components/settings-provider";
import {ThemeProvider} from "../../src/components/theme-provider";
import {ToastProvider} from "../../src/components/toast";
import {ClaudeEventsProvider} from "../../src/hooks/use-claude-events";
import {useCommandPalette} from "../../src/hooks/use-command-palette";
import type {AppDb} from "../../src/lib/db/connection";
import {projects, sessions} from "../../src/lib/db/schema";
import {Route as RootRoute} from "../../src/routes/__root";
import {Route as HomeRoute} from "../../src/routes/index";
import {generateTranscript, PERF_SHAPES, seedFixtureDb} from "./fixtures/generate-transcript";
import {installFakeEventSource} from "./harness/fake-event-source";
import {installFixedResizeObserver} from "./harness/fixed-resize-observer";
import {type Interaction, measureInteraction} from "./harness/measure-interaction";
import {metricIds} from "./perf-ids";
import {ratchet} from "./ratchet";

/**
 * Client lab benchmark for the ⌘K command palette (measurement plan §2.4, journey J6). The app frame renders the real
 * home route and the palette against responses the real API handlers produced. The case opens the palette with ⌘K,
 * types `sqlite` one keystroke at a time under fake timers, then waits out the server-search debounce. It ratchets the
 * commits, DOM mutations and fetches the open costs, the commits each keystroke costs, and the mutations and
 * `/api/search` fetches the typing burst costs.
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

const PROJECT = "-repo";
/** The cwd every generated transcript record carries. */
const FIXTURE_CWD = "/repo";
const FIXED_NOW = Date.parse("2026-09-30T12:00:00.000Z");
const FIXTURE_MTIME = new Date(FIXED_NOW - 24 * 60 * 60 * 1000);
const MAC_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";

/** A fast typist: every keystroke lands inside the search debounce of the one before it. */
const KEYSTROKE_INTERVAL_MS = 50;
const TYPED_QUERY = "sqlite";
/** The fixture session's summary, so the server search has a hit to render. */
const MATCHING_SUMMARY = "Speed up the sqlite index rebuild";

type ApiHandler = (context: {params: Record<string, string>; request: Request}) => Response | Promise<Response>;

/** Request paths the app frame, the home route and the palette fetch, each answered by its real GET handler. */
const ENDPOINTS: Array<{path: string; module: string}> = [
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
	{path: `/api/commands?cwd=${encodeURIComponent(FIXTURE_CWD)}`, module: "../../src/routes/api/commands"},
	{path: "/api/composer-defaults", module: "../../src/routes/api/composer-defaults"},
	{path: "/api/home/dismissals", module: "../../src/routes/api/home.dismissals"},
	{path: "/api/home-stats", module: "../../src/routes/api/home-stats"},
	{path: "/api/usage", module: "../../src/routes/api/usage"},
	{path: `/api/search?query=${TYPED_QUERY}`, module: "../../src/routes/api/search"},
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
	root = mkdtempSync(join(tmpdir(), "perf-client-palette-"));
	const home = join(root, "home");
	const projectDir = join(home, ".claude", "projects", PROJECT);
	mkdirSync(projectDir, {recursive: true});
	vi.stubEnv("HOME", home);
	vi.stubEnv("XDG_CONFIG_HOME", join(root, "config"));
	vi.stubEnv("XDG_CACHE_HOME", join(root, "cache"));

	const {openTestDb} = await import("../../src/lib/db/connection");
	db = openTestDb();
	vi.doMock("../../src/lib/db", () => ({getDb: () => db}));

	const cached = await generateTranscript(PERF_SHAPES.small);
	const file = join(projectDir, basename(cached));
	copyFileSync(cached, file);
	utimesSync(file, FIXTURE_MTIME, FIXTURE_MTIME);
	const [sessionId] = (await seedFixtureDb(db, [file])) as [string];
	db.index.update(projects).set({projectPath: FIXTURE_CWD}).run();
	db.index.update(sessions).set({summary: MATCHING_SUMMARY}).where(eq(sessions.id, sessionId)).run();

	fixtures = {...STATIC_FIXTURES};
	for (const {path, module} of ENDPOINTS) {
		const handler = await handlerFor(module);
		const response = await handler({params: {}, request: new Request(`http://localhost${path}`)});
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
	vi.restoreAllMocks();
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
	// ⌘K is the Mac binding; jsdom's own user agent names no platform.
	vi.spyOn(navigator, "userAgent", "get").mockReturnValue(MAC_UA);
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

/** The palette as the root layout mounts it: beside the frame, opened by its own ⌘K shortcut. */
function PaletteHost() {
	const palette = useCommandPalette();
	return <CommandPalette {...palette} />;
}

/** The root layout's frame (providers, sidebar, main) and palette, with the real root loader and home route. */
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
							<PaletteHost />
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

/**
 * Per-step tallies the whole-interaction measurement does not split: commits, DOM mutations and fetched URLs. Each
 * step settles before the next starts, so everything a step causes lands before the next boundary.
 */
function createStepTally() {
	const commits: number[] = [];
	const mutations: number[] = [];
	const fetchedUrls: string[][] = [];
	let fetchesSeen = 0;
	let step = -1;
	const observer = new MutationObserver((records) => {
		if (step >= 0) mutations[step]! += records.length;
	});

	const fetchCalls = () => vi.mocked(fetch).mock.calls.map(([input]) => String(input));
	const closeStep = () => {
		if (step < 0) return;
		mutations[step]! += observer.takeRecords().length;
		const calls = fetchCalls();
		fetchedUrls[step] = calls.slice(fetchesSeen);
		fetchesSeen = calls.length;
	};

	function Root({children}: {children: ReactNode}) {
		return (
			<Profiler
				id="palette-steps"
				onRender={() => {
					if (step >= 0) commits[step]! += 1;
				}}
			>
				{children}
			</Profiler>
		);
	}

	return {
		Root,
		startStep: () => {
			if (step < 0) {
				observer.observe(document.body, {
					subtree: true,
					childList: true,
					attributes: true,
					characterData: true,
				});
				fetchesSeen = fetchCalls().length;
			}
			closeStep();
			step++;
			commits[step] = 0;
			mutations[step] = 0;
		},
		stop: () => {
			closeStep();
			observer.disconnect();
			step = -1;
		},
		commits,
		mutations,
		fetchedUrls,
	};
}

type OpenMetric = "commits" | "mutations" | "fetches";
type SearchMetric = "commitsPerKeystroke" | "mutations" | "serverSearchFetches";

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

const sum = (values: ReadonlyArray<number>) => values.reduce((total, value) => total + value, 0);

describe("client lab: command palette", () => {
	it("open with ⌘K and search", async () => {
		installBrowserStubs();
		vi.useFakeTimers();
		vi.setSystemTime(FIXED_NOW);

		const tally = createStepTally();
		const queryClient = new QueryClient({defaultOptions: {queries: {refetchOnWindowFocus: false}}});
		const router = createAppRouter(queryClient);
		const open: Interaction = () => {
			fireEvent.keyDown(document.body, {key: "k", code: "KeyK", metaKey: true});
		};
		const keystrokes: Array<Interaction> = Array.from({length: TYPED_QUERY.length}, (_, index) => () => {
			const input = within(screen.getByRole("dialog", {name: "Search"})).getByRole("combobox");
			fireEvent.change(input, {target: {value: TYPED_QUERY.slice(0, index + 1)}});
			vi.advanceTimersByTime(KEYSTROKE_INTERVAL_MS);
		});
		const waitOutDebounce: Interaction = () => {
			vi.advanceTimersByTime(PALETTE_SEARCH_DEBOUNCE_MS);
		};
		const steps = [open, ...keystrokes, waitOutDebounce].map((step): Interaction => (context) => {
			tally.startStep();
			return step(context);
		});
		await measureInteraction(
			() => (
				<tally.Root>
					<RouterProvider router={router} />
				</tally.Root>
			),
			steps,
			{fixtures, queryClient},
		);
		tally.stop();

		const dialog = screen.getByRole("dialog", {name: "Search"});
		expect(within(dialog).getByRole("combobox")).toHaveProperty("value", TYPED_QUERY);
		// The server hit renders with its summary snippet quoted.
		expect(dialog.textContent).toContain(`“${MATCHING_SUMMARY}”`);

		const [openCommits, ...burstCommits] = tally.commits as [number, ...number[]];
		const [openMutations, ...burstMutations] = tally.mutations as [number, ...number[]];
		const [openFetches, ...burstFetches] = tally.fetchedUrls as [string[], ...string[][]];
		const keystrokeCommits = burstCommits.slice(0, TYPED_QUERY.length);
		ratchetAll({
			...metricIds<OpenMetric>("client.palette.open", {
				commits: openCommits,
				mutations: openMutations,
				// The home route already holds the palette's recent sessions, so a warm open fetches nothing.
				fetches: openFetches.length,
			}),
			...metricIds<SearchMetric>("client.palette.search", {
				commitsPerKeystroke: sum(keystrokeCommits) / keystrokeCommits.length,
				mutations: sum(burstMutations),
				serverSearchFetches: burstFetches.flat().filter((url) => url.startsWith("/api/search?")).length,
			}),
		});
	});
});
