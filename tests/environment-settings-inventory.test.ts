import { readFileSync } from "node:fs";
import { globSync } from "node:fs";
import { relative, resolve } from "node:path";
import { describe, expect, it } from "vite-plus/test";

const ROOT = resolve(import.meta.dirname, "..");

// Operational/runtime context only. User-facing policy belongs in config.json
// and /settings; adding another environment read must update this audited list.
const EXPECTED_ENVIRONMENT_READS = [
  "src/lib/api/client.ts:PORT",
  "src/lib/config.ts:XDG_CONFIG_HOME",
  "src/lib/db/connection.ts:VITEST",
  "src/lib/db/connection.ts:XDG_CACHE_HOME",
  "src/lib/reviews.ts:PORT",
  "src/routes/api/capabilities.ts:PATH",
];

const EXPECTED_INJECTED_RUNTIME_READS = [
  "src/lib/herdr/socket-path.ts:HERDR_SESSION",
  "src/lib/herdr/socket-path.ts:HERDR_SOCKET_PATH",
  "src/lib/herdr/socket-path.ts:HOME",
  "src/lib/herdr/socket-path.ts:XDG_CONFIG_HOME",
];

describe("environment settings inventory", () => {
  it("keeps application policy out of environment-only switches", () => {
    const reads: string[] = [];
    for (const path of globSync("src/**/*.{ts,tsx}", { cwd: ROOT })) {
      const source = readFileSync(resolve(ROOT, path), "utf8");
      for (const match of source.matchAll(/process\.env\["([A-Z0-9_]+)"\]/g)) {
        reads.push(`${relative(ROOT, resolve(ROOT, path))}:${match[1]}`);
      }
    }

    expect(reads.sort()).toStrictEqual(EXPECTED_ENVIRONMENT_READS.sort());
  });

  it("documents injected Herdr runtime context and build-time context", () => {
    const injectedReads: string[] = [];
    for (const path of globSync("src/**/*.{ts,tsx}", { cwd: ROOT })) {
      const source = readFileSync(resolve(ROOT, path), "utf8");
      for (const match of source.matchAll(/(?<!process\.)\benv\["([A-Z0-9_]+)"\]/g)) {
        injectedReads.push(`${relative(ROOT, resolve(ROOT, path))}:${match[1]}`);
      }
    }

    expect({
      injectedReads: injectedReads.sort(),
      developmentBuildReads: readFileSync(resolve(ROOT, "src/routes/__root.tsx"), "utf8").match(
        /import\.meta\.env\.DEV/g,
      )?.length,
      processEnvironmentPassThrough: readFileSync(
        resolve(ROOT, "src/lib/cli-runner.ts"),
        "utf8",
      ).includes("...process.env"),
    }).toStrictEqual({
      injectedReads: EXPECTED_INJECTED_RUNTIME_READS.sort(),
      developmentBuildReads: 2,
      processEnvironmentPassThrough: true,
    });
  });
});
