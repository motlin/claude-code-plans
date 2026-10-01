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
import {cleanup, fireEvent, screen} from "@testing-library/react";
import {copyFileSync, mkdirSync, mkdtempSync, rmSync, utimesSync} from "node:fs";
import {tmpdir} from "node:os";
import {basename, join} from "node:path";
import {afterAll, afterEach, beforeAll, describe, expect, it, vi} from "vite-plus/test";
import {AppFrame} from "../../src/components/app-frame";
import {ESTIMATED_TURN_HEIGHT_PIXELS} from "../../src/components/session-chat";
import {SettingsProvider} from "../../src/components/settings-provider";
import {ThemeProvider} from "../../src/components/theme-provider";
import {ToastProvider} from "../../src/components/toast";
import type {AppDb} from "../../src/lib/db/connection";
import {projects} from "../../src/lib/db/schema";
import {FILE_MENTION_DEBOUNCE_MS} from "../../src/lib/file-mentions";
import {ClaudeEventsProvider} from "../../src/hooks/use-claude-events";
import {COMPOSER_DRAFT_DEBOUNCE_MS} from "../../src/hooks/use-composer-draft";
import {Route as RootRoute} from "../../src/routes/__root";
import {Route as HomeRoute} from "../../src/routes/index";
import {Route as SessionRoute} from "../../src/routes/session.$id";
import {generateTranscript, PERF_SHAPES, seedFixtureDb} from "./fixtures/generate-transcript";
import {installFakeEventSource} from "./harness/fake-event-source";
import {installFixedResizeObserver} from "./harness/fixed-resize-observer";
import {type Interaction, measureInteraction} from "./harness/measure-interaction";
import {createRenderCensus} from "./harness/render-census";
import {metricIds} from "./perf-ids";
import {ratchet} from "./ratchet";

/**
 * Client lab benchmark for typing in the composer (measurement plan §2.4 L11): the per-keystroke census. The app
 * frame renders the real `/session/$id` route (the small transcript) or the real home route against responses the real
 * API handlers produced. Each case types into the composer under fake timers, one keystroke per step, and ratchets the
 * commits and distinct components each keystroke renders, the live QueryCache listeners and ClaudeEvents consumers,
 * and the localStorage writes the debounced draft makes.
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
const ROW_HEIGHT = ESTIMATED_TURN_HEIGHT_PIXELS;

/** A fast typist: every keystroke lands inside the draft debounce of the one before it. */
const KEYSTROKE_INTERVAL_MS = 50;
const TYPED_TEXT = "fix tests!";

type ApiHandler = (context: {params: Record<string, string>; request: Request}) => Response | Promise<Response>;

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

/** Request paths the session page fetches, each answered by its real GET handler. */
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

/** Request paths the session and home composers fetch: slash commands, prompt history and launch defaults. */
function composerEndpoints(
	id: string,
	projectPath: string,
): Array<{path: string; module: string; params: Record<string, string>}> {
	return [
		{
			path: `/api/commands?cwd=${encodeURIComponent(projectPath)}`,
			module: "../../src/routes/api/commands",
			params: {},
		},
		{path: `/api/prompt-history?sessionId=${id}`, module: "../../src/routes/api/prompt-history", params: {}},
		{path: "/api/prompt-history", module: "../../src/routes/api/prompt-history", params: {}},
		{path: "/api/commands", module: "../../src/routes/api/commands", params: {}},
		{path: "/api/composer-defaults", module: "../../src/routes/api/composer-defaults", params: {}},
		{path: "/api/home/dismissals", module: "../../src/routes/api/home.dismissals", params: {}},
		{path: "/api/home-stats", module: "../../src/routes/api/home-stats", params: {}},
		{path: "/api/usage", module: "../../src/routes/api/usage", params: {}},
		{path: "/api/sessions/recent?limit=25", module: "../../src/routes/api/sessions.recent", params: {}},
	];
}

