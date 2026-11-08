import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {
	AUTO_SAVE_DELAY_MS,
	bannerCopy,
	createAutoSave,
	createSourceSaver,
	editorDirty,
	initialSaveState,
	reduceSave,
	reportedDirty,
	retryLabel,
	type SaveError,
	type SaveReason,
	type SaveState,
} from "../src/lib/source-save";

function state(overrides: Partial<SaveState> = {}): SaveState {
	return {...initialSaveState("disk", "e1"), ...overrides};
}

describe("initialSaveState", () => {
	it("starts clean with the disk text and its etag", () => {
		expect(initialSaveState("disk", "e1")).toStrictEqual({
			saved: "disk",
			draft: "disk",
			etag: "e1",
			inFlight: false,
			queued: null,
			error: null,
		});
	});
});

describe("reduceSave", () => {
	it("edit updates the draft", () => {
		expect(reduceSave(state(), {type: "edit", draft: "x"})).toStrictEqual({
			state: state({draft: "x"}),
			next: null,
		});
	});

	it("edit during a save queues the draft", () => {
		expect(reduceSave(state({draft: "a", inFlight: true}), {type: "edit", draft: "ab"})).toStrictEqual({
			state: state({draft: "ab", inFlight: true, queued: "ab"}),
			next: null,
		});
	});

	it("saveStart marks the save in flight and takes the queue", () => {
		expect(reduceSave(state({draft: "a", queued: "a"}), {type: "saveStart"})).toStrictEqual({
			state: state({draft: "a", inFlight: true}),
			next: null,
		});
	});

	it("saveOk records the saved text, clears the error and marks clean when the draft matches", () => {
		expect(
			reduceSave(state({draft: "a", inFlight: true, error: {kind: "writeFailed"}}), {
				type: "saveOk",
				etag: "e2",
				text: "a",
			}),
		).toStrictEqual({
			state: state({saved: "a", draft: "a", etag: "e2"}),
			next: null,
		});
	});

	it("saveOk hands back the queued text so it is written next", () => {
		expect(
			reduceSave(state({draft: "ab", inFlight: true, queued: "ab"}), {type: "saveOk", etag: "e2", text: "a"}),
		).toStrictEqual({
			state: state({saved: "a", draft: "ab", etag: "e2"}),
			next: "ab",
		});
	});

	it("saveFail keeps the draft, records the error and drops the queue", () => {
		expect(
			reduceSave(state({draft: "ab", inFlight: true, queued: "ab"}), {
				type: "saveFail",
				error: {kind: "conflict"},
			}),
		).toStrictEqual({
			state: state({draft: "ab", error: {kind: "conflict"}}),
			next: null,
		});
	});

	it("discard resets the draft to the saved text and clears the error", () => {
		expect(reduceSave(state({draft: "ab", error: {kind: "missing"}}), {type: "discard"})).toStrictEqual({
			state: state(),
			next: null,
		});
	});

	it("override clears the error and the etag so the next write has no If-Match", () => {
		expect(reduceSave(state({draft: "ab", error: {kind: "conflict"}}), {type: "override"})).toStrictEqual({
			state: state({draft: "ab", etag: null}),
			next: null,
		});
	});
});

describe("dirty", () => {
	it("editorDirty compares the draft with the saved text", () => {
		expect([editorDirty(state()), editorDirty(state({draft: "x"}))]).toStrictEqual([false, true]);
	});

	it("reportedDirty arms the guard only for manual mode or a failed save (upstream om)", () => {
		const error: SaveError = {kind: "writeFailed"};
		expect([
			reportedDirty(state(), true),
			reportedDirty(state({draft: "x"}), true),
			reportedDirty(state({draft: "x", error}), true),
			reportedDirty(state({draft: "x"}), false),
			reportedDirty(state(), false),
		]).toStrictEqual([false, false, true, true, false]);
	});
});

describe("banner copy", () => {
	it("maps every error kind to upstream's copy and retry label", () => {
		const kinds: SaveError["kind"][] = ["writeFailed", "conflict", "missing", "denied"];
		expect(kinds.map((kind) => [bannerCopy({kind}), retryLabel({kind})])).toStrictEqual([
			["Couldn’t save this file.", "Try again"],
			["This file changed on disk since you started editing.", "Override"],
			["This file was deleted on disk since you started editing.", "Save anyway"],
			["This file can’t be saved. Its path is outside the working directory, or this is a remote session.", null],
		]);
	});
});

