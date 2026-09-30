import {AsyncLocalStorage} from "node:async_hooks";
import type Database from "better-sqlite3";

export interface PerfCounters {
	sql: {count: number; ms: number};
	jsonl: {bytesRead: number; fullScans: number};
	proc: {spawned: number};
}

interface PerfScope {
	name: string;
	counters: PerfCounters;
}

const storage = new AsyncLocalStorage<PerfScope>();

function emptyCounters(): PerfCounters {
	return {
		sql: {count: 0, ms: 0},
		jsonl: {bytesRead: 0, fullScans: 0},
		proc: {spawned: 0},
	};
}

export function withPerfScope<T>(name: string, fn: () => T): T {
	return storage.run({name, counters: emptyCounters()}, fn);
}

export function currentPerfCounters(): PerfCounters | undefined {
	return storage.getStore()?.counters;
}

const STATEMENT_METHODS = ["run", "get", "all", "iterate"] as const;

function instrumentStatement(statement: Database.Statement): void {
	for (const method of STATEMENT_METHODS) {
		const original = statement[method] as (...args: unknown[]) => unknown;
		Object.defineProperty(statement, method, {
			configurable: true,
			writable: true,
			value(this: Database.Statement, ...args: unknown[]): unknown {
				const counters = storage.getStore()?.counters;
				if (counters === undefined) return original.apply(this, args);
				const start = performance.now();
				try {
					return original.apply(this, args);
				} finally {
					counters.sql.count += 1;
					counters.sql.ms += performance.now() - start;
				}
			},
		});
	}
}

/** Makes every statement prepared on `sqlite` report into the active perf scope. */
export function instrumentDatabase(sqlite: Database.Database): void {
	const prepare = sqlite.prepare.bind(sqlite);
	Object.defineProperty(sqlite, "prepare", {
		configurable: true,
		writable: true,
		value(source: string): Database.Statement {
			const statement = prepare(source);
			instrumentStatement(statement);
			return statement;
		},
	});
}
