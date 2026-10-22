import {execFile} from "node:child_process";
import {readFileSync} from "node:fs";
import {readdir, readFile} from "node:fs/promises";
import {homedir} from "node:os";
import {join} from "node:path";
import type {z} from "zod";
import {SessionRegistryFileSchema} from "./runtime-schemas";
import {SessionRegistryFileSchema as StrictSessionRegistryFileSchema} from "./schemas";
import {errnoCode} from "./narrow";

/**
 * Reader for the CLI's live session registry, `~/.claude/sessions/<pid>.json`.
 *
 * The directory also holds `<pid>.<hash>.key` secrets: only names matching
 * `isRegistryFileName` are ever opened, and `messagingSocketPath` is never
 * connected to.
 */

export type SessionRegistryEntry = z.infer<typeof SessionRegistryFileSchema>;

export const SESSION_REGISTRY_DIR = join(homedir(), ".claude", "sessions");

const REGISTRY_FILE_NAME = /^\d+\.json$/;

export function isRegistryFileName(name: string): boolean {
	return REGISTRY_FILE_NAME.test(name);
}

const reportedDrift = new Set<string>();

/** Warn once per file and drift, so a new CLI field or status is visible while its session reads ended. */
function warnDriftOnce(name: string, message: string): void {
	const key = `${name}\0${message}`;
	if (reportedDrift.has(key)) return;
	reportedDrift.add(key);
	console.warn(`Session registry ${name} failed strict validation (schema drift): ${message}`);
}

/**
 * Every valid registry file in `dir`. Unreadable or torn files are skipped
 * quietly; one that parses but fails the strict schema is reported as drift.
 */
export async function readSessionRegistry(
	dir: string = SESSION_REGISTRY_DIR,
	reportDrift: (name: string, message: string) => void = warnDriftOnce,
): Promise<SessionRegistryEntry[]> {
	let names: string[];
	try {
		names = await readdir(dir);
	} catch {
		return [];
	}
	const entries = await Promise.all(
		names.filter(isRegistryFileName).map(async (name) => {
			let raw: unknown;
			try {
				raw = JSON.parse(await readFile(join(dir, name), "utf8"));
			} catch {
				return null;
			}
			// The strict parse reports drift; the lenient twin still keeps the entry.
			const result = StrictSessionRegistryFileSchema.safeParse(raw);
			if (result.success) return result.data;
			reportDrift(
				name,
				result.error.issues.map((issue) => `${issue.path.join(".")} ${issue.message}`).join("; "),
			);
			const lenient = SessionRegistryFileSchema.safeParse(raw);
			return lenient.success ? lenient.data : null;
		}),
	);
	return entries.filter((entry) => entry !== null);
}

type KillFn = (pid: number, signal: 0) => unknown;

/** Signal 0 probes a pid without signalling it; EPERM means it exists under another user. */
export function isPidAlive(pid: number, kill: KillFn = (target, signal) => process.kill(target, signal)): boolean {
	try {
		kill(pid, 0);
		return true;
	} catch (error) {
		return errnoCode(error) === "EPERM";
	}
}

function normalizeStartTime(value: string): string {
	return value.trim().replace(/\s+/g, " ");
}

/** Parse `ps -o pid=,lstart=` output into pid → whitespace-normalized start time. */
export function parsePsStartTimes(output: string): Map<number, string> {
	const times = new Map<number, string>();
	for (const line of output.split("\n")) {
		const [, pid, startTime] = /^\s*(\d+)\s+(.+)$/.exec(line) ?? [];
		if (pid !== undefined && startTime !== undefined) times.set(Number(pid), normalizeStartTime(startTime));
	}
	return times;
}

/**
 * Start times for `pids` from one `ps` call, in UTC like the CLI's `procStart`.
 * `ps` exits non-zero when some pids are gone but still prints the rest.
 * Null when `ps` cannot run at all.
 */
async function readProcessStartTimes(pids: readonly number[]): Promise<Map<number, string> | null> {
	if (pids.length === 0) return Promise.resolve(new Map());
	return new Promise((resolve) => {
		execFile(
			"ps",
			["-o", "pid=,lstart=", "-p", pids.join(",")],
			{env: {...process.env, TZ: "UTC", LC_ALL: "C"}, timeout: 5000},
			(error, stdout) => {
				if (error && (typeof stdout !== "string" || stdout.trim() === "")) {
					const exitedWithStatus = typeof (error as {code?: unknown}).code === "number";
					resolve(exitedWithStatus ? new Map() : null);
					return;
				}
				resolve(parsePsStartTimes(stdout));
			},
		);
	});
}

/**
 * Start time in clock ticks, field 22 of `/proc/<pid>/stat`. The comm field
 * (2) can hold spaces and parentheses, so fields are counted after the last ")".
 */
export function parseStatStartTicks(stat: string): string | null {
	const commEnd = stat.lastIndexOf(")");
	if (commEnd === -1) return null;
	const fields = stat
		.slice(commEnd + 1)
		.trim()
		.split(/\s+/);
	return fields[19] ?? null;
}

/** Null when `/proc` is unavailable (macOS) or the pid is gone. */
function readStatStartTicks(pid: number): string | null {
	try {
		return parseStatStartTicks(readFileSync(`/proc/${pid}/stat`, "utf8"));
	} catch {
		return null;
	}
}

export interface LivenessProbe {
	isAlive: (pid: number) => boolean;
	readStartTimes: (pids: readonly number[]) => Promise<Map<number, string> | null>;
	readStatStartTicks?: (pid: number) => string | null;
}

const defaultProbe: LivenessProbe = {
	isAlive: (pid) => isPidAlive(pid),
	readStartTimes: readProcessStartTimes,
	readStatStartTicks,
};

/** Newer Linux CLIs write `procStart` as `/proc/<pid>/stat` start ticks rather than `ps` text. */
const CLOCK_TICK_PROC_START = /^\d+$/;

/**
 * The entries whose process is still the one that wrote them. A crashed CLI
 * leaves its file behind, so a pid must answer signal 0, and to guard against
 * pid reuse its current start time (`ps -o lstart`, UTC) must equal the file's
 * `procStart`. When `ps` cannot run the signal-0 check alone decides. A
 * clock-tick `procStart` is compared with `/proc/<pid>/stat` instead, and
 * kept when the ticks cannot be read.
 */
export async function liveRegistryEntries(
	entries: readonly SessionRegistryEntry[],
	probe: LivenessProbe = defaultProbe,
): Promise<SessionRegistryEntry[]> {
	const running = entries.filter((entry) => probe.isAlive(entry.pid));
	const startTimes = await probe.readStartTimes(running.map((entry) => entry.pid));
	return running.filter((entry) => {
		if (CLOCK_TICK_PROC_START.test(entry.procStart)) {
			const ticks = probe.readStatStartTicks?.(entry.pid) ?? null;
			return ticks === null || ticks === entry.procStart;
		}
		return startTimes === null || startTimes.get(entry.pid) === normalizeStartTime(entry.procStart);
	});
}
