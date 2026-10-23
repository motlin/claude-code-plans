#!/usr/bin/env node
// Run a command, tee its combined output to a log under the git common dir, and on failure end with a summary
// naming the failing just recipes, test files, tests and diagnostics. `git test run` streams the command's
// output and then prints a long BAD COMMIT trailer, so a caller that reads only its last lines saw FAILURE
// and nothing else; the summary sits right above that trailer and the log keeps the whole run.
//
// Usage: node scripts/verify-log.mjs <command> [args...]

import {spawn, spawnSync} from "node:child_process";
import {createWriteStream, mkdirSync, readdirSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {basename, join, resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {stripVTControlCharacters} from "node:util";

const FAILURE_LINES = [
	/\(\d+ tests? \| \d+ failed\)/u,
	/^\s*×/u,
	/^\s*FAIL\s/u,
	/^\s*(?:Test Files|Tests)\s.*\bfailed\b/u,
	/^error: recipe `[^`]+` failed/u,
];
const MAX_LINES = 40;
const FALLBACK_LINES = 15;
const KEPT_LOGS = 20;

/**
 * @param {string} log the combined output of a failed run
 * @returns {string[]} the lines that name what failed, or the last lines when none do
 */
export function summarizeFailure(log) {
	const lines = stripVTControlCharacters(log).split("\n");
	const named = lines.filter((line) => FAILURE_LINES.some((pattern) => pattern.test(line)));
	if (named.length === 0) {
		return lines.filter((line) => line.trim() !== "").slice(-FALLBACK_LINES);
	}
	if (named.length <= MAX_LINES) {
		return named;
	}
	return [...named.slice(0, MAX_LINES), `… ${named.length - MAX_LINES} more failure lines in the log`];
}

function logDirectory() {
	const commonDir = spawnSync("git", ["rev-parse", "--git-common-dir"], {encoding: "utf8"});
	const base = commonDir.status === 0 ? resolve(commonDir.stdout.trim()) : tmpdir();
	const directory = join(base, "verify-logs");
	mkdirSync(directory, {recursive: true});
	return directory;
}

function pruneLogs(directory) {
	const logs = readdirSync(directory)
		.filter((name) => name.endsWith(".log"))
		.toSorted();
	for (const name of logs.slice(0, -KEPT_LOGS)) {
		rmSync(join(directory, name), {force: true});
	}
}

function main(argv) {
	const [command, ...args] = argv;
	if (command === undefined) {
		process.stderr.write("Usage: node scripts/verify-log.mjs <command> [args...]\n");
		return Promise.resolve(2);
	}
	const head = spawnSync("git", ["rev-parse", "--short", "HEAD"], {encoding: "utf8"}).stdout?.trim() || "nohead";
	const stamp = new Date().toISOString().replaceAll(/[:.]/gu, "-");
	const directory = logDirectory();
	const logPath = join(directory, `${stamp}-${basename(process.cwd())}-${head}.log`);
	const log = createWriteStream(logPath);
	/** @type {string[]} */
	const chunks = [];

	const child = spawn(command, args, {stdio: ["inherit", "pipe", "pipe"]});
	const forward = (/** @type {Buffer} */ chunk) => {
		process.stdout.write(chunk);
		log.write(chunk);
		chunks.push(chunk.toString("utf8"));
	};
	child.stdout.on("data", forward);
	child.stderr.on("data", forward);
	for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
		process.on(signal, () => child.kill(signal));
	}

	return new Promise((resolvePromise) => {
		child.on("error", (error) => {
			forward(Buffer.from(`verify-log: could not run ${command}: ${error.message}\n`));
		});
		child.on("close", (code, signal) => {
			const exitCode = code === null ? 128 : code < 0 ? 127 : code;
			if (exitCode !== 0) {
				const summary = summarizeFailure(chunks.join(""));
				const reason = signal === null ? `exit code ${exitCode}` : `signal ${signal}`;
				const text = [
					"",
					`verify failed (${reason}); what failed:`,
					...summary.map((line) => `  ${line}`),
					`Full log: ${logPath}`,
					"",
				].join("\n");
				process.stdout.write(text);
				log.write(text);
			}
			log.end(() => {
				pruneLogs(directory);
				resolvePromise(exitCode);
			});
		});
	});
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
	process.exitCode = await main(process.argv.slice(2));
}
