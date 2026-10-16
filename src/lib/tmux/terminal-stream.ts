import {execFile, spawn} from "node:child_process";
import type {Readable} from "node:stream";
import {z} from "zod";
import {hmrDispose} from "../hmr-persist";
import type {TerminalController} from "../herdr/terminal-controller";
import {ViewportDimensionSchema, type TerminalObserverSocket} from "../herdr/terminal-observer";

/**
 * Live terminal frames for a tmux pane, in the same `terminal.frame` /
 * `terminal.closed` records herdr streams, so the browser side is unchanged.
 *
 * tmux 3.2+: one control-mode client (`tmux -C attach -f ignore-size,…`) per
 * watched pane, so the user's windows are never resized. A keyframe is
 * `capture-pane -p -e` plus the pane's cursor and size; deltas are that pane's
 * unescaped `%output`. `%layout-change` of its window takes a fresh keyframe,
 * and `%window-close` (or a keyframe finding the pane gone) closes the stream.
 *
 * Older tmux, or a control client that exits, falls back to a keyframe every
 * 250 ms, sent only when the screen changed.
 */

const POLL_INTERVAL_MS = 250;
/** Wait before re-taking a keyframe that output raced, so a burst of output coalesces. */
const KEYFRAME_REFRESH_MS = 100;
const SEND_KEYS_CHUNK_BYTES = 512;
const MAXIMUM_LINE_BYTES = 5 * 1024 * 1024;

export type TmuxControlNotification =
	| {type: "output"; paneId: string; bytes: Buffer}
	| {type: "layout-change"; windowId: string}
	| {type: "window-close"; windowId: string}
	| {type: "exit"};

const BACKSLASH = 0x5c;

function isOctalDigit(byte: number | undefined): byte is number {
	return byte !== undefined && byte >= 0x30 && byte <= 0x37;
}

/** Undo control mode's escaping: bytes below 0x20 and `\` arrive as `\ooo`; everything else is raw. */
export function unescapeTmuxOutput(value: Buffer): Buffer {
	const bytes: number[] = [];
	for (let index = 0; index < value.length; index += 1) {
		const byte = value[index] ?? 0;
		const first = value[index + 1];
		const second = value[index + 2];
		const third = value[index + 3];
		if (byte === BACKSLASH && isOctalDigit(first) && isOctalDigit(second) && isOctalDigit(third)) {
			bytes.push(((first - 0x30) * 64 + (second - 0x30) * 8 + (third - 0x30)) & 0xff);
			index += 3;
		} else {
			bytes.push(byte);
		}
	}
	return Buffer.from(bytes);
}

const OUTPUT_PREFIX = "%output ";

function parseNotification(line: Buffer): TmuxControlNotification | null {
	if (line.subarray(0, OUTPUT_PREFIX.length).toString("latin1") === OUTPUT_PREFIX) {
		const space = line.indexOf(0x20, OUTPUT_PREFIX.length);
		const end = space === -1 ? line.length : space;
		const paneId = line.subarray(OUTPUT_PREFIX.length, end).toString("latin1");
		const data = space === -1 ? Buffer.alloc(0) : line.subarray(space + 1);
		return {type: "output", paneId, bytes: unescapeTmuxOutput(data)};
	}
	const [name, id] = line.toString("utf8").split(" ");
	switch (name) {
		case "%layout-change":
			return id === undefined ? null : {type: "layout-change", windowId: id};
		case "%window-close":
		case "%unlinked-window-close":
			return id === undefined ? null : {type: "window-close", windowId: id};
		case "%exit":
			return {type: "exit"};
		default:
			return null;
	}
}

/**
 * Split control-mode stdout into notifications. Lines are split as bytes so a
 * UTF-8 character across chunks stays whole; command replies between
 * `%begin` and `%end`/`%error` are skipped, as are notifications ccp ignores.
 */
