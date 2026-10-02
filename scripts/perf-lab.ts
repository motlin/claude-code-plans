/**
 * Hermetic browser lab (measurement plan §2.4 L14, §4.6). Seeds a fixture HOME (the README screenshot fixtures plus
 * generated perf transcripts), spawns `vp dev --strictPort` on :7538, and drives Playwright's headless Chromium through
 * journeys J1–J6. Per journey it records CDP `Performance.getMetrics` deltas (style recalcs and layouts), the request
 * count and the layout-shift sum, repeats the whole set and writes min/median/max to `.llm/perf/lab-browser-<sha>.json`.
 *
 * Counts depend on frame boundaries, so most stay diagnostic (plan §7 decision 4). `--ratchet` checks the median of only
 * the metrics `just perf-lab-stability` proved stable (RATCHETED_LAB_METRICS) against tests/perf/ceilings.json as
 * `browser.<journey>.<metric>`.
 */

import {execFileSync, spawn, type ChildProcess} from "node:child_process";
import {
	copyFileSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	statSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import {get} from "node:http";
import {tmpdir} from "node:os";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {chromium, type BrowserContext, type CDPSession, type Page} from "playwright";
import {generateTranscript, PERF_SHAPES} from "../tests/perf/fixtures/generate-transcript";
import {ratchet} from "../tests/perf/ratchet";
import {FIXED_TIME, fixtureServerEnv, seedFixtureHome, stopDevServer} from "./screenshots";

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT_DIRECTORY = join(REPOSITORY_ROOT, ".llm", "perf");
const DEFAULT_PORT = 7538;
const REAL_APP_PORT = 7526;
const DEFAULT_RUNS = 5;
const MIN_RAF_HZ = 50;
const PREFLIGHT_FRAMES = 30;
const VIEWPORT = {width: 1280, height: 800} as const;

export const JOURNEYS = ["J1", "J2", "J3", "J4", "J5", "J6"] as const;
export type JourneyId = (typeof JOURNEYS)[number];

export const JOURNEY_TITLES: Record<JourneyId, string> = {
	J1: "Cold launch to Home",
	J2: "Open a session by URL (typical)",
	J3: "Switch sessions from the sidebar",
	J4: "Live append painted",
	J5: "Type in the composer",
	J6: "⌘K palette open + search",
};

export interface CdpMetricsPayload {
	metrics: Array<{name: string; value: number}>;
}

export interface MetricsDelta {
	recalcStyleCount: number;
	layoutCount: number;
	recalcStyleDurationMs: number;
	layoutDurationMs: number;
}

export interface PreflightProbe {
	visibilityState: string;
	rafTimestamps: number[];
}

export interface LayoutShiftEntry {
	value: number;
	hadRecentInput: boolean;
}

export interface JourneySample extends MetricsDelta {
	requests: number;
	layoutShift: number;
}

export interface Summary {
	min: number;
	median: number;
	max: number;
	values: number[];
}

export interface LabArgs {
	port: number;
	runs: number;
	journeys: JourneyId[];
	/** Check the stable metrics against tests/perf/ceilings.json and exit non-zero on any failure. */
	ratchet: boolean;
}

function metricValue(payload: CdpMetricsPayload, name: string): number {
	const metric = payload.metrics.find((entry) => entry.name === name);
	if (metric === undefined) throw new Error(`CDP Performance.getMetrics payload has no ${name} metric`);
	return metric.value;
}

function counterDelta(before: CdpMetricsPayload, after: CdpMetricsPayload, name: string): number {
	const start = metricValue(before, name);
	const end = metricValue(after, name);
	if (end < start) {
		throw new Error(`${name} went backwards from ${start} to ${end}; the journey crossed a renderer swap`);
	}
	return end - start;
}

/** Durations arrive in seconds; report milliseconds rounded to the microsecond so float noise does not leak. */
function secondsToMs(seconds: number): number {
	return Math.round(seconds * 1_000_000) / 1000;
}

export function metricsDelta(before: CdpMetricsPayload, after: CdpMetricsPayload): MetricsDelta {
	return {
		recalcStyleCount: counterDelta(before, after, "RecalcStyleCount"),
		layoutCount: counterDelta(before, after, "LayoutCount"),
		recalcStyleDurationMs: secondsToMs(counterDelta(before, after, "RecalcStyleDuration")),
		layoutDurationMs: secondsToMs(counterDelta(before, after, "LayoutDuration")),
	};
}

export function rafRateHz(timestamps: readonly number[]): number {
	const first = timestamps[0];
	const last = timestamps.at(-1);
	if (timestamps.length < 2 || first === undefined || last === undefined || last <= first) return 0;
	return ((timestamps.length - 1) * 1000) / (last - first);
}

/** Reasons to abort: a hidden or throttled tab measures frame scheduling, not the app (the hidden-tab trap). */
export function preflightFailures(probe: PreflightProbe): string[] {
	const failures: string[] = [];
	if (probe.visibilityState !== "visible") {
		failures.push(`document.visibilityState is "${probe.visibilityState}", expected "visible"`);
	}
	const hz = rafRateHz(probe.rafTimestamps);
	if (hz < MIN_RAF_HZ) {
		failures.push(`requestAnimationFrame runs at ${hz.toFixed(1)} Hz, expected at least ${MIN_RAF_HZ} Hz`);
	}
	return failures;
}

/** Lab CLS for one journey: the layout-shift values not excused by recent input. */
export function layoutShiftSum(entries: readonly LayoutShiftEntry[]): number {
	return entries.reduce((sum, entry) => (entry.hadRecentInput ? sum : sum + entry.value), 0);
}

export function summarize(values: number[]): Summary {
	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	const median =
		sorted.length % 2 === 1 ? (sorted[middle] ?? 0) : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
	return {min: sorted[0] ?? 0, median, max: sorted.at(-1) ?? 0, values};
}

function isJourney(value: string): value is JourneyId {
	return (JOURNEYS as readonly string[]).includes(value);
}

function positiveInteger(flag: string, raw: string | undefined): number {
	const value = Number(raw);
	if (!Number.isInteger(value) || value <= 0) throw new Error(`${flag} must be a positive integer, got ${raw}`);
	return value;
}

export function parseLabArgs(argv: readonly string[]): LabArgs {
	let port = DEFAULT_PORT;
	let runs = DEFAULT_RUNS;
	let ratchetMode = false;
	const journeys = new Set<JourneyId>();
	for (let index = 0; index < argv.length; index += 1) {
		const argument = argv[index];
		if (argument === "--port") {
			port = positiveInteger("--port", argv[++index]);
		} else if (argument === "--runs") {
			runs = positiveInteger("--runs", argv[++index]);
		} else if (argument === "--journey") {
			const journey = argv[++index] ?? "";
			if (!isJourney(journey)) throw new Error(`Unknown journey: ${journey}`);
			journeys.add(journey);
		} else if (argument === "--ratchet") {
			ratchetMode = true;
		} else {
			throw new Error(`Unknown argument: ${argument}`);
		}
	}
	if (port === REAL_APP_PORT) {
		throw new Error(`Refusing port ${REAL_APP_PORT}: it is the user's real Claude Code Browser server`);
	}
	return {
		port,
		runs,
		journeys: journeys.size === 0 ? [...JOURNEYS] : JOURNEYS.filter((id) => journeys.has(id)),
		ratchet: ratchetMode,
	};
}

// ---------------------------------------------------------------------------------------------------------------
// Fixture HOME and server
// ---------------------------------------------------------------------------------------------------------------

/** The J2/J4 session's mtime, newest in the sidebar ahead of the screenshot fixtures. */
const OPEN_SESSION_MTIME_MS = FIXED_TIME - 60_000;

interface LabFixture {
	root: string;
	home: string;
	/** Session opened cold by URL (J2) and appended to while open (J4), the typical shape. */
	openSessionId: string;
	openSessionPath: string;
	openSessionBytes: number;
	/** The open session's seeded transcript, restored before each run so every run opens the same transcript. */
	openSessionSeed: Buffer;
	/** Session switched to from the sidebar (J3) and typed into (J5), the small shape. */
	switchSessionId: string;
	switchSessionBytes: number;
}

function sessionIdOf(transcript: string): string {
	for (const line of transcript.split("\n")) {
		const sessionId = (JSON.parse(line) as {sessionId?: unknown}).sessionId;
		if (typeof sessionId === "string") return sessionId;
	}
	throw new Error("Generated transcript has no sessionId");
}

/**
 * The fixture root lives in the OS temp directory, not under `.llm/` like the screenshot fixture: the watcher ignores
 * `.llm` subtrees, which would silence J4. The indexer also sets a project's path by decoding its directory name
 * (`-a-b-c` → `/a/b/c`) against the filesystem, and the session page shows its composer only when that resolves.
 * Decoding turns every `-` before the last segment into `/`, so the root's path must contain neither `-` nor `.`.
 */
function createFixtureRoot(): string {
	for (const base of [tmpdir(), "/tmp"]) {
		const root = mkdtempSync(join(realpathSync(base), "ccblab"));
		if (!/[-.]/.test(root)) return root;
		rmSync(root, {recursive: true, force: true});
	}
	throw new Error("No temp directory without '-' or '.' in its path to host the perf lab fixture");
}

async function seedLabFixture(): Promise<LabFixture> {
	const root = createFixtureRoot();
	const home = seedFixtureHome(root);
	const workDirectory = join(root, "perf-app");
	mkdirSync(workDirectory);
	const projectDirectory = join(home, ".claude", "projects", workDirectory.replaceAll("/", "-"));
	mkdirSync(projectDirectory, {recursive: true});
	const place = async (shape: (typeof PERF_SHAPES)["small"], seed: number, mtimeMs: number) => {
		const source = await generateTranscript(shape, seed);
		const sessionId = sessionIdOf(readFileSync(source, "utf8"));
		const path = join(projectDirectory, `${sessionId}.jsonl`);
		copyFileSync(source, path);
		utimesSync(path, mtimeMs / 1000, mtimeMs / 1000);
		return {sessionId, path};
	};
	// Newest first in the sidebar, ahead of the screenshot fixtures (which top out at FIXED_TIME - 1h).
	const open = await place(PERF_SHAPES.typical, 1, OPEN_SESSION_MTIME_MS);
	const switched = await place(PERF_SHAPES.small, 2, FIXED_TIME - 120_000);
	return {
		root,
		home,
		openSessionId: open.sessionId,
		openSessionPath: open.path,
		openSessionBytes: statSync(open.path).size,
		openSessionSeed: readFileSync(open.path),
		switchSessionId: switched.sessionId,
		switchSessionBytes: statSync(switched.path).size,
	};
}

/** The open session as the server's index sees it: what the sidebar and session list are rendered from. */
async function indexedOpenSession(
	baseUrl: string,
	fixture: LabFixture,
): Promise<{messageCount: number; mtime: string} | undefined> {
	const rows = JSON.parse(await httpGet(`${baseUrl}/api/sessions/lookup?ids=${fixture.openSessionId}`)) as Array<{
		messageCount: number;
		mtime: string;
	}>;
	return rows[0];
}

/**
 * Before each run, restore the J4 session to its seeded transcript and mtime, so every run opens the same transcript
 * (J2) and the session no longer counts as active. The server's watcher sees the file shrink below its read offset and
 * moves the offset back to the new end, so the run's append (J4) is still read. Waits until the index holds the
 * seeded transcript again, so the run does not race the watcher's re-index.
 */
async function resetOpenSession(baseUrl: string, fixture: LabFixture, seededMessageCount: number): Promise<void> {
	writeFileSync(fixture.openSessionPath, fixture.openSessionSeed);
	utimesSync(fixture.openSessionPath, OPEN_SESSION_MTIME_MS / 1000, OPEN_SESSION_MTIME_MS / 1000);
	const mtime = new Date(OPEN_SESSION_MTIME_MS).toISOString();
	for (let attempt = 0; attempt < 240; attempt += 1) {
		const indexed = await indexedOpenSession(baseUrl, fixture).catch(() => undefined);
		if (indexed?.messageCount === seededMessageCount && indexed.mtime === mtime) return;
		await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
	}
	throw new Error(`The lab server did not re-index the reset session ${fixture.openSessionId} within 60 seconds`);
}

function startServer(fixture: LabFixture, port: number): {process: ChildProcess; output: string[]} {
	const output: string[] = [];
	const server = spawn("pnpm", ["exec", "vp", "dev", "--host", "127.0.0.1", "--strictPort"], {
		cwd: REPOSITORY_ROOT,
		detached: process.platform !== "win32",
		env: fixtureServerEnv(process.env, {fixtureRoot: fixture.root, fixtureHome: fixture.home, port}),
		stdio: ["ignore", "pipe", "pipe"],
	});
	const remember = (chunk: Buffer) => {
		output.push(chunk.toString());
		if (output.length > 100) output.shift();
	};
	server.stdout?.on("data", remember);
	server.stderr?.on("data", remember);
	return {process: server, output};
}

/**
 * Plain `node:http` rather than `fetch`: under heavy load Node's undici can throw `setTypeOfService EINVAL` from a
 * socket callback while the server is still starting, which no try/catch around `fetch` can intercept.
 */
function httpGet(url: string): Promise<string> {
	return new Promise((resolvePromise, reject) => {
		const request = get(url, {agent: false}, (response) => {
			const chunks: Buffer[] = [];
			response.on("data", (chunk: Buffer) => chunks.push(chunk));
			response.on("error", reject);
			response.on("end", () => {
				if (response.statusCode === 200) resolvePromise(Buffer.concat(chunks).toString("utf8"));
				else reject(new Error(`GET ${url} returned ${response.statusCode}`));
			});
		});
		request.on("error", reject);
	});
}

async function waitForIdleIndex(baseUrl: string, server: ChildProcess, output: string[]): Promise<void> {
	for (let attempt = 0; attempt < 240; attempt += 1) {
		if (server.exitCode !== null)
			throw new Error(`Lab dev server exited with ${server.exitCode}:\n${output.join("")}`);
		try {
			if (!(JSON.parse(await httpGet(`${baseUrl}/api/indexing-status`)) as {isIndexing: boolean}).isIndexing)
				return;
		} catch {
			// Still starting.
		}
		await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
	}
	throw new Error(`Lab dev server was not ready and indexed after 60 seconds:\n${output.join("")}`);
}

// ---------------------------------------------------------------------------------------------------------------
// Browser measurement
// ---------------------------------------------------------------------------------------------------------------

/**
 * Pins the client clock to the fixtures' era like scripts/screenshots.ts, so relative-time sidebars show the fixture
 * sessions, and records layout shifts into a buffer the journeys slice.
 */
const INIT_SCRIPT = `
  {
    globalThis.__name = (target) => target;
    const NativeDate = Date;
    class PinnedDate extends NativeDate {
      constructor(...values) {
        super(...(values.length === 0 ? [${FIXED_TIME}] : values));
      }
      static now() {
        return ${FIXED_TIME};
      }
    }
    globalThis.Date = PinnedDate;
    globalThis.__perfLabShifts = [];
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          globalThis.__perfLabShifts.push({value: entry.value, hadRecentInput: entry.hadRecentInput});
        }
      }).observe({type: "layout-shift", buffered: true});
    } catch {}
  }
`;

interface Probe {
	page: Page;
	cdp: CDPSession;
	requests: () => number;
}

async function prepareContext(context: BrowserContext, blocked: string[]): Promise<void> {
	await context.route("**/*", async (route) => {
		const url = new URL(route.request().url());
		if (url.hostname === "127.0.0.1") {
			await route.continue();
		} else {
			// fonts.googleapis.com and anything else off-box: a network dependency would make the counts flaky.
			blocked.push(url.hostname);
			await route.abort();
		}
	});
	await context.addInitScript(INIT_SCRIPT);
}

async function openProbe(context: BrowserContext): Promise<Probe> {
	const page = await context.newPage();
	let requests = 0;
	page.on("request", () => {
		requests += 1;
	});
	const cdp = await context.newCDPSession(page);
	await cdp.send("Performance.enable");
	return {page, cdp, requests: () => requests};
}

async function runPreflight(page: Page): Promise<void> {
	await page.bringToFront();
	const probe = await page.evaluate(
		(frames) =>
			new Promise<{visibilityState: string; rafTimestamps: number[]}>((resolvePromise) => {
				const rafTimestamps: number[] = [];
				const tick = (timestamp: number) => {
					rafTimestamps.push(timestamp);
					if (rafTimestamps.length <= frames) requestAnimationFrame(tick);
					else resolvePromise({visibilityState: document.visibilityState, rafTimestamps});
				};
				requestAnimationFrame(tick);
			}),
		PREFLIGHT_FRAMES,
	);
	const failures = preflightFailures(probe);
	if (failures.length > 0) throw new Error(`Browser lab preflight failed:\n  ${failures.join("\n  ")}`);
}

/** Wait until the DOM has been quiet for 300 ms (3 s cap), then two frames so the last commit is painted. */
async function settle(page: Page): Promise<void> {
	await page.evaluate(
		() =>
			new Promise<void>((resolvePromise) => {
				let quiet = setTimeout(finish, 300);
				const cap = setTimeout(finish, 3_000);
				const observer = new MutationObserver(() => {
					clearTimeout(quiet);
					quiet = setTimeout(finish, 300);
				});
				function finish(): void {
					clearTimeout(quiet);
					clearTimeout(cap);
					observer.disconnect();
					requestAnimationFrame(() => requestAnimationFrame(() => resolvePromise()));
				}
				observer.observe(document.documentElement, {
					attributes: true,
					characterData: true,
					childList: true,
					subtree: true,
				});
			}),
	);
}

async function shiftCount(page: Page): Promise<number> {
	return page.evaluate(() => (globalThis as unknown as {__perfLabShifts: unknown[]}).__perfLabShifts.length);
}

async function shiftsSince(page: Page, start: number): Promise<LayoutShiftEntry[]> {
	return page.evaluate(
		(from) => (globalThis as unknown as {__perfLabShifts: LayoutShiftEntry[]}).__perfLabShifts.slice(from),
		start,
	);
}

/**
 * Measures one interaction in the current document. Navigation journeys pass `navigates` so the baseline is taken
 * on a same-origin blank page: the renderer stays the same and the layout-shift buffer starts empty.
 */
async function measure(probe: Probe, interaction: () => Promise<void>): Promise<JourneySample> {
	const before = (await probe.cdp.send("Performance.getMetrics")) as CdpMetricsPayload;
	const requestsBefore = probe.requests();
	const shiftsBefore = await shiftCount(probe.page).catch(() => 0);
	const urlBefore = probe.page.url();
	await interaction();
	await settle(probe.page);
	const after = (await probe.cdp.send("Performance.getMetrics")) as CdpMetricsPayload;
	const navigated = probe.page.url() !== urlBefore && !(await sameDocument(probe.page));
	const shifts = await shiftsSince(probe.page, navigated ? 0 : shiftsBefore);
	return {
		...metricsDelta(before, after),
		requests: probe.requests() - requestsBefore,
		layoutShift: Math.round(layoutShiftSum(shifts) * 10_000) / 10_000,
	};
}

/** True while the document that took the baseline is still the one on screen (SPA navigation). */
async function sameDocument(page: Page): Promise<boolean> {
	return page.evaluate(() => (globalThis as unknown as {__perfLabMarker?: boolean}).__perfLabMarker === true);
}

async function markDocument(page: Page): Promise<void> {
	await page.evaluate(() => {
		(globalThis as unknown as {__perfLabMarker: boolean}).__perfLabMarker = true;
	});
}

const LAST_ROW = '[data-testid="transcript-row"][data-perf-last]';
const ANY_ROW = '[data-testid="transcript-row"]';

function sessionView(sessionId: string): string {
	return `[data-perf-session=${JSON.stringify(sessionId)}]`;
}

function appendedLines(fixture: LabFixture, run: number): string {
	const lines = readFileSync(fixture.openSessionPath, "utf8").trimEnd().split("\n");
	const last = JSON.parse(lines.at(-1) ?? "{}") as {uuid?: string};
	const parentUuid = typeof last.uuid === "string" ? last.uuid : null;
	const base = {
		parentUuid,
		isSidechain: false,
		userType: "external",
		cwd: "/repo",
		sessionId: fixture.openSessionId,
		version: "2.0.0-fixture",
		gitBranch: "main",
	};
	const timestamp = new Date().toISOString();
	const user = {
		...base,
		type: "user",
		uuid: `00000000-0000-4000-8000-00000000${String(run).padStart(4, "0")}`,
		timestamp,
		message: {role: "user", content: `Perf lab live append ${run}: keep the row painted.`},
	};
	const assistant = {
		...base,
		parentUuid: user.uuid,
		type: "assistant",
		uuid: `00000000-0000-4000-8000-10000000${String(run).padStart(4, "0")}`,
		timestamp,
		message: {
			id: `msg_perf_lab_${run}`,
			type: "message",
			role: "assistant",
			model: "claude-fixture",
			content: [{type: "text", text: `Perf lab reply ${run}: appended while the session was open.`}],
			stop_reason: "end_turn",
			stop_sequence: null,
			usage: {input_tokens: 1, output_tokens: 1},
		},
	};
	return `${JSON.stringify(user)}\n${JSON.stringify(assistant)}\n`;
}

async function runJourneys(
	context: BrowserContext,
	baseUrl: string,
	fixture: LabFixture,
	journeys: readonly JourneyId[],
	run: number,
): Promise<Partial<Record<JourneyId, JourneySample>>> {
	const probe = await openProbe(context);
	const {page} = probe;
	const samples: Partial<Record<JourneyId, JourneySample>> = {};
	const want = new Set(journeys);
	const blank = `${baseUrl}/api/indexing-status`;

	await page.goto(blank);
	await runPreflight(page);

	const cold = async (id: JourneyId, path: string, anchor: string) => {
		await page.goto(blank);
		samples[id] = await measure(probe, async () => {
			await page.goto(`${baseUrl}${path}`, {waitUntil: "domcontentloaded"});
			await page.locator(anchor).first().waitFor({state: "attached", timeout: 30_000});
		});
		await markDocument(page);
	};

	if (want.has("J1")) await cold("J1", "/", '[data-perf-region="sidebar_recents"] [data-row-main-button]');
	// J2 always runs: J3–J6 start from the opened session.
	await cold("J2", `/session/${fixture.openSessionId}`, `${sessionView(fixture.openSessionId)} ${LAST_ROW}`);
	if (!want.has("J2")) delete samples.J2;

	// J4 right after J2: a deep link lands at the tail, so the appended rows mount inside the virtualized window.
	if (want.has("J4")) {
		const marker = `Perf lab reply ${run}: appended while the session was open.`;
		samples.J4 = await measure(probe, async () => {
			writeFileSync(fixture.openSessionPath, appendedLines(fixture, run), {flag: "a"});
			await page.getByText(marker).first().waitFor({state: "attached", timeout: 30_000});
		});
	}

	const switchView = sessionView(fixture.switchSessionId);
	const switchRow = page.locator(`a[data-row-main-button][href="/session/${fixture.switchSessionId}"]`).first();
	if (want.has("J3")) {
		await switchRow.waitFor();
		samples.J3 = await measure(probe, async () => {
			await switchRow.click();
			await page.locator(`${switchView} ${LAST_ROW}`).first().waitFor({state: "attached", timeout: 30_000});
		});
	} else {
		await page.goto(`${baseUrl}/session/${fixture.switchSessionId}`);
		await page.locator(`${switchView} ${ANY_ROW}`).first().waitFor({state: "attached", timeout: 30_000});
		await markDocument(page);
	}

	// J5 on the untouched session: an append makes a session active, and an active one without a live pane has no composer.
	if (want.has("J5")) {
		const prompt = page.getByRole("textbox", {name: "Prompt"});
		await prompt.click();
		await settle(page);
		samples.J5 = await measure(probe, async () => {
			await page.keyboard.type("measure the composer keystrokes", {delay: 20});
		});
		await prompt.fill("");
		await prompt.blur();
		await settle(page);
	}

	if (want.has("J6")) {
		samples.J6 = await measure(probe, async () => {
			await page.keyboard.press("ControlOrMeta+k");
			const palette = page.locator('[data-perf-overlay="command_palette"]');
			await palette.waitFor({timeout: 10_000});
			const searched = page.waitForResponse((response) => response.url().includes("/api/search"), {
				timeout: 10_000,
			});
			await page.keyboard.type("fixture", {delay: 20});
			await searched;
		});
		await page.keyboard.press("Escape");
	}

	await page.close();
	return samples;
}

export function gitSha(): string {
	try {
		return execFileSync("git", ["rev-parse", "--short", "HEAD"], {cwd: REPOSITORY_ROOT, encoding: "utf8"}).trim();
	} catch {
		return "unknown";
	}
}

export const METRIC_KEYS = [
	"recalcStyleCount",
	"layoutCount",
	"requests",
	"layoutShift",
	"recalcStyleDurationMs",
	"layoutDurationMs",
] as const satisfies ReadonlyArray<keyof JourneySample>;

type MetricKey = (typeof METRIC_KEYS)[number];

type JourneyReport = Record<MetricKey, Summary> & {title: string};

export type StableLabMetrics = Partial<Record<JourneyId, Partial<Record<MetricKey, number>>>>;

/**
 * The metrics stable in both 10-run batches of `just perf-lab-stability` (.llm/perf/browser-lab-stability.md), each with
 * the ceiling tolerance it needs. Only these are ratcheted; style-recalc counts, durations and the other journeys'
 * layout and request counts moved between runs and stay diagnostic. J2 requests and layout shift drifted while each run
 * appended to the session J2 opens and J4 appends to; since the lab resets that session before each run, J2 read 645
 * requests and 0.021 CLS and J4 read 0.0001 CLS in every run of two batches.
 */
export const RATCHETED_LAB_METRICS: StableLabMetrics = {
	J1: {requests: 0.02, layoutShift: 0},
	J2: {requests: 0, layoutShift: 0},
	J3: {layoutShift: 0},
	J4: {layoutShift: 0},
	J5: {layoutCount: 0, layoutShift: 0},
	J6: {layoutCount: 0},
};

/** The median over `runs` of each stable metric, keyed `browser.<journey>.<metric>`, for the journeys that ran. */
export function labRatchetValues(runs: readonly LabRun[], stable: StableLabMetrics): Record<string, number> {
	const values: Record<string, number> = {};
	for (const id of JOURNEYS) {
		const samples = runs.flatMap((run) => (run[id] === undefined ? [] : [run[id]]));
		if (samples.length === 0) continue;
		for (const key of METRIC_KEYS) {
			if (stable[id]?.[key] === undefined) continue;
			values[`browser.${id}.${key}`] = summarize(samples.map((sample) => sample[key])).median;
		}
	}
	return values;
}

/** Runs `check` on every value and returns the failure messages, so one regression does not hide the rest. */
export function ratchetLab(values: Record<string, number>, check: (id: string, value: number) => void): string[] {
	const failures: string[] = [];
	for (const [id, value] of Object.entries(values)) {
		try {
			check(id, value);
		} catch (error) {
			failures.push(error instanceof Error ? error.message : String(error));
		}
	}
	return failures;
}

function buildReport(runs: LabRun[]): Partial<Record<JourneyId, JourneyReport>> {
	const report: Partial<Record<JourneyId, JourneyReport>> = {};
	for (const id of JOURNEYS) {
		const samples = runs.flatMap((run) => (run[id] === undefined ? [] : [run[id]]));
		if (samples.length === 0) continue;
		const entry = {title: JOURNEY_TITLES[id]} as JourneyReport;
		for (const key of METRIC_KEYS) entry[key] = summarize(samples.map((sample) => sample[key]));
		report[id] = entry;
	}
	return report;
}

function formatTable(report: Partial<Record<JourneyId, JourneyReport>>): string {
	const cell = (summary: Summary) => `${summary.min}/${summary.median}/${summary.max}`;
	const rows = [["journey", "recalcStyle", "layout", "requests", "CLS", "title"]];
	for (const [id, entry] of Object.entries(report)) {
		rows.push([
			id,
			cell(entry.recalcStyleCount),
			cell(entry.layoutCount),
			cell(entry.requests),
			cell(entry.layoutShift),
			entry.title,
		]);
	}
	const widths = rows[0]!.map((_, column) => Math.max(...rows.map((row) => row[column]!.length)));
	return rows.map((row) => row.map((value, column) => value.padEnd(widths[column]!)).join("  ")).join("\n");
}

export type LabRun = Partial<Record<JourneyId, JourneySample>>;

export interface LabSession {
	chromium: string;
	fixture: {openSession: {shape: "typical"; bytes: number}; switchSession: {shape: "small"; bytes: number}};
	blockedHosts: string[];
	runs: LabRun[];
}

/**
 * Seeds a fresh fixture HOME, starts one fixture server and runs every requested journey `args.runs` times in a new
 * browser context each. `onRun` sees each finished run (1-based) before the next starts.
 */
export async function runLab(
	args: Omit<LabArgs, "ratchet">,
	onRun?: (run: number, sample: LabRun) => void,
): Promise<LabSession> {
	const baseUrl = `http://127.0.0.1:${args.port}`;
	const fixture = await seedLabFixture();
	const server = startServer(fixture, args.port);
	const blocked: string[] = [];
	try {
		await waitForIdleIndex(baseUrl, server.process, server.output);
		const seededMessageCount = (await indexedOpenSession(baseUrl, fixture))?.messageCount;
		if (seededMessageCount === undefined) throw new Error(`The lab server did not index ${fixture.openSessionId}`);
		const browser = await chromium.launch({headless: true});
		const runs: LabRun[] = [];
		try {
			for (let run = 1; run <= args.runs; run += 1) {
				await resetOpenSession(baseUrl, fixture, seededMessageCount);
				await waitForIdleIndex(baseUrl, server.process, server.output);
				const context = await browser.newContext({viewport: VIEWPORT, colorScheme: "dark", locale: "en-US"});
				try {
					await prepareContext(context, blocked);
					const sample = await runJourneys(context, baseUrl, fixture, args.journeys, run).catch(
						async (error: unknown) => {
							const page = context.pages()[0];
							if (page) {
								const failurePath = join(OUTPUT_DIRECTORY, "lab-browser-failure");
								mkdirSync(OUTPUT_DIRECTORY, {recursive: true});
								await page.screenshot({path: `${failurePath}.png`}).catch(() => undefined);
								writeFileSync(`${failurePath}.html`, await page.content().catch(() => ""));
								writeFileSync(`${failurePath}.log`, server.output.join(""));
								console.error(`Saved ${failurePath}.{png,html,log} from ${page.url()}`);
							}
							throw error;
						},
					);
					runs.push(sample);
					onRun?.(run, sample);
				} finally {
					await context.close();
				}
			}
			return {
				chromium: browser.version(),
				fixture: {
					openSession: {shape: "typical", bytes: fixture.openSessionBytes},
					switchSession: {shape: "small", bytes: fixture.switchSessionBytes},
				},
				blockedHosts: [...new Set(blocked)].sort(),
				runs,
			};
		} finally {
			await browser.close();
		}
	} finally {
		await stopDevServer(server.process);
		rmSync(fixture.root, {recursive: true, force: true});
	}
}

async function main(): Promise<void> {
	const args = parseLabArgs(process.argv.slice(2));
	const session = await runLab(args, (run) => console.log(`run ${run}/${args.runs} done`));
	const sha = gitSha();
	const result = {
		sha,
		createdAt: new Date().toISOString(),
		chromium: session.chromium,
		viewport: VIEWPORT,
		runs: args.runs,
		fixture: session.fixture,
		blockedHosts: session.blockedHosts,
		journeys: buildReport(session.runs),
	};
	mkdirSync(OUTPUT_DIRECTORY, {recursive: true});
	const outputPath = join(OUTPUT_DIRECTORY, `lab-browser-${sha}.json`);
	writeFileSync(outputPath, `${JSON.stringify(result, null, "\t")}\n`);
	console.log(`\nmin/median/max over ${args.runs} runs\n`);
	console.log(formatTable(result.journeys));
	console.log(`\nWrote ${outputPath}`);
	if (!args.ratchet) return;
	const values = labRatchetValues(session.runs, RATCHETED_LAB_METRICS);
	console.log(`\nRatcheting the medians of the stable metrics:`);
	for (const [id, value] of Object.entries(values)) console.log(`${id}: ${value}`);
	const failures = ratchetLab(values, ratchet);
	if (failures.length > 0) {
		console.error(failures.join("\n"));
		process.exitCode = 1;
	}
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	await main();
}
