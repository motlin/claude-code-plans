import {mkdirSync, readFileSync, writeFileSync} from "node:fs";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";
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

type Results = z.infer<typeof ResultsSchema>;

const HERE = dirname(fileURLToPath(import.meta.url));
const CEILINGS_PATH = join(HERE, "ceilings.json");
const DEFAULT_RESULTS_PATH = join(HERE, "..", "..", "node_modules", ".cache", "ccb-perf", "results.json");

export function loadCeilings(json: string = readFileSync(CEILINGS_PATH, "utf8")): Ceilings {
	const ceilings = CeilingsSchema.parse(JSON.parse(json));
	const keys = Object.keys(ceilings);
	if (keys.some((key, index) => index > 0 && keys[index - 1]! > key)) {
		throw new Error("tests/perf/ceilings.json keys must be sorted");
	}
	return ceilings;
}

function readResults(resultsPath: string): Results {
	let json: string;
	try {
		json = readFileSync(resultsPath, "utf8");
	} catch {
		return {};
	}
	return ResultsSchema.parse(JSON.parse(json));
}

function recordResult(resultsPath: string, id: string, value: number, unit: string | undefined): void {
	const results = readResults(resultsPath);
	results[id] = unit === undefined ? {value} : {value, unit};
	const sorted = Object.fromEntries(Object.entries(results).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
	mkdirSync(dirname(resultsPath), {recursive: true});
	writeFileSync(resultsPath, `${JSON.stringify(sorted, null, "\t")}\n`);
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
