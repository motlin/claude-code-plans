import {readFileSync} from "node:fs";
import {mkdir, realpath, rename, rm, stat, writeFile} from "node:fs/promises";
import {homedir, tmpdir} from "node:os";
import {isAbsolute, join, parse, relative, sep} from "node:path";
import {z} from "zod";
import type {BetterSQLite3Database} from "drizzle-orm/better-sqlite3";
import {listFileSearchProjectPathsFromDb} from "./db/queries";
import type * as schema from "./db/schema";
import {isGitRepository} from "./git-tracked";
import {migrateLegacyNavFlags, renameLegacyNavSections, VisibleNavSectionsSchema} from "./nav-sections";
import {defined} from "./defined";
import {nonEmpty} from "./non-empty";
import {DEFAULT_TERMINAL_HOST_SETTING, TerminalHostSettingSchema} from "./terminal-host-setting";
import {AutoArchiveDaysSchema, DEFAULT_AUTO_ARCHIVE_DAYS} from "./auto-archive-options";

/**
 * Directory holding this application's own configuration. Follows the XDG
 * Base Directory spec: `$XDG_CONFIG_HOME/claude-code-plans`, falling back to
 * `~/.config/claude-code-plans`. This is *our* config — distinct from
 * `~/.claude/`, which belongs to Claude Code itself and must not be written
 * to or extended by this app.
 */
