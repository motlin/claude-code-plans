import {mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync} from "node:fs";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";
import {threadId} from "node:worker_threads";
import {z} from "zod";

/**
 * Perf ratchet (measurement plan §4.4). Every measured count must equal its checked-in ceiling within the entry's
 * tolerance: a rise is a regression, and a drop must be locked in by lowering the ceiling in the same commit. There is
 * no automatic write mode; `results.json` only records what was measured.
 */

const CeilingEntrySchema = z
	.object({
		ceiling: z.number().nonnegative(),
		unit: z.string().min(1),
		tolerance: z.number().nonnegative(),
		reason: z.string().min(1).optional(),
		raisedAt: z.string().min(1).optional(),
	})
	.strict();

const CeilingsSchema = z.record(z.string().min(1), CeilingEntrySchema);

export type Ceilings = z.infer<typeof CeilingsSchema>;

const ResultEntrySchema = z
	.object({
		value: z.number(),
		unit: z.string().min(1).optional(),
	})
	.strict();

const ResultsSchema = z.record(z.string().min(1), ResultEntrySchema);

export type Results = z.infer<typeof ResultsSchema>;

const HERE = dirname(fileURLToPath(import.meta.url));
export const CEILINGS_PATH = join(HERE, "ceilings.json");
export const DEFAULT_RESULTS_PATH = join(HERE, "..", "..", "node_modules", ".cache", "ccb-perf", "results.json");

export function loadCeilings(json: string = readFileSync(CEILINGS_PATH, "utf8")): Ceilings {
	const ceilings = CeilingsSchema.parse(JSON.parse(json));
	const keys = Object.keys(ceilings);
	if (keys.some((key, index) => index > 0 && keys[index - 1]! > key)) {
		throw new Error("tests/perf/ceilings.json keys must be sorted");
	}
	return ceilings;
}

export function readResults(resultsPath: string): Results {
	let json: string;
	try {
		json = readFileSync(resultsPath, "utf8");
	} catch {
		return {};
	}
	return ResultsSchema.parse(JSON.parse(json));
}

const LOCK_STALE_MS = 30_000;
const LOCK_RETRY_MS = 5;
const sleepCell = new Int32Array(new SharedArrayBuffer(4));

function isErrorCode(error: unknown, code: string): boolean {
	return error instanceof Error && "code" in error && error.code === code;
}

/**
 * Parallel vitest workers all record into one results file, so the read-merge-write runs under a cross-process lock
 * (an exclusive `mkdir`), and the write goes through a temp file and rename so no reader ever sees a partial file.
 */
function withResultsLock(resultsPath: string, action: () => void): void {
	const lockPath = `${resultsPath}.lock`;
	for (;;) {
		try {
			mkdirSync(lockPath);
			break;
		} catch (error) {
			if (!isErrorCode(error, "EEXIST")) {
				throw error;
			}
		}
		try {
			if (Date.now() - statSync(lockPath).mtimeMs > LOCK_STALE_MS) {
				rmSync(lockPath, {recursive: true, force: true});
				continue;
			}
		} catch (error) {
			if (!isErrorCode(error, "ENOENT")) {
				throw error;
			}
			continue;
		}
		Atomics.wait(sleepCell, 0, 0, LOCK_RETRY_MS);
	}
	try {
		action();
	} finally {
		rmSync(lockPath, {recursive: true, force: true});
	}
}

function recordResult(resultsPath: string, id: string, value: number, unit: string | undefined): void {
	mkdirSync(dirname(resultsPath), {recursive: true});
	withResultsLock(resultsPath, () => {
		const results = readResults(resultsPath);
		results[id] = unit === undefined ? {value} : {value, unit};
		const sorted = Object.fromEntries(Object.entries(results).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
		const tempPath = `${resultsPath}.${process.pid}.${threadId}.tmp`;
		writeFileSync(tempPath, `${JSON.stringify(sorted, null, "\t")}\n`);
		renameSync(tempPath, resultsPath);
	});
}

export function createRatchet(options: {ceilings: Ceilings; resultsPath: string}): (id: string, value: number) => void {
	const {ceilings, resultsPath} = options;
	return (id, value) => {
		const entry = ceilings[id];
		recordResult(resultsPath, id, value, entry?.unit);
		if (entry === undefined) {
			throw new Error(`${id} has no ceiling; add it to tests/perf/ceilings.json`);
		}
		const {ceiling, tolerance} = entry;
		if (value > ceiling * (1 + tolerance)) {
			throw new Error(
				`${id} rose from ${ceiling} to ${value}; fix the regression or raise the ceiling with a reason`,
			);
		}
		if (value < ceiling * (1 - tolerance)) {
			throw new Error(
				`${id} improved from ${ceiling} to ${value}; lower the ceiling in tests/perf/ceilings.json in this same commit`,
			);
		}
	};
}

let defaultRatchet: ((id: string, value: number) => void) | undefined;

export function ratchet(id: string, value: number): void {
	defaultRatchet ??= createRatchet({ceilings: loadCeilings(), resultsPath: DEFAULT_RESULTS_PATH});
	defaultRatchet(id, value);
}
