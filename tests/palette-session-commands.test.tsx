// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
  useParams,
} from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { CommandPalette, PALETTE_RECENT_LIMIT } from "../src/components/command-palette";
import { SessionTitleHeading } from "../src/components/session-title-heading";
import { ToastProvider } from "../src/components/toast";
import { useCommandPalette } from "../src/hooks/use-command-palette";
import {
  recentSessionsQueryOptions,
  sessionDetailQueryOptions,
  type SessionDetailData,
} from "../src/lib/api/sessions";

const MAC_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";

const TITLE = "Migrate the indexer to incremental scans for huge projects";
const QUOTED = "“Migrate the indexer to incremental scan…”";

function detail(overrides: Partial<SessionDetailData> = {}): SessionDetailData {
  return {
    title: TITLE,
    projectName: "project-a",
    projectId: "project-a",
    homeRoot: "/users/dev",
    imageRoots: [],
    starred: false,
    summary: null,
    projectPath: "/users/dev/project-a",
    gitBranch: null,
    cwd: null,
    gitSha: null,
    gitClean: null,
    messageCount: 1,
    pendingTaskCount: 0,
    viewedState: "unviewed",
    ...overrides,
  } as SessionDetailData;
}

function Harness() {
  const palette = useCommandPalette();
  return (
    <>
      <textarea aria-label="Composer" />
      <CommandPalette {...palette} />
    </>
  );
}

function SessionRoute() {
  const { id } = useParams({ strict: false });
  return <SessionTitleHeading sessionId={id ?? ""} title={TITLE} />;
}

async function openPalette(initialPath: string, sessionDetail: SessionDetailData = detail()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(recentSessionsQueryOptions(PALETTE_RECENT_LIMIT).queryKey, {
    sessions: [],
    nextCursor: null,
  });
  queryClient.setQueryData(sessionDetailQueryOptions("sess-1").queryKey, sessionDetail);
  const rootRoute = createRootRoute({
    component: () => (
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <Harness />
          <Outlet />
        </ToastProvider>
      </QueryClientProvider>
    ),
  });
  const sessionRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "session/$id",
    component: SessionRoute,
  });
  const plansRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "plans",
    component: () => null,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([sessionRoute, plansRoute]),
    history: createMemoryHistory({ initialEntries: [initialPath] }),
  });
  await router.load();
  render(<RouterProvider router={router} />);
  const composer = await screen.findByRole("textbox", { name: "Composer" });
  composer.focus();
  fireEvent.keyDown(composer, { key: "k", code: "KeyK", metaKey: true });
  const dialog = await screen.findByRole("dialog", { name: "Search" });
  return { dialog, input: within(dialog).getByRole("combobox", { name: "Search" }) };
}

function optionLabels(dialog: HTMLElement): string[] {
  return [...dialog.querySelectorAll("[cmdk-item]")].map(
    (item) => item.querySelector("[data-palette-label]")?.textContent ?? "",
  );
}

