import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { z } from "zod";
import type { SkillDetail, SkillSource, SkillSummary } from "../api/customize";
import { scanPluginTree } from "../plugins";
import { ClaudeSettingsSchema } from "../schemas";

type FrontmatterValue = string | string[] | Record<string, string>;

const BooleanStringSchema = z.enum(["true", "false"]);

const SkillFrontmatterSchema = z.strictObject({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  version: z.string().optional(),
  license: z.string().optional(),
  model: z.string().optional(),
  tools: z.string().optional(),
  "allowed-tools": z.union([z.string(), z.array(z.string())]).optional(),
  "argument-hint": z.string().optional(),
  "user-invocable": BooleanStringSchema.optional(),
  "disable-model-invocation": BooleanStringSchema.optional(),
  metadata: z.record(z.string(), z.string()).optional(),
});

const InstalledPluginsSchema = z.strictObject({
  version: z.number(),
  plugins: z.record(
    z.string(),
    z.array(
      z.strictObject({
        scope: z.enum(["user", "project", "local"]),
        installPath: z.string(),
        version: z.string(),
        installedAt: z.string(),
        lastUpdated: z.string(),
        gitCommitSha: z.string().optional(),
        projectPath: z.string().optional(),
      }),
    ),
  ),
});

function unquote(value: string): string {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    try {
      return z.string().parse(JSON.parse(value));
    } catch {
      return value.slice(1, -1);
    }
  }
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replaceAll("''", "'");
  }
  return value;
}

function foldLines(lines: readonly string[]): string {
  let out = "";
  for (const line of lines) {
    if (line === "") {
      out += "\n";
    } else if (out === "" || out.endsWith("\n")) {
      out += line;
    } else {
      out += ` ${line}`;
    }
  }
  return out;
}

function parseBlock(indicator: string, lines: readonly string[]): FrontmatterValue {
  const nonEmpty = lines.filter((line) => line.trim() !== "");
  const indent = Math.min(...nonEmpty.map((line) => line.length - line.trimStart().length));
  const dedented = lines.map((line) => line.slice(indent).trimEnd());

  if (indicator.startsWith("|")) return dedented.join("\n").replace(/\n+$/, "");
  if (indicator.startsWith(">")) return foldLines(dedented).replace(/\n+$/, "");

  const items = dedented.filter((line) => line !== "");
  if (items.every((line) => line.startsWith("- "))) {
    return items.map((line) => unquote(line.slice(2).trim()));
  }
  const map: Record<string, string> = {};
  for (const line of items) {
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    map[line.slice(0, colon).trim()] = unquote(line.slice(colon + 1).trim());
  }
  return map;
}

/**
 * Parses the YAML subset used by SKILL.md frontmatter: top-level scalars
 * (plain or quoted), `|` / `>` block scalars, and one level of indented list
 * or map. Returns null when the file has no complete `---` fenced block.
 */
export function parseSkillFrontmatter(content: string): Record<string, FrontmatterValue> | null {
  if (!content.startsWith("---")) return null;
  const end = content.indexOf("\n---", 3);
  if (end === -1) return null;

  const lines = content.slice(4, end).split("\n");
  const result: Record<string, FrontmatterValue> = {};
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    i++;
    const match = /^([A-Za-z0-9_-]+):(.*)$/.exec(line);
    if (match === null) continue;
    const key = match[1] ?? "";
    const rest = (match[2] ?? "").trim();

    const block: string[] = [];
    while (i < lines.length) {
      const next = lines[i] ?? "";
      if (next.trim() !== "" && !/^\s/.test(next)) break;
      block.push(next);
      i++;
    }
    while (block.length > 0 && (block[block.length - 1] ?? "").trim() === "") block.pop();

    if (block.length > 0 && (rest === "" || /^[|>][-+]?$/.test(rest))) {
      result[key] = parseBlock(rest, block);
    } else {
      result[key] = unquote(rest);
    }
  }
  return result;
}

interface ParsedSkill {
  name: string;
  description: string;
  dir: string;
  mtime: number;
}

async function readSkill(dir: string, dirName: string): Promise<ParsedSkill | null> {
  const skillFile = join(dir, "SKILL.md");
  let content: string;
  let mtime: number;
  try {
    const [text, stats] = await Promise.all([readFile(skillFile, "utf-8"), stat(skillFile)]);
    content = text;
    mtime = Math.trunc(stats.mtimeMs);
  } catch {
    return null;
  }

  const raw = parseSkillFrontmatter(content);
  const parsed = raw === null ? undefined : SkillFrontmatterSchema.safeParse(raw);
  const frontmatter = parsed?.success === true ? parsed.data : {};
  return {
    name: frontmatter.name ?? dirName,
    description: frontmatter.description ?? "",
    dir,
    mtime,
  };
}

async function scanSkillsDir(skillsDir: string): Promise<ParsedSkill[]> {
  let entries: string[];
  try {
    entries = await readdir(skillsDir);
  } catch {
    return [];
  }

  const skills: ParsedSkill[] = [];
  for (const entry of entries) {
    const dir = join(skillsDir, entry);
    try {
      if (!(await stat(dir)).isDirectory()) continue;
    } catch {
      continue;
    }
    const skill = await readSkill(dir, entry);
    if (skill !== null) skills.push(skill);
  }
  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

export async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf-8"));
  } catch {
    return undefined;
  }
}

