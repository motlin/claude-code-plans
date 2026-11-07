import {readdirSync, readFileSync} from "node:fs";
import {join} from "node:path";
import {describe, expect, it} from "vite-plus/test";

function sourceFiles(dir: string): string[] {
	return readdirSync(dir, {recursive: true, encoding: "utf8"})
		.filter((file) => /\.(ts|tsx)$/.test(file))
		.map((file) => join(dir, file));
}

describe("surface hover class usage", () => {
	it("T3: rows use the exact hover:bg-surface-0 class that the fizzy ghost-hover remap matches", () => {
		const offenders = sourceFiles("src").filter((file) =>
			/hover:bg-surface-0\/50\b/.test(readFileSync(file, "utf8")),
		);
		expect(offenders).toStrictEqual([]);
	});
});
