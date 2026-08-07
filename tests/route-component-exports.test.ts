import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vite-plus/test";

const ROUTES_DIR = resolve(__dirname, "..", "src", "routes");

function collectRouteFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectRouteFiles(fullPath));
    } else if (entry.name.endsWith(".tsx")) {
      files.push(fullPath);
    }
  }
  return files.sort();
}

const ROUTE_COMPONENT_OPTION =
  /^\s*(?:component|errorComponent|pendingComponent|notFoundComponent|shellComponent):\s*([A-Za-z_$][\w$]*)\s*,?\s*$/gm;

const EXPORTED_DECLARATION =
  /^export\s+(?:async\s+)?(?:function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm;

const EXPORTED_SPECIFIER_LIST = /^export\s*\{([^}]*)\}/gm;

function routeComponentNames(source: string): Set<string> {
  const names = new Set<string>();
  for (const match of source.matchAll(ROUTE_COMPONENT_OPTION)) {
    names.add(match[1]!);
  }
  return names;
}

function exportedNames(source: string): Set<string> {
  const names = new Set<string>();
  for (const match of source.matchAll(EXPORTED_DECLARATION)) {
    names.add(match[1]!);
  }
  for (const match of source.matchAll(EXPORTED_SPECIFIER_LIST)) {
    for (const specifier of match[1]!.split(",")) {
      const local = specifier
        .trim()
        .split(/\s+as\s+/)[0]
        ?.trim();
      if (local) names.add(local);
    }
  }
  return names;
}

describe("route components must not be exported from route files", () => {
  it("no route file exports a component it passes to a route option", () => {
    const violations: string[] = [];

    for (const file of collectRouteFiles(ROUTES_DIR)) {
      const source = readFileSync(file, "utf8");
      const exported = exportedNames(source);
      for (const component of routeComponentNames(source)) {
        if (exported.has(component)) {
          violations.push(`${file.slice(ROUTES_DIR.length + 1)}: ${component}`);
        }
      }
    }

    expect(violations).toStrictEqual([]);
  });
});
