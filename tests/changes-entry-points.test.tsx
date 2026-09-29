// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { BranchStrip } from "../src/components/branch-strip";
import { ChangesPaneView } from "../src/components/changes/changes-pane";
import { registerPane } from "../src/components/panes/pane-registry";
import { TileHost } from "../src/components/panes/tile-host";
import { SettingsProvider } from "../src/components/settings-provider";
import { ToastProvider } from "../src/components/toast";
import { TurnChangesCard } from "../src/components/turn-changes-card";
import { WorkingCopyReviewBanner } from "../src/components/working-copy-review-banner";
import type { SessionDiffResponse } from "../src/lib/api/session-diff";
import { loadChangesReview, openReviewInChanges } from "../src/lib/changes-review";
import { CHANGES_SCOPE_REQUEST_EVENT } from "../src/lib/changes-scope-request";
import { loadChangesScope, saveChangesScope } from "../src/lib/pane-layout";
import type { ReviewFinding } from "../src/lib/review-diff";
import { installLocalStorage } from "./fake-storage";

const reviewOffers = vi.hoisted(() => ({ listener: null as ((sessionId: string) => void) | null }));

vi.mock("../src/lib/hmr-persist", () => ({
  hmrPersist: <T,>(_key: string, initialize: () => T): T => initialize(),
}));
vi.mock("../src/hooks/use-claude-events", () => ({
  useClaudeEvents: () => ({ failedTools: new Map() }),
  useSubscribeReviewOffers: () => (listener: (sessionId: string) => void) => {
    reviewOffers.listener = listener;
    return () => {
      reviewOffers.listener = null;
    };
  },
}));
vi.mock("../src/lib/api/reviews", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/api/reviews")>()),
  createWorkingCopyReview: vi.fn(async () => "review-1"),
  runWorkingCopyReview: vi.fn(async () => ({
    processId: "process-1",
    completion: Promise.resolve(""),
  })),
  cancelWorkingCopyReview: vi.fn(async () => true),
}));

class FakeObserver {
  constructor(private readonly callback?: ResizeObserverCallback) {}
  observe(target: Element) {
    this.callback?.(
      [{ target, contentRect: { width: 800 } } as unknown as ResizeObserverEntry],
      this as unknown as ResizeObserver,
    );
  }
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

class SilentObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

let scopeRequests: unknown[] = [];
const recordScopeRequest = (event: Event) => scopeRequests.push((event as CustomEvent).detail);
let unregisterChanges: () => void = () => {};

beforeEach(() => {
  installLocalStorage();
  sessionStorage.clear();
  vi.stubGlobal("ResizeObserver", FakeObserver);
  vi.stubGlobal("IntersectionObserver", FakeObserver);
  vi.stubGlobal("requestAnimationFrame", () => 0);
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
    DOMRect.fromRect({ x: 0, y: 0, width: 1200, height: 800 }),
  );
  scopeRequests = [];
  window.addEventListener(CHANGES_SCOPE_REQUEST_EVENT, recordScopeRequest);
  unregisterChanges = registerPane("changes", {
    title: "Changes",
    render: () => <div data-testid="changes-pane">Changes pane</div>,
  });
});

