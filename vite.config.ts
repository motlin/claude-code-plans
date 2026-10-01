import {execFileSync} from "node:child_process";
import {defineConfig} from "vite-plus";
import {tanstackStart} from "@tanstack/react-start/plugin/vite";
import {nitro} from "nitro/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import {AGENTATION_ENDPOINT, AGENTATION_SERVER} from "./src/lib/agentation-endpoint";
import {closeNitroRunnerOnServerClose} from "./src/lib/dev-env-runner-teardown";
import {devWorkerProxy} from "./src/lib/dev-worker-proxy";

// Names the dev process in ps; production uses SERVER_PROCESS_TITLE instead.
process.title = "claude-code-browser";

// Field perf samples (src/lib/perf/journey.ts) are grouped by the commit they were built from.
function buildSha(): string {
	try {
		return execFileSync("git", ["rev-parse", "--short", "HEAD"], {encoding: "utf8"}).trim();
	} catch {
		return "unknown";
	}
}

export default defineConfig({
	define: {
		__CCB_BUILD_SHA__: JSON.stringify(buildSha()),
	},
	fmt: {
		semi: true,
		singleQuote: false,
		useTabs: true,
		tabWidth: 4,
		printWidth: 120,
		proseWrap: "never",
		embeddedLanguageFormatting: "off",
		bracketSpacing: false,
		trailingComma: "all",
		arrowParens: "always",
		overrides: [
			{
				files: [".yamllint.yaml", "**/*.yaml", "**/*.yml"],
				options: {
					useTabs: false,
					tabWidth: 2,
				},
			},
			{
				files: ["**/*.md"],
				options: {
					printWidth: 320,
				},
			},
		],
	},
	run: {
		tasks: {
			check: {
				command: "vp check",
			},
			"test:run": {
				command: "node node_modules/vitest/dist/cli.js run",
				input: [{auto: true}, "!node_modules/.experimental-vitest-cache/**"],
				output: [],
			},
		},
	},
	lint: {
		plugins: ["oxc", "typescript", "unicorn", "react"],
		categories: {
			correctness: "warn",
		},
		env: {
			builtin: true,
		},
		ignorePatterns: ["dist", "coverage", ".llm/**", ".output/**", ".remember/**", "src/routeTree.gen.ts"],
		overrides: [
			{
				files: ["vitest.config.ts"],
				globals: {
					process: "readonly",
				},
			},
			{
				files: ["**/*.test.{ts,tsx}", "**/*.spec.{ts,tsx}"],
				globals: {
					vi: "readonly",
					expect: "readonly",
					it: "readonly",
					describe: "readonly",
					beforeEach: "readonly",
					afterEach: "readonly",
					beforeAll: "readonly",
					afterAll: "readonly",
				},
				env: {
					node: true,
				},
			},
			{
				files: ["**/*.{ts,tsx}"],
				rules: {
					"no-array-constructor": "error",
					"no-unused-expressions": "error",
					"no-unused-vars": [
						"error",
						{
							varsIgnorePattern: "^([A-Z_]|_)",
							argsIgnorePattern: "^_",
							caughtErrorsIgnorePattern: "^_",
						},
					],
					eqeqeq: ["error", "smart"],
					"typescript/ban-ts-comment": "error",
					"typescript/no-duplicate-enum-values": "error",
					"typescript/no-empty-object-type": "error",
					"typescript/no-explicit-any": "off",
					"typescript/no-extra-non-null-assertion": "error",
					"typescript/no-misused-new": "error",
					"typescript/no-namespace": "error",
					"typescript/no-non-null-asserted-optional-chain": "error",
					"typescript/no-require-imports": "error",
					"typescript/no-this-alias": "error",
					"typescript/no-unnecessary-type-constraint": "error",
					"typescript/no-unsafe-declaration-merging": "error",
					"typescript/no-unsafe-function-type": "error",
					"typescript/no-wrapper-object-types": "error",
					"typescript/prefer-as-const": "error",
					"typescript/prefer-namespace-keyword": "error",
					"typescript/triple-slash-reference": "error",
				},
				env: {
					es2022: true,
					node: true,
				},
			},
		],
		options: {
			typeAware: true,
			typeCheck: true,
		},
		jsPlugins: [
			{
				name: "vite-plus",
				specifier: "vite-plus/oxlint-plugin",
			},
		],
		rules: {
			"vite-plus/prefer-vite-plus-imports": "error",
		},
	},
	server: {
		// 7526 = "PLAN" on a phone dialpad. Fixed + strictPort so a clash fails loudly
		// instead of silently falling back to a different port.
		port: Number(process.env["PORT"] ?? 7526),
		strictPort: true,
		host: "127.0.0.1",
		allowedHosts: ["plans.m4.notlin.com", ...(process.env["VITE_ALLOWED_HOSTS"]?.split(",").filter(Boolean) ?? [])],
		// Scratch dirs (.llm fixtures, Playwright dumps) must never trigger a page reload.
		watch: {ignored: ["**/routeTree.gen.ts", "**/.llm/**", "**/.playwright-mcp/**"]},
		proxy: {
			[AGENTATION_ENDPOINT]: {
				target: AGENTATION_SERVER,
				changeOrigin: true,
				rewrite: (path) => path.slice(AGENTATION_ENDPOINT.length),
			},
		},
	},
	resolve: {
		tsconfigPaths: true,
	},
	environments: {
		client: {
			build: {
				manifest: true,
			},
		},
	},
	plugins: [
		nitro({
			features: {websocket: true},
			serverDir: "./server",
			// node-pty loads its native addon and spawn-helper from prebuilds/ at runtime.
			traceDeps: ["node-pty*"],
		}),
		tailwindcss(),
		tanstackStart(),
		viteReact(),
		closeNitroRunnerOnServerClose(),
		// After nitro(): its error handler must follow nitro's catch-all dev middleware.
		...devWorkerProxy(),
	],
});
