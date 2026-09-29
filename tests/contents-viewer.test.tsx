// @vitest-environment jsdom

import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import type { ReactElement } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  ContentsViewer,
  type ContentsFileQuery,
} from "../src/components/customize/contents-viewer";
import {
  defaultContentsFile,
  orderContentsTree,
  stripFrontmatter,
} from "../src/components/customize/contents-order";
import { SkillOverview } from "../src/components/customize/skill-detail";
import { splitAllowedTools } from "../src/lib/customize/skills";
import { readFileUnderRoot } from "../src/lib/file-serving";

const useHighlightedLines = vi.hoisted(() =>
  vi.fn<(code: string, language: string | null) => null>(() => null),
);

vi.mock("../src/hooks/use-shiki", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/hooks/use-shiki")>()),
  useHighlightedLines,
}));

describe("orderContentsTree", () => {
  it("puts SKILL.md then README.md first, then folders, then files, recursively", () => {
    expect(
      orderContentsTree([
        { path: "zeta.txt" },
        { path: "README.md" },
        {
          path: "scripts",
          children: [{ path: "scripts/run.py" }, { path: "scripts/lib", children: [] }],
        },
        { path: "alpha.md" },
        { path: "SKILL.md" },
        { path: "assets", children: [{ path: "assets/logo.svg" }] },
      ]),
    ).toStrictEqual([
      { path: "SKILL.md" },
      { path: "README.md" },
      { path: "assets", children: [{ path: "assets/logo.svg" }] },
      {
        path: "scripts",
        children: [{ path: "scripts/lib", children: [] }, { path: "scripts/run.py" }],
      },
      { path: "alpha.md" },
      { path: "zeta.txt" },
    ]);
  });

  it("selects the first priority file, else the first file in tree order", () => {
    expect([
      defaultContentsFile(orderContentsTree([{ path: "b.txt" }, { path: "README.md" }])),
      defaultContentsFile(
        orderContentsTree([{ path: "z.txt" }, { path: "docs", children: [{ path: "docs/a.md" }] }]),
      ),
      defaultContentsFile([]),
    ]).toStrictEqual(["README.md", "docs/a.md", null]);
  });
});

describe("stripFrontmatter", () => {
  it("drops a leading --- fenced block and keeps the body", () => {
    expect([
      stripFrontmatter("---\nname: x\n---\n\n# Title\n"),
      stripFrontmatter("# No frontmatter\n"),
    ]).toStrictEqual(["# Title\n", "# No frontmatter\n"]);
  });
});

describe("splitAllowedTools", () => {
  it("splits on commas and whitespace outside parentheses", () => {
    expect([
      splitAllowedTools("Read, Grep Glob"),
      splitAllowedTools("Bash(git add:*), Bash(git status:*)"),
      splitAllowedTools(["Read", "Bash(ls *)"]),
      splitAllowedTools(undefined),
    ]).toStrictEqual([
      ["Read", "Grep", "Glob"],
      ["Bash(git add:*)", "Bash(git status:*)"],
      ["Read", "Bash(ls *)"],
      [],
    ]);
  });
});

describe("readFileUnderRoot", () => {
  let root: string;
  let skillDir: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "contents-viewer-"));
    skillDir = join(root, "skill");
    mkdirSync(join(skillDir, "scripts"), { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), "# Skill\n");
    writeFileSync(join(skillDir, "scripts", "run.py"), "print('hi')\n");
    writeFileSync(join(root, "secret.txt"), "top secret\n");
    symlinkSync(join(root, "secret.txt"), join(skillDir, "escape.txt"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  async function outcome(relativePath: string) {
    try {
      const file = await readFileUnderRoot(skillDir, relativePath);
      return { content: file.content };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : String(error),
        status: (error as { status?: number }).status,
      };
    }
  }

  it("reads files inside the root and refuses traversal, absolute paths and escaping symlinks", async () => {
    expect({
      nested: await outcome("scripts/run.py"),
      dotDot: await outcome("../secret.txt"),
      nestedDotDot: await outcome("scripts/../../secret.txt"),
      absolute: await outcome(join(root, "secret.txt")),
      symlink: await outcome("escape.txt"),
      empty: await outcome(""),
      missing: await outcome("nope.md"),
      directory: await outcome("scripts"),
    }).toStrictEqual({
      nested: { content: "print('hi')\n" },
      dotDot: { error: "A relative path inside the root is required", status: 400 },
      nestedDotDot: { error: "A relative path inside the root is required", status: 400 },
      absolute: { error: "A relative path inside the root is required", status: 400 },
      symlink: { error: "File path is not allowed", status: 403 },
      empty: { error: "A relative path inside the root is required", status: 400 },
      missing: { error: "File not found", status: 404 },
      directory: { error: "File path is not a regular file", status: 403 },
    });
  });
});

