import {type JSONPath} from "jsonc-parser";
import {
	type SettingsToggle,
	SettingsToggleRequestSchema,
	type SettingsToggleState,
	SettingsToggleStateSchema,
} from "../api/customize";
import {rejectCrossSite} from "../same-origin-guard";
import {SkillOverrideValueSchema} from "../skill-override-value";
import {
	defaultClaudeDir,
	editSettingsText,
	type LoadedSettings,
	loadSettings,
	type ParsedSettings,
	SETTINGS_RESPONSE_HEADERS as RESPONSE_HEADERS,
	settingsPathIn,
	writeSettingsAtomically,
} from "../settings-file";

export type SettingsToggleResult =
	| {ok: true; state: SettingsToggleState}
	| {ok: false; reason: "conflict"; state: SettingsToggleState}
	| {ok: false; reason: "invalid"; message: string};

function toState(loaded: LoadedSettings): SettingsToggleState {
	if (loaded.kind !== "loaded") {
		return {mtimeMs: null, skillOverrides: {}, enabledPlugins: {}};
	}
	return SettingsToggleStateSchema.parse({
		mtimeMs: loaded.mtimeMs,
		// A value from a newer Claude Code passes the lenient read; show it as no override.
		skillOverrides: Object.fromEntries(
			Object.entries(loaded.settings.skillOverrides ?? {}).filter(([, value]) =>
				SkillOverrideValueSchema.options.includes(value),
			),
		),
		enabledPlugins: loaded.settings.enabledPlugins ?? {},
	});
}

/** The skillOverrides / enabledPlugins maps and mtime of ~/.claude/settings.json. */
export async function readSettingsToggleState(claudeDir: string = defaultClaudeDir()): Promise<SettingsToggleState> {
	const loaded = await loadSettings(settingsPathIn(claudeDir));
	if (loaded.kind === "invalid") throw new Error(loaded.message);
	return toState(loaded);
}

function editFor(toggle: SettingsToggle, settings: ParsedSettings): {path: JSONPath; value: unknown} {
	if (toggle.kind === "plugin") {
		return {path: ["enabledPlugins", toggle.id], value: toggle.enabled};
	}
	if (!toggle.enabled) return {path: ["skillOverrides", toggle.name], value: "off"};
	const remaining = Object.keys(settings.skillOverrides ?? {}).filter((name) => name !== toggle.name);
	// Dropping the last override removes the map, so off → on restores the file byte-for-byte.
	return remaining.length === 0
		? {path: ["skillOverrides"], value: undefined}
		: {path: ["skillOverrides", toggle.name], value: undefined};
}

/**
 * The single guarded write path for the Customize enable switches: refuse
 * when settings.json changed since `expectedMtimeMs` was read, edit only the
 * one key (jsonc-parser keeps every other byte), re-validate the result with
 * the strict settings schema, then replace the file via temp + rename.
 */
export async function applySettingsToggle({
	claudeDir = defaultClaudeDir(),
	expectedMtimeMs,
	toggle,
}: {
	claudeDir?: string;
	expectedMtimeMs: number | null;
	toggle: SettingsToggle;
}): Promise<SettingsToggleResult> {
	const path = settingsPathIn(claudeDir);
	const loaded = await loadSettings(path);
	if (loaded.kind === "invalid") return {ok: false, reason: "invalid", message: loaded.message};

	const currentMtime = loaded.kind === "loaded" ? loaded.mtimeMs : null;
	if (currentMtime !== expectedMtimeMs) {
		return {ok: false, reason: "conflict", state: toState(loaded)};
	}

	const baseText = loaded.kind === "loaded" ? loaded.text : "{}\n";
	const settings = loaded.kind === "loaded" ? loaded.settings : {};
	const {path: jsonPath, value} = editFor(toggle, settings);
	const edited = editSettingsText(baseText, jsonPath, value);
	if (!edited.ok) return {ok: false, reason: "invalid", message: edited.message};

	await writeSettingsAtomically(path, claudeDir, edited.text);
	return {ok: true, state: toState(await loadSettings(path))};
}

export async function handleSettingsToggleGet(claudeDir?: string): Promise<Response> {
	const loaded = await loadSettings(settingsPathIn(claudeDir ?? defaultClaudeDir()));
	if (loaded.kind === "invalid") {
		return Response.json({error: loaded.message}, {status: 422, headers: RESPONSE_HEADERS});
	}
	return Response.json(toState(loaded), {headers: RESPONSE_HEADERS});
}

export async function handleSettingsTogglePost(request: Request, claudeDir?: string): Promise<Response> {
	const rejection = rejectCrossSite(request);
	if (rejection) return rejection;

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return Response.json({error: "Invalid JSON body"}, {status: 400});
	}
	const parsed = SettingsToggleRequestSchema.safeParse(body);
	if (!parsed.success) {
		return Response.json({error: "Invalid settings toggle"}, {status: 400});
	}

	const result = await applySettingsToggle({
		...(claudeDir === undefined ? {} : {claudeDir}),
		expectedMtimeMs: parsed.data.expectedMtimeMs,
		toggle: parsed.data.toggle,
	});
	if (result.ok) return Response.json(result.state, {headers: RESPONSE_HEADERS});
	if (result.reason === "conflict") {
		return Response.json(result.state, {status: 409, headers: RESPONSE_HEADERS});
	}
	return Response.json({error: result.message}, {status: 422, headers: RESPONSE_HEADERS});
}
