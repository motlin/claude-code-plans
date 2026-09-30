import {spawn, type ChildProcessByStdio} from "node:child_process";
import type {Readable, Writable} from "node:stream";
import {z} from "zod";
import {herdrWritesEnabled} from "../config";
import {rejectCrossSite} from "../same-origin-guard";
import {
	bridgeTerminalStream,
	parseViewport,
	resolveSessionTerminal,
	sessionStreamArguments,
	type ObserverOptions,
	type TerminalObserver,
	type TerminalObserverSocket,
	ViewportDimensionSchema,
} from "./terminal-observer";

const TerminalControlFrameSchema = z.discriminatedUnion("type", [
	z.object({type: z.literal("data"), data: z.string().max(64 * 1024)}).strict(),
	z
		.object({
			type: z.literal("resize"),
			cols: ViewportDimensionSchema,
			rows: ViewportDimensionSchema,
		})
		.strict(),
]);

type ControllerChild = ChildProcessByStdio<Writable, Readable, Readable>;
type SpawnController = (
	command: string,
	arguments_: readonly string[],
	options: {stdio: ["pipe", "pipe", "pipe"]},
) => ControllerChild;

export interface TerminalController extends TerminalObserver {
	/** Apply one client WebSocket frame: `{type:"data"}` or `{type:"resize"}`. */
	input: (message: string) => void;
}

export interface TerminalControllerDependencies {
	resolveTarget: (sessionId: string) => Promise<string>;
	spawnController: SpawnController;
}

function parseFrame(message: string): z.infer<typeof TerminalControlFrameSchema> | null {
	try {
		const parsed = TerminalControlFrameSchema.safeParse(JSON.parse(message));
		return parsed.success ? parsed.data : null;
	} catch {
		return null;
	}
}

/**
 * Spawn `herdr terminal session control` without `--takeover`, so an attached
 * herdr client keeps its seat, and translate client frames into herdr's
 * NDJSON control commands on stdin.
 */
export function startTerminalController(
	options: ObserverOptions,
	socket: TerminalObserverSocket,
	spawnController: SpawnController = spawn,
): TerminalController {
	const viewport = parseViewport(options.columns, options.rows);
	const child = spawnController("herdr", sessionStreamArguments("control", {target: options.target, ...viewport}), {
		stdio: ["pipe", "pipe", "pipe"],
	});
	const stream = bridgeTerminalStream(child, socket);
	let stopped = false;

	const stop = (): void => {
		stopped = true;
		child.stdin.end();
		stream.stop();
	};

	const writeCommand = (command: Record<string, unknown>): void => {
		child.stdin.write(`${JSON.stringify(command)}\n`);
	};

	return {
		input(message) {
			if (stopped) return;
			const frame = parseFrame(message);
			if (frame === null) {
				socket.send(JSON.stringify({type: "observer.error", message: "invalid terminal control frame"}));
				socket.close(1008, "invalid terminal control frame");
				stop();
				return;
			}
			if (frame.type === "data") writeCommand({type: "terminal.input", text: frame.data});
			else writeCommand({type: "terminal.resize", cols: frame.cols, rows: frame.rows});
		},
		stop,
		shutdown() {
			stopped = true;
			child.stdin.end();
			stream.shutdown();
		},
	};
}

const defaultDependencies: TerminalControllerDependencies = {
	resolveTarget: resolveSessionTerminal,
	spawnController: spawn,
};

export async function controlHerdrSession(
	sessionId: string,
	columns: number,
	rows: number,
	socket: TerminalObserverSocket,
	dependencies: TerminalControllerDependencies = defaultDependencies,
): Promise<TerminalController> {
	const target = await dependencies.resolveTarget(sessionId);
	return startTerminalController({target, columns, rows}, socket, dependencies.spawnController);
}

/** Upgrade gate: same-origin only, and only while herdr writes are enabled. */
export function authorizeTerminalControl(
	request: Request,
	dependencies: {writesEnabled: () => boolean} = {writesEnabled: herdrWritesEnabled},
): Response | null {
	const rejection = rejectCrossSite(request);
	if (rejection) return rejection;
	if (!dependencies.writesEnabled()) {
		return Response.json({error: "herdr writes are disabled"}, {status: 403});
	}
	return null;
}
