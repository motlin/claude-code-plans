import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import {
  AppConfigSchema,
  DEFAULT_IGNORED_DIR_NAMES,
  herdrWritesEnabled,
  readApplicationSettings,
  readConfig,
  updateApplicationSettings,
} from "../src/lib/config";
import {
  handleGetApplicationSettings,
  handlePutApplicationSettings,
} from "../src/lib/application-settings-handler";

describe("persisted application settings", () => {
  let directory: string;
  let configPath: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "application-settings-test-"));
    configPath = join(directory, "config.json");
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("keeps the default ignored directory names in alphabetical order", () => {
    expect(DEFAULT_IGNORED_DIR_NAMES).toStrictEqual([...DEFAULT_IGNORED_DIR_NAMES].sort());
  });

  it("strictly validates every persisted setting", () => {
    expect([
      AppConfigSchema.safeParse({
        herdr_writes_enabled: true,
        show_herdr_section: true,
        show_tmux_section: false,
        ignored_dirs: ["node_modules"],
      }).success,
      AppConfigSchema.safeParse({ herdr_writes_enabled: "1" }).success,
      AppConfigSchema.safeParse({ show_herdr_section: "true" }).success,
      AppConfigSchema.safeParse({ show_tmux_section: 1 }).success,
      AppConfigSchema.safeParse({ watcher_polling: 1 }).success,
      AppConfigSchema.safeParse({ ignored_dirs: [""] }).success,
      AppConfigSchema.safeParse({ ignored_dirs: [] }).success,
      AppConfigSchema.safeParse({ unknown_policy: true }).success,
    ]).toStrictEqual([true, false, false, false, false, false, false, false]);
  });

  it("strips the legacy watcher polling key while parsing persisted config", async () => {
    await writeFile(
      configPath,
      JSON.stringify({ watcher_polling: true, show_herdr_section: false }),
    );

    expect(readConfig(configPath)).toStrictEqual({ show_herdr_section: false });
  });

  it("uses safe defaults and ignores retired CCP environment aliases", () => {
    process.env["CCP_ENABLE_HERDR_WRITES"] = "1";
    process.env["CCP_WATCHER_IGNORED_DIRS"] = "vendor";
    try {
      expect({
        settings: readApplicationSettings(configPath),
        herdrWritesEnabled: herdrWritesEnabled(configPath),
      }).toStrictEqual({
        settings: {
          herdrWritesEnabled: false,
          showHerdrSection: true,
          showTmuxSection: false,
          ignoredDirs: [...DEFAULT_IGNORED_DIR_NAMES],
        },
        herdrWritesEnabled: false,
      });
    } finally {
      delete process.env["CCP_ENABLE_HERDR_WRITES"];
      delete process.env["CCP_WATCHER_IGNORED_DIRS"];
    }
  });

  it("sorts ignored directories while atomically preserving unrelated config fields", async () => {
    await writeFile(
      configPath,
      JSON.stringify({
        image_roots: ["/tmp/images"],
        file_roots: ["/tmp/files"],
        watcher_polling: true,
      }),
    );

    const saved = await updateApplicationSettings(
      {
        herdrWritesEnabled: true,
        showHerdrSection: false,
        showTmuxSection: true,
        ignoredDirs: ["vendor", "output"],
      },
      configPath,
    );

    expect({
      saved,
      file: JSON.parse(await readFile(configPath, "utf8")),
      temporaryFiles: await readdir(directory),
    }).toStrictEqual({
      saved: {
        herdrWritesEnabled: true,
        showHerdrSection: false,
        showTmuxSection: true,
        ignoredDirs: ["output", "vendor"],
      },
      file: {
        image_roots: ["/tmp/images"],
        file_roots: ["/tmp/files"],
        ignored_dirs: ["output", "vendor"],
        herdr_writes_enabled: true,
        show_herdr_section: false,
        show_tmux_section: true,
      },
      temporaryFiles: ["config.json"],
    });
  });

  it("refuses to overwrite an existing invalid config", async () => {
    const invalidConfig = JSON.stringify({ existing_unknown_key: "keep me" });
    await writeFile(configPath, invalidConfig);

    await expect(
      updateApplicationSettings(
        {
          herdrWritesEnabled: true,
          showHerdrSection: true,
          showTmuxSection: false,
          ignoredDirs: ["node_modules"],
        },
        configPath,
      ),
    ).rejects.toThrow("Cannot update an invalid application config");
    expect(await readFile(configPath, "utf8")).toBe(invalidConfig);
  });

  it("reads and writes the same validated settings through the API handlers", async () => {
    await writeFile(configPath, JSON.stringify({ image_roots: ["/tmp/images"] }));
    const request = new Request("http://127.0.0.1:7526/api/application-settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Origin: "http://127.0.0.1:7526" },
      body: JSON.stringify({
        herdrWritesEnabled: true,
        showHerdrSection: false,
        showTmuxSection: true,
        ignoredDirs: ["node_modules", "build"],
      }),
    });

    const savedResponse = await handlePutApplicationSettings(request, configPath);
    const readResponse = handleGetApplicationSettings(configPath);

    expect({
      savedStatus: savedResponse.status,
      saved: await savedResponse.json(),
      readStatus: readResponse.status,
      read: await readResponse.json(),
      persisted: JSON.parse(await readFile(configPath, "utf8")),
    }).toStrictEqual({
      savedStatus: 200,
      saved: {
        herdrWritesEnabled: true,
        showHerdrSection: false,
        showTmuxSection: true,
        ignoredDirs: ["build", "node_modules"],
      },
      readStatus: 200,
      read: {
        herdrWritesEnabled: true,
        showHerdrSection: false,
        showTmuxSection: true,
        ignoredDirs: ["build", "node_modules"],
      },
      persisted: {
        image_roots: ["/tmp/images"],
        ignored_dirs: ["build", "node_modules"],
        herdr_writes_enabled: true,
        show_herdr_section: false,
        show_tmux_section: true,
      },
    });
  });

  it("rejects malformed API settings without changing the config", async () => {
    await writeFile(configPath, JSON.stringify({ herdr_writes_enabled: false }));
    const response = await handlePutApplicationSettings(
      new Request("http://127.0.0.1:7526/api/application-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          herdrWritesEnabled: "yes",
          showHerdrSection: true,
          showTmuxSection: false,
          ignoredDirs: [],
        }),
      }),
      configPath,
    );

    expect({
      status: response.status,
      persisted: JSON.parse(await readFile(configPath, "utf8")),
    }).toStrictEqual({ status: 400, persisted: { herdr_writes_enabled: false } });
  });
});
