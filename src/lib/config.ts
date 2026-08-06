import { readFileSync } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, relative, sep } from "node:path";
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
    /** Absolute directory paths whose image files may be served by the app. */
    image_roots: z.array(z.string()).optional(),
    /** Absolute directory paths whose text files are indexed for content search. */
    file_roots: z
      .array(z.string().trim().min(1).refine(isAbsolute, "File roots must be absolute paths"))
      .optional(),
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

function isContainedPath(path: string, root: string): boolean {
  const relativePath = relative(root, path);
  return (
    relativePath === "" ||
    (relativePath !== ".." && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath))
  );
}

/** Resolve configured file roots to unique, existing, real directories. */
export async function resolveConfiguredFileRoots(
  configPath: string = getConfigPath(),
): Promise<string[]> {
  const configuredRoots = readConfig(configPath)?.file_roots ?? [];
  const resolvedRoots: string[] = [];

  for (const configuredRoot of configuredRoots) {
    let resolvedRoot: string;
    try {
      resolvedRoot = await realpath(configuredRoot);
      if (!(await stat(resolvedRoot)).isDirectory()) continue;
    } catch {
      continue;
    }
    if (resolvedRoots.some((root) => isContainedPath(resolvedRoot, root))) continue;

    // Prefer the widest explicitly configured root when roots overlap, so
    // chokidar and the initial scan traverse each file only once.
    for (let index = resolvedRoots.length - 1; index >= 0; index -= 1) {
      if (isContainedPath(resolvedRoots[index]!, resolvedRoot)) {
        resolvedRoots.splice(index, 1);
      }
    }
    resolvedRoots.push(resolvedRoot);
  }

  return resolvedRoots;
}
