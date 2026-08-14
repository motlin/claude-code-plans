// @vitest-environment jsdom

import { readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { ChromeDevtoolsRenderer } from "../src/components/tool-renderers/chrome-devtools-renderer";
import { ClaudeInChromeRenderer } from "../src/components/tool-renderers/claude-in-chrome-renderer";
import { GithubRenderer } from "../src/components/tool-renderers/github-renderer";
import { PlaywrightRenderer } from "../src/components/tool-renderers/playwright-renderer";
import type { ClientToolCall } from "../src/components/tool-renderers/types";

const SRC_DIR = resolve(__dirname, "..", "src");
const GLOBALS_CSS = resolve(SRC_DIR, "styles", "globals.css");

/**
 * shadcn/ui class names whose backing custom properties this app never defines.
 * Tailwind emits `color: var(--color-muted-foreground)` for them, which resolves
 * to nothing, so the utility silently falls back to the inherited value.
 */
const UNDEFINED_SHADCN_UTILITIES = [
  "bg-muted",
  "bg-background",
  "bg-card",
  "bg-popover",
  "text-muted-foreground",
  "text-foreground",
  "text-card-foreground",
  "text-primary-foreground",
  "border-input",
];

const SHADCN_CUSTOM_PROPERTIES = [
  "--color-muted",
  "--color-muted-foreground",
  "--color-foreground",
  "--color-background",
  "--color-card",
  "--color-card-foreground",
  "--color-popover",
  "--color-primary-foreground",
  "--color-input",
];

function collectSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectSourceFiles(fullPath));
    } else if (entry.name.endsWith(".tsx") || entry.name.endsWith(".ts")) {
      files.push(fullPath);
    }
  }
  return files.sort();
}

function toolCall(name: string, input: Record<string, unknown>, result: string): ClientToolCall {
  return {
    id: "tool-call-1",
    name,
    input,
    param: "",
    result,
    sourceUuid: "source-1",
  };
}

afterEach(cleanup);

describe("undefined shadcn tokens", () => {
  it("globals.css defines none of the shadcn color custom properties", () => {
    const css = readFileSync(GLOBALS_CSS, "utf8");
    const defined = SHADCN_CUSTOM_PROPERTIES.filter((property) =>
      new RegExp(`^\\s*${property}\\s*:`, "m").test(css),
    );
    expect(defined).toStrictEqual([]);
  });

  it("no source file uses a shadcn utility that compiles to nothing", () => {
    const pattern = new RegExp(
      `(?<![\\w-])(?:hover:|focus:|group-hover:|dark:)?(?:${UNDEFINED_SHADCN_UTILITIES.join("|")})(?![\\w-])`,
    );
    const offenders = collectSourceFiles(SRC_DIR)
      .filter((file) => pattern.test(readFileSync(file, "utf8")))
      .map((file) => relative(SRC_DIR, file));
    expect(offenders).toStrictEqual([]);
  });
});

describe("MCP renderers use transcript design tokens", () => {
  it("no source file uses the retired assistant-prefixed text utilities", () => {
    const retiredUtility = /text-assistant-(?:primary|secondary)/;
    const offenders = collectSourceFiles(SRC_DIR)
      .filter((file) => retiredUtility.test(readFileSync(file, "utf8")))
      .map((file) => relative(SRC_DIR, file));
    expect(offenders).toStrictEqual([]);
  });

  it("renders chrome-devtools console output with token classes", () => {
    const { container } = render(
      <ChromeDevtoolsRenderer
        toolCall={toolCall(
          "mcp__plugin_chrome-devtools-mcp_chrome-devtools__list_console_messages",
          {},
          "msgid=1 [log] Hello world",
        )}
      />,
    );
    const html = container.innerHTML;
    expect(html).toContain("text-secondary");
    expect(html).not.toContain("text-muted-foreground");
    expect(html).not.toContain("text-foreground");
  });

  it("renders claude-in-chrome tab context with token classes", () => {
    const { container } = render(
      <ClaudeInChromeRenderer
        toolCall={toolCall("mcp__claude-in-chrome__tabs_context_mcp", {}, "tab 1\ntab 2")}
      />,
    );
    const html = container.innerHTML;
    expect(html).toContain("bg-t1 rounded-r6");
    expect(html).toContain("text-secondary text-code font-mono");
    expect(html).not.toContain("bg-muted");
    expect(html).not.toContain("text-muted-foreground");
  });

  it("renders playwright console messages with token classes", () => {
    const { container } = render(
      <PlaywrightRenderer
        toolCall={toolCall(
          "mcp__plugin_playwright_playwright__browser_console_messages",
          {},
          "[LOG] hello",
        )}
      />,
    );
    const html = container.innerHTML;
    expect(html).toContain("hover:bg-t2 rounded-r6");
    expect(html).toContain("text-secondary");
    expect(html).not.toContain("hover:bg-muted");
    expect(html).not.toContain("text-muted-foreground");
  });

  it("renders github default output with token classes", () => {
    const { container } = render(
      <GithubRenderer
        toolCall={toolCall("mcp__github__get_me", {}, "some plain github response text")}
      />,
    );
    const html = container.innerHTML;
    expect(html).toContain("text-secondary");
    expect(html).not.toContain("text-muted-foreground");
    expect(html).not.toContain("text-foreground");
  });
});
