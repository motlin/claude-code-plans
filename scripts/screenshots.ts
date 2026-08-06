/**
 * Regenerate the README screenshots from fabricated Claude data.
 *
 * The pinned browser state makes output byte-identical across repeated runs on
 * one machine. Other machines get an explicit renderer-manifest drift error
 * before any PNG is replaced; use --update-manifest to accept an intentional
 * browser, platform, viewport, theme, timezone, or font change.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { arch, platform } from "node:os";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type BrowserContext, type Page } from "playwright";

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCREENSHOTS_DIRECTORY = join(REPOSITORY_ROOT, "screenshots");
const MANIFEST_PATH = join(SCREENSHOTS_DIRECTORY, "renderer-manifest.json");
const FIXTURE_PARENT = join(REPOSITORY_ROOT, ".llm");
const PORT = 7537;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const FIXED_TIME = Date.parse("2000-01-02T12:00:00.000Z");
const VIEWPORT = { width: 1280, height: 718 } as const;
const DEVICE_SCALE_FACTOR = 2;
const COLOR_SCHEME = "dark" as const;
const TIMEZONE = "UTC";
const PROJECT_ID = "alice";
const SESSION_ID = "session-alice-100";
const GENERIC_FONT_FAMILIES = new Set([
  "-apple-system",
  "cursive",
  "fantasy",
  "monospace",
  "sans-serif",
  "serif",
  "system-ui",
  "ui-monospace",
  "ui-rounded",
  "ui-sans-serif",
  "ui-serif",
]);

interface FontStackResolution {
  requested: string[];
  resolved: string;
}

interface RendererManifest {
  playwrightVersion: string;
  chromiumVersion: string;
  viewport: {
    width: number;
    height: number;
    deviceScaleFactor: number;
  };
  colorScheme: typeof COLOR_SCHEME;
  timezone: string;
  platform: {
    operatingSystem: NodeJS.Platform;
    architecture: string;
  };
  fontResolution: Record<string, FontStackResolution>;
  fontAvailability: Record<string, boolean>;
  fontsMissing: string[];
}

interface ScreenshotTarget {
  filename: string;
  path: string;
  heading: string;
}

const TARGETS: ScreenshotTarget[] = [
  { filename: "sessions.png", path: "/sessions", heading: "Claude Sessions" },
  {
    filename: "session-detail.png",
    path: `/session/${SESSION_ID}`,
    heading: "Prepare the fixture release",
  },
  { filename: "projects.png", path: "/projects", heading: "Projects" },
  {
    filename: "project-detail.png",
    path: `/project/${PROJECT_ID}`,
    heading: "alice",
  },
  { filename: "tasks.png", path: "/tasks", heading: "Tasks" },
  {
    filename: "search.png",
    path: "/search?q=fixture&mode=conversations",
    heading: "Search Sessions",
  },
  { filename: "plans.png", path: "/plans", heading: "Claude Plans" },
  { filename: "memories.png", path: "/memories", heading: "Claude Memories" },
];

function printHelp(): void {
  console.log(`Usage: pnpm tsx scripts/screenshots.ts [--update-manifest]

Regenerates all eight README screenshots from an isolated fixture database.
Repeated runs are byte-identical on one machine. Renderer drift on another
machine is reported before screenshots are replaced.

  --update-manifest  Accept the current renderer fingerprint intentionally
  --help             Show this help`);
}

function parseArguments(arguments_: string[]): { updateManifest: boolean } {
  let updateManifest = false;
  for (const argument of arguments_) {
    if (argument === "--update-manifest") {
      updateManifest = true;
    } else if (argument === "--help") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return { updateManifest };
}

function writeFixtureFile(path: string, contents: string, mtimeMs: number): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
  utimesSync(path, mtimeMs / 1000, mtimeMs / 1000);
}

function jsonLines(records: ReadonlyArray<Record<string, unknown>>): string {
  return `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
}

function messageRecord(
  type: "user" | "assistant",
  uuid: string,
  timestamp: string,
  content: string | Array<Record<string, unknown>>,
): Record<string, unknown> {
  return {
    type,
    uuid,
    parentUuid: null,
    timestamp,
    sessionId: SESSION_ID,
    cwd: "/fixture/alice-app",
    gitBranch: "docs/screenshots",
    version: "2.0.0-fixture",
    entrypoint: "cli",
    message: { role: type, content },
  };
}

function seedFixtureHome(fixtureRoot: string): string {
  const fixtureHome = join(fixtureRoot, "home");
  const claudeHome = join(fixtureHome, ".claude");
  const projectsDirectory = join(claudeHome, "projects");
  const plansDirectory = join(claudeHome, "plans");
  const tasksDirectory = join(claudeHome, "tasks");
  const primaryProjectDirectory = join(projectsDirectory, PROJECT_ID);
  const secondaryProjectDirectory = join(projectsDirectory, "bob");
  const firstMtime = FIXED_TIME - 60 * 60 * 1000;
  const secondMtime = FIXED_TIME - 24 * 60 * 60 * 1000;
  const thirdMtime = FIXED_TIME - 4 * 24 * 60 * 60 * 1000;

  const primaryTranscript = jsonLines([
    messageRecord(
      "user",
      "fixture-user-100",
      "2000-01-02T10:00:00.000Z",
      "Prepare the fixture release and automate the documentation screenshots.",
    ),
    messageRecord("assistant", "fixture-assistant-100", "2000-01-02T10:01:00.000Z", [
      {
        type: "text",
        text: "I’ll build a deterministic Playwright workflow backed only by fabricated data.",
      },
      {
        type: "tool_use",
        id: "fixture-tool-100",
        name: "Read",
        input: { file_path: "/fixture/alice-app/README.md" },
      },
    ]),
    messageRecord("user", "fixture-user-200", "2000-01-02T10:01:01.000Z", [
      {
        type: "tool_result",
        tool_use_id: "fixture-tool-100",
        content: "# Alice fixture application\n\nA safe documentation fixture.",
      },
    ]),
    messageRecord(
      "assistant",
      "fixture-assistant-200",
      "2000-01-02T10:02:00.000Z",
      "The fixture database is isolated, the clock is pinned, and renderer drift is visible before any PNG changes.",
    ),
    {
      type: "file-history-snapshot",
      messageId: "fixture-message-100",
      isSnapshotUpdate: false,
      snapshot: {
        messageId: "fixture-message-100",
        timestamp: "2000-01-02T10:02:00.000Z",
        trackedFileBackups: {
          "/fixture/.claude/plans/alice-release.md": "fixture-backup-100",
        },
      },
    },
  ]);
  const secondaryTranscript = jsonLines([
    {
      ...messageRecord(
        "user",
        "fixture-user-300",
        "2000-01-01T09:00:00.000Z",
        "Review the fixture search experience.",
      ),
      sessionId: "session-alice-200",
    },
    {
      ...messageRecord(
        "assistant",
        "fixture-assistant-300",
        "2000-01-01T09:02:00.000Z",
        "The fixture search results now highlight matching conversation text.",
      ),
      sessionId: "session-alice-200",
    },
  ]);
  const thirdTranscript = jsonLines([
    {
      ...messageRecord(
        "user",
        "fixture-user-400",
        "1999-12-29T09:00:00.000Z",
        "Add project memories for the fixture team.",
      ),
      sessionId: "session-alice-300",
    },
    {
      ...messageRecord(
        "assistant",
        "fixture-assistant-400",
        "1999-12-29T09:03:00.000Z",
        "The fixture decisions are indexed and ready to browse.",
      ),
      sessionId: "session-alice-300",
    },
  ]);
  const bobTranscript = jsonLines([
    {
      ...messageRecord(
        "user",
        "fixture-user-500",
        "1999-12-31T08:00:00.000Z",
        "Polish the Bob fixture project overview.",
      ),
      sessionId: "session-bob-100",
      cwd: "/fixture/bob-service",
      gitBranch: "main",
    },
    {
      ...messageRecord(
        "assistant",
        "fixture-assistant-500",
        "1999-12-31T08:04:00.000Z",
        "The project overview has concise fixture metadata.",
      ),
      sessionId: "session-bob-100",
      cwd: "/fixture/bob-service",
      gitBranch: "main",
    },
  ]);

  const primaryPath = join(primaryProjectDirectory, `${SESSION_ID}.jsonl`);
  const secondPath = join(primaryProjectDirectory, "session-alice-200.jsonl");
  const thirdPath = join(primaryProjectDirectory, "session-alice-300.jsonl");
  const bobPath = join(secondaryProjectDirectory, "session-bob-100.jsonl");
  writeFixtureFile(primaryPath, primaryTranscript, firstMtime);
  writeFixtureFile(secondPath, secondaryTranscript, secondMtime);
  writeFixtureFile(thirdPath, thirdTranscript, thirdMtime);
  writeFixtureFile(bobPath, bobTranscript, secondMtime - 2 * 60 * 60 * 1000);

  writeFixtureFile(
    join(primaryProjectDirectory, "sessions-index.json"),
    JSON.stringify({
      version: 1,
      entries: [
        {
          sessionId: SESSION_ID,
          fullPath: primaryPath,
          fileMtime: firstMtime,
          firstPrompt: "Prepare the fixture release and automate the documentation screenshots.",
          summary: "Prepare the fixture release",
          messageCount: 4,
          created: "2000-01-02T10:00:00.000Z",
          modified: "2000-01-02T10:02:00.000Z",
          gitBranch: "docs/screenshots",
          projectPath: "/fixture/alice-app",
        },
        {
          sessionId: "session-alice-200",
          fullPath: secondPath,
          fileMtime: secondMtime,
          firstPrompt: "Review the fixture search experience.",
          summary: "Review the fixture search experience",
          messageCount: 2,
          created: "2000-01-01T09:00:00.000Z",
          modified: "2000-01-01T09:02:00.000Z",
          gitBranch: "feature/search",
          projectPath: "/fixture/alice-app",
        },
        {
          sessionId: "session-alice-300",
          fullPath: thirdPath,
          fileMtime: thirdMtime,
          firstPrompt: "Add project memories for the fixture team.",
          summary: "Add project memories",
          messageCount: 2,
          created: "1999-12-29T09:00:00.000Z",
          modified: "1999-12-29T09:03:00.000Z",
          gitBranch: "feature/memories",
          projectPath: "/fixture/alice-app",
        },
      ],
    }),
    firstMtime,
  );
  writeFixtureFile(
    join(secondaryProjectDirectory, "sessions-index.json"),
    JSON.stringify({
      version: 1,
      entries: [
        {
          sessionId: "session-bob-100",
          fullPath: bobPath,
          fileMtime: secondMtime - 2 * 60 * 60 * 1000,
          firstPrompt: "Polish the Bob fixture project overview.",
          summary: "Polish the Bob fixture project overview",
          messageCount: 2,
          created: "1999-12-31T08:00:00.000Z",
          modified: "1999-12-31T08:04:00.000Z",
          gitBranch: "main",
          projectPath: "/fixture/bob-service",
        },
      ],
    }),
    secondMtime,
  );

  writeFixtureFile(
    join(primaryProjectDirectory, "memory", "architecture.md"),
    "# Keep screenshot data isolated\n\nDocumentation rendering must never read a real Claude home.\n",
    firstMtime,
  );
  writeFixtureFile(
    join(primaryProjectDirectory, "memory", "release-checklist.md"),
    "# Release checklist decisions\n\nPin the renderer before accepting image updates.\n",
    secondMtime,
  );
  writeFixtureFile(
    join(secondaryProjectDirectory, "memory", "service-notes.md"),
    "# Service fixture notes\n\nAll names and content are fabricated.\n",
    thirdMtime,
  );

  writeFixtureFile(
    join(plansDirectory, "alice-release.md"),
    "# Ship deterministic documentation\n\n- Seed fixture data\n- Capture every README route\n- Compare renderer metadata\n",
    firstMtime,
  );
  writeFixtureFile(
    join(plansDirectory, "search-polish.md"),
    "# Polish search results\n\nKeep highlighted fixture matches easy to scan.\n",
    secondMtime,
  );
  writeFixtureFile(
    join(plansDirectory, "memory-index.md"),
    "# Index fixture memories\n\nGroup durable decisions by project.\n",
    thirdMtime,
  );

  const tasks = [
    {
      id: "100",
      subject: "Capture all README routes",
      description: "Generate eight deterministic screenshots from the isolated fixture database.",
      status: "in_progress",
      blocks: ["200"],
      blockedBy: [],
      activeForm: "Capturing documentation routes",
      owner: "alice",
      metadata: { category: "documentation" },
    },
    {
      id: "200",
      subject: "Review renderer manifest drift",
      description: "Confirm browser and font changes before accepting new PNG bytes.",
      status: "pending",
      blocks: [],
      blockedBy: ["100"],
      owner: "bob",
      metadata: { category: "release" },
    },
    {
      id: "300",
      subject: "Publish the fixture release notes",
      description: "Document the repeatable screenshot command for contributors.",
      status: "pending",
      blocks: [],
      blockedBy: [],
      owner: "charlie",
      metadata: { category: "documentation" },
    },
  ];
  for (const task of tasks) {
    writeFixtureFile(
      join(tasksDirectory, PROJECT_ID, `${task.id}.json`),
      JSON.stringify(task),
      firstMtime,
    );
  }

  return fixtureHome;
}

function startDevServer(
  fixtureRoot: string,
  fixtureHome: string,
): {
  process: ChildProcess;
  output: string[];
} {
  const output: string[] = [];
  const server = spawn("pnpm", ["exec", "vp", "dev", "--host", "127.0.0.1", "--strictPort"], {
    cwd: REPOSITORY_ROOT,
    detached: process.platform !== "win32",
    env: {
      ...process.env,
      HOME: fixtureHome,
      XDG_CACHE_HOME: join(fixtureRoot, "cache"),
      XDG_CONFIG_HOME: join(fixtureRoot, "config"),
      PORT: String(PORT),
      NO_PROXY: "127.0.0.1,localhost",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const rememberOutput = (chunk: Buffer) => {
    output.push(chunk.toString());
    if (output.length > 100) output.shift();
  };
  server.stdout?.on("data", rememberOutput);
  server.stderr?.on("data", rememberOutput);
  return { process: server, output };
}

async function assertPortAvailable(): Promise<void> {
  const probe = createServer();
  await new Promise<void>((resolvePromise, rejectPromise) => {
    probe.once("error", (error) => rejectPromise(error));
    probe.listen(PORT, "127.0.0.1", () => {
      probe.close((error) => (error ? rejectPromise(error) : resolvePromise()));
    });
  }).catch((error: unknown) => {
    throw new Error(`Screenshot port ${PORT} must be free before starting the fixture server.`, {
      cause: error,
    });
  });
}

async function waitForServer(server: ChildProcess, output: string[]): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (server.exitCode !== null) {
      throw new Error(`Fixture dev server exited with ${server.exitCode}:\n${output.join("")}`);
    }
    try {
      const response = await fetch(`${BASE_URL}/api/indexing-status`);
      if (response.ok) return;
    } catch {
      // The dev server is still starting.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  throw new Error(`Fixture dev server was not ready after 30 seconds:\n${output.join("")}`);
}

async function stopDevServer(server: ChildProcess): Promise<void> {
  const signal = (name: NodeJS.Signals): void => {
    if (process.platform !== "win32" && server.pid !== undefined) {
      try {
        process.kill(-server.pid, name);
      } catch {
        // The isolated process group already exited.
      }
    } else {
      server.kill(name);
    }
  };
  signal("SIGTERM");
  if (server.exitCode !== null) return;
  await Promise.race([
    new Promise<void>((resolvePromise) => server.once("exit", () => resolvePromise())),
    new Promise<void>((resolvePromise) =>
      setTimeout(() => {
        signal("SIGKILL");
        resolvePromise();
      }, 5_000),
    ),
  ]);
}

async function waitForIndexing(): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const response = await fetch(`${BASE_URL}/api/indexing-status`);
    const status = (await response.json()) as { isIndexing: boolean };
    if (!status.isIndexing) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error("Fixture database indexing did not finish after 12 seconds.");
}

function parseFontStack(stack: string): string[] {
  return stack
    .split(",")
    .map((family) => family.trim().replace(/^(?:"|')|(?:"|')$/g, ""))
    .filter(Boolean);
}

async function collectRendererManifest(
  page: Page,
  chromiumVersion: string,
): Promise<RendererManifest> {
  await page.goto(`${BASE_URL}/sessions`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "Claude Sessions", exact: true }).waitFor();
  await page.evaluate(() => document.fonts.ready);

  const fontData = await page.evaluate(() => {
    const monoProbe = document.createElement("code");
    monoProbe.className = "font-mono";
    monoProbe.textContent = "fixture";
    document.body.append(monoProbe);
    const stacks = {
      sans: getComputedStyle(document.body).fontFamily,
      mono: getComputedStyle(monoProbe).fontFamily,
    };
    monoProbe.remove();

    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas font probe is unavailable.");
    const sample = "mmmmmmmmmmWWWWWWWWWWiiiiiiiiii0123456789@#%";
    const width = (fontFamily: string): number => {
      context.font = `72px ${fontFamily}`;
      return context.measureText(sample).width;
    };
    const baselines = {
      monospace: width("monospace"),
      "sans-serif": width("sans-serif"),
      serif: width("serif"),
    };
    return { stacks, baselines, sampleWidths: {} as Record<string, Record<string, number>> };
  });

  const stacks = Object.fromEntries(
    Object.entries(fontData.stacks).map(([name, stack]) => [name, parseFontStack(stack)]),
  );
  const requestedFamilies = [...new Set(Object.values(stacks).flat())].sort();
  const sampleWidths = await page.evaluate((families) => {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas font probe is unavailable.");
    const sample = "mmmmmmmmmmWWWWWWWWWWiiiiiiiiii0123456789@#%";
    const widths: Record<string, Record<string, number>> = {};
    for (const family of families) {
      widths[family] = {};
      for (const fallback of ["monospace", "sans-serif", "serif"]) {
        context.font = `72px "${family.replaceAll('"', '\\"')}", ${fallback}`;
        widths[family]![fallback] = context.measureText(sample).width;
      }
    }
    return widths;
  }, requestedFamilies);

  const fontAvailability: Record<string, boolean> = {};
  for (const family of requestedFamilies) {
    if (GENERIC_FONT_FAMILIES.has(family)) {
      fontAvailability[family] = true;
      continue;
    }
    fontAvailability[family] = Object.entries(fontData.baselines).some(
      ([fallback, baseline]) => Math.abs(sampleWidths[family]![fallback]! - baseline) > 0.01,
    );
  }
  const fontResolution = Object.fromEntries(
    Object.entries(stacks).map(([name, requested]) => [
      name,
      {
        requested,
        resolved: requested.find((family) => fontAvailability[family]) ?? "unresolved",
      },
    ]),
  );
  const packageJson = JSON.parse(
    readFileSync(join(REPOSITORY_ROOT, "node_modules", "playwright", "package.json"), "utf8"),
  ) as { version: string };

  return {
    playwrightVersion: packageJson.version,
    chromiumVersion,
    viewport: { ...VIEWPORT, deviceScaleFactor: DEVICE_SCALE_FACTOR },
    colorScheme: COLOR_SCHEME,
    timezone: TIMEZONE,
    platform: { operatingSystem: platform(), architecture: arch() },
    fontResolution,
    fontAvailability,
    fontsMissing: Object.entries(fontAvailability)
      .filter(([, available]) => !available)
      .map(([family]) => family)
      .sort(),
  };
}

function flattenManifest(value: unknown, path = ""): Map<string, string> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return new Map([[path, JSON.stringify(value)]]);
  }
  const flattened = new Map<string, string>();
  for (const [key, child] of Object.entries(value)) {
    for (const [childPath, childValue] of flattenManifest(child, path ? `${path}.${key}` : key)) {
      flattened.set(childPath, childValue);
    }
  }
  return flattened;
}

export function diffRendererManifests(expected: unknown, actual: unknown): string[] {
  const expectedFields = flattenManifest(expected);
  const actualFields = flattenManifest(actual);
  const fields = new Set([...expectedFields.keys(), ...actualFields.keys()]);
  return [...fields]
    .filter((field) => expectedFields.get(field) !== actualFields.get(field))
    .sort();
}

function printDriftBanner(fields: string[]): void {
  console.error("\n!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
  console.error("!! SCREENSHOT RENDERER DRIFT — PNG OUTPUT MAY CHANGE      !!");
  for (const field of fields) console.error(`!! changed: ${field}`);
  console.error("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!\n");
}

function verifyOrUpdateManifest(manifest: RendererManifest, updateManifest: boolean): void {
  let expected: unknown;
  try {
    expected = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
  } catch {
    if (!updateManifest) {
      throw new Error(
        `Renderer manifest is missing. Run with --update-manifest to create ${MANIFEST_PATH}.`,
      );
    }
    writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(`Created renderer manifest: ${MANIFEST_PATH}`);
    return;
  }

  const changedFields = diffRendererManifests(expected, manifest);
  if (changedFields.length === 0) return;
  printDriftBanner(changedFields);
  if (!updateManifest) {
    throw new Error("Renderer drift detected. Re-run with --update-manifest to accept it.");
  }
  writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Updated renderer manifest: ${MANIFEST_PATH}`);
}

async function prepareContext(context: BrowserContext): Promise<void> {
  await context.route("**/*", async (route) => {
    const requestUrl = new URL(route.request().url());
    if (requestUrl.hostname === "127.0.0.1") {
      await route.continue();
    } else {
      await route.abort();
    }
  });
  // tsx/esbuild annotates serialized callbacks with its `__name` helper.
  // Playwright evaluates those callbacks in the browser, so provide the tiny
  // helper before any callback-based init script or page evaluation runs.
  await context.addInitScript("globalThis.__name = (target) => target;");
  await context.addInitScript(`
    {
      const NativeDate = Date;
      class PinnedDate extends NativeDate {
        constructor(...arguments_) {
          super(...(arguments_.length === 0 ? [${FIXED_TIME}] : arguments_));
        }
        static now() {
          return ${FIXED_TIME};
        }
      }
      globalThis.Date = PinnedDate;
      localStorage.setItem("theme", ${JSON.stringify(COLOR_SCHEME)});
    }
  `);
}

