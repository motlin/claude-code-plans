import {EventEmitter} from "node:events";
import {PassThrough} from "node:stream";
import {describe, expect, it, vi} from "vite-plus/test";
import {
	buildTmuxKeyframe,
	createTmuxControlParser,
	parseTmuxPaneGeometry,
	startTmuxTerminalStream,
	stopAllTmuxTerminalStreams,
	tmuxSendKeysCommands,
	tmuxSupportsControlStreams,
	unescapeTmuxOutput,
	type TmuxControlNotification,
	type TmuxPaneGeometry,
	type TmuxTerminalStreamIo,
} from "../src/lib/tmux/terminal-stream";
import {createTmuxTerminalHost} from "../src/lib/terminal-host";

const GEOMETRY: TmuxPaneGeometry = {
	sessionId: "$3",
	windowId: "@7",
	width: 100,
	height: 3,
	cursorX: 4,
	cursorY: 1,
	cursorVisible: true,
	dead: false,
};

const GEOMETRY_LINE = "$3\t@7\t100\t3\t4\t1\t1\t0\n";

describe("tmux %output unescaping", () => {
	it("turns octal escapes back into bytes and keeps raw UTF-8 as is", () => {
		const escaped = Buffer.from("Alice\\015\\012\\033[1mbold\\134 café");

		expect(unescapeTmuxOutput(escaped)).toStrictEqual(Buffer.from("Alice\r\n\x1b[1mbold\\ café"));
	});

	it("leaves a backslash that does not start an octal escape alone", () => {
		expect(unescapeTmuxOutput(Buffer.from("a\\9b\\01"))).toStrictEqual(Buffer.from("a\\9b\\01"));
	});
});

describe("tmux control-mode parser", () => {
	function parse(chunks: Buffer[]): TmuxControlNotification[] {
		const notifications: TmuxControlNotification[] = [];
		const parser = createTmuxControlParser((notification) => notifications.push(notification));
		for (const chunk of chunks) parser.push(chunk);
		return notifications;
	}

	it("reads output, layout changes, window closes and exit, across chunk boundaries", () => {
		const stream = Buffer.from(
			[
				"%begin 1 2 0",
				"%output %9 not a notification inside a block",
				"%end 1 2 0",
				"%output %5 Alice\\015\\012",
				"%output %12 Bob",
				"%output %5 ",
				"%session-changed $3 main",
				"%layout-change @7 b25d,80x24,0,0,5 b25d,80x24,0,0,5 *",
				"%begin 1 3 0",
				"no such pane",
				"%error 1 3 0",
				"%window-close @8",
				"%unlinked-window-close @9",
				"%exit",
				"",
			].join("\n"),
		);
		const split = 37;

		expect(parse([stream.subarray(0, split), stream.subarray(split)])).toStrictEqual([
			{type: "output", paneId: "%5", bytes: Buffer.from("Alice\r\n")},
			{type: "output", paneId: "%12", bytes: Buffer.from("Bob")},
			{type: "output", paneId: "%5", bytes: Buffer.alloc(0)},
			{type: "layout-change", windowId: "@7"},
			{type: "window-close", windowId: "@8"},
			{type: "window-close", windowId: "@9"},
			{type: "exit"},
		]);
	});

	it("keeps a UTF-8 character split across chunks whole", () => {
		const stream = Buffer.from("%output %5 café\n");

		expect(parse([stream.subarray(0, stream.length - 2), stream.subarray(stream.length - 2)])).toStrictEqual([
			{type: "output", paneId: "%5", bytes: Buffer.from("café")},
		]);
	});
});

describe("tmux pane geometry and keyframes", () => {
	it("parses display-message output", () => {
		expect({
			live: parseTmuxPaneGeometry(GEOMETRY_LINE),
			dead: parseTmuxPaneGeometry("$3\t@7\t100\t3\t0\t0\t0\t1\n"),
			garbage: parseTmuxPaneGeometry("can't find pane %5\n"),
		}).toStrictEqual({
			live: GEOMETRY,
			dead: {...GEOMETRY, cursorX: 0, cursorY: 0, cursorVisible: false, dead: true},
			garbage: null,
		});
	});

	it("clears the screen, draws each captured line with CRLF up to the last non-empty one, and places the cursor", () => {
		const capture = "\x1b[32mAlice\x1b[39m $\nBob\n\n";

		expect(buildTmuxKeyframe(capture, GEOMETRY).toString()).toBe(
			"\x1b[0m\x1b[H\x1b[2J\x1b[32mAlice\x1b[39m $\r\nBob\x1b[0m\x1b[2;5H\x1b[?25h",
		);
	});

	it("hides the cursor when tmux says it is hidden and never draws more rows than the pane has", () => {
		const capture = "one\ntwo\nthree\nfour\n";

		expect(buildTmuxKeyframe(capture, {...GEOMETRY, cursorVisible: false}).toString()).toBe(
			"\x1b[0m\x1b[H\x1b[2Jone\r\ntwo\r\nthree\x1b[0m\x1b[2;5H\x1b[?25l",
		);
	});
});

