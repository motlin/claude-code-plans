// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { ChangesPane, ChangesPaneView } from "../src/components/changes/changes-pane";
import { ToastProvider } from "../src/components/toast";
import type { SessionDiffResponse, SessionDiffScopesResponse } from "../src/lib/api/session-diff";
import { PANE_LAYOUT_STORAGE_KEY, defaultPaneLayout } from "../src/lib/pane-layout";
import { installLocalStorage } from "./fake-storage";

function commit(index: number, subject: string) {
  const sha = index.toString(16).padStart(7, "0").padEnd(40, "a");
  return {
    sha,
    shortSha: sha.slice(0, 7),
    subject,
    author: "Craig",
    date: "2026-09-14T20:29:26.000Z",
  };
}

const FIX_COMMIT = commit(1, "Fix the parser");
const DOCS_COMMIT = commit(2, "Update docs");
const EMPTY_COMMIT = commit(3, "");

function scopesOf(
  overrides: Partial<Extract<SessionDiffScopesResponse, { kind: "git" }>> = {},
): SessionDiffScopesResponse {
  return {
    kind: "git",
    base: "main",
    baseRef: "origin/main",
    mergeBase: "abc1234",
    head: "feature",
    uncommittedAvailable: true,
    commits: [FIX_COMMIT, DOCS_COMMIT],
    totalCommits: 2,
    ...overrides,
  };
}

function emptyDiff(scope: string): SessionDiffResponse {
  return {
    scope,
    source: scope === "session" ? "session-edits" : "git",
    stats: { files: 0, additions: 0, deletions: 0 },
    files: [],
  };
}

class FakeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function openScopeMenu(): Promise<void> {
  fireEvent.click(await screen.findByRole("button", { name: /^Diff scope:/ }));
  await flush();
}

async function openCommitsSubmenu(): Promise<void> {
  const trigger = screen.getByRole("menuitem", { name: /^Commits/ });
  act(() => trigger.focus());
  fireEvent.keyDown(trigger, { key: "ArrowRight" });
  await flush();
}

function radioOutline(): Array<[string | null, string | null]> {
  return screen
    .getAllByRole("menuitemradio")
    .map((node) => [node.textContent, node.getAttribute("aria-checked")]);
}

