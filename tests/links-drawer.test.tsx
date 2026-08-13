// @vitest-environment jsdom

import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  DEFAULT_FILE_SOURCE_SELECTION,
  FILE_SOURCE_SELECTION_STORAGE_KEY,
  OPEN_DRAWER_STORAGE_KEY,
  useFilesDrawerState,
} from "../src/components/files-drawer";
import {
  INCLUDE_TOOLS_AND_THINKING_STORAGE_KEY,
  LINK_ENRICHERS,
  LinksDrawer,
  LinksDrawerToggle,
  useExtractedSessionLinks,
  useLinksDrawerState,
  useSessionLinkDisplay,
} from "../src/components/links-drawer";
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
  useSettings: () => ({ settings: { showThinking: true, showTools: true } }),
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

function DrawerHarness({
  sessionLinks = SESSION_LINKS,
  unscannedRecordCount = 0,
}: {
  sessionLinks?: SessionLinks;
  unscannedRecordCount?: number;
}) {
  const [includeToolsAndThinking, setIncludeToolsAndThinking] = useState(false);
  const display = useSessionLinkDisplay(sessionLinks, includeToolsAndThinking);

  return (
    <LinksDrawer
      display={display}
      unscannedRecordCount={unscannedRecordCount}
      includeToolsAndThinking={includeToolsAndThinking}
      onIncludeToolsAndThinkingChange={setIncludeToolsAndThinking}
      onClose={vi.fn()}
    />
  );
}

describe("LinksDrawer", () => {
  beforeEach(() => {
    installLocalStorage();
    vi.mocked(writeClipboardText).mockReset();
    vi.mocked(jumpToMessage).mockReset();
  });

  it("derives visible counts and occurrence chips from one all-source extraction", () => {
    render(<DrawerHarness />);

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

  it("reports the link count as a floor when the transcript window hides earlier records", () => {
    render(<DrawerHarness unscannedRecordCount={3200} />);

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

    render(<DrawerHarness sessionLinks={toolOnlyLinks} />);

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

  it("filters case-insensitively by URL or compact label", () => {
    render(<DrawerHarness />);
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
    render(<DrawerHarness />);
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
    render(<DrawerHarness />);
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

  it("marks the Links pill as a floor while earlier records are unscanned", () => {
    render(
      <LinksDrawerToggle count={3} unscannedRecordCount={3200} isOpen={false} onToggle={vi.fn()} />,
    );

    const pill = screen.getByRole("button", { name: "Links 3+" });
    expect(pill.getAttribute("title")).toBe(
      "Counted from the loaded messages only — 3200 earlier records have not been scanned. Load earlier messages to include them.",
    );
  });

  it("exports no credentialed enrichers and disables a zero-count pill", () => {
    const onToggle = vi.fn();
    render(<LinksDrawerToggle count={0} isOpen={false} onToggle={onToggle} />);

    fireEvent.click(screen.getByRole("button", { name: "Links 0" }));

    expect({
      enrichers: LINK_ENRICHERS,
      disabled: (screen.getByRole("button", { name: "Links 0" }) as HTMLButtonElement).disabled,
      toggleCalls: onToggle.mock.calls,
    }).toStrictEqual({ enrichers: {}, disabled: true, toggleCalls: [] });
  });
});

describe("session drawer persistence", () => {
  beforeEach(() => {
    installLocalStorage();
  });

  it("hydrates one validated drawer value and keeps Files and Links mutually exclusive", async () => {
    localStorage.setItem(OPEN_DRAWER_STORAGE_KEY, "files");
    localStorage.setItem(
      FILE_SOURCE_SELECTION_STORAGE_KEY,
      JSON.stringify(DEFAULT_FILE_SOURCE_SELECTION),
    );
    localStorage.setItem(INCLUDE_TOOLS_AND_THINKING_STORAGE_KEY, "true");

    const { result } = renderHook(() => ({
      drawers: useFilesDrawerState(),
      links: useLinksDrawerState(),
    }));
    await waitFor(() => {
      expect({
        openDrawer: result.current.drawers.openDrawer,
        includeToolsAndThinking: result.current.links.includeToolsAndThinking,
      }).toStrictEqual({ openDrawer: "files", includeToolsAndThinking: true });
    });

    act(() => result.current.drawers.toggleLinksDrawer());
    await waitFor(() =>
      expect({
        openDrawer: result.current.drawers.openDrawer,
        storedDrawer: localStorage.getItem(OPEN_DRAWER_STORAGE_KEY),
      }).toStrictEqual({ openDrawer: "links", storedDrawer: "links" }),
    );

    act(() => result.current.drawers.toggleFilesDrawer());
    await waitFor(() =>
      expect({
        openDrawer: result.current.drawers.openDrawer,
        storedDrawer: localStorage.getItem(OPEN_DRAWER_STORAGE_KEY),
        storedInclude: localStorage.getItem(INCLUDE_TOOLS_AND_THINKING_STORAGE_KEY),
      }).toStrictEqual({ openDrawer: "files", storedDrawer: "files", storedInclude: "true" }),
    );
  });
});
