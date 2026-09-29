import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { applyEdits, type FormattingOptions, modify, type JSONPath } from "jsonc-parser";
import {
  type SettingsToggle,
  SettingsToggleRequestSchema,
  type SettingsToggleState,
  SettingsToggleStateSchema,
} from "../api/customize";
import { rejectCrossSite } from "../same-origin-guard";
import { ClaudeSettingsSchema } from "../schemas";

const SETTINGS_FILENAME = "settings.json";
const RESPONSE_HEADERS = { "Cache-Control": "private, max-age=0, must-revalidate" };

const INVALID_JSON = "settings.json is not valid JSON";
const INVALID_SCHEMA = "settings.json does not match the settings schema";

type LoadedSettings =
  | { kind: "missing" }
  | { kind: "invalid"; message: string }
  | {
      kind: "loaded";
      text: string;
      mtimeMs: number;
      settings: ReturnType<typeof ClaudeSettingsSchema.parse>;
    };

export type SettingsToggleResult =
  | { ok: true; state: SettingsToggleState }
  | { ok: false; reason: "conflict"; state: SettingsToggleState }
  | { ok: false; reason: "invalid"; message: string };

function defaultClaudeDir(): string {
  return join(homedir(), ".claude");
}

async function loadSettings(path: string): Promise<LoadedSettings> {
  let text: string;
  let mtimeMs: number;
  try {
    mtimeMs = (await stat(path)).mtimeMs;
    text = await readFile(path, "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { kind: "missing" };
    throw error;
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { kind: "invalid", message: INVALID_JSON };
  }
  const parsed = ClaudeSettingsSchema.safeParse(json);
  if (!parsed.success) return { kind: "invalid", message: INVALID_SCHEMA };
  return { kind: "loaded", text, mtimeMs, settings: parsed.data };
}

function toState(loaded: LoadedSettings): SettingsToggleState {
  if (loaded.kind !== "loaded") {
    return { mtimeMs: null, skillOverrides: {}, enabledPlugins: {} };
  }
  return SettingsToggleStateSchema.parse({
    mtimeMs: loaded.mtimeMs,
    skillOverrides: loaded.settings.skillOverrides ?? {},
    enabledPlugins: loaded.settings.enabledPlugins ?? {},
  });
}

/** The skillOverrides / enabledPlugins maps and mtime of ~/.claude/settings.json. */
export async function readSettingsToggleState(
  claudeDir: string = defaultClaudeDir(),
): Promise<SettingsToggleState> {
  const loaded = await loadSettings(join(claudeDir, SETTINGS_FILENAME));
  if (loaded.kind === "invalid") throw new Error(loaded.message);
  return toState(loaded);
}

/** Keep the file's own indentation and line endings for the edited region. */
function detectFormatting(text: string): FormattingOptions {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const indent = /\n([ \t]+)\S/.exec(text)?.[1] ?? "  ";
  const insertSpaces = !indent.startsWith("\t");
  return { insertSpaces, tabSize: insertSpaces ? indent.length : 1, eol };
}

function editFor(
  toggle: SettingsToggle,
  settings: ReturnType<typeof ClaudeSettingsSchema.parse>,
): { path: JSONPath; value: unknown } {
  if (toggle.kind === "plugin") {
    return { path: ["enabledPlugins", toggle.id], value: toggle.enabled };
  }
  if (!toggle.enabled) return { path: ["skillOverrides", toggle.name], value: "off" };
  const remaining = Object.keys(settings.skillOverrides ?? {}).filter(
    (name) => name !== toggle.name,
  );
  // Dropping the last override removes the map, so off → on restores the file byte-for-byte.
  return remaining.length === 0
    ? { path: ["skillOverrides"], value: undefined }
    : { path: ["skillOverrides", toggle.name], value: undefined };
}

async function writeAtomically(path: string, dir: string, text: string): Promise<void> {
  const temporaryPath = join(dir, `.settings-${crypto.randomUUID()}.tmp`);
  await mkdir(dir, { recursive: true });
  try {
    await writeFile(temporaryPath, text, { encoding: "utf-8", flag: "wx" });
    await rename(temporaryPath, path);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
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
  const path = join(claudeDir, SETTINGS_FILENAME);
  const loaded = await loadSettings(path);
  if (loaded.kind === "invalid") return { ok: false, reason: "invalid", message: loaded.message };

  const currentMtime = loaded.kind === "loaded" ? loaded.mtimeMs : null;
  if (currentMtime !== expectedMtimeMs) {
    return { ok: false, reason: "conflict", state: toState(loaded) };
  }

  const baseText = loaded.kind === "loaded" ? loaded.text : "{}\n";
  const settings = loaded.kind === "loaded" ? loaded.settings : {};
  const { path: jsonPath, value } = editFor(toggle, settings);
  const nextText = applyEdits(
    baseText,
    modify(baseText, jsonPath, value, { formattingOptions: detectFormatting(baseText) }),
  );

  let nextJson: unknown;
  try {
    nextJson = JSON.parse(nextText);
  } catch {
    return { ok: false, reason: "invalid", message: INVALID_JSON };
  }
  if (!ClaudeSettingsSchema.safeParse(nextJson).success) {
    return { ok: false, reason: "invalid", message: INVALID_SCHEMA };
  }

  await writeAtomically(path, claudeDir, nextText);
  return { ok: true, state: toState(await loadSettings(path)) };
}

export async function handleSettingsToggleGet(claudeDir?: string): Promise<Response> {
  const loaded = await loadSettings(join(claudeDir ?? defaultClaudeDir(), SETTINGS_FILENAME));
  if (loaded.kind === "invalid") {
    return Response.json({ error: loaded.message }, { status: 422, headers: RESPONSE_HEADERS });
  }
  return Response.json(toState(loaded), { headers: RESPONSE_HEADERS });
}

export async function handleSettingsTogglePost(
  request: Request,
  claudeDir?: string,
): Promise<Response> {
  const rejection = rejectCrossSite(request);
  if (rejection) return rejection;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = SettingsToggleRequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Invalid settings toggle" }, { status: 400 });
  }

  const result = await applySettingsToggle({
    ...(claudeDir === undefined ? {} : { claudeDir }),
    expectedMtimeMs: parsed.data.expectedMtimeMs,
    toggle: parsed.data.toggle,
  });
  if (result.ok) return Response.json(result.state, { headers: RESPONSE_HEADERS });
  if (result.reason === "conflict") {
    return Response.json(result.state, { status: 409, headers: RESPONSE_HEADERS });
  }
  return Response.json({ error: result.message }, { status: 422, headers: RESPONSE_HEADERS });
}
