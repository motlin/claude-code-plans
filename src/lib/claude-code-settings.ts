import {
	CLAUDE_CODE_SETTING_KEYS,
	type ClaudeCodeSettingKey,
	ClaudeCodeSettingPatchSchema,
	type ClaudeCodeSettingsState,
} from "./claude-code-settings-schema";
import {isRecord} from "./narrow";
import {ClaudeSettingsSchema} from "./runtime-schemas";
import {rejectCrossSite} from "./same-origin-guard";
import {
	defaultClaudeDir,
	editSettingsText,
	type LoadedSettings,
	loadSettings,
	SETTINGS_RESPONSE_HEADERS,
	settingsPathIn,
	writeSettingsAtomically,
} from "./settings-file";

type ClaudeCodeSettingValue = string | boolean;

export type ClaudeCodeSettingPatchResult =
	| {ok: true; state: ClaudeCodeSettingsState}
	| {ok: false; reason: "conflict"; state: ClaudeCodeSettingsState}
	| {ok: false; reason: "invalid"; message: string};

function keyPath(key: ClaudeCodeSettingKey): string[] {
	return key.split(".");
}

function nest(path: readonly string[], value: unknown): unknown {
	return path.reduceRight<unknown>((inner, segment) => ({[segment]: inner}), value);
}

function pick(source: unknown, path: readonly string[]): unknown {
	let current = source;
	for (const segment of path) {
		if (!isRecord(current) || !Object.hasOwn(current, segment)) return undefined;
		current = current[segment];
	}
	return current;
}

/** Check a value against the settings schema at the key's own path. */
function isValidValue(key: ClaudeCodeSettingKey, value: unknown): value is ClaudeCodeSettingValue {
	if (typeof value !== "string" && typeof value !== "boolean") return false;
	const parsed = ClaudeSettingsSchema.safeParse(nest(keyPath(key), value));
	return parsed.success && pick(parsed.data, keyPath(key)) === value;
}

function toState(loaded: LoadedSettings): ClaudeCodeSettingsState {
	if (loaded.kind !== "loaded") return {mtimeMs: null, values: {}};
	const values: ClaudeCodeSettingsState["values"] = {};
	for (const key of CLAUDE_CODE_SETTING_KEYS) {
		const value = pick(loaded.settings, keyPath(key));
		if (isValidValue(key, value)) values[key] = value;
	}
	const state: ClaudeCodeSettingsState = {mtimeMs: loaded.mtimeMs, values};
	if (pick(loaded.settings, ["permissions", "disableBypassPermissionsMode"]) === "disable") {
		state.bypassPermissionsModeDisabled = true;
	}
	return state;
}

/** The allow-listed values and mtime of settings.json. */
export async function readClaudeCodeSettings(claudeDir: string = defaultClaudeDir()): Promise<ClaudeCodeSettingsState> {
	const loaded = await loadSettings(settingsPathIn(claudeDir));
	if (loaded.kind === "invalid") throw new Error(loaded.message);
	return toState(loaded);
}

/**
 * Set (or, for undefined, delete) one allow-listed scalar key. Refuses when
 * the file changed since `expectedMtimeMs` was read, edits only that key so
 * the rest of the file keeps its bytes, re-validates the result, and replaces
 * the file atomically.
 */
export async function patchClaudeCodeSetting(
	claudeDir: string,
	{key, value, expectedMtimeMs}: {key: ClaudeCodeSettingKey; value: unknown; expectedMtimeMs: number | null},
): Promise<ClaudeCodeSettingPatchResult> {
	if (value !== undefined && !isValidValue(key, value)) {
		return {ok: false, reason: "invalid", message: `Invalid value for ${key}`};
	}
	const path = settingsPathIn(claudeDir);
	const loaded = await loadSettings(path);
	if (loaded.kind === "invalid") return {ok: false, reason: "invalid", message: loaded.message};

	const currentMtime = loaded.kind === "loaded" ? loaded.mtimeMs : null;
	if (currentMtime !== expectedMtimeMs) return {ok: false, reason: "conflict", state: toState(loaded)};

	const baseText = loaded.kind === "loaded" ? loaded.text : "{}\n";
	const edited = editSettingsText(baseText, keyPath(key), value);
	if (!edited.ok) return {ok: false, reason: "invalid", message: edited.message};

	await writeSettingsAtomically(path, claudeDir, edited.text);
	return {ok: true, state: toState(await loadSettings(path))};
}

export async function handleClaudeCodeSettingsGet(claudeDir: string = defaultClaudeDir()): Promise<Response> {
	const loaded = await loadSettings(settingsPathIn(claudeDir));
	if (loaded.kind === "invalid") {
		return Response.json({error: loaded.message}, {status: 422, headers: SETTINGS_RESPONSE_HEADERS});
	}
	return Response.json(toState(loaded), {headers: SETTINGS_RESPONSE_HEADERS});
}

export async function handleClaudeCodeSettingsPost(
	request: Request,
	claudeDir: string = defaultClaudeDir(),
): Promise<Response> {
	const rejection = rejectCrossSite(request);
	if (rejection) return rejection;

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return Response.json({error: "Invalid JSON body"}, {status: 400});
	}
	const parsed = ClaudeCodeSettingPatchSchema.safeParse(body);
	if (!parsed.success) return Response.json({error: "Invalid Claude Code setting"}, {status: 400});
	const {key, value, expectedMtimeMs} = parsed.data;
	if (value !== undefined && !isValidValue(key, value)) {
		return Response.json({error: `Invalid value for ${key}`}, {status: 400});
	}

	const result = await patchClaudeCodeSetting(claudeDir, {key, value, expectedMtimeMs});
	if (result.ok) return Response.json(result.state, {headers: SETTINGS_RESPONSE_HEADERS});
	if (result.reason === "conflict") {
		return Response.json(result.state, {status: 409, headers: SETTINGS_RESPONSE_HEADERS});
	}
	return Response.json({error: result.message}, {status: 422, headers: SETTINGS_RESPONSE_HEADERS});
}
