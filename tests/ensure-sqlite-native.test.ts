import {execFileSync} from "node:child_process";
import {join} from "node:path";
import {describe, expect, it} from "vite-plus/test";

const REPO_ROOT = join(import.meta.dirname, "..");

describe("just ensure-sqlite-native", () => {
	it("finds better-sqlite3 by its pnpm store directory instead of walking every installed package", () => {
		const body = execFileSync(
			"just",
			["--justfile", join(REPO_ROOT, "justfile"), "--show", "ensure-sqlite-native"],
			{
				cwd: REPO_ROOT,
				encoding: "utf8",
			},
		);
		expect({
			walksStore: /\bfind node_modules\/\.pnpm\b/.test(body),
			globsPackage: body.includes("node_modules/.pnpm/better-sqlite3@*/node_modules/better-sqlite3/package.json"),
		}).toStrictEqual({walksStore: false, globsPackage: true});
	});
});