export function createTmuxControlParser(onNotification: (notification: TmuxControlNotification) => void): {
	push: (chunk: Buffer | string) => void;
} {
	let buffer = Buffer.alloc(0);
	let inBlock = false;
	return {
		push(chunk) {
			buffer = Buffer.concat([buffer, typeof chunk === "string" ? Buffer.from(chunk) : chunk]);
			let newline = buffer.indexOf(0x0a);
			while (newline !== -1) {
				const line = buffer.subarray(0, newline);
				buffer = buffer.subarray(newline + 1);
				const head = line.subarray(0, 7).toString("latin1");
				if (inBlock) {
					if (head.startsWith("%end ") || head.startsWith("%error ")) inBlock = false;
				} else if (head.startsWith("%begin ")) {
					inBlock = true;
				} else {
					const notification = parseNotification(line);
					if (notification !== null) onNotification(notification);
				}
				newline = buffer.indexOf(0x0a);
			}
			if (buffer.length > MAXIMUM_LINE_BYTES) buffer = Buffer.alloc(0);
		},
	};
}

export interface TmuxPaneGeometry {
	sessionId: string;
	windowId: string;
	width: number;
	height: number;
	cursorX: number;
	cursorY: number;
	cursorVisible: boolean;
	dead: boolean;
}

const TMUX_PANE_GEOMETRY_FORMAT = [
	"#{session_id}",
	"#{window_id}",
	"#{pane_width}",
	"#{pane_height}",
	"#{cursor_x}",
	"#{cursor_y}",
	"#{cursor_flag}",
	"#{pane_dead}",
].join("\t");

const GeometryNumber = z.coerce.number().int().nonnegative();
const DimensionNumber = z.coerce.number().int().positive().max(1000);

/** Parse `display-message -p -t %N TMUX_PANE_GEOMETRY_FORMAT`; null for anything else. */
export function parseTmuxPaneGeometry(stdout: string): TmuxPaneGeometry | null {
	const [sessionId, windowId, width, height, cursorX, cursorY, cursorFlag, paneDead, ...rest] = stdout
		.trim()
		.split("\t");
	if (rest.length > 0 || !sessionId?.startsWith("$") || !windowId?.startsWith("@")) return null;
	const parsed = z
		.object({width: DimensionNumber, height: DimensionNumber, cursorX: GeometryNumber, cursorY: GeometryNumber})
		.safeParse({width, height, cursorX, cursorY});
	if (!parsed.success) return null;
	return {
		sessionId,
		windowId,
		...parsed.data,
		cursorVisible: cursorFlag === "1",
		dead: paneDead === "1",
	};
}

/**
 * One full screen: reset and clear, the captured lines joined with CRLF (the
 * browser terminal does not convert LF), then the pane's cursor. Trailing empty
 * lines are left to the clear, and no line beyond the pane's height is drawn,
 * so the screen never scrolls.
 */
export function buildTmuxKeyframe(capture: string, geometry: TmuxPaneGeometry): Buffer {
	const lines = capture.split("\n").slice(0, geometry.height);
	while (lines.length > 0 && lines.at(-1) === "") lines.pop();
	const cursor = `\x1b[${String(geometry.cursorY + 1)};${String(geometry.cursorX + 1)}H`;
	const visibility = geometry.cursorVisible ? "\x1b[?25h" : "\x1b[?25l";
	return Buffer.from(`\x1b[0m\x1b[H\x1b[2J${lines.join("\r\n")}\x1b[0m${cursor}${visibility}`);
}

/** Control mode with `ignore-size` and `read-only` client flags arrived in tmux 3.2. */
export function tmuxSupportsControlStreams(versionOutput: string): boolean {
	const version = versionOutput.trim().replace(/^tmux\s+/, "");
	if (version === "master" || version.startsWith("next-")) return true;
	const match = /^(\d+)\.(\d+)/.exec(version);
	if (match === null) return false;
	const major = Number(match[1]);
	const minor = Number(match[2]);
	return major > 3 || (major === 3 && minor >= 2);
}

/** Raw terminal input as `send-keys -H` commands: one hex byte per key, so control bytes and UTF-8 survive. */
export function tmuxSendKeysCommands(paneId: string, text: string, chunkBytes = SEND_KEYS_CHUNK_BYTES): string[][] {
	const bytes = Buffer.from(text);
	const commands: string[][] = [];
	for (let offset = 0; offset < bytes.length; offset += chunkBytes) {
		const hex = [...bytes.subarray(offset, offset + chunkBytes)].map((byte) => byte.toString(16).padStart(2, "0"));
		commands.push(["send-keys", "-t", paneId, "-H", ...hex]);
	}
	return commands;
}

type Timer = ReturnType<typeof setTimeout>;