beforeEach(() => {
  installLocalStorage();
  vi.stubGlobal("ResizeObserver", FakeObserver);
  vi.stubGlobal("IntersectionObserver", FakeObserver);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderView(
  scopes: SessionDiffScopesResponse,
  scope = "branch",
  onSelectScope: (scope: string) => void = () => {},
) {
  return render(
    <ChangesPaneView
      diff={emptyDiff(scope)}
      scopes={scopes}
      controls={null}
      onRefresh={() => {}}
      scope={scope}
      onSelectScope={onSelectScope}
    />,
  );
}

describe("Changes scope menu", () => {
  it("offers All changes vs base, Uncommitted when dirty, Session edits and Commits", async () => {
    renderView(scopesOf());
    await openScopeMenu();

    expect({
      radios: radioOutline(),
      commits: screen.getByRole("menuitem", { name: /^Commits/ }).textContent,
    }).toEqual({
      radios: [
        ["All changesvs main", "true"],
        ["Uncommitted changes", "false"],
        ["Session edits", "false"],
      ],
      commits: "Commits2",
    });
  });

  it("hides Uncommitted changes when the tree is clean and Commits when there are none", async () => {
    renderView(scopesOf({ uncommittedAvailable: false, commits: [], totalCommits: 0 }));
    await openScopeMenu();

    expect({
      radios: radioOutline(),
      commits: screen.queryByRole("menuitem", { name: /^Commits/ }),
    }).toEqual({
      radios: [
        ["All changesvs main", "true"],
        ["Session edits", "false"],
      ],
      commits: null,
    });
  });

  it("labels the trigger after the selected scope", () => {
    const labels = ["branch", "uncommitted", "session", `commit:${FIX_COMMIT.sha}`].map((scope) => {
      const view = renderView(scopesOf(), scope);
      const label = screen.getByRole("button", { name: /^Diff scope:/ }).getAttribute("aria-label");
      view.unmount();
      return label;
    });
    expect(labels).toEqual([
      "Diff scope: main → feature",
      "Diff scope: Uncommitted changes",
      "Diff scope: Session edits",
      "Diff scope: Fix the parser",
    ]);
  });

  it("reports each scope choice", async () => {
    const onSelectScope = vi.fn();
    renderView(scopesOf(), "branch", onSelectScope);

    await openScopeMenu();
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Uncommitted changes" }));
    await openScopeMenu();
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Session edits" }));
    await openScopeMenu();
    fireEvent.click(screen.getByRole("menuitemradio", { name: /^All changes/ }));
    await openScopeMenu();
    await openCommitsSubmenu();
    fireEvent.click(screen.getByRole("menuitemradio", { name: /^Update docs/ }));

    expect(onSelectScope.mock.calls).toEqual([
      ["uncommitted"],
      ["session"],
      ["branch"],
      [`commit:${DOCS_COMMIT.sha}`],
    ]);
  });

  it("filters commits by search, with the overflow row and the no-match text", async () => {
    renderView(scopesOf({ commits: [FIX_COMMIT, DOCS_COMMIT, EMPTY_COMMIT], totalCommits: 53 }));
    await openScopeMenu();
    await openCommitsSubmenu();

    const commitRows = () =>
      screen
        .getAllByRole("menuitemradio")
        .slice(3)
        .map((node) => node.textContent);
    const all = {
      rows: commitRows(),
      overflow: screen.getByRole("menuitem", { name: "50 older commits not shown" }).ariaDisabled,
    };

    const search = screen.getByRole("textbox", { name: "Search commits" });
    fireEvent.change(search, { target: { value: "DOCS" } });
    const filtered = commitRows();
    fireEvent.change(search, { target: { value: FIX_COMMIT.shortSha } });
    const bySha = commitRows();
    fireEvent.change(search, { target: { value: "nothing like this" } });
    const none = { rows: commitRows(), empty: screen.getByText("No commits match") !== null };

    expect({ all, filtered, bySha, none }).toEqual({
      all: {
        rows: [
          `Fix the parser${FIX_COMMIT.shortSha}`,
          `Update docs${DOCS_COMMIT.shortSha}`,
          `(no message)${EMPTY_COMMIT.shortSha}`,
        ],
        overflow: "true",
      },
      filtered: [`Update docs${DOCS_COMMIT.shortSha}`],
      bySha: [`Fix the parser${FIX_COMMIT.shortSha}`],
      none: { rows: [], empty: true },
    });
  });
});

describe("ChangesPane scope", () => {
  let fetchedScopes: string[];
  let scopesResponse: SessionDiffScopesResponse;

  beforeEach(() => {
    fetchedScopes = [];
    scopesResponse = scopesOf();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        const url = new URL(input, "http://localhost");
        if (url.pathname.endsWith("/diff/scopes")) return Response.json(scopesResponse);
        const scope = url.searchParams.get("scope") ?? "";
        fetchedScopes.push(scope);
        return Response.json(emptyDiff(scope));
      }),
    );
  });

  function renderPane(queryClient = new QueryClient()) {
    render(
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <ChangesPane sessionId="s1" chrome={{ controls: null, moveHandle: null }} />
        </ToastProvider>
      </QueryClientProvider>,
    );
    return queryClient;
  }

  function storedScope(): unknown {
    const store: unknown = JSON.parse(localStorage.getItem(PANE_LAYOUT_STORAGE_KEY) ?? "{}");
    return (store as Record<string, { changesScope?: string }>)["s1"]?.changesScope;
  }

  function diffQueryKeys(queryClient: QueryClient): unknown[] {
    return queryClient
      .getQueryCache()
      .getAll()
      .map((query) => query.queryKey)
      .filter((key) => key[3] !== "scopes");
  }

  it("refetches with each scope's query key and persists the choice per session", async () => {
    const queryClient = renderPane();
    await waitFor(() => expect(fetchedScopes).toEqual(["branch"]));

    await openScopeMenu();
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Uncommitted changes" }));
    await waitFor(() => expect(fetchedScopes).toEqual(["branch", "uncommitted"]));
    const afterUncommitted = storedScope();

    await openScopeMenu();
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Session edits" }));
    await waitFor(() => expect(fetchedScopes).toEqual(["branch", "uncommitted", "session"]));

    await openScopeMenu();
    await openCommitsSubmenu();
    fireEvent.click(screen.getByRole("menuitemradio", { name: /^Fix the parser/ }));
    await waitFor(() => expect(fetchedScopes).toHaveLength(4));

    expect({
      fetchedScopes,
      keys: diffQueryKeys(queryClient),
      afterUncommitted,
      stored: storedScope(),
    }).toEqual({
      fetchedScopes: ["branch", "uncommitted", "session", `commit:${FIX_COMMIT.sha}`],
      keys: [
        ["sessions", "s1", "diff", "branch", false],
        ["sessions", "s1", "diff", "uncommitted", false],
        ["sessions", "s1", "diff", "session", false],
        ["sessions", "s1", "diff", `commit:${FIX_COMMIT.sha}`, false],
      ],
      afterUncommitted: "uncommitted",
      stored: `commit:${FIX_COMMIT.sha}`,
    });
  });

  it("starts from the persisted scope", async () => {
    localStorage.setItem(
      PANE_LAYOUT_STORAGE_KEY,
      JSON.stringify({ s1: { ...defaultPaneLayout(), changesScope: "session" } }),
    );
    renderPane();
    await waitFor(() => expect(fetchedScopes).toEqual(["session"]));
  });

  it("resets to the branch scope when the selected commit disappears", async () => {
    localStorage.setItem(
      PANE_LAYOUT_STORAGE_KEY,
      JSON.stringify({ s1: { ...defaultPaneLayout(), changesScope: "commit:deadbee" } }),
    );
    renderPane();
    await waitFor(() => expect(fetchedScopes.at(-1)).toBe("branch"));

    expect({
      stored: storedScope(),
      label: screen.getByRole("button", { name: /^Diff scope:/ }).getAttribute("aria-label"),
    }).toEqual({ stored: "branch", label: "Diff scope: main → feature" });
  });
});
