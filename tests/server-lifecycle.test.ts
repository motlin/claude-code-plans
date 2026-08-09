import { execFileSync, execSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";

// Regression test for the orphaned duplicate production server
// (.llm/plans/2026-08-08-user-review-bug-sweep.md, step 3): starting the
// server twice must leave exactly one process, and it must own the port.

const projectRoot = resolve(process.cwd());
const script = join(projectRoot, "scripts", "server.sh");
const fixture = join(projectRoot, "tests", "fixtures", "fake-server.mjs");

const PORT = "7581";
const MATCH = "fixtures/fake-server\\.mjs";

const logDir = mkdtempSync(join(tmpdir(), "server-lifecycle-"));

const env = {
  ...process.env,
  PORT,
  SERVER_CMD: `node ${fixture}`,
  SERVER_MATCH: MATCH,
  LOG_FILE: join(logDir, "server.log"),
};

function run(command: string): string {
  return execFileSync("bash", [script, command], {
    cwd: projectRoot,
    encoding: "utf8",
    env,
  });
}

function serverPids(): string[] {
  try {
    return execSync(`pgrep -f '${MATCH}'`, { encoding: "utf8" })
      .trim()
      .split("\n")
      .filter(Boolean)
      .sort();
  } catch {
    return [];
  }
}

function portOwners(): string[] {
  try {
    return execSync(`lsof -t -iTCP:${PORT} -sTCP:LISTEN`, { encoding: "utf8" })
      .trim()
      .split("\n")
      .filter(Boolean)
      .sort();
  } catch {
    return [];
  }
}

afterAll(() => {
  run("stop");
});

describe("scripts/server.sh", () => {
  it("starting twice leaves exactly one process and it owns the port", () => {
    run("start");
    const firstPids = serverPids();
    expect(firstPids).toHaveLength(1);

    run("start");
    const secondPids = serverPids();
    expect(secondPids).toHaveLength(1);
    expect(portOwners()).toEqual(secondPids);
    // The second start replaced the first process rather than piling on.
    expect(secondPids).not.toEqual(firstPids);
  }, 30_000);

  it("stop terminates the server and is a no-op when nothing is running", () => {
    run("start");
    run("stop");
    expect(serverPids()).toEqual([]);
    expect(portOwners()).toEqual([]);

    // Stopping again must succeed without error.
    run("stop");
    expect(serverPids()).toEqual([]);
  }, 30_000);
});
