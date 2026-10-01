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

/**
 * Config pinned onto every git process a test spawns, through git's GIT_CONFIG_COUNT
 * environment protocol so it reaches code under test that inherits process.env.
 * A developer's global core.fsmonitor=true would otherwise start a builtin fsmonitor
 * daemon for each temporary fixture repository, and that daemon outlives the test.
 */
const PINNED_GIT_CONFIG: readonly (readonly [key: string, value: string])[] = [["core.fsmonitor", "false"]];

/** Deletes every GIT_* variable from `environment`, then pins {@link PINNED_GIT_CONFIG} onto it. */
export function isolateGitEnvironment(environment: NodeJS.ProcessEnv = process.env): void {
	scrubGitEnvironment(environment);
	environment["GIT_CONFIG_COUNT"] = String(PINNED_GIT_CONFIG.length);
	for (const [index, [key, value]] of PINNED_GIT_CONFIG.entries()) {
		environment[`GIT_CONFIG_KEY_${index}`] = key;
		environment[`GIT_CONFIG_VALUE_${index}`] = value;
	}
}

type RunGitOptions = {
	readonly env?: Readonly<Record<string, string>>;
	readonly input?: string | Buffer;
};

/** Runs git in `cwd` with an isolated environment plus `options.env`, and returns its trimmed stdout. */
export function runGit(cwd: string, arguments_: readonly string[], options: RunGitOptions = {}): string {
	const env = {...process.env};
	isolateGitEnvironment(env);
	return execFileSync("git", arguments_, {
		cwd,
		env: {...env, ...options.env},
		encoding: "utf8",
		stdio: "pipe",
		...(options.input === undefined ? {} : {input: options.input}),
	}).trim();
}
