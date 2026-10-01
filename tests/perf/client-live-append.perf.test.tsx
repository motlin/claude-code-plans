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
import {copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync} from "node:fs";
import {tmpdir} from "node:os";
import {basename, join} from "node:path";
import {afterAll, afterEach, beforeAll, describe, expect, it, vi} from "vite-plus/test";
import {AppFrame} from "../../src/components/app-frame";
import {ESTIMATED_TURN_HEIGHT_PIXELS} from "../../src/components/session-chat";
import {SettingsProvider} from "../../src/components/settings-provider";
import {ThemeProvider} from "../../src/components/theme-provider";
import {ToastProvider} from "../../src/components/toast";
import {sessionQueryKeys, type TranscriptData} from "../../src/lib/api/sessions";
import type {AppDb} from "../../src/lib/db/connection";
import {DOMAIN_EVENTS} from "../../src/lib/hook-events";
import {ClaudeEventsProvider} from "../../src/hooks/use-claude-events";
import {Route as RootRoute} from "../../src/routes/__root";
import {Route as SessionRoute} from "../../src/routes/session.$id";
import {generateTranscript, PERF_SHAPES, seedFixtureDb} from "./fixtures/generate-transcript";
import {FakeEventSource, installFakeEventSource} from "./harness/fake-event-source";
import {installFixedResizeObserver} from "./harness/fixed-resize-observer";
import {type InteractionMeasurement, measureInteraction} from "./harness/measure-interaction";
import {metricIds} from "./perf-ids";
import {ratchet} from "./ratchet";

/**
 * Client lab benchmark for live SSE traffic while a session is open (measurement plan §2.4 L7–L10). The app frame and
 * the real `/session/$id` route render the typical transcript against responses the real API handlers produced; each
 * case then delivers one event through the fake EventSource and ratchets what it cost. Every query fetch an event
 * triggers counts as a hidden reload, since none of them is a user interaction.
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

/** The open session is the typical transcript; the small one is another session the tab is not showing. */
const OPEN_SHAPE = "typical";
const OTHER_SHAPE = "small";
/** Seeds of the further small sessions that, with the other one, make four agents writing off screen. */
const MULTI_SEEDS = [2, 3, 4] as const;

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
/** The same responses with the further off-screen sessions indexed too, for the multi-writer case. */
let multiFixtures: Record<string, unknown>;
let openSessionId: string;
let otherSessionId: string;
let offScreenSessionIds: string[];
/** The last chained record of each transcript, which an appended line continues. */
const lastRecords = new Map<string, Record<string, unknown>>();

async function handlerFor(module: string): Promise<ApiHandler> {
	const {Route} = (await import(module)) as {Route: {options: {server: {handlers: Record<string, ApiHandler>}}}};
	return Route.options.server.handlers["GET"]!;
}

function lastChainedRecord(file: string): Record<string, unknown> {
	const records = readFileSync(file, "utf8")
		.split("\n")
		.filter((line) => line.length > 0)
		.map((line) => JSON.parse(line) as Record<string, unknown>);
	const last = records.filter((record) => typeof record["uuid"] === "string").at(-1);
	if (last === undefined) throw new Error(`no chained record in ${file}`);
	return last;
}

beforeAll(async () => {
	vi.setSystemTime(FIXED_NOW);
	root = mkdtempSync(join(tmpdir(), "perf-client-live-append-"));
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
	for (const shape of [OPEN_SHAPE, OTHER_SHAPE] as const) {
		const cached = await generateTranscript(PERF_SHAPES[shape]);
		const file = join(projectDir, basename(cached));
		copyFileSync(cached, file);
		utimesSync(file, FIXTURE_MTIME, FIXTURE_MTIME);
		files.push(file);
		lastRecords.set(basename(cached, ".jsonl"), lastChainedRecord(file));
	}
	[openSessionId, otherSessionId] = (await seedFixtureDb(db, files)) as [string, string];

	fixtures = await serveFixtures();

	const multiFiles: string[] = [];
	for (const seed of MULTI_SEEDS) {
		const cached = await generateTranscript(PERF_SHAPES[OTHER_SHAPE], seed);
		const file = join(projectDir, basename(cached));
		copyFileSync(cached, file);
		utimesSync(file, FIXTURE_MTIME, FIXTURE_MTIME);
		multiFiles.push(file);
		lastRecords.set(basename(cached, ".jsonl"), lastChainedRecord(file));
	}
	offScreenSessionIds = [otherSessionId, ...(await seedFixtureDb(db, multiFiles))];
	multiFixtures = await serveFixtures();
}, 600_000);

/** What the frame and the open session fetch, as the real GET handlers answer it from the current DB. */
async function serveFixtures(): Promise<Record<string, unknown>> {
	const endpoints = [
		...FRAME_ENDPOINTS.map((endpoint) => ({...endpoint, params: {}})),
		...sessionEndpoints(openSessionId),
	];
	const served: Record<string, unknown> = {...STATIC_FIXTURES};
	for (const {path, module, params} of endpoints) {
		const handler = await handlerFor(module);
		const response = await handler({params, request: new Request(`http://localhost${path}`)});
		// Responses carry the temp HOME; drop it so the served bytes are the same on every machine.
		served[path] = JSON.parse((await response.text()).replaceAll(root, "/fixture"));
	}
	return served;
}

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
		context: {queryClient},
	});
}

const APPENDED_UUID = "00000000-0000-4000-8000-00000000a99e";

