import {readdirSync, readFileSync} from "node:fs";
import {join} from "node:path";
import {describe, expect, it} from "vite-plus/test";
import viteConfig from "../vite.config";

const TESTS_DIRECTORY = join(import.meta.dirname);
const THIS_FILE = "test-fixture-location.test.ts";

describe("test fixtures stay out of the dev server's watch", () => {
	it("ignores non-source scratch directories in the Vite dev watcher", () => {
		expect(viteConfig.server?.watch?.ignored).toStrictEqual([
			"**/routeTree.gen.ts",
			"**/.llm/**",
			"**/.playwright-mcp/**",
		]);
	});

	it("never creates test fixture directories inside the repository", () => {
		const offenders = readdirSync(TESTS_DIRECTORY, {recursive: true, encoding: "utf8"})
			.filter((file) => /\.test\.tsx?$/.test(file) && !file.endsWith(THIS_FILE))
			.flatMap((file) =>
				readFileSync(join(TESTS_DIRECTORY, file), "utf8")
					.split("\n")
					.map((line, index) => ({file, line: index + 1, text: line.trim()}))
					.filter(({text}) => /process\.cwd\(\)/.test(text) && /\.llm|mkdtemp|mkdir/.test(text)),
			);

		expect(offenders).toStrictEqual([]);
	});
});
