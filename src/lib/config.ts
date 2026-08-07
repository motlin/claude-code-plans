import { readFileSync } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { isAbsolute, join, parse, relative, sep } from "node:path";
import { z } from "zod";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { listFileSearchProjectPathsFromDb } from "./db/queries";
import type * as schema from "./db/schema";

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

async function resolveDirectoryRoots(
  roots: readonly string[],
  excludedResolvedRoots: ReadonlySet<string> = new Set(),
  overlapPreference: "widest" | "narrowest" = "widest",
): Promise<string[]> {
  const resolvedRoots: string[] = [];

  for (const root of roots) {
    let resolvedRoot: string;
    try {
      resolvedRoot = await realpath(root);
      if (!(await stat(resolvedRoot)).isDirectory()) continue;
    } catch {
      continue;
    }
    if (excludedResolvedRoots.has(resolvedRoot)) continue;
    if (
      resolvedRoots.some((root) =>
        overlapPreference === "widest"
          ? isContainedPath(resolvedRoot, root)
          : isContainedPath(root, resolvedRoot),
      )
    ) {
      continue;
    }

    // Keep roots non-overlapping so chokidar and the initial scan traverse
    // each file only once.
    for (let index = resolvedRoots.length - 1; index >= 0; index -= 1) {
      const existingRoot = resolvedRoots[index]!;
      const shouldReplace =
        overlapPreference === "widest"
          ? isContainedPath(existingRoot, resolvedRoot)
          : isContainedPath(resolvedRoot, existingRoot);
      if (shouldReplace) {
        resolvedRoots.splice(index, 1);
      }
    }
    resolvedRoots.push(resolvedRoot);
  }

  return resolvedRoots;
}

/** Resolve configured file roots to unique, existing, real directories. */
export async function resolveConfiguredFileRoots(
  configPath: string = getConfigPath(),
  defaultRoots: readonly string[] = [],
): Promise<string[]> {
  return resolveDirectoryRoots(readConfig(configPath)?.file_roots ?? defaultRoots);
}

/** Resolve explicit file roots, or indexed project paths when the setting is absent. */
export async function resolveFileSearchRoots(
  indexDatabase: BetterSQLite3Database<typeof schema>,
  configPath: string = getConfigPath(),
): Promise<string[]> {
  const configuredRoots = readConfig(configPath)?.file_roots;
  if (configuredRoots !== undefined) return resolveDirectoryRoots(configuredRoots);

  const resolvedHome = await realpath(homedir());
  const filesystemRoot = parse(resolvedHome).root;
  const broadRootCandidates = [
    resolvedHome,
    filesystemRoot,
    tmpdir(),
    join(filesystemRoot, "tmp"),
    join(filesystemRoot, "var", "tmp"),
  ];
  const broadRoots = new Set<string>();
  for (const candidate of broadRootCandidates) {
    try {
      broadRoots.add(await realpath(candidate));
    } catch {
      // A platform may not provide every conventional temporary directory.
    }
  }
  return resolveDirectoryRoots(
    listFileSearchProjectPathsFromDb(indexDatabase),
    broadRoots,
    "narrowest",
  );
}

/** Resolve a requested search directory and prove it remains inside a configured real root. */
export async function resolveFileSearchScope(
  scopeRoot: string,
  configPath: string = getConfigPath(),
  defaultRoots: readonly string[] = [],
): Promise<string | null> {
  let resolvedScope: string;
  try {
    resolvedScope = await realpath(scopeRoot);
    if (!(await stat(resolvedScope)).isDirectory()) return null;
  } catch {
    return null;
  }

  const configuredRoots = await resolveConfiguredFileRoots(configPath, defaultRoots);
  return configuredRoots.some((root) => isContainedPath(resolvedScope, root))
    ? resolvedScope
    : null;
}
