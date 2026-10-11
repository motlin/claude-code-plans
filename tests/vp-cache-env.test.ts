import {execFileSync} from "node:child_process";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";
import {describe, expect, it} from "vite-plus/test";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLEAN_ENV = join(REPO_ROOT, "scripts", "clean-env.sh");

/** The variables of `environment` that survive clean-env.sh. The OS and vp's file tracer add their own (DYLD_INSERT_LIBRARIES, __CF_USER_TEXT_ENCODING), so only the given names are compared. */
function survivorsOf(environment: Record<string, string>): Record<string, string> {
	const output = execFileSync(CLEAN_ENV, ["env", "-0"], {encoding: "utf8", env: environment});
	const seen = new Map(
		output
			.split("\0")
			.filter((line) => line !== "")
			.map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)] as const),
	);
	return Object.fromEntries(
		Object.keys(environment).flatMap((name) => {
			const value = seen.get(name);
			return value === undefined ? [] : [[name, value]];
		}),
	);
}

function justRecipeBody(recipe: string): string {
	return execFileSync("just", ["--justfile", join(REPO_ROOT, "justfile"), "--show", recipe], {
		cwd: REPO_ROOT,
		encoding: "utf8",
	});
}

describe("vp task cache environment", () => {
	it("passes only the allowlisted variables that are set, so per-process variables never reach vp's cache key", () => {
		const path = process.env["PATH"] ?? "";
		expect(
			survivorsOf({
				HOME: "/home/test",
				PATH: path,
				PERF_LARGE: "1",
				TRACEPARENT: "00-abc-def-01",
				CLAUDE_CODE_SESSION_ID: "session",
				HERDR_PANE_ID: "pane",
				SHLVL: "3",
				GIT_DIR: "/somewhere/.git",
				CCB_BUILD_SHA: "abc1234",
			}),
		).toStrictEqual({HOME: "/home/test", PATH: path, PERF_LARGE: "1", CCB_BUILD_SHA: "abc1234"});
	});

	it("builds through the cached build:app task with the commit SHA in its environment", () => {
		expect(justRecipeBody("build")).toMatch(
			/^\s+CCB_BUILD_SHA="\$\(git rev-parse --short HEAD\)" scripts\/clean-env\.sh vp run --cache build:app$/m,
		);
	});

	it.each(["check", "_test"])("runs the cached vp task in `just %s` through the clean environment", (recipe) => {
		expect(justRecipeBody(recipe)).toMatch(/^\s+scripts\/clean-env\.sh vp run --cache /m);
	});
});
