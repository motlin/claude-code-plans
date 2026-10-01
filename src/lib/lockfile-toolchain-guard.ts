// A vite-plus other than the lockfile's (a stale global `vp` on an agent's PATH, say) loads this config fine but
// bundles with its own vite and rolldown, which split the client into different chunks: the same tree then measures
// about 5% apart in `just perf-bundle` depending on which `vp` built it. The config's own `vite-plus` import always
// resolves from node_modules, so comparing it with the running bundler catches the mismatch before anything is written.

export interface ToolchainVersions {
	viteVersion: string;
	rolldownVersion: string;
}

interface BuildStartContext {
	meta: ToolchainVersions;
	error(message: string): never;
}

interface BuildPlugin {
	name: string;
	apply: "build";
	buildStart(this: BuildStartContext): void;
}

/** Fails any build whose running vite or rolldown differs from the versions the lockfile's vite-plus ships. */
export function lockfileToolchainGuard(expected: ToolchainVersions): BuildPlugin {
	return {
		name: "ccp:lockfile-toolchain-guard",
		apply: "build",
		buildStart() {
			const {viteVersion, rolldownVersion} = this.meta;
			if (viteVersion === expected.viteVersion && rolldownVersion === expected.rolldownVersion) return;
			this.error(
				`This build runs vite ${viteVersion} with rolldown ${rolldownVersion}, but the lockfile's vite-plus has vite ${expected.viteVersion} with rolldown ${expected.rolldownVersion}. Another vite-plus splits the client into different chunks and moves the bundle byte ceilings, so build with \`just build\` or node_modules/.bin/vp, not a global vp.`,
			);
		},
	};
}
