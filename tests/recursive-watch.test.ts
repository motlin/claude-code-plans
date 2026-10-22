import {EventEmitter} from "node:events";
import type {FSWatcher} from "node:fs";
import {appendFile, mkdir, mkdtemp, readdir, realpath, rm, unlink, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {basename, dirname, join} from "node:path";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

const watchMock = vi.hoisted(() => vi.fn<typeof import("node:fs").watch>());
const writeFileMock = vi.hoisted(() => vi.fn<typeof import("node:fs/promises").writeFile>());

vi.mock("node:fs", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs")>();
	watchMock.mockImplementation(actual.watch);
	return {...actual, watch: watchMock};
});

vi.mock("node:fs/promises", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs/promises")>();
	writeFileMock.mockImplementation(actual.writeFile);
	return {...actual, writeFile: writeFileMock};
});

import {createRecursiveWatcher, type RecursiveWatcher} from "../src/lib/recursive-watch";

const PROBE_TIMEOUT_MS = 1000;
const PROBE_PREFIX = ".claude-code-browser-watch-probe-";

function probeWriteDirectories(): Set<string> {
	return new Set(
		writeFileMock.mock.calls
			.map(([path]) => String(path))
			.filter((path) => basename(path).startsWith(PROBE_PREFIX))
			.map((path) => dirname(path)),
	);
}

async function waitForReady(watcher: RecursiveWatcher): Promise<void> {
	return new Promise((resolve) => {
		watcher.once("ready", resolve);
	});
}

async function delay(milliseconds: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, milliseconds);
	});
}

/** A native watcher that accepts listeners but never delivers a single event. */
function createDeafNativeWatcher(): FSWatcher {
	const emitter = new EventEmitter();
	return Object.assign(emitter, {close: () => {}}) as unknown as FSWatcher;
}

/** Resolves on the watcher's own event for `expectedPath`; the test timeout bounds the wait. */
async function waitForPath(
	watcher: RecursiveWatcher,
	event: "change" | "unlink",
	expectedPath: string,
): Promise<string> {
	return new Promise((resolve) => {
		watcher.on(event, (path) => {
			if (path === expectedPath) resolve(path);
		});
	});
}

/** Longer than the watcher's debounce, so each rewrite of the sentinel is reported on its own. */
const SENTINEL_REWRITE_MS = 250;

/**
 * Under heavy load the watcher's readiness probe can time out and announce `ready` before FSEvents is armed, which
 * drops a write issued right after it. Rewrite a sentinel until the watcher reports it back, then drain its unlink, so
 * a test's own writes only start once event delivery is proven.
 */
async function waitUntilDelivering(watcher: RecursiveWatcher, directory: string): Promise<void> {
	await waitForReady(watcher);
	const sentinelPath = join(directory, "delivery-sentinel.txt");
	let delivered = false;
	const observed = waitForPath(watcher, "change", sentinelPath).then(() => {
		delivered = true;
	});
	while (!delivered) {
		await writeFile(sentinelPath, `${Date.now()}\n`, "utf8");
		await Promise.race([observed, delay(SENTINEL_REWRITE_MS)]);
	}
	const removed = waitForPath(watcher, "unlink", sentinelPath);
	await unlink(sentinelPath);
	await removed;
}