afterEach(() => {
  cleanup();
  unregisterChanges();
  window.removeEventListener(CHANGES_SCOPE_REQUEST_EVENT, recordScopeRequest);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function inHost(sessionId: string, children: React.ReactNode) {
  return render(
    <SettingsProvider>
      <ToastProvider>
        <TileHost sessionId={sessionId} onExpandWithoutPane={() => {}}>
          {children}
        </TileHost>
      </ToastProvider>
    </SettingsProvider>,
  );
}

describe("Changes entry points", () => {
  it("opens Changes on the branch scope from the branch strip's +N −M", () => {
    saveChangesScope("strip-session", "uncommitted");
    inHost(
      "strip-session",
      <BranchStrip
        sessionId="strip-session"
        session={{
          projectName: "demo",
          projectPath: "/work/demo",
          cwd: "/work/demo",
          gitBranch: "feature/x",
        }}
        statusline={{ cost: { total_lines_added: 12, total_lines_removed: 3 } }}
      />,
    );
    const before = screen.queryByTestId("changes-pane");
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "12 additions, 3 deletions" }));
    });

    expect({
      before,
      opened: screen.queryByTestId("changes-pane")?.textContent,
      scope: loadChangesScope("strip-session"),
      scopeRequests,
    }).toStrictEqual({
      before: null,
      opened: "Changes pane",
      scope: "branch",
      scopeRequests: [{ sessionId: "strip-session", scope: "branch" }],
    });
  });

  it("opens Changes on the turn scope from the turn card header", () => {
    inHost(
      "turn-session",
      <TurnChangesCard
        sessionId="turn-session"
        changes={{
          turnUuid: "u-7",
          anchorLineIndex: 0,
          added: 1,
          removed: 0,
          files: [{ path: "/repo/a.ts", added: 1, removed: 0 }],
        }}
      />,
    );
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /^Edited 1 file/ }));
    });

    expect({
      opened: screen.queryByTestId("changes-pane")?.textContent,
      scope: loadChangesScope("turn-session"),
      scopeRequests,
    }).toStrictEqual({
      opened: "Changes pane",
      scope: "turn:u-7",
      scopeRequests: [{ sessionId: "turn-session", scope: "turn:u-7" }],
    });
  });

  it("points the review banner's View findings at the session's Changes pane on the Uncommitted scope", async () => {
    render(
      <SettingsProvider>
        <WorkingCopyReviewBanner
          capability={{
            enabled: true,
            config: { offerMode: "offer" },
            installed: true,
            available: true,
            unavailabilityReason: null,
          }}
        />
      </SettingsProvider>,
    );
    await act(async () => {
      reviewOffers.listener?.("banner-session");
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Review" }));
    });
    const link = await screen.findByRole("link", { name: "View findings" });
    act(() => {
      link.addEventListener("click", (event) => event.preventDefault());
      fireEvent.click(link);
    });

    expect({
      href: link.getAttribute("href"),
      scope: loadChangesScope("banner-session"),
      review: loadChangesReview("banner-session"),
      scopeRequests,
    }).toStrictEqual({
      href: "/session/banner-session?pane=changes",
      scope: "uncommitted",
      review: "review-1",
      scopeRequests: [{ sessionId: "banner-session", scope: "uncommitted" }],
    });
  });

  it("turns the /review/$reviewId deep link into the session with the Changes pane open", () => {
    const target = openReviewInChanges("deep-session", "review-9");

    expect({
      target,
      scope: loadChangesScope("deep-session"),
      review: loadChangesReview("deep-session"),
    }).toStrictEqual({
      target: { to: "/session/$id", params: { id: "deep-session" }, search: { pane: "changes" } },
      scope: "uncommitted",
      review: "review-9",
    });
  });
});

const PATCH = `diff --git a/src/greet.ts b/src/greet.ts
index 1111111..2222222 100644
--- a/src/greet.ts
+++ b/src/greet.ts
@@ -1,3 +1,4 @@
 export function greet(name: string) {
-  return "hi " + name;
+  const greeting = "hello";
+  return greeting + " " + name;
 }
`;

const DIFF: SessionDiffResponse = {
  scope: "uncommitted",
  source: "git",
  stats: { files: 1, additions: 2, deletions: 1 },
  files: [
    {
      path: "src/greet.ts",
      status: "modified",
      additions: 2,
      deletions: 1,
      binary: false,
      patchLineCount: 10,
      patch: PATCH,
    },
  ],
};

const FINDING: ReviewFinding = {
  id: "f-1",
  file: "src/greet.ts",
  side: "new",
  line: 2,
  severity: "medium",
  title: "Greeting is hard-coded",
  body: "Move it to a constant.",
  resolved: false,
};

describe("Changes pane review findings", () => {
  it("renders unresolved findings inline on their diff line with Fix this one and Dismiss finding", () => {
    vi.stubGlobal("ResizeObserver", SilentObserver);
    const onFix = vi.fn();
    const onDismiss = vi.fn();
    const { container } = render(
      <SettingsProvider>
        <ToastProvider>
          <ChangesPaneView
            diff={DIFF}
            scopes={undefined}
            controls={null}
            onRefresh={() => {}}
            scope="uncommitted"
            findings={[
              FINDING,
              { ...FINDING, id: "f-2", title: "Already handled", resolved: true },
            ]}
            onFixFinding={onFix}
            onDismissFinding={onDismiss}
          />
        </ToastProvider>
      </SettingsProvider>,
    );
    const slot = container.querySelector('[slot="annotation-additions-2"]');
    expect(slot).not.toBeNull();
    const card = within(slot as HTMLElement);
    fireEvent.click(card.getByRole("button", { name: "Fix this one" }));
    fireEvent.click(card.getByRole("button", { name: "Dismiss finding" }));

    expect({
      titles: [...container.querySelectorAll("[data-finding-title]")].map((el) => el.textContent),
      fixed: onFix.mock.calls,
      dismissed: onDismiss.mock.calls,
    }).toStrictEqual({
      titles: ["Greeting is hard-coded"],
      fixed: [[FINDING]],
      dismissed: [[FINDING]],
    });
  });
});
