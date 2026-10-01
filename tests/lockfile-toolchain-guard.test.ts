import {describe, expect, it} from "vite-plus/test";
import {rolldownVersion, version} from "vite-plus";
import {lockfileToolchainGuard} from "../src/lib/lockfile-toolchain-guard";

function runBuildStart(meta: {viteVersion: string; rolldownVersion: string}): string[] {
	const errors: string[] = [];
	const plugin = lockfileToolchainGuard({viteVersion: "8.3.0", rolldownVersion: "1.2.9"});
	plugin.buildStart.call({
		meta,
		error: (message: string): never => {
			errors.push(message);
			throw new Error(message);
		},
	});
	return errors;
}

describe("lockfileToolchainGuard", () => {
	it("lets a build run by the lockfile's vite-plus through", () => {
		expect(runBuildStart({viteVersion: "8.3.0", rolldownVersion: "1.2.9"})).toStrictEqual([]);
	});

	it("fails a build run by another vite-plus, whose rolldown chunks the client differently", () => {
		expect(() => runBuildStart({viteVersion: "8.1.5", rolldownVersion: "0.2.7"})).toThrow(
			"This build runs vite 8.1.5 with rolldown 0.2.7, but the lockfile's vite-plus has vite 8.3.0 with rolldown 1.2.9. Another vite-plus splits the client into different chunks and moves the bundle byte ceilings, so build with `just build` or node_modules/.bin/vp, not a global vp.",
		);
	});

	it("fails when only rolldown differs", () => {
		expect(() => runBuildStart({viteVersion: "8.3.0", rolldownVersion: "1.2.3"})).toThrow(
			"This build runs vite 8.3.0 with rolldown 1.2.3, but the lockfile's vite-plus has vite 8.3.0 with rolldown 1.2.9.",
		);
	});

	it("applies to builds only, so vp dev keeps working with any CLI", () => {
		expect(lockfileToolchainGuard({viteVersion: version, rolldownVersion}).apply).toBe("build");
	});
});
