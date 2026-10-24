import {defineConfig} from "vite-plus";
import {partitionTestFiles} from "./scripts/vitest-isolation";

const testFiles = partitionTestFiles(import.meta.dirname, "tests");

export default defineConfig({
	resolve: {
		tsconfigPaths: true,
	},
	test: {
		globals: true,
		testTimeout: 15000,
		setupFiles: ["tests/setup.ts"],
		// Day and hour bucketing follows the local zone, so pin it to keep counts and bytes equal on every machine.
		env: {TZ: "UTC"},
		// Persist transforms in node_modules/.vitest-cache so a rerun skips them; vite.config.ts keeps it out of test:run's inputs.
		fsModuleCache: true,
		// A passing run prints its summary and nothing else; failures still print in full.
		reporters: process.env["GITHUB_ACTIONS"] === "true" ? ["minimal", "github-actions"] : ["minimal"],
		silent: "passed-only",
		projects: [
			// Plain node tests share each worker's module graph, so common modules load once per worker instead of once per file.
			{
				extends: true,
				test: {name: "shared", include: [...testFiles.shared, "scripts/*.test.mjs"], isolate: false},
			},
			// jsdom files that mock nothing share a worker's DOM and module graph too: jsdom and React load once per worker, not once per file.
			{
				extends: true,
				test: {name: "shared-dom", include: testFiles.sharedDom, environment: "jsdom", isolate: false},
			},
			{extends: true, test: {name: "isolated", include: testFiles.isolated, isolate: true}},
		],
	},
});
