import {mkdtempSync, mkdirSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {describe, expect, it} from "vite-plus/test";
import {needsIsolation, partitionTestFiles, runsInDom} from "../scripts/vitest-isolation";

describe("needsIsolation", () => {
	it("isolates files that replace modules, stub globals, rename the process or ask for it", () => {
		const sources = {
			plain: `import {expect, it} from "vite-plus/test";\nit("adds", () => expect(1 + 1).toBe(2));\n`,
			jsdom: `// @vitest-environment jsdom\nit("renders", () => {});\n`,
			mock: `vi.mock("../src/lib/config");\n`,
			doMock: `vi.doMock("../src/lib/config", () => ({}));\n`,
			resetModules: `beforeEach(() => vi.resetModules());\n`,
			stubGlobal: `vi.stubGlobal("fetch", fetchMock);\n`,
			processTitle: `process.title = "Alice's server";\n`,
			marked: `// @vitest-isolate: asserts a module's first load\n`,
		};

		expect(
			Object.fromEntries(Object.entries(sources).map(([name, source]) => [name, needsIsolation(source)])),
		).toStrictEqual({
			plain: false,
			jsdom: false,
			mock: true,
			doMock: true,
			resetModules: true,
			stubGlobal: true,
			processTitle: true,
			marked: true,
		});
	});
});

describe("runsInDom", () => {
	it("detects the jsdom environment comment", () => {
		expect([
			runsInDom(`// @vitest-environment jsdom\nit("renders", () => {});\n`),
			runsInDom(`it("adds", () => {});\n`),
		]).toStrictEqual([true, false]);
	});
});

describe("partitionTestFiles", () => {
	it("splits test files under the directory into shared, shared jsdom and isolated lists by content", () => {
		const root = mkdtempSync(path.join(tmpdir(), "vitest-isolation-"));
		mkdirSync(path.join(root, "tests", "db"), {recursive: true});
		writeFileSync(path.join(root, "tests", "plain.test.ts"), `it("adds", () => {});\n`);
		writeFileSync(path.join(root, "tests", "db", "query.test.ts"), `it("queries", () => {});\n`);
		writeFileSync(path.join(root, "tests", "dom.test.tsx"), `// @vitest-environment jsdom\n`);
		writeFileSync(path.join(root, "tests", "mocked.test.ts"), `vi.mock("node:fs");\n`);
		writeFileSync(
			path.join(root, "tests", "mocked-dom.test.tsx"),
			`// @vitest-environment jsdom\nvi.mock("node:fs");\n`,
		);
		writeFileSync(path.join(root, "tests", "helper.ts"), `vi.mock("node:fs");\n`);

		expect(partitionTestFiles(root, "tests")).toStrictEqual({
			shared: ["tests/db/query.test.ts", "tests/plain.test.ts"],
			sharedDom: ["tests/dom.test.tsx"],
			isolated: ["tests/mocked-dom.test.tsx", "tests/mocked.test.ts"],
		});
	});
});
