import {execFile} from "node:child_process";
import {currentPerfCounters} from "./server-scope";

/**
 * Runs a command without blocking the event loop, resolving with its stdout, and counts one `proc.spawned` in the
 * active perf scope.
 */
export function trackedExecFile(file: string, args: readonly string[], options: {cwd: string}): Promise<string> {
	const counters = currentPerfCounters();
	if (counters !== undefined) counters.proc.spawned += 1;
	return new Promise((resolve, reject) => {
		execFile(file, args, {cwd: options.cwd, encoding: "utf-8"}, (error, stdout) => {
			if (error) reject(error);
			else resolve(stdout);
		});
	});
}
