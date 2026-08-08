import { appendFile, mkdir, mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const watchMock = vi.hoisted(() => vi.fn());

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  watchMock.mockImplementation(actual.watch);
  return { ...actual, watch: watchMock };
});

import { createRecursiveWatcher, type RecursiveWatcher } from "../src/lib/recursive-watch";

const EVENT_TIMEOUT_MS = 5000;

function waitForReady(watcher: RecursiveWatcher): Promise<void> {
  return new Promise((resolve) => watcher.once("ready", resolve));
}

function waitForPath(
  watcher: RecursiveWatcher,
  event: "change" | "unlink",
  expectedPath: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`Timed out waiting for ${event}: ${expectedPath}`)),
      EVENT_TIMEOUT_MS,
    );
    watcher.on(event, (path) => {
      if (path !== expectedPath) return;
      clearTimeout(timeout);
      resolve(path);
    });
  });
}

describe.sequential("createRecursiveWatcher", () => {
  let fixtureDirectory: string;
  let watcher: RecursiveWatcher | undefined;
  const originalPollingSetting = process.env["CCP_WATCHER_POLLING"];

  beforeEach(async () => {
    delete process.env["CCP_WATCHER_POLLING"];
    fixtureDirectory = await mkdtemp(join(process.cwd(), ".llm/recursive-watch-test-"));
    watchMock.mockClear();
  });

  afterEach(async () => {
    await watcher?.close();
    watcher = undefined;
    await rm(fixtureDirectory, { recursive: true, force: true });
    if (originalPollingSetting === undefined) {
      delete process.env["CCP_WATCHER_POLLING"];
    } else {
      process.env["CCP_WATCHER_POLLING"] = originalPollingSetting;
    }
  });

  it("emits change for created and modified files, then unlink when deleted", async () => {
    const filePath = join(fixtureDirectory, "alice.md");
    watcher = createRecursiveWatcher([fixtureDirectory], () => false);
    await waitForReady(watcher);

    const created = waitForPath(watcher, "change", filePath);
    await writeFile(filePath, "first\n", "utf8");
    expect(await created).toBe(filePath);

    const modified = waitForPath(watcher, "change", filePath);
    await appendFile(filePath, "second\n", "utf8");
    expect(await modified).toBe(filePath);

    const deleted = waitForPath(watcher, "unlink", filePath);
    await unlink(filePath);
    expect(await deleted).toBe(filePath);
  });

  it("observes files created inside a newly-created nested directory", async () => {
    const nestedDirectory = join(fixtureDirectory, "nested");
    const filePath = join(nestedDirectory, "bob.json");
    watcher = createRecursiveWatcher([fixtureDirectory], () => false);
    await waitForReady(watcher);

    const changed = waitForPath(watcher, "change", filePath);
    await mkdir(nestedDirectory);
    await writeFile(filePath, "{}\n", "utf8");

    expect(await changed).toBe(filePath);
  });

  it("filters ignored paths before emitting events", async () => {
    const ignoredDirectory = join(fixtureDirectory, "ignored");
    const ignoredPath = join(ignoredDirectory, "charlie.md");
    const acceptedPath = join(fixtureDirectory, "alice.md");
    const events: string[] = [];
    watcher = createRecursiveWatcher([fixtureDirectory], (path) => path.includes("/ignored/"));
    watcher.on("change", (path) => {
      if (path === ignoredPath) events.push(path);
    });
    watcher.on("unlink", (path) => {
      if (path === ignoredPath) events.push(path);
    });
    await waitForReady(watcher);

    await mkdir(ignoredDirectory);
    await writeFile(ignoredPath, "ignored\n", "utf8");
    const accepted = waitForPath(watcher, "change", acceptedPath);
    await writeFile(acceptedPath, "accepted\n", "utf8");
    await accepted;

    expect(events).toStrictEqual([]);
  });

  it("attaches one native watcher when roots overlap", async () => {
    const nestedDirectory = join(fixtureDirectory, "nested");
    await mkdir(nestedDirectory);

    watcher = createRecursiveWatcher([fixtureDirectory, nestedDirectory], () => false);
    await waitForReady(watcher);

    expect(watchMock.mock.calls.map(([root, options]) => ({ root, options }))).toStrictEqual([
      {
        root: nestedDirectory,
        options: { recursive: true, persistent: true },
      },
    ]);
  });

  it("stops emitting events after close", async () => {
    const filePath = join(fixtureDirectory, "alice.md");
    const events: string[] = [];
    watcher = createRecursiveWatcher([fixtureDirectory], () => false);
    watcher.on("change", (path) => events.push(path));
    watcher.on("unlink", (path) => events.push(path));
    await waitForReady(watcher);
    await watcher.close();

    await writeFile(filePath, "after close\n", "utf8");
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(events).toStrictEqual([]);
  });
});
