import {readFileSync, readdirSync} from "node:fs";
import {join} from "node:path";
import {setTimeout as delay} from "node:timers/promises";
import type {z} from "zod";
import {parseIgnoringStaleTail} from "../src/lib/parse-leading-json";

export interface RegistryScanIo {
	readdir: () => string[];
	readFile: (name: string) => string;
	sleep: () => Promise<void>;
}

export function diskRegistryIo(dir: string): RegistryScanIo {
	return {
		readdir: () => readdirSync(dir),
		readFile: (name) => readFileSync(join(dir, name), "utf-8"),
		sleep: async () => {
			await delay(100);
		},
	};
}

type Attempt = {kind: "gone"} | {kind: "ok"} | {kind: "bad"; reason: string};

function attempt(io: RegistryScanIo, name: string, schema: z.ZodType): Attempt {
	let text: string;
	try {
		text = io.readFile(name);
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") {
			return {kind: "gone"};
		}
		throw error;
	}
	let parsed: unknown;
	try {
		parsed = parseIgnoringStaleTail(text);
	} catch (error) {
		return {kind: "bad", reason: `invalid JSON (${error instanceof Error ? error.message : String(error)})`};
	}
	const result = schema.safeParse(parsed);
	if (result.success) {
		return {kind: "ok"};
	}
	return {
		kind: "bad",
		reason: result.error.issues.map((issue) => `${issue.path.join(".")} ${issue.message}`).join(", "),
	};
}

/**
 * Validate every `<pid>.json` registry file. Live CLIs create, rewrite and delete these files
 * constantly, so a file that vanishes is skipped, and a torn or mid-write read is retried once
 * after a short delay; only a failure that survives the retry is reported as drift.
 */
export async function scanRegistryDir(io: RegistryScanIo, schema: z.ZodType): Promise<string[]> {
	const failures: string[] = [];
	// Only <pid>.json: the directory also holds <pid>.<hash>.key secrets that must never be read.
	for (const name of io.readdir().filter((file) => /^\d+\.json$/.test(file))) {
		let outcome = attempt(io, name, schema);
		if (outcome.kind === "bad") {
			await io.sleep();
			outcome = attempt(io, name, schema);
		}
		if (outcome.kind === "bad") {
			failures.push(`${name}: ${outcome.reason}`);
		}
	}
	return failures;
}
