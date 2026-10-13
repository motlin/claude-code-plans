import {execFileSync} from "node:child_process";
import {defineConfig, rolldownVersion, version as viteVersion} from "vite-plus";
import {tanstackStart} from "@tanstack/react-start/plugin/vite";
import {nitro} from "nitro/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import {AGENTATION_ENDPOINT, AGENTATION_SERVER} from "./src/lib/agentation-endpoint";
import {quietDependencyDirectives} from "./src/lib/build-log-filter";
import {clientChunkGraph} from "./src/lib/client-chunk-graph";
import {closeNitroRunnerOnServerClose} from "./src/lib/dev-env-runner-teardown";
import {holdNitroRequestsUntilReady} from "./src/lib/dev-env-ready-gate";
import {devWorkerProxy} from "./src/lib/dev-worker-proxy";
import {lockfileToolchainGuard} from "./src/lib/lockfile-toolchain-guard";

// Names the dev process in ps; production uses SERVER_PROCESS_TITLE instead.
process.title = "claude-code-browser";

// Field perf samples (src/lib/perf/journey.ts) are grouped by the commit they were built from. `just build` passes
// it in as CCB_BUILD_SHA, the cached build:app task's env key, so a new commit rebuilds even when no source changed.
function buildSha(): string {
	const fromEnvironment = process.env["CCB_BUILD_SHA"];
	if (fromEnvironment) return fromEnvironment;
	try {
		return execFileSync("git", ["rev-parse", "--short", "HEAD"], {encoding: "utf8"}).trim();
	} catch {
		return "unknown";
	}
}