describe("createAutoSave", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it("uses upstream's 1000 ms idle delay", () => {
		expect(AUTO_SAVE_DELAY_MS).toBe(1000);
	});

	it("saves once, 1000 ms after the last of three changes 400 ms apart", () => {
		const saves: [SaveReason, number][] = [];
		const auto = createAutoSave({save: (reason) => saves.push([reason, Date.now()])});
		const start = Date.now();
		auto.change();
		vi.advanceTimersByTime(400);
		auto.change();
		vi.advanceTimersByTime(400);
		auto.change();
		vi.advanceTimersByTime(999);
		expect(saves).toStrictEqual([]);
		vi.advanceTimersByTime(1);
		expect(saves).toStrictEqual([["idle", start + 1800]]);
		vi.advanceTimersByTime(5000);
		expect(saves.length).toBe(1);
	});

	it("blur at 300 ms saves now and cancels the idle save", () => {
		const saves: SaveReason[] = [];
		const auto = createAutoSave({save: (reason) => saves.push(reason)});
		auto.change();
		vi.advanceTimersByTime(300);
		auto.flush("blur");
		vi.advanceTimersByTime(5000);
		expect(saves).toStrictEqual(["blur"]);
	});

	it("flush saves immediately with their reasons", () => {
		const saves: SaveReason[] = [];
		const auto = createAutoSave({save: (reason) => saves.push(reason)});
		auto.change();
		auto.flush("hidden");
		auto.flush("unload");
		auto.flush("explicit");
		vi.advanceTimersByTime(5000);
		expect(saves).toStrictEqual(["hidden", "unload", "explicit"]);
	});

	it("dispose(true) flushes an unmount save; dispose(false) saves nothing", () => {
		const saves: SaveReason[] = [];
		createAutoSave({save: (reason) => saves.push(reason)}).dispose(true);
		const quiet = createAutoSave({save: (reason) => saves.push(reason)});
		quiet.change();
		quiet.dispose(false);
		vi.advanceTimersByTime(5000);
		expect(saves).toStrictEqual(["unmount"]);
	});
});

describe("createSourceSaver", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	function harness(initialDisk = "disk") {
		let disk = initialDisk;
		const writes: [string, SaveReason][] = [];
		const pending: (() => void)[] = [];
		const saver = createSourceSaver({
			write: async (text, reason) => {
				writes.push([text, reason]);
				await new Promise<void>((resolve) => {
					pending.push(resolve);
				});
				disk = text;
			},
			diskText: () => disk,
		});
		const settle = async () => {
			pending.shift()?.();
			await vi.advanceTimersByTimeAsync(0);
		};
		return {saver, writes, settle};
	}

	it("writes the latest text 1000 ms after the last change", async () => {
		const {saver, writes, settle} = harness();
		saver.change("a");
		vi.advanceTimersByTime(400);
		saver.change("ab");
		vi.advanceTimersByTime(400);
		saver.change("abc");
		vi.advanceTimersByTime(1000);
		await settle();
		expect(writes).toStrictEqual([["abc", "idle"]]);
	});

	it("blur writes now and the idle timer never fires", async () => {
		const {saver, writes, settle} = harness();
		saver.change("a");
		vi.advanceTimersByTime(300);
		saver.flush("blur");
		await settle();
		vi.advanceTimersByTime(5000);
		expect(writes).toStrictEqual([["a", "blur"]]);
	});

	it("a change during an in-flight write is written with the latest text after it settles", async () => {
		const {saver, writes, settle} = harness();
		saver.change("a");
		saver.flush("explicit");
		saver.change("ab");
		saver.change("abc");
		saver.flush("blur");
		expect(writes).toStrictEqual([["a", "explicit"]]);
		await settle();
		expect(writes).toStrictEqual([
			["a", "explicit"],
			["abc", "blur"],
		]);
		await settle();
		vi.advanceTimersByTime(5000);
		await settle();
		expect(writes).toStrictEqual([
			["a", "explicit"],
			["abc", "blur"],
		]);
	});

	it("skips the write when the text equals the disk contents", async () => {
		const {saver, writes, settle} = harness();
		saver.change("disk");
		vi.advanceTimersByTime(1000);
		saver.flush("explicit");
		await settle();
		expect(writes).toStrictEqual([]);
	});

	it("dispose(true) flushes an unmount write; dispose(false) writes nothing", async () => {
		const first = harness();
		first.saver.change("a");
		first.saver.dispose(true);
		await first.settle();
		expect(first.writes).toStrictEqual([["a", "unmount"]]);

		const second = harness();
		second.saver.change("a");
		second.saver.dispose(false);
		vi.advanceTimersByTime(5000);
		await second.settle();
		expect(second.writes).toStrictEqual([]);
	});
});
