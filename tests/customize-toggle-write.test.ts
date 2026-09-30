import {mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vite-plus/test";
import {SettingsToggleRequestSchema} from "../src/lib/api/customize";
import {
	applySettingsToggle,
	handleSettingsToggleGet,
	handleSettingsTogglePost,
	readSettingsToggleState,
} from "../src/lib/customize/settings-toggles";
import {ClaudeSettingsSchema} from "../src/lib/schemas";

let claudeDir: string;
let settingsPath: string;

const ORIGINAL = [
	"{",
	'    "model": "opus",',
	'    "skillOverrides": {',
	'        "legacy": "name-only"',
	"    },",
	'    "enabledPlugins": {',
	'        "tools@market": true',
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
	claudeDir = mkdtempSync(join(tmpdir(), "customize-toggle-"));
	settingsPath = join(claudeDir, "settings.json");
});

afterEach(() => {
	rmSync(claudeDir, {recursive: true, force: true});
});

describe("readSettingsToggleState", () => {
	it("reports the file mtime with skillOverrides and enabledPlugins", async () => {
		const mtimeMs = writeSettings(ORIGINAL);
		expect(await readSettingsToggleState(claudeDir)).toStrictEqual({
			mtimeMs,
			skillOverrides: {legacy: "name-only"},
			enabledPlugins: {"tools@market": true},
		});
	});

	it("reports a missing settings.json as a null mtime with empty maps", async () => {
		expect(await readSettingsToggleState(claudeDir)).toStrictEqual({
			mtimeMs: null,
			skillOverrides: {},
			enabledPlugins: {},
		});
	});
});

