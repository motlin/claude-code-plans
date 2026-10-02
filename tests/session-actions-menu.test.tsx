// @vitest-environment jsdom

import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	Outlet,
	RouterProvider,
} from "@tanstack/react-router";
import {act, cleanup, fireEvent, render, screen, waitFor} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {SessionActionsMenu} from "../src/components/session-actions-menu";
import {ToastProvider} from "../src/components/toast";
import {herdrPanesQueryOptions, type HerdrPaneIndexData} from "../src/lib/api/herdr";
import {sessionOpenInQueryOptions, sessionQueryKeys, type SessionListItem} from "../src/lib/api/sessions";
import {getPendingFork, setPendingFork} from "../src/lib/session-fork";
import type {SessionBucket} from "../src/lib/session-state";
import {__unreadStoreTesting, hasUnseenWork, syncUnseenFromSummaries} from "../src/lib/unread-store";
import {pin, readPinState} from "../src/lib/pin-store";
import {installLocalStorage} from "./fake-storage";

const SESSION_ID = "8f0c2c7e-1111-4222-8333-944445555666";

function listItem(bucket: SessionBucket, overrides: Partial<SessionListItem> = {}): SessionListItem {
	return {
		id: SESSION_ID,
		title: "Fix the flaky test",
		mtime: "2026-09-28T10:00:00.000Z",
		created: "2026-09-28T09:00:00.000Z",
		project: "-projects-alpha",
		projectName: "alpha",
		messageCount: 4,
		archived: false,
		state: "ended",
		bucket,
		liveAgentCount: 0,
		unseen: false,
		blockedSince: null,
		...overrides,
	};
}

async function flush() {
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 0));
	});
}

async function renderRow(
	session: SessionListItem,
	livePaneSessionIds: string[] = [],
	{cwd, writesEnabled = false}: {cwd?: string; writesEnabled?: boolean} = {},
	configure?: (client: QueryClient) => void,
) {
	const queryClient = new QueryClient({
		defaultOptions: {
			queries: {retry: false, staleTime: Infinity, gcTime: Infinity, refetchOnMount: false},
		},
	});
	const panes: HerdrPaneIndexData = {
		panes: livePaneSessionIds.map((sessionId) => ({
			paneId: `pane-${sessionId}`,
			terminalId: "t1",
			workspaceId: "w1",
			tabId: "tab1",
			focused: false,
			cwd: null,
			foregroundCwd: null,
			agentStatus: "idle",
			agent: "claude",
			terminalTitle: null,
			agentSessionId: sessionId,
			revision: 1,
			sessionId,
			via: "agent-session" as const,
			viewedState: {
				currentMessageIndex: 0,
				lastViewedMessageIndex: 0,
				reviewTargetMessageIndex: 0,
				newMessageCount: 0,
				viewedInCcp: true,
				viewedInHerdr: false,
				viewedAnywhere: true,
			},
		})),
		writesEnabled,
	};
	queryClient.setQueryData(herdrPanesQueryOptions.queryKey, panes);
	if (cwd !== undefined) {
		queryClient.setQueryData(sessionOpenInQueryOptions(session.id).queryKey, {
			cwd,
			bridgeSessionId: null,
		});
	}
	configure?.(queryClient);
	const rootRoute = createRootRoute({
		component: () => (
			<QueryClientProvider client={queryClient}>
				<ToastProvider>
					<SessionActionsMenu session={session}>
						<a href={`/session/${session.id}`}>Row title</a>
					</SessionActionsMenu>
					<Outlet />
				</ToastProvider>
			</QueryClientProvider>
		),
	});
	const homeRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "/",
		component: () => null,
	});
	const sessionRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "/session/$id",
		component: () => <p>session page</p>,
	});
	const router = createRouter({
		routeTree: rootRoute.addChildren([homeRoute, sessionRoute]),
		history: createMemoryHistory({initialEntries: ["/"]}),
	});
	await router.load();
	render(<RouterProvider router={router} />);
	await waitFor(() => expect(screen.getByText("Row title")).toBeTruthy());
	return router;
}

