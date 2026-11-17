import {readdir, readFile} from "node:fs/promises";
import {basename, isAbsolute, join} from "node:path";

import type {OutputStyles} from "./output-style-options";
import {parseFrontmatter, readPluginName, readPluginRegistry} from "./plugins";
import {defaultClaudeDir, loadSettings, SETTINGS_RESPONSE_HEADERS, settingsPathIn} from "./settings-file";

/** The output styles the Claude Code CLI ships besides its default. */
const BUILT_IN_OUTPUT_STYLES = ["Explanatory", "Learning"];

function unquote(value: string): string
{
	return /^(["']).*\1$/.test(value) ? value.slice(1, -1) : value;
}

/** The style names in one `output-styles/` directory: frontmatter `name`, else the file's basename. */
async function readStyleNames(dir: string): Promise<string[]>
{
	let entries: string[];
	try
	{
		entries = await readdir(dir);
	}
	catch
	{
		return [];
	}
	const files = entries.filter((entry) => entry.endsWith(".md")).toSorted((a, b) => a.localeCompare(b));
	return Promise.all(
		files.map(async (file) =>
		{
			const {frontmatter} = parseFrontmatter(await readFile(join(dir, file), "utf-8"));
			const name = unquote(frontmatter["name"] ?? "");
			return name.length > 0 ? name : basename(file, ".md");
		}),
	);
}

export interface EnabledPlugin
{
	name: string;
	dir: string;
}

/**
 * Built-in styles, the customs in `<claudeDir>/output-styles/` and (for a session) `<projectDir>/.claude/output-styles/`
 * by plain name, and each plugin's `output-styles/` as `<plugin>:<style>`, the name the CLI registers plugin styles
 * under and looks settings.json `outputStyle` up by.
 */
export async function listOutputStyles(
	claudeDir: string,
	plugins: readonly EnabledPlugin[],
	projectDir?: string,
): Promise<OutputStyles>
{
	const groups = await Promise.all([
		readStyleNames(join(claudeDir, "output-styles")),
		projectDir === undefined ? [] : readStyleNames(join(projectDir, ".claude", "output-styles")),
		...plugins.map(async ({name, dir}) =>
			(await readStyleNames(join(dir, "output-styles"))).map((style) => `${name}:${style}`),
		),
	]);
	return {
		builtIns: BUILT_IN_OUTPUT_STYLES,
		customs: groups.flat(),
	};
}

/** Names and install paths of the plugins that settings.json `enabledPlugins` turns on. */
export async function enabledPlugins(claudeDir: string): Promise<EnabledPlugin[]>
{
	const registry = await readPluginRegistry(claudeDir);
	if (registry === null) return [];
	const loaded = await loadSettings(settingsPathIn(claudeDir));
	const enabled = loaded.kind === "loaded" ? (loaded.settings.enabledPlugins ?? {}) : {};
	const installs = Object.entries(registry.plugins).flatMap(([id, entries]) =>
	{
		const install = entries[0];
		return install !== undefined && enabled[id] === true
			? [
					{
						id,
						dir: install.installPath,
					},
				]
			: [];
	});
	return Promise.all(
		installs.map(async ({id, dir}) => (
		{
			name: await readPluginName(id, dir),
			dir,
		})),
	);
}

/** `?cwd=<abs>` adds that project's styles, as the CLI does for a session there. */
export async function handleOutputStylesGet(
	request: Request,
	claudeDir: string = defaultClaudeDir(),
): Promise<Response>
{
	const cwd = new URL(request.url).searchParams.get("cwd");
	const projectDir = cwd !== null && isAbsolute(cwd) ? cwd : undefined;
	const styles = await listOutputStyles(claudeDir, await enabledPlugins(claudeDir), projectDir);
	return Response.json(
		styles,
		{
			headers: SETTINGS_RESPONSE_HEADERS,
		},
	);
}