describe("applySettingsToggle", () => {
	it("turns a skill off and back on, preserving unrelated keys and formatting", async () => {
		const mtimeMs = writeSettings(ORIGINAL);

		const off = await applySettingsToggle({
			claudeDir,
			expectedMtimeMs: mtimeMs,
			toggle: {kind: "skill", name: "deploy", enabled: false},
		});
		const offText = readSettings();
		expect(offText).toBe(
			[
				"{",
				'    "model": "opus",',
				'    "skillOverrides": {',
				'        "legacy": "name-only",',
				'        "deploy": "off"',
				"    },",
				'    "enabledPlugins": {',
				'        "tools@market": true',
				"    },",
				'    "env": {',
				'        "FOO": "bar"',
				"    }",
				"}",
				"",
			].join("\n"),
		);
		expect(off).toStrictEqual({
			ok: true,
			state: {
				mtimeMs: statSync(settingsPath).mtimeMs,
				skillOverrides: {legacy: "name-only", deploy: "off"},
				enabledPlugins: {"tools@market": true},
			},
		});

		if (!off.ok) throw new Error("expected the first toggle to succeed");
		const on = await applySettingsToggle({
			claudeDir,
			expectedMtimeMs: off.state.mtimeMs,
			toggle: {kind: "skill", name: "deploy", enabled: true},
		});
		expect(readSettings()).toBe(ORIGINAL);
		expect(on).toStrictEqual({
			ok: true,
			state: {
				mtimeMs: statSync(settingsPath).mtimeMs,
				skillOverrides: {legacy: "name-only"},
				enabledPlugins: {"tools@market": true},
			},
		});
	});

	it("removes an emptied skillOverrides map so an off/on round-trip is byte-identical", async () => {
		const original = '{\n  "model": "opus"\n}\n';
		const first = writeSettings(original);

		const off = await applySettingsToggle({
			claudeDir,
			expectedMtimeMs: first,
			toggle: {kind: "skill", name: "deploy", enabled: false},
		});
		expect(readSettings()).toBe('{\n  "model": "opus",\n  "skillOverrides": {\n    "deploy": "off"\n  }\n}\n');
		if (!off.ok) throw new Error("expected the first toggle to succeed");

		await applySettingsToggle({
			claudeDir,
			expectedMtimeMs: off.state.mtimeMs,
			toggle: {kind: "skill", name: "deploy", enabled: true},
		});
		expect(readSettings()).toBe(original);
	});

	it("sets enabledPlugins[id] for a plugin, keeping tab indentation", async () => {
		const original = '{\n\t"enabledPlugins": {\n\t\t"tools@market": true\n\t}\n}\n';
		const mtimeMs = writeSettings(original);

		const result = await applySettingsToggle({
			claudeDir,
			expectedMtimeMs: mtimeMs,
			toggle: {kind: "plugin", id: "tools@market", enabled: false},
		});

		expect(readSettings()).toBe('{\n\t"enabledPlugins": {\n\t\t"tools@market": false\n\t}\n}\n');
		expect(result).toStrictEqual({
			ok: true,
			state: {
				mtimeMs: statSync(settingsPath).mtimeMs,
				skillOverrides: {},
				enabledPlugins: {"tools@market": false},
			},
		});
	});

	it("creates settings.json when it does not exist and the caller expected none", async () => {
		const result = await applySettingsToggle({
			claudeDir,
			expectedMtimeMs: null,
			toggle: {kind: "plugin", id: "tools@market", enabled: true},
		});

		expect(readSettings()).toBe('{\n  "enabledPlugins": {\n    "tools@market": true\n  }\n}\n');
		expect(result).toStrictEqual({
			ok: true,
			state: {
				mtimeMs: statSync(settingsPath).mtimeMs,
				skillOverrides: {},
				enabledPlugins: {"tools@market": true},
			},
		});
	});

	it("returns a conflict and leaves the file alone when the mtime is stale", async () => {
		const mtimeMs = writeSettings(ORIGINAL);

		const result = await applySettingsToggle({
			claudeDir,
			expectedMtimeMs: mtimeMs - 1000,
			toggle: {kind: "skill", name: "deploy", enabled: false},
		});

		expect(result).toStrictEqual({
			ok: false,
			reason: "conflict",
			state: {
				mtimeMs,
				skillOverrides: {legacy: "name-only"},
				enabledPlugins: {"tools@market": true},
			},
		});
		expect(readSettings()).toBe(ORIGINAL);
	});

	it("returns a conflict when the caller expected no file but one exists", async () => {
		const mtimeMs = writeSettings(ORIGINAL);

		const result = await applySettingsToggle({
			claudeDir,
			expectedMtimeMs: null,
			toggle: {kind: "plugin", id: "tools@market", enabled: false},
		});

		expect(result).toStrictEqual({
			ok: false,
			reason: "conflict",
			state: {
				mtimeMs,
				skillOverrides: {legacy: "name-only"},
				enabledPlugins: {"tools@market": true},
			},
		});
		expect(readSettings()).toBe(ORIGINAL);
	});

	it("refuses to rewrite a settings.json that fails strict validation", async () => {
		const invalid = '{\n  "skillOverrides": {\n    "legacy": "sometimes"\n  }\n}\n';
		const mtimeMs = writeSettings(invalid);

		const result = await applySettingsToggle({
			claudeDir,
			expectedMtimeMs: mtimeMs,
			toggle: {kind: "skill", name: "deploy", enabled: false},
		});

		expect(result).toStrictEqual({
			ok: false,
			reason: "invalid",
			message: "settings.json does not match the settings schema",
		});
		expect(readSettings()).toBe(invalid);
	});

	it("refuses to rewrite a settings.json that is not JSON", async () => {
		const mtimeMs = writeSettings("{ not json");

		const result = await applySettingsToggle({
			claudeDir,
			expectedMtimeMs: mtimeMs,
			toggle: {kind: "plugin", id: "tools@market", enabled: false},
		});

		expect(result).toStrictEqual({
			ok: false,
			reason: "invalid",
			message: "settings.json is not valid JSON",
		});
		expect(readSettings()).toBe("{ not json");
	});

	it("leaves no temporary files behind", async () => {
		const mtimeMs = writeSettings(ORIGINAL);
		await applySettingsToggle({
			claudeDir,
			expectedMtimeMs: mtimeMs,
			toggle: {kind: "skill", name: "deploy", enabled: false},
		});
		expect(readdirSync(claudeDir)).toStrictEqual(["settings.json"]);
	});
});