describe("createRecursiveWatcher", () => {
	let fixtureDirectory: string;
	let watcher: RecursiveWatcher | undefined;

	beforeEach(async () => {
		fixtureDirectory = await realpath(await mkdtemp(join(tmpdir(), "recursive-watch-test-")));
		const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
		watchMock.mockReset();
		watchMock.mockImplementation(actual.watch);
		writeFileMock.mockClear();
	});

	afterEach(async () => {
		await watcher?.close();
		watcher = undefined;
		await rm(fixtureDirectory, {recursive: true, force: true});
	});

	it("emits change for created and modified files, then unlink when deleted", async () => {
		const filePath = join(fixtureDirectory, "alice.md");
		watcher = createRecursiveWatcher([fixtureDirectory], () => false);
		await waitUntilDelivering(watcher, fixtureDirectory);

		const created = waitForPath(watcher, "change", filePath);
		await writeFile(filePath, "first\n", "utf8");
		expect(await created).toBe(filePath);

		const modified = waitForPath(watcher, "change", filePath);
		await appendFile(filePath, "second\n", "utf8");
		expect(await modified).toBe(filePath);

		const deleted = waitForPath(watcher, "unlink", filePath);
		await unlink(filePath);
		expect(await deleted).toBe(filePath);
	});

	it("observes files created inside a newly-created nested directory", async () => {
		const nestedDirectory = join(fixtureDirectory, "nested");
		const filePath = join(nestedDirectory, "bob.json");
		watcher = createRecursiveWatcher([fixtureDirectory], () => false);
		await waitUntilDelivering(watcher, fixtureDirectory);

		const changed = waitForPath(watcher, "change", filePath);
		await mkdir(nestedDirectory);
		await writeFile(filePath, "{}\n", "utf8");

		expect(await changed).toBe(filePath);
	});

	it("filters ignored paths before emitting events", async () => {
		const ignoredDirectory = join(fixtureDirectory, "ignored");
		const ignoredPath = join(ignoredDirectory, "charlie.md");
		const acceptedPath = join(fixtureDirectory, "alice.md");
		const events: string[] = [];
		watcher = createRecursiveWatcher([fixtureDirectory], (path) => path.includes("/ignored/"));
		watcher.on("change", (path) => {
			if (path === ignoredPath) events.push(path);
		});
		watcher.on("unlink", (path) => {
			if (path === ignoredPath) events.push(path);
		});
		await waitUntilDelivering(watcher, fixtureDirectory);

		await mkdir(ignoredDirectory);
		await writeFile(ignoredPath, "ignored\n", "utf8");
		const accepted = waitForPath(watcher, "change", acceptedPath);
		await writeFile(acceptedPath, "accepted\n", "utf8");
		await accepted;

		expect(events).toStrictEqual([]);
	});

	it("attaches one native watcher when roots overlap", async () => {
		const nestedDirectory = join(fixtureDirectory, "nested");
		const filePath = join(fixtureDirectory, "alice.md");
		await mkdir(nestedDirectory);

		watcher = createRecursiveWatcher([fixtureDirectory, nestedDirectory], () => false);
		await waitUntilDelivering(watcher, fixtureDirectory);

		expect(watchMock.mock.calls.map(([root, options]) => ({root, options}))).toStrictEqual([
			{
				root: fixtureDirectory,
				options: {recursive: true, persistent: true},
			},
		]);

		const changed = waitForPath(watcher, "change", filePath);
		await writeFile(filePath, "created outside nested root\n", "utf8");
		expect(await changed).toBe(filePath);
	});

	it("withholds ready until the native watcher proves it delivers events", async () => {
		watchMock.mockImplementation(createDeafNativeWatcher);
		watcher = createRecursiveWatcher([fixtureDirectory], () => false);
		let ready = false;
		watcher.once("ready", () => {
			ready = true;
		});

		await delay(300);

		expect(ready).toBe(false);
	});

	it("emits ready anyway when the native watcher never proves itself", async () => {
		watchMock.mockImplementation(createDeafNativeWatcher);
		watcher = createRecursiveWatcher([fixtureDirectory], () => false);

		const readyBeforeTimeout = await Promise.race([
			waitForReady(watcher).then(() => true),
			delay(PROBE_TIMEOUT_MS * 3).then(() => false),
		]);

		expect(readyBeforeTimeout).toBe(true);
	});

	it("keeps its readiness probe out of emitted events and off disk", async () => {
		const events: string[] = [];
		watcher = createRecursiveWatcher([fixtureDirectory], () => false);
		watcher.on("change", (path) => events.push(path));
		watcher.on("unlink", (path) => events.push(path));
		await waitForReady(watcher);

		expect(await readdir(fixtureDirectory)).toStrictEqual([]);
		expect(probeWriteDirectories()).toStrictEqual(new Set([fixtureDirectory]));

		await delay(300);

		expect(events).toStrictEqual([]);
	});

	it("probes inside .git so a watched repository root never looks dirty", async () => {
		const gitDirectory = join(fixtureDirectory, ".git");
		await mkdir(gitDirectory);

		watcher = createRecursiveWatcher([fixtureDirectory], () => false);
		await waitForReady(watcher);

		expect(probeWriteDirectories()).toStrictEqual(new Set([gitDirectory]));
		expect(await readdir(gitDirectory)).toStrictEqual([]);
	});

	it("stops emitting events after close", async () => {
		const filePath = join(fixtureDirectory, "alice.md");
		const events: string[] = [];
		watcher = createRecursiveWatcher([fixtureDirectory], () => false);
		watcher.on("change", (path) => events.push(path));
		watcher.on("unlink", (path) => events.push(path));
		await waitForReady(watcher);
		await watcher.close();

		await writeFile(filePath, "after close\n", "utf8");
		await new Promise((resolve) => {
			setTimeout(resolve, 300);
		});

		expect(events).toStrictEqual([]);
	});
});
