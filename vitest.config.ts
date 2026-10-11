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
		projects: [
			// Plain node tests share each worker's module graph, so common modules load once per worker instead of once per file.
			{extends: true, test: {name: "shared", include: testFiles.shared, isolate: false}},
			{extends: true, test: {name: "isolated", include: testFiles.isolated}},
		],
	},
});
