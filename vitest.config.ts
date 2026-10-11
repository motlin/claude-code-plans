import {defineConfig} from "vite-plus";

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
	},
});
