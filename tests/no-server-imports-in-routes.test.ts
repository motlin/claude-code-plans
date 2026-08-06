import { describe, expect, it } from "vite-plus/test";
import { build, type Rollup } from "vite-plus";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "..");

function isRollupOutput(result: unknown): result is Rollup.RollupOutput {
  return typeof result === "object" && result !== null && "output" in result;
}

function collectClientChunks(result: Awaited<ReturnType<typeof build>>): Rollup.OutputChunk[] {
  const outputs: Rollup.RollupOutput[] = [];
  if (Array.isArray(result)) {
    for (const r of result) {
      if (isRollupOutput(r)) outputs.push(r);
    }
  } else if (isRollupOutput(result)) {
    outputs.push(result);
  }

  const chunks: Rollup.OutputChunk[] = [];
  for (const output of outputs) {
    for (const item of output.output) {
      if (item.type === "chunk" && !item.fileName.startsWith("server/")) {
        chunks.push(item);
      }
    }
  }
  return chunks;
}

const EXTERNALIZED_PATTERN = /["']node:(fs|fs\/promises|child_process|readline)["']/;

describe("client build must not contain externalized Node built-ins", () => {
  it("no client chunks reference node:fs or node:fs/promises", async () => {
    const result = await build({
      root: ROOT,
      configFile: resolve(ROOT, "vite.config.ts"),
      logLevel: "silent",
      build: {
        write: false,
      },
    });

    const clientChunks = collectClientChunks(result);
    const violations: string[] = [];

    for (const chunk of clientChunks) {
      const matches = chunk.code.match(new RegExp(EXTERNALIZED_PATTERN, "g"));
      if (matches) {
        const uniqueModules = [...new Set(matches.map((m) => m.replace(/["']/g, "")))];
        violations.push(`${chunk.fileName}: ${uniqueModules.join(", ")}`);
      }
    }

    if (violations.length > 0) {
      expect.fail(
        `Client bundle contains references to Node built-in modules:\n` +
          violations.map((v) => `  - ${v}`).join("\n") +
          "\n\nA route file is importing a server-only module at the top level." +
          "\nMove these imports inside API route handlers (src/routes/api/) using dynamic import().",
      );
    }
  }, 60_000);
});
