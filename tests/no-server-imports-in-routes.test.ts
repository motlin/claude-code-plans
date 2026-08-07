import { beforeAll, describe, expect, it } from "vite-plus/test";
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
const CLIENT_ENTRY_PATTERN = /[\\/]src[\\/]client\.tsx$/;
const SHIKI_LANGUAGE_PATTERN = /[\\/]shiki[\\/]langs[\\/]/;
const RESOLVED_SHIKI_LANGUAGE_PATTERN = /[\\/]shiki[\\/]dist[\\/]langs[\\/]/;
const MARKDOWN_IT_PATTERN = /[\\/]node_modules[\\/]markdown-it[\\/]/;

function isShikiLanguage(moduleId: string): boolean {
  return SHIKI_LANGUAGE_PATTERN.test(moduleId) || RESOLVED_SHIKI_LANGUAGE_PATTERN.test(moduleId);
}

describe("client build boundaries", () => {
  let clientChunks: Rollup.OutputChunk[];

  beforeAll(async () => {
    const result = await build({
      root: ROOT,
      configFile: resolve(ROOT, "vite.config.ts"),
      logLevel: "silent",
      build: {
        write: false,
      },
    });

    clientChunks = collectClientChunks(result);
  }, 60_000);

  it("no client chunks reference node:fs or node:fs/promises", () => {
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
  });

  it("keeps Shiki grammars and markdown-it out of the static client entry graph", () => {
    const entryChunk = clientChunks.find(
      (chunk) =>
        chunk.isEntry && chunk.moduleIds.some((moduleId) => CLIENT_ENTRY_PATTERN.test(moduleId)),
    );
    if (!entryChunk) {
      expect.fail("Could not find the client entry chunk containing src/client.tsx.");
    }

    const chunksByFileName = new Map(clientChunks.map((chunk) => [chunk.fileName, chunk]));
    const staticClosure = new Set<Rollup.OutputChunk>();
    const chunksToVisit = [entryChunk];

    while (chunksToVisit.length > 0) {
      const chunk = chunksToVisit.pop();
      if (!chunk || staticClosure.has(chunk)) continue;

      staticClosure.add(chunk);
      for (const importedFileName of chunk.imports) {
        const importedChunk = chunksByFileName.get(importedFileName);
        if (!importedChunk) {
          expect.fail(`Could not find statically imported client chunk ${importedFileName}.`);
        }
        chunksToVisit.push(importedChunk);
      }
    }

    const violations = new Set<string>();
    for (const chunk of staticClosure) {
      for (const moduleId of chunk.moduleIds) {
        if (isShikiLanguage(moduleId)) {
          violations.add(`${chunk.fileName}: ${moduleId}`);
        }
        if (MARKDOWN_IT_PATTERN.test(moduleId)) {
          violations.add(`${chunk.fileName}: ${moduleId}`);
        }
      }

      for (const dynamicallyImportedFileName of chunk.dynamicImports) {
        const dynamicallyImportedChunk = chunksByFileName.get(dynamicallyImportedFileName);
        if (!dynamicallyImportedChunk) {
          expect.fail(
            `Could not find dynamically imported client chunk ${dynamicallyImportedFileName}.`,
          );
        }
        for (const moduleId of dynamicallyImportedChunk.moduleIds) {
          if (isShikiLanguage(moduleId)) {
            violations.add(
              `${chunk.fileName} -> ${dynamicallyImportedChunk.fileName}: ${moduleId}`,
            );
          }
        }
      }
    }

    expect([...violations].sort()).toStrictEqual([]);
  });
});