async function captureScreenshots(page: Page): Promise<void> {
  for (const target of TARGETS) {
    await page.goto(`${BASE_URL}${target.path}`, { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: target.heading, exact: true }).waitFor();
    await page.evaluate(() => document.fonts.ready);
    // Markdown and syntax highlighting resolve through Suspense after the route
    // heading appears. Give those imports a deterministic window, then require
    // a quiet DOM before committing pixels.
    await page.waitForTimeout(1_000);
    await page.evaluate(
      () =>
        new Promise<void>((resolvePromise) => {
          let quietTimer = setTimeout(finish, 250);
          const maximumTimer = setTimeout(finish, 3_000);
          const observer = new MutationObserver(() => {
            clearTimeout(quietTimer);
            quietTimer = setTimeout(finish, 250);
          });
          function finish(): void {
            clearTimeout(quietTimer);
            clearTimeout(maximumTimer);
            observer.disconnect();
            resolvePromise();
          }
          observer.observe(document.body, {
            attributes: true,
            characterData: true,
            childList: true,
            subtree: true,
          });
        }),
    );
    await page.addStyleTag({
      content: `
        *, *::before, *::after {
          animation: none !important;
          caret-color: transparent !important;
          transition: none !important;
        }
        iframe[title="React Query Devtools"],
        button[aria-label*="React Query"],
        button[aria-label="Open Tanstack query devtools"],
        [data-agentation-root] {
          display: none !important;
        }
      `,
    });
    await page.locator("[data-agentation-root]").evaluateAll((elements) => {
      for (const element of elements) element.remove();
    });
    await page
      .locator('button[aria-label="Open Tanstack query devtools"]')
      .evaluateAll((buttons) => {
        for (const button of buttons) button.parentElement?.remove();
      });
    await page.screenshot({
      path: join(SCREENSHOTS_DIRECTORY, target.filename),
      animations: "disabled",
      caret: "hide",
      fullPage: false,
    });
    console.log(`Captured screenshots/${target.filename}`);
  }
}

