import {describe, expect, it} from "vite-plus/test";
import {clientBoundaryViolations, loweredDirSelectorViolations} from "../scripts/client-boundaries";
import type {ClientChunk} from "../src/lib/client-chunk-graph";

function chunk(fileName: string, overrides: Partial<ClientChunk> = {}): ClientChunk {
	return {fileName, isEntry: false, imports: [], dynamicImports: [], moduleIds: [], ...overrides};
}

const NO_CODE = (): string => "";

const ENTRY = chunk("assets/main.js", {isEntry: true, moduleIds: ["src/client.tsx"], imports: ["assets/react.js"]});

describe("client build boundaries", () => {
	it("accepts lazy grammars and markdown-it behind dynamic imports", () => {
		expect(
			clientBoundaryViolations(
				[
					{...ENTRY, dynamicImports: ["assets/markdown.js"]},
					chunk("assets/react.js", {moduleIds: ["node_modules/react/index.js"]}),
					chunk("assets/markdown.js", {
						moduleIds: ["node_modules/markdown-it/index.mjs"],
						dynamicImports: ["assets/javascript.js"],
					}),
					chunk("assets/javascript.js", {moduleIds: ["node_modules/shiki/dist/langs/javascript.mjs"]}),
				],
				NO_CODE,
			),
		).toStrictEqual([]);
	});

	const CODE: Record<string, string> = {
		"assets/react.js": 'import {readFileSync} from "node:fs";',
		"assets/route.js": 'await import("node:child_process")',
	};

	it("rejects Node built-ins, statically reachable grammars and markdown-it, and grammars one dynamic import away", () => {
		expect(
			clientBoundaryViolations(
				[
					{...ENTRY, dynamicImports: ["assets/lazy-lang.js"]},
					chunk("assets/react.js", {
						moduleIds: ["node_modules/markdown-it/index.mjs", "node_modules/shiki/langs/json.mjs"],
					}),
					chunk("assets/lazy-lang.js", {moduleIds: ["node_modules/shiki/dist/langs/python.mjs"]}),
					chunk("assets/route.js"),
				],
				(fileName) => CODE[fileName] ?? "",
			),
		).toStrictEqual([
			"assets/main.js -> assets/lazy-lang.js: node_modules/shiki/dist/langs/python.mjs",
			"assets/react.js: node:fs",
			"assets/react.js: node_modules/markdown-it/index.mjs",
			"assets/react.js: node_modules/shiki/langs/json.mjs",
			"assets/route.js: node:child_process",
		]);
	});

	it("reports a missing client entry instead of passing vacuously", () => {
		expect(clientBoundaryViolations([chunk("assets/react.js")], NO_CODE)).toStrictEqual([
			"no client entry chunk contains src/client.tsx",
		]);
	});
});

describe("built CSS keeps :dir()", () => {
	it("rejects a stylesheet whose :dir() was lowered to :lang() lists", () => {
		expect(
			loweredDirSelectorViolations("assets/globals-x.css", ".a:where(:root[dir=rtl] :is(:lang(ae),:lang(ar))){}"),
		).toStrictEqual(["assets/globals-x.css: :dir() was lowered to :lang() lists"]);
	});

	it("accepts the globals sheet when its :dir(rtl) rules survive", () => {
		expect(
			loweredDirSelectorViolations("assets/globals-x.css", ".a:where(:root[dir=rtl] :dir(rtl)){}"),
		).toStrictEqual([]);
	});

	it("rejects a globals sheet with no :dir(rtl) left, since its source writes many", () => {
		expect(loweredDirSelectorViolations("assets/globals-x.css", ".a{}")).toStrictEqual([
			"assets/globals-x.css: no :dir(rtl) rule survived the build",
		]);
	});

	it("accepts other stylesheets that never used :dir()", () => {
		expect(loweredDirSelectorViolations("assets/route-x.css", ".a{color:red}")).toStrictEqual([]);
	});
});
