import {describe, expect, it} from "vite-plus/test";
import {DEFAULTS, VERBOSITY_PRESETS} from "../src/components/settings-provider";
import {
	TRANSCRIPT_MODES,
	TRANSCRIPT_MODE_MAX_OVERRIDES,
	TRANSCRIPT_MODE_STORAGE_KEY,
	type TranscriptModeOverrides,
	loadTranscriptModeOverrides,
	nextTranscriptMode,
	resolveTranscriptMode,
	saveTranscriptModeOverrides,
	sessionHasThinking,
	setSessionMode,
	transcriptModeFlags,
} from "../src/lib/transcript-mode";

class MemoryStorage implements Storage {
	readonly values = new Map<string, string>();
	get length(): number {
		return this.values.size;
	}
	clear(): void {
		this.values.clear();
	}
	getItem(key: string): string | null {
		return this.values.get(key) ?? null;
	}
	key(index: number): string | null {
		return [...this.values.keys()][index] ?? null;
	}
	removeItem(key: string): void {
		this.values.delete(key);
	}
	setItem(key: string, value: string): void {
		this.values.set(key, value);
	}
}

function storageWith(raw: string): MemoryStorage {
	const storage = new MemoryStorage();
	storage.setItem(TRANSCRIPT_MODE_STORAGE_KEY, raw);
	return storage;
}

