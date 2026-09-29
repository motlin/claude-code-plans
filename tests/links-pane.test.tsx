// @vitest-environment jsdom

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { useState, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  INCLUDE_TOOLS_AND_THINKING_STORAGE_KEY,
  LINK_ENRICHERS,
  LinksPaneView,
  useExtractedSessionLinks,
  useGroupedSessionLinks,
  useIncludeToolsAndThinking,
  useRegisterLinksPane,
  useSessionLinkDisplay,
} from "../src/components/panes/links-pane";
import { usePaneDefinitions } from "../src/components/panes/pane-registry";
import type { JumpTargetWindow } from "../src/components/jump-target-context";
import { sessionQueryKeys } from "../src/lib/api/sessions";
import { writeClipboardText } from "../src/lib/clipboard";
import { jumpToMessage } from "../src/lib/jump-to-message";
import type { SessionLinks } from "../src/lib/session-links";
import type { SessionLine } from "../src/lib/transcript";
import { installLocalStorage } from "./fake-storage";

vi.mock("../src/lib/clipboard", () => ({
  writeClipboardText: vi.fn(),
}));

vi.mock("../src/lib/jump-to-message", () => ({
  jumpToMessage: vi.fn(),
}));

vi.mock("../src/components/settings-provider", () => ({
  useSettings: () => ({
    settings: { showThinking: true, showTools: true, linkCategoryRules: [] },
  }),
}));

const SESSION_LINKS = {
  groups: [
    {
      categoryId: "GitHub",
      label: "GitHub",
      entries: [
        {
          url: "https://github.com/alice/project/pull/100",
          label: "alice/project#100",
          categoryId: "GitHub",
          occurrences: [
            { source: "visible", anchorIndex: 10, role: "assistant" },
            { source: "tool", anchorIndex: 20, role: "assistant", tool: "Bash" },
          ],
        },
        {
          url: "https://github.com/bob/project/issues/200",
          label: "bob/project#200",
          categoryId: "GitHub",
          occurrences: [{ source: "tool", anchorIndex: 30, role: "assistant", tool: "Bash" }],
        },
      ],
    },
    {
      categoryId: "External",
      label: "External",
      entries: [
        {
          url: "https://docs.example.com/design",
          label: "Design notes",
          categoryId: "External",
          occurrences: [{ source: "thinking", anchorIndex: 40, role: "assistant" }],
        },
        {
          url: "https://example.com/guide",
          label: "Example guide",
          categoryId: "External",
          occurrences: [{ source: "visible", anchorIndex: 50, role: "user" }],
        },
      ],
    },
  ],
  totalCount: 4,
} satisfies SessionLinks;

afterEach(cleanup);

function PaneHarness({
  sessionLinks = SESSION_LINKS,
  unscannedRecordCount = 0,
}: {
  sessionLinks?: SessionLinks;
  unscannedRecordCount?: number;
}) {
  const [includeToolsAndThinking, setIncludeToolsAndThinking] = useState(false);
  const display = useSessionLinkDisplay(sessionLinks, includeToolsAndThinking);

  return (
    <LinksPaneView
      display={display}
      unscannedRecordCount={unscannedRecordCount}
      includeToolsAndThinking={includeToolsAndThinking}
      onIncludeToolsAndThinkingChange={setIncludeToolsAndThinking}
    />
  );
}

