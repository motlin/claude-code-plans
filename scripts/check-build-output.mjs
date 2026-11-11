#!/usr/bin/env node
// Run the build, stream its output, and fail it when it printed anything but its own progress lines. `vp build
// --logLevel warn` prints only warnings plus Nitro's progress, so an allowlist of the progress lines catches every
// new warning, whatever plugin or wording it comes with, instead of letting it scroll past a passing gate.
//
// Usage: node scripts/check-build-output.mjs <command> [args...]

import {spawn} from "node:child_process";
import {pathToFileURL} from "node:url";
import {stripVTControlCharacters} from "node:util";

const EXPECTED_LINES = [
	/^\s*$/u,
	// vp's reminder that `vp build` is its built-in command, not the package script.
	/^note: You are running `vp build` as a Vite\+ built-in command\./u,
	// Nitro's build progress and its dependency trace. consola prints start/success/info as ◐/✔/ℹ, or as
	// [start]/[success]/[info] tags with its basic reporter, which it picks under CI; [warn] stays unexpected.
	/^\[nitro\] [◐✔] /u,
	/^[ℹ✔] /u,
	/^\[(?:start|success)\] \[nitro\] /u,
	/^\[(?:info|success)\] /u,
	/^- \S+ \([^)]+\)$/u,
];

/**
 * @param {string} log the build's combined output
 * @returns {string[]} the lines that are not the build's own progress, with colors stripped
 */
export function unexpectedBuildLines(log)
{
	return stripVTControlCharacters(log)
		.split("\n")
		.filter((line) => !EXPECTED_LINES.some((pattern) => pattern.test(line)));
}

function main(argv)
{
	const [command, ...args] = argv;
	if (command === undefined)
	{
		process.stderr.write("Usage: node scripts/check-build-output.mjs <command> [args...]\n");
		return Promise.resolve(2);
	}
	/** @type {string[]} */
	const chunks = [];
	const child = spawn(
		command,
		args,
		{
			stdio: ["inherit", "pipe", "pipe"],
		},
	);
	child.stdout.on("data", (/** @type {Buffer} */ chunk) =>
	{
		process.stdout.write(chunk);
		chunks.push(chunk.toString("utf8"));
	});
	child.stderr.on("data", (/** @type {Buffer} */ chunk) =>
	{
		process.stderr.write(chunk);
		chunks.push(chunk.toString("utf8"));
	});
	for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"])
	{
		process.on(signal, () => child.kill(signal));
	}
	return new Promise((resolvePromise) =>
	{
		child.on("error", (error) =>
		{
			process.stderr.write(`check-build-output: could not run ${command}: ${error.message}\n`);
			resolvePromise(127);
		});
		child.on("close", (code) =>
		{
			const exitCode = code ?? 128;
			if (exitCode !== 0)
			{
				resolvePromise(exitCode);
				return;
			}
			const unexpected = unexpectedBuildLines(chunks.join(""));
			if (unexpected.length > 0)
			{
				process.stderr.write(
					[
						"",
						"The build printed warnings; fix each at its cause (scripts/check-build-output.mjs):",
						...unexpected.map((line) => `  ${line}`),
						"",
					].join("\n"),
				);
				resolvePromise(1);
				return;
			}
			resolvePromise(0);
		});
	});
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href)
{
	process.exitCode = await main(process.argv.slice(2));
}
