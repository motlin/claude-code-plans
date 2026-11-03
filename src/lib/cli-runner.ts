import {spawn, type ChildProcess} from "node:child_process";

import {buildLaunchFlags, type LaunchOptions} from "./launch-options";

interface SpawnOptions {
	sessionId: string;
	prompt: string;
	projectDir: string;
	environment: Record<string, string>;
	/** Ask without persisting: the fork writes no session JSONL. */
	ephemeral?: boolean;
	/** Composer mode / model / effort, appended as CLI flags. */
	launchOptions?: LaunchOptions;
}

const activeProcesses = new Map<string, ChildProcess>();

export function spawnClaude({
	sessionId,
	prompt,
	projectDir,
	environment,
	ephemeral = false,
	launchOptions = {},
}: SpawnOptions): {
	stream: ReadableStream<Uint8Array>;
	processId: string;
} {
	const processId = `${sessionId}-${Date.now()}`;

	const args = [
		"--resume",
		sessionId,
		"--fork-session",
		"-p",
		prompt,
		"--output-format",
		"stream-json",
		"--verbose",
		"--include-partial-messages",
	];
	if (ephemeral) args.push("--no-session-persistence");
	args.push(...buildLaunchFlags(launchOptions));

	const child = spawn("claude", args, {
		cwd: projectDir,
		stdio: ["ignore", "pipe", "pipe"],
		env: {...process.env, ...environment},
	});

	activeProcesses.set(processId, child);

	const encoder = new TextEncoder();
	// stdout bytes after the last newline: held back so events from stderr or
	// exit never land inside a partially written stream-json line.
	let stdoutTail: Buffer = Buffer.alloc(0);

	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			const flushStdoutTail = () => {
				if (stdoutTail.length === 0) return;
				const line = Buffer.concat([stdoutTail, Buffer.from("\n")]);
				stdoutTail = Buffer.alloc(0);
				controller.enqueue(new Uint8Array(line));
			};

			child.stdout.on("data", (chunk: Buffer) => {
				const pending = stdoutTail.length === 0 ? chunk : Buffer.concat([stdoutTail, chunk]);
				const lastNewline = pending.lastIndexOf(0x0a);
				if (lastNewline === -1) {
					stdoutTail = pending;
					return;
				}
				stdoutTail = pending.subarray(lastNewline + 1);
				try {
					controller.enqueue(new Uint8Array(pending.subarray(0, lastNewline + 1)));
				} catch {
					// stream closed
				}
			});

			child.stderr.on("data", (chunk: Buffer) => {
				const text = chunk.toString().trim();
				if (text) {
					try {
						const errorEvent = JSON.stringify({type: "error", message: text}) + "\n";
						controller.enqueue(encoder.encode(errorEvent));
					} catch {
						// stream closed
					}
				}
			});

			child.on("close", (code) => {
				activeProcesses.delete(processId);
				try {
					flushStdoutTail();
					if (code !== 0 && code !== null) {
						const errorEvent =
							JSON.stringify({
								type: "error",
								message: `Process exited with code ${code}`,
							}) + "\n";
						controller.enqueue(encoder.encode(errorEvent));
					}
					controller.close();
				} catch {
					// already closed
				}
			});

			child.on("error", (err) => {
				activeProcesses.delete(processId);
				try {
					flushStdoutTail();
					const errorEvent = JSON.stringify({type: "error", message: err.message}) + "\n";
					controller.enqueue(encoder.encode(errorEvent));
					controller.close();
				} catch {
					// already closed
				}
			});
		},
		cancel() {
			killProcess(processId);
		},
	});

	return {stream, processId};
}

export function killProcess(processId: string): boolean {
	const child = activeProcesses.get(processId);
	if (!child) return false;
	child.kill("SIGTERM");
	activeProcesses.delete(processId);
	return true;
}