/** herdr is a live process the lab never talks to; it answers as an installation with no panes. */
const STATIC_FIXTURES: Record<string, unknown> = {
	"/api/herdr-panes": {panes: [], writesEnabled: false},
};

let root: string;
let db: AppDb;
let fixtures: Record<string, unknown>;
let sessionId: string;

async function handlerFor(module: string): Promise<ApiHandler> {
	const {Route} = (await import(module)) as {Route: {options: {server: {handlers: Record<string, ApiHandler>}}}};
	return Route.options.server.handlers["GET"]!;
}

async function serveFromHandlers(
	endpoints: Array<{path: string; module: string; params: Record<string, string>}>,
): Promise<void> {
	for (const {path, module, params} of endpoints) {
		const handler = await handlerFor(module);
		const response = await handler({params, request: new Request(`http://localhost${path}`)});
		// Responses carry the temp HOME; drop it so the served bytes are the same on every machine.
		fixtures[path] = JSON.parse((await response.text()).replaceAll(root, "/fixture"));
	}
}

beforeAll(async () => {
	vi.setSystemTime(FIXED_NOW);
	root = mkdtempSync(join(tmpdir(), "perf-client-composer-"));
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
	[sessionId] = (await seedFixtureDb(db, [file])) as [string];
	// The composer renders only for a session with a project directory, which indexing resolves from disk; pin it to
	// the transcript's cwd instead of creating that directory.
	db.index.update(projects).set({projectPath: FIXTURE_CWD}).run();

	fixtures = {
		...STATIC_FIXTURES,
		[`/api/sessions/${sessionId}/files?markIgnored=1`]: {
			kind: "listing",
			dir: FIXTURE_CWD,
			entries: [
				{name: "src", relPath: "src", isDirectory: true},
				{name: "package.json", relPath: "package.json", isDirectory: false},
			],
			partial: false,
		},
	};
	await serveFromHandlers([
		...FRAME_ENDPOINTS.map((endpoint) => ({...endpoint, params: {}})),
		...sessionEndpoints(sessionId),
	]);
	await serveFromHandlers(composerEndpoints(sessionId, FIXTURE_CWD));
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

/** The root layout's frame (providers, sidebar, main) with the real root loader and the real home and session routes. */
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
	const homeRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "/",
		component: HomeRoute.options.component!,
	});
	const sessionRoute = SessionRoute.update({
		id: "/session/$id",
		path: "/session/$id",
		getParentRoute: () => rootRoute,
	} as never);
	return createRouter({
		routeTree: rootRoute.addChildren([homeRoute, sessionRoute as never]),
		history: createMemoryHistory({initialEntries: [initialPath]}),
		context: {queryClient},
	});
}

const SURFACES = {
	session: {path: () => `/session/${sessionId}`, placeholder: "Type / for commands"},
	home: {path: () => "/", placeholder: "Describe a task or ask a question"},
} as const;
type Surface = keyof typeof SURFACES;

/** One keystroke: the composer's value grows to `value`, then the typist's pause (plus `extraMs`) elapses. */
function keystroke(placeholder: string, value: string, extraMs = 0): () => void {
	return () => {
		fireEvent.change(screen.getByPlaceholderText(placeholder), {target: {value}});
		vi.advanceTimersByTime(KEYSTROKE_INTERVAL_MS + extraMs);
	};
}

interface ComposerCase {
	name: string;
	surfaces: ReadonlyArray<Surface>;
	keystrokes: (placeholder: string) => Array<() => void>;
	/** The menu the last keystroke opens, if any. */
	opensMenu?: string;
}