async function main(): Promise<void> {
  const { updateManifest } = parseArguments(process.argv.slice(2));
  await assertPortAvailable();
  mkdirSync(FIXTURE_PARENT, { recursive: true });
  mkdirSync(SCREENSHOTS_DIRECTORY, { recursive: true });
  const fixtureRoot = mkdtempSync(join(FIXTURE_PARENT, "screenshots-fixture-"));
  const fixtureHome = seedFixtureHome(fixtureRoot);
  const server = startDevServer(fixtureRoot, fixtureHome);
  let context: BrowserContext | undefined;

  try {
    await waitForServer(server.process, server.output);
    await waitForIndexing();
    const browser = await chromium.launch({ headless: true });
    try {
      context = await browser.newContext({
        viewport: VIEWPORT,
        deviceScaleFactor: DEVICE_SCALE_FACTOR,
        colorScheme: COLOR_SCHEME,
        timezoneId: TIMEZONE,
        locale: "en-US",
      });
      await prepareContext(context);
      const page = await context.newPage();
      const manifest = await collectRendererManifest(page, browser.version());
      verifyOrUpdateManifest(manifest, updateManifest);
      await captureScreenshots(page);
    } finally {
      await context?.close();
      await browser.close();
    }
  } finally {
    await stopDevServer(server.process);
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
