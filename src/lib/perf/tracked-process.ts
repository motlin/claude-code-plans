import {execSync, type ExecSyncOptionsWithStringEncoding} from "node:child_process";
import {currentPerfCounters} from "./server-scope";

/** `execSync` that counts one `proc.spawned` in the active perf scope. */
export function trackedExecSync(command: string, options: ExecSyncOptionsWithStringEncoding): string {
	const counters = currentPerfCounters();
	if (counters !== undefined) counters.proc.spawned += 1;
	return execSync(command, options);
}