describe("unknown values", () => {
	it("accepts exactly the documented skillOverrides values", () => {
		const values = ["on", "name-only", "user-invocable-only", "off"];
		for (const value of values) {
			expect(ClaudeSettingsSchema.safeParse({skillOverrides: {a: value}}).success).toBe(true);
		}
		expect(ClaudeSettingsSchema.safeParse({skillOverrides: {a: "disabled"}}).success).toBe(false);
	});

	it("rejects toggle requests with unknown kinds, values, extra keys, or plugin-skill names", () => {
		const rejected = [
			{kind: "agent", name: "x", enabled: false},
			{kind: "skill", name: "x", enabled: "off"},
			{kind: "skill", name: "x", enabled: false, value: "name-only"},
			{kind: "skill", name: "", enabled: false},
			{kind: "skill", name: "tools:format", enabled: false},
			{kind: "plugin", id: "no-marketplace", enabled: false},
		];
		for (const toggle of rejected) {
			expect(
				SettingsToggleRequestSchema.safeParse({expectedMtimeMs: 1, toggle}).success,
				JSON.stringify(toggle),
			).toBe(false);
		}
		expect(
			SettingsToggleRequestSchema.safeParse({
				expectedMtimeMs: null,
				toggle: {kind: "plugin", id: "tools@market", enabled: true},
			}),
		).toStrictEqual({
			success: true,
			data: {
				expectedMtimeMs: null,
				toggle: {kind: "plugin", id: "tools@market", enabled: true},
			},
		});
	});
});

describe("HTTP handlers", () => {
	const url = "http://localhost/api/customize/settings-toggles";

	function post(body: unknown, headers: Record<string, string> = {}): Request {
		return new Request(url, {
			method: "POST",
			headers: {"Content-Type": "application/json", ...headers},
			body: JSON.stringify(body),
		});
	}

	it("GET returns the current toggle state", async () => {
		const mtimeMs = writeSettings(ORIGINAL);
		const response = await handleSettingsToggleGet(claudeDir);
		expect(response.status).toBe(200);
		expect(await response.json()).toStrictEqual({
			mtimeMs,
			skillOverrides: {legacy: "name-only"},
			enabledPlugins: {"tools@market": true},
		});
	});

	it("POST writes and returns the new state", async () => {
		const mtimeMs = writeSettings(ORIGINAL);
		const response = await handleSettingsTogglePost(
			post({
				expectedMtimeMs: mtimeMs,
				toggle: {kind: "plugin", id: "tools@market", enabled: false},
			}),
			claudeDir,
		);
		expect(response.status).toBe(200);
		expect(await response.json()).toStrictEqual({
			mtimeMs: statSync(settingsPath).mtimeMs,
			skillOverrides: {legacy: "name-only"},
			enabledPlugins: {"tools@market": false},
		});
	});

	it("POST answers 409 with the current state on a stale mtime", async () => {
		const mtimeMs = writeSettings(ORIGINAL);
		const response = await handleSettingsTogglePost(
			post({expectedMtimeMs: 1, toggle: {kind: "plugin", id: "tools@market", enabled: false}}),
			claudeDir,
		);
		expect(response.status).toBe(409);
		expect(await response.json()).toStrictEqual({
			mtimeMs,
			skillOverrides: {legacy: "name-only"},
			enabledPlugins: {"tools@market": true},
		});
		expect(readSettings()).toBe(ORIGINAL);
	});

	it("POST answers 400 for an unknown value and 422 for an invalid file", async () => {
		writeSettings(ORIGINAL);
		const bad = await handleSettingsTogglePost(
			post({expectedMtimeMs: 1, toggle: {kind: "skill", name: "x", enabled: "maybe"}}),
			claudeDir,
		);
		expect(bad.status).toBe(400);

		const mtimeMs = writeSettings('{ "unknownKey": true }');
		const invalid = await handleSettingsTogglePost(
			post({expectedMtimeMs: mtimeMs, toggle: {kind: "skill", name: "x", enabled: false}}),
			claudeDir,
		);
		expect(invalid.status).toBe(422);
		expect(await invalid.json()).toStrictEqual({
			error: "settings.json does not match the settings schema",
		});
	});

	it("POST rejects cross-site requests", async () => {
		const mtimeMs = writeSettings(ORIGINAL);
		const response = await handleSettingsTogglePost(
			post(
				{
					expectedMtimeMs: mtimeMs,
					toggle: {kind: "plugin", id: "tools@market", enabled: false},
				},
				{Origin: "https://evil.example"},
			),
			claudeDir,
		);
		expect(response.status).toBe(403);
		expect(readSettings()).toBe(ORIGINAL);
	});
});