describe("LinksPaneView", () => {
  beforeEach(() => {
    installLocalStorage();
    vi.mocked(writeClipboardText).mockReset();
    vi.mocked(jumpToMessage).mockReset();
  });

  it("derives visible counts and occurrence chips from one all-source extraction", () => {
    render(<PaneHarness />);

    expect({
      count: screen.getByLabelText("2 items").textContent,
      labels: screen.getAllByTitle(/^https:/).map((element) => element.textContent),
      jumps: screen
        .getAllByRole("button", { name: /Jump to link mention/ })
        .map((button) => button.getAttribute("aria-label")),
    }).toStrictEqual({
      count: "2",
      labels: ["alice/project#100", "Example guide"],
      jumps: ["Jump to link mention 1", "Jump to link mention 1"],
    });

    fireEvent.click(screen.getByRole("checkbox", { name: "Include tools and thinking" }));

    expect({
      count: screen.getByLabelText("4 items").textContent,
      labels: screen.getAllByTitle(/^https:/).map((element) => element.textContent),
    }).toStrictEqual({
      count: "4",
      labels: ["alice/project#100", "bob/project#200", "Design notes", "Example guide"],
    });
  });

  it("lists loopback dev servers as new-tab Open dev server links with liveness", () => {
    const display = { groups: [], totalCount: 0, hiddenCount: 0 };
    render(
      <LinksPaneView
        display={display}
        devServers={[
          { url: "http://localhost:5173", name: "web", live: true },
          { url: "http://127.0.0.1:3000", live: false },
        ]}
        includeToolsAndThinking={false}
        onIncludeToolsAndThinkingChange={vi.fn()}
      />,
    );

    expect(
      screen.getAllByRole("link", { name: /^Open dev server/ }).map((link) => ({
        name: link.getAttribute("aria-label"),
        href: link.getAttribute("href"),
        target: link.getAttribute("target"),
        rel: link.getAttribute("rel"),
      })),
    ).toStrictEqual([
      {
        name: "Open dev server localhost:5173 in a new tab",
        href: "http://localhost:5173",
        target: "_blank",
        rel: "noopener noreferrer",
      },
      {
        name: "Open dev server 127.0.0.1:3000 in a new tab",
        href: "http://127.0.0.1:3000",
        target: "_blank",
        rel: "noopener noreferrer",
      },
    ]);
    expect(screen.getAllByRole("img").map((dot) => dot.getAttribute("aria-label"))).toStrictEqual([
      "Running",
      "Not responding",
    ]);
    expect(screen.getByTitle("http://localhost:5173").textContent).toBe("web · localhost:5173");
  });

  it("reports the link count as a floor when the transcript window hides earlier records", () => {
    render(<PaneHarness unscannedRecordCount={3200} />);

    expect({
      count: screen.getByLabelText("2 items in the loaded messages").textContent,
      note: screen.getByRole("note").textContent,
    }).toStrictEqual({
      count: "2+",
      note: "Counted from the loaded messages only — 3200 earlier records have not been scanned. Load earlier messages to include them.",
    });
  });

  it("names the hidden count when visible messages contain no links", () => {
    const toolOnlyLinks = {
      groups: [
        {
          categoryId: "External",
          label: "External",
          entries: SESSION_LINKS.groups[1]!.entries.slice(0, 1),
        },
      ],
      totalCount: 1,
    } satisfies SessionLinks;

    render(<PaneHarness sessionLinks={toolOnlyLinks} />);

    expect(screen.getByText(/No links in visible messages/).textContent).toBe(
      "No links in visible messages. Enable 'Include tools and thinking' to see 1 more.",
    );
  });

  it("recomputes categories when user rules or the hydrated host change", () => {
    const lines = [
      {
        type: "user",
        lineIndex: 100,
        message: { role: "user", content: "Read https://docs.example.com/alice" },
      },
    ] satisfies SessionLine[];
    const { result, rerender } = renderHook(
      ({ currentHost, userRules }) => useExtractedSessionLinks(lines, currentHost, userRules),
      {
        initialProps: {
          currentHost: undefined as string | undefined,
          userRules: [] as Array<{ label: string; hostPattern: string }>,
        },
      },
    );

    expect(result.current.groups.map((group) => group.categoryId)).toStrictEqual(["External"]);

    rerender({
      currentHost: undefined,
      userRules: [{ label: "Documentation", hostPattern: "docs.example.com" }],
    });
    expect(result.current.groups.map((group) => group.categoryId)).toStrictEqual(["Documentation"]);

    rerender({
      currentHost: "docs.example.com",
      userRules: [{ label: "Documentation", hostPattern: "docs.example.com" }],
    });
    expect(result.current.groups.map((group) => group.categoryId)).toStrictEqual(["MyHost"]);
  });

  it("categorizes server-collected links in the browser, and holds off until they land", () => {
    const collected = [
      {
        url: "https://docs.example.com/alice",
        label: "docs.example.com/alice",
        occurrences: [{ source: "visible" as const, anchorIndex: 100, role: "user" as const }],
      },
    ];
    const { result, rerender } = renderHook(
      ({ links }) =>
        useGroupedSessionLinks(links, "docs.example.com", [
          { label: "Documentation", hostPattern: "docs.*" },
        ]),
      { initialProps: { links: undefined as typeof collected | undefined } },
    );

    // Undefined until the whole-session scan lands, which is the caller's
    // signal to keep showing the window's own extraction and its `12+` floors.
    expect(result.current).toBeUndefined();

    rerender({ links: collected });
    expect(result.current).toStrictEqual({
      groups: [
        {
          categoryId: "MyHost",
          label: "My Host",
          entries: [
            {
              url: "https://docs.example.com/alice",
              label: "docs.example.com/alice",
              categoryId: "MyHost",
              occurrences: [{ source: "visible", anchorIndex: 100, role: "user" }],
            },
          ],
        },
      ],
      totalCount: 1,
    });
  });

  it("filters case-insensitively by URL or compact label", () => {
    render(<PaneHarness />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Include tools and thinking" }));
    const filter = screen.getByRole("searchbox", { name: "Filter links" });

    fireEvent.change(filter, { target: { value: "BOB/PROJECT" } });
    expect(screen.getAllByTitle(/^https:/).map((element) => element.textContent)).toStrictEqual([
      "bob/project#200",
    ]);

    fireEvent.change(filter, { target: { value: "DOCS.EXAMPLE.COM" } });
    expect(screen.getAllByTitle(/^https:/).map((element) => element.textContent)).toStrictEqual([
      "Design notes",
    ]);
  });

  it("forces matching groups open during a query and restores remembered collapse state", () => {
    render(<PaneHarness />);
    const gitHubHeader = screen.getByRole("button", { name: /GitHub/ });
    const filter = screen.getByRole("searchbox", { name: "Filter links" });

    fireEvent.click(gitHubHeader);
    expect({
      expanded: gitHubHeader.getAttribute("aria-expanded"),
      labels: screen.queryAllByTitle(/^https:/).map((element) => element.textContent),
    }).toStrictEqual({ expanded: "false", labels: ["Example guide"] });

    fireEvent.change(filter, { target: { value: "alice" } });
    expect({
      expanded: gitHubHeader.getAttribute("aria-expanded"),
      labels: screen.getAllByTitle(/^https:/).map((element) => element.textContent),
    }).toStrictEqual({ expanded: "true", labels: ["alice/project#100"] });

    fireEvent.change(filter, { target: { value: "" } });
    expect({
      expanded: gitHubHeader.getAttribute("aria-expanded"),
      labels: screen.queryAllByTitle(/^https:/).map((element) => element.textContent),
    }).toStrictEqual({ expanded: "false", labels: ["Example guide"] });
  });

  it("opens links safely, copies only with success feedback, and jumps to occurrences", async () => {
    vi.mocked(writeClipboardText).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    render(<PaneHarness />);
    const externalLink = screen.getByRole("link", {
      name: "Open alice/project#100 in a new tab",
    });
    const copyButton = screen.getByRole("button", { name: "Copy alice/project#100" });
    const jumpButton = screen.getAllByRole("button", { name: "Jump to link mention 1" })[0]!;

    expect({
      href: externalLink.getAttribute("href"),
      target: externalLink.getAttribute("target"),
      rel: externalLink.getAttribute("rel"),
    }).toStrictEqual({
      href: "https://github.com/alice/project/pull/100",
      target: "_blank",
      rel: "noopener noreferrer",
    });

    fireEvent.click(copyButton);
    await waitFor(() =>
      expect(vi.mocked(writeClipboardText).mock.calls).toStrictEqual([
        ["https://github.com/alice/project/pull/100"],
      ]),
    );
    expect(copyButton.getAttribute("title")).toBe("Copy URL");

    fireEvent.click(copyButton);
    await waitFor(() => expect(copyButton.getAttribute("title")).toBe("Copied"));
    fireEvent.click(jumpButton);

    expect({
      copyCalls: vi.mocked(writeClipboardText).mock.calls,
      jumpCalls: vi.mocked(jumpToMessage).mock.calls,
    }).toStrictEqual({
      copyCalls: [
        ["https://github.com/alice/project/pull/100"],
        ["https://github.com/alice/project/pull/100"],
      ],
      jumpCalls: [[10]],
    });
  });

  it("exports no credentialed enrichers", () => {
    expect(LINK_ENRICHERS).toStrictEqual({});
  });
});

describe("links pane include toggle persistence", () => {
  beforeEach(() => {
    installLocalStorage();
  });

  it("hydrates Include tools and thinking from storage and persists changes", async () => {
    localStorage.setItem(INCLUDE_TOOLS_AND_THINKING_STORAGE_KEY, "true");

    const { result } = renderHook(() => useIncludeToolsAndThinking());
    await waitFor(() => expect(result.current[0]).toBe(true));

    act(() => result.current[1](false));
    await waitFor(() =>
      expect({
        include: result.current[0],
        stored: localStorage.getItem(INCLUDE_TOOLS_AND_THINKING_STORAGE_KEY),
      }).toStrictEqual({ include: false, stored: "false" }),
    );
  });
});

const JUMP_TARGET_WINDOW: JumpTargetWindow = {
  windowStartIndex: 0,
  requestMessageJump: () => {},
};

function RegisterLinksPane({ lines }: { lines: SessionLine[] }) {
  useRegisterLinksPane({
    sessionId: "session-test-100",
    lines,
    windowStartIndex: 0,
    jumpTargetWindow: JUMP_TARGET_WINDOW,
  });
  const definition = usePaneDefinitions().get("links");
  return definition === undefined ? null : (
    <div data-testid="links-pane">
      <h1>{definition.title}</h1>
      {definition.render({ moveHandle: null, controls: null })}
    </div>
  );
}

function withQueryClient(queryClient: QueryClient, children: ReactNode) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe("links pane registration", () => {
  beforeEach(() => {
    installLocalStorage();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => {})),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("registers a Links pane that lists dev servers even when the session has no links", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(sessionQueryKeys.resources("session-test-100"), {
      files: { entries: [], totalCount: 0 },
      links: [],
    });
    queryClient.setQueryData(sessionQueryKeys.devServers("session-test-100"), {
      servers: [{ url: "http://localhost:5173", live: true }],
    });

    render(withQueryClient(queryClient, <RegisterLinksPane lines={[]} />));

    expect({
      title: screen.getByRole("heading", { level: 1 }).textContent,
      devServers: screen
        .getAllByRole("link", { name: /^Open dev server/ })
        .map((link) => link.getAttribute("href")),
      empty: screen.getByText(/^No links/).textContent,
    }).toStrictEqual({
      title: "Links",
      devServers: ["http://localhost:5173"],
      empty: "No links in visible messages.",
    });
  });

  it("falls back to the loaded window's links, as a floor, until the session scan lands", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const lines = [
      {
        type: "user",
        lineIndex: 100,
        message: { role: "user", content: "Read https://example.com/guide" },
      },
    ] satisfies SessionLine[];

    render(withQueryClient(queryClient, <RegisterLinksPane lines={lines} />));

    expect(screen.getAllByTitle(/^https:/).map((element) => element.textContent)).toStrictEqual([
      "example.com/guide",
    ]);
  });
});

describe("drawer shell removal", () => {
  it("leaves no session-drawer module and no source importing one", () => {
    const root = path.resolve(import.meta.dirname, "..");
    const sourceFiles = (readdirSync(path.join(root, "src"), { recursive: true }) as string[])
      .filter((file) => /\.tsx?$/.test(file))
      .filter((file) =>
        /session-drawer|links-drawer/.test(readFileSync(path.join(root, "src", file), "utf8")),
      );

    expect({
      sessionDrawer: existsSync(path.join(root, "src/components/session-drawer.tsx")),
      sessionDrawerStory: existsSync(path.join(root, "src/components/session-drawer.stories.tsx")),
      linksDrawer: existsSync(path.join(root, "src/components/links-drawer.tsx")),
      importers: sourceFiles,
    }).toStrictEqual({
      sessionDrawer: false,
      sessionDrawerStory: false,
      linksDrawer: false,
      importers: [],
    });
  });
});
