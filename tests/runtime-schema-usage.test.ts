import {readdirSync, readFileSync} from "node:fs";
import {join, relative} from "node:path";
import {describe, expect, it} from "vite-plus/test";
import * as runtimeSchemas from "../src/lib/runtime-schemas";

const SRC = join(import.meta.dirname, "..", "src");

/** Strict parses kept on purpose: each reports drift, then falls back to the lenient twin. */
const DRIFT_REPORTERS = ["lib/session-registry.ts: StrictSessionRegistryFileSchema"];

function sourceFiles(directory: string): string[] {
	return readdirSync(directory, {withFileTypes: true}).flatMap((entry) => {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) return sourceFiles(path);
		return /\.tsx?$/.test(entry.name) ? [path] : [];
	});
}

/** Names a file imports as values (not `import type`) from the strict `schemas` module. */
function strictValueImports(source: string): string[] {
	const names: string[] = [];
	for (const match of source.matchAll(/import\s+(type\s+)?\{([^}]*)\}\s+from\s+"(?:\.\.?\/)+(?:lib\/)?schemas"/g)) {
		if (match[1]) continue;
		for (const specifier of (match[2] ?? "").split(",")) {
			const trimmed = specifier.trim();
			if (trimmed === "" || trimmed.startsWith("type ")) continue;
			names.push(trimmed.split(/\s+as\s+/).at(-1) ?? trimmed);
		}
	}
	return names;
}

describe("runtime parsing uses the lenient schemas", () => {
	it("no source file parses with a strict schema from schemas.ts", () => {
		const offenders: string[] = [];
		for (const file of sourceFiles(SRC)) {
			const source = readFileSync(file, "utf8");
			for (const name of strictValueImports(source)) {
				if (new RegExp(`\\b${name}\\.(?:safeParse|parse)(?:Async)?\\(`).test(source)) {
					offenders.push(`${relative(SRC, file)}: ${name}`);
				}
			}
		}
		expect(offenders).toEqual(DRIFT_REPORTERS);
	});

	it("every runtime twin has a strict original of the same name", async () => {
		const strict: Record<string, unknown> = await import("../src/lib/schemas");
		const missing = Object.keys(runtimeSchemas).filter((name) => strict[name] === undefined);
		expect(missing).toEqual([]);
	});
});