describe("ContentsViewer", () => {
  const FILES: Record<string, string> = {
    "SKILL.md": "---\nname: demo\n---\n\n# Demo skill\n",
    "scripts/run.py": "print('hi')\n",
  };

  const fileQuery: ContentsFileQuery = (path) => ({
    queryKey: ["contents-test", path],
    queryFn: () => Promise.resolve({ path, content: FILES[path] ?? "" }),
  });

  afterEach(() => {
    cleanup();
  });

  async function renderViewer() {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <ContentsViewer
          name="demo"
          tree={[{ path: "scripts", children: [{ path: "scripts/run.py" }] }, { path: "SKILL.md" }]}
          fileQuery={fileQuery}
        />
      </QueryClientProvider>,
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  it("shows Preview/Code for SKILL.md and hides it for a .py file", async () => {
    await renderViewer();

    const markdownState = {
      path: screen.getByTestId("contents-path").textContent,
      modes: screen
        .getAllByRole("radio")
        .map((radio) => [radio.getAttribute("aria-label"), radio.getAttribute("aria-checked")]),
      heading: (await screen.findByRole("heading", { level: 1 })).textContent,
      version: screen.getByRole("combobox", { name: "Version" }).textContent,
    };

    fireEvent.click(screen.getByRole("treeitem", { name: "run.py" }));
    const firstLine = await screen.findByRole("cell", { name: "Go to line 1" });

    expect({
      markdownState,
      pythonState: {
        path: screen.getByTestId("contents-path").textContent,
        modeControl: screen.queryByRole("radiogroup", { name: "File view mode" }),
        code: firstLine.textContent,
      },
    }).toStrictEqual({
      markdownState: {
        path: "/SKILL.md",
        modes: [
          ["Preview", "true"],
          ["Code", "false"],
        ],
        heading: "Demo skill",
        version: "demo · current",
      },
      pythonState: {
        path: "/scripts/run.py",
        modeControl: null,
        code: "1",
      },
    });
  });

  it("switches markdown to Code with line numbers including the frontmatter", async () => {
    await renderViewer();
    await screen.findByRole("heading", { level: 1 });
    fireEvent.click(screen.getByRole("radio", { name: "Code" }));

    expect(
      [...document.querySelectorAll("[role=row] code")].map((line) => line.textContent),
    ).toStrictEqual(["---", "name: demo", "---", "", "# Demo skill", ""]);
  });

  it("exposes a 244px file list resizable between 160 and 520", async () => {
    await renderViewer();
    const separator = screen.getByRole("separator", { name: "Resize file list" });
    fireEvent.keyDown(separator, { key: "End" });

    expect({
      min: separator.getAttribute("aria-valuemin"),
      max: separator.getAttribute("aria-valuemax"),
      now: separator.getAttribute("aria-valuenow"),
    }).toStrictEqual({ min: "160", max: "520", now: "520" });
  });
});

async function renderInRouter(element: ReactElement) {
  const rootRoute = createRootRoute({ component: () => element });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  render(<RouterProvider router={router} />);
}

describe("SkillOverview", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the description and the Source, Invocation and Allowed tools cards", async () => {
    await renderInRouter(
      <SkillOverview
        detail={{
          skill: {
            id: "plugin:tools@market:lint",
            name: "lint",
            description: "Lint code.\nTwice.",
            source: "plugin",
            sourceLabel: "tools",
            dir: "/Users/test/.claude/plugins/cache/tools/skills/lint",
            mtime: Date.parse("2026-09-15T12:00:00Z"),
            enabled: true,
          },
          pluginId: "tools@market",
          userInvocable: true,
          modelInvocable: false,
          allowedTools: ["Read", "Bash(git diff:*)"],
          argumentHint: "<path>",
          tree: [],
        }}
      />,
    );
    await screen.findByTestId("skill-description");

    expect({
      description: screen.getByTestId("skill-description").textContent,
      cards: screen
        .getAllByRole("complementary")
        .flatMap((aside) => [...aside.querySelectorAll("section")].map((card) => card.textContent)),
      pluginLink: screen.getByRole("link", { name: "tools" }).getAttribute("href"),
    }).toStrictEqual({
      description: "Lint code.\nTwice.",
      cards: [
        "Source/Users/test/.claude/plugins/cache/tools/skills/linttools",
        "Invocation/tools:lint <path>User-invocableYesModel-invocableNo",
        "Allowed toolsReadBash(git diff:*)",
      ],
      pluginLink: "/customize/plugins?q=tools",
    });
  });
});