/** A spawned `tmux -C attach` client. */
export interface TmuxControlChild {
	stdin: {write: (text: string) => boolean; end: () => void};
	stdout: Readable;
	stderr: Readable;
	exitCode: number | null;
	signalCode: NodeJS.Signals | null;
	kill: (signal?: NodeJS.Signals) => boolean;
	on(event: "error", listener: (error: Error) => void): unknown;
	on(event: "exit", listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
}

export interface TmuxTerminalStreamIo {
	/** Runs `tmux <args>` and resolves its stdout; rejects when tmux fails. */
	output: (args: readonly string[]) => Promise<string>;
	spawnControl: (args: readonly string[]) => TmuxControlChild;
	schedule: (callback: () => void, delayMs: number) => Timer | number;
	cancel: (timer: Timer | number) => void;
}

export interface TmuxStreamPane {
	paneId: string;
	/** The tmux server socket; empty for the default server. */
	socketPath: string;
}

export interface TmuxTerminalStreamOptions {
	pane: TmuxStreamPane;
	/** Interactive streams attach without `read-only` and type data frames. */
	interactive: boolean;
}

const TerminalControlFrameSchema = z.discriminatedUnion("type", [
	z.object({type: z.literal("data"), data: z.string().max(64 * 1024)}).strict(),
	z.object({type: z.literal("resize"), cols: ViewportDimensionSchema, rows: ViewportDimensionSchema}).strict(),
]);

function parseControlFrame(message: string): z.infer<typeof TerminalControlFrameSchema> | null {
	try {
		const parsed = TerminalControlFrameSchema.safeParse(JSON.parse(message));
		return parsed.success ? parsed.data : null;
	} catch {
		return null;
	}
}

const activeStreams = new Set<TerminalController>();

/**
 * Stream one tmux pane to the socket. Rejects when the pane is already gone;
 * after that, every ending is reported on the socket. Resize frames are
 * ignored: the browser follows the pane's size, never the other way round.
 */
export async function startTmuxTerminalStream(
	{pane, interactive}: TmuxTerminalStreamOptions,
	socket: TerminalObserverSocket,
	io: TmuxTerminalStreamIo = defaultTmuxTerminalStreamIo,
): Promise<TerminalController> {
	const server = pane.socketPath === "" ? [] : ["-S", pane.socketPath];
	const readGeometry = async (): Promise<TmuxPaneGeometry | null> => {
		try {
			const geometry = parseTmuxPaneGeometry(
				await io.output([...server, "display-message", "-p", "-t", pane.paneId, TMUX_PANE_GEOMETRY_FORMAT]),
			);
			return geometry === null || geometry.dead ? null : geometry;
		} catch {
			return null;
		}
	};

	let geometry = await readGeometry();
	if (geometry === null) throw new Error(`The tmux pane ${pane.paneId} is gone`);
	const version = await io.output(["-V"]).catch(() => "");

	let stopped = false;
	let sequence = 0;
	/** Output is dropped until the first keyframe, and while one is being captured. */
	let capturing = true;
	let raced = false;
	/** The last keyframe sent, so polling only sends a changed screen. */
	let lastKeyframe: string | null = null;
	let timer: Timer | number | null = null;
	let control: TmuxControlChild | null = null;
	let mode: "control" | "poll" = "poll";
	let typing: Promise<unknown> = Promise.resolve();

	const send = (record: Record<string, unknown>): void => {
		socket.send(JSON.stringify(record));
	};

	const sendFrame = (bytes: Buffer, full: boolean, size: TmuxPaneGeometry): void => {
		sequence += 1;
		send({
			type: "terminal.frame",
			seq: sequence,
			encoding: "ansi",
			width: size.width,
			height: size.height,
			full,
			bytes: bytes.toString("base64"),
		});
	};

	const schedule = (delayMs: number): void => {
		if (timer !== null || stopped) return;
		timer = io.schedule(() => {
			timer = null;
			void keyframe();
		}, delayMs);
	};

	const releaseResources = (): void => {
		stopped = true;
		activeStreams.delete(stream);
		if (timer !== null) io.cancel(timer);
		timer = null;
		if (control !== null) {
			control.stdin.end();
			if (control.exitCode === null && control.signalCode === null) control.kill("SIGTERM");
		}
	};

	const close = (): void => {
		if (stopped) return;
		send({type: "terminal.closed"});
		socket.close(1000, "terminal closed");
		releaseResources();
	};

	const isStopped = (): boolean => stopped;
	/** Output or a layout change arrives while a capture is awaited. */
	const wasRaced = (): boolean => raced;

	async function keyframe(): Promise<void> {
		if (stopped) return;
		capturing = true;
		raced = false;
		const [next, capture] = await Promise.all([
			readGeometry(),
			io.output([...server, "capture-pane", "-p", "-e", "-t", pane.paneId]).catch(() => null),
		]);
		if (isStopped()) return;
		if (next === null || capture === null) {
			close();
			return;
		}
		geometry = next;
		capturing = false;
		const bytes = buildTmuxKeyframe(capture, next);
		const screen = `${String(next.width)}x${String(next.height)}\0${bytes.toString("latin1")}`;
		if (mode === "poll") {
			if (screen !== lastKeyframe) sendFrame(bytes, true, next);
			lastKeyframe = screen;
			schedule(POLL_INTERVAL_MS);
			return;
		}
		sendFrame(bytes, true, next);
		lastKeyframe = screen;
		if (wasRaced()) schedule(KEYFRAME_REFRESH_MS);
	}

	const requestKeyframe = (): void => {
		if (capturing) raced = true;
		else void keyframe();
	};

	const fallBackToPolling = (): void => {
		if (stopped || mode === "poll") return;
		mode = "poll";
		control = null;
		if (!capturing) void keyframe();
	};

	const onNotification = (notification: TmuxControlNotification): void => {
		if (stopped || geometry === null) return;
		switch (notification.type) {
			case "output":
				if (notification.paneId !== pane.paneId) return;
				if (capturing) raced = true;
				else sendFrame(notification.bytes, false, geometry);
				return;
			case "layout-change":
				if (notification.windowId === geometry.windowId) requestKeyframe();
				return;
			case "window-close":
				if (notification.windowId === geometry.windowId) close();
				return;
			case "exit":
				fallBackToPolling();
		}
	};

	const typeText = (text: string): void => {
		const commands = tmuxSendKeysCommands(pane.paneId, text);
		const client = mode === "control" ? control : null;
		if (client !== null) {
			for (const command of commands) client.stdin.write(`${command.join(" ")}\n`);
			return;
		}
		typing = typing.then(async () => {
			for (const command of commands) await io.output([...server, ...command]);
		});
		typing = typing.catch(() => undefined);
	};

	const stream: TerminalController = {
		input(message) {
			if (stopped || !interactive) return;
			const frame = parseControlFrame(message);
			if (frame === null) {
				send({type: "observer.error", message: "invalid terminal control frame"});
				socket.close(1008, "invalid terminal control frame");
				releaseResources();
				return;
			}
			if (frame.type === "data") typeText(frame.data);
		},
		stop: releaseResources,
		shutdown() {
			if (stopped) return;
			socket.close(1012, "terminal observer server stopped");
			releaseResources();
		},
	};
	activeStreams.add(stream);

	if (tmuxSupportsControlStreams(version)) {
		const flags = interactive ? "ignore-size" : "ignore-size,read-only";
		const child = io.spawnControl([...server, "-C", "attach-session", "-t", geometry.sessionId, "-f", flags]);
		const parser = createTmuxControlParser(onNotification);
		child.stdout.on("data", (chunk: Buffer | string) => {
			parser.push(chunk);
		});
		child.stderr.on("data", () => undefined);
		child.on("error", fallBackToPolling);
		child.on("exit", fallBackToPolling);
		control = child;
		mode = "control";
	}

	void keyframe();
	return stream;
}

export function stopAllTmuxTerminalStreams(): void {
	for (const stream of activeStreams) stream.shutdown();
}

hmrDispose(stopAllTmuxTerminalStreams);

const TMUX_STREAM_COMMAND_TIMEOUT_MS = 2000;

export const defaultTmuxTerminalStreamIo: TmuxTerminalStreamIo = {
	output: async (args) =>
		new Promise((resolve, reject) => {
			execFile(
				"tmux",
				[...args],
				{timeout: TMUX_STREAM_COMMAND_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024},
				(error: Error | null, stdout: string) => {
					if (error) reject(error);
					else resolve(stdout);
				},
			);
		}),
	spawnControl: (args) => spawn("tmux", [...args], {stdio: ["pipe", "pipe", "pipe"]}),
	schedule: setTimeout,
	cancel: (timer) => {
		clearTimeout(timer);
	},
};
