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
import {serializeDevServerRestarts} from "./src/lib/dev-restart-serializer";
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
				command: "node node_modules/vitest/dist/cli.js run",
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
		plugins: ["typescript", "unicorn", "oxc", "import", "react", "vitest", "promise", "node", "jsx-a11y"],
		jsPlugins: [
			{
				name: "vite-plus",
				specifier: "vite-plus/oxlint-plugin",
			},
		],
		categories: {
			correctness: "error",
			suspicious: "error",
			perf: "error",
		},
		rules: {
			"vite-plus/prefer-vite-plus-imports": "error",
			"react/react-in-jsx-scope": "off",
			"no-case-declarations": "error",
			"no-empty": "error",
			"no-fallthrough": "error",
			"no-prototype-builtins": "error",
			"no-regex-spaces": "error",
			// ./router registers the router's type augmentation; the .d.ts imports react to augment its module.
			"import/no-unassigned-import": ["error", {allow: ["**/*.css", "./router", "react"]}],
			"no-unused-vars": [
				"error",
				{
					varsIgnorePattern: "^([A-Z_]|_)",
					argsIgnorePattern: "^_",
					caughtErrorsIgnorePattern: "^_",
				},
			],
			"react-hooks/rules-of-hooks": "error",
			eqeqeq: ["error", "smart"],
			"react/only-export-components": [
				"warn",
				{
					allowConstantExport: true,
				},
			],
			// Project opt-outs from the categories, each with dozens to hundreds of findings or a convention clash.
			// Test helpers and route callbacks sit beside the code that uses them on purpose.
			"unicorn/consistent-function-scoping": "off",
			// The `_` prefix marks unused bindings (see no-unused-vars) and Vite defines use __NAME__.
			"no-underscore-dangle": "off",
			"no-shadow": "off",
			"promise/always-return": "off",
			"vitest/no-conditional-expect": "off",
			// Tests assert through shared helpers that expect-expect cannot see.
			"vitest/expect-expect": "off",
			// React Compiler rules; this project does not build with the React Compiler.
			"react/refs": "off",
			"react/set-state-in-effect": "off",
			"react/exhaustive-effect-dependencies": "off",
			"react/purity": "off",
			"react/preserve-manual-memoization": "off",
			"react/static-components": "off",
			"react/memo-dependencies": "off",
			"react/immutability": "off",
			"react/globals": "off",
			// Render props (errorComponent, defaultComponent, toolbarContents) are not nested component definitions.
			"react/no-unstable-nested-components": ["error", {allowAsProps: true}],
			// Iterating over a copy is how loops that delete from their own Map or Set stay safe.
			"unicorn/no-useless-spread": "off",
			// on* assignment is how these sites replace and clear a single handler.
			"unicorn/prefer-add-event-listener": "off",
			// Every postMessage here is a Worker, MessagePort or BroadcastChannel, which take no targetOrigin.
			"unicorn/require-post-message-target-origin": "off",
			// Its loops wait on flags that callbacks flip between awaits.
			"no-unmodified-loop-condition": "off",
			// Sequential awaits are deliberate: ordered file reads, DB writes and test steps that must not interleave.
			"no-await-in-loop": "off",
			// Spreading inside map is the immutable-update idiom here; the copies are small and short-lived.
			"oxc/no-map-spread": "off",
			// Index keys sit on static token, line and text lists that never reorder, where the index is the identity.
			"react/no-array-index-key": "off",
			// Markup mirrors claude.ai/code, which puts ARIA roles on divs and spans rather than swapping tags.
			"jsx-a11y/prefer-tag-over-role": "off",
			// role="list" on list-style:none lists restores the list semantics Safari VoiceOver drops.
			"jsx-a11y/no-redundant-roles": "off",
			// Pickers, search fields and dialogs focus their input on open, as upstream does.
			"jsx-a11y/no-autofocus": "off",
			// Base UI render props and expression children carry the label where the rule cannot see it; every finding was a labelled control.
			"jsx-a11y/control-has-associated-label": "off",
			// The upstream eslint-plugin-jsx-a11y recommended allowances: list markup may carry listbox and option roles.
			"jsx-a11y/no-noninteractive-element-to-interactive-role": [
				"error",
				{
					ul: ["listbox", "menu", "menubar", "radiogroup", "tablist", "tree", "treegrid"],
					ol: ["listbox", "menu", "menubar", "radiogroup", "tablist", "tree", "treegrid"],
					li: ["menuitem", "menuitemradio", "menuitemcheckbox", "option", "row", "tab", "treeitem"],
					table: ["grid"],
					td: ["gridcell"],
				},
			],
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
					"no-undef": "error",
					"no-redeclare": "error",
				},
				env: {
					es2020: true,
					browser: true,
					jest: true,
				},
			},
			{
				files: ["**/*.{ts,tsx}"],
				rules: {
					"@typescript-eslint/ban-ts-comment": [
						"error",
						{
							minimumDescriptionLength: 10,
						},
					],
					"no-array-constructor": "error",
					"@typescript-eslint/no-dynamic-delete": "error",
					"@typescript-eslint/no-empty-object-type": "error",
					"@typescript-eslint/no-invalid-void-type": "error",
					"@typescript-eslint/no-namespace": "error",
					"@typescript-eslint/no-non-null-asserted-nullish-coalescing": "error",
					"@typescript-eslint/no-explicit-any": "error",
					"@typescript-eslint/no-non-null-assertion": "error",
					"@typescript-eslint/no-require-imports": "error",
					"@typescript-eslint/no-unsafe-function-type": "error",
					"no-var": "error",
					"@typescript-eslint/prefer-literal-enum-member": "error",
					"@typescript-eslint/unified-signatures": "error",
					"@typescript-eslint/no-misused-promises": "error",
					"@typescript-eslint/require-await": "error",
					"@typescript-eslint/return-await": ["error", "error-handling-correctness-only"],
					"@typescript-eslint/only-throw-error": [
						"error",
						{
							// TanStack Router control flow and crossws upgrade rejections are thrown by design.
							allow: [
								{
									from: "package",
									package: "@tanstack/router-core",
									name: ["Redirect", "NotFoundError"],
								},
								{from: "lib", name: "Response"},
							],
						},
					],
					"@typescript-eslint/switch-exhaustiveness-check": [
						"error",
						{considerDefaultExhaustiveForUnions: true},
					],
					"@typescript-eslint/prefer-nullish-coalescing": "error",
					"@typescript-eslint/restrict-plus-operands": "error",
					"@typescript-eslint/no-mixed-enums": "error",
					"@typescript-eslint/use-unknown-in-catch-callback-variable": "error",
					"@typescript-eslint/consistent-type-exports": "error",
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
					"no-promise-executor-return": "error",
					"no-negated-condition": "error",
					"@typescript-eslint/no-confusing-void-expression": "error",
					"@typescript-eslint/promise-function-async": "error",
					"@typescript-eslint/dot-notation": ["error", {allowIndexSignaturePropertyAccess: true}],
					"@typescript-eslint/prefer-readonly": "error",
					"@typescript-eslint/no-deprecated": "error",
					"import/no-cycle": "error",
					"import/no-duplicates": "error",
					"@typescript-eslint/no-unsafe-assignment": "error",
					"@typescript-eslint/no-unsafe-member-access": "error",
					"@typescript-eslint/no-unsafe-call": "error",
					"@typescript-eslint/no-unsafe-argument": "error",
					"@typescript-eslint/no-unnecessary-condition": ["error", {allowConstantLoopConditions: true}],
					"@typescript-eslint/strict-boolean-expressions": "off", // User opted out: it forces `=== true` noise.
				},
				env: {
					es2020: true,
					browser: true,
					jest: true,
				},
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
					"@typescript-eslint/no-explicit-any": "off",
					"@typescript-eslint/no-non-null-assertion": "off",
					"@typescript-eslint/no-unsafe-type-assertion": "off",
					"@typescript-eslint/no-unsafe-assignment": "off",
					"@typescript-eslint/no-unsafe-member-access": "off",
					"@typescript-eslint/no-unsafe-call": "off",
					"@typescript-eslint/no-unsafe-argument": "off",
					"@typescript-eslint/no-unsafe-return": "off",
					// Fetch mocks stringify RequestInfo and bodies; expect(mock.method) is the vitest idiom.
					"@typescript-eslint/no-base-to-string": "off",
					"@typescript-eslint/unbound-method": "off",
					// Titles come from typed fixture names; it.for and afterEach assertions are inside test blocks.
					"vitest/valid-title": "off",
					"vitest/no-standalone-expect": "off",
					"vitest/no-focused-tests": "error",
					"vitest/no-disabled-tests": "error",
					"vitest/no-identical-title": "error",
					"vitest/valid-expect": "error",
					"vitest/require-mock-type-parameters": "error",
					"vitest/require-to-throw-message": "error",
				},
			},
			{
				// TanStack Router file routes must export Route beside their components; the router plugin owns their HMR.
				files: ["src/routes/**"],
				rules: {
					"react/only-export-components": "off",
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
				// changeOrigin rewrites only Host; the Agentation server 403s a non-loopback Origin.
				headers: {origin: AGENTATION_SERVER},
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
		serializeDevServerRestarts(),
		// After nitro(): its error handler must follow nitro's catch-all dev middleware.
		...devWorkerProxy(),
	],
});