function getConfigDir(): string {
	const xdg = process.env["XDG_CONFIG_HOME"];
	const base = nonEmpty(xdg) ?? join(homedir(), ".config");
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
const AppConfigObjectSchema = z
	.object({
		/** Directory basenames the file watcher never descends into. */
		ignored_dirs: z.array(z.string().trim().min(1)).min(1).optional(),
		/** Absolute directory paths whose image files may be served by the app. */
		image_roots: z.array(z.string()).optional(),
		/** Absolute directory paths whose text files are indexed for content search. */
		file_roots: z
			.array(z.string().trim().min(1).refine(isAbsolute, "File roots must be absolute paths"))
			.optional(),
		/** Live terminal input: permit ccp to send input and state updates to live terminal panes. */
		terminal_writes_enabled: z.boolean().optional(),
		/** Retired by `terminal_writes_enabled`; read only to migrate, dropped on the next save. */
		herdr_writes_enabled: z.boolean().optional(),
		/** Terminal multiplexer driven for live sessions: auto, herdr or tmux. */
		terminal_host: TerminalHostSettingSchema.optional(),
		/** Offer Shell tabs (login `$SHELL` PTYs in the session folder) in the Terminal pane. */
		shell_pane_enabled: z.boolean().optional(),
		/** Sidebar sections pinned outside the More ▸ menu, in nav order. */
		visible_nav_sections: z.preprocess(renameLegacyNavSections, VisibleNavSectionsSchema).optional(),
		/** Retired by `visible_nav_sections`; read only to migrate, dropped on the next save. */
		show_herdr_section: z.boolean().optional(),
		/** Retired by `visible_nav_sections`; read only to migrate, dropped on the next save. */
		show_tmux_section: z.boolean().optional(),
		/** Archive inactive sessions: days without JSONL activity before the sweeper archives a session; 0 is Never. */
		auto_archive_inactive_days: AutoArchiveDaysSchema.optional(),
	})
	.strict();

function stripLegacyWatcherPolling(value: unknown): unknown {
	if (
		typeof value !== "object" ||
		value === null ||
		Array.isArray(value) ||
		!("watcher_polling" in value) ||
		typeof value.watcher_polling !== "boolean"
	) {
		return value;
	}

	return Object.fromEntries(Object.entries(value).filter(([key]) => key !== "watcher_polling"));
}

export const AppConfigSchema = z.preprocess(stripLegacyWatcherPolling, AppConfigObjectSchema);
const AppConfigPatchSchema = AppConfigObjectSchema.partial();

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
 * `CCP_ENABLE_HERDR_WRITES` and `CCP_WATCHER_IGNORED_DIRS` are intentionally
 * no longer read. The persisted application config is the sole authority, so
 * a setting changed through the UI cannot be silently overridden by the
 * server process environment.
 */
const DEFAULT_APPLICATION_POLICY = {
	terminalWritesEnabled: false,
	shellPaneEnabled: true,
} as const;

export const DEFAULT_IGNORED_DIR_NAMES = [
	".cache",
	".git",
	".in_use",
	".llm",
	".next",
	".turbo",
	".venv",
	".vite",
	"build",
	"coverage",
	"dist",
	"node_modules",
	"out",
	"target",
] as const;

export const ApplicationSettingsSchema = z
	.object({
		terminalWritesEnabled: z.boolean(),
		terminalHost: TerminalHostSettingSchema,
		shellPaneEnabled: z.boolean(),
		visibleNavSections: VisibleNavSectionsSchema,
		ignoredDirs: z.array(z.string().trim().min(1)).min(1),
	})
	.strict();

export type ApplicationSettings = z.infer<typeof ApplicationSettingsSchema>;

export function readApplicationSettings(configPath: string = getConfigPath()): ApplicationSettings {
	const config = readConfig(configPath);
	return {
		terminalWritesEnabled:
			config?.terminal_writes_enabled ??
			config?.herdr_writes_enabled ??
			DEFAULT_APPLICATION_POLICY.terminalWritesEnabled,
		terminalHost: config?.terminal_host ?? DEFAULT_TERMINAL_HOST_SETTING,
		shellPaneEnabled: config?.shell_pane_enabled ?? DEFAULT_APPLICATION_POLICY.shellPaneEnabled,
		visibleNavSections:
			config?.visible_nav_sections ??
			migrateLegacyNavFlags({
				showHerdrSection: config?.show_herdr_section,
				showTmuxSection: config?.show_tmux_section,
			}),
		ignoredDirs: config?.ignored_dirs ?? [...DEFAULT_IGNORED_DIR_NAMES],
	};
}

/** The Live terminal input setting: whether ccp may type into and report state to live panes. */
export function terminalWritesEnabled(configPath: string = getConfigPath()): boolean {
	return readApplicationSettings(configPath).terminalWritesEnabled;
}

export function terminalHostSetting(configPath: string = getConfigPath()): ApplicationSettings["terminalHost"] {
	return readApplicationSettings(configPath).terminalHost;
}

export function shellPaneEnabled(configPath: string = getConfigPath()): boolean {
	return readApplicationSettings(configPath).shellPaneEnabled;
}

/** Atomically replace a valid config while preserving all fields outside the patch. */
async function updateConfig(patch: Partial<AppConfig>, configPath: string = getConfigPath()): Promise<AppConfig> {
	const parsedPatch = AppConfigPatchSchema.parse(patch);
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

	const next = AppConfigSchema.parse({...current, ...parsedPatch});
	const directory = parse(configPath).dir;
	const temporaryPath = join(directory, `.config-${crypto.randomUUID()}.tmp`);
	await mkdir(directory, {recursive: true, mode: 0o700});
	try {
		await writeFile(temporaryPath, `${JSON.stringify(next, null, 2)}\n`, {
			encoding: "utf8",
			mode: 0o600,
			flag: "wx",
		});
		await rename(temporaryPath, configPath);
	} catch (error) {
		await rm(temporaryPath, {force: true});
		throw error;
	}
	return next;
}

export async function updateApplicationSettings(
	settings: ApplicationSettings,
	configPath: string = getConfigPath(),
): Promise<ApplicationSettings> {
	const parsed = ApplicationSettingsSchema.parse(settings);
	const ignoredDirs = parsed.ignoredDirs.toSorted();
	await updateConfig(
		{
			terminal_writes_enabled: parsed.terminalWritesEnabled,
			herdr_writes_enabled: undefined,
			terminal_host: parsed.terminalHost,
			shell_pane_enabled: parsed.shellPaneEnabled,
			visible_nav_sections: parsed.visibleNavSections,
			show_herdr_section: undefined,
			show_tmux_section: undefined,
			ignored_dirs: ignoredDirs,
		},
		configPath,
	);
	return readApplicationSettings(configPath);
}

/** The Archive inactive sessions setting in days; Never (0) unless a valid config sets it. */
export function readAutoArchiveInactiveDays(configPath: string = getConfigPath()): number {
	return readConfig(configPath)?.auto_archive_inactive_days ?? DEFAULT_AUTO_ARCHIVE_DAYS;
}

export async function updateAutoArchiveInactiveDays(
	days: number,
	configPath: string = getConfigPath(),
): Promise<number> {
	await updateConfig({auto_archive_inactive_days: AutoArchiveDaysSchema.parse(days)}, configPath);
	return readAutoArchiveInactiveDays(configPath);
}

function isContainedPath(path: string, root: string): boolean {
	const relativePath = relative(root, path);
	return (
		relativePath === "" ||
		(relativePath !== ".." && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath))
	);
}