// Files the build or test run reads that another step rewrites on every verify: Fallow's caches and the perf results
// the test run merges into. Tracking them would make every verify rerun miss.
const UNTRACKED_TASK_INPUTS = ["!.fallow/**", "!node_modules/.cache/ccb-perf/**"];

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
			// Add dependsOn here for code generation that type-aware lint needs.
			check: {
				command: "vp check",
			},
			// tsc 7 is a native Go binary whose file reads vp's auto input tracking never sees, so a cached
			// run would replay an old success for a tree that no longer type-checks.
			typecheck: {
				command: "tsc --noEmit",
				cache: false,
			},
			"build:app": {
				command: "vp build --logLevel warn",
				cache: {
					env: ["CCB_BUILD_SHA"],
					input: [{auto: true}, ...UNTRACKED_TASK_INPUTS],
					output: [".output/**", "src/routeTree.gen.ts"],
				},
			},
			"test:run": {
				command: "vp test run",
				cache: {
					env: ["PERF_LARGE", "FULL_JSONL_SCAN", "XDG_CACHE_HOME", "XDG_CONFIG_HOME"],
					untrackedEnv: ["TMPDIR", "CCB_PERF_LOG"],
					input: [{auto: true}, "!node_modules/.vitest-cache/**", ...UNTRACKED_TASK_INPUTS],
					output: [],
				},
			},
		},
	},
	lint: {
		plugins: [],
		jsPlugins: [
			{
				name: "vite-plus",
				specifier: "vite-plus/oxlint-plugin",
			},
		],
		categories: {
			correctness: "off",
		},
		rules: {
			"vite-plus/prefer-vite-plus-imports": "error",
		},
		env: {
			builtin: true,
		},
		ignorePatterns: [
			"dist",
			"build",
			"coverage",
			"storybook-static",
			".llm/**",
			".output/**",
			".remember/**",
			"src/routeTree.gen.ts",
			"vitest.shims.d.ts",
		],
		overrides: [
			{
				files: ["public/**/*.{ts,tsx}"],
				globals: {
					ServiceWorkerGlobalScope: "readonly",
					ExtendableEvent: "readonly",
				},
			},
			{
				files: ["vite.config.ts", "vitest.config.ts"],
				globals: {
					process: "readonly",
				},
			},
			{
				files: ["**/*.test.{js,jsx,ts,tsx}", "**/*.spec.{js,jsx,ts,tsx}", "**/setupTests.{js,ts}"],
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
					browser: true,
					jest: true,
					node: true,
				},
			},
			{
				files: ["**/*.{js,jsx}"],
				rules: {
					"getter-return": "error",
					"no-undef": "error",
					"no-unreachable": "error",
					"constructor-super": "error",
					"for-direction": "error",
					"no-async-promise-executor": "error",
					"no-case-declarations": "error",
					"no-class-assign": "error",
					"no-compare-neg-zero": "error",
					"no-cond-assign": "error",
					"no-const-assign": "error",
					"no-constant-binary-expression": "error",
					"no-constant-condition": "error",
					"no-control-regex": "error",
					"no-debugger": "error",
					"no-delete-var": "error",
					"no-dupe-class-members": "error",
					"no-dupe-else-if": "error",
					"no-dupe-keys": "error",
					"no-duplicate-case": "error",
					"no-empty": "error",
					"no-empty-character-class": "error",
					"no-empty-pattern": "error",
					"no-empty-static-block": "error",
					"no-ex-assign": "error",
					"no-extra-boolean-cast": "error",
					"no-fallthrough": "error",
					"no-func-assign": "error",
					"no-global-assign": "error",
					"no-import-assign": "error",
					"no-invalid-regexp": "error",
					"no-irregular-whitespace": "error",
					"no-loss-of-precision": "error",
					"no-misleading-character-class": "error",
					"no-new-native-nonconstructor": "error",
					"no-nonoctal-decimal-escape": "error",
					"no-obj-calls": "error",
					"no-prototype-builtins": "error",
					"no-redeclare": "error",
					"no-regex-spaces": "error",
					"no-self-assign": "error",
					"no-setter-return": "error",
					"no-shadow-restricted-names": "error",
					"no-sparse-arrays": "error",
					"no-this-before-super": "error",
					"no-unassigned-vars": "error",
					"no-unexpected-multiline": "error",
					"no-unsafe-finally": "error",
					"no-unsafe-negation": "error",
					"no-unsafe-optional-chaining": "error",
					"no-unused-labels": "error",
					"no-unused-private-class-members": "error",
					"no-unused-vars": [
						"error",
						{
							varsIgnorePattern: "^([A-Z_]|_)",
							argsIgnorePattern: "^_",
							caughtErrorsIgnorePattern: "^_",
						},
					],
					"no-useless-backreference": "error",
					"no-useless-catch": "error",
					"no-useless-escape": "error",
					"no-with": "error",
					"preserve-caught-error": "error",
					"require-yield": "error",
					"use-isnan": "error",
					"valid-typeof": "error",
					"react-hooks/rules-of-hooks": "error",
					"react-hooks/exhaustive-deps": "error",
					eqeqeq: ["error", "smart"],
					"react/only-export-components": [
						"warn",
						{
							allowConstantExport: true,
						},
					],
				},
				env: {
					es2020: true,
					browser: true,
					jest: true,
				},
				plugins: ["react"],
			},
			{
				files: ["**/*.{ts,tsx}"],
				rules: {
					"getter-return": "error",
					"no-unreachable": "error",
					"@typescript-eslint/ban-ts-comment": [
						"error",
						{
							minimumDescriptionLength: 10,
						},
					],
					"no-array-constructor": "error",
					"@typescript-eslint/no-duplicate-enum-values": "error",
					"@typescript-eslint/no-dynamic-delete": "error",
					"@typescript-eslint/no-empty-object-type": "error",
					"@typescript-eslint/no-explicit-any": "off",
					"@typescript-eslint/no-extra-non-null-assertion": "error",
					"@typescript-eslint/no-extraneous-class": "error",
					"@typescript-eslint/no-invalid-void-type": "error",
					"@typescript-eslint/no-misused-new": "error",
					"@typescript-eslint/no-namespace": "error",
					"@typescript-eslint/no-non-null-asserted-nullish-coalescing": "error",
					"@typescript-eslint/no-non-null-asserted-optional-chain": "error",
					"@typescript-eslint/no-non-null-assertion": "error",
					"@typescript-eslint/no-require-imports": "error",
					"@typescript-eslint/no-this-alias": "error",
					"@typescript-eslint/no-unnecessary-type-constraint": "error",
					"@typescript-eslint/no-unsafe-declaration-merging": "error",
					"@typescript-eslint/no-unsafe-function-type": "error",
					"no-unused-expressions": "error",
					"no-unused-vars": [
						"error",
						{
							varsIgnorePattern: "^([A-Z_]|_)",
							argsIgnorePattern: "^_",
							caughtErrorsIgnorePattern: "^_",
						},
					],
					"@typescript-eslint/no-useless-constructor": "error",
					"no-var": "error",
					"@typescript-eslint/no-wrapper-object-types": "error",
					"@typescript-eslint/prefer-as-const": "error",
					"@typescript-eslint/prefer-literal-enum-member": "error",
					"@typescript-eslint/prefer-namespace-keyword": "error",
					"@typescript-eslint/triple-slash-reference": "error",
					"@typescript-eslint/unified-signatures": "error",
					"@typescript-eslint/no-unsafe-type-assertion": "error",
					"@typescript-eslint/no-floating-promises": "error",
					"@typescript-eslint/no-misused-promises": "error",
					"@typescript-eslint/await-thenable": "error",
					"@typescript-eslint/require-await": "error",
					"@typescript-eslint/return-await": ["error", "error-handling-correctness-only"],
					"@typescript-eslint/only-throw-error": "error",
					"@typescript-eslint/switch-exhaustiveness-check": "error",
					"@typescript-eslint/no-unnecessary-type-assertion": "error",
					"@typescript-eslint/prefer-nullish-coalescing": "error",
					"@typescript-eslint/no-unsafe-enum-comparison": "error",
					"@typescript-eslint/no-unsafe-unary-minus": "error",
					"@typescript-eslint/no-misused-spread": "error",
					"@typescript-eslint/no-array-delete": "error",
					"@typescript-eslint/no-for-in-array": "error",
					"@typescript-eslint/no-implied-eval": "error",
					"@typescript-eslint/restrict-plus-operands": "error",
					"@typescript-eslint/no-mixed-enums": "error",
					"@typescript-eslint/use-unknown-in-catch-callback-variable": "error",
					"@typescript-eslint/consistent-type-exports": "error",
					"@typescript-eslint/no-redundant-type-constituents": "error",
					"@typescript-eslint/no-unnecessary-boolean-literal-compare": "error",
					"@typescript-eslint/no-unnecessary-type-parameters": "error",
					"@typescript-eslint/no-unnecessary-type-conversion": "error",
					"@typescript-eslint/no-useless-default-assignment": "error",
					"@typescript-eslint/prefer-find": "error",
					"@typescript-eslint/prefer-includes": "error",
					"@typescript-eslint/prefer-string-starts-ends-with": "error",
					"@typescript-eslint/prefer-reduce-type-parameter": "error",
					"@typescript-eslint/prefer-return-this-type": "error",
					"@typescript-eslint/related-getter-setter-pairs": "error",
					"@typescript-eslint/non-nullable-type-assertion-style": "error",
					"@typescript-eslint/prefer-promise-reject-errors": "error",
					"@typescript-eslint/prefer-optional-chain": "error",
					"@typescript-eslint/no-unsafe-return": "error",
					"@typescript-eslint/no-unnecessary-template-expression": "error",
					"no-promise-executor-return": "error",
					"no-negated-condition": "error",
					"@typescript-eslint/no-confusing-void-expression": "error",
					"@typescript-eslint/promise-function-async": "error",
					"@typescript-eslint/dot-notation": ["error", {allowIndexSignaturePropertyAccess: true}],
					"@typescript-eslint/consistent-return": "error",
					"@typescript-eslint/prefer-readonly": "error",
					"@typescript-eslint/no-deprecated": "error",
					"import/no-cycle": "error",
					"import/no-self-import": "error",
					"import/no-duplicates": "error",
					"@typescript-eslint/no-unsafe-assignment": "error",
					"@typescript-eslint/no-unsafe-member-access": "error",
					"@typescript-eslint/no-unsafe-call": "error",
					"@typescript-eslint/no-unsafe-argument": "error",
					"@typescript-eslint/no-unnecessary-condition": ["error", {allowConstantLoopConditions: true}],
					"@typescript-eslint/strict-boolean-expressions": "error",
					"react-hooks/rules-of-hooks": "error",
					"react-hooks/exhaustive-deps": "error",
					eqeqeq: ["error", "smart"],
					"react/only-export-components": [
						"warn",
						{
							allowConstantExport: true,
						},
					],
				},
				env: {
					es2020: true,
					browser: true,
					jest: true,
				},
				plugins: ["typescript", "react", "import"],
			},
			{
				files: ["**/*.stories.@(ts|tsx|js|jsx|mjs|cjs)", "**/*.story.@(ts|tsx|js|jsx|mjs|cjs)"],
				rules: {
					"react-hooks/rules-of-hooks": "off",
					"import-x/no-anonymous-default-export": "off",
					"storybook/await-interactions": "error",
					"storybook/context-in-play-function": "error",
					"storybook/default-exports": "error",
					"storybook/hierarchy-separator": "warn",
					"storybook/no-redundant-story-name": "warn",
					"storybook/no-renderer-packages": "error",
					"storybook/prefer-pascal-case": "warn",
					"storybook/story-exports": "error",
					"storybook/use-storybook-expect": "error",
					"storybook/use-storybook-testing-library": "error",
				},
				jsPlugins: ["eslint-plugin-storybook"],
				plugins: ["react", "import"],
			},
			{
				files: [".storybook/main.@(js|cjs|mjs|ts)"],
				rules: {
					"storybook/no-uninstalled-addons": "error",
				},
				jsPlugins: ["eslint-plugin-storybook"],
			},
			{
				files: ["**/*.test.{ts,tsx}", "**/*.spec.{ts,tsx}"],
				rules: {
					"@typescript-eslint/no-non-null-assertion": "off",
					"@typescript-eslint/no-unsafe-type-assertion": "off",
					"@typescript-eslint/no-unsafe-assignment": "off",
					"@typescript-eslint/no-unsafe-member-access": "off",
					"@typescript-eslint/no-unsafe-call": "off",
					"@typescript-eslint/no-unsafe-argument": "off",
					"vitest/no-focused-tests": "error",
					"vitest/no-disabled-tests": "error",
					"vitest/no-identical-title": "error",
					"vitest/valid-expect": "error",
					"vitest/require-mock-type-parameters": "error",
					"vitest/require-to-throw-message": "error",
				},
				plugins: ["typescript", "vitest"],
			},
			// Project burn-down: template rules that still have findings here, each followed by its finding count.
			// Delete a line once its rule is clean; .llm/todo.md tracks the work.
			{
				files: ["**/*.{ts,tsx}"],
				plugins: ["typescript", "react", "import", "vitest"],
				rules: {
					"@typescript-eslint/await-thenable": "off", // 3
					"@typescript-eslint/consistent-return": "off", // 65
					"@typescript-eslint/dot-notation": "off", // 9
					"@typescript-eslint/no-confusing-void-expression": "off", // 1242
					"@typescript-eslint/no-deprecated": "off", // 83
					"@typescript-eslint/no-dynamic-delete": "off", // 14
					"@typescript-eslint/no-floating-promises": "off", // 25
					"@typescript-eslint/no-invalid-void-type": "off", // 2
					"@typescript-eslint/no-misused-promises": "off", // 24
					"@typescript-eslint/no-misused-spread": "off", // 2
					"@typescript-eslint/no-non-null-assertion": "off", // 297
					"@typescript-eslint/no-unnecessary-boolean-literal-compare": "off", // 3
					"@typescript-eslint/no-unnecessary-condition": "off", // 324
					"@typescript-eslint/no-unnecessary-template-expression": "off", // 1
					"@typescript-eslint/no-unnecessary-type-assertion": "off", // 146
					"@typescript-eslint/no-unnecessary-type-parameters": "off", // 3
					"@typescript-eslint/no-unsafe-argument": "off", // 8
					"@typescript-eslint/no-unsafe-assignment": "off", // 13
					"@typescript-eslint/no-unsafe-call": "off", // 17
					"@typescript-eslint/no-unsafe-member-access": "off", // 25
					"@typescript-eslint/no-unsafe-return": "off", // 23
					"@typescript-eslint/no-unsafe-type-assertion": "off", // 382
					"@typescript-eslint/non-nullable-type-assertion-style": "off", // 29
					"@typescript-eslint/only-throw-error": "off", // 13
					"@typescript-eslint/prefer-includes": "off", // 8
					"@typescript-eslint/prefer-nullish-coalescing": "off", // 46
					"@typescript-eslint/prefer-optional-chain": "off", // 23
					"@typescript-eslint/prefer-promise-reject-errors": "off", // 6
					"@typescript-eslint/prefer-readonly": "off", // 2
					"@typescript-eslint/prefer-string-starts-ends-with": "off", // 5
					"@typescript-eslint/promise-function-async": "off", // 621
					"@typescript-eslint/require-await": "off", // 387
					"@typescript-eslint/return-await": "off", // 1
					"@typescript-eslint/strict-boolean-expressions": "off", // 647
					"@typescript-eslint/switch-exhaustiveness-check": "off", // 14
					"import/no-duplicates": "off", // 2
					"no-negated-condition": "off", // 71
					"no-promise-executor-return": "off", // 122
					"no-useless-constructor": "off", // 1
					"react-hooks/exhaustive-deps": "off", // 6
					"react/only-export-components": "off", // 239 warnings, 86 in TanStack route modules that must export Route
					"vitest/no-disabled-tests": "off", // 2
					"vitest/require-mock-type-parameters": "off", // 332
					"vitest/require-to-throw-message": "off", // 13
					"vitest/valid-expect": "off", // 2
				},
			},
			// Test harness helpers named use* run at module scope and in anonymous callbacks.
			{
				files: ["tests/**/*.{ts,tsx}"],
				plugins: ["react"],
				rules: {
					"react-hooks/rules-of-hooks": "off", // 4
				},
			},
		],
		options: {
			typeAware: true,
			typeCheck: true,
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
	build: {
		// The per-file gzip table is hundreds of lines on every build; just perf-bundle ratchets the sizes that matter.
		reportCompressedSize: false,
		rolldownOptions: {onLog: quietDependencyDirectives},
	},
	environments: {
		client: {
			build: {
				manifest: true,
			},
		},
	},
	plugins: [
		lockfileToolchainGuard({viteVersion, rolldownVersion}),
		nitro({
			features: {websocket: true},
			serverDir: "./server",
			// node-pty loads its native addon and spawn-helper from prebuilds/ at runtime.
			traceDeps: ["node-pty*"],
		}),
		tailwindcss(),
		tanstackStart(),
		viteReact(),
		clientChunkGraph(import.meta.dirname),
		closeNitroRunnerOnServerClose(),
		holdNitroRequestsUntilReady(),
		// After nitro(): its error handler must follow nitro's catch-all dev middleware.
		...devWorkerProxy(),
	],
});
