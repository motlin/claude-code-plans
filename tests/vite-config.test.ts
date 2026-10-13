import {readFileSync} from "node:fs";
import {join} from "node:path";
import {afterAll, describe, expect, it} from "vite-plus/test";
import {z} from "zod";
import {AGENTATION_ENDPOINT, AGENTATION_SERVER} from "../src/lib/agentation-endpoint";

// The only test file that loads vite.config.ts: importing it builds every plugin and renames the process,
// so one isolated file pays that once instead of each plugin's own test file.

const REPO_ROOT = join(import.meta.dirname, "..");
const originalTitle = process.title;
const originalBuildSha = process.env["CCB_BUILD_SHA"];
process.title = "node";
process.env["CCB_BUILD_SHA"] = "abc1234";
const {default: viteConfig} = await import("../vite.config");
const {default: vitestConfig} = await import("../vitest.config");
const loadedTitle = process.title;

afterAll(() => {
	process.title = originalTitle;
	if (originalBuildSha === undefined) delete process.env["CCB_BUILD_SHA"];
	else process.env["CCB_BUILD_SHA"] = originalBuildSha;
});

function pluginNames(option: unknown): string[] {
	if (Array.isArray(option)) {
		return option.flatMap((entry: unknown) => pluginNames(entry));
	}
	return option !== null && typeof option === "object" && "name" in option && typeof option.name === "string"
		? [option.name]
		: [];
}

describe("vite config", () => {
	it("names the Vite dev process so it is identifiable in ps", () => {
		expect(loadedTitle).toBe("claude-code-browser");
	});

	it("ignores non-source scratch directories in the Vite dev watcher", () => {
		expect(viteConfig.server?.watch?.ignored).toStrictEqual([
			"**/routeTree.gen.ts",
			"**/.llm/**",
			"**/.playwright-mcp/**",
		]);
	});

	it("proxies the Agentation endpoint to the local Agentation server", () => {
		const proxy = viteConfig.server?.proxy?.[AGENTATION_ENDPOINT];
		if (proxy === undefined || typeof proxy === "string") {
			throw new Error("expected an object proxy entry for the Agentation endpoint");
		}

		expect({
			target: proxy.target,
			changeOrigin: proxy.changeOrigin,
			rewritten: proxy.rewrite?.("/__agentation/sessions/abc/events"),
		}).toStrictEqual({
			target: AGENTATION_SERVER,
			changeOrigin: true,
			rewritten: "/sessions/abc/events",
		});
	});

	it("registers the dev env plugins, with the worker proxy last, after nitro", () => {
		const names = pluginNames(viteConfig.plugins);

		expect({
			closesRunner: names.includes("ccp:close-nitro-env-runner"),
			holdsRequests: names.includes("ccp:hold-nitro-requests-until-ready"),
			serializesRestarts: names.includes("ccp:serialize-dev-server-restarts"),
			last: names.slice(-2),
			errorsAfterNitro:
				names.indexOf("ccp:dev-request-errors") > names.findIndex((name) => name.startsWith("nitro")),
		}).toStrictEqual({
			closesRunner: true,
			holdsRequests: true,
			serializesRestarts: true,
			last: ["ccp:dev-worker-connection-close", "ccp:dev-request-errors"],
			errorsAfterNitro: true,
		});
	});
});

describe("typecheck task cache", () => {
	it("never caches tsc, whose native file reads vp's input tracking cannot see", () => {
		expect(viteConfig.run?.tasks?.["typecheck"]).toStrictEqual({command: "tsc --noEmit", cache: false});
	});

	it("leaves type-checking to `vp check` instead of repeating it in the build", () => {
		const {scripts} = z
			.object({scripts: z.record(z.string(), z.string())})
			.parse(JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")));

		expect({
			typeCheckedByVpCheck: viteConfig.lint?.options?.typeCheck,
			build: scripts["build"],
			scriptsCallingTsc: Object.keys(scripts).filter((name) => /\btsc\b/.test(scripts[name] ?? "")),
		}).toStrictEqual({typeCheckedByVpCheck: true, build: "vp build", scriptsCallingTsc: []});
	});
});

describe("test task cache", () => {
	it("persists vitest's transforms across runs and keeps that cache out of the test:run task's inputs", () => {
		expect({
			fsModuleCache: vitestConfig.test?.fsModuleCache,
			fsModuleCachePath: vitestConfig.test?.fsModuleCachePath,
			testRun: viteConfig.run?.tasks?.["test:run"],
		}).toStrictEqual({
			fsModuleCache: true,
			fsModuleCachePath: undefined,
			testRun: {
				command: "vp test run",
				cache: {
					env: ["PERF_LARGE", "FULL_JSONL_SCAN", "XDG_CACHE_HOME", "XDG_CONFIG_HOME"],
					untrackedEnv: ["TMPDIR", "CCB_PERF_LOG"],
					input: [
						{auto: true},
						"!node_modules/.vitest-cache/**",
						"!.fallow/**",
						"!node_modules/.cache/ccb-perf/**",
					],
					output: [],
				},
			},
		});
	});
});

describe("build task cache", () => {
	it("caches the app build with its outputs, keyed on the commit SHA the build stamps in", () => {
		expect({
			define: viteConfig.define,
			buildApp: viteConfig.run?.tasks?.["build:app"],
		}).toStrictEqual({
			define: {__CCB_BUILD_SHA__: JSON.stringify("abc1234")},
			buildApp: {
				command: "vp build --logLevel warn",
				cache: {
					env: ["CCB_BUILD_SHA"],
					input: [{auto: true}, "!.fallow/**", "!node_modules/.cache/ccb-perf/**"],
					output: [".output/**", "src/routeTree.gen.ts"],
				},
			},
		});
	});
});

describe("quiet output", () => {
	it("reports only failures from vitest and keeps the build's size table and dependency warnings out of verify", () => {
		expect({
			reporters: vitestConfig.test?.reporters,
			silent: vitestConfig.test?.silent,
			projects: vitestConfig.test?.projects?.map((project): unknown =>
				typeof project === "object" && "test" in project ? [project.test.name, project.test.isolate] : project,
			),
			reportCompressedSize: viteConfig.build?.reportCompressedSize,
			filtersBundlerLogs: typeof viteConfig.build?.rolldownOptions?.onLog,
		}).toStrictEqual({
			reporters: process.env["GITHUB_ACTIONS"] === "true" ? ["minimal", "github-actions"] : ["minimal"],
			silent: "passed-only",
			projects: [
				["shared", false],
				["isolated", true],
			],
			reportCompressedSize: false,
			filtersBundlerLogs: "function",
		});
	});
});