/** One line continuing the session's chain, the way the watcher broadcasts a fresh assistant reply. */
function appendedLine(sessionId: string): Record<string, unknown> {
	const last = lastRecords.get(sessionId)!;
	return {
		parentUuid: last["uuid"],
		isSidechain: false,
		userType: "external",
		cwd: last["cwd"],
		sessionId,
		version: last["version"],
		gitBranch: last["gitBranch"],
		type: "assistant",
		message: {
			id: "msg_perf_live_append",
			type: "message",
			role: "assistant",
			model: "claude-opus-4-1",
			content: [{type: "text", text: "Appended while the session is open."}],
			stop_reason: null,
			stop_sequence: null,
			usage: {input_tokens: 1, output_tokens: 1},
		},
		uuid: APPENDED_UUID,
		timestamp: new Date(Date.parse(String(last["timestamp"])) + 1_000).toISOString(),
	};
}

/** The open session's summary as the recent list serves it, which is what the server broadcasts on an update. */
function openSessionSummary(): unknown {
	const recent = fixtures["/api/sessions/recent?limit=50"] as {sessions: Array<{id: string}>};
	const summary = recent.sessions.find((session) => session.id === openSessionId);
	if (summary === undefined) throw new Error(`no recent-list summary for ${openSessionId}`);
	return summary;
}

async function measureEvent(
	deliver: (eventSource: FakeEventSource) => void,
	served: Record<string, unknown> = fixtures,
): Promise<{measurement: InteractionMeasurement; queryClient: QueryClient}> {
	installBrowserStubs();
	const queryClient = new QueryClient({defaultOptions: {queries: {refetchOnWindowFocus: false}}});
	const router = createAppRouter(queryClient, `/session/${openSessionId}`);
	const measurement = await measureInteraction(
		() => <RouterProvider router={router} />,
		() => {
			deliver(FakeEventSource.last());
		},
		{fixtures: served, queryClient},
	);
	return {measurement, queryClient};
}

function openTranscriptHasAppendedLine(queryClient: QueryClient): boolean {
	const transcript = queryClient.getQueryData<TranscriptData>(sessionQueryKeys.transcript(openSessionId));
	return transcript?.records.some((record) => record["uuid"] === APPENDED_UUID) ?? false;
}

type LiveEventMetric = "commits" | "mutations" | "fetches" | "hiddenReloads";
type LiveAppendMultiMetric = "commits" | "fetches" | "hiddenReloads";

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

const CASES: Array<{name: string; appendsToOpen: boolean; deliver: (eventSource: FakeEventSource) => void}> = [
	{
		name: "appendOpen",
		appendsToOpen: true,
		deliver: (eventSource) => {
			eventSource.emit(DOMAIN_EVENTS.SESSION_LINES_APPENDED, {
				sessionId: openSessionId,
				lines: [appendedLine(openSessionId)],
			});
		},
	},
	{
		name: "appendOther",
		appendsToOpen: false,
		deliver: (eventSource) => {
			eventSource.emit(DOMAIN_EVENTS.SESSION_LINES_APPENDED, {
				sessionId: otherSessionId,
				lines: [appendedLine(otherSessionId)],
			});
		},
	},
	{
		name: "sessionUpdated",
		appendsToOpen: false,
		deliver: (eventSource) => {
			eventSource.emit(DOMAIN_EVENTS.SESSION_UPDATED, {session: openSessionSummary()});
		},
	},
	{
		name: "toolPending",
		appendsToOpen: false,
		deliver: (eventSource) => {
			eventSource.emit(DOMAIN_EVENTS.SESSION_TOOL_PENDING, {
				sessionId: openSessionId,
				toolName: "Bash",
				toolUseId: "toolu_perf_live_pending",
			});
		},
	},
	{
		// A reconnect is an error followed by `open`; it refetches only what missed events could have changed.
		name: "reconnect",
		appendsToOpen: false,
		deliver: (eventSource) => {
			eventSource.error();
			eventSource.open();
		},
	},
];

describe("client lab: live SSE events with a session open", () => {
	for (const {name, appendsToOpen, deliver} of CASES) {
		it(name, async () => {
			const {measurement, queryClient} = await measureEvent(deliver);

			expect(openTranscriptHasAppendedLine(queryClient)).toBe(appendsToOpen);
			ratchetAll(
				metricIds<LiveEventMetric>(`client.liveEvent.${name}`, {
					commits: measurement.commits,
					mutations: measurement.mutations,
					fetches: measurement.fetches.count,
					hiddenReloads: measurement.hiddenReloads,
				}),
			);
		});
	}
});

describe("client lab: four agents appending off screen with a session open", () => {
	it("appendOffScreen", async () => {
		const {measurement, queryClient} = await measureEvent((eventSource) => {
			for (const sessionId of offScreenSessionIds) {
				eventSource.emit(DOMAIN_EVENTS.SESSION_LINES_APPENDED, {sessionId, lines: [appendedLine(sessionId)]});
			}
		}, multiFixtures);

		expect({
			offScreen: offScreenSessionIds.length,
			appendedToOpen: openTranscriptHasAppendedLine(queryClient),
		}).toStrictEqual({
			offScreen: 4,
			appendedToOpen: false,
		});
		ratchetAll(
			metricIds<LiveAppendMultiMetric>("client.liveAppendMulti.appendOffScreen", {
				commits: measurement.commits,
				fetches: measurement.fetches.count,
				hiddenReloads: measurement.hiddenReloads,
			}),
		);
	});
});
