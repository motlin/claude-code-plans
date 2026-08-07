import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vite-plus/test";

const IMPORT_SPECIFIER_PATTERN = /(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)["']([^"']+)["']/g;

describe("client entry imports", () => {
  it("only imports the hydration runtime and router", () => {
    const source = readFileSync(resolve(__dirname, "../src/client.tsx"), "utf8");
    const importSpecifiers = [...source.matchAll(IMPORT_SPECIFIER_PATTERN)]
      .map((match) => {
        const specifier = match[1];
        if (specifier === undefined) {
          throw new Error("Import specifier capture is missing");
        }
        return specifier;
      })
      .sort((first, second) => first.localeCompare(second));

    expect(importSpecifiers).toStrictEqual([
      "./router",
      "@tanstack/react-start/client",
      "react-dom/client",
    ]);
  });
});
