import {readdir, readFile} from "node:fs/promises";
import {basename, join} from "node:path";

import type {OutputStyles} from "./output-style-options";
import {parseFrontmatter, readPluginRegistry} from "./plugins";
import {defaultClaudeDir, loadSettings, SETTINGS_RESPONSE_HEADERS, settingsPathIn} from "./settings-file";

/** The output styles the Claude Code CLI ships besides its default. */
const BUILT_IN_OUTPUT_STYLES = ["Explanatory", "Learning"];

function unquote(value: string): string {
	return /^(["']).*\1$/.test(value) ? value.slice(1, -1) : value;
}

/** The style names in one `output-styles/` directory: frontmatter `name`, else the file's basename. */
async function readStyleNames(dir: string): Promise<string[]> {
	let entries: string[];
	try {
		entries = await readdir(dir);
	} catch {
		return [];
	}
	const files = entries.filter((entry) => entry.endsWith(".md")).toSorted((a, b) => a.localeCompare(b));
	return Promise.all(
		files.map(async (file) => {
			const {frontmatter} = parseFrontmatter(await readFile(join(dir, file), "utf-8"));
			const name = unquote(frontmatter["name"] ?? "");
			return name.length > 0 ? name : basename(file, ".md");
		}),
	);
}

/** Built-in styles plus the customs in `<claudeDir>/output-styles/` and each plugin's `output-styles/`. */
export async function listOutputStyles(claudeDir: string, pluginDirs: readonly string[]): Promise<OutputStyles> {
	const groups = await Promise.all(
		[claudeDir, ...pluginDirs].map(async (dir) => readStyleNames(join(dir, "output-styles"))),
	);
	return {builtIns: BUILT_IN_OUTPUT_STYLES, customs: groups.flat()};
}

/** Install paths of the plugins that settings.json `enabledPlugins` turns on. */
export async function enabledPluginDirs(claudeDir: string): Promise<string[]> {
	const registry = await readPluginRegistry(claudeDir);
	if (registry === null) return [];
	const loaded = await loadSettings(settingsPathIn(claudeDir));
	const enabled = loaded.kind === "loaded" ? (loaded.settings.enabledPlugins ?? {}) : {};
	return Object.entries(registry.plugins).flatMap(([id, installs]) => {
		const install = installs[0];
		return install !== undefined && enabled[id] === true ? [install.installPath] : [];
	});
}

export async function handleOutputStylesGet(claudeDir: string = defaultClaudeDir()): Promise<Response> {
	const styles = await listOutputStyles(claudeDir, await enabledPluginDirs(claudeDir));
	return Response.json(styles, {headers: SETTINGS_RESPONSE_HEADERS});
}