describe("palette contextual session commands", () => {
  const writeText = vi.fn((_text: string) => Promise.resolve());
  const fetchMock = vi.fn((_url: string, _init?: RequestInit) => new Promise<Response>(() => {}));

  beforeEach(() => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(MAC_UA);
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    Element.prototype.scrollIntoView = () => {};
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    writeText.mockClear();
    fetchMock.mockClear();
  });

  it("lists the copy commands with the quoted title when 'copy' is typed on a session page", async () => {
    const { dialog, input } = await openPalette("/session/sess-1");

    fireEvent.change(input, { target: { value: "copy" } });

    await within(dialog).findByRole("option", { name: `Copy link to ${QUOTED}` });
    expect(optionLabels(dialog).slice(0, 4)).toStrictEqual([
      "New session",
      `Copy link to ${QUOTED}`,
      "Copy resume command",
      "Copy fork command",
    ]);
  });

  it("offers Pin, Rename and the session commands for 'session'", async () => {
    const { dialog, input } = await openPalette("/session/sess-1");

    fireEvent.change(input, { target: { value: "session" } });

    await within(dialog).findByRole("option", { name: `Pin ${QUOTED}` });
    expect(optionLabels(dialog).slice(0, 6)).toStrictEqual([
      "New session",
      `Pin ${QUOTED}`,
      `Rename ${QUOTED}`,
      `Copy link to ${QUOTED}`,
      "Copy resume command",
      "Copy fork command",
    ]);
  });

  it("offers Unpin for a starred session", async () => {
    const { dialog, input } = await openPalette("/session/sess-1", detail({ starred: true }));

    fireEvent.change(input, { target: { value: "pin" } });

    await within(dialog).findByRole("option", { name: `Unpin ${QUOTED}` });
  });

  it("hides the commands in the empty state", async () => {
    const { dialog } = await openPalette("/session/sess-1");

    await within(dialog).findByRole("option", { name: "Settings" });
    expect(optionLabels(dialog).filter((label) => label.includes("Copy"))).toStrictEqual([]);
  });

  it("does not offer the commands on other routes", async () => {
    const { dialog, input } = await openPalette("/plans");

    fireEvent.change(input, { target: { value: "copy" } });

    await within(dialog).findByRole("option", { name: /See all results/ });
    expect(optionLabels(dialog).filter((label) => label.startsWith("Copy"))).toStrictEqual([]);
  });

  it("copies the resume command in the project directory", async () => {
    const { dialog, input } = await openPalette("/session/sess-1");

    fireEvent.change(input, { target: { value: "resume" } });
    fireEvent.click(await within(dialog).findByRole("option", { name: "Copy resume command" }));

    await waitFor(() =>
      expect(writeText.mock.calls).toStrictEqual([
        ["cd '/users/dev/project-a' && claude -r sess-1"],
      ]),
    );
    expect(await screen.findByText("Command copied to clipboard.")).toBeTruthy();
  });

  it("copies the fork command", async () => {
    const { dialog, input } = await openPalette("/session/sess-1");

    fireEvent.change(input, { target: { value: "fork" } });
    fireEvent.click(await within(dialog).findByRole("option", { name: "Copy fork command" }));

    await waitFor(() =>
      expect(writeText.mock.calls).toStrictEqual([
        ["cd '/users/dev/project-a' && claude -r sess-1 --fork-session"],
      ]),
    );
  });

  it("copies the session link", async () => {
    const { dialog, input } = await openPalette("/session/sess-1");

    fireEvent.change(input, { target: { value: "link" } });
    fireEvent.click(await within(dialog).findByRole("option", { name: `Copy link to ${QUOTED}` }));

    await waitFor(() =>
      expect(writeText.mock.calls).toStrictEqual([["http://localhost:3000/session/sess-1"]]),
    );
    expect(await screen.findByText("Link copied to clipboard.")).toBeTruthy();
  });

  it("pins the session", async () => {
    const { dialog, input } = await openPalette("/session/sess-1");

    fireEvent.change(input, { target: { value: "pin" } });
    fireEvent.click(await within(dialog).findByRole("option", { name: `Pin ${QUOTED}` }));

    await waitFor(() =>
      expect(
        fetchMock.mock.calls
          .filter(([url]) => url.endsWith("/starred"))
          .map(([url, init]) => [url, init?.method, init?.body]),
      ).toStrictEqual([["/api/sessions/sess-1/starred", "PUT", JSON.stringify({ starred: true })]]),
    );
  });

  it("starts renaming the session title", async () => {
    const { dialog, input } = await openPalette("/session/sess-1");

    fireEvent.change(input, { target: { value: "rename" } });
    fireEvent.click(await within(dialog).findByRole("option", { name: `Rename ${QUOTED}` }));

    const rename = await screen.findByRole("textbox", { name: "Rename" });
    expect((rename as HTMLInputElement).value).toBe(TITLE);
  });
});