describe("tmux version and keys", () => {
	it("needs tmux 3.2 or newer for control-mode streams", () => {
		expect(
			["tmux 3.1c", "tmux 3.2", "tmux 3.3a", "tmux 4.0", "tmux next-3.6", "tmux master", "tmux 2.9", ""].map(
				tmuxSupportsControlStreams,
			),
		).toStrictEqual([false, true, true, true, true, true, false, false]);
	});

	it("types raw terminal input as hex send-keys, in chunks", () => {
		expect(tmuxSendKeysCommands("%5", "\x1b[Aé", 3)).toStrictEqual([
			["send-keys", "-t", "%5", "-H", "1b", "5b", "41"],
			["send-keys", "-t", "%5", "-H", "c3", "a9"],
		]);
	});
});

type FakeControl = ReturnType<typeof createFakeControl>;

function createFakeControl() {
	const emitter = new EventEmitter();
	const written: string[] = [];
	return Object.assign(emitter, {
		stdin: {
			write: vi.fn<(text: string) => boolean>((text) => {
				written.push(text);
				return true;
			}),
			end: vi.fn<() => void>(),
		},
		stdout: new PassThrough(),
		stderr: new PassThrough(),
		exitCode: null,
		signalCode: null,
		kill: vi.fn<() => boolean>(() => true),
		written,
	});
}

function createSocket() {
	return {
		send: vi.fn<(message: string) => void>(),
		close: vi.fn<(code?: number, reason?: string) => void>(),
	};
}

interface Harness {
	io: TmuxTerminalStreamIo;
	calls: string[][];
	controls: FakeControl[];
	spawned: string[][];
	timers: {callback: () => void; delayMs: number}[];
	geometry: {current: string | Error};
	capture: {current: string | Error};
}

function createHarness(version = "tmux 3.4\n"): Harness {
	const calls: string[][] = [];
	const controls: FakeControl[] = [];
	const spawned: string[][] = [];
	const timers: {callback: () => void; delayMs: number}[] = [];
	const geometry: {current: string | Error} = {current: GEOMETRY_LINE};
	const capture: {current: string | Error} = {current: "Alice $\n\n\n"};
	const answer = async (value: string | Error): Promise<string> =>
		value instanceof Error ? Promise.reject(value) : Promise.resolve(value);
	const io: TmuxTerminalStreamIo = {
		output: async (args) => {
			calls.push([...args]);
			if (args.includes("-V")) return answer(version);
			if (args.includes("display-message")) return answer(geometry.current);
			if (args.includes("capture-pane")) return answer(capture.current);
			return answer("");
		},
		spawnControl: (args) => {
			spawned.push([...args]);
			const control = createFakeControl();
			controls.push(control);
			return control;
		},
		schedule: (callback, delayMs) => {
			timers.push({callback, delayMs});
			return timers.length;
		},
		cancel: () => undefined,
	};
	return {io, calls, controls, spawned, timers, geometry, capture};
}

async function flush(): Promise<void> {
	for (let index = 0; index < 10; index += 1) await Promise.resolve();
	await new Promise((resolve) => {
		setImmediate(resolve);
	});
}

function sent(socket: ReturnType<typeof createSocket>): unknown[] {
	return socket.send.mock.calls.map(([message]) => {
		const record = JSON.parse(message) as Record<string, unknown>;
		return typeof record["bytes"] === "string"
			? {...record, bytes: Buffer.from(record["bytes"], "base64").toString()}
			: record;
	});
}

const KEYFRAME = "\x1b[0m\x1b[H\x1b[2JAlice $\x1b[0m\x1b[2;5H\x1b[?25h";

function keyframe(seq: number, bytes = KEYFRAME) {
	return {type: "terminal.frame", seq, encoding: "ansi", width: 100, height: 3, full: true, bytes};
}

function delta(seq: number, bytes: string) {
	return {type: "terminal.frame", seq, encoding: "ansi", width: 100, height: 3, full: false, bytes};
}

const PANE = {paneId: "%5", socketPath: "/tmp/tmux-501/default"};

