import { readFileSync } from "node:fs";
import { mkdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { isAbsolute, join, parse, relative, sep } from "node:path";
import { z } from "zod";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { listFileSearchProjectPathsFromDb } from "./db/queries";
import type * as schema from "./db/schema";
import { isGitRepository } from "./git-tracked";

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
export const AppConfigSchema = z
  .object({
    /** Directory basenames the file watcher never descends into. */
    ignored_dirs: z.array(z.string().trim().min(1)).min(1).optional(),
    /** Absolute directory paths whose image files may be served by the app. */
    image_roots: z.array(z.string()).optional(),
    /** Absolute directory paths whose text files are indexed for content search. */
    file_roots: z
      .array(z.string().trim().min(1).refine(isAbsolute, "File roots must be absolute paths"))
      .optional(),
    /** Permit ccp to send input and state updates to live Herdr panes. */
    herdr_writes_enabled: z.boolean().optional(),
    /** Use chokidar polling instead of the platform's recursive filesystem watcher. */
    watcher_polling: z.boolean().optional(),
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

/**
 * Application policy formerly exposed through `CCP_*` environment variables.
 *
 * `CCP_ENABLE_HERDR_WRITES`, `CCP_WATCHER_POLLING`, and
 * `CCP_WATCHER_IGNORED_DIRS` are intentionally no longer read. The persisted
 * application config is the sole authority, so a setting changed through the
 * UI cannot be silently overridden by the server process environment.
 */
const DEFAULT_APPLICATION_POLICY = {
  herdrWritesEnabled: false,
  watcherPolling: false,
} as const;

export const DEFAULT_IGNORED_DIR_NAMES = [
  ".git",
  "node_modules",
  "dist",
  "build",
  "out",
  "coverage",
  ".next",
  ".turbo",
  ".vite",
  ".cache",
  ".llm",
  ".venv",
  "target",
  ".in_use",
] as const;

export const ApplicationSettingsSchema = z
  .object({
    herdrWritesEnabled: z.boolean(),
    watcherPolling: z.boolean(),
    ignoredDirs: z.array(z.string().trim().min(1)).min(1),
  })
  .strict();

export type ApplicationSettings = z.infer<typeof ApplicationSettingsSchema>;

export function readApplicationSettings(configPath: string = getConfigPath()): ApplicationSettings {
  const config = readConfig(configPath);
  return {
    herdrWritesEnabled:
      config?.herdr_writes_enabled ?? DEFAULT_APPLICATION_POLICY.herdrWritesEnabled,
    watcherPolling: config?.watcher_polling ?? DEFAULT_APPLICATION_POLICY.watcherPolling,
    ignoredDirs: config?.ignored_dirs ?? [...DEFAULT_IGNORED_DIR_NAMES],
  };
}

export function herdrWritesEnabled(configPath: string = getConfigPath()): boolean {
  return readApplicationSettings(configPath).herdrWritesEnabled;
}

export function watcherPollingEnabled(configPath: string = getConfigPath()): boolean {
  return readApplicationSettings(configPath).watcherPolling;
}

/** Atomically replace a valid config while preserving all fields outside the patch. */
async function updateConfig(
  patch: Partial<AppConfig>,
  configPath: string = getConfigPath(),
): Promise<AppConfig> {
  const parsedPatch = AppConfigSchema.partial().parse(patch);
  const current = readConfig(configPath);
  if (current === null) {
    let existing = false;
    try {
      await stat(configPath);
      existing = true;
    } catch {
      // A missing config starts from an empty, valid document.
    }
    if (existing) {
      throw new Error("Cannot update an invalid application config");
    }
  }

  const next = AppConfigSchema.parse({ ...current, ...parsedPatch });
  const directory = parse(configPath).dir;
  const temporaryPath = join(directory, `.config-${crypto.randomUUID()}.tmp`);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  try {
    await writeFile(temporaryPath, `${JSON.stringify(next, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    await rename(temporaryPath, configPath);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
  return next;
}

export async function updateApplicationSettings(
  settings: ApplicationSettings,
  configPath: string = getConfigPath(),
): Promise<ApplicationSettings> {
  const parsed = ApplicationSettingsSchema.parse(settings);
  await updateConfig(
    {
      herdr_writes_enabled: parsed.herdrWritesEnabled,
      watcher_polling: parsed.watcherPolling,
      ignored_dirs: parsed.ignoredDirs,
    },
    configPath,
  );
  return readApplicationSettings(configPath);
}

function isContainedPath(path: string, root: string): boolean {
  const relativePath = relative(root, path);
  return (
    relativePath === "" ||
    (relativePath !== ".." && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath))
  );
}

export async function resolveDirectoryRoots(
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
  if (configuredRoots !== undefined) {
    return resolveDirectoryRoots(configuredRoots.filter(isGitRepository));
  }

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
    listFileSearchProjectPathsFromDb(indexDatabase).filter(isGitRepository),
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

  const explicitRoots = readConfig(configPath)?.file_roots;
  const configuredRoots = await resolveDirectoryRoots(
    explicitRoots === undefined ? defaultRoots : explicitRoots.filter(isGitRepository),
  );
  return configuredRoots.some((root) => isContainedPath(resolvedScope, root))
    ? resolvedScope
    : null;
}
