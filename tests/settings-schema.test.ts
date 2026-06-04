import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { ClaudeSettingsSchema, McpConfigSchema, SessionsIndexSchema } from "../src/lib/schemas";

/**
 * Collect all project root directories under `~/projects`, scanning up to 2 levels deep.
 * Skips node_modules and .git directories.
 */
function collectProjectDirs(root: string): string[] {
  const results: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return results;
  }
  for (const entry of entries) {
    if (entry === "node_modules" || entry === ".git") continue;
    const fullPath = join(root, entry);
    let st: ReturnType<typeof statSync>;
    try {
      st = statSync(fullPath);
    } catch {
      continue;
    }
    if (!st.isDirectory()) continue;
    results.push(fullPath);

    // Scan one more level for grouped project directories (e.g. open-source/project)
    let subEntries: string[];
    try {
      subEntries = readdirSync(fullPath);
    } catch {
      continue;
    }
    for (const subEntry of subEntries) {
      if (subEntry === "node_modules" || subEntry === ".git" || subEntry === ".claude") continue;
      const subPath = join(fullPath, subEntry);
      let subSt: ReturnType<typeof statSync>;
      try {
        subSt = statSync(subPath);
      } catch {
        continue;
      }
      if (subSt.isDirectory()) {
        results.push(subPath);
      }
    }
  }
  return results;
}

/**
 * Find settings files across all project directories.
 * Looks for files matching `pattern` inside `.claude/` subdirectory of each project.
 */
