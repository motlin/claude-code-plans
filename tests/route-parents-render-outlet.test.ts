import { readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vite-plus/test";

const ROUTES_DIR = resolve(__dirname, "..", "src", "routes");

function collectRouteFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...collectRouteFiles(fullPath));
    else if (entry.name.endsWith(".tsx") || entry.name.endsWith(".ts")) files.push(fullPath);
  }
  return files.sort();
}

/** `src/routes/herdr.terminal.$sessionId.tsx` -> `herdr.terminal.$sessionId` */
function routeId(file: string): string {
  return relative(ROUTES_DIR, file).replace(/\.tsx?$/, "");
}

/**
 * Flat file routing nests `a.b` under `a` whenever `a` exists as a route. A
 * trailing underscore (`a_.b`) is the documented opt-out from that layout.
 */
function parentRouteId(id: string, byId: Map<string, string>): string | null {
  const segments = id.split(".");
  for (let end = segments.length - 1; end > 0; end -= 1) {
    const candidate = segments.slice(0, end).join(".");
    if (candidate.endsWith("_")) return null;
    if (byId.has(candidate)) return candidate;
  }
  return null;
}

/** API routes only declare `server.handlers`, so they render nothing to nest into. */
const RENDERS_A_COMPONENT = /^\s*component:\s*[A-Za-z_$][\w$]*\s*,?\s*$/m;

/**
 * A route that owns children is a layout route: TanStack renders the child
 * through the parent's `<Outlet />`. A parent without one silently swallows
 * every child route — the URL and document title change while the child
 * component never mounts, so the page renders the parent instead.
 */
describe("parent routes must render an Outlet", () => {
  it("every route file with nested children renders <Outlet />", () => {
    const files = collectRouteFiles(ROUTES_DIR);
    const byId = new Map(files.map((file) => [routeId(file), file]));

    const parents = new Set<string>();
    for (const id of byId.keys()) {
      const parent = parentRouteId(id, byId);
      if (parent !== null) parents.add(parent);
    }

    const violations: string[] = [];
    for (const parent of [...parents].sort()) {
      const source = readFileSync(byId.get(parent)!, "utf8");
      if (!RENDERS_A_COMPONENT.test(source)) continue;
      if (!source.includes("<Outlet")) violations.push(parent);
    }

    expect(violations).toStrictEqual([]);
  });
});
