import {mkdir, readFile, rename, rm, stat, writeFile} from "node:fs/promises";
import {homedir} from "node:os";
import {join} from "node:path";
import {applyEdits, type FormattingOptions, modify, type JSONPath} from "jsonc-parser";
import {ClaudeSettingsSchema} from "./runtime-schemas";
import {errnoCode} from "./narrow";

/** Shared guarded read / edit / atomic write of ~/.claude/settings.json. */

const SETTINGS_FILENAME = "settings.json";
export const SETTINGS_RESPONSE_HEADERS = {"Cache-Control": "private, max-age=0, must-revalidate"};
const INVALID_SETTINGS_JSON = "settings.json is not valid JSON";
const INVALID_SETTINGS_SCHEMA = "settings.json does not match the settings schema";

export type ParsedSettings = ReturnType<typeof ClaudeSettingsSchema.parse>;

export type LoadedSettings =
	| {kind: "missing"}
	| {kind: "invalid"; message: string}
	| {kind: "loaded"; text: string; mtimeMs: number; settings: ParsedSettings};

export function defaultClaudeDir(): string {
	return join(homedir(), ".claude");
}

export function settingsPathIn(claudeDir: string): string {
	return join(claudeDir, SETTINGS_FILENAME);
}

export async function loadSettings(path: string): Promise<LoadedSettings> {
	let text: string;
	let mtimeMs: number;
	try {
		mtimeMs = (await stat(path)).mtimeMs;
		text = await readFile(path, "utf-8");
	} catch (error) {
		if (errnoCode(error) === "ENOENT") return {kind: "missing"};
		throw error;
	}
	let json: unknown;
	try {
		json = JSON.parse(text);
	} catch {
		return {kind: "invalid", message: INVALID_SETTINGS_JSON};
	}
	const parsed = ClaudeSettingsSchema.safeParse(json);
	if (!parsed.success) return {kind: "invalid", message: INVALID_SETTINGS_SCHEMA};
	return {kind: "loaded", text, mtimeMs, settings: parsed.data};
}

/** Keep the file's own indentation and line endings for the edited region. */
function detectFormatting(text: string): FormattingOptions {
	const eol = text.includes("\r\n") ? "\r\n" : "\n";
	const indent = /\n([ \t]+)\S/.exec(text)?.[1] ?? "  ";
	const insertSpaces = !indent.startsWith("\t");
	return {insertSpaces, tabSize: insertSpaces ? indent.length : 1, eol};
}

/**
 * Edit one JSON path (undefined removes it) with jsonc-parser so every other
 * byte stays as it was, then re-validate the whole result with the settings
 * schema. Returns the new text, or an error message.
 */
export function editSettingsText(
	baseText: string,
	jsonPath: JSONPath,
	value: unknown,
): {ok: true; text: string} | {ok: false; message: string} {
	const text = applyEdits(
		baseText,
		modify(baseText, jsonPath, value, {formattingOptions: detectFormatting(baseText)}),
	);
	let json: unknown;
	try {
		json = JSON.parse(text);
	} catch {
		return {ok: false, message: INVALID_SETTINGS_JSON};
	}
	if (!ClaudeSettingsSchema.safeParse(json).success) return {ok: false, message: INVALID_SETTINGS_SCHEMA};
	return {ok: true, text};
}

/** Replace the file via a temp file in the same directory + rename. */
export async function writeSettingsAtomically(path: string, dir: string, text: string): Promise<void> {
	const temporaryPath = join(dir, `.settings-${crypto.randomUUID()}.tmp`);
	await mkdir(dir, {recursive: true});
	try {
		await writeFile(temporaryPath, text, {encoding: "utf-8", flag: "wx"});
		await rename(temporaryPath, path);
	} catch (error) {
		await rm(temporaryPath, {force: true});
		throw error;
	}
}