async function resolveRealDirectory(root: string): Promise<string | null> {
	try {
		const resolvedRoot = await realpath(root);
		return (await stat(resolvedRoot)).isDirectory() ? resolvedRoot : null;
	} catch {
		return null;
	}
}

export async function resolveDirectoryRoots(
	roots: readonly string[],
	excludedResolvedRoots: ReadonlySet<string> = new Set(),
	overlapPreference: "widest" | "narrowest" = "widest",
): Promise<string[]> {
	// Resolve every root concurrently: awaiting them one by one queued each
	// filesystem call behind the rest of the server's work in turn.
	const realRoots = await Promise.all(roots.map(resolveRealDirectory));
	const resolvedRoots: string[] = [];

	for (const resolvedRoot of realRoots) {
		if (resolvedRoot === null) continue;
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
			const existingRoot = defined(resolvedRoots[index], "index counts down within resolvedRoots");
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
	return resolveFileRootsCached(readConfig(configPath)?.file_roots ?? defaultRoots);
}

/** Resolve explicit file roots, or indexed project paths when the setting is absent. */
export async function resolveFileSearchRoots(
	indexDatabase: BetterSQLite3Database<typeof schema>,
	configPath: string = getConfigPath(),
): Promise<string[]> {
	const configuredRoots = readConfig(configPath)?.file_roots;
	if (configuredRoots !== undefined) {
		return resolveFileRootsCached(configuredRoots.filter(isGitRepository));
	}

	return resolveFileRootsCached(listFileSearchProjectPathsFromDb(indexDatabase).filter(isGitRepository), "inferred");
}

/** Real paths of the home, filesystem root and temporary directories, which are never inferred as roots. */
async function resolveBroadRoots(): Promise<Set<string>> {
	const resolvedHome = await realpath(homedir());
	const filesystemRoot = parse(resolvedHome).root;
	const broadRootCandidates = [
		resolvedHome,
		filesystemRoot,
		tmpdir(),
		join(filesystemRoot, "tmp"),
		join(filesystemRoot, "var", "tmp"),
	];
	const resolvedCandidates = await Promise.all(
		// A platform may not provide every conventional temporary directory.
		broadRootCandidates.map(async (candidate) => realpath(candidate).catch(() => null)),
	);
	return new Set(resolvedCandidates.filter((candidate) => candidate !== null));
}

/**
 * How long a file-root resolution is reused. A resolution costs a realpath
 * and a stat per indexed project, and every await queues behind whatever else
 * the server is doing; done per request (twice, once per layer), one file read
 * took seconds under indexing load. A different root list (projects or config changed) always
 * resolves afresh; the TTL only bounds how long a root that vanished or lost
 * its `.git` stays listed. Per-file realpath containment checks still run on
 * every request.
 */
export const FILE_ROOTS_CACHE_TTL_MILLISECONDS = 10_000;

const fileRootsCache = new Map<string, {expiresAt: number; roots: Promise<string[]>}>();

export function clearFileRootsCache(): void {
	fileRootsCache.clear();
}

/**
 * `resolveDirectoryRoots` memoized per exact input. "explicit" keeps the
 * widest roots as configured; "inferred" drops broad roots and keeps the
 * narrowest repositories.
 */
async function resolveFileRootsCached(
	roots: readonly string[],
	mode: "explicit" | "inferred" = "explicit",
): Promise<string[]> {
	const now = Date.now();
	for (const [key, entry] of fileRootsCache) {
		if (entry.expiresAt <= now) fileRootsCache.delete(key);
	}
	const key = JSON.stringify([mode, roots]);
	const cached = fileRootsCache.get(key);
	// Copies, so no caller can edit the shared result. Microtask hops only; no I/O.
	if (cached !== undefined) return cached.roots.then((resolvedRoots) => [...resolvedRoots]);

	const resolved =
		mode === "explicit"
			? resolveDirectoryRoots(roots)
			: resolveBroadRoots().then(async (broadRoots) => resolveDirectoryRoots(roots, broadRoots, "narrowest"));
	fileRootsCache.set(key, {expiresAt: now + FILE_ROOTS_CACHE_TTL_MILLISECONDS, roots: resolved});
	resolved.catch(() => fileRootsCache.delete(key));
	return resolved.then((resolvedRoots) => [...resolvedRoots]);
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
	const configuredRoots = await resolveFileRootsCached(
		explicitRoots === undefined ? defaultRoots : explicitRoots.filter(isGitRepository),
	);
	return configuredRoots.some((root) => isContainedPath(resolvedScope, root)) ? resolvedScope : null;
}