describe("tmux control-mode terminal stream", () => {
	it("attaches read-only without resizing, sends a keyframe, then only this pane's output", async () => {
		const harness = createHarness();
		const socket = createSocket();

		const stream = await startTmuxTerminalStream({pane: PANE, interactive: false}, socket, harness.io);
		await flush();
		const control = harness.controls[0];
		control?.stdout.write("%output %5 Alice\\015\\012\n%output %6 Bob\n%output %5 hi\n");
		await flush();

		expect({spawned: harness.spawned, sent: sent(socket), closed: socket.close.mock.calls}).toStrictEqual({
			spawned: [
				["-S", "/tmp/tmux-501/default", "-C", "attach-session", "-t", "$3", "-f", "ignore-size,read-only"],
			],
			sent: [keyframe(1), delta(2, "Alice\r\n"), delta(3, "hi")],
			closed: [],
		});
		stream.stop();
		expect(control?.kill).toHaveBeenCalledWith("SIGTERM");
	});

	it("drops output that arrives before the first keyframe and refreshes the keyframe afterwards", async () => {
		const harness = createHarness();
		const socket = createSocket();
		let releaseCapture: (value: string) => void = () => undefined;
		const output = harness.io.output;
		harness.io.output = async (args) => {
			if (args.includes("capture-pane")) {
				return new Promise((resolve) => {
					releaseCapture = resolve;
				});
			}
			return output(args);
		};

		await startTmuxTerminalStream({pane: PANE, interactive: false}, socket, harness.io);
		await flush();
		harness.controls[0]?.stdout.write("%output %5 early\n");
		await flush();
		releaseCapture("Alice $\n");
		await flush();

		expect({sent: sent(socket), timers: harness.timers.map((timer) => timer.delayMs)}).toStrictEqual({
			sent: [keyframe(1)],
			timers: [100],
		});
	});

	it("re-keyframes on a layout change of the pane's window and ignores other windows", async () => {
		const harness = createHarness();
		const socket = createSocket();

		await startTmuxTerminalStream({pane: PANE, interactive: false}, socket, harness.io);
		await flush();
		harness.geometry.current = "$3\t@7\t120\t3\t0\t0\t1\t0\n";
		harness.controls[0]?.stdout.write("%layout-change @8 x x *\n%layout-change @7 x x *\n");
		await flush();

		expect(sent(socket)).toStrictEqual([
			keyframe(1),
			{...keyframe(2, "\x1b[0m\x1b[H\x1b[2JAlice $\x1b[0m\x1b[1;1H\x1b[?25h"), width: 120},
		]);
	});

	it("closes when the pane's window closes, and not for another window", async () => {
		const harness = createHarness();
		const socket = createSocket();

		await startTmuxTerminalStream({pane: PANE, interactive: false}, socket, harness.io);
		await flush();
		harness.controls[0]?.stdout.write("%window-close @8\n%window-close @7\n");
		await flush();

		expect({sent: sent(socket), closed: socket.close.mock.calls}).toStrictEqual({
			sent: [keyframe(1), {type: "terminal.closed"}],
			closed: [[1000, "terminal closed"]],
		});
	});

	it("closes when a fresh keyframe finds the pane gone", async () => {
		const harness = createHarness();
		const socket = createSocket();

		await startTmuxTerminalStream({pane: PANE, interactive: false}, socket, harness.io);
		await flush();
		harness.geometry.current = new Error("can't find pane: %5");
		harness.controls[0]?.stdout.write("%layout-change @7 x x *\n");
		await flush();

		expect({sent: sent(socket), closed: socket.close.mock.calls}).toStrictEqual({
			sent: [keyframe(1), {type: "terminal.closed"}],
			closed: [[1000, "terminal closed"]],
		});
	});

	it("falls back to polling when the control client exits, closing once the pane is gone", async () => {
		const harness = createHarness();
		const socket = createSocket();

		await startTmuxTerminalStream({pane: PANE, interactive: false}, socket, harness.io);
		await flush();
		harness.controls[0]?.stdout.write("%exit\n");
		harness.controls[0]?.emit("exit", 0, null);
		await flush();
		harness.capture.current = "Alice $ ls\n";
		harness.timers.at(-1)?.callback();
		await flush();
		harness.geometry.current = "$3\t@7\t100\t3\t4\t1\t1\t1\n";
		harness.timers.at(-1)?.callback();
		await flush();

		expect({sent: sent(socket), closed: socket.close.mock.calls}).toStrictEqual({
			sent: [
				keyframe(1),
				keyframe(2, "\x1b[0m\x1b[H\x1b[2JAlice $ ls\x1b[0m\x1b[2;5H\x1b[?25h"),
				{type: "terminal.closed"},
			],
			closed: [[1000, "terminal closed"]],
		});
	});

	it("polls capture-pane every 250 ms on tmux older than 3.2, sending only changed screens", async () => {
		const harness = createHarness("tmux 3.1c\n");
		const socket = createSocket();

		await startTmuxTerminalStream({pane: PANE, interactive: false}, socket, harness.io);
		await flush();
		harness.timers.at(-1)?.callback();
		await flush();
		harness.capture.current = "Alice $ ls\n";
		harness.timers.at(-1)?.callback();
		await flush();

		expect({
			spawned: harness.spawned,
			sent: sent(socket),
			delays: harness.timers.map((timer) => timer.delayMs),
		}).toStrictEqual({
			spawned: [],
			sent: [keyframe(1), keyframe(2, "\x1b[0m\x1b[H\x1b[2JAlice $ ls\x1b[0m\x1b[2;5H\x1b[?25h")],
			delays: [250, 250, 250],
		});
	});

	it("rejects when the pane is already gone", async () => {
		const harness = createHarness();
		harness.geometry.current = new Error("can't find pane: %5");

		await expect(
			startTmuxTerminalStream({pane: PANE, interactive: false}, createSocket(), harness.io),
		).rejects.toThrow("The tmux pane %5 is gone");
	});
});