describe("transcript-mode", () => {
	it("lists the three upstream modes in cycle order", () => {
		expect(TRANSCRIPT_MODES).toEqual(["normal", "thinking", "verbose"]);
	});

	describe("nextTranscriptMode", () => {
		it("cycles Normal -> Thinking -> Verbose -> Normal when the session has thinking", () => {
			expect([
				nextTranscriptMode("normal", {hasThinking: true}),
				nextTranscriptMode("thinking", {hasThinking: true}),
				nextTranscriptMode("verbose", {hasThinking: true}),
			]).toEqual(["thinking", "verbose", "normal"]);
		});

		it("toggles Normal <-> Verbose when the session has no thinking", () => {
			expect([
				nextTranscriptMode("normal", {hasThinking: false}),
				nextTranscriptMode("thinking", {hasThinking: false}),
				nextTranscriptMode("verbose", {hasThinking: false}),
			]).toEqual(["verbose", "verbose", "normal"]);
		});
	});

	describe("resolveTranscriptMode", () => {
		const overrides: TranscriptModeOverrides = {a: "verbose", b: "thinking"};

		it("uses the session's override, else the default", () => {
			expect([
				resolveTranscriptMode({
					sessionId: "a",
					overrides,
					defaultMode: "normal",
					hasThinking: true,
				}),
				resolveTranscriptMode({
					sessionId: "c",
					overrides,
					defaultMode: "thinking",
					hasThinking: true,
				}),
			]).toEqual(["verbose", "thinking"]);
		});

		it("coerces Thinking to Normal when the session has no thinking", () => {
			expect([
				resolveTranscriptMode({
					sessionId: "b",
					overrides,
					defaultMode: "verbose",
					hasThinking: false,
				}),
				resolveTranscriptMode({
					sessionId: "c",
					overrides,
					defaultMode: "thinking",
					hasThinking: false,
				}),
				resolveTranscriptMode({
					sessionId: "b",
					overrides,
					defaultMode: "verbose",
					hasThinking: true,
				}),
			]).toEqual(["normal", "normal", "thinking"]);
		});

		it("keeps sessions isolated from each other", () => {
			const next = setSessionMode(overrides, "c", "thinking", "normal");
			expect([
				resolveTranscriptMode({
					sessionId: "a",
					overrides: next,
					defaultMode: "normal",
					hasThinking: true,
				}),
				resolveTranscriptMode({
					sessionId: "b",
					overrides: next,
					defaultMode: "normal",
					hasThinking: true,
				}),
				resolveTranscriptMode({
					sessionId: "c",
					overrides: next,
					defaultMode: "normal",
					hasThinking: true,
				}),
				resolveTranscriptMode({
					sessionId: "d",
					overrides: next,
					defaultMode: "normal",
					hasThinking: true,
				}),
			]).toEqual(["verbose", "thinking", "thinking", "normal"]);
		});
	});

	describe("setSessionMode", () => {
		it("records a non-default mode as the most recent entry without mutating the input", () => {
			const overrides: TranscriptModeOverrides = {a: "verbose", b: "thinking"};
			const next = setSessionMode(overrides, "a", "thinking", "normal");
			expect(Object.entries(next)).toEqual([
				["b", "thinking"],
				["a", "thinking"],
			]);
			expect(overrides).toEqual({a: "verbose", b: "thinking"});
		});

		it("deletes the entry when the mode equals the default", () => {
			expect(setSessionMode({a: "verbose", b: "thinking"}, "a", "normal", "normal")).toEqual({
				b: "thinking",
			});
		});

		it("caps the overrides at 100, evicting the least recently set", () => {
			let overrides: TranscriptModeOverrides = {};
			for (let index = 0; index < TRANSCRIPT_MODE_MAX_OVERRIDES; index++) {
				overrides = setSessionMode(overrides, `s${index}`, "verbose", "normal");
			}
			overrides = setSessionMode(overrides, "s0", "thinking", "normal");
			overrides = setSessionMode(overrides, "new", "verbose", "normal");
			const keys = Object.keys(overrides);
			expect(TRANSCRIPT_MODE_MAX_OVERRIDES).toBe(100);
			expect(keys.length).toBe(100);
			expect(keys.includes("s1")).toBe(false);
			expect(keys.slice(-2)).toEqual(["s0", "new"]);
		});
	});

	describe("persistence", () => {
		it("round-trips overrides through storage", () => {
			const storage = new MemoryStorage();
			saveTranscriptModeOverrides({a: "verbose", b: "thinking"}, storage);
			expect(storage.getItem(TRANSCRIPT_MODE_STORAGE_KEY)).toBe('{"a":"verbose","b":"thinking"}');
			expect(loadTranscriptModeOverrides(storage)).toEqual({a: "verbose", b: "thinking"});
		});

		it("drops legacy summary entries so those sessions follow the default", () => {
			expect(loadTranscriptModeOverrides(storageWith('{"a":"summary","b":"verbose"}'))).toEqual({
				b: "verbose",
			});
		});

		it("ignores garbage so every session falls back to the default", () => {
			expect([
				loadTranscriptModeOverrides(storageWith("not json")),
				loadTranscriptModeOverrides(storageWith('{"a":"loud"}')),
				loadTranscriptModeOverrides(storageWith('["verbose"]')),
				loadTranscriptModeOverrides(storageWith('{"":"verbose"}')),
				loadTranscriptModeOverrides(new MemoryStorage()),
				loadTranscriptModeOverrides(null),
			]).toEqual([{}, {}, {}, {}, {}, {}]);
		});

		it("trims an oversized stored map to the newest 100 entries", () => {
			const raw = Object.fromEntries(Array.from({length: 105}, (_, index) => [`s${index}`, "verbose"]));
			const loaded = loadTranscriptModeOverrides(storageWith(JSON.stringify(raw)));
			expect(Object.keys(loaded).length).toBe(100);
			expect(Object.keys(loaded)[0]).toBe("s5");
		});
	});

	describe("transcriptModeFlags", () => {
		const custom = {...DEFAULTS, ...VERBOSITY_PRESETS.normal, showPassedHooks: true};

		it("keeps the global custom toggles when the session follows the default", () => {
			expect(
				transcriptModeFlags({
					mode: "normal",
					defaultMode: "normal",
					settings: custom,
					presets: VERBOSITY_PRESETS,
				}),
			).toEqual({...VERBOSITY_PRESETS.normal, showPassedHooks: true});
		});

		it("uses the preset flags when the session overrides the default", () => {
			expect(
				transcriptModeFlags({
					mode: "verbose",
					defaultMode: "normal",
					settings: custom,
					presets: VERBOSITY_PRESETS,
				}),
			).toEqual(VERBOSITY_PRESETS.verbose);
		});
	});

	describe("sessionHasThinking", () => {
		it("detects a non-blank thinking block on any assistant line", () => {
			expect([
				sessionHasThinking([{type: "assistant", message: {content: [{type: "thinking", thinking: "hmm"}]}}]),
				sessionHasThinking([
					{type: "assistant", message: {content: [{type: "thinking", thinking: "  "}]}},
					{type: "user", message: {content: "hi"}},
				]),
				sessionHasThinking([]),
			]).toEqual([true, false, false]);
		});
	});
});
