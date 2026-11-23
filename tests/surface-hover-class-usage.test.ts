import {readdirSync, readFileSync} from "node:fs";
import {join} from "node:path";
import {describe, expect, it} from "vite-plus/test";

function sourceFiles(dir: string): string[]
{
	return readdirSync(
		dir,
		{
			recursive: true,
			encoding: "utf8",
		},
	)
		.filter((file) => /\.(ts|tsx)$/.test(file))
		.map((file) => join(dir, file));
}

describe("surface hover class usage", () =>
{
	it("T3: rows hover with bg-fill-ghost-hover, not the hover:bg-surface-0 class whose fizzy remap upstream deleted", () =>
	{
		const offenders = sourceFiles("src").flatMap((file) =>
			(readFileSync(file, "utf8").match(/"[^"\n]*"|'[^'\n]*'|`[^`]*`/g) ?? [])
				.filter((classes) => /(?<![\w-])hover:bg-surface-0(?![\w/-])/.test(classes))
				.filter((classes) => !/(?<![\w:-])bg-(?:surface-[0-3]|neutral-30)(?![\w/-])/.test(classes))
				.map((classes) => `${file}: ${classes}`),
		);
		expect(offenders).toStrictEqual([]);
	});
});