async function rightClickRow(): Promise<HTMLElement> {
	fireEvent.contextMenu(screen.getByText("Row title"), {clientX: 40, clientY: 50});
	await flush();
	return screen.getByRole("menu");
}

function outline(menu: HTMLElement): string[] {
	return [...menu.querySelectorAll('[role="menuitem"], [role="separator"]')].map((node) =>
		node.getAttribute("role") === "separator"
			? "---"
			: `${node.textContent ?? ""} [${node.getAttribute("aria-keyshortcuts") ?? ""}]`,
	);
}

const writeText = vi.fn<(text: string) => Promise<void>>();

beforeEach(() => {
	installLocalStorage();
	writeText.mockReset();
	writeText.mockResolvedValue(undefined);
	Object.defineProperty(navigator, "clipboard", {value: {writeText}, configurable: true});
	__unreadStoreTesting.reset();
	__unreadStoreTesting.setPersist(() => Promise.resolve());
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	setPendingFork(null);
	__unreadStoreTesting.reset();
});

describe("SessionActionsMenu", () => {
	it("copies the fresh canonical URL from the row menu without looking up an identity", async () => {
		const fetch = vi.fn<(input: RequestInfo | URL) => Promise<Response>>(() => new Promise<Response>(() => {}));
		vi.stubGlobal("fetch", fetch);
		await renderRow(listItem("done"), [], {}, (client) => {
			client.setQueryData(sessionQueryKeys.detail(SESSION_ID), {canonicalRouteId: "session_alice_100"});
		});
		await rightClickRow();
		fireEvent.click(screen.getByRole("menuitem", {name: /^Copy link/}));
		await waitFor(() =>
			expect(writeText.mock.calls).toStrictEqual([[`${window.location.origin}/session/session_alice_100`]]),
		);
		expect(fetch.mock.calls.filter(([url]) => String(url).endsWith("/identity"))).toStrictEqual([]);
	});

	it("labels the hover kebab with the session title", async () => {
		await renderRow(listItem("done"));

		expect(
			screen.getByRole("button", {name: "More options for Fix the flaky test"}).getAttribute("aria-haspopup"),
		).toBe("menu");
	});

	it("opens the menu on right-click with accelerators in aria-keyshortcuts", async () => {
		await renderRow(listItem("done"));

		const menu = await rightClickRow();

		expect(menu.getAttribute("data-cds")).toBe("ContextMenu");
		expect(outline(menu)).toEqual([
			"PinP [p]",
			"Mark as unreadU [u]",
			"RenameR [r]",
			"Copy linkC [c]",
			"ForkF [f]",
			"---",
			"Move to group []",
			"---",
			"ArchiveA [a]",
		]);
	});

	it("pins and unpins in this browser with p", async () => {
		await renderRow(listItem("done"));

		fireEvent.keyDown(await rightClickRow(), {key: "p", code: "KeyP"});
		await flush();
		const afterPin = readPinState();
		fireEvent.keyDown(await rightClickRow(), {key: "p", code: "KeyP"});
		await flush();

		expect({afterPin, afterUnpin: readPinState()}).toStrictEqual({
			afterPin: {pinnedIds: [SESSION_ID], pinnedOrder: []},
			afterUnpin: {pinnedIds: [], pinnedOrder: []},
		});
	});

	it("opens the same items from the kebab", async () => {
		syncUnseenFromSummaries([{id: SESSION_ID, unseen: true}]);
		pin(SESSION_ID);
		await renderRow(listItem("review"));

		fireEvent.click(screen.getByRole("button", {name: "More options for Fix the flaky test"}));
		await flush();

		const menu = screen.getByRole("menu");
		expect(menu.getAttribute("data-cds")).toBe("Menu");
		expect(outline(menu)).toEqual([
			"UnpinP [p]",
			"Mark as readU [u]",
			"RenameR [r]",
			"Copy linkC [c]",
			"ForkF [f]",
			"---",
			"Move to group []",
			"---",
			"ArchiveA [a]",
		]);
	});

	it("shows the live terminal under Open in when a herdr pane is live", async () => {
		await renderRow(listItem("working"), [SESSION_ID]);

		const menu = await rightClickRow();

		expect(outline(menu)).toEqual([
			"Open in []",
			"---",
			"PinP [p]",
			"RenameR [r]",
			"Copy linkC [c]",
			"ForkF [f]",
			"---",
			"Move to group []",
			"---",
			"ArchiveA [a]",
		]);
	});

	it("copies the session link when c is pressed and closes", async () => {
		await renderRow(listItem("done"));
		const menu = await rightClickRow();

		fireEvent.keyDown(menu, {key: "c"});
		await flush();

		expect(writeText.mock.calls).toEqual([[`${window.location.origin}/session/${SESSION_ID}`]]);
		expect(screen.queryByRole("menu")).toBeNull();
		await waitFor(() =>
			expect(document.querySelector("[data-toast-message]")?.textContent).toBe("Link copied to clipboard."),
		);
	});

	it("marks the session unread when u is pressed", async () => {
		await renderRow(listItem("done"));
		const menu = await rightClickRow();

		fireEvent.keyDown(menu, {key: "u"});
		await flush();

		expect(hasUnseenWork(SESSION_ID)).toBe(true);
	});

	it("closes on Escape", async () => {
		await renderRow(listItem("done"));
		const menu = await rightClickRow();

		fireEvent.keyDown(menu, {key: "Escape"});
		await flush();

		expect(screen.queryByRole("menu")).toBeNull();
	});

	it("disables Fork with a reason while the session is working", async () => {
		await renderRow(listItem("working"), [], {cwd: "/Users/alice/alpha"});

		const menu = await rightClickRow();
		const fork = [...menu.querySelectorAll('[role="menuitem"]')].find((node) => node.textContent === "ForkF");

		expect({
			disabled: fork?.getAttribute("aria-disabled"),
			title: fork?.getAttribute("title"),
		}).toEqual({disabled: "true", title: "Session file is still being written"});
	});

	it("launches the fork in herdr when f is pressed", async () => {
		const fetchMock = vi.fn<typeof fetch>();
		fetchMock.mockResolvedValue(Response.json({ok: true, tabId: "w1:t2", paneId: "w1:p3", sessionId: null}));
		vi.stubGlobal("fetch", fetchMock);
		await renderRow(listItem("done"), [], {cwd: "/Users/alice/alpha", writesEnabled: true});
		const menu = await rightClickRow();

		fireEvent.keyDown(menu, {key: "f"});
		await flush();

		expect(fetchMock.mock.calls.map(([input, init]) => [input, init?.body])).toEqual([
			[
				"/api/herdr/launch",
				JSON.stringify({
					cwd: "/Users/alice/alpha",
					args: ["--resume", SESSION_ID, "--fork-session"],
				}),
			],
		]);
		await waitFor(() =>
			expect(getPendingFork()).toEqual({
				cwd: "/Users/alice/alpha",
				since: expect.any(Number),
				sessionId: null,
				parentSessionId: SESSION_ID,
			}),
		);
		expect(writeText).not.toHaveBeenCalled();
	});

	it("copies the fork command when herdr writes are disabled", async () => {
		await renderRow(listItem("done"), [], {cwd: "/Users/alice/alpha"});
		const menu = await rightClickRow();

		fireEvent.keyDown(menu, {key: "f"});
		await flush();

		expect(writeText.mock.calls).toEqual([
			[`cd '/Users/alice/alpha' && claude --resume ${SESSION_ID} --fork-session`],
		]);
		await waitFor(() =>
			expect(document.querySelector("[data-toast-message]")?.textContent).toBe(
				"Command copied. Paste it in a terminal to fork this session.",
			),
		);
		expect(getPendingFork()).toBeNull();
	});
});
