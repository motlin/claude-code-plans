import {spawn, type ChildProcess} from 'node:child_process';

export interface SpawnOptions {
	sessionId: string;
	prompt: string;
	projectDir: string;
}

const activeProcesses = new Map<string, ChildProcess>();

export function spawnClaude({sessionId, prompt, projectDir}: SpawnOptions): {
	stream: ReadableStream<Uint8Array>;
	processId: string;
} {
	const processId = `${sessionId}-${Date.now()}`;

	const args = [
		'--resume',
		sessionId,
		'--fork-session',
		'-p',
		prompt,
		'--output-format',
		'stream-json',
		'--verbose',
		'--include-partial-messages',
	];

	const child = spawn('claude', args, {
		cwd: projectDir,
		stdio: ['ignore', 'pipe', 'pipe'],
		env: {...process.env},
	});

	activeProcesses.set(processId, child);

	const encoder = new TextEncoder();

	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			child.stdout!.on('data', (chunk: Buffer) => {
				try {
					controller.enqueue(encoder.encode(chunk.toString()));
				} catch {
					// stream closed
				}
			});

			child.stderr!.on('data', (chunk: Buffer) => {
				const text = chunk.toString().trim();
				if (text) {
					try {
						const errorEvent = JSON.stringify({type: 'error', message: text}) + '\n';
						controller.enqueue(encoder.encode(errorEvent));
					} catch {
						// stream closed
					}
				}
			});

			child.on('close', (code) => {
				activeProcesses.delete(processId);
				try {
					if (code !== 0 && code !== null) {
						const errorEvent =
							JSON.stringify({type: 'error', message: `Process exited with code ${code}`}) + '\n';
						controller.enqueue(encoder.encode(errorEvent));
					}
					controller.close();
				} catch {
					// already closed
				}
			});

			child.on('error', (err) => {
				activeProcesses.delete(processId);
				try {
					const errorEvent = JSON.stringify({type: 'error', message: err.message}) + '\n';
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
	child.kill('SIGTERM');
	activeProcesses.delete(processId);
	return true;
}

export function getActiveProcessIds(): string[] {
	return Array.from(activeProcesses.keys());
}