function findProjectSettingsFiles(projectsBase: string, pattern: RegExp): string[] {
  const results: string[] = [];
  const projectDirs = collectProjectDirs(projectsBase);
  for (const projectDir of projectDirs) {
    const claudeDir = join(projectDir, ".claude");
    let entries: string[];
    try {
      entries = readdirSync(claudeDir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (pattern.test(entry)) {
        results.push(join(claudeDir, entry));
      }
    }
  }
  return results;
}

/**
 * Find .mcp.json files in project roots and their .claude/ subdirectories.
 */
function findMcpFiles(projectsBase: string): string[] {
  const results: string[] = [];
  const projectDirs = collectProjectDirs(projectsBase);
  for (const projectDir of projectDirs) {
    const rootMcp = join(projectDir, ".mcp.json");
    if (existsSync(rootMcp)) results.push(rootMcp);
    const claudeMcp = join(projectDir, ".claude", ".mcp.json");
    if (existsSync(claudeMcp)) results.push(claudeMcp);
  }
  return results;
}

describe("ClaudeSettingsSchema", () => {
  it("parses an empty settings object", () => {
    const result = ClaudeSettingsSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("parses settings with scalar fields", () => {
    const result = ClaudeSettingsSchema.safeParse({
      model: "claude-opus-4-6",
      theme: "dark",
      tui: "fullscreen",
      verbose: true,
      includeCoAuthoredBy: false,
      alwaysThinkingEnabled: true,
      voiceEnabled: false,
      cleanupPeriodDays: 90,
      fileCheckpointingEnabled: true,
      autoUpdatesChannel: "latest",
      skipDangerousModePermissionPrompt: false,
      teammateMode: "in-process",
      preferredNotifChannel: "ghostty",
    });
    expect(result.success).toBe(true);
  });

  it("parses settings with env key/value pairs", () => {
    const result = ClaudeSettingsSchema.safeParse({
      env: {
        DISABLE_TELEMETRY: "1",
        MY_VAR: "hello",
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.env).toStrictEqual({
        DISABLE_TELEMETRY: "1",
        MY_VAR: "hello",
      });
    }
  });

  it("parses settings with permissions", () => {
    const result = ClaudeSettingsSchema.safeParse({
      permissions: {
        allow: ["Bash", "Read", "Write"],
        deny: ["Bash(rm -rf:*)"],
        ask: ["Edit(CLAUDE.md)"],
        defaultMode: "plan",
      },
    });
    expect(result.success).toBe(true);
  });

  it("parses settings with hooks", () => {
    const result = ClaudeSettingsSchema.safeParse({
      hooks: {
        PostToolUse: [
          {
            matcher: "Bash",
            hooks: [{ type: "command", command: "echo hello" }],
          },
        ],
        SessionStart: [
          {
            hooks: [{ type: "command", command: "echo start", timeout: 5000 }],
          },
        ],
      },
    });
    expect(result.success).toBe(true);
  });

  it("parses settings with statusLine", () => {
    const result = ClaudeSettingsSchema.safeParse({
      statusLine: {
        type: "command",
        command: "~/.claude/statusline.sh",
        padding: 0,
      },
    });
    expect(result.success).toBe(true);
  });

  it("parses settings with enabledPlugins", () => {
    const result = ClaudeSettingsSchema.safeParse({
      enabledPlugins: {
        "my-plugin@marketplace": true,
        "other-plugin@marketplace": false,
      },
    });
    expect(result.success).toBe(true);
  });

  it("parses settings with extraKnownMarketplaces", () => {
    const result = ClaudeSettingsSchema.safeParse({
      extraKnownMarketplaces: {
        "my-marketplace": {
          source: { source: "github", repo: "user/repo" },
        },
        "local-marketplace": {
          source: { source: "directory", path: "/path/to/plugins" },
        },
      },
    });
    expect(result.success).toBe(true);
  });

  it("parses settings with $schema field", () => {
    const result = ClaudeSettingsSchema.safeParse({
      $schema: "https://json.schemastore.org/claude-code-settings.json",
    });
    expect(result.success).toBe(true);
  });

  it("rejects unknown top-level fields", () => {
    const result = ClaudeSettingsSchema.safeParse({
      unknownField: "value",
    });
    expect(result.success).toBe(false);
  });
});

describe("McpConfigSchema", () => {
  it("parses minimal mcp config", () => {
    const result = McpConfigSchema.safeParse({
      mcpServers: {
        myServer: {
          command: "/usr/bin/server",
        },
      },
    });
    expect(result.success).toBe(true);
  });

  it("parses mcp config with all fields", () => {
    const result = McpConfigSchema.safeParse({
      mcpServers: {
        myServer: {
          type: "stdio",
          command: "npx",
          args: ["@some/package@latest"],
          env: { API_KEY: "secret" },
          cwd: "/tmp",
        },
      },
    });
    expect(result.success).toBe(true);
  });

  it("parses mcp config with empty servers", () => {
    const result = McpConfigSchema.safeParse({ mcpServers: {} });
    expect(result.success).toBe(true);
  });

  it("rejects missing mcpServers key", () => {
    const result = McpConfigSchema.safeParse({ servers: {} });
    expect(result.success).toBe(false);
  });

  it("parses a remote (sse/http) server entry with url and headers", () => {
    const result = McpConfigSchema.safeParse({
      mcpServers: {
        remote: {
          type: "http",
          url: "https://example.com/mcp",
          headers: { Authorization: "Bearer token" },
        },
      },
    });
    expect(result.success).toBe(true);
  });

  it("rejects server entry with unknown fields", () => {
    const result = McpConfigSchema.safeParse({
      mcpServers: {
        broken: { command: "/usr/bin/server", bogusField: true },
      },
    });
    expect(result.success).toBe(false);
  });
});

describe("SessionsIndexSchema against disk", () => {
  const projectsDir = join(homedir(), ".claude", "projects");

  it("validates all sessions-index.json files on disk", () => {
    let projectDirs: string[];
    try {
      projectDirs = readdirSync(projectsDir);
    } catch {
      return;
    }

    let validated = 0;
    const failures: string[] = [];

    for (const projectDir of projectDirs) {
      const projectPath = join(projectsDir, projectDir);
      let st: ReturnType<typeof statSync>;
      try {
        st = statSync(projectPath);
      } catch {
        continue;
      }
      if (!st.isDirectory()) continue;

      const indexPath = join(projectPath, "sessions-index.json");
      let raw: string;
      try {
        raw = readFileSync(indexPath, "utf-8");
      } catch {
        continue;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        failures.push(`${projectDir}/sessions-index.json: invalid JSON`);
        continue;
      }

      const result = SessionsIndexSchema.safeParse(parsed);
      if (!result.success) {
        const issues = result.error.issues
          .map((issue) => `  ${issue.path.join(".")}: ${issue.message}`)
          .join("\n");
        failures.push(`${projectDir}/sessions-index.json:\n${issues}`);
      } else {
        validated++;
      }
    }

    if (failures.length > 0) {
      throw new Error(
        `${failures.length} sessions-index.json files failed validation:\n${failures.join("\n")}`,
      );
    }

    expect(validated).toBeGreaterThanOrEqual(0);
  });
});

describe("ClaudeSettingsSchema against disk", () => {
  const claudeHome = join(homedir(), ".claude");

  for (const filename of ["settings.json", "settings.local.json"]) {
    it(`validates ~/.claude/${filename}`, () => {
      const filePath = join(claudeHome, filename);
      let raw: string;
      try {
        raw = readFileSync(filePath, "utf-8");
      } catch {
        return;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new Error(`${filename}: invalid JSON`);
      }

      const result = ClaudeSettingsSchema.safeParse(parsed);
      if (!result.success) {
        const issues = result.error.issues
          .map((issue) => `  ${issue.path.join(".")}: ${issue.message}`)
          .join("\n");
        throw new Error(`${filename} failed validation:\n${issues}`);
      }
    });
  }

  it("validates all project-level settings files on disk", () => {
    const projectsBase = join(homedir(), "projects");
    if (!existsSync(projectsBase)) return;

    const settingsFiles = findProjectSettingsFiles(projectsBase, /^settings(\.local)?\.json$/);

    let validated = 0;
    const failures: string[] = [];

    for (const filePath of settingsFiles) {
      const relative = filePath.replace(projectsBase + "/", "");
      let raw: string;
      try {
        raw = readFileSync(filePath, "utf-8");
      } catch {
        continue;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        failures.push(`${relative}: invalid JSON`);
        continue;
      }

      const result = ClaudeSettingsSchema.safeParse(parsed);
      if (!result.success) {
        const issues = result.error.issues
          .map((issue) => `  ${issue.path.join(".")}: ${issue.message}`)
          .join("\n");
        failures.push(`${relative}:\n${issues}`);
      } else {
        validated++;
      }
    }

    if (failures.length > 0) {
      throw new Error(
        `${failures.length} project settings files failed validation:\n${failures.join("\n")}`,
      );
    }

    expect(validated).toBeGreaterThanOrEqual(0);
  });
});

describe("McpConfigSchema against disk", () => {
  const claudeHome = join(homedir(), ".claude");

  it("validates ~/.claude/mcp.json", () => {
    const filePath = join(claudeHome, "mcp.json");
    let raw: string;
    try {
      raw = readFileSync(filePath, "utf-8");
    } catch {
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error("mcp.json: invalid JSON");
    }

    const result = McpConfigSchema.safeParse(parsed);
    if (!result.success) {
      const issues = result.error.issues
        .map((issue) => `  ${issue.path.join(".")}: ${issue.message}`)
        .join("\n");
      throw new Error(`mcp.json failed validation:\n${issues}`);
    }
  });

  it("validates all project-level .mcp.json files on disk", () => {
    const projectsBase = join(homedir(), "projects");
    if (!existsSync(projectsBase)) return;

    const mcpFiles = findMcpFiles(projectsBase);

    let validated = 0;
    const failures: string[] = [];

    for (const filePath of mcpFiles) {
      const relative = filePath.replace(projectsBase + "/", "");
      let raw: string;
      try {
        raw = readFileSync(filePath, "utf-8");
      } catch {
        continue;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        failures.push(`${relative}: invalid JSON`);
        continue;
      }

      const result = McpConfigSchema.safeParse(parsed);
      if (!result.success) {
        const issues = result.error.issues
          .map((issue) => `  ${issue.path.join(".")}: ${issue.message}`)
          .join("\n");
        failures.push(`${relative}:\n${issues}`);
      } else {
        validated++;
      }
    }

    if (failures.length > 0) {
      throw new Error(
        `${failures.length} .mcp.json files failed validation:\n${failures.join("\n")}`,
      );
    }

    // Don't assert validated > 0 since not all machines have project .mcp.json files
    if (validated > 0) {
      expect(validated).toBeGreaterThan(0);
    }
  });
});
