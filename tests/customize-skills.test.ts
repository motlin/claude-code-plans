import { mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { SkillListResponse } from "../src/lib/api/customize";
import { listSkills, parseSkillFrontmatter, readSkillDetail } from "../src/lib/customize/skills";

let root: string;
let claudeDir: string;
let projectPath: string;
let pluginPath: string;

const MTIME = new Date("2026-09-15T12:00:00.000Z");

function writeSkill(dir: string, content: string): void {
  const file = join(dir, "SKILL.md");
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
  utimesSync(file, MTIME, MTIME);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "customize-skills-"));
  claudeDir = join(root, "claude");
  projectPath = join(root, "repos", "my-app");
  pluginPath = join(root, "plugin-cache", "tools", "1.0.0");
  mkdirSync(claudeDir, { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("parseSkillFrontmatter", () => {
  it("parses block scalars, quoted values, lists and maps", () => {
    const content = [
      "---",
      "name: alpha",
      "description: >-",
      "  Folded text that",
      "  spans two lines.",
      'argument-hint: "What next?"',
      "user-invocable: true",
      "allowed-tools:",
      "  - Read",
      "  - Bash(ls *)",
      "metadata:",
      "    author: github",
      "    version: 0.1.0",
      "notes: |",
      "  line one",
      "  line two",
      "quoted: 'it''s'",
      "---",
      "",
      "# Body",
    ].join("\n");

    expect(parseSkillFrontmatter(content)).toStrictEqual({
      name: "alpha",
      description: "Folded text that spans two lines.",
      "argument-hint": "What next?",
      "user-invocable": "true",
      "allowed-tools": ["Read", "Bash(ls *)"],
      metadata: { author: "github", version: "0.1.0" },
      notes: "line one\nline two",
      quoted: "it's",
    });
  });

  it("returns null without an opening or closing delimiter", () => {
    expect(parseSkillFrontmatter("# Just markdown")).toBeNull();
    expect(parseSkillFrontmatter("---\nname: broken\nno close")).toBeNull();
  });
});

describe("listSkills", () => {
  it("lists personal, project and plugin skills with overrides applied", async () => {
    writeSkill(
      join(claudeDir, "skills", "alpha"),
      [
        "---",
        "name: alpha",
        "description: |",
        "  First line.",
        "  Second line.",
        "allowed-tools:",
        "  - Read",
        "metadata:",
        "  author: someone",
        "---",
        "Body",
      ].join("\n"),
    );
    writeSkill(
      join(claudeDir, "skills", "beta-dir"),
      "---\nname: beta\ndescription: 'Beta skill'\n---\nBody",
    );
    // Malformed: unknown frontmatter key fails the strict schema.
    writeSkill(
      join(claudeDir, "skills", "broken"),
      "---\nname: shiny\ndescription: nope\nbogus-key: 1\n---\nBody",
    );
    // No frontmatter at all.
    writeSkill(join(claudeDir, "skills", "plain"), "# Plain skill\n");
    // Directory without SKILL.md and a stray file are ignored.
    mkdirSync(join(claudeDir, "skills", "empty"), { recursive: true });
    writeFileSync(join(claudeDir, "skills", "stray.md"), "not a skill");
    // Symlinked skill directories are followed.
    writeSkill(join(root, "shared", "linked"), "---\nname: linked\ndescription: Linked\n---\n");
    symlinkSync(join(root, "shared", "linked"), join(claudeDir, "skills", "linked"));

    writeSkill(
      join(projectPath, ".claude", "skills", "deploy"),
      "---\nname: deploy\ndescription: Ship it\ndisable-model-invocation: true\n---\n",
    );

    writeSkill(
      join(pluginPath, "skills", "lint"),
      "---\nname: lint\ndescription: Lint code\nversion: 0.2.0\n---\n",
    );
    writeSkill(
      join(pluginPath, "skills", "format"),
      "---\nname: format\ndescription: Format code\n---\n",
    );
    mkdirSync(join(claudeDir, "plugins"), { recursive: true });
    writeFileSync(
      join(claudeDir, "plugins", "installed_plugins.json"),
      JSON.stringify({
        version: 2,
        plugins: {
          "tools@market": [
            {
              scope: "user",
              installPath: pluginPath,
              version: "1.0.0",
              installedAt: "2026-04-22T19:16:18.255Z",
              lastUpdated: "2026-04-22T19:16:18.255Z",
              gitCommitSha: "cf62a6c02dc03db88da8eb7c61bdb9fd88da6326",
            },
          ],
        },
      }),
    );

    writeFileSync(
      join(claudeDir, "settings.json"),
      JSON.stringify({ skillOverrides: { beta: "off", "tools:format": "off" } }),
    );

    const skills = await listSkills({
      projects: [
        { id: "-repos-my-app", projectPath },
        { id: "-repos-missing", projectPath: join(root, "repos", "missing") },
      ],
      claudeDir,
    });

    const mtime = MTIME.getTime();
    expect(skills).toStrictEqual([
      {
        id: "personal:alpha",
        name: "alpha",
        description: "First line.\nSecond line.",
        source: "personal",
        sourceLabel: "Personal",
        dir: join(claudeDir, "skills", "alpha"),
        mtime,
        enabled: true,
      },
      {
        id: "personal:beta",
        name: "beta",
        description: "Beta skill",
        source: "personal",
        sourceLabel: "Personal",
        dir: join(claudeDir, "skills", "beta-dir"),
        mtime,
        enabled: false,
      },
      {
        id: "personal:broken",
        name: "broken",
        description: "",
        source: "personal",
        sourceLabel: "Personal",
        dir: join(claudeDir, "skills", "broken"),
        mtime,
        enabled: true,
      },
      {
        id: "personal:linked",
        name: "linked",
        description: "Linked",
        source: "personal",
        sourceLabel: "Personal",
        dir: join(claudeDir, "skills", "linked"),
        mtime,
        enabled: true,
      },
      {
        id: "personal:plain",
        name: "plain",
        description: "",
        source: "personal",
        sourceLabel: "Personal",
        dir: join(claudeDir, "skills", "plain"),
        mtime,
        enabled: true,
      },
      {
        id: "project:-repos-my-app:deploy",
        name: "deploy",
        description: "Ship it",
        source: "project",
        sourceLabel: "my-app",
        dir: join(projectPath, ".claude", "skills", "deploy"),
        mtime,
        enabled: true,
      },
      {
        id: "plugin:tools@market:format",
        name: "format",
        description: "Format code",
        source: "plugin",
        sourceLabel: "tools",
        dir: join(pluginPath, "skills", "format"),
        mtime,
        enabled: false,
      },
      {
        id: "plugin:tools@market:lint",
        name: "lint",
        description: "Lint code",
        source: "plugin",
        sourceLabel: "tools",
        dir: join(pluginPath, "skills", "lint"),
        mtime,
        enabled: true,
      },
    ]);
    expect(SkillListResponse.parse(skills)).toStrictEqual(skills);
  });

  it("returns an empty list when nothing is on disk", async () => {
    expect(await listSkills({ projects: [], claudeDir })).toStrictEqual([]);
  });

  it("treats malformed settings and plugin registry as absent", async () => {
    writeSkill(join(claudeDir, "skills", "solo"), "---\nname: solo\ndescription: Solo\n---\n");
    writeFileSync(join(claudeDir, "settings.json"), "{ not json");
    mkdirSync(join(claudeDir, "plugins"), { recursive: true });
    writeFileSync(join(claudeDir, "plugins", "installed_plugins.json"), '{"plugins": 5}');

    expect(await listSkills({ projects: [], claudeDir })).toStrictEqual([
      {
        id: "personal:solo",
        name: "solo",
        description: "Solo",
        source: "personal",
        sourceLabel: "Personal",
        dir: join(claudeDir, "skills", "solo"),
        mtime: MTIME.getTime(),
        enabled: true,
      },
    ]);
  });
});

describe("readSkillDetail", () => {
  it("reads invocation flags, allowed tools and the file tree", async () => {
    const dir = join(pluginPath, "skills", "lint");
    writeSkill(
      dir,
      [
        "---",
        "name: lint",
        "description: Lint code",
        "allowed-tools: Read, Bash(git diff:*)",
        "argument-hint: <path>",
        "disable-model-invocation: true",
        "---",
        "Body",
      ].join("\n"),
    );
    mkdirSync(join(dir, "scripts"), { recursive: true });
    writeFileSync(join(dir, "scripts", "run.py"), "print()\n");

    const detail = await readSkillDetail({
      id: "plugin:tools@market:lint",
      name: "lint",
      description: "Lint code",
      source: "plugin",
      sourceLabel: "tools",
      dir,
      mtime: MTIME.getTime(),
      enabled: true,
    });

    expect(detail).toStrictEqual({
      skill: {
        id: "plugin:tools@market:lint",
        name: "lint",
        description: "Lint code",
        source: "plugin",
        sourceLabel: "tools",
        dir,
        mtime: MTIME.getTime(),
        enabled: true,
      },
      pluginId: "tools@market",
      userInvocable: true,
      modelInvocable: false,
      allowedTools: ["Read", "Bash(git diff:*)"],
      argumentHint: "<path>",
      tree: [{ path: "scripts", children: [{ path: "scripts/run.py" }] }, { path: "SKILL.md" }],
    });
  });
});
