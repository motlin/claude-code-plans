// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { ChangedFilesSidebar } from "../src/components/changes/changes-file-tree";

const FILES = [
  { path: ".github/workflows/push.yml", additions: 3, deletions: 1 },
  { path: "src/app.ts", additions: 158, deletions: 0 },
  { path: "tests/app.test.ts", additions: 0, deletions: 21 },
];

const COMMITS = [
  {
    sha: "07bc05d1111111111111111111111111111111111",
    shortSha: "07bc05d",
    subject: "Fetch logs from both servers",
    author: "Craig P. Motlin",
    date: "2026-09-14T20:29:26.000Z",
  },
];

type SidebarOverrides = Partial<
  Omit<
    Parameters<typeof ChangedFilesSidebar>[0],
    "onSelectFile" | "onSelectCommit" | "onCopyCommitSha"
  >
>;

function renderSidebar(overrides: SidebarOverrides = {}) {
  const handlers = {
    onSelectFile: vi.fn<(path: string) => void>(),
    onSelectCommit: vi.fn<(sha: string | null) => void>(),
    onCopyCommitSha: vi.fn<(sha: string) => void>(),
  };
  render(
    <ChangedFilesSidebar
      files={FILES}
      groupByFolder
      groupByKind={false}
      activePath={null}
      commits={COMMITS}
      selectedCommitSha={null}
      {...handlers}
      {...overrides}
    />,
  );
  return handlers;
}

function treeRows(): string[] {
  return within(screen.getByRole("tree", { name: "Changed files" }))
    .getAllByRole("treeitem")
    .map((row) => `${row.getAttribute("aria-level")} ${row.textContent}`);
}

afterEach(() => {
  cleanup();
});

describe("ChangedFilesSidebar", () => {
  it("renders compacted directories and ± counts with no status letters", () => {
    renderSidebar();

    expect(treeRows()).toEqual([
      "1 .github/workflows",
      "2 push.yml+3−1",
      "1 src",
      "2 app.ts+158−0",
      "1 tests",
      "2 app.test.ts+0−21",
    ]);
  });

  it("collapses a directory when its row is clicked", () => {
    renderSidebar();

    const dir = screen.getByRole("treeitem", { name: /^\.github\/workflows/ });
    fireEvent.click(dir);

    expect({ expanded: dir.getAttribute("aria-expanded"), rows: treeRows() }).toEqual({
      expanded: "false",
      rows: ["1 .github/workflows", "1 src", "2 app.ts+158−0", "1 tests", "2 app.test.ts+0−21"],
    });
  });

  it("renders trailing kind sections when separating test, build, and generated files", () => {
    renderSidebar({ groupByFolder: false });
    expect(screen.queryByText("Test files")).toBeNull();
    cleanup();

    renderSidebar({ groupByFolder: false, groupByKind: true });
    const tree = screen.getByRole("tree", { name: "Changed files" });
    expect(
      [...tree.querySelectorAll("[data-diff-tree-section-label], [data-diff-tree-row]")].map(
        (element) => element.textContent,
      ),
    ).toEqual([
      "app.tssrc+158−0",
      "Test files",
      "app.test.tstests+0−21",
      "Build files",
      "push.yml.github/workflows+3−1",
    ]);
  });

  it("marks the active file with aria-current and selects files on click", () => {
    const props = renderSidebar({ activePath: "src/app.ts" });

    const current = screen
      .getAllByRole("treeitem")
      .filter((row) => row.getAttribute("aria-current") === "true")
      .map((row) => row.textContent);
    fireEvent.click(screen.getByRole("treeitem", { name: /^push\.yml/ }));
    fireEvent.click(screen.getByRole("treeitem", { name: /^app\.test\.ts/ }), { metaKey: true });

    expect({
      current,
      selected: props.onSelectFile.mock.calls,
    }).toEqual({ current: ["app.ts+158−0"], selected: [[".github/workflows/push.yml"]] });
  });

  it("opens instead of jumping on Cmd/Ctrl+click when an open handler is given", () => {
    const onOpenFile = vi.fn();
    const props = renderSidebar({ onOpenFile });

    fireEvent.click(screen.getByRole("treeitem", { name: /^app\.test\.ts/ }), { ctrlKey: true });

    expect({ opened: onOpenFile.mock.calls, selected: props.onSelectFile.mock.calls }).toEqual({
      opened: [["tests/app.test.ts"]],
      selected: [],
    });
  });

  it("resizes the file list with the keyboard between 160 and 640 pixels", () => {
    renderSidebar();
    const handle = screen.getByRole("separator", { name: "Resize file list" });
    const widths: Array<string | null> = [handle.getAttribute("aria-valuenow")];

    fireEvent.keyDown(handle, { key: "ArrowRight" });
    widths.push(handle.getAttribute("aria-valuenow"));
    fireEvent.keyDown(handle, { key: "End" });
    widths.push(handle.getAttribute("aria-valuenow"));
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    widths.push(handle.getAttribute("aria-valuenow"));
    fireEvent.keyDown(handle, { key: "Home" });
    widths.push(handle.getAttribute("aria-valuenow"));
    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    widths.push(handle.getAttribute("aria-valuenow"));

    expect({
      widths,
      min: handle.getAttribute("aria-valuemin"),
      max: handle.getAttribute("aria-valuemax"),
      style: handle.parentElement?.style.width,
    }).toEqual({
      widths: ["240", "248", "640", "640", "160", "160"],
      min: "160",
      max: "640",
      style: "160px",
    });
  });

  it("lists All changes and each commit, selecting and copying commits", () => {
    const props = renderSidebar();
    const toolbar = screen.getByRole("toolbar", { name: "Commits" });
    const rows = within(toolbar)
      .getAllByRole("button")
      .map((button) => [
        button.getAttribute("aria-label") ?? button.textContent,
        button.getAttribute("aria-pressed"),
      ]);

    fireEvent.click(within(toolbar).getByRole("button", { name: /^Fetch logs/ }));
    fireEvent.click(within(toolbar).getByRole("button", { name: "Copy commit SHA" }));
    fireEvent.click(within(toolbar).getByRole("button", { name: "All changes" }));

    expect({
      rows: rows.map(([label, pressed]) => [label?.replace(/·[^·]*ago$/, "· <time>"), pressed]),
      selected: props.onSelectCommit.mock.calls,
      copied: props.onCopyCommitSha.mock.calls,
      time: toolbar.querySelector("time")?.getAttribute("datetime"),
    }).toEqual({
      rows: [
        ["All changes", "true"],
        ["Fetch logs from both servers07bc05d·Craig P. Motlin· <time>", "false"],
        ["Copy commit SHA", null],
      ],
      selected: [["07bc05d1111111111111111111111111111111111"], [null]],
      copied: [["07bc05d1111111111111111111111111111111111"]],
      time: "2026-09-14T20:29:26.000Z",
    });
  });

  it("presses the selected commit and hides the commit list when there are no commits", () => {
    renderSidebar({ selectedCommitSha: COMMITS[0]?.sha ?? null });
    const pressed = within(screen.getByRole("toolbar", { name: "Commits" }))
      .getAllByRole("button", { pressed: true })
      .map((button) => button.textContent?.slice(0, 10));
    cleanup();

    renderSidebar({ commits: [] });

    expect({ pressed, toolbar: screen.queryByRole("toolbar", { name: "Commits" }) }).toEqual({
      pressed: ["Fetch logs"],
      toolbar: null,
    });
  });
});