async function readSkillOverrides(claudeDir: string): Promise<Record<string, string>> {
  const parsed = ClaudeSettingsSchema.safeParse(await readJson(join(claudeDir, "settings.json")));
  return parsed.success ? (parsed.data.skillOverrides ?? {}) : {};
}

export async function readInstalledPlugins(
  claudeDir: string,
): Promise<{ id: string; name: string; installPath: string }[]> {
  const parsed = InstalledPluginsSchema.safeParse(
    await readJson(join(claudeDir, "plugins", "installed_plugins.json")),
  );
  if (!parsed.success) return [];
  return Object.entries(parsed.data.plugins)
    .flatMap(([id, installs]) => {
      const install = installs[0];
      if (install === undefined) return [];
      const at = id.indexOf("@");
      return [{ id, name: at === -1 ? id : id.slice(0, at), installPath: install.installPath }];
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

export interface SkillProjectSource {
  id: string;
  projectPath: string;
}

export interface ListSkillsOptions {
  projects: readonly SkillProjectSource[];
  /** Defaults to ~/.claude. */
  claudeDir?: string;
}

/**
 * One inventory of every skill Claude Code can load: personal
 * (~/.claude/skills), project (<cwd>/.claude/skills) and installed-plugin
 * skills. `enabled` is false when settings.skillOverrides maps the skill's
 * invocation name (`name`, or `plugin:name` for plugin skills) to "off".
 */
export async function listSkills({
  projects,
  claudeDir = join(homedir(), ".claude"),
}: ListSkillsOptions): Promise<SkillSummary[]> {
  const overrides = await readSkillOverrides(claudeDir);

  const toSummary = (
    skill: ParsedSkill,
    source: SkillSource,
    idPrefix: string,
    sourceLabel: string,
    overrideKey: string,
  ): SkillSummary => ({
    id: `${idPrefix}${skill.name}`,
    name: skill.name,
    description: skill.description,
    source,
    sourceLabel,
    dir: skill.dir,
    mtime: skill.mtime,
    enabled: overrides[overrideKey] !== "off",
  });

  const result: SkillSummary[] = [];

  for (const skill of await scanSkillsDir(join(claudeDir, "skills"))) {
    result.push(toSummary(skill, "personal", "personal:", "Personal", skill.name));
  }

  for (const project of projects) {
    const label = basename(project.projectPath);
    for (const skill of await scanSkillsDir(join(project.projectPath, ".claude", "skills"))) {
      result.push(toSummary(skill, "project", `project:${project.id}:`, label, skill.name));
    }
  }

  for (const plugin of await readInstalledPlugins(claudeDir)) {
    for (const skill of await scanSkillsDir(join(plugin.installPath, "skills"))) {
      result.push(
        toSummary(
          skill,
          "plugin",
          `plugin:${plugin.id}:`,
          plugin.name,
          `${plugin.name}:${skill.name}`,
        ),
      );
    }
  }

  return result;
}

/**
 * SKILL.md `allowed-tools` is either a YAML list or one string separated by
 * commas and/or spaces; spaces inside `Bash(git add:*)` belong to the rule.
 */
export function splitAllowedTools(value: string | readonly string[] | undefined): string[] {
  if (value === undefined) return [];
  if (typeof value !== "string") return [...value];
  const tools: string[] = [];
  let current = "";
  let depth = 0;
  for (const char of value) {
    if (char === "(") depth++;
    if (char === ")") depth = Math.max(0, depth - 1);
    if (depth === 0 && (char === "," || /\s/.test(char))) {
      if (current !== "") tools.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  if (current !== "") tools.push(current);
  return tools;
}

/**
 * The detail view of one listed skill: SKILL.md invocation frontmatter plus
 * the skill directory tree (symlinks skipped, paths relative to the dir).
 */
export async function readSkillDetail(skill: SkillSummary): Promise<SkillDetail> {
  let content = "";
  try {
    content = await readFile(join(skill.dir, "SKILL.md"), "utf-8");
  } catch {
    // Listed a moment ago; treat a vanished SKILL.md as empty frontmatter.
  }
  const raw = parseSkillFrontmatter(content);
  const parsed = raw === null ? undefined : SkillFrontmatterSchema.safeParse(raw);
  const frontmatter = parsed?.success === true ? parsed.data : {};
  const tree = await scanPluginTree(skill.dir);

  const pluginPrefix = "plugin:";
  const pluginId =
    skill.source === "plugin" && skill.id.startsWith(pluginPrefix)
      ? skill.id.slice(pluginPrefix.length, skill.id.length - skill.name.length - 1)
      : undefined;

  return {
    skill,
    ...(pluginId === undefined ? {} : { pluginId }),
    userInvocable: frontmatter["user-invocable"] !== "false",
    modelInvocable: frontmatter["disable-model-invocation"] !== "true",
    allowedTools: splitAllowedTools(frontmatter["allowed-tools"]),
    ...(frontmatter["argument-hint"] === undefined
      ? {}
      : { argumentHint: frontmatter["argument-hint"] }),
    tree: tree?.children ?? [],
  };
}
