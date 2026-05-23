import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

/**
 * Directory holding this application's own configuration. Follows the XDG
 * Base Directory spec: `$XDG_CONFIG_HOME/claude-code-plans`, falling back to
 * `~/.config/claude-code-plans`. This is *our* config — distinct from
 * `~/.claude/`, which belongs to Claude Code itself and must not be written
 * to or extended by this app.
 */
function getConfigDir(): string {
  const xdg = process.env["XDG_CONFIG_HOME"];
  const base = xdg || join(homedir(), ".config");
  return join(base, "claude-code-plans");
}

/** Path to this application's config file. */
export function getConfigPath(): string {
  return join(getConfigDir(), "config.json");
}

/**
 * Strict schema for `config.json`. Unknown keys and malformed values are
 * rejected outright rather than coerced — callers fall back to defaults when
 * the whole file fails to validate. New settings must be added here.
 */
const AppConfigSchema = z
  .object({
    /** Directory basenames the file watcher never descends into. */
    ignored_dirs: z.array(z.string().trim().min(1)).optional(),
  })
  .strict();

export type AppConfig = z.infer<typeof AppConfigSchema>;

/**
 * Read and strictly validate this app's config file. Returns `null` when the
 * file is missing, unreadable, not valid JSON, or fails schema validation —
 * callers treat every one of those cases as "no config, use defaults".
 */
export function readConfig(configPath: string = getConfigPath()): AppConfig | null {
  let raw: string;
  try {
    raw = readFileSync(configPath, "utf8");
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const result = AppConfigSchema.safeParse(parsed);
  return result.success ? result.data : null;
}
