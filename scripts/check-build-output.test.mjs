import {describe, expect, test} from "vite-plus/test";

import {unexpectedBuildLines} from "./check-build-output.mjs";

describe("unexpectedBuildLines", () =>
{
	test("passes a clean build's own progress lines", () =>
	{
		const log = [
			"note: You are running `vp build` as a Vite+ built-in command. If you meant to run the build npm script, use `vpr build` instead.",
			"\u001b[36m[nitro]\u001b[39m ◐ Building [Nitro] (preset: node-server, compatibility: 2026-11-05)",
			"[nitro] ✔ Generated public .output/public",
			"ℹ Tracing dependencies:",
			"- node-pty (1.2.0-beta.18)",
			"- better-sqlite3 (13.0.3)",
			"✔ Traced 3 dependencies (38 files) in 99ms.",
			"ℹ Ensure your production environment matches the builder OS and architecture (darwin-arm64) to avoid native module issues.",
			"ℹ Generated .output/nitro.json",
			"",
			"[nitro] ✔ You can preview this build using npx vite preview",
			"",
		].join("\n");
		expect(unexpectedBuildLines(log)).toStrictEqual([]);
	});

	test("names every warning line, whatever its wording", () =>
	{
		const log = [
			"[nitro] ✔ Generated public .output/public",
			"Found 7 warnings while optimizing generated CSS:",
			"\u001b[33m[INEFFECTIVE_DYNAMIC_IMPORT] \u001b[0msrc/lib/hook-config.ts is dynamically imported by src/routes/api/hooks.status.ts",
			"(!) Some chunks are larger than 500 kB after minification. Consider:",
			"`output.codeSplitting.groups[0].name` is a function. Set `output.codeSplitting.groups[0].debugName` so the bundler timing report can identify this group.",
			'[plugin unwasm] Failed to load the WebAssembly module; falling back to module mode: Cannot resolve module "env"',
			"ℹ Generated .output/nitro.json",
		].join("\n");
		expect(unexpectedBuildLines(log)).toStrictEqual([
			"Found 7 warnings while optimizing generated CSS:",
			"[INEFFECTIVE_DYNAMIC_IMPORT] src/lib/hook-config.ts is dynamically imported by src/routes/api/hooks.status.ts",
			"(!) Some chunks are larger than 500 kB after minification. Consider:",
			"`output.codeSplitting.groups[0].name` is a function. Set `output.codeSplitting.groups[0].debugName` so the bundler timing report can identify this group.",
			'[plugin unwasm] Failed to load the WebAssembly module; falling back to module mode: Cannot resolve module "env"',
		]);
	});
});
