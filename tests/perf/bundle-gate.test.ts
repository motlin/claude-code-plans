import {execFileSync} from "node:child_process";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";
import {describe, expect, it} from "vite-plus/test";
import {z} from "zod";
import {BUNDLE_BYTES_TOLERANCE} from "./ceiling-policy";
import {loadCeilings} from "./ratchet";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function just(...args: string[]): string {
	return execFileSync("just", ["--justfile", join(REPO_ROOT, "justfile"), ...args], {
		cwd: REPO_ROOT,
		encoding: "utf8",
		stdio: "pipe",
	});
}

const JustDumpSchema = z.object({
	recipes: z.record(z.string(), z.object({dependencies: z.array(z.object({recipe: z.string()}))})),
});

describe("bundle byte gate", () => {
	it("runs every recipe with the lockfile's vite-plus ahead of any global vp on PATH", () => {
		expect(just("--evaluate", "PATH").split(":")[0]).toBe(join(REPO_ROOT, "node_modules", ".bin"));
	});

	it("ratchets the bundle bytes in `just verify` right after the build, reusing its output", () => {
		const dump = JustDumpSchema.parse(JSON.parse(just("--dump", "--dump-format", "json")));
		expect(dump.recipes["verify"]?.dependencies.map((dependency) => dependency.recipe)).toStrictEqual([
			"check",
			"build",
			"perf-bundle",
			"fallow",
			"pre-commit",
		]);
	});

	it("gives every bundle byte ceiling the ±1% band", () => {
		const tolerances = Object.fromEntries(
			Object.entries(loadCeilings())
				.filter(([id]) => id.startsWith("bundle."))
				.map(([id, entry]) => [id, entry.tolerance]),
		);
		expect(tolerances).toStrictEqual({
			"bundle.home.gzip": BUNDLE_BYTES_TOLERANCE,
			"bundle.home.raw": BUNDLE_BYTES_TOLERANCE,
			"bundle.session.gzip": BUNDLE_BYTES_TOLERANCE,
			"bundle.session.raw": BUNDLE_BYTES_TOLERANCE,
		});
		expect(BUNDLE_BYTES_TOLERANCE).toBe(0.01);
	});
});
