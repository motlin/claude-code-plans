import {execFileSync, spawnSync} from "node:child_process";
import {mkdirSync, mkdtempSync, realpathSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join, sep} from "node:path";
import {afterEach, describe, expect, it} from "vite-plus/test";

const SCRIPT = join(import.meta.dirname, "..", "scripts", "capture-permission-screens.py");

function hasPython(): boolean {
	try {
		execFileSync("python3", ["--version"], {stdio: "ignore"});
		return true;
	} catch {
		return false;
	}
}

const scratch: string[] = [];
afterEach(() => {
	for (const directory of scratch.splice(0)) rmSync(directory, {recursive: true, force: true});
});

function scratchDir(): string {
	const directory = realpathSync(mkdtempSync(join(tmpdir(), "ccp-capture-test-")));
	scratch.push(directory);
	return directory;
}

describe.skipIf(!hasPython())("capture-permission-screens.py --dry-run", () => {
	it("gives the CLI a fresh temp config dir and none of the parent's herdr, tmux, Claude or Anthropic variables", () => {
		const temp = scratchDir();
		const output = execFileSync("python3", ["-I", SCRIPT, "--claude", "/bin/false", "--dry-run"], {
			encoding: "utf8",
			env: {
				PATH: process.env["PATH"] ?? "",
				HOME: temp,
				TMPDIR: temp,
				HERDR_PANE_ID: "w100:p100",
				TMUX: "/tmp/tmux-test-100/default,100,0",
				CLAUDE_CONFIG_DIR: join(temp, ".claude"),
				CLAUDECODE: "1",
				ANTHROPIC_API_KEY: "sk-ant-test-100",
				CCP_KEPT: "kept",
			},
		});
		const {env, argv} = JSON.parse(output) as {env: Record<string, string>; argv: string[]};
		const configDir = env["CLAUDE_CONFIG_DIR"] ?? "";
		expect({
			prefixedKeys: Object.keys(env).filter((key) => /^(HERDR|TMUX|CLAUDE|ANTHROPIC)/.test(key)),
			configDirUnderTemp: realpathSync(join(configDir, "..", "..")) === temp,
			configDirName: configDir.split(sep).at(-1),
			baseUrl: env["ANTHROPIC_BASE_URL"],
			kept: env["CCP_KEPT"],
			argv,
		}).toStrictEqual({
			prefixedKeys: [
				"CLAUDE_CONFIG_DIR",
				"ANTHROPIC_BASE_URL",
				"ANTHROPIC_API_KEY",
				"CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC",
			],
			configDirUnderTemp: true,
			configDirName: "cfg",
			baseUrl: "http://127.0.0.1:0",
			kept: "kept",
			argv: [
				"/bin/false",
				"--strict-mcp-config",
				"--settings",
				'{"disableAllHooks": true}',
				"--permission-mode",
				"default",
			],
		});
	});

	it("refuses to run when the config dir would land inside ~/.claude", () => {
		const home = scratchDir();
		const claudeDir = join(home, ".claude");
		mkdirSync(claudeDir);
		const result = spawnSync("python3", ["-I", SCRIPT, "--claude", "/bin/false", "--dry-run"], {
			encoding: "utf8",
			env: {PATH: process.env["PATH"] ?? "", HOME: home, TMPDIR: claudeDir},
		});
		expect({status: result.status, stdout: result.stdout, stderr: result.stderr.trim()}).toStrictEqual({
			status: 1,
			stdout: "",
			stderr: expect.stringMatching(/^refusing to run: CLAUDE_CONFIG_DIR .* is inside ~\/\.claude$/) as unknown,
		});
	});
});