describe("tmux interactive terminal stream", () => {
	it("attaches without read-only and types data frames through the control client, ignoring resizes", async () => {
		const harness = createHarness();
		const socket = createSocket();

		const controller = await startTmuxTerminalStream({pane: PANE, interactive: true}, socket, harness.io);
		await flush();
		controller.input(JSON.stringify({type: "data", data: "\x1b[A"}));
		controller.input(JSON.stringify({type: "resize", cols: 40, rows: 10}));

		expect({spawned: harness.spawned, written: harness.controls[0]?.written}).toStrictEqual({
			spawned: [["-S", "/tmp/tmux-501/default", "-C", "attach-session", "-t", "$3", "-f", "ignore-size"]],
			written: ["send-keys -t %5 -H 1b 5b 41\n"],
		});
	});

	it("types through tmux commands when polling", async () => {
		const harness = createHarness("tmux 3.0\n");
		const socket = createSocket();

		const controller = await startTmuxTerminalStream({pane: PANE, interactive: true}, socket, harness.io);
		await flush();
		controller.input(JSON.stringify({type: "data", data: "y"}));
		await flush();

		expect(harness.calls.filter((args) => args.includes("send-keys"))).toStrictEqual([
			["-S", "/tmp/tmux-501/default", "send-keys", "-t", "%5", "-H", "79"],
		]);
	});

	it("closes on an invalid control frame", async () => {
		const harness = createHarness();
		const socket = createSocket();

		const controller = await startTmuxTerminalStream({pane: PANE, interactive: true}, socket, harness.io);
		await flush();
		controller.input("not json");

		expect({sent: sent(socket).at(-1), closed: socket.close.mock.calls}).toStrictEqual({
			sent: {type: "observer.error", message: "invalid terminal control frame"},
			closed: [[1008, "invalid terminal control frame"]],
		});
	});
});

describe("tmux stream shutdown", () => {
	it("closes every open stream with 1012", async () => {
		const harness = createHarness();
		const socket = createSocket();

		await startTmuxTerminalStream({pane: PANE, interactive: false}, socket, harness.io);
		await flush();
		stopAllTmuxTerminalStreams();

		expect(socket.close.mock.calls).toStrictEqual([[1012, "terminal observer server stopped"]]);
	});
});

describe("tmux host live terminal", () => {
	const sources = (panes: string) => ({
		entries: () => [],
		registry: () => [{sessionId: "session-test-tmux-stream", pid: 700, cwd: "/tmp/test"}],
		listPanes: async () => Promise.resolve(panes),
		processTable: async () => Promise.resolve(""),
	});
	const paneLine = ["%5", "700", "/tmp/tmux-501/default", "main", "0", "zsh", "1", "1", "/tmp/test"].join("\t");

	it("streams the session's tmux pane", async () => {
		const harness = createHarness();
		const socket = createSocket();
		const host = createTmuxTerminalHost(sources(paneLine), undefined, undefined, harness.io);

		const observer = await host.observe("session-test-tmux-stream", 80, 24, socket);
		await flush();
		observer.stop();

		expect({canStream: host.canStream, sent: sent(socket), spawned: harness.spawned}).toStrictEqual({
			canStream: true,
			sent: [keyframe(1)],
			spawned: [
				["-S", "/tmp/tmux-501/default", "-C", "attach-session", "-t", "$3", "-f", "ignore-size,read-only"],
			],
		});
	});

	it("rejects a session without a tmux pane", async () => {
		const host = createTmuxTerminalHost(sources(""), undefined, undefined, createHarness().io);

		await expect(host.control("session-test-tmux-stream", 80, 24, createSocket())).rejects.toThrow(
			"No live tmux pane is linked to this session",
		);
	});
});
