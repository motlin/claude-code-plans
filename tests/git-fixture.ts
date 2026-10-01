import {execFileSync} from "node:child_process";

/**
 * Deletes every GIT_* variable from `environment`. A git hook or a linked worktree
 * exports GIT_DIR, GIT_INDEX_FILE and friends, and a test git command that inherits
 * them targets the developer's repository instead of its temporary fixture.
 */
export function scrubGitEnvironment(environment: NodeJS.ProcessEnv = process.env): void {
	for (const name of Object.keys(environment)) {
		if (name.startsWith("GIT_")) delete environment[name];
	}
}

type RunGitOptions = {
	readonly env?: Readonly<Record<string, string>>;
	readonly input?: string | Buffer;
};

/** Runs git in `cwd` with a scrubbed environment plus `options.env`, and returns its trimmed stdout. */
export function runGit(cwd: string, arguments_: readonly string[], options: RunGitOptions = {}): string {
	const env = {...process.env};
	scrubGitEnvironment(env);
	return execFileSync("git", arguments_, {
		cwd,
		env: {...env, ...options.env},
		encoding: "utf8",
		stdio: "pipe",
		...(options.input === undefined ? {} : {input: options.input}),
	}).trim();
}
