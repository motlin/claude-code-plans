import {describe, expect, it} from "vite-plus/test";
import {
	STALE_CHUNK_GUARD_MS,
	STALE_CHUNK_RELOAD_KEY,
	installStaleChunkReload,
	isStaleChunkError,
	type StaleChunkReloadDeps,
} from "../src/lib/stale-chunk-reload";

function memoryStorage(): Storage & {entries: Map<string, string>} {
	const entries = new Map<string, string>();
	return {
		entries,
		get length() {
			return entries.size;
		},
		clear: () => {
			entries.clear();
		},
		getItem: (key) => entries.get(key) ?? null,
		key: (index) => [...entries.keys()][index] ?? null,
		removeItem: (key) => {
			entries.delete(key);
		},
		setItem: (key, value) => {
			entries.set(key, value);
		},
	};
}

interface Harness {
	target: EventTarget;
	storage: ReturnType<typeof memoryStorage>;
	reloads: number[];
	clock: {now: number};
	deps: StaleChunkReloadDeps;
}

function harness(): Harness {
	const target = new EventTarget();
	const storage = memoryStorage();
	const reloads: number[] = [];
	const clock = {now: 1_000_000};
	const deps: StaleChunkReloadDeps = {
		storage: () => storage,
		reload: () => {
			reloads.push(clock.now);
		},
		now: () => clock.now,
	};
	return {target, storage, reloads, clock, deps};
}

function preloadError(target: EventTarget, message: string): Event {
	const event = Object.assign(new Event("vite:preloadError", {cancelable: true}), {payload: new TypeError(message)});
	target.dispatchEvent(event);
	return event;
}

const STALE =
	"Failed to fetch dynamically imported module: https://plans.m4.notlin.com/assets/tool-approval-notify-tip-PCUCVhl8.js";

describe("isStaleChunkError", () => {
	it("recognizes each browser's failed dynamic import message", () => {
		expect(
			[
				STALE,
				"Importing a module script failed.",
				"error loading dynamically imported module: https://x/assets/a.js",
				"Unable to preload CSS for https://x/assets/a.css",
				"Something else broke",
			].map((message) => isStaleChunkError(new TypeError(message))),
		).toStrictEqual([true, true, true, true, false]);
	});

	it("ignores non-errors", () => {
		expect([isStaleChunkError(undefined), isStaleChunkError(STALE)]).toStrictEqual([false, false]);
	});
});

describe("installStaleChunkReload", () => {
	it("reloads exactly once on a preload error and suppresses the throw", () => {
		const {target, storage, reloads, clock, deps} = harness();
		installStaleChunkReload(target, deps);

		const event = preloadError(target, STALE);

		expect({
			prevented: event.defaultPrevented,
			reloads,
			flag: storage.entries.get(STALE_CHUNK_RELOAD_KEY),
		}).toStrictEqual({prevented: true, reloads: [clock.now], flag: String(clock.now)});
	});

	it("does not reload again for a second error within the guard window", () => {
		const {target, reloads, clock, deps} = harness();
		installStaleChunkReload(target, deps);
		preloadError(target, STALE);
		clock.now += STALE_CHUNK_GUARD_MS - 1;

		const second = preloadError(target, STALE);

		expect({prevented: second.defaultPrevented, reloads: reloads.length}).toStrictEqual({
			prevented: false,
			reloads: 1,
		});
	});

	it("reloads again once the guard window has passed", () => {
		const {target, reloads, clock, deps} = harness();
		installStaleChunkReload(target, deps);
		preloadError(target, STALE);
		clock.now += STALE_CHUNK_GUARD_MS;

		preloadError(target, STALE);

		expect(reloads.length).toBe(2);
	});

	it("reloads on an unhandled rejection from a bare dynamic import", () => {
		const {target, reloads, deps} = harness();
		installStaleChunkReload(target, deps);
		const event = Object.assign(new Event("unhandledrejection", {cancelable: true}), {
			reason: new TypeError(STALE),
		});

		target.dispatchEvent(event);

		expect({prevented: event.defaultPrevented, reloads: reloads.length}).toStrictEqual({
			prevented: true,
			reloads: 1,
		});
	});

	it("leaves unrelated rejections alone", () => {
		const {target, reloads, deps} = harness();
		installStaleChunkReload(target, deps);
		const event = Object.assign(new Event("unhandledrejection", {cancelable: true}), {
			reason: new Error("network down"),
		});

		target.dispatchEvent(event);

		expect({prevented: event.defaultPrevented, reloads: reloads.length}).toStrictEqual({
			prevented: false,
			reloads: 0,
		});
	});

	it("never reloads when the guard flag cannot be stored, so it cannot loop", () => {
		const {target, reloads, deps} = harness();
		installStaleChunkReload(target, {
			...deps,
			storage: () => {
				throw new Error("SecurityError");
			},
		});

		const event = preloadError(target, STALE);

		expect({prevented: event.defaultPrevented, reloads: reloads.length}).toStrictEqual({
			prevented: false,
			reloads: 0,
		});
	});

	it("stops listening once uninstalled", () => {
		const {target, reloads, deps} = harness();
		const uninstall = installStaleChunkReload(target, deps);
		uninstall();

		preloadError(target, STALE);

		expect(reloads.length).toBe(0);
	});
});
