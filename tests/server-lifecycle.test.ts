import { execFileSync, execSync, spawnSync } from "node:child_process";
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

function darwinListeners(): Array<{ address: string; processId: string }> {
  return execFileSync("netstat", ["-anv", "-p", "tcp"], { encoding: "utf8" })
    .split("\n")
    .map((line) => line.trim().split(/\s+/))
    .filter(
      (fields) =>
        fields[0]?.startsWith("tcp") === true &&
        fields[3]?.endsWith(`.${PORT}`) === true &&
        fields[5] === "LISTEN",
    )
    .map((fields) => {
      const address = fields[3];
      const processId = fields[10];
      if (address === undefined || processId === undefined) {
        throw new Error(`Unexpected netstat listener row: ${fields.join(" ")}`);
      }
      return {
        address: `${address.slice(0, -PORT.length - 1)}:${PORT}`,
        processId,
      };
    });
}

function portOwners(): string[] {
  if (process.platform === "darwin") {
    return darwinListeners()
      .map(({ processId }) => processId)
      .sort();
  }
  try {
    return execFileSync("lsof", ["-nP", "-t", `-iTCP:${PORT}`, "-sTCP:LISTEN"], {
      encoding: "utf8",
    })
      .trim()
      .split("\n")
      .filter(Boolean)
      .sort();
  } catch {
    return [];
  }
}

function listenerAddresses(): string[] {
  if (process.platform === "darwin") {
    return darwinListeners().map(({ address }) => address);
  }
  return execFileSync("lsof", ["-a", `-iTCP:${PORT}`, "-sTCP:LISTEN", "-P", "-n", "-Fn"], {
    encoding: "utf8",
  })
    .split("\n")
    .filter((line) => line.startsWith("n"))
    .map((line) => line.slice(1));
}

afterAll(() => {
  run("stop");
});

describe("scripts/server.sh", () => {
  it("starting twice leaves exactly one process and it owns the port", () => {
    run("start");
    const firstPids = serverPids();
    expect(firstPids.length).toBe(1);

    run("start");
    const secondPids = serverPids();
    expect(secondPids.length).toBe(1);
    expect(portOwners()).toStrictEqual(secondPids);
    // The second start replaced the first process rather than piling on.
    expect(secondPids).not.toStrictEqual(firstPids);
  }, 30_000);

  it("dev refuses to compete with a wildcard-bound production listener", () => {
    run("start");
    const productionPids = serverPids();
    expect(productionPids.length).toBe(1);
    expect(portOwners()).toStrictEqual(productionPids);
    expect(listenerAddresses()).toStrictEqual([`*:${PORT}`]);

    const result = spawnSync("bash", [script, "dev", "node", fixture], {
      cwd: projectRoot,
      encoding: "utf8",
      env,
    });

    expect({ status: result.status, stdout: result.stdout, stderr: result.stderr }).toStrictEqual({
      status: 1,
      stdout: "",
      stderr: `Port ${PORT} is already in use by pid(s): ${productionPids[0]}. Run 'just stop' before 'just dev'.\n`,
    });
    expect(serverPids()).toStrictEqual(productionPids);
    expect(portOwners()).toStrictEqual(productionPids);
  }, 30_000);

  it("stop terminates the server and is a no-op when nothing is running", () => {
    run("start");
    run("stop");
    expect(serverPids()).toStrictEqual([]);
    expect(portOwners()).toStrictEqual([]);

    // Stopping again must succeed without error.
    run("stop");
    expect(serverPids()).toStrictEqual([]);
  }, 30_000);
});
