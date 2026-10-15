import {readdirSync, readFileSync, statSync} from "node:fs";
import {join} from "node:path";
import {describe, expect, it} from "vite-plus/test";

function sources(dir: string): string[] {
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) return sources(path);
		return /\.tsx?$/.test(name) ? [path] : [];
	});
}

describe("focus rings", () => {
	it("rings rows and buttons only on keyboard focus, as upstream's focus-visible rings do", () => {
		const offenders = sources("src").filter((path) =>
			/(?<![\w-])focus:ring-focus\b/.test(readFileSync(path, "utf8")),
		);

		expect({
			offenders,
			fileResult: readFileSync("src/components/file-search-results.tsx", "utf8").includes(
				"hover:bg-surface-0/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-100",
			),
		}).toStrictEqual({offenders: [], fileResult: true});
	});
});
