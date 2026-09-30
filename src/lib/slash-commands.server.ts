import {readdir, readFile} from "node:fs/promises";
import {homedir} from "node:os";
import {join} from "node:path";
import {listSkills, parseSkillFrontmatter, readInstalledPlugins, readSkillInvocation} from "./customize/skills";
import {BUILTIN_SLASH_COMMANDS, mergeSlashCommands, type SlashCommand, type SlashCommandSource} from "./slash-commands";

function frontmatterString(frontmatter: Record<string, unknown> | null, key: string): string | undefined {
	const value = frontmatter?.[key];
	return typeof value === "string" && value !== "" ? value : undefined;
}

/** The description line the CLI falls back to: the first non-blank body line. */
function firstBodyLine(content: string): string {
	const end = content.startsWith("---") ? content.indexOf("\n---", 3) : -1;
	const body = end === -1 ? content : content.slice(end + 4);
	const line = body.split("\n").find((l) => l.trim() !== "") ?? "";
	return line.replace(/^#+\s*/, "").trim();
}

/** `<dir>/*.md` command files, invoked as `/<prefix><basename>`. */
async function readCommandsDir(dir: string, source: SlashCommandSource, prefix = ""): Promise<SlashCommand[]> {
	let entries: string[];
	try {
		entries = await readdir(dir);
	} catch {
		return [];
	}
	const commands: SlashCommand[] = [];
	for (const entry of entries.filter((e) => e.endsWith(".md")).sort()) {
		let content: string;
		try {
			content = await readFile(join(dir, entry), "utf-8");
		} catch {
			continue;
		}
		const frontmatter = parseSkillFrontmatter(content);
		const argumentHint = frontmatterString(frontmatter, "argument-hint");
		commands.push({
			name: `${prefix}${entry.slice(0, -".md".length)}`,
			description: frontmatterString(frontmatter, "description") ?? firstBodyLine(content),
			source,
			...(argumentHint === undefined ? {} : {argumentHint}),
		});
	}
	return commands;
}

export interface ListSlashCommandsOptions {
	/** The session's working directory; project skills and commands come from here. */
	cwd: string | undefined;
	/** Defaults to ~/.claude. */
	claudeDir?: string;
}

/**
 * Everything the composer's "/" popup can offer, in CLI precedence order:
 * built-ins, then skills over commands (personal over project), then the
 * namespaced plugin skills and commands. The first entry for a name wins.
 */
export async function listSlashCommands({
	cwd,
	claudeDir = join(homedir(), ".claude"),
}: ListSlashCommandsOptions): Promise<SlashCommand[]> {
	const skills = await listSkills({
		projects: cwd === undefined ? [] : [{id: "cwd", projectPath: cwd}],
		claudeDir,
	});

	const skillCommands: Record<"personal" | "project" | "plugin", SlashCommand[]> = {
		personal: [],
		project: [],
		plugin: [],
	};
	for (const skill of skills) {
		if (!skill.enabled) continue;
		const {userInvocable, argumentHint} = await readSkillInvocation(skill.dir);
		if (!userInvocable) continue;
		skillCommands[skill.source].push({
			name: skill.source === "plugin" ? `${skill.sourceLabel}:${skill.name}` : skill.name,
			description: skill.description,
			source: `${skill.source}-skill`,
			...(argumentHint === undefined ? {} : {argumentHint}),
		});
	}

	const pluginCommands: SlashCommand[] = [];
	for (const plugin of await readInstalledPlugins(claudeDir)) {
		pluginCommands.push(
			...(await readCommandsDir(join(plugin.installPath, "commands"), "plugin-command", `${plugin.name}:`)),
		);
	}

	return mergeSlashCommands([
		BUILTIN_SLASH_COMMANDS,
		skillCommands.personal,
		skillCommands.project,
		await readCommandsDir(join(claudeDir, "commands"), "personal-command"),
		cwd === undefined ? [] : await readCommandsDir(join(cwd, ".claude", "commands"), "project-command"),
		skillCommands.plugin,
		pluginCommands,
	]);
}
