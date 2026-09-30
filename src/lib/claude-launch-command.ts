const EFFORT_LEVELS = new Set(["low", "medium", "high", "xhigh", "max"]);
const PERMISSION_MODES = new Set(["acceptEdits", "auto", "bypassPermissions", "default", "manual", "dontAsk", "plan"]);

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]*$/;

const VALUE_FLAGS: Record<string, (value: string) => boolean> = {
	"--resume": (value) => ID_PATTERN.test(value),
	"--resume-session-at": (value) => ID_PATTERN.test(value),
	"--model": (value) => /^[A-Za-z0-9][A-Za-z0-9._[\]-]*$/.test(value),
	"--effort": (value) => EFFORT_LEVELS.has(value),
	"--permission-mode": (value) => PERMISSION_MODES.has(value),
};

/** Returns an error message, or null when `args` only uses the supported launch flags. */
export function validateClaudeLaunchArgs(args: readonly string[]): string | null {
	const seen = new Set<string>();
	for (let index = 0; index < args.length; index++) {
		const flag = args[index] as string;
		if (seen.has(flag)) return "duplicate claude argument";
		seen.add(flag);

		if (flag === "--fork-session") continue;

		const isValid = VALUE_FLAGS[flag];
		if (!isValid) return "unsupported claude argument";

		index++;
		const value = args[index];
		if (value === undefined) return `${flag} requires a value`;
		if (!isValid(value)) return `invalid value for ${flag}`;
	}

	for (const flag of ["--fork-session", "--resume-session-at"]) {
		if (seen.has(flag) && !seen.has("--resume")) return `${flag} requires --resume`;
	}
	return null;
}

function shellQuote(value: string): string {
	return `'${value.replaceAll("'", `'\\''`)}'`;
}

function shellWord(value: string): string {
	return /^[A-Za-z0-9_@%+=:,./-]+$/.test(value) ? value : shellQuote(value);
}

export interface ClaudeLaunchCommand {
	cwd: string;
	prompt?: string;
	args?: readonly string[];
}

/** POSIX shell command that starts the same session herdr would, for copy-to-clipboard fallback. */
export function buildClaudeCopyCommand({cwd, prompt, args = []}: ClaudeLaunchCommand): string {
	const words = ["claude", ...args.map(shellWord)];
	if (prompt !== undefined) words.push(shellQuote(prompt));
	return `cd ${shellQuote(cwd)} && ${words.join(" ")}`;
}
