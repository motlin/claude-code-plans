import {mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vite-plus/test";
import {
	handleClaudeCodeSettingsGet,
	handleClaudeCodeSettingsPost,
	patchClaudeCodeSetting,
	readClaudeCodeSettings,
} from "../src/lib/claude-code-settings";
import {CLAUDE_CODE_SETTING_KEYS} from "../src/lib/claude-code-settings-schema";
import {ClaudeSettingsSchema} from "../src/lib/schemas";

let claudeDir: string;
let settingsPath: string;

const ORIGINAL = [
	"{",
	'    "model": "opus",',
	'    "outputStyle": "Learning",',
	'    "sandbox": {',
	'        "excludedCommands": [',
	'            "docker"',
	"        ]",
	"    },",
	'    "env": {',
	'        "FOO": "bar"',
	"    }",
	"}",
	"",
].join("\n");

function writeSettings(text: string): number {
	writeFileSync(settingsPath, text);
	return statSync(settingsPath).mtimeMs;
}

function readSettings(): string {
	return readFileSync(settingsPath, "utf-8");
}

beforeEach(() => {
	claudeDir = mkdtempSync(join(tmpdir(), "claude-code-settings-"));
	settingsPath = join(claudeDir, "settings.json");
});

afterEach(() => {
	rmSync(claudeDir, {recursive: true, force: true});
});

describe("CLAUDE_CODE_SETTING_KEYS", () => {
	it("allows only the scalar keys the Claude Code tab edits", () => {
		expect(CLAUDE_CODE_SETTING_KEYS).toStrictEqual([
			"outputStyle",
			"remoteControlAtStartup",
			"skipDangerousModePermissionPrompt",
			"sandbox.enabled",
			"enableWorkflows",
		]);
	});
});

describe("readClaudeCodeSettings", () => {
	it("reports the mtime and the allow-listed values present in the file", async () => {
		const mtimeMs = writeSettings(
			'{\n  "outputStyle": "Learning",\n  "enableWorkflows": false,\n  "sandbox": {"enabled": true},\n  "model": "opus"\n}\n',
		);
		expect(await readClaudeCodeSettings(claudeDir)).toStrictEqual({
			mtimeMs,
			values: {outputStyle: "Learning", enableWorkflows: false, "sandbox.enabled": true},
		});
	});

	it("flags bypass permissions mode as disabled when permissions.disableBypassPermissionsMode is disable", async () => {
		const mtimeMs = writeSettings(
			'{\n  "skipDangerousModePermissionPrompt": true,\n  "permissions": {"disableBypassPermissionsMode": "disable"}\n}\n',
		);
		expect(await readClaudeCodeSettings(claudeDir)).toStrictEqual({
			mtimeMs,
			values: {skipDangerousModePermissionPrompt: true},
			bypassPermissionsModeDisabled: true,
		});
	});

	it("reports a missing file as a null mtime and no values", async () => {
		expect(await readClaudeCodeSettings(claudeDir)).toStrictEqual({mtimeMs: null, values: {}});
	});
});

describe("patchClaudeCodeSetting", () => {
	it("sets a scalar key, keeping the other keys and the file's indentation", async () => {
		const mtimeMs = writeSettings(ORIGINAL);
		const result = await patchClaudeCodeSetting(claudeDir, {
			key: "outputStyle",
			value: "Explanatory",
			expectedMtimeMs: mtimeMs,
		});
		expect(readSettings()).toBe(ORIGINAL.replace('"Learning"', '"Explanatory"'));
		expect(JSON.parse(readSettings())).toStrictEqual({
			model: "opus",
			outputStyle: "Explanatory",
			sandbox: {excludedCommands: ["docker"]},
			env: {FOO: "bar"},
		});
		expect(result).toStrictEqual({
			ok: true,
			state: {
				mtimeMs: statSync(settingsPath).mtimeMs,
				values: {outputStyle: "Explanatory"},
			},
		});
	});

	it("removes the key when the value is undefined", async () => {
		const mtimeMs = writeSettings(ORIGINAL);
		const result = await patchClaudeCodeSetting(claudeDir, {
			key: "outputStyle",
			value: undefined,
			expectedMtimeMs: mtimeMs,
		});
		expect(JSON.parse(readSettings())).toStrictEqual({
			model: "opus",
			sandbox: {excludedCommands: ["docker"]},
			env: {FOO: "bar"},
		});
		expect(result.ok).toBe(true);
	});

	it("updates nested sandbox.enabled and keeps sandbox.excludedCommands", async () => {
		const mtimeMs = writeSettings(ORIGINAL);
		await patchClaudeCodeSetting(claudeDir, {key: "sandbox.enabled", value: true, expectedMtimeMs: mtimeMs});
		expect(JSON.parse(readSettings())).toStrictEqual({
			model: "opus",
			outputStyle: "Learning",
			sandbox: {excludedCommands: ["docker"], enabled: true},
			env: {FOO: "bar"},
		});
		expect(readSettings()).toContain('    "sandbox": {\n        "excludedCommands": [');
	});

	it("creates settings.json with the nested key when the file is missing", async () => {
		const result = await patchClaudeCodeSetting(claudeDir, {
			key: "sandbox.enabled",
			value: true,
			expectedMtimeMs: null,
		});
		expect(JSON.parse(readSettings())).toStrictEqual({sandbox: {enabled: true}});
		expect(result).toStrictEqual({
			ok: true,
			state: {mtimeMs: statSync(settingsPath).mtimeMs, values: {"sandbox.enabled": true}},
		});
	});

	it("refuses a stale mtime with a conflict and leaves the file untouched", async () => {
		const mtimeMs = writeSettings(ORIGINAL);
		const result = await patchClaudeCodeSetting(claudeDir, {
			key: "outputStyle",
			value: "Explanatory",
			expectedMtimeMs: mtimeMs - 1000,
		});
		expect(result).toStrictEqual({
			ok: false,
			reason: "conflict",
			state: {mtimeMs, values: {outputStyle: "Learning"}},
		});
		expect(readSettings()).toBe(ORIGINAL);
	});

	it("refuses to edit a settings.json that is not valid JSON", async () => {
		const mtimeMs = writeSettings("{ not json");
		expect(
			await patchClaudeCodeSetting(claudeDir, {key: "outputStyle", value: "x", expectedMtimeMs: mtimeMs}),
		).toStrictEqual({ok: false, reason: "invalid", message: "settings.json is not valid JSON"});
		expect(readSettings()).toBe("{ not json");
	});

	it("rejects a value of the wrong type for the key", async () => {
		const mtimeMs = writeSettings(ORIGINAL);
		expect(
			await patchClaudeCodeSetting(claudeDir, {
				key: "sandbox.enabled",
				value: "yes",
				expectedMtimeMs: mtimeMs,
			}),
		).toStrictEqual({ok: false, reason: "invalid", message: "Invalid value for sandbox.enabled"});
		expect(readSettings()).toBe(ORIGINAL);
	});

	it("leaves no temp files behind after a write", async () => {
		const mtimeMs = writeSettings(ORIGINAL);
		await patchClaudeCodeSetting(claudeDir, {key: "enableWorkflows", value: false, expectedMtimeMs: mtimeMs});
		expect(readdirSync(claudeDir)).toStrictEqual(["settings.json"]);
	});
});

describe("claude-code-settings handlers", () => {
	function post(body: unknown, headers: Record<string, string> = {}): Request {
		return new Request("http://localhost/api/claude-code-settings", {
			method: "POST",
			headers: {"Content-Type": "application/json", ...headers},
			body: JSON.stringify(body),
		});
	}

	it("GET returns the mtime and values", async () => {
		const mtimeMs = writeSettings(ORIGINAL);
		const response = await handleClaudeCodeSettingsGet(claudeDir);
		expect(response.status).toBe(200);
		expect(await response.json()).toStrictEqual({mtimeMs, values: {outputStyle: "Learning"}});
	});

	it("POST writes an allow-listed key", async () => {
		const mtimeMs = writeSettings(ORIGINAL);
		const response = await handleClaudeCodeSettingsPost(
			post({key: "remoteControlAtStartup", value: false, expectedMtimeMs: mtimeMs}),
			claudeDir,
		);
		expect(response.status).toBe(200);
		expect(JSON.parse(readSettings())).toMatchObject({remoteControlAtStartup: false});
	});

	it("POST with no value deletes the key", async () => {
		const mtimeMs = writeSettings(ORIGINAL);
		const response = await handleClaudeCodeSettingsPost(
			post({key: "outputStyle", value: undefined, expectedMtimeMs: mtimeMs}),
			claudeDir,
		);
		expect(response.status).toBe(200);
		expect(await response.json()).toStrictEqual({mtimeMs: statSync(settingsPath).mtimeMs, values: {}});
	});

	it("POST rejects keys outside the allowlist with 400", async () => {
		const mtimeMs = writeSettings(ORIGINAL);
		for (const key of ["model", "permissions", "sandbox", "sandbox.excludedCommands", "__proto__"]) {
			const response = await handleClaudeCodeSettingsPost(
				post({key, value: true, expectedMtimeMs: mtimeMs}),
				claudeDir,
			);
			expect(response.status).toBe(400);
		}
		expect(readSettings()).toBe(ORIGINAL);
	});

	it("POST rejects a wrongly typed value with 400", async () => {
		const mtimeMs = writeSettings(ORIGINAL);
		const response = await handleClaudeCodeSettingsPost(
			post({key: "enableWorkflows", value: "on", expectedMtimeMs: mtimeMs}),
			claudeDir,
		);
		expect(response.status).toBe(400);
		expect(readSettings()).toBe(ORIGINAL);
	});

	it("POST returns 409 with the current state on a stale mtime", async () => {
		const mtimeMs = writeSettings(ORIGINAL);
		const response = await handleClaudeCodeSettingsPost(
			post({key: "outputStyle", value: "x", expectedMtimeMs: mtimeMs - 1000}),
			claudeDir,
		);
		expect(response.status).toBe(409);
		expect(await response.json()).toStrictEqual({mtimeMs, values: {outputStyle: "Learning"}});
	});

	it("POST returns 422 when settings.json is invalid", async () => {
		const mtimeMs = writeSettings("{ not json");
		const response = await handleClaudeCodeSettingsPost(
			post({key: "outputStyle", value: "x", expectedMtimeMs: mtimeMs}),
			claudeDir,
		);
		expect(response.status).toBe(422);
	});

	it("POST refuses a cross-site request", async () => {
		const mtimeMs = writeSettings(ORIGINAL);
		const response = await handleClaudeCodeSettingsPost(
			post({key: "outputStyle", value: "x", expectedMtimeMs: mtimeMs}, {Origin: "https://evil.example"}),
			claudeDir,
		);
		expect(response.status).toBe(403);
		expect(readSettings()).toBe(ORIGINAL);
	});
});

describe("ClaudeSettingsSchema workflow keys", () => {
	it("accepts enableWorkflows and disableWorkflows booleans", () => {
		expect(ClaudeSettingsSchema.parse({enableWorkflows: true, disableWorkflows: false})).toStrictEqual({
			enableWorkflows: true,
			disableWorkflows: false,
		});
	});
});
