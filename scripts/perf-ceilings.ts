import {writeFileSync} from "node:fs";
import {resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {
	CEILINGS_PATH,
	DEFAULT_RESULTS_PATH,
	loadCeilings,
	readResults,
	type Ceilings,
	type Results,
} from "../tests/perf/ratchet";

/**
 * `just perf-ceilings` (measurement plan §4.4): a manual convenience that locks improvements into
 * tests/perf/ceilings.json. Lowered and new ids take the measured value; raised ids are left alone and listed, because a
 * raise needs a hand-written `reason` and `raisedAt`. Never run this from CI, a bot or a schedule.
 */

interface CeilingChange {
	id: string;
	kind: "added" | "lowered" | "raised";
	from: number | undefined;
	to: number;
}

function compareKeys(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}

export function rewriteCeilings(ceilings: Ceilings, results: Results): {ceilings: Ceilings; changes: CeilingChange[]} {
	const next: Ceilings = {...ceilings};
	const changes: CeilingChange[] = [];
	for (const [id, {value, unit}] of Object.entries(results).sort(([a], [b]) => compareKeys(a, b))) {
		const entry = ceilings[id];
		if (entry === undefined) {
			next[id] = {ceiling: value, unit: unit ?? "count", tolerance: 0};
			changes.push({id, kind: "added", from: undefined, to: value});
		} else if (value < entry.ceiling) {
			next[id] = {ceiling: value, unit: entry.unit, tolerance: entry.tolerance};
			changes.push({id, kind: "lowered", from: entry.ceiling, to: value});
		} else if (value > entry.ceiling) {
			changes.push({id, kind: "raised", from: entry.ceiling, to: value});
		}
	}
	const sorted = Object.fromEntries(Object.entries(next).sort(([a], [b]) => compareKeys(a, b)));
	return {ceilings: sorted, changes};
}

function status(ceiling: number | undefined, value: number): string {
	if (ceiling === undefined) {
		return "new";
	}
	return value < ceiling ? "lowered" : value > ceiling ? "raised" : "ok";
}

export function formatResultsTable(ceilings: Ceilings, results: Results): string {
	const entries = Object.entries(results).sort(([a], [b]) => compareKeys(a, b));
	if (entries.length === 0) {
		return "No perf results recorded.";
	}
	const rows = entries.map(([id, {value, unit}]) => {
		const entry = ceilings[id];
		return [
			id,
			String(value),
			entry === undefined ? "-" : String(entry.ceiling),
			unit ?? entry?.unit ?? "",
			status(entry?.ceiling, value),
		];
	});
	const table = [["id", "value", "ceiling", "unit", "status"], ...rows];
	const rightAligned = new Set([1, 2]);
	const widths = table[0]!.map((_, column) => Math.max(...table.map((row) => row[column]!.length)));
	return table
		.map((row) =>
			row
				.map((cell, column) =>
					column === row.length - 1
						? cell
						: rightAligned.has(column)
							? cell.padStart(widths[column]!)
							: cell.padEnd(widths[column]!),
				)
				.join("  "),
		)
		.join("\n");
}

function formatChange({id, kind, from, to}: CeilingChange): string {
	switch (kind) {
		case "added":
			return `+ ${id}: ${to}`;
		case "lowered":
			return `- ${id}: ${from} -> ${to}`;
		case "raised":
			return `! ${id}: ${from} -> ${to} (left alone; raise it by hand with a reason and raisedAt)`;
	}
}

function main(): void {
	const ceilings = loadCeilings();
	const results = readResults(DEFAULT_RESULTS_PATH);
	if (process.argv.includes("--table")) {
		console.log(formatResultsTable(ceilings, results));
		return;
	}
	const {ceilings: next, changes} = rewriteCeilings(ceilings, results);
	const written = changes.filter((change) => change.kind !== "raised");
	if (written.length > 0) {
		writeFileSync(CEILINGS_PATH, `${JSON.stringify(next, null, "\t")}\n`);
	}
	if (changes.length === 0) {
		console.log("tests/perf/ceilings.json already matches results.json.");
		return;
	}
	console.log(changes.map(formatChange).join("\n"));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main();
}