const CASES: Array<ComposerCase> = [
	{
		name: "typing",
		surfaces: ["session", "home"],
		// The last keystroke also waits out the draft debounce, so the one coalesced localStorage write lands.
		keystrokes: (placeholder) =>
			Array.from({length: TYPED_TEXT.length}, (_, index) =>
				keystroke(
					placeholder,
					TYPED_TEXT.slice(0, index + 1),
					index === TYPED_TEXT.length - 1 ? COMPOSER_DRAFT_DEBOUNCE_MS : 0,
				),
			),
	},
	{
		name: "slashMenu",
		surfaces: ["session", "home"],
		keystrokes: (placeholder) => [keystroke(placeholder, "/", COMPOSER_DRAFT_DEBOUNCE_MS)],
		opensMenu: "Slash commands",
	},
	{
		// Only the session composer has a working directory to mention files from.
		name: "mentionMenu",
		surfaces: ["session"],
		keystrokes: (placeholder) => [
			keystroke(placeholder, "@", Math.max(FILE_MENTION_DEBOUNCE_MS, COMPOSER_DRAFT_DEBOUNCE_MS)),
		],
		opensMenu: "Mention suggestions",
	},
];

type ComposerMetric =
	| "commitsPerKeystroke"
	| "componentsPerKeystroke"
	| "sessionChatRendersPerKeystroke"
	| "queryCacheListeners"
	| "claudeEventsConsumers"
	| "localStorageWrites";

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

async function measureComposer(surface: Surface, composerCase: ComposerCase): Promise<Record<ComposerMetric, number>> {
	installBrowserStubs();
	vi.useFakeTimers();
	vi.setSystemTime(FIXED_NOW);
	const setItem = vi.spyOn(Storage.prototype, "setItem");
	const removeItem = vi.spyOn(Storage.prototype, "removeItem");
	const storageWrites = () => setItem.mock.calls.length + removeItem.mock.calls.length;
	let writesBefore = 0;

	const census = createRenderCensus();
	const queryClient = new QueryClient({defaultOptions: {queries: {refetchOnWindowFocus: false}}});
	const router = createAppRouter(queryClient, SURFACES[surface].path());
	const keystrokes = composerCase.keystrokes(SURFACES[surface].placeholder);
	const steps: Array<Interaction> = keystrokes.map((press, index) => () => {
		if (index === 0) writesBefore = storageWrites();
		census.startStep();
		press();
	});
	const measurement = await measureInteraction(
		() => (
			<census.Root>
				<RouterProvider router={router} />
			</census.Root>
		),
		steps,
		{fixtures, queryClient},
	);
	census.stop();

	if (composerCase.opensMenu !== undefined) {
		expect(screen.getByLabelText(composerCase.opensMenu)).toBeTruthy();
	}
	const perKeystroke = (total: number) => total / keystrokes.length;
	const censusSteps = census.steps();
	return {
		commitsPerKeystroke: perKeystroke(measurement.commits),
		componentsPerKeystroke: perKeystroke(censusSteps.reduce((sum, step) => sum + Object.keys(step).length, 0)),
		sessionChatRendersPerKeystroke: perKeystroke(
			censusSteps.reduce((sum, step) => sum + (step["SessionChat"] ?? 0), 0),
		),
		queryCacheListeners: measurement.subscriptions.queryCacheListeners,
		claudeEventsConsumers: census.contextConsumers(ClaudeEventsProvider),
		localStorageWrites: storageWrites() - writesBefore,
	};
}

describe("client lab: composer keystroke census", () => {
	for (const composerCase of CASES) {
		for (const surface of composerCase.surfaces) {
			it(`${surface} ${composerCase.name}`, async () => {
				const {sessionChatRendersPerKeystroke, ...metrics} = await measureComposer(surface, composerCase);

				const prefix = `client.composer.${surface}.${composerCase.name}`;
				ratchetAll({
					...metricIds<Exclude<ComposerMetric, "sessionChatRendersPerKeystroke">>(prefix, metrics),
					...(surface === "session"
						? metricIds<"sessionChatRendersPerKeystroke">(prefix, {sessionChatRendersPerKeystroke})
						: {}),
				});
			});
		}
	}
});
